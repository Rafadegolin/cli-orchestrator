'use strict';

// A barra de status. Responde "onde eu preciso olhar agora?" em menos de um
// segundo, sem procurar.

const elLista = document.getElementById('lateral-lista');
const elContagem = document.getElementById('lateral-contagem');
const elFilaBloco = document.getElementById('bloco-fila');
const elFilaLista = document.getElementById('fila-lista');
const elFilaContagem = document.getElementById('fila-contagem');
const btnFilaDica = document.getElementById('fila-dica');
const btnHooks = document.getElementById('btn-hooks');
const elHooksRotulo = document.getElementById('hooks-rotulo');
const btnAtualizar = document.getElementById('btn-atualizar');
const btnRetomarTodas = document.getElementById('btn-retomar-todas');
const elVersao = document.getElementById('lateral-versao');

// Ordem de urgencia, nao de projeto: quem espera ha mais tempo primeiro, depois
// quem terminou e precisa de revisao, depois quem esta rodando, por ultimo
// quem parou.
const PESO = { esperando: 0, terminou: 1, rodando: 2, iniciando: 3, encerrada: 4 };

// Painel dormindo vai para o fim, e por isso o peso NAO pode sair so do status:
// ele carrega 'iniciando' (peso 3) e cairia no meio da lista, na frente de
// sessoes vivas. Nao ha processo nenhum ali para exigir sua atencao.
const PESO_DORMINDO = 5;

// O rotulo diz o ESTADO. O motivo que veio do hook ("pedindo permissao",
// "parado ha 60s") vai para o title -- juntar os dois produzia coisas como
// "parado ha 60s ha 4min", com o "ha" duas vezes na mesma linha.
const ROTULO = {
  esperando: 'esperando',
  terminou: 'pronto para revisar',
  rodando: 'trabalhando',
  iniciando: 'iniciando',
  encerrada: 'encerrada',
};

const ROTULO_DORMINDO = 'sessão salva';

const cards = new Map();
let jaAvisado = new Set();

function registrar({ id, feature, cwd }) {
  cards.set(id, { id, feature, cwd, status: 'iniciando', motivo: '', desde: Date.now() });
  redesenhar();
}

function remover(id) {
  cards.delete(id);
  jaAvisado.delete(id);
  redesenhar();
}

function definirStatus(id, status, motivo = '', desde = Date.now(), extra = {}) {
  const c = cards.get(id);
  if (!c) return;
  c.status = status;
  c.motivo = motivo;
  c.desde = desde;
  // A pergunta do Claude e o tipo de espera: `permissao` tem o que aprovar,
  // `ocioso` esta so esperando voce digitar.
  c.pergunta = extra.pergunta || '';
  c.tipo = extra.tipo || '';

  window.OrqPainel.painelPorId.get(id)?.definirStatus(status, rotuloDe(c), motivo);
  window.OrqAprovacao?.atualizar(id, c);

  if (status === 'esperando') avisar(c);
  else jaAvisado.delete(id);

  // Sessao que saiu de 'rodando' pode ter aberto vaga para quem esta na fila.
  window.OrqFila?.reavaliar();

  redesenhar();
}

async function avisar(c) {
  if (jaAvisado.has(c.id)) return;
  jaAvisado.add(c.id);
  // So incomoda se o app nao estiver na frente.
  if (await window.orq.estaFocado()) return;
  window.orq.notificar(`${c.feature} está esperando`, c.motivo || 'pedindo permissão');
}

function estaDormindo(id) {
  return Boolean(window.OrqPainel.painelPorId.get(id)?.dormindo);
}

function pesoDe(c) {
  return estaDormindo(c.id) ? PESO_DORMINDO : (PESO[c.status] ?? 9);
}

// A UNICA fonte do rotulo. A lateral, a fila e o cabecalho do painel consomem
// esta funcao -- antes cada um montava o seu, e os tres ja tinham divergido.
function rotuloDe(c) {
  if (estaDormindo(c.id)) return ROTULO_DORMINDO;
  if (c.status === 'esperando') return `esperando ${textoEspera(Date.now() - c.desde)}`;
  return ROTULO[c.status] || c.status;
}

// NAO se chama `projetoDe`: projetos.js ja declara uma funcao com esse nome no
// mesmo escopo global compartilhado, e a ultima avaliada vence em silencio.
// Foi assim que a ordenacao por projeto quebrou -- este arquivo acabava
// chamando a de projetos.js, que espera um caminho e nao um card.
function nomeProjetoDe(c) {
  return window.OrqProjetos?.projetoDe?.(c.cwd)?.nome || '';
}

// Ordem da GRADE e da lista de sessoes: as duas seguem a mesma escolha, porque
// procurar uma sessao em duas ordenacoes diferentes ao mesmo tempo e pior que
// nao ordenar.
function ordenadas() {
  const porProjeto = window.OrqCasca?.ordem() === 'projeto';
  return [...cards.values()].sort((a, b) => {
    if (porProjeto) {
      return nomeProjetoDe(a).localeCompare(nomeProjetoDe(b))
        || a.feature.localeCompare(b.feature);
    }
    const d = pesoDe(a) - pesoDe(b);
    if (d !== 0) return d;
    // Dentro do mesmo peso, quem esta parado ha mais tempo vem primeiro.
    return a.desde - b.desde;
  });
}

// A fila de atencao NAO segue a ordenacao escolhida: ela e a fila, e fila e
// sempre por quem espera ha mais tempo. Ordenar por projeto aqui faria o
// Ctrl+Enter pular para a sessao errada.
function filaAtencao() {
  return [...cards.values()]
    .filter((c) => c.status === 'esperando' && !estaDormindo(c.id))
    .sort((a, b) => a.desde - b.desde);
}

function textoEspera(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  return `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

function redesenhar() {
  const lista = ordenadas();
  elContagem.textContent = String(lista.length);

  // Viva = tem processo. Painel restaurado dormindo aparece na lista, mas nao
  // conta no placar: ninguem esta gastando CPU por ele.
  const vivas = lista.filter((c) => {
    const p = window.OrqPainel.painelPorId.get(c.id);
    return c.status !== 'encerrada' && !(p && p.dormindo);
  }).length;
  window.OrqCasca?.definirVivas(vivas);

  elLista.replaceChildren(...lista.map((c) => {
    const painel = window.OrqPainel.painelPorId.get(c.id);

    const li = document.createElement('li');
    li.className = 'card'
      + (c.status === 'esperando' ? ' card-atencao' : '')
      // Redesenhar recria os cards, entao o foco tem de ser reaplicado aqui --
      // senao ele some sozinho na primeira mudanca de status de qualquer sessao.
      + (window.OrqGrade?.focado?.() === c.id ? ' card-focado' : '');
    li.dataset.id = c.id;

    const bolinha = document.createElement('span');
    bolinha.className = painel?.dormindo ? 'bolinha bolinha-dormindo' : `bolinha bolinha-${c.status}`;

    const nome = document.createElement('span');
    nome.className = 'card-nome';
    nome.textContent = c.feature;

    const sub = document.createElement('span');
    sub.className = 'card-sub';
    sub.dataset.status = c.status;
    sub.textContent = rotuloDe(c);

    const texto = document.createElement('span');
    texto.className = 'card-texto';
    texto.append(nome, sub);

    const porta = document.createElement('span');
    porta.className = 'card-porta';
    porta.textContent = painel?.portas?.length ? `:${painel.portas[0]}` : '';

    li.title = [c.cwd, c.motivo].filter(Boolean).join('\n');
    li.append(bolinha, texto, porta);
    li.addEventListener('click', () => window.OrqGrade.focarPainel(c.id));
    return li;
  }));

  redesenharFila();
  // A grade acompanha a mesma ordem, sem mover nenhum no do DOM.
  window.OrqGrade?.ordenarGrade?.(lista);
}

// O bloco ESPERANDO VOCE. So existe quando ha fila: um cabecalho vazio ocupando
// espaco na lateral e ruido permanente para avisar de algo que nao esta
// acontecendo.
function redesenharFila() {
  const espera = filaAtencao();
  elFilaBloco.hidden = espera.length === 0;
  if (!espera.length) {
    elFilaLista.replaceChildren();
    return;
  }

  elFilaContagem.textContent = String(espera.length);
  elFilaLista.replaceChildren(...espera.map((c) => {
    const li = document.createElement('li');
    li.dataset.id = c.id;
    li.title = c.motivo || 'esperando você';

    const bolinha = document.createElement('span');
    bolinha.className = 'bolinha bolinha-esperando';

    const nome = document.createElement('span');
    nome.className = 'fila-nome';
    nome.textContent = c.feature;

    const tempo = document.createElement('span');
    tempo.className = 'fila-espera';
    tempo.textContent = textoEspera(Date.now() - c.desde);

    li.append(bolinha, nome, tempo);
    li.addEventListener('click', () => window.OrqGrade.focarPainel(c.id));
    return li;
  }));
}

// UM unico intervalo para todos os cronometros. Um setInterval por card
// acordaria a CPU N vezes por segundo a toa e derrubaria a meta de consumo
// parado.
//
// Sai na primeira linha quando ninguem espera -- que e o estado normal da tela.
// Antes ele varria o DOM a cada segundo mesmo sem nada para atualizar.
setInterval(() => {
  const espera = filaAtencao();
  if (!espera.length) return;

  for (const c of espera) {
    const rotulo = rotuloDe(c);
    const decorrido = textoEspera(Date.now() - c.desde);

    const sub = elLista.querySelector(`.card[data-id="${CSS.escape(c.id)}"] .card-sub`);
    if (sub) sub.textContent = rotulo;

    const naFila = elFilaLista.querySelector(`li[data-id="${CSS.escape(c.id)}"] .fila-espera`);
    if (naFila) naFila.textContent = decorrido;

    window.OrqPainel.painelPorId.get(c.id)?.atualizarRotulo(rotulo);
  }
}, 1000);

// O toque que faz o app valer a pena: pular direto para quem espera ha mais
// tempo, em vez de cacar painel.
function pularParaMaisAntigo() {
  // Da fila, e nao de ordenadas(): com a grade ordenada por projeto, o primeiro
  // da lista nao e quem espera ha mais tempo.
  const alvo = filaAtencao()[0] || ordenadas().find((c) => c.status === 'terminou');
  if (!alvo) return null;
  window.orq.focarJanela();
  window.OrqGrade.focarPainel(alvo.id);
  return alvo.id;
}

btnFilaDica?.addEventListener('click', pularParaMaisAntigo);

window.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey && ev.key === 'Enter') {
    ev.preventDefault();
    pularParaMaisAntigo();
  }
});

// Diffs vindos do processo principal: { id, status, motivo, desde, pergunta, tipo }.
window.orq.aoMudarEstado(({ id, status, motivo, desde, pergunta, tipo }) =>
  definirStatus(id, status, motivo, desde, { pergunta, tipo }));

btnHooks?.addEventListener('click', async () => {
  const s = await window.orq.hooksSituacao();
  if (s.instalado) await window.orq.hooksDesinstalar();
  else await window.orq.hooksInstalar();
  atualizarBotaoHooks();
});

async function atualizarBotaoHooks() {
  if (!btnHooks) return;
  const s = await window.orq.hooksSituacao();
  // Escreve so no rotulo: mexer no textContent do botao apagaria o switch, que
  // e markup irmao. O estado visual do switch sai da classe.
  if (elHooksRotulo) elHooksRotulo.textContent = s.instalado ? 'ligados' : 'desligados';
  btnHooks.classList.toggle('hooks-ok', Boolean(s.instalado));
  btnHooks.title = s.instalado
    ? `Hooks registrados em ${s.arquivo} (clique para remover)`
    : `Registrar hooks em ${s.arquivo} para as bolinhas mudarem sozinhas`;
}

atualizarBotaoHooks();

// Primeiro desenho com a lista vazia: sem isto a contagem de SESSOES nasce em
// branco em vez de zero, e o placar de sessoes vivas so aparece quando o
// primeiro painel abre.
redesenhar();

// -------------------------------------------------------- sessao anterior

// So aparece quando ha o que retomar. A fila da Fase 6 espaca as partidas, e e
// isso que torna "todas de uma vez" aceitavel.
function atualizarRetomarTodas() {
  if (!btnRetomarTodas) return;
  const n = window.OrqGrade?.dormindos?.().length || 0;
  btnRetomarTodas.hidden = n === 0;
  btnRetomarTodas.textContent = `Retomar todas (${n})`;
  btnRetomarTodas.title = 'Religa as sessões da última vez que você fechou o app. '
    + 'As partidas são espaçadas pela fila.';
}

btnRetomarTodas?.addEventListener('click', async () => {
  btnRetomarTodas.disabled = true;
  try {
    await window.OrqGrade.retomarTodas();
  } finally {
    btnRetomarTodas.disabled = false;
    atualizarRetomarTodas();
  }
});

// ------------------------------------------------------------ atualizacao

// O botao so existe quando ha o que aplicar. Atualizacao nunca deve interromper
// o trabalho: ela espera voce olhar para a lateral.
function mostrarAtualizacao(s) {
  if (!btnAtualizar) return;

  // Com a lateral recolhida este botao e invisivel, e ele e o UNICO aviso de
  // versao nova que o app da -- atualizacao nunca vira dialogo aqui. A marca no
  // botao de recolher e o que impede "some a lateral, some o aviso, para
  // sempre". Fica no #app porque quem a desenha e a barra de titulo.
  document.getElementById('app').dataset.atualizacao = s.disponivel ? 'sim' : 'nao';

  // No portatil nao ha instalador, mas quase sempre da para trocar so o
  // app.asar -- e ai o botao e o mesmo do instalado. So quando NAO da (mudou o
  // Electron, ou a pasta nao e gravavel) ele volta a mandar para o site, e
  // dizendo por que.
  if (s.portatil && s.disponivel && !s.leve) {
    btnAtualizar.hidden = false;
    btnAtualizar.disabled = false;
    btnAtualizar.textContent = `Baixar a versão ${s.disponivel}`;
    btnAtualizar.title = `Desta vez não dá para atualizar de dentro do app: ${s.motivoPesado || 'a release não traz o pacote leve'}. `
      + 'Abre a página da release para você baixar o zip novo.';
    btnAtualizar.className = 'atualizar-pronta';
    return;
  }

  if (s.baixada) {
    btnAtualizar.hidden = false;
    btnAtualizar.disabled = false;
    btnAtualizar.textContent = `Atualizar para ${s.disponivel} e reiniciar`;
    btnAtualizar.title = s.leve
      ? 'Já está baixada. Fecha os painéis, troca o app e reabre sozinho.'
      : 'Fecha os painéis abertos e reinicia o app na versão nova';
    btnAtualizar.className = 'atualizar-pronta';
  } else if (s.disponivel) {
    btnAtualizar.hidden = false;
    btnAtualizar.disabled = true;
    // O caminho leve baixa um arquivo so e nao reporta progresso: mostrar
    // "0%" ali seria inventar um numero que nunca vai andar.
    btnAtualizar.textContent = s.leve
      ? `Baixando ${s.disponivel}...`
      : `Baixando ${s.disponivel}... ${s.percentual || 0}%`;
    btnAtualizar.title = 'A atualização está sendo baixada em segundo plano';
    btnAtualizar.className = '';
  } else {
    btnAtualizar.hidden = true;
  }
}

btnAtualizar?.addEventListener('click', async () => {
  btnAtualizar.disabled = true;
  const r = await window.orq.atualizacaoAplicar();
  // Se o usuario desistiu no dialogo, o botao volta a valer.
  if (!r?.aplicado) btnAtualizar.disabled = false;
});

window.orq.aoMudarAtualizacao(mostrarAtualizacao);

(async () => {
  const v = await window.orq.versao();
  if (elVersao) elVersao.textContent = `v${v}`;
  mostrarAtualizacao(await window.orq.atualizacaoSituacao());
})();

window.OrqLateral = {
  registrar, remover, definirStatus, pularParaMaisAntigo, cards, ordenadas, mostrarAtualizacao,
  atualizarRetomarTodas, filaAtencao, rotuloDe, pesoDe, textoEspera, redesenhar,
};
