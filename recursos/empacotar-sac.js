'use strict';
// O pacote que ABRE com o Smart App Control ligado.
//
// POR QUE ELE EXISTE. Medido em 11/08/2026, com o SAC em modo forcado (estado
// 1): o instalador NSIS e o zip portatil sao os dois bloqueados -- e a build
// feita na propria maquina TAMBEM. O que decide nao e Mark of the Web nem o
// lugar do arquivo (o mesmo exe copiado para fora do OneDrive continua barrado);
// e a IDENTIDADE do binario. Sem assinatura de uma CA do Microsoft Trusted Root
// Program, o unico jeito de passar e a nuvem ja conhecer aquele arquivo.
//
// E ai esta a saida: o `electron.exe` que vem do npm E conhecido -- ele e
// byte a byte o mesmo para todo mundo que instala o Electron 43, e roda sem
// bloqueio nenhum (verificado nesta maquina, com o SAC ligado). Quem perde a
// reputacao e o electron-builder, que renomeia o executavel e reescreve icone e
// metadados: aquele hash passa a ser unico no mundo, e a nuvem nao o conhece.
//
// Entao este pacote nao renomeia nada. E o `electron.exe` ORIGINAL mais o nosso
// `app.asar` ao lado. O preco e cosmetico e esta listado no LEIA-ME: o processo
// se chama electron.exe e o icone da barra de tarefas vem da BrowserWindow, e
// nao do executavel.
//
// Uso: npm run empacotar && npm run empacotar:sac

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const VERSAO = require(path.join(RAIZ, 'package.json')).version;

const ELECTRON = path.join(RAIZ, 'node_modules', 'electron', 'dist');
const EMPACOTADO = path.join(RAIZ, 'dist', 'win-unpacked', 'resources');
const NOME = `Orquestrador-${VERSAO}-sac`;
const SAIDA = path.join(RAIZ, 'dist', NOME);
const ZIP = path.join(RAIZ, 'dist', `${NOME}.zip`);

function hash(arquivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
}

function exigir(caminho, dica) {
  if (!fs.existsSync(caminho)) {
    console.error(`nao achei ${caminho}\n${dica}`);
    process.exit(2);
  }
}

exigir(ELECTRON, 'rode antes: npm install && npx install-electron');
exigir(path.join(EMPACOTADO, 'app.asar'), 'rode antes: npm run empacotar');

if (fs.existsSync(SAIDA)) fs.rmSync(SAIDA, { recursive: true, force: true });
fs.cpSync(ELECTRON, SAIDA, { recursive: true });

// O default_app so serve quando NAO ha resources/app.asar. Deixa-lo confundiria
// quem abrir a pasta, e nao ha caso em que ele rode.
const padrao = path.join(SAIDA, 'resources', 'default_app.asar');
if (fs.existsSync(padrao)) fs.rmSync(padrao);

fs.cpSync(path.join(EMPACOTADO, 'app.asar'), path.join(SAIDA, 'resources', 'app.asar'));
fs.cpSync(path.join(EMPACOTADO, 'app.asar.unpacked'),
  path.join(SAIDA, 'resources', 'app.asar.unpacked'), { recursive: true });

// Sem ele o electron-updater nao sabe onde procurar versao nova. O aviso no
// rodape continua sendo so "Baixar a versao X" -- a deteccao de portatil
// (ausencia de desinstalador ao lado do executavel) vale aqui tambem.
const meta = path.join(EMPACOTADO, 'app-update.yml');
if (fs.existsSync(meta)) fs.cpSync(meta, path.join(SAIDA, 'resources', 'app-update.yml'));

// A GARANTIA DO PACOTE INTEIRO. Se algum passo acima tocar no executavel, ele
// perde a reputacao e volta a ser bloqueado -- e o sintoma seria so o usuario
// dizendo que nao abre. Falhar aqui e barato; falhar na maquina dele nao e.
const origem = path.join(ELECTRON, 'electron.exe');
const copia = path.join(SAIDA, 'electron.exe');
if (hash(origem) !== hash(copia)) {
  console.error('o electron.exe do pacote NAO e identico ao do npm -- o SAC vai bloquear.');
  process.exit(3);
}

// Atalho relativo, nao .lnk: o .lnk grava caminho absoluto e quebra assim que a
// pessoa extrai em outro lugar.
fs.writeFileSync(path.join(SAIDA, 'Orquestrador.cmd'),
  '@echo off\r\nstart "" "%~dp0electron.exe"\r\n');

fs.writeFileSync(path.join(SAIDA, 'LEIA-ME.txt'), [
  'Orquestrador de CLIs ' + VERSAO + ' -- pacote compativel com o Smart App Control',
  '',
  'Para abrir: Orquestrador.cmd  (ou electron.exe direto)',
  '',
  'Por que este pacote existe',
  '  Com o Controle Inteligente de Aplicativos (SAC) ligado, o Windows bloqueia',
  '  todo programa sem assinatura de uma autoridade que ele reconheca -- e este',
  '  app nao e assinado. Aqui o executavel e o proprio electron.exe original,',
  '  que o Windows ja conhece, e o app vai ao lado dele em resources/app.asar.',
  '',
  'O que muda em relacao ao instalador',
  '  - o processo aparece como electron.exe no Gerenciador de Tarefas;',
  '  - nao ha atalho no menu Iniciar (crie um para Orquestrador.cmd se quiser);',
  '  - a atualizacao nao se aplica sozinha: o aviso abre a pagina da release.',
  '',
  'Seus dados ficam em %USERPROFILE%\\.orquestrador, fora desta pasta.',
  'Trocar a pasta por uma versao nova nao perde nada.',
  '',
].join('\r\n'));

// O zip sai pelo bsdtar, e cada detalhe abaixo custou uma tentativa:
//
//   - `Compress-Archive` NAO serve: parte do que o Electron distribui tem data
//     fora da faixa que o formato zip aceita, e o cmdlet morre no meio com "O
//     DateTimeOffset especificado nao pode ser convertido em um carimbo de
//     data/hora de arquivo Zip", deixando um zip pela metade.
//   - Caminho COMPLETO do tar.exe do Windows: `tar` solto no PATH acha o GNU
//     tar do Git, que nao escreve zip nenhum.
//   - `--options zip:compression=deflate` e obrigatorio. Sem ele o bsdtar
//     guarda tudo sem comprimir, e o pacote sai com os 359 MB da pasta em vez
//     dos ~140 MB que os outros artefatos tem.
//   - Caminhos RELATIVOS, com o cwd na pasta dist: o bsdtar le `C:\...` depois
//     do -f como `maquina:caminho` e tenta conectar num host chamado C.
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
if (fs.existsSync(ZIP)) fs.rmSync(ZIP);
execFileSync(TAR, ['-a', '-c', '--options', 'zip:compression=deflate',
  '-f', `${NOME}.zip`, NOME], { cwd: path.dirname(SAIDA), stdio: 'inherit' });

const mb = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1);
console.log(`\npronto: dist/${NOME}.zip (${mb} MB)`);
console.log(`pasta:  dist/${NOME}/  -- abre com Orquestrador.cmd`);
