'use strict';

// Auto-atualizacao pelas releases do GitHub.
//
// A regra que manda aqui: este app hospeda sessoes de trabalho VIVAS. Reiniciar
// por conta propria mataria os painéis abertos no meio de uma tarefa. Entao o
// download acontece sozinho, mas quem decide aplicar e sempre o usuario.

const { app, dialog, Notification, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const terminais = require('./terminais');

const PAGINA_RELEASES = 'https://github.com/Rafadegolin/cli-orchestrator/releases/latest';

// Instalado pelo NSIS ou rodando a partir do zip portatil?
//
// Importa porque o updater aplica a atualizacao rodando o INSTALADOR, e quem
// esta no portatil nao tem instalador nenhum -- baixar um so para ele ser
// recusado (ou, com o Smart App Control ligado, barrado como todo binario nao
// assinado que vem da internet) seria mandar a pessoa para um beco sem saida.
//
// O NSIS deixa o desinstalador ao lado do executavel; o zip nao tem nenhum.
function ehPortatil() {
  try {
    const pasta = path.dirname(process.execPath);
    const temDesinstalador = fs.readdirSync(pasta)
      .some((n) => /^Uninstall .*\.exe$/i.test(n));
    return !temDesinstalador;
  } catch {
    return false;
  }
}

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
  portatil: false,
};

function avisarJanela() {
  if (janela && !janela.isDestroyed() && !janela.webContents.isDestroyed()) {
    janela.webContents.send('atualizacao:estado', { ...situacao });
  }
}

function iniciar(j) {
  janela = j;

  situacao.portatil = ehPortatil();

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

  // No portatil, baixar o instalador nao serve para nada: aplicar exigiria
  // roda-lo, e e ele que o Smart App Control bloqueia. Melhor so avisar e
  // mandar para a pagina da release, onde esta o zip novo.
  atualizador.autoDownload = !situacao.portatil;
  atualizador.autoInstallOnAppQuit = !situacao.portatil;

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
  // Portatil: nao ha instalador para rodar. Abre a pagina da release para
  // baixar o zip novo, que e o caminho que de fato funciona.
  if (situacao.portatil) {
    await shell.openExternal(PAGINA_RELEASES);
    return { aplicado: false, portatil: true, abriu: PAGINA_RELEASES };
  }

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
