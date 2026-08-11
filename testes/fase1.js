'use strict';
// Fase 1: um painel, digitacao vai ao PTY, bytes voltam a tela, resize reflui,
// enxurrada nao derruba nada.

const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');
const RAIZ = path.resolve(__dirname, '..').replace(/\\/g, '/');

(async () => {
  const cdp = await conectar();

  const globais = await cdp.avaliar(`JSON.stringify({
    term: typeof window.Terminal,
    fit: typeof window.FitAddon?.FitAddon,
    webgl: typeof window.WebglAddon?.WebglAddon,
    canvas: typeof window.CanvasAddon?.CanvasAddon,
    ponte: typeof window.orq?.abrirTerminal,
    grade: typeof window.OrqGrade?.criarPainel,
  })`);
  checar('globais do xterm e da ponte carregaram',
    Object.values(JSON.parse(globais)).every((v) => v === 'function'), globais);

  const vazou = await cdp.avaliar(`JSON.stringify({
    require: typeof window.require, process: typeof window.process, module: typeof window.module })`);
  checar('nao ha Node vazando na janela',
    vazou === '{"require":"undefined","process":"undefined","module":"undefined"}', vazou);

  await zerarGrade(cdp);
  await cdp.avaliar(`(async () => { window.__p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'fase1' }); return 'ok'; })()`);
  await esperar(2000);

  const info = JSON.parse(await cdp.avaliar(`(() => { const p = window.__p;
    return JSON.stringify({ id: p.id, cols: p.term.cols, rows: p.term.rows, render: p.tipoRender, status: p.status }); })()`));
  checar('painel abriu com PTY', info.status === 'rodando', JSON.stringify(info));
  checar('fit calculou cols/rows plausiveis', info.cols > 20 && info.rows > 5, `${info.cols}x${info.rows}`);
  checar('primeiro painel usa WebGL', info.render === 'webgl', info.render);

  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(info.id)}, 'echo ORQ_ECO_1\\r')`);
  await esperar(2000);
  const buffer = await cdp.avaliar(`(() => { const b = window.__p.term.buffer.active; let t = '';
    for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\\n'; return t; })()`);
  checar('saida do PTY chegou na tela', buffer.includes('ORQ_ECO_1'),
    buffer.split('\n').filter(Boolean).slice(-1)[0]);

  // Resize: mexe na COLUNA DO GRID do pai -- mudar a largura da aside sozinha
  // nao altera o tamanho do painel.
  // O reflow passa por ResizeObserver, que so e entregue com a janela em
  // primeiro plano -- em segundo plano o Chromium pausa a renderizacao inteira.
  await aoFrente(cdp);

  // Engorda a LATERAL: com a casca em flex, ela e quem tira largura da area de
  // painéis. (Antes isto mexia no grid-template-columns do #app, que nao existe
  // mais desde que a janela virou flex coluna.)
  const antes = await cdp.avaliar(`window.__p.term.cols`);
  await cdp.avaliar(`document.getElementById('lateral').style.flexBasis = '560px'`);

  // Espera pela condicao em vez de dormir um tanto fixo: o reflow passa por
  // ResizeObserver mais debounce de 100ms, e tempo fixo aqui vira teste
  // intermitente.
  let depois = antes;
  for (let i = 0; i < 40 && depois >= antes; i++) {
    await esperar(150);
    depois = await cdp.avaliar(`window.__p.term.cols`);
  }
  checar('resize refluiu o terminal', depois < antes && depois > 10, `${antes} -> ${depois}`);
  await cdp.avaliar(`document.getElementById('lateral').style.flexBasis = ''`);
  await esperar(600);

  await cdp.avaliar(`window.orq.escrever(window.__p.id, 'for /L %i in (1,1,4000) do @echo LINHA_%i\\r')`);
  await esperar(8000);
  const vivo = JSON.parse(await cdp.avaliar(`(() => { const b = window.__p.term.buffer.active;
    let ultima = ''; for (let i = b.length - 1; i >= 0 && !ultima; i--) ultima = b.getLine(i).translateToString(true).trim();
    return JSON.stringify({ linhas: b.length, ultima }); })()`));
  checar('sobreviveu a enxurrada dentro do scrollback', vivo.linhas <= 3100, JSON.stringify(vivo));

  encerrar('FASE1');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
