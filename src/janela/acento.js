'use strict';

// A cor de destaque do app: foco, botao primario, bordas de alvo e a bolinha de
// `rodando`. Antes era sempre o verde; agora a pessoa escolhe.
//
// A cor escolhida e a BASE, e nao o valor que vai para a tela. Os tokens que
// carregam texto (`--acc` como texto sobre `--bg1`, e `--acc-texto` sobre o
// botao primario) tem de passar AA (4,5:1) nos dois temas -- o `teste:ui`
// calcula isso, e foi assim que os valores do doc 02 caíram. Uma cor livre
// qualquer reprovaria quase sempre num dos dois temas, entao a luminosidade e
// AJUSTADA (mesmo matiz e saturacao) ate passar: clareada no tema escuro,
// escurecida no claro. E o mesmo que foi feito a mao com o #0b7b52 do verde.
//
// Os tokens derivados vao INLINE no <html>, que vence `:root` e `html.claro`. A
// cor padrao NAO escreve nada: os valores calibrados do `estilo.css` continuam
// valendo byte a byte, e o caso de quem nunca mexeu nisso nao muda.
//
// A bolinha de `rodando` acompanha a cor (decisao de quem pediu). Por isso o
// seletor avisa quando o matiz cai perto do de `esperando` ou de erro: cor que
// significa duas coisas nao significa nenhuma.

(() => {
  const PADRAO = '#3ddc97';
  // Um pouco acima de 4,5: o teste le a cor de volta do navegador, e arredondar
  // canal para inteiro nao pode derrubar um par que passou aqui por 0,01.
  const ALVO = 4.6;

  const PRESETS = [
    { nome: 'Verde', cor: '#3ddc97' },
    { nome: 'Azul', cor: '#5b8cff' },
    { nome: 'Ciano', cor: '#22c3d6' },
    { nome: 'Roxo', cor: '#a78bfa' },
    { nome: 'Rosa', cor: '#f472b6' },
    { nome: 'Vermelho', cor: '#ef5350' },
    { nome: 'Laranja', cor: '#ff8a3d' },
    { nome: 'Âmbar', cor: '#e5c03a' },
  ];

  // ------------------------------------------------------------- cor

  function hexParaRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const hex2 = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  const rgbParaHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

  // Cor de token CSS (hex, rgb() ou rgba()) para [r, g, b].
  function lerCor(texto) {
    const t = String(texto || '').trim();
    const h = hexParaRgb(t);
    if (h) return h;
    const m = t.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return p.length >= 3 ? p.slice(0, 3) : null;
  }

  function luminancia([r, g, b]) {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contraste(a, b) {
    const la = luminancia(a);
    const lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function rgbParaHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function hslParaRgb([h, s, l]) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round);
  }

  // Anda a luminosidade em passos ate todas as condicoes passarem. Os extremos
  // (branco e preto) sempre passam contra os fundos do app, entao o laco termina.
  function ajustar(base, direcao, passa) {
    const [h, s, l0] = rgbParaHsl(base);
    for (let i = 0; i <= 100; i++) {
      const l = Math.min(1, Math.max(0, l0 + direcao * i * 0.01));
      const rgb = hslParaRgb([h, s, l]);
      if (passa(rgb)) return rgb;
    }
    return direcao > 0 ? [255, 255, 255] : [0, 0, 0];
  }

  // Os tokens de um tema, a partir da base. Puro: recebe o fundo, nao le o DOM,
  // e e por isso que o `teste:ui` consegue varrer cores sem trocar o tema.
  function derivar(hex, tema, fundo) {
    const base = hexParaRgb(hex) || hexParaRgb(PADRAO);
    const bg = fundo || (tema === 'claro' ? [255, 255, 255] : [13, 16, 20]);
    const branco = [255, 255, 255];

    if (tema === 'claro') {
      const acc = ajustar(base, -1, (c) => contraste(c, bg) >= ALVO && contraste(c, branco) >= ALVO);
      return { acc: rgbParaHex(acc), texto: '#ffffff', fraco: `rgba(${acc.join(', ')}, .09)` };
    }

    const acc = ajustar(base, +1, (c) => contraste(c, bg) >= ALVO);
    // Texto do botao primario: o mesmo matiz, bem escuro -- como o #06231a do
    // verde. Se nem isso passar, preto.
    const [h, s] = rgbParaHsl(acc);
    const escuro = hslParaRgb([h, Math.min(s, 0.7), 0.08]);
    const texto = contraste(escuro, acc) >= ALVO ? escuro : [0, 0, 0];
    return { acc: rgbParaHex(acc), texto: rgbParaHex(texto), fraco: `rgba(${acc.join(', ')}, .10)` };
  }

  // A cor "parecida" com a de um status: so matiz, e so para cor com saturacao
  // de verdade -- um cinza nao confunde com nada.
  function parecidaCom(hex) {
    const rgb = hexParaRgb(hex);
    if (!rgb) return null;
    const [h, s] = rgbParaHsl(rgb);
    if (s < 0.25) return null;
    const estilo = getComputedStyle(document.documentElement);
    const status = [
      { nome: 'esperando', token: '--warn' },
      { nome: 'erro', token: '--danger' },
    ];
    for (const st of status) {
      const c = lerCor(estilo.getPropertyValue(st.token));
      if (!c) continue;
      const [hs] = rgbParaHsl(c);
      const d = Math.abs(h - hs);
      if (Math.min(d, 360 - d) < 25) return st.nome;
    }
    return null;
  }

  // ---------------------------------------------------------- aplicar

  const TOKENS = ['--acc', '--accd', '--acc-texto'];
  let atual = PADRAO;

  function normalizar(hex) {
    const rgb = hexParaRgb(hex);
    return rgb ? rgbParaHex(rgb) : PADRAO;
  }

  // Le o fundo do tema que esta valendo AGORA. Por isso quem chama e o
  // `aplicarTema()` do casca, DEPOIS de trocar a classe `claro`.
  function aplicar(hex) {
    atual = normalizar(hex);
    const raiz = document.documentElement;
    const tema = raiz.classList.contains('claro') ? 'claro' : 'escuro';

    if (atual === PADRAO) {
      for (const t of TOKENS) raiz.style.removeProperty(t);
    } else {
      const fundo = lerCor(getComputedStyle(raiz).getPropertyValue('--bg1'));
      const d = derivar(atual, tema, fundo);
      raiz.style.setProperty('--acc', d.acc);
      raiz.style.setProperty('--accd', d.fraco);
      raiz.style.setProperty('--acc-texto', d.texto);
    }

    // O terminal e escuro nos DOIS temas, entao o cursor usa sempre a variante
    // do tema escuro. So o cursor: o verde ANSI e cor do programa, nao do app.
    const cursor = atual === PADRAO ? PADRAO : derivar(atual, 'escuro').acc;
    window.OrqPainel?.definirCursor?.(cursor);
  }

  // ---------------------------------------------------------- seletor

  const elOverlay = document.getElementById('acento');
  const elGrade = document.getElementById('acento-grade');
  const elLivre = document.getElementById('acento-livre');
  const elValor = document.getElementById('acento-valor');
  const elAviso = document.getElementById('acento-aviso');
  const btnPadrao = document.getElementById('acento-padrao');
  const btnPronto = document.getElementById('acento-pronto');

  function fechar() {
    if (!elOverlay) return;
    elOverlay.hidden = true;
    // Uma previa do seletor de cor livre que nao virou `change` volta atras.
    aplicar(window.OrqCasca?.acento?.() || PADRAO);
  }

  function desenhar(hex) {
    const cor = normalizar(hex);
    elGrade.replaceChildren(...PRESETS.map((p) => {
      const b = document.createElement('button');
      b.className = 'cor-opcao' + (p.cor === cor ? ' ativa' : '');
      b.style.background = p.cor;
      b.title = p.nome;
      b.setAttribute('aria-label', p.nome);
      b.dataset.acento = p.cor;
      b.addEventListener('click', () => escolher(p.cor));
      return b;
    }));
    elLivre.value = cor;
    elValor.textContent = cor;
    btnPadrao.classList.toggle('ativa', cor === PADRAO);

    const parecida = parecidaCom(cor);
    elAviso.hidden = !parecida;
    elAviso.textContent = parecida
      ? `Parecida com a cor de “${parecida}”: a bolinha de rodando acompanha esta cor, e as duas podem se confundir.`
      : '';
  }

  function escolher(hex) {
    const cor = normalizar(hex);
    window.OrqCasca.mudar({ acento: cor });
    desenhar(cor);
  }

  function abrir() {
    if (!elOverlay) return;
    elOverlay.hidden = false;
    desenhar(window.OrqCasca?.acento?.() || PADRAO);
  }

  // `input` e PREVIA (dispara a cada movimento do seletor do sistema); so o
  // `change` grava -- senao arrastar no seletor reescreveria o ui.json dezenas
  // de vezes por segundo.
  elLivre?.addEventListener('input', () => {
    aplicar(elLivre.value);
    elValor.textContent = normalizar(elLivre.value);
  });
  elLivre?.addEventListener('change', () => escolher(elLivre.value));
  btnPadrao?.addEventListener('click', () => escolher(PADRAO));
  btnPronto?.addEventListener('click', fechar);
  if (elOverlay) window.OrqOverlays?.registrar(elOverlay, fechar);

  window.OrqAcento = {
    PADRAO, PRESETS, ALVO,
    aplicar, derivar, contraste, hexParaRgb, normalizar, parecidaCom,
    abrir, fechar, atual: () => atual,
    aberto: () => elOverlay?.hidden === false,
  };

  // O casca pode ter lido o ui.json antes deste arquivo carregar; aplica o que
  // ele ja sabe.
  aplicar(window.OrqCasca?.acento?.() || PADRAO);
})();
