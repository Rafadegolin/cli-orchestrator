'use strict';

// Ver o que a sessao mudou, sem sair do app -- e comentar linhas para o agente.
//
// Lista de arquivos a esquerda, hunks de UM arquivo por vez a direita. Isso nao
// e so estetica: um diff de 200 arquivos renderizado inteiro sao dezenas de
// milhares de nos no DOM. Um arquivo por vez mantem a arvore pequena por
// construcao, sem precisar de virtualizacao nem de biblioteca. Os comentarios
// seguem a mesma regra: moram no modelo e so sao desenhados no arquivo aberto.
//
// Clicar numa linha (Shift+clique estende o intervalo) abre uma caixa; os
// comentarios se acumulam num rascunho POR WORKTREE, e "Colar no agente" monta
// um prompt so e cola na caixa do Claude SEM Enter -- o mesmo `colarTexto` do
// botao Revisao.

(() => {
  const elDiff = document.getElementById('diff');
  const elTitulo = document.getElementById('diff-titulo');
  const elArquivos = document.getElementById('diff-arquivos');
  const elCorpo = document.getElementById('diff-corpo');
  const btnFechar = document.getElementById('diff-fechar');
  const elRodape = document.getElementById('diff-rodape');
  const elRascunho = document.getElementById('diff-rascunho');
  const btnColar = document.getElementById('diff-colar');
  const btnDescartar = document.getElementById('diff-descartar');

  // O trecho citado no prompt. O diff envelhece entre comentar e colar, e e o
  // trecho -- nao o numero da linha -- que deixa o Claude se achar com a linha
  // deslocada. Mas um intervalo de 200 linhas citado inteiro afogaria o pedido.
  const MAX_TRECHO = 12;

  let arquivos = [];
  let selecionado = 0;
  // A worktree do overlay aberto: de onde sai a chave do rascunho e o painel.
  let alvo = null; // { projeto, caminho, nome }
  // Rascunho por worktree, em memoria. Sobrevive a fechar e reabrir o overlay,
  // nao a reiniciar o app -- o dialogo de fechar avisa (ver `avisarMain`).
  const rascunhos = new Map(); // caminho normalizado -> [comentario]
  // Intervalo de linhas sendo comentado, em INDICES do arquivo aberto.
  let selecao = null; // { de, ate }
  // Caixa aberta: comentario novo (`indice: -1`) ou edicao de um existente.
  let editor = null; // { indice }

  const normalizar = (p) => String(p || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();

  // ------------------------------------------------------------ parser

  function classeDa(linha) {
    if (linha.startsWith('+++') || linha.startsWith('---')) return 'diff-meta';
    if (linha.startsWith('@@')) return 'diff-hunk';
    if (linha.startsWith('+')) return 'diff-mais';
    if (linha.startsWith('-')) return 'diff-menos';
    if (linha.startsWith('diff --git') || linha.startsWith('index ')
      || linha.startsWith('new file') || linha.startsWith('deleted file')
      || linha.startsWith('similarity ') || linha.startsWith('rename ')
      || linha.startsWith('\\ No newline')) return 'diff-meta';
    return 'diff-contexto';
  }

  // Numero de cada linha nos dois lados, lido do `@@ -a,b +c,d @@` de cada hunk.
  // Contexto anda os dois contadores, `+` so o novo, `-` so o antigo. Meta e
  // cabecalho de hunk ficam sem numero: nao ha o que citar neles. Arquivo novo
  // (`--- /dev/null`) cai de graca em `@@ -0,0 +1,N @@`.
  function numerar(linhas) {
    let antiga = null;
    let nova = null;
    return linhas.map((texto) => {
      const classe = classeDa(texto);
      if (classe === 'diff-hunk') {
        const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(texto);
        antiga = m ? Number(m[1]) : null;
        nova = m ? Number(m[2]) : null;
        return { texto, classe, antiga: null, nova: null };
      }
      // Antes do primeiro hunk (cabecalho do arquivo) nao ha numeracao.
      if (classe === 'diff-meta' || antiga === null) return { texto, classe, antiga: null, nova: null };
      if (classe === 'diff-mais') return { texto, classe, antiga: null, nova: nova++ };
      if (classe === 'diff-menos') return { texto, classe, antiga: antiga++, nova: null };
      return { texto, classe, antiga: antiga++, nova: nova++ };
    });
  }

  const comentavel = (l) => l.antiga !== null || l.nova !== null;

  // Parser de diff unificado. Quebra em `diff --git`, e dentro de cada pedaco
  // classifica a linha pelo primeiro caractere. Sem realce de sintaxe: seria a
  // primeira dependencia de UI do projeto, e ninguem precisa dela para ler o
  // que mudou.
  function separar(texto, origem) {
    if (!texto || !texto.trim()) return [];

    const partes = texto.split(/^diff --git /m).filter((p) => p.trim());
    return partes.map((p) => {
      const linhas = `diff --git ${p}`.split('\n');
      // "diff --git a/src/x.js b/src/x.js" -> src/x.js
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(linhas[0]);
      const nome = m ? m[2] : linhas[0].replace('diff --git ', '');
      let mais = 0;
      let menos = 0;
      for (const l of linhas) {
        if (l.startsWith('+') && !l.startsWith('+++')) mais += 1;
        else if (l.startsWith('-') && !l.startsWith('---')) menos += 1;
      }
      return { nome, origem, linhas, numeradas: numerar(linhas), mais, menos };
    });
  }

  // ------------------------------------------------------------ comentario

  // O comentario e montado NA HORA de comentar, com o trecho copiado: o diff
  // pode ser relido (e mudar) antes de colar, e o comentario continua valendo.
  //
  // A referencia usa o lado NOVO (contexto e `+`), que e o arquivo como esta
  // agora. So um intervalo feito apenas de linhas removidas cai no lado antigo,
  // e o prompt diz isso -- aquele numero nao existe mais no arquivo.
  function comentarioDe(arquivo, de, ate, texto) {
    const faixa = arquivo.numeradas.slice(de, ate + 1).filter(comentavel);
    const novas = faixa.map((l) => l.nova).filter((n) => n !== null);
    const lado = novas.length ? 'nova' : 'antiga';
    const nums = lado === 'nova' ? novas : faixa.map((l) => l.antiga).filter((n) => n !== null);
    const corte = faixa.length > MAX_TRECHO;
    const trecho = faixa.slice(0, MAX_TRECHO).map((l) => l.texto);
    if (corte) trecho.push('…');
    return {
      arquivo: arquivo.nome,
      origem: arquivo.origem,
      lado,
      de: Math.min(...nums),
      ate: Math.max(...nums),
      trecho,
      texto: String(texto || '').trim(),
    };
  }

  function referencia(c) {
    const linhas = c.de === c.ate ? `${c.de}` : `${c.de}-${c.ate}`;
    return `${c.arquivo}:${linhas}${c.lado === 'antiga' ? ' (linha removida; numeração antiga)' : ''}`;
  }

  // Um prompt so, sem `\r` e SEM quebra no fim: colado por bracketed paste, uma
  // quebra final viraria uma linha vazia sobrando na caixa do Claude.
  function montarPrompt(comentarios) {
    const blocos = comentarios.map((c) => [
      referencia(c),
      ...c.trecho.map((t) => `> ${t}`),
      c.texto,
    ].join('\n'));
    return ['Revise estes pontos:', ...blocos].join('\n\n').replace(/\r/g, '').replace(/\s+$/, '');
  }

  function rascunho() {
    if (!alvo) return [];
    const k = normalizar(alvo.caminho);
    if (!rascunhos.has(k)) rascunhos.set(k, []);
    return rascunhos.get(k);
  }

  // O main precisa do total para o dialogo de fechar o app: o rascunho nao
  // persiste, e fechar com comentario nao colado o perderia calado.
  function avisarMain() {
    let total = 0;
    for (const lista of rascunhos.values()) total += lista.length;
    window.orq.rascunhoDiff?.(total);
  }

  function atualizarRodape() {
    const n = alvo ? rascunho().length : 0;
    elRodape.hidden = n === 0;
    elRascunho.textContent = n === 1 ? '1 comentário no rascunho' : `${n} comentários no rascunho`;
    btnColar.textContent = n === 1 ? 'Colar 1 comentário no agente' : `Colar ${n} comentários no agente`;
  }

  // ------------------------------------------------------------ desenho

  function desenharArquivos() {
    const lista = rascunho();
    elArquivos.replaceChildren(...arquivos.map((a, i) => {
      const li = document.createElement('li');
      li.className = 'diff-arquivo' + (i === selecionado ? ' ativo' : '');
      li.dataset.indice = String(i);

      const nome = document.createElement('span');
      nome.className = 'diff-nome';
      nome.textContent = a.nome;
      nome.title = a.nome;

      const contas = document.createElement('span');
      contas.className = 'diff-contas mono';
      contas.textContent = `+${a.mais} −${a.menos}`;

      const origem = document.createElement('span');
      origem.className = 'diff-origem';
      origem.textContent = a.origem;

      const n = lista.filter((c) => c.arquivo === a.nome && c.origem === a.origem).length;
      if (n) {
        const marca = document.createElement('span');
        marca.className = 'diff-marca-comentarios';
        marca.textContent = n === 1 ? '1 comentário' : `${n} comentários`;
        origem.append(' · ', marca);
      }

      li.append(nome, origem, contas);
      li.addEventListener('click', () => {
        selecionado = i;
        selecao = null;
        editor = null;
        desenharArquivos();
        desenharCorpo();
      });
      return li;
    }));
  }

  // Onde cada comentario do rascunho cai no arquivo aberto: o indice da ULTIMA
  // linha do intervalo, para a nota vir logo abaixo do trecho. Casa por numero
  // no mesmo lado; se o diff mudou e a linha sumiu, a nota vai para o topo.
  function posicoes(a) {
    const mapa = new Map(); // indice da linha -> [indice do comentario]
    const soltos = [];
    rascunho().forEach((c, ic) => {
      if (c.arquivo !== a.nome || c.origem !== a.origem) return;
      let ultimo = -1;
      a.numeradas.forEach((l, i) => {
        const n = c.lado === 'nova' ? l.nova : (l.classe === 'diff-menos' ? l.antiga : null);
        if (n !== null && n >= c.de && n <= c.ate) ultimo = i;
      });
      if (ultimo < 0) soltos.push(ic);
      else mapa.set(ultimo, [...(mapa.get(ultimo) || []), ic]);
    });
    return { mapa, soltos };
  }

  function marcadas(a) {
    const set = new Set();
    for (const c of rascunho()) {
      if (c.arquivo !== a.nome || c.origem !== a.origem) continue;
      a.numeradas.forEach((l, i) => {
        const n = c.lado === 'nova' ? l.nova : (l.classe === 'diff-menos' ? l.antiga : null);
        if (n !== null && n >= c.de && n <= c.ate) set.add(i);
      });
    }
    return set;
  }

  function notaDe(indice) {
    const c = rascunho()[indice];
    const nota = document.createElement('div');
    nota.className = 'diff-nota';
    const ref = document.createElement('span');
    ref.className = 'diff-nota-ref';
    ref.textContent = referencia(c);
    const texto = document.createElement('span');
    texto.className = 'diff-nota-texto';
    texto.textContent = c.texto;
    nota.append(ref, texto);
    nota.title = 'Clique para editar ou remover';
    nota.addEventListener('click', () => {
      selecao = null;
      editor = { indice };
      desenharCorpo();
    });
    return nota;
  }

  function caixaDe(valor) {
    const caixa = document.createElement('div');
    caixa.className = 'diff-editor';

    const campo = document.createElement('textarea');
    campo.className = 'diff-editor-campo';
    campo.rows = 3;
    campo.placeholder = 'O que o agente deve rever aqui? (Enter salva, Shift+Enter quebra a linha, Esc cancela)';
    campo.value = valor || '';
    campo.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        salvar(campo.value);
      }
    });

    const acoes = document.createElement('div');
    acoes.className = 'diff-editor-acoes';
    const ok = document.createElement('button');
    ok.className = 'primario';
    ok.textContent = editor && editor.indice >= 0 ? 'Salvar' : 'Comentar';
    ok.addEventListener('click', () => salvar(campo.value));
    const cancelar = document.createElement('button');
    cancelar.textContent = 'Cancelar';
    cancelar.addEventListener('click', cancelarEditor);
    acoes.append(ok, cancelar);

    if (editor && editor.indice >= 0) {
      const remover = document.createElement('button');
      remover.className = 'diff-editor-remover';
      remover.textContent = 'Remover';
      remover.addEventListener('click', () => {
        rascunho().splice(editor.indice, 1);
        editor = null;
        mudouRascunho();
      });
      acoes.append(remover);
    }

    caixa.append(campo, acoes);
    // Foco depois de entrar no DOM; senao o `focus()` nao pega.
    requestAnimationFrame(() => campo.focus());
    return caixa;
  }

  function desenharCorpo() {
    const a = arquivos[selecionado];
    if (!a) {
      elCorpo.replaceChildren();
      return;
    }
    const rolagem = elCorpo.scrollTop;
    const { mapa, soltos } = posicoes(a);
    const comComentario = marcadas(a);
    const sel = selecao ? { de: Math.min(selecao.de, selecao.ate), ate: Math.max(selecao.de, selecao.ate) } : null;

    const pre = document.createElement('div');
    pre.className = 'diff-linhas mono';

    for (const ic of soltos) {
      pre.append(notaDe(ic));
      if (editor && editor.indice === ic) pre.append(caixaDe(rascunho()[ic].texto));
    }

    a.numeradas.forEach((l, i) => {
      const div = document.createElement('div');
      let classe = l.classe;
      if (comentavel(l)) classe += ' diff-comentavel';
      if (comComentario.has(i)) classe += ' diff-comentada';
      if (sel && i >= sel.de && i <= sel.ate) classe += ' diff-selecionada';
      div.className = classe;
      div.dataset.i = String(i);
      // Linha vazia precisa de altura: sem isto o diff fica com buracos.
      div.textContent = l.texto || ' ';
      pre.append(div);

      for (const ic of mapa.get(i) || []) {
        pre.append(notaDe(ic));
        if (editor && editor.indice === ic) pre.append(caixaDe(rascunho()[ic].texto));
      }
      if (editor && editor.indice === -1 && sel && i === sel.ate) pre.append(caixaDe(''));
    });

    elCorpo.replaceChildren(pre);
    elCorpo.scrollTop = rolagem;
  }

  // Um ouvinte so no corpo, e nao um por linha: um arquivo grande sao milhares
  // de linhas, e redesenhar a cada clique ja e o caro aqui.
  elCorpo.addEventListener('click', (ev) => {
    const linha = ev.target.closest?.('.diff-comentavel');
    if (!linha || !elCorpo.contains(linha)) return;
    const i = Number(linha.dataset.i);
    // Shift estende a selecao do MESMO arquivo; a selecao vive em indices dele,
    // e trocar de arquivo ja a zera.
    if (ev.shiftKey && selecao) selecao = { de: selecao.de, ate: i };
    else selecao = { de: i, ate: i };
    editor = { indice: -1 };
    // Shift+clique tambem seleciona texto no navegador; aqui so atrapalha.
    window.getSelection?.()?.removeAllRanges();
    desenharCorpo();
  });

  function salvar(texto) {
    const t = String(texto || '').trim();
    if (!t) {
      cancelarEditor();
      return;
    }
    const a = arquivos[selecionado];
    if (editor && editor.indice >= 0) {
      rascunho()[editor.indice].texto = t;
    } else if (a && selecao) {
      const de = Math.min(selecao.de, selecao.ate);
      const ate = Math.max(selecao.de, selecao.ate);
      rascunho().push(comentarioDe(a, de, ate, t));
    }
    selecao = null;
    editor = null;
    mudouRascunho();
  }

  function cancelarEditor() {
    selecao = null;
    editor = null;
    desenharCorpo();
  }

  function mudouRascunho() {
    desenharArquivos();
    desenharCorpo();
    atualizarRodape();
    avisarMain();
  }

  // ------------------------------------------------------------ colar

  // A sessao desta worktree. `painelEm` sozinho nao basta: o painel aberto por
  // `claude -w` nasce com o cwd na RAIZ do projeto, e e a sessao que migra para
  // a worktree. Por isso a segunda regra casa pela convencao do `-w` -- o slug
  // e ao mesmo tempo o nome da pasta e o `painel.feature`.
  function painelDaWorktree(projeto, caminho, nome) {
    const direto = window.OrqLigacoes?.painelEm?.(caminho);
    if (direto) return direto;
    const raiz = normalizar(projeto);
    for (const p of window.OrqPainel?.painelPorId.values() || []) {
      if (p.feature === nome && normalizar(p.cwd) === raiz) return p;
    }
    return null;
  }

  async function colar() {
    if (!alvo) return;
    const lista = rascunho();
    if (!lista.length) return;
    const prompt = montarPrompt(lista);
    const painel = painelDaWorktree(alvo.projeto, alvo.caminho, alvo.nome);

    if (painel) {
      if (!painel.colarTexto(prompt, 'os comentários')) return;
      lista.length = 0;
      avisarMain();
      fechar();
      window.OrqGrade?.focarPainel?.(painel.id);
      return;
    }

    // Sem sessao nesta worktree: abre uma, continuando a conversa de la, com os
    // comentarios ja na caixa. E o caminho do `abrir-externo.js`: a sonda do CLI
    // decide se a flag existe, e `prefillCabe` se a linha cabe no cmd.exe. Sem
    // isso, a sessao abre igual e o texto vai para a area de transferencia.
    let podePrefill = false;
    try { podePrefill = await window.orq.claudePrefill(); } catch { podePrefill = false; }
    const base = window.OrqProjetos.COMANDO_RETOMAR;
    if (podePrefill && !window.OrqProjetos.prefillCabe(base, prompt)) podePrefill = false;

    const comandoInicial = podePrefill ? window.OrqProjetos.comPrefill(base, prompt) : base;
    const w = { caminho: alvo.caminho, nome: alvo.nome, sessaoViva: false };
    lista.length = 0;
    avisarMain();
    fechar();
    await window.OrqProjetos.retomar(alvo.projeto, w, { comandoInicial });
    if (!podePrefill) {
      window.orq.copiar(prompt);
      window.OrqToast?.mostrar('Sessão aberta na worktree. Os comentários foram copiados — cole no prompt.');
    }
  }

  btnColar?.addEventListener('click', () => {
    colar().catch((err) => {
      console.error('[diff] colar', err);
      window.OrqToast?.mostrar(`Não consegui colar os comentários: ${err.message || err}`);
    });
  });

  btnDescartar?.addEventListener('click', () => {
    rascunho().length = 0;
    selecao = null;
    editor = null;
    mudouRascunho();
  });

  // ------------------------------------------------------------ abrir/fechar

  function aviso(texto) {
    const p = document.createElement('p');
    p.className = 'diff-aviso';
    p.textContent = texto;
    elArquivos.replaceChildren();
    elCorpo.replaceChildren(p);
  }

  async function abrir(projeto, caminho, rotulo) {
    elDiff.hidden = false;
    elTitulo.textContent = `Alterações em ${rotulo || ''}`.trim();
    arquivos = [];
    selecionado = 0;
    selecao = null;
    editor = null;
    // O nome da pasta e o slug, que e o `painel.feature` da sessao dali. O
    // rotulo que vem da lateral e esse mesmo nome; o basename e a garantia.
    alvo = { projeto, caminho, nome: String(caminho).split(/[\\/]/).filter(Boolean).pop() || rotulo };
    atualizarRodape();
    aviso('Lendo o git…');

    const r = await window.orq.worktreesDiff(projeto, caminho);
    if (!r || !r.ok) {
      aviso(r?.texto || 'não consegui ler o diff');
      return;
    }

    elTitulo.textContent = `${rotulo || r.branch} · ${r.branch} vs ${r.baseBranch || 'base'}`;
    arquivos = [
      ...separar(r.naoCommitado, 'não commitado'),
      ...separar(r.commitado, 'commitado'),
    ];

    if (!arquivos.length) {
      aviso('Nada mudou nesta sessão ainda.');
      return;
    }

    desenharArquivos();
    desenharCorpo();

    if (r.truncado) {
      const nota = document.createElement('p');
      nota.className = 'diff-aviso';
      nota.textContent = 'O diff é grande demais e foi cortado. Veja o restante no git.';
      elCorpo.prepend(nota);
    }
  }

  function fechar() {
    elDiff.hidden = true;
    arquivos = [];
    selecao = null;
    editor = null;
  }

  btnFechar?.addEventListener('click', fechar);
  // O Esc dos overlays e tratado em CAPTURA na `window` (casca.js), antes de
  // qualquer ouvinte da caixa de texto. Por isso a distincao mora aqui: com a
  // caixa aberta, o Esc cancela o comentario e o overlay fica.
  window.OrqOverlays?.registrar(elDiff, () => {
    if (editor) cancelarEditor();
    else fechar();
  });

  // Janela recarregada perde o rascunho: o main nao pode continuar achando que
  // ha comentario a perder.
  avisarMain();

  window.OrqDiff = {
    abrir,
    fechar,
    separar,
    classeDa,
    numerar,
    comentarioDe,
    montarPrompt,
    painelDaWorktree,
    colar,
    rascunho,
    MAX_TRECHO,
    arquivos: () => arquivos,
  };
})();
