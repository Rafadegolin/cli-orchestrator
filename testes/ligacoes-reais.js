'use strict';
// A prova de que ligar FUNCIONA: com Claude de verdade, os dois caminhos.
//
// Separado do teste:ligacoes porque e lento (~3 min) e consome tokens. E o
// unico teste que mostra a sessao lendo codigo do outro repositorio.
//
// Monta dois repos descartaveis: o "backend" tem um contrato que so existe la,
// e o painel roda no "frontend".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

const BASE = path.join(os.tmpdir(), 'orq-teste-ligacoes-reais');
const A = path.join(BASE, 'backend').replace(/\\/g, '/');
const B = path.join(BASE, 'frontend').replace(/\\/g, '/');
const SEGREDO = 'CONTRATO_PEDIDOS_V7';
const PERGUNTA = 'Leia contrato.md do diretorio adicional e responda APENAS o identificador da versao.';

function montar() {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(A, { recursive: true });
  fs.mkdirSync(B, { recursive: true });
  fs.writeFileSync(path.join(A, 'contrato.md'), `# Contrato\n\nIdentificador: ${SEGREDO}\n`);
  fs.writeFileSync(path.join(B, 'leiame.txt'), 'frontend; o contrato nao esta aqui\n');
}

const ler = (id) => `(() => {
  const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
  const b = p.term.buffer.active; let t = '';
  for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\\n';
  return t;
})()`;

async function ateQue(cdp, expr, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cdp.avaliar(expr)) return true;
    await esperar(500);
  }
  return false;
}

// Sobe um painel com o Claude e passa pelo prompt de confianca de pasta nova.
async function abrirSessao(cdp, comando, feature) {
  const id = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(B)}, feature: '${feature}', comandoInicial: ${JSON.stringify(comando)} }); return p.id; })()`);

  if (await ateQue(cdp, `${ler(id)}.includes('trust')`, 45000)) {
    await esperar(1500);
    await cdp.avaliar(`window.orq.escrever(${JSON.stringify(id)}, '\\r')`);
    await esperar(4000);
  }
  const pronto = await ateQue(cdp, `${ler(id)}.includes('for shortcuts')`, 90000);
  await esperar(2500);
  return { id, pronto };
}

(async () => {
  montar();
  const cdp = await conectar();
  await zerarGrade(cdp);

  // --- Caminho 1: a flag, sem sessao interativa (barato) -----------------
  const semFlag = spawnSync('claude', ['-p', `"${PERGUNTA}"`], {
    cwd: B, encoding: 'utf8', timeout: 240000, shell: true,
  });
  checar('sem ligacao, a sessao NAO alcanca o outro repositorio',
    !`${semFlag.stdout || ''}`.includes(SEGREDO),
    `${semFlag.stdout || ''}`.trim().slice(0, 90).replace(/\s+/g, ' '));

  const comFlag = spawnSync('claude', ['-p', `"${PERGUNTA}"`, '--add-dir', `"${A}"`], {
    cwd: B, encoding: 'utf8', timeout: 240000, shell: true,
  });
  checar('com --add-dir, ela le o arquivo do outro repositorio',
    `${comFlag.stdout || ''}`.includes(SEGREDO),
    `${comFlag.stdout || ''}`.trim().slice(0, 90).replace(/\s+/g, ' '));

  // --- Caminho 2: ligar uma sessao JA VIVA, pela API do app --------------
  const s = await abrirSessao(cdp, 'cls && claude', 'viva');
  checar('a sessao interativa subiu', s.pronto, '');

  // E aqui que o app faz o trabalho: /add-dir, Enter separado e a confirmacao.
  await cdp.avaliar(`(async () => { await window.OrqLigacoes.ligar(
    ${JSON.stringify(s.id)}, ${JSON.stringify(A)}); return 'ok'; })()`);

  const confirmou = await ateQue(cdp,
    `${ler(s.id)}.includes('as a working directory')`, 40000);
  checar('o app completou o /add-dir, inclusive a confirmacao', confirmou, '');

  await ateQue(cdp, `${ler(s.id)}.includes('for shortcuts')`, 20000);
  await esperar(1500);
  await cdp.avaliar(`(async () => { await window.OrqLigacoes.enviarLinha(
    ${JSON.stringify(s.id)}, ${JSON.stringify(PERGUNTA)}); return 'ok'; })()`);

  const leu = await ateQue(cdp, `${ler(s.id)}.includes(${JSON.stringify(SEGREDO)})`, 180000);
  checar('a sessao JA VIVA passou a ler o codigo do outro repositorio', leu, '');
  if (!leu) {
    const t = await cdp.avaliar(ler(s.id));
    console.log(t.split('\n').filter((l) => l.trim()).slice(-14).join('\n'));
  }

  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(s.id)}).destruir()`);
  await esperar(2000);
  await zerarGrade(cdp);
  await cdp.avaliar(`window.orq.sessaoSalvar([])`);
  fs.rmSync(BASE, { recursive: true, force: true });

  encerrar('LIGACOES_REAIS');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
