'use strict';
// A prova de que APROVAR funciona: com Claude de verdade.
//
// Separado da bateria padrao porque e lento (~2 min) e consome tokens. E o
// unico teste que percorre o caminho inteiro: pedido real -> hook -> faixa ->
// clique -> tecla no PTY -> acao acontecendo.
//
// A provocacao e escrever arquivo, e nao rodar `echo`: medido, o CLI executa
// `echo` sem pedir permissao nenhuma, e a sessao nunca fica esperando.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

const PASTA = path.join(os.tmpdir(), 'orq-teste-aprovacao').replace(/\\/g, '/');
const CONTEUDO = 'APROVADO_PELO_ORQUESTRADOR';
const PEDIDO = `Crie o arquivo marca.txt nesta pasta com exatamente o conteudo ${CONTEUDO}, e nada mais.`;

const ler = (id) => `(() => {
  const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
  return p ? p.textoDoBuffer() : '';
})()`;

async function ateQue(cdp, expr, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cdp.avaliar(expr)) return true;
    await esperar(500);
  }
  return false;
}

async function arquivoAparece(ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (fs.existsSync(path.join(PASTA, 'marca.txt'))) return true;
    await esperar(400);
  }
  return false;
}

(async () => {
  fs.rmSync(PASTA, { recursive: true, force: true });
  fs.mkdirSync(PASTA, { recursive: true });
  fs.writeFileSync(path.join(PASTA, 'leiame.txt'), 'pasta descartavel do teste\n');

  const cdp = await conectar();
  await zerarGrade(cdp);

  const id = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(PASTA)}, feature: 'aprovacao', comandoInicial: 'cls && claude' });
    return p.id; })()`);

  if (await ateQue(cdp, `${ler(id)}.includes('trust')`, 45000)) {
    await esperar(1500);
    await cdp.avaliar(`window.orq.escrever(${JSON.stringify(id)}, '\\r')`);
    await esperar(4000);
  }
  checar('a sessao interativa subiu',
    await ateQue(cdp, `${ler(id)}.includes('for shortcuts')`, 90000), '');
  await esperar(2000);

  await cdp.avaliar(`(async () => { await window.OrqLigacoes.enviarLinha(
    ${JSON.stringify(id)}, ${JSON.stringify(PEDIDO)}); return 'ok'; })()`);

  // 1. O hook reporta o pedido de permissao.
  checar('o Claude pediu permissao e o hook avisou',
    await ateQue(cdp, `window.OrqLateral.cards.get(${JSON.stringify(id)})?.status === 'esperando'`, 120000), '');

  // 2. A faixa acende com o botao.
  await esperar(1200);
  const faixa = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
    return JSON.stringify({
      acesa: p.elRodape.classList.contains('tem-pedido'),
      aprovar: !!p.elRodape.querySelector('.rodape-aprovar'),
      texto: p.elRodape.querySelector('.rodape-pergunta')?.textContent || '',
    });
  })()`));
  checar('a faixa de aprovacao acendeu com o botao', faixa.acesa && faixa.aprovar, JSON.stringify(faixa));

  // 3. E le a pergunta DE VERDADE do buffer, nao a frase generica do hook.
  checar('e mostra a pergunta real do Claude, lida do terminal',
    /^Do you want to /.test(faixa.texto), faixa.texto);

  // 4. O clique aprova: a acao acontece no disco.
  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(id)})
    .elRodape.querySelector('.rodape-aprovar').click()`);

  const criou = await arquivoAparece(60000);
  checar('clicar em Aprovar fez a acao acontecer de verdade', criou, `${PASTA}/marca.txt`);
  if (criou) {
    const texto = fs.readFileSync(path.join(PASTA, 'marca.txt'), 'utf8');
    checar('com o conteudo pedido', texto.includes(CONTEUDO), texto.trim().slice(0, 60));
  }

  // 5. Depois de aprovado, o pedido saiu da tela e a trava recusa.
  //
  // Aqui a checagem e so a RECUSA, e nao "o buffer ficou igual": a tela de uma
  // sessao viva do Claude nunca fica parada -- spinner, cronometro e barra de
  // status redesenham sozinhos. Que a recusa nao escreve nada e provado no
  // teste:ui, num painel de cmd.exe, onde o buffer de fato nao se mexe.
  await esperar(2000);
  const r = JSON.parse(await cdp.avaliar(
    `JSON.stringify(window.OrqAprovacao.aprovar(${JSON.stringify(id)}))`));
  checar('com o pedido ja respondido, Aprovar recusa em vez de responder as cegas',
    r.ok === false && r.motivo === 'sem pedido na tela', `ok=${r.ok} motivo=${r.motivo}`);

  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(id)})?.destruir()`);
  await esperar(2000);
  await zerarGrade(cdp);
  await cdp.avaliar(`window.orq.sessaoSalvar([])`);
  fs.rmSync(PASTA, { recursive: true, force: true });

  encerrar('APROVACAO_REAIS');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
