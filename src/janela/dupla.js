'use strict';
// Implementacao dupla: uma feature que atravessa dois repositorios.
//
// O caso real: backend num repo e frontend noutro, mesma feature. Sem isto era
// preciso SAIR do orquestrador -- abrir os dois repos a mao, entrar nas branches
// e rodar um `claude` de terminal comum que enxergasse os dois.
//
// O desenho cabe numa linha: o app cria as DUAS worktrees, abre UM painel na do
// repositorio escolhido, e passa a outra em `ligacoes` -- de onde o `--add-dir`
// sai sozinho, porque `criarPainel` ja chama `OrqLigacoes.comAddDir`. Sessao
// nova lancada com `--add-dir` nao pede confirmacao nenhuma; a danca do
// `/add-dir` com Enter separado so existe para sessao JA viva.
//
// Duas coisas que decidem a correcao, e nenhuma e obvia:
//
//  1. O `cwd` do painel e a WORKTREE, nao a raiz do projeto. Deixar o `claude
//     -w` criar faria o painel nascer em `C:\projeto` enquanto a sessao migra
//     para dentro da worktree, e `p.cwd` mentiria sobre onde a sessao esta --
//     quebrando `OrqLigacoes.painelEm()` e o portao de "painel aberto nesta
//     pasta" que protege o arquivar.
//  2. Por isso o comando vai SEM `-w` (`montarComando(..., { worktree: false })`):
//     a worktree ja existe, e o `-w` criaria uma segunda dentro dela.
//
// Nao ha campo novo no painel: a ligacao entra em `p.ligacoes`, que o
// `retratoSessao()` ja grava e o `despertar()` ja reaplica. Uma dupla restaurada
// volta ligada sozinha.

(() => {
  const elOverlay = document.getElementById('dupla');
  const elA = document.getElementById('dupla-a');
  const elB = document.getElementById('dupla-b');
  const elNome = document.getElementById('dupla-nome');
  const elDica = document.getElementById('dupla-dica');
  const elOnde = document.getElementById('dupla-onde');
  const elPrevia = document.getElementById('dupla-previa');
  const elErro = document.getElementById('dupla-erro');
  const btnConfirmar = document.getElementById('dupla-confirmar');
  const btnCancelar = document.getElementById('dupla-cancelar');

  // Qual dos dois hospeda o terminal: 'a' ou 'b'.
  let onde = 'a';

  // Ultima chamada vence. `atualizarPrevia` limpa, ESPERA o main e so entao
  // escreve: com duas chamadas no ar -- digitar dispara `input` e trocar de
  // repositorio dispara `change` -- as duas limpavam primeiro e escreviam
  // depois, e a previa saia com as linhas em DOBRO. Foi o teste que pegou.
  let previaEmCurso = 0;

  function candidatos() {
    // Sem `.git` nao existe worktree, e projeto que sumiu do disco nao recebe
    // nada. Oferecer o que so sabe falhar e pior que nao oferecer.
    return (window.OrqProjetos?.lista?.() || []).filter((p) => p.existe && p.git);
  }

  function escolhido(sel) {
    return candidatos().find((p) => p.id === sel.value) || null;
  }

  function slug() {
    return window.OrqProjetos.slugFeature(elNome.value || '');
  }

  function mostrarErro(texto) {
    elErro.textContent = texto || '';
    elErro.hidden = !texto;
  }

  // ------------------------------------------------------------ desenho

  function preencherSelects() {
    const lista = candidatos();
    for (const sel of [elA, elB]) {
      const antes = sel.value;
      sel.replaceChildren(...lista.map((p) => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.nome;
        return o;
      }));
      if (lista.some((p) => p.id === antes)) sel.value = antes;
    }
    // Dois selects com o mesmo padrao apontariam para o mesmo repositorio, e o
    // primeiro clique seria sempre um erro.
    if (lista.length > 1 && elA.value === elB.value) elB.value = lista[1].id;
  }

  function desenharOnde() {
    const a = escolhido(elA);
    const b = escolhido(elB);
    elOnde.replaceChildren(...[['a', a], ['b', b]].map(([qual, p]) => {
      const btn = document.createElement('button');
      btn.textContent = p ? p.nome : '—';
      btn.className = onde === qual ? 'ativa' : '';
      btn.addEventListener('click', () => { onde = qual; desenharOnde(); });
      return btn;
    }));
  }

  // O nome REAL do branch, antes de confirmar. Mesma regra do campo de sessao do
  // topo, e ela veio de um defeito: a tela prometia `feat/auth-refresh` e o git
  // recebia `worktree-auth-refresh`.
  function atualizarDica() {
    const s = slug();
    elDica.textContent = s
      ? `worktree ${s} · branch worktree-${s}, nos dois repositórios`
      : 'digite o nome da feature';
  }

  // Diz o que vai acontecer com CADA repositorio antes de escrever qualquer
  // coisa: criar, ou reaproveitar o que ja esta la.
  async function atualizarPrevia() {
    const a = escolhido(elA);
    const b = escolhido(elB);
    const s = slug();
    const meu = ++previaEmCurso;
    elPrevia.replaceChildren();
    if (!a || !b || !s) return;

    const r = await window.orq.worktreesPreverDupla(a.caminho, b.caminho, s);
    // Outra chamada comecou enquanto esta esperava: quem escreve e ela.
    if (meu !== previaEmCurso) return;

    elPrevia.replaceChildren();
    for (const [proj, p] of [[a, r.a], [b, r.b]]) {
      const linha = document.createElement('div');
      linha.className = 'dupla-previa-linha';
      const nome = document.createElement('span');
      nome.textContent = proj.nome;
      const acao = document.createElement('span');
      acao.className = 'mono';
      acao.textContent = p.ok
        ? (p.existe ? 'reaproveitar (já existe)' : 'criar')
        : p.texto;
      if (!p.ok) acao.classList.add('dupla-previa-erro');
      linha.append(nome, acao);
      elPrevia.append(linha);
    }
  }

  function atualizar() {
    desenharOnde();
    atualizarDica();
    mostrarErro('');
    atualizarPrevia();
  }

  // ------------------------------------------------------------ abrir/fechar

  function abrir() {
    if (candidatos().length < 2) {
      window.OrqToast?.mostrar('cadastre ao menos dois projetos com git');
      return;
    }
    preencherSelects();
    onde = 'a';
    atualizar();
    elOverlay.hidden = false;
    elNome.focus();
  }

  function fechar() {
    elOverlay.hidden = true;
  }

  function aberta() {
    return elOverlay.hidden === false;
  }

  // ------------------------------------------------------------ confirmar

  async function confirmar() {
    const a = escolhido(elA);
    const b = escolhido(elB);
    const s = slug();

    if (!a || !b) return mostrarErro('escolha os dois repositórios');
    if (a.id === b.id) return mostrarErro('escolha dois repositórios diferentes');
    if (!s) return mostrarErro('dê um nome à feature');

    btnConfirmar.disabled = true;
    const antes = btnConfirmar.textContent;
    btnConfirmar.textContent = 'criando…';
    try {
      const r = await window.orq.worktreesCriarDupla(a.caminho, b.caminho, s);
      if (!r.ok) {
        const qual = r.onde === 'a' ? a.nome : b.nome;
        return mostrarErro(`${qual}: ${r.texto}`);
      }

      const anfitriao = onde === 'a' ? r.a : r.b;
      const outro = onde === 'a' ? r.b : r.a;

      fechar();
      await window.OrqGrade.criarPainel({
        // A worktree, e nao a raiz: e o que mantem `p.cwd` verdadeiro.
        cwd: anfitriao.caminho,
        feature: s,
        // Sem `-w`: a worktree ja existe, e ele criaria outra dentro dela.
        comandoInicial: window.OrqProjetos.montarComando(s, true, { worktree: false }),
        // Vira `--add-dir "<caminho>"` dentro do proprio `criarPainel`.
        ligacoes: [outro.caminho],
      });

      // Aviso do que o `.worktreeinclude` nao conseguiu copiar. Um toast so: o
      // toast e um de cada vez, e varios se atropelariam.
      if (r.avisos?.length) window.OrqToast?.mostrar(r.avisos[0]);
    } catch (err) {
      // O `finally` abaixo e o que impede o botao de ficar preso em "criando…"
      // para sempre -- foi por ai que toda excecao do main virava "travou".
      mostrarErro(String(err?.message || err));
    } finally {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = antes;
    }
    return undefined;
  }

  // ------------------------------------------------------------ fiacao

  document.getElementById('btn-dupla')?.addEventListener('click', abrir);
  btnCancelar?.addEventListener('click', fechar);
  btnConfirmar?.addEventListener('click', confirmar);
  elA?.addEventListener('change', atualizar);
  elB?.addEventListener('change', atualizar);
  elNome?.addEventListener('input', atualizar);
  elNome?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') confirmar();
  });

  // Esc pelo topo da pilha, clique no fundo e z-index por ordem de abertura.
  window.OrqOverlays?.registrar(elOverlay, fechar);

  window.OrqDupla = { abrir, fechar, aberta, confirmar };
})();
