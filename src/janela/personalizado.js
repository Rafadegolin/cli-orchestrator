'use strict';

// A quarta densidade: um molde de tamanhos que voce desenha arrastando.
//
// As densidades 1, 2 e 3 dao a TODO painel o mesmo tamanho. O arranjo que falta
// e o desigual -- dois terminais grandes lado a lado e dois pequenos dividindo a
// terceira coluna. Aqui isso vira span de celulas do CSS Grid: cada painel
// recebe `grid-column: span C` e `grid-row: span R`, e o posicionamento
// automatico da grade acomoda o resto sozinho, sem nenhuma coordenada explicita.
//
// O MOLDE E POR POSICAO, NAO POR SESSAO. Ele guarda "o primeiro painel e grande,
// o terceiro e pequeno" -- e nao "a sessao auth-refresh e grande". Tamanho preso
// a uma feature morreria junto com ela; um molde vale para o proximo conjunto de
// sessoes que voce abrir. A consequencia honesta: com a ordenacao por Urgencia,
// a FORMA da tela fica parada e quem ocupa o slot grande muda conforme os status
// mudam.
//
// Tudo dentro de uma IIFE. Os scripts da janela dividem um escopo lexico global
// e nomes de topo repetidos entre arquivos sao SyntaxError silencioso.

(() => {
  const elApp = document.getElementById('app');
  const elGrade = document.getElementById('grade');

  // O mesmo `gap` do #grade no estilo.css. Sem ele a conversao de pixels para
  // celulas erra por uma celula inteira nas larguras maiores.
  const GAP = 12;
  const MAX_LINHAS = 4;

  const painéis = () => [...(window.OrqPainel?.painelPorId.values() || [])];
  const ativo = () => window.OrqCasca?.densidade() === 'p';

  function molde() {
    const m = window.OrqCasca?.ui().personalizado || {};
    return {
      cols: m.cols || 3,
      alturaLinha: m.alturaLinha || 160,
      celulas: Array.isArray(m.celulas) ? m.celulas.map((c) => ({ c: c.c || 1, r: c.r || 1 })) : [],
    };
  }

  // A ordem VISUAL, que e a que a grade usa para posicionar.
  //
  // `ordenarGrade()` escreve `style.order` e nunca move no do DOM, entao a ordem
  // do documento nao serve aqui: o molde tem de casar com o que esta na tela.
  function naOrdemDaTela() {
    return painéis()
      .map((p, i) => ({ p, ordem: Number(p.el.style.order), i }))
      .sort((a, b) => {
        const oa = Number.isFinite(a.ordem) ? a.ordem : a.i;
        const ob = Number.isFinite(b.ordem) ? b.ordem : b.i;
        return oa - ob || a.i - b.i;
      })
      .map((x) => x.p);
  }

  // Duas atribuicoes inline por painel, idempotentes. Chamado de novo a cada
  // mudanca de status (via ordenarGrade), entao tem de ser barato -- e e: nao le
  // layout nenhum.
  function aplicar() {
    const ligado = ativo();
    const m = molde();
    const lista = naOrdemDaTela();

    lista.forEach((p, i) => {
      if (!ligado) {
        p.el.style.gridColumn = '';
        p.el.style.gridRow = '';
        return;
      }
      // Posicao alem do molde entra 1x1: um molde de quatro slots nao pode
      // impedir voce de abrir o quinto painel.
      const cel = m.celulas[i] || { c: 1, r: 1 };
      p.el.style.gridColumn = `span ${Math.min(cel.c, m.cols)}`;
      p.el.style.gridRow = `span ${cel.r}`;
    });
  }

  // ------------------------------------------------------------- gravar

  function gravar(celulas) {
    const m = molde();
    window.OrqCasca.mudar({ personalizado: { ...m, celulas } });
  }

  function definirCelula(indice, c, r) {
    const m = molde();
    const celulas = [...m.celulas];
    // Preenche os buracos: mexer no 5o slot com o molde tendo 2 nao pode deixar
    // `undefined` no meio do array -- ele vai para o JSON e volta como null.
    while (celulas.length <= indice) celulas.push({ c: 1, r: 1 });
    celulas[indice] = {
      c: Math.min(Math.max(1, c), m.cols),
      r: Math.min(Math.max(1, r), MAX_LINHAS),
    };
    gravar(celulas);
    return celulas[indice];
  }

  function redefinir() {
    gravar([]);
    window.OrqToast?.mostrar('Layout personalizado redefinido: todos do mesmo tamanho');
  }

  // -------------------------------------------------------- redimensionar

  let arrasto = null;

  // Quanto mede uma celula AGORA. Vai a fonte (largura real do #grade) em vez de
  // guardar o valor: a janela muda de tamanho e a lateral pode abrir e fechar.
  function tamanhoDaCelula() {
    const m = molde();
    const largura = (elGrade.clientWidth - GAP * (m.cols - 1)) / m.cols;
    return { largura, altura: m.alturaLinha, cols: m.cols };
  }

  // Pixels -> span. O `+ GAP` dos dois lados existe porque N celulas ocupam
  // `N*celula + (N-1)*gap`: sem isso um painel de 2 celulas exatas arredondava
  // para 1.
  const emCelulas = (px, celula, teto) => Math.min(teto,
    Math.max(1, Math.round((px + GAP) / (celula + GAP))));

  function aoPressionar(ev) {
    if (!ativo() || window.OrqMapa?.modo() === 'mapa') return;
    const alca = ev.target.closest('.painel-alca');
    if (!alca) return;

    const el = alca.closest('.painel');
    const p = window.OrqPainel.painelPorId.get(el?.dataset.id);
    if (!p) return;

    const indice = naOrdemDaTela().indexOf(p);
    if (indice < 0) return;

    arrasto = {
      p,
      indice,
      x0: ev.clientX,
      y0: ev.clientY,
      l0: el.offsetWidth,
      a0: el.offsetHeight,
      c: 1,
      r: 1,
    };
    el.classList.add('redimensionando');
    ev.preventDefault();
  }

  function aoMover(ev) {
    if (!arrasto) return;
    const cel = tamanhoDaCelula();
    arrasto.c = emCelulas(arrasto.l0 + ev.clientX - arrasto.x0, cel.largura, cel.cols);
    arrasto.r = emCelulas(arrasto.a0 + ev.clientY - arrasto.y0, cel.altura, MAX_LINHAS);
    // Mostra ao vivo. O fit() do terminal vem do ResizeObserver, com o debounce
    // dele -- nada de chamar ajustar() por pixel arrastado.
    arrasto.p.el.style.gridColumn = `span ${arrasto.c}`;
    arrasto.p.el.style.gridRow = `span ${arrasto.r}`;
  }

  function aoSoltar() {
    if (!arrasto) return;
    const { p, indice, c, r } = arrasto;
    arrasto = null;
    p.el.classList.remove('redimensionando');
    // Gravar dispara `mudar()`, que reaplica o molde inteiro -- entao o estado
    // da tela passa a vir do molde salvo, e nao do que o arrasto deixou inline.
    definirCelula(indice, c, r);
    p.agendarAjuste();
  }

  elGrade.addEventListener('mousedown', aoPressionar);
  window.addEventListener('mousemove', aoMover);
  window.addEventListener('mouseup', aoSoltar);

  window.OrqPersonalizado = {
    aplicar, molde, definirCelula, redefinir, naOrdemDaTela, GAP, MAX_LINHAS,
    ativo,
  };

  // A grade pode ter nascido no slot 'p' (preferencia salva) antes deste arquivo
  // carregar: o casca.js chama `aplicar()` com optional chaining e naquele
  // momento nao havia ninguem para atender.
  if (elApp.dataset.densidade === 'p') aplicar();
})();
