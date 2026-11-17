'use strict';

// O historico de SESSOES do Claude Code (redesign R8): os transcritos em
// `~/.claude/projects/<pasta codificada>/*.jsonl`, resumidos para a pagina de
// Historico -- titulo, primeiro pedido, a ultima fala do agente, modelo, numero
// de mensagens, PR ligado e quando.
//
// LER SEM CARREGAR O ARQUIVO INTEIRO e a regra do modulo: medido aqui, sao
// ~2,7 GB em ~400 arquivos, o maior com ~71 MB. Cada arquivo e lido em dois
// pedacos -- a CABECA (64 KB: o primeiro pedido) e a CAUDA (256 KB: titulo,
// ultima fala, modelo, contagem) --, e o resumo fica em cache por caminho +
// mtime + tamanho, em memoria e em `~/.orquestrador/transcritos.json`.
//
// O formato e LAYOUT INTERNO do CLI, nao contrato (o mesmo aviso do
// claude-dados.js): campo que sumir vira vazio na tela, nunca erro. O conteudo
// nunca sai desta maquina.
//
// Node puro, `ORQ_CLAUDE` e `ORQ_DADOS` para o teste.

const fs = require('fs');
const path = require('path');
const claudeDados = require('./claude-dados');
const arquivo = require('./arquivo');

const CABECA = 64 * 1024;
const CAUDA = 256 * 1024;
const MAX_TEXTO = 600;
const POR_PAGINA = 30;
const CONCORRENCIA = 4;
const ARQ_CACHE = 'transcritos.json';
const MAX_CACHE = 2000;

let cache = null; // caminho -> { mtimeMs, size, resumo }
let gravarDepois = null;

function lerCache() {
  if (cache) return cache;
  cache = new Map();
  const salvo = arquivo.lerJson(arquivo.caminho(ARQ_CACHE), null);
  if (salvo && Array.isArray(salvo.itens)) {
    for (const it of salvo.itens) if (it && it.caminho) cache.set(it.caminho, it);
  }
  return cache;
}

function agendarGravacao() {
  clearTimeout(gravarDepois);
  gravarDepois = setTimeout(() => {
    const itens = [...lerCache().values()].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_CACHE);
    try { arquivo.gravarJson(arquivo.caminho(ARQ_CACHE), { itens }); } catch { /* cache e so atalho */ }
  }, 2000);
  if (gravarDepois.unref) gravarDepois.unref();
}

// ------------------------------------------------------------ leitura

function lerPedaco(fd, inicio, tamanho) {
  const buf = Buffer.alloc(tamanho);
  const n = fs.readSync(fd, buf, 0, tamanho, inicio);
  return buf.subarray(0, n).toString('utf8');
}

// As linhas JSON de um pedaco. Na cauda a primeira linha quase sempre esta
// cortada no meio, e na cabeca a ultima: as duas sao descartadas pelo parse.
function linhas(texto) {
  const saida = [];
  for (const l of texto.split('\n')) {
    if (!l.trim()) continue;
    try { saida.push(JSON.parse(l)); } catch { /* linha cortada */ }
  }
  return saida;
}

// O texto de uma mensagem: string, ou os blocos `text` de um array. Bloco de
// ferramenta (tool_use / tool_result) nao e fala.
function textoDe(mensagem) {
  const c = mensagem && mensagem.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

// Fala de verdade da pessoa: nao e meta, nao e de subagente, nao e resultado de
// ferramenta, e nao e o eco de um comando de barra.
function falaDaPessoa(r) {
  if (!r || r.type !== 'user' || r.isMeta || r.isSidechain) return '';
  const t = textoDe(r.message).trim();
  if (!t || /^<(command|local-command|system-reminder)/.test(t)) return '';
  return t;
}

function falaDoAgente(r) {
  if (!r || r.type !== 'assistant' || r.isSidechain) return '';
  return textoDe(r.message).trim();
}

const cortar = (t, n = MAX_TEXTO) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

function resumir(caminho, stat) {
  let fd;
  try {
    fd = fs.openSync(caminho, 'r');
    const tamanho = stat.size;
    const cabeca = linhas(lerPedaco(fd, 0, Math.min(CABECA, tamanho)));
    const cauda = tamanho > CABECA
      ? linhas(lerPedaco(fd, Math.max(0, tamanho - CAUDA), Math.min(CAUDA, tamanho)))
      : cabeca;

    let sessionId = '';
    let cwd = '';
    let branch = '';
    let primeiro = '';
    for (const r of cabeca) {
      if (!sessionId && r.sessionId) sessionId = r.sessionId;
      if (!cwd && r.cwd) cwd = r.cwd;
      if (!branch && r.gitBranch) branch = r.gitBranch;
      if (!primeiro) primeiro = falaDaPessoa(r);
      if (sessionId && cwd && primeiro) break;
    }

    let titulo = '';
    let ultimo = '';
    let modelo = '';
    let msgs = null;
    let pr = null;
    let contadas = 0;
    for (const r of cauda) {
      if (!sessionId && r.sessionId) sessionId = r.sessionId;
      if (r.type === 'custom-title' && r.customTitle) titulo = r.customTitle;
      else if (r.type === 'ai-title' && r.aiTitle && !titulo) titulo = r.aiTitle;
      if (r.type === 'pr-link' && r.prNumber) pr = { numero: r.prNumber, url: r.prUrl || '' };
      if (r.type === 'system' && r.subtype === 'turn_duration' && Number.isFinite(r.messageCount)) msgs = r.messageCount;
      if (r.type === 'user' || r.type === 'assistant') contadas += 1;
      const fala = falaDoAgente(r);
      if (fala) {
        ultimo = fala;
        if (r.message && r.message.model) modelo = r.message.model;
      }
      if (r.gitBranch) branch = r.gitBranch;
    }
    // O ai-title pode vir antes de um custom-title na cauda: o custom vence.
    for (const r of cauda) if (r.type === 'custom-title' && r.customTitle) titulo = r.customTitle;

    // O NOME DO ARQUIVO e o id da sessao no Claude Code (`<uuid>.jsonl`), e e a
    // fonte mais firme: o `sessionId` dos registros so entra se o nome nao for
    // um uuid.
    const doNome = path.basename(caminho, '.jsonl');
    return {
      sessionId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(doNome)
        ? doNome : (sessionId || doNome),
      cwd,
      branch,
      titulo: cortar(titulo || primeiro, 120),
      primeiro: cortar(primeiro),
      ultimo: cortar(ultimo),
      modelo,
      msgs: msgs != null ? msgs : null,
      // Sem o turn_duration, a contagem da cauda e um piso (o arquivo pode ser
      // maior que ela): a tela diz "+" nesse caso.
      msgsPiso: msgs == null ? contadas : null,
      pr,
      em: stat.mtimeMs,
      tamanho,
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ja fechado */ }
  }
}

// ------------------------------------------------------------ listar

// As pastas do CLI que pertencem aos projetos pedidos: a do proprio projeto e
// as das worktrees dele (`<proj>/.claude/worktrees/<x>` vira
// `<codificado>--claude-worktrees-<x>`). Sem projetos: todas.
function pastasDe(projetos) {
  const raiz = claudeDados.pastaProjetos();
  let nomes = [];
  try { nomes = fs.readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  if (!projetos || !projetos.length) return nomes.map((n) => path.join(raiz, n));
  const prefixos = projetos.map((p) => path.basename(claudeDados.pastaDoProjeto(p)).toLowerCase());
  return nomes.filter((n) => {
    const l = n.toLowerCase();
    return prefixos.some((p) => l === p || l.startsWith(`${p}--claude-worktrees-`));
  }).map((n) => path.join(raiz, n));
}

function arquivosDe(pastas) {
  const saida = [];
  for (const pasta of pastas) {
    let itens = [];
    try { itens = fs.readdirSync(pasta); } catch { continue; }
    for (const nome of itens) {
      if (!nome.endsWith('.jsonl')) continue;
      const caminho = path.join(pasta, nome);
      try {
        const stat = fs.statSync(caminho);
        if (stat.isFile() && stat.size > 0) saida.push({ caminho, stat });
      } catch { /* sumiu no meio */ }
    }
  }
  return saida.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

function resumoComCache({ caminho, stat }) {
  const c = lerCache();
  const visto = c.get(caminho);
  if (visto && visto.mtimeMs === stat.mtimeMs && visto.size === stat.size) return visto.resumo;
  const resumo = resumir(caminho, stat);
  if (resumo) {
    c.set(caminho, { caminho, mtimeMs: stat.mtimeMs, size: stat.size, resumo });
    agendarGravacao();
  }
  return resumo;
}

// `{ projetos: [caminhos] | [], busca, pagina }` -> `{ itens, total, pagina }`.
// Assincrono e em lotes de CONCORRENCIA, cedendo o loop entre eles: o processo
// principal hospeda as sessoes e nao pode travar lendo transcrito.
async function listar({ projetos = [], busca = '', pagina = 0, aoProgresso } = {}) {
  const todos = arquivosDe(pastasDe(projetos));
  const termo = String(busca || '').trim().toLowerCase();
  const inicio = Math.max(0, Number(pagina) || 0) * POR_PAGINA;
  const itens = [];
  let casados = 0;
  let feitos = 0;

  for (let i = 0; i < todos.length; i += CONCORRENCIA) {
    const lote = todos.slice(i, i + CONCORRENCIA);
    for (const a of lote) {
      const r = resumoComCache(a);
      feitos += 1;
      if (!r) continue;
      if (termo && !`${r.titulo} ${r.primeiro} ${r.ultimo} ${r.branch}`.toLowerCase().includes(termo)) continue;
      if (casados >= inicio && itens.length < POR_PAGINA) itens.push({ arquivo: a.caminho, ...r });
      casados += 1;
    }
    if (aoProgresso) aoProgresso({ feitos, total: todos.length });
    await new Promise((ok) => setImmediate(ok));
    // Sem busca, a pagina pedida ja esta completa: nao ha por que resumir o
    // resto agora (o total vem da contagem de arquivos).
    if (!termo && itens.length >= POR_PAGINA) break;
  }
  return {
    itens,
    total: termo ? casados : todos.length,
    pagina: Math.max(0, Number(pagina) || 0),
    porPagina: POR_PAGINA,
  };
}

// O detalhe de uma sessao: o primeiro pedido (mais longo) e os ultimos turnos.
// O caminho vem da janela: tem de estar DENTRO da pasta de projetos do CLI e
// terminar em .jsonl, senao e recusado.
function detalhe(caminho) {
  const raiz = path.resolve(claudeDados.pastaProjetos());
  const alvo = path.resolve(String(caminho || ''));
  if (!alvo.toLowerCase().startsWith(`${raiz.toLowerCase()}${path.sep}`) || !alvo.endsWith('.jsonl')) {
    return { ok: false, texto: 'Arquivo fora do histórico do Claude Code.' };
  }
  let stat;
  try { stat = fs.statSync(alvo); } catch { return { ok: false, texto: 'A conversa não existe mais.' }; }
  let fd;
  try {
    fd = fs.openSync(alvo, 'r');
    const cabeca = linhas(lerPedaco(fd, 0, Math.min(CABECA, stat.size)));
    const cauda = stat.size > CABECA
      ? linhas(lerPedaco(fd, Math.max(0, stat.size - CAUDA), Math.min(CAUDA, stat.size)))
      : cabeca;
    let primeiro = '';
    for (const r of cabeca) { primeiro = falaDaPessoa(r); if (primeiro) break; }
    const turnos = [];
    for (const r of cauda) {
      const voce = falaDaPessoa(r);
      if (voce) { turnos.push({ quem: 'voce', texto: cortar(voce, 1200) }); continue; }
      const agente = falaDoAgente(r);
      if (agente) turnos.push({ quem: 'agente', texto: cortar(agente, 1200) });
    }
    return { ok: true, primeiro: cortar(primeiro, 2000), turnos: turnos.slice(-4) };
  } catch {
    return { ok: false, texto: 'Não consegui ler a conversa.' };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ja fechado */ }
  }
}

function esquecerCache() {
  cache = null;
}

module.exports = {
  listar, detalhe, resumir, pastasDe, esquecerCache,
  CABECA, CAUDA, POR_PAGINA,
};
