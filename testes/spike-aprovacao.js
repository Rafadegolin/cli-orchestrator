'use strict';
// SPIKE: como a tela do Claude se parece em cada momento, e em que ORDEM os
// hooks chegam em volta de um pedido de permissao.
//
// Nao e um teste de passa/falha do app -- e a MEDICAO de onde saem duas marcas
// do `aprovacao.js`, e a resposta para "vale registrar o PreToolUse?".
// Consome tokens e leva alguns minutos.
//
// O QUE ELE RESPONDE:
//
//  1. Qual texto separa "prompt na tela esperando resposta" de "prompt ja
//     respondido, ainda rolando na tela, com a sessao trabalhando". Sem isso o
//     farejador reacende amarelo em cima de quem voltou a trabalhar -- que e o
//     relato que originou este spike.
//  2. Se `MARCA_TRABALHANDO` de fato so aparece durante o trabalho. E o sinal
//     AFIRMATIVO que autoriza o farejador a apagar; se ele vazar para o momento
//     do prompt, o app passaria a apagar amarelo verdadeiro.
//  3. Se o `PreToolUse` roda ANTES ou DEPOIS do prompt de permissao. Se for
//     antes, ele nao marca "permissao concedida" e registra-lo so somaria custo
//     de hook por ferramenta -- e a resposta fica escrita para ninguem tentar
//     de novo.
//
// As marcas testadas sao lidas do APP RODANDO (`window.OrqAprovacao`), nunca
// copiadas para ca: o spike tem de medir o que esta em producao.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { conectar, esperar, zerarGrade, aoFrente } = require('./cdp');

const PASTA = path.join(os.tmpdir(), 'orq-spike-aprovacao').replace(/\\/g, '/');
const SAIDA = path.join(PASTA, 'capturas.json');

// Porta propria: os hooks do usuario (47615) seguem funcionando e mexendo no
// painel de verdade, e este coletor so OBSERVA a ordem, sem disputar nada.
const PORTA_COLETOR = 47616;

const PEDIDO = 'Crie o arquivo marca.txt nesta pasta com exatamente o conteudo OK, e nada mais.';

const eventos = [];
let t0 = Date.now();

// -------------------------------------------------------------- o coletor

function subirColetor() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '2' });
      res.end('ok');
      const partes = req.url.split('/').filter(Boolean);
      eventos.push({ ms: Date.now() - t0, evento: partes[1] || '?', tipo: partes[2] || '' });
    });
    s.listen(PORTA_COLETOR, '127.0.0.1', () => ok(s));
  });
}

// Hooks de ESCOPO DE PROJETO, dentro da pasta descartavel. Nao encosta no
// ~/.claude/settings.json do usuario -- medir nao pode custar a configuracao de
// quem esta medindo.
function escreverHooks() {
  const cmd = (evento, tipo = '') => ({
    hooks: [{
      type: 'command',
      command: `curl -s --connect-timeout 0.2 -m 2 --data-binary @- `
        + `http://127.0.0.1:${PORTA_COLETOR}/evento/${evento}${tipo ? '/' + tipo : ''} || exit 0`,
      timeout: 3,
    }],
  });

  const settings = {
    hooks: {
      // O que este spike existe para observar: onde ele cai em relacao ao
      // Notification.
      PreToolUse: [cmd('PreToolUse')],
      PostToolUse: [cmd('PostToolUse')],
      Notification: [
        { matcher: 'permission_prompt', ...cmd('Notification', 'permissao') },
        { matcher: 'idle_prompt', ...cmd('Notification', 'ocioso') },
      ],
      Stop: [cmd('Stop')],
    },
  };

  fs.mkdirSync(path.join(PASTA, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(PASTA, '.claude', 'settings.json'),
    JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

// -------------------------------------------------------------- capturas

const capturas = [];

// O REGISTRO de sessoes que o CLI mantem em ~/.claude/sessions/<pid>.json.
//
// Amostrado junto de cada captura para responder UMA pergunta, e ela decide se
// o app pode usar esse arquivo como fonte de status: durante um prompt de
// permissao, o CLI diz `busy` ou `idle`?
//
// Se disser `busy`, entao `busy` NAO e evidencia de trabalho e usar isso para
// apagar amarelo esconderia sessao bloqueada -- o erro na direcao cara. Se
// disser `idle`, `busy` e afirmativo e serve como o `MARCA_TRABALHANDO` serve.
const PASTA_SESSOES = path.join(os.homedir(), '.claude', 'sessions');

function lerRegistro(cwdAlvo) {
  const chave = (p) => String(p || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  const alvo = chave(cwdAlvo);
  let nomes = [];
  try { nomes = fs.readdirSync(PASTA_SESSOES).filter((f) => f.endsWith('.json')); } catch { return null; }

  for (const n of nomes) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(PASTA_SESSOES, n), 'utf8'));
      const c = chave(s.cwd);
      if (c === alvo || c.startsWith(alvo + '/')) {
        return { pid: s.pid, nome: s.name || '', nomeDe: s.nameSource || 'dado', status: s.status || '' };
      }
    } catch { /* arquivo sendo escrito agora */ }
  }
  return null;
}

// Le a tela ACHATADA e a classifica com as marcas do app. Guardar o texto cru
// junto e o que permite reanalisar depois sem rodar o spike de novo.
async function capturar(cdp, id, momento) {
  const bruto = await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
    if (!p) return '{}';
    const A = window.OrqAprovacao;
    const tela = window.OrqPainel.achatar(p.textoDaTela({ flush: true }));
    const pedido = A.lerPedido(tela);
    return JSON.stringify({
      tela,
      opcao: A.MARCA_OPCAO.test(tela),
      trabalhando: A.MARCA_TRABALHANDO.test(tela),
      forma: pedido ? pedido.forma : '',
      pergunta: pedido ? pedido.pergunta : '',
      status: p.status,
    });
  })()`);

  const c = { momento, ms: Date.now() - t0, ...JSON.parse(bruto), registro: lerRegistro(PASTA) };
  capturas.push(c);
  console.log(`  [${String(c.ms).padStart(6)}ms] ${momento.padEnd(28)} `
    + `pedido=${(c.forma || '-').padEnd(9)} trabalhando=${c.trabalhando ? 'SIM' : 'nao'} `
    + `status=${c.status.padEnd(9)} registro=${c.registro ? c.registro.status || '(vazio)' : '-'}`);
  return c;
}

async function ateQue(cdp, expr, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cdp.avaliar(expr)) return true;
    await esperar(500);
  }
  return false;
}

const lerBuffer = (id) => `(() => {
  const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
  return p ? p.textoDoBuffer() : '';
})()`;

// ----------------------------------------------------------------- spike

(async () => {
  const observar = process.argv.includes('--observar');
  const segundos = Number((process.argv.find((a) => /^--segundos=/.test(a)) || '').split('=')[1]) || 120;

  fs.rmSync(PASTA, { recursive: true, force: true });
  fs.mkdirSync(PASTA, { recursive: true });
  escreverHooks();
  const servidor = await subirColetor();

  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  const id = await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
    { cwd: ${JSON.stringify(PASTA)}, feature: 'spike', comandoInicial: 'cls && claude' });
    return p.id; })()`);

  // Pasta nova pede confirmacao de confianca antes de qualquer coisa.
  if (await ateQue(cdp, `${lerBuffer(id)}.includes('trust')`, 45000)) {
    await esperar(1500);
    await cdp.avaliar(`window.orq.escrever(${JSON.stringify(id)}, '\\r')`);
    await esperar(4000);
  }
  if (!await ateQue(cdp, `${lerBuffer(id)}.includes('for shortcuts')`, 90000)) {
    console.error('a sessao do Claude nao subiu; abortando');
    process.exit(3);
  }
  await esperar(2000);

  // ---------------------------------------------------------------------
  // MODO OBSERVAR: o prompt de PLANO nao da para provocar por escrito (ele vem
  // do shift+tab, que e estado da TUI). Entao aqui o spike so fica capturando e
  // quem opera provoca a mao -- entrar em plan mode e pedir um plano qualquer.
  // ---------------------------------------------------------------------
  if (observar) {
    console.log(`\nOBSERVANDO por ${segundos}s. Provoque o prompt de plano nesse painel:`);
    console.log('  shift+tab ate "plan mode on", peca um plano, e espere ele perguntar.\n');
    t0 = Date.now();
    const fim = Date.now() + segundos * 1000;
    let n = 0;
    while (Date.now() < fim) {
      await capturar(cdp, id, `observando-${++n}`);
      await esperar(2000);
    }
  } else {
    // -------------------------------------------------------------------
    // MOMENTOS 1 a 3: o ciclo de um pedido de permissao de verdade.
    // -------------------------------------------------------------------
    t0 = Date.now();
    eventos.length = 0;
    await cdp.avaliar(`(async () => { await window.OrqLigacoes.enviarLinha(
      ${JSON.stringify(id)}, ${JSON.stringify(PEDIDO)}); return 'ok'; })()`);

    console.log('\nesperando o Claude pedir permissao...\n');

    // 1. O prompt ATIVO na tela. Detectado pelo texto, e nao pelo status: o
    //    hook so chega ~6s depois, e o instante que interessa e o da tela.
    const apareceu = await ateQue(cdp,
      `(() => { const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
        return !!window.OrqAprovacao.lerPedido(
          window.OrqPainel.achatar(p.textoDaTela({ flush: true }))); })()`, 180000);
    if (!apareceu) {
      console.error('o Claude nao pediu permissao; abortando');
      process.exit(3);
    }
    await capturar(cdp, id, '1-prompt-ativo');
    await esperar(1500);
    await capturar(cdp, id, '1-prompt-ativo-1.5s');

    // 2 e 3. Responde e acompanha de perto: e nesta faixa que o farejador
    //        errava, reacendendo por cima de uma sessao ja trabalhando.
    console.log('\nrespondendo "1" e acompanhando...\n');
    await cdp.avaliar(`window.orq.escrever(${JSON.stringify(id)}, '1')`);

    for (let i = 1; i <= 12; i++) {
      await esperar(1000);
      await capturar(cdp, id, `2-apos-responder-${i}s`);
    }
  }

  // ----------------------------------------------------------------- saida

  fs.writeFileSync(SAIDA, JSON.stringify({ capturas, eventos }, null, 2), 'utf8');

  console.log('\n================ ORDEM DOS HOOKS ================');
  if (!eventos.length) {
    console.log('  nenhum evento chegou ao coletor.');
    console.log('  (hooks de escopo de projeto podem exigir confianca na pasta)');
  }
  for (const e of eventos) {
    console.log(`  [${String(e.ms).padStart(6)}ms] ${e.evento}${e.tipo ? '/' + e.tipo : ''}`);
  }

  const iPre = eventos.findIndex((e) => e.evento === 'PreToolUse');
  const iNot = eventos.findIndex((e) => e.evento === 'Notification');
  if (iPre >= 0 && iNot >= 0) {
    console.log(`\n  PreToolUse ${iPre < iNot ? 'ANTES' : 'DEPOIS'} do Notification.`);
    console.log(iPre < iNot
      ? '  => NAO registrar PreToolUse: ele nao marca permissao concedida,\n'
        + '     so somaria um hook por uso de ferramenta.'
      : '  => registrar PreToolUse no lugar do PostToolUse: mesmo status,\n'
        + '     mesmo custo, e chega no instante da concessao.');
  }

  console.log('\n================ AS MARCAS ================');
  const comPedido = capturas.filter((c) => c.forma);
  const trabalhando = capturas.filter((c) => c.trabalhando);
  const ambos = capturas.filter((c) => c.forma && c.trabalhando);

  console.log(`  capturas: ${capturas.length}`);
  console.log(`  com pedido reconhecido: ${comPedido.length}  (formas: `
    + `${[...new Set(comPedido.map((c) => c.forma))].join(', ') || '-'})`);
  console.log(`  com sinal de trabalho:  ${trabalhando.length}`);
  console.log(`  com OS DOIS ao mesmo tempo: ${ambos.length}`);
  if (ambos.length) {
    console.log('\n  ATENCAO: prompt e sinal de trabalho na MESMA tela.');
    console.log('  E a sobreposicao que faz o farejador errar. Momentos:');
    for (const c of ambos) console.log(`    - ${c.momento}`);
    console.log('  Reveja MARCA_TRABALHANDO em src/janela/aprovacao.js com o texto salvo.');
  } else if (comPedido.length && trabalhando.length) {
    console.log('\n  As duas marcas SEPARAM os momentos corretamente.');
  }

  console.log(`\ncapturas completas (com o texto cru da tela) em:\n  ${SAIDA}`);
  console.log('\nA pasta NAO e apagada: o texto cru e o valor deste spike.');

  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(id)})?.destruir()`);
  await esperar(1500);
  await zerarGrade(cdp);
  await cdp.avaliar(`window.orq.sessaoSalvar([])`);
  servidor.close();
  process.exit(0);
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
