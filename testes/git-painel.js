'use strict';
// Painel Git (redesign R7), o backend em Node puro, sem app:
// - commit pelo app num repositorio descartavel: so os marcados entram, caminho
//   fora da lista e recusado, hook de pre-commit que recusa nao deixa residuo;
// - escrita no GitHub com `fetch` falso: criar PR, mesclar com sha velho, 403
//   sem permissao, e o token NUNCA aparece em retorno nem em erro;
// - o "Gerar" com um `claude` de mentira (ORQ_CLAUDE_BIN).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { checar, encerrar } = require('./cdp');
const worktrees = require('../src/main/worktrees');
const github = require('../src/main/github');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();

(async () => {
  // ------------------------------------------------------------ commit
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-git-painel-'));
  git(raiz, 'init', '-q', '-b', 'main');
  git(raiz, 'config', 'user.email', 'teste@exemplo.com');
  git(raiz, 'config', 'user.name', 'Teste');
  git(raiz, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'um\n');
  fs.writeFileSync(path.join(raiz, 'b.txt'), 'dois\n');
  git(raiz, 'add', '.');
  git(raiz, 'commit', '-q', '-m', 'inicio');

  fs.writeFileSync(path.join(raiz, 'a.txt'), 'um\num e meio\n');
  fs.writeFileSync(path.join(raiz, 'b.txt'), 'dois mudado\n');
  fs.writeFileSync(path.join(raiz, 'novo com espaco.txt'), 'novo\n');

  const st = await worktrees.statusArquivos(raiz);
  const porNome = Object.fromEntries((st.arquivos || []).map((a) => [a.caminho, a]));
  checar('o status lista os tres alterados', st.ok && st.arquivos.length === 3, JSON.stringify(st.arquivos));
  checar('com tipo e contagem de linhas', porNome['a.txt']?.tipo === 'M' && porNome['a.txt']?.mais === 1
    && porNome['novo com espaco.txt']?.tipo === '?', JSON.stringify(porNome));

  const fora = await worktrees.commitar(raiz, { mensagem: 'x', arquivos: ['../fora.txt'] });
  checar('caminho com .. e recusado', !fora.ok && /recusado/.test(fora.texto), fora.texto);
  const naoMudou = await worktrees.commitar(raiz, { mensagem: 'x', arquivos: ['c.txt'] });
  checar('arquivo sem alteracao e recusado', !naoMudou.ok, naoMudou.texto);
  const semMsg = await worktrees.commitar(raiz, { mensagem: '  ', arquivos: ['a.txt'] });
  checar('mensagem vazia e recusada', !semMsg.ok, semMsg.texto);

  const r = await worktrees.commitar(raiz, { mensagem: 'muda a e o novo', arquivos: ['a.txt', 'novo com espaco.txt'] });
  checar('o commit dos marcados funciona', r.ok && /^[0-9a-f]{4,}$/.test(r.sha), JSON.stringify(r));
  const noCommit = git(raiz, 'show', '--name-only', '--format=', 'HEAD').split(/\r?\n/).sort();
  checar('e leva SO os marcados', JSON.stringify(noCommit) === JSON.stringify(['a.txt', 'novo com espaco.txt']),
    JSON.stringify(noCommit));
  checar('o desmarcado continua alterado, fora do commit',
    /b\.txt/.test(git(raiz, 'status', '--porcelain')), git(raiz, 'status', '--porcelain'));

  // Hook de pre-commit que recusa: o add do arquivo novo tem de ser desfeito.
  const hooks = path.join(raiz, '.git', 'hooks');
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho "lint falhou" >&2\nexit 1\n');
  fs.chmodSync(path.join(hooks, 'pre-commit'), 0o755);
  fs.writeFileSync(path.join(raiz, 'outro.txt'), 'x\n');
  const recusado = await worktrees.commitar(raiz, { mensagem: 'nao vai', arquivos: ['outro.txt'] });
  checar('hook que recusa vira motivo legivel', !recusado.ok && /recusado/.test(recusado.texto), recusado.texto);
  checar('e nao deixa o arquivo novo no indice', /^\?\? outro\.txt$/m.test(git(raiz, 'status', '--porcelain')),
    git(raiz, 'status', '--porcelain'));
  fs.rmSync(path.join(hooks, 'pre-commit'));

  const commits = await worktrees.commitsAFrente(raiz, 'HEAD~1');
  checar('commitsAFrente lista o commit novo', commits.length === 1 && commits[0].assunto === 'muda a e o novo',
    JSON.stringify(commits));

  // Caminho com caracteres de glob: `[id].tsx` e um padrao que casa `i.tsx`.
  fs.rmSync(path.join(raiz, 'outro.txt'));
  git(raiz, 'checkout', '-q', '--', 'b.txt');
  fs.writeFileSync(path.join(raiz, '[id].tsx'), 'pagina\n');
  fs.writeFileSync(path.join(raiz, 'i.tsx'), 'outra\n');
  const glob = await worktrees.commitar(raiz, { mensagem: 'so a pagina', arquivos: ['[id].tsx'] });
  const noGlob = git(raiz, 'show', '--name-only', '--format=', 'HEAD').split(/\r?\n/);
  checar('caminho com [ ] e literal: nao leva o i.tsx desmarcado',
    glob.ok && JSON.stringify(noGlob) === '["[id].tsx"]', JSON.stringify({ glob, noGlob }));
  fs.rmSync(path.join(raiz, 'i.tsx'));

  // Rename indexado: o nome antigo tem de sair no MESMO commit.
  git(raiz, 'mv', 'a.txt', 'renomeado.txt');
  const stR = await worktrees.statusArquivos(raiz);
  const ren = stR.arquivos.find((a) => a.caminho === 'renomeado.txt');
  checar('o status traz o nome antigo do rename', ren && ren.tipo === 'R' && ren.antigo === 'a.txt', JSON.stringify(stR.arquivos));
  const rr = await worktrees.commitar(raiz, { mensagem: 'renomeia', arquivos: ['renomeado.txt'] });
  const sobrou = git(raiz, 'status', '--porcelain');
  checar('o commit do rename leva a remocao do antigo', rr.ok && sobrou === '' && !fs.existsSync(path.join(raiz, 'a.txt'))
    && git(raiz, 'ls-tree', '--name-only', 'HEAD').split(/\r?\n/).includes('renomeado.txt')
    && !git(raiz, 'ls-tree', '--name-only', 'HEAD').split(/\r?\n/).includes('a.txt'), JSON.stringify({ rr, sobrou }));

  // ------------------------------------------------------------ GitHub
  const TOKEN = 'ghp_SEGREDO_QUE_NAO_PODE_VAZAR';
  const lerCredencial = async () => TOKEN;
  const chamadas = [];
  const respostas = [];
  const buscar = async (url, op = {}) => {
    chamadas.push({ url, metodo: op.method || 'GET', corpo: op.body ? JSON.parse(op.body) : null,
      auth: op.headers?.Authorization || '' });
    const r = respostas.shift() || { status: 500, corpo: {} };
    return { status: r.status, json: async () => r.corpo, text: async () => r.texto || '' };
  };
  const semToken = (x) => !JSON.stringify(x).includes(TOKEN);

  respostas.push({ status: 201, corpo: { number: 42, html_url: 'https://github.com/o/r/pull/42' } });
  const criado = await github.criarPr({ dono: 'o', repo: 'r', head: 'feature/x', base: 'main', titulo: 'Titulo', corpo: 'C', rascunho: true },
    { buscar, lerCredencial });
  checar('criarPr devolve numero e url', criado.ok && criado.numero === 42, JSON.stringify(criado));
  checar('com POST, rascunho e o token no cabecalho',
    chamadas[0].metodo === 'POST' && chamadas[0].corpo.draft === true && chamadas[0].auth === `Bearer ${TOKEN}`,
    JSON.stringify({ ...chamadas[0], auth: '(oculto)' }));

  respostas.push({ status: 403, corpo: { message: `Resource not accessible ${TOKEN}`.replace(TOKEN, 'x') } });
  const proibido = await github.criarPr({ dono: 'o', repo: 'r', head: 'h', base: 'main', titulo: 'T' }, { buscar, lerCredencial });
  checar('403 vira acesso:false (a tela cai para o navegador)', !proibido.ok && proibido.acesso === false, JSON.stringify(proibido));

  const semCred = await github.criarPr({ dono: 'o', repo: 'r', head: 'h', base: 'main', titulo: 'T' },
    { buscar, lerCredencial: async () => '' });
  checar('sem credencial nem tenta escrever', !semCred.ok && semCred.acesso === false, JSON.stringify(semCred));

  respostas.push({ status: 409, corpo: { message: 'Head branch was modified' } });
  const velho = await github.mesclar({ dono: 'o', repo: 'r', numero: 42, metodo: 'squash', sha: 'abc' }, { buscar, lerCredencial });
  checar('mesclar com sha velho e recusado com motivo', !velho.ok && /mudou/.test(velho.texto), JSON.stringify(velho));
  const ultima = chamadas[chamadas.length - 1];
  checar('o merge manda o sha da tela', ultima.metodo === 'PUT' && ultima.corpo.sha === 'abc'
    && ultima.corpo.merge_method === 'squash', JSON.stringify({ ...ultima, auth: '' }));

  respostas.push({ status: 200, corpo: { merged: true, sha: 'def' } });
  const mesclou = await github.mesclar({ dono: 'o', repo: 'r', numero: 42, metodo: 'merge', sha: 'abc' }, { buscar, lerCredencial });
  checar('merge aceito', mesclou.ok && mesclou.sha === 'def', JSON.stringify(mesclou));
  const metodoRuim = await github.mesclar({ dono: 'o', repo: 'r', numero: 42, metodo: 'force', sha: 'abc' }, { buscar, lerCredencial });
  checar('metodo de merge desconhecido e recusado', !metodoRuim.ok, metodoRuim.texto);

  respostas.push({ status: 200, corpo: { number: 42, title: 'T', state: 'open', mergeable: true, mergeable_state: 'clean',
    html_url: 'https://github.com/o/r/pull/42', base: { ref: 'main' }, head: { ref: 'feature/x', sha: 'abc' } } });
  respostas.push({ status: 200, corpo: [
    { user: { login: 'a' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'a' }, state: 'APPROVED' },
    { user: { login: 'b' }, state: 'COMMENTED' }] });
  respostas.push({ status: 200, corpo: { check_runs: [
    { id: 1, name: 'build', status: 'completed', conclusion: 'success', started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:01:30Z' },
    { id: 2, name: 'lint', status: 'completed', conclusion: 'failure' },
    { id: 3, name: 'deploy', status: 'in_progress' }] } });
  const det = await github.detalhesPr({ dono: 'o', repo: 'r', numero: 42 }, { buscar, lerCredencial });
  checar('detalhes trazem checks por nome com situacao',
    det.ok && det.checks.map((c) => `${c.nome}:${c.situacao}`).join() === 'build:ok,lint:falhou,deploy:pendente',
    JSON.stringify(det.checks));
  checar('a duracao do check sai em segundos', det.checks[0].segundos === 90, String(det.checks[0].segundos));
  checar('vale a ULTIMA revisao de cada pessoa', det.aprovacoes === 1 && det.mudancasPedidas === 0,
    JSON.stringify({ a: det.aprovacoes, m: det.mudancasPedidas }));

  respostas.push({ status: 200, texto: '2026-01-01T00:00:00.0000000Z linha 1\n2026-01-01T00:00:01.0000000Z erro: x falhou\n' });
  const log = await github.logDoCheck({ dono: 'o', repo: 'r', id: 2 }, { buscar, lerCredencial });
  checar('o log do check vem sem o carimbo de hora', log.ok && log.linhas.join('|') === 'linha 1|erro: x falhou',
    JSON.stringify(log));

  checar('o token nao aparece em nenhum retorno',
    [criado, proibido, semCred, velho, mesclou, metodoRuim, det, log].every(semToken), '');

  // ------------------------------------------------------------ gerar
  const falso = path.join(raiz, 'claude-falso.js');
  fs.writeFileSync(falso, `#!/usr/bin/env node
// O prompt chega pela entrada padrao, como no claude de verdade.
const p = require('fs').readFileSync(0, 'utf8');
if (!process.argv.includes('-p')) { console.error('sem -p'); process.exit(2); }
if (/pull request/.test(p)) console.log('TITULO: Ajusta a e cria novo\\nDESCRICAO:\\n- muda a\\n- cria novo');
else console.log('Ajusta o arquivo a\\n\\nPorque sim.');
`);
  process.env.ORQ_CLAUDE_SCRIPT = falso;
  const gerar = require('../src/main/gerar-texto');
  const vazio = await gerar.gerar(raiz, 'commit', { stat: '', diff: '' });
  checar('sem diff nao chama o Claude', !vazio.ok, vazio.texto);
  const msg = await gerar.gerar(raiz, 'commit', { stat: 'a.txt | 1 +', diff: '+um e meio' });
  checar('gerar a mensagem de commit', msg.ok && /^Ajusta o arquivo a/.test(msg.texto), JSON.stringify(msg));
  const pr = await gerar.gerar(raiz, 'pr', { stat: 'a.txt | 1 +', diff: '+x', issue: 'TECH-1' });
  checar('gerar titulo e descricao do PR separados', pr.ok && pr.titulo === 'Ajusta a e cria novo'
    && /muda a/.test(pr.corpo), JSON.stringify(pr));
  checar('o prompt do PR leva a issue', /Issue: TECH-1/.test(gerar.montarPrompt('pr', { stat: 's', diff: 'd', issue: 'TECH-1' })), '');

  fs.rmSync(raiz, { recursive: true, force: true });
  encerrar('GIT_PAINEL');
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
