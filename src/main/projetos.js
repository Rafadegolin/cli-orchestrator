'use strict';

// Cadastro de projetos: os caminhos que voce abre todo dia, salvos para nao
// ter que navegar no dialogo nativo toda vez.
//
// Sem banco de dados -- um JSON basta, na mesma pasta onde eventos.js ja grava
// a porta do servidor.

const fs = require('fs');
const path = require('path');

const arquivo = require('./arquivo');

const NOME = 'projetos.json';
const PASTA = arquivo.PASTA;
const ARQUIVO = arquivo.caminho(NOME);

const VERSAO = 1;

function chave(caminho) {
  // Windows nao diferencia maiusculas: C:\Proj e c:\proj sao a mesma pasta.
  return path.resolve(caminho).replace(/[\\/]+$/, '').toLowerCase();
}

function nomeCurto(caminho) {
  const partes = path.resolve(caminho).replace(/[\\/]+$/, '').split(/[\\/]/);
  return partes[partes.length - 1] || caminho;
}

function ler() {
  const bruto = arquivo.lerJson(NOME, {});
  return Array.isArray(bruto.projetos) ? bruto.projetos : [];
}

function gravar(projetos) {
  arquivo.gravarJson(NOME, { versao: VERSAO, projetos });
}

function ehRepositorio(caminho) {
  try {
    // .git e pasta no repo normal e ARQUIVO dentro de um worktree, entao nao
    // da para exigir que seja diretorio.
    return fs.existsSync(path.join(caminho, '.git'));
  } catch {
    return false;
  }
}

// Revalida na leitura, sem gravar: a pasta pode ter sido movida e o projeto
// pode ter virado repositorio git depois de cadastrado.
function listar() {
  return ler().map((p) => ({
    ...p,
    existe: fs.existsSync(p.caminho),
    git: ehRepositorio(p.caminho),
  }));
}

function adicionar(caminho) {
  if (!caminho) throw new Error('caminho vazio');

  const resolvido = path.resolve(caminho);
  if (!fs.existsSync(resolvido)) throw new Error(`pasta nao existe: ${resolvido}`);

  const projetos = ler();
  const k = chave(resolvido);
  const jaTem = projetos.find((p) => chave(p.caminho) === k);
  if (jaTem) return { projeto: jaTem, novo: false };

  const projeto = {
    id: `pj-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    caminho: resolvido,
    nome: nomeCurto(resolvido),
    adicionadoEm: new Date().toISOString(),
  };

  projetos.push(projeto);
  gravar(projetos);
  return { projeto, novo: true };
}

// Tira da lista. NAO toca na pasta em disco.
function remover(id) {
  const projetos = ler();
  const restantes = projetos.filter((p) => p.id !== id);
  if (restantes.length === projetos.length) return { removido: false };
  gravar(restantes);
  return { removido: true };
}

function renomear(id, nome) {
  const projetos = ler();
  const p = projetos.find((x) => x.id === id);
  if (!p) return { renomeado: false };
  p.nome = String(nome || '').trim() || nomeCurto(p.caminho);
  gravar(projetos);
  return { renomeado: true, nome: p.nome };
}

module.exports = { ARQUIVO, PASTA, listar, adicionar, remover, renomear, nomeCurto, ehRepositorio };
