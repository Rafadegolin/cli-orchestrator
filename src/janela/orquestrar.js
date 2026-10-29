'use strict';

// O worker do orquestrador (Fase 10.6), do lado da janela.
//
// O processo principal ja conferiu quem chama, o teto de filhos, o ritmo e o
// projeto (`orquestracao.js`); aqui o slug e calculado, a worktree nasce do
// commit da coordenadora e o painel abre com o pedido na caixa do Claude. O
// veredito volta pelo `orqResposta`, e e o que o `curl` da coordenadora le.
//
// O molde e o `abrir-externo.js`, com tres diferencas que valem registro:
//  - painel ja aberto na pasta e RECUSA, nunca foco: entregar a uma
//    coordenadora uma sessao que ja existia daria a ela o trabalho de outra;
//  - sem `--prefill-b64`, ou sem caber na linha, tambem RECUSA: o pedido do
//    worker e o trabalho inteiro, e copiar para a area de transferencia nao
//    serve a quem nao esta olhando;
//  - quem manda o Enter que poe o worker para trabalhar e o MAIN, quando o
//    registro do CLI diz que a TUI subiu (ver `orquestracao.js`).
//
// IIFE, pelo escopo global compartilhado dos scripts classicos.

(() => {
  async function projetoPorId(id) {
    const lista = await window.orq.projetosListar();
    return (lista || []).find((p) => p.id === id) || null;
  }

  // O `id` do PEDIDO vai por ultimo: e por ele que o main acha quem espera, e
  // nada do veredito pode sobrescreve-lo.
  const responder = (p, r) => window.orq.orqResposta({ ...r, id: p.id });
  const recusar = (p, status, erro, texto) => responder(p, { ok: false, status, erro, texto });

  async function criar(p) {
    const projeto = await projetoPorId(p.projetoId);
    if (!projeto) return recusar(p, 409, 'sem-projeto', 'o projeto da coordenadora saiu do cadastro');

    // O slug e calculado AQUI, pela mesma razao do `abrir-externo.js`: ele e a
    // pasta, o `painel.feature` e o `--name` -- e e pelo `--name` que o main casa
    // o registro do CLI com este worker para mandar o Enter.
    const slug = window.OrqProjetos.slugFeature(p.nome);
    if (!slug) return recusar(p, 400, 'nome', `"${p.nome}" nao produz nome de pasta usavel`);

    const comandoInicial = window.OrqProjetos.montarComando(slug, true, { worktree: false });
    let podePrefill = false;
    try { podePrefill = await window.orq.claudePrefill(); } catch { podePrefill = false; }
    if (!podePrefill) {
      return recusar(p, 501, 'sem-prefill', 'o Claude Code instalado nao aceita --prefill-b64; atualize o CLI');
    }

    const r = await window.orq.worktreesCriar(projeto.caminho, slug, '', p.desde);
    if (!r || !r.ok) return recusar(p, 409, (r && r.motivo) || 'worktree', (r && r.texto) || 'nao consegui criar a worktree');

    if (window.OrqLigacoes?.painelEm?.(r.caminho)) {
      return recusar(p, 409, 'ja-existe', `ja ha um painel aberto em ${slug}; escolha outro nome`);
    }

    const setup = r.criada ? (projeto.scripts?.setup || '') : '';
    if (!window.OrqProjetos.prefillCabe(comandoInicial, p.prompt, { setup })) {
      return recusar(p, 413, 'prompt-grande', 'o prompt nao cabe na linha de comando do worker; encurte-o');
    }

    const painel = await window.OrqGrade.criarPainel({
      cwd: r.caminho,
      feature: slug,
      branch: r.branch,
      comandoInicial,
      promptInicial: p.prompt,
      setupInicial: setup,
      pai: p.pai,
    });
    for (const aviso of r.avisos || []) window.OrqToast?.mostrar(aviso);

    const coord = window.OrqPainel.painelPorId.get(p.pai);
    window.OrqToast?.mostrar(`${coord ? coord.feature : 'Uma sessão'} criou o worker ${slug}.`);
    // O contador da coordenadora na lateral, e a linha no mapa.
    window.OrqLateral?.redesenhar?.();
    window.OrqMapa?.redesenhar?.();

    responder(p, { ok: true, painel: painel.id, nome: slug, branch: r.branch, worktree: r.caminho });
  }

  // Colar e mandar o Enter separado: a TUI do Claude trata o Enter colado junto
  // como quebra de linha (`ligacoes.js`). O `colarTexto` ja recusa painel
  // dormindo ou em `esperando` e protege texto multilinha pelo bracketed paste.
  async function enviar(p) {
    const painel = window.OrqPainel.painelPorId.get(p.worker);
    if (!painel) return recusar(p, 409, 'encerrada', 'este worker foi fechado');
    if (!painel.colarTexto(p.texto, 'a instrução da coordenadora')) {
      return recusar(p, 409, 'recusado', 'o painel do worker recusou o texto (dormindo ou esperando)');
    }
    await new Promise((ok) => setTimeout(ok, window.OrqLigacoes.MS_ANTES_DO_ENTER));
    window.orq.escrever(painel.id, '\r');
    responder(p, { ok: true });
  }

  window.orq.aoPedidoOrq((p) => {
    const fazer = p.tipo === 'criar' ? criar : p.tipo === 'enviar' ? enviar : null;
    if (!fazer) return recusar(p, 400, 'tipo', 'pedido desconhecido');
    fazer(p).catch((err) => {
      // Nenhuma falha daqui pode deixar o `curl` da coordenadora pendurado.
      console.error('[orquestrar]', err);
      recusar(p, 500, 'falha', String((err && err.message) || err));
    });
  });

  window.orq.aoAvisoOrq((a) => {
    if (a && a.texto) window.OrqToast?.mostrar(a.texto);
  });

  // Ligar e desligar pela paleta. Ligar abre o dialogo nativo no main: grava
  // uma skill no ~/.claude, e isso so com o "sim" da pessoa.
  //
  // `ligadaAgora` e um ESPELHO para o rotulo da paleta, que e montado de forma
  // sincrona. Quem decide se as rotas respondem e o main, a cada pedido.
  let ligadaAgora = false;
  async function atualizar() {
    try { ligadaAgora = Boolean((await window.orq.orqSituacao())?.ligada); } catch { /* fica o que era */ }
    return ligadaAgora;
  }

  async function ligar() {
    const r = await window.orq.orqLigar();
    if (r && r.cancelado) return;
    if (!r || !r.ok) {
      window.OrqToast?.mostrar((r && r.texto) || 'Não consegui ligar a orquestração.');
      return;
    }
    await atualizar();
    window.OrqToast?.mostrar('Orquestração ligada. Peça a uma sessão para dividir uma tarefa em workers.');
  }

  async function desligar() {
    await window.orq.orqDesligar();
    await atualizar();
    window.OrqToast?.mostrar('Orquestração desligada e skill removida. Sessões já abertas podem lembrar dela até reiniciar.');
  }

  async function alternar() {
    return (await atualizar()) ? desligar() : ligar();
  }

  window.addEventListener('load', () => { atualizar(); });

  window.OrqOrquestrar = { ligar, desligar, alternar, ligada: () => ligadaAgora };
})();
