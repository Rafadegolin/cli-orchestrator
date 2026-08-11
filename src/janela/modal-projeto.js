'use strict';

// Cadastrar projeto: pasta e faixa de portas.
//
// O caminho e DIGITAVEL, e o botao Procurar so preenche o campo. Isso preserva
// a propriedade que o app ja tinha -- `projetos:adicionar` recebe o caminho
// pronto, sem abrir dialogo por dentro -- e de quebra torna o fluxo inteiro
// testavel, porque o CDP nao dirige dialogo nativo do Windows.

(() => {
  const elModal = document.getElementById('modal-projeto');
  const elCaminho = document.getElementById('projeto-caminho');
  const elFaixas = document.getElementById('projeto-faixas');
  const elErro = document.getElementById('projeto-erro');
  const btnProcurar = document.getElementById('projeto-procurar');
  const btnConfirmar = document.getElementById('projeto-confirmar');
  const btnCancelar = document.getElementById('projeto-cancelar');

  // Faixas afastadas de proposito: 100 portas dao 20 sessoes por projeto com o
  // bloco de 5, e o espaco entre elas evita que dois projetos se encostem
  // mesmo com muita sessao aberta.
  const FAIXAS = [
    [3100, 3199],
    [4000, 4099],
    [5200, 5299],
  ];

  let escolhida = 0;

  function desenharFaixas() {
    elFaixas.replaceChildren(...FAIXAS.map((f, i) => {
      const b = document.createElement('button');
      b.className = 'modal-faixa mono' + (i === escolhida ? ' ativa' : '');
      b.dataset.faixa = String(i);
      b.textContent = `${f[0]}–${f[1]}`;
      b.addEventListener('click', () => { escolhida = i; desenharFaixas(); });
      return b;
    }));
  }

  function mostrarErro(texto) {
    elErro.textContent = texto || '';
    elErro.hidden = !texto;
  }

  function abrir(caminho = '') {
    elCaminho.value = caminho;
    escolhida = 0;
    mostrarErro('');
    desenharFaixas();
    elModal.hidden = false;
    elCaminho.focus();
  }

  function fechar() {
    elModal.hidden = true;
    mostrarErro('');
  }

  async function procurar() {
    const escolhido = await window.orq.escolherPasta();
    if (escolhido) {
      elCaminho.value = escolhido;
      mostrarErro('');
    }
  }

  async function confirmar() {
    const caminho = (elCaminho.value || '').trim();
    if (!caminho) {
      mostrarErro('Diga a pasta do repositório.');
      elCaminho.focus();
      return null;
    }

    btnConfirmar.disabled = true;
    try {
      const r = await window.orq.projetosAdicionar(caminho, FAIXAS[escolhida]);
      // O principal e quem sabe se a pasta existe; a mensagem dele e melhor
      // que qualquer palpite daqui.
      if (r.erro) {
        mostrarErro(r.erro);
        return null;
      }
      await window.OrqProjetos?.carregarProjetos();
      fechar();
      window.OrqToast?.mostrar(r.novo
        ? `Projeto ${r.projeto.nome} cadastrado`
        : `${r.projeto.nome} já estava cadastrado`);
      return r;
    } finally {
      btnConfirmar.disabled = false;
    }
  }

  btnProcurar?.addEventListener('click', procurar);
  btnConfirmar?.addEventListener('click', confirmar);
  btnCancelar?.addEventListener('click', fechar);

  elCaminho?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); confirmar(); }
  });

  window.OrqOverlays?.registrar(elModal, fechar);

  window.OrqModalProjeto = {
    abrir, fechar, confirmar, procurar, FAIXAS,
    escolher: (i) => { escolhida = i; desenharFaixas(); },
    faixaEscolhida: () => FAIXAS[escolhida],
  };
})();
