'use strict';

// O arranjo de painéis, para fechar o app e voltar ao mesmo lugar.
//
// NAO guarda a saida dos terminais. Seriam 3000 linhas por painel, e restaurar
// texto morto daria a impressao falsa de uma sessao viva -- pior que voltar com
// o painel visivelmente vazio esperando voce retomar.
//
// Tambem NAO mantem processo vivo com o app fechado: isso viraria um servico em
// segundo plano, com uma classe inteira de problemas nova (processo orfao,
// sessao zumbi comendo CPU). A spec e explicita em deixar isso de fora.

const fs = require('fs');
const path = require('path');

const arquivo = require('./arquivo');

const NOME = 'sessao.json';
const VERSAO = 1;

function carregar() {
  const bruto = arquivo.lerJson(NOME, {});
  const paineis = Array.isArray(bruto.paineis) ? bruto.paineis : [];

  return paineis
    .filter((p) => p && p.cwd)
    .map((p, i) => ({
      feature: String(p.feature || ''),
      cwd: String(p.cwd),
      comandoInicial: p.comandoInicial ? String(p.comandoInicial) : '',
      // Painel de shell puro ('terminal') ou sessao do Claude. Lista branca:
      // o arquivo e do usuario e pode ser editado a mao.
      tipoPainel: p.tipoPainel === 'terminal' ? 'terminal' : 'sessao',
      // Ligacoes sao caminhos de pasta: sobrevivem ao fechar e reabrir, ao
      // contrario de id de painel.
      ligacoes: Array.isArray(p.ligacoes) ? p.ligacoes.map(String) : [],
      // As que o CLI ainda nao aceitou. Sem elas no disco, reabrir o app
      // transformava toda ligacao pendente em "aplicada" na interface.
      ligacoesPendentes: Array.isArray(p.ligacoesPendentes) ? p.ligacoesPendentes.map(String) : [],
      ordem: Number.isFinite(p.ordem) ? p.ordem : i,
      // Posicao no mapa. `null` significa "nunca foi arrastado" -- e o mapa
      // arruma sozinho, em vez de empilhar tudo no canto superior esquerdo.
      x: Number.isFinite(p.x) ? p.x : null,
      y: Number.isFinite(p.y) ? p.y : null,
      // Tamanho no mapa, na mesma logica: `null` e "nunca foi redimensionado",
      // e o mapa aplica o tamanho padrao. E o que faz um sessao.json gravado
      // por uma versao anterior abrir sem nenhum tratamento especial.
      w: Number.isFinite(p.w) ? p.w : null,
      h: Number.isFinite(p.h) ? p.h : null,
      // A pasta pode ter sumido enquanto o app estava fechado (worktree
      // arquivado, projeto movido). Abrir PTY ali so produz erro cru de spawn,
      // entao a janela precisa saber disso antes de tentar.
      existe: fs.existsSync(p.cwd),
    }))
    .sort((a, b) => a.ordem - b.ordem);
}

function salvar(paineis) {
  const limpos = (Array.isArray(paineis) ? paineis : [])
    .filter((p) => p && p.cwd)
    .map((p, i) => ({
      feature: String(p.feature || path.basename(String(p.cwd))),
      cwd: path.resolve(String(p.cwd)),
      comandoInicial: p.comandoInicial ? String(p.comandoInicial) : '',
      // Painel de shell puro ('terminal') ou sessao do Claude. Lista branca:
      // o arquivo e do usuario e pode ser editado a mao.
      tipoPainel: p.tipoPainel === 'terminal' ? 'terminal' : 'sessao',
      ligacoes: Array.isArray(p.ligacoes) ? [...new Set(p.ligacoes.map(String))] : [],
      ligacoesPendentes: Array.isArray(p.ligacoesPendentes)
        ? [...new Set(p.ligacoesPendentes.map(String))] : [],
      ordem: Number.isFinite(p.ordem) ? p.ordem : i,
      x: Number.isFinite(p.x) ? Math.round(p.x) : null,
      y: Number.isFinite(p.y) ? Math.round(p.y) : null,
      w: Number.isFinite(p.w) ? Math.round(p.w) : null,
      h: Number.isFinite(p.h) ? Math.round(p.h) : null,
    }));

  arquivo.gravarJson(NOME, {
    versao: VERSAO,
    salvoEm: new Date().toISOString(),
    paineis: limpos,
  });

  return { quantidade: limpos.length };
}

function limpar() {
  return salvar([]);
}

module.exports = { NOME, ARQUIVO: arquivo.caminho(NOME), carregar, salvar, limpar };
