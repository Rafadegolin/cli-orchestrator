'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const os = require('os');

const terminais = require('./terminais');
const eventos = require('./eventos');
const estado = require('./estado');
const instalarHooks = require('./instalar-hooks');
const projetos = require('./projetos');

// cmd.exe abre em dezenas de ms; o PowerShell leva algumas centenas e sozinho
// comeria boa parte da meta de 1,5s ate o primeiro terminal.
const SHELL_PADRAO = process.platform === 'win32'
  ? (process.env.ComSpec || 'cmd.exe')
  : (process.env.SHELL || '/bin/bash');

let janela = null;

function criarJanela() {
  janela = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#14161a',
    show: false,
    title: 'Orquestrador',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'ponte.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  janela.once('ready-to-show', () => janela.show());
  janela.on('closed', () => {
    terminais.fecharTodos();
    janela = null;
  });

  terminais.definirJanela(janela);
  estado.definirJanela(janela);
  janela.loadFile(path.join(__dirname, '..', 'janela', 'index.html'));
}

app.whenReady().then(async () => {
  criarJanela();

  try {
    await eventos.iniciar();
  } catch (err) {
    // Porta ocupada nao pode derrubar o app: os terminais continuam servindo,
    // so as bolinhas param de mudar sozinhas.
    dialog.showMessageBox(janela, {
      type: 'warning',
      title: 'Servidor de eventos',
      message: `Nao consegui abrir a porta ${eventos.PORTA}.`,
      detail: `${err.message}\n\nOs terminais funcionam normalmente, mas as bolinhas de status nao vao mudar sozinhas.`,
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on('window-all-closed', () => {
  terminais.fecharTodos();
  eventos.parar();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  terminais.fecharTodos();
  eventos.parar();
});

// ---------------------------------------------------------------- IPC

ipcMain.handle('app:escolherPasta', async () => {
  const r = await dialog.showOpenDialog(janela, {
    title: 'Escolha a pasta do projeto',
    properties: ['openDirectory'],
    defaultPath: os.homedir(),
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('app:pastaPadrao', () => os.homedir());

ipcMain.handle('terminal:abrir', (_e, { id, cwd, cols, rows, comando, args, env, feature }) => {
  const pasta = cwd || os.homedir();
  estado.registrar(id, { feature: feature || id, cwd: pasta });
  const r = terminais.abrir({
    id,
    cwd: pasta,
    comando: comando || SHELL_PADRAO,
    args: args || [],
    cols,
    rows,
    env,
  });
  estado.definirStatus(id, 'rodando', 'shell aberto');
  return r;
});

ipcMain.on('terminal:escrever', (_e, { id, texto }) => terminais.escrever(id, texto));
ipcMain.on('terminal:redimensionar', (_e, { id, cols, rows }) => terminais.redimensionar(id, cols, rows));
ipcMain.on('terminal:fechar', (_e, { id }) => {
  terminais.fechar(id);
  estado.remover(id);
});

ipcMain.handle('estado:todas', () => estado.todas());

// -------------------------------------------------------------- projetos

ipcMain.handle('projetos:listar', () => projetos.listar());

// Recebe o caminho ja escolhido, em vez de abrir o dialogo por dentro: separa
// a escolha da gravacao e deixa o fluxo testavel (o CDP nao dirige dialogo
// nativo do Windows).
ipcMain.handle('projetos:adicionar', (_e, caminho) => {
  const r = projetos.adicionar(caminho);
  return { ...r, projetos: projetos.listar() };
});

ipcMain.handle('projetos:remover', async (_e, { id, confirmar = true } = {}) => {
  const alvo = projetos.listar().find((p) => p.id === id);
  if (!alvo) return { cancelado: false, removido: false, projetos: projetos.listar() };

  if (confirmar) {
    const { response } = await dialog.showMessageBox(janela, {
      type: 'question',
      buttons: ['Remover da lista', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Remover projeto',
      message: `Remover "${alvo.nome}" da lista?`,
      detail: `${alvo.caminho}\n\nSo o cadastro sai daqui. A pasta e os arquivos no disco NAO sao tocados.`,
    });
    if (response !== 0) return { cancelado: true, projetos: projetos.listar() };
  }

  const r = projetos.remover(id);
  return { ...r, projetos: projetos.listar() };
});

ipcMain.handle('app:estaFocado', () => Boolean(janela && janela.isFocused()));

ipcMain.on('app:focar', () => {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
});

ipcMain.on('app:notificar', (_e, { titulo, corpo }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: titulo, body: corpo, silent: false });
  n.on('click', () => {
    if (!janela) return;
    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();
  });
  n.show();
});

// --------------------------------------------------------- hooks do Claude

ipcMain.handle('hooks:situacao', () => ({
  instalado: instalarHooks.estaInstalado(),
  arquivo: instalarHooks.ARQ_SETTINGS,
  porta: eventos.PORTA,
}));

// Editar o settings.json do usuario SEMPRE passa por aqui: pergunta, mostra o
// arquivo e o que vai ser escrito, e so entao grava (com backup).
ipcMain.handle('hooks:instalar', async () => {
  const { response } = await dialog.showMessageBox(janela, {
    type: 'question',
    buttons: ['Instalar os hooks', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    title: 'Instalar hooks do Claude Code',
    message: 'Posso editar o seu settings.json do Claude?',
    detail:
      `Arquivo: ${instalarHooks.ARQ_SETTINGS}\n\n` +
      `Vou ADICIONAR hooks que avisam este app quando uma sessao pede permissao, ` +
      `termina ou fica ociosa. Nada e removido: o que ja estiver la e preservado, ` +
      `e um backup do arquivo e gravado antes.\n\n` +
      `Os hooks so falam com 127.0.0.1:${eventos.PORTA}. Com o app fechado eles ` +
      `falham em silencio e nao atrapalham suas sessoes.`,
  });
  if (response !== 0) return { cancelado: true };
  return instalarHooks.instalar();
});

ipcMain.handle('hooks:desinstalar', async () => {
  const { response } = await dialog.showMessageBox(janela, {
    type: 'question',
    buttons: ['Remover os hooks', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    title: 'Remover hooks do Claude Code',
    message: 'Remover apenas os hooks deste app?',
    detail: `Arquivo: ${instalarHooks.ARQ_SETTINGS}\n\nHooks seus configurados a mao nao sao tocados.`,
  });
  if (response !== 0) return { cancelado: true };
  return instalarHooks.desinstalar();
});
