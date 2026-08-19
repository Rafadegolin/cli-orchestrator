'use strict';
// O botao "Abrir terminal" do dialogo de abrir projeto.
//
// Prova as quatro coisas que decidem se a feature esta certa: o dialogo aparece
// TAMBEM sem conversa guardada (com o "Retomar" fora), o painel sobe sem Claude
// nenhum, ele nao mente na lateral ("terminal", e nao "trabalhando"), e nao
// entra na fila de atencao do Ctrl+Enter.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

// O `esperar` do cdp.js e um sleep, nao um poll. Este e o laco com condicao que
// as outras suites tambem escrevem a mao.
async function ate(fn, cond, ms = 10000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    ultimo = await fn();
    if (cond(ultimo)) return ultimo;
    await esperar(200);
  }
  return ultimo;
}

(async () => {
  const cdp = await conectar();
  await zerarGrade(cdp);

  // Pasta nova: garantidamente sem conversa anterior guardada.
  const base = path.join(os.tmpdir(), `orq-teste-terminal-${Date.now()}`);
  fs.mkdirSync(base, { recursive: true });

  const id = await cdp.avaliar(`(async () => {
    const r = await window.orq.projetosAdicionar(${JSON.stringify(base)});
    await window.OrqProjetos.carregarProjetos();
    return r.projeto ? r.projeto.id : (r.erro || 'sem id');
  })()`);
  checar('projeto de teste cadastrado', typeof id === 'string' && id.startsWith('pj-'), String(id));

  // --- o dialogo aparece mesmo sem conversa guardada -----------------------
  const semConversa = await cdp.avaliar(`(async () => {
    await window.OrqEscolhaSessao.abrir(${JSON.stringify(id)});
    return {
      aberta: window.OrqEscolhaSessao.aberta(),
      retomarEscondido: document.getElementById('escolha-retomar').hidden,
      terminalVisivel: !document.getElementById('escolha-terminal').hidden,
      larguraTerminal: document.getElementById('escolha-terminal').getBoundingClientRect().width,
      explica: document.getElementById('escolha-explica').textContent,
    };
  })()`);
  checar('o dialogo aparece mesmo sem conversa guardada', semConversa.aberta === true, JSON.stringify(semConversa));
  checar('e o "Retomar" fica fora, porque nao ha o que retomar', semConversa.retomarEscondido === true, JSON.stringify(semConversa));
  checar('o "Abrir terminal" esta la, com largura de verdade',
    semConversa.terminalVisivel && semConversa.larguraTerminal > 40, `${semConversa.larguraTerminal}px`);
  checar('o texto explica o caso sem conversa',
    /ainda não tem conversas/.test(semConversa.explica), semConversa.explica);

  // --- clicar abre um shell puro ------------------------------------------
  await cdp.avaliar(`document.getElementById('escolha-terminal').click()`);
  await ate(() => cdp.avaliar(`window.OrqPainel.painelPorId.size`), (n) => n === 1, 8000);

  const painel = await cdp.avaliar(`(() => {
    const [p] = [...window.OrqPainel.painelPorId.values()];
    return { tipoPainel: p.tipoPainel, comandoInicial: p.comandoInicial, cwd: p.cwd, id: p.id };
  })()`);
  checar('o painel nasceu como terminal', painel.tipoPainel === 'terminal', JSON.stringify(painel));
  checar('e SEM comando inicial: nenhum Claude sobe', painel.comandoInicial === '', JSON.stringify(painel));
  checar('na pasta do projeto', String(painel.cwd).toLowerCase() === base.toLowerCase(), painel.cwd);

  // O shell responde: e um terminal de verdade, nao uma casca.
  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(painel.id)}, 'echo ORQ_TERMINAL_OK\\r')`);
  const eco = await ate(
    () => cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(painel.id)}).textoDaTela({ flush: true })`),
    (t) => /ORQ_TERMINAL_OK/.test(String(t)), 10000,
  );
  checar('o shell responde de verdade', /ORQ_TERMINAL_OK/.test(String(eco)), String(eco).slice(-80));

  // --- ele nao mente na lateral nem na fila -------------------------------
  const rotulo = await cdp.avaliar(`(() => {
    const c = [...window.OrqLateral.cards.values()][0];
    return {
      rotulo: window.OrqLateral.rotuloDe(c),
      status: c.status,
      tipoPainel: c.tipoPainel,
      naFila: window.OrqLateral.filaAtencao().length,
      bolinha: document.querySelector('#lateral-lista .bolinha')?.className || '',
    };
  })()`);
  checar('a lateral diz "terminal", e nao "trabalhando"', rotulo.rotulo === 'terminal', JSON.stringify(rotulo));
  checar('a bolinha nao e a de sessao trabalhando',
    /bolinha-terminal/.test(rotulo.bolinha), rotulo.bolinha);
  checar('e ele fica fora da fila de atencao', rotulo.naFila === 0, JSON.stringify(rotulo));

  // --- sobrevive ao retrato da sessao -------------------------------------
  const retrato = await cdp.avaliar(`(() => window.OrqGrade.retratoSessao().map(p => p.tipoPainel))()`);
  checar('o retrato da sessao guarda o tipo', JSON.stringify(retrato) === '["terminal"]', JSON.stringify(retrato));

  // --- quem ja escolheu continua sem dialogo ------------------------------
  await zerarGrade(cdp);
  const semDialogo = await cdp.avaliar(`(async () => {
    await window.OrqProjetos.abrirProjeto(${JSON.stringify(id)});
    return { aberta: window.OrqEscolhaSessao.aberta(), paineis: window.OrqPainel.painelPorId.size };
  })()`);
  checar('a paleta/abrirProjeto continua indo direto, sem dialogo',
    semDialogo.aberta === false && semDialogo.paineis === 1, JSON.stringify(semDialogo));

  const tipoSessao = await cdp.avaliar(`(() => [...window.OrqPainel.painelPorId.values()][0].tipoPainel)()`);
  checar('e o painel dele e sessao, nao terminal', tipoSessao === 'sessao', String(tipoSessao));

  await zerarGrade(cdp);
  await cdp.avaliar(`(async () => { await window.orq.projetosRemover(${JSON.stringify(id)}, false); await window.OrqProjetos.carregarProjetos(); })()`);
  fs.rmSync(base, { recursive: true, force: true });

  encerrar('TERMINAL_PROJETO');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
