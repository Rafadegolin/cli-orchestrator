'use strict';

// Tema, densidade da grade e ordenacao -- as escolhas que o usuario faz uma vez
// e espera encontrar do jeito que deixou.
//
// Arquivo separado do sessao.json de proposito: o arranjo de painéis muda o
// tempo todo e e regravado com debounce; preferencia muda por clique e e rara.
// Juntar os dois faria toda troca de tema reescrever a lista de painéis.

const arquivo = require('./arquivo');

const NOME = 'ui.json';
const VERSAO = 1;

const PADRAO = {
  tema: 'escuro',
  densidade: 2,
  ordem: 'urgencia',
};

// Valor de arquivo nunca entra cru: um ui.json editado a mao com densidade 9
// quebraria o layout sem nenhuma mensagem que explicasse por que.
function normalizar(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  return {
    tema: b.tema === 'claro' ? 'claro' : 'escuro',
    densidade: [1, 2, 3].includes(Number(b.densidade)) ? Number(b.densidade) : PADRAO.densidade,
    ordem: b.ordem === 'projeto' ? 'projeto' : 'urgencia',
  };
}

function carregar() {
  return normalizar(arquivo.lerJson(NOME, {}).ui);
}

function salvar(parcial) {
  const atual = carregar();
  const novo = normalizar({ ...atual, ...(parcial || {}) });
  arquivo.gravarJson(NOME, { versao: VERSAO, ui: novo });
  return novo;
}

module.exports = { carregar, salvar, PADRAO, NOME };
