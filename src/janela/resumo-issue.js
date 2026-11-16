'use strict';

// Botao "Resumo" do painel: pede ao Claude da sessao a devolutiva ao
// solicitante e ela vai para o Pronix Flow como RASCUNHO (ver main/resumo.js).
//
// A issue e escolhida NO CLIQUE, e nao herdada de quem abriu o painel: na
// implementacao dupla o painel nasce sem issue, e cada repositorio pode ter a
// sua. As sugestoes saem do que o painel ja sabe -- a issue do chip, o nome da
// branch, da feature e das pastas (a sessao e as ligacoes) --, mais a inbox do
// Flow e um campo livre. Escolhida, ela vira o chip do painel (e vai para o
// sessao.json), e o proximo clique ja a sugere primeiro.

(() => {
  const elCaixa = document.getElementById('resumo');
  const elCorpo = document.getElementById('resumo-corpo');
  const btnFechar = document.getElementById('resumo-fechar');

  const MS_ANTES_DO_ENTER = 700;
  // KEY-N em qualquer posicao: `worktree-feature-TECH-3679`, `feature/TECH-1`,
  // `.claude/worktrees/feature-TECH-3680`. Mesma fronteira do Flow (item #17).
  const RE_IDENTIFICADOR = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})(?![0-9])/g;

  let painelAtual = null;
  let seq = 0;

  function criar(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
  }

  function botao(texto, classe, aoClicar) {
    const b = criar('button', classe, texto);
    b.type = 'button';
    b.addEventListener('click', aoClicar);
    return b;
  }

  // Sugestoes, na ordem de confianca, sem repetir.
  function candidatos(painel) {
    const vistos = new Map();
    const juntar = (id, origem) => {
      const chave = id.toUpperCase();
      if (!vistos.has(chave)) vistos.set(chave, origem);
    };
    if (painel.issue?.identificador) juntar(painel.issue.identificador, 'issue do painel');
    const fontes = [
      [painel.branch, 'branch'],
      [painel.feature, 'feature'],
      [painel.cwd, 'pasta da sessão'],
      ...(painel.ligacoes || []).map((l) => [typeof l === 'string' ? l : l?.caminho, 'repositório ligado']),
    ];
    for (const [texto, origem] of fontes) {
      for (const m of String(texto || '').matchAll(RE_IDENTIFICADOR)) juntar(`${m[1]}-${m[2]}`, origem);
    }
    return [...vistos].map(([id, origem]) => ({ id, origem }));
  }

  // O pedido vai COM Enter. Se o Claude saiu e o painel voltou ao shell, a linha
  // seria executada como comando -- entao so com a TUI do Claude na tela. Ela
  // liga o bracketed paste sozinha: o mesmo sinal que o `colarTexto` usa.
  function claudeNaTela(painel) {
    return !painel.dormindo && !painel.encerrado && painel.term?.modes?.bracketedPasteMode === true;
  }

  function fechar() {
    elCaixa.hidden = true;
    painelAtual = null;
    seq++;
  }

  function erro(texto) {
    const el = elCorpo.querySelector('.modal-erro');
    if (!el) return;
    el.textContent = texto || '';
    el.hidden = !texto;
  }

  function travar(sim) {
    for (const b of elCorpo.querySelectorAll('button, input')) b.disabled = sim;
  }

  async function gerar(identificador) {
    const painel = painelAtual;
    if (!painel) return;
    const id = String(identificador || '').trim();
    if (!id) { erro('Escolha ou digite uma issue.'); return; }

    // Antes de gastar a ida ao Flow: com o Claude trabalhando o pedido entraria
    // na fila dele no meio da tarefa, e o resumo sairia da tarefa pela metade.
    if (painel.status === 'rodando') {
      erro('O Claude ainda está trabalhando nesta sessão: espere ele terminar.');
      return;
    }
    if (painel.status === 'esperando') {
      erro('A sessão está esperando uma resposta sua: responda antes.');
      return;
    }
    if (!claudeNaTela(painel)) {
      erro('O Claude não está aberto neste painel: abra ou retome a sessão antes.');
      return;
    }

    travar(true);
    erro('');
    const minha = ++seq;
    const r = await window.orq.resumoPreparar(painel.id, id);
    if (minha !== seq) return;
    travar(false);
    if (!r || !r.ok) { erro((r && r.texto) || 'não deu para preparar o pedido'); return; }

    fechar();
    // Rechecado: a ida ao Flow leva tempo, e o Claude pode ter saido nesse meio.
    if (!claudeNaTela(painel)) {
      window.OrqToast?.mostrar('O Claude saiu deste painel: o pedido de devolutiva não foi enviado.');
      return;
    }
    // O `colarTexto` faz as recusas de sempre (dormindo, encerrada, esperando
    // resposta) e avisa por toast.
    if (!painel.colarTexto(r.prompt, 'o pedido de devolutiva')) return;
    await new Promise((ok) => setTimeout(ok, MS_ANTES_DO_ENTER));
    window.orq.escrever(painel.id, '\r');
    window.OrqToast?.mostrar(`Pedido de devolutiva de ${r.contexto.issue} enviado ao Claude`);

    // Vira o chip do painel quando ele ainda nao tinha issue.
    if (!painel.issue) {
      painel.issue = { repo: '', identificador: r.contexto.issue, titulo: r.contexto.titulo, url: r.contexto.url };
      painel.mostrarIssue();
      window.OrqGrade?.salvarSessao?.();
    }
  }

  function linhaIssue(id, rotulo, detalhe) {
    const linha = criar('div', 'inbox-linha');
    const textoEl = criar('div', 'inbox-texto');
    const topo = criar('div', 'inbox-topo');
    topo.append(criar('span', 'inbox-id', id));
    textoEl.append(topo, criar('div', 'inbox-titulo', rotulo));
    if (detalhe) textoEl.append(criar('div', 'inbox-meta', detalhe));
    const acoes = criar('div', 'inbox-acoes');
    acoes.append(botao('Usar', 'primario inbox-ver', () => gerar(id)));
    linha.append(textoEl, acoes);
    return linha;
  }

  function desenhar(painel) {
    const sugestoes = candidatos(painel);

    const explica = criar('p', 'modal-explica',
      'O Claude desta sessão escreve um resumo do que foi entregue, em linguagem de quem pediu, '
      + 'e ele entra como rascunho na issue do Flow. Escolha a issue que vai receber a devolutiva.');

    const lista = criar('div', 'inbox-lista resumo-lista');
    for (const s of sugestoes) lista.append(linhaIssue(s.id, `Sugerida pela ${s.origem}`, ''));

    const elInbox = criar('div', 'inbox-lista resumo-lista');
    elInbox.append(criar('p', 'inbox-meta', 'Carregando suas issues do Flow…'));

    const campo = criar('input', 'scripts-campo');
    campo.type = 'text';
    campo.spellcheck = false;
    campo.placeholder = 'Outra issue (ex.: TECH-123)';
    campo.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); gerar(campo.value); }
    });

    const elErro = criar('p', 'modal-erro');
    elErro.hidden = true;

    const acoes = criar('div', 'modal-acoes');
    acoes.append(botao('Usar esta', 'primario', () => gerar(campo.value)), botao('Cancelar', '', fechar));

    const partes = [explica];
    if (sugestoes.length) partes.push(criar('div', 'modal-rotulo', 'Desta sessão'), lista);
    partes.push(criar('div', 'modal-rotulo', 'Minhas issues no Flow'), elInbox,
      criar('div', 'modal-rotulo', 'Outra'), campo, elErro, acoes);
    elCorpo.replaceChildren(...partes);

    // Sem sugestao, o campo e o caminho; com, Enter no primeiro "Usar".
    if (sugestoes.length) lista.querySelector('button')?.focus();
    else campo.focus();

    const minha = seq;
    window.orq.flowIssues().then((r) => {
      if (minha !== seq || elCaixa.hidden) return;
      if (!r || !r.ok) {
        elInbox.replaceChildren(criar('p', 'inbox-meta', (r && r.texto) || 'não deu para ler o Flow'));
        return;
      }
      const ja = new Set(sugestoes.map((s) => s.id));
      const resto = r.issues.filter((i) => !ja.has(String(i.issue).toUpperCase()));
      if (!resto.length) {
        elInbox.replaceChildren(criar('p', 'inbox-meta', 'Nenhuma outra issue aberta atribuída a você.'));
        return;
      }
      elInbox.replaceChildren(...resto.map((i) => linhaIssue(i.issue, i.title, i.estado?.nome || '')));
    });
  }

  function abrir(painelId) {
    const painel = window.OrqPainel?.painelPorId.get(painelId);
    if (!painel) return;
    if (painel.tipoPainel === 'terminal') return;
    painelAtual = painel;
    seq++;
    elCaixa.hidden = false;
    desenhar(painel);
  }

  btnFechar.addEventListener('click', fechar);
  window.OrqOverlays?.registrar(elCaixa, fechar);

  // O curl do Claude entregou e o Flow gravou.
  window.orq.aoSalvarResumo((info) => {
    window.OrqToast?.mostrar(`Devolutiva salva como rascunho em ${info?.identificador || 'issue'}`);
  });

  window.OrqResumo = { abrir, candidatos };
})();
