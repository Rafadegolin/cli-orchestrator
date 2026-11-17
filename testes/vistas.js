'use strict';
// Vistas (redesign R4): trocar da grade para uma pagina e voltar.
//
// Prova as tres coisas que decidem se esconder a grade e seguro:
// - o PTY NAO muda de tamanho enquanto a grade esta escondida (o ResizeObserver
//   dispara com largura 0, e o `ajustar()` tem de pular -- senao a TUI do Claude
//   redesenharia em 1 coluna);
// - a saida que chega com a pagina aberta nao se perde: aparece ao voltar;
// - Esc numa pagina volta para as sessoes, e focar um painel tambem.

const os = require('os');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');
const { eco } = require('./comandos');

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

(async () => {
  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 2, lateral: 'aberta' })`);

  // Uma pagina de teste, registrada pelo mesmo caminho das paginas reais.
  await cdp.avaliar(`(() => {
    if (!window.OrqVistas.tem('teste')) {
      const el = document.createElement('section');
      el.id = 'pagina-teste';
      el.textContent = 'pagina de teste';
      window.OrqVistas.registrar('teste', { el, titulo: 'Teste' });
    }
    window.OrqVistas.ir('sessoes');
    return 'ok';
  })()`);

  const id = await cdp.avaliar(`(async () => {
    const p = await window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(os.homedir())}, feature: 'vistas-a' });
    return p.id;
  })()`);
  const P = `window.OrqPainel.painelPorId.get(${JSON.stringify(id)})`;
  await ate(() => cdp.avaliar(`${P}.textoDoBuffer().length`), (n) => n > 20, 8000);
  await esperar(800);

  const antes = JSON.parse(await cdp.avaliar(`JSON.stringify({ cols: ${P}.term.cols, rows: ${P}.term.rows })`));
  checar('o painel nasceu com tamanho de verdade', antes.cols > 20 && antes.rows > 5, JSON.stringify(antes));

  await cdp.avaliar(`window.OrqVistas.ir('teste')`);
  await esperar(900);
  const naPagina = JSON.parse(await cdp.avaliar(`JSON.stringify({
    vista: document.getElementById('app').dataset.vista,
    gradeVisivel: getComputedStyle(document.getElementById('grade')).display !== 'none',
    paginaVisivel: !document.getElementById('pagina-teste').hidden,
    titulo: document.getElementById('barra-vista').textContent,
    cols: ${P}.term.cols, rows: ${P}.term.rows,
    vivo: window.OrqPainel.painelPorId.has(${JSON.stringify(id)}),
  })`));
  checar('a pagina aparece e a grade some', naPagina.paginaVisivel && !naPagina.gradeVisivel, JSON.stringify(naPagina));
  checar('o titulo da barra diz a vista', naPagina.titulo === 'Teste', naPagina.titulo);
  checar('o painel continua vivo (nao foi recriado nem destruido)', naPagina.vivo, '');
  checar('e o terminal NAO mudou de tamanho com a grade escondida',
    naPagina.cols === antes.cols && naPagina.rows === antes.rows, JSON.stringify({ antes, naPagina }));

  // Saida chegando com a pagina aberta.
  const MARCA = `VISTAS_${Date.now()}`;
  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(id)}, ${JSON.stringify(`${eco(MARCA)}\r`)})`);
  await esperar(1200);

  // Esc volta para as sessoes.
  await cdp.avaliar(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await esperar(600);
  checar('Esc na pagina volta para as sessoes',
    await cdp.avaliar(`window.OrqVistas.atual()`) === 'sessoes', '');

  const voltou = await ate(() => cdp.avaliar(`${P}.textoDoBuffer()`), (t) => t.includes(MARCA), 6000);
  checar('a saida que chegou com a pagina aberta aparece ao voltar', voltou.includes(MARCA), '');
  const depois = JSON.parse(await cdp.avaliar(`JSON.stringify({ cols: ${P}.term.cols, rows: ${P}.term.rows })`));
  checar('e o tamanho continua o mesmo', depois.cols === antes.cols && depois.rows === antes.rows,
    JSON.stringify({ antes, depois }));

  // Focar um painel a partir de uma pagina leva de volta a grade.
  await cdp.avaliar(`window.OrqVistas.ir('teste')`);
  await esperar(300);
  await cdp.avaliar(`window.OrqGrade.focarPainel(${JSON.stringify(id)})`);
  await esperar(300);
  checar('focar uma sessao a partir de uma pagina volta para a grade',
    await cdp.avaliar(`window.OrqVistas.atual()`) === 'sessoes', '');

  await zerarGrade(cdp);
  encerrar('VISTAS');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
