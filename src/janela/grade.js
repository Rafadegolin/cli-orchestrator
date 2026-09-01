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
  // Conta PAINEIS, nao filhos: o mapa deixa o <svg> das ligacoes dentro do
  // #grade, e ele sozinho faria o app achar que ainda ha sessao aberta.
  elVazio.hidden = porId.size > 0;
  // A grade mudou, entao a conta de "retomar todas" mudou junto. Sem isto o
  // botao ficava com o numero da restauracao para sempre -- fechei os quatro
  // painéis restaurados, abri quatro novos, e ele seguia dizendo "(4)".
  window.OrqLateral?.atualizarRetomarTodas?.();
}

async function criarPainel({
  cwd, feature, comandoInicial, tipoPainel, dormindo, indisponivel, ligacoes, ligacoesPendentes, x, y, w, h,
}) {
  const id = novoId();

  const painel = new OrqP.Painel({
    id,
    feature: feature || OrqP.nomeCurto(cwd),
    cwd,
    aoFocar: (pid) => { focado = pid; marcarFocado(); },
    aoFechar: () => {
      // Sem isto `focado` continua apontando para um id morto, e o guarda de
      // ordenacao passa a defender um painel que nao existe mais.
      if (focado === id) focado = null;
      atualizarVazio();
      window.OrqLateral?.remover(id);
      // Painel fechado antes de partir nao pode deixar entrada presa na fila.
      window.OrqFila?.remover(id);
      window.OrqFila?.reavaliar();
      salvarSessao();
    },
  });

  painel.comandoInicial = comandoInicial || '';
  // Painel de shell puro, sem Claude dentro. Sem esta marca ele ficaria com a
  // bolinha VERDE para sempre -- `estado.definirStatus(id, 'rodando')` marca
  // todo painel que nasce, e sem hooks nada nunca corrige. Verde significa
  // "Claude trabalhando", e um terminal nao esta trabalhando nada.
  painel.tipoPainel = tipoPainel === 'terminal' ? 'terminal' : 'sessao';
  painel.ligacoes = Array.isArray(ligacoes) ? [...ligacoes] : [];
  // Pendente e a ligacao que o CLI ainda NAO aceitou. Sem restaurar isto, o
  // seletor voltava dizendo "desligar" para uma ligacao que nunca chegou a
  // valer, e o botao de tentar de novo sumia -- o mesmo silencio que a ordem de
  // gravacao em `registrarEm` existe para evitar.
  painel.ligacoesPendentes = Array.isArray(ligacoesPendentes) ? [...ligacoesPendentes] : [];
  // Painel que NASCE ligado (toda implementacao dupla, e toda sessao restaurada
  // com ligacao) precisa desenhar o chip aqui: quem o atualizava era so o
  // `ligacoes.js`, que roda quando VOCE liga. Sem isto o chip dizia "ligar" numa
  // sessao que ja enxerga o outro repositorio, e o unico lugar que nomeia o
  // branch do outro lado ficava vazio. Foi o teste que pegou.
  painel.mostrarLigacoes();
  painel.x = Number.isFinite(x) ? x : null;
  painel.y = Number.isFinite(y) ? y : null;
  // Tamanho no mapa. Separado de x/y porque um sessao.json gravado antes do
  // redimensionar existir tem posicao e nao tem tamanho -- o mapa preenche.
  painel.w = Number.isFinite(w) ? w : null;
  painel.h = Number.isFinite(h) ? h : null;

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
    window.OrqLateral?.registrar({ id, feature: painel.feature, cwd, tipoPainel: painel.tipoPainel });
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
    window.OrqLateral?.registrar({ id, feature: painel.feature, cwd, tipoPainel: painel.tipoPainel });
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
  // FILTRA PRIMEIRO, numera depois. O `#grade` nao tem so painéis dentro: o
  // mapa deixa la o <svg> das ligacoes, e numerar pelo indice de todos os
  // filhos empurrava a ordem de todo mundo em um.
  return [...elGrade.children]
    .map((el) => porId.get(el.dataset.id))
    .filter(Boolean)
    .map((p, ordem) => ({
      feature: p.feature,
      cwd: p.cwd,
      comandoInicial: p.comandoInicial || '',
      // Sem isto o terminal voltaria como sessao dormindo esperando `claude`.
      tipoPainel: p.tipoPainel || 'sessao',
      // Ligacao e entre PASTAS, nao entre ids: id de painel e efemero, pasta
      // sobrevive ao fechar e reabrir.
      ligacoes: p.ligacoes || [],
      ligacoesPendentes: p.ligacoesPendentes || [],
      ordem,
      // Posicao e tamanho no mapa, quando o painel ja passou por la.
      x: Number.isFinite(p.x) ? p.x : null,
      y: Number.isFinite(p.y) ? p.y : null,
      w: Number.isFinite(p.w) ? p.w : null,
      h: Number.isFinite(p.h) ? p.h : null,
    }));
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
      tipoPainel: s.tipoPainel,
      ligacoes: s.ligacoes,
      ligacoesPendentes: s.ligacoesPendentes,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
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

// O painel FOCADO nao sai do lugar.
//
// A ordenacao por urgencia e global: qualquer mudanca de status em QUALQUER
// sessao recalcula a posicao de todas. Na pratica isso movia a janela em que
// voce estava digitando -- por causa de outro painel --, e num `#conteudo`
// rolavel ela podia sair da tela. Foi relatado exatamente assim.
//
// A regra e minima de proposito: o focado fica no indice que ja ocupava e os
// outros se reorganizam em volta. Sem foco, nada muda em relacao a antes.
//
// So faz sentido na grade: no mapa o painel e posicionado e `style.order` nao
// tem efeito nenhum.
function fixarFocado(ordenada) {
  const id = focado;
  if (!id || document.getElementById('app')?.dataset.modo === 'mapa') return ordenada;

  const p = porId.get(id);
  const atual = Number(p?.el.style.order);
  if (!p || !Number.isFinite(atual)) return ordenada;

  const i = ordenada.findIndex((c) => c.id === id);
  if (i < 0 || i === atual) return ordenada;

  const sem = [...ordenada];
  const [alvo] = sem.splice(i, 1);
  sem.splice(Math.min(atual, sem.length), 0, alvo);
  return sem;
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
  const ordenada = fixarFocado(lista || window.OrqLateral?.ordenadas?.() || []);
  ordenada.forEach((c, i) => {
    const p = porId.get(c.id);
    if (p) p.el.style.order = String(i);
  });
  // O molde da densidade personalizada e por POSICAO, entao ele so pode ser
  // aplicado depois que as posicoes existem. Aqui e o unico ponto por onde toda
  // reordenacao passa -- pendurar em outro lugar seria pendurar em varios.
  window.OrqPersonalizado?.aplicar();
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

// Solta o foco. Enquanto ha painel focado ele nao sai do lugar (`fixarFocado`),
// entao existe um caminho para dizer "nenhum" -- e o teste que mede a ordenacao
// PURA por urgencia depende disso.
function desfocar() {
  focado = null;
  marcarFocado();
  window.OrqLateral?.redesenhar?.();
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
  desfocar,
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
