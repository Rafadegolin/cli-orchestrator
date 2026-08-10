'use strict';

// Driver CDP minimo: liga no Electron pela porta de depuracao e avalia JS
// dentro da janela real. Testa o codigo de producao sem instrumenta-lo.

const PORTA_CDP = 9222;

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

// Limpa a grade entre testes.
async function zerarGrade(cdp) {
  await cdp.avaliar(`(() => { for (const p of [...window.OrqGrade.painelPorId.values()]) p.destruir(); return 'ok'; })()`);
  await esperar(1500);
}

module.exports = { conectar, checar, encerrar, esperar, zerarGrade, PORTA_CDP };
