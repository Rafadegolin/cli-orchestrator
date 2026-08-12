'use strict';

// Cadastro de projetos: os caminhos que voce abre todo dia, salvos para nao
// ter que navegar no dialogo nativo toda vez.
//
// Sem banco de dados -- um JSON basta, na mesma pasta onde eventos.js ja grava
// a porta do servidor.

const fs = require('fs');
const os = require('os');
const path = require('path');

const arquivo = require('./arquivo');
const claude = require('./claude-dados');

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
    // Valor torto no JSON (editado a mao) nao pode pintar o painel de nada:
    // sem cor valida, a janela volta a sortear pelo caminho.
    cor: corValida(p.cor) ? Number(p.cor) : null,
    existe: fs.existsSync(p.caminho),
    git: ehRepositorio(p.caminho),
  }));
}

// A cor do projeto, 1..CORES, casando com `--proj-N` do estilo.css.
//
// Guardar o INDICE e nao o valor da cor: o token e quem decide o tom em cada
// tema, e um `#a78bfa` gravado aqui ficaria errado no tema claro para sempre.
const CORES = 10;

function corValida(c) {
  const n = Number(c);
  return Number.isInteger(n) && n >= 1 && n <= CORES;
}

// A cor MENOS usada hoje. Projeto novo nasce com ela em vez de sorteada: com
// dez tons e hash, duas pastas caindo na mesma cor e questao de tempo -- e foi
// relatado. Isto nao mexe em quem ja esta cadastrado.
function proximaCor(extras = []) {
  const uso = new Array(CORES + 1).fill(0);
  for (const p of [...ler(), ...extras]) {
    if (corValida(p.cor)) uso[Number(p.cor)] += 1;
  }
  let melhor = 1;
  for (let i = 2; i <= CORES; i++) if (uso[i] < uso[melhor]) melhor = i;
  return melhor;
}

// `null` volta para a cor automatica (sorteada pelo caminho).
function definirCor(id, cor) {
  const projetos = ler();
  const p = projetos.find((x) => x.id === id);
  if (!p) return { ok: false, erro: 'projeto nao encontrado' };

  if (cor === null || cor === undefined) delete p.cor;
  else if (corValida(cor)) p.cor = Number(cor);
  else return { ok: false, erro: `cor invalida: ${cor}` };

  gravar(projetos);
  return { ok: true, projeto: p };
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
    cor: proximaCor(),
    adicionadoEm: new Date().toISOString(),
  };
  if (faixaValida(faixa)) projeto.faixa = [faixa[0], faixa[1]];

  projetos.push(projeto);
  gravar(projetos);
  return { projeto, novo: true };
}

// A proxima faixa de 100 portas livre, a partir de 3100.
//
// O cadastro de um projeto so oferece tres faixas fixas; dez projetos de uma vez
// nao cabem nelas. Aqui a faixa sai sozinha, pulando o que ja esta em uso.
const FAIXA_BASE = 3100;
const FAIXA_TAMANHO = 100;

function proximaFaixa(extras = []) {
  const usadas = [...ler(), ...extras]
    .map((p) => p.faixa)
    .filter(faixaValida)
    .map((f) => f[0]);

  for (let inicio = FAIXA_BASE; inicio < 65000; inicio += FAIXA_TAMANHO) {
    if (!usadas.includes(inicio)) return [inicio, inicio + FAIXA_TAMANHO - 1];
  }
  return null;
}

// Cadastra um LOTE, com UMA gravacao so.
//
// Duas coisas que o `adicionar` sozinho num laco nao daria:
//  - `gravar()` reescreve o arquivo inteiro, entao N projetos seriam N ciclos
//    de leitura e escrita atomica;
//  - `adicionar` LANCA quando a pasta nao existe, e um caminho ruim derrubaria
//    o lote inteiro. Aqui cada recusa e um item do relatorio, e o resto entra.
function adicionarVarios(caminhos) {
  const projetos = ler();
  const novos = [];
  const jaExistiam = [];
  const recusados = [];

  for (const bruto of caminhos || []) {
    const resolvido = bruto ? path.resolve(String(bruto)) : '';
    if (!resolvido) { recusados.push({ caminho: String(bruto), motivo: 'caminho vazio' }); continue; }
    if (!fs.existsSync(resolvido)) {
      recusados.push({ caminho: resolvido, motivo: 'pasta nao existe' });
      continue;
    }

    const k = chave(resolvido);
    if ([...projetos, ...novos].some((p) => chave(p.caminho) === k)) {
      jaExistiam.push(resolvido);
      continue;
    }

    const faixa = proximaFaixa(novos);
    const projeto = {
      // O sufixo aleatorio sozinho carregaria a unicidade quando varios entram
      // no mesmo milissegundo; o indice fecha a conta.
      id: `pj-${Date.now().toString(36)}-${novos.length}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      caminho: resolvido,
      nome: nomeCurto(resolvido),
      // `novos` entra na conta: importar dez de uma vez tem de espalhar as
      // cores entre eles, e nao dar a mesma para todos.
      cor: proximaCor(novos),
      adicionadoEm: new Date().toISOString(),
    };
    if (faixa) projeto.faixa = faixa;
    novos.push(projeto);
  }

  if (novos.length) gravar([...projetos, ...novos]);
  return { novos, jaExistiam, recusados };
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

// Quantas conversas o Claude Code ja guardou para esta pasta.
//
// A mecanica (onde fica a pasta e como o caminho e codificado) mora no
// `claude-dados.js`, que e o unico lugar do app que conhece o layout interno do
// CLI. Se ele mudar, a contagem vira zero e o app so deixa de oferecer o
// "retomar" -- degrada sem quebrar.
//
// Ressalva: worktree tem pasta propria, porque o cwd e outro. A contagem de um
// projeto nao inclui as conversas das worktrees dele.
function conversas(caminho) {
  return claude.conversas(caminho);
}

module.exports = {
  conversas,
  adicionarVarios,
  proximaFaixa,
  CORES,
  corValida,
  proximaCor,
  definirCor,
  ARQUIVO, PASTA, listar, adicionar, remover, renomear, nomeCurto, ehRepositorio,
  faixaDe, faixaValida, donoDe,
};
