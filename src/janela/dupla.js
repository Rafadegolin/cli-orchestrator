'use strict';
// Implementacao dupla: uma feature que atravessa dois repositorios.
//
// O caso real: backend num repo e frontend noutro, mesma feature. Sem isto era
// preciso SAIR do orquestrador -- abrir os dois repos a mao, entrar nas branches
// e rodar um `claude` de terminal comum que enxergasse os dois.
//
// O desenho cabe numa linha: o app cria UMA worktree em cada repositorio, abre UM
// painel na do repositorio escolhido, e passa a outra em `ligacoes` -- de onde o
// `--add-dir` sai sozinho, porque `criarPainel` ja chama `OrqLigacoes.comAddDir`. Sessao
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
//  3. Cada repositorio tem o SEU nome de branch, porque cada um tem a sua issue.
//     Os dois campos sao independentes de proposito -- espelhar o primeiro no
//     segundo economizaria uma digitacao no caso facil e escondria o caso que
//     motivou a feature.
//
// A sessao se chama como o branch do ANFITRIAO: e onde ela vive, e e o que mantem
// a correlacao do `registro.js`, que casa o `--name` do CLI com o `feature` do
// painel. Um nome combinado ("a + b") nao seria branch de ninguem.
//
// Nao ha campo novo no painel: a ligacao entra em `p.ligacoes`, que o
// `retratoSessao()` ja grava e o `despertar()` ja reaplica. Uma dupla restaurada
// volta ligada sozinha.

(() => {
  const elOverlay = document.getElementById('dupla');
  const elA = document.getElementById('dupla-a');
  const elB = document.getElementById('dupla-b');
  const elNomeA = document.getElementById('dupla-nome-a');
  const elNomeB = document.getElementById('dupla-nome-b');
  const elDicaA = document.getElementById('dupla-dica-a');
  const elDicaB = document.getElementById('dupla-dica-b');
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

  function slugDe(el) {
    return window.OrqProjetos.slugFeature(el.value || '');
  }

  // Um lado inteiro: o repositorio escolhido mais o nome de branch dele.
  // E esta a forma que o main recebe -- `{ caminho, slug }` --, e nao quatro
  // strings soltas onde trocar duas de lugar nao daria erro nenhum.
  function lado(sel, elNome) {
    const p = escolhido(sel);
    return p ? { projeto: p, caminho: p.caminho, slug: slugDe(elNome) } : null;
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

  // O nome REAL do branch, antes de confirmar, e ao lado do campo que o produz.
  // Mesma regra do campo de sessao do topo, e ela veio de um defeito: a tela
  // prometia `feat/auth-refresh` e o git recebia `worktree-auth-refresh`.
  //
  // Uma dica por campo, e nao uma frase so: com nomes diferentes, uma linha
  // unica nao diria qual branch e de qual repositorio.
  function atualizarDica() {
    for (const [elNome, elDica] of [[elNomeA, elDicaA], [elNomeB, elDicaB]]) {
      const s = slugDe(elNome);
      elDica.textContent = s ? `branch worktree-${s}` : 'sem nome, sem worktree';
    }
  }

  // Diz o que vai acontecer com CADA repositorio antes de escrever qualquer
  // coisa: criar, ou reaproveitar o que ja esta la.
  async function atualizarPrevia() {
    const a = lado(elA, elNomeA);
    const b = lado(elB, elNomeB);
    const meu = ++previaEmCurso;
    elPrevia.replaceChildren();
    if (!a || !b || !a.slug || !b.slug) return;

    const r = await window.orq.worktreesPreverDupla(
      { caminho: a.caminho, slug: a.slug }, { caminho: b.caminho, slug: b.slug });
    // Outra chamada comecou enquanto esta esperava: quem escreve e ela.
    if (meu !== previaEmCurso) return;

    elPrevia.replaceChildren();
    for (const [alvo, p] of [[a, r.a], [b, r.b]]) {
      const linha = document.createElement('div');
      linha.className = 'dupla-previa-linha';
      const nome = document.createElement('span');
      // Com nomes diferentes, dizer so o projeto deixaria a previa ambigua.
      nome.textContent = `${alvo.projeto.nome} · worktree-${alvo.slug}`;
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
    elNomeA.focus();
  }

  function fechar() {
    elOverlay.hidden = true;
  }

  function aberta() {
    return elOverlay.hidden === false;
  }

  // ------------------------------------------------------------ confirmar

  async function confirmar() {
    const a = lado(elA, elNomeA);
    const b = lado(elB, elNomeB);

    if (!a || !b) return mostrarErro('escolha os dois repositórios');
    if (a.projeto.id === b.projeto.id) return mostrarErro('escolha dois repositórios diferentes');
    // Diz QUAL falta: com dois campos, "dê um nome" nao aponta para lugar nenhum.
    if (!a.slug) return mostrarErro(`dê um nome ao branch de ${a.projeto.nome}`);
    if (!b.slug) return mostrarErro(`dê um nome ao branch de ${b.projeto.nome}`);

    btnConfirmar.disabled = true;
    const antes = btnConfirmar.textContent;
    btnConfirmar.textContent = 'criando…';
    try {
      const r = await window.orq.worktreesCriarDupla(
        { caminho: a.caminho, slug: a.slug }, { caminho: b.caminho, slug: b.slug });
      if (!r.ok) {
        const qual = r.onde === 'a' ? a.projeto.nome : b.projeto.nome;
        return mostrarErro(`${qual}: ${r.texto}`);
      }

      const anfitriao = onde === 'a' ? r.a : r.b;
      const outro = onde === 'a' ? r.b : r.a;
      const ladoAnfitriao = onde === 'a' ? a : b;

      fechar();
      await window.OrqGrade.criarPainel({
        // A worktree, e nao a raiz: e o que mantem `p.cwd` verdadeiro.
        cwd: anfitriao.caminho,
        // O nome do ANFITRIAO. Ele vai para o cabecalho, a lateral, o historico
        // e o `--name` do CLI, que e por onde o `registro.js` casa a sessao com
        // este painel -- um nome que nao fosse branch de ninguem quebraria isso.
        feature: ladoAnfitriao.slug,
        // Sem `-w`: a worktree ja existe, e ele criaria outra dentro dela.
        comandoInicial: window.OrqProjetos.montarComando(ladoAnfitriao.slug, true, { worktree: false }),
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
  for (const el of [elNomeA, elNomeB]) {
    el?.addEventListener('input', atualizar);
    el?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') confirmar();
    });
  }

  // Esc pelo topo da pilha, clique no fundo e z-index por ordem de abertura.
  window.OrqOverlays?.registrar(elOverlay, fechar);

  window.OrqDupla = { abrir, fechar, aberta, confirmar };
})();
