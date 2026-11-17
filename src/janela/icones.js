'use strict';

// Icones de linha do redesign premium (R0). Um traco so (1,7 em 24 unidades),
// cantos e pontas arredondados, cor de `currentColor` -- o icone herda a cor do
// botao, e um tema novo nao precisa de icone novo.
//
// SVG inline, e nao fonte nem arquivo: o CSP e `font-src 'self'`, o app tem de
// abrir sem internet, e um <img> nao herdaria `currentColor`.
//
// Uso: `OrqIcones.svg('branch')` devolve um <svg class="ico"> pronto para
// `append`. `classe` extra e opcional ('ico-s' para 14px).

(() => {
  const NS = 'http://www.w3.org/2000/svg';

  // Conteudo de cada icone dentro de um viewBox 0 0 24 24.
  const FORMAS = {
    grade: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    mapa: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 11 7.6-4M8.2 13l7.6 4"/>',
    issue: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5"/>',
    historico: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    notas: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    pasta: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'pasta-mais': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-6 4-12 8"/>',
    pr: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 8v8M18 16V9a2 2 0 0 0-2-2h-4"/><path d="m14 5-2 2 2 2"/>',
    arquivo: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M12 10v6"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    menu: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
    filtro: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    atualizar: '<path d="M20 11a8 8 0 0 0-14.9-3.9L3 9M4 13a8 8 0 0 0 14.9 3.9L21 15"/><path d="M3 4v5h5M21 20v-5h-5"/>',
    gerar: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    lixeira: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    sino: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    lateral: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    inspetor: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    terminal: '<path d="m5 8 4 4-4 4M12 16h7"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    externo: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    voltar: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    'seta-cima': '<path d="M12 19V5M6 11l6-6 6 6"/>',
    'seta-baixo': '<path d="m6 9 6 6 6-6"/>',
    'seta-direita': '<path d="m9 6 6 6-6 6"/>',
    copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  };

  function svg(nome, classe) {
    const forma = FORMAS[nome];
    if (!forma) throw new Error(`icone desconhecido: ${nome}`);
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('class', classe ? `ico ${classe}` : 'ico');
    el.innerHTML = forma;
    return el;
  }

  window.OrqIcones = { svg, nomes: () => Object.keys(FORMAS) };
})();
