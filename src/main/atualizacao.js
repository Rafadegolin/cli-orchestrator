'use strict';

// Auto-atualizacao pelas releases do GitHub.
//
// A regra que manda aqui: este app hospeda sessoes de trabalho VIVAS. Reiniciar
// por conta propria mataria os painéis abertos no meio de uma tarefa. Entao o
// download acontece sozinho, mas quem decide aplicar e sempre o usuario.

const { app, dialog, Notification } = require('electron');

const terminais = require('./terminais');

// 4h entre checagens, com UM intervalo so. E raro sair versao nova, e acordar a
// CPU para consultar o GitHub o tempo todo contraria a meta de consumo parado.
const MS_ENTRE_CHECAGENS = 4 * 60 * 60 * 1000;

// Atraso da primeira checagem: a meta e 1,5s ate o primeiro terminal, e rede no
// arranque competiria com isso.
const MS_PRIMEIRA_CHECAGEM = 10_000;

let janela = null;
let timer = null;
let atualizador = null;

const situacao = {
  ativo: false,
  versaoAtual: app.getVersion(),
  disponivel: null,
  baixada: false,
  percentual: 0,
};

function avisarJanela() {
  if (janela && !janela.isDestroyed() && !janela.webContents.isDestroyed()) {
    janela.webContents.send('atualizacao:estado', { ...situacao });
  }
}

function iniciar(j) {
  janela = j;

  // Fora de um app empacotado nao ha o que consultar: o electron-updater
  // precisa do app.asar e do arquivo de metadados que o electron-builder gera.
  if (!app.isPackaged) {
    console.log('[atualizacao] app nao empacotado, updater desligado');
    return;
  }

  try {
    atualizador = require('electron-updater').autoUpdater;
  } catch (err) {
    console.error('[atualizacao] electron-updater indisponivel:', err.message);
    return;
  }

  atualizador.logger = {
    info: (m) => console.log('[atualizacao]', m),
    warn: (m) => console.warn('[atualizacao]', m),
    error: (m) => console.error('[atualizacao]', m),
    debug: () => {},
  };

  // Baixa sozinho em segundo plano; instalar continua sendo decisao do usuario.
  atualizador.autoDownload = true;
  // Se o usuario fechar o app normalmente, aplica na saida -- ai nao ha sessao
  // viva para atrapalhar.
  atualizador.autoInstallOnAppQuit = true;

  atualizador.on('update-available', (info) => {
    situacao.disponivel = info?.version || null;
    avisarJanela();
  });

  atualizador.on('update-not-available', () => {
    situacao.disponivel = null;
    situacao.baixada = false;
    avisarJanela();
  });

  atualizador.on('download-progress', (p) => {
    situacao.percentual = Math.round(p?.percent || 0);
    avisarJanela();
  });

  atualizador.on('update-downloaded', (info) => {
    situacao.baixada = true;
    situacao.disponivel = info?.version || situacao.disponivel;
    situacao.percentual = 100;
    avisarJanela();
    notificar();
  });

  // Sem internet, GitHub fora do ar, release malformada: nada disso pode virar
  // dialogo. O app nunca deve incomodar por causa de atualizacao.
  atualizador.on('error', (err) => {
    console.error('[atualizacao] falhou:', err?.message || err);
  });

  situacao.ativo = true;

  setTimeout(verificar, MS_PRIMEIRA_CHECAGEM);
  timer = setInterval(verificar, MS_ENTRE_CHECAGENS);
}

function verificar() {
  if (!atualizador) return;
  atualizador.checkForUpdates().catch((err) => {
    console.error('[atualizacao] checagem falhou:', err?.message || err);
  });
}

function notificar() {
  if (!Notification.isSupported()) return;
  if (janela && !janela.isDestroyed() && janela.isFocused()) return;

  const n = new Notification({
    title: 'Atualizacao pronta',
    body: `A versao ${situacao.disponivel} esta baixada. Reinicie o app quando quiser aplicar.`,
    silent: true,
  });
  n.on('click', () => {
    if (!janela || janela.isDestroyed()) return;
    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();
  });
  n.show();
}

// Chamado pela janela depois que o usuario clica em atualizar. O dialogo diz
// quantos painéis vao morrer -- reiniciar com seis sessoes do Claude no meio de
// uma tarefa e exatamente o que nao pode acontecer sem aviso.
async function aplicar() {
  if (!atualizador || !situacao.baixada) return { aplicado: false };

  const abertos = terminais.idsAbertos().length;
  const detalhe = abertos
    ? `${abertos} ${abertos === 1 ? 'painel aberto sera fechado' : 'painéis abertos serao fechados'} e ${abertos === 1 ? 'seu processo sera encerrado' : 'seus processos serao encerrados'}.\n\nSessoes do Claude em andamento serao interrompidas.`
    : 'Nenhum painel aberto no momento.';

  const { response } = await dialog.showMessageBox(janela, {
    type: 'question',
    buttons: ['Reiniciar e atualizar', 'Agora nao'],
    defaultId: 1,
    cancelId: 1,
    title: 'Aplicar atualizacao',
    message: `Instalar a versao ${situacao.disponivel} e reiniciar?`,
    detail: `${detalhe}\n\nSe preferir, e so fechar o app normalmente depois: a atualizacao se aplica sozinha na saida.`,
  });

  if (response !== 0) return { aplicado: false };

  // isSilent=false mostra o progresso do instalador; isForceRunAfter=true
  // reabre o app depois.
  atualizador.quitAndInstall(false, true);
  return { aplicado: true };
}

function parar() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { iniciar, verificar, aplicar, parar, situacao };
