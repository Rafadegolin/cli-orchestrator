'use strict';
// Branch, PR e CI no cabecalho, e a secao "Pronto para revisar" (Fase 10.3).
//
// Duas metades. A primeira roda em Node puro: o estado da branch e o push
// contra um remoto BARE local, e o modulo do GitHub com `fetch` falso -- nada
// aqui toca a rede nem le credencial de verdade. A segunda dirige o app do
// `npm run dev` num repositorio descartavel, sem Claude e sem GitHub (o remoto
// e uma pasta, entao `repoGithub` devolve null e nenhuma consulta sai).
//
// O contrato da API de verdade e do `git credential fill` fica no
// `teste:github-real`.

const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const worktrees = require('../src/main/worktrees');
const github = require('../src/main/github');

const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

async function ate(fn, cond, ms = 10000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    ultimo = await fn();
    if (cond(ultimo)) return ultimo;
    await esperar(200);
  }
  return ultimo;
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Um repositorio com um remoto BARE, e uma worktree na convencao do `claude -w`.
function montar(rotulo) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `orq-branch-${rotulo}-`));
  const bare = path.join(base, 'remoto.git');
  const raiz = path.join(base, 'repo');
  git(base, ['init', '-q', '--bare', '-b', 'main', bare]);
  fs.mkdirSync(raiz);
  git(raiz, ['init', '-q', '-b', 'main']);
  git(raiz, ['config', 'user.email', 'teste@exemplo']);
  git(raiz, ['config', 'user.name', 'teste']);
  git(raiz, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'base\n');
  git(raiz, ['add', '.']);
  git(raiz, ['commit', '-q', '-m', 'base']);
  git(raiz, ['remote', 'add', 'origin', bare]);
  git(raiz, ['push', '-q', '-u', 'origin', 'main']);
  const slug = 'feat-branch';
  const wt = path.join(raiz, '.claude', 'worktrees', slug);
  git(raiz, ['worktree', 'add', '-q', '-b', `worktree-${slug}`, wt]);
  return { base, bare, raiz, wt, slug };
}

function commitar(dir, arquivo, texto) {
  fs.writeFileSync(path.join(dir, arquivo), texto);
  git(dir, ['add', '.']);
  git(dir, ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-q', '-m', arquivo]);
}

async function nodePuro() {
  const r = montar('puro');

  // --- estado local ---------------------------------------------------------
  let e = await worktrees.estadoBranch(r.wt);
  checar('worktree recem-criada: no branch, base main, nada a frente',
    e.ok && e.branch === `worktree-${r.slug}` && e.base === 'main' && e.frente === 0 && e.upstream === '',
    JSON.stringify(e));

  commitar(r.wt, 'b.txt', 'b\n');
  commitar(r.wt, 'c.txt', 'c\n');
  e = await worktrees.estadoBranch(r.wt);
  checar('dois commits a frente e, sem upstream, os dois sem push',
    e.frente === 2 && e.semPush === 2 && e.upstream === '', JSON.stringify(e));

  const raiz = await worktrees.estadoBranch(r.raiz);
  checar('no checkout principal (branch == base) nao ha nada a frente',
    raiz.ok && raiz.branch === 'main' && raiz.frente === 0 && raiz.upstream === 'origin/main', JSON.stringify(raiz));

  // --- push -----------------------------------------------------------------
  const p1 = await worktrees.push(r.wt);
  checar('push sem upstream cria a branch no remoto', p1.ok && p1.remoto === 'origin', JSON.stringify(p1));
  checar('e o remoto bare recebeu a branch',
    git(r.bare, ['branch', '--list', `worktree-${r.slug}`]).includes(`worktree-${r.slug}`));
  e = await worktrees.estadoBranch(r.wt);
  checar('depois do push: rastreada, e nada sem push',
    e.upstream === `origin/worktree-${r.slug}` && e.semPush === 0 && e.frente === 2, JSON.stringify(e));
  checar('o estado traz a URL do remoto (e o que diz se e GitHub)', e.urlRemoto === r.bare, e.urlRemoto);

  commitar(r.wt, 'd.txt', 'd\n');
  e = await worktrees.estadoBranch(r.wt);
  checar('commit novo com upstream: 1 sem push', e.semPush === 1 && e.frente === 3, JSON.stringify(e));
  const p2 = await worktrees.push(r.wt);
  checar('push com upstream envia', p2.ok && (await worktrees.estadoBranch(r.wt)).semPush === 0, JSON.stringify(p2));

  // Divergiu: alguem mandou outro commit para a mesma branch no remoto.
  const clone = path.join(r.base, 'clone');
  git(r.base, ['clone', '-q', '-b', `worktree-${r.slug}`, r.bare, clone]);
  commitar(clone, 'outro.txt', 'de outra pessoa\n');
  git(clone, ['push', '-q']);
  commitar(r.wt, 'e.txt', 'e\n');
  const p3 = await worktrees.push(r.wt);
  checar('push divergido e RECUSADO (nunca --force)', p3.ok === false && /recusado/.test(p3.texto || ''), JSON.stringify(p3));
  checar('e a recusa cabe numa linha', !/\n/.test(p3.texto || ''), p3.texto);

  // HEAD destacado
  git(r.wt, ['checkout', '-q', '--detach']);
  e = await worktrees.estadoBranch(r.wt);
  checar('HEAD destacado nao tem branch nem nada a frente', e.ok && e.branch === '' && e.frente === 0, JSON.stringify(e));
  const p4 = await worktrees.push(r.wt);
  checar('e o push recusa com motivo', p4.ok === false && /HEAD destacado/.test(p4.texto), p4.texto);

  // Sem origin e com dois remotos: nao adivinha.
  git(r.raiz, ['remote', 'rename', 'origin', 'um']);
  git(r.raiz, ['remote', 'add', 'dois', r.bare]);
  git(r.raiz, ['checkout', '-q', '-b', 'sem-remoto-claro']);
  commitar(r.raiz, 'f.txt', 'f\n');
  const p5 = await worktrees.push(r.raiz);
  checar('dois remotos e nenhum origin: recusa em vez de adivinhar',
    p5.ok === false && /nenhum se chama origin/.test(p5.texto), JSON.stringify(p5));

  fs.rmSync(r.base, { recursive: true, force: true });

  // --- repoGithub -------------------------------------------------------------
  const casos = [
    ['https://github.com/Acme/App.git', 'Acme/App'],
    ['https://user:ghp_segredo@github.com/acme/app', 'acme/app'],
    ['git@github.com:acme/app.git', 'acme/app'],
    ['ssh://git@github.com/acme/app.git', 'acme/app'],
    ['https://gitlab.com/acme/app.git', null],
    ['C:\\repos\\remoto.git', null],
    ['', null],
  ];
  for (const [url, esperado] of casos) {
    const g = github.repoGithub(url);
    const obtido = g ? `${g.dono}/${g.repo}` : null;
    checar(`repoGithub(${url || "''"})`, obtido === esperado, String(obtido));
  }

  // --- consultar, com fetch falso ---------------------------------------------
  const TOKEN = 'ghp_TOKEN_FALSO_QUE_NAO_PODE_VAZAR';
  function falso(rotas) {
    const vistos = [];
    const buscar = async (url, op) => {
      vistos.push({ url, auth: op.headers.Authorization || '' });
      const caminho = url.replace('https://api.github.com', '');
      const achado = rotas.find(([prefixo, comToken]) => caminho.startsWith(prefixo)
        && (comToken === undefined || comToken === Boolean(op.headers.Authorization)));
      if (!achado) return { status: 404, json: async () => ({ message: 'Not Found' }) };
      return { status: achado[2], json: async () => achado[3] };
    };
    return { buscar, vistos };
  }
  const alvo = { dono: 'acme', repo: 'app', branch: 'feature/TECH-1', sha: 'abc123' };

  const f1 = falso([
    ['/repos/acme/app/pulls', undefined, 200, [
      { number: 7, state: 'closed', merged_at: '2026-01-01', html_url: 'https://github.com/acme/app/pull/7' },
      { number: 12, state: 'open', draft: false, merged_at: null, html_url: 'https://github.com/acme/app/pull/12' },
    ]],
    ['/repos/acme/app/commits/abc123/check-runs', undefined, 200, { check_runs: [
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
      { status: 'completed', conclusion: 'skipped' },
      { status: 'in_progress', conclusion: null },
    ] }],
  ]);
  const c1 = await github.consultar(alvo, { buscar: f1.buscar, lerCredencial: async () => TOKEN });
  checar('o PR ABERTO vence o mais antigo mesclado', c1.acesso && c1.pr.numero === 12 && c1.pr.estado === 'aberto',
    JSON.stringify(c1));
  checar('CI resumido: 4 checks, 1 falha, 1 rodando (skipped nao e falha)',
    c1.ci.total === 4 && c1.ci.falhas === 1 && c1.ci.pendentes === 1, JSON.stringify(c1.ci));
  checar('a consulta do PR usa head=dono:branch',
    f1.vistos[0].url.includes(`head=${encodeURIComponent('acme:feature/TECH-1')}`), f1.vistos[0].url);
  checar('com credencial, vai como Bearer', f1.vistos[0].auth === `Bearer ${TOKEN}`);
  checar('o token NAO aparece no retorno', !JSON.stringify(c1).includes(TOKEN));

  const f2 = falso([
    ['/repos/acme/app/pulls', true, 401, { message: 'Bad credentials' }],
    ['/repos/acme/app/pulls', false, 200, [{ number: 3, state: 'closed', merged_at: '2026-01-02', html_url: 'https://x' }]],
    ['/repos/acme/app/commits', undefined, 200, { check_runs: [] }],
  ]);
  const c2 = await github.consultar(alvo, { buscar: f2.buscar, lerCredencial: async () => TOKEN });
  checar('token recusado (401) tenta de novo sem token', c2.acesso && c2.pr.estado === 'mesclado', JSON.stringify(c2));
  checar('e o retorno ainda nao carrega o token', !JSON.stringify(c2).includes(TOKEN));

  const f3 = falso([]);
  const c3 = await github.consultar(alvo, { buscar: f3.buscar, lerCredencial: async () => '' });
  checar('404 (privado sem credencial) vira acesso:false', c3.acesso === false, JSON.stringify(c3));
  checar('sem credencial, nenhum cabecalho Authorization sai', f3.vistos.every((v) => !v.auth));

  const c4 = await github.consultar(alvo, {
    buscar: async () => { throw new Error(`rede caiu levando ${TOKEN}`); },
    lerCredencial: async () => TOKEN,
  });
  checar('rede fora vira acesso:false, sem estourar e sem vazar o token',
    c4.acesso === false && !JSON.stringify(c4).includes(TOKEN), JSON.stringify(c4));

  checar('urlNovoPr preserva a / do branch',
    github.urlNovoPr('acme', 'app', 'main', 'feature/TECH-1')
      === 'https://github.com/acme/app/compare/main...feature/TECH-1?expand=1',
    github.urlNovoPr('acme', 'app', 'main', 'feature/TECH-1'));
}

function stop(id) {
  return new Promise((ok) => {
    const req = http.request({
      host: '127.0.0.1', port: 47615, path: '/evento/Stop/', method: 'POST',
      headers: { 'x-orq-id': id, 'content-type': 'application/json' },
    }, (res) => { res.resume(); res.on('end', ok); });
    req.on('error', ok);
    req.end('{}');
  });
}

(async () => {
  await nodePuro();

  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  const r = montar('ui');
  commitar(r.wt, 'b.txt', 'b\n');

  const PN = (id) => `window.OrqPainel.painelPorId.get(${JSON.stringify(id)})`;
  const id = await cdp.avaliar(`window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(r.wt)}, feature: ${JSON.stringify(r.slug)} })
    .then((p) => p.id)`);
  checar('painel aberto na worktree', Boolean(id));

  const chip = () => cdp.avaliar(`JSON.stringify({ texto: ${PN(id)}.elBranch.textContent,
    hidden: ${PN(id)}.elBranch.hidden, title: ${PN(id)}.elBranch.title })`).then(JSON.parse);
  let c = await ate(chip, (x) => !x.hidden, 8000);
  checar('o chip aparece ao nascer, so com o estado local', c.hidden === false && c.texto === '1 à frente · push',
    JSON.stringify(c));
  checar('o title explica que ainda nao esta no remoto', /ainda não está no remoto/.test(c.title), c.title);

  // Fora da fila de atencao, mesmo depois do Stop.
  await stop(id);
  const revisar = () => cdp.avaliar(`JSON.stringify({
    hidden: document.getElementById('bloco-revisar').hidden,
    ids: [...document.querySelectorAll('#revisar-lista li')].map((li) => li.dataset.id),
    texto: document.getElementById('revisar-lista').textContent,
    fila: window.OrqLateral.filaAtencao().map((x) => x.id),
  })`).then(JSON.parse);
  const rv = await ate(revisar, (x) => x.ids.includes(id), 8000);
  checar('o Stop poe a sessao em "Pronto para revisar"', rv.hidden === false && rv.ids.includes(id), JSON.stringify(rv));
  checar('com o estado da branch no cartao', /1 à frente/.test(rv.texto), rv.texto);
  checar('e ela NAO entra na fila de atencao (o amarelo e so para pergunta)', !rv.fila.includes(id));

  // Push pelo IPC, sem o dialogo nativo (que o CDP nao dirige).
  const p = JSON.parse(await cdp.avaliar(`window.orq.branchPush(${JSON.stringify(id)}, false).then(JSON.stringify)`));
  checar('push pelo IPC', p.ok === true, JSON.stringify(p));
  c = await ate(chip, (x) => x.texto === '1 à frente', 8000);
  checar('o chip perde o "push" depois de enviar', c.texto === '1 à frente', JSON.stringify(c));
  checar('e o remoto bare recebeu a branch',
    git(r.bare, ['branch', '--list', `worktree-${r.slug}`]).includes(`worktree-${r.slug}`));

  const pr = JSON.parse(await cdp.avaliar(`window.orq.branchAbrirPr(${JSON.stringify(id)}).then(JSON.stringify)`));
  checar('abrir PR com remoto que nao e GitHub recusa com motivo, sem abrir nada',
    pr.ok === false && /GitHub/.test(pr.texto), JSON.stringify(pr));

  // O menu
  const menu = JSON.parse(await cdp.avaliar(`(() => {
    window.OrqBranch.abrirMenu(${JSON.stringify(id)}, 100, 100);
    const el = document.querySelector('.menu-branch');
    const itens = [...el.querySelectorAll('button')].map((b) => ({ t: b.textContent, d: b.disabled }));
    window.OrqBranch.fecharMenu();
    return JSON.stringify({ itens, fechado: el.hidden });
  })()`));
  checar('o menu sem nada para enviar oferece PR (desligado: nao e GitHub) e Atualizar',
    menu.itens.length === 2 && menu.itens[0].d === true && menu.itens[1].t === 'Atualizar', JSON.stringify(menu));
  checar('e fecha', menu.fechado === true);

  // Painel de terminal na mesma pasta: sem chip.
  const idT = await cdp.avaliar(`window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(r.wt)}, feature: 't',
    tipoPainel: 'terminal' }).then((p) => p.id)`);
  await esperar(1500);
  checar('painel de terminal nao mostra chip', await cdp.avaliar(`${PN(idT)}.elBranch.hidden`) === true);

  await zerarGrade(cdp);
  await esperar(500);
  fs.rmSync(r.base, { recursive: true, force: true });
  encerrar('BRANCH');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
