'use strict';
// Copiar e colar dentro do terminal.
//
// POR QUE ISTO PRECISOU EXISTIR, medido no bundle do @xterm/xterm 5.5:
//
//   _keyDown(e){ if(this._customKeyEventHandler && !1===this._customKeyEventHandler(e)) return !1;
//     ... const i=evaluateKeyboardEvent(e,...);      // Ctrl+C -> i.key = ETX (\x03)
//     ... this.coreService.triggerDataEvent(i.key,!0), this.cancel(e,!0) }
//
// O `cancel(e, true)` e `preventDefault()` + `stopPropagation()`, e NAO ha
// checagem de `hasSelection()` em lugar nenhum desse caminho: Ctrl+C sempre vira
// SIGINT e sempre cancela o evento, entao o navegador nunca dispara o `copy`. O
// xterm ate registra `element.addEventListener("copy", ...)`, mas nada o aciona
// -- este app nao tem menu do Electron (`Menu` nunca e importado no main), e o
// botao direito nao abria nada.
//
// Ou seja: o problema NUNCA foram os atalhos do app. Nenhum dos ouvintes de
// teclado do renderer toca em Ctrl+C, Ctrl+V ou Insert. O que faltava era o
// gancho da PRIMEIRA linha do `_keyDown` -- o unico ponto de entrada que existe
// antes do `preventDefault`.
//
// E a selecao do xterm nao e selecao de DOM (o `.xterm` tem `user-select: none`
// e o desenho sai no WebGL), entao `document.getSelection()` e o
// `webContents.copy()` que depende dela copiariam VAZIO. Quem tem o texto e o
// `term.getSelection()`.
//
// IIFE de proposito: `painel.js`, `grade.js` e `lateral.js` dividem um escopo
// global, e `teste:ui` falha se dois arquivos declararem o mesmo nome de topo.

(() => {
  const EH_MAC = window.OrqShell ? window.OrqShell.EH_MAC : false;

  let elMenu = null;
  let termDoMenu = null;

  // ------------------------------------------------------------ o basico

  function copiar(term) {
    if (!term || !term.hasSelection()) return false;
    const texto = term.getSelection();
    if (!texto) return false;
    window.orq.copiar(texto);
    // Limpar a selecao E o retorno visual. Um toast por Ctrl+C viraria ruido: o
    // toast deste app e um de cada vez, e copiar e gesto repetido.
    term.clearSelection();
    return true;
  }

  async function colar(term) {
    if (!term) return false;
    const texto = await window.orq.colar();
    if (!texto) return false;
    // `term.paste`, NUNCA `window.orq.escrever` direto: ele normaliza \r\n -> \r
    // e embrulha em bracketed paste (ESC[200~ ... ESC[201~) quando o programa
    // pediu esse modo. E o que faz a TUI do Claude receber um texto multilinha
    // como TEXTO, e nao como uma rajada de Enters.
    //
    // Isto aqui ja dizia "desemboca no `onData` que ja existe, entao nao ha
    // caminho novo ate o PTY". A premissa estava errada, e produziu a colagem
    // dupla: o caminho novo nao era o nosso, era o NATIVO do navegador, que
    // passou a existir porque nada cancelava a tecla. Ver `cancelar()`.
    term.paste(texto);
    return true;
  }

  // ------------------------------------------------------------ o teclado

  // A REGRA DESTE ARQUIVO: se nos tratamos a tecla, nos cancelamos o evento.
  //
  // Devolver `false` do `attachCustomKeyEventHandler` NAO cancela nada -- ele e a
  // primeira linha do `_keyDown`, que sai dali antes de chegar ao `cancel()`, e o
  // `preventDefault` mora exclusivamente dentro do `cancel()`:
  //
  //   _keyDown(e){ if(this._customKeyEventHandler && !1===this._customKeyEventHandler(e)) return !1;
  //     ... this.cancel(e,!0) }
  //   cancel(e,t){ if(this.options.cancelEvents||t) return e.preventDefault(),e.stopPropagation(),!1 }
  //
  // Sem este cancelamento a tecla segue viva e o Chromium executa a ACAO PADRAO
  // dela -- que para colar e uma colagem inteira, entregue ao ouvinte nativo de
  // `paste` que o xterm registra no textarea E no element. Esse ouvinte chama a
  // MESMA funcao que `term.paste()` chama (`t.paste=r` no bundle), entao o texto
  // ia para o PTY DUAS VEZES. Foi o que aconteceu, e o sintoma era o pior tipo:
  // obvio na TUI do Claude (dois chips de texto colado) e quase invisivel num
  // shell cru, onde as duas copias so se concatenam.
  //
  // `preventDefault` e nao `stopPropagation`: quem dispara a colagem e a acao
  // padrao, e so o primeiro a cancela.
  function cancelar(ev) {
    ev.preventDefault();
    return false;
  }

  // Vai para `term.attachCustomKeyEventHandler`. Devolver `true` deixa tudo
  // exatamente como era; quem age devolve `cancelar(ev)`.
  function tratarTecla(term, ev) {
    // O xterm chama este mesmo handler no keypress e no keyup. Sem esta saida,
    // um Ctrl+C copiaria uma vez por evento.
    if (ev.type !== 'keydown') return true;

    const mod = EH_MAC ? ev.metaKey : ev.ctrlKey;
    const ehC = ev.code === 'KeyC' || ev.key === 'c' || ev.key === 'C';
    const ehV = ev.code === 'KeyV' || ev.key === 'v' || ev.key === 'V';
    const ehInsert = ev.code === 'Insert' || ev.key === 'Insert';

    // Copiar sempre: Ctrl+Shift+C (ou Cmd+Shift+C) e o classico Ctrl+Insert.
    if ((mod && ev.shiftKey && ehC) || (ev.ctrlKey && !ev.shiftKey && ehInsert)) {
      copiar(term);
      return cancelar(ev);
    }

    // Copiar SO quando ha selecao. Sem selecao devolve `true` e o Ctrl+C segue
    // virando \x03 como sempre -- e essa a metade que nao pode ser perdida.
    if (mod && !ev.shiftKey && !ev.altKey && ehC && term.hasSelection()) {
      copiar(term);
      return cancelar(ev);
    }

    // Colar: Ctrl+Shift+V, Shift+Insert, e o Cmd+V do macOS (la o Ctrl+V
    // continua sendo do programa, porque o modificador de atalho e o Command).
    if ((mod && ev.shiftKey && ehV) || (ev.shiftKey && !ev.ctrlKey && ehInsert)
        || (EH_MAC && mod && !ev.shiftKey && ehV)) {
      colar(term);
      return cancelar(ev);
    }

    return true;
  }

  // ------------------------------------------------------------ o menu

  // Botao direito hoje nao faz NADA: sem menu do Electron, o `rightClickHandler`
  // do xterm so reposiciona o textarea esperando um menu nativo que nunca vem.
  //
  // Ele tambem e a rede do Ctrl+C: se um dia um acelerador de menu interceptar a
  // tecla antes do renderer, este caminho continua de pe.
  function montarMenu() {
    if (elMenu) return elMenu;

    elMenu = document.createElement('div');
    elMenu.className = 'menu-ctx';
    elMenu.hidden = true;

    for (const item of [
      { rotulo: 'Copiar', acao: aoCopiar },
      { rotulo: 'Colar', acao: aoColar },
      { rotulo: 'Selecionar tudo', acao: aoSelecionarTudo },
    ]) {
      const b = document.createElement('button');
      b.textContent = item.rotulo;
      b.addEventListener('click', item.acao);
      elMenu.append(b);
    }

    document.getElementById('app').append(elMenu);
    return elMenu;
  }

  function aoCopiar() {
    const term = termDoMenu;
    fecharMenu();
    if (!copiar(term)) window.OrqToast?.mostrar('nada selecionado para copiar');
  }

  function aoColar() {
    const term = termDoMenu;
    fecharMenu();
    colar(term);
  }

  function aoSelecionarTudo() {
    const term = termDoMenu;
    fecharMenu();
    term?.selectAll();
  }

  function abrirMenu(term, x, y) {
    const el = montarMenu();
    termDoMenu = term;

    // "Copiar" sem selecao nao e erro, e so nao tem o que fazer -- desabilitar
    // diz isso antes do clique.
    el.children[0].disabled = !term || !term.hasSelection();

    el.hidden = false;
    // Medir DEPOIS de mostrar: elemento escondido nao tem tamanho, e o menu
    // sairia sempre pela borda de baixo da tela.
    const larg = el.offsetWidth;
    const alt = el.offsetHeight;
    el.style.left = `${Math.min(x, window.innerWidth - larg - 4)}px`;
    el.style.top = `${Math.min(y, window.innerHeight - alt - 4)}px`;
    return el;
  }

  function fecharMenu() {
    if (elMenu) elMenu.hidden = true;
    termDoMenu = null;
  }

  function menuAberto() {
    return Boolean(elMenu && !elMenu.hidden);
  }

  // Fecha em tudo que tira um menu de contexto do lugar: clique fora, rolagem,
  // saida da janela e Esc.
  //
  // O Esc vai em CAPTURA com `stopPropagation`, no molde do Ctrl+B do
  // `casca.js` e do F1 do `ajuda.js`: o xterm escuta no proprio textarea, que e
  // mais fundo que a `window`, entao em fase de bolha o Esc fecharia o menu E
  // chegaria ao PTY. Nao registra em `OrqOverlays` porque aquilo e a pilha dos
  // overlays de tela cheia -- um menu de contexto tem ciclo proprio.
  window.addEventListener('mousedown', (ev) => {
    if (menuAberto() && !elMenu.contains(ev.target)) fecharMenu();
  }, true);
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !menuAberto()) return;
    ev.preventDefault();
    ev.stopPropagation();
    fecharMenu();
  }, true);
  window.addEventListener('blur', fecharMenu);
  window.addEventListener('scroll', fecharMenu, true);

  // ------------------------------------------------------------ ligacao

  // Chamado por `Painel._montarTerminal`, o ponto unico de configuracao do xterm.
  function ligar(term, elArea) {
    term.attachCustomKeyEventHandler((ev) => tratarTecla(term, ev));

    elArea.addEventListener('contextmenu', (ev) => {
      // Sem o preventDefault o xterm move o textarea dele para debaixo do
      // cursor, esperando um menu nativo que nao existe aqui.
      ev.preventDefault();
      abrirMenu(term, ev.clientX, ev.clientY);
    });
  }

  // O terminal do painel FOCADO, para os comandos da paleta.
  function termFocado() {
    const id = window.OrqGrade?.focado?.();
    const p = id ? window.OrqPainel.painelPorId.get(id) : null;
    return p && !p.dormindo ? p.term : null;
  }

  window.OrqCopia = {
    ligar, tratarTecla, copiar, colar,
    abrirMenu, fecharMenu, menuAberto, termFocado,
  };
})();
