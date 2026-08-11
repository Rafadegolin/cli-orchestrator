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

  let ui = { tema: 'escuro', densidade: 2, ordem: 'urgencia' };
  const ouvintes = [];

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
    for (const b of elDensidade.querySelectorAll('button')) {
      b.classList.toggle('ativa', Number(b.dataset.cols) === ui.densidade);
    }
    // Mudar a altura do painel muda cols/rows do terminal. O ResizeObserver de
    // cada painel ja pega isso -- com a janela em primeiro plano, que e a
    // unica situacao em que alguem esta trocando densidade.
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

  elDensidade.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-cols]');
    if (b) mudar({ densidade: Number(b.dataset.cols) });
  });

  elOrdenacao.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-ordem]');
    if (b) mudar({ ordem: b.dataset.ordem });
  });

  elCampo.addEventListener('input', atualizarDica);

  window.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!['1', '2', '3'].includes(ev.key)) return;
    // Digitar "3" no nome da feature nao pode reorganizar a grade.
    const alvo = document.activeElement;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
    // O xterm captura o teclado no proprio textarea, entao digitar dentro de um
    // terminal ja nao chega aqui.
    ev.preventDefault();
    mudar({ densidade: Number(ev.key) });
  });

  window.orq.aoMedir(definirCpu);

  window.OrqCasca = {
    // Leitura, nunca a referencia: ninguem muda preferencia por atribuicao.
    ui: () => ({ ...ui }),
    ordem: () => ui.ordem,
    densidade: () => ui.densidade,
    tema: () => ui.tema,
    mudar,
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
  atualizarDica();
  desenharCarga(0);

  (async () => {
    const salvo = await window.orq.uiCarregar();
    ui = { ...ui, ...salvo };
    aplicarTema();
    aplicarDensidade();
    aplicarOrdem();
    avisar();

    const m = await window.orq.metricas();
    window.OrqCasca.nucleos = m.nucleos;
    definirCpu(m);
  })();
})();
