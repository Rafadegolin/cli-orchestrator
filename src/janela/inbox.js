'use strict';

// Issues do Pronix Flow (Fase 10.4), como PAGINA propria desde o redesign (R5).
//
// Ate a Fase 10.4 o contrato com o Flow era de mao unica -- ele empurra pelo
// /abrir. Esta tela le as issues abertas atribuidas a voce e abre a sessao PELO
// MESMO CAMINHO do /abrir: o clique manda so o ID ao main, que tira os campos da
// lista que ele mesmo leu e chama o `externo.atender`. Slug, branch literal,
// worktree, prefill e a deduplicacao sao os de sempre, sem copia aqui.
//
// O token nunca passa por esta janela depois de colado: o campo e limpo no
// clique, e nenhum IPC o devolve.
//
// Sem relogio: busca ao abrir a pagina, ao voltar para a janela com ela aberta
// (piso de 60s) e no botao Atualizar. Falha de rede vira texto na propria tela,
// nunca dialogo.
//
// Os ids (#inbox, #inbox-lista, #inbox-token...) sao os de antes da pagina: o
// `teste:inbox-ui` e o resto do app falam com eles.

(() => {
  const btnLateral = document.getElementById('btn-inbox');

  const MS_PISO = 60_000;
  const TODOS = '__todos';
  const SEM_PROJETO = '__sem';

  let ultima = null;
  let lidaEm = 0;
  let seq = 0;
  let filtroProjeto = TODOS;
  let filtroTexto = '';
  let filtroEstado = TODOS;
  // 'minhas' (as atribuidas a voce, o contrato original) ou 'ciclo': todas as
  // issues do ciclo ativo de cada time, de qualquer pessoa (TECH-3802 no Flow).
  let escopo = 'minhas';

  // Por que uma issue nao abre. O texto mora aqui, e nao no main, porque e
  // rotulo de tela -- o main diz o CODIGO, que e o mesmo do /abrir.
  const MOTIVOS = {
    'sem-repo': 'a issue não tem repositório no Flow',
    'repo-nao-cadastrado': 'repositório não cadastrado aqui',
    'repo-ambiguo': 'mais de um projeto aponta para este repositório',
    'repo-invalido': 'repositório em formato inesperado',
    'branch-invalida': 'branch inválida',
  };

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

  function icob(icone, titulo, aoClicar) {
    const b = botao('', 'pagina-icob', aoClicar);
    b.title = titulo;
    b.setAttribute('aria-label', titulo);
    b.append(window.OrqIcones.svg(icone, 'ico-s'));
    return b;
  }

  // ------------------------------------------------------------ a pagina

  const elInbox = criar('section');
  elInbox.id = 'inbox';
  const elConteudo = criar('div', 'pagina-conteudo');
  const elTopo = criar('div', 'pagina-topo');
  const elTitulo = criar('h1', 'pagina-titulo', 'Issues');
  const elQuem = criar('span', 'inbox-quem');
  const elLida = criar('span', 'pagina-sub');
  const elAcoesTopo = criar('span', 'inbox-acoes-topo');
  elTopo.append(elTitulo, elQuem, criar('span', 'pagina-espaco'), elLida, elAcoesTopo);
  const elCorpo = criar('div');
  elCorpo.id = 'inbox-corpo';
  elConteudo.append(elTopo, elCorpo);
  elInbox.append(elConteudo);

  function mensagem(texto) {
    elCorpo.replaceChildren(criar('div', 'pagina-cartao inbox-estado-vazio', texto));
  }

  // Ha quanto tempo, em portugues curto: "agora", "há 10 min", "ontem".
  function quando(iso) {
    const t = Date.parse(iso || '');
    if (!t) return '';
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'ontem' : `há ${d} dias`;
  }

  // ------------------------------------------------------------ conectar

  function desenharConectar(base, erro) {
    elQuem.textContent = '';
    elLida.textContent = '';
    elAcoesTopo.replaceChildren();

    const cartao = criar('div', 'pagina-cartao inbox-conectar');
    const titulo = criar('h2', 'inbox-conectar-titulo', 'Conectar ao Pronix Flow');
    const explica = criar('p', 'modal-explica',
      'Cole um token pessoal do Flow (Configurações → Tokens de API). Ele só lê: as issues '
      + 'atribuídas a você e as do ciclo atual dos times do workspace. Fica guardado cifrado neste computador.');

    const campoBase = criar('input', 'scripts-campo');
    campoBase.id = 'inbox-base';
    campoBase.type = 'text';
    campoBase.spellcheck = false;
    campoBase.value = base || '';

    const campoToken = criar('input', 'scripts-campo');
    campoToken.id = 'inbox-token';
    campoToken.type = 'password';
    campoToken.spellcheck = false;
    campoToken.autocomplete = 'off';
    campoToken.placeholder = 'pfx_…';

    const elErro = criar('p', 'modal-erro', erro || '');
    elErro.id = 'inbox-erro';
    elErro.hidden = !erro;

    const conectar = botao('Conectar', 'primario', async () => {
      const token = campoToken.value;
      // Limpo ANTES do await: o token nao fica no DOM nem durante a ida ao Flow.
      campoToken.value = '';
      conectar.disabled = true;
      conectar.textContent = 'Conectando…';
      const r = await window.orq.flowConectar({ base: campoBase.value, token });
      if (elInbox.hidden) return;
      if (!r || !r.ok) {
        conectar.disabled = false;
        conectar.textContent = 'Conectar';
        elErro.textContent = (r && r.texto) || 'não deu para conectar';
        elErro.hidden = false;
        campoToken.focus();
        return;
      }
      window.OrqToast?.mostrar(`Conectado ao Flow como ${r.usuario.nome || r.usuario.email}`);
      atualizar(true);
    });
    conectar.id = 'inbox-conectar';

    // Abre a tela de tokens do Flow que estiver no campo, e nao a padrao: quem
    // trocou o endereco quer o token DAQUELE Flow.
    const criarToken = botao('Criar um token no Flow', '', () => {
      const alvo = (campoBase.value.trim() || base || '').replace(/\/+$/, '');
      window.orq.abrirExterno(`${alvo}/settings/tokens`);
    });

    campoToken.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') conectar.click();
    });

    const acoes = criar('div', 'modal-acoes');
    acoes.append(conectar, criarToken);

    cartao.append(
      titulo,
      explica,
      criar('div', 'modal-rotulo', 'Endereço do Flow'),
      campoBase,
      criar('div', 'modal-rotulo', 'Token pessoal'),
      campoToken,
      elErro,
      acoes,
    );
    elCorpo.replaceChildren(cartao);
    campoToken.focus();
  }

  // ------------------------------------------------------------ a lista

  function visiveis() {
    const termo = filtroTexto.trim().toLowerCase();
    return ultima.issues.filter((i) => {
      if (filtroProjeto === SEM_PROJETO && i.projeto) return false;
      if (filtroProjeto !== TODOS && filtroProjeto !== SEM_PROJETO
        && (!i.projeto || i.projeto.id !== filtroProjeto)) return false;
      if (filtroEstado !== TODOS && (i.estado?.nome || i.estado?.tipo) !== filtroEstado) return false;
      if (!termo) return true;
      return `${i.issue} ${i.title}`.toLowerCase().includes(termo);
    });
  }

  // O painel que ja trabalha nesta issue, se houver: pela issue do chip ou pelo
  // branch. So muda o ROTULO do botao -- o clique continua indo pelo /abrir, que
  // ja deduplica e foca o painel existente.
  function painelDaIssue(i) {
    for (const p of window.OrqPainel?.painelPorId?.values() || []) {
      if (p.issue?.identificador && p.issue.identificador === i.issue) return p;
      if (i.branch && p.branch && p.branch === i.branch) return p;
    }
    return null;
  }

  function tomDoEstado(tipo) {
    const t = String(tipo || '').toLowerCase();
    if (t === 'started' || t === 'inprogress' || t === 'in_progress') return 'andamento';
    if (t === 'review' || t === 'inreview') return 'revisao';
    if (t === 'completed' || t === 'done') return 'feito';
    return 'afazer';
  }

  function linha(i) {
    const tr = criar('tr', 'inbox-linha');
    tr.dataset.id = i.id;

    const tdId = criar('td', 'inbox-col-id');
    const idEl = criar('span', 'inbox-id mono');
    idEl.append(window.OrqIcones.svg('issue', 'ico-s'), document.createTextNode(i.issue));
    tdId.append(idEl);

    const tdTitulo = criar('td', 'inbox-col-titulo');
    const titulo = criar('div', 'inbox-titulo', i.title || '(sem título)');
    titulo.title = i.title;
    const destino = i.projeto
      ? `→ ${i.projeto.nome}`
      : MOTIVOS[i.motivo] || 'não dá para abrir aqui';
    const meta = criar('div', `inbox-meta${i.projeto ? '' : ' inbox-meta-sem'}`,
      `${i.repo || 'sem repositório'} · ${i.branch} ${destino}`);
    const status = criar('div', 'inbox-status');
    status.hidden = true;
    tdTitulo.append(titulo, meta);
    // As labels do Flow, com a cor dele num ponto (o texto fica no token do
    // app, para o contraste nao depender da cor que alguem escolheu la).
    if ((i.labels || []).length) {
      const labels = criar('div', 'inbox-labels');
      for (const l of i.labels) {
        const chip = criar('span', 'inbox-label');
        const ponto = criar('span', 'inbox-label-cor');
        if (l.cor) ponto.style.background = l.cor;
        chip.append(ponto, document.createTextNode(l.nome));
        labels.append(chip);
      }
      tdTitulo.append(labels);
    }
    tdTitulo.append(status);

    const tdProjeto = criar('td', 'inbox-col-projeto');
    if (i.projeto) {
      const pista = window.OrqProjetos?.lista?.().find((p) => p.id === i.projeto.id);
      const cor = criar('span', 'inbox-cor');
      cor.style.background = pista ? (window.OrqProjetos.tintaDaPasta?.(pista.caminho) || '') : '';
      tdProjeto.append(cor, document.createTextNode(i.projeto.nome));
    } else {
      tdProjeto.append(criar('span', 'inbox-sem-projeto', 'sem projeto'));
    }

    const tdEstado = criar('td', 'inbox-col-estado');
    tdEstado.append(criar('span', `inbox-pill inbox-pill-${tomDoEstado(i.estado?.tipo)}`,
      i.estado?.nome || i.estado?.tipo || ''));

    // Responsaveis: a inicial de cada um, com o nome no title. A sua vem
    // marcada -- no escopo do ciclo e o que diz "esta e minha" de relance.
    const tdResp = criar('td', 'inbox-col-resp');
    for (const nome of (i.responsaveis || []).slice(0, 3)) {
      const av = criar('span', 'inbox-avatar', nome.trim().charAt(0).toUpperCase());
      av.title = nome;
      tdResp.append(av);
    }
    if ((i.responsaveis || []).length > 3) tdResp.append(criar('span', 'inbox-avatar-mais', `+${i.responsaveis.length - 3}`));
    if (!(i.responsaveis || []).length) tdResp.append(criar('span', 'inbox-sem-projeto', '—'));
    if (escopo === 'ciclo' && i.minha) tdResp.append(criar('span', 'inbox-minha', 'você'));

    const tdQuando = criar('td', 'inbox-col-quando', quando(i.atualizada));

    const tdAcoes = criar('td', 'inbox-col-acoes');
    const acoes = criar('div', 'inbox-acoes');
    const existente = painelDaIssue(i);
    const abrir = botao(existente ? 'Ir para a sessão' : 'Abrir sessão', 'primario',
      () => abrirIssue(i, abrir, status));
    abrir.disabled = !i.projeto;
    abrir.title = i.projeto
      ? `Abre uma sessão em ${i.projeto.nome}, no branch ${i.branch}`
      + (i.temDescricao ? ', com a descrição na caixa do Claude' : '')
      : destino;
    acoes.append(abrir);
    if (i.url) {
      const ver = botao('', 'inbox-ver', () => window.orq.abrirExterno(i.url));
      ver.title = 'Ver a issue no Flow';
      ver.setAttribute('aria-label', 'Ver a issue no Flow');
      ver.append(window.OrqIcones.svg('externo', 'ico-s'));
      acoes.append(ver);
    }
    tdAcoes.append(acoes);

    tr.append(tdId, tdTitulo, tdProjeto, tdResp, tdEstado, tdQuando, tdAcoes);
    return tr;
  }

  function desenharLista() {
    const { usuario, base, issues } = ultima;

    elQuem.textContent = `${usuario.nome || usuario.email || 'conectado'} · ${base.replace(/^https?:\/\//, '')}`;
    elLida.textContent = 'atualizado agora';
    const recarregar = icob('atualizar', 'Atualizar', () => atualizar(true));
    recarregar.id = 'inbox-atualizar';
    const noFlow = icob('externo', 'Abrir o Flow no navegador', () => window.orq.abrirExterno(base));
    const sair = botao('Desconectar', 'inbox-sair', async () => {
      await window.orq.flowDesconectar();
      ultima = null;
      desenharConectar(base);
    });
    sair.id = 'inbox-sair';
    elAcoesTopo.replaceChildren(recarregar, noFlow, sair);

    // Abas por estado: so os estados que aparecem na lista.
    const estados = [...new Set(issues.map((i) => i.estado?.nome || i.estado?.tipo).filter(Boolean))];
    if (filtroEstado !== TODOS && !estados.includes(filtroEstado)) filtroEstado = TODOS;
    const abas = criar('div', 'segmentado inbox-abas');
    const aba = (valor, rotulo, qtd) => {
      const b = botao(`${rotulo} · ${qtd}`, valor === filtroEstado ? 'ativa' : '', () => {
        filtroEstado = valor;
        for (const x of abas.children) x.classList.toggle('ativa', x === b);
        desenharItens();
      });
      abas.append(b);
    };
    aba(TODOS, 'Todas', issues.length);
    for (const e of estados) {
      aba(e, e, issues.filter((i) => (i.estado?.nome || i.estado?.tipo) === e).length);
    }

    // O filtro por projeto so oferece projetos que aparecem na lista: um
    // seletor com os vinte cadastrados e zero issues em dezoito seria ruido.
    const nomes = new Map();
    for (const i of issues) if (i.projeto) nomes.set(i.projeto.id, i.projeto.nome);
    if (filtroProjeto !== TODOS && filtroProjeto !== SEM_PROJETO && !nomes.has(filtroProjeto)) {
      filtroProjeto = TODOS;
    }
    const seletor = criar('select', 'inbox-filtro');
    seletor.id = 'inbox-projeto';
    seletor.setAttribute('aria-label', 'Filtrar por projeto');
    const opcao = (valor, rotulo) => {
      const o = criar('option', '', rotulo);
      o.value = valor;
      o.selected = valor === filtroProjeto;
      seletor.append(o);
    };
    opcao(TODOS, `Todos os projetos (${issues.length})`);
    for (const [id, nome] of [...nomes].sort((a, b) => a[1].localeCompare(b[1]))) {
      opcao(id, `${nome} (${issues.filter((i) => i.projeto && i.projeto.id === id).length})`);
    }
    const semProjeto = issues.filter((i) => !i.projeto).length;
    if (semProjeto) opcao(SEM_PROJETO, `Sem projeto cadastrado (${semProjeto})`);
    seletor.addEventListener('change', () => { filtroProjeto = seletor.value; desenharItens(); });

    const caixaBusca = criar('label', 'inbox-caixa-busca');
    caixaBusca.append(window.OrqIcones.svg('busca', 'ico-s'));
    const busca = criar('input', 'inbox-busca');
    busca.id = 'inbox-busca';
    busca.type = 'text';
    busca.spellcheck = false;
    busca.placeholder = 'Buscar por título ou ID…';
    busca.value = filtroTexto;
    busca.addEventListener('input', () => { filtroTexto = busca.value; desenharItens(); });
    caixaBusca.append(busca);

    const filtros = criar('div', 'inbox-filtros');
    filtros.append(seletorEscopo(), abas, seletor, caixaBusca);

    const tabela = criar('table', 'inbox-tabela');
    const thead = criar('thead');
    const cab = criar('tr');
    for (const t of ['ID', 'Título / contexto', 'Projeto', 'Resp.', 'Estado', 'Atualizada', '']) cab.append(criar('th', '', t));
    thead.append(cab);
    const lista = criar('tbody');
    lista.id = 'inbox-lista';
    tabela.append(thead, lista);
    const rolagem = criar('div', 'inbox-rolagem');
    rolagem.append(tabela);

    function desenharItens() {
      const itens = visiveis();
      const vazio = (texto) => {
        const tr = criar('tr');
        const td = criar('td', 'inbox-vazio', texto);
        td.colSpan = 7;
        tr.append(td);
        return tr;
      };
      if (!issues.length) {
        lista.replaceChildren(vazio(escopo === 'ciclo'
          ? 'Nenhuma issue no ciclo atual dos times deste workspace.'
          : 'Nenhuma issue aberta atribuída a você.'));
      } else if (!itens.length) {
        lista.replaceChildren(vazio('Nenhuma issue com este filtro.'));
      } else {
        lista.replaceChildren(...itens.map(linha));
      }
    }
    desenharItens();

    const cartao = criar('div', 'pagina-cartao');
    cartao.append(filtros, rolagem);
    elCorpo.replaceChildren(cartao);
  }

  async function abrirIssue(i, btn, status) {
    btn.disabled = true;
    const rotulo = btn.textContent;
    btn.textContent = 'Abrindo…';
    const r = await window.orq.flowAbrir(i.id);
    if (r && r.ok) {
      fechar();
      const onde = (r.projeto && r.projeto.nome) || (i.projeto && i.projeto.nome) || '';
      window.OrqToast?.mostrar(r.jaPedido || r.jaAberta
        ? `${i.issue} já estava aberta`
        : `Abrindo ${i.issue} em ${onde} (${r.branch || i.branch})`);
      return;
    }
    btn.disabled = false;
    btn.textContent = rotulo;
    // Na linha, e nao so no toast: o motivo tem de ficar ao lado do que falhou.
    status.textContent = (r && r.texto) || (r && r.erro) || 'não deu para abrir';
    status.hidden = false;
  }

  // ------------------------------------------------------------ ciclo

  // `forcar` ignora o piso: abrir a tela e o Atualizar querem a lista de agora.
  async function atualizar(forcar) {
    if (!forcar && Date.now() - lidaEm < MS_PISO) return;
    const minha = (seq += 1);
    if (!ultima) mensagem('Lendo as issues do Flow…');
    const r = await window.orq.flowIssues(escopo);
    // Ultima-chamada-vence, e nada a desenhar com a pagina fechada.
    if (minha !== seq || elInbox.hidden) return;
    lidaEm = Date.now();

    if (r && r.ok) {
      ultima = r;
      desenharLista();
      return;
    }
    if (r && r.erro === 'desconectado') {
      ultima = null;
      const s = await window.orq.flowSituacao();
      desenharConectar(s.base);
      return;
    }
    // Token revogado leva direto ao formulario, com o motivo: e o unico conserto.
    if (r && r.erro === 'token') {
      ultima = null;
      const s = await window.orq.flowSituacao();
      desenharConectar(s.base, r.texto);
      return;
    }
    const cartao = criar('div', 'pagina-cartao inbox-estado-vazio');
    cartao.append(
      criar('p', '', (r && r.texto) || 'não deu para ler o Flow'),
      // Flow sem a lista do ciclo: o caminho de volta e a lista de sempre.
      escopo === 'ciclo' && r && r.erro === 'versao'
        ? botao('Ver as atribuídas a mim', '', () => mudarEscopo('minhas'))
        : botao('Tentar de novo', '', () => atualizar(true)),
    );
    elCorpo.replaceChildren(cartao);
  }

  // As suas ou o ciclo inteiro. Trocar relê do Flow (o piso nao vale: e outra
  // lista) e volta os filtros de estado ao comeco.
  function mudarEscopo(novo) {
    if (novo === escopo) return;
    escopo = novo;
    filtroEstado = TODOS;
    ultima = null;
    atualizar(true);
  }

  function seletorEscopo() {
    const g = criar('div', 'segmentado inbox-escopo');
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', 'Quais issues');
    for (const [valor, rotulo] of [['minhas', 'Atribuídas a mim'], ['ciclo', 'Ciclo atual']]) {
      const b = botao(rotulo, valor === escopo ? 'ativa' : '', () => mudarEscopo(valor));
      b.dataset.escopo = valor;
      b.setAttribute('aria-pressed', String(valor === escopo));
      g.append(b);
    }
    return g;
  }

  // Chamado pela vista ao aparecer.
  async function aoMostrar() {
    const s = await window.orq.flowSituacao();
    if (elInbox.hidden) return;
    if (!s.conectado) {
      ultima = null;
      desenharConectar(s.base);
      return;
    }
    atualizar(true);
  }

  function abrir() {
    window.OrqVistas.ir('issues');
  }

  function fechar() {
    if (window.OrqVistas.atual() === 'issues') window.OrqVistas.ir('sessoes');
  }

  // Voltar para a janela com a pagina aberta: a lista pode ter mudado no Flow
  // enquanto voce estava la. O piso impede o alt-tab de virar marretada.
  window.addEventListener('focus', () => {
    if (!elInbox.hidden && ultima) atualizar(false);
  });

  window.OrqVistas.registrar('issues', { el: elInbox, titulo: 'Issues', aoMostrar });
  btnLateral?.setAttribute('data-vista', 'issues');
  btnLateral?.addEventListener('click', abrir);

  window.OrqInbox = { abrir, fechar, atualizar, MS_PISO };
})();
