'use strict';
// A casca da nova UI: tokens, tema, densidade e as regras de compressao.
//
// Depende de LAYOUT, entao usa aoFrente() -- o Chromium pausa os passos de
// renderizacao com a janela em segundo plano e nada aqui mediria certo.

const fs = require('fs');
const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..').replace(/\\/g, '/');
const JANELA = path.join(__dirname, '..', 'src', 'janela');

// Os scripts da janela sao CLASSICOS e dividem UM escopo lexico global. Declarar
// o mesmo nome de topo em dois deles nao estoura: a ultima avaliacao vence em
// silencio, e o outro arquivo passa a chamar a funcao errada.
//
// Ja aconteceu duas vezes -- `remover` (fila/lateral) e `projetoDe`
// (lateral/projetos, que quebrou a ordenacao por projeto sem nenhuma mensagem).
// Este teste le a FONTE e fecha a classe inteira, em vez de consertar o caso.
function declaracoesDuplicadas() {
  const porNome = new Map();
  const arquivos = fs.readdirSync(JANELA)
    .filter((f) => f.endsWith('.js'))
    // casca.js vive inteiro dentro de uma IIFE: nao publica nome nenhum.
    .filter((f) => !/^\s*\(\(\) => \{/m.test(fs.readFileSync(path.join(JANELA, f), 'utf8')));

  for (const arquivo of arquivos) {
    const fonte = fs.readFileSync(path.join(JANELA, arquivo), 'utf8');
    for (const linha of fonte.split('\n')) {
      const m = /^(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/.exec(linha);
      if (!m) continue;
      if (!porNome.has(m[1])) porNome.set(m[1], []);
      if (!porNome.get(m[1]).includes(arquivo)) porNome.get(m[1]).push(arquivo);
    }
  }

  return [...porNome.entries()]
    .filter(([, onde]) => onde.length > 1)
    .map(([nome, onde]) => `${nome} (${onde.join(', ')})`);
}

// Larguras de referencia do doc 03: desenho, confortavel, minimo validado.
const LARGURAS = [1440, 1100, 924];

async function estreitar(cdp, largura) {
  await cdp.enviar('Emulation.setDeviceMetricsOverride', {
    width: largura, height: 900, deviceScaleFactor: 0, mobile: false,
  });
  await esperar(700);
}

async function soltar(cdp) {
  await cdp.enviar('Emulation.clearDeviceMetricsOverride');
  await esperar(700);
}

(async () => {
  const cdp = await conectar();
  const frente = await aoFrente(cdp);
  checar('a janela esta em primeiro plano (layout depende disso)', frente, '');

  await zerarGrade(cdp);

  checar('a casca carregou', await cdp.avaliar('typeof window.OrqCasca?.mudar') === 'function');

  // --- 0. escopo global compartilhado, sem nome repetido -----------------
  const duplicadas = declaracoesDuplicadas();
  checar('nenhum nome de topo declarado em dois scripts da janela',
    duplicadas.length === 0, duplicadas.join(' · '));

  // --- 1. fontes vem do disco, nao de fallback --------------------------
  //
  // Sem isto o app cai em system-ui/Consolas e ninguem percebe olhando: a tela
  // fica "quase certa" e a tipografia, que e metade do desenho, se perde.
  const fontes = JSON.parse(await cdp.avaliar(`(async () => {
    await document.fonts.ready;
    return JSON.stringify({
      grotesk: document.fonts.check('12px "Space Grotesk"'),
      mono: document.fonts.check('12px "JetBrains Mono"'),
      corpo: getComputedStyle(document.body).fontFamily,
      remota: [...document.styleSheets].some(f => (f.href || '').startsWith('http')),
    });
  })()`));
  checar('Space Grotesk carregou do disco', fontes.grotesk, fontes.corpo);
  checar('JetBrains Mono carregou do disco', fontes.mono, '');
  checar('nenhuma folha de estilo vem da internet', fontes.remota === false, '');

  // --- 2. barra de titulo -------------------------------------------------
  const titulo = JSON.parse(await cdp.avaliar(`(() => {
    const t = document.getElementById('titulo');
    const r = t.getBoundingClientRect();
    return JSON.stringify({
      altura: Math.round(r.height),
      topo: Math.round(r.top),
      // Espaco reservado para os tres botoes que o Windows desenha por cima.
      reserva: parseFloat(getComputedStyle(t).paddingRight),
      arrasta: getComputedStyle(t).webkitAppRegion,
    });
  })()`));
  checar('a barra de titulo tem 38px no topo', titulo.altura === 38 && titulo.topo === 0,
    JSON.stringify(titulo));
  checar('e reserva a area dos botoes de janela', titulo.reserva > 40, `${titulo.reserva}px`);

  // --- 3. tema ------------------------------------------------------------
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'claro' })`);
  await esperar(400);
  const claro = JSON.parse(await cdp.avaliar(`JSON.stringify({
    classe: document.documentElement.className,
    bg1: getComputedStyle(document.documentElement).getPropertyValue('--bg1').trim(),
    lateral: getComputedStyle(document.getElementById('lateral')).backgroundColor,
  })`));
  checar('tema claro pinta as superficies de claro',
    claro.classe === 'claro' && claro.bg1 === '#ffffff' && claro.lateral === 'rgb(255, 255, 255)',
    JSON.stringify(claro));

  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro' })`);
  await esperar(400);
  checar('e volta para o escuro',
    await cdp.avaliar(`document.documentElement.className`) === '', '');

  // Persistencia: o valor tem de estar no disco, nao so na memoria da janela.
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'claro', densidade: 3, ordem: 'projeto' })`);
  await esperar(500);
  const salvo = JSON.parse(await cdp.avaliar(
    `(async () => JSON.stringify(await window.orq.uiCarregar()))()`));
  checar('tema, densidade e ordenacao foram para o disco',
    salvo.tema === 'claro' && salvo.densidade === 3 && salvo.ordem === 'projeto',
    JSON.stringify(salvo));

  // --- 4. densidade -------------------------------------------------------
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro', densidade: 2, ordem: 'urgencia' })`);
  await esperar(400);

  await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'ui-auth-refresh' }); return 'ok'; })()`);
  await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'ui-dois' }); return 'ok'; })()`);
  await esperar(2500);

  const esperado = { 1: 460, 2: 320, 3: 268 };
  for (const d of [1, 2, 3]) {
    await cdp.avaliar(`window.OrqCasca.mudar({ densidade: ${d} })`);
    await esperar(500);
    const r = JSON.parse(await cdp.avaliar(`(() => {
      const app = document.getElementById('app');
      const est = getComputedStyle(app);
      const painel = document.querySelector('.painel');
      const st = painel.querySelector('.painel-status');
      const grade = getComputedStyle(document.getElementById('grade'));
      return JSON.stringify({
        cols: est.getPropertyValue('--cols').trim(),
        colunasReais: grade.gridTemplateColumns.split(' ').length,
        altura: Math.round(painel.getBoundingClientRect().height),
        rotuloVisivel: getComputedStyle(st).display !== 'none',
        ativa: document.querySelector('#densidade button.ativa')?.dataset.cols,
      });
    })()`));
    checar(`densidade ${d}: ${d} coluna(s) de ${esperado[d]}px`,
      r.cols === String(d) && r.colunasReais === d && r.altura === esperado[d], JSON.stringify(r));
    checar(`densidade ${d}: o botao correspondente fica marcado`, r.ativa === String(d), r.ativa);
    // Na densidade 3 o espaco vale mais que a redundancia; nas outras, cor
    // nunca pode ser o unico portador de significado.
    checar(`densidade ${d}: rotulo de status ${d === 3 ? 'oculto' : 'visivel'}`,
      r.rotuloVisivel === (d !== 3), String(r.rotuloVisivel));
  }

  // Tecla so vale fora de campo de texto: digitar "3" no nome da feature nao
  // pode reorganizar a grade.
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 2 })`);
  await esperar(300);
  await cdp.avaliar(`(() => { document.getElementById('nome-feature').focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true })); return 'ok'; })()`);
  await esperar(300);
  checar('digito com foco num campo de texto e ignorado',
    await cdp.avaliar(`window.OrqCasca.densidade()`) === 2, '');

  await cdp.avaliar(`(() => { document.getElementById('nome-feature').blur(); document.body.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true })); return 'ok'; })()`);
  await esperar(400);
  checar('e fora dele muda a densidade',
    await cdp.avaliar(`window.OrqCasca.densidade()`) === 3, '');

  // --- 5. o terminal fica escuro nos DOIS temas ---------------------------
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'claro', densidade: 2 })`);
  await esperar(500);
  const term = JSON.parse(await cdp.avaliar(`(() => {
    const p = [...window.OrqGrade.painelPorId.values()][0];
    return JSON.stringify({ fundo: p.term.options.theme.background, frente: p.term.options.theme.foreground });
  })()`));
  checar('com o tema claro, o terminal continua escuro',
    term.fundo === '#0b0e12' && term.frente === '#c8d3e0', JSON.stringify(term));
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro' })`);
  await esperar(400);

  // --- 6. placar ----------------------------------------------------------
  const placar = JSON.parse(await cdp.avaliar(`JSON.stringify({
    segmentos: document.getElementById('placar-carga').childElementCount,
    cpu: document.getElementById('placar-cpu').textContent,
    vivas: document.getElementById('placar-num').textContent,
  })`));
  checar('a barra de carga tem 14 segmentos', placar.segmentos === 14, String(placar.segmentos));
  checar('o placar mostra CPU', /^cpu \d+%$/.test(placar.cpu), placar.cpu);
  checar('e conta as sessoes vivas', placar.vivas === '2', placar.vivas);

  // --- 7. compressao: nenhum scroll horizontal, fechar sempre alcancavel ---
  for (const largura of LARGURAS) {
    await estreitar(cdp, largura);
    const r = JSON.parse(await cdp.avaliar(`(() => {
      const painel = document.querySelector('.painel');
      const nome = painel.querySelector('.painel-feature');
      const fechar = painel.querySelector('.painel-fechar');
      const cx = fechar.getBoundingClientRect();
      const emCima = document.elementFromPoint(cx.left + cx.width / 2, cx.top + cx.height / 2);
      return JSON.stringify({
        scrollDoc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollBarra: (() => { const b = document.getElementById('barra'); return b.scrollWidth - b.clientWidth; })(),
        scrollCab: (() => { const c = painel.querySelector('.painel-cab'); return c.scrollWidth - c.clientWidth; })(),
        nomeInteiro: nome.scrollWidth <= nome.clientWidth + 1 && nome.getBoundingClientRect().width > 0,
        fecharClicavel: fechar.contains(emCima) || emCima === fechar,
      });
    })()`));
    checar(`${largura}px: nenhum scroll horizontal`,
      r.scrollDoc <= 0 && r.scrollBarra <= 0 && r.scrollCab <= 0, JSON.stringify(r));
    checar(`${largura}px: o nome da sessao aparece por inteiro`, r.nomeInteiro, '');
    checar(`${largura}px: o botao fechar continua clicavel`, r.fecharClicavel, '');
  }
  await soltar(cdp);

  // --- 8. nome absurdo: degrada, nao estoura -----------------------------
  //
  // "O nome nunca encolhe" e "as acoes sao inegociaveis" nao cabem as duas num
  // painel de 306px se a feature tiver 40 caracteres. A escolha aqui e
  // explicita: o nome ganha reticencias e o botao de fechar sobrevive.
  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 3 })`);
  await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'ui-nome-absurdamente-longo-de-feature-que-ninguem-escreveria' });
    return 'ok'; })()`);
  await esperar(2000);
  await estreitar(cdp, 924);

  const absurdo = JSON.parse(await cdp.avaliar(`(() => {
    const painel = document.querySelector('.painel');
    const cab = painel.querySelector('.painel-cab');
    const nome = painel.querySelector('.painel-feature');
    const fechar = painel.querySelector('.painel-fechar');
    const cx = fechar.getBoundingClientRect();
    const emCima = document.elementFromPoint(cx.left + cx.width / 2, cx.top + cx.height / 2);
    return JSON.stringify({
      estouro: cab.scrollWidth - cab.clientWidth,
      truncou: nome.scrollWidth > nome.clientWidth,
      sobrouNome: Math.round(nome.getBoundingClientRect().width),
      fecharClicavel: fechar.contains(emCima) || emCima === fechar,
    });
  })()`));
  checar('nome absurdo nao estoura o cabecalho', absurdo.estouro <= 0, JSON.stringify(absurdo));
  checar('ele trunca com reticencias em vez de empurrar as acoes', absurdo.truncou, '');
  checar('e ainda sobra nome legivel', absurdo.sobrouNome > 60, `${absurdo.sobrouNome}px`);
  checar('com o botao de fechar alcancavel', absurdo.fecharClicavel, '');
  await soltar(cdp);

  // --- 9. fila de atencao, rotulos e ordenacao ---------------------------
  //
  // Os status entram por OrqLateral.definirStatus (a mesma porta por onde os
  // diffs dos hooks chegam), com `desde` sintetico: esperar 12 minutos de
  // verdade nao e teste, e o caminho do hook ja e coberto pela fase45.
  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 2, ordem: 'urgencia' })`);

  const ids = {};
  for (const f of ['ui-a-espera-velha', 'ui-b-trabalha', 'ui-c-revisar', 'ui-d-espera-nova']) {
    ids[f] = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ)}, feature: ${JSON.stringify(f)} }); return p.id; })()`);
    await esperar(400);
  }
  await esperar(2000);

  const marcar = (id, status, motivo, minutos = 0) =>
    cdp.avaliar(`window.OrqLateral.definirStatus(${JSON.stringify(id)}, ${JSON.stringify(status)},
      ${JSON.stringify(motivo)}, Date.now() - ${minutos} * 60000)`);

  await marcar(ids['ui-a-espera-velha'], 'esperando', 'pedindo permissão', 12);
  await marcar(ids['ui-b-trabalha'], 'rodando', '');
  await marcar(ids['ui-c-revisar'], 'terminou', 'pronto para revisar');
  await marcar(ids['ui-d-espera-nova'], 'esperando', 'parado há 60s', 4);
  await esperar(600);

  const fila = JSON.parse(await cdp.avaliar(`(() => {
    const bloco = document.getElementById('bloco-fila');
    const itens = [...document.querySelectorAll('#fila-lista li')];
    return JSON.stringify({
      visivel: bloco.hidden === false,
      contagem: document.getElementById('fila-contagem').textContent,
      nomes: itens.map(l => l.querySelector('.fila-nome').textContent),
      tempos: itens.map(l => l.querySelector('.fila-espera').textContent),
    });
  })()`));
  checar('a fila de atencao aparece quando alguem espera', fila.visivel, JSON.stringify(fila));
  checar('com a contagem certa', fila.contagem === '2', fila.contagem);
  checar('e quem espera ha mais tempo vem primeiro',
    fila.nomes.join() === 'ui-a-espera-velha,ui-d-espera-nova', fila.nomes.join());
  checar('mostrando o tempo de cada uma',
    fila.tempos[0] === 'há 12min' && fila.tempos[1] === 'há 4min', fila.tempos.join(' / '));

  // O rotulo diz o ESTADO; o motivo do hook vai para o title. Era daqui que
  // saia o "parado ha 60s ha 4min", com o "ha" duas vezes.
  const rotulos = JSON.parse(await cdp.avaliar(`(() => {
    const de = (id) => {
      const p = window.OrqPainel.painelPorId.get(id);
      const card = document.querySelector('#lateral-lista .card[data-id="' + CSS.escape(id) + '"]');
      return {
        painel: p.elStatus.textContent,
        painelTitle: p.elStatus.title,
        card: card?.querySelector('.card-sub')?.textContent,
      };
    };
    return JSON.stringify({
      a: de(${JSON.stringify(ids['ui-a-espera-velha'])}),
      b: de(${JSON.stringify(ids['ui-b-trabalha'])}),
      c: de(${JSON.stringify(ids['ui-c-revisar'])}),
    });
  })()`));
  checar('rotulo de quem espera diz o estado e o tempo',
    rotulos.a.painel === 'esperando há 12min' && rotulos.a.card === 'esperando há 12min',
    JSON.stringify(rotulos.a));
  checar('e o motivo do hook fica no title, fora do rotulo',
    rotulos.a.painelTitle === 'pedindo permissão' && !rotulos.a.painel.includes('permissão'),
    rotulos.a.painelTitle);
  checar('rodando vira "trabalhando"', rotulos.b.painel === 'trabalhando', rotulos.b.painel);
  checar('terminou vira "pronto para revisar"',
    rotulos.c.painel === 'pronto para revisar', rotulos.c.painel);

  // Ordem: pelo style.order E pela posicao real na tela. Conferir so o `order`
  // deixaria passar um valor certo sem efeito visual nenhum.
  const naTela = () => cdp.avaliar(`(() => {
    const ps = [...document.querySelectorAll('.painel')]
      .map(el => ({
        nome: el.querySelector('.painel-feature').textContent,
        order: Number(getComputedStyle(el).order),
        y: Math.round(el.getBoundingClientRect().top),
        x: Math.round(el.getBoundingClientRect().left),
      }))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return JSON.stringify({
      porOrder: [...ps].sort((a, b) => a.order - b.order).map(p => p.nome),
      porPosicao: ps.map(p => p.nome),
    });
  })()`);

  const urgencia = JSON.parse(await naTela());
  const esperadoUrgencia = 'ui-a-espera-velha,ui-d-espera-nova,ui-c-revisar,ui-b-trabalha';
  checar('a grade ordena por urgencia', urgencia.porOrder.join() === esperadoUrgencia,
    urgencia.porOrder.join());
  checar('e a ordem do style.order e a que aparece na tela',
    urgencia.porPosicao.join() === esperadoUrgencia, urgencia.porPosicao.join());

  await cdp.avaliar(`window.OrqCasca.mudar({ ordem: 'projeto' })`);
  await esperar(600);
  const porProjeto = JSON.parse(await naTela());
  checar('alternar para Projeto reordena, ignorando a urgencia',
    porProjeto.porPosicao.join() === 'ui-a-espera-velha,ui-b-trabalha,ui-c-revisar,ui-d-espera-nova',
    porProjeto.porPosicao.join());
  await cdp.avaliar(`window.OrqCasca.mudar({ ordem: 'urgencia' })`);
  await esperar(500);

  // Clicar na fila foca o painel daquela sessao.
  await cdp.avaliar(`document.querySelector('#fila-lista li').click()`);
  await esperar(400);
  checar('clicar na fila foca a sessao certa',
    await cdp.avaliar(`window.OrqGrade.focado()`) === ids['ui-a-espera-velha'], '');

  // Painel dormindo: rotulo proprio, bolinha vazada e ultimo na ordem.
  await cdp.avaliar(`(() => { const p = window.OrqPainel.painelPorId.get(
    ${JSON.stringify(ids['ui-c-revisar'])}); p.mostrarDormindo({ aoRetomar: () => {} }); return 'ok'; })()`);
  await cdp.avaliar(`window.OrqLateral.redesenhar()`);
  await esperar(500);
  const dorme = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(ids['ui-c-revisar'])});
    const ps = [...document.querySelectorAll('.painel')]
      .map(el => ({ nome: el.querySelector('.painel-feature').textContent, order: Number(getComputedStyle(el).order) }))
      .sort((a, b) => a.order - b.order);
    return JSON.stringify({
      rotulo: p.elStatus.textContent,
      bolinha: p.elBolinha.className,
      ultimo: ps[ps.length - 1].nome,
    });
  })()`));
  checar('painel dormindo diz "sessão salva"', dorme.rotulo === 'sessão salva', dorme.rotulo);
  checar('com bolinha vazada', dorme.bolinha.includes('bolinha-dormindo'), dorme.bolinha);
  checar('e vai para o fim da ordem', dorme.ultimo === 'ui-c-revisar', dorme.ultimo);

  // Sem ninguem esperando, a fila some e o cronometro nao tem o que fazer.
  await marcar(ids['ui-a-espera-velha'], 'rodando', '');
  await marcar(ids['ui-d-espera-nova'], 'rodando', '');
  await esperar(500);
  const antesDoTique = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(ids['ui-a-espera-velha'])}).elStatus.textContent`);
  await esperar(2200);
  const depoisDoTique = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(ids['ui-a-espera-velha'])}).elStatus.textContent`);
  checar('sem fila, o bloco de atencao some',
    await cdp.avaliar(`document.getElementById('bloco-fila').hidden`) === true, '');
  checar('e o rotulo para de mudar de segundo em segundo',
    antesDoTique === depoisDoTique && antesDoTique === 'trabalhando', `${antesDoTique} -> ${depoisDoTique}`);

  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: 'escuro', densidade: 2, ordem: 'urgencia' })`);

  encerrar('UI');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
