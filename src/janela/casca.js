'use strict';

// A casca: tema, densidade da grade, ordenacao e o placar da lateral.
//
// Tudo dentro de uma IIFE de proposito. painel.js, grade.js, lateral.js e
// projetos.js sao scripts classicos e dividem UM escopo lexico global, onde
// repetir um nome de topo e SyntaxError silencioso. Este arquivo carrega antes
// de todos eles e nao tem por que disputar nomes.

(() => {
  const elApp = document.getElementById('app');
  const btnTema = document.getElementById('btn-tema');
  const elOrdenacao = document.getElementById('ordenacao');
  const elDensidade = document.getElementById('densidade');
  const btnLateral = document.getElementById('btn-lateral');
  const elCampo = document.getElementById('nome-feature');
  const elDica = document.getElementById('barra-dica');
  const elNum = document.getElementById('placar-num');
  const elCpu = document.getElementById('placar-cpu');
  const elCarga = document.getElementById('placar-carga');
  const elToast = document.getElementById('toast');

  const SEGMENTOS = 14;
  // As tres ultimas casas viram ambar: a barra tem de dizer "esta apertando"
  // antes de encher, senao so avisa quando ja e tarde.
  const SEGMENTOS_QUENTES = 3;

  // O molde do slot personalizado vem junto das outras preferencias, e nao do
  // sessao.json: ele e o FORMATO da tela, que sobrevive a qualquer conjunto de
  // sessoes. Quem normaliza de verdade e o processo principal.
  // Estes defaults valem so ate o `uiCarregar()` responder -- mas nao sao
  // decorativos: `uso` faltava aqui, e por causa disso `ui().uso` era `undefined`
  // nessa janela, o que fazia o item da paleta mostrar o rotulo errado se voce
  // abrisse a paleta rapido demais. Toda preferencia nova entra nas DUAS listas.
  let ui = {
    tema: 'escuro',
    densidade: 2,
    ordem: 'urgencia',
    lateral: 'aberta',
    uso: 'barras',
    avisos: 'ligados',
    personalizado: { cols: 3, alturaLinha: 160, celulas: [] },
  };
  const ouvintes = [];

  // A plataforma vira atributo, como `data-modo` e `data-densidade`: e o CSS
  // que precisa saber, porque no macOS os botoes de janela ficam a ESQUERDA e a
  // reserva de espaco da barra de titulo inverte de lado.
  elApp.dataset.plataforma = window.OrqShell.EH_MAC ? 'mac' : 'win';

  // Os rotulos de tecla que estao ESCRITOS no HTML. O resto da tela ja monta o
  // seu a partir do `OrqShell.MOD`; estes tres sao estaticos e mentiriam num
  // Mac, onde nao existe Ctrl nem F1 util.
  (() => {
    const mod = window.OrqShell.MOD;
    const ajudaTecla = window.OrqShell.EH_MAC ? `${mod}+/` : 'F1';
    const busca = document.getElementById('btn-busca');
    if (busca) {
      busca.title = `Buscar sessão, projeto ou comando (${mod}+K)`;
      const t = busca.querySelector('.tecla');
      if (t) t.textContent = `${mod}+K`;
    }
    const ajuda = document.querySelector('#btn-ajuda .mono');
    if (ajuda) ajuda.textContent = ajudaTecla;
  })();

  // ------------------------------------------------------------- aplicar

  function aplicarTema() {
    document.documentElement.classList.toggle('claro', ui.tema === 'claro');
    // Simbolo do que voce VAI ativar, nao do estado atual: e o padrao que todo
    // alternador de tema usa e o que as pessoas ja esperam.
    btnTema.textContent = ui.tema === 'claro' ? '☾' : '☀';
    btnTema.title = ui.tema === 'claro' ? 'Mudar para o tema escuro' : 'Mudar para o tema claro';
  }

  function aplicarDensidade() {
    elApp.dataset.densidade = String(ui.densidade);
    // Comparacao por STRING: o slot personalizado e 'p', e `Number('p')` e NaN
    // -- que nunca casa com nada, nem consigo mesmo.
    for (const b of elDensidade.querySelectorAll('button')) {
      b.classList.toggle('ativa', b.dataset.cols === String(ui.densidade));
    }

    // As duas medidas do molde saem daqui para o CSS. Fora do slot 'p' elas nao
    // sao lidas por regra nenhuma, mas escrever sempre evita que um retorno ao
    // 'p' pegue o valor do molde anterior.
    const molde = ui.personalizado || {};
    elApp.style.setProperty('--pcols', String(molde.cols || 3));
    elApp.style.setProperty('--altura-linha', `${molde.alturaLinha || 160}px`);
    window.OrqPersonalizado?.aplicar();

    // Mudar a altura do painel muda cols/rows do terminal. O ResizeObserver de
    // cada painel ja pega isso -- com a janela em primeiro plano, que e a
    // unica situacao em que alguem esta trocando densidade.
  }

  // Recolher a lateral alarga a grade, entao TODO terminal precisa refluir. Nada
  // e chamado aqui: o ResizeObserver de cada painel ja pega a mudanca de largura
  // com o debounce dele, que e exatamente o mesmo caminho da troca de densidade.
  function aplicarLateral() {
    const fechada = ui.lateral === 'fechada';
    elApp.dataset.lateral = fechada ? 'fechada' : 'aberta';
    if (!btnLateral) return;
    const mod = window.OrqShell.MOD;
    btnLateral.title = fechada
      ? `Mostrar a barra lateral (${mod}+B)`
      : `Ocultar a barra lateral (${mod}+B)`;
    btnLateral.setAttribute('aria-pressed', String(fechada));
  }

  function aplicarOrdem() {
    for (const b of elOrdenacao.querySelectorAll('button')) {
      b.classList.toggle('ativa', b.dataset.ordem === ui.ordem);
    }
  }

  function avisar() {
    for (const fn of ouvintes) {
      try {
        fn({ ...ui });
      } catch (err) {
        console.error('[casca] ouvinte falhou:', err);
      }
    }
  }

  // Grava sem esperar: preferencia e barata e o disco nao pode segurar a tela.
  function mudar(parcial) {
    ui = { ...ui, ...parcial };
    aplicarTema();
    aplicarDensidade();
    aplicarOrdem();
    aplicarLateral();
    avisar();
    window.orq.uiSalvar(parcial);
  }

  // -------------------------------------------------------------- placar

  function desenharCarga(cpu) {
    if (elCarga.childElementCount !== SEGMENTOS) {
      elCarga.replaceChildren(...Array.from({ length: SEGMENTOS }, () => document.createElement('span')));
    }
    const acesos = Math.round((Math.min(100, Math.max(0, cpu)) / 100) * SEGMENTOS);
    elCarga.querySelectorAll('span').forEach((s, i) => {
      const aceso = i < acesos;
      s.classList.toggle('aceso', aceso && i < SEGMENTOS - SEGMENTOS_QUENTES);
      s.classList.toggle('cheio', aceso && i >= SEGMENTOS - SEGMENTOS_QUENTES);
    });
  }

  function definirCpu({ cpu }) {
    elCpu.textContent = `cpu ${cpu}%`;
    elCpu.title = `Uso de CPU do app inteiro (todos os processos), sobre ${
      window.OrqCasca.nucleos || '?'} núcleos`;
    desenharCarga(cpu);
  }

  // Chamado pela lateral quando a lista de sessoes muda -- em vez de este
  // arquivo ficar consultando de tempos em tempos. Nada aqui acorda a CPU
  // sozinho.
  function definirVivas(n) {
    elNum.textContent = String(n);
  }

  // ------------------------------------------------------------ overlays

  // Uma saida so para ajuda, seletor, paleta e modal.
  //
  // Antes cada um tinha o proprio `keydown` de Esc e o proprio clique-fora --
  // quatro copias da mesma regra, e com dois abertos ao mesmo tempo um Esc
  // fechava os dois. Aqui o Esc fecha o TOPO DA PILHA e para por ali.
  const overlays = [];

  // A pilha segue a ordem de ABERTURA, nunca a ordem do HTML.
  //
  // Com ordem do HTML, abrir o historico com a ajuda aberta mostrava a ajuda
  // por cima (ela vem depois no documento) enquanto o Esc fechava o historico:
  // voce via um e fechava outro. O z-index acompanha a mesma pilha.
  const Z_BASE = 40;
  let ordemAbertura = 0;

  function aoTopo(reg) {
    reg.ordem = ++ordemAbertura;
    reg.el.style.zIndex = String(Z_BASE + reg.ordem);
  }

  function registrarOverlay(el, fechar) {
    if (!el) return;
    const reg = { el, fechar, ordem: 0 };
    overlays.push(reg);

    // Clicar no fundo do overlay fecha; clicar no cartao dentro dele nao.
    el.addEventListener('click', (ev) => { if (ev.target === el) fechar(); });

    // Observa o proprio atributo em vez de exigir que cada modulo avise quando
    // abre: aviso que depende de lembrar e aviso que uma hora falta.
    const obs = new MutationObserver(() => { if (!el.hidden) aoTopo(reg); });
    obs.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    if (!el.hidden) aoTopo(reg);
  }

  function overlayNoTopo() {
    let topo = null;
    for (const o of overlays) {
      if (o.el.hidden) continue;
      if (!topo || o.ordem > topo.ordem) topo = o;
    }
    return topo;
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const topo = overlayNoTopo();
    if (!topo) return;
    ev.preventDefault();
    ev.stopPropagation();
    topo.fechar();
  }, true);

  // --------------------------------------------------------------- toast

  // Confirma acao concluida cujo efeito nao esta todo a vista, e -- mais
  // importante aqui -- da resposta visivel quando o app SE RECUSA a fazer algo.
  const MS_TOAST = 2200;
  let timerToast = null;

  function mostrarToast(texto) {
    if (!texto) return;
    elToast.textContent = '';
    const ponto = document.createElement('span');
    ponto.className = 'toast-ponto';
    const msg = document.createElement('span');
    msg.textContent = texto;
    elToast.append(ponto, msg);
    elToast.hidden = false;

    clearTimeout(timerToast);
    timerToast = setTimeout(() => { elToast.hidden = true; }, MS_TOAST);
  }

  // ---------------------------------------------------------------- dica

  // A dica diz o que VAI ACONTECER de verdade, incluindo o nome do branch.
  //
  // O `worktree-` nao e nosso: e o `claude -w` que o poe, e nao ha opcao para
  // mudar isso (medido: a flag aceita `[name]` e mais nada). Mostrar aqui e o
  // que evita a surpresa de procurar um branch que tem outro nome.
  function atualizarDica() {
    const bruto = (elCampo.value || '').trim();
    const slug = window.OrqProjetos ? window.OrqProjetos.slugFeature(bruto) : bruto;
    elDica.textContent = slug
      ? `cria o worktree ${slug} · branch worktree-${slug}`
      : 'sem nome, roda na pasta do projeto sem criar worktree';
  }

  // ------------------------------------------------------------- eventos

  btnTema.addEventListener('click', () => mudar({ tema: ui.tema === 'claro' ? 'escuro' : 'claro' }));

  function alternarLateral() {
    mudar({ lateral: ui.lateral === 'fechada' ? 'aberta' : 'fechada' });
    return ui.lateral;
  }

  btnLateral?.addEventListener('click', alternarLateral);

  // Ctrl+B na fase de CAPTURA, e com stopPropagation.
  //
  // O xterm escuta no proprio textarea, que e mais fundo que a window: em fase
  // de captura este ouvinte roda ANTES dele, entao o terminal nunca recebe o
  // \x02. Sem isso, recolher a lateral com o cursor num terminal mandaria um
  // caractere de controle para a sessao -- justamente o que este app existe
  // para nao fazer. (E o mesmo caminho do Esc dos overlays, logo acima.)
  window.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
    if (ev.key.toLowerCase() !== 'b') return;
    ev.preventDefault();
    ev.stopPropagation();
    alternarLateral();
  }, true);

  elDensidade.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-cols]');
    if (b) mudar({ densidade: b.dataset.cols === 'p' ? 'p' : Number(b.dataset.cols) });
  });

  elOrdenacao.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-ordem]');
    if (b) mudar({ ordem: b.dataset.ordem });
  });

  elCampo.addEventListener('input', atualizarDica);

  window.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!['1', '2', '3', '4'].includes(ev.key)) return;
    // Digitar "3" no nome da feature nao pode reorganizar a grade.
    const alvo = document.activeElement;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
    // A guarda acima e que protege o terminal, e NAO o xterm: ele so faz
    // stopPropagation nas teclas que consome, e "1".."4" puras ele nao consome.
    // O que salva e o helper dele ser um <textarea>, apanhado pela linha
    // anterior. Removeu a guarda achando que o xterm cobre? Digitar "3" no
    // terminal passa a reorganizar a grade.
    ev.preventDefault();
    // O 4 segue a POSICAO do botao na barra, e nao um numero de colunas: o slot
    // personalizado e a quarta pilula.
    mudar({ densidade: ev.key === '4' ? 'p' : Number(ev.key) });
  });

  window.orq.aoMedir(definirCpu);

  window.OrqCasca = {
    // Leitura, nunca a referencia: ninguem muda preferencia por atribuicao.
    ui: () => ({ ...ui }),
    ordem: () => ui.ordem,
    densidade: () => ui.densidade,
    tema: () => ui.tema,
    lateral: () => ui.lateral,
    mudar,
    alternarLateral,
    definirVivas,
    atualizarDica,
    aoMudar: (fn) => ouvintes.push(fn),
    nucleos: 0,
    SEGMENTOS,
  };

  window.OrqToast = { mostrar: mostrarToast, MS_TOAST };
  window.OrqOverlays = { registrar: registrarOverlay, noTopo: overlayNoTopo, lista: overlays };

  // Estado inicial: aplica o padrao ja (a tela nao pode nascer sem densidade) e
  // corrige quando o disco responder.
  aplicarTema();
  aplicarDensidade();
  aplicarOrdem();
  aplicarLateral();
  atualizarDica();
  desenharCarga(0);

  (async () => {
    const salvo = await window.orq.uiCarregar();
    ui = { ...ui, ...salvo };
    aplicarTema();
    aplicarDensidade();
    aplicarOrdem();
    aplicarLateral();
    avisar();

    const m = await window.orq.metricas();
    window.OrqCasca.nucleos = m.nucleos;
    definirCpu(m);
  })();
})();
