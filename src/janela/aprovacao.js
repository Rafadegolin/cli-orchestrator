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
  //
  // As duas rodam sobre o texto ACHATADO (`OrqPainel.achatar`), e nao ancoradas
  // em inicio/fim de linha como antes. Motivo medido: a largura do painel manda
  // na quebra de linha do CLI, e num painel estreito a pergunta chega partida
  // ao meio -- ancorar em `^...$` fazia a faixa de Aprovar simplesmente nunca
  // aparecer ali, sem nada denunciando. Foi assim que a confirmacao do
  // /add-dir passou despercebida por muito tempo.
  const MARCA_PERGUNTA = /(Do you want to [^?]{1,240}\?)/;
  const MARCA_OPCAO = /(?:^|\s)[^\w\s]?\s*1\.\s+\S/;

  // Quanto esperar o prompt aparecer no buffer depois de o hook avisar. O hook
  // dispara quando o Claude MOSTRA o pedido, entao a folga e pequena.
  const MS_ESPERA_PROMPT = 4000;

  const painel = (id) => window.OrqPainel?.painelPorId.get(id);

  // O que esta na tela AGORA. Devolve a pergunta so quando os dois sinais
  // estao presentes -- e essa mesma leitura que autoriza escrever no PTY.
  function pedidoNaTela(id) {
    const p = painel(id);
    if (!p || p.dormindo || p.encerrado) return null;

    const texto = window.OrqPainel.achatar(p.textoDoBuffer());
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

  // ----------------------------------------------- o farejador dos 6 segundos

  // MEDIDO no binario do CLI 2.1.220: o hook de `permission_prompt` nao pode
  // chegar em menos de ~6 segundos.
  //
  //   function ADr(e, t) { useEffect(() => { UNr() }, []);            // zera o relogio
  //     Rc(() => { if (nkS(Q3f)) dAe({ message: e, notificationType: t }) }, ...) }
  //   var Q3f = 6000;  function nkS(e){ return Date.now() - MN() >= e }
  //
  // O `dAe` chama o `bz`, que E o disparo do hook. Ou seja: a bolinha amarela
  // tem um buraco de seis segundos que nenhum ajuste do app fecha pelo Canal 2.
  // (A tabela do CLAUDE.md media a perna hook -> bolinha, 71ms; a perna
  // CLI -> hook nunca tinha sido medida.)
  //
  // ISTO DOBRA A INVARIANTE "nunca deduza status lendo o Canal 1", e por isso a
  // excecao e estreita, e so tem UMA direcao:
  //
  //   - so ACENDE (`rodando` -> `esperando`), nunca apaga. Sair do amarelo
  //     continua sendo exclusividade do Canal 2, que e a autoridade.
  //   - so com as DUAS marcas na tela, as mesmas que ja autorizam escrever no
  //     PTY -- se elas bastam para responder, bastam para acender uma bolinha.
  //   - so em painel VISIVEL, e lendo so a tela (`textoDaTela`), sem flush:
  //     painel fora da vista nao pode pagar o custo nem perder a economia da
  //     Fase 6.1, e para ele o hook chega igual.
  //
  // De brinde, isto tambem cobre o `PostToolUse` atrasado que devolvia a sessao
  // ao verde com o prompt ainda na tela: no proximo giro o farejador reacende.
  const MS_FAREJAR = 1500;

  function candidatos() {
    return [...(window.OrqPainel?.painelPorId.values() || [])].filter(
      (p) => p.visivel && !p.dormindo && !p.encerrado && p.status === 'rodando',
    );
  }

  function farejar() {
    for (const p of candidatos()) {
      const texto = window.OrqPainel.achatar(p.textoDaTela());
      if (!MARCA_OPCAO.test(texto)) continue;
      const m = MARCA_PERGUNTA.exec(texto);
      if (!m) continue;

      // O hook, quando chegar, sobrescreve isto com a mesma coisa -- e traz o
      // `desde` de verdade. Aqui o objetivo e so nao ficar seis segundos calado.
      window.OrqLateral?.definirStatus(p.id, 'esperando', 'pedindo permissao',
        Date.now(), { pergunta: m[1].trim(), tipo: 'permissao' });
    }
  }

  const relogio = setInterval(() => {
    // Sai na primeira linha quando nao ha painel trabalhando a vista, que e o
    // estado normal da tela.
    if (candidatos().length) farejar();
  }, MS_FAREJAR);

  window.OrqAprovacao = {
    TECLA_APROVAR,
    MARCA_PERGUNTA,
    MARCA_OPCAO,
    MS_FAREJAR,
    pedidoNaTela,
    esperarPedido,
    aprovar,
    atualizar,
    farejar,
    pararDeFarejar: () => clearInterval(relogio),
  };
})();
