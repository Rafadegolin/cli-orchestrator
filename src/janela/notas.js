'use strict';

// O bloco de notas da grade: um painel SEM terminal, com abas, onde o texto
// nunca se perde -- nem fechando o painel, nem fechando o app.
//
// Quem guarda e o processo principal (`src/main/notas.js`); este arquivo e a
// vista. O `Painel` com `tipoPainel: 'notas'` monta o frame de sempre e chama
// `OrqNotas.montar(painel)` no lugar do xterm.
//
// Tres caminhos de gravacao, e cada um cobre um buraco do outro:
//  - debounce de 400ms a cada mudanca (o caso normal);
//  - fechar o painel grava na hora (`fechar()`, chamado pelo `destruir`);
//  - o `beforeunload` grava por `sendSync` -- so a resposta sincrona garante
//    que o texto chegou ao disco antes de a janela morrer (o molde das telas).
//
// O EDITOR E FORMATADO (negrito, italico, sublinhado, tachado, codigo, listas,
// titulo): um `contenteditable`, e nao mais a textarea. Tres regras decidem o
// resto do arquivo:
//  1. Cada aba guarda `html` (a formatacao) E `texto` (texto puro derivado). O
//     `texto` continua sendo a fonte do titulo, da busca e da compatibilidade:
//     uma versao antiga do app lendo o arquivo segue vendo o conteudo.
//  2. HTML do disco NUNCA vira DOM sem passar pelo `limparHtml` -- o
//     `notas.json` e do usuario e pode ser editado a mao. Colar dentro do
//     editor entra como TEXTO PURO, entao nada de fora traz formatacao.
//  3. Para a sessao vai MARKDOWN (`paraMarkdown`): e o que o Claude le bem, e
//     `<b>` cru no prompt seria ruido.
//
// IIFE, pelo escopo global compartilhado dos scripts classicos.

(() => {
  const MS_SALVAR = 400;

  // O estado e UM so para o app inteiro, como o bloco de notas: o painel e
  // uma vista dele, e reabrir o painel encontra tudo onde estava.
  let estado = null;
  let carregando = null;
  let timer = null;
  let sujo = false;
  let vista = null;
  // Onde estava o cursor de cada aba, para trocar de aba nao jogar voce para o
  // comeco do texto. So em memoria: e conveniencia, nao conteudo.
  const cursores = new Map();

  function carregar() {
    if (estado) return Promise.resolve(estado);
    if (!carregando) {
      carregando = window.orq.notasCarregar().then((e) => { estado = e; return e; });
    }
    return carregando;
  }

  const abaAtiva = () => estado.abas.find((a) => a.id === estado.ativa) || estado.abas[0];

  // O titulo automatico e a primeira linha com texto. `titulo` gravado so
  // existe quando a pessoa renomeou.
  function tituloDe(a) {
    if (a.titulo) return a.titulo;
    const linha = (a.texto.split('\n').find((l) => l.trim()) || '').trim();
    return linha ? linha.slice(0, 32) : 'sem título';
  }

  // ------------------------------------------------------------ o HTML

  // A lista branca do editor. Tudo que o `execCommand` produz cabe aqui; o
  // resto (span com estilo, font, img, script, link…) e desembrulhado ou cai.
  const TAGS = {
    B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's',
    CODE: 'code', UL: 'ul', OL: 'ol', LI: 'li', H3: 'h3', DIV: 'div', P: 'div', BR: 'br',
  };
  // Some com o conteudo junto: texto de <script> nao e texto da pessoa.
  const DESCARTAR = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TITLE', 'HEAD']);
  const BLOCOS = new Set(['DIV', 'P', 'LI', 'H3', 'UL', 'OL']);

  // HTML (do disco) -> fragmento com SO as tags da lista e NENHUM atributo.
  // O `<template>` e inerte: o `onerror` de uma <img> la dentro nao roda, e
  // nada dele chega ao documento -- o que sai daqui e reconstruido no por no.
  function limparHtml(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html || '');
    const saida = document.createDocumentFragment();
    (function copiar(de, para) {
      for (const n of de.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) {
          para.append(document.createTextNode(n.data));
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          if (DESCARTAR.has(n.tagName)) continue;
          const tag = TAGS[n.tagName];
          if (tag) {
            const el = document.createElement(tag);
            para.append(el);
            if (tag !== 'br') copiar(n, el);
          } else {
            copiar(n, para);
          }
        }
      }
    })(t.content, saida);
    return saida;
  }

  // Aba de antes do editor formatado (so `texto`): uma linha por div, como o
  // Chromium escreve, e linha vazia com o <br> que a mantem de pe.
  function htmlDoTexto(texto) {
    const frag = document.createDocumentFragment();
    for (const linha of String(texto || '').split('\n')) {
      const div = document.createElement('div');
      if (linha) div.textContent = linha;
      else div.append(document.createElement('br'));
      frag.append(div);
    }
    return frag;
  }

  // Um <br> que e o ULTIMO conteudo do bloco e marcador do Chromium ("esta
  // linha existe"), e nao uma quebra: `<div><br></div>` e uma linha vazia, e
  // `<div>a<br></div>` e so "a".
  function brFinal(br) {
    for (let n = br.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === Node.ELEMENT_NODE) return false;
      if (n.nodeType === Node.TEXT_NODE && n.data) return false;
    }
    return true;
  }

  // Percorre o editor e produz o texto LINHA A LINHA, com as mesmas regras de
  // bloco do navegador. `md` liga as marcas do Markdown; sem ele sai o texto
  // puro, e `segs` diz onde cada no de texto comeca nesse texto -- e o mapa
  // que a busca e o cursor usam para voltar do texto para o DOM.
  function percorrer(raiz, { md = false } = {}) {
    let saida = '';
    let usada = false; // a linha atual ja existe (tem conteudo, ou um <br> marcador)
    let pend = false; // a proxima coisa escrita comeca linha nova
    const segs = [];

    const novaLinha = () => { saida += '\n'; usada = false; pend = false; };
    const garantir = () => { if (pend) novaLinha(); };
    const escrever = (t, no) => {
      garantir();
      if (no) segs.push({ no, ini: saida.length });
      saida += t;
      usada = true;
    };
    // Envolve um trecho inline com a marca, sem marcar vazio (`****`).
    const envolver = (el, marca) => {
      if (!el.textContent.trim()) { andar(el); return; }
      escrever(marca);
      andar(el);
      escrever(marca);
    };

    function andar(el) {
      let item = 0;
      for (const n of el.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) {
          if (n.data) escrever(n.data, n);
          continue;
        }
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = n.tagName;
        if (tag === 'BR') {
          garantir();
          if (brFinal(n) && (BLOCOS.has(el.tagName) || el === raiz)) {
            usada = true;
          } else {
            usada = true;
            pend = true;
          }
          continue;
        }
        if (md && (tag === 'B' || tag === 'STRONG')) { envolver(n, '**'); continue; }
        if (md && (tag === 'I' || tag === 'EM')) { envolver(n, '_'); continue; }
        if (md && (tag === 'S' || tag === 'STRIKE' || tag === 'DEL')) { envolver(n, '~~'); continue; }
        if (md && tag === 'CODE') { envolver(n, '`'); continue; }
        if (BLOCOS.has(tag)) {
          if (usada) pend = true;
          if (md && tag === 'H3') escrever('### ');
          if (md && tag === 'LI') {
            item += 1;
            escrever(el.tagName === 'OL' ? `${item}. ` : '- ');
          }
          andar(n);
          if (usada) pend = true;
          continue;
        }
        andar(n);
      }
    }

    andar(raiz);
    return { texto: saida, segs };
  }

  const textoPuro = (raiz) => percorrer(raiz).texto;
  const paraMarkdown = (raiz) => percorrer(raiz, { md: true }).texto;

  // Posicao no texto puro -> ponto no DOM. `fim` desempata a fronteira entre
  // dois nos: o comeco de um achado vai para o no seguinte, o fim fica no
  // anterior.
  function pontoDe(segs, pos, fim) {
    for (const s of segs) {
      const len = s.no.data.length;
      if (fim ? (pos > s.ini && pos <= s.ini + len) : (pos >= s.ini && pos < s.ini + len)) {
        return { no: s.no, off: pos - s.ini };
      }
    }
    const ult = segs[segs.length - 1];
    return ult ? { no: ult.no, off: ult.no.data.length } : null;
  }

  function rangeDe(raiz, ini, fim) {
    const { segs } = percorrer(raiz);
    const a = pontoDe(segs, ini, false);
    // Cursor (ini === fim) e o MESMO ponto: com `fim` procurado do jeito de
    // fim de intervalo, a posicao 0 nao casava com nenhum trecho e caia no
    // ultimo -- `selecionar(0, 0)` selecionava o texto inteiro.
    const b = fim === ini ? a : pontoDe(segs, fim, true);
    const r = document.createRange();
    if (!a || !b) {
      r.selectNodeContents(raiz);
      r.collapse(false);
      return r;
    }
    r.setStart(a.no, a.off);
    r.setEnd(b.no, b.off);
    return r;
  }

  // ------------------------------------------------------------ gravar

  function agendar() {
    sujo = true;
    vista?.mostrarEstado('salvando…');
    clearTimeout(timer);
    timer = setTimeout(() => salvar(), MS_SALVAR);
  }

  async function salvar() {
    clearTimeout(timer);
    timer = null;
    // O editor so e lido para o modelo aqui (e na troca de aba): percorrer o
    // DOM a cada tecla seria trabalho jogado fora no meio de uma frase.
    vista?.sincronizar();
    if (!estado || !sujo) return;
    sujo = false;
    const r = await window.orq.notasSalvar(estado);
    if (r && r.ok) {
      if (!sujo) vista?.mostrarEstado('salvo');
    } else {
      // O que ja esta no disco fica: a gravacao recusada nao corta nada.
      sujo = true;
      vista?.mostrarEstado('não salvo');
      window.OrqToast?.mostrar(`O bloco de notas não foi salvo: ${(r && r.texto) || 'erro'}`);
    }
  }

  window.addEventListener('beforeunload', () => {
    vista?.sincronizar();
    if (!estado || !sujo) return;
    try { window.orq.notasSalvarAgora(estado); } catch (err) { console.error('[notas]', err); }
    sujo = false;
  });

  // ------------------------------------------------------------ a vista

  // Os botoes de formatacao. `cmd` vai para o `execCommand`, que mantem o
  // Ctrl+Z nativo; os tres de tecla sao os do proprio editor (Ctrl+B/I/U).
  const FORMATOS = [
    { id: 'bold', rotulo: 'N', titulo: 'Negrito ({mod}+B)', classe: 'f-negrito' },
    { id: 'italic', rotulo: 'I', titulo: 'Itálico ({mod}+I)', classe: 'f-italico' },
    { id: 'underline', rotulo: 'S', titulo: 'Sublinhado ({mod}+U)', classe: 'f-sublinhado' },
    { id: 'strikeThrough', rotulo: 'T', titulo: 'Tachado', classe: 'f-tachado' },
    { id: 'codigo', rotulo: '</>', titulo: 'Código' },
    { id: 'titulo', rotulo: 'H', titulo: 'Título' },
    { id: 'insertUnorderedList', rotulo: '•', titulo: 'Lista' },
    { id: 'insertOrderedList', rotulo: '1.', titulo: 'Lista numerada' },
    { id: 'limpar', rotulo: '⌫', titulo: 'Limpar formatação' },
  ];

  function montar(painel) {
    // Abrir o bloco comeca no FIM de cada aba (pedido: nada de rolar ate o que
    // se escreveu por ultimo). A memoria de posicao vale so enquanto o bloco
    // esta aberto -- trocar de aba e voltar devolve onde voce estava.
    cursores.clear();
    painel.feature = 'Bloco de notas';
    const elNome = painel.el.querySelector('.painel-feature');
    if (elNome) elNome.textContent = 'Bloco de notas';
    painel.el.querySelector('.painel-fechar')?.setAttribute('title', 'Fechar o bloco (o texto fica guardado)');
    const mod = window.OrqShell ? window.OrqShell.MOD : 'Ctrl';

    const raiz = document.createElement('div');
    raiz.className = 'notas';

    const barra = document.createElement('div');
    barra.className = 'notas-abas';
    const elAbas = document.createElement('div');
    elAbas.className = 'notas-lista';
    const btnNova = document.createElement('button');
    btnNova.className = 'notas-nova';
    btnNova.textContent = '+';
    btnNova.title = 'Nova aba';
    const elEstado = document.createElement('span');
    elEstado.className = 'notas-estado';
    const btnEnviar = document.createElement('button');
    btnEnviar.className = 'notas-enviar';
    btnEnviar.textContent = '▸ sessão';
    btnEnviar.title = `Colar a seleção (ou a aba inteira) na caixa de uma sessão, sem enviar, em Markdown\n${mod}+Shift+Enter`;
    barra.append(elAbas, btnNova, elEstado, btnEnviar);

    const ferramentas = document.createElement('div');
    ferramentas.className = 'notas-formatos';
    const botoesFormato = new Map();
    for (const f of FORMATOS) {
      const b = document.createElement('button');
      b.className = `notas-formato ${f.classe || ''}`.trim();
      b.textContent = f.rotulo;
      b.title = f.titulo.replace('{mod}', mod);
      b.dataset.formato = f.id;
      // mousedown SEM default: o clique nao pode tirar a selecao do editor,
      // senao o negrito cairia em lugar nenhum.
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => formatar(f.id));
      botoesFormato.set(f.id, b);
      ferramentas.append(b);
    }

    const busca = document.createElement('div');
    busca.className = 'notas-busca';
    busca.hidden = true;
    const campo = document.createElement('input');
    campo.className = 'notas-busca-campo';
    campo.placeholder = 'Buscar';
    campo.spellcheck = false;
    const contador = document.createElement('span');
    contador.className = 'notas-busca-conta';
    const btnAnt = document.createElement('button');
    btnAnt.textContent = '↑';
    btnAnt.title = 'Anterior (Shift+Enter)';
    const btnProx = document.createElement('button');
    btnProx.textContent = '↓';
    btnProx.title = 'Próximo (Enter)';
    const btnFecharBusca = document.createElement('button');
    btnFecharBusca.textContent = '×';
    btnFecharBusca.title = 'Fechar a busca (Esc)';
    busca.append(campo, contador, btnAnt, btnProx, btnFecharBusca);

    const ed = document.createElement('div');
    ed.className = 'notas-texto';
    ed.contentEditable = 'false';
    ed.spellcheck = false;
    ed.setAttribute('role', 'textbox');
    ed.setAttribute('aria-multiline', 'true');
    ed.dataset.placeholder = 'Escreva aqui. O texto é guardado sozinho e volta quando você reabrir o bloco.';

    raiz.append(barra, ferramentas, busca, ed);
    painel.elTerm.replaceChildren(raiz);

    // A ultima selecao DENTRO do editor. Clicar em "▸ sessão" ou num botao da
    // barra nao pode perder o que estava marcado.
    let ultimaSelecao = null;
    const selecaoNoEditor = () => {
      const s = document.getSelection();
      if (!s || !s.rangeCount) return null;
      const r = s.getRangeAt(0);
      return ed.contains(r.commonAncestorContainer) ? r : null;
    };

    // ---------------------------------------------- modelo <-> editor

    let editorSujo = false;

    function marcarVazio() {
      ed.classList.toggle('vazio', !ed.textContent && !ed.querySelector('li'));
    }

    // Copia o editor para a aba ativa. So quando ha o que copiar.
    function sincronizar() {
      if (!editorSujo || !estado) return;
      editorSujo = false;
      const a = abaAtiva();
      a.html = ed.innerHTML;
      a.texto = textoPuro(ed);
      // So o nome AUTOMATICO depende do texto.
      if (!a.titulo) {
        const el = elAbas.querySelector(`.notas-aba[data-id="${a.id}"] .notas-aba-nome`);
        if (el) el.textContent = tituloDe(a);
      }
    }

    function desenharAbas() {
      elAbas.replaceChildren(...estado.abas.map((a) => {
        const b = document.createElement('div');
        b.className = `notas-aba${a.id === estado.ativa ? ' ativa' : ''}`;
        b.dataset.id = a.id;
        const nome = document.createElement('span');
        nome.className = 'notas-aba-nome';
        nome.textContent = tituloDe(a);
        nome.title = 'Duplo clique para renomear';
        const x = document.createElement('button');
        x.className = 'notas-aba-fechar';
        x.textContent = '×';
        x.title = 'Fechar a aba';
        x.addEventListener('click', (ev) => { ev.stopPropagation(); fecharAba(a.id); });
        b.addEventListener('click', () => trocar(a.id));
        nome.addEventListener('dblclick', (ev) => { ev.stopPropagation(); renomear(a.id, nome); });
        b.append(nome, x);
        return b;
      }));
    }

    // O cursor como POSICAO NO TEXTO PURO: o DOM da aba e reconstruido ao
    // voltar, e um Range velho apontaria para nos que nao existem mais.
    function posicaoDe(no, off) {
      const { texto, segs } = percorrer(ed);
      if (no.nodeType === Node.TEXT_NODE) {
        const s = segs.find((x) => x.no === no);
        if (s) return s.ini + Math.min(off, no.data.length);
      }
      // Ponto entre elementos: vale o comeco do primeiro texto DEPOIS dele.
      const r = document.createRange();
      try { r.setStart(no, off); } catch { return 0; }
      for (const s of segs) if (r.comparePoint(s.no, 0) >= 0) return s.ini;
      return texto.length;
    }

    function guardarCursor() {
      const a = estado && abaAtiva();
      if (!a) return;
      const r = selecaoNoEditor() || ultimaSelecao;
      const ini = r ? posicaoDe(r.startContainer, r.startOffset) : 0;
      const fim = r ? posicaoDe(r.endContainer, r.endOffset) : ini;
      cursores.set(a.id, { ini, fim, topo: ed.scrollTop });
    }

    function selecionar(ini, fim) {
      const r = rangeDe(ed, ini, fim);
      const s = document.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      ultimaSelecao = r.cloneRange();
      return r;
    }

    function mostrarAtiva() {
      const a = abaAtiva();
      ed.replaceChildren(typeof a.html === 'string' ? limparHtml(a.html) : htmlDoTexto(a.texto));
      editorSujo = false;
      marcarVazio();
      ultimaSelecao = null;
      const c = cursores.get(a.id);
      if (c && document.activeElement === ed) selecionar(c.ini, c.fim);
      else if (!c && document.activeElement === ed) cursorNoFim();
      if (c) ed.scrollTop = c.topo;
      else {
        // Sem posicao guardada: o fim do texto. De novo no quadro seguinte,
        // porque o painel recem-montado ainda pode estar sem layout (altura 0).
        ed.scrollTop = ed.scrollHeight;
        requestAnimationFrame(() => {
          if (abaAtiva() === a && !cursores.has(a.id)) ed.scrollTop = ed.scrollHeight;
        });
      }
      if (!busca.hidden) contar();
    }

    function cursorNoFim() {
      const fim = textoPuro(ed).length;
      selecionar(fim, fim);
    }

    function focarEditor() {
      if (ed.contentEditable !== 'true') return;
      if (document.activeElement === ed) return;
      ed.focus();
      const a = abaAtiva();
      const c = a && cursores.get(a.id);
      if (ultimaSelecao && ed.contains(ultimaSelecao.startContainer)) {
        const s = document.getSelection();
        s.removeAllRanges();
        s.addRange(ultimaSelecao);
      } else if (c) {
        selecionar(c.ini, c.fim);
      } else {
        const topo = ed.scrollTop;
        cursorNoFim();
        ed.scrollTop = Math.max(topo, ed.scrollHeight - ed.clientHeight);
      }
    }

    function trocar(id) {
      if (id === estado.ativa) { focarEditor(); return; }
      sincronizar();
      guardarCursor();
      estado.ativa = id;
      desenharAbas();
      mostrarAtiva();
      focarEditor();
      agendar();
    }

    function novaAba() {
      if (estado.abas.length >= 50) {
        window.OrqToast?.mostrar('O bloco de notas tem no máximo 50 abas.');
        return;
      }
      sincronizar();
      guardarCursor();
      const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      estado.abas.push({ id, titulo: '', texto: '', html: '', criadaEm: Date.now(), editadaEm: Date.now() });
      estado.ativa = id;
      desenharAbas();
      mostrarAtiva();
      focarEditor();
      agendar();
    }

    // A ULTIMA aba nunca fecha: e esvaziada. Um bloco sem aba nenhuma nao tem
    // onde escrever.
    function fecharAba(id) {
      sincronizar();
      const a = estado.abas.find((x) => x.id === id);
      if (!a) return;
      if (a.texto.trim() && !window.confirm(`Apagar a aba "${tituloDe(a)}" e o texto dela?`)) return;
      if (estado.abas.length === 1) {
        a.texto = '';
        a.html = '';
        a.titulo = '';
        a.editadaEm = Date.now();
      } else {
        const i = estado.abas.indexOf(a);
        estado.abas.splice(i, 1);
        if (estado.ativa === id) estado.ativa = estado.abas[Math.max(0, i - 1)].id;
      }
      cursores.delete(id);
      desenharAbas();
      mostrarAtiva();
      agendar();
    }

    // Inline, e nao `prompt()`: o Electron nao implementa o `prompt` da janela.
    function renomear(id, elNome) {
      const a = estado.abas.find((x) => x.id === id);
      if (!a) return;
      sincronizar();
      const campoNome = document.createElement('input');
      campoNome.className = 'notas-aba-campo';
      campoNome.value = a.titulo || tituloDe(a);
      campoNome.maxLength = 80;
      let feito = false;
      const terminar = (gravar) => {
        if (feito) return;
        feito = true;
        if (gravar) {
          a.titulo = campoNome.value.replace(/[\r\n\t]+/g, ' ').trim();
          agendar();
        }
        desenharAbas();
      };
      campoNome.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); terminar(true); focarEditor(); }
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); terminar(false); focarEditor(); }
      });
      campoNome.addEventListener('blur', () => terminar(true));
      elNome.replaceWith(campoNome);
      campoNome.focus();
      campoNome.select();
    }

    btnNova.addEventListener('click', novaAba);

    // ---------------------------------------------- escrever

    ed.addEventListener('input', () => {
      editorSujo = true;
      abaAtiva().editadaEm = Date.now();
      marcarVazio();
      if (!busca.hidden) contar();
      agendar();
    });

    // `insertText`, e nao mexer no DOM: e o que mantem o Ctrl+Z funcionando.
    function inserir(texto) {
      focarEditor();
      document.execCommand('insertText', false, texto);
    }

    // Colar entra como TEXTO PURO: formatacao de pagina web ou de Word nao
    // passaria pela lista branca de qualquer jeito, e o que passasse traria
    // fonte e cor de fora. Imagem colada aqui nao tem para onde ir: e ignorada.
    ed.addEventListener('paste', (ev) => {
      ev.preventDefault();
      const t = ev.clipboardData?.getData('text/plain');
      if (t) document.execCommand('insertText', false, t.replace(/\r\n?/g, '\n'));
    });
    // Arrastar texto de fora tambem traria HTML: entra como texto puro. Arquivo
    // solto e do `anexos.js`, que escreve o caminho pelo `inserir`.
    ed.addEventListener('drop', (ev) => {
      if (ev.dataTransfer?.files?.length) return;
      const t = ev.dataTransfer?.getData('text/plain');
      ev.preventDefault();
      if (!t) return;
      const pos = document.caretRangeFromPoint?.(ev.clientX, ev.clientY);
      if (pos) {
        const s = document.getSelection();
        s.removeAllRanges();
        s.addRange(pos);
      }
      document.execCommand('insertText', false, t);
    });

    ed.addEventListener('keydown', (ev) => {
      // Tab escreve tabulacao, como num editor, em vez de levar o foco embora.
      if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        ev.preventDefault();
        inserir('\t');
      }
    });

    // ---------------------------------------------- formatar

    const escapar = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

    function blocoAtual(tag) {
      const r = selecaoNoEditor();
      let n = r && r.startContainer;
      while (n && n !== ed) {
        if (n.nodeType === Node.ELEMENT_NODE && n.tagName === tag) return n;
        n = n.parentNode;
      }
      return null;
    }

    function formatar(id) {
      if (ed.contentEditable !== 'true') return;
      focarEditor();
      if (id === 'codigo') {
        const dentro = blocoAtual('CODE');
        if (dentro) {
          // Desembrulha: seleciona o <code> inteiro e o troca pelo texto dele.
          const r = document.createRange();
          r.selectNode(dentro);
          const s = document.getSelection();
          s.removeAllRanges();
          s.addRange(r);
          document.execCommand('insertText', false, dentro.textContent);
        } else {
          const sel = document.getSelection().toString();
          if (sel) document.execCommand('insertHTML', false, `<code>${escapar(sel)}</code>`);
        }
      } else if (id === 'titulo') {
        document.execCommand('formatBlock', false, blocoAtual('H3') ? 'div' : 'h3');
      } else if (id === 'limpar') {
        document.execCommand('removeFormat');
        if (blocoAtual('H3')) document.execCommand('formatBlock', false, 'div');
      } else {
        document.execCommand(id);
      }
      atualizarFormatos();
    }

    function atualizarFormatos() {
      if (!selecaoNoEditor()) return;
      for (const id of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList']) {
        let ativo = false;
        try { ativo = document.queryCommandState(id); } catch { /* segue */ }
        botoesFormato.get(id)?.classList.toggle('ativo', ativo);
      }
      botoesFormato.get('codigo')?.classList.toggle('ativo', Boolean(blocoAtual('CODE')));
      botoesFormato.get('titulo')?.classList.toggle('ativo', Boolean(blocoAtual('H3')));
    }

    // Um ouvinte de documento, desligado no `fechar()`.
    const aoMudarSelecao = () => {
      const r = selecaoNoEditor();
      if (r) {
        ultimaSelecao = r.cloneRange();
        atualizarFormatos();
      }
    };
    document.addEventListener('selectionchange', aoMudarSelecao);

    // ---------------------------------------------- buscar

    // O realce e pela Custom Highlight API, e nao selecionando: selecionar no
    // editor com o foco no campo de busca levaria o foco embora, e o proximo
    // Enter escreveria no texto em vez de ir ao proximo achado. Os achados
    // ficam marcados; Esc fecha a busca e SELECIONA o atual.
    const temRealce = typeof Highlight === 'function' && window.CSS && CSS.highlights;
    let achados = [];
    let atual = -1;

    function limparRealce() {
      if (!temRealce) return;
      CSS.highlights.delete('notas-achado');
      CSS.highlights.delete('notas-atual');
    }

    function contar() {
      const termo = campo.value;
      achados = [];
      if (termo) {
        const alvo = textoPuro(ed).toLowerCase();
        const t = termo.toLowerCase();
        for (let i = alvo.indexOf(t); i >= 0 && achados.length < 10000; i = alvo.indexOf(t, i + t.length)) {
          achados.push(i);
        }
      }
      if (atual >= achados.length) atual = achados.length - 1;
      contador.textContent = termo ? `${achados.length ? atual + 1 : 0}/${achados.length}` : '';
      busca.classList.toggle('sem-achado', Boolean(termo) && !achados.length);
      realcar();
    }

    function rangeDoAchado(i) {
      return rangeDe(ed, achados[i], achados[i] + campo.value.length);
    }

    function realcar() {
      if (!temRealce) return;
      limparRealce();
      if (!achados.length || busca.hidden) return;
      // Ate 500 realces: o resto conta, mas nao pinta -- cada um e um Range vivo.
      const todos = achados.slice(0, 500).map((_, i) => rangeDoAchado(i));
      CSS.highlights.set('notas-achado', new Highlight(...todos));
      if (atual >= 0) CSS.highlights.set('notas-atual', new Highlight(rangeDoAchado(atual)));
    }

    // Rola ate o achado medindo o Range de verdade: com quebra automatica e
    // formatacao, "linha x altura" nao diz onde o texto esta.
    function irPara(i) {
      if (!achados.length) return;
      atual = (i + achados.length) % achados.length;
      const r = rangeDoAchado(atual);
      ultimaSelecao = r.cloneRange();
      const caixa = r.getBoundingClientRect();
      const topoEd = ed.getBoundingClientRect().top;
      ed.scrollTop = Math.max(0, ed.scrollTop + (caixa.top - topoEd) - ed.clientHeight / 2);
      contador.textContent = `${atual + 1}/${achados.length}`;
      realcar();
    }

    function abrirBusca() {
      sincronizar();
      const r = selecaoNoEditor() || ultimaSelecao;
      const sel = r ? r.toString() : '';
      const desde = r ? posicaoDe(r.startContainer, r.startOffset) : 0;
      busca.hidden = false;
      if (sel && !sel.includes('\n')) campo.value = sel;
      campo.focus();
      campo.select();
      atual = -1;
      contar();
      if (achados.length) irPara(Math.max(0, achados.findIndex((x) => x >= desde)));
    }

    function fecharBusca() {
      busca.hidden = true;
      limparRealce();
      const r = atual >= 0 && achados.length ? rangeDoAchado(atual) : null;
      achados = [];
      ed.focus();
      if (r) {
        const s = document.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        ultimaSelecao = r.cloneRange();
      }
    }

    // O achado atual como texto. Para o teste.
    const achadoAtual = () => (atual >= 0 && achados.length ? rangeDoAchado(atual).toString() : '');

    campo.addEventListener('input', () => {
      atual = -1;
      contar();
      if (achados.length) irPara(0);
    });
    campo.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); irPara(atual + (ev.shiftKey ? -1 : 1)); }
      // Em captura nao da: o Esc aqui e da busca, e para ali.
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fecharBusca(); }
    });
    btnProx.addEventListener('click', () => irPara(atual + 1));
    btnAnt.addEventListener('click', () => irPara(atual - 1));
    btnFecharBusca.addEventListener('click', fecharBusca);

    // ---------------------------------------------- enviar para uma sessao

    let elMenu = null;
    function fecharMenu() { if (elMenu) elMenu.hidden = true; }

    // A selecao (ou a aba inteira) em MARKDOWN. Sublinhado nao tem Markdown e
    // vai como texto.
    function selecaoComFragmento() {
      const r = selecaoNoEditor() || ultimaSelecao;
      if (!r || r.collapsed || !ed.contains(r.commonAncestorContainer)) return null;
      const tmp = document.createElement('div');
      tmp.append(r.cloneContents());
      return textoPuro(tmp).trim() ? tmp : null;
    }

    function textoParaEnviar() {
      const sel = selecaoComFragmento();
      return paraMarkdown(sel || ed);
    }

    function abrirMenu(x, y) {
      const texto = textoParaEnviar();
      if (!texto.trim()) {
        window.OrqToast?.mostrar('A aba está vazia: não há o que colar.');
        return;
      }
      const sessoes = [...window.OrqPainel.painelPorId.values()]
        .filter((p) => !p.ehNotas && !p.encerrado && !p.dormindo && p.status !== 'encerrada');
      if (!sessoes.length) {
        window.OrqToast?.mostrar('Nenhuma sessão aberta para receber o texto.');
        return;
      }
      if (!elMenu) {
        elMenu = document.createElement('div');
        elMenu.className = 'menu-ctx menu-notas';
        elMenu.hidden = true;
        document.getElementById('app').append(elMenu);
      }
      const cab = document.createElement('div');
      cab.className = 'menu-notas-cab';
      cab.textContent = selecaoComFragmento() ? 'Colar a seleção em…' : 'Colar a aba inteira em…';
      elMenu.replaceChildren(cab, ...sessoes.map((p) => {
        const b = document.createElement('button');
        b.textContent = p.feature;
        b.title = p.cwd || '';
        b.addEventListener('click', () => {
          fecharMenu();
          // O `colarTexto` faz as recusas de sempre (esperando, dormindo, texto
          // multilinha sem bracketed paste) e foca a sessao. Nunca manda Enter.
          if (p.colarTexto(texto, 'a nota')) {
            window.OrqToast?.mostrar(`Colado em ${p.feature} — o Enter é seu.`);
          }
        });
        return b;
      }));
      elMenu.hidden = false;
      elMenu.style.left = `${Math.min(x, window.innerWidth - elMenu.offsetWidth - 4)}px`;
      elMenu.style.top = `${Math.min(y, window.innerHeight - elMenu.offsetHeight - 4)}px`;
    }

    btnEnviar.addEventListener('mousedown', (ev) => ev.preventDefault());
    btnEnviar.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const r = btnEnviar.getBoundingClientRect();
      abrirMenu(r.left, r.bottom + 4);
    });
    // Na JANELA, e por isso desligados no `fechar()`: reabrir o bloco nao pode
    // empilhar ouvintes de um painel que ja morreu.
    const foraDoMenu = (ev) => {
      if (elMenu && !elMenu.hidden && !elMenu.contains(ev.target) && ev.target !== btnEnviar) fecharMenu();
    };
    const escDoMenu = (ev) => {
      if (ev.key !== 'Escape' || !elMenu || elMenu.hidden) return;
      ev.preventDefault();
      ev.stopPropagation();
      fecharMenu();
    };
    window.addEventListener('mousedown', foraDoMenu, true);
    window.addEventListener('keydown', escDoMenu, true);

    // ---------------------------------------------- teclas do painel

    raiz.addEventListener('keydown', (ev) => {
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'f') {
        ev.preventDefault();
        abrirBusca();
      } else if (mod && ev.shiftKey && ev.key === 'Enter') {
        ev.preventDefault();
        const r = btnEnviar.getBoundingClientRect();
        abrirMenu(r.left, r.bottom + 4);
      }
    });

    // O mousedown do painel chama `focar()`, que foca o editor: clicar na
    // barra de busca ou num botao nao pode roubar o foco do campo de busca. E
    // clicar DENTRO do editor ja posiciona o cursor sozinho.
    raiz.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('input, button, .notas-aba, .notas-texto')) ev.stopPropagation();
    });
    // Como o clique no editor nao passa pelo `focar()` do painel, quem avisa a
    // grade que o bloco e o focado (borda, Alt+setas, ordenacao) e o foco.
    ed.addEventListener('focus', () => painel.aoFocarExterno?.(painel.id));

    // ---------------------------------------------- arranque

    function mostrarEstado(t) {
      elEstado.textContent = t;
      elEstado.dataset.estado = t === 'não salvo' ? 'erro' : (t === 'salvo' ? 'ok' : 'gravando');
    }

    vista = { mostrarEstado, sincronizar };
    mostrarEstado('carregando…');
    carregar().then(() => {
      if (painel.encerrado) return;
      ed.contentEditable = 'true';
      desenharAbas();
      mostrarAtiva();
      mostrarEstado('salvo');
      if (window.OrqGrade?.focado?.() === painel.id) focarEditor();
    }).catch((err) => {
      // Sem ler o disco, NAO deixa escrever: a primeira gravacao trocaria o que
      // esta guardado por um bloco vazio.
      mostrarEstado('não carregou');
      console.error('[notas] carregar falhou:', err);
    });

    painel.notas = {
      focar: focarEditor,
      inserir,
      fechar: () => {
        sincronizar();
        guardarCursor();
        fecharMenu();
        limparRealce();
        elMenu?.remove();
        window.removeEventListener('mousedown', foraDoMenu, true);
        window.removeEventListener('keydown', escDoMenu, true);
        document.removeEventListener('selectionchange', aoMudarSelecao);
        vista = null;
        if (sujo) salvar();
      },
      // Para o teste e a paleta.
      editor: ed,
      texto: () => textoPuro(ed),
      markdown: () => textoParaEnviar(),
      selecionar,
      selecao: () => { const r = selecaoNoEditor() || ultimaSelecao; return r ? r.toString() : ''; },
      formatar,
      abrirBusca,
      abrirMenu,
      achadoAtual,
      estado: () => estado,
    };
  }

  // Abrir o bloco: um so, focado se ja existe. A pasta e a de dados do app --
  // e o que passa no filtro do `sessao.json`, e o `painelEm` ja o ignora.
  async function abrir() {
    const c = await window.orq.constantes();
    return window.OrqGrade.criarPainel({ cwd: c.pastaDados, feature: 'Bloco de notas', tipoPainel: 'notas' });
  }

  // Abrir/fechar pela tecla. Com o bloco aberto e o foco DENTRO dele, fecha a
  // vista (o texto fica: `destruir` -> `notas.fechar` grava o que falta); em
  // qualquer outro caso abre ou foca. Fechar um bloco que voce nao esta
  // olhando seria surpresa -- a tecla primeiro o traz para a frente.
  function alternar() {
    const p = [...window.OrqPainel.painelPorId.values()].find((x) => x.ehNotas && !x.encerrado);
    if (p && p.el.contains(document.activeElement)) {
      p.destruir();
      return null;
    }
    return abrir();
  }

  // Ctrl+Shift+N (Cmd no macOS) em CAPTURA, com stopPropagation: o molde do
  // Ctrl+B. Em bolha a tecla chegaria ao PTY do terminal focado tambem.
  window.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || !ev.shiftKey || ev.altKey) return;
    if (ev.code !== 'KeyN') return;
    ev.preventDefault();
    ev.stopPropagation();
    alternar();
  }, true);

  document.getElementById('btn-notas')?.addEventListener('click', () => abrir());

  window.OrqNotas = {
    montar, abrir, alternar, salvar, carregar,
    // Puras, para o teste.
    limparHtml, htmlDoTexto, textoPuro, paraMarkdown,
  };
})();
