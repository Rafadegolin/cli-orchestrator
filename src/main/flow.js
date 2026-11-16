'use strict';

// A inbox do Pronix Flow (Fase 10.4): as issues abertas atribuidas a quem gerou
// o token, lidas de `GET <origem>/api/orquestrador/issues`.
//
// O contrato e DELES, como o do /abrir: mora em
// `apps/api/src/orquestrador/orquestrador.service.ts` do pronix-flow, e os
// campos `repo`, `branch`, `issue`, `title`, `url` e `description` tem o MESMO
// nome e significado do payload do /abrir -- e isso que deixa abrir a issue pelo
// mesmo caminho (`externo.atender`), sem uma segunda logica de slug, branch,
// worktree e prefill.
//
// O token e PESSOAL (`pfx_...`, criado em Configuracoes -> Tokens de API no
// Flow) e so le as issues de quem o criou. Quem o guarda e o
// `flow-credencial.js`, cifrado pelo `safeStorage`; aqui ele chega por
// parametro e morre na chamada: nao vai para retorno, erro nem log.
//
// Node puro, sem Electron: o `teste:inbox` exercita tudo com `fetch` falso.

const pedidos = require('./pedido');
const { ORIGEM_FLOW } = require('./preferencias');

const CAMINHO = '/api/orquestrador/issues';
const MS_API = 10_000;

// O formato do token do Flow (`TOKEN_PREFIX` + 32 bytes em base64url). Conferir
// aqui poupa uma ida a rede com um texto colado errado, e e o que permite dizer
// "isso nao e um token do Flow" em vez de "token invalido".
const TOKEN_VALIDO = /^pfx_[A-Za-z0-9_-]{20,200}$/;

// O mesmo teto do "Abrir no Claude" do Flow (`MAX_DESCRICAO` em
// `apps/web/src/lib/orquestrador.ts`), com folga sob os 5000 do CLI. Pelo Flow o
// corte acontece no navegador; pela inbox a descricao chega INTEIRA, e o
// `montarPrompt` recusaria acima de 5000 -- uma issue longa nunca abriria.
const MAX_DESCRICAO = 4000;
const MARCA_CORTE = '\n\n[…descrição truncada — a issue completa está no Flow]';

const MAX_ISSUES = 200;

// A origem do Flow, ou '' quando nao serve.
//
// So https, e http SO no loopback (o Flow de desenvolvimento roda em
// localhost:3100). O token viaja no cabecalho: mandar para um http qualquer
// seria entrega-lo a quem estiver no caminho. O caminho e descartado -- quem
// cola `https://flow.x/teams/abc` quis dizer `https://flow.x`.
function normalizarBase(bruto) {
  const t = String(bruto || '').trim();
  if (!t) return ORIGEM_FLOW;
  let u;
  try { u = new URL(t); } catch { return ''; }
  if (u.username || u.password) return '';
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:' && loopback) return u.origin;
  return '';
}

function tokenValido(token) {
  return TOKEN_VALIDO.test(String(token || '').trim());
}

function cortarDescricao(texto) {
  const t = String(texto || '').trim();
  if (t.length <= MAX_DESCRICAO) return t;
  return t.slice(0, MAX_DESCRICAO - MARCA_CORTE.length) + MARCA_CORTE;
}

const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Uma issue do Flow na forma que o app usa, ou `null` quando falta o minimo.
//
// Defensivo de proposito: a resposta e de outro sistema, e um campo que mudar
// de forma tem de derrubar UMA linha da lista, nao a inbox inteira.
function normalizarIssue(b) {
  if (!b || typeof b !== 'object') return null;
  const id = texto(b.id, 80);
  const issue = texto(b.issue, 60);
  const branch = texto(b.branch, 200);
  if (!id || !issue || !branch) return null;
  return {
    id,
    issue,
    branch,
    repo: texto(b.repo, 200) || null,
    title: texto(b.title, 300),
    url: pedidos.urlSegura(b.url),
    description: typeof b.description === 'string' ? b.description : '',
    estado: {
      nome: texto(b.state && b.state.name, 60),
      tipo: texto(b.state && b.state.type, 20),
    },
    prioridade: texto(b.priority, 20),
    time: { chave: texto(b.team && b.team.key, 20), nome: texto(b.team && b.team.name, 80) },
    atualizada: texto(b.updatedAt, 40),
  };
}

function normalizarInbox(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const lista = Array.isArray(c.issues) ? c.issues : [];
  const usuario = c.user && typeof c.user === 'object'
    ? { nome: texto(c.user.name, 120), email: texto(c.user.email, 200) }
    : { nome: '', email: '' };
  return {
    usuario,
    issues: lista.slice(0, MAX_ISSUES).map(normalizarIssue).filter(Boolean),
  };
}

// Os campos que `externo.atender` recebe -- os do /abrir, com a descricao ja
// cortada no teto.
function paraPedido(issue) {
  return {
    repo: issue.repo || '',
    branch: issue.branch,
    issue: issue.issue,
    title: issue.title,
    url: issue.url,
    description: cortarDescricao(issue.description),
  };
}

// Em que projeto cadastrado cada issue abriria -- so leitura, para a lista.
//
// E o MESMO `pedido.resolver` que decide o clique, entao a tela nunca promete um
// projeto que o clique nao abriria. Sem a releitura forcada de remotes do
// `externo.resolverProjeto`: aquilo e um `git config` por projeto, aceitavel
// para UM pedido e caro demais para cada linha de uma lista.
function anotar(issues, projetos) {
  return issues.map((i) => {
    if (!i.repo) return { ...i, projeto: null, motivo: 'sem-repo' };
    const n = pedidos.normalizarPedido(paraPedido(i));
    if (!n.ok) return { ...i, projeto: null, motivo: n.erro };
    const r = pedidos.resolver(n.pedido, projetos);
    if (r.ok) return { ...i, projeto: { id: r.projeto.id, nome: r.projeto.nome }, motivo: '' };
    return { ...i, projeto: null, motivo: r.erro };
  });
}

// O GET. Devolve `{ ok, usuario, issues }` ou `{ ok: false, erro, texto }`,
// nunca estoura -- e nunca carrega o token, nem no erro.
async function buscarInbox({ base, token, buscar = fetch } = {}) {
  const origem = normalizarBase(base);
  if (!origem) return { ok: false, erro: 'url', texto: 'endereço do Flow inválido (use https)' };
  if (!tokenValido(token)) return { ok: false, erro: 'token', texto: 'isso não parece um token do Flow (pfx_…)' };

  let r;
  try {
    r = await buscar(`${origem}${CAMINHO}`, {
      headers: { Authorization: `Bearer ${String(token).trim()}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(MS_API),
    });
  } catch {
    return { ok: false, erro: 'rede', texto: `não consegui falar com ${origem}` };
  }

  if (r.status === 401) {
    return { ok: false, erro: 'token', texto: 'o Flow recusou o token — ele pode ter sido revogado' };
  }
  // 404 e o Flow de antes da rota existir: o resto do app continua igual.
  if (r.status === 404) {
    return { ok: false, erro: 'versao', texto: 'este Flow ainda não tem a inbox do orquestrador' };
  }
  if (!r.ok) return { ok: false, erro: 'servidor', texto: `o Flow respondeu ${r.status}` };

  let corpo;
  try { corpo = await r.json(); } catch {
    return { ok: false, erro: 'formato', texto: 'a resposta do Flow não é JSON' };
  }
  return { ok: true, ...normalizarInbox(corpo) };
}

// ------------------------------------------- devolutiva ao solicitante

// "TECH-3641". Mesma regra de key do Flow (`parseIdentifier` em
// `orquestrador-summary.service.ts`): letra + 1..9 alfanumericos, caixa livre.
const IDENTIFICADOR = /^[A-Za-z][A-Za-z0-9]{1,9}-\d{1,9}$/;

function identificadorValido(id) {
  return IDENTIFICADOR.test(String(id || '').trim());
}

// Teto do texto da devolutiva -- o `MAX_SUMMARY_LENGTH` do Flow.
const MAX_RESUMO = 20_000;

// Uma chamada autenticada ao Flow, com os mesmos portoes do `buscarInbox`
// (origem https, formato do token) e os mesmos codigos de erro. Nunca estoura e
// nunca carrega o token no retorno.
async function chamar({ base, token, caminho, metodo = 'GET', corpo, buscar = fetch }) {
  const origem = normalizarBase(base);
  if (!origem) return { ok: false, erro: 'url', texto: 'endereço do Flow inválido (use https)' };
  if (!tokenValido(token)) return { ok: false, erro: 'token', texto: 'isso não parece um token do Flow (pfx_…)' };

  let r;
  try {
    r = await buscar(`${origem}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${String(token).trim()}`,
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
      signal: AbortSignal.timeout(MS_API),
    });
  } catch {
    return { ok: false, erro: 'rede', texto: `não consegui falar com ${origem}` };
  }

  if (r.status === 401) {
    return { ok: false, erro: 'token', texto: 'o Flow recusou o token — ele pode ter sido revogado' };
  }
  let json = null;
  try { json = await r.json(); } catch { /* corpo vazio ou nao-JSON */ }
  if (!r.ok) {
    const msg = json && typeof json.message === 'string' ? json.message : '';
    return {
      ok: false,
      erro: r.status === 404 ? 'nao-encontrada' : 'servidor',
      status: r.status,
      texto: msg || `o Flow respondeu ${r.status}`,
    };
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, erro: 'formato', texto: 'a resposta do Flow não é JSON' };
  }
  return { ok: true, json };
}

// O contexto da issue para o pedido de devolutiva (`OrqIssueContextDto`).
// 404 aqui tanto pode ser issue inexistente quanto um Flow de antes da rota.
async function buscarContexto({ base, token, identificador, buscar = fetch } = {}) {
  const id = String(identificador || '').trim();
  if (!identificadorValido(id)) {
    return { ok: false, erro: 'identificador', texto: `"${id}" não é um identificador de issue (ex.: TECH-123)` };
  }
  const r = await chamar({ base, token, caminho: `${CAMINHO}/${encodeURIComponent(id)}`, buscar });
  if (!r.ok) {
    if (r.erro === 'nao-encontrada') {
      return { ...r, texto: `a issue ${id} não existe no Flow (ou este Flow ainda não tem a devolutiva)` };
    }
    return r;
  }
  const b = r.json;
  const req = b.requester && typeof b.requester === 'object' ? b.requester : null;
  const nomeSolicitante = req ? texto(req.name, 120) : '';
  return {
    ok: true,
    contexto: {
      issue: texto(b.issue, 60) || id.toUpperCase(),
      titulo: texto(b.title, 300),
      url: pedidos.urlSegura(b.url),
      descricao: cortarDescricao(b.description),
      solicitante: nomeSolicitante
        ? { nome: nomeSolicitante, cargo: texto(req.position, 120), departamento: texto(req.department, 120) }
        : null,
    },
  };
}

// Grava a devolutiva como RASCUNHO. Devolve `{ ok, url }` (a issue no Flow).
async function salvarResumo({ base, token, identificador, texto: corpo, buscar = fetch } = {}) {
  const id = String(identificador || '').trim();
  if (!identificadorValido(id)) return { ok: false, erro: 'identificador', texto: 'identificador de issue inválido' };
  const t = String(corpo || '').replace(/\r\n?/g, '\n').trim();
  if (!t) return { ok: false, erro: 'vazio', texto: 'a devolutiva veio vazia' };
  if (t.length > MAX_RESUMO) return { ok: false, erro: 'grande', texto: `a devolutiva passa de ${MAX_RESUMO} caracteres` };
  const r = await chamar({
    base,
    token,
    metodo: 'POST',
    corpo: { body: t },
    buscar,
    caminho: `${CAMINHO}/${encodeURIComponent(id)}/summaries`,
  });
  if (!r.ok) return r;
  return { ok: true, url: pedidos.urlSegura(r.json.url) };
}

module.exports = {
  CAMINHO,
  MAX_DESCRICAO,
  MAX_RESUMO,
  identificadorValido,
  buscarContexto,
  salvarResumo,
  normalizarBase,
  tokenValido,
  cortarDescricao,
  normalizarInbox,
  paraPedido,
  anotar,
  buscarInbox,
};
