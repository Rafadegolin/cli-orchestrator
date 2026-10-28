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

  // --- 8. metricas por dia (Fase 10.7) ----------------------------------
  //
  // O dia e injetado em UTC: o padrao e a data LOCAL, e o teste nao pode
  // depender do fuso da maquina onde roda.
  const diaUtc = (t) => new Date(t).toISOString().slice(0, 10);
  const DIA = 24 * 60 * MIN;
  const AGORA = T0 + 2 * DIA + 12 * 60 * MIN; // dia 7, meio-dia
  const m = (lista) => historico.metricas(lista, { dias: 4, agora: AGORA, diaDe: diaUtc });

  const porDia = m([
    // dia 5: duas esperas, respondidas em 2min e 10min
    ev(T0, 'p1', 'auth', 'api', '', 'rodando'),
    ev(T0 + 5 * MIN, 'p1', 'auth', 'api', 'rodando', 'esperando'),
    ev(T0 + 7 * MIN, 'p1', 'auth', 'api', 'esperando', 'rodando'),
    ev(T0 + 20 * MIN, 'p1', 'auth', 'api', 'rodando', 'esperando'),
    ev(T0 + 30 * MIN, 'p1', 'auth', 'api', 'esperando', 'terminou'),
    ev(T0 + 31 * MIN, 'p1', 'auth', 'api', 'terminou', null),
    // dia 7: uma espera de 4min respondida
    ev(T0 + 2 * DIA, 'p2', 'web-x', 'web', '', 'rodando'),
    ev(T0 + 2 * DIA + MIN, 'p2', 'web-x', 'web', 'rodando', 'esperando'),
    ev(T0 + 2 * DIA + 5 * MIN, 'p2', 'web-x', 'web', 'esperando', 'rodando'),
    ev(T0 + 2 * DIA + 6 * MIN, 'p2', 'web-x', 'web', 'rodando', null),
  ]);
  const dia = (k) => porDia.dias.find((d) => d.dia === k);
  checar('a janela tem os dias pedidos, do mais recente ao mais antigo',
    porDia.dias.map((d) => d.dia).join(',') === '2026-01-07,2026-01-06,2026-01-05,2026-01-04',
    porDia.dias.map((d) => d.dia).join(','));
  checar('soma a espera de cada dia', dia('2026-01-05').esperando === 12 * MIN
    && dia('2026-01-07').esperando === 4 * MIN,
    `${dia('2026-01-05').esperando / MIN} / ${dia('2026-01-07').esperando / MIN}min`);
  checar('dia sem nada aparece zerado, e nao some',
    dia('2026-01-06').esperando === 0 && dia('2026-01-06').episodios === 0
      && dia('2026-01-06').respostaMediana === null, JSON.stringify(dia('2026-01-06')));
  checar('conta episodios e sessoes por dia',
    dia('2026-01-05').episodios === 2 && dia('2026-01-05').sessoes === 1
      && dia('2026-01-05').features === 1, JSON.stringify(dia('2026-01-05')));
  checar('mediana da resposta no dia', dia('2026-01-05').respostaMediana === 6 * MIN,
    `${dia('2026-01-05').respostaMediana / MIN}min`);
  checar('totais da janela', porDia.totais.esperando === 16 * MIN && porDia.totais.episodios === 3
    && porDia.totais.features === 2 && porDia.totais.respostaMediana === 4 * MIN,
    JSON.stringify(porDia.totais));

  // Fechar o painel com a sessao esperando e ABANDONO, nao resposta.
  const abandono = m([
    ev(T0, 'p1', 'a', 'api', '', 'rodando'),
    ev(T0 + MIN, 'p1', 'a', 'api', 'rodando', 'esperando'),
    ev(T0 + 3 * MIN, 'p1', 'a', 'api', 'esperando', 'rodando'),
    ev(T0 + 4 * MIN, 'p1', 'a', 'api', 'rodando', 'esperando'),
    ev(T0 + 64 * MIN, 'p1', 'a', 'api', 'esperando', null),
  ]);
  checar('espera encerrada fechando o painel soma no tempo esperando',
    abandono.totais.esperando === 62 * MIN, `${abandono.totais.esperando / MIN}min`);
  checar('mas nao entra na resposta', abandono.totais.respostaMediana === 2 * MIN
    && abandono.totais.respostaMedia === 2 * MIN, JSON.stringify(abandono.totais));

  // Espera que ficou aberta (queda do app) nao conta nada.
  const queda = m([
    ev(T0, 'p1', 'a', 'api', '', 'esperando'),
  ]);
  checar('espera sem fechamento nao conta', queda.totais.esperando === 0
    && queda.totais.respostaMediana === null, JSON.stringify(queda.totais));

  // Mediana resiste a uma espera esquecida; a media nao.
  const atipico = [];
  [1, 2, 3, 120].forEach((min, i) => {
    const base = T0 + i * 200 * MIN;
    atipico.push(ev(base, `q${i}`, 'b', 'api', '', 'esperando'));
    atipico.push(ev(base + min * MIN, `q${i}`, 'b', 'api', 'esperando', 'rodando'));
    atipico.push(ev(base + min * MIN + 1, `q${i}`, 'b', 'api', 'rodando', null));
  });
  const at = m(atipico).totais;
  checar('mediana ignora a espera atipica, a media nao',
    at.respostaMediana === 2.5 * MIN && at.respostaMedia > 30 * MIN,
    `mediana ${at.respostaMediana / MIN}min, media ${Math.round(at.respostaMedia / MIN)}min`);

  // --- 9. de terminou ate integrado ---------------------------------------
  const ciclo = [
    ev(T0, 'p1', 'feat', 'api', '', 'rodando'),
    ev(T0 + 10 * MIN, 'p1', 'feat', 'api', 'rodando', 'terminou'),
    ev(T0 + 15 * MIN, 'p1', 'feat', 'api', 'terminou', 'rodando'),
    ev(T0 + 40 * MIN, 'p1', 'feat', 'api', 'rodando', 'terminou'),
    ev(T0 + 50 * MIN, 'p1', 'feat', 'api', 'terminou', null),
    { t: T0 + 100 * MIN, id: 'fechou:api/feat', feature: 'feat', projeto: 'api', tipo: 'fechou' },
    // integrada sem nunca ter terminado no historico
    { t: T0 + 2 * DIA, id: 'fechou:web/velha', feature: 'velha', projeto: 'web', tipo: 'fechou' },
  ];
  const linhaFeat = historico.resumo(ciclo).find((r) => r.feature === 'feat');
  checar('o lead time parte do ULTIMO terminou', linhaFeat.leadTime === 60 * MIN,
    `${linhaFeat.leadTime / MIN}min`);
  checar('o fechou nao conta como sessao nem mexe nos tempos',
    linhaFeat.sessoes === 1 && linhaFeat.trabalhando === 35 * MIN && linhaFeat.revisando === 15 * MIN,
    JSON.stringify(linhaFeat));
  const velha = historico.resumo(ciclo).find((r) => r.feature === 'velha');
  checar('integrada sem terminou: aparece, com lead time null',
    velha && velha.leadTime === null && velha.sessoes === 0, JSON.stringify(velha));
  const mc = m(ciclo);
  checar('integradas contadas por dia, e o lead mediano so com quem tem lead',
    mc.dias.find((d) => d.dia === '2026-01-05').integradas === 1
      && mc.dias.find((d) => d.dia === '2026-01-07').integradas === 1
      && mc.totais.integradas === 2 && mc.totais.leadMediano === 60 * MIN,
    JSON.stringify(mc.totais));

  // Gravado e relido do disco, o fechou nao abre intervalo.
  historico.limpar();
  historico.transicao({ id: 'd1', feature: 'disco', projeto: 'api', de: '', para: 'rodando', t: T0 });
  historico.transicao({ id: 'd1', feature: 'disco', projeto: 'api', de: 'rodando', para: 'terminou', t: T0 + 5 * MIN });
  historico.fechou({ feature: 'disco', projeto: 'api', t: T0 + 8 * MIN });
  historico.transicao({ id: 'd1', feature: 'disco', projeto: 'api', de: 'terminou', para: null, t: T0 + 9 * MIN });
  const disco = historico.resumo()[0];
  checar('fechou gravado no disco e relido sem perder nada',
    historico.ler().length === 4 && disco.leadTime === 3 * MIN && disco.trabalhando === 5 * MIN
      && disco.revisando === 4 * MIN && disco.sessoes === 1, JSON.stringify(disco));

  // --- 7. arquivo que nao existe nao e erro ------------------------------
  historico.limpar();
  checar('sem arquivo, a leitura devolve lista vazia', historico.ler().length === 0, '');
  checar('e o resumo tambem', historico.resumo().length === 0, '');

  fs.rmSync(PASTA, { recursive: true, force: true });

  console.log(falhas === 0 ? '\nHISTORICO_OK' : `\nHISTORICO_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
})();
