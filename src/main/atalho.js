'use strict';
// O atalho no menu Iniciar, e o icone que sobrevive ao "fixar na barra de
// tarefas".
//
// POR QUE ISTO PRECISA EXISTIR. O icone da janela em execucao vem do `icon` da
// BrowserWindow, e esse ja esta certo. Mas quando voce FIXA, o Windows nao
// guarda a janela: ele guarda um ATALHO para o executavel, e tira o icone dos
// recursos do proprio .exe. No pacote compativel com o Smart App Control o
// executavel e o `electron.exe` original -- e ele nao pode ser tocado, porque a
// unica razao de o SAC deixa-lo passar e ser byte a byte igual ao de todo
// mundo. Resultado: fixava e virava o icone do Electron.
//
// A saida e a que o proprio Windows preve: um atalho .lnk que carrega o icone e
// um AppUserModelID, mais o app declarando o MESMO id (`setAppUserModelId` no
// index.js). E o id que faz o Windows entender que a janela aberta e aquele
// atalho fixado, em vez de dois itens sem relacao.
//
// O .lnk e criado AQUI, na maquina de quem usa, e nao vai dentro do zip: ele
// grava caminho absoluto, e viajaria quebrado.

const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { ehEmpacotado } = require('./empacotamento');

// Tem de ser igual ao `appId` do electron-builder, senao o app instalado pelo
// NSIS passa a ter duas identidades: a do instalador e a nossa.
const AUMID = 'com.pronixtech.orquestrador';

function caminhoDoAtalho() {
  return path.join(app.getPath('appData'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Orquestrador.lnk');
}

// De onde o atalho tira o icone, em ordem de preferencia:
//
//   1. um icone.ico ao lado do executavel -- e o que o pacote `-sac` poe la,
//      justamente porque o executavel dele nao carrega icone nosso;
//   2. o proprio executavel, que no instalador NSIS ja tem o icone embutido.
//
// O .ico dentro do asar nao serve: o Windows precisa de um caminho de arquivo
// que ele consiga abrir sozinho.
function iconeDe() {
  const aoLado = path.join(path.dirname(process.execPath), 'icone.ico');
  if (fs.existsSync(aoLado)) return { icon: aoLado, iconIndex: 0 };
  return { icon: process.execPath, iconIndex: 0 };
}

function criar() {
  if (process.platform !== 'win32') return { erro: 'Atalho no menu Iniciar so existe no Windows.' };

  // Em desenvolvimento o executavel e o electron.exe do node_modules, e um
  // atalho para ele sem os argumentos do projeto abriria a tela padrao do
  // Electron. Melhor recusar do que criar um atalho que nao funciona.
  //
  // `app.isPackaged` NAO serve para perguntar isso -- ver empacotamento.js.
  if (!ehEmpacotado()) {
    return { erro: 'So no app empacotado -- em desenvolvimento o executavel e o Electron cru.' };
  }

  const destino = caminhoDoAtalho();
  const { icon, iconIndex } = iconeDe();

  try {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    // 'replace' exige que o arquivo ja exista; 'create' e para quando nao ha.
    const operacao = fs.existsSync(destino) ? 'replace' : 'create';
    const ok = shell.writeShortcutLink(destino, operacao, {
      target: process.execPath,
      cwd: path.dirname(process.execPath),
      description: 'Orquestrador de CLIs',
      icon,
      iconIndex,
      appUserModelId: AUMID,
    });
    if (!ok) return { erro: 'O Windows recusou a criacao do atalho.' };
    return { ok: true, caminho: destino, icone: icon };
  } catch (e) {
    return { erro: e.message };
  }
}

function existe() {
  try { return fs.existsSync(caminhoDoAtalho()); } catch { return false; }
}

module.exports = { AUMID, criar, existe, caminhoDoAtalho };
