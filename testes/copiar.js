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
    const T = window.OrqCopia.tratarTecla;
    // Cada caso devolve o PAR: o que o handler respondeu ao xterm, e se ele
    // CANCELOU o evento. A segunda metade nao estava aqui, e foi por isso que
    // este teste passou por cima da colagem dupla -- devolver false ao xterm nao
    // cancela nada, e o Chromium seguia colando por conta propria ALEM do nosso
    // term.paste().
    const caso = (term, o) => {
      let cancelou = false;
      const ev = {
        type: 'keydown', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
        preventDefault: () => { cancelou = true; }, ...o,
      };
      return { retorno: T(term, ev), cancelou };
    };
    return JSON.stringify({
      ctrlC_comSelecao:  caso(falso(true),  { ctrlKey: true, code: 'KeyC' }),
      ctrlC_semSelecao:  caso(falso(false), { ctrlKey: true, code: 'KeyC' }),
      ctrlShiftC:        caso(falso(true),  { ctrlKey: true, shiftKey: true, code: 'KeyC' }),
      ctrlInsert:        caso(falso(true),  { ctrlKey: true, code: 'Insert' }),
      ctrlShiftV:        caso(falso(false), { ctrlKey: true, shiftKey: true, code: 'KeyV' }),
      shiftInsert:       caso(falso(false), { shiftKey: true, code: 'Insert' }),
      letraComum:        caso(falso(true),  { code: 'KeyA' }),
      ctrlB:             caso(falso(true),  { ctrlKey: true, code: 'KeyB' }),
      naoEhKeydown:      caso(falso(true),  { ctrlKey: true, code: 'KeyC', type: 'keyup' }),
    });
  })()`));

  // `false` = o xterm ignora a tecla e nos tratamos. `true` = segue o de sempre.
  const d = JSON.stringify(teclas);
  checar('Ctrl+C COM selecao copia', teclas.ctrlC_comSelecao.retorno === false, d);
  checar('Ctrl+C SEM selecao continua interrompendo', teclas.ctrlC_semSelecao.retorno === true, d);
  checar('Ctrl+Shift+C copia sempre', teclas.ctrlShiftC.retorno === false, d);
  checar('Ctrl+Insert copia', teclas.ctrlInsert.retorno === false, d);
  checar('Ctrl+Shift+V cola', teclas.ctrlShiftV.retorno === false, d);
  checar('Shift+Insert cola', teclas.shiftInsert.retorno === false, d);
  checar('letra comum passa direto', teclas.letraComum.retorno === true, d);
  checar('Ctrl+B nao e roubado daqui', teclas.ctrlB.retorno === true, d);
  // O xterm chama o mesmo handler no keypress e no keyup: sem esta saida um
  // Ctrl+C copiaria uma vez por evento.
  checar('so keydown e tratado', teclas.naoEhKeydown.retorno === true, d);

  // A INVARIANTE QUE FALTAVA, e o defeito inteiro cabe nela: devolver false so
  // faz o XTERM desistir da tecla -- a acao padrao do CHROMIUM continua de pe.
  // Ctrl+Insert, Shift+Insert e Ctrl+Shift+V sao comandos de edicao dele (Copy,
  // Paste, PasteAndMatchStyle), e o xterm nunca os cancelou: evaluateKeyboardEvent
  // nao produz `key` para eles e o _keyDown sai por !i.key sem chamar cancel.
  // Eram, portanto, os tres gestos que o navegador ja fazia sozinho -- e sem o
  // preventDefault o gesto acontecia DUAS vezes, o nosso e o do Blink.
  //
  // Tratou, cancelou; nao tratou, nao cancela. Em laco, e nao caso a caso, para
  // que tecla nova nasca coberta.
  for (const [nome, r] of Object.entries(teclas)) {
    checar(`${nome}: tratou <=> cancelou`,
      (r.retorno === false) === (r.cancelou === true), JSON.stringify(r));
  }

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

  // --- colar com tecla DE VERDADE -------------------------------------------
  //
  // Por que isto precisou existir: tudo acima chama `tratarTecla` com objeto
  // literal e `OrqCopia.colar()` direto -- nenhum dos dois tem acao padrao de
  // navegador para cancelar, e foi por essa brecha que a colagem DUPLA passou
  // verde pela suite inteira. Aqui a tecla entra pelo `Input.dispatchKeyEvent`,
  // evento CONFIAVEL, que e a condicao para o Chromium executar o comando de
  // edicao dele.
  //
  // A contagem e no `onData`, e nao no buffer do shell: e ali que os DOIS
  // caminhos desembocam (o `handlePasteEvent` do xterm e o `term.paste()` sao a
  // MESMA funcao do bundle), sem depender de eco do cmd, de flush nem de quebra
  // de linha. Antes do conserto dava 2.
  const CTRL = 2;
  const SHIFT = 8;
  const P = `window.OrqPainel.painelPorId.get(${JSON.stringify(id)})`;

  async function tecla(mods, vk, code, key) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await cdp.enviar('Input.dispatchKeyEvent', {
        type, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, code, key,
      });
    }
  }

  async function vezesQueColou(marca, mods, vk, code, key) {
    await cdp.avaliar(`window.orq.copiar(${JSON.stringify(marca)})`);
    // `copiar` e ipcRenderer.send, sem ack: ler de volta garante que o clipboard
    // ja tem o texto antes de a tecla sair.
    checar(`clipboard pronto (${marca})`, await cdp.avaliar('window.orq.colar()') === marca);
    await cdp.avaliar(`(() => {
      const p = ${P};
      window.__cola = 0;
      window.__colaSub = p.term.onData((d) => { if (d.includes(${JSON.stringify(marca)})) window.__cola++; });
      p.focar();
      p.term.focus();
      return 'ok';
    })()`);
    await tecla(mods, vk, code, key);
    // Esperar DEPOIS de ver a primeira, e nao sair no primeiro evento: sair cedo
    // leria 1 com a segunda colagem ainda a caminho, que e exatamente o defeito.
    await esperar(900);
    return cdp.avaliar('(() => { window.__colaSub.dispose(); return window.__cola; })()');
  }

  // O CANARIO, e ele nao e opcional: sem medir o caminho nativo SOZINHO, o dia
  // em que o `Input.dispatchKeyEvent` deixar de disparar o comando de edicao do
  // Chromium este teste mede 1, fica verde e nao prova nada.
  await cdp.avaliar(`(() => { ${P}.term.attachCustomKeyEventHandler(() => true); return 'ok'; })()`);
  const nativo = await vezesQueColou('ORQ_NATIVO', CTRL | SHIFT, 86, 'KeyV', 'V');
  checar('o paste nativo do Chromium esta vivo (canario)', nativo === 1, `colou ${nativo}x`);

  // Devolve o handler de producao. `OrqCopia.ligar()` nao serve aqui: ele
  // registraria um SEGUNDO ouvinte de contextmenu no mesmo elemento.
  await cdp.avaliar(`(() => {
    const p = ${P};
    p.term.attachCustomKeyEventHandler((ev) => window.OrqCopia.tratarTecla(p.term, ev));
    return 'ok';
  })()`);

  const colaV = await vezesQueColou('ORQ_DUPLA_A', CTRL | SHIFT, 86, 'KeyV', 'V');
  checar('Ctrl+Shift+V cola UMA vez', colaV === 1, `colou ${colaV}x`);
  const colaIns = await vezesQueColou('ORQ_DUPLA_B', SHIFT, 45, 'Insert', 'Insert');
  checar('Shift+Insert cola UMA vez', colaIns === 1, `colou ${colaIns}x`);
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
