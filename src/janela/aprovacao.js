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
  // AS FORMAS DE PEDIDO QUE O APP RECONHECE, e o que ele faz com cada uma.
  //
  // Isto era uma pergunta so e uma tecla fixa, e os dois viraram mentira quando
  // apareceu o segundo formato. O prompt de PLANO diz "Would you like to
  // proceed?" -- nao casava com nada, entao clicar em Aprovar caia direto no
  // "Nao achei o pedido na tela", com a faixa exibindo a frase generica do hook.
  //
  // E ampliar a marca teria sido PIOR que o bug: ali a opcao 1 e "Yes, and use
  // auto mode", que liga o modo automatico da sessao inteira. Aprovar por
  // POSICAO ("e sempre a 1") escalaria permissao sem ninguem pedir -- a mesma
  // coisa que o app ja recusa na opcao 2 do prompt de permissao e no "remember"
  // do /add-dir. Por isso o plano entra como forma RECONHECIDA e NAO APROVAVEL:
  // a faixa mostra a pergunta certa e some o botao, porque escolher entre "auto
  // mode" e "manually approve" e decisao de quem esta trabalhando, nao do app.
  const FORMAS = [
    {
      nome: 'permissao',
      // A forma medida contra o CLI 2.1.220:
      //     Do you want to create marca.txt?
      //     ❯ 1. Yes
      //       2. Yes, allow all edits during this session (shift+tab)
      //       3. No
      pergunta: /(Do you want to [^?]{1,240}\?)/,
      aprovavel: true,
      // Nunca a 2 ("allow all edits during this session"): mudaria o
      // comportamento da sessao alem deste pedido.
      tecla: '1',
      rotuloOpcao: '1. Yes',
    },
    {
      nome: 'plano',
      //     Claude has written up a plan and is ready to execute. Would you like to proceed?
      //     > 1. Yes, and use auto mode
      //       2. Yes, manually approve edits
      //       3. Tell Claude what to change
      pergunta: /(Claude has written up a plan[^?]{0,240}\?|Would you like to proceed\?)/,
      aprovavel: false,
    },
  ];

  // A tecla do caso comum. Exportada porque e o numero que a ajuda e o teste
  // conferem; quem decide de verdade e a forma lida na tela.
  const TECLA_APROVAR = FORMAS[0].tecla;
  const MARCA_PERGUNTA = FORMAS[0].pergunta;

  // A segunda marca: a lista de opcoes. Sozinha ela apareceria em qualquer menu
  // do CLI, e por isso nunca vale sem uma pergunta junto.
  //
  // Roda sobre o texto ACHATADO (`OrqPainel.achatar`) e NAO e ancorada em
  // inicio/fim de linha. Motivo medido: a largura do painel manda na quebra de
  // linha do CLI, e num painel estreito a pergunta chega partida ao meio --
  // ancorar em `^...$` fazia a faixa nunca aparecer ali, sem nada denunciando.
  const MARCA_OPCAO = /(?:^|\s)[^\w\s]?\s*1\.\s+\S/;

  // O SINAL DE QUE A SESSAO ESTA TRABALHANDO, e a peca que faltava.
  //
  // O relato: painel amarelo dizendo "esperando ha 43s" com o terminal
  // mostrando `* Fluttering… (1m 8s · ↓ 3.9k tokens)`. O prompt ja tinha sido
  // respondido e continuava rolando na tela -- indistinguivel de um pendente
  // para quem so procura as duas marcas.
  //
  // Este sinal so aparece enquanto ha algo em curso para interromper, e nunca
  // enquanto o CLI espera uma resposta. E ele que faz o farejador ter as duas
  // maos: nao acende por cima de quem voltou a trabalhar, e apaga quando o
  // trabalho aparece.
  const MARCA_TRABALHANDO = /esc to interrupt|[↓↑]\s*[\d.,]+k?\s*tokens/i;

  // Quanto esperar o prompt aparecer no buffer depois de o hook avisar. O hook
  // dispara quando o Claude MOSTRA o pedido, entao a folga e pequena.
  const MS_ESPERA_PROMPT = 4000;

  const painel = (id) => window.OrqPainel?.painelPorId.get(id);

  // Le um pedido de um texto JA ACHATADO. Funcao pura: e o que permite testar
  // as marcas contra o texto capturado no spike sem subir terminal nenhum.
  //
  // Entre duas formas na mesma tela vence a que aparece MAIS TARDE -- a de
  // baixo e a atual, a de cima e o que ja rolou.
  function lerPedido(texto) {
    if (!MARCA_OPCAO.test(texto)) return null;

    let achado = null;
    for (const f of FORMAS) {
      const m = f.pergunta.exec(texto);
      if (!m) continue;
      if (achado && m.index < achado.indice) continue;
      achado = {
        pergunta: m[1].trim(),
        forma: f.nome,
        aprovavel: f.aprovavel,
        tecla: f.tecla || '',
        rotuloOpcao: f.rotuloOpcao || '',
        indice: m.index,
      };
    }
    return achado;
  }

  // O que esta na TELA agora -- e essa mesma leitura que autoriza escrever no
  // PTY.
  //
  // Le a tela, e nao mais `textoDoBuffer()`. O buffer inclui as 3000 linhas de
  // scrollback e `exec` devolve o PRIMEIRO match, entao a trava podia estar
  // conferindo uma pergunta de dez minutos atras e liberando um "1" em cima do
  // que estivesse na tela. E o mesmo defeito que `esperarNovoNoBuffer` ja
  // consertou para o /add-dir, e aqui era pior: aqui o texto velho vira escrita
  // no terminal de alguem.
  //
  // Com `flush`, porque decidir por texto pendente e decidir pelo passado.
  function pedidoNaTela(id) {
    const p = painel(id);
    if (!p || p.dormindo || p.encerrado) return null;
    return lerPedido(window.OrqPainel.achatar(p.textoDaTela({ flush: true })));
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

    // Forma reconhecida que este app NAO responde. Chegar aqui e raro (a faixa
    // ja tira o botao quando le a tela), mas o clique pode acontecer no segundo
    // entre a faixa acender e a leitura voltar -- e a trava e no clique.
    if (!pedido.aprovavel) {
      p.focar();
      window.OrqToast?.mostrar('Este pedido muda o modo da sessão; responda no terminal');
      return { ok: false, motivo: 'forma nao aprovavel', forma: pedido.forma };
    }

    window.orq.escrever(id, pedido.tecla);
    window.OrqToast?.mostrar(`Aprovado em ${p.feature}`);
    return { ok: true, pergunta: pedido.pergunta, forma: pedido.forma };
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

    // O rotulo comeca com a frase generica do hook ("Claude Code needs your
    // permission") e e trocado pela pergunta de verdade assim que ela aparece
    // na tela. E e nesse mesmo momento que o botao some, se a forma lida for
    // uma que este app nao responde.
    //
    // O botao nasce presente porque o caso comum E o prompt de permissao, e
    // esperar a leitura para mostra-lo custaria um segundo de faixa sem acao no
    // caminho que importa. Quem protege o intervalo e a trava do `aprovar()`.
    if (podeAprovar) {
      esperarPedido(id).then((achado) => {
        if (!achado || p.status !== 'esperando') return;
        p.atualizarPedido({
          pergunta: achado.pergunta,
          aprovavel: achado.aprovavel,
          rotuloOpcao: achado.rotuloOpcao,
        });
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
  // ISTO DOBRA A INVARIANTE "nunca deduza status lendo o Canal 1", e a excecao
  // e estreita: so painel VISIVEL, lendo so a tela (`textoDaTela`) e sem flush
  // -- painel fora da vista nao pode pagar o custo nem perder a economia da
  // Fase 6.1, e para ele o hook chega igual.
  //
  // ELE PASSOU A TER DUAS MAOS, e essa foi a revisao consciente da regra "so o
  // Canal 2 apaga". O relato que forcou isso: painel amarelo dizendo "esperando
  // ha 43s" com o Claude visivelmente trabalhando ha um minuto. Duas causas
  // somadas, e nenhuma se resolvia so acendendo:
  //
  //  1. O prompt RESPONDIDO continua rolando na tela por um tempo. Para quem so
  //     procura as duas marcas, ele e identico a um pendente -- e o farejador
  //     reacendia o amarelo a cada 1,5s por cima de uma sessao que ja voltara a
  //     trabalhar. O comentario antigo aqui chamava isso de recurso.
  //  2. Do outro lado, o Canal 2 nao tinha como desfazer: ver `estado:farejado`
  //     no index.js. O amarelo ficava preso ate um `Stop`.
  //
  // A assimetria do custo de errar e o que decide a forma das duas condicoes:
  // acender a toa e ruido na tela, apagar a toa ESCONDE uma sessao bloqueada.
  // Por isso nunca se apaga pela AUSENCIA do prompt -- so pela PRESENCA do
  // sinal de trabalho, que e afirmativo e some assim que o CLI volta a esperar.
  //
  // Nas duas direcoes o main e avisado, senao volta a haver dois donos da
  // verdade -- que e a causa 2 acima.
  const MS_FAREJAR = 1500;

  function candidatos() {
    return [...(window.OrqPainel?.painelPorId.values() || [])].filter(
      (p) => p.visivel && !p.dormindo && !p.encerrado
        && (p.status === 'rodando' || p.status === 'esperando'),
    );
  }

  // Um lugar so para os dois lados: a janela pinta na hora, o main fica sabendo.
  function anunciar(p, status, motivo, extra = {}) {
    window.OrqLateral?.definirStatus(p.id, status, motivo, Date.now(), extra);
    window.orq?.estadoFarejado?.({ id: p.id, status, motivo, ...extra });
  }

  function farejar() {
    for (const p of candidatos()) {
      const texto = window.OrqPainel.achatar(p.textoDaTela());
      const trabalhando = MARCA_TRABALHANDO.test(texto);
      const pedido = lerPedido(texto);

      // ACENDER: o pedido esta na tela e nada indica que a sessao voltou a
      // trabalhar. O hook, quando chegar, sobrescreve isto com a mesma coisa --
      // aqui o objetivo e so nao ficar seis segundos calado.
      if (p.status === 'rodando') {
        if (pedido && !trabalhando) {
          anunciar(p, 'esperando', 'pedindo permissao',
            { pergunta: pedido.pergunta, tipo: 'permissao' });
        }
        continue;
      }

      // APAGAR: basta o sinal de trabalho, MESMO COM O PROMPT AINDA NA TELA.
      //
      // Essa ultima parte e o caso da captura que originou tudo isto, e exigir
      // que o prompt tivesse sumido deixava o bug de pe: o bloco ja respondido
      // continua rolando acima enquanto o spinner trabalha embaixo, entao os
      // dois sinais aparecem JUNTOS por um bom tempo.
      //
      // Quem desempata e o tempo verbal de cada marca. O prompt na tela e
      // historico -- pode ter sido respondido ha um minuto e ainda estar
      // visivel. O sinal de trabalho e sobre o AGORA: o CLI so oferece
      // interromper enquanto ha o que interromper, e ele some assim que a
      // sessao volta a esperar. Se ha trabalho em curso, ninguem esta bloqueado
      // -- seja qual for o texto que sobrou na tela.
      if (trabalhando) anunciar(p, 'rodando', '');
    }
  }

  const relogio = setInterval(() => {
    // Sai na primeira linha quando nao ha painel a vista em nenhum dos dois
    // estados que interessam, que e o caso normal da tela.
    if (candidatos().length) farejar();
  }, MS_FAREJAR);

  window.OrqAprovacao = {
    TECLA_APROVAR,
    MARCA_PERGUNTA,
    MARCA_OPCAO,
    MARCA_TRABALHANDO,
    FORMAS,
    MS_FAREJAR,
    lerPedido,
    pedidoNaTela,
    esperarPedido,
    aprovar,
    atualizar,
    farejar,
    pararDeFarejar: () => clearInterval(relogio),
  };
})();
