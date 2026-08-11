'use strict';

// O mapa: os mesmos painéis, posicionados livremente, com as ligacoes
// desenhadas entre eles.
//
// A REGRA QUE DECIDE O DESENHO TODO: o terminal NUNCA e escalado. Um
// `transform: scale()` no container borra o texto do xterm e nao re-rasteriza a
// textura do WebGL -- e a armadilha classica de terminal dentro de canvas. Por
// isso nao ha zoom continuo aqui. Ha dois estados:
//
//   1:1          painéis de verdade, terminais vivos, arrastaveis
//   visao geral  os mesmos painéis viram CARTOES em escala reduzida
//
// Na visao geral o terminal nao encolhe: ele e TROCADO por um cartao. Sem
// escala, sem borrao. E nada se perde -- painel fora da vista ja para de
// desenhar e acumula num buffer desde a Fase 6.1.
//
// TROCAR DE MODO NAO RECRIA PAINEL NENHUM. O xterm e dono do proprio DOM; os
// painéis continuam no mesmo pai e so mudam de posicionamento. Recriar
// destruiria os terminais.

(() => {
  const elApp = document.getElementById('app');
  const elConteudo = document.getElementById('conteudo');
  const elGrade = document.getElementById('grade');

  const LARGURA = 420;
  const ALTURA = 300;
  const FOLGA = 40;

  let svg = null;

  const painéis = () => [...(window.OrqPainel?.painelPorId.values() || [])];

  function modo() {
    return elApp.dataset.modo || 'grade';
  }

  // Quem nunca foi arrastado ganha uma posicao em grade, para o mapa nao nascer
  // com tudo empilhado no canto.
  function arrumarQuemNaoTemLugar() {
    const porLinha = Math.max(1, Math.floor((elConteudo.clientWidth - FOLGA) / (LARGURA + FOLGA)));
    let vaga = 0;

    for (const p of painéis()) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) continue;
      p.x = FOLGA + (vaga % porLinha) * (LARGURA + FOLGA);
      p.y = FOLGA + Math.floor(vaga / porLinha) * (ALTURA + FOLGA);
      vaga += 1;
    }
  }

  function aplicarPosicoes() {
    for (const p of painéis()) {
      p.el.style.left = `${p.x || 0}px`;
      p.el.style.top = `${p.y || 0}px`;
    }
    // A area de rolagem tem de acompanhar o painel mais distante.
    const maxX = Math.max(0, ...painéis().map((p) => (p.x || 0) + LARGURA));
    const maxY = Math.max(0, ...painéis().map((p) => (p.y || 0) + ALTURA));
    elGrade.style.width = `${maxX + FOLGA}px`;
    elGrade.style.height = `${maxY + FOLGA}px`;
  }

  function garantirSvg() {
    if (svg && svg.isConnected) return svg;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'mapa-linhas';
    elGrade.prepend(svg);
    return svg;
  }

  // Uma linha por par ligado. As ligacoes sao entre PASTAS, entao o par se
  // resolve por `painelEm` -- o mesmo caminho que a feature de ligar usa.
  function desenharLinhas() {
    const s = garantirSvg();
    s.setAttribute('width', elGrade.style.width || '100%');
    s.setAttribute('height', elGrade.style.height || '100%');
    s.replaceChildren();

    if (modo() !== 'mapa') return;

    const feitas = new Set();
    for (const p of painéis()) {
      for (const caminho of p.ligacoes || []) {
        const outro = window.OrqLigacoes?.painelEm(caminho);
        if (!outro || outro.id === p.id) continue;

        const chave = [p.id, outro.id].sort().join('|');
        if (feitas.has(chave)) continue;
        feitas.add(chave);

        const linha = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        linha.setAttribute('x1', String((p.x || 0) + LARGURA / 2));
        linha.setAttribute('y1', String((p.y || 0) + ALTURA / 2));
        linha.setAttribute('x2', String((outro.x || 0) + LARGURA / 2));
        linha.setAttribute('y2', String((outro.y || 0) + ALTURA / 2));
        linha.setAttribute('class', 'mapa-linha');
        linha.dataset.de = p.id;
        linha.dataset.para = outro.id;
        s.append(linha);
      }
    }
  }

  function redesenhar() {
    if (modo() !== 'mapa') return;
    arrumarQuemNaoTemLugar();
    aplicarPosicoes();
    desenharLinhas();
  }

  // ------------------------------------------------------------- arrastar

  let arrastando = null;

  function aoPressionar(ev) {
    if (modo() !== 'mapa') return;
    // So pelo cabecalho: o corpo e o terminal, e arrastar dali roubaria a
    // selecao de texto.
    const cab = ev.target.closest('.painel-cab');
    if (!cab || ev.target.closest('button')) return;

    const el = cab.closest('.painel');
    const p = window.OrqPainel.painelPorId.get(el?.dataset.id);
    if (!p) return;

    arrastando = { p, dx: ev.clientX - (p.x || 0), dy: ev.clientY - (p.y || 0) };
    el.classList.add('arrastando');
    ev.preventDefault();
  }

  function aoMover(ev) {
    if (!arrastando) return;
    const { p, dx, dy } = arrastando;
    p.x = Math.max(0, Math.round(ev.clientX - dx));
    p.y = Math.max(0, Math.round(ev.clientY - dy));
    p.el.style.left = `${p.x}px`;
    p.el.style.top = `${p.y}px`;
    desenharLinhas();
  }

  function aoSoltar() {
    if (!arrastando) return;
    arrastando.p.el.classList.remove('arrastando');
    arrastando = null;
    aplicarPosicoes();
    desenharLinhas();
    window.OrqGrade?.salvarSessao?.();
  }

  elGrade.addEventListener('mousedown', aoPressionar);
  window.addEventListener('mousemove', aoMover);
  window.addEventListener('mouseup', aoSoltar);

  // ---------------------------------------------------------------- modos

  function definirModo(novo) {
    const alvo = novo === 'mapa' ? 'mapa' : 'grade';
    elApp.dataset.modo = alvo;

    if (alvo === 'grade') {
      // Devolve o layout para a grade: as posicoes ficam guardadas nos painéis
      // e voltam intactas quando voce voltar ao mapa.
      elGrade.style.width = '';
      elGrade.style.height = '';
      for (const p of painéis()) {
        p.el.style.left = '';
        p.el.style.top = '';
      }
      if (svg) svg.replaceChildren();
    } else {
      redesenhar();
    }

    // O painel muda de tamanho entre os modos, entao o terminal precisa refluir
    // -- cada um com o proprio debounce, como sempre.
    for (const p of painéis()) p.agendarAjuste();
    // Marcar os controles E PARTE DE TROCAR DE MODO, nao tarefa de quem chama:
    // deixar isso a cargo do chamador e garantir que uma hora alguem esquece.
    marcarControles();
    window.OrqGrade?.salvarSessao?.();
    return alvo;
  }

  function alternarModo() {
    return definirModo(modo() === 'mapa' ? 'grade' : 'mapa');
  }

  function definirVisao(geral) {
    elApp.dataset.visao = geral ? 'geral' : 'perto';
    // Sem escala no terminal: a visao geral TROCA o painel por um cartao (CSS),
    // entao aqui so o tamanho da area muda.
    redesenhar();
    for (const p of painéis()) p.agendarAjuste();
    marcarControles();
  }

  function alternarVisao() {
    const geral = elApp.dataset.visao !== 'geral';
    definirVisao(geral);
    return geral;
  }

  // ------------------------------------------------------------- controles

  const elModos = document.getElementById('modos');
  const btnVisao = document.getElementById('btn-visao');

  function marcarControles() {
    const atual = modo();
    for (const b of elModos?.querySelectorAll('button') || []) {
      b.classList.toggle('ativa', b.dataset.modo === atual);
    }
    // A visao geral so faz sentido no mapa; na grade a densidade ja cumpre esse
    // papel, e dois controles para a mesma coisa e um a mais.
    if (btnVisao) {
      btnVisao.hidden = atual !== 'mapa';
      btnVisao.classList.toggle('ativa', elApp.dataset.visao === 'geral');
    }
  }

  elModos?.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-modo]');
    if (!b) return;
    definirModo(b.dataset.modo);
    marcarControles();
  });

  btnVisao?.addEventListener('click', () => {
    alternarVisao();
    marcarControles();
  });

  // A lateral e o status mudam o tempo todo; as linhas acompanham.
  window.OrqCasca?.aoMudar(() => redesenhar());
  elConteudo.addEventListener('scroll', () => { if (modo() === 'mapa') desenharLinhas(); });
  marcarControles();

  window.OrqMapa = {
    modo, definirModo, alternarModo, redesenhar, desenharLinhas,
    definirVisao, alternarVisao, marcarControles,
    visao: () => elApp.dataset.visao || 'perto',
    LARGURA, ALTURA,
    linhas: () => [...(svg?.querySelectorAll('.mapa-linha') || [])],
  };
})();
