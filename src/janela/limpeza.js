'use strict';

// A faxina de worktrees.
//
// O problema que ela resolve nao e tecnico, e de VISIBILIDADE. Fechar um painel
// mata o processo e mais nada -- a pasta `<projeto>/.claude/worktrees/<feat>`, o
// branch `worktree-<feat>` e o lock com o PID ja morto continuam todos la. Cada
// worktree e um checkout inteiro, com node_modules proprio, e uma feature por
// dia vira alguns GB por semana que ninguem ve.
//
// Ate aqui o unico caminho para limpar era o `x` de uma linha da lista de
// worktrees, dentro do card do projeto, uma por vez. Isto e a mesma acao, em
// lote, com o que interessa na frente: tamanho, idade, e o que impede cada uma.
//
// O QUE ELA NAO FAZ: nada automatico. Continua valendo a regra da casa -- so
// apaga por clique explicito, e com o dialogo nativo nomeando o que vai embora
// (inclusive os arquivos que o git ignora, que nenhum commit guarda).

(() => {
  const elLimpeza = document.getElementById('limpeza');
  const elTitulo = document.getElementById('limpeza-titulo');
  const elLista = document.getElementById('limpeza-lista');
  const elResumo = document.getElementById('limpeza-resumo');
  const btnArquivar = document.getElementById('limpeza-arquivar');
  const btnCancelar = document.getElementById('limpeza-cancelar');
  const btnFechar = document.getElementById('limpeza-fechar');

  let projeto = null;
  let itens = [];
  const marcados = new Set();

  function formatarBytes(b) {
    if (!Number.isFinite(b) || b <= 0) return '';
    if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
    if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
    return `${Math.max(1, Math.round(b / 1024))} KB`;
  }

  // "12 dias", "3 meses". A idade da feature responde "isto ainda importa?"
  // melhor que qualquer outra coluna.
  function formatarIdade(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const dias = Math.floor(ms / 86400000);
    if (dias < 1) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return `${dias} dias`;
    const meses = Math.round(dias / 30);
    return meses === 1 ? '1 mês' : `${meses} meses`;
  }

  // O mesmo vocabulario da lista dentro do card do projeto. Duas telas falando
  // do mesmo estado com palavras diferentes e como ter dois estados.
  function impedimentoDe(w) {
    if (w.sessaoViva) return `Sessão do Claude rodando (pid ${w.pid}).`;
    if (!w.limpo) return 'Há alteração sem commit.';
    if (w.naoMesclados > 0) return `Há commit fora de ${w.baseBranch}.`;
    return '';
  }

  function etiquetaDe(w) {
    if (w.sessaoViva) return 'aberto agora';
    if (!w.limpo) return `${w.sujos} alterado${w.sujos === 1 ? '' : 's'}`;
    if (w.naoMesclados > 0) return `${w.naoMesclados} commit${w.naoMesclados === 1 ? '' : 's'}`;
    if (!w.existe) return 'pasta sumiu';
    return 'mesclada';
  }

  function atualizarResumo() {
    const alvos = itens.filter((i) => marcados.has(i.caminho));
    const bytes = alvos.reduce((s, i) => s + (i.tamanho?.bytes || 0), 0);
    const parcial = alvos.some((i) => i.tamanho?.parcial);

    if (!alvos.length) {
      elResumo.textContent = itens.length
        ? 'Nada marcado.'
        : 'Nenhuma worktree neste projeto.';
    } else {
      const espaco = bytes ? ` · libera ${parcial ? 'mais de ' : ''}${formatarBytes(bytes)}` : '';
      elResumo.textContent = `${alvos.length} marcada${alvos.length === 1 ? '' : 's'}`
        + `${espaco} · remove a pasta e o branch de cada uma`;
    }
    btnArquivar.disabled = alvos.length === 0;
  }

  function desenhar() {
    elLista.replaceChildren(...itens.map((w) => {
      const impedimento = impedimentoDe(w);

      const li = document.createElement('li');
      li.className = 'limpeza-item' + (impedimento ? ' limpeza-travado' : '');

      const caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.className = 'limpeza-caixa';
      // Impedida entra DESMARCADA e travada, mas continua na lista: some-la
      // esconderia justamente a worktree que voce quer entender por que nao sai.
      caixa.disabled = Boolean(impedimento);
      caixa.checked = marcados.has(w.caminho);
      caixa.title = impedimento || `Arquivar ${w.nome}`;
      caixa.addEventListener('change', () => {
        if (caixa.checked) marcados.add(w.caminho);
        else marcados.delete(w.caminho);
        atualizarResumo();
      });

      const nome = document.createElement('span');
      nome.className = 'limpeza-nome';
      nome.textContent = w.nome;
      nome.title = `${w.caminho}\nbranch: ${w.branch}`;

      const etiqueta = document.createElement('span');
      etiqueta.className = 'limpeza-marca' + (impedimento ? ' limpeza-marca-impedida' : '');
      etiqueta.textContent = etiquetaDe(w);
      etiqueta.title = impedimento || 'Nada impede arquivar esta worktree.';

      const meta = document.createElement('span');
      meta.className = 'limpeza-meta mono';
      const tamanho = w.tamanho
        ? `${w.tamanho.parcial ? '≥' : ''}${formatarBytes(w.tamanho.bytes)}`
        : '…';
      const idade = formatarIdade(w.ultimoCommit);
      meta.textContent = [tamanho, idade].filter(Boolean).join(' · ');

      // O mesmo diff que a lista do card ja abre: decidir sem ver o que mudou
      // nao e decidir.
      const ver = document.createElement('button');
      ver.className = 'limpeza-ver';
      ver.textContent = 'ver diff';
      ver.addEventListener('click', (ev) => {
        ev.stopPropagation();
        window.OrqDiff?.abrir(projeto, w.caminho, w.nome);
      });

      li.append(caixa, nome, etiqueta, meta, ver);
      return li;
    }));

    atualizarResumo();
  }

  async function abrir(caminhoProjeto, nomeProjeto = '') {
    projeto = caminhoProjeto;
    marcados.clear();
    itens = [];

    elTitulo.textContent = nomeProjeto ? `Limpar worktrees — ${nomeProjeto}` : 'Limpar worktrees';
    elLista.replaceChildren();
    elResumo.textContent = 'lendo os worktrees…';
    btnArquivar.disabled = true;
    elLimpeza.hidden = false;

    itens = await window.orq.worktreesListar(caminhoProjeto) || [];
    // Marcadas por padrao SO as candidatas -- e quem decide isso e o
    // `podeArquivar` do processo principal, nao uma regra reescrita aqui.
    for (const w of itens) if (w.candidata) marcados.add(w.caminho);
    desenhar();

    // O tamanho chega DEPOIS: sao dezenas de milhares de stat por checkout, e
    // segurar a lista para contar bytes deixaria a tela parada no clique.
    if (!itens.length) return;
    const tamanhos = await window.orq.worktreesTamanhos(itens.map((w) => w.caminho));
    // A tela pode ter sido fechada, ou aberta em outro projeto, no meio disso.
    if (elLimpeza.hidden || projeto !== caminhoProjeto) return;
    for (const w of itens) w.tamanho = tamanhos[w.caminho];
    desenhar();
  }

  async function arquivarMarcadas() {
    const alvos = [...marcados];
    if (!alvos.length) return { ok: false };

    btnArquivar.disabled = true;
    btnArquivar.textContent = 'arquivando…';

    const r = await window.orq.worktreesArquivarVarias(projeto, alvos);

    btnArquivar.textContent = 'Arquivar marcadas';

    if (r.cancelado) {
      btnArquivar.disabled = false;
      return r;
    }

    // UM toast com o resumo: o toast e um de cada vez, e N deles se
    // atropelariam sem ninguem conseguir ler nenhum.
    const partes = [];
    if (r.arquivadas?.length) partes.push(`${r.arquivadas.length} arquivada${r.arquivadas.length === 1 ? '' : 's'}`);
    if (r.recusadas?.length) partes.push(`${r.recusadas.length} recusada${r.recusadas.length === 1 ? '' : 's'}`);
    const branchesPresos = (r.avisos || []).length;
    if (branchesPresos) partes.push(`${branchesPresos} branch não removido`);
    if (partes.length) window.OrqToast?.mostrar(partes.join(' · '));

    // Recarrega em vez de remover da lista na mao: o estado real pode ter
    // mudado no meio do lote, e a lista tem de refletir o disco.
    await abrir(projeto, elTitulo.textContent.replace(/^Limpar worktrees — /, ''));
    window.OrqProjetos?.recarregarDetalhes?.();
    return r;
  }

  function fechar() {
    elLimpeza.hidden = true;
    itens = [];
    marcados.clear();
    projeto = null;
  }

  btnArquivar?.addEventListener('click', arquivarMarcadas);
  btnCancelar?.addEventListener('click', fechar);
  btnFechar?.addEventListener('click', fechar);
  window.OrqOverlays?.registrar(elLimpeza, fechar);

  window.OrqLimpeza = {
    abrir,
    fechar,
    arquivarMarcadas,
    formatarBytes,
    formatarIdade,
    itens: () => itens,
    marcados: () => [...marcados],
  };
})();
