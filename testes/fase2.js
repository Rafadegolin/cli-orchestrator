'use strict';
// Fase 2: N painéis na grade, colunas, orcamento de WebGL, fechar mata o PTY,
// RAM e CPU dentro das metas.

const path = require('path');
const { execSync } = require('child_process');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');
const RAIZ = path.resolve(__dirname, '..').replace(/\\/g, '/');

// Base fixa do Electron nesta maquina, medida com 0 painéis. Nao cresce com o
// numero de painéis, entao a metrica que diz se o app esta gordo e o custo
// MARGINAL -- total/N carrega a base junto e nunca fecha com poucos painéis.
const BASE_MB = 283;

function medir(seg = 0) {
  return JSON.parse(execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${__dirname}\\medir.ps1" -SegundosCpu ${seg}`,
    { encoding: 'utf8', timeout: (seg + 90) * 1000 }
  ).trim());
}

function contaCmd() {
  return Number(execSync(
    'powershell -NoProfile -Command "(Get-Process cmd -ErrorAction SilentlyContinue | Measure-Object).Count"',
    { encoding: 'utf8' }
  ).trim()) || 0;
}

(async () => {
  const cdp = await conectar();
  await zerarGrade(cdp);

  const cmdAntes = contaCmd();

  for (let i = 1; i <= 8; i++) {
    await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ)}, feature: 'feat-${i}' }); return 'ok'; })()`);
    await esperar(400);
  }
  await esperar(2500);

  const est = JSON.parse(await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()];
    return JSON.stringify({
      n: ps.length,
      colunas: getComputedStyle(document.getElementById('grade')).gridTemplateColumns.split(' ').length,
      renders: ps.map(p => p.tipoRender),
      rodando: ps.filter(p => p.status === 'rodando').length,
      scrollback: ps[0].term.options.scrollback,
    });
  })()`));

  checar('8 painéis abertos', est.n === 8, String(est.n));
  checar('todos com PTY rodando', est.rodando === 8, `${est.rodando}/8`);
  checar('grade em 3 colunas acima de 4 painéis', est.colunas === 3, String(est.colunas));
  checar('scrollback limitado a 3000', est.scrollback === 3000, String(est.scrollback));
  checar('8 painéis cabem no orcamento de WebGL',
    est.renders.filter((r) => r === 'webgl').length === 8, est.renders.join(','));

  const cmdDepois = contaCmd();
  checar('8 processos de shell nasceram', cmdDepois - cmdAntes >= 8, `${cmdAntes} -> ${cmdDepois}`);

  const m = medir(60);
  checar('a medicao achou os processos do app', m.processos > 0 && m.ramMb > 0, JSON.stringify(m));
  checar('RAM total abaixo de 700 MB', m.ramMb < 700, `${m.ramMb} MB em ${m.processos} processos`);
  checar('RAM marginal por painel abaixo de 40 MB', (m.ramMb - BASE_MB) / 8 < 40,
    `${((m.ramMb - BASE_MB) / 8).toFixed(1)} MB/painel  (crua: ${(m.ramMb / 8).toFixed(1)})`);
  checar('CPU parado abaixo de 2%', m.cpuPct >= 0 && m.cpuPct < 2, `${m.cpuPct}% de ${m.nucleos} nucleos`);

  // O 9o painel nao pode estourar o teto de contextos WebGL.
  await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'feat-9' }); return 'ok'; })()`);
  await esperar(1500);
  const nono = JSON.parse(await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()];
    return JSON.stringify(ps.reduce((a, p) => (a[p.tipoRender] = (a[p.tipoRender] || 0) + 1, a), {}));
  })()`));
  checar('9o painel cai para canvas', nono.webgl === 8 && nono.canvas === 1, JSON.stringify(nono));

  await cdp.avaliar(`(() => { const ps = [...window.OrqGrade.painelPorId.values()]; ps[0].destruir(); ps[1].destruir(); return 'ok'; })()`);
  await esperar(2500);
  checar('fechar painel matou o processo', contaCmd() <= cmdDepois - 1, `${cmdDepois + 1} -> ${contaCmd()}`);

  const apos = JSON.parse(await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()];
    return JSON.stringify({ n: ps.length, webgl: ps.filter(p => p.tipoRender === 'webgl').length });
  })()`));
  checar('vaga de WebGL foi reaproveitada apos fechar', apos.n === 7 && apos.webgl === 7, JSON.stringify(apos));

  encerrar('FASE2');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
