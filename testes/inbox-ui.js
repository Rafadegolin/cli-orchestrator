'use strict';

// A inbox do Pronix Flow no app DE VERDADE (Fase 10.4): conectar com token,
// recusar o token errado sem guardar nada, listar, filtrar, e abrir a issue
// pelo MESMO caminho do /abrir -- painel na worktree, branch literal, descricao
// no --prefill-b64.
//
// Precisa do `npm run dev` no ar (que usa a pasta de dados `.dev-udata/dados`,
// entao a conexao real com o Flow nao e tocada). O "Flow" e um servidor falso
// em 127.0.0.1: loopback e o unico http que o app aceita.
//
// NAO INVOCA O CLAUDE: o `montarComando` e trocado por `echo claude`, como no
// `teste:abrir-ui`.

const fs = require('fs');
const http = require('http');
const path = require('path');

const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');
const pedido = require('../src/main/pedido');

const RAIZ = path.resolve(__dirname, '..');
const DADOS = path.join(RAIZ, '.dev-udata', 'dados');
const TOKEN = `pfx_${'k'.repeat(43)}`;
const ERRADO = `pfx_${'e'.repeat(43)}`;
const BRANCH = 'feature/INBOX-77';
const SLUG = 'feature-INBOX-77';
const WT = path.join(RAIZ, '.claude', 'worktrees', SLUG);
const DESCRICAO = 'Corpo da issue.\n\nCom dois parágrafos.';

let repo = '';
let aceitar = TOKEN;
let pedidosAoFlow = 0;

const servidor = http.createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/api/orquestrador/issues') {
    res.writeHead(404).end();
    return;
  }
  pedidosAoFlow += 1;
  if (req.headers.authorization !== `Bearer ${aceitar}`) {
    res.writeHead(401, { 'content-type': 'application/json' }).end('{"statusCode":401}');
    return;
  }
  const issue = (over) => ({
    repo,
    branch: BRANCH,
    title: 'Issue da inbox',
    url: 'https://flow.pronixhub.com.br/teams/t/issues/x',
    description: '',
    state: { name: 'A fazer', type: 'UNSTARTED' },
    priority: 'NONE',
    team: { key: 'INBOX', name: 'Inbox' },
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  });
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
    user: { name: 'Pessoa de Teste', email: 'teste@x.com' },
    issues: [
      issue({ id: 'ok', issue: 'INBOX-77', description: DESCRICAO, state: { name: 'Em progresso', type: 'STARTED' } }),
      issue({ id: 'sem-repo', issue: 'INBOX-78', repo: null, branch: 'feature/INBOX-78' }),
      issue({ id: 'outro', issue: 'INBOX-79', repo: 'acme/nao-cadastrado', branch: 'feature/INBOX-79' }),
    ],
  }));
});

const linhas = (cdp) => cdp.avaliar(`JSON.stringify([...document.querySelectorAll('#inbox-lista .inbox-linha')].map((li) => ({
  id: li.dataset.id,
  abrir: !li.querySelector('.inbox-acoes .primario').disabled,
  meta: li.querySelector('.inbox-meta').textContent,
})))`).then(JSON.parse);

async function esperarAte(cdp, expr, vezes = 40) {
  for (let i = 0; i < vezes; i++) {
    if (await cdp.avaliar(`Boolean(${expr})`)) return true;
    await esperar(250);
  }
  return false;
}

const painelDaWt = `[...window.OrqPainel.painelPorId.values()].filter((p) => (p.cwd || '').toLowerCase().includes('${SLUG.toLowerCase()}'))`;

(async () => {
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const BASE = `http://127.0.0.1:${servidor.address().port}`;

  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  // Estado FIXADO no comeco.
  await cdp.avaliar(`(async () => {
    await window.orq.flowDesconectar();
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos();
    window.OrqInbox.fechar();
  })()`);
  fs.rmSync(WT, { recursive: true, force: true });

  const proj = JSON.parse(await cdp.avaliar(
    `window.orq.projetosAdicionar(${JSON.stringify(RAIZ)}).then((r) => JSON.stringify(r.projeto))`,
  ));
  repo = pedido.normalizarRepo(proj.remotes[0]);
  checar('o proprio repo entrou no cadastro', Boolean(repo), JSON.stringify(proj.remotes));
  await cdp.avaliar('window.OrqProjetos.carregarProjetos()');

  await cdp.avaliar(`(() => {
    window.__origMontar = window.OrqProjetos.montarComando;
    window.OrqProjetos.montarComando = () => 'echo claude';
    window.__origPrefill = window.orq.claudePrefill;
    window.orq.claudePrefill = () => Promise.resolve(true);
    return 'ok';
  })()`);

  // ------------------------------------------------------------ conectar

  await cdp.avaliar(`document.getElementById('btn-inbox').click()`);
  checar('desconectado, a inbox abre no formulario',
    await esperarAte(cdp, `document.getElementById('inbox-token')`));
  checar('o formulario ja traz a origem de producao',
    (await cdp.avaliar(`document.getElementById('inbox-base').value`)) === 'https://flow.pronixhub.com.br');

  const tentar = (token) => cdp.avaliar(`(() => {
    document.getElementById('inbox-base').value = ${JSON.stringify(BASE)};
    document.getElementById('inbox-token').value = ${JSON.stringify(token)};
    document.getElementById('inbox-conectar').click();
    return 'ok';
  })()`);

  await tentar(ERRADO);
  checar('token recusado pelo Flow vira mensagem no formulario',
    await esperarAte(cdp, `!document.getElementById('inbox-erro').hidden`));
  checar('e a mensagem diz que o Flow recusou',
    /recusou/.test(await cdp.avaliar(`document.getElementById('inbox-erro').textContent`)));
  checar('token recusado NAO chega ao disco', !fs.existsSync(path.join(DADOS, 'flow.json')));
  checar('o campo do token foi limpo', (await cdp.avaliar(`document.getElementById('inbox-token').value`)) === '');

  await tentar(TOKEN);
  checar('com o token certo, a lista aparece', await esperarAte(cdp, `document.querySelectorAll('#inbox-lista .inbox-linha').length === 3`));

  const guardado = fs.existsSync(path.join(DADOS, 'flow.json')) ? fs.readFileSync(path.join(DADOS, 'flow.json'), 'utf8') : '';
  checar('a credencial foi guardada', Boolean(guardado));
  checar('e CIFRADA: o token nao aparece no arquivo', guardado && !guardado.includes(TOKEN));
  checar('o token nao ficou em lugar nenhum do DOM',
    !(await cdp.avaliar(`document.body.innerHTML.includes(${JSON.stringify(TOKEN)})`)));
  checar('a situacao diz conectado, sem o token',
    await cdp.avaliar(`window.orq.flowSituacao().then((s) => s.conectado && !JSON.stringify(s).includes(${JSON.stringify(TOKEN)}))`));
  checar('a lista mostra quem esta conectado',
    (await cdp.avaliar(`document.querySelector('.inbox-quem').textContent`)).includes('Pessoa de Teste'));

  // ------------------------------------------------------------ a lista

  const l = await linhas(cdp);
  const porId = Object.fromEntries(l.map((x) => [x.id, x]));
  checar('em progresso vem primeiro (a ordem do Flow)', l[0].id === 'ok', JSON.stringify(l.map((x) => x.id)));
  checar('issue com repo cadastrado pode abrir', porId.ok.abrir, JSON.stringify(porId.ok));
  checar('e diz em que projeto abre', porId.ok.meta.includes(`→ ${proj.nome}`), porId.ok.meta);
  checar('issue sem repo nao abre', !porId['sem-repo'].abrir);
  checar('e diz por que', /não tem repositório/.test(porId['sem-repo'].meta), porId['sem-repo'].meta);
  checar('repo nao cadastrado nao abre', !porId.outro.abrir);
  checar('e diz por que', /não cadastrado/.test(porId.outro.meta), porId.outro.meta);

  await cdp.avaliar(`(() => { const s = document.getElementById('inbox-projeto'); s.value = '__sem'; s.dispatchEvent(new Event('change')); })()`);
  checar('filtrar "sem projeto" deixa as duas que nao abrem',
    JSON.stringify((await linhas(cdp)).map((x) => x.id)) === '["sem-repo","outro"]');
  await cdp.avaliar(`(() => {
    const s = document.getElementById('inbox-projeto'); s.value = '__todos'; s.dispatchEvent(new Event('change'));
    const b = document.getElementById('inbox-busca'); b.value = 'inbox-79'; b.dispatchEvent(new Event('input'));
  })()`);
  checar('a busca casa pelo identificador, sem caixa',
    JSON.stringify((await linhas(cdp)).map((x) => x.id)) === '["outro"]');
  await cdp.avaliar(`(() => { const b = document.getElementById('inbox-busca'); b.value = ''; b.dispatchEvent(new Event('input')); })()`);

  // --------------------------------------- abrir, pelo caminho do /abrir
  //
  // Com o interruptor `externo` DESLIGADO: ele fecha o deeplink e o HTTP, que
  // vem de fora, e nao pode quebrar um botao da tela.
  await cdp.avaliar(`window.orq.uiSalvar({ externo: 'desligado' })`);

  const antes = pedidosAoFlow;
  await cdp.avaliar(`document.querySelector('#inbox-lista .inbox-linha[data-id="ok"] .primario').click()`);
  checar('abrir fecha a inbox', await esperarAte(cdp, `document.getElementById('inbox').hidden`));
  checar('abrir nao consulta o Flow de novo (usa a lista lida)', pedidosAoFlow === antes);

  checar('o painel nasceu na worktree, mesmo com o externo desligado',
    await esperarAte(cdp, `${painelDaWt}.length === 1`, 120));
  const info = JSON.parse(await cdp.avaliar(`(() => {
    const p = ${painelDaWt}[0];
    return JSON.stringify(p ? { feature: p.feature, branch: p.branch, issue: p.issue } : {});
  })()`));
  checar('o painel guarda o branch literal', info.branch === BRANCH, info.branch);
  checar('a feature e o slug', info.feature === SLUG, info.feature);
  checar('a issue ficou no painel', info.issue && info.issue.identificador === 'INBOX-77', JSON.stringify(info.issue));
  checar('o git concorda com o branch',
    fs.existsSync(WT) && fs.readFileSync(path.join(RAIZ, '.git', 'worktrees', SLUG, 'HEAD'), 'utf8').trim()
      === `ref: refs/heads/${BRANCH}`);

  let tela = '';
  for (let i = 0; i < 60 && !tela.includes('--prefill-b64'); i++) {
    tela = await cdp.avaliar(`(() => { const p = ${painelDaWt}[0]; return p ? window.OrqPainel.achatar(p.textoDoBuffer()) : ''; })()`);
    if (!tela.includes('--prefill-b64')) await esperar(500);
  }
  const m = tela.match(/--prefill-b64 ([A-Za-z0-9_-]+)/);
  checar('o comando levou --prefill-b64', Boolean(m), tela.slice(-200));
  if (m) {
    const texto = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    checar('o prompt e a descricao da issue, com os paragrafos', texto === DESCRICAO, JSON.stringify(texto));
  }

  // De novo: o painel ja existe, entao nao nasce um segundo.
  await cdp.avaliar(`window.OrqInbox.abrir()`);
  await esperarAte(cdp, `document.querySelector('#inbox-lista .inbox-linha[data-id="ok"] .primario')`);
  await cdp.avaliar(`document.querySelector('#inbox-lista .inbox-linha[data-id="ok"] .primario').click()`);
  await esperar(2500);
  checar('abrir de novo NAO cria um segundo painel',
    Number(await cdp.avaliar(`${painelDaWt}.length`)) === 1);
  await cdp.avaliar(`window.orq.uiSalvar({ externo: 'ligado' })`);

  // --------------------------------------------- token revogado no Flow

  aceitar = 'pfx_outro';
  await cdp.avaliar(`window.OrqInbox.abrir()`);
  checar('token revogado leva de volta ao formulario',
    await esperarAte(cdp, `document.getElementById('inbox-token') && !document.getElementById('inbox-erro').hidden`));
  checar('dizendo que pode ter sido revogado',
    /revogado/.test(await cdp.avaliar(`document.getElementById('inbox-erro').textContent`)));

  // -------------------------------------------------------------- faxina

  await cdp.avaliar(`(async () => {
    window.OrqInbox.fechar();
    await window.orq.flowDesconectar();
    window.OrqProjetos.montarComando = window.__origMontar;
    window.orq.claudePrefill = window.__origPrefill;
    for (const p of [...window.OrqPainel.painelPorId.values()]) p.destruir();
  })()`);
  checar('desconectar apaga a credencial', !fs.existsSync(path.join(DADOS, 'flow.json')));
  await esperar(1200);

  const arq = JSON.parse(await cdp.avaliar(
    `window.orq.worktreesArquivar(${JSON.stringify(RAIZ)}, ${JSON.stringify(WT)}, false).then((r) => JSON.stringify(r))`,
  ));
  checar('a worktree do teste foi arquivada', arq.ok === true, JSON.stringify(arq));

  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos();
  })()`);
  fs.rmSync(WT, { recursive: true, force: true });
  servidor.close();

  encerrar('INBOX_UI');
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
