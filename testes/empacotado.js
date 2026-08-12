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
const { conectar, checar, encerrar, esperar, exigirPortaLivre } = require('./cdp');

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

  // Esta suite sobe o proprio app: com a porta ocupada ela testaria a instancia
  // que ja estava la, e nao o pacote.
  await exigirPortaLivre();

  fs.mkdirSync(UDATA, { recursive: true });
  // Com o Smart App Control ligado, ESTE executavel e bloqueado -- o Windows
  // recusa o CreateProcess e o Node relata `spawn UNKNOWN`, sem uma palavra
  // sobre politica de aplicativo. Perder meia hora atras de um defeito de
  // empacotamento que nao existe e caro; a mensagem abaixo aponta o culpado.
  const sac = (() => {
    try {
      return Number(execSync('powershell -NoProfile -Command "(Get-ItemProperty '
        + '\'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy\' -Name '
        + 'VerifiedAndReputablePolicyState -ErrorAction SilentlyContinue)'
        + '.VerifiedAndReputablePolicyState"', { encoding: 'utf8' }).trim());
    } catch { return 0; }
  })();

  // O bloqueio do SAC chega como excecao SINCRONA do spawn, e nao pelo evento
  // 'error' -- um handler assincrono aqui nunca chegaria a rodar.
  let app;
  try {
    app = spawn(EXE, [`--remote-debugging-port=9222`, `--user-data-dir=${UDATA}`], {
      detached: true,
      stdio: 'ignore',
      // Sem isto o app empacotado gravaria na lista de projetos REAL do usuario.
      env: { ...process.env, ORQ_DADOS: path.join(UDATA, 'dados') },
    });
  } catch (e) {
    if (e.code === 'UNKNOWN' && sac === 1) {
      console.error('\nO Smart App Control BLOQUEOU o app empacotado -- nao e defeito do build.');
      console.error('Ele barra todo binario sem assinatura de CA reconhecida, e o exe que o');
      console.error('electron-builder produz e unico no mundo: a nuvem nao o conhece.');
      console.error('\nPara testar o pacote que abre assim mesmo:');
      console.error('  npm run empacotar:sac && npm run teste:sac');
      process.exit(4);
    }
    throw e;
  }
  app.unref();

  const cdp = await conectar();

  // Se o xterm nao carregar de dentro do asar, tudo abaixo fica undefined.
  //
  // ESPERA PELA CONDICAO, e nao um instante fixo: `conectar()` volta assim que
  // existe um alvo CDP, o que acontece ANTES de os <script> terminarem de
  // avaliar. Ler de dentro do asar e mais lento que ler do disco solto, entao
  // amostrar uma vez so reprovava o app empacotado por atraso de arranque --
  // com o resto do teste passando logo em seguida, que e a assinatura de um
  // teste apressado e nao de um app quebrado.
  const alvo = `JSON.stringify({
    term: typeof window.Terminal,
    webgl: typeof window.WebglAddon?.WebglAddon,
    ponte: typeof window.orq?.abrirTerminal,
    grade: typeof window.OrqGrade?.criarPainel,
    projetos: typeof window.OrqProjetos?.montarComando,
  })`;
  let globais = {};
  for (let i = 0; i < 60; i++) {
    globais = JSON.parse(await cdp.avaliar(alvo));
    if (Object.values(globais).every((v) => v === 'function')) break;
    await esperar(250);
  }
  checar('xterm e scripts carregaram de dentro do asar',
    Object.values(globais).every((v) => v === 'function'), JSON.stringify(globais));

  // As fontes tambem vem de dentro do asar. Sem isto o app instalado cai em
  // fallback e a tipografia inteira do redesenho se perde sem nenhum erro.
  const fontes = JSON.parse(await cdp.avaliar(`(async () => {
    await document.fonts.ready;
    return JSON.stringify({
      grotesk: document.fonts.check('12px "Space Grotesk"'),
      mono: document.fonts.check('12px "JetBrains Mono"'),
    });
  })()`));
  checar('as fontes carregaram de dentro do asar',
    fontes.grotesk && fontes.mono, JSON.stringify(fontes));

  // A barra de titulo propria depende de titleBarStyle/titleBarOverlay, que so
  // valem na criacao da janela -- se o empacotado nascer com moldura nativa, a
  // faixa de 38px fica sobrando embaixo dela.
  const titulo = JSON.parse(await cdp.avaliar(`(() => {
    const t = document.getElementById('titulo');
    const r = t.getBoundingClientRect();
    return JSON.stringify({ altura: Math.round(r.height), topo: Math.round(r.top) });
  })()`));
  checar('a barra de titulo propria subiu no empacotado',
    titulo.altura === 38 && titulo.topo === 0, JSON.stringify(titulo));

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
