'use strict';
// A saida dos painéis guardada ao fechar e mostrada no painel restaurado
// (Fase 10.5).
//
// Metade em Node puro (o modulo do disco, com `ORQ_DADOS` temporario) e metade
// pelo CDP. A do CDP RECARREGA A JANELA de verdade: e o unico jeito de exercitar
// o `beforeunload` e o `sendSync`, que sao o caminho real do fechamento. Antes do
// reload os PTYs dos painéis do teste sao fechados no main (sem destruir o
// painel, que apagaria a tela), para nao sobrar processo orfao.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PASTA_PURA = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-teste-telas-'));
const ORIGINAL = process.env.ORQ_DADOS;
process.env.ORQ_DADOS = PASTA_PURA;
const telas = require('../src/main/telas');
if (ORIGINAL === undefined) delete process.env.ORQ_DADOS; else process.env.ORQ_DADOS = ORIGINAL;

const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
// Mesma pasta que o subir.ps1 passa ao app pela env ORQ_DADOS.
const PASTA_APP = path.join(RAIZ, '.dev-udata', 'dados', 'telas');

async function ate(fn, cond, ms = 10000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    try { ultimo = await fn(); } catch { ultimo = undefined; }
    if (ultimo !== undefined && cond(ultimo)) return ultimo;
    await esperar(250);
  }
  return ultimo;
}

function nodePuro() {
  const k1 = telas.chave('C:\\Proj\\x', 'feat');
  checar('a chave ignora caixa e separador',
    k1 === telas.chave('c:/proj/x/', 'feat') && k1 !== telas.chave('c:/proj/x', 'outra'), k1);

  const r1 = telas.salvar([
    { cwd: 'C:\\a', feature: 'um', conteudo: '\x1b[31mvermelho\x1b[0m\r\nfim' },
    { cwd: 'C:\\b', feature: 'dois', conteudo: 'dois' },
    { cwd: 'C:\\c', feature: 'vazio', conteudo: '' },
  ]);
  checar('salvar grava os que tem conteudo', r1.gravados === 2, JSON.stringify(r1));
  checar('carregar devolve o mesmo conteudo, com cor',
    telas.carregar('c:/a', 'um')?.conteudo === '\x1b[31mvermelho\x1b[0m\r\nfim');
  const nomes = fs.readdirSync(telas.PASTA);
  checar('o nome do arquivo nao tem a feature nem o caminho',
    nomes.every((n) => /^[0-9a-f]{16}\.ans$/.test(n)), nomes.join(','));

  const r2 = telas.salvar([{ cwd: 'C:\\b', feature: 'dois', conteudo: 'dois' }]);
  checar('salvar com lista menor apaga quem saiu', r2.apagados === 1 && telas.carregar('C:\\a', 'um') === null,
    JSON.stringify(r2));

  const linhas = Array.from({ length: 40000 }, (_, i) => `\x1b[32mlinha ${i}\x1b[0m`).join('\r\n');
  const cortado = telas.cortar(linhas);
  checar('acima do teto corta no INICIO', Buffer.byteLength(cortado) <= telas.TETO_BYTES
    && cortado.endsWith('linha 39999\x1b[0m') && !cortado.includes('linha 0\x1b'), String(Buffer.byteLength(cortado)));
  checar('e o corte cai numa quebra de linha', cortado.startsWith('\x1b[32mlinha '), JSON.stringify(cortado.slice(0, 12)));

  telas.apagar('c:/b', 'dois');
  checar('apagar remove o arquivo', telas.carregar('C:\\b', 'dois') === null);

  telas.salvar([{ cwd: 'C:\\velho', feature: 'v', conteudo: 'v' }]);
  const alvo = path.join(telas.PASTA, `${telas.chave('C:\\velho', 'v')}.ans`);
  const antigo = (Date.now() - 40 * 86_400_000) / 1000;
  fs.utimesSync(alvo, antigo, antigo);
  fs.writeFileSync(path.join(telas.PASTA, 'abc.ans.tmp'), 'orfao');
  const p = telas.podar();
  checar('podar apaga o que passou de 30 dias, e o .tmp orfao',
    p.apagados === 1 && !fs.existsSync(alvo) && !fs.readdirSync(telas.PASTA).some((n) => n.endsWith('.tmp')),
    JSON.stringify(p));

  telas.salvar([{ cwd: 'C:\\x', feature: 'x', conteudo: 'x' }]);
  telas.apagarTudo();
  checar('apagarTudo leva a pasta', !fs.existsSync(telas.PASTA));
  fs.rmSync(PASTA_PURA, { recursive: true, force: true });
}

(async () => {
  nodePuro();

  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  checar('o addon esta pinado SEM ^ no par do xterm 5.5',
    pkg.dependencies['@xterm/addon-serialize'] === '0.13.0', pkg.dependencies['@xterm/addon-serialize']);

  let cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqCasca.mudar({ telas: 'guardar' })`);

  checar('o addon carregou na janela', await cdp.avaliar('Boolean(window.SerializeAddon && window.SerializeAddon.SerializeAddon)'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-telas-ui-'));
  const sub = (n) => { const d = path.join(dir, n); fs.mkdirSync(d); return d; };
  const dA = sub('a');
  const dC = sub('c');

  const PN = (id) => `window.OrqPainel.painelPorId.get(${JSON.stringify(id)})`;
  const criar = (o) => cdp.avaliar(`window.OrqGrade.criarPainel(${JSON.stringify(o)}).then((p) => p.id)`);

  // A: saida colorida e longa, escrita direto no xterm.
  const idA = await criar({ cwd: dA, feature: 'telas-a', tipoPainel: 'terminal' });
  await esperar(1200);
  await cdp.avaliar(`new Promise((ok) => {
    let t = '';
    for (let i = 1; i <= 700; i++) t += '\\x1b[31mL' + i + '\\x1b[0m\\r\\n';
    ${PN(idA)}.term.write(t + '\\x1b[?2004h', ok);
  })`);
  const retrato = await cdp.avaliar(`${PN(idA)}.retratoTela()`);
  checar('o retrato traz o fim da saida, com cor', /L700/.test(retrato) && retrato.includes('\x1b[31m'), String(retrato.length));
  checar('e deixa o comeco de fora (~500 linhas)', !/(^|[^\d])L5\D/.test(retrato) && /L300\D/.test(retrato));
  checar('o retrato NAO leva os modos (bracketed paste ligaria colagem num shell)', !retrato.includes('?2004h'));
  await cdp.avaliar(`${PN(idA)}.term.write('\\x1b[?2004l')`);

  // Bytes pendentes (painel fora da vista) entram crus no fim.
  const comPendente = await cdp.avaliar(`(() => {
    const p = ${PN(idA)};
    p.pendentes.push(new TextEncoder().encode('PENDENTE-XYZ'));
    const r = p.retratoTela();
    p.pendentes.length = 0;
    return r;
  })()`);
  checar('os bytes pendentes entram no retrato', comPendente.endsWith('PENDENTE-XYZ'));

  // C: comando com `cls &&`, para provar que o despertar o tira.
  const idC = await criar({ cwd: dC, feature: 'telas-c', tipoPainel: 'terminal', comandoInicial: 'cls && echo RETOMOU-%ORQ_PORTA:~0,0%OK' });
  await ate(() => cdp.avaliar(`${PN(idC)}.textoDoBuffer()`), (t) => /^RETOMOU-OK/m.test(t), 10000);

  // Medir o fechamento com 8 painéis cheios.
  const extras = [];
  for (let i = 0; i < 6; i++) {
    const id = await criar({ cwd: sub(`m${i}`), feature: `telas-m${i}`, tipoPainel: 'terminal' });
    extras.push(id);
  }
  await esperar(1500);
  await cdp.avaliar(`Promise.all(${JSON.stringify(extras)}.map((id) => new Promise((ok) => {
    let t = '';
    for (let i = 1; i <= 3000; i++) t += '\\x1b[3' + (i % 7) + 'mlinha ' + i + ' ' + 'x'.repeat(60) + '\\x1b[0m\\r\\n';
    window.OrqPainel.painelPorId.get(id).term.write(t, ok);
  })))`);
  const medida = JSON.parse(await cdp.avaliar(`(() => {
    const t0 = performance.now();
    const r = window.OrqGrade.salvarTelas();
    return JSON.stringify({ ...r, total: Math.round(performance.now() - t0) });
  })()`));
  console.log(`MEDIDA  salvarTelas com 8 painéis: ${medida.total}ms no total (main gravou em ${medida.ms}ms)`);
  checar('salvarTelas grava pelo sendSync', medida.gravados >= 8, JSON.stringify(medida));
  checar('e fecha rapido (< 300ms com 8 painéis cheios)', medida.total < 300, `${medida.total}ms`);
  checar('os arquivos estao na pasta do app', fs.readdirSync(PASTA_APP).filter((n) => n.endsWith('.ans')).length >= 8);

  // Fechar os PTYs no main SEM destruir os painéis (destruir apaga a tela).
  await cdp.avaliar(`[...window.OrqPainel.painelPorId.keys()].forEach((id) => window.orq.fecharTerminal(id))`);
  await esperar(500);

  // --- reload de verdade: beforeunload -> sendSync -> restaurarSessao ------------
  await cdp.enviar('Page.reload', {});
  await esperar(1500);
  cdp = await conectar();
  await aoFrente(cdp);
  const restaurado = await ate(() => cdp.avaliar(`JSON.stringify([...window.OrqPainel.painelPorId.values()]
      .filter((p) => p.feature === 'telas-a' || p.feature === 'telas-c')
      .map((p) => ({ id: p.id, feature: p.feature, dormindo: p.dormindo, tela: Boolean(p.telaAnterior),
        comTela: p.elDormindo.classList.contains('com-tela'), texto: p.textoDoBuffer() })))`).then(JSON.parse),
  (l) => l.length === 2 && l.every((p) => p.tela && /sessão anterior/.test(p.texto)), 15000);
  const a = (restaurado || []).find((p) => p.feature === 'telas-a') || {};
  const c = (restaurado || []).find((p) => p.feature === 'telas-c') || {};
  // L400, e nao L700: o ConPTY repinta a area visivel do shell por cima do que o
  // teste escreveu direto no xterm, entao o fim some. O scrollback, nao.
  checar('o painel volta dormindo e COM a saida da vez anterior', a.dormindo === true && /^L400$/m.test(a.texto || ''),
    (a.texto || '').slice(-200));
  checar('com o separador da sessao anterior', /— sessão anterior · salva em \d\d\/\d\d/.test(a.texto || ''));
  checar('o separador vem DEPOIS do conteudo', (a.texto || '').indexOf('L400') < (a.texto || '').indexOf('sessão anterior'));
  checar('o cartao de retomar vira rodape e deixa o texto aparecer', a.comTela === true);

  const corRestaurada = await cdp.avaliar(`(() => {
    const b = ${PN(a.id)}.term.buffer.active;
    for (let i = 0; i < b.length; i++) {
      const l = b.getLine(i);
      if (l && l.translateToString(true) === 'L400') return l.getCell(0).getFgColor();
    }
    return -1;
  })()`);
  checar('a cor sobreviveu (L400 em vermelho, cor 1 da paleta)', corRestaurada === 1, String(corRestaurada));
  checar('e o painel restaurado nao herdou o bracketed paste',
    await cdp.avaliar(`${PN(a.id)}.term.modes.bracketedPasteMode`) === false);

  // Retomar C: o comando vai SEM o `cls &&`, e o texto anterior fica.
  await cdp.avaliar(`window.OrqGrade.despertar(${JSON.stringify(c.id)}).then(() => 1)`);
  const depois = await ate(() => cdp.avaliar(`${PN(c.id)}.textoDoBuffer()`),
    (t) => (t.match(/^RETOMOU-OK/gm) || []).length >= 2, 12000);
  checar('retomar com tela nao manda o cls', !/cls && echo RETOMOU/.test(depois.split('sessão anterior')[1] || ''),
    (depois.split('sessão anterior')[1] || '').slice(0, 200));
  checar('e o texto da vez anterior continua acima', /sessão anterior/.test(depois)
    && (depois.match(/^RETOMOU-OK/gm) || []).length >= 2, depois.slice(-300));

  // Fechar o painel apaga a tela dele na hora.
  const antes = fs.readdirSync(PASTA_APP).length;
  await cdp.avaliar(`${PN(a.id)}.destruir()`);
  const agora = await ate(async () => fs.readdirSync(PASTA_APP).length, (n) => n === antes - 1, 4000);
  checar('fechar o painel apaga a tela dele', agora === antes - 1, `${antes} -> ${agora}`);

  // Desligar apaga a pasta e para de gravar.
  await cdp.avaliar('window.OrqGrade.alternarTelas()');
  const sumiu = await ate(async () => !fs.existsSync(PASTA_APP), (x) => x === true, 4000);
  checar('desligar apaga a pasta das telas', sumiu === true);
  checar('e desligado nao grava nada', await cdp.avaliar('window.OrqGrade.salvarTelas()') === null && !fs.existsSync(PASTA_APP));
  await cdp.avaliar('window.OrqGrade.alternarTelas()');

  await zerarGrade(cdp);
  await cdp.avaliar('window.orq.sessaoSalvar([])');
  await esperar(500);
  fs.rmSync(dir, { recursive: true, force: true });
  encerrar('TELAS');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
