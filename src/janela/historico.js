'use strict';

// Historico, como PAGINA propria desde o redesign (R8). Duas abas:
//
// - SESSOES: as conversas do Claude Code de cada projeto (o leitor e o
//   src/main/transcritos.js, que so le a cabeca e a cauda de cada arquivo),
//   agrupadas por projeto, com o ultimo resumo do agente e retomar com um
//   clique (`claude --resume <id>` na pasta da conversa).
// - METRICAS: a linha de base de tempo por feature (Fase 10.7), a mesma de
//   antes, agora com barras por dia.
//
// O placar da lateral continua levando as Metricas (o *agora* para o *ao longo
// do tempo*); a navegacao "Historico" abre as Sessoes. Sem relogio: le ao
// abrir, ao buscar e no "Mostrar mais".

(() => {
  const elPlacar = document.getElementById('placar');

  // Duracao para gente ler, nao para maquina: acima de uma hora ninguem quer
  // contar minutos.
  function duracao(ms) {
    const min = Math.round(ms / 60000);
    if (min < 1) return '—';
    if (min < 60) return `${min}min`;
    const h = Math.floor(min / 60);
    const resto = min % 60;
    return resto ? `${h}h${String(resto).padStart(2, '0')}` : `${h}h`;
  }

  function quando(t) {
    if (!t) return '—';
    const dias = Math.floor((Date.now() - t) / 86400000);
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return `há ${dias} dias`;
    return new Date(t).toLocaleDateString('pt-BR');
  }

  // Mais fino que o `quando`, para as conversas: "há 3min", "há 2h", "ontem".
  function haQuanto(t) {
    if (!t) return '';
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min}min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h}h`;
    return quando(t);
  }

  // `null` e "nao ha o que medir", que e diferente de zero.
  function duracaoOuNada(ms) {
    return ms == null ? '—' : duracao(ms);
  }

  // A chave vem do main como data LOCAL (`YYYY-MM-DD`), e e lida aqui como
  // local tambem: `new Date('2026-01-05')` seria meia-noite UTC, ou seja o dia
  // anterior no Brasil.
  function rotuloDia(chave) {
    const [a, m, d] = chave.split('-').map(Number);
    const data = new Date(a, m - 1, d);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dias = Math.round((hoje - data) / 86400000);
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'ontem';
    return data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  }

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

  function tabela(classe, colunas, linhas) {
    const t = criar('table', `ajuda-tabela ${classe}`);
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const c of colunas) tr.append(criar('th', '', c));
    thead.append(tr);
    const tbody = document.createElement('tbody');
    for (const celulas of linhas) {
      const linha = document.createElement('tr');
      for (const [texto, cls] of celulas) linha.append(criar('td', cls, texto));
      tbody.append(linha);
    }
    t.append(thead, tbody);
    return t;
  }

  // ------------------------------------------------------------ a pagina

  const elHistorico = criar('section');
  elHistorico.id = 'historico';
  const conteudo = criar('div', 'pagina-conteudo');
  const topo = criar('div', 'pagina-topo');
  const titulo = criar('h1', 'pagina-titulo', 'Histórico');
  const abas = criar('div', 'segmentado');
  const abaSessoes = botao('Sessões', 'ativa', () => mostrarAba('sessoes'));
  const abaMetricas = botao('Métricas', '', () => mostrarAba('metricas'));
  abas.append(abaSessoes, abaMetricas);
  topo.append(titulo, abas);
  const elSessoes = criar('div', 'hist-sessoes');
  const elCorpo = criar('div');
  elCorpo.id = 'historico-corpo';
  elCorpo.hidden = true;
  conteudo.append(topo, elSessoes, elCorpo);
  elHistorico.append(conteudo);

  let aba = 'sessoes';

  function mostrarAba(qual) {
    aba = qual;
    abaSessoes.classList.toggle('ativa', qual === 'sessoes');
    abaMetricas.classList.toggle('ativa', qual === 'metricas');
    elSessoes.hidden = qual !== 'sessoes';
    elCorpo.hidden = qual !== 'metricas';
    if (qual === 'metricas') carregarMetricas();
    else carregarSessoes(true);
  }

  // ------------------------------------------------------------ metricas

  // Barras por dia, CSS puro: a altura de cada uma e a fracao do maior valor.
  function barras(valores, tom) {
    const caixa = criar('div', 'hist-barras');
    const maior = Math.max(1, ...valores.map((v) => v || 0));
    valores.forEach((v, i) => {
      const b = criar('span', i === valores.length - 1 && tom ? `hist-barra hist-barra-${tom}` : 'hist-barra');
      b.style.height = `${Math.max(4, Math.round(((v || 0) / maior) * 100))}%`;
      caixa.append(b);
    });
    return caixa;
  }

  // A linha de base da Fase 10: o que ela inteira deveria derrubar.
  function desenharBase(m) {
    const { totais } = m;
    const blocos = [];

    blocos.push(criar('h3', 'historico-titulo', `Linha de base — últimos ${m.dias.length} dias`));

    const dias = [...m.dias].reverse();
    const chips = criar('div', 'historico-chips');
    for (const [rotulo, valor, cls, serie, tom] of [
      ['Esperando você', duracaoOuNada(totais.esperando || null), 'historico-espera', dias.map((d) => d.esperando), 'espera'],
      ['Resposta (mediana)', duracaoOuNada(totais.respostaMediana), '', dias.map((d) => d.respostaMediana), 'info'],
      ['Integradas', String(totais.integradas), '', dias.map((d) => d.integradas), 'ok'],
      ['Terminou → integrado', duracaoOuNada(totais.leadMediano), '', null, ''],
    ]) {
      const chip = criar('div', 'historico-chip');
      chip.append(criar('span', 'historico-chip-rotulo', rotulo), criar('b', `historico-num ${cls}`, valor));
      if (serie) chip.append(barras(serie, tom));
      chips.append(chip);
    }
    blocos.push(chips);

    blocos.push(tabela('historico-dias',
      ['Dia', 'Esperando você', 'Episódios', 'Resposta', 'Sessões', 'Features', 'Integradas'],
      m.dias.map((d) => [
        [rotuloDia(d.dia), ''],
        [d.esperando ? duracao(d.esperando) : '—', 'historico-num historico-espera'],
        [String(d.episodios), 'historico-num'],
        [duracaoOuNada(d.respostaMediana), 'historico-num'],
        [String(d.sessoes), 'historico-num'],
        [String(d.features), 'historico-num'],
        [String(d.integradas), 'historico-num'],
      ])));

    return blocos;
  }

  function desenharMetricas(linhas, metricas) {
    if (!linhas.length) {
      const vazio = document.createElement('p');
      vazio.className = 'historico-vazio';
      vazio.textContent = 'Ainda não há histórico. Ele começa a ser gravado assim que as sessões '
        + 'mudam de status — o que depende dos hooks estarem ligados.';
      elCorpo.replaceChildren(vazio);
      return;
    }

    const porFeature = tabela('historico-tabela',
      ['Feature', 'Projeto', 'Trabalhando', 'Esperando você', 'Interrupções', 'Terminou → integrado',
        'Última vez'],
      linhas.map((r) => [
        [r.feature, 'historico-feature'],
        [r.projeto || '—', ''],
        [duracao(r.trabalhando), 'historico-num'],
        [duracao(r.esperando), 'historico-num historico-espera'],
        [String(r.interrupcoes), 'historico-num'],
        [duracaoOuNada(r.leadTime), 'historico-num'],
        [quando(r.ultima), ''],
      ]));

    const nota = criar('p', 'historico-nota',
      'Só entram intervalos com começo e fim. Se o app cair com uma sessão aberta, '
      + 'aquele intervalo se perde — subcontar é melhor que inventar tempo que não houve. '
      + '"Integrada" é uma worktree arquivada pelo app, o que exige o trabalho já estar na base. '
      + 'A resposta não conta a espera encerrada fechando o painel.');

    elCorpo.replaceChildren(
      ...(metricas ? desenharBase(metricas) : []),
      criar('h3', 'historico-titulo', 'Por feature'),
      porFeature,
      nota,
    );
  }

  async function carregarMetricas() {
    elCorpo.replaceChildren();
    const [linhas, metricas] = await Promise.all([
      window.orq.historico(),
      window.orq.historicoMetricas(),
    ]);
    desenharMetricas(linhas || [], metricas || null);
  }

  // ------------------------------------------------------------ sessoes

  const TODOS_CLAUDE = '__claude';
  let escopo = '';            // '' = projetos cadastrados; caminho = um projeto; TODOS_CLAUDE = tudo
  let busca = '';
  let pagina = 0;
  let itens = [];
  let total = 0;
  let aberta = '';            // arquivo expandido
  let seq = 0;

  const filtros = criar('div', 'hist-filtros');
  const seletor = criar('select', 'hist-seletor');
  seletor.id = 'hist-escopo';
  seletor.setAttribute('aria-label', 'Quais sessões mostrar');
  seletor.addEventListener('change', () => { escopo = seletor.value; carregarSessoes(true); });
  const caixaBusca = criar('label', 'inbox-caixa-busca');
  caixaBusca.append(window.OrqIcones.svg('busca', 'ico-s'));
  const campoBusca = criar('input', 'hist-busca');
  campoBusca.id = 'hist-busca';
  campoBusca.placeholder = 'Buscar sessões';
  campoBusca.setAttribute('aria-label', 'Buscar sessões');
  let timerBusca = null;
  campoBusca.addEventListener('input', () => {
    clearTimeout(timerBusca);
    timerBusca = setTimeout(() => { busca = campoBusca.value; carregarSessoes(true); }, 250);
  });
  caixaBusca.append(campoBusca);
  const elContagem = criar('span', 'pagina-sub');
  filtros.append(seletor, caixaBusca, elContagem);
  const elLista = criar('div', 'hist-lista');
  elLista.id = 'hist-lista';
  const btnMais = botao('Mostrar mais sessões', 'hist-mais', () => { pagina += 1; carregarSessoes(false); });
  elSessoes.append(filtros, elLista, btnMais);

  function opcoesDeEscopo() {
    const atual = escopo;
    seletor.replaceChildren();
    const opcao = (valor, rotulo) => {
      const o = criar('option', '', rotulo);
      o.value = valor;
      o.selected = valor === atual;
      seletor.append(o);
    };
    opcao('', 'Projetos cadastrados');
    for (const p of window.OrqProjetos?.lista?.() || []) if (p.existe) opcao(p.caminho, p.nome);
    opcao(TODOS_CLAUDE, 'Tudo no Claude Code');
  }

  function projetosDoEscopo() {
    if (escopo === TODOS_CLAUDE) return [];
    if (escopo) return [escopo];
    const lista = (window.OrqProjetos?.lista?.() || []).filter((p) => p.existe).map((p) => p.caminho);
    // Sem projeto cadastrado, "projetos cadastrados" seria uma lista vazia --
    // que o main entende como TUDO. Melhor dizer que nao ha o que mostrar.
    return lista.length ? lista : null;
  }

  async function carregarSessoes(doZero) {
    if (doZero) { pagina = 0; itens = []; aberta = ''; }
    const projetos = projetosDoEscopo();
    if (projetos === null) {
      elLista.replaceChildren(criar('div', 'pagina-cartao inbox-estado-vazio',
        'Nenhum projeto cadastrado. Escolha "Tudo no Claude Code" para ver todas as conversas.'));
      elContagem.textContent = '';
      btnMais.hidden = true;
      return;
    }
    const minha = ++seq;
    if (doZero) elLista.replaceChildren(criar('p', 'insp-nota', 'Lendo as conversas…'));
    const r = await window.orq.historicoSessoes({ projetos, busca, pagina });
    if (minha !== seq) return;
    itens = doZero ? r.itens : itens.concat(r.itens);
    total = r.total;
    desenharSessoes();
  }

  function grupoDe(item) {
    const p = window.OrqProjetos?.projetoDe?.(item.cwd);
    return p ? p.nome : 'Outras pastas';
  }

  function desenharSessoes() {
    elContagem.textContent = itens.length ? `${itens.length} de ${total} sessões` : '';
    btnMais.hidden = itens.length >= total || !itens.length;
    if (!itens.length) {
      elLista.replaceChildren(criar('div', 'pagina-cartao inbox-estado-vazio',
        busca ? 'Nenhuma sessão com esta busca.' : 'Nenhuma conversa do Claude Code nestes projetos ainda.'));
      return;
    }
    const grupos = new Map();
    for (const it of itens) {
      const g = grupoDe(it);
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(it);
    }
    const blocos = [];
    for (const [nome, lista] of grupos) {
      const cab = criar('div', 'hist-grupo');
      const proj = (window.OrqProjetos?.lista?.() || []).find((p) => p.nome === nome);
      const cor = criar('span', 'inbox-cor');
      if (proj) cor.style.background = window.OrqProjetos.tintaDaPasta?.(proj.caminho) || '';
      cab.append(cor, criar('span', 'hist-grupo-nome', nome), criar('span', 'hist-grupo-qtd mono', String(lista.length)));
      blocos.push(cab);
      const cartao = criar('div', 'pagina-cartao hist-cartao');
      for (const it of lista) cartao.append(linhaSessao(it));
      blocos.push(cartao);
    }
    elLista.replaceChildren(...blocos);
  }

  function linhaSessao(it) {
    const el = criar('div', `hist-sessao${aberta === it.arquivo ? ' aberta' : ''}`);
    el.dataset.arquivo = it.arquivo;
    const cab = criar('button', 'hist-sessao-cab');
    cab.type = 'button';
    cab.addEventListener('click', () => {
      aberta = aberta === it.arquivo ? '' : it.arquivo;
      desenharSessoes();
    });
    cab.append(criar('div', 'hist-sessao-titulo', it.titulo || '(sem título)'));
    if (it.ultimo) {
      const resumo = criar('div', 'hist-sessao-resumo');
      resumo.append(criar('b', '', 'Agente: '), document.createTextNode(it.ultimo));
      cab.append(resumo);
    }
    const meta = criar('div', 'hist-sessao-meta');
    const msgs = it.msgs != null ? `${it.msgs} msgs` : (it.msgsPiso ? `${it.msgsPiso}+ msgs` : '');
    for (const parte of [msgs, haQuanto(it.em), it.modelo ? it.modelo.replace(/^claude-/, '') : '', it.branch]) {
      if (parte) meta.append(criar('span', 'mono', parte));
    }
    if (it.pr) meta.append(criar('span', 'insp-chip insp-chip-ok', `PR #${it.pr.numero}`));
    cab.append(meta);
    el.append(cab);
    if (aberta === it.arquivo) el.append(detalheSessao(it));
    return el;
  }

  // O id de sessao vai para uma linha de shell: so o formato que o CLI usa.
  const ID_VALIDO = /^[0-9a-f-]{8,64}$/i;

  function retomar(it, fork) {
    if (!ID_VALIDO.test(it.sessionId)) {
      window.OrqToast?.mostrar('Esta conversa não tem um id que dê para retomar.');
      return;
    }
    if (!it.cwd) {
      window.OrqToast?.mostrar('Não sei em que pasta esta conversa rodou.');
      return;
    }
    const comando = `${window.OrqShell.limpar()} && claude --resume ${it.sessionId}${fork ? ' --fork-session' : ''}`;
    const feature = window.OrqProjetos?.slugFeature?.(it.branch || it.titulo || 'retomada').slice(0, 40) || 'retomada';
    window.OrqVistas.ir('sessoes');
    window.OrqGrade.criarPainel({ cwd: it.cwd, feature, comandoInicial: comando })
      .catch(() => window.OrqToast?.mostrar('Não consegui abrir o painel nesta pasta (ela ainda existe?).'));
  }

  function detalheSessao(it) {
    const caixa = criar('div', 'hist-detalhe');
    const acoes = criar('div', 'hist-acoes');
    const bRetomar = botao('Retomar na pasta', 'insp-botao insp-primario', () => retomar(it, false));
    bRetomar.title = `claude --resume ${it.sessionId}`;
    const bFork = botao('Retomar em sessão nova', 'insp-botao', () => retomar(it, true));
    bFork.title = 'Continua a partir desta conversa com um id novo (--fork-session)';
    const bCopiar = botao('Copiar id', 'insp-botao', () => {
      window.orq.copiar(it.sessionId);
      window.OrqToast?.mostrar('Id da sessão copiado');
    });
    acoes.append(bRetomar, bFork, bCopiar);
    if (it.pr && /^https:\/\//.test(it.pr.url)) acoes.append(botao(`PR #${it.pr.numero} ↗`, 'insp-botao', () => window.orq.abrirExterno(it.pr.url)));
    caixa.append(acoes);
    const corpo = criar('div', 'hist-turnos');
    corpo.append(criar('p', 'insp-nota', 'Lendo a conversa…'));
    caixa.append(corpo);
    window.orq.historicoSessao(it.arquivo).then((d) => {
      if (!d || !d.ok) { corpo.replaceChildren(criar('p', 'insp-nota', (d && d.texto) || 'Não consegui ler.')); return; }
      const partes = [criar('div', 'insp-rotulo', 'Primeiro pedido')];
      partes.push(turno('voce', d.primeiro || '(vazio)'));
      if (d.turnos.length) partes.push(criar('div', 'insp-rotulo', 'Últimos turnos'));
      for (const t of d.turnos) partes.push(turno(t.quem, t.texto));
      corpo.replaceChildren(...partes);
    });
    return caixa;
  }

  function turno(quem, texto) {
    const t = criar('div', `hist-turno hist-turno-${quem}`);
    t.append(criar('div', 'hist-turno-quem', quem === 'voce' ? 'Você' : 'Agente'), criar('div', 'hist-turno-texto', texto));
    return t;
  }

  // ------------------------------------------------------------ abrir

  function aoMostrar() {
    opcoesDeEscopo();
    mostrarAba(aba);
  }

  // Abre nas Metricas (o placar, e o caminho antigo do overlay).
  async function abrir() {
    aba = 'metricas';
    if (window.OrqVistas.atual() !== 'historico') window.OrqVistas.ir('historico');
    mostrarAba('metricas');
  }

  // Abre nas Sessoes (a navegacao da lateral).
  function abrirSessoes() {
    aba = 'sessoes';
    if (window.OrqVistas.atual() !== 'historico') window.OrqVistas.ir('historico');
    else mostrarAba('sessoes');
  }

  function fechar() {
    if (window.OrqVistas.atual() === 'historico') window.OrqVistas.ir('sessoes');
  }

  window.OrqVistas.registrar('historico', { el: elHistorico, titulo: 'Histórico', aoMostrar });
  elPlacar?.addEventListener('click', abrir);

  window.OrqHistorico = { abrir, abrirSessoes, fechar, duracao, quando };
})();
