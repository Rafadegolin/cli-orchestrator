'use strict';

// Aprovar sem entrar no terminal.
//
// E a unica parte do app que escreve no PTY por conta propria, entao tudo aqui
// foi MEDIDO contra o CLI real, nao presumido:
//
//  1. O prompt de permissao tem esta forma:
//
//        Do you want to create marca.txt?
//        ❯ 1. Yes
//          2. Yes, allow all edits during this session (shift+tab)
//          3. No
//        Esc to cancel · Tab to amend
//
//     A linha "Do you want to ...?" e a pergunta de verdade -- e o que a faixa
//     mostra, porque aprovar sem saber o que se aprova nao e aprovar.
//
//  2. O `message` do hook e generico ("Claude needs your permission"): serve de
//     reserva enquanto o buffer nao e lido, nunca de rotulo final.
//
//  3. `\r` SOZINHO NAO APROVA. Medido: o Enter deixa o prompt identico na tela
//     e a acao nao acontece. Quem aceita a opcao 1 e o DIGITO `1`, sozinho, sem
//     Enter depois. (E diferente da confirmacao do /add-dir, que responde ao
//     Enter -- sao dois widgets diferentes, e por isso os dois foram medidos.)
//
// Consequencia boa do item 3: se a trava falhar e o `1` for escrito sem o
// prompt na tela, ele vira o caractere "1" na caixa de entrada do Claude --
// visivel, inofensivo e NAO enviado. Um Enter as cegas, que era o desenho
// inicial, mandaria mensagem vazia.

(() => {
  // Nunca a opcao 2 ("allow all edits during this session"): mudaria o
  // comportamento da sessao alem deste pedido, sem o usuario ter pedido isso.
  // Mesma regra ja aplicada no /add-dir.
  const TECLA_APROVAR = '1';

  // Duas marcas, e as duas precisam estar presentes: a pergunta sozinha pode
  // sobreviver no scrollback depois de respondida, e a lista de opcoes sozinha
  // apareceria em qualquer menu do CLI.
  const MARCA_PERGUNTA = /^\s*(Do you want to .+\?)\s*$/m;
  const MARCA_OPCAO = /^\s*[^\w\s]?\s*1\.\s+\S/m;

  // Quanto esperar o prompt aparecer no buffer depois de o hook avisar. O hook
  // dispara quando o Claude MOSTRA o pedido, entao a folga e pequena.
  const MS_ESPERA_PROMPT = 4000;

  const painel = (id) => window.OrqPainel?.painelPorId.get(id);

  // O que esta na tela AGORA. Devolve a pergunta so quando os dois sinais
  // estao presentes -- e essa mesma leitura que autoriza escrever no PTY.
  function pedidoNaTela(id) {
    const p = painel(id);
    if (!p || p.dormindo || p.encerrado) return null;

    const texto = p.textoDoBuffer();
    if (!MARCA_OPCAO.test(texto)) return null;

    const m = MARCA_PERGUNTA.exec(texto);
    if (!m) return null;

    return { pergunta: m[1].trim() };
  }

  async function esperarPedido(id, ms = MS_ESPERA_PROMPT) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      const achado = pedidoNaTela(id);
      if (achado) return achado;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  }

  // A trava. Reconfere no momento do clique, e nao no momento em que a faixa
  // apareceu: entre o usuario responder no proprio terminal e o hook avisar o
  // app existe uma janela de cerca de um segundo em que a faixa ainda esta la.
  function aprovar(id) {
    const p = painel(id);
    if (!p) return { ok: false, motivo: 'painel não existe mais' };

    const pedido = pedidoNaTela(id);
    if (!pedido) {
      // NAO ESCREVE NADA. Leva voce ao terminal, que e onde a resposta esta.
      p.focar();
      window.OrqToast?.mostrar('Não achei o pedido na tela; responda no terminal');
      return { ok: false, motivo: 'sem pedido na tela' };
    }

    window.orq.escrever(id, TECLA_APROVAR);
    window.OrqToast?.mostrar(`Aprovado em ${p.feature}`);
    return { ok: true, pergunta: pedido.pergunta };
  }

  // Chamado pela lateral a cada mudanca de status. Decide se a faixa existe.
  function atualizar(id, { status, tipo, pergunta } = {}) {
    const p = painel(id);
    if (!p) return;

    if (status !== 'esperando' || p.dormindo) {
      p.limparAprovacao();
      return;
    }

    // `permissao` tem o que aprovar; `ocioso` esta so esperando voce digitar.
    const podeAprovar = tipo === 'permissao';
    p.mostrarAprovacao({
      pergunta: pergunta || 'Esperando você',
      aoAprovar: podeAprovar ? () => aprovar(id) : null,
      aoVer: () => p.focar(),
    });

    // O rotulo comeca com a frase generica do hook e e trocado pela pergunta
    // de verdade assim que ela aparece no buffer.
    if (podeAprovar) {
      esperarPedido(id).then((achado) => {
        if (achado && p.status === 'esperando') p.atualizarPergunta(achado.pergunta);
      });
    }
  }

  window.OrqAprovacao = {
    TECLA_APROVAR,
    MARCA_PERGUNTA,
    MARCA_OPCAO,
    pedidoNaTela,
    esperarPedido,
    aprovar,
    atualizar,
  };
})();
