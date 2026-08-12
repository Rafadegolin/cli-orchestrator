'use strict';

// Alt + setas: andar de um terminal para outro sem tirar a mao do teclado.
//
// FASE DE CAPTURA COM stopPropagation, e isto nao e preferencia de estilo.
// Medido no xterm 5.5 empacotado: ele reescreve Alt+Seta para `\x1b[1;5D` (que e
// Ctrl+Seta, "palavra para tras") e manda para o PTY. Em fase de bolha o byte ja
// teria ido embora antes de o app ver a tecla -- e a caixa de entrada do Claude
// mexeria o cursor junto. E o mesmo caminho do Ctrl+B da lateral.
//
// A ESCOLHA DO ALVO E POR GEOMETRIA, nao por indice na lista. Aritmetica de
// indice so funciona numa grade uniforme; aqui os painéis podem ter tamanhos
// diferentes (densidade personalizada) ou posicao livre (mapa). Medir retangulo
// funciona nos tres modos com o mesmo codigo.

(() => {
  const DIRECOES = {
    ArrowLeft: 'esq',
    ArrowRight: 'dir',
    ArrowUp: 'cima',
    ArrowDown: 'baixo',
  };

  const painéis = () => [...(window.OrqPainel?.painelPorId.values() || [])]
    .filter((p) => !p.encerrado && p.el.offsetParent !== null);

  const centro = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  // O vizinho na direcao pedida: entre os que estao daquele lado, o mais
  // proximo -- com o desvio na outra dimensao pesando mais que a distancia na
  // direcao do movimento, senao um painel longe e quase alinhado perde para um
  // perto e completamente deslocado.
  function vizinho(de, direcao) {
    const a = centro(de.el);
    let melhor = null;
    let melhorCusto = Infinity;

    for (const p of painéis()) {
      if (p === de) continue;
      const b = centro(p.el);
      const dx = b.x - a.x;
      const dy = b.y - a.y;

      const avanco = { esq: -dx, dir: dx, cima: -dy, baixo: dy }[direcao];
      // Tolerancia de 4px: painéis alinhados podem diferir por arredondamento.
      if (avanco <= 4) continue;

      const desvio = (direcao === 'esq' || direcao === 'dir') ? Math.abs(dy) : Math.abs(dx);
      const custo = avanco + desvio * 3;
      if (custo < melhorCusto) {
        melhorCusto = custo;
        melhor = p;
      }
    }
    return melhor;
  }

  function navegar(direcao) {
    const lista = painéis();
    if (lista.length < 2) return null;

    const atual = window.OrqPainel.painelPorId.get(window.OrqGrade?.focado?.()) || lista[0];
    const alvo = vizinho(atual, direcao);
    if (!alvo) return null;

    window.OrqGrade.focarPainel(alvo.id);
    // O `#conteudo` rola: sem isto, pular para um painel fora da vista poria o
    // foco em algo que voce nao esta vendo.
    alvo.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return alvo.id;
  }

  window.addEventListener('keydown', (ev) => {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const direcao = DIRECOES[ev.key];
    if (!direcao) return;

    // Campo de texto do app (nome da feature, busca da paleta, caminho do
    // projeto) fica com as setas: la elas movem o cursor, e ninguem espera que
    // o foco pule de terminal enquanto digita um nome.
    const alvo = document.activeElement;
    const noTerminal = Boolean(alvo?.closest?.('.painel-term'));
    if (!noTerminal && (alvo?.tagName === 'INPUT' || alvo?.isContentEditable)) return;

    ev.preventDefault();
    ev.stopPropagation();
    navegar(direcao);
  }, true);

  window.OrqNavegar = { navegar, vizinho, DIRECOES };
})();
