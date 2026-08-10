'use strict';

// A barra de status. Responde "onde eu preciso olhar agora?" em menos de um
// segundo, sem procurar.

const elLista = document.getElementById('lateral-lista');
const elContagem = document.getElementById('lateral-contagem');
const btnHooks = document.getElementById('btn-hooks');
const btnAtualizar = document.getElementById('btn-atualizar');
const elVersao = document.getElementById('lateral-versao');

// Ordem de urgencia, nao de projeto: quem espera ha mais tempo primeiro, depois
// quem terminou e precisa de revisao, depois quem esta rodando, por ultimo
// quem parou.
const PESO = { esperando: 0, terminou: 1, rodando: 2, iniciando: 3, encerrada: 4 };

const ROTULO = {
  esperando: 'esperando voce',
  terminou: 'pronto para revisar',
  rodando: 'rodando',
  iniciando: 'iniciando',
  encerrada: 'encerrada',
};

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

function definirStatus(id, status, motivo = '', desde = Date.now()) {
  const c = cards.get(id);
  if (!c) return;
  c.status = status;
  c.motivo = motivo;
  c.desde = desde;

  window.OrqPainel.painelPorId.get(id)?.definirStatus(status, motivo || ROTULO[status]);

  if (status === 'esperando') avisar(c);
  else jaAvisado.delete(id);

  redesenhar();
}

async function avisar(c) {
  if (jaAvisado.has(c.id)) return;
  jaAvisado.add(c.id);
  // So incomoda se o app nao estiver na frente.
  if (await window.orq.estaFocado()) return;
  window.orq.notificar(`${c.feature} esta esperando`, c.motivo || 'pedindo permissao');
}

function ordenadas() {
  return [...cards.values()].sort((a, b) => {
    const d = PESO[a.status] - PESO[b.status];
    if (d !== 0) return d;
    // Dentro do mesmo status, quem esta parado ha mais tempo vem primeiro.
    return a.desde - b.desde;
  });
}

function textoEspera(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `ha ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `ha ${m}min`;
  return `ha ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

function redesenhar() {
  const lista = ordenadas();
  elContagem.textContent = String(lista.length);

  elLista.replaceChildren(...lista.map((c) => {
    const li = document.createElement('li');
    li.className = 'card' + (c.status === 'esperando' ? ' card-atencao' : '');
    li.dataset.id = c.id;

    const bolinha = document.createElement('span');
    bolinha.className = `bolinha bolinha-${c.status}`;

    const nome = document.createElement('span');
    nome.className = 'card-nome';
    nome.textContent = c.feature;

    const sub = document.createElement('span');
    sub.className = 'card-sub';
    sub.dataset.desde = String(c.desde);
    sub.dataset.status = c.status;
    sub.textContent = legenda(c);

    li.append(bolinha, nome, sub);
    li.addEventListener('click', () => window.OrqGrade.focarPainel(c.id));
    return li;
  }));
}

function legenda(c) {
  const base = c.motivo || ROTULO[c.status] || c.status;
  return c.status === 'esperando' ? `${base} ${textoEspera(Date.now() - c.desde)}` : base;
}

// UM unico intervalo atualiza todos os cronometros. Um setInterval por card
// acordaria a CPU N vezes por segundo a toa e derrubaria a meta de consumo
// parado.
setInterval(() => {
  for (const sub of elLista.querySelectorAll('.card-sub[data-status="esperando"]')) {
    const c = cards.get(sub.closest('.card').dataset.id);
    if (c) sub.textContent = legenda(c);
  }
}, 1000);

// O toque que faz o app valer a pena: pular direto para quem espera ha mais
// tempo, em vez de cacar painel.
function pularParaMaisAntigo() {
  const esperando = ordenadas().filter((c) => c.status === 'esperando');
  const alvo = esperando[0] || ordenadas().find((c) => c.status === 'terminou');
  if (!alvo) return null;
  window.orq.focarJanela();
  window.OrqGrade.focarPainel(alvo.id);
  return alvo.id;
}

window.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey && ev.key === 'Enter') {
    ev.preventDefault();
    pularParaMaisAntigo();
  }
});

// Diffs vindos do processo principal: { id, status, motivo, desde }.
window.orq.aoMudarEstado(({ id, status, motivo, desde }) => definirStatus(id, status, motivo, desde));

btnHooks?.addEventListener('click', async () => {
  const s = await window.orq.hooksSituacao();
  if (s.instalado) await window.orq.hooksDesinstalar();
  else await window.orq.hooksInstalar();
  atualizarBotaoHooks();
});

async function atualizarBotaoHooks() {
  if (!btnHooks) return;
  const s = await window.orq.hooksSituacao();
  btnHooks.textContent = s.instalado ? 'Hooks: ligados' : 'Hooks: instalar';
  btnHooks.className = s.instalado ? 'hooks-ok' : '';
  btnHooks.title = s.instalado
    ? `Hooks registrados em ${s.arquivo} (clique para remover)`
    : `Registrar hooks em ${s.arquivo} para as bolinhas mudarem sozinhas`;
}

atualizarBotaoHooks();

// ------------------------------------------------------------ atualizacao

// O botao so existe quando ha o que aplicar. Atualizacao nunca deve interromper
// o trabalho: ela espera voce olhar para a lateral.
function mostrarAtualizacao(s) {
  if (!btnAtualizar) return;

  if (s.baixada) {
    btnAtualizar.hidden = false;
    btnAtualizar.disabled = false;
    btnAtualizar.textContent = `Atualizar para ${s.disponivel} e reiniciar`;
    btnAtualizar.title = 'Fecha os painéis abertos e reinicia o app na versao nova';
    btnAtualizar.className = 'atualizar-pronta';
  } else if (s.disponivel) {
    btnAtualizar.hidden = false;
    btnAtualizar.disabled = true;
    btnAtualizar.textContent = `Baixando ${s.disponivel}... ${s.percentual || 0}%`;
    btnAtualizar.title = 'A atualizacao esta sendo baixada em segundo plano';
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
};
