'use strict';
// Fase 2: N painéis na grade, colunas, orcamento de WebGL, fechar mata o PTY,
// RAM e CPU dentro das metas.

const path = require('path');
const { execSync } = require('child_process');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');
const RAIZ = path.resolve(__dirname, '..').replace(/\\/g, '/');

// Base fixa do Electron nesta maquina, medida com 0 painéis. Nao cresce com o
// numero de painéis, entao a metrica que diz se o app esta gordo e o custo
// MARGINAL -- total/N carrega a base junto e nunca fecha com poucos painéis.
// Base do app SEM depurador e sem painel nenhum, medida com `npm run perfil`.
// Serve so para traduzir o custo medido aqui numa estimativa comparavel com a
// meta da spec.
//
// Subiu dos 283 MB da Fase 2 quando o redesenho trouxe os overlays -- paleta,
// modais, historico, diff e mapa --, ou seja ~47 MB de DOM e scripts, e nao
// custo de painel.
const BASE_LIMPA = 330;

// A base COM depurador e com a suite ja rodando e medida na hora, logo abaixo:
// e a unica forma de a conta nao depender de quantas suites rodaram antes.
let BASE_MEDIDA = 0;

function medir(seg = 0) {
  return JSON.parse(execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${__dirname}\\medir.ps1" -SegundosCpu ${seg}`,
    { encoding: 'utf8', timeout: (seg + 90) * 1000 }
  ).trim());
}

function contaCmd() {
  return Number(execSync(
    'powershell -NoProfile -Command "(Get-Process cmd -ErrorAction SilentlyContinue | Measure-Object).Count"',
    { encoding: 'utf8' }
  ).trim()) || 0;
}

(async () => {
  const cdp = await conectar();

  // O numero de CPU parado depende de a janela estar DESENHANDO: com ela
  // oculta o Chromium pausa a renderizacao, o processo de GPU nao compoe nada
  // e a medida cai para quase zero -- numero bonito e mentiroso. Trazer para a
  // frente fixa a condicao, e o que se mede passa a ser o caso real: alguem
  // olhando a tela.
  await aoFrente(cdp);
  await zerarGrade(cdp);
  await esperar(1500);

  // Mede a base AQUI, com a grade ja vazia e nas mesmas condicoes do total la
  // embaixo: mesma janela, mesmo depurador, mesmas suites ja tendo rodado.
  BASE_MEDIDA = medir().ramMb;

  const cmdAntes = contaCmd();

  for (let i = 1; i <= 8; i++) {
    await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ)}, feature: 'feat-${i}' }); return 'ok'; })()`);
    await esperar(400);
  }
  await esperar(2500);

  const est = JSON.parse(await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()];
    return JSON.stringify({
      n: ps.length,
      colunas: getComputedStyle(document.getElementById('grade')).gridTemplateColumns.split(' ').length,
      densidade: window.OrqCasca.densidade(),
      renders: ps.map(p => p.tipoRender),
      rodando: ps.filter(p => p.status === 'rodando').length,
      scrollback: ps[0].term.options.scrollback,
      teto: 8,
      visiveis: ps.filter(p => p.visivel).length,
      visiveisComWebgl: ps.filter(p => p.visivel && p.tipoRender === 'webgl').length,
      foraComWebgl: ps.filter(p => !p.visivel && p.tipoRender === 'webgl').length,
    });
  })()`));

  checar('8 painéis abertos', est.n === 8, String(est.n));
  checar('todos com PTY rodando', est.rodando === 8, `${est.rodando}/8`);
  // As colunas vem da densidade escolhida pelo usuario, nao mais da contagem de
  // painéis. O padrao e 2.
  checar('a grade segue a densidade escolhida',
    est.colunas === est.densidade, `${est.colunas} colunas, densidade ${est.densidade}`);
  checar('scrollback limitado a 3000', est.scrollback === 3000, String(est.scrollback));

  // Com altura fixa por densidade, oito painéis NAO cabem na tela -- e painel
  // fora da vista nao pode segurar contexto de WebGL (regra do 6.1). Entao o
  // que se verifica aqui e o contrato de verdade, e nao um numero:
  //   1. ninguem fora da vista tem WebGL;
  //   2. todo painel a vista tem, ate o teto;
  //   3. o teto e respeitado.
  checar('nenhum painel fora da vista segura WebGL',
    est.foraComWebgl === 0, `${est.foraComWebgl} fora da vista com webgl`);
  checar('todo painel a vista desenha em WebGL, ate o teto',
    est.visiveisComWebgl === Math.min(est.visiveis, est.teto),
    `${est.visiveisComWebgl} de ${est.visiveis} visiveis (teto ${est.teto})`);
  checar('e o teto de contextos e respeitado',
    est.renders.filter((r) => r === 'webgl').length <= est.teto, est.renders.join(','));

  const cmdDepois = contaCmd();
  checar('8 processos de shell nasceram', cmdDepois - cmdAntes >= 8, `${cmdAntes} -> ${cmdDepois}`);

  const m = medir(60);
  checar('a medicao achou os processos do app', m.processos > 0 && m.ramMb > 0, JSON.stringify(m));

  // O que os oito painéis CUSTARAM, e nao o total bruto.
  //
  // O total bruto nao serve de meta aqui: esta suite roda com o depurador
  // conectado (~150 MB so dele) e frequentemente depois de outras, no mesmo
  // processo. Comparar isso com os 700 MB da spec -- medidos num app limpo --
  // reprova por causa da instrumentacao, nao do app.
  //
  // A base e medida NA HORA, com zero painéis, entao a conta se auto-calibra:
  // qualquer overhead comum aos dois lados se cancela.
  const custo = m.ramMb - BASE_MEDIDA;
  const estimativaReal = BASE_LIMPA + custo;

  checar('os 8 painéis cabem no orcamento de RAM da spec (700 MB num app limpo)',
    estimativaReal < 700,
    `${custo.toFixed(0)} MB de custo sobre a base -> ~${estimativaReal.toFixed(0)} MB num app limpo`);
  checar('RAM marginal por painel abaixo de 40 MB', custo / 8 < 40,
    `${(custo / 8).toFixed(1)} MB/painel  (bruta com depurador: ${(m.ramMb / 8).toFixed(1)})`);
  checar('CPU parado abaixo de 2%', m.cpuPct >= 0 && m.cpuPct < 2, `${m.cpuPct}% de ${m.nucleos} nucleos`);

  // O teto de contextos vale mesmo com todos a vista. A densidade 3 e a unica
  // que poe nove painéis na tela ao mesmo tempo nesta resolucao.
  await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ)}, feature: 'feat-9' }); return 'ok'; })()`);
  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 3 })`);
  await cdp.avaliar(`document.getElementById('conteudo').scrollTop = 0`);
  await esperar(2000);
  const nono = JSON.parse(await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()];
    return JSON.stringify({
      n: ps.length,
      webgl: ps.filter(p => p.tipoRender === 'webgl').length,
      foraComWebgl: ps.filter(p => !p.visivel && p.tipoRender === 'webgl').length,
    });
  })()`));
  checar('com 9 painéis, o teto de 8 contextos WebGL nao e estourado',
    nono.n === 9 && nono.webgl <= 8 && nono.foraComWebgl === 0, JSON.stringify(nono));

  await cdp.avaliar(`(() => { const ps = [...window.OrqGrade.painelPorId.values()]; ps[0].destruir(); ps[1].destruir(); return 'ok'; })()`);
  await esperar(3000);
  checar('fechar painel matou o processo', contaCmd() <= cmdDepois - 1, `${cmdDepois + 1} -> ${contaCmd()}`);

  const apos = JSON.parse(await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()];
    return JSON.stringify({
      n: ps.length,
      webgl: ps.filter(p => p.tipoRender === 'webgl').length,
      visiveis: ps.filter(p => p.visivel).length,
    });
  })()`));
  checar('vaga de WebGL foi reaproveitada apos fechar',
    apos.n === 7 && apos.webgl === Math.min(apos.visiveis, 8), JSON.stringify(apos));

  await cdp.avaliar(`window.OrqCasca.mudar({ densidade: 2 })`);

  encerrar('FASE2');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
