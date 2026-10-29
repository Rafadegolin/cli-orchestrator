'use strict';

// Onde o token pessoal do Pronix Flow mora entre uma execucao e outra.
//
// Cifrado pelo `safeStorage` do Electron (DPAPI no Windows, Chaveiro no macOS),
// e o arquivo so guarda o texto cifrado: a regra da Fase 10 era "nunca em
// arquivo nosso em texto puro, nunca em log". Sem cifra disponivel, o app
// RECUSA guardar, em vez de cair para texto puro calado -- e o tipo de
// "melhoria" que transforma uma garantia em nenhuma.
//
// O token decifrado nao fica em memoria: e lido no instante de cada consulta e
// entregue ao `flow.buscarInbox`, como o do medidor de uso. A janela nunca o
// recebe -- `situacao()` diz se ha um, e de onde, e so.

const { safeStorage } = require('electron');
const fs = require('fs');
const arquivo = require('./arquivo');
const flow = require('./flow');

const NOME = 'flow.json';
const VERSAO = 1;

function lerArquivo() {
  const d = arquivo.lerJson(NOME, null);
  return d && typeof d === 'object' && typeof d.token === 'string' ? d : null;
}

function situacao() {
  const d = lerArquivo();
  return { conectado: Boolean(d), base: (d && flow.normalizarBase(d.base)) || flow.normalizarBase('') };
}

// `{ base, token }`, ou `null` quando nao ha credencial ou ela nao decifra
// (perfil do Windows trocado, Chaveiro negado). Nunca estoura.
function ler() {
  const d = lerArquivo();
  if (!d) return null;
  try {
    const token = safeStorage.decryptString(Buffer.from(d.token, 'base64'));
    return { base: flow.normalizarBase(d.base), token };
  } catch {
    return null;
  }
}

function gravar(base, token) {
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, texto: 'o sistema não ofereceu cifra para guardar o token' };
  }
  const cifrado = safeStorage.encryptString(String(token).trim()).toString('base64');
  arquivo.gravarJson(NOME, { versao: VERSAO, base, token: cifrado });
  return { ok: true };
}

function apagar() {
  try { fs.unlinkSync(arquivo.caminho(NOME)); } catch { /* ja nao existia */ }
}

module.exports = { situacao, ler, gravar, apagar, NOME };
