'use strict';

// As rotas /orq/* (Fase 10.6) contra o app DE VERDADE: uma coordenadora (um
// painel aberto pelo teste) chama a 47615 com o `X-Orq-Id` dela, e o worker
// nasce na grade -- worktree do commit dela, prefill no PTY, chip, contador,
// linha no mapa, `esperar` soltando com um `Stop` falso, `enviar` chegando ao
// terminal.
//
// Precisa do `npm run dev` no ar. A mecanica pura (portoes, escopo, long-poll,
// diff, a partida) fica no `teste:orquestracao`, em Node puro.
//
// NAO INVOCA O CLAUDE: o `montarComando` e trocado por `echo claude`, como no
// `teste:abrir-ui`, e o shell ecoa o que o CLI receberia. Sem Claude nao ha
// registro em `~/.claude/sessions`, entao o Enter automatico nao dispara aqui --
// ele e coberto pelo teste em Node puro e pelo `teste:orquestracao-reais`.
//
// O interruptor e ligado escrevendo o `ui.json` direto: o caminho da tela e um
// dialogo nativo, que o CDP nao dirige.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const TMP = path.join(os.tmpdir(), `orq-teste-orq-ui-${Date.now()}`);
const REPO = path.join(TMP, 'repo');
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function pedir(caminho, o = {}) {
  return new Promise((ok) => {
    const headers = { ...(o.id ? { 'x-orq-id': o.id } : {}), ...(o.headers || {}) };
    if (o.json !== undefined) headers['content-type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port: 47615, path: caminho, method: o.metodo || 'GET', headers }, (res) => {
      let c = '';
      res.on('data', (d) => { c += d; });
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(c); } catch { /* nao-json */ }
        ok({ status: res.statusCode, j, cru: c.trim() });
      });
    });
    req.setTimeout(100_000, () => { req.destroy(); ok({ status: 0, j: {}, cru: 'TIMEOUT' }); });
    req.on('error', (e) => ok({ status: 0, j: {}, cru: `ERRO ${e.message}` }));
    if (o.json !== undefined) req.write(JSON.stringify(o.json));
    else if (o.corpo) req.write(o.corpo);
    req.end();
  });
}

(async () => {
  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  // ------------------------------------------------------------ o palco

  fs.mkdirSync(REPO, { recursive: true });
  git(REPO, ['init', '-q', '-b', 'main']);
  git(REPO, ['config', 'user.email', 't@t']);
  git(REPO, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(REPO, 'a.txt'), 'um\n');
  git(REPO, ['add', '-A']);
  git(REPO, ['commit', '-q', '-m', 'base']);
  const sha = git(REPO, ['rev-parse', 'HEAD']).trim();

  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.orq.projetosAdicionar(${JSON.stringify(REPO)});
    await window.OrqProjetos.carregarProjetos();
  })()`);

  const constantes = JSON.parse(await cdp.avaliar('window.orq.constantes().then((c) => JSON.stringify(c))'));
  const arqUi = path.join(constantes.pastaDados, 'ui.json');
  const uiAntes = fs.existsSync(arqUi) ? fs.readFileSync(arqUi, 'utf8') : null;
  const gravarUi = (orquestracao) => {
    const atual = uiAntes ? JSON.parse(uiAntes) : { versao: 1, ui: {} };
    atual.ui = { ...(atual.ui || {}), orquestracao };
    fs.writeFileSync(arqUi, `${JSON.stringify(atual, null, 2)}\n`);
  };

  await cdp.avaliar(`(() => {
    window.__origMontar = window.OrqProjetos.montarComando;
    window.OrqProjetos.montarComando = () => 'echo claude';
    window.__origPrefill = window.orq.claudePrefill;
    window.orq.claudePrefill = () => Promise.resolve(true);
    return 'ok';
  })()`);

  // A coordenadora: um painel de sessao comum na raiz do repositorio.
  const coord = await cdp.avaliar(`window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(REPO)}, feature: 'coord' }).then((p) => p.id)`);
  await esperar(1500);

  // ------------------------------------------------------------ os portoes

  gravarUi('desligada');
  let r = await pedir('/orq/status', { id: coord });
  checar('desligada: 503', r.status === 503 && r.j.erro === 'orquestracao-desligada', r.cru);
  gravarUi('ligada');
  r = await pedir('/orq/status', { id: coord, headers: { origin: 'https://flow.pronixhub.com.br' } });
  checar('com Origin, mesmo a do Flow: 403', r.status === 403 && r.j.erro === 'origem-proibida', r.cru);
  r = await pedir('/orq/status', { id: coord });
  checar('a coordenadora comeca sem workers', r.status === 200 && r.j.workers.length === 0, r.cru);

  // ------------------------------------------------------------ criar

  const PROMPT = 'Implemente a parte A.\nUse o contrato do a.txt.';
  r = await pedir('/orq/criar', { metodo: 'POST', id: coord, json: { nome: 'Parte A', prompt: PROMPT } });
  checar('criar: 201', r.status === 201 && r.j.worker && r.j.worker.branch === 'worktree-Parte-A', r.cru);
  checar('a resposta nao carrega caminho de disco', !/[A-Za-z]:\\\\/.test(r.cru), r.cru);
  const wid = r.j.worker && r.j.worker.id;

  const info = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(wid || '')});
    if (!p) return '{}';
    return JSON.stringify({ cwd: p.cwd, feature: p.feature, pai: p.pai, chip: p.elPai.textContent, oculto: p.elPai.hidden, branch: p.branch });
  })()`));
  const wt = path.join(REPO, '.claude', 'worktrees', 'Parte-A');
  checar('o painel do worker nasceu na worktree', info.cwd && path.resolve(info.cwd).toLowerCase() === wt.toLowerCase(), info.cwd);
  checar('e sabe quem e a coordenadora', info.pai === coord, String(info.pai));
  checar('o chip diz de onde veio', info.chip === '↳ coord' && info.oculto === false, String(info.chip));
  checar('o branch nasceu do commit da coordenadora', fs.existsSync(wt) && git(wt, ['rev-parse', 'HEAD']).trim() === sha);

  let tela = '';
  for (let i = 0; i < 40 && !tela.includes('--prefill-b64'); i++) {
    tela = await cdp.avaliar(`(() => { const p = window.OrqPainel.painelPorId.get(${JSON.stringify(wid || '')}); return p ? window.OrqPainel.achatar(p.textoDoBuffer()) : ''; })()`);
    if (!tela.includes('--prefill-b64')) await esperar(500);
  }
  const m = tela.match(/--prefill-b64 ([A-Za-z0-9_-]+)/);
  checar('o prompt foi para o PTY pelo --prefill-b64', Boolean(m), tela.slice(-200));
  if (m) {
    const texto = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    checar('e e o prompt da coordenadora, com as quebras', texto === PROMPT, JSON.stringify(texto));
  }

  const cartao = await cdp.avaliar(`document.querySelector('.card[data-id="${coord}"] .card-filhos')?.textContent || ''`);
  checar('o card da coordenadora conta o worker', cartao === '1 worker', JSON.stringify(cartao));

  await cdp.avaliar(`window.OrqMapa.definirModo('mapa')`);
  await esperar(600);
  const linha = await cdp.avaliar(`document.querySelectorAll('.mapa-linha-pai[data-de="${coord}"][data-para="${wid}"]').length`);
  checar('o mapa liga a coordenadora ao worker', linha === 1, String(linha));
  await cdp.avaliar(`window.OrqMapa.definirModo('grade')`);

  r = await pedir('/orq/criar', { metodo: 'POST', id: wid, json: { nome: 'neto', prompt: 'x' } });
  checar('o worker nao cria worker: 403', r.status === 403 && r.j.erro === 'profundidade', r.cru);

  // ------------------------------------------------------------ esperar

  const espera = pedir(`/orq/esperar?id=${wid}&timeout=30`, { id: coord });
  await esperar(500);
  await pedir('/evento/Stop', { metodo: 'POST', headers: { 'x-orq-id': wid }, corpo: JSON.stringify({ cwd: wt }) });
  r = await espera;
  checar('o Stop do worker solta o esperar', r.status === 200 && r.j.expirou === false && r.j.worker.status === 'terminou', r.cru);

  // ------------------------------------------------------------ enviar

  r = await pedir('/orq/enviar', { metodo: 'POST', id: coord, json: { id: wid, texto: 'echo MARCA-ORQ-ENVIO' } });
  checar('enviar: 200', r.status === 200, r.cru);
  let viu = false;
  for (let i = 0; i < 20 && !viu; i++) {
    const t = await cdp.avaliar(`window.OrqPainel.achatar(window.OrqPainel.painelPorId.get(${JSON.stringify(wid)}).textoDoBuffer())`);
    // O eco do `echo` sai numa linha so com a marca: prova que o Enter foi junto.
    viu = /(^|\s)MARCA-ORQ-ENVIO(\s|$)/.test(t.replace(/echo MARCA-ORQ-ENVIO/g, ''));
    if (!viu) await esperar(400);
  }
  checar('o texto chegou ao terminal do worker, com o Enter', viu);

  await pedir('/evento/Notification/permissao', {
    metodo: 'POST', headers: { 'x-orq-id': wid }, corpo: JSON.stringify({ cwd: wt, message: 'Claude needs your permission' }),
  });
  await esperar(300);
  r = await pedir('/orq/enviar', { metodo: 'POST', id: coord, json: { id: wid, texto: '1' } });
  checar('em esperando, enviar e recusado', r.status === 409 && r.j.erro === 'esperando', r.cru);

  // ------------------------------------------------------------ a coordenadora fecha

  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(coord)}).destruir()`);
  await esperar(500);
  const orfao = await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(wid)})?.elPai.textContent || ''`);
  checar('fechar a coordenadora nao fecha o worker, e o chip diz isso', orfao === '↳ sessão fechada', JSON.stringify(orfao));

  // ------------------------------------------------------------ faxina

  await cdp.avaliar(`(async () => {
    window.OrqProjetos.montarComando = window.__origMontar;
    window.orq.claudePrefill = window.__origPrefill;
    for (const p of [...window.OrqPainel.painelPorId.values()]) p.destruir();
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos();
  })()`);
  await esperar(1500);
  if (uiAntes === null) fs.rmSync(arqUi, { force: true });
  else fs.writeFileSync(arqUi, uiAntes);
  try { git(REPO, ['worktree', 'remove', '--force', wt]); } catch { /* segue */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* pasta presa no Windows */ }

  encerrar('ORQUESTRACAO_UI');
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
