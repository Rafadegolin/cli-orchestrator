'use strict';

// O pedido do Pronix Flow chegando no app DE VERDADE: HTTP na 47615, painel
// nascendo na worktree certa, e o mesmo pedido duas vezes abrindo UM painel so.
//
// Precisa do `npm run dev` no ar. A mecanica pura (parse, resolucao, allowlist,
// branch) fica no `teste:abrir`, que roda em Node puro.
//
// NAO INVOCA O CLAUDE. O `montarComando` e trocado por `echo claude` pelo CDP,
// de fora, antes do pedido: assim o `comPrefill` ainda insere as flags de
// verdade (ele so exige a palavra `claude` no comando) e o shell ecoa o que
// receberia -- o que deixa PROVAR que o prompt chegou ao PTY, em vez de supor,
// e sem gastar token nenhum.

const fs = require('fs');
const http = require('http');
const path = require('path');

const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
const FLOW = 'https://flow.pronixhub.com.br';
const BRANCH = 'feature/TESTE-4242';
const SLUG = 'feature-TESTE-4242';
const WT = path.join(RAIZ, '.claude', 'worktrees', SLUG);

function pedir(caminho, o = {}) {
  return new Promise((ok) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 47615,
      path: caminho,
      method: o.metodo || 'GET',
      headers: o.headers || {},
    }, (res) => {
      let c = '';
      res.on('data', (d) => { c += d; });
      res.on('end', () => ok({ status: res.statusCode, h: res.headers, corpo: c.trim() }));
    });
    req.setTimeout(15000, () => { req.destroy(); ok({ status: 0, h: {}, corpo: 'TIMEOUT' }); });
    req.on('error', (e) => ok({ status: 0, h: {}, corpo: `ERRO ${e.message}` }));
    if (o.corpo) req.write(o.corpo);
    req.end();
  });
}

const abrir = (carga) => pedir('/abrir', {
  metodo: 'POST',
  headers: { origin: FLOW, 'content-type': 'application/json' },
  corpo: JSON.stringify(carga),
});

(async () => {
  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  // Estado FIXADO no comeco, e nao so limpo no fim: suite que herda lixo da
  // anterior nao esta testando, esta torcendo.
  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos();
  })()`);
  fs.rmSync(WT, { recursive: true, force: true });

  const proj = JSON.parse(await cdp.avaliar(
    `window.orq.projetosAdicionar(${JSON.stringify(RAIZ)}).then((r) => JSON.stringify(r.projeto))`,
  ));
  checar('o proprio repo entrou no cadastro com remotes',
    Array.isArray(proj.remotes) && proj.remotes.length > 0, JSON.stringify(proj.remotes));

  const repo = proj.remotes[0];
  await cdp.avaliar('window.OrqProjetos.carregarProjetos()');

  // Troca o comando por um `echo` inofensivo, e finge que o CLI aceita a flag.
  await cdp.avaliar(`(() => {
    window.__origMontar = window.OrqProjetos.montarComando;
    window.OrqProjetos.montarComando = () => 'echo claude';
    window.__origPrefill = window.orq.claudePrefill;
    window.orq.claudePrefill = () => Promise.resolve(true);
    window.__toasts = [];
    const m = window.OrqToast.mostrar;
    window.OrqToast.mostrar = (t) => { window.__toasts.push(String(t)); return m(t); };
    return 'ok';
  })()`);

  // ------------------------------------------------------------- o pedido

  const carga = {
    repo,
    branch: BRANCH,
    issue: 'TESTE-4242',
    title: 'Pedido de teste do orquestrador',
    url: 'https://flow.pronixhub.com.br/teams/t/issues/i',
  };

  const r1 = await abrir(carga);
  checar('/abrir aceita o pedido do Flow', r1.status === 200, `${r1.status} ${r1.corpo}`);
  const c1 = JSON.parse(r1.corpo || '{}');
  checar('a resposta diz o branch criado', c1.branch === BRANCH, r1.corpo);
  checar('a resposta NAO carrega caminho de disco',
    !r1.corpo.includes('\\\\') && !/[A-Za-z]:/.test(r1.corpo), r1.corpo);

  // O painel pode nascer depois da resposta: o /abrir responde o VEREDITO, e nao
  // espera o painel existir.
  let paineis = 0;
  for (let i = 0; i < 60 && paineis === 0; i++) {
    paineis = Number(await cdp.avaliar(
      `[...window.OrqPainel.painelPorId.values()].filter((p) => (p.cwd || '').toLowerCase().includes('${SLUG.toLowerCase()}')).length`,
    ));
    if (!paineis) await esperar(500);
  }
  checar('o painel nasceu na worktree', paineis === 1, `paineis=${paineis}`);

  const info = JSON.parse(await cdp.avaliar(`(() => {
    const p = [...window.OrqPainel.painelPorId.values()]
      .find((x) => (x.cwd || '').toLowerCase().includes('${SLUG.toLowerCase()}'));
    if (!p) return JSON.stringify({});
    return JSON.stringify({
      feature: p.feature,
      branch: p.branch,
      issue: p.issue,
      chip: p.elIssue ? p.elIssue.textContent : null,
      chipEscondido: p.elIssue ? p.elIssue.hidden : null,
      comando: p.comandoInicial,
    });
  })()`));

  checar('o git concorda com o branch pedido',
    fs.existsSync(WT) && fs.readFileSync(path.join(RAIZ, '.git', 'worktrees', SLUG, 'HEAD'), 'utf8').trim()
      === `ref: refs/heads/${BRANCH}`,
    fs.existsSync(WT) ? 'worktree existe' : 'worktree NAO existe');

  checar('a feature e o slug (e o que o --name usa)', info.feature === SLUG, info.feature);
  checar('o painel guarda o branch REAL', info.branch === BRANCH, info.branch);
  checar('a issue ficou no painel', info.issue && info.issue.identificador === 'TESTE-4242', JSON.stringify(info.issue));
  checar('o chip mostra o identificador', info.chip === 'TESTE-4242', String(info.chip));
  checar('o chip esta visivel', info.chipEscondido === false, String(info.chipEscondido));

  // O prompt chegou ao PTY, e chegou DIGITADO -- via --prefill-b64, sem Enter.
  //
  // Em laco com intervalo, e nunca numa leitura unica: o comando so e escrito no
  // PRIMEIRO byte de volta do PTY (`aoPrimeiroDado`) e ainda passa pela fila de
  // partida, e o `term.write` do xterm e assincrono -- o que o flush entregou so
  // aparece no passo seguinte do parser.
  let tela = '';
  for (let i = 0; i < 60 && !tela.includes('--prefill-b64'); i++) {
    tela = await cdp.avaliar(`(() => {
      const p = [...window.OrqPainel.painelPorId.values()]
        .find((x) => (x.cwd || '').toLowerCase().includes('${SLUG.toLowerCase()}'));
      return p ? window.OrqPainel.achatar(p.textoDoBuffer()) : '';
    })()`);
    if (!tela.includes('--prefill-b64')) await esperar(500);
  }

  const m = tela.match(/--prefill-b64 ([A-Za-z0-9_-]+)/);
  checar('o comando levou --prefill-b64', Boolean(m), tela.slice(-200));
  if (m) {
    const texto = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    checar('o prompt carrega a issue', texto.includes('TESTE-4242'), texto);
    checar('o prompt carrega o titulo', texto.includes('Pedido de teste do orquestrador'), texto);
    checar('o prompt carrega o link de volta', texto.includes('flow.pronixhub.com.br'), texto);
  }
  checar('o comando levou --deep-link-origin', tela.includes('--deep-link-origin'), tela.slice(-200));

  // ------------------------------------------------ o teto da linha do cmd
  //
  // MEDIDO no painel: acima de ~8191 caracteres o cmd.exe descarta a linha
  // INTEIRA, sem erro nenhum -- e ali o `claude` nem chegaria a subir, deixando
  // um shell parado com a bolinha verde para sempre. A guarda tem de preferir
  // abrir sem contexto a mandar uma linha que sera jogada fora.
  const limites = JSON.parse(await cdp.avaliar(`(() => {
    const base = 'cls && claude --name feature-TESTE-4242';
    const curto = 'x'.repeat(500);
    const enorme = 'x'.repeat(window.OrqProjetos.MAX_PROMPT);
    return JSON.stringify({
      cabeCurto: window.OrqProjetos.prefillCabe(base, curto),
      cabeEnorme: window.OrqProjetos.prefillCabe(base, enorme),
      linhaCurta: window.OrqProjetos.comPrefill(base, curto).length,
      linhaEnorme: window.OrqProjetos.comPrefill(base, enorme).length,
      base: base.length,
      teto: window.OrqProjetos.MAX_LINHA,
    });
  })()`));

  checar('prompt normal cabe na linha', limites.cabeCurto === true, JSON.stringify(limites));
  checar('a linha montada fica abaixo do teto',
    limites.linhaCurta > limites.base && limites.linhaCurta <= limites.teto, String(limites.linhaCurta));
  // 5000 caracteres viram ~6700 de base64, e ainda cabem; o que nao pode e a
  // guarda deixar passar linha maior que o teto.
  checar('nada passa do teto, nem no pior caso',
    limites.linhaEnorme <= limites.teto, `${limites.linhaEnorme} > ${limites.teto}`);
  checar('quando nao cabe, o comando volta SEM prefill',
    limites.cabeEnorme === (limites.linhaEnorme > limites.base), JSON.stringify(limites));

  // ------------------------------------------- o MESMO pedido, de novo
  //
  // Este e o caminho NORMAL do Flow, e nao uma borda: com o app fechado ele
  // dispara o deeplink e, ~3s depois, manda o POST do mesmo pedido.

  const r2 = await abrir(carga);
  checar('o pedido repetido tambem e 200', r2.status === 200, `${r2.status} ${r2.corpo}`);
  await esperar(2500);
  const depois = Number(await cdp.avaliar(
    `[...window.OrqPainel.painelPorId.values()].filter((p) => (p.cwd || '').toLowerCase().includes('${SLUG.toLowerCase()}')).length`,
  ));
  checar('o pedido repetido NAO abriu um segundo painel', depois === 1, `paineis=${depois}`);

  // ------------------------------------------------------------- recusas

  const r3 = await abrir({ ...carga, repo: 'acme/nao-cadastrado' });
  checar('repo desconhecido -> 404 (o Flow copia a branch)', r3.status === 404, `${r3.status} ${r3.corpo}`);
  await esperar(600);
  const toasts = JSON.parse(await cdp.avaliar('JSON.stringify(window.__toasts || [])'));
  checar('e o app nomeia o repo na tela',
    toasts.some((t) => t.includes('acme/nao-cadastrado')), JSON.stringify(toasts));

  const r4 = await pedir('/abrir', {
    metodo: 'POST',
    headers: { origin: 'https://evil.com', 'content-type': 'application/json' },
    corpo: JSON.stringify(carga),
  });
  checar('origem de fora -> 403', r4.status === 403, `${r4.status} ${r4.corpo}`);

  const r5 = await pedir('/abrir', {
    metodo: 'OPTIONS',
    headers: { origin: FLOW, 'access-control-request-private-network': 'true' },
  });
  checar('preflight libera o Flow', r5.status === 204, String(r5.status));
  checar('preflight libera rede privada', r5.h['access-control-allow-private-network'] === 'true');
  checar('preflight ecoa a origem', r5.h['access-control-allow-origin'] === FLOW);

  const r6 = await pedir('/ping', { headers: { origin: FLOW } });
  checar('/ping do app real responde', r6.status === 200, r6.corpo);
  checar('/ping diz a versao do app', /"version":"\d+\.\d+/.test(r6.corpo), r6.corpo);

  // -------------------------------------------------------------- faxina

  await cdp.avaliar(`(() => {
    window.OrqProjetos.montarComando = window.__origMontar;
    window.orq.claudePrefill = window.__origPrefill;
    for (const p of [...window.OrqPainel.painelPorId.values()]) p.destruir();
    return 'ok';
  })()`);
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

  encerrar('ABRIR_UI');
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
