'use strict';

// Quem esta rodando, esperando, pronto. Guarda o status de cada painel e
// manda DIFFS para a janela -- nunca a lista inteira, senao a barra lateral
// re-renderiza varias vezes por segundo a toa.

const path = require('path');

const historico = require('./historico');
const projetos = require('./projetos');

// A ordem importa para a barra lateral: quem espera ha mais tempo primeiro.
//
// `parada` fica entre `terminou` e `rodando`: e uma sessao que acabou e ficou
// la, sem nada pendente. Menos urgente que uma que acabou agora e espera
// revisao, mais visivel que uma trabalhando.
const STATUS = ['esperando', 'terminou', 'parada', 'rodando', 'iniciando', 'encerrada'];

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

// Uma passagem so por onde toda mudanca de status vai parar no historico.
// `para: null` fecha a vida da sessao -- e o que FECHA o ultimo intervalo, sem
// o qual a soma viraria "trabalhou tres dias".
function anotar(s, para) {
  if (!s) return;
  historico.transicao({
    id: s.id,
    feature: s.feature,
    projeto: projetos.donoDe(s.cwdSessao || s.cwd)?.nome || '',
    de: s.status,
    para,
  });
}

function remover(id) {
  anotar(sessoes.get(id), null);
  sessoes.delete(id);
}

// Chamado na saida do app: fecha os intervalos de todas as sessoes vivas.
function encerrarTodas() {
  for (const s of sessoes.values()) anotar(s, null);
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

  // `cwdSessao` ANTES do cwd de spawn.
  //
  // O app grava o cwd real da sessao assim que ele aparece num evento -- depois
  // de `claude -w`, a pasta do worktree. Ele estava sendo gravado e nunca
  // consultado: um evento sem ORQ_ID vindo daquele mesmo worktree caia na regra
  // do descendente (ou em nada), mesmo o app ja sabendo de quem era. E quando
  // dois painéis vivem na MESMA pasta de projeto, o cwd de spawn nao distingue
  // os dois e o primeiro do Map levava tudo -- o painel 2 esperando acendia o 1.
  for (const s of sessoes.values()) {
    if (s.cwdSessao && s.cwdSessao === alvo) return s.id;
  }

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

// O `notification_type` do Claude Code, ja separado pelo matcher do
// settings.json e entregue na rota do hook.
//
// A lista completa esta no binario do CLI 2.1.220
// (`fieldToMatch:"notification_type"`) e tem OITO valores; o app registrava
// matcher para dois. Os que faltavam e significam espera de verdade entram
// aqui -- `elicitation_dialog` e literalmente "Claude Code needs your input",
// e sem matcher ele nao gerava evento nenhum: a sessao ficava esperando com o
// painel verde, para sempre.
//
// E `ocioso` (idle_prompt) DEIXOU de ser amarelo. Medido no binario: ele
// dispara 60s depois da ultima mensagem com a sessao parada no prompt, ou seja
// "acabou e ninguem esta bloqueado". Enquanto ele virava `esperando`, uma
// sessao que tinha terminado ficava amarela sozinha um minuto depois, sem ter
// pergunta nenhuma -- foi relatado, e e o oposto do que o amarelo promete.
const TIPOS_NOTIFICACAO = {
  permissao: { status: 'esperando', motivo: 'pedindo permissao' },
  elicitacao: { status: 'esperando', motivo: 'pedindo uma resposta' },
  agente: { status: 'esperando', motivo: 'agente em segundo plano travado' },
  ocioso: { status: 'parada', motivo: 'sem nada pendente' },
  concluido: { status: 'terminou', motivo: 'pronto para revisar' },
};

// Evento do Claude -> status. O tipo vem da rota do hook (o matcher do
// settings.json ja separou os tipos), e o corpo serve so de reforco.
function statusDe(evento, tipo) {
  switch (evento) {
    case 'Notification':
      // Tipo desconhecido cai em `esperando`: se o Claude notificou e a gente
      // nao sabe por que, mostrar e melhor que engolir. Isso so alcanca um
      // settings.json editado a mao -- matcher que o app nao registrou nao
      // dispara hook nenhum.
      return TIPOS_NOTIFICACAO[tipo] || TIPOS_NOTIFICACAO.permissao;
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

  if (mudouStatus) anotar(s, alvo.status);

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

// Status vindo de dentro do app (shell aberto, e o farejador do Canal 1), e
// nao de um hook.
//
// Ela CARREGA pergunta e tipo, e isso nao e enfeite: sem eles, um diff emitido
// aqui chegava na janela sem os campos, `lateral.definirStatus` recebia
// `extra = {}` e zerava a pergunta do card -- a faixa de aprovacao perdia o
// texto por causa de uma atualizacao que nao tinha nada a ver com ela.
//
// A mesma regra de `aplicar()` vale: pergunta so existe enquanto se espera.
function definirStatus(id, status, motivo = '', { pergunta = '', tipo = '' } = {}) {
  const s = sessoes.get(id);
  if (!s) return;

  const perguntaAlvo = status === 'esperando' ? pergunta : '';
  const tipoAlvo = status === 'esperando' ? tipo : '';

  const mudouStatus = s.status !== status;
  if (!mudouStatus && s.motivo === motivo
    && s.pergunta === perguntaAlvo && s.tipo === tipoAlvo) return;

  if (mudouStatus) anotar(s, status);
  s.status = status;
  s.motivo = motivo;
  s.pergunta = perguntaAlvo;
  s.tipo = tipoAlvo;
  // O cronometro so reinicia quando o status muda de verdade -- reacender o
  // mesmo `esperando` a cada giro do farejador nao pode zerar "esperando ha
  // 4min".
  if (mudouStatus) s.desde = Date.now();

  emitir('estado:diff', {
    id, status: s.status, motivo: s.motivo, desde: s.desde, pergunta: s.pergunta, tipo: s.tipo,
  });
}

function todas() {
  return [...sessoes.values()].map((s) => ({ ...s }));
}

module.exports = {
  STATUS,
  definirJanela,
  registrar,
  remover,
  encerrarTodas,
  resolver,
  statusDe,
  aplicar,
  definirStatus,
  todas,
};
