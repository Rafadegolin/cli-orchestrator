'use strict';

// O unico lugar do app que incomoda voce FORA da janela.
//
// Sao dois canais, e eles andam juntos de proposito: a notificacao do Windows e
// o piscar da barra de tarefas. O piscar nao e redundancia -- o Windows descarta
// toast em silencio (Foco Assistido, notificacoes do app desligadas nas
// configuracoes do sistema, atalho sem o AppUserModelID), e nesses casos ele e o
// unico sinal que sobra.
//
// Por que o portao da preferencia vive AQUI, no processo principal, e nao no
// `lateral.js` que decide o que avisar:
//
//  1. o renderer guarda `jaAvisado` (avisa uma vez por episodio) e `jaLembrado`
//     (um lembrete depois de 5min, condicionado a `jaAvisado.has(id)`).
//     Desistir ANTES de marcar deixaria a sessao sem lembrete para sempre, mesmo
//     depois de religar; desistir DEPOIS queimaria o slot sem ter avisado. Nao
//     ha posicao boa la dentro. Aqui a contabilidade continua correta e so o
//     efeito e suprimido;
//  2. o `flashFrame` so existe deste lado, e a preferencia precisa cobri-lo;
//  3. o toast de "atualizacao pronta" nao passa pelo IPC da janela -- ele monta
//     o proprio `Notification`. Num portao no renderer ele escaparia por
//     construcao.
//
// De quebra, o handler de clique deixou de existir em dois lugares: `index.js` e
// `atualizacao.js` tinham o mesmo codigo copiado.

const { Notification } = require('electron');

const preferencias = require('./preferencias');

let janela = null;

function definirJanela(j) {
  janela = j;
}

function ligados() {
  return preferencias.avisosLigados();
}

function trazerParaFrente() {
  if (!janela || janela.isDestroyed()) return;
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
}

// Devolve se algum sinal chegou a sair -- e o que torna isto testavel sem
// depender de enxergar um toast do sistema operacional.
function notificar({ titulo, corpo, silencioso = false } = {}) {
  if (!ligados()) return false;

  // Piscar ANTES do toast e independente dele, pelo motivo do cabecalho. Para
  // sozinho quando a janela recebe foco (`index.js`).
  if (janela && !janela.isDestroyed() && !janela.isFocused()) janela.flashFrame(true);

  if (!Notification.isSupported()) return false;

  const n = new Notification({ title: titulo, body: corpo, silent: silencioso });
  n.on('click', trazerParaFrente);
  n.show();
  return true;
}

module.exports = { definirJanela, notificar, ligados, trazerParaFrente };
