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
    if (!estado || !sujo) return;
    try { window.orq.notasSalvarAgora(estado); } catch (err) { console.error('[notas]', err); }
    sujo = false;
  });

  // ------------------------------------------------------------ a vista

  function montar(painel) {
    painel.feature = 'Bloco de notas';
    const elNome = painel.el.querySelector('.painel-feature');
    if (elNome) elNome.textContent = 'Bloco de notas';
    painel.el.querySelector('.painel-fechar')?.setAttribute('title', 'Fechar o bloco (o texto fica guardado)');

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
    btnEnviar.title = 'Colar a seleção (ou a aba inteira) na caixa de uma sessão, sem enviar\nCtrl+Shift+Enter';
    barra.append(elAbas, btnNova, elEstado, btnEnviar);

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

    const ta = document.createElement('textarea');
    ta.className = 'notas-texto';
    ta.spellcheck = false;
    ta.placeholder = 'Escreva aqui. O texto é guardado sozinho e volta quando você reabrir o bloco.';

    // A textarea quebra na largura do painel, entao linha de texto nao e linha
    // na tela. A busca mede a altura do texto ate o achado neste espelho, que
    // copia fonte, padding e largura da textarea.
    const espelho = document.createElement('div');
    espelho.className = 'notas-texto notas-espelho';
    espelho.setAttribute('aria-hidden', 'true');

    raiz.append(barra, busca, ta, espelho);
    painel.elTerm.replaceChildren(raiz);

    // ---------------------------------------------- abas

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

    function guardarCursor() {
      const a = abaAtiva();
      if (a) cursores.set(a.id, { ini: ta.selectionStart, fim: ta.selectionEnd, topo: ta.scrollTop });
    }

    function mostrarAtiva() {
      const a = abaAtiva();
      ta.value = a.texto;
      const c = cursores.get(a.id);
      if (c) {
        ta.setSelectionRange(c.ini, c.fim);
        ta.scrollTop = c.topo;
      } else {
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
      }
      if (!busca.hidden) contar();
    }

    function trocar(id) {
      if (id === estado.ativa) { ta.focus(); return; }
      guardarCursor();
      estado.ativa = id;
      desenharAbas();
      mostrarAtiva();
      ta.focus();
      agendar();
    }

    function novaAba() {
      if (estado.abas.length >= 50) {
        window.OrqToast?.mostrar('O bloco de notas tem no máximo 50 abas.');
        return;
      }
      guardarCursor();
      const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      estado.abas.push({ id, titulo: '', texto: '', criadaEm: Date.now(), editadaEm: Date.now() });
      estado.ativa = id;
      desenharAbas();
      mostrarAtiva();
      ta.focus();
      agendar();
    }

    // A ULTIMA aba nunca fecha: e esvaziada. Um bloco sem aba nenhuma nao tem
    // onde escrever.
    function fecharAba(id) {
      const a = estado.abas.find((x) => x.id === id);
      if (!a) return;
      if (a.texto.trim() && !window.confirm(`Apagar a aba "${tituloDe(a)}" e o texto dela?`)) return;
      if (estado.abas.length === 1) {
        a.texto = '';
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
        if (ev.key === 'Enter') { ev.preventDefault(); terminar(true); ta.focus(); }
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); terminar(false); ta.focus(); }
      });
      campoNome.addEventListener('blur', () => terminar(true));
      elNome.replaceWith(campoNome);
      campoNome.focus();
      campoNome.select();
    }

    btnNova.addEventListener('click', novaAba);

    // ---------------------------------------------- escrever

    ta.addEventListener('input', () => {
      const a = abaAtiva();
      a.texto = ta.value;
      a.editadaEm = Date.now();
      // So o nome AUTOMATICO depende do texto; redesenhar a barra a cada tecla
      // seria a toa no resto do tempo.
      if (!a.titulo) {
        const el = elAbas.querySelector(`.notas-aba[data-id="${a.id}"] .notas-aba-nome`);
        if (el) el.textContent = tituloDe(a);
      }
      if (!busca.hidden) contar();
      agendar();
    });

    // `insertText`, e nao mexer no `value`: e o que mantem o Ctrl+Z funcionando.
    function inserir(texto) {
      ta.focus();
      document.execCommand('insertText', false, texto);
    }

    ta.addEventListener('keydown', (ev) => {
      // Tab escreve tabulacao, como num editor, em vez de levar o foco embora.
      if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        ev.preventDefault();
        inserir('\t');
      }
    });

    // ---------------------------------------------- buscar

    let achados = [];
    let atual = -1;

    function contar() {
      const termo = campo.value;
      achados = [];
      if (termo) {
        const alvo = ta.value.toLowerCase();
        const t = termo.toLowerCase();
        for (let i = alvo.indexOf(t); i >= 0 && achados.length < 10000; i = alvo.indexOf(t, i + t.length)) {
          achados.push(i);
        }
      }
      if (atual >= achados.length) atual = achados.length - 1;
      contador.textContent = termo ? `${achados.length ? atual + 1 : 0}/${achados.length}` : '';
      busca.classList.toggle('sem-achado', Boolean(termo) && !achados.length);
    }

    // Seleciona no textarea e rola ate o achado. Com a quebra automatica uma
    // linha de texto pode ocupar varias na tela, entao a conta `linha x
    // line-height` erraria: quem diz o topo e o espelho, com o texto ate ali.
    function irPara(i) {
      if (!achados.length) return;
      atual = (i + achados.length) % achados.length;
      const ini = achados[atual];
      const fim = ini + campo.value.length;
      ta.setSelectionRange(ini, fim);
      espelho.style.width = `${ta.clientWidth}px`;
      // O caractere invisivel no fim faz existir a linha que um `\n` final
      // abre na textarea e num div nao abre.
      espelho.textContent = ta.value.slice(0, ini) + '​';
      const est = getComputedStyle(ta);
      const alturaLinha = parseFloat(est.lineHeight) || 18;
      const topo = espelho.scrollHeight - parseFloat(est.paddingBottom) - alturaLinha;
      espelho.textContent = '';
      ta.scrollTop = Math.max(0, topo - ta.clientHeight / 2);
      contador.textContent = `${atual + 1}/${achados.length}`;
    }

    function abrirBusca() {
      busca.hidden = false;
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes('\n')) campo.value = sel;
      campo.focus();
      campo.select();
      atual = -1;
      contar();
      if (achados.length) irPara(Math.max(0, achados.findIndex((x) => x >= ta.selectionStart)));
    }

    function fecharBusca() {
      busca.hidden = true;
      achados = [];
      ta.focus();
    }

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

    function textoParaEnviar() {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      return sel.trim() ? sel : ta.value;
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
      const sel = ta.selectionEnd > ta.selectionStart && ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
      const cab = document.createElement('div');
      cab.className = 'menu-notas-cab';
      cab.textContent = sel ? 'Colar a seleção em…' : 'Colar a aba inteira em…';
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

    // O mousedown do painel chama `focar()`, que foca o textarea: clicar na
    // barra de busca ou num botao nao pode roubar o foco do campo de busca.
    raiz.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('input, button, .notas-aba')) ev.stopPropagation();
    });

    // ---------------------------------------------- arranque

    function mostrarEstado(t) {
      elEstado.textContent = t;
      elEstado.dataset.estado = t === 'não salvo' ? 'erro' : (t === 'salvo' ? 'ok' : 'gravando');
    }

    vista = { mostrarEstado };
    ta.disabled = true;
    mostrarEstado('carregando…');
    carregar().then(() => {
      if (painel.encerrado) return;
      ta.disabled = false;
      desenharAbas();
      mostrarAtiva();
      mostrarEstado('salvo');
      if (window.OrqGrade?.focado?.() === painel.id) ta.focus();
    }).catch((err) => {
      // Sem ler o disco, NAO deixa escrever: a primeira gravacao trocaria o que
      // esta guardado por um bloco vazio.
      mostrarEstado('não carregou');
      console.error('[notas] carregar falhou:', err);
    });

    painel.notas = {
      focar: () => { if (!ta.disabled) ta.focus(); },
      inserir,
      fechar: () => {
        guardarCursor();
        fecharMenu();
        elMenu?.remove();
        window.removeEventListener('mousedown', foraDoMenu, true);
        window.removeEventListener('keydown', escDoMenu, true);
        vista = null;
        if (sujo) salvar();
      },
      // Para o teste e a paleta.
      textarea: ta,
      abrirBusca,
      abrirMenu,
      estado: () => estado,
    };
  }

  // Abrir o bloco: um so, focado se ja existe. A pasta e a de dados do app --
  // e o que passa no filtro do `sessao.json`, e o `painelEm` ja o ignora.
  async function abrir() {
    const c = await window.orq.constantes();
    return window.OrqGrade.criarPainel({ cwd: c.pastaDados, feature: 'Bloco de notas', tipoPainel: 'notas' });
  }

  document.getElementById('btn-notas')?.addEventListener('click', () => abrir());

  window.OrqNotas = { montar, abrir, salvar, carregar };
})();
