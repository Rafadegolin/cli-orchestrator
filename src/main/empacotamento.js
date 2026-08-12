'use strict';
// "Este app esta empacotado?" -- e por que `app.isPackaged` nao responde isso
// aqui.
//
// O Electron decide o `isPackaged` pelo NOME DO EXECUTAVEL: se ele se chama
// `electron.exe`, a resposta e nao. E o pacote compativel com o Smart App
// Control roda justamente sobre o `electron.exe` original, que nao pode ser
// renomeado -- ser byte a byte igual ao de todo mundo e a unica razao de o SAC
// deixa-lo passar.
//
// Resultado: um app empacotado e distribuido se via como "em desenvolvimento",
// e tudo que dependia dessa pergunta se desligava em silencio -- o updater
// inteiro, inclusive. Nada quebrava na cara: simplesmente nunca chegava aviso
// de versao nova.
//
// A pergunta certa e por onde o codigo esta sendo lido. Empacotado, o app mora
// dentro de um .asar; em desenvolvimento, e uma pasta do disco.

const { app } = require('electron');

function ehEmpacotado() {
  return app.getAppPath().toLowerCase().endsWith('.asar');
}

module.exports = { ehEmpacotado };
