'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
const uso = require('./uso');
const remoto = require('./remoto');
const avisos = require('./avisos');
const registro = require('./registro');

// Chamado pelo desinstalador (recursos/instalador.nsh) antes de apagar os
// arquivos. Tem de ser rapido e mudo: nada de janela, nada de dialogo -- o
// usuario esta olhando a barra de progresso do desinstalador.
//
// Sem isto, desinstalar o app deixaria os hooks no settings.json do Claude para
// sempre, e toda sessao passaria a pagar ~310ms por evento tentando falar com
// um app que nao existe mais.
// Fica com `includes`, de proposito, e vale registrar por que a alternativa foi
// recusada: exigir a flag na PRIMEIRA posicao parece mais seguro, mas se um dia
// o Electron puser qualquer coisa antes dela o desinstalador para de remover os
// hooks EM SILENCIO -- e ai eles ficam registrados para sempre, que e
// exatamente o que este bloco existe para evitar. O risco que a posicao evitaria
// (o relancamento da troca leve repassando argv) nao existe na pratica: um app
// lancado com esta flag sai antes de virar app.
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

// A rede de seguranca do processo principal.
//
// Este processo HOSPEDA as sessoes: quando ele morre, todas morrem junto, e o
// trabalho de horas vai com elas. E ate aqui nao havia nada -- um throw fora de
// um `ipcMain.handle` matava o app em silencio, sem dialogo, sem log, sem nada
// na tela. O caminho mais exposto era o `setImmediate` do `eventos.js`, que roda
// para todo hook que chega e nao tinha guarda nenhuma.
//
// Ela LOGA E NAO FAZ MAIS NADA. Nunca dialogo -- a mesma politica do updater e
// do `gitDeRede`: uma excecao que se repete viraria uma fila de caixas modais em
// cima de sessoes rodando, que e pior que o problema. Seguir com um modulo
// possivelmente inconsistente e estritamente melhor que derrubar tudo.
//
// O custo assumido: rede global MASCARA defeito. Por isso o prefixo e ruidoso e
// a stack inteira vai para o log.
function conterFalha(origem, err) {
  console.error(`[falha-contida] ${origem}:`, (err && err.stack) || err);
}

process.on('uncaughtException', (err) => conterFalha('uncaughtException', err));
process.on('unhandledRejection', (err) => conterFalha('unhandledRejection', err));

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

  // O aviso de sessao esperando so incomoda com a janela em segundo plano. Mas
  // uma sessao que comecou a esperar ENQUANTO voce olhava tambem precisa ser
  // avisada quando voce sai -- senao a unica chance de aviso e queimada, que era
  // o defeito. A janela conta os dois lados para o renderer.
  janela.on('blur', () => {
    if (janela && !janela.isDestroyed()) janela.webContents.send('app:foco', false);
  });
  janela.on('focus', () => {
    if (!janela || janela.isDestroyed()) return;
    // Voce olhou: para de piscar na barra de tarefas.
    janela.flashFrame(false);
    janela.webContents.send('app:foco', true);
  });

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
    uso.parar();
    remoto.parar();
    registro.parar();
    janela = null;
  });

  terminais.definirJanela(janela);
  estado.definirJanela(janela);
  avisos.definirJanela(janela);
  atualizacao.iniciar(janela);
  metricas.iniciar(janela);
  uso.iniciar(janela);
  remoto.iniciar(janela);
  registro.iniciar(janela);
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
  uso.parar();
  remoto.parar();
  registro.parar();
});

// ---------------------------------------------------------------- IPC

// Handler SEPARADO do `escolherPasta`, e nao um parametro nele: o "Painel
// avulso" (grade.js) depende do contrato de string unica, e trocar o retorno
// para array quebraria aquele caminho em silencio.
ipcMain.handle('app:escolherPastas', async () => {
  const r = await dialog.showOpenDialog(janela, {
    title: 'Escolha as pastas dos projetos',
    properties: ['openDirectory', 'multiSelections'],
    defaultPath: os.homedir(),
  });
  return r.canceled ? [] : r.filePaths;
});

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

// O farejador do Canal 1 (`aprovacao.js`) avisando o que leu na tela.
//
// ISTO EXISTE PORQUE HAVIA DOIS DONOS DA VERDADE, e o sintoma foi relatado como
// "o painel fica amarelo com o Claude trabalhando". O farejador acendia o
// amarelo so na JANELA (`OrqLateral.definirStatus`) e o processo principal
// seguia achando `rodando`. Quando o evento seguinte chegava, `aplicar()`
// comparava com o que ELE guardava, concluia "nao mudou nada" e nao emitia
// diff nenhum -- ou seja, o amarelo aceso pela janela nao tinha como ser
// apagado por hook nenhum, e ficava preso ate um `Stop`.
//
// `send` e nao `handle`: e notificacao. A resposta volta pelo `estado:diff` de
// sempre, que e o unico caminho por onde status chega na janela.
ipcMain.on('estado:farejado', (_e, { id, status, motivo, pergunta, tipo } = {}) => {
  if (!id || !status) return;
  estado.definirStatus(id, status, motivo || '', { pergunta, tipo });
});

// --------------------------------------------------------------- sessao

ipcMain.handle('sessao:carregar', () => sessao.carregar());
ipcMain.handle('sessao:salvar', (_e, paineis) => sessao.salvar(paineis));

// Quantas sessoes estao efetivamente trabalhando. E o numero que decide se
// fechar o app precisa de confirmacao.
ipcMain.handle('sessao:rodando', () => estado.todas().filter((s) => s.status === 'rodando').length);

// -------------------------------------------------------------- projetos

ipcMain.handle('projetos:listar', () => projetos.listar());
ipcMain.handle('projetos:conversas', (_e, caminho) => projetos.conversas(caminho));

ipcMain.handle('projetos:definirCor', (_e, { id, cor }) => ({
  ...projetos.definirCor(id, cor),
  projetos: projetos.listar(),
}));

ipcMain.handle('projetos:adicionarVarios', (_e, caminhos) => {
  const r = projetos.adicionarVarios(caminhos);
  return { ...r, projetos: projetos.listar() };
});

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

// Leitura pura, sem rede: quanto a base local esta atras do que ja foi buscado.
ipcMain.handle('git:situacao', (_e, projeto) => worktrees.situacaoRemoto(projeto));
// Esta toca a rede -- assincrona, com prazo, e proibida de pedir senha.
ipcMain.handle('git:buscar', (_e, projeto) => worktrees.buscar(projeto));
// Um projeto, com o piso de tempo do `remoto`: e o gatilho de expandir um card.
// Quem chama NAO espera o resultado -- o push `git:estado` corrige a tela quando
// o fetch voltar, e desenhar o card nunca pode depender de internet.
ipcMain.handle('git:buscarUm', async (_e, projeto) => {
  const r = await remoto.atualizarUm(projeto);
  remoto.emitir();
  return r;
});
// Todos, sem piso: e o "Buscar novidades no remoto" da paleta, pedido a mao.
ipcMain.handle('git:buscarTodos', () => remoto.tique({ forcar: true }));
ipcMain.handle('git:estado', () => remoto.agora());
// Escreve no checkout do usuario, mas so por fast-forward: sem dialogo porque
// `--ff-only` nao tem como estragar nada -- ou avanca, ou recusa com motivo.
ipcMain.handle('git:atualizar', (_e, projeto) => worktrees.atualizar(projeto));

ipcMain.handle('worktrees:diff', (_e, { projeto, caminho }) => worktrees.diff(projeto, caminho));

// Quanto cada worktree ocupa. Separado do `listar` porque e caro: somar bytes
// de um checkout com node_modules sao dezenas de milhares de stat, e o `listar`
// roda ao expandir um projeto. Aqui e sob demanda -- so a tela de limpeza pede.
// Orcamento do LOTE, e nao por item. O teto de 8s do `tamanhoDe` e por pasta:
// com dez worktrees isso virava 80 segundos varrendo disco e saturando o
// threadpool do libuv -- a tela ja ficava lenta antes mesmo de alguem clicar em
// arquivar. Repartir o que sobra mantem a promessa do modulo (numero aproximado
// que se declara parcial) sem deixar a duracao crescer com a lista.
const MS_TAMANHOS_LOTE = 12_000;

ipcMain.handle('worktrees:tamanhos', async (_e, caminhos) => {
  const alvos = Array.isArray(caminhos) ? caminhos : [];
  const saida = {};
  const limite = Date.now() + MS_TAMANHOS_LOTE;
  // Sequencial: sao varias arvores grandes no MESMO disco, e disparar todas
  // juntas so faz a cabeca do disco brigar consigo mesma.
  for (const c of alvos) {
    // Piso de 500ms: com o orcamento estourado o certo e cada uma ainda se
    // declarar parcial, e nao devolver zero como se a pasta estivesse vazia.
    const ms = Math.max(500, limite - Date.now());
    saida[c] = await worktrees.tamanhoDe(c, { ms: Math.min(ms, worktrees.MS_TAMANHO) });
  }
  return saida;
});

// Arquivar VARIAS de uma vez.
//
// Nao e um laco de `worktrees:arquivar`, pela mesma razao que
// `projetos.adicionarVarios` existe: um alvo problematico nao pode derrubar o
// lote, e N dialogos nativos seguidos seriam N chances de clicar no automatico.
// Um dialogo so, que NOMEIA tudo que vai embora, e cada recusa volta com motivo.
ipcMain.handle('worktrees:arquivarVarias', async (evento, { projeto, caminhos, confirmar = true } = {}) => {
  const pedidos = Array.isArray(caminhos) ? caminhos : [];
  if (!pedidos.length) return { ok: false, arquivadas: [], recusadas: [] };

  // A janela de QUEM PEDIU, e nao a global `janela` -- que e zerada no `closed`.
  // Um lote leva dezenas de segundos, e nesse intervalo a janela pode morrer:
  // com a global, o `showMessageBox` receberia `null` e estouraria.
  const dono = BrowserWindow.fromWebContents(evento.sender);
  const vivo = () => dono && !dono.isDestroyed() && !dono.webContents.isDestroyed();

  // O portao que so o main conhece: painel deste app aberto na pasta. O lock do
  // Claude cobre a sessao; este cobre o terminal.
  const bloqueados = terminais.idsAbertos().map((id) => terminais.cwdDe(id)).filter(Boolean);
  const { aptas, recusadas } = worktrees.triarLote(projeto, pedidos, { bloqueados });

  if (!aptas.length) return { ok: false, arquivadas: [], recusadas };

  if (confirmar) {
    const linhas = aptas.map((w) => {
      const extra = w.ignorados?.length ? `  (+ ${w.ignorados.join(', ')})` : '';
      return `  ${w.nome}  —  ${w.branch}${extra}`;
    });
    // Os ignorados NOMEADOS, como no dialogo de uma so: o git nao os enxerga e
    // o `worktree remove` os apaga assim mesmo. Em lote isso pesa mais, nao
    // menos.
    const comIgnorados = aptas.filter((w) => w.ignorados?.length).length;

    const { response } = await dialog.showMessageBox(dono, {
      type: 'warning',
      buttons: ['Arquivar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Arquivar worktrees',
      message: aptas.length === 1
        ? `Arquivar "${aptas[0].nome}"?`
        : `Arquivar ${aptas.length} worktrees?`,
      detail:
        'Isto remove a pasta e o branch de cada uma:\n\n' +
        `${linhas.join('\n')}\n\n` +
        (comIgnorados
          ? `Os itens entre parenteses sao arquivos que o git ignora e que nenhum commit guarda.\n\n`
          : '') +
        'Conferido agora: nenhuma tem sessao aberta, alteracao sem commit ou commit fora da ' +
        'base. Ainda assim, isto nao tem desfazer.',
    });
    if (response !== 0) return { ok: false, cancelado: true, arquivadas: [], recusadas };
  }

  // O progresso existe porque o lote leva dezenas de segundos e ate agora a
  // unica pista era o texto do botao virar `arquivando...`. Quem monta o evento
  // e o modulo; aqui so se repassa para a janela que pediu.
  const r = await worktrees.arquivarVarias(projeto, aptas.map((w) => w.caminho), {
    aoProgresso: (p) => { if (vivo()) dono.webContents.send('worktrees:progresso', p); },
  });
  // As recusas da triagem e as da execucao contam a mesma historia para quem
  // esta olhando: uma lista so.
  return { ...r, recusadas: [...recusadas, ...r.recusadas] };
});

// Arquivar apaga trabalho de forma irreversivel. Tres portoes antes de mexer em
// qualquer coisa, e cada recusa diz QUAL deles impediu.
ipcMain.handle('worktrees:arquivar', async (_e, { projeto, caminho, confirmar = true } = {}) => {
  // Portao extra que o modulo nao tem como saber: painel deste app aberto na
  // pasta. O lock do Claude cobre a sessao; este cobre o terminal.
  //
  // `dentroDe`, e nao igualdade: um painel aberto numa SUBPASTA do worktree
  // passava aqui, e o `worktree remove` apagava a pasta debaixo dele.
  const emUso = terminais.idsAbertos()
    .some((id) => worktrees.dentroDe(caminho, terminais.cwdDe(id)));
  if (emUso) {
    return {
      ok: false,
      motivo: 'painel-aberto',
      texto: 'Ha um painel deste app aberto dentro desta pasta. Feche o painel antes de arquivar.',
    };
  }

  // Precisa dos `ignorados`, que o dialogo NOMEIA -- entao aqui e `listar`
  // mesmo, e nao o `lerUma` do caminho de lote.
  const alvo = worktrees.listar(projeto).find((w) => worktrees.mesmoCaminho(w.caminho, caminho));
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
        // Os ignorados NOMEADOS. O `git status` nao os enxerga, entao os
        // portoes acima nao os cobrem -- e o `worktree remove` apaga assim
        // mesmo. Nao bloqueia: so para de apagar em silencio.
        (alvo.ignorados?.length
          ? `Isto tambem apaga ${alvo.ignorados.length} ${alvo.ignorados.length === 1
            ? 'arquivo que o git ignora' : 'arquivos que o git ignora'}, `
            + `e que nenhum commit guarda:\n${alvo.ignorados.join(', ')}\n\n`
          : '') +
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
  minutosUso: Math.round(uso.MS_ENTRE / 60000),
  minutosBusca: Math.round(remoto.MS_ENTRE / 60000),
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

// Os quatro numeros do medidor do topo. `detalhe` traz junto a tabela por
// projeto, que e grande e so o overlay precisa.
ipcMain.handle('uso:situacao', () => uso.agora());
ipcMain.handle('uso:detalhe', () => uso.detalhe());

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

// Delegador: o piscar, o toast e o portao da preferencia vivem no `avisos.js`,
// que e o mesmo caminho do aviso de atualizacao.
ipcMain.on('app:notificar', (_e, { titulo, corpo }) => avisos.notificar({ titulo, corpo }));

// --------------------------------------------------------- hooks do Claude

ipcMain.handle('hooks:situacao', () => ({
  ...instalarHooks.situacao(),
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
