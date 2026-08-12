'use strict';
// A casca da nova UI: tokens, tema, densidade e as regras de compressao.
//
// Depende de LAYOUT, entao usa aoFrente() -- o Chromium pausa os passos de
// renderizacao com a janela em segundo plano e nada aqui mediria certo.

const fs = require('fs');
const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..').replace(/\\/g, '/');
const JANELA = path.join(__dirname, '..', 'src', 'janela');

// Os scripts da janela sao CLASSICOS e dividem UM escopo lexico global. Declarar
// o mesmo nome de topo em dois deles nao estoura: a ultima avaliacao vence em
// silencio, e o outro arquivo passa a chamar a funcao errada.
//
// Ja aconteceu duas vezes -- `remover` (fila/lateral) e `projetoDe`
// (lateral/projetos, que quebrou a ordenacao por projeto sem nenhuma mensagem).
// Este teste le a FONTE e fecha a classe inteira, em vez de consertar o caso.
function declaracoesDuplicadas() {
  const porNome = new Map();
  const arquivos = fs.readdirSync(JANELA)
    .filter((f) => f.endsWith('.js'))
    // casca.js vive inteiro dentro de uma IIFE: nao publica nome nenhum.
    .filter((f) => !/^\s*\(\(\) => \{/m.test(fs.readFileSync(path.join(JANELA, f), 'utf8')));

  for (const arquivo of arquivos) {
    const fonte = fs.readFileSync(path.join(JANELA, arquivo), 'utf8');
    for (const linha of fonte.split('\n')) {
      const m = /^(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/.exec(linha);
      if (!m) continue;
      if (!porNome.has(m[1])) porNome.set(m[1], []);
      if (!porNome.get(m[1]).includes(arquivo)) porNome.get(m[1]).push(arquivo);
    }
  }

  return [...porNome.entries()]
    .filter(([, onde]) => onde.length > 1)
    .map(([nome, onde]) => `${nome} (${onde.join(', ')})`);
}

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

// Arrasta a alca de redimensionar com eventos de mouse DE VERDADE.
//
// Chamar `definirTamanho()` ou `definirCelula()` prova o efeito, nao o gesto --
// e o gesto e a feature inteira. Vai em passos, como um arrasto real: um salto
// unico esconderia erro no calculo do delta.
async function arrastarAlca(cdp, id, dx, dy) {
  const mouse = (type, x, y) => cdp.enviar('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
  });

  const p = JSON.parse(await cdp.avaliar(`(() => {
    const el = window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).el;
    const a = el.querySelector('.painel-alca').getBoundingClientRect();
    return JSON.stringify({ x: a.x + a.width / 2, y: a.y + a.height / 2 });
  })()`));

  await mouse('mousePressed', p.x, p.y);
  for (let i = 1; i <= 4; i += 1) {
    await mouse('mouseMoved', p.x + (dx * i) / 4, p.y + (dy * i) / 4);
    await esperar(40);
  }
  await mouse('mouseReleased', p.x + dx, p.y + dy);
  await esperar(500);
}

(async () => {
  const cdp = await conectar();
  const frente = await aoFrente(cdp);
  checar('a janela esta em primeiro plano (layout depende disso)', frente, '');

  await zerarGrade(cdp);

  // Estado conhecido ANTES de comecar, e nao so ao terminar: a suite roda depois
  // de outras (e de qualquer coisa que voce tenha clicado na tela), e quase tudo
  // aqui pressupoe a grade. Com o app deixado no mapa, `style.order` nao tem
  // efeito visual e meia duzia de checagens falha por motivo nenhum.
  await cdp.avaliar(`window.OrqMapa?.definirModo('grade')`);
  await cdp.avaliar(`window.OrqMapa?.definirVisao(false)`);
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro', densidade: 2, ordem: 'urgencia' })`);
  await esperar(500);

  checar('a casca carregou', await cdp.avaliar('typeof window.OrqCasca?.mudar') === 'function');

  // --- 0. escopo global compartilhado, sem nome repetido -----------------
  const duplicadas = declaracoesDuplicadas();
  checar('nenhum nome de topo declarado em dois scripts da janela',
    duplicadas.length === 0, duplicadas.join(' · '));

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

  // --- 2b. a marca e a MESMA do icone do app ------------------------------
  //
  // Ela era um quadrado verde com um furo, herdado do prototipo, enquanto o
  // icone do app e a grade de quatro painéis com as bolinhas de status. Duas
  // marcas diferentes para o mesmo programa.
  const marca = JSON.parse(await cdp.avaliar(`(() => {
    const svg = document.querySelector('.marca-icone');
    const vazio = document.querySelector('.vazio-marca');
    const cores = (el) => [...(el?.querySelectorAll('circle') || [])]
      .map(c => c.getAttribute('fill').toLowerCase());
    return JSON.stringify({
      ehSvg: svg?.tagName.toLowerCase(),
      paineis: svg?.querySelectorAll('rect[rx]').length,
      bolinhas: cores(svg),
      vazioIgual: JSON.stringify(cores(vazio)) === JSON.stringify(cores(svg)),
    });
  })()`));
  checar('a marca do cabecalho e um svg', marca.ehSvg === 'svg', marca.ehSvg);
  // Quatro painéis (mais o fundo) e as quatro bolinhas de status, na ordem do
  // icone: esperando, rodando, terminou, dormindo.
  checar('ela desenha os quatro painéis do icone', marca.paineis === 5, String(marca.paineis));
  checar('com as quatro cores de status',
    JSON.stringify(marca.bolinhas) === JSON.stringify(['#ffb454', '#3ddc97', '#7aa2f7', '#7d8690']),
    JSON.stringify(marca.bolinhas));
  checar('e a marca da tela vazia e a mesma', marca.vazioIgual, '');

  // --- 2c. o atalho recusa fora de app empacotado ------------------------
  //
  // Aqui o executavel e o electron.exe do node_modules: um atalho para ele
  // abriria a tela padrao do Electron, e nao este app.
  const semAtalho = JSON.parse(await cdp.avaliar(
    '(async () => JSON.stringify(await window.orq.atalhoCriar()))()'));
  checar('em desenvolvimento, criar atalho recusa com motivo',
    !!semAtalho.erro && !semAtalho.ok, JSON.stringify(semAtalho));

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

  // --- 4b. o slot personalizado -------------------------------------------
  // A quarta pilula nao e "mais uma contagem de colunas": ela troca a altura
  // fixa por span de LINHAS, que e o unico jeito de um painel ser maior que o
  // vizinho sem sair do alinhamento da grade.
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 'p', personalizado: {
    cols: 3, alturaLinha: 160, celulas: [{ c: 1, r: 2 }, { c: 1, r: 1 }] } })`);
  await esperar(600);

  const custom = JSON.parse(await cdp.avaliar(`(() => {
    const grade = getComputedStyle(document.getElementById('grade'));
    const ordenados = window.OrqPersonalizado.naOrdemDaTela();
    return JSON.stringify({
      colunasReais: grade.gridTemplateColumns.split(' ').length,
      linha: grade.gridAutoRows,
      spans: ordenados.map((p) => p.el.style.gridRow),
      alturas: ordenados.map((p) => Math.round(p.el.getBoundingClientRect().height)),
      ativa: document.querySelector('#densidade button.ativa')?.dataset.cols,
    });
  })()`));
  checar('o personalizado usa as colunas do molde', custom.colunasReais === 3,
    JSON.stringify(custom));
  checar('e a altura passa a vir da linha da grade, nao de --altura-painel',
    custom.linha === '160px', custom.linha);
  checar('o primeiro painel ocupa duas linhas e o segundo uma',
    custom.spans[0] === 'span 2' && custom.spans[1] === 'span 1', JSON.stringify(custom.spans));
  // 2 linhas de 160 mais o gap de 12 = 332. Se o span nao virasse altura de
  // verdade, os dois mediriam igual e nada na tela mudaria.
  checar('e o span vira altura de verdade na tela',
    custom.alturas[0] === 332 && custom.alturas[1] === 160, JSON.stringify(custom.alturas));
  checar('a quarta pilula fica marcada (comparacao por string, nao por Number)',
    custom.ativa === 'p', String(custom.ativa));

  // Mexer numa posicao grava o molde -- e o molde e por POSICAO, entao a chave
  // e o indice na tela e nao o id do painel.
  await cdp.avaliar(`window.OrqPersonalizado.definirCelula(1, 1, 2)`);
  await esperar(500);
  const molde = JSON.parse(await cdp.avaliar(`(async () => {
    const ui = await window.orq.uiCarregar();
    return JSON.stringify({
      celulas: ui.personalizado.celulas,
      densidade: ui.densidade,
      naTela: window.OrqPersonalizado.naOrdemDaTela().map((p) => p.el.style.gridRow),
    });
  })()`));
  checar('mexer numa posicao grava o molde no ui.json',
    molde.celulas[1] && molde.celulas[1].r === 2 && molde.densidade === 'p',
    JSON.stringify(molde));
  checar('e a tela passa a seguir o molde salvo',
    molde.naTela[1] === 'span 2', JSON.stringify(molde.naTela));

  // E o gesto: arrastar a alca no slot personalizado cresce em CELULAS, nao em
  // pixels -- e o que mantem a grade alinhada enquanto os painéis mudam de
  // tamanho.
  await cdp.avaliar(`window.OrqCasca.mudar({ personalizado: {
    cols: 3, alturaLinha: 160, celulas: [] } })`);
  await esperar(500);
  const alvoP = JSON.parse(await cdp.avaliar(
    `JSON.stringify(window.OrqPersonalizado.naOrdemDaTela().map((p) => p.id))`))[0];
  await arrastarAlca(cdp, alvoP, 300, 200);

  const arrastadoP = JSON.parse(await cdp.avaliar(`(async () => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(alvoP)});
    const ui = await window.orq.uiCarregar();
    return JSON.stringify({
      col: p.el.style.gridColumn, row: p.el.style.gridRow,
      altura: Math.round(p.el.getBoundingClientRect().height),
      salvo: ui.personalizado.celulas[0],
    });
  })()`));
  checar('arrastar a alca no personalizado cresce em celulas da grade',
    arrastadoP.col === 'span 2' && arrastadoP.row === 'span 2', JSON.stringify(arrastadoP));
  checar('e o molde vai para o ui.json na hora de soltar',
    arrastadoP.salvo && arrastadoP.salvo.c === 2 && arrastadoP.salvo.r === 2,
    JSON.stringify(arrastadoP.salvo));

  // Sair do slot tem de LIMPAR os spans: sobrando inline, a densidade 2 herdaria
  // um painel com o dobro da altura e ninguem entenderia de onde veio.
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 2 })`);
  await esperar(500);
  const limpou = JSON.parse(await cdp.avaliar(`JSON.stringify(
    [...window.OrqGrade.painelPorId.values()].map((p) => [p.el.style.gridRow, p.el.style.gridColumn]))`));
  checar('sair do personalizado limpa os spans inline',
    limpou.every(([r, c]) => !r && !c), JSON.stringify(limpou));

  // --- 4c. recolher a barra lateral ---------------------------------------
  const larguraAntes = await cdp.avaliar(
    `Math.round(document.getElementById('conteudo').getBoundingClientRect().width)`);

  await cdp.avaliar(`window.OrqCasca.mudar({ lateral: 'fechada' })`);
  await esperar(700);
  const fechada = JSON.parse(await cdp.avaliar(`(async () => {
    const ui = await window.orq.uiCarregar();
    return JSON.stringify({
      display: getComputedStyle(document.getElementById('lateral')).display,
      largura: Math.round(document.getElementById('conteudo').getBoundingClientRect().width),
      salvo: ui.lateral,
      marcado: document.getElementById('app').dataset.lateral,
      // Nada de scroll horizontal por causa da grade mais larga.
      scrollDoc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    });
  })()`));
  checar('recolher esconde a lateral e devolve o espaco para a grade',
    fechada.display === 'none' && fechada.largura > larguraAntes, JSON.stringify(fechada));
  checar('e a escolha vai para o ui.json', fechada.salvo === 'fechada', fechada.salvo);
  checar('sem criar scroll horizontal', fechada.scrollDoc === 0, String(fechada.scrollDoc));

  // O terminal tem de REFLUIR com o espaco novo -- e sem ninguem chamar fit() a
  // mao: quem entrega isso e o ResizeObserver de cada painel.
  const colsLateral = JSON.parse(await cdp.avaliar(`JSON.stringify(
    [...window.OrqGrade.painelPorId.values()].map((p) => p.term.cols))`));
  checar('os terminais refluem sozinhos com a lateral recolhida',
    colsLateral.every((c) => c > 0), JSON.stringify(colsLateral));

  // Ctrl+B com o cursor DENTRO de um terminal nao pode mandar \x02 para a
  // sessao: o ouvinte e de captura e para o evento antes do xterm.
  const antesBuffer = await cdp.avaliar(`(async () => {
    const p = [...window.OrqPainel.painelPorId.values()][0];
    p.focar();
    return (await p.textoDoBuffer()).length;
  })()`);
  await cdp.avaliar(`(() => {
    const p = [...window.OrqPainel.painelPorId.values()][0];
    p.term.textarea.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
    return 'ok';
  })()`);
  await esperar(700);
  const porTecla = JSON.parse(await cdp.avaliar(`(async () => {
    const p = [...window.OrqPainel.painelPorId.values()][0];
    return JSON.stringify({
      lateral: window.OrqCasca.lateral(),
      cresceu: (await p.textoDoBuffer()).length - ${antesBuffer},
    });
  })()`));
  checar('Ctrl+B dentro de um terminal alterna a lateral',
    porTecla.lateral === 'aberta', porTecla.lateral);
  checar('e NAO vaza caractere de controle para a sessao',
    porTecla.cresceu === 0, String(porTecla.cresceu));

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

  // --- 9. fila de atencao, rotulos e ordenacao ---------------------------
  //
  // Os status entram por OrqLateral.definirStatus (a mesma porta por onde os
  // diffs dos hooks chegam), com `desde` sintetico: esperar 12 minutos de
  // verdade nao e teste, e o caminho do hook ja e coberto pela fase45.
  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 2, ordem: 'urgencia' })`);

  const ids = {};
  for (const f of ['ui-a-espera-velha', 'ui-b-trabalha', 'ui-c-revisar', 'ui-d-espera-nova']) {
    ids[f] = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ)}, feature: ${JSON.stringify(f)} }); return p.id; })()`);
    await esperar(400);
  }
  await esperar(2000);

  const marcar = (id, status, motivo, minutos = 0) =>
    cdp.avaliar(`window.OrqLateral.definirStatus(${JSON.stringify(id)}, ${JSON.stringify(status)},
      ${JSON.stringify(motivo)}, Date.now() - ${minutos} * 60000)`);

  await marcar(ids['ui-a-espera-velha'], 'esperando', 'pedindo permissão', 12);
  await marcar(ids['ui-b-trabalha'], 'rodando', '');
  await marcar(ids['ui-c-revisar'], 'terminou', 'pronto para revisar');
  await marcar(ids['ui-d-espera-nova'], 'esperando', 'parado há 60s', 4);
  await esperar(600);

  const fila = JSON.parse(await cdp.avaliar(`(() => {
    const bloco = document.getElementById('bloco-fila');
    const itens = [...document.querySelectorAll('#fila-lista li')];
    return JSON.stringify({
      visivel: bloco.hidden === false,
      contagem: document.getElementById('fila-contagem').textContent,
      nomes: itens.map(l => l.querySelector('.fila-nome').textContent),
      tempos: itens.map(l => l.querySelector('.fila-espera').textContent),
    });
  })()`));
  checar('a fila de atencao aparece quando alguem espera', fila.visivel, JSON.stringify(fila));
  checar('com a contagem certa', fila.contagem === '2', fila.contagem);
  checar('e quem espera ha mais tempo vem primeiro',
    fila.nomes.join() === 'ui-a-espera-velha,ui-d-espera-nova', fila.nomes.join());
  checar('mostrando o tempo de cada uma',
    fila.tempos[0] === 'há 12min' && fila.tempos[1] === 'há 4min', fila.tempos.join(' / '));

  // O rotulo diz o ESTADO; o motivo do hook vai para o title. Era daqui que
  // saia o "parado ha 60s ha 4min", com o "ha" duas vezes.
  const rotulos = JSON.parse(await cdp.avaliar(`(() => {
    const de = (id) => {
      const p = window.OrqPainel.painelPorId.get(id);
      const card = document.querySelector('#lateral-lista .card[data-id="' + CSS.escape(id) + '"]');
      return {
        painel: p.elStatus.textContent,
        painelTitle: p.elStatus.title,
        card: card?.querySelector('.card-sub')?.textContent,
      };
    };
    return JSON.stringify({
      a: de(${JSON.stringify(ids['ui-a-espera-velha'])}),
      b: de(${JSON.stringify(ids['ui-b-trabalha'])}),
      c: de(${JSON.stringify(ids['ui-c-revisar'])}),
    });
  })()`));
  checar('rotulo de quem espera diz o estado e o tempo',
    rotulos.a.painel === 'esperando há 12min' && rotulos.a.card === 'esperando há 12min',
    JSON.stringify(rotulos.a));
  checar('e o motivo do hook fica no title, fora do rotulo',
    rotulos.a.painelTitle === 'pedindo permissão' && !rotulos.a.painel.includes('permissão'),
    rotulos.a.painelTitle);
  checar('rodando vira "trabalhando"', rotulos.b.painel === 'trabalhando', rotulos.b.painel);
  checar('terminou vira "pronto para revisar"',
    rotulos.c.painel === 'pronto para revisar', rotulos.c.painel);

  // Ordem: pelo style.order E pela posicao real na tela. Conferir so o `order`
  // deixaria passar um valor certo sem efeito visual nenhum.
  const naTela = () => cdp.avaliar(`(() => {
    const ps = [...document.querySelectorAll('.painel')]
      .map(el => ({
        nome: el.querySelector('.painel-feature').textContent,
        order: Number(getComputedStyle(el).order),
        y: Math.round(el.getBoundingClientRect().top),
        x: Math.round(el.getBoundingClientRect().left),
      }))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return JSON.stringify({
      porOrder: [...ps].sort((a, b) => a.order - b.order).map(p => p.nome),
      porPosicao: ps.map(p => p.nome),
    });
  })()`);

  const urgencia = JSON.parse(await naTela());
  const esperadoUrgencia = 'ui-a-espera-velha,ui-d-espera-nova,ui-c-revisar,ui-b-trabalha';
  checar('a grade ordena por urgencia', urgencia.porOrder.join() === esperadoUrgencia,
    urgencia.porOrder.join());
  checar('e a ordem do style.order e a que aparece na tela',
    urgencia.porPosicao.join() === esperadoUrgencia, urgencia.porPosicao.join());

  await cdp.avaliar(`window.OrqCasca.mudar({ ordem: 'projeto' })`);
  await esperar(600);
  const porProjeto = JSON.parse(await naTela());
  checar('alternar para Projeto reordena, ignorando a urgencia',
    porProjeto.porPosicao.join() === 'ui-a-espera-velha,ui-b-trabalha,ui-c-revisar,ui-d-espera-nova',
    porProjeto.porPosicao.join());
  await cdp.avaliar(`window.OrqCasca.mudar({ ordem: 'urgencia' })`);
  await esperar(500);

  // Clicar na fila foca o painel daquela sessao.
  await cdp.avaliar(`document.querySelector('#fila-lista li').click()`);
  await esperar(400);
  checar('clicar na fila foca a sessao certa',
    await cdp.avaliar(`window.OrqGrade.focado()`) === ids['ui-a-espera-velha'], '');

  // Painel dormindo: rotulo proprio, bolinha vazada e ultimo na ordem.
  await cdp.avaliar(`(() => { const p = window.OrqPainel.painelPorId.get(
    ${JSON.stringify(ids['ui-c-revisar'])}); p.mostrarDormindo({ aoRetomar: () => {} }); return 'ok'; })()`);
  await cdp.avaliar(`window.OrqLateral.redesenhar()`);
  await esperar(500);
  const dorme = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(ids['ui-c-revisar'])});
    const ps = [...document.querySelectorAll('.painel')]
      .map(el => ({ nome: el.querySelector('.painel-feature').textContent, order: Number(getComputedStyle(el).order) }))
      .sort((a, b) => a.order - b.order);
    return JSON.stringify({
      rotulo: p.elStatus.textContent,
      bolinha: p.elBolinha.className,
      ultimo: ps[ps.length - 1].nome,
    });
  })()`));
  checar('painel dormindo diz "sessão salva"', dorme.rotulo === 'sessão salva', dorme.rotulo);
  checar('com bolinha vazada', dorme.bolinha.includes('bolinha-dormindo'), dorme.bolinha);
  checar('e vai para o fim da ordem', dorme.ultimo === 'ui-c-revisar', dorme.ultimo);

  // Sem ninguem esperando, a fila some e o cronometro nao tem o que fazer.
  await marcar(ids['ui-a-espera-velha'], 'rodando', '');
  await marcar(ids['ui-d-espera-nova'], 'rodando', '');
  await esperar(500);
  const antesDoTique = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(ids['ui-a-espera-velha'])}).elStatus.textContent`);
  await esperar(2200);
  const depoisDoTique = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(ids['ui-a-espera-velha'])}).elStatus.textContent`);
  checar('sem fila, o bloco de atencao some',
    await cdp.avaliar(`document.getElementById('bloco-fila').hidden`) === true, '');
  checar('e o rotulo para de mudar de segundo em segundo',
    antesDoTique === depoisDoTique && antesDoTique === 'trabalhando', `${antesDoTique} -> ${depoisDoTique}`);

  // --- 10. faixa de aprovacao --------------------------------------------
  //
  // O teste que mais importa e o NEGATIVO: clicar em Aprovar sem pedido na tela
  // nao pode escrever nada no PTY. Ele nao precisa do Claude -- um cmd.exe
  // basta, porque cmd.exe nunca mostra prompt de permissao.
  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 2 })`);

  // As marcas conferidas contra o texto REAL do CLI, capturado no spike. Se o
  // Claude mudar a forma do prompt, e aqui que se descobre -- e nao com um
  // "1" aparecendo na caixa de entrada de alguem.
  const PROMPT_REAL = [
    ' Do you want to create marca.txt?',
    ' \u276f 1. Yes',
    '   2. Yes, allow all edits during this session (shift+tab)',
    '   3. No',
    ' Esc to cancel \u00b7 Tab to amend',
  ].join('\n');

  const marcas = JSON.parse(await cdp.avaliar(`(() => {
    const A = window.OrqAprovacao;
    const texto = ${JSON.stringify(PROMPT_REAL)};
    return JSON.stringify({
      opcao: A.MARCA_OPCAO.test(texto),
      pergunta: (A.MARCA_PERGUNTA.exec(texto) || [])[1] || '',
      tecla: A.TECLA_APROVAR,
      // O buffer de um cmd.exe nao pode casar com marca nenhuma.
      falsoPositivo: A.MARCA_OPCAO.test('C:\\\\Users> dir\\n 1 arquivo(s)\\n'),
    });
  })()`));
  checar('a marca casa com o prompt real do CLI',
    marcas.opcao && marcas.pergunta === 'Do you want to create marca.txt?', JSON.stringify(marcas));
  checar('e a tecla de aprovar e o digito 1, nunca Enter',
    marcas.tecla === '1', marcas.tecla);
  checar('saida comum de terminal nao vira falso positivo',
    marcas.falsoPositivo === false, String(marcas.falsoPositivo));

  const idA = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'ui-aprovacao' }); return p.id; })()`);
  await esperar(2500);

  const linhasAntes = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(idA)}).term.rows`);

  const marcarEspera = (tipo, pergunta) => cdp.avaliar(
    `window.OrqLateral.definirStatus(${JSON.stringify(idA)}, 'esperando', 'pedindo permissão',
      Date.now(), { tipo: ${JSON.stringify(tipo)}, pergunta: ${JSON.stringify(pergunta)} })`);

  await marcarEspera('permissao', 'Claude needs your permission');
  await esperar(600);

  const comPedido = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(idA)});
    return JSON.stringify({
      acesa: p.elRodape.classList.contains('tem-pedido'),
      texto: p.elRodape.querySelector('.rodape-pergunta')?.textContent || '',
      aprovar: !!p.elRodape.querySelector('.rodape-aprovar'),
      ver: !!p.elRodape.querySelector('.rodape-ver'),
      rows: p.term.rows,
    });
  })()`));
  checar('pedido de permissao acende a faixa com Aprovar e Ver',
    comPedido.acesa && comPedido.aprovar && comPedido.ver, JSON.stringify(comPedido));
  checar('mostrando a pergunta', comPedido.texto === 'Claude needs your permission', comPedido.texto);
  // A prova de que o espaco e reservado: a faixa acendeu e o terminal nao
  // perdeu uma linha sequer -- logo nao houve pty.resize() no meio do prompt.
  checar('e o terminal NAO muda de altura ao acender a faixa',
    comPedido.rows === linhasAntes, `${linhasAntes} -> ${comPedido.rows}`);

  // A TRAVA. cmd.exe nao tem prompt de permissao nenhum na tela.
  const bufAntes = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(idA)}).textoDoBuffer()`);
  const r = JSON.parse(await cdp.avaliar(
    `JSON.stringify(window.OrqAprovacao.aprovar(${JSON.stringify(idA)}))`));
  await esperar(1500);
  const bufDepois = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(idA)}).textoDoBuffer()`);

  checar('sem pedido na tela, Aprovar NAO escreve nada no PTY',
    bufAntes === bufDepois && r.ok === false, `ok=${r.ok} motivo=${r.motivo}`);
  checar('e avisa por toast em vez de falhar calado',
    (await cdp.avaliar(`document.getElementById('toast').textContent`)).includes('Não achei'), '');

  // Ver tambem nao escreve nada -- so leva o cursor para o terminal.
  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(idA)})
    .elRodape.querySelector('.rodape-ver').click()`);
  await esperar(1000);
  checar('Ver foca o painel e nao escreve nada',
    await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(idA)}).textoDoBuffer()`) === bufDepois
    && await cdp.avaliar(`window.OrqGrade.focado()`) === idA, '');

  // Ocioso nao tem o que aprovar: a faixa aparece sem o botao.
  await marcarEspera('ocioso', '');
  await esperar(600);
  const ocioso = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(idA)});
    return JSON.stringify({
      acesa: p.elRodape.classList.contains('tem-pedido'),
      aprovar: !!p.elRodape.querySelector('.rodape-aprovar'),
      texto: p.elRodape.querySelector('.rodape-pergunta')?.textContent || '',
    });
  })()`));
  checar('sessao apenas ociosa nao ganha botao de Aprovar',
    ocioso.acesa && !ocioso.aprovar && ocioso.texto === 'Esperando você', JSON.stringify(ocioso));

  // Saindo de esperando, a faixa apaga -- e o espaco continua reservado.
  await cdp.avaliar(`window.OrqLateral.definirStatus(${JSON.stringify(idA)}, 'rodando', '')`);
  await esperar(600);
  const limpa = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(idA)});
    return JSON.stringify({
      acesa: p.elRodape.classList.contains('tem-pedido'),
      altura: Math.round(p.elRodape.getBoundingClientRect().height),
      rows: p.term.rows,
    });
  })()`));
  checar('a faixa apaga quando a espera acaba', limpa.acesa === false, JSON.stringify(limpa));
  checar('mas o espaco continua reservado, e o terminal nao muda de altura',
    limpa.altura === 34 && limpa.rows === linhasAntes, JSON.stringify(limpa));

  // textoDoBuffer aplica os bytes pendentes: painel fora da vista guardava a
  // saida e a leitura devolvia texto velho.
  //
  // A leitura e feita em LACO porque o `term.write` do xterm e assincrono -- o
  // que o flush entregou so aparece no passo seguinte do parser. E exatamente
  // por isso que quem espera algo no buffer (esperarPedido, esperarNoBuffer)
  // tambem usa laco, e nao uma leitura unica.
  const guardou = await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(idA)});
    p.definirVisivel(false);
    p.escreverBytes(new TextEncoder().encode('\\r\\nORQ_PENDENTE_9\\r\\n'));
    return p.pendentes.length > 0;
  })()`);
  checar('painel fora da vista guarda os bytes em vez de desenhar', guardou === true, '');

  let achou = false;
  for (let i = 0; i < 20 && !achou; i++) {
    achou = await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(idA)})
      .textoDoBuffer().includes('ORQ_PENDENTE_9')`);
    if (!achou) await esperar(150);
  }
  checar('e textoDoBuffer os aplica antes de devolver o texto', achou, '');

  // --- 11. paleta de comandos --------------------------------------------
  await cdp.avaliar(`window.OrqPaleta.fechar()`);
  await cdp.avaliar(`(() => { window.dispatchEvent(new KeyboardEvent('keydown',
    { key: 'k', ctrlKey: true, bubbles: true })); return 'ok'; })()`);
  await esperar(500);
  const paletaAberta = JSON.parse(await cdp.avaliar(`JSON.stringify({
    visivel: document.getElementById('paleta').hidden === false,
    itens: document.querySelectorAll('.paleta-item').length,
    focoNaBusca: document.activeElement?.id === 'paleta-busca',
    selecionado: document.querySelector('.paleta-item.selecionado')?.dataset.indice,
  })`));
  checar('Ctrl+K abre a paleta com o foco na busca',
    paletaAberta.visivel && paletaAberta.focoNaBusca && paletaAberta.itens > 0,
    JSON.stringify(paletaAberta));
  checar('e o primeiro item ja vem selecionado', paletaAberta.selecionado === '0', '');

  // A tela e acentuada; a busca nao pode exigir acento.
  const filtrou = JSON.parse(await cdp.avaliar(`(() => {
    const i = document.getElementById('paleta-busca');
    i.value = 'sessao';
    i.dispatchEvent(new Event('input'));
    return JSON.stringify([...document.querySelectorAll('.paleta-rotulo')].map(e => e.textContent));
  })()`));
  checar('a busca ignora acento: "sessao" acha "sessão"',
    filtrou.length > 0 && filtrou.every((t) => /sess[aã]o/i.test(t)), JSON.stringify(filtrou));

  const nada = JSON.parse(await cdp.avaliar(`(() => {
    const i = document.getElementById('paleta-busca');
    i.value = 'zzzznaoexiste';
    i.dispatchEvent(new Event('input'));
    return JSON.stringify({ itens: document.querySelectorAll('.paleta-item').length,
      vazio: Boolean(document.querySelector('.paleta-vazio')) });
  })()`));
  checar('busca sem resultado avisa em vez de ficar em branco',
    nada.itens === 0 && nada.vazio, JSON.stringify(nada));

  // Enter executa: o tema e o comando mais facil de observar sem efeito colateral.
  const temaAntes = await cdp.avaliar(`window.OrqCasca.tema()`);
  await cdp.avaliar(`(() => {
    const i = document.getElementById('paleta-busca');
    i.value = 'tema';
    i.dispatchEvent(new Event('input'));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'ok';
  })()`);
  await esperar(700);
  checar('Enter executa o item selecionado',
    await cdp.avaliar(`window.OrqCasca.tema()`) !== temaAntes, temaAntes);
  checar('e a paleta fecha ao executar',
    await cdp.avaliar(`document.getElementById('paleta').hidden`) === true, '');
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: ${JSON.stringify(temaAntes)} })`);

  // --- 12. overlays empilhados -------------------------------------------
  //
  // Antes cada overlay tinha o proprio Esc, e com dois abertos um Esc fechava
  // os dois. Agora o registro unico fecha so o do topo.
  await cdp.avaliar(`(async () => { await window.OrqAjuda.abrir(); return 'ok'; })()`);
  await esperar(500);
  await cdp.avaliar(`window.OrqPaleta.abrir()`);
  await esperar(400);

  const doisAbertos = JSON.parse(await cdp.avaliar(`JSON.stringify({
    ajuda: document.getElementById('ajuda').hidden === false,
    paleta: document.getElementById('paleta').hidden === false,
  })`));
  checar('da para abrir a paleta por cima da ajuda',
    doisAbertos.ajuda && doisAbertos.paleta, JSON.stringify(doisAbertos));

  // Quem abriu depois tem de APARECER por cima, e nao so ser o alvo do Esc.
  // A ordem do HTML poe a ajuda depois do historico, entao sem empilhamento por
  // ordem de abertura voce veria um overlay e o Esc fecharia outro.
  const empilhado = JSON.parse(await cdp.avaliar(`JSON.stringify({
    ajuda: Number(getComputedStyle(document.getElementById('ajuda')).zIndex),
    paleta: Number(getComputedStyle(document.getElementById('paleta')).zIndex),
    topo: window.OrqOverlays.noTopo()?.el.id,
  })`));
  checar('e o que abriu depois fica por cima, tambem visualmente',
    empilhado.paleta > empilhado.ajuda && empilhado.topo === 'paleta', JSON.stringify(empilhado));

  await cdp.avaliar(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await esperar(400);
  const umEsc = JSON.parse(await cdp.avaliar(`JSON.stringify({
    ajuda: document.getElementById('ajuda').hidden === false,
    paleta: document.getElementById('paleta').hidden === false,
  })`));
  checar('um Esc fecha SO o overlay de cima', umEsc.ajuda && !umEsc.paleta, JSON.stringify(umEsc));

  await cdp.avaliar(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await esperar(400);
  checar('o Esc seguinte fecha o de baixo',
    await cdp.avaliar(`document.getElementById('ajuda').hidden`) === true, '');

  // --- 13. modal de cadastrar projeto ------------------------------------
  //
  // Cadastra pelo caminho DIGITADO: o CDP nao dirige dialogo nativo, e e por
  // isso que o modal separa escolher a pasta de gravar o projeto.
  const alvo = RAIZ;
  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos();
    return 'ok';
  })()`);
  await esperar(400);

  checar('sem projeto, a lateral mostra o cartao com o botao',
    await cdp.avaliar(`Boolean(document.querySelector('.projeto-vazio button'))`), '');

  await cdp.avaliar(`window.OrqModalProjeto.abrir()`);
  await esperar(400);
  const modalAberto = JSON.parse(await cdp.avaliar(`JSON.stringify({
    visivel: document.getElementById('modal-projeto').hidden === false,
    faixas: [...document.querySelectorAll('.modal-faixa')].map(b => b.textContent),
    ativa: document.querySelector('.modal-faixa.ativa')?.textContent,
  })`));
  checar('o modal abre com as tres faixas', modalAberto.visivel && modalAberto.faixas.length === 3,
    JSON.stringify(modalAberto));

  // Pasta que nao existe: mensagem na tela, sem cadastrar nada.
  await cdp.avaliar(`(async () => {
    document.getElementById('projeto-caminho').value = 'C:/isto/nao/existe';
    await window.OrqModalProjeto.confirmar();
    return 'ok';
  })()`);
  await esperar(500);
  const recusa = JSON.parse(await cdp.avaliar(`JSON.stringify({
    erro: document.getElementById('projeto-erro').hidden === false,
    aberto: document.getElementById('modal-projeto').hidden === false,
  })`));
  checar('pasta inexistente vira mensagem no modal, sem fechar',
    recusa.erro && recusa.aberto, JSON.stringify(recusa));

  // Agora o caminho bom, com a segunda faixa.
  await cdp.avaliar(`window.OrqModalProjeto.escolher(1)`);
  await cdp.avaliar(`(async () => {
    document.getElementById('projeto-caminho').value = ${JSON.stringify(alvo)};
    await window.OrqModalProjeto.confirmar();
    return 'ok';
  })()`);
  await esperar(800);

  const cadastrado = JSON.parse(await cdp.avaliar(`(async () => {
    const lista = await window.orq.projetosListar();
    return JSON.stringify({
      total: lista.length,
      faixa: lista[0]?.faixa || null,
      fechou: document.getElementById('modal-projeto').hidden === true,
      toast: document.getElementById('toast').textContent,
    });
  })()`));
  checar('cadastra pelo caminho digitado, sem dialogo nativo',
    cadastrado.total === 1 && cadastrado.fechou, JSON.stringify(cadastrado));
  checar('e grava a faixa de portas escolhida',
    Array.isArray(cadastrado.faixa) && cadastrado.faixa[0] === 4000, JSON.stringify(cadastrado.faixa));
  checar('confirmando por toast', /cadastrado/i.test(cadastrado.toast || ''), cadastrado.toast);

  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos();
    return 'ok';
  })()`);

  // --- 14. contraste AA nos dois temas ------------------------------------
  //
  // O checklist do doc 08 pede AA. Isso nao se confere no olho: calcula-se.
  // Cada par tem o tamanho do texto que ele carrega de verdade -- 4,5:1 para
  // texto normal, 3:1 so onde o texto e grande (>=18,66px ou 14px negrito).
  for (const tema of ['escuro', 'claro']) {
    await cdp.avaliar(`window.OrqCasca.mudar({ tema: ${JSON.stringify(tema)} })`);
    await esperar(400);
    const medido = JSON.parse(await cdp.avaliar(`(() => {
      const raiz = getComputedStyle(document.documentElement);
      const tok = (n) => raiz.getPropertyValue(n).trim();
      const rgb = (cor) => {
        const d = document.createElement('div');
        d.style.color = cor;
        document.body.append(d);
        const m = getComputedStyle(d).color.match(/[\\d.]+/g).map(Number);
        d.remove();
        return m;
      };
      const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lum = (cor) => { const [r, g, b] = rgb(cor); return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b); };
      const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const PARES = [
        ['fg/bg0', tok('--fg'), tok('--bg0')],
        ['fg/bg1', tok('--fg'), tok('--bg1')],
        ['fg2/bg1', tok('--fg2'), tok('--bg1')],
        ['fg3/bg1', tok('--fg3'), tok('--bg1')],
        ['fg3/bg3', tok('--fg3'), tok('--bg3')],
        ['acc/bg1', tok('--acc'), tok('--bg1')],
        ['warn/bg1', tok('--warn'), tok('--bg1')],
        ['info/bg1', tok('--info'), tok('--bg1')],
        ['acc-texto/acc', tok('--acc-texto'), tok('--acc')],
        ['termfg/term', tok('--termfg'), tok('--term')],
      ];
      return JSON.stringify(PARES.map(([nome, f, b]) => ({ nome, razao: Math.round(razao(f, b) * 100) / 100 })));
    })()`));
    const ruins = medido.filter((m) => m.razao < 4.5);
    checar(`contraste AA no tema ${tema}`, ruins.length === 0,
      ruins.map((r) => `${r.nome}=${r.razao}`).join(' ') || medido.map((r) => `${r.nome}=${r.razao}`).join(' '));
  }

  // --- 15. historico e diff (Fase 9) --------------------------------------
  await cdp.avaliar(`(async () => { await window.OrqHistorico.abrir(); return 'ok'; })()`);
  await esperar(800);
  const hist = JSON.parse(await cdp.avaliar(`JSON.stringify({
    visivel: document.getElementById('historico').hidden === false,
    tabela: Boolean(document.querySelector('.historico-tabela')),
    vazio: Boolean(document.querySelector('.historico-vazio')),
    colunas: [...document.querySelectorAll('.historico-tabela th')].map(t => t.textContent),
  })`));
  checar('o historico abre e mostra tabela ou o aviso de vazio',
    hist.visivel && (hist.tabela || hist.vazio), JSON.stringify(hist));

  // Botao de fechar fora do seletor de estilo aparece como botao branco do
  // sistema no meio da tela. Aconteceu duas vezes (historico e envio em lote).
  //
  // A checagem VARRE o documento em vez de conferir uma lista: assim o proximo
  // overlay entra sozinho, e nao ha lista para alguem esquecer de atualizar --
  // que foi exatamente como as duas primeiras passaram.
  const fechares = JSON.parse(await cdp.avaliar(`JSON.stringify(
    [...document.querySelectorAll('[id$="-fechar"]')].map(e => {
      const s = getComputedStyle(e);
      return { id: e.id, borda: s.borderRadius };
    }))`));
  checar('todo botao de fechar tem estilo, e ha mais de um',
    fechares.length >= 4 && fechares.every((f) => f.borda === '8px'),
    JSON.stringify(fechares.filter((f) => f.borda !== '8px')) + ` (${fechares.length} botoes)`);
  if (hist.tabela) {
    checar('com as colunas que respondem "valeu a pena?"',
      hist.colunas.includes('Trabalhando') && hist.colunas.includes('Esperando você')
      && hist.colunas.includes('Interrupções'), hist.colunas.join(' | '));
  }
  await cdp.avaliar(`window.OrqHistorico.fechar()`);

  // O placar leva ao historico: e o mesmo assunto, do agora para o ao longo do tempo.
  await cdp.avaliar(`document.getElementById('placar').click()`);
  await esperar(700);
  checar('clicar no placar abre o historico',
    await cdp.avaliar(`document.getElementById('historico').hidden`) === false, '');
  await cdp.avaliar(`window.OrqHistorico.fechar()`);

  // O parser do diff, sem precisar de repositorio: e ele que decide o que a
  // tela mostra, e erra em silencio se o formato do git mudar.
  const DIFF = [
    'diff --git a/src/um.js b/src/um.js',
    'index 111..222 100644',
    '--- a/src/um.js',
    '+++ b/src/um.js',
    '@@ -1,3 +1,4 @@',
    ' contexto',
    '-linha velha',
    '+linha nova',
    '+outra nova',
    'diff --git a/dois.txt b/dois.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/dois.txt',
    '@@ -0,0 +1 @@',
    '+arquivo novo',
  ].join('\n');

  const parse = JSON.parse(await cdp.avaliar(`(() => {
    const arqs = window.OrqDiff.separar(${JSON.stringify(DIFF)}, 'teste');
    return JSON.stringify({
      quantos: arqs.length,
      nomes: arqs.map(a => a.nome),
      contas: arqs.map(a => a.mais + '/' + a.menos),
      classes: [
        window.OrqDiff.classeDa('+novo'),
        window.OrqDiff.classeDa('-velho'),
        window.OrqDiff.classeDa('@@ -1 +1 @@'),
        window.OrqDiff.classeDa('+++ b/x'),
        window.OrqDiff.classeDa(' igual'),
      ],
    });
  })()`));
  checar('o parser separa um arquivo por bloco',
    parse.quantos === 2 && parse.nomes.join() === 'src/um.js,dois.txt', JSON.stringify(parse.nomes));
  checar('conta adicoes e remocoes sem confundir com os cabecalhos +++/---',
    parse.contas.join() === '2/1,1/0', parse.contas.join());
  checar('e classifica cada linha pelo papel',
    parse.classes.join() === 'diff-mais,diff-menos,diff-hunk,diff-meta,diff-contexto',
    parse.classes.join());

  // A tela do diff: um arquivo por vez, para a arvore do DOM ficar pequena.
  await cdp.avaliar(`(() => {
    const d = document.getElementById('diff');
    d.hidden = false;
    window.OrqDiff.separar(${JSON.stringify(DIFF)}, 'teste');
    return 'ok';
  })()`);
  await cdp.avaliar(`window.OrqDiff.fechar()`);
  checar('o diff fecha limpando o estado',
    await cdp.avaliar(`document.getElementById('diff').hidden`) === true
    && await cdp.avaliar(`window.OrqDiff.arquivos().length`) === 0, '');

  // --- 16. o campo diz a verdade sobre o branch --------------------------
  //
  // O `feat/` que ficava no campo era decoracao do prototipo e nunca chegou a
  // branch nenhum: quem nomeia e o `claude -w`, sempre como `worktree-<nome>`.
  const campo = JSON.parse(await cdp.avaliar(`(() => {
    const i = document.getElementById('nome-feature');
    i.value = 'auth refresh';
    i.dispatchEvent(new Event('input'));
    const dica = document.getElementById('barra-dica').textContent;
    i.value = '';
    i.dispatchEvent(new Event('input'));
    return JSON.stringify({
      dica,
      vazia: document.getElementById('barra-dica').textContent,
      prefixo: Boolean(document.querySelector('.campo-feature .prefixo')),
    });
  })()`));
  checar('nao ha mais prefixo no campo', campo.prefixo === false, '');
  checar('e a dica cita o nome real do branch',
    campo.dica.includes('worktree-auth-refresh') && !campo.dica.includes('feat/'), campo.dica);
  checar('sem nome, a dica diz que nao havera worktree',
    /sem criar worktree/.test(campo.vazia), campo.vazia);

  // --- 17. enviar para varias sessoes -------------------------------------
  await zerarGrade(cdp);
  const lote = {};
  for (const f of ['lote-a', 'lote-b']) {
    lote[f] = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ)}, feature: ${JSON.stringify(f)} }); return p.id; })()`);
    await esperar(500);
  }
  await esperar(2500);

  await cdp.avaliar(`window.OrqEnviarVarias.abrir()`);
  await esperar(500);
  const lista = JSON.parse(await cdp.avaliar(`JSON.stringify({
    itens: document.querySelectorAll('.enviar-item').length,
    candidatas: window.OrqEnviarVarias.candidatas().length,
    aviso: document.getElementById('enviar-aviso').textContent,
    botaoTravado: document.getElementById('enviar-confirmar').disabled,
  })`));
  checar('lista as sessoes vivas', lista.itens === 2 && lista.candidatas === 2, JSON.stringify(lista));
  checar('sem escolha nenhuma, o envio fica travado',
    lista.botaoTravado === true && /ao menos uma/.test(lista.aviso), lista.aviso);

  // Painel dormindo nao tem para onde escrever: nao entra na lista.
  await cdp.avaliar(`(() => { const p = window.OrqPainel.painelPorId.get(${JSON.stringify(lote['lote-b'])});
    p.mostrarDormindo({ aoRetomar: () => {} }); return 'ok'; })()`);
  await cdp.avaliar(`window.OrqEnviarVarias.selecionar('todas')`);
  await esperar(400);
  checar('painel dormindo fica de fora',
    await cdp.avaliar(`window.OrqEnviarVarias.candidatas().length`) === 1, '');
  await cdp.avaliar(`(() => { const p = window.OrqPainel.painelPorId.get(${JSON.stringify(lote['lote-b'])});
    p.acordou(); return 'ok'; })()`);

  // A contagem antes de enviar: cinco sessoes e cinco vezes o custo.
  await cdp.avaliar(`window.OrqEnviarVarias.selecionar('todas')`);
  await esperar(400);
  const aviso = await cdp.avaliar(`document.getElementById('enviar-aviso').textContent`);
  checar('avisa quantas sessoes e quantas execucoes antes de enviar',
    /2 sess[õo]es/.test(aviso) && /2 execu/.test(aviso), aviso);

  // O TESTE QUE IMPORTA: chega no terminal certo, e nos dois escolhidos.
  await cdp.avaliar(`document.getElementById('enviar-texto').value = 'echo ORQ_LOTE_9911'`);
  await cdp.avaliar(`(async () => { await window.OrqEnviarVarias.enviar(); return 'ok'; })()`);

  const chegou = async (id) => {
    for (let i = 0; i < 40; i++) {
      const tem = await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(id)})
        .textoDoBuffer().includes('ORQ_LOTE_9911')`);
      if (tem) return true;
      await esperar(250);
    }
    return false;
  };
  checar('o texto chegou na primeira sessao', await chegou(lote['lote-a']), '');
  checar('e tambem na segunda', await chegou(lote['lote-b']), '');

  // E nao vazou para quem nao foi escolhido.
  const idFora = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'lote-fora' }); return p.id; })()`);
  await esperar(2500);
  await cdp.avaliar(`window.OrqEnviarVarias.abrir()`);
  await cdp.avaliar(`window.OrqEnviarVarias.selecionar('nenhuma')`);
  await cdp.avaliar(`(() => { [...window.OrqEnviarVarias.candidatas()]
    .filter(p => p.feature === 'lote-a')
    .forEach(p => document.querySelector('.enviar-item[data-id="' + CSS.escape(p.id) + '"]').click());
    return 'ok'; })()`);
  await cdp.avaliar(`document.getElementById('enviar-texto').value = 'echo ORQ_SO_UM_7788'`);
  await cdp.avaliar(`(async () => { await window.OrqEnviarVarias.enviar(); return 'ok'; })()`);
  await esperar(3000);

  const soUm = JSON.parse(await cdp.avaliar(`JSON.stringify({
    escolhido: window.OrqPainel.painelPorId.get(${JSON.stringify(lote['lote-a'])}).textoDoBuffer().includes('ORQ_SO_UM_7788'),
    vizinho: window.OrqPainel.painelPorId.get(${JSON.stringify(idFora)}).textoDoBuffer().includes('ORQ_SO_UM_7788'),
  })`));
  checar('so o painel escolhido recebe, sem vazar para o vizinho',
    soUm.escolhido && !soUm.vizinho, JSON.stringify(soUm));

  // --- 18. layouts salvos --------------------------------------------------
  await zerarGrade(cdp);
  await cdp.avaliar(`(async () => {
    for (const l of await window.orq.layoutsListar()) await window.orq.layoutsRemover(l.nome);
    await window.OrqLayouts.recarregar();
    return 'ok';
  })()`);

  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'claro', densidade: 3, ordem: 'projeto' })`);
  for (const f of ['lay-a', 'lay-b']) {
    await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ)}, feature: ${JSON.stringify(f)} }); return 'ok'; })()`);
    await esperar(500);
  }
  await esperar(2000);

  await cdp.avaliar(`(async () => { await window.OrqLayouts.salvarAtual('teste-revisao'); return 'ok'; })()`);
  await esperar(600);
  const layoutSalvo = JSON.parse(await cdp.avaliar(`(async () => {
    const l = (await window.orq.layoutsListar()).find(x => x.nome === 'teste-revisao');
    return JSON.stringify(l ? { tema: l.tema, densidade: l.densidade, ordem: l.ordem, paineis: l.paineis.length } : null);
  })()`));
  checar('salvar guarda o arranjo e as tres preferencias',
    layoutSalvo && layoutSalvo.tema === 'claro' && layoutSalvo.densidade === 3
    && layoutSalvo.ordem === 'projeto' && layoutSalvo.paineis === 2, JSON.stringify(layoutSalvo));

  // Muda tudo, e o layout tem de trazer de volta.
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro', densidade: 1, ordem: 'urgencia' })`);
  await zerarGrade(cdp);
  await esperar(500);

  // `confirmar: false` porque a confirmacao e um dialogo nativo, que o CDP nao
  // dirige. O caminho com pergunta e o mesmo, so com o window.confirm na frente.
  await cdp.avaliar(`(async () => { await window.OrqLayouts.aplicar('teste-revisao', { confirmar: false }); return 'ok'; })()`);
  await esperar(2500);

  const aplicado = JSON.parse(await cdp.avaliar(`JSON.stringify({
    tema: window.OrqCasca.tema(),
    densidade: window.OrqCasca.densidade(),
    ordem: window.OrqCasca.ordem(),
    paineis: window.OrqGrade.painelPorId.size,
    dormindo: window.OrqGrade.dormindos().length,
    comPty: [...window.OrqGrade.painelPorId.values()].filter(p => !p.dormindo).length,
  })`));
  checar('aplicar traz tema, densidade e ordenacao de volta',
    aplicado.tema === 'claro' && aplicado.densidade === 3 && aplicado.ordem === 'projeto',
    JSON.stringify(aplicado));
  checar('e os painéis voltam DORMINDO, sem subir PTY sozinho',
    aplicado.paineis === 2 && aplicado.dormindo === 2 && aplicado.comPty === 0,
    JSON.stringify(aplicado));

  await cdp.avaliar(`(async () => { await window.OrqLayouts.remover('teste-revisao'); return 'ok'; })()`);
  checar('remover tira o layout da paleta',
    (await cdp.avaliar(`JSON.stringify(window.OrqPaleta.comandos().map(c => c.rotulo))`))
      .includes('teste-revisao') === false, '');

  // --- 19. o mapa ----------------------------------------------------------
  await zerarGrade(cdp);
  const mapa = {};
  for (const f of ['mapa-a', 'mapa-b']) {
    mapa[f] = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ)}, feature: ${JSON.stringify(f)} }); return p.id; })()`);
    await esperar(500);
  }
  await esperar(2000);

  const idsAntes = await cdp.avaliar(`JSON.stringify([...window.OrqGrade.painelPorId.keys()])`);
  const rowsGrade = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])}).term.rows`);

  await cdp.avaliar(`window.OrqMapa.definirModo('mapa')`);
  await esperar(1200);

  const noMapa = JSON.parse(await cdp.avaliar(`JSON.stringify({
    modo: window.OrqMapa.modo(),
    mesmos: JSON.stringify([...window.OrqGrade.painelPorId.keys()]) === ${JSON.stringify(idsAntes)},
    posicionados: [...window.OrqGrade.painelPorId.values()]
      .every(p => Number.isFinite(p.x) && Number.isFinite(p.y)),
    naMesmaPosicao: (() => {
      const [a, b] = [...window.OrqGrade.painelPorId.values()];
      return a.x === b.x && a.y === b.y;
    })(),
    absoluto: getComputedStyle(document.querySelector('.painel')).position,
  })`));
  // O teste central: trocar de modo NAO pode recriar painel, senao o xterm
  // morre junto.
  checar('trocar para o mapa preserva os mesmos objetos de painel',
    noMapa.modo === 'mapa' && noMapa.mesmos, JSON.stringify(noMapa));
  checar('e o terminal continua respondendo depois da troca',
    await cdp.avaliar(`(() => { const p = window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])});
      return Boolean(p.term && p.term.rows > 0 && !p.encerrado); })()`), '');
  checar('quem nunca foi arrastado ganha lugar, sem empilhar no canto',
    noMapa.posicionados && !noMapa.naMesmaPosicao, JSON.stringify(noMapa));
  checar('os painéis passam a ser posicionados', noMapa.absoluto === 'absolute', noMapa.absoluto);

  // O fundo de bolinhas so existe no mapa: na grade ele seria ruido atras de
  // painéis encostados uns nos outros.
  checar('o mapa ganha o padrao de bolinhas atras dos painéis',
    (await cdp.avaliar(`getComputedStyle(document.getElementById('grade')).backgroundImage`))
      .includes('radial-gradient'), '');

  // Redimensionar. O tamanho e MODELO (p.w / p.h) e encaixa na malha de 20px --
  // a mesma do padrao de bolinhas, e e por isso que os painéis ficam alinhados
  // entre si sem ninguem mirar.
  const colsAntes = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])}).term.cols`);

  const tamanho = JSON.parse(await cdp.avaliar(`(() => {
    const r = window.OrqMapa.definirTamanho(${JSON.stringify(mapa['mapa-a'])}, 613, 447);
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])});
    const cx = p.el.getBoundingClientRect();
    return JSON.stringify({ r, l: Math.round(cx.width), a: Math.round(cx.height) });
  })()`));
  checar('redimensionar encaixa na malha de 20px',
    tamanho.r.w === 620 && tamanho.r.h === 440, JSON.stringify(tamanho.r));
  checar('e o painel na tela fica exatamente desse tamanho',
    tamanho.l === 620 && tamanho.a === 440, JSON.stringify(tamanho));

  // Sem piso, arrastar a alca para cima esconderia o terminal inteiro.
  const minimo = JSON.parse(await cdp.avaliar(
    `JSON.stringify(window.OrqMapa.definirTamanho(${JSON.stringify(mapa['mapa-a'])}, 40, 40))`));
  checar('e nao encolhe abaixo do minimo util',
    minimo.w === 280 && minimo.h === 180, JSON.stringify(minimo));

  // O gesto de verdade: arrastar a alca com o mouse. Sem isto, o que esta
  // provado e a funcao, e nao a alca.
  await cdp.avaliar(`window.OrqMapa.definirTamanho(${JSON.stringify(mapa['mapa-a'])}, 420, 300)`);
  await esperar(300);
  await arrastarAlca(cdp, mapa['mapa-a'], 170, 90);
  const arrastado = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])});
    return JSON.stringify({ w: p.w, h: p.h, classe: p.el.className,
      caixa: Math.round(p.el.getBoundingClientRect().width) });
  })()`));
  // 420+170 = 590 e 300+90 = 390, encaixados na malha: 600 e 400.
  checar('arrastar a alca com o mouse redimensiona, encaixando na malha',
    arrastado.w === 600 && arrastado.h === 400, JSON.stringify(arrastado));
  checar('e a caixa na tela acompanha o modelo',
    arrastado.caixa === 600, String(arrastado.caixa));
  checar('soltar limpa a marca de arrasto',
    !arrastado.classe.includes('redimensionando'), arrastado.classe);

  await cdp.avaliar(`window.OrqMapa.definirTamanho(${JSON.stringify(mapa['mapa-a'])}, 620, 440)`);
  // Espera o ResizeObserver mais o debounce de 100ms do painel -- o fit() nao e
  // sincrono com o redimensionar, de proposito.
  await esperar(700);

  // Redimensionar reflui o terminal DE VERDADE, em vez de esticar a imagem.
  const colsDepois = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])}).term.cols`);
  checar('o terminal reflui: 620px de painel dao mais colunas que os 420 do padrao',
    colsDepois > colsAntes, `${colsAntes} -> ${colsDepois}`);

  // Ligacao vira linha. Ligadas pelas PASTAS, como manda o modelo de ligacoes.
  await cdp.avaliar(`(() => {
    const a = window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])});
    const b = window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-b'])});
    a.ligacoes = [b.cwd]; b.ligacoes = [a.cwd];
    window.OrqMapa.desenharLinhas();
    return 'ok';
  })()`);
  await esperar(400);
  checar('duas sessoes ligadas viram uma linha (uma so, nao duas)',
    await cdp.avaliar(`window.OrqMapa.linhas().length`) === 1, '');

  // A ponta da linha sai do centro REAL do painel. Enquanto o tamanho era fixo
  // em 420x300 no codigo, um painel redimensionado deixava a linha apontando
  // para o vazio -- e o mesmo defeito ja acontecia com os cartoes da visao
  // geral, que sao 260 de largura.
  const ponta = JSON.parse(await cdp.avaliar(`(() => {
    const l = window.OrqMapa.linhas()[0];
    const de = window.OrqPainel.painelPorId.get(l.dataset.de);
    return JSON.stringify({
      x1: Number(l.getAttribute('x1')),
      y1: Number(l.getAttribute('y1')),
      esperadoX: (de.x || 0) + de.w / 2,
      esperadoY: (de.y || 0) + de.h / 2,
    });
  })()`));
  checar('a linha sai do centro real do painel, e nao de um tamanho presumido',
    ponta.x1 === ponta.esperadoX && ponta.y1 === ponta.esperadoY, JSON.stringify(ponta));

  await cdp.avaliar(`(() => {
    for (const p of window.OrqPainel.painelPorId.values()) p.ligacoes = [];
    window.OrqMapa.desenharLinhas();
    return 'ok';
  })()`);
  checar('desligar apaga a linha', await cdp.avaliar(`window.OrqMapa.linhas().length`) === 0, '');

  // Arrastar grava a posicao no retrato que a Fase 7 salva.
  await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])});
    p.x = 777; p.y = 333;
    window.OrqMapa.redesenhar();
    window.OrqGrade.salvarSessao({ agora: true });
    return 'ok';
  })()`);
  await esperar(600);
  const salvoMapa = JSON.parse(await cdp.avaliar(`(async () => {
    const s = await window.orq.sessaoCarregar();
    const a = s.find(p => p.feature === 'mapa-a');
    return JSON.stringify(a ? { x: a.x, y: a.y, w: a.w, h: a.h } : null);
  })()`));
  checar('a posicao no mapa vai para o sessao.json',
    salvoMapa && salvoMapa.x === 777 && salvoMapa.y === 333, JSON.stringify(salvoMapa));
  checar('e o tamanho vai junto', salvoMapa && salvoMapa.w === 620 && salvoMapa.h === 440,
    JSON.stringify(salvoMapa));

  // Visao geral: o terminal e TROCADO por cartao, nunca encolhido.
  await cdp.avaliar(`window.OrqMapa.definirVisao(true)`);
  await esperar(600);
  const geral = JSON.parse(await cdp.avaliar(`JSON.stringify({
    termosVisiveis: [...document.querySelectorAll('.painel-term')].filter(e => e.offsetParent !== null).length,
    cabecalhos: document.querySelectorAll('.painel-cab').length,
    // O cartao so pode medir 260px se o tamanho inline TIVER SAIDO: estilo
    // inline vence folha de estilo, e o painel vinha de 620px de largura.
    inline: [...document.querySelectorAll('.painel')].map(e => e.style.width || ''),
    largurasCartao: [...document.querySelectorAll('.painel')]
      .map(e => Math.round(e.getBoundingClientRect().width)),
    // Nenhum SCALE em lugar nenhum: e o que garante que o xterm nao borra.
    // Comparar com a string "none" nao serve: a animacao de entrada usa
    // fill-mode both, o quadro final fica aplicado e o Chromium reporta a
    // matriz IDENTIDADE. O que importa sao os fatores de escala, a e d.
    escalas: [...document.querySelectorAll('.painel')].map(e => {
      const t = getComputedStyle(e).transform;
      if (t === 'none') return [1, 1];
      const n = t.match(/-?[\\d.]+/g).map(Number);
      return [n[0], n[3]];
    }),
  })`));
  checar('na visao geral nenhum terminal fica visivel',
    geral.termosVisiveis === 0 && geral.cabecalhos === 2, JSON.stringify(geral));
  checar('e nada e ESCALADO — o terminal e trocado por cartao, nao encolhido',
    geral.escalas.every(([x, y]) => x === 1 && y === 1), JSON.stringify(geral.escalas));
  checar('o cartao volta ao tamanho de cartao, mesmo vindo de um painel redimensionado',
    geral.inline.every((v) => v === '') && geral.largurasCartao.every((l) => l === 260),
    JSON.stringify({ i: geral.inline, l: geral.largurasCartao }));

  // Densidade e ordenacao nao fazem nada no mapa, entao nao ficam na tela.
  const controles = JSON.parse(await cdp.avaliar(`JSON.stringify({
    densidade: getComputedStyle(document.getElementById('densidade')).display,
    ordenacao: getComputedStyle(document.getElementById('ordenacao')).display,
    visao: document.getElementById('btn-visao').hidden,
  })`));
  checar('no mapa somem os controles que nao fazem nada nele',
    controles.densidade === 'none' && controles.ordenacao === 'none' && controles.visao === false,
    JSON.stringify(controles));

  // Voltar para a grade devolve tudo, inclusive o tamanho do terminal.
  await cdp.avaliar(`window.OrqMapa.definirVisao(false)`);
  await cdp.avaliar(`window.OrqMapa.definirModo('grade')`);
  await esperar(1400);
  const voltou = JSON.parse(await cdp.avaliar(`JSON.stringify({
    modo: window.OrqMapa.modo(),
    mesmos: JSON.stringify([...window.OrqGrade.painelPorId.keys()]) === ${JSON.stringify(idsAntes)},
    rows: window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])}).term.rows,
    posicao: getComputedStyle(document.querySelector('.painel')).position,
    guardouX: window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])}).x,
    guardouW: window.OrqPainel.painelPorId.get(${JSON.stringify(mapa['mapa-a'])}).w,
    inline: [...document.querySelectorAll('.painel')].map(e => e.style.width + '|' + e.style.height),
    fundo: getComputedStyle(document.getElementById('grade')).backgroundImage,
  })`));
  checar('voltar para a grade preserva os painéis',
    voltou.modo === 'grade' && voltou.mesmos && voltou.posicao !== 'absolute', JSON.stringify(voltou));
  checar('e o tamanho do mapa nao vaza para a grade',
    voltou.inline.every((v) => v === '|'), JSON.stringify(voltou.inline));
  checar('as bolinhas ficam no mapa: a grade nao herda o fundo',
    voltou.fundo === 'none', voltou.fundo);
  checar('o terminal volta ao tamanho que tinha na grade',
    voltou.rows === rowsGrade, `${rowsGrade} -> ${voltou.rows}`);
  checar('e a posicao e o tamanho do mapa ficam guardados para a proxima vez',
    voltou.guardouX === 777 && voltou.guardouW === 620,
    JSON.stringify({ x: voltou.guardouX, w: voltou.guardouW }));

  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro', densidade: 2, ordem: 'urgencia' })`);
  // Limpa a sessao SALVA, e nao so a grade: sobrando painel no sessao.json, a
  // fase7 restaura os dela mais o nosso e conta a ordem errada. Suite que
  // deixa estado em disco quebra a proxima.
  await cdp.avaliar(`window.orq.sessaoSalvar([])`);

  encerrar('UI');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
