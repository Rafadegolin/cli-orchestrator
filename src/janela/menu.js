'use strict';

// Menu suspenso generico (redesign R2/R3): o "..." da linha da sessao na
// lateral e o "..." do cabecalho do painel. Mesmo visual do `.menu-ctx` do
// botao direito (copiar.js) e do menu do chip de branch (branch.js).
//
// Um elemento so, criado sob demanda. Fecha no clique fora, no Esc, no blur da
// janela e na rolagem. O Esc vai em CAPTURA com stopPropagation, no molde do
// menu do copiar.js: em bolha ele fecharia o menu E chegaria ao PTY.
//
// Uso: OrqMenu.abrir([{ rotulo, acao, perigo }], x, y)

(() => {
  let el = null;

  function fechar() {
    if (el) el.hidden = true;
  }

  function garantir() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'menu-ctx menu-acoes';
    el.hidden = true;
    document.getElementById('app').append(el);
    window.addEventListener('mousedown', (ev) => {
      if (!el.hidden && !el.contains(ev.target)) fechar();
    }, true);
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el.hidden) {
        ev.stopPropagation();
        fechar();
      }
    }, true);
    window.addEventListener('blur', fechar);
    window.addEventListener('scroll', fechar, true);
    return el;
  }

  function abrir(itens, x, y) {
    const menu = garantir();
    menu.replaceChildren(...itens.filter(Boolean).map((it) => {
      const b = document.createElement('button');
      b.textContent = it.rotulo;
      if (it.perigo) b.className = 'perigo';
      b.addEventListener('click', () => {
        fechar();
        it.acao();
      });
      return b;
    }));
    menu.hidden = false;
    const larg = menu.offsetWidth;
    const alt = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - larg - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - alt - 8))}px`;
    menu.querySelector('button')?.focus();
  }

  // Abre ancorado embaixo de um elemento (o botao que o chamou).
  function abrirEm(alvo, itens) {
    const r = alvo.getBoundingClientRect();
    abrir(itens, r.left, r.bottom + 4);
  }

  window.OrqMenu = { abrir, abrirEm, fechar, aberto: () => Boolean(el && !el.hidden) };
})();
