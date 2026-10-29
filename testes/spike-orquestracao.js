'use strict';

// SPIKE do 10.6 (rotas /orq/* + skill de orquestracao). MEDE o CLI real e
// CONSOME TOKENS -- nao e teste de regressao, e roda a mao.
//
// Responde as tres perguntas do `docs/fase-10-proximos-passos.md` antes de
// existir qualquer rota em `src/`:
//
//   A. a ferramenta Bash do CLI corta um long-poll? (define o teto do /orq/esperar)
//   B. o Claude segue uma skill que manda despachar workers por `curl`?
//   C. as agent teams nativas funcionam no Windows? (se sim, o 10.6 encolhe)
//
// Tudo numa pasta descartavel em %TEMP%, com um servidor HTTP FALSO no lugar
// das rotas /orq/*, que registra cada chamada. A skill e de escopo de PROJETO
// (`<pasta>/.claude/skills/`): nada e gravado no `~/.claude` de ninguem.
//
// `spawn` assincrono, NUNCA `spawnSync`: o servidor falso roda neste mesmo
// processo, e uma chamada sincrona travaria o laco de eventos -- o `curl` do
// Claude nunca seria respondido e o spike mediria a si mesmo.
//
// Uso: node testes/spike-orquestracao.js [A] [B] [C]   (sem argumento: todas)

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const DIR = path.join(os.tmpdir(), 'orq-spike-orquestracao');
const PROJ = path.join(DIR, 'projeto');
const SAIDA = path.join(DIR, 'resultado.json');

// A mesma lista do `terminais.js`: sem isto o `claude -p` lancado de dentro de
// uma sessao (o caso de quem roda o spike pelo proprio Claude Code) nasceria se
// achando sessao-filha dela.
const ENV_SESSAO_PAI = ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID'];

function envLimpo(extra = {}) {
  const e = { ...process.env, ...extra };
  for (const k of ENV_SESSAO_PAI) delete e[k];
  // Sem ORQ_ID os hooks do app (se estiverem instalados) nao confundem as
  // sessoes do spike com um painel.
  delete e.ORQ_ID;
  return e;
}

const agora = () => Date.now();
const T0 = agora();
const rel = () => `${String(((agora() - T0) / 1000).toFixed(1)).padStart(6)}s`;
const log = (...a) => console.log(`[${rel()}]`, ...a);

// ------------------------------------------------------------ servidor falso

const chamadas = [];
const workers = new Map();
let seqWorker = 0;

// Quanto um worker falso leva para "terminar".
const MS_WORKER = 8_000;
// Teto do esperar falso. E o numero que a parte A existe para validar.
const MAX_ESPERAR_S = 90;

function statusDe(w) {
  return agora() - w.criado >= MS_WORKER ? 'terminou' : 'rodando';
}

function json(res, status, corpo) {
  const txt = JSON.stringify(corpo);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(txt) });
  res.end(txt);
}

const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  let corpo = '';
  req.on('data', (d) => { corpo += d; });
  req.on('end', () => {
    const reg = {
      t: agora() - T0,
      metodo: req.method,
      rota: u.pathname,
      query: Object.fromEntries(u.searchParams),
      tipo: req.headers['content-type'] || '',
      corpo: corpo.slice(0, 2000),
      completou: false,
      abortou: false,
      msAberto: 0,
    };
    chamadas.push(reg);
    const inicio = agora();
    // `close` antes do `finish` = o cliente desistiu (o Bash do CLI matou o curl).
    res.on('finish', () => { reg.completou = true; reg.msAberto = agora() - inicio; });
    res.on('close', () => { if (!reg.completou) { reg.abortou = true; reg.msAberto = agora() - inicio; } });

    // --- A: o long-poll cru
    if (req.method === 'GET' && u.pathname === '/esperar') {
      const s = Math.min(600, Math.max(0, Number(u.searchParams.get('s')) || 0));
      setTimeout(() => { if (!res.writableEnded && !res.destroyed) json(res, 200, { pronto: true, s }); }, s * 1000);
      return;
    }

    // --- B: as rotas propostas do 10.6
    if (req.method === 'POST' && u.pathname === '/orq/criar') {
      let b = null;
      try { b = JSON.parse(corpo); } catch { /* registra torto */ }
      reg.corpoValido = Boolean(b && typeof b.nome === 'string' && b.nome && typeof b.prompt === 'string' && b.prompt);
      if (!reg.corpoValido) return json(res, 400, { erro: 'corpo-invalido', texto: 'precisa de nome e prompt' });
      seqWorker += 1;
      const id = `w${seqWorker}`;
      const slug = String(b.nome).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60);
      workers.set(id, { id, nome: slug, prompt: b.prompt, criado: agora() });
      return json(res, 201, { id, nome: slug, branch: `worktree-${slug}`, status: 'iniciando' });
    }
    if (req.method === 'GET' && u.pathname === '/orq/status') {
      const lista = [...workers.values()].map((w) => ({ id: w.id, nome: w.nome, status: statusDe(w), pergunta: null }));
      return json(res, 200, { workers: lista });
    }
    if (req.method === 'GET' && u.pathname === '/orq/esperar') {
      const w = workers.get(u.searchParams.get('id') || '');
      if (!w) return json(res, 404, { erro: 'worker-desconhecido' });
      const teto = Math.min(MAX_ESPERAR_S, Math.max(1, Number(u.searchParams.get('timeout')) || MAX_ESPERAR_S));
      const limite = agora() + teto * 1000;
      const tique = () => {
        if (res.destroyed) return;
        const st = statusDe(w);
        if (st === 'terminou' || agora() >= limite) return json(res, 200, { id: w.id, status: st, expirou: st !== 'terminou' });
        setTimeout(tique, 500);
      };
      return tique();
    }
    if (req.method === 'POST' && u.pathname === '/orq/enviar') {
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && u.pathname === '/orq/diff') {
      const w = workers.get(u.searchParams.get('id') || '');
      if (!w) return json(res, 404, { erro: 'worker-desconhecido' });
      return json(res, 200, { id: w.id, arquivos: [`src/${w.nome}.js`], resumo: `+42 -3 em src/${w.nome}.js` });
    }

    reg.inventada = true;
    json(res, 404, { erro: 'rota-desconhecida' });
  });
});

// ------------------------------------------------------------ rodar o CLI

// Uma sessao `claude -p` com stream-json: e o que deixa ver CADA chamada de
// ferramenta, com os parametros que o modelo escolheu (timeout, background).
function rodarClaude(nome, prompt, { args = [], env = {}, msTeto = 8 * 60_000 } = {}) {
  return new Promise((resolve) => {
    const inicio = agora();
    const todos = ['-p', prompt, '--output-format', 'stream-json', '--verbose', ...args];
    log(`>> ${nome}: claude ${args.join(' ')}`);
    const filho = spawn('claude', todos, { cwd: PROJ, env: envLimpo(env), windowsHide: true });
    let resto = '';
    let stderr = '';
    const eventos = [];
    filho.stdout.on('data', (d) => {
      resto += d.toString('utf8');
      let i;
      while ((i = resto.indexOf('\n')) >= 0) {
        const linha = resto.slice(0, i).trim();
        resto = resto.slice(i + 1);
        if (!linha) continue;
        try { eventos.push(JSON.parse(linha)); } catch { /* linha que nao e JSON */ }
      }
    });
    filho.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    const prazo = setTimeout(() => { log(`!! ${nome}: estourou ${msTeto / 1000}s, matando`); filho.kill(); }, msTeto);
    filho.on('close', (codigo) => {
      clearTimeout(prazo);
      const ferramentas = [];
      for (const e of eventos) {
        if (e.type !== 'assistant' || !e.message || !Array.isArray(e.message.content)) continue;
        // `parent_tool_use_id` diz de QUEM e a chamada: nulo e a sessao principal,
        // preenchido e um subagente/teammate. E o que separa "ele delegou" de
        // "ele fez sozinho".
        for (const c of e.message.content) {
          if (c.type === 'tool_use') ferramentas.push({ nome: c.name, entrada: c.input, mae: e.parent_tool_use_id || null, id: c.id });
        }
      }
      const fim = eventos.find((e) => e.type === 'result') || {};
      const r = {
        nome,
        codigo,
        ms: agora() - inicio,
        ferramentas,
        resposta: String(fim.result || '').slice(0, 1500),
        turnos: fim.num_turns,
        custo: fim.total_cost_usd,
        erro: fim.is_error || false,
        stderr: stderr.slice(-4000),
      };
      log(`<< ${nome}: codigo ${codigo} em ${(r.ms / 1000).toFixed(1)}s, ${ferramentas.length} ferramentas, US$ ${r.custo}`);
      resolve(r);
    });
  });
}

// ------------------------------------------------------------ A

async function parteA(porta) {
  const binario = estaticoTimeout();
  const url = (s) => `http://127.0.0.1:${porta}/esperar?s=${s}`;
  const casos = [
    // Controle: bem abaixo do padrao.
    { s: 20, dica: false },
    // Acima do padrao de 120s, sem avisar o modelo.
    { s: 150, dica: false },
    // Acima do padrao, avisando que demora: ele passa `timeout` sozinho?
    { s: 150, dica: true },
  ];
  const corridas = [];
  for (const c of casos) {
    const antes = chamadas.length;
    const prompt = `Rode exatamente este comando com a ferramenta Bash e me diga o JSON que ele devolveu: `
      + `curl -s "${url(c.s)}"`
      + (c.dica ? ` -- atenção: esse comando é um long-poll e pode levar até ${c.s + 30} segundos para responder.` : '');
    const r = await rodarClaude(`A s=${c.s}${c.dica ? ' com dica' : ''}`, prompt, {
      args: ['--allowedTools', 'Bash(curl:*)'],
    });
    const minhas = chamadas.slice(antes).filter((x) => x.rota === '/esperar');
    corridas.push({
      ...c,
      ms: r.ms,
      bash: r.ferramentas.filter((f) => f.nome === 'Bash').map((f) => ({
        timeout: f.entrada.timeout ?? null,
        background: Boolean(f.entrada.run_in_background),
      })),
      http: minhas.map((x) => ({ completou: x.completou, abortou: x.abortou, msAberto: x.msAberto })),
      resposta: r.resposta.slice(0, 300),
      custo: r.custo,
    });
  }
  return { binario, corridas };
}

// O padrao e o teto da ferramenta Bash, lidos do binario. Ja medido uma vez
// (2.1.312: `var a=120000,s=600000`), mas relido aqui porque e o numero que
// decide o teto do /orq/esperar e muda sem aviso entre versoes.
function estaticoTimeout() {
  try {
    const exe = execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/).find((l) => /\.exe$/i.test(l.trim()));
    if (!exe) return { erro: 'claude.exe nao achado' };
    const buf = fs.readFileSync(exe.trim());
    const txt = buf.toString('latin1');
    const m = /var (\w)=(\d+),(\w)=(\d+);function \w+\(\w=process\.env\)\{let \w=\w\.BASH_DEFAULT_TIMEOUT_MS/.exec(txt);
    if (!m) return { erro: 'padrao do timeout nao casou -- o CLI mudou a forma' };
    return { padraoMs: Number(m[2]), tetoMs: Number(m[4]) };
  } catch (err) {
    return { erro: String(err.message || err) };
  }
}

// ------------------------------------------------------------ B

function escreverSkill(porta) {
  const base = `http://127.0.0.1:${porta}`;
  const pasta = path.join(PROJ, '.claude', 'skills', 'orquestrador');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'SKILL.md'), `---
name: orquestrador
description: Despacha workers (outras sessoes do Claude Code, cada uma na sua worktree) pelo orquestrador de CLIs local. Use quando o pedido for dividir uma feature em partes e entregar cada parte a um worker.
---

# Orquestrador de CLIs

O orquestrador roda nesta maquina em ${base}. Cada worker e uma sessao nova do Claude
Code, na propria worktree e no proprio branch. Fale com ele so por \`curl\`, sempre com
\`-s\`, e mande JSON com \`-H "content-type: application/json"\`.

## Rotas

- Criar um worker:
  \`curl -s -X POST ${base}/orq/criar -H "content-type: application/json" -d '{"nome":"<slug-curto>","prompt":"<o que o worker deve fazer>"}'\`
  Responde \`{"id","nome","branch","status"}\`. Guarde o \`id\`.
- Ver todos: \`curl -s ${base}/orq/status\`
- Esperar um worker terminar (long-poll, no maximo ${MAX_ESPERAR_S}s por chamada):
  \`curl -s "${base}/orq/esperar?id=<id>&timeout=${MAX_ESPERAR_S}"\`
  Se voltar \`"expirou": true\`, chame de novo. Pare quando \`status\` for \`terminou\`.
- Mandar texto para um worker: \`curl -s -X POST ${base}/orq/enviar -H "content-type: application/json" -d '{"id":"<id>","texto":"..."}'\`
- Ver o que um worker mudou: \`curl -s "${base}/orq/diff?id=<id>"\`

## Regras

- Um worker por parte independente. Nao crie worker para trabalho que voce mesmo faria em um passo.
- Nao invente rotas alem destas.
- Depois de criar, espere cada worker com /orq/esperar antes de ler o diff.
`);
}

async function parteB(porta) {
  escreverSkill(porta);
  const rodadas = [];
  for (let i = 1; i <= 2; i++) {
    const antes = chamadas.length;
    const r = await rodarClaude(`B rodada ${i}`,
      'Use o orquestrador para dividir a feature "exportar o relatório em CSV" em três partes '
      + 'independentes (backend, frontend e testes) e despache um worker para cada. Espere os três '
      + 'terminarem e me diga, numa linha por worker, o que cada um mudou.',
      { args: ['--allowedTools', 'Bash(curl:*)', 'Skill', 'Read'] });
    const minhas = chamadas.slice(antes);
    rodadas.push({
      rodada: i,
      ms: r.ms,
      custo: r.custo,
      turnos: r.turnos,
      usouSkill: r.ferramentas.some((f) => f.nome === 'Skill'),
      criar: minhas.filter((x) => x.rota === '/orq/criar').length,
      criarValidos: minhas.filter((x) => x.rota === '/orq/criar' && x.corpoValido).length,
      criarComJson: minhas.filter((x) => x.rota === '/orq/criar' && /application\/json/i.test(x.tipo)).length,
      esperar: minhas.filter((x) => x.rota === '/orq/esperar').length,
      status: minhas.filter((x) => x.rota === '/orq/status').length,
      diff: minhas.filter((x) => x.rota === '/orq/diff').length,
      inventadas: minhas.filter((x) => x.inventada).map((x) => `${x.metodo} ${x.rota}`),
      esperarAbortados: minhas.filter((x) => x.rota === '/orq/esperar' && x.abortou).length,
      resposta: r.resposta.slice(0, 600),
    });
    workers.clear();
  }
  return { rodadas };
}

// ------------------------------------------------------------ C

// O portao das teams e o backend escolhido, lidos do binario. Medido uma vez:
// `$o(){if(!env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS&&!argv.includes("--agent-teams"))return!1;
// if(!E("tengu_amber_flint",!0))return!1;return!0}` -- SEM teste de plataforma, ao
// contrario do cross-session messaging.
function estaticoTeams() {
  try {
    const exe = execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/).find((l) => /\.exe$/i.test(l.trim()));
    const txt = fs.readFileSync(exe.trim()).toString('latin1');
    // `[\w$]`, e nao `\w`: o bundler nomeia a funcao `$o`, e `\w` nao casa `$`.
    const m = /function [\w$]+\(\)\{if\(![\w$]+\.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS[^}]*\}/.exec(txt);
    return {
      portao: m ? m[0] : null,
      portaoTemPlataforma: m ? /windows|win32|platform/i.test(m[0]) : null,
      fallbackEmProcesso: txt.includes('isInProcessEnabled: true (non-interactive session)'),
    };
  } catch (err) {
    return { erro: String(err.message || err) };
  }
}

async function parteC() {
  const binario = estaticoTeams();
  for (const f of ['alfa.txt', 'beta.txt']) fs.rmSync(path.join(PROJ, f), { force: true });
  const r = await rodarClaude('C agent teams',
    'Crie uma equipe de agentes (agent team) com dois teammates. O primeiro teammate cria o arquivo '
    + 'alfa.txt na pasta atual com o texto ALFA-OK; o segundo cria beta.txt com o texto BETA-OK. '
    + 'NAO crie os arquivos voce mesmo: delegue aos teammates. Quando os dois terminarem, responda "feito".',
    {
      env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' },
      args: ['--permission-mode', 'acceptEdits', '--debug'],
      msTeto: 10 * 60_000,
    });
  const ler = (f) => { try { return fs.readFileSync(path.join(PROJ, f), 'utf8').trim(); } catch { return null; } };
  const nomes = r.ferramentas.map((f) => f.nome);
  return {
    binario,
    ms: r.ms,
    custo: r.custo,
    ferramentas: [...new Set(nomes)],
    // As entradas das chamadas de delegacao (sem o prompt inteiro) e quem
    // escreveu cada arquivo: a sessao principal (mae nula) ou um delegado.
    delegacoes: r.ferramentas.filter((f) => /agent|team|task/i.test(f.nome)).map((f) => ({
      nome: f.nome,
      chaves: Object.keys(f.entrada || {}),
      tipo: f.entrada && (f.entrada.subagent_type || f.entrada.team_name || f.entrada.name || null),
      mae: f.mae,
    })),
    escritas: r.ferramentas.filter((f) => f.nome === 'Write').map((f) => ({
      arquivo: path.basename(String((f.entrada || {}).file_path || '')),
      porDelegado: Boolean(f.mae),
    })),
    usouTeam: nomes.some((n) => /team/i.test(n)),
    alfa: ler('alfa.txt'),
    beta: ler('beta.txt'),
    backend: (r.stderr.match(/\[BackendRegistry\][^\n]*/g) || []).slice(0, 8),
    resposta: r.resposta.slice(0, 400),
    stderrFim: r.erro ? r.stderr.slice(-800) : '',
  };
}

// ------------------------------------------------------------ main

(async () => {
  const pedidas = process.argv.slice(2).map((x) => x.toUpperCase());
  const roda = (p) => !pedidas.length || pedidas.includes(p);

  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJ, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: PROJ });
  fs.writeFileSync(path.join(PROJ, 'README.md'), '# projeto descartavel do spike de orquestracao\n');

  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = servidor.address().port;
  log(`servidor falso em 127.0.0.1:${porta}, pasta ${PROJ}`);

  const resultado = { cli: execFileSync('claude', ['--version'], { encoding: 'utf8', env: envLimpo() }).trim() };
  if (roda('A')) resultado.A = await parteA(porta);
  if (roda('B')) resultado.B = await parteB(porta);
  if (roda('C')) resultado.C = await parteC();
  resultado.chamadas = chamadas;

  fs.writeFileSync(SAIDA, JSON.stringify(resultado, null, 2));
  servidor.close();

  console.log('\n================ RESULTADO ================');
  console.log(JSON.stringify({ ...resultado, chamadas: `${chamadas.length} (ver ${SAIDA})` }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
