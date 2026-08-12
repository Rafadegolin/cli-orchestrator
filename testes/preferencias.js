'use strict';
// Preferencias (ui.json). Node puro, sem app: normalizacao nao precisa de janela.
//
// O que este teste existe para cobrar e uma coisa so: NADA vindo do arquivo
// entra cru. O ui.json e do usuario e pode ser editado a mao -- um molde com
// span de 90 colunas ou uma densidade que nao existe tem de virar valor padrao,
// e nao uma grade quebrada sem nenhuma mensagem que explique por que.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PASTA = path.join(os.tmpdir(), `orq-teste-prefs-${Date.now()}`);
process.env.ORQ_DADOS = PASTA;

const preferencias = require('../src/main/preferencias');

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
}

const gravarBruto = (ui) => fs.writeFileSync(
  path.join(PASTA, preferencias.NOME), JSON.stringify({ versao: 1, ui }), 'utf8');

(() => {
  fs.mkdirSync(PASTA, { recursive: true });

  // --- padroes -------------------------------------------------------------
  const padrao = preferencias.carregar();
  checar('sem arquivo, vem o padrao',
    padrao.tema === 'escuro' && padrao.densidade === 2 && padrao.ordem === 'urgencia',
    JSON.stringify({ t: padrao.tema, d: padrao.densidade, o: padrao.ordem }));
  checar('e o molde do personalizado ja vem montado',
    padrao.personalizado.cols === 3 && padrao.personalizado.celulas.length > 0,
    JSON.stringify(padrao.personalizado));

  // --- a quarta densidade nao e um numero ---------------------------------
  checar('o slot personalizado sobrevive ao salvar e reler',
    preferencias.salvar({ densidade: 'p' }).densidade === 'p', '');
  checar('e continua la depois de mexer em OUTRA preferencia',
    preferencias.salvar({ tema: 'claro' }).densidade === 'p', '');
  checar('densidade que nao existe cai no padrao',
    preferencias.salvar({ densidade: 9 }).densidade === 2, '');

  // --- a lateral recolhida -------------------------------------------------
  checar('a lateral nasce ABERTA', padrao.lateral === 'aberta', padrao.lateral);
  checar('recolher sobrevive ao salvar e reler',
    preferencias.salvar({ lateral: 'fechada' }).lateral === 'fechada', '');
  checar('valor torto de lateral volta para aberta',
    preferencias.salvar({ lateral: 'talvez' }).lateral === 'aberta', '');

  // --- o medidor de uso no topo -------------------------------------------
  checar('o medidor de uso nasce VISIVEL', padrao.uso === 'barras', String(padrao.uso));
  checar('esconder o medidor sobrevive ao salvar e reler',
    preferencias.salvar({ uso: 'oculto' }).uso === 'oculto', '');
  checar('valor torto de uso volta para barras',
    preferencias.salvar({ uso: 'as vezes' }).uso === 'barras', '');

  // --- o molde entra pela porta da normalizacao ---------------------------
  const salvo = preferencias.salvar({
    personalizado: { cols: 3, alturaLinha: 200, celulas: [{ c: 1, r: 2 }, { c: 2, r: 1 }] },
  });
  checar('o molde e gravado como veio, quando esta dentro dos limites',
    salvo.personalizado.alturaLinha === 200
    && salvo.personalizado.celulas.length === 2
    && salvo.personalizado.celulas[1].c === 2,
    JSON.stringify(salvo.personalizado));

  // --- ui.json editado a mao ----------------------------------------------
  gravarBruto({
    tema: 'roxo',
    densidade: 'q',
    ordem: 'qualquer',
    personalizado: {
      cols: 99,
      alturaLinha: 5000,
      // span maior que o numero de colunas cobriria a grade inteira; `r`
      // negativo somem a linha; entrada torta nao pode virar NaN no CSS.
      celulas: [{ c: 40, r: -3 }, { c: 'dois', r: 2 }, null],
    },
  });

  const torto = preferencias.carregar();
  checar('valor torto cai no padrao em vez de quebrar a tela',
    torto.tema === 'escuro' && torto.densidade === 2 && torto.ordem === 'urgencia',
    JSON.stringify({ t: torto.tema, d: torto.densidade, o: torto.ordem }));
  checar('colunas e altura do molde ficam dentro dos limites',
    torto.personalizado.cols === 6 && torto.personalizado.alturaLinha === 400,
    JSON.stringify({ c: torto.personalizado.cols, a: torto.personalizado.alturaLinha }));
  checar('nenhuma celula passa do numero de colunas nem fica menor que 1',
    torto.personalizado.celulas.every((c) => c.c >= 1 && c.c <= torto.personalizado.cols
      && c.r >= 1 && c.r <= 4),
    JSON.stringify(torto.personalizado.celulas));
  checar('e nenhum valor de celula vira NaN',
    torto.personalizado.celulas.every((c) => Number.isFinite(c.c) && Number.isFinite(c.r)),
    JSON.stringify(torto.personalizado.celulas));

  // --- molde ausente -------------------------------------------------------
  gravarBruto({ tema: 'claro' });
  const semMolde = preferencias.carregar();
  checar('ui.json de uma versao anterior (sem molde) abre com o molde padrao',
    semMolde.tema === 'claro' && semMolde.personalizado.cols === 3,
    JSON.stringify(semMolde.personalizado));

  fs.rmSync(PASTA, { recursive: true, force: true });

  console.log(falhas === 0 ? '\nPREFERENCIAS_OK' : `\nPREFERENCIAS_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
})();
