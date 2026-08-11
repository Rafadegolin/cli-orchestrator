'use strict';

// Monta e destroi painéis na grade. Sem biblioteca de layout: CSS Grid resolve.

// Sem desestruturar: painel.js e grade.js sao scripts classicos e dividem o
// mesmo escopo lexico global -- redeclarar `Painel` aqui e SyntaxError.
const OrqP = window.OrqPainel;
const porId = OrqP.painelPorId;

const elGrade = document.getElementById('grade');
const elVazio = document.getElementById('vazio');
const elNome = document.getElementById('nome-feature');
const btnNovo = document.getElementById('btn-novo');

let seq = 0;
let focado = null;

function novoId() {
  seq += 1;
  return `p${seq}-${Date.now().toString(36)}`;
}

// As colunas vem da DENSIDADE escolhida pelo usuario (casca.js), nao mais da
// contagem de painéis: um numero que muda sozinho a cada painel aberto e
// exatamente o oposto de uma grade previsivel.
function atualizarVazio() {
  elVazio.hidden = elGrade.childElementCount > 0;
  // A grade mudou, entao a conta de "retomar todas" mudou junto. Sem isto o
  // botao ficava com o numero da restauracao para sempre -- fechei os quatro
  // painéis restaurados, abri quatro novos, e ele seguia dizendo "(4)".
  window.OrqLateral?.atualizarRetomarTodas?.();
}

async function criarPainel({ cwd, feature, comandoInicial, dormindo, indisponivel, ligacoes }) {
  const id = novoId();

  const painel = new OrqP.Painel({
    id,
    feature: feature || OrqP.nomeCurto(cwd),
    cwd,
    aoFocar: (pid) => { focado = pid; marcarFocado(); },
    aoFechar: () => {
      atualizarVazio();
      window.OrqLateral?.remover(id);
      // Painel fechado antes de partir nao pode deixar entrada presa na fila.
      window.OrqFila?.remover(id);
      window.OrqFila?.reavaliar();
      salvarSessao();
    },
  });

  painel.comandoInicial = comandoInicial || '';
  painel.ligacoes = Array.isArray(ligacoes) ? [...ligacoes] : [];

  elGrade.append(painel.el);
  atualizarVazio();

  // O fit precisa do elemento ja no DOM e com tamanho para calcular cols/rows.
  painel.ajustar();

  // Painel restaurado: monta tudo menos o PTY, e espera voce mandar retomar.
  if (dormindo) {
    painel.mostrarDormindo({
      indisponivel,
      aoRetomar: () => despertar(id),
      aoRemover: () => painel.destruir(),
    });
    window.OrqLateral?.registrar({ id, feature: painel.feature, cwd });
    window.OrqLateral?.definirStatus(id, indisponivel ? 'encerrada' : 'iniciando',
      indisponivel ? 'pasta nao encontrada' : 'aguardando voce retomar');
    salvarSessao();
    return painel;
  }

  // Registrar ANTES de abrir o terminal: o primeiro byte pode voltar do PTY
  // enquanto o await ainda esta pendente, e ai o gancho chegaria tarde.
  //
  // A fila entra DEPOIS do primeiro dado, nao antes: o shell precisa estar
  // pronto de qualquer jeito, e segurar antes disso so atrasaria a checagem de
  // vaga sem economizar nada.
  if (comandoInicial) {
    // Sessao nova entra ja com as flags: lancar com --add-dir nao pede
    // confirmacao nenhuma, ao contrario do /add-dir em sessao viva.
    const comando = window.OrqLigacoes
      ? window.OrqLigacoes.comAddDir(comandoInicial, painel.ligacoes)
      : comandoInicial;
    painel.aoPrimeiroDado(() => {
      const enviar = () => window.orq.escrever(id, `${comando}\r`);
      if (window.OrqFila) window.OrqFila.pedirVaga(id, enviar);
      else enviar();
    });
  }

  try {
    window.OrqLateral?.registrar({ id, feature: painel.feature, cwd });
    const aberto = await window.orq.abrirTerminal({
      id,
      cwd,
      feature: painel.feature,
      cols: painel.term.cols,
      rows: painel.term.rows,
    });
    painel.definirPortas(aberto?.portas);
    painel.definirStatus('rodando', 'shell aberto');
  } catch (err) {
    painel.definirStatus('encerrada', String(err));
    painel.term.write(`\r\n\x1b[31mfalhou ao abrir: ${String(err)}\x1b[0m\r\n`);
    return painel;
  }

  painel.focar();
  salvarSessao();
  return painel;
}

// ------------------------------------------------------ sessao e retomada

// Retrato do arranjo atual. Painel dormindo entra igual: ele faz parte do que
// voce quer de volta amanha.
function retratoSessao() {
  return [...elGrade.children].map((el, ordem) => {
    const p = porId.get(el.dataset.id);
    return p ? {
      feature: p.feature,
      cwd: p.cwd,
      comandoInicial: p.comandoInicial || '',
      // Ligacao e entre PASTAS, nao entre ids: id de painel e efemero, pasta
      // sobrevive ao fechar e reabrir.
      ligacoes: p.ligacoes || [],
      ordem,
    } : null;
  }).filter(Boolean);
}

// Debounce: abrir oito painéis nao pode virar oito gravacoes em disco.
let timerSessao = null;
function salvarSessao({ agora = false } = {}) {
  clearTimeout(timerSessao);
  if (agora) {
    window.orq.sessaoSalvar(retratoSessao());
    return;
  }
  timerSessao = setTimeout(() => window.orq.sessaoSalvar(retratoSessao()), 500);
}

// Fechar dentro da janela do debounce perderia a ultima mudanca -- justo o
// arranjo que voce acabou de montar.
window.addEventListener('beforeunload', () => salvarSessao({ agora: true }));

async function despertar(id) {
  const painel = porId.get(id);
  if (!painel || !painel.dormindo) return null;

  painel.acordou();
  painel.ajustar();

  const comando = window.OrqLigacoes
    ? window.OrqLigacoes.comAddDir(painel.comandoInicial, painel.ligacoes)
    : painel.comandoInicial;
  if (comando) {
    painel.aoPrimeiroDado(() => {
      const enviar = () => window.orq.escrever(id, `${comando}\r`);
      if (window.OrqFila) window.OrqFila.pedirVaga(id, enviar);
      else enviar();
    });
  }

  try {
    const aberto = await window.orq.abrirTerminal({
      id,
      cwd: painel.cwd,
      feature: painel.feature,
      cols: painel.term.cols,
      rows: painel.term.rows,
    });
    painel.definirPortas(aberto?.portas);
    painel.definirStatus('rodando', 'shell aberto');
  } catch (err) {
    painel.definirStatus('encerrada', String(err));
    painel.term.write(`\r\n\x1b[31mfalhou ao retomar: ${String(err)}\x1b[0m\r\n`);
  }

  painel.focar();
  return painel;
}

// Restaura o arranjo salvo: painéis dormindo, na ordem, SEM subir PTY nenhum.
async function restaurarSessao() {
  const salvos = await window.orq.sessaoCarregar();
  for (const s of salvos) {
    await criarPainel({
      cwd: s.cwd,
      feature: s.feature,
      comandoInicial: s.comandoInicial,
      ligacoes: s.ligacoes,
      dormindo: true,
      indisponivel: !s.existe,
    });
  }
  window.OrqLateral?.atualizarRetomarTodas?.();
  return salvos.length;
}

function dormindos() {
  return [...porId.values()].filter((p) => p.dormindo && p.status !== 'encerrada');
}

async function retomarTodas() {
  // A fila da Fase 6 espaca as partidas, entao pedir todas de uma vez deixou de
  // ser a rajada que a spec temia.
  for (const p of dormindos()) await despertar(p.id);
  window.OrqLateral?.atualizarRetomarTodas?.();
}

// Reordena a grade por `style.order`, NUNCA movendo nos no DOM.
//
// Mover o elemento de um xterm funciona, mas cada mudanca de status dispararia
// reflow e fit() em cascata em todos os painéis -- e status muda o tempo todo.
// Com `order` o navegador so reposiciona caixas ja montadas.
//
// A ordem salva pela Fase 7 continua sendo a do DOM (ordem de criacao), que e o
// que `retratoSessao()` le: a ordenacao da tela e uma VISTA, nao o arranjo.
function ordenarGrade(lista) {
  const ordenada = lista || window.OrqLateral?.ordenadas?.() || [];
  ordenada.forEach((c, i) => {
    const p = porId.get(c.id);
    if (p) p.el.style.order = String(i);
  });
}

function marcarFocado() {
  for (const [id, p] of porId) {
    p.el.classList.toggle('painel-focado', id === focado);
  }
  // O card da lateral acompanha: uma sessao focada por vez, e voce tem de
  // conseguir ver qual e sem olhar para a grade.
  for (const li of document.querySelectorAll('#lateral-lista .card')) {
    li.classList.toggle('card-focado', li.dataset.id === focado);
  }
}

function focarPainel(id) {
  const p = porId.get(id);
  if (p) p.focar();
}

// ------------------------------------------------------------ eventos

btnNovo.addEventListener('click', async () => {
  const cwd = await window.orq.escolherPasta();
  if (!cwd) return;
  const feature = elNome.value.trim();
  elNome.value = '';
  await criarPainel({ cwd, feature });
});

// Enter aciona a acao PRIMARIA, que e a mesma que a dica ao lado descreve.
// Antes abria o seletor de pasta do "Painel avulso", que nao tem relacao com o
// nome de feature que voce acabou de digitar.
elNome.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  document.getElementById('btn-nova-sessao')?.click();
});

// Um unico ouvinte para todos os painéis: o lote chega com todos juntos.
window.orq.aoReceberDados((lote) => {
  for (const { id, bytes } of lote) {
    porId.get(id)?.escreverBytes(bytes);
  }
});

window.orq.aoTerminar(({ id, exitCode }) => {
  porId.get(id)?.marcarFim(exitCode);
  window.OrqLateral?.definirStatus(id, 'encerrada');
});

// A janela inteira mudou de tamanho: todos os painéis precisam refluir, cada
// um com seu proprio debounce.
window.addEventListener('resize', () => {
  for (const p of porId.values()) p.agendarAjuste();
});

window.OrqGrade = {
  criarPainel, focarPainel, painelPorId: porId,
  despertar, restaurarSessao, retomarTodas, dormindos, retratoSessao, salvarSessao,
  ordenarGrade,
  focado: () => focado,
};

// Trocar entre Urgencia e Projeto reordena na hora.
window.OrqCasca?.aoMudar(() => {
  window.OrqLateral?.redesenhar?.();
});

// No evento `load`, e NAO no carregamento deste script: grade.js e avaliado
// antes de lateral.js, entao restaurar aqui direto deixava window.OrqLateral
// indefinido -- os painéis restaurados nao entravam na lista de sessoes e o
// botao "retomar todas" nunca aparecia.
//
// Painéis dormindo nao custam PTY, entao isto nao briga com a meta de abertura.
window.addEventListener('load', () => restaurarSessao());
