'use strict';

// Ver o que a sessao mudou, sem sair do app.
//
// Lista de arquivos a esquerda, hunks de UM arquivo por vez a direita. Isso nao
// e so estetica: um diff de 200 arquivos renderizado inteiro sao dezenas de
// milhares de nos no DOM. Um arquivo por vez mantem a arvore pequena por
// construcao, sem precisar de virtualizacao nem de biblioteca.

(() => {
  const elDiff = document.getElementById('diff');
  const elTitulo = document.getElementById('diff-titulo');
  const elArquivos = document.getElementById('diff-arquivos');
  const elCorpo = document.getElementById('diff-corpo');
  const btnFechar = document.getElementById('diff-fechar');

  let arquivos = [];
  let selecionado = 0;

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
      return { nome, origem, linhas, mais, menos };
    });
  }

  function classeDa(linha) {
    if (linha.startsWith('+++') || linha.startsWith('---')) return 'diff-meta';
    if (linha.startsWith('@@')) return 'diff-hunk';
    if (linha.startsWith('+')) return 'diff-mais';
    if (linha.startsWith('-')) return 'diff-menos';
    if (linha.startsWith('diff --git') || linha.startsWith('index ')
      || linha.startsWith('new file') || linha.startsWith('deleted file')
      || linha.startsWith('similarity ') || linha.startsWith('rename ')) return 'diff-meta';
    return 'diff-contexto';
  }

  function desenharArquivos() {
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

      li.append(nome, origem, contas);
      li.addEventListener('click', () => { selecionado = i; desenharArquivos(); desenharCorpo(); });
      return li;
    }));
  }

  function desenharCorpo() {
    const a = arquivos[selecionado];
    if (!a) {
      elCorpo.replaceChildren();
      return;
    }
    const pre = document.createElement('div');
    pre.className = 'diff-linhas mono';
    for (const l of a.linhas) {
      const div = document.createElement('div');
      div.className = classeDa(l);
      // Linha vazia precisa de altura: sem isto o diff fica com buracos.
      div.textContent = l || ' ';
      pre.append(div);
    }
    elCorpo.replaceChildren(pre);
    elCorpo.scrollTop = 0;
  }

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
  }

  btnFechar?.addEventListener('click', fechar);
  window.OrqOverlays?.registrar(elDiff, fechar);

  window.OrqDiff = { abrir, fechar, separar, classeDa, arquivos: () => arquivos };
})();
