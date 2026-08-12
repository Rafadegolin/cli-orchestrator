'use strict';

// O mapa: os mesmos painéis, posicionados livremente, com as ligacoes
// desenhadas entre eles.
//
// A REGRA QUE DECIDE O DESENHO TODO: o terminal NUNCA e escalado. Um
// `transform: scale()` no container borra o texto do xterm e nao re-rasteriza a
// textura do WebGL -- e a armadilha classica de terminal dentro de canvas. Por
// isso nao ha zoom continuo aqui. Ha dois estados:
//
//   1:1          painéis de verdade, terminais vivos, arrastaveis
//   visao geral  os mesmos painéis viram CARTOES em escala reduzida
//
// Na visao geral o terminal nao encolhe: ele e TROCADO por um cartao. Sem
// escala, sem borrao. E nada se perde -- painel fora da vista ja para de
// desenhar e acumula num buffer desde a Fase 6.1.
//
// TROCAR DE MODO NAO RECRIA PAINEL NENHUM. O xterm e dono do proprio DOM; os
// painéis continuam no mesmo pai e so mudam de posicionamento. Recriar
// destruiria os terminais.

(() => {
  const elApp = document.getElementById('app');
  const elConteudo = document.getElementById('conteudo');
  const elGrade = document.getElementById('grade');

  const LARGURA = 420;
  const ALTURA = 300;
  const FOLGA = 40;

  // A malha do encaixe, e a MESMA do padrao de bolinhas do fundo (o
  // `background-size: 20px` do #grade em modo mapa). Arrastar e redimensionar
  // caem nos pontos que voce esta vendo, entao os painéis ficam alinhados entre
  // si sem ninguem mirar.
  const MALHA = 20;
  // Minimos em multiplos da malha. 280 fica acima do @container de 260px, entao
  // encolher um painel ao maximo ainda deixa a pill do projeto no cabecalho.
  const MIN_L = 280;
  const MIN_A = 180;

  const encaixar = (n) => Math.round(n / MALHA) * MALHA;

  let svg = null;

  const painéis = () => [...(window.OrqPainel?.painelPorId.values() || [])];

  function modo() {
    return elApp.dataset.modo || 'grade';
  }

  function visaoGeral() {
    return elApp.dataset.visao === 'geral';
  }

  // O tamanho de cada painel, uma leitura por redesenho.
  //
  // No 1:1 ele vem do MODELO (p.w / p.h) -- de graca, e e o que permite
  // redimensionar. Na visao geral o painel e um cartao de altura automatica
  // decidida pelo CSS, entao ali nao ha modelo nenhum e o jeito e medir. Antes
  // isto era 420x300 fixo nos dois casos, e as linhas de ligacao terminavam
  // longe dos cartoes.
  function medidas() {
    const geral = visaoGeral();
    const m = new Map();
    for (const p of painéis()) {
      m.set(p.id, geral
        ? { w: p.el.offsetWidth, h: p.el.offsetHeight }
        : { w: p.w || LARGURA, h: p.h || ALTURA });
    }
    return m;
  }

  // Quem nunca foi arrastado ganha uma posicao em grade, para o mapa nao nascer
  // com tudo empilhado no canto.
  function arrumarQuemNaoTemLugar() {
    const porLinha = Math.max(1, Math.floor((elConteudo.clientWidth - FOLGA) / (LARGURA + FOLGA)));
    let vaga = 0;

    for (const p of painéis()) {
      // Tamanho e posicao sao independentes: um painel restaurado de um
      // sessao.json antigo tem x/y e nao tem w/h.
      if (!Number.isFinite(p.w)) p.w = LARGURA;
      if (!Number.isFinite(p.h)) p.h = ALTURA;

      if (Number.isFinite(p.x) && Number.isFinite(p.y)) continue;
      // A vaga cai na malha sozinha: FOLGA, LARGURA+FOLGA e ALTURA+FOLGA sao
      // todos multiplos de 20.
      p.x = FOLGA + (vaga % porLinha) * (LARGURA + FOLGA);
      p.y = FOLGA + Math.floor(vaga / porLinha) * (ALTURA + FOLGA);
      vaga += 1;
    }
  }

  function aplicarPosicoes() {
    const geral = visaoGeral();

    for (const p of painéis()) {
      p.el.style.left = `${p.x || 0}px`;
      p.el.style.top = `${p.y || 0}px`;
      // Na visao geral quem manda no tamanho e o CSS (260px de largura, altura
      // automatica). Estilo inline vence folha de estilo, entao ele TEM de sair
      // -- senao o cartao sai do tamanho do painel.
      if (geral) {
        p.el.style.width = '';
        p.el.style.height = '';
      } else {
        p.el.style.width = `${p.w || LARGURA}px`;
        p.el.style.height = `${p.h || ALTURA}px`;
      }
    }

    // A area de rolagem tem de acompanhar o painel mais distante -- e agora cada
    // um tem o seu tamanho, entao a conta e por painel.
    const tam = medidas();
    const cantos = painéis().map((p) => {
      const t = tam.get(p.id) || { w: LARGURA, h: ALTURA };
      return { x: (p.x || 0) + t.w, y: (p.y || 0) + t.h };
    });
    const maxX = Math.max(0, ...cantos.map((c) => c.x));
    const maxY = Math.max(0, ...cantos.map((c) => c.y));
    elGrade.style.width = `${maxX + FOLGA}px`;
    elGrade.style.height = `${maxY + FOLGA}px`;
  }

  function garantirSvg() {
    if (svg && svg.isConnected) return svg;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'mapa-linhas';
    elGrade.prepend(svg);
    return svg;
  }

  // Uma linha por par ligado. As ligacoes sao entre PASTAS, entao o par se
  // resolve por `painelEm` -- o mesmo caminho que a feature de ligar usa.
  function desenharLinhas() {
    const s = garantirSvg();
    s.setAttribute('width', elGrade.style.width || '100%');
    s.setAttribute('height', elGrade.style.height || '100%');
    s.replaceChildren();

    if (modo() !== 'mapa') return;

    const tam = medidas();
    const centro = (p) => {
      const t = tam.get(p.id) || { w: LARGURA, h: ALTURA };
      return { x: (p.x || 0) + t.w / 2, y: (p.y || 0) + t.h / 2 };
    };

    const feitas = new Set();
    for (const p of painéis()) {
      for (const caminho of p.ligacoes || []) {
        const outro = window.OrqLigacoes?.painelEm(caminho);
        if (!outro || outro.id === p.id) continue;

        const chave = [p.id, outro.id].sort().join('|');
        if (feitas.has(chave)) continue;
        feitas.add(chave);

        const a = centro(p);
        const b = centro(outro);
        const linha = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        linha.setAttribute('x1', String(a.x));
        linha.setAttribute('y1', String(a.y));
        linha.setAttribute('x2', String(b.x));
        linha.setAttribute('y2', String(b.y));
        linha.setAttribute('class', 'mapa-linha');
        linha.dataset.de = p.id;
        linha.dataset.para = outro.id;
        s.append(linha);
      }
    }
  }

  // Arrastar e redimensionar sao continuos, e redesenhar o SVG inteiro a cada
  // mousemove poe um rebuild dentro do laco de eventos. Um quadro basta: o olho
  // nao ve mais que isso, e a leitura de tamanho da visao geral passa a ser uma
  // por quadro em vez de uma por evento.
  let quadro = 0;
  function agendarLinhas() {
    if (quadro) return;
    quadro = requestAnimationFrame(() => { quadro = 0; desenharLinhas(); });
  }

  function redesenhar() {
    if (modo() !== 'mapa') return;
    arrumarQuemNaoTemLugar();
    aplicarPosicoes();
    desenharLinhas();
  }

  // -------------------------------------------- arrastar e redimensionar

  let arrastando = null;
  let redimensionando = null;

  function painelDoElemento(el) {
    return window.OrqPainel.painelPorId.get(el?.closest('.painel')?.dataset.id);
  }

  function aoPressionar(ev) {
    if (modo() !== 'mapa') return;

    // A alca vem primeiro: ela fica no canto inferior direito, dentro do painel,
    // e nao tem nada a ver com o cabecalho.
    const alca = ev.target.closest('.painel-alca');
    if (alca) {
      // Na visao geral o cartao tem altura automatica -- nao ha tamanho para
      // mexer, e o CSS ja esconde a alca. Este teste e a rede.
      if (visaoGeral()) return;
      const p = painelDoElemento(alca);
      if (!p) return;
      redimensionando = {
        p,
        x0: ev.clientX,
        y0: ev.clientY,
        w0: p.w || LARGURA,
        h0: p.h || ALTURA,
      };
      p.el.classList.add('redimensionando');
      ev.preventDefault();
      return;
    }

    // So pelo cabecalho: o corpo e o terminal, e arrastar dali roubaria a
    // selecao de texto.
    const cab = ev.target.closest('.painel-cab');
    if (!cab || ev.target.closest('button')) return;

    const el = cab.closest('.painel');
    const p = window.OrqPainel.painelPorId.get(el?.dataset.id);
    if (!p) return;

    arrastando = { p, dx: ev.clientX - (p.x || 0), dy: ev.clientY - (p.y || 0) };
    el.classList.add('arrastando');
    ev.preventDefault();
  }

  function aoMover(ev) {
    if (redimensionando) {
      const { p, x0, y0, w0, h0 } = redimensionando;
      p.w = Math.max(MIN_L, encaixar(w0 + ev.clientX - x0));
      p.h = Math.max(MIN_A, encaixar(h0 + ev.clientY - y0));
      p.el.style.width = `${p.w}px`;
      p.el.style.height = `${p.h}px`;
      // O fit() nao entra aqui: o ResizeObserver do painel ja dispara sozinho e
      // o debounce de 100ms dele espera voce parar de arrastar.
      agendarLinhas();
      return;
    }

    if (!arrastando) return;
    const { p, dx, dy } = arrastando;
    p.x = Math.max(0, encaixar(ev.clientX - dx));
    p.y = Math.max(0, encaixar(ev.clientY - dy));
    p.el.style.left = `${p.x}px`;
    p.el.style.top = `${p.y}px`;
    agendarLinhas();
  }

  function aoSoltar() {
    const alvo = redimensionando?.p || arrastando?.p;
    if (!alvo) return;

    alvo.el.classList.remove('arrastando', 'redimensionando');
    const mudouTamanho = Boolean(redimensionando);
    arrastando = null;
    redimensionando = null;

    aplicarPosicoes();
    desenharLinhas();
    // Explicito depois de redimensionar: o ResizeObserver ja teria pedido, mas
    // depender dele para o ultimo ajuste e depender de o navegador entregar um
    // evento que ele pode ter coalescido.
    if (mudouTamanho) alvo.agendarAjuste();
    window.OrqGrade?.salvarSessao?.();
  }

  // Entrada por codigo (paleta, testes): mesmo encaixe e mesmos minimos do
  // arrasto, para nao existirem dois caminhos com regras diferentes.
  function definirTamanho(id, l, a) {
    const p = window.OrqPainel.painelPorId.get(id);
    if (!p) return null;
    p.w = Math.max(MIN_L, encaixar(Number(l) || 0));
    p.h = Math.max(MIN_A, encaixar(Number(a) || 0));
    redesenhar();
    p.agendarAjuste();
    window.OrqGrade?.salvarSessao?.();
    return { w: p.w, h: p.h };
  }

  elGrade.addEventListener('mousedown', aoPressionar);
  window.addEventListener('mousemove', aoMover);
  window.addEventListener('mouseup', aoSoltar);

  // ---------------------------------------------------------------- modos

  function definirModo(novo) {
    const alvo = novo === 'mapa' ? 'mapa' : 'grade';
    elApp.dataset.modo = alvo;

    if (alvo === 'grade') {
      // Devolve o layout para a grade: as posicoes ficam guardadas nos painéis
      // e voltam intactas quando voce voltar ao mapa.
      elGrade.style.width = '';
      elGrade.style.height = '';
      for (const p of painéis()) {
        p.el.style.left = '';
        p.el.style.top = '';
        // O tamanho tambem tem de sair do inline, senao a grade herdaria os
        // 420x300 do mapa e a densidade deixaria de mandar na altura.
        p.el.style.width = '';
        p.el.style.height = '';
      }
      if (svg) svg.replaceChildren();
    } else {
      redesenhar();
    }

    // O painel muda de tamanho entre os modos, entao o terminal precisa refluir
    // -- cada um com o proprio debounce, como sempre.
    for (const p of painéis()) p.agendarAjuste();
    // Marcar os controles E PARTE DE TROCAR DE MODO, nao tarefa de quem chama:
    // deixar isso a cargo do chamador e garantir que uma hora alguem esquece.
    marcarControles();
    window.OrqGrade?.salvarSessao?.();
    return alvo;
  }

  function alternarModo() {
    return definirModo(modo() === 'mapa' ? 'grade' : 'mapa');
  }

  function definirVisao(geral) {
    elApp.dataset.visao = geral ? 'geral' : 'perto';
    // Sem escala no terminal: a visao geral TROCA o painel por um cartao (CSS),
    // entao aqui so o tamanho da area muda.
    redesenhar();
    for (const p of painéis()) p.agendarAjuste();
    marcarControles();
  }

  function alternarVisao() {
    const geral = elApp.dataset.visao !== 'geral';
    definirVisao(geral);
    return geral;
  }

  // ------------------------------------------------------------- controles

  const elModos = document.getElementById('modos');
  const btnVisao = document.getElementById('btn-visao');

  function marcarControles() {
    const atual = modo();
    for (const b of elModos?.querySelectorAll('button') || []) {
      b.classList.toggle('ativa', b.dataset.modo === atual);
    }
    // A visao geral so faz sentido no mapa; na grade a densidade ja cumpre esse
    // papel, e dois controles para a mesma coisa e um a mais.
    if (btnVisao) {
      btnVisao.hidden = atual !== 'mapa';
      btnVisao.classList.toggle('ativa', elApp.dataset.visao === 'geral');
    }
  }

  elModos?.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-modo]');
    if (!b) return;
    definirModo(b.dataset.modo);
    marcarControles();
  });

  btnVisao?.addEventListener('click', () => {
    alternarVisao();
    marcarControles();
  });

  // A lateral e o status mudam o tempo todo; as linhas acompanham.
  window.OrqCasca?.aoMudar(() => redesenhar());
  elConteudo.addEventListener('scroll', () => { if (modo() === 'mapa') agendarLinhas(); });
  marcarControles();

  window.OrqMapa = {
    modo, definirModo, alternarModo, redesenhar, desenharLinhas,
    definirVisao, alternarVisao, marcarControles, definirTamanho,
    visao: () => elApp.dataset.visao || 'perto',
    LARGURA, ALTURA, MALHA, MIN_L, MIN_A, encaixar,
    linhas: () => [...(svg?.querySelectorAll('.mapa-linha') || [])],
  };
})();
