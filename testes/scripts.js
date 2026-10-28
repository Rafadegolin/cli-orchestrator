'use strict';
// Os scripts `setup`, `run` e `arquivar` do projeto (Fase 10.2).
//
// Duas metades. A primeira roda em Node puro: a normalizacao do cadastro e a
// heranca do bloco de portas. A segunda dirige o app do `npm run dev`, num
// repositorio descartavel, SEM INVOCAR O CLAUDE: o `montarComando` e trocado
// pelo mesmo comando com `echo claude`, como no `teste:abrir-ui`, e o shell
// ecoa o que o CLI receberia.
//
// O `arquivar` e coberto no `teste:worktrees`, onde o script roda de verdade.
//
// Os comandos de setup/run sao de cmd.exe: esta metade so roda no Windows.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-teste-scripts-'));
process.env.ORQ_DADOS = PASTA;
// Depois do ORQ_DADOS: arquivo.js le a variavel na carga.
const projetos = require('../src/main/projetos');
const portas = require('../src/main/portas');

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

function montarRepo() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-scripts-'));
  git(raiz, ['init', '-q', '-b', 'main']);
  git(raiz, ['config', 'user.email', 'teste@exemplo']);
  git(raiz, ['config', 'user.name', 'teste']);
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'base\n');
  git(raiz, ['add', '.']);
  git(raiz, ['commit', '-q', '-m', 'base']);
  return raiz;
}

async function nodePuro() {
  // --- normalizacao ---------------------------------------------------------
  const n = projetos.normalizarScripts({ setup: '  npm ci  ', run: '', arquivar: null, outro: 'x' });
  checar('normalizar apara, descarta vazio e campo desconhecido',
    JSON.stringify(n.scripts) === JSON.stringify({ setup: 'npm ci' }) && n.erro === null, JSON.stringify(n));
  checar('quebra de linha e recusada (no cmd.exe viraria um Enter)',
    Boolean(projetos.normalizarScripts({ setup: 'a\nb' }).erro));
  checar('texto acima do teto e recusado',
    Boolean(projetos.normalizarScripts({ run: 'x'.repeat(projetos.MAX_SCRIPT + 1) }).erro));
  checar('valor que nao e texto e recusado', Boolean(projetos.normalizarScripts({ run: 42 }).erro));

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-scripts-pj-'));
  const { projeto } = projetos.adicionar(repo);
  const ruim = projetos.definirScripts(projeto.id, { setup: 'a\r\nb' });
  checar('definirScripts devolve o erro em vez de estourar', ruim.ok === false && Boolean(ruim.erro), JSON.stringify(ruim));
  const bom = projetos.definirScripts(projeto.id, { setup: 'npm ci', run: 'npm run dev' });
  checar('definirScripts grava', bom.ok === true);
  const lido = projetos.listar().find((p) => p.id === projeto.id);
  checar('o listar devolve os scripts', lido.scripts.setup === 'npm ci' && lido.scripts.run === 'npm run dev',
    JSON.stringify(lido.scripts));
  checar('scriptDe resolve por pasta, inclusive dentro de worktree',
    projetos.scriptDe(path.join(repo, '.claude', 'worktrees', 'x'), 'run') === 'npm run dev');
  checar('scriptDe de script ausente e vazio', projetos.scriptDe(repo, 'arquivar') === '');
  projetos.definirScripts(projeto.id, {});
  checar('salvar tudo vazio tira o campo do arquivo',
    !('scripts' in JSON.parse(fs.readFileSync(projetos.ARQUIVO, 'utf8')).projetos[0]));

  // Editado a mao com lixo: a leitura descarta calada, nunca estoura.
  const bruto = JSON.parse(fs.readFileSync(projetos.ARQUIVO, 'utf8'));
  bruto.projetos[0].scripts = { setup: 'ok', run: 'linha\nquebrada', arquivar: 7 };
  fs.writeFileSync(projetos.ARQUIVO, JSON.stringify(bruto));
  const torto = projetos.listar()[0].scripts;
  checar('script torto no JSON e descartado na leitura',
    JSON.stringify(torto) === JSON.stringify({ setup: 'ok' }), JSON.stringify(torto));

  // --- heranca de portas ----------------------------------------------------
  const a = await portas.reservar('sessao');
  const b = await portas.reservar('run', null, { herdarDe: 'sessao' });
  checar('o painel de run herda o MESMO bloco da sessao', a.length === 5 && a.join() === b.join(), `${a} / ${b}`);
  portas.liberar('sessao');
  const c = await portas.reservar('terceiro');
  checar('fechar a sessao NAO libera o bloco enquanto o run vive',
    c.length === 5 && !c.some((p) => b.includes(p)), `${c} / ${b}`);
  const d = await portas.reservar('orfao', null, { herdarDe: 'nao-existe' });
  checar('herdar de painel sem bloco cai numa reserva propria',
    d.length === 5 && !d.some((p) => b.includes(p) || c.includes(p)), String(d));
  for (const id of ['run', 'terceiro', 'orfao']) portas.liberar(id);

  fs.rmSync(repo, { recursive: true, force: true });
}

(async () => {
  await nodePuro();

  if (process.platform !== 'win32') {
    console.log('AVISO  a metade de interface usa comandos de cmd.exe e so roda no Windows');
    encerrar('SCRIPTS');
    return;
  }

  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  const raiz = montarRepo();
  const slug = 'scripts-setup';
  const wt = path.join(raiz, '.claude', 'worktrees', slug);

  // --- composicao da linha --------------------------------------------------
  const comp = JSON.parse(await cdp.avaliar(`(() => {
    const P = window.OrqProjetos;
    const base = 'cls && claude --name x';
    return JSON.stringify({
      com: P.comSetup(base, 'npm ci'),
      sem: P.comSetup(base, ''),
      solto: P.comSetup('claude', 'npm ci'),
      // A palavra claude DENTRO do setup nao pode ser o alvo das flags: o setup
      // entra por ultimo, depois do comAddDir e do comPrefill.
      ordem: P.comSetup(P.comPrefill(base, 'oi'), 'node scripts/claude.js'),
      // Prompt que cabe sozinho mas nao cabe com o setup: o prefill cai.
      cabeSo: P.prefillCabe(base, 'x'.repeat(4000)),
      cabeJunto: P.prefillCabe(base, 'x'.repeat(4000), { setup: 'y'.repeat(2900) }),
      setupCabe: P.setupCabe(base, 'y'.repeat(P.MAX_LINHA)),
    });
  })()`));
  checar('o setup entra depois do cls, com separador incondicional',
    comp.com === 'cls && npm ci & claude --name x', comp.com);
  checar('sem setup a linha nao muda', comp.sem === 'cls && claude --name x', comp.sem);
  checar('linha sem cls ganha o setup na frente', comp.solto === 'npm ci & claude', comp.solto);
  checar('a palavra claude do setup nao recebe as flags',
    /^cls && node scripts\/claude\.js & claude --deep-link-origin --prefill-b64 \S+ --name x$/.test(comp.ordem), comp.ordem);
  checar('o espaco do setup sai do teto do prefill', comp.cabeSo === true && comp.cabeJunto === false,
    JSON.stringify(comp));
  checar('setup que nao cabe na linha e detectado', comp.setupCabe === false);

  // --- estado fixado no comeco ----------------------------------------------
  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos();
  })()`);
  const proj = JSON.parse(await cdp.avaliar(
    `window.orq.projetosAdicionar(${JSON.stringify(raiz)}).then((r) => JSON.stringify(r.projeto))`,
  ));

  // O setup FALHA no meio (`cmd /c exit 1 &&` corta o resto dele), e o Claude
  // tem de subir assim mesmo. As marcas de saida sao montadas pelo shell
  // (`SETUP-%...%`), para nao casarem com o eco da propria linha digitada.
  const SETUP = 'echo SETUP%ORQ_PORTA:~0,0%-OK %ORQ_WORKTREE% && cmd /c exit 1 && echo NAO%ORQ_PORTA:~0,0%-DEVIA';
  const RUN = 'echo RUN%ORQ_PORTA:~0,0%-PORTA %PORT%';
  const def = JSON.parse(await cdp.avaliar(
    `window.orq.projetosDefinirScripts(${JSON.stringify(proj.id)}, ${JSON.stringify({ setup: SETUP, run: RUN })})
      .then((r) => JSON.stringify({ ok: r.ok, erro: r.erro }))`,
  ));
  checar('os scripts foram gravados pelo IPC', def.ok === true, JSON.stringify(def));
  await cdp.avaliar('window.OrqProjetos.carregarProjetos()');

  await cdp.avaliar(`(() => {
    window.__origMontar = window.OrqProjetos.montarComando;
    window.OrqProjetos.montarComando = (...a) => window.__origMontar(...a).replace(/\\bclaude\\b/, 'echo claude');
    return 'ok';
  })()`);

  // --- 1. a "nova sessao" de um projeto com setup ----------------------------
  const abrir = () => cdp.avaliar(`(async () => {
    document.getElementById('nome-feature').value = ${JSON.stringify(slug)};
    const p = await window.OrqProjetos.abrirProjeto(${JSON.stringify(proj.id)});
    return p ? p.id : '';
  })()`);

  const id1 = await abrir();
  checar('a nova sessao abriu um painel', Boolean(id1));
  const PN = (id) => `window.OrqPainel.painelPorId.get(${JSON.stringify(id)})`;
  const p1 = JSON.parse(await cdp.avaliar(`JSON.stringify({ cwd: ${PN(id1)}.cwd, cmd: ${PN(id1)}.comandoInicial,
    branch: ${PN(id1)}.branch })`));
  checar('o APP criou a worktree, e o painel nasceu nela',
    fs.existsSync(wt) && p1.cwd.toLowerCase() === wt.toLowerCase(), p1.cwd);
  checar('o branch e o mesmo do claude -w', p1.branch === `worktree-${slug}`, p1.branch);
  checar('o comando vai sem -w', !/ -w /.test(p1.cmd), p1.cmd);
  checar('o setup NAO entra no comandoInicial (o despertar o repetiria)', !/SETUP/.test(p1.cmd), p1.cmd);

  const tela = await ate(() => cdp.avaliar(`${PN(id1)}.textoDoBuffer()`),
    (t) => /^claude --name /m.test(t), 15000);
  const mSetup = /^SETUP-OK (.+)$/m.exec(tela);
  checar('o setup rodou dentro do painel', Boolean(mSetup), tela.slice(-400));
  checar('com ORQ_WORKTREE apontando para a worktree',
    mSetup && mSetup[1].trim().toLowerCase() === wt.toLowerCase(), mSetup ? mSetup[1] : '');
  checar('o setup que falha corta so o resto DELE', !/^NAO-DEVIA/m.test(tela));
  checar('e o Claude sobe depois, mesmo com o setup falhando',
    /^claude --name scripts-setup$/m.test(tela) && tela.search(/^SETUP-OK/m) < tela.search(/^claude --name/m),
    tela.slice(-400));

  const retrato = await cdp.avaliar(`JSON.stringify(window.OrqGrade.retratoSessao
    ? window.OrqGrade.retratoSessao() : [])`);
  checar('o retrato salvo nao carrega o setup', !/SETUP/.test(retrato));

  // --- 2. o run, com as portas da sessao ------------------------------------
  const run = JSON.parse(await cdp.avaliar(`JSON.stringify({ hidden: ${PN(id1)}.elRun.hidden,
    title: ${PN(id1)}.elRun.title, portas: ${PN(id1)}.portas })`));
  checar('o botao ▶ aparece no painel da sessao', run.hidden === false && run.title.includes(RUN), JSON.stringify(run));

  const idRun = await cdp.avaliar(`Promise.resolve(${PN(id1)}.abrirRun()).then((p) => p ? p.id : '')`);
  checar('o ▶ abriu outro painel', Boolean(idRun) && idRun !== id1, idRun);
  const pr = JSON.parse(await ate(() => cdp.avaliar(`JSON.stringify({ tipo: ${PN(idRun)}.tipoPainel,
    portas: ${PN(idRun)}.portas || [], botao: ${PN(idRun)}.elRun.hidden, cwd: ${PN(idRun)}.cwd })`),
  (j) => JSON.parse(j).portas.length > 0, 8000));
  checar('o painel do run e de terminal, na mesma pasta',
    pr.tipo === 'terminal' && pr.cwd.toLowerCase() === wt.toLowerCase(), JSON.stringify(pr));
  checar('o painel do run nao tem o proprio ▶', pr.botao === true);
  checar('o run herdou o bloco de portas da sessao',
    pr.portas.length === 5 && pr.portas.join() === run.portas.join(), `${pr.portas} / ${run.portas}`);
  const telaRun = await ate(() => cdp.avaliar(`${PN(idRun)}.textoDoBuffer()`),
    (t) => /^RUN-PORTA \d+/m.test(t), 10000);
  checar('e o PORT que o run enxerga e o da sessao',
    (/^RUN-PORTA (\d+)/m.exec(telaRun) || [])[1] === String(run.portas[0]), telaRun.slice(-200));

  const total = () => cdp.avaliar('window.OrqPainel.painelPorId.size');
  const antes = await total();
  const idRun2 = await cdp.avaliar(`Promise.resolve(${PN(id1)}.abrirRun()).then((p) => p ? p.id : '')`);
  checar('um segundo ▶ foca o run que ja existe', idRun2 === idRun && (await total()) === antes,
    `${idRun2} ${idRun}`);

  // --- 3. reabrir o mesmo nome reaproveita, e NAO roda o setup ---------------
  await zerarGrade(cdp);
  const id2 = await abrir();
  const tela2 = await ate(() => cdp.avaliar(`${PN(id2)}.textoDoBuffer()`),
    (t) => /^claude --name /m.test(t), 15000);
  checar('reabrir o mesmo nome abre na mesma worktree',
    (await cdp.avaliar(`${PN(id2)}.cwd`)).toLowerCase() === wt.toLowerCase());
  checar('e o setup NAO roda de novo', !/^SETUP-OK/m.test(tela2) && /^claude --name/m.test(tela2),
    tela2.slice(-300));

  // --- 4. projeto sem setup continua com claude -w ---------------------------
  await zerarGrade(cdp);
  await cdp.avaliar(`window.orq.projetosDefinirScripts(${JSON.stringify(proj.id)}, { run: ${JSON.stringify(RUN)} })
    .then(() => window.OrqProjetos.carregarProjetos())`);
  // Este caminho usa o `montarComando` LOCAL do projetos.js, que a troca acima
  // nao alcanca -- abrir de verdade subiria o Claude. O `criarPainel` e trocado
  // por um que so ANOTA o pedido, e o `worktreesCriar` por um espiao.
  const p3 = JSON.parse(await cdp.avaliar(`(async () => {
    const criar = window.OrqGrade.criarPainel;
    const wtCriar = window.orq.worktreesCriar;
    let pedido = null;
    let criouWorktree = false;
    window.OrqGrade.criarPainel = async (o) => { pedido = o; return null; };
    window.orq.worktreesCriar = (...a) => { criouWorktree = true; return wtCriar(...a); };
    try {
      document.getElementById('nome-feature').value = 'sem-setup';
      await window.OrqProjetos.abrirProjeto(${JSON.stringify(proj.id)});
    } finally {
      window.OrqGrade.criarPainel = criar;
      window.orq.worktreesCriar = wtCriar;
    }
    return JSON.stringify({ cwd: pedido && pedido.cwd, cmd: pedido && pedido.comandoInicial,
      setup: pedido && pedido.setupInicial, criouWorktree });
  })()`));
  checar('sem setup, a nova sessao continua sendo claude -w na raiz',
    / -w sem-setup$/.test(p3.cmd || '') && String(p3.cwd).toLowerCase() === raiz.toLowerCase()
      && !p3.setup && p3.criouWorktree === false, JSON.stringify(p3));

  // --- limpeza --------------------------------------------------------------
  await zerarGrade(cdp);
  await cdp.avaliar(`(() => { window.OrqProjetos.montarComando = window.__origMontar; return 'ok'; })()`);
  await cdp.avaliar(`window.orq.projetosRemover(${JSON.stringify(proj.id)}, false)
    .then(() => window.OrqProjetos.carregarProjetos())`);
  await esperar(500);
  try { git(raiz, ['worktree', 'remove', '--force', wt]); } catch { /* ok */ }
  fs.rmSync(raiz, { recursive: true, force: true });
  fs.rmSync(PASTA, { recursive: true, force: true });
  encerrar('SCRIPTS');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
