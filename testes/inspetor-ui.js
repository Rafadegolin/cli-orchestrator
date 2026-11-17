'use strict';
// O painel Git (redesign R7) pela tela, sem GitHub e sem Claude:
// - nasce FECHADO; Ctrl+Shift+G abre, e a tecla nao vaza para o terminal;
// - mostra os arquivos alterados da sessao focada, todos marcados;
// - commit so com os marcados, pela propria tela, num repositorio descartavel;
// - a aba Git lista o commit novo; a aba PR diz que nao ha GitHub;
// - o chip de branch do cabecalho abre o painel na sessao dele.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();

async function ate(fn, cond, ms = 10000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    ultimo = await fn();
    if (cond(ultimo)) return ultimo;
    await esperar(200);
  }
  return ultimo;
}

(async () => {
  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqInspetor.alternar(false)`);

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-inspetor-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'teste@exemplo.com');
  git(repo, 'config', 'user.name', 'Teste');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'inicio');
  // Uma worktree de verdade: a base (main) fica no checkout principal.
  const wt = path.join(repo, 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/inspetor', wt);
  fs.writeFileSync(path.join(wt, 'a.txt'), 'um\ndois\n');
  fs.writeFileSync(path.join(wt, 'b.txt'), 'novo\n');

  checar('o painel Git nasce fechado',
    await cdp.avaliar(`document.getElementById('inspetor').hidden && !window.OrqInspetor.aberto()`) === true, '');

  const id = await cdp.avaliar(`(async () => (await window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(wt)}, feature: 'inspetor' })).id)()`);
  const P = `window.OrqPainel.painelPorId.get(${JSON.stringify(id)})`;
  await ate(() => cdp.avaliar(`${P}.textoDoBuffer().length`), (n) => n > 20, 8000);
  await cdp.avaliar(`${P}.focar()`);
  await esperar(400);
  // Conta o que sai do teclado para o PTY: abrir o painel Git estreita o
  // terminal (o texto reflui), entao comparar o buffer daria falso alarme.
  await cdp.avaliar(`(() => { window.__enviados = []; ${P}.term.onData((d) => window.__enviados.push(d)); return 'ok'; })()`);

  // Ctrl+G nao pode chegar ao PTY: e captura com stopPropagation.
  await cdp.avaliar(`${P}.term.textarea.dispatchEvent(new KeyboardEvent('keydown',
    { key: 'G', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`);
  const aberto = await ate(() => cdp.avaliar(`document.querySelectorAll('#insp-arquivos .insp-arquivo').length`), (n) => n === 2, 8000);
  checar('Ctrl+Shift+G abre e lista os dois arquivos alterados', aberto === 2, String(aberto));
  await esperar(300);
  // ESC[I / ESC[O sao o aviso de foco do ConPTY (modo 1004), nao a tecla.
  const enviados = JSON.parse(await cdp.avaliar(
    `JSON.stringify(window.__enviados.filter((d) => d !== '\\x1b[I' && d !== '\\x1b[O'))`));
  checar('e a tecla nao vazou para o terminal', enviados.length === 0, JSON.stringify(enviados));
  checar('a escolha vai para o ui.json',
    await cdp.avaliar(`window.orq.uiCarregar().then(u => u.inspetor)`) === 'aberto', '');

  const marcados = await cdp.avaliar(`[...document.querySelectorAll('#insp-arquivos input')].filter(c => c.checked).length`);
  checar('todos entram marcados', marcados === 2, String(marcados));

  // Desmarca o b.txt, escreve a mensagem e commita pela tela.
  await cdp.avaliar(`(() => {
    const linha = [...document.querySelectorAll('#insp-arquivos .insp-arquivo')].find(l => l.textContent.includes('b.txt'));
    const c = linha.querySelector('input'); c.checked = false; c.dispatchEvent(new Event('change'));
    const m = document.getElementById('insp-mensagem'); m.value = 'Muda a pelo painel'; m.dispatchEvent(new Event('input'));
    return 'ok';
  })()`);
  await esperar(200);
  const rotulo = await cdp.avaliar(`document.getElementById('insp-commit').textContent`);
  checar('o botao conta os marcados', rotulo === 'Commit de 1 arquivo', rotulo);
  await cdp.avaliar(`document.getElementById('insp-commit').click()`);
  await ate(() => cdp.avaliar(`document.querySelectorAll('#insp-arquivos .insp-arquivo').length`), (n) => n === 1, 8000);
  const noCommit = git(wt, 'show', '--name-only', '--format=%s', 'HEAD').split(/\r?\n/).filter(Boolean);
  checar('o commit levou so o marcado, com a mensagem', noCommit[0] === 'Muda a pelo painel' && noCommit[1] === 'a.txt'
    && noCommit.length === 2, JSON.stringify(noCommit));
  checar('e o desmarcado continua na lista', await cdp.avaliar(
    `document.querySelector('#insp-arquivos .insp-arquivo').textContent.includes('b.txt')`) === true, '');

  // Aba Git: o commit novo aparece; aba PR: sem GitHub.
  await cdp.avaliar(`document.querySelector('.insp-aba[data-aba="git"]').click()`);
  await esperar(400);
  const abaGit = await cdp.avaliar(`document.querySelector('#inspetor .insp-corpo').textContent`);
  checar('a aba Git lista o commit novo', /Muda a pelo painel/.test(abaGit), abaGit.slice(0, 200));
  checar('e diz que o remoto nao e do GitHub', /não é do GitHub/.test(abaGit), '');
  await cdp.avaliar(`document.querySelector('.insp-aba[data-aba="pr"]').click()`);
  const abaPr = await ate(() => cdp.avaliar(`document.querySelector('#inspetor .insp-corpo').textContent`),
    (t) => /Sem GitHub/.test(t), 6000);
  checar('a aba PR diz que nao ha GitHub', /Sem GitHub/.test(abaPr), abaPr.slice(0, 120));

  // Fechar pelo botao e reabrir pelo chip do cabecalho.
  await cdp.avaliar(`window.OrqInspetor.alternar(false)`);
  await esperar(300);
  await cdp.avaliar(`window.OrqInspetor.abrirPara(${JSON.stringify(id)}, 'alteracoes')`);
  await esperar(500);
  checar('abrirPara (o chip de branch) abre na sessao certa',
    await cdp.avaliar(`window.OrqInspetor.aberto() && window.OrqInspetor.alvo() === ${JSON.stringify(id)}`) === true, '');

  await cdp.avaliar(`window.OrqInspetor.alternar(false)`);
  await zerarGrade(cdp);
  fs.rmSync(repo, { recursive: true, force: true });
  encerrar('INSPETOR_UI');
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
