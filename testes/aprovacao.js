'use strict';
// A faixa de aprovacao e o farejador do Canal 1, sem invocar o Claude.
//
// O truque que torna isto barato: `textoDaTela()` le o buffer do XTERM, entao
// escrever direto no `term` reproduz exatamente o que o farejador veria numa
// sessao real -- sem token, sem esperar os 6 segundos do hook, e podendo
// montar telas que sao dificeis de provocar de proposito (prompt respondido
// ainda visivel, pergunta velha no scrollback).
//
// O que ele NAO cobre e o caminho ponta a ponta com o CLI de verdade: isso e o
// `teste:aprovacao-reais`, e as marcas em si saem do `spike:aprovacao`.

const os = require('os');
const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const PASTA = path.join(os.tmpdir(), 'orq-teste-aprovacao-ui').replace(/\\/g, '/');

// As telas, na forma medida contra o CLI 2.1.220.
const PROMPT_PERMISSAO = [
  ' Do you want to create marca.txt?',
  ' \u276f 1. Yes',
  '   2. Yes, allow all edits during this session (shift+tab)',
  '   3. No',
  ' Esc to cancel \u00b7 Tab to amend',
].join('\r\n');

// A forma que o app NAO reconhecia, e que fazia o clique cair no toast de erro.
// Repare na opcao 1: "and use auto mode" -- por isso ela nao ganha botao.
const PROMPT_PLANO = [
  ' Claude has written up a plan and is ready to execute. Would you like to proceed?',
  ' > 1. Yes, and use auto mode',
  '   2. Yes, manually approve edits',
  '   3. Tell Claude what to change',
].join('\r\n');

// O rodape de uma sessao trabalhando. E o sinal AFIRMATIVO que autoriza apagar.
const TRABALHANDO = '\u273b Fluttering\u2026 (1m 8s \u00b7 \u2193 3.9k tokens) \u00b7 esc to interrupt';

const escrever = (id, texto) =>
  `window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).term.write(${JSON.stringify(texto)})`;

const limparTela = (id) =>
  `window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).term.reset()`;

const statusDoPainel = (id) =>
  `window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).status`;

// O que o PROCESSO PRINCIPAL acha. E a metade que faltava: o farejador pintava
// so a janela, e o main seguia achando `rodando`.
async function statusNoMain(cdp, id) {
  const todas = JSON.parse(await cdp.avaliar(
    `window.orq.estadoAtual().then(s => JSON.stringify(s))`));
  return todas.find((s) => s.id === id) || null;
}

// O farejador tem relogio proprio de 1,5s; chamar na mao deixa o teste
// deterministico em vez de depender de quando o giro cai.
async function farejar(cdp) {
  await cdp.avaliar('window.OrqAprovacao.farejar()');
  await esperar(400);
}

(async () => {
  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  // ---------------------------------------------------- as formas, sem DOM

  const formas = JSON.parse(await cdp.avaliar(`(() => {
    const A = window.OrqAprovacao;
    const achatar = window.OrqPainel.achatar;
    return JSON.stringify({
      permissao: A.lerPedido(achatar(${JSON.stringify(PROMPT_PERMISSAO)})),
      plano: A.lerPedido(achatar(${JSON.stringify(PROMPT_PLANO)})),
      terminalComum: A.lerPedido(achatar('C:\\\\Users> dir\\n 1 arquivo(s)\\n')),
      trabalhando: A.MARCA_TRABALHANDO.test(achatar(${JSON.stringify(TRABALHANDO)})),
      trabalhandoNoPrompt: A.MARCA_TRABALHANDO.test(achatar(${JSON.stringify(PROMPT_PERMISSAO)})),
    });
  })()`));

  checar('o prompt de permissao e lido, e e aprovavel',
    formas.permissao?.forma === 'permissao' && formas.permissao?.aprovavel === true
    && formas.permissao?.tecla === '1',
    JSON.stringify(formas.permissao));
  checar('e a pergunta vem inteira, sem a lista de opcoes junto',
    formas.permissao?.pergunta === 'Do you want to create marca.txt?', formas.permissao?.pergunta);

  // O bug relatado: este prompt nao casava com nada, entao clicar em Aprovar
  // caia no "Nao achei o pedido na tela".
  checar('o prompt de PLANO passou a ser reconhecido',
    formas.plano?.forma === 'plano', JSON.stringify(formas.plano));
  checar('e NAO e aprovavel -- a opcao 1 dele liga o auto mode da sessao',
    formas.plano?.aprovavel === false, JSON.stringify(formas.plano));
  checar('saida comum de terminal nao vira falso positivo',
    formas.terminalComum === null, JSON.stringify(formas.terminalComum));

  // A marca que separa os dois momentos. Se ela vazasse para a tela do prompt,
  // o app passaria a APAGAR amarelo verdadeiro.
  checar('o sinal de trabalho casa com a tela de uma sessao trabalhando',
    formas.trabalhando === true, '');
  checar('e NAO casa com a tela de um prompt esperando resposta',
    formas.trabalhandoNoPrompt === false, '');

  // ------------------------------------------------------- com painel real

  const id = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(PASTA.replace(/\/[^/]+$/, ''))}, feature: 'aprovacao-ui' }); return p.id; })()`);
  await esperar(2500);

  await cdp.avaliar(limparTela(id));
  await cdp.avaliar(`window.OrqLateral.definirStatus(${JSON.stringify(id)}, 'rodando', '')`);
  await esperar(300);

  // --- ACENDER -----------------------------------------------------------

  await cdp.avaliar(escrever(id, `\r\n${PROMPT_PERMISSAO}\r\n`));
  await esperar(400);
  await farejar(cdp);

  checar('com o prompt na tela, o farejador acende o amarelo',
    await cdp.avaliar(statusDoPainel(id)) === 'esperando', await cdp.avaliar(statusDoPainel(id)));

  // A REGRESSAO PRINCIPAL. Antes o farejador chamava so `OrqLateral`, o main
  // seguia em `rodando`, e por isso o `PostToolUse` seguinte era descartado
  // como "nao mudou nada" -- o amarelo ficava preso ate um Stop.
  const noMain = await statusNoMain(cdp, id);
  checar('e o PROCESSO PRINCIPAL fica sabendo (a dessincronizacao acabou)',
    noMain?.status === 'esperando', JSON.stringify(noMain));
  checar('com a pergunta lida da tela, e nao a frase generica do hook',
    noMain?.pergunta === 'Do you want to create marca.txt?', noMain?.pergunta);

  // Consequencia direta: agora um evento de volta ao trabalho PRODUZ diff.
  //
  // A tela e limpa antes, senao o proprio farejador reacende no giro seguinte
  // -- corretamente, porque com o prompt na tela e sem sinal de trabalho a
  // sessao esta mesmo esperando.
  await cdp.avaliar(limparTela(id));
  await esperar(300);
  await cdp.avaliar(`window.orq.estadoFarejado({ id: ${JSON.stringify(id)}, status: 'rodando' })`);
  await esperar(600);
  checar('e um evento de volta ao trabalho agora consegue apagar',
    await cdp.avaliar(statusDoPainel(id)) === 'rodando', await cdp.avaliar(statusDoPainel(id)));

  // --- NAO ACENDER POR CIMA DE QUEM VOLTOU A TRABALHAR --------------------
  //
  // A TELA DA CAPTURA DO BUG: o prompt ja respondido ainda rolando acima, com o
  // spinner trabalhando embaixo. Os dois sinais na MESMA tela.
  await cdp.avaliar(limparTela(id));
  await cdp.avaliar(escrever(id, `\r\n${PROMPT_PERMISSAO}\r\n${TRABALHANDO}\r\n`));
  await esperar(400);
  await farejar(cdp);
  checar('prompt respondido AINDA na tela + sinal de trabalho: nao acende',
    await cdp.avaliar(statusDoPainel(id)) === 'rodando', await cdp.avaliar(statusDoPainel(id)));

  // --- APAGAR ------------------------------------------------------------
  //
  // A mesma tela, mas com o amarelo ja aceso (foi o hook de verdade que
  // acendeu, e a sessao voltou a trabalhar depois). Exigir que o prompt tivesse
  // sumido para apagar deixava o bug de pe: ele continua visivel por um bom
  // tempo depois de respondido.
  await cdp.avaliar(
    `window.OrqLateral.definirStatus(${JSON.stringify(id)}, 'esperando', 'pedindo permissão',
      Date.now(), { tipo: 'permissao', pergunta: 'Do you want to create marca.txt?' })`);
  await esperar(300);
  await farejar(cdp);
  checar('amarelo aceso com a sessao visivelmente trabalhando: apaga',
    await cdp.avaliar(statusDoPainel(id)) === 'rodando', await cdp.avaliar(statusDoPainel(id)));
  const apagadoNoMain = await statusNoMain(cdp, id);
  checar('e o main acompanha, em vez de guardar um amarelo que a tela nao mostra',
    apagadoNoMain?.status === 'rodando', JSON.stringify(apagadoNoMain));

  // E o outro lado: sem sinal de trabalho, NAO apaga. Apagar por ausencia de
  // prompt esconderia uma sessao bloqueada, que e o erro caro.
  await cdp.avaliar(limparTela(id));
  await cdp.avaliar(escrever(id, '\r\nC:\\Users> \r\n'));
  await cdp.avaliar(
    `window.OrqLateral.definirStatus(${JSON.stringify(id)}, 'esperando', 'pedindo permissão',
      Date.now(), { tipo: 'permissao', pergunta: 'Do you want to create marca.txt?' })`);
  await esperar(300);
  await farejar(cdp);
  checar('sem sinal de trabalho, o amarelo NAO e apagado pela tela',
    await cdp.avaliar(statusDoPainel(id)) === 'esperando', await cdp.avaliar(statusDoPainel(id)));

  // --- A TRAVA LE A TELA, E NAO O SCROLLBACK ------------------------------
  //
  // `pedidoNaTela` lia `textoDoBuffer()`, ou seja as 3000 linhas de historico, e
  // `exec` devolve o PRIMEIRO match: a trava podia estar conferindo uma
  // pergunta de dez minutos atras e liberando um "1" em cima do que estivesse
  // na tela agora.
  await cdp.avaliar(limparTela(id));
  await cdp.avaliar(escrever(id, `\r\n${PROMPT_PERMISSAO}\r\n`));
  await esperar(300);
  // Empurra o prompt para fora da tela, mas ele continua no scrollback.
  await cdp.avaliar(escrever(id, '\r\n'.repeat(80)));
  await esperar(500);

  const buffer = await cdp.avaliar(`window.OrqPainel.achatar(
    window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).textoDoBuffer())`);
  checar('a pergunta antiga continua no scrollback (o cenario do defeito)',
    buffer.includes('Do you want to create marca.txt?'), '');

  const naTela = await cdp.avaliar(
    `JSON.stringify(window.OrqAprovacao.pedidoNaTela(${JSON.stringify(id)}))`);
  checar('mas a leitura da TELA nao acha nada -- e por isso nao responde',
    naTela === 'null', naTela);

  const antes = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).textoDoBuffer()`);
  const rec = JSON.parse(await cdp.avaliar(
    `JSON.stringify(window.OrqAprovacao.aprovar(${JSON.stringify(id)}))`));
  await esperar(1200);
  const depois = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).textoDoBuffer()`);
  checar('com pergunta so no scrollback, Aprovar recusa e NAO escreve no PTY',
    rec.ok === false && antes === depois, `ok=${rec.ok} motivo=${rec.motivo}`);

  // --- O PROMPT DE PLANO NA FAIXA ----------------------------------------

  await cdp.avaliar(limparTela(id));
  await cdp.avaliar(escrever(id, `\r\n${PROMPT_PLANO}\r\n`));
  await esperar(400);
  // O hook de plano chega como `permissao` com a frase generica -- foi assim
  // que ele apareceu na captura de campo.
  await cdp.avaliar(
    `window.OrqLateral.definirStatus(${JSON.stringify(id)}, 'esperando', 'pedindo permissão',
      Date.now(), { tipo: 'permissao', pergunta: 'Claude Code needs your approval for the plan' })`);
  await esperar(1800);

  const faixa = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
    return JSON.stringify({
      acesa: p.elRodape.classList.contains('tem-pedido'),
      texto: p.elRodape.querySelector('.rodape-pergunta')?.textContent || '',
      aprovar: !!p.elRodape.querySelector('.rodape-aprovar'),
      ver: !!p.elRodape.querySelector('.rodape-ver'),
    });
  })()`));

  checar('o pedido de plano acende a faixa', faixa.acesa && faixa.ver, JSON.stringify(faixa));
  checar('mostrando a pergunta REAL, no lugar da frase generica do hook',
    /Would you like to proceed\?$/.test(faixa.texto), faixa.texto);
  checar('e SEM o botao Aprovar: escolher entre auto mode e manual e decisao sua',
    faixa.aprovar === false, JSON.stringify(faixa));

  // Mesmo forcando a chamada, ele recusa em vez de responder por voce.
  const bAntes = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).textoDoBuffer()`);
  const rPlano = JSON.parse(await cdp.avaliar(
    `JSON.stringify(window.OrqAprovacao.aprovar(${JSON.stringify(id)}))`));
  await esperar(1200);
  const bDepois = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(id)}).textoDoBuffer()`);
  checar('e aprovar() recusa a forma de plano sem escrever nada',
    rPlano.ok === false && rPlano.motivo === 'forma nao aprovavel' && bAntes === bDepois,
    `ok=${rPlano.ok} motivo=${rPlano.motivo}`);

  // ------------------------------------------------------------- limpeza

  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(id)})?.destruir()`);
  await esperar(1500);
  await zerarGrade(cdp);
  await cdp.avaliar(`window.orq.sessaoSalvar([])`);

  encerrar('APROVACAO');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
