'use strict';
// Ligar sessoes entre repositorios.
//
// Nao invoca o Claude: a prova de que o --add-dir funciona de verdade esta em
// testes/ligacoes-reais.js, que e lento e por isso fica separado. Aqui se
// verifica a mecanica -- montagem do comando, espelho, persistencia e injecao.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
const RAIZ_URL = RAIZ.replace(/\\/g, '/');
const ARQ = path.join(RAIZ, '.dev-udata', 'dados', 'sessao.json');
const OUTRO = path.join(os.tmpdir(), 'orq-teste-ligacoes-repo-b');

function lerSessao() {
  try {
    return JSON.parse(fs.readFileSync(ARQ, 'utf8')).paineis || [];
  } catch {
    return [];
  }
}

async function ateQue(cdp, expr, ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cdp.avaliar(expr)) return true;
    await esperar(250);
  }
  return false;
}

(async () => {
  fs.mkdirSync(OUTRO, { recursive: true });
  fs.writeFileSync(path.join(OUTRO, 'marca.txt'), 'outro repo\n');

  const cdp = await conectar();
  await zerarGrade(cdp);
  await esperar(800);

  checar('modulo de ligacoes carregou',
    await cdp.avaliar(`typeof window.OrqLigacoes?.comAddDir`) === 'function');

  // --- 1. montagem do comando (funcao pura) -------------------------------
  const casos = JSON.parse(await cdp.avaliar(`JSON.stringify({
    semLigacao: window.OrqLigacoes.comAddDir('cls && claude -w feat', []),
    uma:        window.OrqLigacoes.comAddDir('cls && claude -w feat', ['C:/repos/api']),
    duas:       window.OrqLigacoes.comAddDir('cls && claude -c', ['C:/repos/api', 'C:/repos/web']),
    espaco:     window.OrqLigacoes.comAddDir('cls && claude', ['C:/Program Files/app']),
    repetida:   window.OrqLigacoes.comAddDir('cls && claude', ['C:/repos/api', 'C:/repos/api']),
    semClaude:  window.OrqLigacoes.comAddDir('npm run dev', ['C:/repos/api'])
  })`));

  checar('sem ligacao, o comando nao muda',
    casos.semLigacao === 'cls && claude -w feat', casos.semLigacao);
  checar('a flag entra DEPOIS de claude e ANTES dos argumentos',
    casos.uma === 'cls && claude --add-dir "C:\\repos\\api" -w feat', casos.uma);
  checar('duas ligacoes viram duas flags',
    casos.duas === 'cls && claude --add-dir "C:\\repos\\api" --add-dir "C:\\repos\\web" -c', casos.duas);
  checar('caminho com espaco vai entre aspas',
    casos.espaco === 'cls && claude --add-dir "C:\\Program Files\\app"', casos.espaco);
  checar('caminho repetido nao vira flag duplicada',
    (casos.repetida.match(/--add-dir/g) || []).length === 1, casos.repetida);
  checar('comando que nao e claude fica intacto',
    casos.semClaude === 'npm run dev', casos.semClaude);

  // --- 2. espelho entre dois painéis --------------------------------------
  const ids = [];
  for (const [f, cwd] of [['back', RAIZ_URL], ['front', OUTRO.replace(/\\/g, '/')]]) {
    ids.push(await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(cwd)}, feature: '${f}' }); return p.id; })()`));
    await esperar(600);
  }
  await esperar(1200);

  // aplicar:false porque aqui roda cmd.exe, nao Claude -- a injecao e testada
  // separado, e mandar /add-dir para o cmd so encheria o terminal de erro.
  const dupla = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.OrqLigacoes.ligar(${JSON.stringify(ids[0])},
      ${JSON.stringify(OUTRO.replace(/\\/g, '/'))}, { aplicar: false });
    const a = window.OrqPainel.painelPorId.get(${JSON.stringify(ids[0])});
    const b = window.OrqPainel.painelPorId.get(${JSON.stringify(ids[1])});
    return JSON.stringify({ r, ligA: a.ligacoes, ligB: b.ligacoes });
  })()`));

  checar('ligar registra no painel de origem', dupla.ligA.length === 1, JSON.stringify(dupla.ligA));
  checar('e o espelho registra no painel de destino: a ligacao e mutua',
    dupla.ligB.length === 1, JSON.stringify(dupla.ligB));
  checar('o app reconhece que foi mutua', dupla.r.mutua === true, JSON.stringify(dupla.r));

  const etiqueta = await cdp.avaliar(
    `window.OrqPainel.painelPorId.get(${JSON.stringify(ids[0])}).elLigacoes.textContent`);
  checar('o cabecalho mostra a contagem', etiqueta === '1 ligado', etiqueta);

  // --- 3. persistencia ----------------------------------------------------
  await esperar(1200);
  const salvos = lerSessao();
  const comLig = salvos.filter((p) => (p.ligacoes || []).length > 0);
  checar('as ligacoes dos DOIS lados foram para o JSON', comLig.length === 2,
    JSON.stringify(salvos.map((p) => ({ f: p.feature, l: (p.ligacoes || []).length }))));

  // --- 4. nao se liga a si mesmo ------------------------------------------
  const proprio = JSON.parse(await cdp.avaliar(`(async () => JSON.stringify(
    await window.OrqLigacoes.ligar(${JSON.stringify(ids[0])}, ${JSON.stringify(RAIZ_URL)}, { aplicar: false })))()`));
  checar('um painel nao se liga a si mesmo', proprio.ok === false, JSON.stringify(proprio));

  // --- 5. desligar tira dos dois ------------------------------------------
  const desligou = JSON.parse(await cdp.avaliar(`(() => {
    const r = window.OrqLigacoes.desligar(${JSON.stringify(ids[0])}, ${JSON.stringify(OUTRO.replace(/\\/g, '/'))});
    const a = window.OrqPainel.painelPorId.get(${JSON.stringify(ids[0])});
    const b = window.OrqPainel.painelPorId.get(${JSON.stringify(ids[1])});
    return JSON.stringify({ r, ligA: a.ligacoes.length, ligB: b.ligacoes.length });
  })()`));
  checar('desligar limpa os dois lados',
    desligou.ligA === 0 && desligou.ligB === 0, JSON.stringify(desligou));
  checar('e avisa que a sessao viva so perde o acesso ao reiniciar',
    desligou.r.precisaReiniciar === true, JSON.stringify(desligou.r));

  // --- 6. injecao em sessao viva: o texto chega ao terminal certo ---------
  await cdp.avaliar(`(async () => { await window.OrqLigacoes.enviarLinha(
    ${JSON.stringify(ids[0])}, 'echo ORQ_LINHA_ENVIADA'); return 'ok'; })()`);

  const chegou = await ateQue(cdp, `(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(ids[0])});
    const b = p.term.buffer.active; let t = '';
    for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true);
    return t.includes('ORQ_LINHA_ENVIADA');
  })()`, 10000);
  checar('enviarLinha digita e envia de fato no painel certo', chegou, '');

  const noOutro = await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(ids[1])});
    const b = p.term.buffer.active; let t = '';
    for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true);
    return t.includes('ORQ_LINHA_ENVIADA');
  })()`);
  checar('e nao vaza para o painel vizinho', noOutro === false, String(noOutro));

  // --- 7. painel dormindo desperta com as flags ---------------------------
  await zerarGrade(cdp);
  await esperar(1000);
  await cdp.avaliar(`window.orq.sessaoSalvar(${JSON.stringify([{
    feature: 'dorme', cwd: RAIZ_URL, comandoInicial: 'cls && claude -c',
    ligacoes: [OUTRO.replace(/\\/g, '/')], ordem: 0,
  }])})`);
  await esperar(500);
  await cdp.avaliar(`(async () => { await window.OrqGrade.restaurarSessao(); return 'ok'; })()`);
  await esperar(2000);

  const restaurado = JSON.parse(await cdp.avaliar(`(() => {
    const p = [...window.OrqGrade.painelPorId.values()][0];
    return JSON.stringify({
      ligacoes: p.ligacoes,
      dormindo: p.dormindo,
      comandoQueVaiRodar: window.OrqLigacoes.comAddDir(p.comandoInicial, p.ligacoes),
    });
  })()`));
  checar('painel restaurado volta com as ligacoes',
    restaurado.ligacoes.length === 1, JSON.stringify(restaurado.ligacoes));
  checar('e o comando de despertar ja sai com a flag',
    restaurado.comandoQueVaiRodar.includes('--add-dir'), restaurado.comandoQueVaiRodar);

  await zerarGrade(cdp);
  await cdp.avaliar(`window.orq.sessaoSalvar([])`);
  fs.rmSync(OUTRO, { recursive: true, force: true });

  encerrar('LIGACOES');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
