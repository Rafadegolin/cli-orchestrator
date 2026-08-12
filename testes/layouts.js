'use strict';
// Layouts salvos. Node puro, sem app: gravacao, leitura e normalizacao nao
// precisam de janela para serem conferidas.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PASTA = path.join(os.tmpdir(), `orq-teste-layouts-${Date.now()}`);
process.env.ORQ_DADOS = PASTA;

const layouts = require('../src/main/layouts');

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
}

const painel = (feature, cwd) => ({ feature, cwd, comandoInicial: 'cls && claude', ligacoes: [] });

(() => {
  fs.mkdirSync(PASTA, { recursive: true });

  checar('sem arquivo, a lista vem vazia', layouts.listar().length === 0, '');

  // --- salvar e ler -------------------------------------------------------
  layouts.salvar({
    nome: 'revisao',
    tema: 'claro',
    densidade: 1,
    ordem: 'projeto',
    paineis: [painel('a', 'C:/x'), painel('b', 'C:/y')],
  });
  layouts.salvar({
    nome: 'tocaia',
    tema: 'escuro',
    densidade: 3,
    ordem: 'urgencia',
    paineis: [painel('c', 'C:/z')],
  });

  const lista = layouts.listar();
  checar('grava os dois', lista.length === 2, lista.map((l) => l.nome).join(','));

  const revisao = layouts.obter('revisao');
  checar('guarda tema, densidade e ordenacao',
    revisao.tema === 'claro' && revisao.densidade === 1 && revisao.ordem === 'projeto',
    JSON.stringify({ t: revisao.tema, d: revisao.densidade, o: revisao.ordem }));
  checar('e os painéis', revisao.paineis.length === 2, String(revisao.paineis.length));

  // --- gravar por cima do mesmo nome SUBSTITUI ---------------------------
  layouts.salvar({ nome: 'revisao', tema: 'escuro', densidade: 2, ordem: 'urgencia', paineis: [painel('so-um', 'C:/w')] });
  checar('salvar com nome repetido substitui em vez de duplicar',
    layouts.listar().filter((l) => l.nome === 'revisao').length === 1,
    layouts.listar().map((l) => l.nome).join(','));
  checar('e o conteudo e o novo', layouts.obter('revisao').paineis.length === 1,
    String(layouts.obter('revisao').paineis.length));
  checar('sem perder o outro layout', Boolean(layouts.obter('tocaia')), '');

  // --- normalizacao defensiva --------------------------------------------
  fs.writeFileSync(path.join(PASTA, layouts.NOME), JSON.stringify({
    versao: 1,
    layouts: [
      { nome: 'torto', tema: 'roxo', densidade: 9, ordem: 'qualquer', paineis: 'nao e lista' },
      { semNome: true },
      { nome: 'ok', tema: 'claro', densidade: 2, ordem: 'projeto', paineis: [{ cwd: 'C:/a' }, { feature: 'sem cwd' }] },
    ],
  }), 'utf8');

  const normal = layouts.listar();
  checar('layout sem nome e descartado', normal.length === 2, normal.map((l) => l.nome).join(','));

  const torto = layouts.obter('torto');
  checar('valor torto cai no padrao em vez de quebrar a tela',
    torto.tema === 'escuro' && torto.densidade === 2 && torto.ordem === 'urgencia'
    && Array.isArray(torto.paineis) && torto.paineis.length === 0,
    JSON.stringify({ t: torto.tema, d: torto.densidade, o: torto.ordem, p: torto.paineis.length }));

  checar('painel sem cwd e descartado, com cwd sobrevive',
    layouts.obter('ok').paineis.length === 1, String(layouts.obter('ok').paineis.length));

  // --- a densidade personalizada nao e um numero -------------------------
  // Sem 'p' na lista branca, aplicar um layout salvo no slot personalizado
  // devolvia o usuario para a densidade 2 sem nada explicando por que.
  layouts.salvar({ nome: 'custom', tema: 'escuro', densidade: 'p', ordem: 'urgencia', paineis: [painel('d', 'C:/k')] });
  checar('o slot personalizado sobrevive ao salvar e reler',
    layouts.obter('custom').densidade === 'p', String(layouts.obter('custom').densidade));

  // --- remover ------------------------------------------------------------
  checar('remover tira da lista', layouts.remover('torto').removido === true, '');
  checar('e nome que nao existe nao finge que removeu',
    layouts.remover('nunca-existiu').removido === false, '');

  // --- nome vazio nao vira layout ----------------------------------------
  let recusou = false;
  try { layouts.salvar({ nome: '   ', paineis: [] }); } catch { recusou = true; }
  checar('layout sem nome e recusado', recusou, '');

  fs.rmSync(PASTA, { recursive: true, force: true });

  console.log(falhas === 0 ? '\nLAYOUTS_OK' : `\nLAYOUTS_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
})();
