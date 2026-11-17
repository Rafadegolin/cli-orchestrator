'use strict';

// Vistas (redesign R4): a grade de sessoes e as paginas proprias -- Issues,
// Historico, Configuracoes -- dividem o #conteudo, e trocar de uma para outra
// NUNCA recria painel nenhum.
//
// A grade e so ESCONDIDA. Dois mecanismos que ja existiam fazem isso ser seguro:
// - o `ajustar()` do painel pula tamanho 0, entao o ResizeObserver que dispara
//   ao esconder nao manda o PTY para 1 coluna (a TUI do Claude redesenharia
//   quebrada);
// - o IntersectionObserver (Fase 6.1) passa a ver o painel fora da vista, e a
//   saida vai para o buffer -- desenhada de uma vez ao voltar.
//
// Uma pagina se registra com `registrar(vista, { el, titulo, aoMostrar })`. O
// elemento dela mora em #paginas e fica `hidden` enquanto outra vista esta na
// tela. Configuracoes cobre tambem a lateral (tela cheia, com "Voltar ao app").
//
// Esc numa pagina volta para as sessoes -- mas so quando nenhum overlay esta
// aberto por cima: o Esc e de quem esta no topo, e o OrqOverlays ja trata o
// dele em captura antes deste ouvinte.

(() => {
  const elApp = document.getElementById('app');
  const elPaginas = document.getElementById('paginas');
  const elTituloVista = document.getElementById('barra-vista');
  const paginas = new Map();
  const ouvintes = [];
  let atual = 'sessoes';

  function registrar(vista, { el, titulo, aoMostrar, telaCheia = false }) {
    el.classList.add('pagina');
    el.dataset.vista = vista;
    el.hidden = true;
    if (el.parentElement !== elPaginas) elPaginas.append(el);
    paginas.set(vista, { el, titulo, aoMostrar, telaCheia });
  }

  function ir(vista) {
    if (vista !== 'sessoes' && !paginas.has(vista)) return atual;
    if (vista === atual) {
      // Clicar de novo na vista em que ja se esta recarrega o conteudo dela.
      paginas.get(vista)?.aoMostrar?.();
      return atual;
    }
    atual = vista;
    elApp.dataset.vista = vista;
    for (const [nome, p] of paginas) p.el.hidden = nome !== vista;
    const pagina = paginas.get(vista);
    elApp.toggleAttribute('data-tela-cheia', Boolean(pagina?.telaCheia));
    if (elTituloVista) elTituloVista.textContent = pagina?.titulo || 'Todas as sessões';
    for (const b of document.querySelectorAll('#lateral-nav [data-vista]')) {
      b.classList.toggle('ativo', b.dataset.vista === vista);
    }
    pagina?.aoMostrar?.();
    for (const fn of ouvintes) {
      try { fn(vista); } catch (err) { console.error('[vistas] ouvinte falhou:', err); }
    }
    return atual;
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || atual === 'sessoes') return;
    if (window.OrqOverlays?.noTopo?.()) return;
    if (window.OrqMenu?.aberto?.()) return;
    ev.preventDefault();
    ir('sessoes');
  });

  // Atalhos das vistas, em CAPTURA com stopPropagation (o molde do Ctrl+B): em
  // fase de bolha a tecla chegaria tambem ao PTY do terminal focado.
  window.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    let alvo = null;
    if (!ev.shiftKey && ev.key === ',') alvo = 'config';
    else if (ev.shiftKey && ev.key.toLowerCase() === 'i') alvo = 'issues';
    else if (ev.shiftKey && ev.key.toLowerCase() === 'h') alvo = 'historico';
    if (!alvo || !paginas.has(alvo)) return;
    ev.preventDefault();
    ev.stopPropagation();
    ir(atual === alvo ? 'sessoes' : alvo);
  }, true);

  elApp.dataset.vista = 'sessoes';

  window.OrqVistas = {
    registrar,
    ir,
    atual: () => atual,
    tem: (vista) => paginas.has(vista),
    aoMudar: (fn) => ouvintes.push(fn),
  };
})();
