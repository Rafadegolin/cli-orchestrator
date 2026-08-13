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
  // Espera pela CONDICAO: a gravacao passa por um debounce de 500ms mais o IPC
  // e a escrita atomica, e com a janela em segundo plano o timer do debounce
  // ainda e limitado pelo Chromium. Tempo fixo aqui vira teste intermitente.
  let salvos = [];
  for (let i = 0; i < 40; i++) {
    salvos = lerSessao();
    if (salvos.filter((p) => (p.ligacoes || []).length > 0).length === 2) break;
    await esperar(200);
  }
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

  // --- 5b. a aplicacao no CLI, com buffer FALSO ---------------------------
  //
  // Este era o buraco: `aplicarEmSessaoViva` nunca era exercitada por teste
  // nenhum -- os dois `ligar()` acima passam `{ aplicar: false }`, e o unico
  // teste que entrava ali e o `ligacoes-reais`, que leva ~3min e gasta token.
  // Trocando o `textoDoBuffer` do painel por um roteiro, os quatro caminhos
  // rodam em segundos e sem CLI nenhum.
  const CONF = 'Add directory to workspace';
  // A quebra E DE VERDADE (\n), e nao a sequencia literal: e ela que o
  // `achatar` tem de colapsar. Com barra-n literal o teste passaria a testar
  // outra coisa.
  const OK_QUEBRADO = 'Added C:\\repos\\api as\na working directory for this session';

  async function comBuffer(id, roteiro, chamada) {
    await cdp.avaliar(`(() => {
      const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
      p.__real = p.textoDoBuffer;
      let i = 0;
      const passos = ${JSON.stringify(roteiro)};
      p.textoDoBuffer = () => passos[Math.min(i++, passos.length - 1)];
      return 'ok';
    })()`);
    const r = await cdp.avaliar(chamada);
    await cdp.avaliar(`(() => {
      const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
      p.textoDoBuffer = p.__real; delete p.__real; return 'ok';
    })()`);
    return r;
  }

  const alvo = ids[0];
  const CAMINHO = 'C:/repos/api';
  const chamar = (ms = 1200) => `(async () => JSON.stringify(await window.OrqLigacoes.ligar(
    ${JSON.stringify(alvo)}, ${JSON.stringify(CAMINHO)}, { ms: ${ms} })))()`;

  // (a) caminho feliz -- e com a resposta QUEBRADA em duas linhas, que e como
  // ela chega de verdade num painel estreito. Medido no CLI: era exatamente
  // isso que fazia uma ligacao bem-sucedida parecer ter falhado.
  const feliz = JSON.parse(await comBuffer(alvo, ['', CONF, CONF, `${CONF} ${OK_QUEBRADO}`], chamar()));
  checar('confirmacao encontrada: a ligacao e dada como aplicada',
    feliz.ok === true && feliz.aplicado === true, JSON.stringify(feliz));
  checar('e a resposta quebrada em duas linhas ainda casa',
    (await cdp.avaliar(`window.OrqLigacoes.pendenteEm(${JSON.stringify(alvo)}, ${JSON.stringify(CAMINHO)})`)) === false, '');

  await cdp.avaliar(`window.OrqLigacoes.desligar(${JSON.stringify(alvo)}, ${JSON.stringify(CAMINHO)})`);

  // (b) estouro de tempo: o CLI nunca pergunta nada.
  const estourou = JSON.parse(await comBuffer(alvo, ['', '', ''], chamar(900)));
  checar('sem confirmacao a tempo, ligar FALHA em vez de mentir',
    estourou.ok === false && Boolean(estourou.motivo), JSON.stringify(estourou));
  checar('e a ligacao fica PENDENTE, nao concluida',
    (await cdp.avaliar(`window.OrqLigacoes.pendenteEm(${JSON.stringify(alvo)}, ${JSON.stringify(CAMINHO)})`)) === true, '');

  // (c) O CONSERTO PRINCIPAL: tentar de novo depois de falhar tem de TENTAR.
  // Antes o registro ja estava gravado, `novo === false` pulava tudo, e a
  // segunda tentativa devolvia `ok: true` sem mandar coisa nenhuma.
  const retry = JSON.parse(await comBuffer(alvo, ['', CONF, `${CONF} ${OK_QUEBRADO}`], chamar()));
  checar('tentar de novo depois de falhar realmente tenta',
    retry.ok === true && retry.aplicado === true, JSON.stringify(retry));
  checar('e a pendencia some quando da certo',
    (await cdp.avaliar(`window.OrqLigacoes.pendenteEm(${JSON.stringify(alvo)}, ${JSON.stringify(CAMINHO)})`)) === false, '');

  await cdp.avaliar(`window.OrqLigacoes.desligar(${JSON.stringify(alvo)}, ${JSON.stringify(CAMINHO)})`);

  // (d) marca VELHA no scrollback nao vale: sem o corte por frescor, uma
  // confirmacao de dez minutos atras fazia o app disparar um Enter no que
  // estivesse na tela e reportar sucesso.
  const velho = JSON.parse(await comBuffer(alvo, [`${CONF} ${OK_QUEBRADO}`], chamar(900)));
  checar('confirmacao velha no scrollback nao conta como resposta de agora',
    velho.ok === false, JSON.stringify(velho));

  await cdp.avaliar(`window.OrqLigacoes.desligar(${JSON.stringify(alvo)}, ${JSON.stringify(CAMINHO)})`);

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

  // --- 8. ligacao pendente NAO pode corromper a saida do painel -----------
  //
  // `pendentes` do Painel guarda os Uint8Array de saida de painel fora da vista
  // (Fase 6.1), com `pendentesBytes` contando o total. As ligacoes usavam ESSE
  // MESMO campo para caminhos que o CLI ainda nao aceitou -- strings empurradas
  // num array de bytes, sem mexer no contador. O `descarregarPendentes()`
  // seguinte alocava um buffer menor que o conteudo e fazia
  // `junto.set(string, off)`: bytes viravam zero, e o offset podia estourar.
  //
  // O sintoma seria uma ligacao falha corrompendo a saida de OUTRO painel que
  // estivesse rolado para fora da tela -- longe o bastante da causa para custar
  // uma tarde.
  await zerarGrade(cdp);
  await esperar(800);

  const idB = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(RAIZ_URL)}, feature: 'buffer' }); return p.id; })()`);
  await esperar(2000);

  const separados = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(idB)});
    // Uma ligacao pendente, como uma falha de /add-dir deixaria.
    window.OrqLigacoes.ligar; // so para deixar claro de onde vem o campo
    p.ligacoesPendentes = ['C:/algum/caminho'];
    return JSON.stringify({
      pendentesEhBytes: Array.isArray(p.pendentes) && p.pendentes.every(x => x instanceof Uint8Array),
      camposSeparados: p.ligacoesPendentes.length === 1 && p.pendentes.length === 0,
    });
  })()`));
  checar('caminho pendente nao entra no buffer de bytes do painel',
    separados.pendentesEhBytes && separados.camposSeparados, JSON.stringify(separados));

  // Agora o caminho completo: painel fora da vista, saida chegando, e volta.
  const MARCA = 'BUFFER_INTEIRO_9F3A';
  await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(idB)});
    p.definirVisivel(false);
    const enc = new TextEncoder();
    for (let i = 0; i < 40; i++) p.escreverBytes(enc.encode('linha ' + i + ' ${MARCA}\\r\\n'));
    return 'ok';
  })()`);
  await esperar(300);

  // O `term.write` do xterm e ASSINCRONO: o que o flush entregou so aparece no
  // buffer no passo seguinte do parser. Ler na mesma chamada le o passado --
  // e a mesma razao pela qual todo mundo que espera algo no buffer usa laco.
  const erroAoVoltar = await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(idB)});
    try { p.definirVisivel(true); return ''; } catch (e) { return String(e); }
  })()`);
  await esperar(800);

  const voltou = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(idB)});
    const erro = ${JSON.stringify(erroAoVoltar)};
    const texto = p.textoDoBuffer();
    return JSON.stringify({
      erro,
      ocorrencias: (texto.match(/${MARCA}/g) || []).length,
      temNulo: texto.includes('\\u0000'),
      pendentesZerado: p.pendentes.length === 0 && p.pendentesBytes === 0,
      ligacaoIntacta: (p.ligacoesPendentes || []).length === 1,
    });
  })()`));

  checar('descarregar o buffer com ligacao pendente nao estoura', voltou.erro === '', voltou.erro);
  checar('e a saida volta INTEIRA, sem bytes zerados',
    voltou.ocorrencias === 40 && !voltou.temNulo,
    `${voltou.ocorrencias}/40 nulos=${voltou.temNulo}`);
  checar('o buffer de bytes zera e a ligacao pendente continua la',
    voltou.pendentesZerado && voltou.ligacaoIntacta, JSON.stringify(voltou));

  // E o campo novo sobrevive ao fechar e reabrir, senao uma ligacao que falhou
  // volta parecendo aplicada e o botao de tentar de novo some.
  await cdp.avaliar(`window.OrqGrade.salvarSessao({ agora: true })`);
  await esperar(900);
  const gravado = lerSessao().find((p) => p.feature === 'buffer');
  checar('ligacao pendente e gravada no sessao.json',
    (gravado?.ligacoesPendentes || []).length === 1, JSON.stringify(gravado?.ligacoesPendentes));

  await zerarGrade(cdp);
  await cdp.avaliar(`window.orq.sessaoSalvar([])`);
  fs.rmSync(OUTRO, { recursive: true, force: true });

  encerrar('LIGACOES');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
