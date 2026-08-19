'use strict';
// Porta por painel: a "regra de ouro do isolamento".
//
// O teste que importa e o ultimo -- dois painéis do mesmo projeto subindo um
// servidor cada um AO MESMO TEMPO. E exatamente o cenario que hoje morre com
// EADDRINUSE quando as duas sessoes disputam a porta 3000.

const net = require('net');
const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');
const cmd = require('./comandos');

const RAIZ = path.resolve(__dirname, '..').replace(/\\/g, '/');

function ocupar(porta) {
  return new Promise((resolve, reject) => {
    const s = net.createServer(() => {});
    s.once('error', reject);
    s.listen(porta, '127.0.0.1', () => resolve(s));
  });
}

function livre(porta) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(porta, '127.0.0.1');
  });
}

function pedir(porta, caminho = '/') {
  return fetch(`http://127.0.0.1:${porta}${caminho}`).then((r) => r.text());
}

async function abrir(cdp, feature) {
  const info = JSON.parse(await cdp.avaliar(`(async () => {
    const p = await window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(RAIZ)}, feature: '${feature}' });
    return JSON.stringify({ id: p.id, portas: p.portas || [] });
  })()`));
  await esperar(600);
  return info;
}

(async () => {
  const cdp = await conectar();
  await zerarGrade(cdp);

  // 1. Bloqueia a porta base de proposito: o app tem de pular por cima dela.
  const intruso = await ocupar(3100);
  const a = await abrir(cdp, 'porta-a');
  const b = await abrir(cdp, 'porta-b');
  await esperar(1500);

  checar('painel recebeu um bloco de 5 portas', a.portas.length === 5, JSON.stringify(a.portas));
  checar('porta ocupada por outro processo foi pulada',
    !a.portas.includes(3100) && !b.portas.includes(3100), `a=${a.portas[0]} b=${b.portas[0]}`);

  const sobrepoe = a.portas.filter((p) => b.portas.includes(p));
  checar('os blocos de dois painéis nao se sobrepoem', sobrepoe.length === 0,
    `a=${a.portas.join(',')} | b=${b.portas.join(',')}`);

  const todasLivres = (await Promise.all([...a.portas, ...b.portas].map(livre))).every(Boolean);
  checar('as portas entregues estao mesmo livres', todasLivres, '');

  intruso.close();

  // 2. A variavel chega dentro do shell do painel.
  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(a.id)}, 'echo PORTA=[${cmd.variavel('PORT')}] BLOCO=[${cmd.variavel('ORQ_PORTAS')}]\\r')`);
  await esperar(2500);
  const buffer = await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(a.id)});
    const bf = p.term.buffer.active; let t = '';
    for (let i = 0; i < bf.length; i++) t += bf.getLine(i).translateToString(true) + '\\n';
    return t;
  })()`);
  checar('PORT chegou no ambiente do shell', buffer.includes(`PORTA=[${a.portas[0]}]`),
    (buffer.match(/PORTA=\[[^\]]*\]/g) || []).slice(-1)[0] || 'nao achei');
  checar('ORQ_PORTAS traz o bloco inteiro', buffer.includes(`BLOCO=[${a.portas.join(',')}]`),
    (buffer.match(/BLOCO=\[[^\]]*\]/g) || []).slice(-1)[0] || 'nao achei');

  const etiqueta = await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(a.id)}).elPorta.textContent`);
  checar('o cabecalho mostra a porta', etiqueta === `:${a.portas[0]}`, etiqueta);

  // 3. A PROVA: dois servidores do "mesmo projeto" no ar ao mesmo tempo.
  const servidor = (marca) =>
    `node -e "require('http').createServer((q,s)=>s.end('${marca}')).listen(process.env.PORT)"`;
  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(a.id)}, ${JSON.stringify(servidor('SOU_O_PAINEL_A') + '\r')})`);
  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(b.id)}, ${JSON.stringify(servidor('SOU_O_PAINEL_B') + '\r')})`);
  await esperar(6000);

  let respA = '(sem resposta)';
  let respB = '(sem resposta)';
  try { respA = await pedir(a.portas[0]); } catch (e) { respA = `erro: ${e.message}`; }
  try { respB = await pedir(b.portas[0]); } catch (e) { respB = `erro: ${e.message}`; }

  checar('o servidor do painel A respondeu na porta dele', respA === 'SOU_O_PAINEL_A', respA);
  checar('o servidor do painel B respondeu na porta dele, AO MESMO TEMPO',
    respB === 'SOU_O_PAINEL_B', respB);

  // 4. Fechar devolve o bloco para reuso.
  const portasA = a.portas.slice();
  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(a.id)}).destruir()`);
  await esperar(3000);
  checar('fechar o painel liberou as portas de verdade',
    (await Promise.all(portasA.map(livre))).every(Boolean), portasA.join(','));

  // O painel novo tem de VOLTAR para a faixa liberada, nao seguir subindo. Nao
  // da para exigir exatamente portasA[0]: o intruso que ocupava a 3100 ja foi
  // fechado, entao a faixa mais baixa livre agora comeca antes dela.
  const c = await abrir(cdp, 'porta-c');
  await esperar(1200);
  checar('painel novo reaproveita a faixa liberada em vez de subir',
    c.portas[0] <= portasA[0], `liberado em ${portasA[0]}, novo em ${c.portas[0]}`);
  checar('e mesmo assim nao pisa no bloco do painel que continua aberto',
    c.portas.filter((p) => b.portas.includes(p)).length === 0,
    `c=${c.portas.join(',')} | b=${b.portas.join(',')}`);

  // --- faixa por projeto -------------------------------------------------
  //
  // O que da sentido a escolha no cadastro: dois projetos com faixas diferentes
  // abrem em blocos que nem chegam perto um do outro, e um worktree herda a
  // faixa do projeto dono.
  await zerarGrade(cdp);

  const os = require('os');
  const fs = require('fs');
  const baseA = path.join(os.tmpdir(), 'orq-faixa-a').replace(/\\/g, '/');
  const baseB = path.join(os.tmpdir(), 'orq-faixa-b').replace(/\\/g, '/');
  const dentroA = `${baseA}/.claude/worktrees/feat-x`;
  for (const d of [baseA, baseB, dentroA]) fs.mkdirSync(d, { recursive: true });

  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.orq.projetosAdicionar(${JSON.stringify(baseA)}, [4000, 4099]);
    await window.orq.projetosAdicionar(${JSON.stringify(baseB)}, [5200, 5299]);
    await window.OrqProjetos.carregarProjetos();
    return 'ok';
  })()`);
  await esperar(500);

  const abrirEm = async (cwd, feature) => {
    const info = JSON.parse(await cdp.avaliar(`(async () => {
      const p = await window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(cwd)}, feature: '${feature}' });
      return JSON.stringify({ id: p.id, portas: p.portas || [] });
    })()`));
    await esperar(900);
    return info;
  };

  const fa = await abrirEm(baseA, 'faixa-a');
  const fb = await abrirEm(baseB, 'faixa-b');
  const fw = await abrirEm(dentroA, 'faixa-worktree');

  checar('projeto com faixa 4000 abre dentro dela',
    fa.portas[0] >= 4000 && fa.portas[4] <= 4099, fa.portas.join(','));
  checar('projeto com faixa 5200 abre dentro da dele',
    fb.portas[0] >= 5200 && fb.portas[4] <= 5299, fb.portas.join(','));
  checar('e os dois blocos nem chegam perto um do outro',
    Math.abs(fa.portas[0] - fb.portas[0]) > 100, `${fa.portas[0]} vs ${fb.portas[0]}`);
  checar('worktree herda a faixa do projeto dono',
    fw.portas[0] >= 4000 && fw.portas[0] <= 4099 && fw.portas[0] !== fa.portas[0],
    fw.portas.join(','));

  // Pasta sem projeto cadastrado continua na faixa padrao.
  const avulso = await abrirEm(RAIZ, 'faixa-avulso');
  checar('pasta sem projeto cadastrado usa a faixa padrao a partir da 3100',
    avulso.portas[0] >= 3100 && avulso.portas[0] < 4000, avulso.portas.join(','));

  await zerarGrade(cdp);
  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos();
    return 'ok';
  })()`);
  for (const d of [baseA, baseB]) fs.rmSync(d, { recursive: true, force: true });

  encerrar('PORTAS');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
