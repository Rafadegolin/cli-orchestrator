'use strict';

// Um painel: xterm + cabecalho. Nao ha framework aqui de proposito -- o
// xterm.js ja controla o DOM dele e qualquer camada por cima so adiciona
// re-render inutil.

const { Terminal } = window;
const { FitAddon } = window.FitAddon;
const { WebglAddon } = window.WebglAddon;
const { CanvasAddon } = window.CanvasAddon;

// O navegador limita contextos WebGL vivos (na pratica ~16) e mata o mais
// antigo SEM AVISAR quando estoura -- o sintoma e um painel preto do nada.
// Por isso o teto e nosso, bem abaixo do limite do navegador.
const TETO_WEBGL = 8;

// Padrao do xterm e 1000; gente costuma subir para 100.000 sem pensar, e isso
// e dezenas de MB por painel.
const SCROLLBACK = 3000;

const MS_DEBOUNCE_RESIZE = 100;

const TEMA = {
  background: '#14161a',
  foreground: '#d6dae0',
  cursor: '#7cc4ff',
  selectionBackground: '#2c3542',
  black: '#14161a',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d6dae0',
};

// Ordem de uso: o primeiro da lista e o mais recentemente focado. Os primeiros
// TETO_WEBGL ficam em WebGL, o resto cai para canvas.
const ordemDeUso = [];
const painelPorId = new Map();

class Painel {
  constructor({ id, feature, cwd, aoFocar, aoFechar }) {
    this.id = id;
    this.feature = feature;
    this.cwd = cwd;
    this.aoFocarExterno = aoFocar;
    this.aoFecharExterno = aoFechar;
    this.status = 'iniciando';
    this.addonRender = null;
    this.tipoRender = 'dom';
    this.timerResize = null;
    this.encerrado = false;
    this.pendentePrimeiroDado = null;
    this.timerPrimeiroDado = null;

    // Registra ANTES de montar o terminal: _aplicarRenderizador() decide entre
    // WebGL e canvas pela posicao em ordemDeUso, e um id ainda nao registrado
    // da indexOf === -1 -- todo painel nasceria em canvas.
    painelPorId.set(id, this);
    ordemDeUso.unshift(id);

    this.el = this._montarDom();
    this._montarTerminal();

    // Entrar na frente empurra todo mundo uma posicao: quem estava na ultima
    // vaga de WebGL precisa cair para canvas agora, nao na proxima vez que
    // alguem clicar.
    rebalancearRenderizadores();
  }

  _montarDom() {
    const raiz = document.createElement('section');
    raiz.className = 'painel';
    raiz.dataset.id = this.id;

    const cab = document.createElement('header');
    cab.className = 'painel-cab';

    this.elBolinha = document.createElement('span');
    this.elBolinha.className = 'bolinha bolinha-iniciando';
    this.elBolinha.title = 'iniciando';

    const elFeature = document.createElement('span');
    elFeature.className = 'painel-feature';
    elFeature.textContent = this.feature;

    this.elLocal = document.createElement('span');
    this.elLocal.className = 'painel-local';
    this.elLocal.textContent = nomeCurto(this.cwd);
    this.elLocal.title = this.cwd;

    this.elRender = document.createElement('span');
    this.elRender.className = 'painel-render';

    const btnFechar = document.createElement('button');
    btnFechar.className = 'painel-fechar';
    btnFechar.textContent = '×';
    btnFechar.title = 'Fechar painel (mata o processo)';
    btnFechar.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.destruir();
    });

    cab.append(this.elBolinha, elFeature, this.elLocal, this.elRender, btnFechar);

    this.elTerm = document.createElement('div');
    this.elTerm.className = 'painel-term';

    raiz.append(cab, this.elTerm);

    // Clicar em qualquer lugar do painel da foco ao terminal. So o painel
    // focado recebe teclado -- quem cuida disso e o proprio xterm.
    raiz.addEventListener('mousedown', () => this.focar());

    return raiz;
  }

  _montarTerminal() {
    this.term = new Terminal({
      allowProposedApi: true,
      scrollback: SCROLLBACK,
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.1,
      cursorBlink: true,
      theme: TEMA,
      windowsPty: { backend: 'conpty' },
    });

    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(this.elTerm);

    this.term.onData((d) => window.orq.escrever(this.id, d));
    this.term.textarea?.addEventListener('focus', () => this._marcarUso());

    this.observer = new ResizeObserver(() => this.agendarAjuste());
    this.observer.observe(this.elTerm);
  }

  // ------------------------------------------------------- renderizador

  usarRenderizador(tipo) {
    if (this.encerrado || this.tipoRender === tipo) return;

    if (this.addonRender) {
      try { this.addonRender.dispose(); } catch { /* ja disposto */ }
      this.addonRender = null;
    }

    if (tipo === 'webgl') {
      try {
        const addon = new WebglAddon();
        // O addon avisa quando o navegador mata o contexto. Sem isso o painel
        // fica preto e nada no app percebe.
        addon.onContextLoss(() => {
          this.addonRender = null;
          this.tipoRender = 'dom';
          this.usarRenderizador('canvas');
        });
        this.term.loadAddon(addon);
        this.addonRender = addon;
        this.tipoRender = 'webgl';
      } catch {
        this.usarRenderizador('canvas');
        return;
      }
    } else if (tipo === 'canvas') {
      try {
        const addon = new CanvasAddon();
        this.term.loadAddon(addon);
        this.addonRender = addon;
        this.tipoRender = 'canvas';
      } catch {
        this.tipoRender = 'dom'; // ultimo recurso: renderizador DOM do xterm
      }
    }

    this.elRender.textContent = this.tipoRender;
    this.elRender.className = `painel-render render-${this.tipoRender}`;
  }

  _marcarUso() {
    const i = ordemDeUso.indexOf(this.id);
    if (i === 0) return;
    if (i > 0) ordemDeUso.splice(i, 1);
    ordemDeUso.unshift(this.id);
    rebalancearRenderizadores();
  }

  // ------------------------------------------------------------ dados

  escreverBytes(bytes) {
    if (this.encerrado) return;
    this.term.write(bytes);
    this._dispararPrimeiroDado();
  }

  // Avisa quando o primeiro byte volta do PTY -- ou seja, quando o prompt
  // apareceu e o shell esta lendo a entrada.
  //
  // Existe porque escrever assim que `abrirTerminal` resolve NAO e seguro: o
  // pty.spawn ja retornou, mas com ConPTY os bytes enviados antes de o shell
  // anexar ao pseudoconsole podem se perder. Seria um bug intermitente, do tipo
  // que so aparece na maquina lenta.
  aoPrimeiroDado(cb, msLimite = 1500) {
    if (this.pendentePrimeiroDado) return;
    this.pendentePrimeiroDado = cb;
    // Rede de seguranca: shell que nao imprime prompt nenhum nao pode deixar o
    // comando preso para sempre.
    this.timerPrimeiroDado = setTimeout(() => this._dispararPrimeiroDado(), msLimite);
  }

  _dispararPrimeiroDado() {
    const cb = this.pendentePrimeiroDado;
    if (!cb) return;
    this.pendentePrimeiroDado = null;
    clearTimeout(this.timerPrimeiroDado);
    this.timerPrimeiroDado = null;
    try {
      cb();
    } catch (err) {
      console.error('[painel] comando inicial falhou:', err);
    }
  }

  focar() {
    this._marcarUso();
    this.term.focus();
    if (this.aoFocarExterno) this.aoFocarExterno(this.id);
  }

  definirStatus(status, rotulo) {
    this.status = status;
    this.elBolinha.className = `bolinha bolinha-${status}`;
    this.elBolinha.title = rotulo || status;
  }

  // Redimensionar reflui o buffer inteiro do terminal. Fazer isso a cada pixel
  // arrastado e caro; espera-se o usuario parar.
  agendarAjuste() {
    clearTimeout(this.timerResize);
    this.timerResize = setTimeout(() => this.ajustar(), MS_DEBOUNCE_RESIZE);
  }

  ajustar() {
    if (this.encerrado) return;
    if (!this.elTerm.clientWidth || !this.elTerm.clientHeight) return;
    try {
      this.fit.fit();
    } catch {
      return;
    }
    window.orq.redimensionar(this.id, this.term.cols, this.term.rows);
  }

  marcarFim(exitCode) {
    this.definirStatus('encerrada', `processo saiu (codigo ${exitCode})`);
    this.term.write(`\r\n\x1b[90m[processo encerrado: ${exitCode}]\x1b[0m\r\n`);
  }

  destruir() {
    if (this.encerrado) return;
    this.encerrado = true;

    clearTimeout(this.timerResize);
    clearTimeout(this.timerPrimeiroDado);
    this.pendentePrimeiroDado = null;
    this.observer?.disconnect();
    window.orq.fecharTerminal(this.id);

    try { this.addonRender?.dispose(); } catch { /* ja disposto */ }
    try { this.term.dispose(); } catch { /* ja disposto */ }

    this.el.remove();
    painelPorId.delete(this.id);
    const i = ordemDeUso.indexOf(this.id);
    if (i >= 0) ordemDeUso.splice(i, 1);

    rebalancearRenderizadores();

    // Avisa aqui dentro, e nao no clique do botao de fechar: destruir um painel
    // por codigo tem que limpar o card da lateral do mesmo jeito, senao sobra
    // card orfao apontando para um painel que nao existe mais.
    if (this.aoFecharExterno) this.aoFecharExterno(this.id);
  }
}

function rebalancearRenderizadores() {
  ordemDeUso.forEach((id, pos) => {
    const p = painelPorId.get(id);
    if (p) p.usarRenderizador(pos < TETO_WEBGL ? 'webgl' : 'canvas');
  });
}

function nomeCurto(caminho) {
  if (!caminho) return '';
  const partes = caminho.replace(/[\\/]+$/, '').split(/[\\/]/);
  return partes[partes.length - 1] || caminho;
}

window.OrqPainel = { Painel, painelPorId, nomeCurto };
