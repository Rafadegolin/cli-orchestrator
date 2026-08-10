'use strict';

// Expoe para a janela so o que ela precisa. Nada de ipcRenderer cru, nada de
// require: o node-pty vive inteiro no processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orq', {
  escolherPasta: () => ipcRenderer.invoke('app:escolherPasta'),
  pastaPadrao: () => ipcRenderer.invoke('app:pastaPadrao'),

  abrirTerminal: (opcoes) => ipcRenderer.invoke('terminal:abrir', opcoes),
  escrever: (id, texto) => ipcRenderer.send('terminal:escrever', { id, texto }),
  redimensionar: (id, cols, rows) => ipcRenderer.send('terminal:redimensionar', { id, cols, rows }),
  fecharTerminal: (id) => ipcRenderer.send('terminal:fechar', { id }),

  // O lote chega como [{ id, bytes: Uint8Array }] -- um envio por quadro com
  // todos os painéis juntos.
  aoReceberDados: (fn) => ipcRenderer.on('terminal:dados', (_e, lote) => fn(lote)),
  aoTerminar: (fn) => ipcRenderer.on('terminal:fim', (_e, info) => fn(info)),

  // Status vem como DIFF ({ id, status, motivo, desde }), nunca a lista toda.
  aoMudarEstado: (fn) => ipcRenderer.on('estado:diff', (_e, diff) => fn(diff)),
  estadoAtual: () => ipcRenderer.invoke('estado:todas'),

  projetosListar: () => ipcRenderer.invoke('projetos:listar'),
  projetosAdicionar: (caminho) => ipcRenderer.invoke('projetos:adicionar', caminho),
  projetosRemover: (id, confirmar = true) => ipcRenderer.invoke('projetos:remover', { id, confirmar }),

  hooksSituacao: () => ipcRenderer.invoke('hooks:situacao'),
  hooksInstalar: () => ipcRenderer.invoke('hooks:instalar'),
  hooksDesinstalar: () => ipcRenderer.invoke('hooks:desinstalar'),

  notificar: (titulo, corpo) => ipcRenderer.send('app:notificar', { titulo, corpo }),
  estaFocado: () => ipcRenderer.invoke('app:estaFocado'),
  focarJanela: () => ipcRenderer.send('app:focar'),
});
