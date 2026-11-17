'use strict';

// O painel Git a direita (redesign R7): alteracoes e commit, push e novo PR,
// e o PR com os checks e o merge -- da sessao FOCADA.
//
// FECHADO POR PADRAO (pedido do usuario: "nunca sempre ativo"). Abre pelo botao
// da barra de titulo, pelo chip de branch do cabecalho do painel ou por
// Ctrl+Shift+G, e a escolha fica no ui.json (`inspetor`).
//
// Quem decide e o processo principal: aqui so se desenha e se pede. Todo
// clique de escrita (commit, push, PR, merge) e relido la, no instante, e push
// e merge passam pelo dialogo nativo. Sem relogio: atualiza ao abrir, ao trocar
// de painel focado, quando o estado da branch daquele painel muda (o `Stop` da
// sessao) e no botao.

(() => {
  const elApp = document.getElementById('app');
  const elCorpo = document.getElementById('corpo');

  let aberto = false;
  let aba = 'alteracoes';
  let alvo = null;          // id do painel mostrado
  let dados = null;         // resposta do git:arquivos
  let pr = null;            // resposta do branch:pr
  let marcados = new Set(); // caminhos marcados para o commit
  let mensagem = '';
  let prForm = { titulo: '', corpo: '', base: '', rascunho: false, tocado: false };
  let seq = 0;
  let ocupado = '';

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
  function icob(icone, titulo, aoClicar, classe = '') {
    const b = botao('', `insp-icob ${classe}`.trim(), aoClicar);
    b.title = titulo;
    b.setAttribute('aria-label', titulo);
    b.append(window.OrqIcones.svg(icone, 'ico-s'));
    return b;
  }

  function haQuanto(ms) {
    if (!ms) return '';
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min}min`;
    const h = Math.round(min / 60);
    return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
  }

  // ------------------------------------------------------------ estrutura

  const el = criar('aside');
  el.id = 'inspetor';
  el.hidden = true;
  const topo = criar('div', 'insp-topo');
  const abas = criar('div', 'insp-abas');
  abas.setAttribute('role', 'tablist');
  const ABAS = [
    ['alteracoes', 'arquivo', 'Alterações'],
    ['git', 'branch', 'Git e novo PR'],
    ['pr', 'pr', 'PR e CI'],
  ];
  for (const [id, icone, rotulo] of ABAS) {
    const b = icob(icone, rotulo, () => { aba = id; desenhar(); carregarAba(); }, 'insp-aba');
    b.dataset.aba = id;
    b.setAttribute('role', 'tab');
    abas.append(b);
  }
  const elQuem = criar('span', 'insp-quem mono');
  const btnAtualizar = icob('atualizar', 'Atualizar', () => carregar(true));
  const btnFechar = icob('fechar', 'Fechar o painel Git (Ctrl+Shift+G)', () => alternar(false));
  topo.append(abas, elQuem, btnAtualizar, btnFechar);
  const corpo = criar('div', 'insp-corpo');
  el.append(topo, corpo);
  elCorpo.append(el);

  // ------------------------------------------------------------ dados

  function painelAlvo() {
    return alvo ? window.OrqPainel.painelPorId.get(alvo) : null;
  }

  function escolherAlvo() {
    const f = window.OrqGrade?.focado?.();
    const p = f && window.OrqPainel.painelPorId.get(f);
    if (p && p.tipoPainel !== 'notas') return f;
    // Sem foco: fica no que ja estava, se ainda existir.
    return alvo && window.OrqPainel.painelPorId.has(alvo) ? alvo : null;
  }

  async function carregar(forcar = false) {
    if (!aberto) return;
    const novo = escolherAlvo();
    if (novo !== alvo) {
      alvo = novo;
      dados = null;
      pr = null;
      marcados = new Set();
      mensagem = '';
      prForm = { titulo: '', corpo: '', base: '', rascunho: false, tocado: false };
    }
    if (!alvo) { desenhar(); return; }
    const minha = ++seq;
    if (forcar || !dados) desenhar();
    const r = await window.orq.gitArquivos(alvo);
    if (minha !== seq) return;
    const antes = new Set((dados?.arquivos || []).map((a) => a.caminho));
    dados = r;
    // Arquivo que APARECEU desde a ultima leitura entra marcado; o que a
    // pessoa desmarcou continua desmarcado.
    for (const a of r.arquivos || []) if (!antes.has(a.caminho)) marcados.add(a.caminho);
    for (const c of [...marcados]) if (!(r.arquivos || []).some((a) => a.caminho === c)) marcados.delete(c);
    await carregarAba();
    desenhar();
  }

  async function carregarAba() {
    if (!aberto || !alvo) return;
    if (aba === 'pr') {
      const minha = ++seq;
      pr = { carregando: true };
      desenhar();
      const r = await window.orq.branchPr(alvo);
      if (minha !== seq) return;
      pr = r;
      desenhar();
    }
  }

  // ------------------------------------------------------------ desenho

  function aviso(titulo, texto, tom = '') {
    const c = criar('div', `insp-aviso${tom ? ` insp-aviso-${tom}` : ''}`);
    c.append(criar('div', 'insp-aviso-titulo', titulo));
    if (texto) c.append(criar('div', 'insp-aviso-texto', texto));
    return c;
  }

  function cabecalhoBranch() {
    const l = dados?.local;
    const c = criar('div', 'insp-branch');
    const nome = criar('div', 'insp-branch-nome mono');
    nome.append(window.OrqIcones.svg('branch', 'ico-s'), document.createTextNode(l?.branch || '(sem branch)'));
    const partes = [];
    if (l?.base) partes.push(`a partir de ${l.base}`);
    if (l?.frente) partes.push(`${l.frente} à frente`);
    if (l && !l.upstream) partes.push('sem upstream');
    else if (l?.semPush) partes.push(`${l.semPush} sem push`);
    c.append(nome, criar('div', 'insp-branch-sub', partes.join(' · ')));
    return c;
  }

  function desenharAlteracoes() {
    const frag = document.createDocumentFragment();
    frag.append(cabecalhoBranch());
    const arquivos = dados?.arquivos || [];
    const titulo = criar('div', 'insp-rotulo');
    const somaMais = arquivos.reduce((s, a) => s + (a.mais || 0), 0);
    const somaMenos = arquivos.reduce((s, a) => s + (a.menos || 0), 0);
    titulo.append(criar('span', '', `Não commitado · ${arquivos.length}`));
    const cont = criar('span', 'insp-contagem mono');
    cont.append(criar('span', 'insp-mais', `+${somaMais}`), document.createTextNode(' '), criar('span', 'insp-menos', `−${somaMenos}`));
    titulo.append(cont);
    frag.append(titulo);

    if (!arquivos.length) {
      frag.append(aviso('Nada para commitar', 'A árvore desta sessão está limpa.'));
      return frag;
    }

    const lista = criar('div', 'insp-lista');
    lista.id = 'insp-arquivos';
    for (const a of arquivos) {
      const linha = criar('label', 'insp-arquivo');
      const caixa = criar('input');
      caixa.type = 'checkbox';
      caixa.checked = marcados.has(a.caminho);
      caixa.addEventListener('change', () => {
        if (caixa.checked) marcados.add(a.caminho); else marcados.delete(a.caminho);
        desenhar();
      });
      const tipo = criar('span', `insp-tipo insp-tipo-${a.tipo === '?' ? 'novo' : a.tipo}`, a.tipo === '?' ? 'A' : a.tipo);
      const nome = criar('span', 'insp-arquivo-nome mono', a.caminho);
      nome.title = a.caminho;
      const linhas = criar('span', 'insp-arquivo-linhas mono',
        a.mais == null ? 'novo' : `+${a.mais} −${a.menos}`);
      linha.append(caixa, tipo, nome, linhas);
      lista.append(linha);
    }
    frag.append(lista);

    const rotMsg = criar('div', 'insp-rotulo');
    const lab = criar('label', '', 'Mensagem do commit');
    lab.htmlFor = 'insp-mensagem';
    const gerar = botao('', 'insp-botao insp-botao-p', async () => {
      ocupado = 'gerar';
      desenhar();
      const p = painelAlvo();
      const r = await window.orq.gitGerar({ id: alvo, modo: 'commit', issue: p?.issue?.identificador || '' });
      ocupado = '';
      if (r.ok) mensagem = r.texto;
      else window.OrqToast?.mostrar(r.texto || 'Não deu para gerar.');
      desenhar();
    });
    gerar.append(window.OrqIcones.svg('gerar', 'ico-s'), document.createTextNode(ocupado === 'gerar' ? 'Gerando…' : 'Gerar'));
    gerar.disabled = Boolean(ocupado);
    gerar.title = 'Escreve a mensagem com o Claude Code em segundo plano (custa alguns centavos de tokens)';
    rotMsg.append(lab, gerar);
    const area = criar('textarea', 'insp-campo insp-area');
    area.id = 'insp-mensagem';
    area.rows = 4;
    area.value = mensagem;
    area.placeholder = 'Resumo em uma linha\n\nO porquê, se precisar.';
    area.addEventListener('input', () => { mensagem = area.value; });
    frag.append(rotMsg, area);

    const n = arquivos.filter((a) => marcados.has(a.caminho)).length;
    const acoes = criar('div', 'insp-acoes');
    const commitar = (push) => async () => {
      ocupado = 'commit';
      desenhar();
      const r = await window.orq.gitCommit({ id: alvo, mensagem, arquivos: [...marcados], push });
      ocupado = '';
      if (r.ok) {
        mensagem = '';
        window.OrqToast?.mostrar(`Commit ${r.sha} com ${r.arquivos} ${r.arquivos === 1 ? 'arquivo' : 'arquivos'}`
          + (r.push && r.push.ok ? ' e push feito' : ''));
        if (r.push && !r.push.ok && !r.push.cancelado) window.OrqToast?.mostrar(r.push.texto);
        await carregar(true);
      } else {
        window.OrqToast?.mostrar(r.texto || 'O commit não foi feito.');
        desenhar();
      }
    };
    const bCommit = botao(ocupado === 'commit' ? 'Commitando…' : `Commit de ${n} ${n === 1 ? 'arquivo' : 'arquivos'}`,
      'insp-botao insp-primario', commitar(false));
    bCommit.id = 'insp-commit';
    bCommit.disabled = Boolean(ocupado) || !n;
    const bPush = botao('Commit e push', 'insp-botao', commitar(true));
    bPush.disabled = Boolean(ocupado) || !n;
    acoes.append(bCommit, bPush);
    frag.append(acoes);
    frag.append(criar('p', 'insp-nota', 'Só os arquivos marcados entram. Push sempre pergunta antes, e nunca usa --force.'));
    return frag;
  }

  function desenharGit() {
    const frag = document.createDocumentFragment();
    frag.append(cabecalhoBranch());
    const l = dados?.local;
    if (!l || !l.branch) {
      frag.append(aviso('Sem branch', 'Esta pasta não está num branch (HEAD destacado ou não é git).'));
      return frag;
    }
    const estadoChip = window.OrqBranch?.de?.(alvo);
    const prAberto = estadoChip?.pr && estadoChip.pr.estado === 'aberto' ? estadoChip.pr : null;

    if (!l.upstream || l.semPush) {
      const n = l.upstream ? l.semPush : l.frente;
      frag.append(aviso(l.upstream ? `A branch tem ${n} ${n === 1 ? 'commit não enviado' : 'commits não enviados'}`
        : 'A branch ainda não está no remoto',
      'O push vai antes do pull request. Nunca com --force.', 'espera'));
    }

    const commits = dados?.commits || [];
    if (commits.length) {
      const lista = criar('div', 'insp-lista');
      for (const c of commits) {
        const linha = criar('div', 'insp-commit');
        linha.append(criar('span', 'insp-sha mono', c.sha), criar('span', 'insp-commit-assunto', c.assunto),
          criar('span', 'insp-commit-quando', haQuanto(c.em)));
        lista.append(linha);
      }
      frag.append(lista);
    }

    const bPush = botao('Enviar (push)', 'insp-botao', async () => {
      const r = await window.orq.branchPush(alvo, true);
      if (r && r.ok) window.OrqToast?.mostrar(`Push feito em ${r.branch}`);
      else if (r && !r.cancelado && r.texto) window.OrqToast?.mostrar(r.texto);
      carregar(true);
    });
    bPush.disabled = Boolean(l.upstream && !l.semPush);
    const acoesPush = criar('div', 'insp-acoes');
    acoesPush.append(bPush);
    frag.append(acoesPush);

    if (prAberto) {
      frag.append(aviso(`PR #${prAberto.numero} aberto`, 'Os checks, as revisões e o merge estão na aba PR e CI.'));
      frag.append(botao('Ver o PR e os checks', 'insp-botao', () => { aba = 'pr'; desenhar(); carregarAba(); }));
      return frag;
    }
    if (!dados.github) {
      frag.append(aviso('O remoto não é do GitHub', 'Criar PR por aqui só funciona com repositório no GitHub.'));
      return frag;
    }

    // ------- novo PR
    const p = painelAlvo();
    const ui = window.OrqCasca.ui();
    if (!prForm.tocado) {
      prForm.titulo = prForm.titulo || (p?.issue?.identificador
        ? `${p.issue.identificador} · ${p.issue.titulo || ''}`.trim() : (commits[0]?.assunto || l.branch));
      prForm.base = prForm.base || ui.git?.base || l.base || '';
      prForm.rascunho = Boolean(ui.git?.rascunho);
    }
    const form = criar('div', 'insp-form');
    const cab = criar('div', 'insp-rotulo');
    cab.append(criar('span', 'insp-form-titulo', 'Novo pull request'));
    const gerar = botao('', 'insp-botao insp-botao-p', async () => {
      ocupado = 'gerar-pr';
      desenhar();
      const r = await window.orq.gitGerar({ id: alvo, modo: 'pr', issue: p?.issue?.identificador || '' });
      ocupado = '';
      if (r.ok) { prForm.titulo = r.titulo; prForm.corpo = r.corpo; prForm.tocado = true; }
      else window.OrqToast?.mostrar(r.texto || 'Não deu para gerar.');
      desenhar();
    });
    gerar.append(window.OrqIcones.svg('gerar', 'ico-s'), document.createTextNode(ocupado === 'gerar-pr' ? 'Gerando…' : 'Gerar'));
    gerar.disabled = Boolean(ocupado);
    gerar.title = 'Título e descrição pelo Claude Code em segundo plano (custa alguns centavos de tokens)';
    cab.append(gerar);

    const campoTitulo = criar('input', 'insp-campo');
    campoTitulo.id = 'insp-pr-titulo';
    campoTitulo.value = prForm.titulo;
    campoTitulo.setAttribute('aria-label', 'Título do PR');
    campoTitulo.addEventListener('input', () => { prForm.titulo = campoTitulo.value; prForm.tocado = true; });
    const campoCorpo = criar('textarea', 'insp-campo insp-area');
    campoCorpo.rows = 5;
    campoCorpo.placeholder = 'Descrição (opcional)';
    campoCorpo.value = prForm.corpo;
    campoCorpo.setAttribute('aria-label', 'Descrição do PR');
    campoCorpo.addEventListener('input', () => { prForm.corpo = campoCorpo.value; prForm.tocado = true; });
    const linhaBase = criar('div', 'insp-rotulo');
    linhaBase.append(criar('span', '', 'Branch base'), criar('span', 'insp-nota-inline', `a partir de ${l.branch}`));
    const campoBase = criar('input', 'insp-campo mono');
    campoBase.value = prForm.base;
    campoBase.setAttribute('aria-label', 'Branch base do PR');
    campoBase.addEventListener('input', () => { prForm.base = campoBase.value; prForm.tocado = true; });
    const rascunho = criar('label', 'insp-check');
    const caixa = criar('input');
    caixa.type = 'checkbox';
    caixa.checked = prForm.rascunho;
    caixa.addEventListener('change', () => { prForm.rascunho = caixa.checked; prForm.tocado = true; });
    rascunho.append(caixa, document.createTextNode('Criar como rascunho'));

    const precisaPush = !l.upstream || l.semPush;
    const criarPr = botao(ocupado === 'pr' ? 'Criando…' : (precisaPush ? 'Push e criar PR' : 'Criar PR'),
      'insp-botao insp-primario insp-largo', async () => {
        ocupado = 'pr';
        desenhar();
        const r = await window.orq.branchCriarPr({ id: alvo, titulo: prForm.titulo, corpo: prForm.corpo,
          base: prForm.base, rascunho: prForm.rascunho });
        ocupado = '';
        if (r.ok) {
          window.OrqToast?.mostrar(`PR #${r.numero} criado`);
          prForm = { titulo: '', corpo: '', base: '', rascunho: false, tocado: false };
          aba = 'pr';
          await carregar(true);
          return;
        }
        if (r.acesso === false && r.urlManual) {
          window.OrqToast?.mostrar('Sem permissão para criar pela API: abrindo o GitHub.');
          window.orq.abrirExterno(r.urlManual);
        } else if (!r.cancelado && r.texto) {
          window.OrqToast?.mostrar(r.texto);
        }
        desenhar();
      });
    criarPr.id = 'insp-criar-pr';
    criarPr.disabled = Boolean(ocupado);
    form.append(cab, campoTitulo, campoCorpo, linhaBase, campoBase, rascunho, criarPr);
    frag.append(form);
    return frag;
  }

  function desenharPr() {
    const frag = document.createDocumentFragment();
    if (!pr || pr.carregando) {
      frag.append(criar('p', 'insp-nota', 'Lendo o PR no GitHub…'));
      return frag;
    }
    if (pr.semGithub) {
      frag.append(aviso('Sem GitHub', 'O remoto desta branch não é do GitHub, ou ela ainda não subiu.'));
      return frag;
    }
    if (pr.nenhum) {
      frag.append(aviso('Nenhum PR para esta branch', 'Crie na aba Git e novo PR.'));
      frag.append(botao('Ir para Git e novo PR', 'insp-botao', () => { aba = 'git'; desenhar(); }));
      return frag;
    }
    if (!pr.ok) {
      frag.append(aviso('Não consegui ler o PR', pr.texto || '', 'falha'));
      return frag;
    }
    const cab = criar('div', 'insp-pr-cab');
    const linha = criar('div', 'insp-rotulo');
    const tom = pr.estado === 'aberto' ? 'ok' : (pr.estado === 'mesclado' ? 'info' : '');
    linha.append(criar('span', `insp-chip insp-chip-${tom}`, pr.rascunho ? 'rascunho' : pr.estado),
      criar('span', 'insp-sha mono', `#${pr.numero}`));
    const gh = botao('GitHub ↗', 'insp-link', () => window.orq.abrirExterno(pr.url));
    linha.append(gh);
    cab.append(linha, criar('div', 'insp-pr-titulo', pr.titulo), criar('div', 'insp-branch-sub mono', `${pr.head} → ${pr.base}`));
    frag.append(cab);

    const falhas = pr.checks.filter((c) => c.situacao === 'falhou');
    const pendentes = pr.checks.filter((c) => c.situacao === 'pendente');
    const okN = pr.checks.filter((c) => c.situacao === 'ok').length;
    const cards = criar('div', 'insp-cards');
    const card = (rotulo, valor, tomCard) => {
      const c = criar('div', 'insp-card');
      c.append(criar('div', 'insp-card-rotulo', rotulo), criar('div', `insp-card-valor${tomCard ? ` insp-${tomCard}` : ''}`, valor));
      return c;
    };
    cards.append(
      card('Checks', falhas.length ? `${falhas.length} ✗` : `${okN}/${pr.checks.length} ✓`, falhas.length ? 'menos' : (pendentes.length ? '' : 'mais')),
      card('Revisão', pr.mudancasPedidas ? `${pr.mudancasPedidas} mudanças` : `${pr.aprovacoes} aprov.`),
      card('Conflitos', pr.estadoMescla === 'dirty' ? 'sim' : 'nenhum', pr.estadoMescla === 'dirty' ? 'menos' : ''),
    );
    frag.append(cards);

    if (pr.checks.length) {
      frag.append(criar('div', 'insp-rotulo', 'Checks'));
      const lista = criar('div', 'insp-lista');
      for (const c of pr.checks) {
        const l = criar('div', `insp-check-linha insp-check-${c.situacao}`);
        const simbolo = { ok: '✓', falhou: '✗', pendente: '◌', pulado: '–' }[c.situacao];
        l.append(criar('span', 'insp-check-sim', simbolo), criar('span', 'insp-check-nome', c.nome),
          criar('span', 'insp-check-tempo mono', c.segundos != null ? `${Math.floor(c.segundos / 60)}m ${c.segundos % 60}s` : ''));
        if (c.situacao === 'falhou') {
          l.append(botao('log', 'insp-link', async () => {
            const r = await window.orq.branchLogCheck({ id: alvo, checkId: c.id });
            c.log = r.ok ? r.linhas : [r.texto];
            desenhar();
          }));
        }
        lista.append(l);
        if (c.log) {
          const pre = criar('pre', 'insp-log mono', c.log.slice(-12).join('\n'));
          lista.append(pre);
        }
      }
      frag.append(lista);
    }

    if (falhas.length) {
      frag.append(botao('Pedir correção à sessão', 'insp-botao insp-largo', () => {
        const p = painelAlvo();
        if (!p) return;
        const detalhes = falhas.map((c) => `- ${c.nome}${c.log ? `\n${c.log.slice(-8).map((x) => `  > ${x}`).join('\n')}` : ''}`).join('\n');
        p.colarTexto(`Os checks do PR #${pr.numero} falharam:\n${detalhes}\nCorrija, rode os testes e suba de novo.`,
          'o pedido de correção');
      }));
    }

    if (pr.estado === 'aberto') {
      const acoes = criar('div', 'insp-acoes');
      const metodo = criar('select', 'insp-campo insp-metodo');
      metodo.setAttribute('aria-label', 'Método de merge');
      for (const [v, t] of [['squash', 'Squash'], ['merge', 'Merge commit'], ['rebase', 'Rebase']]) {
        const o = criar('option', '', t);
        o.value = v;
        metodo.append(o);
      }
      const mesclar = botao(`Mesclar em ${pr.base}`, 'insp-botao insp-primario', async () => {
        const r = await window.orq.branchMesclar({ id: alvo, numero: pr.numero, metodo: metodo.value, sha: pr.sha });
        if (r.ok) {
          window.OrqToast?.mostrar(`PR #${pr.numero} mesclado. A worktree fica pronta para arquivar.`);
          carregar(true);
        } else if (!r.cancelado && r.texto) {
          window.OrqToast?.mostrar(r.texto);
        }
      });
      mesclar.id = 'insp-mesclar';
      mesclar.disabled = Boolean(falhas.length) || !pr.mesclavel;
      mesclar.title = falhas.length ? 'Há checks falhando' : (!pr.mesclavel ? 'O GitHub ainda não deixa mesclar' : '');
      acoes.append(metodo, mesclar);
      frag.append(acoes);
      if (!pr.temToken) frag.append(criar('p', 'insp-nota', 'Sem credencial do GitHub nesta máquina: mesclar abre o GitHub.'));
    }
    return frag;
  }

  function desenhar() {
    for (const b of abas.children) b.classList.toggle('ativa', b.dataset.aba === aba);
    const p = painelAlvo();
    elQuem.textContent = p ? p.feature || window.OrqPainel.nomeCurto?.(p.cwd) || '' : '';
    if (!alvo || !p) {
      corpo.replaceChildren(aviso('Nenhuma sessão focada', 'Clique num painel para ver o git dele aqui.'));
      return;
    }
    if (!dados) { corpo.replaceChildren(criar('p', 'insp-nota', 'Lendo o git…')); return; }
    if (!dados.ok && !dados.local) { corpo.replaceChildren(aviso('Sem git aqui', dados.texto || '')); return; }
    const conteudo = aba === 'git' ? desenharGit() : (aba === 'pr' ? desenharPr() : desenharAlteracoes());
    const rolagem = corpo.scrollTop;
    corpo.replaceChildren(conteudo);
    corpo.scrollTop = rolagem;
  }

  // ------------------------------------------------------------ abrir/fechar

  function alternar(forcar) {
    aberto = typeof forcar === 'boolean' ? forcar : !aberto;
    el.hidden = !aberto;
    elApp.dataset.inspetor = aberto ? 'aberto' : 'fechado';
    document.getElementById('btn-inspetor')?.classList.toggle('ativo', aberto);
    if (window.OrqCasca.ui().inspetor !== (aberto ? 'aberto' : 'fechado')) {
      window.OrqCasca.mudar({ inspetor: aberto ? 'aberto' : 'fechado' });
    }
    if (aberto) carregar(true);
    return aberto;
  }

  // Abre ja mostrando um painel (o chip de branch do cabecalho).
  function abrirPara(id, abaInicial) {
    if (id && window.OrqPainel.painelPorId.has(id)) window.OrqGrade.focarPainel(id);
    if (abaInicial) aba = abaInicial;
    alvo = null;
    alternar(true);
  }

  const btn = document.getElementById('btn-inspetor');
  btn?.append(window.OrqIcones.svg('inspetor'));
  btn?.addEventListener('click', () => alternar());

  // Ctrl+Shift+G em CAPTURA com stopPropagation (o molde do Ctrl+B): em bolha a
  // tecla chegaria tambem ao PTY do terminal focado.
  window.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || !ev.shiftKey || ev.altKey) return;
    if (ev.key.toLowerCase() !== 'g') return;
    ev.preventDefault();
    ev.stopPropagation();
    alternar();
  }, true);

  // Trocar o painel focado troca o que o painel Git mostra. O foco muda por
  // clique no painel (mousedown), entao basta ouvir ali.
  document.getElementById('grade')?.addEventListener('mousedown', () => {
    if (aberto) setTimeout(() => { if (escolherAlvo() !== alvo) carregar(); }, 50);
  });
  window.OrqVistas?.aoMudar(() => { if (aberto) carregar(); });

  // O estado da branch daquele painel mudou (Stop da sessao, push, refresh).
  window.orq.aoMudarBranch((carga) => {
    if (aberto && carga && carga.id === alvo) setTimeout(() => carregar(), 100);
  });

  // A preferencia guardada: abre ja aberto se ficou aberto da ultima vez.
  window.OrqCasca.aoMudar((u) => {
    const deve = u.inspetor === 'aberto';
    if (deve !== aberto) alternar(deve);
  });

  window.OrqInspetor = { alternar, abrirPara, carregar, aberto: () => aberto, alvo: () => alvo };
})();
