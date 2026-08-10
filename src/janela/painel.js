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

// Painel fora da area visivel nao desenha: os bytes ficam num buffer ate ele
// voltar. 200 KB sao muito mais do que as 3000 linhas de scrollback conseguem
// mostrar, entao o teto so corta o que seria descartado de qualquer jeito.
const TETO_INVISIVEL_BYTES = 200 * 1024;

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

    // Comeca visivel: o IntersectionObserver so corrige no primeiro quadro, e
    // ate la e melhor desenhar a mais do que engolir saida.
    this.visivel = true;
    this.pendentes = [];
    this.pendentesBytes = 0;
    // Quanto ja foi jogado fora por estouro do teto. Serve para o teste provar
    // que o corte aconteceu, em vez de inferir por numero de linha -- e ajuda a
    // responder "por que falta saida no comeco?" sem adivinhacao.
    this.descartadosBytes = 0;

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

    // Etiqueta da fila de partida. Clicavel de proposito: o app nunca deve
    // deixar voce preso atras da propria heuristica dele.
    this.elFila = document.createElement('button');
    this.elFila.className = 'painel-fila';
    this.elFila.hidden = true;

    // Responde "por que meu dev subiu em outra porta?" sem abrir documentacao.
    this.elPorta = document.createElement('span');
    this.elPorta.className = 'painel-porta';

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

    cab.append(this.elBolinha, elFeature, this.elLocal, this.elFila, this.elPorta, this.elRender, btnFechar);

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

    // Com a grade rolavel, painel pode sair da area visivel. O root e a propria
    // grade porque e ela que rola, nao a janela -- e e buscada por id, nao por
    // parentElement: na hora que isto roda o painel ainda nao foi anexado.
    this.observerVista = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) this.definirVisivel(e.isIntersecting);
      },
      { root: document.getElementById('grade'), threshold: 0 }
    );
    this.observerVista.observe(this.el);
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

    // Fora da vista, nao paga o custo de parsear e desenhar: guarda e escreve
    // de uma vez quando o painel voltar.
    if (!this.visivel) {
      this.pendentes.push(bytes);
      this.pendentesBytes += bytes.length;
      // Descarta PEDACOS INTEIROS do inicio, nunca por offset de byte: cortar
      // no meio de um Uint8Array parte sequencia UTF-8 e o painel volta com
      // caractere quebrado. Mesma regra da fila do processo principal.
      while (this.pendentesBytes > TETO_INVISIVEL_BYTES && this.pendentes.length > 1) {
        const fora = this.pendentes.shift().length;
        this.pendentesBytes -= fora;
        this.descartadosBytes += fora;
      }
      // O gancho do comando inicial nao pode depender de estar visivel.
      this._dispararPrimeiroDado();
      return;
    }

    this.term.write(bytes);
    this._dispararPrimeiroDado();
  }

  definirVisivel(visivel) {
    if (this.encerrado || this.visivel === visivel) return;
    this.visivel = visivel;
    if (visivel) this._descarregarPendentes();
    // A visibilidade manda no orcamento de WebGL: nao faz sentido um painel
    // fora da vista segurar contexto enquanto um visivel desenha em canvas.
    rebalancearRenderizadores();
  }

  _descarregarPendentes() {
    if (!this.pendentes.length) return;
    const total = this.pendentesBytes;
    const junto = new Uint8Array(total);
    let off = 0;
    for (const p of this.pendentes) {
      junto.set(p, off);
      off += p.length;
    }
    this.pendentes.length = 0;
    this.pendentesBytes = 0;
    this.term.write(junto);
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

  // posicao 0 esconde a etiqueta. `aoForcar` e o escape manual.
  definirFila(posicao, aoForcar) {
    if (!this.elFila) return;
    if (!posicao) {
      this.elFila.hidden = true;
      this.elFila.onclick = null;
      return;
    }
    this.elFila.hidden = false;
    this.elFila.textContent = `na fila (${posicao})`;
    this.elFila.title =
      `Ja ha ${window.OrqFila?.TETO_RODANDO ?? 4} sessoes rodando. Este comando parte quando abrir vaga.\n` +
      'Clique para comecar agora mesmo assim.';
    this.elFila.onclick = (ev) => {
      ev.stopPropagation();
      if (aoForcar) aoForcar();
    };
  }

  definirPortas(portas) {
    this.portas = portas || [];
    if (!this.portas.length) {
      this.elPorta.textContent = '';
      this.elPorta.title = '';
      return;
    }
    this.elPorta.textContent = `:${this.portas[0]}`;
    this.elPorta.title =
      `Portas reservadas so para este painel: ${this.portas.join(', ')}\n\n` +
      `PORT=${this.portas[0]}\nORQ_PORTA=${this.portas[0]}\nORQ_PORTAS=${this.portas.join(',')}\n\n` +
      'O projeto precisa ler a variavel: Next e Express leem PORT sozinhos, ' +
      'o Vite exige --port %PORT%.';
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
    this.pendentes.length = 0;
    this.pendentesBytes = 0;
    this.observer?.disconnect();
    this.observerVista?.disconnect();
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

// Visivel primeiro, e entre os visiveis o mais recentemente usado.
//
// Antes da grade rolar isto era so ordemDeUso, e funcionava porque todo painel
// estava sempre a vista. Agora nao: um painel focado ha tres minutos e rolado
// para fora seguraria uma vaga de WebGL enquanto um painel que voce esta
// olhando desenha em canvas.
function rebalancearRenderizadores() {
  const ordenados = ordemDeUso
    .map((id, pos) => ({ id, pos, p: painelPorId.get(id) }))
    .filter((x) => x.p)
    .sort((a, b) => (Number(b.p.visivel) - Number(a.p.visivel)) || (a.pos - b.pos));

  ordenados.forEach((x, i) => {
    // Fora da vista nao desenha nada, entao nao precisa nem de canvas ativo --
    // mas trocar de renderizador custa; so o que importa e nao segurar WebGL.
    x.p.usarRenderizador(x.p.visivel && i < TETO_WEBGL ? 'webgl' : 'canvas');
  });
}

function nomeCurto(caminho) {
  if (!caminho) return '';
  const partes = caminho.replace(/[\\/]+$/, '').split(/[\\/]/);
  return partes[partes.length - 1] || caminho;
}

window.OrqPainel = { Painel, painelPorId, nomeCurto };
