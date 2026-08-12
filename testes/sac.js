'use strict';
// O pacote que abre com o Smart App Control ligado.
//
// Este teste existe porque a falha aqui e SILENCIOSA do lado de quem
// desenvolve: na maquina de quem empacota o app roda de qualquer jeito, e o
// unico sintoma do defeito e um usuario dizendo que "nao abre" -- sem log, sem
// erro, so a caixa do Windows dizendo que uma politica bloqueou o arquivo.
//
// Duas coisas precisam valer ao mesmo tempo, e uma nao implica a outra:
//   1. o executavel precisa ser o electron.exe ORIGINAL, byte a byte (e o unico
//      motivo de o SAC deixar passar: aquele hash a nuvem ja conhece);
//   2. o app precisa de fato SUBIR desse jeito -- xterm carregado de dentro do
//      asar e node-pty desempacotado abrindo terminal de verdade. Sao as mesmas
//      duas armadilhas da Fase 8, e trocar o executavel mexe exatamente no
//      caminho que as revela.
//
// Uso: npm run empacotar && npm run empacotar:sac && npm run teste:sac

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { conectar, checar, encerrar, esperar } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
const VERSAO = require(path.join(RAIZ, 'package.json')).version;
const PACOTE = path.join(RAIZ, 'dist', `Orquestrador-${VERSAO}-sac`);
const EXE = path.join(PACOTE, 'electron.exe');
const ORIGINAL = path.join(RAIZ, 'node_modules', 'electron', 'dist', 'electron.exe');
const UDATA = path.join(RAIZ, '.dev-udata', 'sac');

const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error(`nao achei ${EXE}\nrode antes: npm run empacotar && npm run empacotar:sac`);
    process.exit(2);
  }

  checar('o executavel e o electron.exe original, byte a byte',
    hash(EXE) === hash(ORIGINAL), `${hash(EXE).slice(0, 12)} vs ${hash(ORIGINAL).slice(0, 12)}`);

  // Renomear o executavel e a forma mais facil de perder a reputacao sem
  // perceber -- e seria uma "melhoria" tentadora, ja que electron.exe nao diz
  // nada a quem abre a pasta.
  checar('o pacote nao renomeou o executavel', fs.existsSync(EXE), 'electron.exe presente');
  checar('ha um atalho relativo para abrir',
    fs.existsSync(path.join(PACOTE, 'Orquestrador.cmd')), 'Orquestrador.cmd');
  checar('o app.asar esta ao lado, e nao o default_app',
    fs.existsSync(path.join(PACOTE, 'resources', 'app.asar'))
    && !fs.existsSync(path.join(PACOTE, 'resources', 'default_app.asar')), 'resources/');
  checar('o node-pty ficou desempacotado',
    fs.existsSync(path.join(PACOTE, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty')),
    'app.asar.unpacked/node_modules/node-pty');

  try {
    execSync('powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | '
      + 'Where-Object { $_.Path -like \'*-sac*\' } | Stop-Process -Force"');
  } catch { /* nao havia nenhuma */ }
  await esperar(1000);

  fs.mkdirSync(UDATA, { recursive: true });
  const app = spawn(EXE, ['--remote-debugging-port=9222', `--user-data-dir=${UDATA}`], {
    detached: true,
    stdio: 'ignore',
    // Sem isto o pacote gravaria na lista de projetos REAL do usuario.
    env: { ...process.env, ORQ_DADOS: path.join(UDATA, 'dados') },
  });
  app.unref();

  const cdp = await conectar();

  // Espera pela CONDICAO: `conectar()` volta assim que existe alvo CDP, o que
  // acontece antes de os <script> terminarem de avaliar.
  let alvo = { term: 'undefined' };
  for (let i = 0; i < 40; i++) {
    alvo = JSON.parse(await cdp.avaliar(`JSON.stringify({
      term: typeof window.Terminal,
      ponte: typeof window.orq?.abrirTerminal,
      grade: typeof window.OrqGrade?.criarPainel,
    })`));
    if (alvo.term === 'function' && alvo.grade === 'function') break;
    await esperar(250);
  }
  checar('o xterm carregou de dentro do asar', alvo.term === 'function', alvo.term);
  checar('a ponte do preload esta de pe', alvo.ponte === 'function', alvo.ponte);
  checar('a grade subiu', alvo.grade === 'function', alvo.grade);

  await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ.replace(/\\/g, '/'))}, feature: 'sac' }); return 'ok'; })()`);

  // Espera pela CONDICAO, e nao um instante fixo. O cmd.exe leva o tempo que
  // levar para escrever a primeira linha -- e num arranque frio ele passa dos
  // 3s que estavam aqui antes, reprovando um pacote que esta perfeito.
  let est = { status: '', texto: '' };
  for (let i = 0; i < 40; i++) {
    est = JSON.parse(await cdp.avaliar(`(() => {
      const p = [...window.OrqGrade.painelPorId.values()][0];
      return JSON.stringify({ status: p.status, texto: p.textoDoBuffer().slice(-200) });
    })()`));
    if (est.status === 'rodando' && /\w/.test(est.texto)) break;
    await esperar(250);
  }
  checar('o node-pty abriu terminal de verdade',
    est.status === 'rodando' && /\w/.test(est.texto), JSON.stringify(est).slice(0, 160));

  // MATA O QUE SUBIU. Esta suite e uma das duas que abrem o app por conta
  // propria (a outra e a do empacotado); as demais se conectam ao `npm run
  // dev`. Deixar esta instancia viva ocuparia a porta 9222, e a suite seguinte
  // rodaria contra ELA sem que nada denunciasse -- passando, inclusive, so que
  // testando outro app.
  await cdp.avaliar(`[...window.OrqGrade.painelPorId.values()].forEach(p => p.destruir())`);
  await esperar(1500);
  try {
    execSync('powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | '
      + 'Where-Object { $_.Path -like \'*-sac*\' } | Stop-Process -Force"');
  } catch { /* ja saiu */ }

  encerrar('SAC');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
