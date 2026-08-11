'use strict';

// Quem esta rodando, esperando, pronto. Guarda o status de cada painel e
// manda DIFFS para a janela -- nunca a lista inteira, senao a barra lateral
// re-renderiza varias vezes por segundo a toa.

const path = require('path');

// A ordem importa para a barra lateral: quem espera ha mais tempo primeiro.
const STATUS = ['esperando', 'terminou', 'rodando', 'iniciando', 'encerrada'];

const sessoes = new Map();
let janela = null;

function definirJanela(j) {
  janela = j;
}

function emitir(evento, dados) {
  if (janela && !janela.isDestroyed() && !janela.webContents.isDestroyed()) {
    janela.webContents.send(evento, dados);
  }
}

function registrar(id, { feature, cwd }) {
  sessoes.set(id, {
    id,
    feature,
    cwd: normalizar(cwd),
    status: 'iniciando',
    motivo: '',
    // O que o Claude esta perguntando, e de que tipo de espera se trata.
    // `permissao` tem o que aprovar; `ocioso` so esta esperando voce digitar.
    pergunta: '',
    tipo: '',
    desde: Date.now(),
  });
}

function remover(id) {
  sessoes.delete(id);
}

function normalizar(p) {
  if (!p) return '';
  return path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
}

// A chave de ligacao entre evento e painel.
//
// A spec manda usar o cwd, e isso vale quando o app cria o worktree. Aqui ele
// nao cria: o painel nasce em C:\projeto e `claude -w feature` move a sessao
// para a pasta do worktree, entao o cwd do hook NAO e o cwd de spawn. Por isso
// o ORQ_ID (herdado pelo processo filho via env) vem primeiro, e o cwd fica
// como as duas regras de fallback.
function resolver({ orqId, cwd }) {
  if (orqId && sessoes.has(orqId)) return orqId;

  const alvo = normalizar(cwd);
  if (!alvo) return null;

  for (const s of sessoes.values()) {
    if (s.cwd === alvo) return s.id;
  }

  // Worktree criado dentro (ou ao lado) da pasta do projeto: escolhe o painel
  // cujo cwd e o ancestral mais especifico do cwd do evento.
  let melhor = null;
  let maior = -1;
  for (const s of sessoes.values()) {
    if (s.cwd && alvo.startsWith(s.cwd + path.sep) && s.cwd.length > maior) {
      maior = s.cwd.length;
      melhor = s.id;
    }
  }
  return melhor;
}

// Evento do Claude -> status. O tipo vem da query string do hook (o matcher do
// settings.json ja separou permission_prompt de idle_prompt), e o corpo serve
// so de reforco.
function statusDe(evento, tipo) {
  switch (evento) {
    case 'Notification':
      return tipo === 'ocioso'
        ? { status: 'esperando', motivo: 'parado ha 60s' }
        : { status: 'esperando', motivo: 'pedindo permissao' };
    case 'UserPromptSubmit':
    case 'PostToolUse':
    case 'SessionStart':
      return { status: 'rodando', motivo: '' };
    case 'Stop':
      return { status: 'terminou', motivo: 'pronto para revisar' };
    case 'SessionEnd':
      return { status: 'encerrada', motivo: '' };
    default:
      return null;
  }
}

function aplicar({ evento, tipo, cwd, orqId, sessionId, mensagem = '' }) {
  const id = resolver({ orqId, cwd });
  if (!id) return { id: null, mudou: false };

  const alvo = statusDe(evento, tipo);
  if (!alvo) return { id, mudou: false };

  const s = sessoes.get(id);
  s.sessionId = sessionId || s.sessionId;

  // Guarda o cwd real da sessao assim que ele aparece: depois de `claude -w`
  // o painel passa a viver no worktree.
  if (cwd) s.cwdSessao = normalizar(cwd);

  // A pergunta so faz sentido enquanto a sessao espera; sair de 'esperando'
  // limpa, senao a faixa de aprovacao mostraria pergunta de dez minutos atras.
  const pergunta = alvo.status === 'esperando' ? mensagem : '';
  const tipoEspera = alvo.status === 'esperando' ? tipo : '';

  const mudouStatus = s.status !== alvo.status;
  const mudouMotivo = s.motivo !== alvo.motivo;
  // Duas perguntas seguidas do mesmo tipo nao mudam status nem motivo, e a
  // faixa ficaria com a pergunta anterior se a comparacao parasse nos dois.
  const mudouPergunta = s.pergunta !== pergunta || s.tipo !== tipoEspera;
  if (!mudouStatus && !mudouMotivo && !mudouPergunta) return { id, mudou: false };

  s.status = alvo.status;
  s.motivo = alvo.motivo;
  s.pergunta = pergunta;
  s.tipo = tipoEspera;
  // O cronometro do card amarelo so reinicia quando o status muda de verdade.
  if (mudouStatus) s.desde = Date.now();

  emitir('estado:diff', {
    id, status: s.status, motivo: s.motivo, desde: s.desde, pergunta: s.pergunta, tipo: s.tipo,
  });
  return { id, mudou: true, status: s.status };
}

function definirStatus(id, status, motivo = '') {
  const s = sessoes.get(id);
  if (!s || (s.status === status && s.motivo === motivo)) return;
  s.status = status;
  s.motivo = motivo;
  s.desde = Date.now();
  emitir('estado:diff', { id, status, motivo, desde: s.desde });
}

function todas() {
  return [...sessoes.values()].map((s) => ({ ...s }));
}

module.exports = {
  STATUS,
  definirJanela,
  registrar,
  remover,
  resolver,
  statusDe,
  aplicar,
  definirStatus,
  todas,
};
