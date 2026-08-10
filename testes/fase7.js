'use strict';
// Fase 7: fechar o app e voltar ao mesmo lugar.
//
// O teste que mais importa e o 3: painel restaurado NAO pode subir PTY. E por
// isso ele conta processos de shell no sistema, em vez de so olhar a tela.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
const RAIZ_URL = RAIZ.replace(/\\/g, '/');
const ARQ = path.join(RAIZ, '.dev-udata', 'dados', 'sessao.json');

function lerSessao() {
  try {
    return JSON.parse(fs.readFileSync(ARQ, 'utf8')).paineis || [];
  } catch {
    return [];
  }
}

function contaCmd() {
  return Number(execSync(
    'powershell -NoProfile -Command "(Get-Process cmd -ErrorAction SilentlyContinue | Measure-Object).Count"',
    { encoding: 'utf8' }
  ).trim()) || 0;
}

async function ateQue(cdp, expressao, ms = 8000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await cdp.avaliar(expressao)) return true;
    await esperar(200);
  }
  return false;
}

(async () => {
  const cdp = await conectar();
  await zerarGrade(cdp);
  await esperar(900);

  // --- 1. o arranjo e gravado --------------------------------------------
  for (const f of ['alfa', 'beta', 'gama']) {
    await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ_URL)}, feature: '${f}', comandoInicial: 'echo VOLTEI_${f}' }); return 'ok'; })()`);
    await esperar(500);
  }
  await esperar(1200);

  const salvos = lerSessao();
  checar('os tres painéis foram gravados no JSON', salvos.length === 3,
    salvos.map((p) => p.feature).join(','));
  checar('com feature, cwd e comandoInicial',
    salvos[0].feature === 'alfa'
    && salvos[0].cwd.replace(/\\/g, '/').toLowerCase() === RAIZ_URL.toLowerCase()
    && salvos[0].comandoInicial === 'echo VOLTEI_alfa', JSON.stringify(salvos[0]));
  checar('e na ordem em que estao na grade',
    salvos.map((p) => p.ordem).join(',') === '0,1,2', salvos.map((p) => p.ordem).join(','));

  // --- 2. fechar um painel tira do JSON ----------------------------------
  await cdp.avaliar(`(() => { const ps = [...window.OrqGrade.painelPorId.values()];
    ps.find(p => p.feature === 'beta').destruir(); return 'ok'; })()`);
  await esperar(1500);
  const apos = lerSessao();
  checar('painel fechado sai do JSON',
    apos.length === 2 && !apos.some((p) => p.feature === 'beta'),
    apos.map((p) => p.feature).join(','));

  // --- 3. restaurar NAO pode subir PTY -----------------------------------
  await zerarGrade(cdp);
  await esperar(1500);

  const retrato = [
    { feature: 'restaurado-1', cwd: RAIZ_URL, comandoInicial: 'echo ACORDEI_1', ordem: 0 },
    { feature: 'restaurado-2', cwd: RAIZ_URL, comandoInicial: 'echo ACORDEI_2', ordem: 1 },
    { feature: 'sumiu', cwd: 'C:/pasta/que/nao/existe', comandoInicial: 'echo NUNCA', ordem: 2 },
  ];
  await cdp.avaliar(`window.orq.sessaoSalvar(${JSON.stringify(retrato)})`);
  await esperar(600);

  const cmdAntes = contaCmd();
  await cdp.avaliar(`(async () => { await window.OrqGrade.restaurarSessao(); return 'ok'; })()`);
  await esperar(2500);
  const cmdDepois = contaCmd();

  checar('restaurar NAO sobe nenhum shell', cmdDepois <= cmdAntes, `${cmdAntes} -> ${cmdDepois}`);

  const estado = JSON.parse(await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()];
    return JSON.stringify({
      n: ps.length,
      ordem: ps.map(p => p.feature),
      dormindo: ps.filter(p => p.dormindo).length,
      comBotao: [...document.querySelectorAll('.dormindo-retomar')].length,
      comRemover: [...document.querySelectorAll('.dormindo-remover')].length,
    });
  })()`));
  checar('os tres painéis voltaram, na ordem salva',
    estado.n === 3 && estado.ordem.join(',') === 'restaurado-1,restaurado-2,sumiu',
    JSON.stringify(estado.ordem));
  checar('todos voltaram dormindo', estado.dormindo === 3, String(estado.dormindo));
  checar('os validos mostram o botao de retomar', estado.comBotao === 2, String(estado.comBotao));
  checar('e o de pasta sumida oferece remover, nao retomar',
    estado.comRemover === 1, String(estado.comRemover));

  // --- 4. painel dormindo nao segura WebGL -------------------------------
  const webgl = await cdp.avaliar(
    `[...window.OrqGrade.painelPorId.values()].filter(p => p.dormindo && p.tipoRender === 'webgl').length`);
  checar('painel dormindo nao segura vaga de WebGL', webgl === 0, String(webgl));

  // --- 5. despertar sobe o PTY e roda o comando salvo ---------------------
  const alvo = await cdp.avaliar(`(() => {
    const p = [...window.OrqGrade.painelPorId.values()].find(x => x.feature === 'restaurado-1');
    return p ? p.id : '';
  })()`);
  // Envolve para devolver primitivo: despertar resolve com o objeto Painel, e o
  // serializador do CDP estoura tentando percorrer DOM e Terminal.
  await cdp.avaliar(`(async () => { await window.OrqGrade.despertar(${JSON.stringify(alvo)}); return 'ok'; })()`);
  await esperar(2500);

  const acordado = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(alvo)});
    return JSON.stringify({ dormindo: p.dormindo, status: p.status, temPorta: (p.portas || []).length > 0 });
  })()`));
  checar('despertar sobe o PTY', acordado.dormindo === false && acordado.status === 'rodando',
    JSON.stringify(acordado));
  checar('e o painel ganha faixa de portas', acordado.temPorta === true, JSON.stringify(acordado));

  const rodou = await ateQue(cdp, `(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(alvo)});
    const b = p.term.buffer.active; let t = '';
    for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true);
    return t.includes('ACORDEI_1');
  })()`);
  checar('e o comandoInicial salvo e executado', rodou, '');

  // --- 6. retomar todas ---------------------------------------------------
  const antesTodas = await cdp.avaliar(`window.OrqGrade.dormindos().length`);
  await cdp.avaliar(`(async () => { await window.OrqGrade.retomarTodas(); return 'ok'; })()`);
  await esperar(3000);
  const depoisTodas = await cdp.avaliar(`window.OrqGrade.dormindos().length`);
  checar('retomar todas acorda os que restavam',
    antesTodas >= 1 && depoisTodas === 0, `${antesTodas} -> ${depoisTodas}`);

  // A pasta que sumiu nao pode ter sido acordada.
  const sumiu = JSON.parse(await cdp.avaliar(`(() => {
    const p = [...window.OrqGrade.painelPorId.values()].find(x => x.feature === 'sumiu');
    return JSON.stringify(p ? { status: p.status, dormindo: p.dormindo } : null);
  })()`));
  checar('painel de pasta sumida nao e acordado por engano',
    sumiu && sumiu.status === 'encerrada', JSON.stringify(sumiu));

  // --- 7. a contagem que decide a confirmacao de fechamento ---------------
  const rodando = await cdp.avaliar(`window.orq.sessaoRodando()`);
  checar('a contagem de sessoes rodando responde', Number.isInteger(rodando), String(rodando));

  await zerarGrade(cdp);
  await esperar(1200);
  await cdp.avaliar(`window.orq.sessaoSalvar([])`);

  encerrar('FASE7');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
