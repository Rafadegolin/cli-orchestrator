'use strict';

// O pedido do Pronix Flow, do lado da janela.
//
// O processo principal ja resolveu `owner/repo` -> projeto cadastrado e ja
// deduplicou; aqui e onde o slug e calculado, a worktree e criada e o painel
// nasce. Depois manda o VEREDITO de volta, que e o que o `POST /abrir` responde.
//
// Dentro de uma IIFE, que e o caminho preferido para arquivo novo: `painel.js`,
// `grade.js` e `lateral.js` dividem um escopo lexico global, e o `teste:ui`
// falha se dois arquivos declararem o mesmo nome de topo.

(() => {
  // O SLUG E CALCULADO AQUI, e nao no processo principal.
  //
  // `slugFeature` produz um valor de que tres subsistemas dependem ao mesmo
  // tempo: o nome da pasta da worktree, o `painel.feature` e o `--name` do CLI
  // -- e e por esse ultimo que o `registro.js` casa a sessao do CLI com este
  // painel. Dois produtores do mesmo slug significam duas respostas em alguma
  // entrada, e o sintoma seria o `donoDe()` parar de casar em silencio, que e
  // exatamente a classe de bug que ele foi escrito para evitar.
  //
  // Somando: o `teste:ui` so enxerga `src/janela/*.js`, entao uma copia em
  // `src/main/` derivaria sem nada pegar -- a mesma armadilha do `projetoDe`.
  // Ao main cabe RECUSAR (`SLUG_VALIDO`, `branchValido`), nao produzir.
  const slugDe = (texto) => window.OrqProjetos.slugFeature(texto);

  // Le a lista FRESCA do processo principal, e nao o cache do renderer.
  //
  // Duas razoes, e a primeira e uma corrida real: com o app fechado e o deeplink
  // quem abre o app, entao o pedido chega enquanto `carregarProjetos()` ainda
  // esta no ar e o cache pode estar vazio -- e o sintoma seria "o projeto do
  // pedido saiu do cadastro" numa maquina onde ele esta. A segunda e que o cache
  // envelhece, e um IPC por pedido (que chega por clique de site, nao em rajada)
  // e barato demais para valer a economia.
  async function projetoPorId(id) {
    const lista = await window.orq.projetosListar();
    return (lista || []).find((p) => p.id === id) || null;
  }

  function responder(p, r) {
    window.orq.abrirResposta({ id: p.id, chave: p.chave, ...r });
  }

  function recusar(p, texto, erro = 'worktree', extra = {}) {
    window.OrqToast?.mostrar(texto);
    responder(p, { ok: false, erro, texto, ...extra });
  }

  async function aplicar(p) {
    const projeto = await projetoPorId(p.projetoId);
    if (!projeto) {
      recusar(p, 'O projeto do pedido saiu do cadastro.', 'projeto-sumiu');
      return;
    }

    const slug = slugDe(p.branch);
    if (!slug) {
      recusar(p, `"${p.branch}" nao produz nome de pasta usavel.`, 'branch-invalida', { status: 400 });
      return;
    }

    const r = await window.orq.worktreesCriar(projeto.caminho, slug, p.branch);
    if (!r || !r.ok) {
      const texto = (r && r.texto) || 'nao consegui criar a worktree';
      recusar(p, texto, (r && r.motivo) || 'worktree', {
        status: 409,
        ...(r && r.branchAtual ? { branchAtual: r.branchAtual } : {}),
      });
      return;
    }

    // Painel ja aberto nesta pasta: FOCA, nao duplica.
    //
    // `OrqLigacoes.painelEm` e a unica busca por cwd normalizada do renderer --
    // a do `retomar()` compara com `toLowerCase()` cru e so roda quando ha
    // sessao viva. Este ramo cobre o pedido repetido depois de a worktree ja
    // existir; o caso dos 3 segundos entre o deeplink e o POST e coberto antes,
    // pela deduplicacao do `externo.js`.
    const jaAberto = window.OrqLigacoes?.painelEm?.(r.caminho);
    if (jaAberto) {
      window.OrqGrade.focarPainel(jaAberto.id);
      responder(p, {
        ok: true, jaAberta: true, branch: r.branch, worktree: slug, promptPendente: false,
      });
      return;
    }

    // Sem `-w`: a worktree ja existe, e o `-w` criaria uma SEGUNDA dentro dela.
    // Mesmo caminho da implementacao dupla.
    const comandoInicial = window.OrqProjetos.montarComando(slug, true, { worktree: false });

    // A sonda vive no processo principal e e memoizada por execucao. Sem a flag,
    // a sessao abre igual e o prompt vai para a area de transferencia -- o que
    // nao pode acontecer e mandar `--prefill-b64` para um CLI que responderia
    // `unknown option` e SAIRIA, deixando um shell morto com bolinha verde.
    let podePrefill = false;
    try { podePrefill = await window.orq.claudePrefill(); } catch { podePrefill = false; }

    // E cabe na linha? O cmd.exe descarta MUDO qualquer comando acima de 8191
    // caracteres, e ali o Claude nem chegaria a subir -- ver o MAX_LINHA. Melhor
    // abrir a sessao sem o contexto e copiar para a area de transferencia.
    if (podePrefill && !window.OrqProjetos.prefillCabe(comandoInicial, p.prompt)) {
      podePrefill = false;
    }

    const promptInicial = podePrefill ? p.prompt : '';

    await window.OrqGrade.criarPainel({
      // A WORKTREE, e nao a raiz do projeto: e o que mantem `p.cwd` verdadeiro
      // para o `estado.js`, para o `painelEm()` e para o portao de "painel
      // aberto nesta pasta" que protege o arquivar.
      cwd: r.caminho,
      feature: slug,
      branch: r.branch,
      issue: p.issue,
      comandoInicial,
      promptInicial,
    });

    if (p.prompt && !podePrefill) {
      window.orq.copiar(p.prompt);
      window.OrqToast?.mostrar('Sessão aberta. O contexto da issue foi copiado — cole no prompt.');
    }

    for (const aviso of r.avisos || []) window.OrqToast?.mostrar(aviso);

    responder(p, {
      ok: true,
      branch: r.branch,
      // Nome curto, nunca o caminho: mandar o layout de diretorios da pessoa
      // para uma pagina web e gratuito.
      worktree: slug,
      promptPendente: Boolean(promptInicial),
    });
  }

  window.orq.aoPedidoAbrir((p) => {
    aplicar(p).catch((err) => {
      // Nenhuma falha daqui pode deixar o /abrir pendurado esperando o veredito.
      const texto = String((err && err.message) || err);
      console.error('[abrir-externo]', err);
      recusar(p, `Nao consegui abrir a sessao: ${texto}`, 'falha', { status: 500 });
    });
  });

  window.orq.aoAvisoAbrir((a) => {
    if (a && a.texto) window.OrqToast?.mostrar(a.texto);
  });

  // O SINAL DE PRONTO, e por que ele nao e o `did-finish-load` do main.
  //
  // Aquele diria que a pagina carregou, e nao que os modulos da janela existem.
  // Com o app fechado e o proprio deeplink quem abre o app, entao o pedido chega
  // no arranque -- e um pedido entregue antes de `OrqGrade` existir se perderia
  // sem erro nenhum.
  //
  // `load`, e nao o corpo do script, pela mesma razao que a `restaurarSessao()`
  // espera: `grade.js` e avaliado antes de `lateral.js`, e este arquivo e
  // avaliado antes de os dois terem terminado de montar o que exportam.
  //
  // A LISTA DE PROJETOS nao entra nesta condicao de proposito: `projetoPorId` a
  // le fresca do processo principal a cada pedido, entao esperar pelo cache aqui
  // so adiaria a entrega sem tornar nada mais correto.
  window.addEventListener('load', () => window.orq.externoPronto());
})();
