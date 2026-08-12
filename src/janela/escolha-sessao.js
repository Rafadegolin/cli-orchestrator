'use strict';

// Clicar num projeto: sessao nova, ou retomar uma conversa anterior.
//
// "Retomar" e `claude -r` sem valor, que -- medido no `--help` do CLI 2.1.220 --
// abre o SELETOR INTERATIVO dele dentro do painel. Ou seja, quem escolhe qual
// conversa e voce, na tela, e o app nao precisa saber id de sessao nenhum.
//
// A pergunta so aparece quando ha o que retomar: com zero conversas guardadas,
// o clique abre sessao nova direto. Pergunta sem alternativa e so um clique a
// mais entre voce e o trabalho.

(() => {
  const COMANDO_RETOMAR = 'cls && claude -r';

  const elOverlay = document.getElementById('escolha-sessao');
  const elTitulo = document.getElementById('escolha-titulo');
  const elExplica = document.getElementById('escolha-explica');
  const btnRetomar = document.getElementById('escolha-retomar');
  const btnNova = document.getElementById('escolha-nova');
  const btnCancelar = document.getElementById('escolha-cancelar');

  let projetoAtual = null;

  function fechar() {
    projetoAtual = null;
    elOverlay.hidden = true;
  }

  // Chamado pelo clique na linha do projeto. Devolve o painel aberto, ou null
  // quando a pergunta ficou na tela esperando voce.
  async function abrirProjetoComEscolha(id) {
    const p = (window.OrqProjetos.lista() || []).find((x) => x.id === id);
    if (!p || !p.existe) return null;

    const quantas = await window.orq.projetosConversas(p.caminho);
    if (!quantas) return window.OrqProjetos.abrirProjeto(id);

    projetoAtual = { id, nome: p.nome, quantas };
    elTitulo.textContent = `Abrir ${p.nome}`;
    elExplica.textContent = `Este projeto tem ${quantas} ${quantas === 1
      ? 'conversa anterior guardada' : 'conversas anteriores guardadas'}. `
      + 'Retomar abre o seletor do próprio Claude para você escolher qual.';
    elOverlay.hidden = false;
    btnNova.focus();
    return null;
  }

  btnNova?.addEventListener('click', () => {
    const alvo = projetoAtual;
    fechar();
    if (alvo) window.OrqProjetos.abrirProjeto(alvo.id);
  });

  btnRetomar?.addEventListener('click', () => {
    const alvo = projetoAtual;
    fechar();
    // O `comandoInicial` sobrescrito e a costura que ja existia em
    // `abrirProjeto` -- nao ha caminho novo de criacao de painel aqui.
    if (alvo) window.OrqProjetos.abrirProjeto(alvo.id, { comandoInicial: COMANDO_RETOMAR });
  });

  btnCancelar?.addEventListener('click', fechar);
  window.OrqOverlays?.registrar(elOverlay, fechar);

  window.OrqEscolhaSessao = {
    COMANDO_RETOMAR,
    abrir: abrirProjetoComEscolha,
    fechar,
    aberta: () => elOverlay.hidden === false,
  };
})();
