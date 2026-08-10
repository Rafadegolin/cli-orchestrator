'use strict';
// Fases 4 e 5: hook -> servidor -> diff -> bolinha, e a barra lateral ordenada
// por urgencia com cronometro e Ctrl+Enter.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
const hooks = require(path.join(RAIZ, 'src', 'main', 'instalar-hooks'));
const RAIZ_URL = RAIZ.replace(/\\/g, '/');

// O Claude Code executa hooks num shell POSIX. Achar o `sh` explicitamente
// importa: rodando o teste a partir do PowerShell ele nao esta no PATH, e
// spawnSync devolve status null -- o teste falharia inteiro culpando o app.
function acharSh() {
  const candidatos = [
    'C:/Program Files/Git/usr/bin/sh.exe',
    'C:/Program Files/Git/bin/sh.exe',
    'C:/Program Files (x86)/Git/usr/bin/sh.exe',
  ];
  for (const c of candidatos) if (fs.existsSync(c)) return c;
  const r = spawnSync('where', ['sh'], { encoding: 'utf8' });
  const achado = (r.stdout || '').split(/\r?\n/).find((l) => l.trim().endsWith('.exe'));
  if (achado) return achado.trim();
  throw new Error('nao achei um shell POSIX (sh.exe). Instale o Git for Windows.');
}
const SH = acharSh();

// Dispara o hook exatamente como o Claude Code faz: shell POSIX, JSON no stdin
// por redirecionamento de arquivo (com stdin em pipe o curl espera o EOF e a
// medida de tempo mente).
function dispararHook(evento, tipo, { orqId = '', cwd = '' } = {}) {
  const cmd = hooks.comando(evento, tipo);
  const arq = path.join(__dirname, '.corpo-hook.json');
  fs.writeFileSync(arq, JSON.stringify({ hook_event_name: evento, cwd, session_id: 'sess-teste' }), 'utf8');
  const t0 = Date.now();
  const r = spawnSync(SH, ['-c', `${cmd} < "${arq.replace(/\\/g, '/')}"`], {
    env: { ...process.env, ORQ_ID: orqId }, encoding: 'utf8', timeout: 10000,
  });
  fs.rmSync(arq, { force: true });
  if (r.status === null) throw new Error(`o shell nao rodou (${SH}): ${r.error?.message || 'status null'}`);
  return { code: r.status, ms: Date.now() - t0 };
}

(async () => {
  const cdp = await conectar();
  await zerarGrade(cdp);

  checar('lateral carregou', await cdp.avaliar(`typeof window.OrqLateral?.ordenadas`) === 'function');

  const ids = [];
  for (const f of ['alpha', 'beta', 'gama']) {
    ids.push(await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ_URL)}, feature: '${f}' }); return p.id; })()`));
    await esperar(400);
  }
  await esperar(1500);
  checar('3 painéis registrados na lateral', await cdp.avaliar(`window.OrqLateral.cards.size`) === 3);

  // Pedido de permissao -> amarelo. Esta e a meta de 300ms da secao 2.
  const t0 = Date.now();
  const h1 = dispararHook('Notification', 'permissao', { orqId: ids[1] });
  let ms = -1;
  for (let i = 0; i < 60; i++) {
    if (await cdp.avaliar(`window.OrqLateral.cards.get(${JSON.stringify(ids[1])})?.status`) === 'esperando') {
      ms = Date.now() - t0; break;
    }
    await esperar(25);
  }
  checar('latencia do pedido ate a bolinha abaixo de 300ms', ms > 0 && ms < 300, `${ms}ms`);
  checar('o hook em si custou pouco', h1.ms < 300, `${h1.ms}ms, exit=${h1.code}`);
  checar('a bolinha do PAINEL tambem mudou',
    (await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(ids[1])}).elBolinha.className`)).includes('bolinha-esperando'));

  await esperar(1100);
  dispararHook('Stop', '', { orqId: ids[2] });
  await esperar(600);
  const ordem = JSON.parse(await cdp.avaliar(`JSON.stringify(window.OrqLateral.ordenadas().map(c => c.feature + ':' + c.status))`));
  checar('esperando vem primeiro, terminou em segundo',
    ordem[0].endsWith(':esperando') && ordem[1].endsWith(':terminou'), JSON.stringify(ordem));

  dispararHook('Notification', 'permissao', { orqId: ids[0] });
  await esperar(600);
  const ordem2 = JSON.parse(await cdp.avaliar(`JSON.stringify(window.OrqLateral.ordenadas().map(c => c.feature))`));
  checar('entre dois esperando, o mais antigo vem primeiro', ordem2[0] === 'beta', JSON.stringify(ordem2));

  await esperar(2200);
  const texto = await cdp.avaliar(`document.querySelector('.card-atencao .card-sub')?.textContent`);
  checar('card amarelo mostra ha quanto tempo espera', /ha \d+s/.test(texto || ''), texto);

  checar('Ctrl+Enter foca quem espera ha mais tempo',
    await cdp.avaliar(`window.OrqLateral.pularParaMaisAntigo()`) === ids[1]);
  checar('o painel certo ficou com o foco visual',
    await cdp.avaliar(`document.querySelector('.painel-focado')?.dataset.id`) === ids[1]);

  dispararHook('UserPromptSubmit', '', { orqId: ids[1] });
  await esperar(600);
  checar('UserPromptSubmit volta para verde',
    await cdp.avaliar(`window.OrqLateral.cards.get(${JSON.stringify(ids[1])}).status`) === 'rodando');

  // Sem ORQ_ID, resolve pelo cwd descendente -- o caso do worktree, que o
  // `claude -w` cria em .claude/worktrees/<nome> DENTRO do projeto.
  dispararHook('Notification', 'permissao', { orqId: '', cwd: `${RAIZ_URL}/.claude/worktrees/qualquer` });
  await esperar(700);
  const algum = JSON.parse(await cdp.avaliar(`JSON.stringify([...window.OrqLateral.cards.values()].map(c => c.status))`));
  checar('sem ORQ_ID, o cwd descendente achou um painel',
    algum.filter((s) => s === 'esperando').length >= 1, JSON.stringify(algum));

  encerrar('FASE45');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
