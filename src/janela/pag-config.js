'use strict';

// Configuracoes (redesign R6): uma pagina de tela cheia, no molde do Orca, no
// lugar de "procurar na paleta". Navegacao em grupos a esquerda, busca
// (Ctrl+F) que filtra as linhas, e linhas de titulo + descricao + controle.
//
// NENHUMA REGRA NOVA MORA AQUI. Cada controle chama a funcao que ja existia e
// ja tinha teste: OrqCasca.mudar, OrqLateral.alternarAvisos, OrqGrade.
// alternarTelas, OrqOrquestrar.alternar, o botao de hooks da lateral... A
// pagina e uma VISTA das preferencias, e o dono de cada uma continua sendo quem
// era.
//
// Desenha tudo de novo a cada mudanca (a pagina e pequena e so existe com ela
// na tela); a posicao de rolagem e o texto da busca sobrevivem ao redesenho.

(() => {
  const TEXTO_REVISAO_EXEMPLO = '{branch}';

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

  // ------------------------------------------------------------ controles

  function interruptor(ligado, rotulo, aoMudar) {
    const b = criar('button', `cfg-switch${ligado ? ' ligado' : ''}`);
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(Boolean(ligado)));
    b.setAttribute('aria-label', rotulo);
    b.append(criar('span', 'cfg-switch-bolota'));
    b.addEventListener('click', () => aoMudar(!ligado));
    return b;
  }

  function segmentado(opcoes, atual, aoEscolher, rotulo) {
    const g = criar('div', 'segmentado');
    g.setAttribute('role', 'group');
    if (rotulo) g.setAttribute('aria-label', rotulo);
    for (const [valor, texto] of opcoes) {
      const b = botao(texto, String(valor) === String(atual) ? 'ativa' : '', () => aoEscolher(valor));
      b.setAttribute('aria-pressed', String(String(valor) === String(atual)));
      g.append(b);
    }
    return g;
  }

  // Uma linha: titulo, descricao e o controle a direita. `busca` e o texto
  // extra que a busca casa (sinonimos).
  function linha(titulo, descricao, controle, busca = '') {
    const l = criar('div', 'cfg-linha');
    l.dataset.busca = `${titulo} ${descricao} ${busca}`.toLowerCase();
    const textos = criar('div', 'cfg-textos');
    const t = criar('div', 'cfg-titulo');
    if (titulo instanceof Node) t.append(titulo); else t.textContent = titulo;
    textos.append(t);
    if (descricao) textos.append(criar('div', 'cfg-descricao', descricao));
    l.append(textos);
    if (controle) {
      const c = criar('div', 'cfg-controle');
      for (const x of [].concat(controle)) if (x) c.append(x);
      l.append(c);
    }
    return l;
  }

  function cartao(titulo, linhas) {
    const sec = criar('section', 'cfg-secao');
    sec.append(criar('h2', 'cfg-secao-titulo', titulo));
    const c = criar('div', 'cfg-cartao');
    for (const l of linhas) if (l) c.append(l);
    sec.append(c);
    return sec;
  }

  function chip(texto, tom) {
    return criar('span', `cfg-chip${tom ? ` cfg-chip-${tom}` : ''}`, texto);
  }

  const mudar = (parcial) => window.OrqCasca.mudar(parcial);
  const ui = () => window.OrqCasca.ui();

  // ------------------------------------------------------------ grupos

  function grupoAparencia() {
    const u = ui();
    const presets = window.OrqAcento?.PRESETS || [];
    const cores = criar('div', 'cfg-cores');
    for (const p of presets) {
      const b = botao('', `cfg-cor${p.cor === u.acento ? ' ativa' : ''}`, () => mudar({ acento: p.cor }));
      b.style.background = p.cor;
      b.title = p.nome;
      b.setAttribute('aria-label', `Cor de destaque ${p.nome}`);
      cores.append(b);
    }
    cores.append(botao('Outra…', 'cfg-botao', () => window.OrqAcento?.abrir()));

    const tamanho = Number(u.tamanhoTerminal) || 11.5;
    const passo = criar('div', 'cfg-passo');
    passo.append(
      botao('−', 'cfg-passo-b', () => mudar({ tamanhoTerminal: Math.max(9, tamanho - 0.5) })),
      criar('span', 'cfg-passo-v mono', String(tamanho).replace('.', ',')),
      botao('+', 'cfg-passo-b', () => mudar({ tamanhoTerminal: Math.min(20, tamanho + 0.5) })),
    );

    return [
      cartao('Tema e cores', [
        linha('Tema', 'O terminal continua escuro nos dois temas.',
          segmentado([['escuro', 'Escuro'], ['claro', 'Claro']], u.tema, (v) => mudar({ tema: v }), 'Tema'),
          'claro escuro dark light'),
        linha('Cor de destaque',
          'Base do botão principal, da sessão rodando e dos interruptores. O tom é ajustado para manter contraste AA.',
          cores, 'acento accent'),
      ]),
      cartao('Fontes', [
        linha('Fontes da interface e do terminal',
          `${u.fonteUi || 'Space Grotesk (padrão)'} · ${u.fonteMono || 'JetBrains Mono (padrão)'}. Só fontes instaladas nesta máquina.`,
          botao('Escolher…', 'cfg-botao', () => window.OrqFontes?.abrir()), 'fonte font'),
        linha('Tamanho do terminal', 'De 9 a 20, em meio ponto.', passo, 'fonte tamanho zoom'),
      ]),
    ];
  }

  function grupoSessoes() {
    const u = ui();
    const layouts = window.OrqLayouts?.listar?.() || [];
    const listaLayouts = criar('div', 'cfg-lista');
    for (const l of layouts) {
      const item = criar('div', 'cfg-lista-item');
      item.append(
        criar('span', 'cfg-lista-nome', l.nome),
        criar('span', 'cfg-lista-meta', `${l.paineis.length} ${l.paineis.length === 1 ? 'painel' : 'painéis'}`),
        botao('Aplicar', 'cfg-botao', () => window.OrqLayouts.aplicar(l.nome)),
        botao('Remover', 'cfg-botao cfg-botao-fraco', async () => {
          await window.OrqLayouts.remover(l.nome);
          desenhar();
        }),
      );
      listaLayouts.append(item);
    }
    // O Electron nao implementa `window.prompt`: o nome e digitado aqui mesmo.
    const novoLayout = criar('div', 'cfg-lista-item cfg-lista-novo');
    const nomeLayout = criar('input', 'cfg-campo');
    nomeLayout.placeholder = 'Nome do layout (ex.: revisão)';
    nomeLayout.setAttribute('aria-label', 'Nome do novo layout');
    nomeLayout.id = 'cfg-layout-nome';
    const salvarLayout = botao('Salvar arranjo atual', 'cfg-botao', async () => {
      const nome = nomeLayout.value.trim();
      if (!nome) { nomeLayout.focus(); return; }
      await window.OrqLayouts.salvarAtual(nome);
      desenhar();
    });
    novoLayout.append(nomeLayout, salvarLayout);
    listaLayouts.append(novoLayout);

    const padrao = window.OrqPainel?.TEXTO_REVISAO_PADRAO || '';
    const campoRevisao = criar('textarea', 'cfg-campo cfg-area');
    campoRevisao.id = 'cfg-texto-revisao';
    campoRevisao.rows = 3;
    campoRevisao.value = u.textoRevisao || padrao;
    campoRevisao.setAttribute('aria-label', 'Texto do botão Revisão');
    const acoesRevisao = criar('div', 'cfg-linha-acoes');
    acoesRevisao.append(
      botao('Salvar texto', 'cfg-botao', () => {
        const t = campoRevisao.value.replace(/\s*\n\s*/g, ' ').trim();
        mudar({ textoRevisao: t === padrao ? '' : t });
        window.OrqToast?.mostrar('Texto da Revisão salvo');
      }),
      botao('Restaurar o padrão', 'cfg-botao cfg-botao-fraco', () => mudar({ textoRevisao: '' })),
    );
    const revisao = linha('Texto do botão Revisão',
      `Colado na caixa do Claude, sem Enter. ${TEXTO_REVISAO_EXEMPLO} vira "na respectiva branch", ou o plural numa implementação dupla.`,
      null, 'revisao review commit push');
    revisao.classList.add('cfg-linha-bloco');
    revisao.append(campoRevisao, acoesRevisao);

    return [
      cartao('Grade e lateral', [
        linha('Colunas da grade', 'P é o molde personalizado, desenhado arrastando a alça dos painéis.',
          segmentado([[1, '1'], [2, '2'], [3, '3'], ['p', 'P']], u.densidade,
            (v) => mudar({ densidade: v }), 'Colunas'), 'densidade colunas'),
        linha('Barra lateral', 'Compacta esconde o branch embaixo do nome. Ctrl+B alterna o trilho recolhido.',
          segmentado([['aberta', 'Aberta'], ['compacta', 'Compacta'], ['fechada', 'Recolhida']], u.lateral,
            (v) => mudar({ lateral: v }), 'Barra lateral'), 'lateral sidebar'),
        linha('Medidor de uso do Claude', 'As barras de 5h e 7d na barra de título.',
          interruptor(u.uso !== 'oculto', 'Medidor de uso', (v) => mudar({ uso: v ? 'barras' : 'oculto' })),
          'uso limite usage'),
      ]),
      cartao('Layouts salvos', [
        linha('Layouts', 'O arranjo dos painéis com tema e densidade. Aplicar fecha os painéis atuais e os traz dormindo.',
          null, 'layout arranjo'),
        listaLayouts,
      ]),
      cartao('Revisão', [revisao]),
      cartao('Terminais e avisos', [
        linha('Avisar fora da janela',
          'Notificação do sistema e o piscar na barra de tarefas quando uma sessão passa a esperar você ou termina.',
          interruptor(window.OrqLateral?.avisosLigados?.(), 'Avisos', () => { window.OrqLateral.alternarAvisos(); setTimeout(desenhar, 200); }),
          'notificacao toast avisos'),
        linha('Guardar a saída dos terminais',
          'As últimas 500 linhas de cada painel voltam ao reabrir o app. Desligar apaga o que já foi guardado.',
          interruptor(window.OrqGrade?.telasLigadas?.(), 'Guardar a saída', () => { window.OrqGrade.alternarTelas(); setTimeout(desenhar, 200); }),
          'telas scrollback privacidade'),
      ]),
    ];
  }

  async function grupoIntegracoes() {
    const u = ui();
    const hooksRotulo = document.getElementById('hooks-rotulo')?.textContent || '';
    const tomHooks = hooksRotulo === 'ligados' ? 'ok' : (hooksRotulo === 'desatualizados' ? 'aviso' : '');
    const flow = await window.orq.flowSituacao();

    const origens = criar('div', 'cfg-lista');
    for (const o of u.origens || []) {
      const item = criar('div', 'cfg-lista-item');
      item.append(
        criar('span', 'cfg-lista-nome mono', o),
        botao('Remover', 'cfg-botao cfg-botao-fraco', async () => {
          await window.orq.uiSalvar({ origens: (ui().origens || []).filter((x) => x !== o) });
          await recarregarUi();
        }),
      );
      origens.append(item);
    }
    const nova = criar('div', 'cfg-lista-item cfg-lista-novo');
    const campoOrigem = criar('input', 'cfg-campo mono');
    campoOrigem.id = 'cfg-origem-nova';
    campoOrigem.placeholder = 'https://…';
    campoOrigem.setAttribute('aria-label', 'Nova origem permitida');
    const erroOrigem = criar('div', 'cfg-erro');
    erroOrigem.id = 'cfg-origem-erro';
    erroOrigem.hidden = true;
    const adicionar = botao('Adicionar', 'cfg-botao', async () => {
      const texto = campoOrigem.value.trim();
      if (!texto) return;
      const salvo = await window.orq.uiSalvar({ origens: [...(ui().origens || []), texto] });
      const aceita = (salvo.origens || []).length > (ui().origens || []).length;
      if (!aceita) {
        erroOrigem.textContent = 'Origem recusada: só https, ou http no próprio computador, sem curinga.';
        erroOrigem.hidden = false;
        return;
      }
      await recarregarUi();
    });
    adicionar.id = 'cfg-origem-adicionar';
    nova.append(campoOrigem, adicionar);
    origens.append(nova, erroOrigem);

    const linhaExterno = linha('Abrir sessões a partir do navegador',
      'Deixa o "Abrir no Claude" do Flow abrir uma sessão aqui. Só as origens abaixo são aceitas.',
      interruptor(u.externo !== 'desligado', 'Abrir pelo navegador', async (v) => {
        await window.orq.uiSalvar({ externo: v ? 'ligado' : 'desligado' });
        await recarregarUi();
      }), 'externo deeplink origem cors');
    linhaExterno.classList.add('cfg-linha-bloco');
    linhaExterno.append(origens);

    return [
      cartao('Hooks do Claude Code', [
        linha((() => {
          const f = document.createDocumentFragment();
          f.append('Hooks de status ', chip(hooksRotulo || 'verificando', tomHooks));
          return f;
        })(),
        'É por eles que a bolinha de cada sessão muda de cor. Ficam no settings.json do Claude Code, com backup antes de gravar.',
        botao(hooksRotulo === 'ligados' ? 'Remover' : 'Instalar', 'cfg-botao', () => {
          document.getElementById('btn-hooks')?.click();
          setTimeout(desenhar, 600);
        }), 'hooks status bolinha'),
      ]),
      cartao('Pronix Flow', [
        linha((() => {
          const f = document.createDocumentFragment();
          f.append('Conta do Flow ', chip(flow.conectado ? 'conectada' : 'desconectada', flow.conectado ? 'ok' : ''));
          return f;
        })(),
        flow.base ? `${flow.base} · token cifrado neste computador` : 'Um token pessoal lê as issues atribuídas a você e as do ciclo atual.',
        flow.conectado
          ? botao('Desconectar', 'cfg-botao cfg-botao-fraco', async () => { await window.orq.flowDesconectar(); desenhar(); })
          : botao('Conectar…', 'cfg-botao', () => window.OrqVistas.ir('issues')),
        'flow token issues'),
        linhaExterno,
      ]),
      cartao('Workers', [
        linha('Deixar uma sessão criar outras',
          'Instala a skill orquestrador no Claude Code. Cada worker nasce num painel, numa worktree e num branch próprios.',
          interruptor(window.OrqOrquestrar?.ligada?.(), 'Workers', async () => {
            await window.OrqOrquestrar.alternar();
            desenhar();
          }), 'orquestracao workers skill'),
      ]),
    ];
  }

  function grupoGit() {
    const u = ui();
    const git = u.git || { base: '', rascunho: false };
    const campoBase = criar('input', 'cfg-campo mono cfg-campo-curto');
    campoBase.id = 'cfg-git-base';
    campoBase.placeholder = 'a base do projeto';
    campoBase.value = git.base || '';
    campoBase.setAttribute('aria-label', 'Branch base padrão do PR');
    campoBase.addEventListener('change', () => mudar({ git: { ...git, base: campoBase.value.trim() } }));

    const projetos = (window.OrqProjetos?.lista?.() || []).map((p) => {
      const s = p.scripts || {};
      const scripts = ['setup', 'run', 'arquivar'].filter((k) => s[k]).join(', ') || 'sem scripts';
      const cor = criar('span', 'cfg-icone-projeto');
      cor.style.color = window.OrqProjetos.tintaDaPasta?.(p.caminho) || '';
      cor.append(window.OrqProjetos.iconeDoProjeto(p));
      const titulo = document.createDocumentFragment();
      titulo.append(cor, p.nome);
      return linha(titulo, `${p.caminho} · ${scripts}`, [
        botao('Scripts…', 'cfg-botao', () => window.OrqScriptsProjeto?.abrir(p.id)),
        botao('Cor e ícone…', 'cfg-botao cfg-botao-fraco', () => window.OrqCorProjeto?.abrir(p.id)),
      ], 'projeto scripts setup run cor icone');
    });
    if (!projetos.length) {
      projetos.push(linha('Nenhum projeto cadastrado', 'Cadastre pela lateral (ícone de pasta) ou pela paleta.',
        botao('Cadastrar projeto', 'cfg-botao', () => window.OrqModalProjeto?.abrir()), 'projeto'));
    }

    return [
      cartao('GitHub e pull requests', [
        linha('Credencial', 'Usa o login que o git desta máquina já tem (git credential). Nenhum token para colar.',
          null, 'github credencial token'),
        linha('Branch base padrão do PR', 'Vazio = a base do projeto (o branch do checkout principal).',
          campoBase, 'base staging main'),
        linha('Criar PR como rascunho', 'Marca "rascunho" por padrão no formulário de novo PR.',
          interruptor(git.rascunho, 'Rascunho por padrão', (v) => mudar({ git: { ...git, rascunho: v } })),
          'draft rascunho'),
      ]),
      cartao('Projetos', projetos),
    ];
  }

  async function grupoApp() {
    const v = await window.orq.versao();
    const linhas = [
      linha(`Versão ${v}`, 'A atualização nunca reinicia sozinha: o botão aparece no rodapé da lateral.',
        botao('Verificar agora', 'cfg-botao', () => window.OrqLateral?.verificarAtualizacao()),
        'versao atualizacao update'),
    ];
    if (window.OrqShell.EH_WIN) {
      linhas.push(linha('Atalho no menu Iniciar', 'Para fixar na barra de tarefas com o ícone certo.',
        botao('Criar atalho', 'cfg-botao', async () => {
          const r = await window.orq.atalhoCriar();
          window.OrqToast?.mostrar(r.erro ? `Não deu para criar o atalho: ${r.erro}` : 'Atalho criado no menu Iniciar');
        }), 'atalho fixar'));
    }
    const mod = window.OrqShell.MOD || 'Ctrl';
    const teclas = [
      [`${mod}+K`, 'Paleta de comandos'],
      [`${mod}+Enter`, 'Ir para a sessão que espera há mais tempo'],
      [`${mod}+B`, 'Recolher a lateral'],
      [`${mod}+,`, 'Configurações'],
      [`${mod}+Shift+I`, 'Issues'],
      [`${mod}+Shift+N`, 'Bloco de notas'],
      ['1 2 3 4', 'Colunas da grade'],
      ['Esc', 'Fechar o que está por cima / voltar para as sessões'],
    ];
    const lista = criar('div', 'cfg-teclas');
    for (const [k, d] of teclas) {
      lista.append(criar('span', 'cfg-kbd mono', k), criar('span', 'cfg-tecla-desc', d));
    }
    linhas.push(linha('Atalhos de teclado', 'A lista completa está na ajuda (F1).', null, 'atalho teclado tecla'));
    linhas.push(lista);
    return [cartao('Aplicativo', linhas)];
  }

  // ------------------------------------------------------------ a pagina

  const GRUPOS = [
    { id: 'aparencia', nome: 'Aparência', icone: 'grade', montar: grupoAparencia },
    { id: 'sessoes', nome: 'Sessões', icone: 'terminal', montar: grupoSessoes },
    { id: 'integracoes', nome: 'Integrações', icone: 'issue', montar: grupoIntegracoes },
    { id: 'git', nome: 'Git e projetos', icone: 'branch', montar: grupoGit },
    { id: 'app', nome: 'Aplicativo', icone: 'seta-cima', montar: grupoApp },
  ];

  const el = criar('section');
  el.id = 'configuracoes';
  const nav = criar('nav', 'cfg-nav');
  const corpo = criar('div', 'cfg-corpo');
  el.append(nav, corpo);

  const voltar = botao('', 'cfg-voltar', () => window.OrqVistas.ir('sessoes'));
  voltar.append(window.OrqIcones.svg('voltar', 'ico-s'), document.createTextNode('Voltar ao app'));
  const caixaBusca = criar('label', 'cfg-busca');
  caixaBusca.append(window.OrqIcones.svg('busca', 'ico-s'));
  const busca = criar('input');
  busca.id = 'cfg-busca';
  busca.placeholder = 'Pesquisar';
  busca.setAttribute('aria-label', 'Pesquisar configurações');
  caixaBusca.append(busca, criar('span', 'cfg-kbd mono', `${window.OrqShell.MOD || 'Ctrl'}+F`));
  const navLista = criar('div', 'cfg-nav-lista');
  for (const g of GRUPOS) {
    const b = botao('', 'cfg-nav-item', () => {
      document.getElementById(`cfg-grupo-${g.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    b.dataset.grupo = g.id;
    b.append(window.OrqIcones.svg(g.icone, 'ico-s'), document.createTextNode(g.nome));
    navLista.append(b);
  }
  nav.append(voltar, caixaBusca, navLista);

  function filtrar() {
    const termo = busca.value.trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const l of corpo.querySelectorAll('.cfg-linha')) {
      const alvo = l.dataset.busca.normalize('NFD').replace(/[̀-ͯ]/g, '');
      l.hidden = Boolean(termo) && !alvo.includes(termo);
    }
    for (const s of corpo.querySelectorAll('.cfg-secao')) {
      s.hidden = Boolean(termo) && !s.querySelector('.cfg-linha:not([hidden])');
    }
    for (const g of corpo.querySelectorAll('.cfg-grupo')) {
      g.hidden = Boolean(termo) && !g.querySelector('.cfg-secao:not([hidden])');
    }
  }
  busca.addEventListener('input', filtrar);

  let desenhando = 0;
  async function desenhar() {
    const minha = ++desenhando;
    const rolagem = corpo.scrollTop;
    const blocos = [];
    for (const g of GRUPOS) {
      const grupo = criar('div', 'cfg-grupo');
      grupo.id = `cfg-grupo-${g.id}`;
      grupo.append(criar('h1', 'cfg-grupo-titulo', g.nome));
      for (const s of await g.montar()) grupo.append(s);
      blocos.push(grupo);
    }
    if (minha !== desenhando) return;
    corpo.replaceChildren(...blocos);
    corpo.scrollTop = rolagem;
    filtrar();
  }

  async function recarregarUi() {
    // `origens` e `externo` nao passam pelo `mudar` (o main normaliza e pode
    // recusar): relemos o ui.json e entregamos ao casca.
    const salvo = await window.orq.uiCarregar();
    mudar({ origens: salvo.origens, externo: salvo.externo });
  }

  // Ctrl+F com a pagina aberta foca a busca dela (no resto do app o Ctrl+F e do
  // bloco de notas, que so o trata com o foco dentro dele).
  window.addEventListener('keydown', (ev) => {
    if (el.hidden || !(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'f') return;
    ev.preventDefault();
    busca.focus();
    busca.select();
  });

  window.OrqCasca.aoMudar(() => { if (!el.hidden) desenhar(); });

  window.OrqVistas.registrar('config', {
    el, titulo: 'Configurações', telaCheia: true, aoMostrar: desenhar,
  });

  function abrir(grupo) {
    window.OrqVistas.ir('config');
    if (grupo) setTimeout(() => document.getElementById(`cfg-grupo-${grupo}`)?.scrollIntoView(), 80);
  }

  const btnConfig = document.getElementById('btn-config');
  btnConfig?.append(window.OrqIcones.svg('filtro'));
  btnConfig?.addEventListener('click', () => {
    window.OrqVistas.ir(window.OrqVistas.atual() === 'config' ? 'sessoes' : 'config');
  });

  window.OrqConfig = { abrir, desenhar, GRUPOS: GRUPOS.map((g) => g.id) };
})();
