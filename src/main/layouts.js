'use strict';

// Layouts salvos: "modo revisao" com 2 painéis grandes, "modo tocaia" com 8
// pequenos.
//
// Um layout nao inventa estrutura nenhuma: e o retrato que o `retratoSessao()`
// da grade ja produz, mais as tres preferencias que o `ui.json` ja guarda. Por
// isso ficou barato depois da Fase 7 e do redesenho.

const arquivo = require('./arquivo');

const NOME = 'layouts.json';
const VERSAO = 1;

const MAX = 20;

// Normalizacao defensiva, como no sessao.js: o arquivo e do usuario e pode ter
// sido editado a mao, ou vir de uma versao futura.
function limparPainel(p, i) {
  return {
    feature: String(p.feature || ''),
    cwd: String(p.cwd || ''),
    comandoInicial: p.comandoInicial ? String(p.comandoInicial) : '',
    ligacoes: Array.isArray(p.ligacoes) ? [...new Set(p.ligacoes.map(String))] : [],
    ordem: Number.isFinite(p.ordem) ? p.ordem : i,
  };
}

function limpar(l, i) {
  return {
    nome: String(l.nome || `layout ${i + 1}`).trim().slice(0, 60),
    tema: l.tema === 'claro' ? 'claro' : 'escuro',
    // 'p' e o slot personalizado. Sem ele aqui, aplicar um layout salvo tirava o
    // usuario do modo personalizado em silencio -- caindo na densidade 2 sem
    // nada na tela explicando por que.
    densidade: l.densidade === 'p'
      ? 'p'
      : ([1, 2, 3].includes(Number(l.densidade)) ? Number(l.densidade) : 2),
    ordem: l.ordem === 'projeto' ? 'projeto' : 'urgencia',
    paineis: (Array.isArray(l.paineis) ? l.paineis : []).filter((p) => p && p.cwd).map(limparPainel),
    salvoEm: l.salvoEm || new Date().toISOString(),
  };
}

function listar() {
  const bruto = arquivo.lerJson(NOME, {});
  const lista = Array.isArray(bruto.layouts) ? bruto.layouts : [];
  return lista.filter((l) => l && l.nome).map(limpar);
}

function gravar(lista) {
  arquivo.gravarJson(NOME, { versao: VERSAO, layouts: lista.slice(0, MAX) });
  return lista;
}

// Salvar com um nome que ja existe SUBSTITUI aquele layout, em vez de criar um
// segundo com o mesmo nome -- dois "modo revisao" na lista seria a pior das
// duas opcoes.
function salvar(layout) {
  if (!layout || !String(layout.nome || '').trim()) throw new Error('layout precisa de nome');

  const novo = limpar({ ...layout, salvoEm: new Date().toISOString() }, 0);
  const lista = listar().filter((l) => l.nome.toLowerCase() !== novo.nome.toLowerCase());
  lista.unshift(novo);
  gravar(lista);
  return novo;
}

function remover(nome) {
  const alvo = String(nome || '').toLowerCase();
  const lista = listar();
  const restantes = lista.filter((l) => l.nome.toLowerCase() !== alvo);
  if (restantes.length === lista.length) return { removido: false };
  gravar(restantes);
  return { removido: true };
}

function obter(nome) {
  const alvo = String(nome || '').toLowerCase();
  return listar().find((l) => l.nome.toLowerCase() === alvo) || null;
}

module.exports = { NOME, MAX, listar, salvar, remover, obter };
