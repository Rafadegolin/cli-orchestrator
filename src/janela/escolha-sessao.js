'use strict';

// Clicar num projeto: sessao nova, retomar uma conversa anterior, ou so um
// terminal na pasta.
//
// "Retomar" e `claude -r` sem valor, que -- medido no `--help` do CLI 2.1.220 --
// abre o SELETOR INTERATIVO dele dentro do painel. Ou seja, quem escolhe qual
// conversa e voce, na tela, e o app nao precisa saber id de sessao nenhum.
//
// "Abrir terminal" abre um painel na mesma pasta e NAO manda comando nenhum:
// serve para rodar o dev server, um `git log`, o que for, sem subir o Claude e
// sem gastar token. Nao ha caminho novo de criacao de painel aqui -- e a mesma
// costura do "Retomar", so que sem comando.
//
// A pergunta aparece SEMPRE, e isso mudou. Antes, com zero conversas guardadas,
// o clique abria sessao nova direto, com a justificativa de que "pergunta sem
// alternativa e so um clique a mais entre voce e o trabalho". Ela deixou de
// valer no dia em que passou a existir alternativa mesmo sem conversa nenhuma:
// terminal ou Claude. Com zero conversas quem sai e o "Retomar", que ai sim nao
// tem o que oferecer.
//
// Quem NAO passa por aqui continua nao passando, de proposito: a paleta e o
// botao "Nova sessao" chamam `abrirProjeto` direto, porque neles voce ja disse
// o que queria (ver o comentario na linha do clique, em projetos.js).

(() => {
  const COMANDO_RETOMAR = `${window.OrqShell.limpar()} && claude -r`;

  const elOverlay = document.getElementById('escolha-sessao');
  const elTitulo = document.getElementById('escolha-titulo');
  const elExplica = document.getElementById('escolha-explica');
  const btnTerminal = document.getElementById('escolha-terminal');
  const btnRetomar = document.getElementById('escolha-retomar');
  const btnNova = document.getElementById('escolha-nova');
  const btnCancelar = document.getElementById('escolha-cancelar');

  let projetoAtual = null;

  function fechar() {
    projetoAtual = null;
    elOverlay.hidden = true;
  }

  // Chamado pelo clique na linha do projeto. Devolve sempre null: a pergunta
  // fica na tela esperando voce em todos os casos.
  async function abrirProjetoComEscolha(id) {
    const p = (window.OrqProjetos.lista() || []).find((x) => x.id === id);
    if (!p || !p.existe) return null;

    const quantas = await window.orq.projetosConversas(p.caminho);

    projetoAtual = { id, nome: p.nome, quantas };
    elTitulo.textContent = `Abrir ${p.nome}`;
    elExplica.textContent = quantas
      ? `Este projeto tem ${quantas} ${quantas === 1
        ? 'conversa anterior guardada' : 'conversas anteriores guardadas'}. `
        + 'Retomar abre o seletor do próprio Claude para você escolher qual.'
      : 'Este projeto ainda não tem conversas guardadas. '
        + 'O terminal abre na pasta sem iniciar o Claude.';

    // `hidden` funciona aqui porque quem tem `display: flex` e o `.modal-acoes`,
    // e nao o botao: a regra global `[hidden] { display: none !important }` do
    // topo do estilo.css vence. Botao com `display` proprio seria a armadilha
    // numero 1 do CLAUDE.md, e e por isso que isto esta escrito.
    btnRetomar.hidden = !quantas;

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

  btnTerminal?.addEventListener('click', () => {
    const alvo = projetoAtual;
    fechar();
    // `terminal: true` e sentinela, e nao `comandoInicial: ''`: la dentro a
    // conta e `comandoInicial || montarComando(...)`, entao string vazia cairia
    // de volta no padrao e o Claude subiria assim mesmo.
    if (alvo) window.OrqProjetos.abrirProjeto(alvo.id, { terminal: true });
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
