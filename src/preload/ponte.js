'use strict';

// Expoe para a janela so o que ela precisa. Nada de ipcRenderer cru, nada de
// require: o node-pty vive inteiro no processo principal.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('orq', {
  escolherPasta: () => ipcRenderer.invoke('app:escolherPasta'),
  escolherPastas: () => ipcRenderer.invoke('app:escolherPastas'),
  pastaPadrao: () => ipcRenderer.invoke('app:pastaPadrao'),

  // O caminho de um File solto na janela. `file.path` deixou de existir no
  // Electron 32 e este app esta no 43, entao o unico jeito e o `webUtils` --
  // que funciona em preload mesmo com `sandbox: true`, que e como a janela sobe.
  caminhoDoArquivo: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },

  abrirTerminal: (opcoes) => ipcRenderer.invoke('terminal:abrir', opcoes),
  escrever: (id, texto) => ipcRenderer.send('terminal:escrever', { id, texto }),
  redimensionar: (id, cols, rows) => ipcRenderer.send('terminal:redimensionar', { id, cols, rows }),
  fecharTerminal: (id) => ipcRenderer.send('terminal:fechar', { id }),

  // O lote chega como [{ id, bytes: Uint8Array }] -- um envio por quadro com
  // todos os painéis juntos.
  aoReceberDados: (fn) => ipcRenderer.on('terminal:dados', (_e, lote) => fn(lote)),
  aoTerminar: (fn) => ipcRenderer.on('terminal:fim', (_e, info) => fn(info)),

  // Status vem como DIFF ({ id, status, motivo, desde, pergunta, tipo }), nunca
  // a lista toda.
  aoMudarEstado: (fn) => ipcRenderer.on('estado:diff', (_e, diff) => fn(diff)),
  estadoAtual: () => ipcRenderer.invoke('estado:todas'),

  // O que o farejador do Canal 1 leu na tela. Sem isto o processo principal nao
  // fica sabendo, e o hook seguinte nao consegue apagar o que a janela acendeu.
  estadoFarejado: (dados) => ipcRenderer.send('estado:farejado', dados),

  projetosListar: () => ipcRenderer.invoke('projetos:listar'),
  projetosConversas: (caminho) => ipcRenderer.invoke('projetos:conversas', caminho),
  projetosDefinirCor: (id, cor) => ipcRenderer.invoke('projetos:definirCor', { id, cor }),
  projetosAdicionarVarios: (caminhos) => ipcRenderer.invoke('projetos:adicionarVarios', caminhos),
  projetosAdicionar: (caminho, faixa) => ipcRenderer.invoke('projetos:adicionar', caminho, faixa),
  projetosRemover: (id, confirmar = true) => ipcRenderer.invoke('projetos:remover', { id, confirmar }),

  sessaoCarregar: () => ipcRenderer.invoke('sessao:carregar'),
  sessaoSalvar: (paineis) => ipcRenderer.invoke('sessao:salvar', paineis),
  sessaoRodando: () => ipcRenderer.invoke('sessao:rodando'),

  worktreesListar: (projeto) => ipcRenderer.invoke('worktrees:listar', projeto),
  worktreesArquivar: (projeto, caminho, confirmar = true) =>
    ipcRenderer.invoke('worktrees:arquivar', { projeto, caminho, confirmar }),
  worktreesDiff: (projeto, caminho) => ipcRenderer.invoke('worktrees:diff', { projeto, caminho }),
  worktreesTamanhos: (caminhos) => ipcRenderer.invoke('worktrees:tamanhos', caminhos),
  worktreesArquivarVarias: (projeto, caminhos, confirmar = true) =>
    ipcRenderer.invoke('worktrees:arquivarVarias', { projeto, caminhos, confirmar }),
  // Push, e nao invoke: o lote leva dezenas de segundos e quem espera precisa
  // ver que alguma coisa esta acontecendo.
  aoArquivarProgresso: (fn) => ipcRenderer.on('worktrees:progresso', (_e, p) => fn(p)),
  includeSituacao: (projeto) => ipcRenderer.invoke('worktrees:situacaoInclude', projeto),

  gitSituacao: (projeto) => ipcRenderer.invoke('git:situacao', projeto),
  gitBuscar: (projeto) => ipcRenderer.invoke('git:buscar', projeto),
  gitBuscarUm: (projeto) => ipcRenderer.invoke('git:buscarUm', projeto),
  gitBuscarTodos: () => ipcRenderer.invoke('git:buscarTodos'),
  gitEstado: () => ipcRenderer.invoke('git:estado'),
  // Push, no molde do `aoMudarUso`: o relogio da busca vive no processo
  // principal, entao quem sabe que a base ficou para tras e ele.
  aoMudarGit: (fn) => ipcRenderer.on('git:estado', (_e, lista) => fn(lista)),
  gitAtualizar: (projeto) => ipcRenderer.invoke('git:atualizar', projeto),
  includeCriar: (projeto, linhas, confirmar = true) =>
    ipcRenderer.invoke('worktrees:criarInclude', { projeto, linhas, confirmar }),

  atalhoCriar: () => ipcRenderer.invoke('atalho:criar'),
  atalhoExiste: () => ipcRenderer.invoke('atalho:existe'),

  hooksSituacao: () => ipcRenderer.invoke('hooks:situacao'),
  hooksInstalar: () => ipcRenderer.invoke('hooks:instalar'),
  hooksDesinstalar: () => ipcRenderer.invoke('hooks:desinstalar'),

  // Valor SINCRONO, e nao um invoke: quem monta comando de shell precisa da
  // resposta na hora do clique, e um `await` chegaria tarde. Em preload
  // sandboxed o `process` polifilado do Electron ainda traz o `platform`.
  plataforma: process.platform,

  versao: () => ipcRenderer.invoke('app:versao'),
  constantes: () => ipcRenderer.invoke('app:constantes'),

  // Tema, densidade e ordenacao. Salvar tambem repinta os botoes de janela, que
  // sao do Windows e nao enxergam o CSS.
  uiCarregar: () => ipcRenderer.invoke('ui:carregar'),
  uiSalvar: (parcial) => ipcRenderer.invoke('ui:salvar', parcial),

  metricas: () => ipcRenderer.invoke('app:metricas'),
  historico: () => ipcRenderer.invoke('historico:resumo'),

  // Uso do Claude Code. `uso()` traz so os quatro numeros do medidor do topo;
  // `usoDetalhe()` traz tambem a tabela por projeto, e por isso e sob demanda.
  uso: () => ipcRenderer.invoke('uso:situacao'),
  usoDetalhe: () => ipcRenderer.invoke('uso:detalhe'),
  aoMudarUso: (fn) => ipcRenderer.on('uso:estado', (_e, u) => fn(u)),

  layoutsListar: () => ipcRenderer.invoke('layouts:listar'),
  layoutsSalvar: (layout) => ipcRenderer.invoke('layouts:salvar', layout),
  layoutsRemover: (nome) => ipcRenderer.invoke('layouts:remover', nome),
  aoMedir: (fn) => ipcRenderer.on('app:metricas', (_e, m) => fn(m)),

  atualizacaoSituacao: () => ipcRenderer.invoke('atualizacao:situacao'),
  atualizacaoVerificar: () => ipcRenderer.invoke('atualizacao:verificar'),
  atualizacaoAplicar: (opcoes) => ipcRenderer.invoke('atualizacao:aplicar', opcoes),
  aoMudarAtualizacao: (fn) => ipcRenderer.on('atualizacao:estado', (_e, s) => fn(s)),

  notificar: (titulo, corpo) => ipcRenderer.send('app:notificar', { titulo, corpo }),
  estaFocado: () => ipcRenderer.invoke('app:estaFocado'),
  focarJanela: () => ipcRenderer.send('app:focar'),
  aoMudarFoco: (fn) => ipcRenderer.on('app:foco', (_e, focada) => fn(focada)),
});
