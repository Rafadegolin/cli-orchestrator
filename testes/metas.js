'use strict';
// As metas da secao 2 que precisam de medida dedicada: latencia de tecla e
// CPU sob carga.
//
// ARMADILHA DE MEDICAO, nao do app: com a janela fora do primeiro plano o
// Chromium limita setTimeout/rAF a ~1/s, e toda latencia abaixo de 1s passa a
// ler exatamente ~1000ms. Por isso a ida e volta e medida por EVENTO
// (onWriteParsed) e nao por polling.

const path = require('path');
const { execSync } = require('child_process');
const { conectar, esperar, zerarGrade } = require('./cdp');
const RAIZ = path.resolve(__dirname, '..').replace(/\\/g, '/');

function medir(seg = 0) {
  return JSON.parse(execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${__dirname}\\medir.ps1" -SegundosCpu ${seg}`,
    { encoding: 'utf8', timeout: (seg + 90) * 1000 }
  ).trim());
}

(async () => {
  const cdp = await conectar();
  await cdp.enviar('Page.enable').catch(() => {});
  await cdp.enviar('Page.bringToFront').catch(() => {});
  await cdp.avaliar(`window.orq.focarJanela()`);
  await esperar(1200);

  await zerarGrade(cdp);
  await cdp.avaliar(`(async () => { window.__p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'metas' }); return 'ok'; })()`);
  await esperar(2500);

  // Confere o clamp AQUI, e nao so no inicio: a janela pode ter perdido o
  // primeiro plano no meio do caminho, e ai o callback do term.write() cai num
  // rAF limitado e a medida vira ~1000ms sem nenhum aviso.
  const clamp = await cdp.avaliar(`(async () => {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 2));
    return (performance.now() - t0) / 5;
  })()`);
  if (clamp > 100) {
    console.log(`\nCusto proprio do app: INDETERMINADO -- janela em segundo plano (setTimeout(2) = ${clamp.toFixed(0)}ms).`);
    console.log('Traga a janela para frente e rode de novo; a ida e volta abaixo e medida por evento e continua valida.\n');
  }

  const render = JSON.parse(await cdp.avaliar(`(async () => {
    const p = window.__p;
    const dados = new TextEncoder().encode('x'.repeat(1500) + '\\r\\n');
    const a = [];
    for (let n = 0; n < 40; n++) {
      const t0 = performance.now();
      await new Promise(ok => p.term.write(dados, ok));
      a.push(performance.now() - t0);
    }
    a.sort((x, y) => x - y);
    return JSON.stringify({ mediana: a[20], p95: a[37], max: a[39] });
  })()`));
  console.log(`Custo proprio do app (write -> processado, 1,5 KB): mediana ${render.mediana.toFixed(2)}ms  p95 ${render.p95.toFixed(2)}ms`);

  const lat = JSON.parse(await cdp.avaliar(`(async () => {
    const p = window.__p;
    const a = [];
    for (let n = 0; n < 15; n++) {
      const marca = 'K' + n + 'Z' + Math.floor(performance.now());
      const medida = await new Promise((ok) => {
        let pronto = false;
        const t0 = performance.now();
        const d = p.term.onWriteParsed(() => {
          if (pronto) return;
          const b = p.term.buffer.active;
          for (let i = Math.max(0, b.length - 20); i < b.length; i++) {
            if (b.getLine(i)?.translateToString(true).includes(marca)) {
              pronto = true; d.dispose(); ok(performance.now() - t0); return;
            }
          }
        });
        setTimeout(() => { if (!pronto) { pronto = true; d.dispose(); ok(-1); } }, 4000);
        window.orq.escrever(p.id, 'echo ' + marca + '\\r');
      });
      if (medida > 0) a.push(medida);
      await new Promise(r => requestAnimationFrame(r));
    }
    a.sort((x, y) => x - y);
    return JSON.stringify({ n: a.length, mediana: a[Math.floor(a.length / 2)], min: a[0], max: a[a.length - 1] });
  })()`));
  console.log(`Ida e volta tecla -> PTY -> tela: mediana ${lat.mediana?.toFixed(1)}ms (min ${lat.min?.toFixed(1)} / max ${lat.max?.toFixed(1)}, n=${lat.n})`);
  console.log('  inclui o cmd.exe processar o echo: terminal nao faz eco local, entao o piso e a ida e volta pelo shell');

  // CPU com 4 painéis cuspindo log.
  await zerarGrade(cdp);
  for (let i = 1; i <= 4; i++) {
    await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ)}, feature: 'carga-${i}' }); return 'ok'; })()`);
    await esperar(400);
  }
  await esperar(2000);
  await cdp.avaliar(`(() => { for (const p of window.OrqGrade.painelPorId.values())
    window.orq.escrever(p.id, 'for /L %i in (1,1,900000) do @echo CARGA_%i\\r'); return 'ok'; })()`);
  await esperar(4000);

  console.log('\nmedindo CPU sob carga por 60s (4 painéis cuspindo log)...');
  const carga = medir(60);
  console.log(`CPU com 4 painéis cuspindo log: ${carga.cpuPct}%  (meta < 25%, ${carga.nucleos} nucleos)`);
  console.log(`RAM nesse momento: ${carga.ramMb} MB`);

  // Interrompe a carga para nao deixar shells girando depois do teste.
  await cdp.avaliar(`(() => { for (const p of window.OrqGrade.painelPorId.values()) window.orq.escrever(p.id, '\\u0003'); return 'ok'; })()`);
  await esperar(1500);
  await zerarGrade(cdp);

  process.exit(0);
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
