'use strict';

// Trocar a cor de um projeto.
//
// A cor e sorteada pelo caminho, o que a torna estavel entre execucoes -- mas
// estavel nao e o mesmo que distinta: com dez tons, duas pastas caem na mesma
// cor cedo ou tarde, e uma cor que nao distingue nao serve para nada. Projeto
// novo ja nasce com a cor menos usada (isso e do processo principal); aqui e
// onde voce arruma o que ja esta cadastrado.

(() => {
  const CORES = 10;

  const elOverlay = document.getElementById('cor-projeto');
  const elTitulo = document.getElementById('cor-titulo');
  const elGrade = document.getElementById('cor-grade');
  const btnAuto = document.getElementById('cor-automatica');
  const btnFechar = document.getElementById('cor-pronto');

  let alvo = null;

  function fechar() {
    alvo = null;
    elOverlay.hidden = true;
  }

  // Quais cores JA estao em uso, para marcar as repetidas. Nao proibe: se voce
  // quer dois projetos verdes, o problema e seu -- mas nao pode ser sem querer.
  function emUso(exceto) {
    const usadas = new Map();
    for (const p of window.OrqProjetos.lista()) {
      if (p.id === exceto) continue;
      const t = window.OrqProjetos.tintaDoProjeto(p);
      usadas.set(t, (usadas.get(t) || 0) + 1);
    }
    return usadas;
  }

  function desenhar() {
    const p = window.OrqProjetos.lista().find((x) => x.id === alvo);
    if (!p) return fechar();

    elTitulo.textContent = `Cor de ${p.nome}`;
    const usadas = emUso(p.id);

    elGrade.replaceChildren(...Array.from({ length: CORES }, (_, i) => {
      const n = i + 1;
      const b = document.createElement('button');
      b.className = 'cor-opcao' + (p.cor === n ? ' ativa' : '');
      b.style.background = `var(--proj-${n})`;
      b.dataset.cor = String(n);

      const repetida = usadas.has(`var(--proj-${n})`);
      if (repetida) {
        b.classList.add('cor-repetida');
        b.title = 'Outro projeto já usa esta cor';
      }

      b.addEventListener('click', () => aplicar(n));
      return b;
    }));

    btnAuto.classList.toggle('ativa', !p.cor);
    btnAuto.title = p.cor
      ? 'Volta a sortear a cor pelo caminho da pasta'
      : 'Esta cor está sendo sorteada pelo caminho da pasta';
  }

  async function aplicar(cor) {
    const id = alvo;
    if (!id) return null;
    const r = await window.orq.projetosDefinirCor(id, cor);
    if (!r.ok) {
      window.OrqToast?.mostrar(r.erro || 'Não consegui trocar a cor');
      return r;
    }
    // Recarrega o cache e redesenha TUDO que carrega a cor: arvore, cartoes da
    // lateral e a faixa de cada painel aberto (`carregarProjetos` ja chama o
    // `mostrarProjeto` de todos).
    await window.OrqProjetos.carregarProjetos();
    window.OrqLateral?.redesenhar?.();
    desenhar();
    return r;
  }

  btnAuto?.addEventListener('click', () => aplicar(null));
  btnFechar?.addEventListener('click', fechar);
  window.OrqOverlays?.registrar(elOverlay, fechar);

  function abrir(id) {
    alvo = id;
    elOverlay.hidden = false;
    desenhar();
  }

  window.OrqCorProjeto = { abrir, fechar, aplicar, CORES, aberta: () => elOverlay.hidden === false };
})();
