'use strict';

// As rotas /orq/* (Fase 10.6): uma sessao do Claude num painel -- a
// COORDENADORA -- cria e acompanha WORKERS, cada um com painel e worktree
// proprios, visiveis na grade e com status pelos hooks de sempre.
//
// Tudo que DECIDE mora aqui, em Node puro e sem Electron (o molde do
// `pedido.js`): quem pode chamar, quantos filhos, o long-poll, o formato das
// respostas, e o Enter automatico da partida. O que precisa do Electron (a
// janela, o PTY, o git) chega INJETADO por `configurar()` -- e e isso que deixa o
// `teste:orquestracao` exercitar as rotas sem app.
//
// O que o spike mediu e decidiu este desenho (CLAUDE.md, "O que o spike do
// 10.6 mediu"): a skill basta, por `curl`; o Bash do CLI corta em 120s, entao o
// `esperar` segura no maximo 90s e a skill chama em laco; e o diff tem de ser o
// de verdade, porque o modelo desconfia de resumo bonito.

const path = require('path');

// Abaixo dos 120s do Bash do CLI, com folga para o `curl` subir.
const ESPERAR_MAX_S = 90;
// Workers VIVOS por coordenadora. Cada um e uma sessao inteira gastando token.
const MAX_FILHOS = 6;
// Ritmo de `criar` por coordenadora: o modelo em laco nao pode virar rajada.
const RITMO_MAX = 3;
const RITMO_JANELA = 30_000;
// Long-polls abertos ao mesmo tempo, somando todas as coordenadoras.
const MAX_ESPERAS = 16;
// O mesmo teto do `--prefill-b64` (`pedido.MAX_PROMPT`).
const MAX_PROMPT = 5000;
const MAX_NOME = 60;

// A partida. MEDIDO (`spike:orquestracao D`, CLI 2.1.312): o registro
// `~/.claude/sessions/<pid>.json` aparece `idle` com o nosso `name` ~1,1s depois
// de subir, ja com o prefill na caixa, e um Enter 300ms depois ENVIA. Numa pasta
// nao confiada o registro so aparece DEPOIS de a pessoa aceitar o dialogo de
// confianca -- entao esperar por ele e o que garante que o Enter nunca cai
// naquele dialogo (cujo padrao e "No, exit").
const MS_LACO_PARTIDA = 1000;
const MS_ANTES_DO_ENTER = 300;
// Generoso de proposito: o worker pode estar retido na `OrqFila` (teto de 4
// rodando, escape em 60s) antes de o Claude sequer subir.
const MS_DESISTIR_PARTIDA = 150_000;

// O que ENCERRA a espera da coordenadora. `rodando`/`iniciando` nao: e o worker
// trabalhando. `esperando` sim: alguem precisa responder, e a coordenadora deve
// saber (quem responde e a pessoa, pela faixa de aprovacao).
const FINAIS = new Set(['terminou', 'esperando', 'parada', 'encerrada']);

let dep = null;
const workers = new Map();
const ritmo = new Map();
let esperasAbertas = 0;
let lacoPartida = null;

// { estado, terminais, projetos, worktrees, pedirJanela, sessoesClaude,
//   escrever, avisar, agora }
function configurar(d) {
  dep = { agora: () => Date.now(), avisar: () => {}, ...d };
}

const erro = (status, codigo, texto, extra = {}) => ({ status, corpo: { ok: false, erro: codigo, texto, ...extra } });
const ok = (status, corpo) => ({ status, corpo: { ok: true, ...corpo } });

const norm = (p) => path.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();
const dentro = (pai, filho) => {
  const a = norm(pai);
  const b = norm(filho);
  return b === a || b.startsWith(`${a}${path.sep}`);
};

// ------------------------------------------------------------ quem chama

// O `X-Orq-Id` e o id do painel, injetado no PTY e herdado pela ferramenta Bash
// do CLI. Nao e segredo (contra codigo local nao ha defesa: ver o `/abrir`), mas
// e o que amarra o pedido a UMA sessao do app -- sem ele nao ha "filhos de quem".
function chamador(orqId) {
  const id = String(orqId || '').trim();
  if (!id || /[$%]/.test(id)) {
    return { falha: erro(401, 'sem-identidade', 'chame de dentro de uma sessao do orquestrador, com -H "X-Orq-Id: $ORQ_ID"') };
  }
  const s = dep.estado.obter(id);
  if (!s || !dep.terminais.cwdDe(id)) {
    return { falha: erro(403, 'desconhecido', 'este id nao e uma sessao aberta no orquestrador') };
  }
  return { id, sessao: s };
}

function vivo(id) {
  return Boolean(dep.estado.obter(id) && dep.terminais.cwdDe(id));
}

// A coordenadora so enxerga os PROPRIOS workers. Id de outro devolve o mesmo
// 404 de um id que nao existe: nao ha por que confirmar que ele existe.
function meuWorker(paiId, id) {
  const w = workers.get(String(id || ''));
  if (!w || w.paiId !== paiId) return null;
  return w;
}

function statusDe(w) {
  const s = dep.estado.obter(w.id);
  return s || { status: 'encerrada', pergunta: '', desde: w.criadoEm };
}

// Nenhuma resposta carrega caminho de disco: a mesma regra do `/ping`. O
// branch basta para a coordenadora mesclar (`git merge <branch>`).
function paraResposta(w) {
  const s = statusDe(w);
  return {
    id: w.id,
    nome: w.nome,
    branch: w.branch,
    status: s.status,
    pergunta: s.status === 'esperando' ? s.pergunta || '' : '',
    desde: s.desde,
    partida: w.partida,
  };
}

// ------------------------------------------------------------ as rotas

async function atender({ rota, orqId, query = {}, corpo = {}, aoFechar = () => {} }) {
  if (!dep) return erro(503, 'sem-handler', 'orquestracao nao configurada');
  const quem = chamador(orqId);
  if (quem.falha) return quem.falha;
  podar();

  switch (rota) {
    case 'criar': return criar(quem, corpo);
    case 'status': return ok(200, { workers: meus(quem.id).map(paraResposta) });
    case 'esperar': return esperar(quem, query, aoFechar);
    case 'enviar': return enviar(quem, corpo);
    case 'diff': return diff(quem, query);
    default: return erro(404, 'rota-desconhecida', 'rotas: criar, status, esperar, enviar, diff');
  }
}

function meus(paiId) {
  return [...workers.values()].filter((w) => w.paiId === paiId);
}

async function criar(quem, corpo) {
  // Profundidade 1: worker nao cria worker. Uma arvore de sessoes gastando
  // token sem ninguem olhando e o oposto do que este app existe para mostrar.
  if (workers.has(quem.id)) {
    return erro(403, 'profundidade', 'um worker nao pode criar outros workers');
  }

  const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : '';
  const prompt = typeof corpo.prompt === 'string' ? corpo.prompt : '';
  if (!nome || nome.length > MAX_NOME) return erro(400, 'nome', `nome curto obrigatorio (ate ${MAX_NOME} caracteres)`);
  if (!prompt.trim()) return erro(400, 'prompt', 'prompt obrigatorio');
  if (prompt.length > MAX_PROMPT) {
    return erro(413, 'prompt-grande', `o prompt tem ${prompt.length} caracteres; o limite e ${MAX_PROMPT}`);
  }

  const vivos = meus(quem.id).filter((w) => vivo(w.id)).length;
  if (vivos >= MAX_FILHOS) {
    return erro(429, 'teto-filhos', `ja ha ${vivos} workers vivos; o teto e ${MAX_FILHOS}. Espere algum terminar e feche-o.`);
  }
  const agora = dep.agora();
  const marcas = (ritmo.get(quem.id) || []).filter((t) => agora - t < RITMO_JANELA);
  if (marcas.length >= RITMO_MAX) {
    return erro(429, 'ritmo', `no maximo ${RITMO_MAX} workers a cada ${RITMO_JANELA / 1000}s`);
  }

  // O projeto e o da COORDENADORA, pela pasta onde a sessao dela esta agora
  // (`cwdSessao`, que acompanha o `claude -w`). Nenhuma string do pedido vira
  // caminho: o projeto sai da lista cadastrada, como no `pedido.resolver`.
  const cwd = quem.sessao.cwdSessao || quem.sessao.cwd || dep.terminais.cwdDe(quem.id);
  const projeto = dep.projetos.donoDe(cwd);
  if (!projeto) {
    return erro(409, 'sem-projeto', 'a pasta desta sessao nao e de um projeto cadastrado no orquestrador');
  }

  // O worker nasce do commit ATUAL da coordenadora (decisao de quem pediu): ele
  // enxerga o que ela ja commitou, e ela depois mescla o branch dele no dela.
  const eb = await dep.worktrees.estadoBranch(cwd);
  if (!eb || !eb.ok || !eb.branch || !eb.sha) {
    return erro(409, 'sem-branch', 'esta sessao nao esta num branch (HEAD destacado?)');
  }

  const r = await dep.pedirJanela('criar', {
    projetoId: projeto.id, nome, prompt, desde: eb.sha, pai: quem.id,
  });
  if (!r) return erro(504, 'sem-resposta', 'a janela do orquestrador nao respondeu');
  if (!r.ok) return erro(r.status || 409, r.erro || 'recusado', r.texto || 'nao consegui criar o worker');

  // So o que NASCEU conta no ritmo: uma recusa (nome repetido) nao pode custar
  // ao modelo a vaga da tentativa seguinte, com o nome certo.
  marcas.push(agora);
  ritmo.set(quem.id, marcas);

  const w = {
    id: r.painel,
    paiId: quem.id,
    nome: r.nome,
    branch: r.branch,
    base: eb.branch,
    worktree: r.worktree,
    criadoEm: agora,
    partida: 'pendente',
    // Antes disto, um `terminou` e velho e nao encerra o `esperar`. Relogio
    // REAL, e nao o `dep.agora`: e comparado com o `desde` do `estado.js`.
    enviadoEm: Date.now(),
  };
  workers.set(w.id, w);
  armarPartida();
  return ok(201, { worker: paraResposta(w) });
}

function esperar(quem, query, aoFechar) {
  const w = meuWorker(quem.id, query.id);
  if (!w) return erro(404, 'worker-desconhecido', 'nao ha worker seu com esse id (veja /orq/status)');

  const pedido = Number(query.timeout);
  const segundos = Number.isFinite(pedido) && pedido > 0 ? Math.min(ESPERAR_MAX_S, pedido) : ESPERAR_MAX_S;

  // Um status final ANTERIOR ao ultimo envio e velho: a coordenadora mandou
  // `enviar` e chamou `esperar` antes de o hook do worker dizer que voltou a
  // rodar. Sem isto, o `terminou` de antes devolveria na hora, e ela leria um
  // diff que o worker ainda nem comecou a mudar.
  const encerra = (s) => s && FINAIS.has(s.status) && (s.status === 'encerrada' || (s.desde || 0) >= w.enviadoEm);
  const atual = statusDe(w);
  if (encerra(atual)) return ok(200, { worker: paraResposta(w), expirou: false });

  if (esperasAbertas >= MAX_ESPERAS) {
    return erro(429, 'muitas-esperas', `ja ha ${MAX_ESPERAS} esperas abertas; espere um worker de cada vez`);
  }

  return new Promise((resolve) => {
    esperasAbertas += 1;
    let feito = false;
    const fim = (expirou) => {
      if (feito) return;
      feito = true;
      esperasAbertas -= 1;
      desligar();
      clearTimeout(prazo);
      resolve(ok(200, { worker: paraResposta(w), expirou }));
    };
    const desligar = dep.estado.aoMudar((d) => {
      if (d.id !== w.id) return;
      if (encerra(d.status === 'encerrada' ? d : statusDe(w))) fim(false);
    });
    const prazo = setTimeout(() => fim(true), segundos * 1000);
    // O cliente desistiu (o Bash do CLI matou o curl): solta a vaga.
    aoFechar(() => fim(true));
  });
}

async function enviar(quem, corpo) {
  const w = meuWorker(quem.id, corpo.id);
  if (!w) return erro(404, 'worker-desconhecido', 'nao ha worker seu com esse id (veja /orq/status)');
  const texto = typeof corpo.texto === 'string' ? corpo.texto : '';
  if (!texto.trim()) return erro(400, 'texto', 'texto obrigatorio');
  if (texto.length > MAX_PROMPT) return erro(413, 'texto-grande', `no maximo ${MAX_PROMPT} caracteres`);

  const s = statusDe(w);
  if (!vivo(w.id)) return erro(409, 'encerrada', 'este worker foi fechado');
  // A mesma recusa do `ligacoes.js`: em `esperando` o texto cairia DENTRO do
  // seletor de permissao, que responde a digitos. Quem responde e a pessoa.
  if (s.status === 'esperando') {
    return erro(409, 'esperando', 'o worker esta esperando uma resposta da pessoa; espere de novo', { pergunta: s.pergunta || '' });
  }

  const r = await dep.pedirJanela('enviar', { worker: w.id, texto });
  if (!r) return erro(504, 'sem-resposta', 'a janela do orquestrador nao respondeu');
  if (!r.ok) return erro(r.status || 409, r.erro || 'recusado', r.texto || 'nao consegui enviar');
  w.enviadoEm = Date.now();
  return ok(200, { worker: paraResposta(w) });
}

async function diff(quem, query) {
  const w = meuWorker(quem.id, query.id);
  if (!w) return erro(404, 'worker-desconhecido', 'nao ha worker seu com esse id (veja /orq/status)');
  const r = await dep.worktrees.diffLento(w.worktree, { base: w.base, arquivo: query.arquivo || '' });
  if (!r.ok) return erro(409, 'diff', r.texto);
  const { ok: _ok, ...resto } = r;
  return ok(200, { id: w.id, branch: w.branch, ...resto });
}

// ------------------------------------------------------------ a partida

// Laco TEMPORARIO: so existe enquanto ha worker esperando o Enter, e morre
// sozinho. Um relogio permanente cobraria do orcamento de CPU parado, que ja
// esta apertado (`registro.js`, `teste:fase2`).
function armarPartida() {
  if (lacoPartida) return;
  lacoPartida = setInterval(tiquePartida, MS_LACO_PARTIDA);
}

function tiquePartida() {
  const pendentes = [...workers.values()].filter((w) => w.partida === 'pendente');
  if (!pendentes.length) {
    clearInterval(lacoPartida);
    lacoPartida = null;
    return;
  }
  let lista = null;
  for (const w of pendentes) {
    if (!vivo(w.id)) { w.partida = 'desistiu'; continue; }
    if (dep.agora() - w.criadoEm > MS_DESISTIR_PARTIDA) {
      w.partida = 'desistiu';
      dep.avisar(`O worker ${w.nome} nao chegou a ficar pronto; o pedido esta na caixa dele, sem enviar.`);
      continue;
    }
    if (!lista) {
      try { lista = dep.sessoesClaude(); } catch { lista = []; }
    }
    // Pelo NOME, como o `registro.js`: o `--name <slug>` e exatamente o
    // `feature` do painel. A pasta e a segunda confirmacao.
    const s = lista.find((x) => x.nome === w.nome && dentro(w.worktree, x.cwd));
    if (!s || s.status !== 'idle') continue;
    w.partida = 'enviando';
    setTimeout(() => {
      if (vivo(w.id)) dep.escrever(w.id, '\r');
      w.partida = 'enviada';
      w.enviadoEm = Date.now();
    }, MS_ANTES_DO_ENTER);
  }
}

// Worker morto cujo pai tambem morreu nao interessa a mais ninguem.
function podar() {
  for (const w of workers.values()) {
    if (!vivo(w.id) && !vivo(w.paiId)) workers.delete(w.id);
  }
}

function eWorker(id) {
  return workers.has(id);
}

// So para o teste.
function _esperasAbertas() {
  return esperasAbertas;
}

function _zerar() {
  workers.clear();
  ritmo.clear();
  esperasAbertas = 0;
  if (lacoPartida) clearInterval(lacoPartida);
  lacoPartida = null;
}

module.exports = {
  ESPERAR_MAX_S, MAX_FILHOS, MAX_PROMPT, MAX_ESPERAS, RITMO_MAX, RITMO_JANELA,
  MS_DESISTIR_PARTIDA, FINAIS,
  configurar, atender, eWorker, tiquePartida, _zerar, _esperasAbertas,
};
