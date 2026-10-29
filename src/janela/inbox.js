'use strict';

// "Minhas issues": a inbox do Pronix Flow (Fase 10.4).
//
// Ate aqui o contrato com o Flow era de mao unica -- ele empurra pelo /abrir.
// Escolher a proxima tarefa exigia ir ao navegador. Esta tela le as issues
// abertas atribuidas a voce e abre a sessao PELO MESMO CAMINHO do /abrir: o
// clique manda so o ID ao main, que tira os campos da lista que ele mesmo leu e
// chama o `externo.atender`. Slug, branch literal, worktree, prefill e a
// deduplicacao sao os de sempre, sem copia aqui.
//
// O token nunca passa por esta janela depois de colado: o campo e limpo no
// clique, e nenhum IPC o devolve.
//
// Sem relogio: busca ao abrir, ao voltar para a janela com ela aberta (piso de
// 60s) e no botao Atualizar. Falha de rede vira texto na propria tela, nunca
// dialogo.

(() => {
  const elInbox = document.getElementById('inbox');
  const elCorpo = document.getElementById('inbox-corpo');
  const btnFechar = document.getElementById('inbox-fechar');
  const btnLateral = document.getElementById('btn-inbox');

  const MS_PISO = 60_000;
  const TODOS = '__todos';
  const SEM_PROJETO = '__sem';

  let ultima = null;
  let lidaEm = 0;
  let seq = 0;
  let filtroProjeto = TODOS;
  let filtroTexto = '';

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

  function mensagem(texto) {
    elCorpo.replaceChildren(criar('p', 'historico-vazio', texto));
  }

  // ------------------------------------------------------------ conectar

  function desenharConectar(base, erro) {
    const explica = criar('p', 'modal-explica',
      'Cole um token pessoal do Flow (Configurações → Tokens de API). Ele só lê as issues '
      + 'atribuídas a você, e fica guardado cifrado neste computador.');

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

    elCorpo.replaceChildren(
      explica,
      criar('div', 'modal-rotulo', 'Endereço do Flow'),
      campoBase,
      criar('div', 'modal-rotulo', 'Token pessoal'),
      campoToken,
      elErro,
      acoes,
    );
    campoToken.focus();
  }

  // ------------------------------------------------------------ a lista

  function visiveis() {
    const termo = filtroTexto.trim().toLowerCase();
    return ultima.issues.filter((i) => {
      if (filtroProjeto === SEM_PROJETO && i.projeto) return false;
      if (filtroProjeto !== TODOS && filtroProjeto !== SEM_PROJETO
        && (!i.projeto || i.projeto.id !== filtroProjeto)) return false;
      if (!termo) return true;
      return `${i.issue} ${i.title}`.toLowerCase().includes(termo);
    });
  }

  function linha(i) {
    const li = criar('li', 'inbox-linha');
    li.dataset.id = i.id;

    const topo = criar('div', 'inbox-topo');
    const estado = criar('span', `inbox-estado inbox-estado-${String(i.estado.tipo).toLowerCase()}`, i.estado.nome || i.estado.tipo);
    topo.append(criar('span', 'inbox-id mono', i.issue), estado);

    const titulo = criar('div', 'inbox-titulo', i.title || '(sem título)');
    titulo.title = i.title;

    const destino = i.projeto
      ? `→ ${i.projeto.nome}`
      : MOTIVOS[i.motivo] || 'não dá para abrir aqui';
    const meta = criar('div', `inbox-meta${i.projeto ? '' : ' inbox-meta-sem'}`,
      `${i.repo || 'sem repositório'} · ${i.branch} ${destino}`);

    const texto = criar('div', 'inbox-texto');
    texto.append(topo, titulo, meta);

    const status = criar('div', 'inbox-status');
    status.hidden = true;
    texto.append(status);

    const acoes = criar('div', 'inbox-acoes');
    const abrir = botao('Abrir', 'primario', () => abrirIssue(i, abrir, status));
    abrir.disabled = !i.projeto;
    abrir.title = i.projeto
      ? `Abre uma sessão em ${i.projeto.nome}, no branch ${i.branch}`
      + (i.temDescricao ? ', com a descrição na caixa do Claude' : '')
      : destino;
    acoes.append(abrir);
    if (i.url) {
      const ver = botao('↗', 'inbox-ver', () => window.orq.abrirExterno(i.url));
      ver.title = 'Ver a issue no Flow';
      acoes.append(ver);
    }

    li.append(texto, acoes);
    return li;
  }

  function desenharLista() {
    const { usuario, base, issues } = ultima;

    const quem = criar('span', 'inbox-quem',
      `${usuario.nome || usuario.email || 'conectado'} · ${base.replace(/^https?:\/\//, '')}`);
    const recarregar = botao('Atualizar', '', () => atualizar(true));
    recarregar.id = 'inbox-atualizar';
    const sair = botao('Desconectar', '', async () => {
      await window.orq.flowDesconectar();
      ultima = null;
      desenharConectar(base);
    });
    sair.id = 'inbox-sair';
    const cabeca = criar('div', 'inbox-cabeca');
    cabeca.append(quem, recarregar, sair);

    // O filtro por projeto so oferece projetos que aparecem na lista: um
    // seletor com os vinte cadastrados e zero issues em dezoito seria ruido.
    const nomes = new Map();
    for (const i of issues) if (i.projeto) nomes.set(i.projeto.id, i.projeto.nome);
    if (filtroProjeto !== TODOS && filtroProjeto !== SEM_PROJETO && !nomes.has(filtroProjeto)) {
      filtroProjeto = TODOS;
    }
    const seletor = criar('select', 'inbox-filtro');
    seletor.id = 'inbox-projeto';
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

    const busca = criar('input', 'scripts-campo inbox-busca');
    busca.id = 'inbox-busca';
    busca.type = 'text';
    busca.spellcheck = false;
    busca.placeholder = 'Filtrar por identificador ou título';
    busca.value = filtroTexto;
    busca.addEventListener('input', () => { filtroTexto = busca.value; desenharItens(); });

    const filtros = criar('div', 'inbox-filtros');
    filtros.append(seletor, busca);

    const lista = criar('ol', 'inbox-lista');
    lista.id = 'inbox-lista';

    function desenharItens() {
      const itens = visiveis();
      if (!issues.length) {
        lista.replaceChildren(criar('li', 'historico-vazio', 'Nenhuma issue aberta atribuída a você.'));
      } else if (!itens.length) {
        lista.replaceChildren(criar('li', 'historico-vazio', 'Nenhuma issue com este filtro.'));
      } else {
        lista.replaceChildren(...itens.map(linha));
      }
    }
    desenharItens();

    elCorpo.replaceChildren(cabeca, filtros, lista);
  }

  async function abrirIssue(i, btn, status) {
    btn.disabled = true;
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
    btn.textContent = 'Abrir';
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
    const r = await window.orq.flowIssues();
    // Ultima-chamada-vence, e nada a desenhar com a tela fechada.
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
    const erro = criar('p', 'historico-vazio', (r && r.texto) || 'não deu para ler o Flow');
    const tentar = botao('Tentar de novo', '', () => atualizar(true));
    elCorpo.replaceChildren(erro, tentar);
  }

  async function abrir() {
    elInbox.hidden = false;
    const s = await window.orq.flowSituacao();
    if (elInbox.hidden) return;
    if (!s.conectado) {
      ultima = null;
      desenharConectar(s.base);
      return;
    }
    atualizar(true);
  }

  function fechar() {
    elInbox.hidden = true;
  }

  // Voltar para a janela com a inbox aberta: a lista pode ter mudado no Flow
  // enquanto voce estava la. O piso impede o alt-tab de virar marretada.
  window.addEventListener('focus', () => {
    if (!elInbox.hidden && ultima) atualizar(false);
  });

  btnFechar?.addEventListener('click', fechar);
  btnLateral?.addEventListener('click', abrir);
  window.OrqOverlays?.registrar(elInbox, fechar);

  window.OrqInbox = { abrir, fechar, atualizar, MS_PISO };
})();
