'use strict';
// Historico de tempo por feature. Node puro, sem app: a agregacao e onde o erro
// se esconde, e ela nao precisa de janela nenhuma para ser conferida.
//
// O teste que mais importa e o do INTERVALO SEM FECHAMENTO. Sem ele, uma sessao
// aberta na sexta com o app fechado no fim de semana viraria "trabalhou tres
// dias" -- e um numero inflado e pior que nenhum numero, porque parece util.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PASTA = path.join(os.tmpdir(), `orq-teste-historico-${Date.now()}`);
process.env.ORQ_DADOS = PASTA;

// Depois do ORQ_DADOS: arquivo.js le a variavel na carga.
const historico = require('../src/main/historico');

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
}

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);

function ev(t, id, feature, projeto, de, para) {
  return { t, id, feature, projeto, de, para };
}

(() => {
  fs.mkdirSync(PASTA, { recursive: true });

  // --- 1. soma de tempo por estado ---------------------------------------
  //
  // rodando 10min -> esperando 5min -> rodando 20min -> fim.
  const basico = historico.resumo([
    ev(T0, 'p1', 'auth', 'api', '', 'rodando'),
    ev(T0 + 10 * MIN, 'p1', 'auth', 'api', 'rodando', 'esperando'),
    ev(T0 + 15 * MIN, 'p1', 'auth', 'api', 'esperando', 'rodando'),
    ev(T0 + 35 * MIN, 'p1', 'auth', 'api', 'rodando', null),
  ]);
  checar('agrega uma sessao', basico.length === 1, JSON.stringify(basico.map((r) => r.feature)));
  checar('soma o tempo trabalhando', basico[0].trabalhando === 30 * MIN,
    `${basico[0].trabalhando / MIN}min`);
  checar('soma o tempo esperando por voce', basico[0].esperando === 5 * MIN,
    `${basico[0].esperando / MIN}min`);
  checar('conta as interrupcoes', basico[0].interrupcoes === 1, String(basico[0].interrupcoes));

  // --- 2. O TESTE CENTRAL: intervalo sem fechamento nao conta -------------
  const aberto = historico.resumo([
    ev(T0, 'p1', 'solta', 'api', '', 'rodando'),
    // e o app caiu aqui. Tres dias depois, outra sessao qualquer:
    ev(T0 + 3 * 24 * 60 * MIN, 'p2', 'outra', 'api', '', 'rodando'),
    ev(T0 + 3 * 24 * 60 * MIN + 60 * MIN, 'p2', 'outra', 'api', 'rodando', null),
  ]);
  const solta = aberto.find((r) => r.feature === 'solta');
  checar('intervalo que ficou aberto NAO vira tres dias de trabalho',
    solta.trabalhando === 0, `${solta.trabalhando / MIN}min`);
  checar('e a sessao seguinte e contada normalmente',
    aberto.find((r) => r.feature === 'outra').trabalhando === 60 * MIN, '');

  // --- 3. o fim gravado na saida do app fecha o intervalo -----------------
  const fechado = historico.resumo([
    ev(T0, 'p1', 'fecha', 'api', '', 'rodando'),
    ev(T0 + 42 * MIN, 'p1', 'fecha', 'api', 'rodando', null),
  ]);
  checar('com o fim gravado, o ultimo intervalo conta',
    fechado[0].trabalhando === 42 * MIN, `${fechado[0].trabalhando / MIN}min`);

  // --- 4. a chave e feature + projeto, nunca o id do painel ---------------
  const duasAberturas = historico.resumo([
    ev(T0, 'p1', 'auth', 'api', '', 'rodando'),
    ev(T0 + 10 * MIN, 'p1', 'auth', 'api', 'rodando', null),
    // mesma feature, outro dia, id novo (id e efemero)
    ev(T0 + 600 * MIN, 'p9-outro', 'auth', 'api', '', 'rodando'),
    ev(T0 + 620 * MIN, 'p9-outro', 'auth', 'api', 'rodando', null),
  ]);
  checar('duas aberturas da mesma feature viram uma linha so',
    duasAberturas.length === 1 && duasAberturas[0].trabalhando === 30 * MIN,
    JSON.stringify(duasAberturas.map((r) => `${r.feature}:${r.trabalhando / MIN}min`)));
  checar('e a contagem de sessoes distingue as duas aberturas',
    duasAberturas[0].sessoes === 2, String(duasAberturas[0].sessoes));

  // Mesma feature em projetos diferentes sao coisas diferentes.
  const doisProjetos = historico.resumo([
    ev(T0, 'p1', 'auth', 'api', '', 'rodando'),
    ev(T0 + 10 * MIN, 'p1', 'auth', 'api', 'rodando', null),
    ev(T0, 'p2', 'auth', 'web', '', 'rodando'),
    ev(T0 + 10 * MIN, 'p2', 'auth', 'web', 'rodando', null),
  ]);
  checar('a mesma feature em projetos diferentes nao se mistura',
    doisProjetos.length === 2, JSON.stringify(doisProjetos.map((r) => `${r.projeto}/${r.feature}`)));

  // --- 5. gravacao e leitura de verdade, com linha corrompida ------------
  historico.limpar();
  historico.transicao({ id: 'g1', feature: 'grava', projeto: 'api', de: '', para: 'rodando', t: T0 });
  fs.appendFileSync(historico.caminho(), '{isto nao e json\n', 'utf8');
  historico.transicao({ id: 'g1', feature: 'grava', projeto: 'api', de: 'rodando', para: null, t: T0 + 7 * MIN });

  const lido = historico.ler();
  checar('linha corrompida no meio e descartada sem derrubar a leitura',
    lido.length === 2, `${lido.length} eventos`);
  checar('e o que sobrou agrega certo',
    historico.resumo()[0].trabalhando === 7 * MIN, '');

  // --- 6. poda por idade --------------------------------------------------
  historico.limpar();
  const velho = Date.now() - 200 * 24 * 60 * MIN;
  historico.transicao({ id: 'v1', feature: 'velha', projeto: 'api', de: '', para: 'rodando', t: velho });
  historico.transicao({ id: 'v1', feature: 'velha', projeto: 'api', de: 'rodando', para: null, t: velho + MIN });
  historico.transicao({ id: 'n1', feature: 'nova', projeto: 'api', de: '', para: 'rodando', t: Date.now() });

  const antes = historico.ler().length;
  const poda = historico.podar({ dias: 90 });
  const depois = historico.ler();
  checar('a poda tira o que passou da idade', poda.podou && depois.length < antes,
    `${antes} -> ${depois.length}`);
  checar('e preserva o mais recente',
    depois.every((e) => e.feature === 'nova'), JSON.stringify(depois.map((e) => e.feature)));

  // --- 7. arquivo que nao existe nao e erro ------------------------------
  historico.limpar();
  checar('sem arquivo, a leitura devolve lista vazia', historico.ler().length === 0, '');
  checar('e o resumo tambem', historico.resumo().length === 0, '');

  fs.rmSync(PASTA, { recursive: true, force: true });

  console.log(falhas === 0 ? '\nHISTORICO_OK' : `\nHISTORICO_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
})();
