'use strict';

// Driver CDP minimo: liga no Electron pela porta de depuracao e avalia JS
// dentro da janela real. Testa o codigo de producao sem instrumenta-lo.

const PORTA_CDP = 9222;

// Para as DUAS suites que sobem o proprio app (empacotado e sac): se ja houver
// alguem na porta de depuracao, o app que elas lancam nao consegue bindar e o
// `conectar()` cai no app que ja estava la. A suite roda inteira, passa ou
// falha -- testando outro programa. Ja aconteceu, e a mensagem de erro nao
// tinha nada a ver com a causa.
async function exigirPortaLivre(porta = PORTA_CDP) {
  try {
    await fetch(`http://127.0.0.1:${porta}/json/version`, { signal: AbortSignal.timeout(1500) });
  } catch {
    return; // ninguem atendeu: livre, que e o que queremos
  }
  console.error(`\nJa ha um Electron na porta ${porta} -- provavelmente o \`npm run dev\`.`);
  console.error('Esta suite SOBE o proprio app, entao ele nao conseguiria a porta e o teste');
  console.error('rodaria contra a instancia errada. Feche a outra antes.');
  process.exit(2);
}

async function acharAlvo(porta, tentativas = 80) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/json/list`);
      const alvos = await r.json();
      const pagina = alvos.find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
      if (pagina) return pagina;
    } catch { /* app ainda subindo */ }
    await new Promise((s) => setTimeout(s, 250));
  }
  throw new Error('nao achei o alvo CDP -- o app esta rodando? use `npm run dev`');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pendentes = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pendentes.has(m.id)) {
        const { ok, falha } = this.pendentes.get(m.id);
        this.pendentes.delete(m.id);
        m.error ? falha(new Error(JSON.stringify(m.error))) : ok(m.result);
      }
    });
  }

  enviar(metodo, params = {}) {
    const id = ++this.id;
    return new Promise((ok, falha) => {
      this.pendentes.set(id, { ok, falha });
      this.ws.send(JSON.stringify({ id, method: metodo, params }));
    });
  }

  // Sempre devolva primitivos ou JSON.stringify: mandar um objeto com DOM ou
  // um Terminal do xterm de volta estoura o serializador do CDP.
  async avaliar(expressao) {
    const r = await this.enviar('Runtime.evaluate', {
      expression: expressao,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function conectar(porta = PORTA_CDP) {
  const alvo = await acharAlvo(porta);
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((ok, falha) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => falha(new Error('websocket do CDP falhou')), { once: true });
  });
  const cdp = await new Cdp(ws);
  await cdp.enviar('Runtime.enable');
  return cdp;
}

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
  return ok;
}
function encerrar(rotulo) {
  console.log(falhas === 0 ? `\n${rotulo}_OK` : `\n${rotulo}_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
}

const esperar = (ms) => new Promise((s) => setTimeout(s, ms));

// Traz a janela para frente e espera ela realmente estar desenhando.
//
// OBRIGATORIO em qualquer teste que dependa de layout. O Chromium PAUSA os
// passos de renderizacao quando a janela esta em segundo plano, e junto com
// eles para de entregar IntersectionObserver e ResizeObserver -- entao painel
// rolado para fora nunca e marcado invisivel, e resize nunca reflui. O sintoma
// e um teste que falha sem nada ter mudado no app.
//
// E a mesma familia do clamp de setTimeout para ~1/s em segundo plano.
async function aoFrente(cdp, ms = 10000) {
  await cdp.enviar('Page.enable').catch(() => {});

  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    // Pede a cada volta, e nao so uma vez: outro processo pode roubar o foco no
    // meio da espera -- `testes/arvore.js`, que mata arvores de processo, faz
    // isso com frequencia e a suite seguinte pagava o pato.
    await cdp.enviar('Page.bringToFront').catch(() => {});
    await cdp.avaliar('window.orq.focarJanela()').catch(() => {});

    // Timer nao limitado e o sinal de que a renderizacao voltou a rodar.
    const clamp = await cdp.avaliar(`(async () => {
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 2));
      return (performance.now() - t0) / 4;
    })()`);
    if (clamp < 100) return true;
    await esperar(300);
  }
  return false;
}

// Limpa a grade entre testes.
async function zerarGrade(cdp) {
  await cdp.avaliar(`(() => { for (const p of [...window.OrqGrade.painelPorId.values()]) p.destruir(); return 'ok'; })()`);
  await esperar(1500);
}

module.exports = {
  conectar, checar, encerrar, esperar, zerarGrade, aoFrente, exigirPortaLivre, PORTA_CDP,
};
