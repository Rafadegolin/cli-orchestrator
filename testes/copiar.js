'use strict';
// Copiar e colar no terminal.
//
// O defeito era este, medido no bundle do @xterm/xterm 5.5: `_keyDown` traduz
// Ctrl+C para \x03 e chama `cancel(e, true)` -- preventDefault mais
// stopPropagation -- SEM olhar se ha selecao. Com o evento cancelado o navegador
// nunca dispara o `copy`, entao o ouvinte que o proprio xterm registra nunca
// roda, e nao havia como copiar nada.
//
// As duas metades que este teste protege:
//
//   com selecao -> copia   (o conserto)
//   sem selecao -> \x03    (o que NAO podia ser perdido no conserto)
//
// A segunda e a mais importante: um conserto que copiasse sempre mataria o
// interromper do Claude, e o sintoma so apareceria no meio de uma sessao presa.

const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

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
  // Selecao e medida de tela: o Chromium para de desenhar em segundo plano.
  await aoFrente(cdp);
  await zerarGrade(cdp);

  checar('modulo carregou', await cdp.avaliar(`typeof window.OrqCopia?.tratarTecla`) === 'function');
  checar('a ponte expoe copiar/colar',
    await cdp.avaliar(`typeof window.orq?.copiar + '/' + typeof window.orq?.colar`) === 'function/function');

  // --- a logica pura do handler ------------------------------------------
  //
  // Sem tocar em terminal: um `term` de mentira com hasSelection controlado,
  // porque o que se quer provar aqui e a TABELA de decisao.
  const teclas = JSON.parse(await cdp.avaliar(`(() => {
    const falso = (temSelecao) => ({
      hasSelection: () => temSelecao,
      getSelection: () => (temSelecao ? 'texto' : ''),
      clearSelection: () => {},
      paste: () => {},
    });
    const ev = (o) => ({ type: 'keydown', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
    const T = window.OrqCopia.tratarTecla;
    return JSON.stringify({
      ctrlC_comSelecao:  T(falso(true),  ev({ ctrlKey: true, code: 'KeyC' })),
      ctrlC_semSelecao:  T(falso(false), ev({ ctrlKey: true, code: 'KeyC' })),
      ctrlShiftC:        T(falso(true),  ev({ ctrlKey: true, shiftKey: true, code: 'KeyC' })),
      ctrlInsert:        T(falso(true),  ev({ ctrlKey: true, code: 'Insert' })),
      ctrlShiftV:        T(falso(false), ev({ ctrlKey: true, shiftKey: true, code: 'KeyV' })),
      shiftInsert:       T(falso(false), ev({ shiftKey: true, code: 'Insert' })),
      letraComum:        T(falso(true),  ev({ code: 'KeyA' })),
      ctrlB:             T(falso(true),  ev({ ctrlKey: true, code: 'KeyB' })),
      naoEhKeydown:      T(falso(true),  { ...ev({ ctrlKey: true, code: 'KeyC' }), type: 'keyup' }),
    });
  })()`));

  // `false` = o xterm ignora a tecla e nos tratamos. `true` = segue o de sempre.
  checar('Ctrl+C COM selecao copia', teclas.ctrlC_comSelecao === false, JSON.stringify(teclas));
  checar('Ctrl+C SEM selecao continua interrompendo', teclas.ctrlC_semSelecao === true, JSON.stringify(teclas));
  checar('Ctrl+Shift+C copia sempre', teclas.ctrlShiftC === false);
  checar('Ctrl+Insert copia', teclas.ctrlInsert === false);
  checar('Ctrl+Shift+V cola', teclas.ctrlShiftV === false);
  checar('Shift+Insert cola', teclas.shiftInsert === false);
  checar('letra comum passa direto', teclas.letraComum === true);
  checar('Ctrl+B nao e roubado daqui', teclas.ctrlB === true);
  // O xterm chama o mesmo handler no keypress e no keyup: sem esta saida um
  // Ctrl+C copiaria uma vez por evento.
  checar('so keydown e tratado', teclas.naoEhKeydown === true);

  // --- ida e volta de verdade, num terminal ------------------------------
  const id = await cdp.avaliar(`(async () => {
    const p = await window.OrqGrade.criarPainel({ cwd: null, feature: 'copia', tipoPainel: 'terminal' });
    return p.id;
  })()`);
  checar('painel de terminal aberto', typeof id === 'string' && id.length > 0, String(id));

  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(id)}, 'echo ORQ_COPIA_MARCA\\r')`);
  // `term.write` do xterm e assincrono, e painel fora da vista nao escreve nele:
  // laco com intervalo, nunca leitura unica.
  const viu = await ate(
    () => cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).textoDaTela({ flush: true })`),
    (t) => /ORQ_COPIA_MARCA/.test(String(t)), 10000,
  );
  checar('o terminal respondeu', /ORQ_COPIA_MARCA/.test(String(viu)), String(viu).slice(-60));

  // Selecionar tudo e copiar percorre os tres saltos: renderer -> IPC ->
  // clipboard do sistema. Ler de volta pelo `colar` prova o caminho inteiro.
  const volta = await cdp.avaliar(`(async () => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
    p.term.selectAll();
    const copiou = window.OrqCopia.copiar(p.term);
    const lido = await window.orq.colar();
    return JSON.stringify({ copiou, temMarca: /ORQ_COPIA_MARCA/.test(String(lido)), limpou: p.term.hasSelection() });
  })()`);
  const r = JSON.parse(volta);
  checar('copiar devolveu sucesso', r.copiou === true, volta);
  checar('o texto chegou ao clipboard do sistema', r.temMarca === true, volta);
  // Limpar a selecao e o retorno visual E o que devolve o Ctrl+C ao PTY: sem
  // isso o proximo Ctrl+C copiaria de novo em vez de interromper.
  checar('copiar limpa a selecao', r.limpou === false, volta);

  // Copiar sem selecao nao pode inventar nada.
  const semSelecao = await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
    p.term.clearSelection();
    return window.OrqCopia.copiar(p.term);
  })()`);
  checar('copiar sem selecao nao faz nada', semSelecao === false, String(semSelecao));

  // --- colar ---------------------------------------------------------------
  await cdp.avaliar(`window.orq.copiar('ORQ_COLA_OK')`);
  await cdp.avaliar(`(async () => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
    p.term.focus();
    await window.OrqCopia.colar(p.term);
  })()`);
  const colado = await ate(
    () => cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).textoDaTela({ flush: true })`),
    (t) => /ORQ_COLA_OK/.test(String(t)), 10000,
  );
  checar('colar escreve no terminal', /ORQ_COLA_OK/.test(String(colado)), String(colado).slice(-60));

  // --- o menu do botao direito --------------------------------------------
  const menu = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
    p.term.clearSelection();
    const el = window.OrqCopia.abrirMenu(p.term, 40, 40);
    const semSelecao = el.children[0].disabled;
    window.OrqCopia.fecharMenu();
    p.term.selectAll();
    window.OrqCopia.abrirMenu(p.term, 40, 40);
    const comSelecao = el.children[0].disabled;
    const aberto = window.OrqCopia.menuAberto();
    window.OrqCopia.fecharMenu();
    return JSON.stringify({ semSelecao, comSelecao, aberto, fechado: !window.OrqCopia.menuAberto(), itens: el.children.length });
  })()`));
  checar('o menu tem os tres itens', menu.itens === 3, JSON.stringify(menu));
  checar('abre e fecha', menu.aberto === true && menu.fechado === true, JSON.stringify(menu));
  // Dizer antes do clique que nao ha o que copiar e melhor que um toast depois.
  checar('"Copiar" fica desabilitado sem selecao', menu.semSelecao === true, JSON.stringify(menu));
  checar('e habilitado com selecao', menu.comSelecao === false, JSON.stringify(menu));

  await zerarGrade(cdp);
  encerrar('COPIAR');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
