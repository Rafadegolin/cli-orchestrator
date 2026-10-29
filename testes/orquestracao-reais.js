'use strict';

// A orquestracao (Fase 10.6) com Claude DE VERDADE: uma coordenadora divide a
// tarefa em dois workers pela skill, os dois partem SOZINHOS pelo Enter
// automatico, terminam, e ela le o diff e mescla os dois branches no dela.
//
// CONSOME TOKENS (tres sessoes curtas) e leva alguns minutos. Precisa do
// `npm run dev` no ar e dos hooks instalados -- sem eles nenhum worker chega a
// `terminou` e a coordenadora espera para sempre.
//
// Nada vai para o ~/.claude de ninguem: a skill e as permissoes sao de escopo de
// PROJETO, commitadas no repositorio descartavel (e por isso vao junto para as
// worktrees dos workers). O interruptor e ligado pelo `ui.json`, como no
// `teste:orquestracao-ui`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');
const skill = require('../src/main/skill-orquestrador');
const claudeDados = require('../src/main/claude-dados');

const TMP = path.join(os.tmpdir(), 'orq-teste-orq-reais');
const REPO = path.join(TMP, 'repo');
const MS_TETO = 8 * 60_000;
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function pedir(caminho, id) {
  return new Promise((ok) => {
    const req = http.request({ host: '127.0.0.1', port: 47615, path: caminho, headers: { 'x-orq-id': id } }, (res) => {
      let c = '';
      res.on('data', (d) => { c += d; });
      res.on('end', () => { try { ok(JSON.parse(c)); } catch { ok({}); } });
    });
    req.on('error', () => ok({}));
    req.end();
  });
}

const PROMPT = [
  'Use a skill orquestrador para criar exatamente dois workers:',
  '- um chamado alfa, que cria o arquivo alfa.txt contendo a linha ALFA-OK e faz commit;',
  '- outro chamado beta, que cria o arquivo beta.txt contendo a linha BETA-OK e faz commit.',
  'Espere os dois terminarem, confira o diff de cada um, mescle os dois branches no seu com git merge',
  'e, no fim, responda apenas FIM-ORQ.',
].join('\n');

(async () => {
  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  const hooks = JSON.parse(await cdp.avaliar('window.orq.hooksSituacao().then((s) => JSON.stringify(s))'));
  if (!hooks.instalado) {
    console.log('Os hooks nao estao instalados: sem eles nenhum worker chega a terminou. Instale e rode de novo.');
    process.exit(2);
  }

  // ------------------------------------------------------------ o repositorio

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* sobra de corrida anterior */ }
  fs.mkdirSync(path.join(REPO, '.claude', 'skills', 'orquestrador'), { recursive: true });
  git(REPO, ['init', '-q', '-b', 'main']);
  git(REPO, ['config', 'user.email', 't@t']);
  git(REPO, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(REPO, 'README.md'), '# repositorio descartavel do teste de orquestracao\n');
  fs.writeFileSync(path.join(REPO, '.claude', 'skills', 'orquestrador', 'SKILL.md'), skill.texto());
  fs.writeFileSync(path.join(REPO, '.claude', 'settings.json'), JSON.stringify({
    permissions: { allow: ['Read', 'Write', 'Edit', 'Bash(curl:*)', 'Bash(git:*)', 'Skill'] },
  }, null, 2));
  // As worktrees dos workers moram em `.claude/worktrees`, e nao podem entrar
  // no commit de ninguem.
  fs.writeFileSync(path.join(REPO, '.gitignore'), '.claude/worktrees/\n');
  git(REPO, ['add', '-A']);
  git(REPO, ['commit', '-q', '-m', 'base']);

  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.orq.projetosAdicionar(${JSON.stringify(REPO)});
    await window.OrqProjetos.carregarProjetos();
  })()`);

  const constantes = JSON.parse(await cdp.avaliar('window.orq.constantes().then((c) => JSON.stringify(c))'));
  const arqUi = path.join(constantes.pastaDados, 'ui.json');
  const uiAntes = fs.existsSync(arqUi) ? fs.readFileSync(arqUi, 'utf8') : null;
  const atual = uiAntes ? JSON.parse(uiAntes) : { versao: 1, ui: {} };
  atual.ui = { ...(atual.ui || {}), orquestracao: 'ligada' };
  fs.writeFileSync(arqUi, `${JSON.stringify(atual, null, 2)}\n`);

  // ------------------------------------------------------------ a coordenadora

  // O pedido vai pelo mesmo prefill dos workers, e o Enter dela e o teste quem
  // manda -- o automatico do app e so para worker.
  const coord = await cdp.avaliar(`(async () => {
    const cmd = window.OrqProjetos.montarComando('coord-real', true, { worktree: false });
    const p = await window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(REPO)}, feature: 'coord-real', comandoInicial: cmd, promptInicial: ${JSON.stringify(PROMPT)} });
    return p.id;
  })()`);

  const tela = () => cdp.avaliar(`(() => { const p = window.OrqPainel.painelPorId.get(${JSON.stringify(coord)}); return p ? window.OrqPainel.achatar(p.textoDaTela({ flush: true })) : ''; })()`);
  const t0 = Date.now();
  let enviou = false;
  let confiou = false;
  while (!enviou && Date.now() - t0 < 90_000) {
    const t = await tela();
    // A pasta descartavel nunca foi confiada: o dialogo aparece, e o padrao dele
    // e "No, exit". So AQUI, no repositorio do teste, ele e aceito.
    if (!confiou && /Yes, I trust this folder/.test(t)) {
      confiou = true;
      await esperar(1500);
      await cdp.avaliar(`window.orq.escrever(${JSON.stringify(coord)}, '\\x1b[B')`);
      await esperar(500);
      await cdp.avaliar(`window.orq.escrever(${JSON.stringify(coord)}, '\\r')`);
      await esperar(2000);
      continue;
    }
    // Pronta = o registro do CLI diz `idle` com o nosso name: o mesmo sinal que o
    // app usa para o Enter dos workers (medido no spike D).
    const s = claudeDados.sessoes().find((x) => x.nome === 'coord-real');
    if (s && s.status === 'idle') {
      await esperar(1500);
      await cdp.avaliar(`window.orq.escrever(${JSON.stringify(coord)}, '\\r')`);
      enviou = true;
    }
    await esperar(1000);
  }
  checar('a coordenadora recebeu o pedido', enviou, (await tela()).slice(-300));

  // ------------------------------------------------------------ os workers

  let workers = [];
  let fim = false;
  while (Date.now() - t0 < MS_TETO) {
    const r = await pedir('/orq/status', coord);
    workers = r.workers || workers;
    const t = await tela();
    if (/FIM-ORQ/.test(t.replace(/responda apenas FIM-ORQ/gi, '')) && fs.existsSync(path.join(REPO, 'alfa.txt'))) { fim = true; break; }
    await esperar(5000);
  }
  console.log(JSON.stringify(workers, null, 1));
  checar('a coordenadora criou os dois workers', workers.length === 2, String(workers.length));
  checar('os dois partiram SOZINHOS pelo Enter automatico', workers.length === 2 && workers.every((w) => w.partida === 'enviada'),
    workers.map((w) => w.partida).join(','));
  checar('os dois terminaram', workers.length === 2 && workers.every((w) => ['terminou', 'parada'].includes(w.status)),
    workers.map((w) => w.status).join(','));
  checar('a coordenadora chegou ao fim', fim, (await tela()).slice(-400));
  const ler = (f) => { try { return fs.readFileSync(path.join(REPO, f), 'utf8').trim(); } catch { return null; } };
  checar('o trabalho do alfa foi mesclado na coordenadora', ler('alfa.txt') === 'ALFA-OK', String(ler('alfa.txt')));
  checar('o do beta tambem', ler('beta.txt') === 'BETA-OK', String(ler('beta.txt')));
  const paineis = JSON.parse(await cdp.avaliar(`JSON.stringify([...window.OrqPainel.painelPorId.values()].map((p) => ({ f: p.feature, pai: p.pai })))`));
  checar('os workers aparecem na grade com a coordenadora como pai',
    paineis.filter((p) => p.pai === coord).length === 2, JSON.stringify(paineis));

  // ------------------------------------------------------------ faxina

  await cdp.avaliar(`(async () => {
    for (const p of [...window.OrqPainel.painelPorId.values()]) p.destruir();
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos();
  })()`);
  await esperar(2500);
  if (uiAntes === null) fs.rmSync(arqUi, { force: true });
  else fs.writeFileSync(arqUi, uiAntes);
  for (const w of ['alfa', 'beta']) {
    try { git(REPO, ['worktree', 'remove', '--force', path.join(REPO, '.claude', 'worktrees', w)]); } catch { /* segue */ }
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* pasta presa no Windows */ }

  encerrar('ORQUESTRACAO_REAIS');
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
