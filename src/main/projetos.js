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

// Faixa valida e um par de inteiros crescente com espaco para pelo menos um
// bloco. Valor torto no JSON (editado a mao, ou de uma versao futura) nao pode
// derrubar a reserva de portas -- cai no padrao e segue.
function faixaValida(f) {
  return Array.isArray(f) && f.length === 2
    && Number.isInteger(f[0]) && Number.isInteger(f[1])
    && f[0] > 0 && f[1] > f[0];
}

function adicionar(caminho, faixa) {
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
  if (faixaValida(faixa)) projeto.faixa = [faixa[0], faixa[1]];

  projetos.push(projeto);
  gravar(projetos);
  return { projeto, novo: true };
}

// Qual projeto e dono de uma pasta.
//
// Casa pelo prefixo MAIS ESPECIFICO: um worktree vive em
// <projeto>/.claude/worktrees/<feat> e pertence ao projeto, e com dois projetos
// aninhados o de dentro ganha.
//
// Mora aqui, e nao na janela, porque quem precisa disso e o processo principal:
// a faixa de portas na hora de abrir o PTY e o historico na hora de gravar a
// transicao. Uma regra so, usada pelos dois.
function donoDe(caminho) {
  const alvo = chave(String(caminho || '.'));
  let melhor = null;

  for (const p of ler()) {
    const base = chave(p.caminho);
    const dentro = alvo === base || alvo.startsWith(base + path.sep);
    if (dentro && (!melhor || base.length > chave(melhor.caminho).length)) melhor = p;
  }
  return melhor;
}

// A qual faixa de portas uma pasta pertence. `null` quando o projeto nao existe
// ou nao escolheu faixa -- quem chama cai na padrao.
function faixaDe(caminho) {
  const dono = donoDe(caminho);
  return dono && faixaValida(dono.faixa) ? dono.faixa : null;
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

module.exports = {
  ARQUIVO, PASTA, listar, adicionar, remover, renomear, nomeCurto, ehRepositorio,
  faixaDe, faixaValida, donoDe,
};
