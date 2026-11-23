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
  const elIcones = document.getElementById('icone-grade');
  const btnImagem = document.getElementById('icone-imagem');
  const btnPadrao = document.getElementById('icone-padrao');

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

    elTitulo.textContent = `Cor e ícone de ${p.nome}`;
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

    desenharIcones(p);
  }

  // A grade de icones, cada um ja na cor do projeto. Com imagem propria, ela
  // aparece primeiro, marcada.
  function desenharIcones(p) {
    const cor = window.OrqProjetos.tintaDoProjeto(p);
    const atual = p.iconeUrl ? null : (p.icone?.galeria || 'pasta');
    const opcoes = [];
    if (p.iconeUrl) {
      const b = document.createElement('button');
      b.className = 'icone-opcao ativa';
      b.title = 'Imagem do projeto';
      b.dataset.icone = 'imagem';
      const img = document.createElement('img');
      img.alt = '';
      img.src = p.iconeUrl;
      b.append(img);
      opcoes.push(b);
    }
    for (const nome of window.OrqIcones.GALERIA_PROJETO) {
      const b = document.createElement('button');
      b.className = 'icone-opcao' + (nome === atual ? ' ativa' : '');
      b.style.color = cor;
      b.dataset.icone = nome;
      b.title = nome;
      b.append(window.OrqIcones.svg(nome));
      b.addEventListener('click', () => aplicarIcone(nome === 'pasta' ? null : { galeria: nome }));
      opcoes.push(b);
    }
    elIcones.replaceChildren(...opcoes);
    btnPadrao.classList.toggle('ativa', !p.icone);
  }

  async function aplicarIcone(icone) {
    const id = alvo;
    if (!id) return null;
    const r = await window.orq.projetosDefinirIcone(id, icone);
    if (!r.ok) {
      window.OrqToast?.mostrar(r.erro || 'Não consegui trocar o ícone');
      return r;
    }
    await window.OrqProjetos.carregarProjetos();
    window.OrqLateral?.redesenhar?.();
    if (alvo === id) desenhar();
    return r;
  }

  async function escolherImagem() {
    const caminho = await window.orq.escolherImagem();
    if (!caminho) return null;
    return aplicarIcone({ imagem: caminho });
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
  btnImagem?.addEventListener('click', escolherImagem);
  btnPadrao?.addEventListener('click', () => aplicarIcone(null));
  btnFechar?.addEventListener('click', fechar);
  window.OrqOverlays?.registrar(elOverlay, fechar);

  function abrir(id) {
    alvo = id;
    elOverlay.hidden = false;
    desenhar();
  }

  window.OrqCorProjeto = { abrir, fechar, aplicar, aplicarIcone, CORES, aberta: () => elOverlay.hidden === false };
})();
