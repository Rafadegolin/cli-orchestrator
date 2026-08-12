'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const os = require('os');

const terminais = require('./terminais');
const eventos = require('./eventos');
const estado = require('./estado');
const instalarHooks = require('./instalar-hooks');
const projetos = require('./projetos');
const atualizacao = require('./atualizacao');
const portas = require('./portas');
const worktrees = require('./worktrees');
const sessao = require('./sessao');
const arquivo = require('./arquivo');
const preferencias = require('./preferencias');
const metricas = require('./metricas');
const historico = require('./historico');
const layouts = require('./layouts');
const atalho = require('./atalho');

// Chamado pelo desinstalador (recursos/instalador.nsh) antes de apagar os
// arquivos. Tem de ser rapido e mudo: nada de janela, nada de dialogo -- o
// usuario esta olhando a barra de progresso do desinstalador.
//
// Sem isto, desinstalar o app deixaria os hooks no settings.json do Claude para
// sempre, e toda sessao passaria a pagar ~310ms por evento tentando falar com
// um app que nao existe mais.
if (process.argv.includes('--remover-hooks')) {
  try {
    instalarHooks.desinstalar();
    console.log('hooks removidos');
  } catch (err) {
    console.error('falhou ao remover hooks:', err.message);
  }
  app.quit();
  process.exit(0);
}

// cmd.exe abre em dezenas de ms; o PowerShell leva algumas centenas e sozinho
// comeria boa parte da meta de 1,5s ate o primeiro terminal.
const SHELL_PADRAO = process.platform === 'win32'
  ? (process.env.ComSpec || 'cmd.exe')
  : (process.env.SHELL || '/bin/bash');

let janela = null;

// Os botoes de janela sao desenhados pelo Windows, entao a cor deles nao sai do
// CSS -- tem de ser dita ao Electron. Os valores sao os mesmos tokens --bg1 e
// --fg2 de cada tema, e trocar de tema chama setTitleBarOverlay.
const CORES_TITULO = {
  escuro: { color: '#0d1014', symbolColor: '#a3adba' },
  claro: { color: '#ffffff', symbolColor: '#4d5661' },
};

// Trava para o dialogo de confirmacao nao aparecer quando quem esta fechando
// nao e o usuario. O quitAndInstall do updater tambem fecha a janela: sem isto,
// aplicar atualizacao pediria confirmacao no meio do reinicio.
let fechamentoAutorizado = false;

function criarJanela() {
  // Le o tema ANTES de criar a janela: comecar sempre no escuro faria o tema
  // claro piscar preto no arranque, e a cor dos botoes de janela nao pode ser
  // corrigida depois sem o mesmo pisca.
  const cores = CORES_TITULO[preferencias.carregar().tema] || CORES_TITULO.escuro;

  janela = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 924,
    minHeight: 560,
    backgroundColor: cores.color,
    show: false,
    title: 'Orquestrador',
    // No instalador e no zip portatil o icone vem do proprio executavel, e esta
    // linha nao muda nada. Ela existe pelo pacote "sac", onde o executavel e o
    // electron.exe ORIGINAL e intocado -- sem ela a barra de tarefas mostraria
    // o icone do Electron.
    icon: path.join(__dirname, '..', '..', 'recursos', 'icone.ico'),
    // A faixa de 38px e desenhada por nos; os TRES BOTOES continuam sendo os do
    // Windows, pintados por cima pelo overlay. E o que preserva o Snap Layouts
    // (arrastar para a borda, o menu que aparece ao pairar no maximizar) --
    // `frame: false` daria controle total do visual e custaria isso.
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...cores, height: 38 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'ponte.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  janela.once('ready-to-show', () => janela.show());

  // Fechar mata todas as sessoes em andamento. Um clique no X nao pode custar
  // uma tarde de trabalho sem nem avisar.
  janela.on('close', (ev) => {
    if (fechamentoAutorizado) return;

    const rodando = estado.todas().filter((s) => s.status === 'rodando').length;
    if (rodando === 0) return;

    ev.preventDefault();
    dialog.showMessageBox(janela, {
      type: 'warning',
      buttons: ['Fechar mesmo assim', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Fechar o orquestrador',
      message: `${rodando} ${rodando === 1 ? 'sessao esta' : 'sessoes estao'} rodando agora.`,
      detail: 'Fechar interrompe todas elas.\n\n'
        + 'O arranjo de painéis fica salvo: ao reabrir, eles voltam com um botao de retomar.',
    }).then(({ response }) => {
      if (response === 0) {
        fechamentoAutorizado = true;
        janela.close();
      }
    });
  });

  janela.on('closed', () => {
    terminais.fecharTodos();
    metricas.parar();
    janela = null;
  });

  terminais.definirJanela(janela);
  estado.definirJanela(janela);
  atualizacao.iniciar(janela);
  metricas.iniciar(janela);
  janela.loadFile(path.join(__dirname, '..', 'janela', 'index.html'));
}

app.whenReady().then(async () => {
  // ANTES de criar janela ou emitir notificacao: e este id que diz ao Windows
  // que a janela aberta e o atalho fixado sao a mesma coisa. Sem ele o Windows
  // usa o caminho do executavel como identidade, e no pacote `-sac` isso e
  // "electron.exe" -- que e literalmente outro programa aos olhos dele.
  app.setAppUserModelId(atalho.AUMID);

  // E o atalho tem de EXISTIR com esse id, senao o Windows joga fora as
  // notificacoes sem avisar. Ver o comentario em atalho.garantir().
  atalho.garantir();

  // Corte do historico UMA VEZ por arranque, antes de a janela pedir o resumo.
  try {
    historico.podar();
  } catch (err) {
    console.error('[historico] poda falhou:', err.message);
  }

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

// Sair pelo menu, pelo updater ou por Alt+F4 do sistema tambem chega aqui: a
// partir deste ponto o fechamento ja foi decidido e nao cabe mais perguntar.
app.on('before-quit', () => {
  fechamentoAutorizado = true;
  // ANTES de fechar os terminais: fecha os intervalos abertos no historico.
  // Sem isto, uma sessao aberta na sexta com o app fechado no fim de semana
  // apareceria como "trabalhou tres dias".
  estado.encerrarTodas();
  terminais.fecharTodos();
  eventos.parar();
  atualizacao.parar();
  metricas.parar();
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

ipcMain.handle('terminal:abrir', async (_e, { id, cwd, cols, rows, comando, args, env, feature }) => {
  const pasta = cwd || os.homedir();
  estado.registrar(id, { feature: feature || id, cwd: pasta });

  // Reserva ANTES de criar o PTY: as variaveis precisam existir no ambiente do
  // processo desde o nascimento, senao o dev server ja subiu na porta errada.
  //
  // A faixa sai do projeto dono da pasta, resolvida AQUI e nao na janela: assim
  // vale igual para painel de projeto, de worktree e avulso, sem cada chamador
  // ter de lembrar de passar.
  const bloco = await portas.reservar(id, projetos.faixaDe(pasta));

  const r = terminais.abrir({
    id,
    cwd: pasta,
    comando: comando || SHELL_PADRAO,
    args: args || [],
    cols,
    rows,
    env: { ...portas.comoEnv(bloco), ...env },
  });
  estado.definirStatus(id, 'rodando', 'shell aberto');
  return { ...r, portas: bloco };
});

ipcMain.on('terminal:escrever', (_e, { id, texto }) => terminais.escrever(id, texto));
ipcMain.on('terminal:redimensionar', (_e, { id, cols, rows }) => terminais.redimensionar(id, cols, rows));
ipcMain.on('terminal:fechar', (_e, { id }) => {
  terminais.fechar(id);
  estado.remover(id);
  portas.liberar(id);
});

ipcMain.handle('estado:todas', () => estado.todas());

// --------------------------------------------------------------- sessao

ipcMain.handle('sessao:carregar', () => sessao.carregar());
ipcMain.handle('sessao:salvar', (_e, paineis) => sessao.salvar(paineis));

// Quantas sessoes estao efetivamente trabalhando. E o numero que decide se
// fechar o app precisa de confirmacao.
ipcMain.handle('sessao:rodando', () => estado.todas().filter((s) => s.status === 'rodando').length);

// -------------------------------------------------------------- projetos

ipcMain.handle('projetos:listar', () => projetos.listar());

// Recebe o caminho ja escolhido, em vez de abrir o dialogo por dentro: separa
// a escolha da gravacao e deixa o fluxo testavel (o CDP nao dirige dialogo
// nativo do Windows).
ipcMain.handle('projetos:adicionar', (_e, caminho, faixa) => {
  try {
    const r = projetos.adicionar(caminho, faixa);
    return { ...r, projetos: projetos.listar() };
  } catch (err) {
    // O modal digita o caminho, entao pasta inexistente e erro de USO, nao de
    // programa: volta como texto para a tela mostrar, em vez de estourar no IPC.
    return { erro: err.message, projetos: projetos.listar() };
  }
});

// ------------------------------------------------------------- worktrees

ipcMain.handle('worktrees:listar', (_e, projeto) => worktrees.listar(projeto));

ipcMain.handle('worktrees:situacaoInclude', (_e, projeto) => worktrees.situacaoInclude(projeto));

ipcMain.handle('worktrees:diff', (_e, { projeto, caminho }) => worktrees.diff(projeto, caminho));

// Arquivar apaga trabalho de forma irreversivel. Tres portoes antes de mexer em
// qualquer coisa, e cada recusa diz QUAL deles impediu.
ipcMain.handle('worktrees:arquivar', async (_e, { projeto, caminho, confirmar = true } = {}) => {
  const norm = (p) => path.resolve(String(p || '')).toLowerCase();

  // Portao extra que o modulo nao tem como saber: painel deste app aberto na
  // pasta. O lock do Claude cobre a sessao; este cobre o terminal.
  const emUso = terminais.idsAbertos().some((id) => norm(terminais.cwdDe(id)) === norm(caminho));
  if (emUso) {
    return {
      ok: false,
      motivo: 'painel-aberto',
      texto: 'Ha um painel deste app aberto nesta pasta. Feche o painel antes de arquivar.',
    };
  }

  const alvo = worktrees.listar(projeto).find((w) => norm(w.caminho) === norm(caminho));
  const veredito = worktrees.podeArquivar(alvo);
  if (!veredito.pode) return { ok: false, ...veredito };

  if (confirmar) {
    const { response } = await dialog.showMessageBox(janela, {
      type: 'warning',
      buttons: ['Arquivar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Arquivar worktree',
      message: `Arquivar "${alvo.nome}"?`,
      detail:
        `Isto remove a pasta ${alvo.caminho}\n` +
        `e o branch ${alvo.branch}.\n\n` +
        'Conferido agora: nao ha sessao aberta, nao ha alteracao sem commit e nao ha commit ' +
        'fora da base. Ainda assim, isto nao tem desfazer.',
    });
    if (response !== 0) return { ok: false, motivo: 'cancelado', texto: '' };
  }

  return worktrees.arquivar(projeto, caminho);
});

// Cria arquivo novo no repositorio do usuario -- vai aparecer no git status
// dele, entao sempre pergunta antes.
ipcMain.handle('worktrees:criarInclude', async (_e, { projeto, linhas, confirmar = true } = {}) => {
  const alvo = (linhas && linhas.length) ? linhas : worktrees.situacaoInclude(projeto).candidatos;
  if (!alvo.length) return { ok: false, texto: 'Nada de ambiente ignorado para copiar.' };

  if (confirmar) {
    const { response } = await dialog.showMessageBox(janela, {
      type: 'question',
      buttons: ['Criar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Criar .worktreeinclude',
      message: 'Criar o .worktreeinclude neste projeto?',
      detail:
        `Arquivo: ${path.join(projeto, '.worktreeinclude')}\n\n` +
        `Vai listar: ${alvo.join(', ')}\n\n` +
        'Sem ele, cada worktree novo nasce sem esses arquivos e a aplicacao nao sobe la dentro. ' +
        'E um arquivo novo no seu repositorio e vai aparecer no git status.',
    });
    if (response !== 0) return { ok: false, cancelado: true };
  }

  const r = worktrees.criarInclude(projeto, alvo);
  return { ok: true, ...r };
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

ipcMain.handle('app:versao', () => app.getVersion());

// Os numeros que a tela de ajuda cita saem daqui, e nao digitados no texto:
// documentacao que repete constante a mao vira mentira na primeira mudanca.
ipcMain.handle('app:constantes', () => ({
  portaBase: portas.BASE,
  portasPorPainel: portas.POR_PAINEL,
  portaEventos: eventos.PORTA,
  pastaDados: arquivo.PASTA,
  arquivoHooks: instalarHooks.ARQ_SETTINGS,
}));

ipcMain.handle('ui:carregar', () => preferencias.carregar());

// Trocar de tema tem de repintar os botoes de janela junto: eles sao desenhados
// pelo Windows e nao enxergam o CSS. Sem isto, o tema claro fica com uma faixa
// preta no canto superior direito.
ipcMain.handle('ui:salvar', (_e, parcial) => {
  const ui = preferencias.salvar(parcial);
  if (janela && !janela.isDestroyed()) {
    const cores = CORES_TITULO[ui.tema] || CORES_TITULO.escuro;
    try {
      janela.setTitleBarOverlay({ ...cores, height: 38 });
    } catch { /* plataforma sem overlay: a faixa continua nossa, so os botoes nao */ }
    janela.setBackgroundColor(cores.color);
  }
  return ui;
});

ipcMain.handle('app:metricas', () => metricas.agora());

ipcMain.handle('historico:resumo', () => historico.resumo());

ipcMain.handle('layouts:listar', () => layouts.listar());
ipcMain.handle('layouts:salvar', (_e, layout) => {
  try {
    return { ok: true, layout: layouts.salvar(layout), layouts: layouts.listar() };
  } catch (err) {
    return { ok: false, erro: err.message, layouts: layouts.listar() };
  }
});
ipcMain.handle('layouts:remover', (_e, nome) => ({ ...layouts.remover(nome), layouts: layouts.listar() }));

ipcMain.handle('atalho:criar', () => atalho.criar());
ipcMain.handle('atalho:existe', () => atalho.existe());

ipcMain.handle('atualizacao:situacao', () => ({ ...atualizacao.situacao }));
ipcMain.handle('atualizacao:verificar', () => { atualizacao.verificar(); return true; });
ipcMain.handle('atualizacao:aplicar', (_e, opcoes) => atualizacao.aplicar(opcoes));

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
