'use strict';
// Testa o app EMPACOTADO, nao o codigo solto. E aqui que aparecem as duas
// quebras classicas da Fase 8, ambas invisiveis em desenvolvimento:
//
//   1. modulo nativo dentro do asar -> a janela abre e nenhum terminal funciona
//   2. o xterm e carregado por <script src="../../node_modules/...">, caminho
//      que no app empacotado passa a resolver DENTRO do asar -> janela em branco
//
// Uso: npm run empacotar, depois node testes/empacotado.js

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { conectar, checar, encerrar, esperar } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
const EXE = path.join(RAIZ, 'dist', 'win-unpacked', 'Orquestrador.exe');
const UDATA = path.join(RAIZ, '.dev-udata', 'empacotado');

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error(`nao achei ${EXE}\nrode antes: npm run empacotar`);
    process.exit(2);
  }

  // Mata instancias anteriores do app empacotado.
  try {
    execSync('powershell -NoProfile -Command "Get-Process Orquestrador -ErrorAction SilentlyContinue | Stop-Process -Force"');
  } catch { /* nao havia nenhuma */ }
  await esperar(1000);

  fs.mkdirSync(UDATA, { recursive: true });
  const app = spawn(EXE, [`--remote-debugging-port=9222`, `--user-data-dir=${UDATA}`], {
    detached: true,
    stdio: 'ignore',
    // Sem isto o app empacotado gravaria na lista de projetos REAL do usuario.
    env: { ...process.env, ORQ_DADOS: path.join(UDATA, 'dados') },
  });
  app.unref();

  const cdp = await conectar();

  // Se o xterm nao carregar de dentro do asar, tudo abaixo e undefined.
  const globais = JSON.parse(await cdp.avaliar(`JSON.stringify({
    term: typeof window.Terminal,
    webgl: typeof window.WebglAddon?.WebglAddon,
    ponte: typeof window.orq?.abrirTerminal,
    grade: typeof window.OrqGrade?.criarPainel,
    projetos: typeof window.OrqProjetos?.montarComando,
  })`));
  checar('xterm e scripts carregaram de dentro do asar',
    Object.values(globais).every((v) => v === 'function'), JSON.stringify(globais));

  const versao = await cdp.avaliar(`window.orq.versao()`);
  checar('app reporta a versao do package.json', /^\d+\.\d+\.\d+$/.test(versao), versao);

  // O teste que pega o asarUnpack errado: PTY de verdade no app empacotado.
  await cdp.avaliar(`(async () => { window.__p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ.replace(/\\/g, '/'))}, feature: 'empacotado' }); return 'ok'; })()`);
  await esperar(2500);

  const info = JSON.parse(await cdp.avaliar(`(() => { const p = window.__p;
    return JSON.stringify({ status: p.status, render: p.tipoRender, cols: p.term.cols }); })()`));
  checar('o PTY subiu no app empacotado (node-pty fora do asar)',
    info.status === 'rodando', JSON.stringify(info));
  checar('renderizador WebGL ativo', info.render === 'webgl', info.render);

  await cdp.avaliar(`window.orq.escrever(window.__p.id, 'echo ORQ_EMPACOTADO_OK\\r')`);
  await esperar(2500);
  const buffer = await cdp.avaliar(`(() => { const b = window.__p.term.buffer.active; let t = '';
    for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\\n'; return t; })()`);
  checar('comando executou e a saida voltou para a tela',
    buffer.includes('ORQ_EMPACOTADO_OK'), buffer.split('\n').filter(Boolean).slice(-1)[0]);

  // O servidor de eventos precisa subir tambem no app instalado.
  const porta = fs.existsSync(path.join(require('os').homedir(), '.orquestrador', 'porta'));
  checar('servidor de eventos gravou a porta', porta, '~/.orquestrador/porta');

  // Sem release publicada o updater recebe 404. Nao pode virar dialogo nem
  // derrubar nada -- so situacao vazia.
  const atual = JSON.parse(await cdp.avaliar(
    `(async () => JSON.stringify(await window.orq.atualizacaoSituacao()))()`));
  checar('updater ligado no app empacotado', atual.ativo === true, JSON.stringify(atual));
  checar('sem release disponivel, nenhum aviso aparece',
    await cdp.avaliar(`document.getElementById('btn-atualizar').hidden`) === true, '');

  await cdp.avaliar(`window.OrqPainel.painelPorId.get(window.__p.id).destruir()`);
  await esperar(1500);

  try {
    execSync('powershell -NoProfile -Command "Get-Process Orquestrador -ErrorAction SilentlyContinue | Stop-Process -Force"');
  } catch { /* ja saiu */ }

  encerrar('EMPACOTADO');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
