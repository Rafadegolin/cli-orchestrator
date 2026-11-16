'use strict';

// As fontes do app: a da interface, a monoespacada (terminal e todo texto
// `.mono`) e o tamanho do terminal. Pela paleta: "Fonte…".
//
// Nada e baixado: o CSP e `font-src 'self'` e o app tem de abrir sem internet.
// O nome escolhido e de uma fonte INSTALADA, e a vendorizada continua ATRAS na
// cadeia -- nome que nao existe nesta maquina cai na padrao, e nao em serif.
//
// O molde e o `acento.js`: `input` e previa, `change` grava, Fechar/Esc
// devolve o que estava gravado. Quem valida o nome de verdade e o main
// (`preferencias.nomeFonte`); aqui a mesma regra so evita gravar o que ele
// jogaria fora.
//
// IIFE, pelo escopo global compartilhado dos scripts classicos.

(() => {
  // As cadeias do `estilo.css` (`--ui` e `--mono`). Repetidas aqui porque o
  // nome escolhido entra NA FRENTE delas.
  const CADEIA_UI = "'Space Grotesk', system-ui, 'Segoe UI', sans-serif";
  const CADEIA_MONO = "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace, 'Segoe UI Symbol'";
  const CADEIA_TERM = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';
  const TAMANHO_PADRAO = 11.5;
  const NOME_VALIDO = /^[\p{L}\p{N} ._-]{1,64}$/u;

  const EH_MAC = window.OrqShell ? window.OrqShell.EH_MAC : false;
  const SUGESTOES_UI = EH_MAC
    ? ['Space Grotesk', 'SF Pro Text', 'Helvetica Neue', 'Avenir Next', 'Inter', 'Arial']
    : ['Space Grotesk', 'Segoe UI', 'Segoe UI Variable Text', 'Inter', 'Arial', 'Verdana', 'Calibri'];
  const SUGESTOES_MONO = EH_MAC
    ? ['JetBrains Mono', 'SF Mono', 'Menlo', 'Monaco', 'Fira Code', 'Cascadia Code']
    : ['JetBrains Mono', 'Cascadia Mono', 'Cascadia Code', 'Consolas', 'Fira Code', 'Courier New'];

  const nomeValido = (v) => {
    const t = String(v || '').trim();
    return NOME_VALIDO.test(t) ? t : '';
  };
  const tamanho = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(20, Math.max(9, Math.round(n * 2) / 2)) : TAMANHO_PADRAO;
  };

  // ---------------------------------------------------------- aplicar

  // Inline no <html>, como o acento: vence o `:root` e o `html.claro`. Fonte
  // padrao nao escreve inline nenhum -- o CSS calibrado segue valendo.
  function aplicar(prefs) {
    const p = prefs || {};
    const raiz = document.documentElement;
    const ui = nomeValido(p.fonteUi);
    const mono = nomeValido(p.fonteMono);
    if (ui) raiz.style.setProperty('--ui', `'${ui}', ${CADEIA_UI}`);
    else raiz.style.removeProperty('--ui');
    if (mono) raiz.style.setProperty('--mono', `'${mono}', ${CADEIA_MONO}`);
    else raiz.style.removeProperty('--mono');
    window.OrqPainel?.definirFonte?.(mono ? `"${mono}", ${CADEIA_TERM}` : CADEIA_TERM, tamanho(p.tamanhoTerminal));
  }

  // Ha fonte com esse nome nesta maquina? Mede um texto com a fonte e com o
  // generico; se der igual contra DOIS genericos diferentes, o navegador caiu
  // no generico e a fonte nao existe. (`document.fonts.check` diz `true` para
  // nome desconhecido sem @font-face, e por isso nao serve aqui.)
  const ctx = document.createElement('canvas').getContext('2d');
  const AMOSTRA = 'mmmmmmmmmmlli1WQ@#';
  function larg(fonte) { ctx.font = `40px ${fonte}`; return ctx.measureText(AMOSTRA).width; }
  function instalada(nome) {
    if (!nome) return true;
    return ['monospace', 'serif', 'sans-serif'].some((g) => larg(`'${nome}', ${g}`) !== larg(g));
  }
  function monoespacada(nome) {
    ctx.font = `40px '${nome}', monospace`;
    return Math.abs(ctx.measureText('iiiiii').width - ctx.measureText('MMMMMM').width) < 0.5;
  }

  // ---------------------------------------------------------- seletor

  const elOverlay = document.getElementById('fontes');
  const elUi = document.getElementById('fontes-ui');
  const elMono = document.getElementById('fontes-mono');
  const elTam = document.getElementById('fontes-tamanho');
  const elTamValor = document.getElementById('fontes-tamanho-valor');
  const elAvisoUi = document.getElementById('fontes-aviso-ui');
  const elAvisoMono = document.getElementById('fontes-aviso-mono');
  const btnPadrao = document.getElementById('fontes-padrao');
  const btnPronto = document.getElementById('fontes-pronto');

  function preencherListas() {
    const op = (v) => { const o = document.createElement('option'); o.value = v; return o; };
    document.getElementById('fontes-lista-ui')?.replaceChildren(...SUGESTOES_UI.map(op));
    document.getElementById('fontes-lista-mono')?.replaceChildren(...SUGESTOES_MONO.map(op));
  }

  // O que esta nos campos agora, ja limpo.
  function lerCampos() {
    return {
      fonteUi: nomeValido(elUi.value),
      fonteMono: nomeValido(elMono.value),
      tamanhoTerminal: tamanho(elTam.value),
    };
  }

  function avisar(el, texto) {
    el.hidden = !texto;
    el.textContent = texto || '';
  }

  function desenharAvisos() {
    const bruto = (el) => String(el.value || '').trim();
    const ui = bruto(elUi);
    const mono = bruto(elMono);
    avisar(elAvisoUi, ui && !nomeValido(ui) ? 'Use só letras, números, espaço, ponto e hífen.'
      : (ui && !instalada(ui) ? `“${ui}” não foi encontrada nesta máquina: a tela segue com a padrão.` : ''));
    avisar(elAvisoMono, mono && !nomeValido(mono) ? 'Use só letras, números, espaço, ponto e hífen.'
      : (mono && !instalada(mono) ? `“${mono}” não foi encontrada nesta máquina: o terminal segue com a padrão.`
        : (mono && !monoespacada(mono) ? `“${mono}” não é monoespaçada: as colunas do terminal vão desalinhar.` : '')));
    elTamValor.textContent = `${tamanho(elTam.value)} px`;
    const p = lerCampos();
    btnPadrao.classList.toggle('ativa', !p.fonteUi && !p.fonteMono && p.tamanhoTerminal === TAMANHO_PADRAO);
  }

  function desenhar(prefs) {
    elUi.value = prefs.fonteUi || '';
    elMono.value = prefs.fonteMono || '';
    elTam.value = String(tamanho(prefs.tamanhoTerminal));
    desenharAvisos();
  }

  function previa() {
    aplicar(lerCampos());
    desenharAvisos();
  }

  // Grava so o que o main aceitaria; um nome invalido ainda digitando fica na
  // previa (que ja o ignora) ate virar valido.
  function gravar() {
    const brutoInvalido = (el) => String(el.value || '').trim() && !nomeValido(el.value);
    if (brutoInvalido(elUi) || brutoInvalido(elMono)) return;
    window.OrqCasca.mudar(lerCampos());
    desenharAvisos();
  }

  function abrir() {
    if (!elOverlay) return;
    preencherListas();
    elOverlay.hidden = false;
    desenhar(window.OrqCasca?.ui?.() || {});
    elUi.focus();
  }

  // Previa que nao virou `change` volta ao que esta gravado.
  function fechar() {
    if (!elOverlay) return;
    elOverlay.hidden = true;
    aplicar(window.OrqCasca?.ui?.() || {});
  }

  for (const el of [elUi, elMono, elTam]) {
    el?.addEventListener('input', previa);
    el?.addEventListener('change', gravar);
  }
  btnPadrao?.addEventListener('click', () => {
    desenhar({ fonteUi: '', fonteMono: '', tamanhoTerminal: TAMANHO_PADRAO });
    gravar();
  });
  btnPronto?.addEventListener('click', fechar);
  if (elOverlay) window.OrqOverlays?.registrar(elOverlay, fechar);

  window.OrqFontes = {
    CADEIA_UI, CADEIA_MONO, CADEIA_TERM, TAMANHO_PADRAO,
    aplicar, abrir, fechar, instalada, monoespacada,
    aberto: () => elOverlay?.hidden === false,
  };

  // O casca pode ter lido o ui.json antes deste arquivo carregar.
  aplicar(window.OrqCasca?.ui?.() || {});
})();
