'use strict';
// A casca da nova UI: tokens, tema, densidade e as regras de compressao.
//
// Depende de LAYOUT, entao usa aoFrente() -- o Chromium pausa os passos de
// renderizacao com a janela em segundo plano e nada aqui mediria certo.

const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..').replace(/\\/g, '/');

// Larguras de referencia do doc 03: desenho, confortavel, minimo validado.
const LARGURAS = [1440, 1100, 924];

async function estreitar(cdp, largura) {
  await cdp.enviar('Emulation.setDeviceMetricsOverride', {
    width: largura, height: 900, deviceScaleFactor: 0, mobile: false,
  });
  await esperar(700);
}

async function soltar(cdp) {
  await cdp.enviar('Emulation.clearDeviceMetricsOverride');
  await esperar(700);
}

(async () => {
  const cdp = await conectar();
  const frente = await aoFrente(cdp);
  checar('a janela esta em primeiro plano (layout depende disso)', frente, '');

  await zerarGrade(cdp);

  checar('a casca carregou', await cdp.avaliar('typeof window.OrqCasca?.mudar') === 'function');

  // --- 1. fontes vem do disco, nao de fallback --------------------------
  //
  // Sem isto o app cai em system-ui/Consolas e ninguem percebe olhando: a tela
  // fica "quase certa" e a tipografia, que e metade do desenho, se perde.
  const fontes = JSON.parse(await cdp.avaliar(`(async () => {
    await document.fonts.ready;
    return JSON.stringify({
      grotesk: document.fonts.check('12px "Space Grotesk"'),
      mono: document.fonts.check('12px "JetBrains Mono"'),
      corpo: getComputedStyle(document.body).fontFamily,
      remota: [...document.styleSheets].some(f => (f.href || '').startsWith('http')),
    });
  })()`));
  checar('Space Grotesk carregou do disco', fontes.grotesk, fontes.corpo);
  checar('JetBrains Mono carregou do disco', fontes.mono, '');
  checar('nenhuma folha de estilo vem da internet', fontes.remota === false, '');

  // --- 2. barra de titulo -------------------------------------------------
  const titulo = JSON.parse(await cdp.avaliar(`(() => {
    const t = document.getElementById('titulo');
    const r = t.getBoundingClientRect();
    return JSON.stringify({
      altura: Math.round(r.height),
      topo: Math.round(r.top),
      // Espaco reservado para os tres botoes que o Windows desenha por cima.
      reserva: parseFloat(getComputedStyle(t).paddingRight),
      arrasta: getComputedStyle(t).webkitAppRegion,
    });
  })()`));
  checar('a barra de titulo tem 38px no topo', titulo.altura === 38 && titulo.topo === 0,
    JSON.stringify(titulo));
  checar('e reserva a area dos botoes de janela', titulo.reserva > 40, `${titulo.reserva}px`);

  // --- 3. tema ------------------------------------------------------------
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'claro' })`);
  await esperar(400);
  const claro = JSON.parse(await cdp.avaliar(`JSON.stringify({
    classe: document.documentElement.className,
    bg1: getComputedStyle(document.documentElement).getPropertyValue('--bg1').trim(),
    lateral: getComputedStyle(document.getElementById('lateral')).backgroundColor,
  })`));
  checar('tema claro pinta as superficies de claro',
    claro.classe === 'claro' && claro.bg1 === '#ffffff' && claro.lateral === 'rgb(255, 255, 255)',
    JSON.stringify(claro));

  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro' })`);
  await esperar(400);
  checar('e volta para o escuro',
    await cdp.avaliar(`document.documentElement.className`) === '', '');

  // Persistencia: o valor tem de estar no disco, nao so na memoria da janela.
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'claro', densidade: 3, ordem: 'projeto' })`);
  await esperar(500);
  const salvo = JSON.parse(await cdp.avaliar(
    `(async () => JSON.stringify(await window.orq.uiCarregar()))()`));
  checar('tema, densidade e ordenacao foram para o disco',
    salvo.tema === 'claro' && salvo.densidade === 3 && salvo.ordem === 'projeto',
    JSON.stringify(salvo));

  // --- 4. densidade -------------------------------------------------------
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro', densidade: 2, ordem: 'urgencia' })`);
  await esperar(400);

  await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'ui-auth-refresh' }); return 'ok'; })()`);
  await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'ui-dois' }); return 'ok'; })()`);
  await esperar(2500);

  const esperado = { 1: 460, 2: 320, 3: 268 };
  for (const d of [1, 2, 3]) {
    await cdp.avaliar(`window.OrqCasca.mudar({ densidade: ${d} })`);
    await esperar(500);
    const r = JSON.parse(await cdp.avaliar(`(() => {
      const app = document.getElementById('app');
      const est = getComputedStyle(app);
      const painel = document.querySelector('.painel');
      const st = painel.querySelector('.painel-status');
      const grade = getComputedStyle(document.getElementById('grade'));
      return JSON.stringify({
        cols: est.getPropertyValue('--cols').trim(),
        colunasReais: grade.gridTemplateColumns.split(' ').length,
        altura: Math.round(painel.getBoundingClientRect().height),
        rotuloVisivel: getComputedStyle(st).display !== 'none',
        ativa: document.querySelector('#densidade button.ativa')?.dataset.cols,
      });
    })()`));
    checar(`densidade ${d}: ${d} coluna(s) de ${esperado[d]}px`,
      r.cols === String(d) && r.colunasReais === d && r.altura === esperado[d], JSON.stringify(r));
    checar(`densidade ${d}: o botao correspondente fica marcado`, r.ativa === String(d), r.ativa);
    // Na densidade 3 o espaco vale mais que a redundancia; nas outras, cor
    // nunca pode ser o unico portador de significado.
    checar(`densidade ${d}: rotulo de status ${d === 3 ? 'oculto' : 'visivel'}`,
      r.rotuloVisivel === (d !== 3), String(r.rotuloVisivel));
  }

  // Tecla so vale fora de campo de texto: digitar "3" no nome da feature nao
  // pode reorganizar a grade.
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 2 })`);
  await esperar(300);
  await cdp.avaliar(`(() => { document.getElementById('nome-feature').focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true })); return 'ok'; })()`);
  await esperar(300);
  checar('digito com foco num campo de texto e ignorado',
    await cdp.avaliar(`window.OrqCasca.densidade()`) === 2, '');

  await cdp.avaliar(`(() => { document.getElementById('nome-feature').blur(); document.body.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true })); return 'ok'; })()`);
  await esperar(400);
  checar('e fora dele muda a densidade',
    await cdp.avaliar(`window.OrqCasca.densidade()`) === 3, '');

  // --- 5. o terminal fica escuro nos DOIS temas ---------------------------
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'claro', densidade: 2 })`);
  await esperar(500);
  const term = JSON.parse(await cdp.avaliar(`(() => {
    const p = [...window.OrqGrade.painelPorId.values()][0];
    return JSON.stringify({ fundo: p.term.options.theme.background, frente: p.term.options.theme.foreground });
  })()`));
  checar('com o tema claro, o terminal continua escuro',
    term.fundo === '#0b0e12' && term.frente === '#c8d3e0', JSON.stringify(term));
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro' })`);
  await esperar(400);

  // --- 6. placar ----------------------------------------------------------
  const placar = JSON.parse(await cdp.avaliar(`JSON.stringify({
    segmentos: document.getElementById('placar-carga').childElementCount,
    cpu: document.getElementById('placar-cpu').textContent,
    vivas: document.getElementById('placar-num').textContent,
  })`));
  checar('a barra de carga tem 14 segmentos', placar.segmentos === 14, String(placar.segmentos));
  checar('o placar mostra CPU', /^cpu \d+%$/.test(placar.cpu), placar.cpu);
  checar('e conta as sessoes vivas', placar.vivas === '2', placar.vivas);

  // --- 7. compressao: nenhum scroll horizontal, fechar sempre alcancavel ---
  for (const largura of LARGURAS) {
    await estreitar(cdp, largura);
    const r = JSON.parse(await cdp.avaliar(`(() => {
      const painel = document.querySelector('.painel');
      const nome = painel.querySelector('.painel-feature');
      const fechar = painel.querySelector('.painel-fechar');
      const cx = fechar.getBoundingClientRect();
      const emCima = document.elementFromPoint(cx.left + cx.width / 2, cx.top + cx.height / 2);
      return JSON.stringify({
        scrollDoc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollBarra: (() => { const b = document.getElementById('barra'); return b.scrollWidth - b.clientWidth; })(),
        scrollCab: (() => { const c = painel.querySelector('.painel-cab'); return c.scrollWidth - c.clientWidth; })(),
        nomeInteiro: nome.scrollWidth <= nome.clientWidth + 1 && nome.getBoundingClientRect().width > 0,
        fecharClicavel: fechar.contains(emCima) || emCima === fechar,
      });
    })()`));
    checar(`${largura}px: nenhum scroll horizontal`,
      r.scrollDoc <= 0 && r.scrollBarra <= 0 && r.scrollCab <= 0, JSON.stringify(r));
    checar(`${largura}px: o nome da sessao aparece por inteiro`, r.nomeInteiro, '');
    checar(`${largura}px: o botao fechar continua clicavel`, r.fecharClicavel, '');
  }
  await soltar(cdp);

  // --- 8. nome absurdo: degrada, nao estoura -----------------------------
  //
  // "O nome nunca encolhe" e "as acoes sao inegociaveis" nao cabem as duas num
  // painel de 306px se a feature tiver 40 caracteres. A escolha aqui e
  // explicita: o nome ganha reticencias e o botao de fechar sobrevive.
  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 3 })`);
  await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'ui-nome-absurdamente-longo-de-feature-que-ninguem-escreveria' });
    return 'ok'; })()`);
  await esperar(2000);
  await estreitar(cdp, 924);

  const absurdo = JSON.parse(await cdp.avaliar(`(() => {
    const painel = document.querySelector('.painel');
    const cab = painel.querySelector('.painel-cab');
    const nome = painel.querySelector('.painel-feature');
    const fechar = painel.querySelector('.painel-fechar');
    const cx = fechar.getBoundingClientRect();
    const emCima = document.elementFromPoint(cx.left + cx.width / 2, cx.top + cx.height / 2);
    return JSON.stringify({
      estouro: cab.scrollWidth - cab.clientWidth,
      truncou: nome.scrollWidth > nome.clientWidth,
      sobrouNome: Math.round(nome.getBoundingClientRect().width),
      fecharClicavel: fechar.contains(emCima) || emCima === fechar,
    });
  })()`));
  checar('nome absurdo nao estoura o cabecalho', absurdo.estouro <= 0, JSON.stringify(absurdo));
  checar('ele trunca com reticencias em vez de empurrar as acoes', absurdo.truncou, '');
  checar('e ainda sobra nome legivel', absurdo.sobrouNome > 60, `${absurdo.sobrouNome}px`);
  checar('com o botao de fechar alcancavel', absurdo.fecharClicavel, '');
  await soltar(cdp);

  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro', densidade: 2, ordem: 'urgencia' })`);

  encerrar('UI');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
