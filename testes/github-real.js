'use strict';
// O spike do 10.3, guardado como teste: fala com a API do GitHub DE VERDADE e
// le a credencial do git desta maquina. Nao gasta token do Claude.
//
// Prova o que o `teste:branch` so pode supor com `fetch` falso:
//  - `git credential fill` com o Git Credential Manager proibido de perguntar
//    responde rapido e NAO abre janela (nem para um host sem credencial);
//  - as duas rotas devolvem o formato que o `github.js` le.
//
// O token nunca e impresso -- so se existe e quanto tempo levou.

const { execFile } = require('child_process');
const github = require('../src/main/github');
const { checar, encerrar } = require('./cdp');

function fillPara(host) {
  return new Promise((ok) => {
    const t0 = Date.now();
    const p = execFile('git', ['credential', 'fill'], {
      encoding: 'utf8', windowsHide: true, timeout: 8000,
      env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
    }, (err) => ok({ ms: Date.now() - t0, falhou: Boolean(err), morto: Boolean(err && err.killed) }));
    p.stdin.end(`protocol=https\nhost=${host}\n\n`);
  });
}

(async () => {
  const t0 = Date.now();
  const token = await github.credencial();
  const msCred = Date.now() - t0;
  console.log(`credencial do github.com: ${token ? 'existe' : 'nao existe'} (${msCred}ms)`);
  checar('git credential fill responde em menos de 5s', msCred < 5000, `${msCred}ms`);

  const sem = await fillPara('nao-existe.exemplo.invalid');
  checar('host sem credencial falha rapido, sem esperar janela nenhuma', sem.falhou && !sem.morto && sem.ms < 5000,
    JSON.stringify(sem));

  // Um PR ja mesclado deste proprio repositorio: o formato e o que importa.
  const t1 = Date.now();
  const c = await github.consultar({ dono: 'Rafadegolin', repo: 'cli-orchestrator', branch: 'feature/TECH-1222', sha: '' });
  console.log(`consulta: ${Date.now() - t1}ms`, JSON.stringify(c));
  checar('a API respondeu (repositorio publico)', c.acesso === true, JSON.stringify(c));
  checar('o PR mesclado volta como mesclado, com numero e url',
    c.pr && c.pr.estado === 'mesclado' && Number.isInteger(c.pr.numero) && /^https:\/\/github\.com\//.test(c.pr.url),
    JSON.stringify(c.pr));
  checar('o token nao aparece no resultado', !token || !JSON.stringify(c).includes(token));

  const sha = await fetch('https://api.github.com/repos/Rafadegolin/cli-orchestrator/commits/main',
    { headers: { 'User-Agent': 'orquestrador', Accept: 'application/vnd.github+json' } })
    .then((r) => r.json()).then((j) => j.sha).catch(() => '');
  const c2 = await github.consultar({ dono: 'Rafadegolin', repo: 'cli-orchestrator', branch: 'main', sha });
  checar('check-runs responde no formato lido', c2.acesso === true && c2.ci && Number.isInteger(c2.ci.total),
    JSON.stringify(c2.ci));

  encerrar('GITHUB_REAL');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
