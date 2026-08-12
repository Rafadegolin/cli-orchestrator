'use strict';

// Escreve os hooks no settings.json do Claude.
//
// Este arquivo e do usuario, nao nosso: nunca sobrescreve, sempre faz merge,
// sempre grava backup antes, e o app so chama isto depois de perguntar.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { PORTA, ENDERECO } = require('./eventos');

const ARQ_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

// Marca que identifica os hooks que SAO nossos, para desinstalar sem tocar nos
// hooks que o usuario tenha configurado por conta propria.
const MARCA = `${ENDERECO}:${PORTA}/evento`;

// curl.exe vem no Windows desde o 10. Arranque de ~10ms contra os ~80ms do
// interpretador Node que a spec rejeita, e sem .exe proprio para empacotar.
//
// - `--data-binary @-` repassa o JSON que o Claude manda no stdin
// - `--connect-timeout 0.2` e o que faz o app FECHADO custar ~200ms em vez de
//   2s: o Windows nao devolve RST na hora numa porta fechada do loopback, o
//   curl fica retransmitindo SYN e so desiste no -m. Ligar no app aberto leva
//   menos de 1ms, entao 200ms e folgadissimo.
// - `-m 2` continua como rede de seguranca se algo travar depois de conectar
// - `|| exit 0` faz o hook falhar em silencio quando o app esta fechado
//   (curl sai com 7 em conexao recusada)
// - `$ORQ_ID` e a variavel injetada na criacao do PTY; processos filhos herdam
//   o env, entao o claude e o proprio hook a recebem. Sintaxe POSIX e nao
//   `%ORQ_ID%`: medido contra o CLI 2.1.220 no Windows, o Claude Code executa
//   hooks num shell POSIX -- `$ORQ_ID` expande, `%ORQ_ID%` chega literal.
// Evento e tipo vao no PATH da URL. Query string exigiria `&`, que o cmd.exe
// trata como separador de comando quando as aspas nao sobrevivem -- o curl
// recebia duas URLs quebradas e o evento se perdia em silencio.
function comando(evento, tipo = '') {
  const rota = tipo ? `${evento}/${tipo}` : evento;
  return `curl -s --connect-timeout 0.2 -m 2 -H "X-Orq-Id: $ORQ_ID" --data-binary @- http://${MARCA}/${rota} || exit 0`;
}

function entrada(evento, tipo = '', matcher = null) {
  const e = { hooks: [{ type: 'command', command: comando(evento, tipo), timeout: 3 }] };
  if (matcher) e.matcher = matcher;
  return e;
}

// Um matcher por tipo de notificacao: assim o proprio Claude separa os tipos e
// o app nao precisa adivinhar pelo corpo.
//
// A LISTA COMPLETA de `notification_type` esta no binario do CLI 2.1.220
// (`matcherMetadata:{fieldToMatch:"notification_type",values:[...]}`) e tem
// OITO valores:
//
//   permission_prompt · idle_prompt · auth_success · elicitation_dialog
//   elicitation_complete · elicitation_response · agent_needs_input · agent_completed
//
// O app registrava DOIS. E `elicitation_dialog` e literalmente
// "Claude Code needs your input" -- sem matcher para ele, uma sessao travada
// nessa pergunta nao gerava evento nenhum e o painel ficava verde para sempre.
// Foi relatado como "estava esperando e nao apareceu o amarelo".
//
// Os que ficam de fora de proposito: `auth_success`, `elicitation_complete` e
// `elicitation_response` nao sao espera -- sao o fim dela, e o evento seguinte
// (PostToolUse/Stop) ja conta essa historia.
function nossosHooks() {
  return {
    Notification: [
      entrada('Notification', 'permissao', 'permission_prompt'),
      entrada('Notification', 'ocioso', 'idle_prompt'),
      entrada('Notification', 'elicitacao', 'elicitation_dialog'),
      entrada('Notification', 'agente', 'agent_needs_input'),
      entrada('Notification', 'concluido', 'agent_completed'),
    ],
    UserPromptSubmit: [entrada('UserPromptSubmit')],
    PostToolUse: [entrada('PostToolUse')],
    Stop: [entrada('Stop')],
    SessionStart: [entrada('SessionStart')],
    SessionEnd: [entrada('SessionEnd')],
  };
}

// Todas as rotas que o conjunto atual instala -- e por elas que `situacao()`
// sabe dizer "desatualizados" em vez de um "ligados" que mente.
function rotasEsperadas() {
  const rotas = [];
  for (const lista of Object.values(nossosHooks())) {
    for (const e of lista) {
      for (const h of e.hooks) rotas.push(String(h.command));
    }
  }
  return rotas;
}

function lerSettings() {
  try {
    return JSON.parse(fs.readFileSync(ARQ_SETTINGS, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`settings.json do Claude ilegivel: ${err.message}`);
  }
}

function ehNosso(entradaHook) {
  return (entradaHook.hooks || []).some((h) => String(h.command || '').includes(MARCA));
}

// Instalado = TODAS as rotas do conjunto atual estao la.
//
// Antes bastava UMA sobreviver em QUALQUER evento. O modo de falha que isso
// escondia e exatamente o que foi relatado: sumindo so as entradas de
// `Notification`, o verde e o azul continuam mudando sozinhos, o amarelo morre,
// e a lateral segue dizendo "ligados" -- a interface afirmando ativamente que
// esta tudo bem enquanto o unico sinal que importa nao chega mais.
//
// `parcial` cobre tambem quem instalou por uma versao anterior do app: o
// conjunto cresceu, e sem isso ninguem seria avisado de que falta reinstalar.
function situacao() {
  const s = lerSettings();
  const h = s.hooks || {};
  const instalados = new Set();
  for (const lista of Object.values(h)) {
    for (const e of lista || []) {
      for (const c of e.hooks || []) instalados.add(String(c.command || ''));
    }
  }

  const esperadas = rotasEsperadas();
  const faltando = esperadas.filter((c) => !instalados.has(c));
  const algum = [...instalados].some((c) => c.includes(MARCA));

  return {
    instalado: algum && faltando.length === 0,
    parcial: algum && faltando.length > 0,
    faltando: faltando.length,
  };
}

function estaInstalado() {
  return situacao().instalado;
}

function backup() {
  if (!fs.existsSync(ARQ_SETTINGS)) return null;
  const alvo = `${ARQ_SETTINGS}.orq-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(ARQ_SETTINGS, alvo);
  return alvo;
}

function instalar() {
  const s = lerSettings();
  const copia = backup();

  s.hooks = s.hooks || {};
  const meus = nossosHooks();

  for (const [evento, entradas] of Object.entries(meus)) {
    const atuais = Array.isArray(s.hooks[evento]) ? s.hooks[evento] : [];
    // Tira os nossos antigos e mantem intactos os do usuario.
    s.hooks[evento] = [...atuais.filter((e) => !ehNosso(e)), ...entradas];
  }

  fs.mkdirSync(path.dirname(ARQ_SETTINGS), { recursive: true });
  fs.writeFileSync(ARQ_SETTINGS, JSON.stringify(s, null, 2) + '\n', 'utf8');
  return { arquivo: ARQ_SETTINGS, backup: copia };
}

function desinstalar() {
  const s = lerSettings();
  if (!s.hooks) return { arquivo: ARQ_SETTINGS, backup: null };

  const copia = backup();
  for (const evento of Object.keys(s.hooks)) {
    const restantes = (s.hooks[evento] || []).filter((e) => !ehNosso(e));
    if (restantes.length) s.hooks[evento] = restantes;
    else delete s.hooks[evento];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;

  fs.writeFileSync(ARQ_SETTINGS, JSON.stringify(s, null, 2) + '\n', 'utf8');
  return { arquivo: ARQ_SETTINGS, backup: copia };
}

module.exports = {
  ARQ_SETTINGS,
  MARCA,
  comando,
  nossosHooks,
  lerSettings,
  estaInstalado,
  situacao,
  rotasEsperadas,
  instalar,
  desinstalar,
};
