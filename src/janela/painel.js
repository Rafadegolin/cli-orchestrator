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

// O TERMINAL FICA ESCURO NOS DOIS TEMAS, e por isso os valores estao aqui em
// vez de saírem das variaveis CSS: nao e esquecimento, e decisao -- codigo
// monoespacado sobre fundo claro quebra a leitura. Sao os tokens --term e
// --termfg, que o tema claro deliberadamente nao sobrescreve.
const TEMA = {
  background: '#0b0e12',
  foreground: '#c8d3e0',
  cursor: '#3ddc97',
  selectionBackground: '#2c3542',
  black: '#0b0e12',
  red: '#f7768e',
  green: '#3ddc97',
  yellow: '#ffb454',
  blue: '#7aa2f7',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#c8d3e0',
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
    this.dormindo = false;
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
    this.mostrarProjeto();
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

    // Cor sozinha nao carrega significado: toda bolinha vem com texto ao lado.
    // Some na densidade 3 (regra do CSS), onde o espaco vale mais que a
    // redundancia e a bolinha assume.
    this.elStatus = document.createElement('span');
    this.elStatus.className = 'painel-status';

    // Ligacoes com outros repositorios. Clicar abre o seletor.
    this.elLigacoes = document.createElement('button');
    this.elLigacoes.className = 'painel-ligacoes';
    this.elLigacoes.textContent = 'ligar';
    this.elLigacoes.title = 'Dar a esta sessão acesso ao código de outro repositório';
    this.elLigacoes.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.OrqSeletorLigacoes?.abrir(this.id);
    });

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

    // O grupo da direita e INEGOCIAVEL (flex: 0 0 auto no CSS): em janela
    // estreita a compressao come o rotulo de status e depois a pill do projeto,
    // mas o botao de fechar continua alcancavel.
    const acoes = document.createElement('span');
    acoes.className = 'painel-acoes';
    acoes.append(this.elPorta, this.elFila, this.elLigacoes, this.elRender, btnFechar);

    cab.append(this.elBolinha, elFeature, this.elLocal, this.elStatus, acoes);

    this.elTerm = document.createElement('div');
    this.elTerm.className = 'painel-term';

    // Convite do painel restaurado: fica por cima do terminal ate voce mandar
    // retomar. A spec e explicita em nao religar seis sessoes sozinho no
    // arranque -- e caro e ninguem pediu.
    this.elDormindo = document.createElement('div');
    this.elDormindo.className = 'painel-dormindo';
    this.elDormindo.hidden = true;
    // Dentro do elTerm, e nao do painel: assim ele cobre exatamente a area do
    // terminal, sem depender de adivinhar a altura do cabecalho.
    this.elTerm.append(this.elDormindo);

    // A faixa de aprovacao. O ESPACO E RESERVADO SEMPRE, mesmo vazia: se ela
    // entrasse e saisse, a altura do terminal mudaria a cada ida e volta de
    // 'esperando', disparando fit() e pty.resize() no exato momento em que o
    // prompt de permissao esta na tela -- que e o pior instante possivel para a
    // TUI do Claude redesenhar. Vazia, ela usa o fundo do terminal e parece
    // apenas uma folga embaixo.
    this.elRodape = document.createElement('div');
    this.elRodape.className = 'painel-rodape';

    // A alca de redimensionar. Existe SEMPRE, e quem decide se aparece e o CSS
    // (mapa em 1:1, ou a densidade personalizada): criar e destruir conforme o
    // modo seria mais um lugar de onde o painel pode voltar diferente.
    //
    // Quem escuta o arrasto e o modulo dono do modo -- mapa.js encaixa na malha
    // de 20px, personalizado.js encaixa em celulas da grade. Aqui so o elemento.
    this.elAlca = document.createElement('div');
    this.elAlca.className = 'painel-alca';
    this.elAlca.title = 'Arraste para redimensionar';

    raiz.append(cab, this.elTerm, this.elRodape, this.elAlca);

    // Clicar em qualquer lugar do painel da foco ao terminal. So o painel
    // focado recebe teclado -- quem cuida disso e o proprio xterm.
    raiz.addEventListener('mousedown', () => this.focar());

    return raiz;
  }

  _montarTerminal() {
    this.term = new Terminal({
      allowProposedApi: true,
      scrollback: SCROLLBACK,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 11.5,
      // O doc de UI pede 1.65, medida pensada para o terminal FALSO do
      // prototipo (uma pilha de divs). Aqui altura de linha nao e decoracao, e
      // quantidade de LINHAS: com o painel de 268px da densidade 3, 1.65 daria
      // 11 linhas contra 13 -- 18% a menos de TUI do Claude a vista. Fica em
      // 1.35, que e visualmente proximo e materialmente utilizavel.
      lineHeight: 1.35,
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

    // Com a grade rolavel, painel pode sair da area visivel.
    //
    // O root e o #conteudo, que e QUEM ROLA -- nao o #grade, que apenas cresce
    // dentro dele. Apontar para um elemento que nao rola faz todo painel contar
    // como visivel para sempre, e a economia inteira do painel fora da vista
    // (buffer em vez de desenho, sem vaga de WebGL) simplesmente nao acontece.
    // Buscado por id, e nao por parentElement: aqui o painel ainda nao foi
    // anexado ao DOM.
    this.observerVista = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) this.definirVisivel(e.isIntersecting);
      },
      { root: document.getElementById('conteudo'), threshold: 0 }
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

  // O texto que esta na tela do terminal, com os bytes pendentes ja aplicados.
  //
  // O flush NAO e detalhe: painel fora da vista nao escreve no xterm (os bytes
  // esperam em `pendentes` ate ele voltar), entao ler `term.buffer` direto
  // devolveria texto velho. Quem le o buffer usa isto para decidir se responde
  // a uma sessao -- e decidir por texto velho e responder ao pedido errado.
  //
  // O `term.write` do xterm e ASSINCRONO: o que este flush entregou aparece no
  // buffer no proximo passo do parser, nao nesta chamada. Por isso todo mundo
  // que espera algo aqui usa laco com intervalo (`esperarPedido`,
  // `esperarNoBuffer`) -- uma leitura unica logo apos o flush le o passado.
  // A JUNCAO RESPEITA `isWrapped`, e isso decide se procurar texto aqui
  // funciona ou nao.
  //
  // Quando o terminal QUEBRA uma linha que nao cabe, a continuacao e a mesma
  // linha logica -- juntar com `\n` parte palavras ao meio. Um caminho solto num
  // painel estreito virava `...captura.p` + `ng"`, e nenhum `includes` do mundo
  // acha `captura.png` ali. Quebra de verdade (linha nova de fato) continua
  // virando `\n`, e o `achatar` a transforma em espaco -- que e o certo para o
  // texto que o proprio CLI quebrou com indentacao.
  textoDoBuffer() {
    if (this.encerrado || !this.term) return '';
    this.descarregarPendentes();
    return Painel._juntar(this.term.buffer.active, 0, this.term.buffer.active.length);
  }

  static _juntar(b, inicio, fim) {
    let t = '';
    for (let i = inicio; i < fim; i++) {
      const linha = b.getLine(i);
      if (!linha) continue;
      // A continuacao cola na anterior; o resto entra em linha propria.
      if (i > inicio && !linha.isWrapped) t += '\n';
      t += linha.translateToString(true);
    }
    return t;
  }

  // O texto do terminal com os espacos ACHATADOS: toda sequencia de espaco,
  // tabulacao e quebra de linha vira um espaco so.
  //
  // Procurar frase em terminal sem isto e loteria, e foi MEDIDO: o CLI quebra a
  // linha onde a largura do painel mandar, e a mesma frase que casa num painel
  // largo nao casa num estreito. No spike do `/add-dir`, a confirmacao chegou
  // partida ao meio --
  //
  //     Added C:\...\repo-alvo as
  //     a working directory for this session
  //
  // -- e o `.includes('as a working directory')` nunca via nada, mesmo com a
  // ligacao tendo dado certo. Como os painéis aqui vivem numa grade e podem ter
  // 200px de largura, isso deixa de ser caso raro e vira o caso normal.
  static achatar(texto) {
    return String(texto || '').replace(/\s+/g, ' ');
  }

  // So o que esta VISIVEL na janela do terminal, sem scrollback.
  //
  // Existe para ser lido de tempos em tempos: `textoDoBuffer()` percorre as 3000
  // linhas do scrollback e ainda descarrega os bytes pendentes -- barato uma
  // vez, caro a cada segundo em oito painéis. Aqui sao as ~15 linhas da tela, e
  // e onde o prompt de permissao sempre esta.
  //
  // `flush` e o que separa os dois usos, e a diferenca importa:
  //
  //  - SEM flush (padrao) para quem le em LACO. O farejador roda a cada 1,5s e
  //    pula painel fora da vista justamente para nao desfazer a economia da
  //    Fase 6.1 -- descarregar ali seria pagar o custo que ela evita.
  //  - COM flush para quem vai DECIDIR alguma coisa. Ler sem descarregar
  //    devolve a tela de antes dos bytes que ja chegaram, e decidir por texto
  //    velho e responder ao pedido errado -- num caminho que escreve no PTY.
  textoDaTela({ flush = false } = {}) {
    if (this.encerrado || !this.term) return '';
    if (flush) this.descarregarPendentes();
    const b = this.term.buffer.active;
    return Painel._juntar(b, b.baseY, b.baseY + this.term.rows);
  }

  definirVisivel(visivel) {
    if (this.encerrado || this.visivel === visivel) return;
    this.visivel = visivel;
    if (visivel) this.descarregarPendentes();
    // A visibilidade manda no orcamento de WebGL: nao faz sentido um painel
    // fora da vista segurar contexto enquanto um visivel desenha em canvas.
    rebalancearRenderizadores();
  }

  // Publico desde que textoDoBuffer() precisa dele: ler o buffer sem aplicar o
  // que esta pendente devolve o passado.
  descarregarPendentes() {
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

  // Painel restaurado da sessao anterior: sem PTY, esperando voce mandar
  // retomar. `indisponivel` cobre a pasta que sumiu enquanto o app esteve
  // fechado (worktree arquivado, projeto movido).
  mostrarDormindo({ aoRetomar, indisponivel, aoRemover } = {}) {
    this.dormindo = true;
    this.elDormindo.hidden = false;
    this.elDormindo.replaceChildren();
    // Sem PTY nao ha o que aprovar nem resize com que se preocupar: aqui a
    // faixa some de vez e devolve os 34px para o convite de retomar.
    this.limparAprovacao();
    this.elRodape.hidden = true;

    const titulo = document.createElement('p');
    titulo.className = 'dormindo-titulo';
    titulo.textContent = indisponivel ? 'Pasta não encontrada' : 'Sessão anterior';

    const onde = document.createElement('p');
    onde.className = 'dormindo-onde';
    onde.textContent = this.cwd;
    onde.title = this.cwd;

    const botao = document.createElement('button');
    if (indisponivel) {
      botao.textContent = 'Remover painel';
      botao.className = 'dormindo-remover';
      botao.addEventListener('click', (ev) => { ev.stopPropagation(); (aoRemover || (() => this.destruir()))(); });
    } else {
      botao.textContent = 'Retomar';
      botao.className = 'dormindo-retomar';
      botao.addEventListener('click', (ev) => { ev.stopPropagation(); if (aoRetomar) aoRetomar(); });
    }

    this.elDormindo.append(titulo, onde, botao);
    this.definirStatus(indisponivel ? 'encerrada' : 'iniciando',
      indisponivel ? 'pasta não encontrada' : 'sessão salva',
      indisponivel ? 'A pasta desta sessão não existe mais' : 'Esperando você retomar');

    // Nao desenha nada: nao pode segurar vaga de WebGL.
    rebalancearRenderizadores();
  }

  acordou() {
    this.dormindo = false;
    this.elDormindo.hidden = true;
    this.elDormindo.replaceChildren();
    this.elRodape.hidden = false;
    rebalancearRenderizadores();
  }

  // ------------------------------------------------- faixa de aprovacao

  // `aoAprovar` so e passado quando ha o que aprovar (pedido de permissao).
  // Sessao apenas ociosa esta esperando voce DIGITAR, nao confirmar: ali a
  // faixa aparece com a pergunta e sem o botao.
  mostrarAprovacao({ pergunta, aoAprovar, aoVer }) {
    this.elRodape.classList.add('tem-pedido');
    this.elRodape.replaceChildren();

    this.elPergunta = document.createElement('span');
    this.elPergunta.className = 'rodape-pergunta';
    this.elPergunta.textContent = pergunta || 'Esperando você';
    this.elPergunta.title = this.elPergunta.textContent;

    this.elAcoes = document.createElement('span');
    this.elAcoes.className = 'rodape-acoes';

    // Guardado porque o botao pode nascer e SAIR: quando a leitura da tela
    // descobre que o pedido e de um formato que este app nao responde (o
    // prompt de plano), `atualizarPedido` o remove.
    this._aprovar = aoAprovar || null;
    this.elAprovar = null;
    if (this._aprovar) this._montarAprovar();

    const ver = document.createElement('button');
    ver.className = 'rodape-ver';
    ver.textContent = 'Ver';
    ver.title = 'Leva o cursor para este terminal, sem responder nada';
    ver.addEventListener('click', (ev) => { ev.stopPropagation(); (aoVer || (() => this.focar()))(); });
    this.elAcoes.append(ver);

    this.elRodape.append(this.elPergunta, this.elAcoes);
  }

  // `rotuloOpcao` e o texto da opcao que sera respondida, lido da tela. Antes
  // isto era a string fixa `"1. Yes"`, que passou a ser mentira no instante em
  // que o app aprendeu a reconhecer mais de um formato de pedido.
  _montarAprovar(rotuloOpcao) {
    if (!this._aprovar || !this.elAcoes) return;
    if (!this.elAprovar) {
      this.elAprovar = document.createElement('button');
      this.elAprovar.className = 'rodape-aprovar';
      this.elAprovar.textContent = 'Aprovar';
      this.elAprovar.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._aprovar?.();
      });
      this.elAcoes.prepend(this.elAprovar);
    }
    this.elAprovar.title = rotuloOpcao
      ? `Responde "${rotuloOpcao}" ao pedido que está na tela do terminal`
      : 'Responde ao pedido que está na tela do terminal';
  }

  // A faixa depois de a tela ter sido lida de verdade: a pergunta certa no
  // lugar da frase generica do hook, e o botao presente so se este app souber
  // responder AQUELE formato.
  atualizarPedido({ pergunta, aprovavel, rotuloOpcao } = {}) {
    if (pergunta && this.elPergunta) {
      this.elPergunta.textContent = pergunta;
      this.elPergunta.title = pergunta;
    }
    if (!this.elAcoes) return;

    if (aprovavel === false) {
      this.elAprovar?.remove();
      this.elAprovar = null;
    } else if (aprovavel === true) {
      this._montarAprovar(rotuloOpcao);
    }
  }

  limparAprovacao() {
    this.elRodape.classList.remove('tem-pedido');
    this.elRodape.replaceChildren();
    this.elPergunta = null;
    this.elAcoes = null;
    this.elAprovar = null;
    this._aprovar = null;
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
      `Já há ${window.OrqFila?.TETO_RODANDO ?? 4} sessões rodando. Este comando parte quando abrir vaga.\n` +
      'Clique para começar agora mesmo assim.';
    this.elFila.onclick = (ev) => {
      ev.stopPropagation();
      if (aoForcar) aoForcar();
    };
  }

  mostrarLigacoes() {
    if (!this.elLigacoes) return;
    const n = (this.ligacoes || []).length;
    this.elLigacoes.textContent = n ? `${n} ligado${n === 1 ? '' : 's'}` : 'ligar';
    this.elLigacoes.className = n ? 'painel-ligacoes tem-ligacao' : 'painel-ligacoes';
    this.elLigacoes.title = n
      ? `Esta sessão enxerga o código de:\n${(this.ligacoes || []).join('\n')}\n\nClique para gerenciar.`
      : 'Dar a esta sessão acesso ao código de outro repositório';
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
      `Portas reservadas só para este painel: ${this.portas.join(', ')}\n\n` +
      `PORT=${this.portas[0]}\nORQ_PORTA=${this.portas[0]}\nORQ_PORTAS=${this.portas.join(',')}\n\n` +
      'O projeto precisa ler a variável: Next e Express leem PORT sozinhos, ' +
      'o Vite exige --port %PORT%.';
  }

  definirStatus(status, rotulo, motivo = '') {
    this.status = status;
    // Painel dormindo tem bolinha vazada, independente do status por baixo: ele
    // nao tem processo nenhum, e isso e o que a bolinha precisa comunicar.
    this.elBolinha.className = this.dormindo ? 'bolinha bolinha-dormindo' : `bolinha bolinha-${status}`;
    this.elBolinha.title = motivo || rotulo || status;

    this.elStatus.className = `painel-status status-${this.dormindo ? 'dormindo' : status}`;
    this.elStatus.title = motivo || '';
    this.atualizarRotulo(rotulo || status);
    this.el.classList.toggle('painel-esperando', status === 'esperando' && !this.dormindo);
  }

  // Separado de definirStatus porque o cronometro chama isto UMA VEZ POR
  // SEGUNDO enquanto alguem espera: reatribuir className e title a cada tique,
  // sem nada ter mudado, e trabalho de estilo a toa.
  atualizarRotulo(rotulo) {
    const texto = this.dormindo ? 'sessão salva' : rotulo;
    if (this.elStatus.textContent !== texto) this.elStatus.textContent = texto;
  }

  // A pill do cabecalho diz o PROJETO, nao a pasta. Para painel de worktree o
  // cwd e <projeto>/.claude/worktrees/<feat>, entao o nome curto da pasta seria
  // o nome da feature -- repetido logo ao lado, sem informar nada.
  mostrarProjeto() {
    const p = window.OrqProjetos?.projetoDe?.(this.cwd);
    this.elLocal.textContent = p ? p.nome : nomeCurto(this.cwd);
    // Worktree tem o nome do projeto na pill, entao o caminho e a unica coisa
    // que diz QUAL worktree -- e ele vai no balao.
    this.elLocal.title = this.cwd;

    // A cor vai no PAINEL, e nao so na pill: abaixo de 260px de largura o
    // `@container` esconde a pill inteira -- justamente quando ha muitos painéis
    // e distinguir e mais dificil. A faixa mora no frame e sobrevive a isso.
    //
    // E limpa quando nao ha projeto: antes o estilo inline ficava para sempre,
    // entao descadastrar um projeto deixava a cor dele no painel.
    const tinta = window.OrqProjetos?.tintaDaPasta?.(this.cwd) || '';
    this.el.style.setProperty('--tinta', tinta);
    this.el.classList.toggle('painel-tinto', Boolean(tinta));
    this.elLocal.style.boxShadow = tinta ? `inset 2px 0 0 ${tinta}` : '';
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
    this.definirStatus('encerrada', `processo saiu (código ${exitCode})`);
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
    // Painel dormindo idem: cinco painéis restaurados nao podem tomar as vagas
    // dos que voce esta realmente usando.
    const querWebgl = x.p.visivel && !x.p.dormindo && i < TETO_WEBGL;
    x.p.usarRenderizador(querWebgl ? 'webgl' : 'canvas');
  });
}

function nomeCurto(caminho) {
  if (!caminho) return '';
  const partes = caminho.replace(/[\\/]+$/, '').split(/[\\/]/);
  return partes[partes.length - 1] || caminho;
}

window.OrqPainel = { Painel, painelPorId, nomeCurto, achatar: Painel.achatar };
