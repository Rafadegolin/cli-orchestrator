'use strict';

// Quanto do seu Claude ja foi usado: a janela de 5h e a da semana.
//
// O percentual e a hora do reset SO existem por rede. Nada no disco guarda
// limite -- foi procurado: nenhum arquivo de `~/.claude/` tem utilizacao,
// janela de reset ou status, e os transcritos tambem nao. Por isso este modulo
// consulta, e por isso ele nao estima nada quando a consulta falha.
//
// MEDIDO no spike (`testes/uso-real.js`, contra o CLI 2.1.220 e a conta real):
//
//   GET https://api.anthropic.com/api/oauth/usage   ->  HTTP 200
//   { five_hour: { utilization: 24, resets_at: "..." },
//     seven_day: { utilization: 51, resets_at: "..." },
//     limits: [ { kind: "session",       percent: 24, severity: "normal", resets_at },
//               { kind: "weekly_all",    percent: 51, severity: "normal", resets_at },
//               { kind: "weekly_scoped", percent:  0, severity: "normal",
//                 scope: { model: { display_name: "Fable" } } } ] }
//
// Duas coisas que a leitura do binario do CLI sugeria e o spike DESMENTIU:
// nao ha cabecalho `anthropic-ratelimit-*` nenhum nesta resposta (os numeros
// estao todos no corpo), e o `anthropic-beta` e dispensavel -- responde 200 sem
// ele. Cabecalho a menos e uma coisa a menos para quebrar.

const { net } = require('electron');

const claude = require('./claude-dados');

const URL_USO = 'https://api.anthropic.com/api/oauth/usage';

const MS_TIMEOUT = 5000;          // o mesmo do CLI
const MS_ENTRE = 5 * 60 * 1000;   // relogio de fundo
const MS_PRIMEIRA = 15_000;       // depois do arranque, longe da meta de 1,5s
const MS_PISO = 30_000;           // entre duas buscas sob demanda
const MS_RETENTATIVA = 60_000;    // uma segunda chance depois de falhar

let janela = null;
let timer = null;
let atrasado = null;
let ultimoEnvio = '';
let buscando = null;

let situacao = {
  ok: false,
  motivo: 'ainda nao consultado',
  em: 0,
  janelas: [],
  escopos: [],
};

// --------------------------------------------------------------- a leitura

// `limits[]` e a fonte preferida porque traz `severity` -- o servidor dizendo
// se esta apertado, o que vale mais que um limiar de porcentagem inventado
// aqui. Os objetos soltos (`five_hour`/`seven_day`) ficam de reserva: se a
// forma da resposta mudar, o app perde a cor mas nao perde o numero.
function montarJanela(corpo, kind, chave, rotulo) {
  const limites = Array.isArray(corpo.limits) ? corpo.limits : [];
  const l = limites.find((x) => x && x.kind === kind);
  const w = corpo[chave];

  const bruto = l && Number.isFinite(Number(l.percent))
    ? Number(l.percent)
    : (w && Number.isFinite(Number(w.utilization)) ? Number(w.utilization) : null);
  if (bruto === null) return null;

  const reseta = Date.parse((l && l.resets_at) || (w && w.resets_at) || '') || 0;

  return {
    tipo: chave,
    rotulo,
    pct: Math.max(0, Math.min(100, Math.round(bruto))),
    reseta,
    gravidade: (l && l.severity) || 'normal',
  };
}

// O limite por modelo (hoje `weekly_scoped`). So aparece quando ja consumiu
// algo: uma linha "Fable 0%" no detalhe seria ruido em toda abertura.
function montarEscopos(corpo) {
  const limites = Array.isArray(corpo.limits) ? corpo.limits : [];
  return limites
    .filter((l) => l && l.kind === 'weekly_scoped' && Number(l.percent) > 0)
    .map((l) => ({
      rotulo: (l.scope && l.scope.model && l.scope.model.display_name) || 'modelo',
      pct: Math.max(0, Math.min(100, Math.round(Number(l.percent)))),
      reseta: Date.parse(l.resets_at || '') || 0,
      gravidade: l.severity || 'normal',
    }));
}

// -------------------------------------------------------------- a chamada

function pedir(token) {
  return new Promise((resolve) => {
    let respondido = false;
    const acabar = (r) => { if (!respondido) { respondido = true; resolve(r); } };

    let req;
    try {
      req = net.request({ method: 'GET', url: URL_USO });
    } catch (err) {
      acabar({ erro: err.message });
      return;
    }

    // O token entra aqui e morre aqui. Nao vai para o uso.json, nao vai para a
    // janela, nao vai para log -- nem em caso de erro.
    req.setHeader('Authorization', `Bearer ${token}`);
    req.setHeader('Accept', 'application/json');

    // O ClientRequest do Electron nao tem timeout proprio; sem este relogio uma
    // rede pendurada deixaria a promessa viva para sempre.
    const corte = setTimeout(() => {
      acabar({ erro: `timeout de ${MS_TIMEOUT}ms` });
      try { req.abort(); } catch { /* ja morreu */ }
    }, MS_TIMEOUT);

    req.on('response', (res) => {
      let corpo = '';
      res.on('data', (c) => { corpo += c; });
      res.on('end', () => {
        clearTimeout(corte);
        acabar({ status: res.statusCode, corpo });
      });
      res.on('error', (err) => { clearTimeout(corte); acabar({ erro: err.message }); });
    });

    req.on('error', (err) => { clearTimeout(corte); acabar({ erro: err.message }); });
    req.end();
  });
}

async function buscar() {
  const cred = claude.credenciais();
  if (!cred) return { ok: false, motivo: 'sem credencial do Claude' };

  // Vencida: nem tenta. O app NAO renova token de ninguem -- quem renova e uma
  // sessao do Claude, e e isso que a tela diz.
  if (cred.expira && cred.expira <= Date.now()) {
    return { ok: false, motivo: 'credencial vencida' };
  }

  const r = await pedir(cred.token);

  if (r.erro) return { ok: false, motivo: `rede: ${r.erro}` };
  if (r.status !== 200) return { ok: false, motivo: `HTTP ${r.status}` };

  let corpo;
  try {
    corpo = JSON.parse(r.corpo);
  } catch {
    return { ok: false, motivo: 'resposta ilegivel' };
  }

  const janelas = [
    montarJanela(corpo, 'session', 'five_hour', 'sessão'),
    montarJanela(corpo, 'weekly_all', 'seven_day', 'semana'),
  ].filter(Boolean);

  if (!janelas.length) return { ok: false, motivo: 'resposta sem as janelas' };

  return { ok: true, motivo: '', em: Date.now(), janelas, escopos: montarEscopos(corpo) };
}

// ------------------------------------------------------------ o resultado

function agora() {
  return { ...situacao };
}

function emitir() {
  if (!janela || janela.isDestroyed() || janela.webContents.isDestroyed()) return;

  const carga = agora();
  // Igual ao medidor de CPU: mandar o mesmo valor a cada tique faria a tela
  // se redesenhar a toa.
  const marca = JSON.stringify(carga);
  if (marca === ultimoEnvio) return;
  ultimoEnvio = marca;

  janela.webContents.send('uso:estado', carga);
}

// Uma busca de cada vez: dois pedidos simultaneos (o relogio e o overlay
// abrindo) dariam duas chamadas de rede para a mesma resposta.
function atualizar({ forcar = false } = {}) {
  if (buscando) return buscando;
  if (!forcar && situacao.em && Date.now() - situacao.em < MS_PISO) return Promise.resolve(situacao);

  buscando = (async () => {
    try {
      const r = await buscar();
      situacao = { escopos: [], janelas: [], ...r, em: r.em || Date.now() };
      if (!r.ok) {
        // Falha de uso NUNCA vira dialogo -- mesma politica do updater e do git
        // de rede. Sem internet, o app so deixa de mostrar o percentual.
        console.error(`[uso] sem percentual: ${r.motivo}`);
      }
    } catch (err) {
      situacao = { ok: false, motivo: err.message, em: Date.now(), janelas: [], escopos: [] };
    } finally {
      buscando = null;
    }
    return situacao;
  })();

  return buscando;
}

function reagendar(ms) {
  clearTimeout(atrasado);
  atrasado = setTimeout(() => { atrasado = null; tique(); }, ms);
}

async function tique() {
  // Mesma guarda do metricas.js: janela escondida nao tem quem olhe o medidor,
  // e nao ha por que gastar rede.
  if (!janela || janela.isDestroyed() || !janela.isVisible() || janela.isMinimized()) return;

  await atualizar({ forcar: true });
  emitir();

  // Falhou (rede caindo no arranque, por exemplo): tenta de novo em um minuto,
  // UMA vez. Sem isto o proximo intento so viria no tique seguinte, e o medidor
  // ficaria vazio cinco minutos por causa de uma falha de dois segundos. E como
  // e uma so, ficar offline nao vira marretada na rede.
  if (!situacao.ok) reagendar(MS_RETENTATIVA);
}

// A janela voltou a aparecer.
//
// O tique so roda com ela visivel, entao abrir o app minimizado (ou em outra
// area de trabalho) fazia o primeiro passar em branco -- e o proximo era so
// cinco minutos depois, com o medidor vazio e nada explicando. Restaurar a
// janela e justamente o momento em que alguem vai olhar para ele.
function aoVoltar() {
  if (!situacao.em || Date.now() - situacao.em >= MS_ENTRE) tique();
}

function iniciar(j) {
  janela = j;
  parar();
  // A primeira fica longe do arranque: a meta e 1,5s ate o primeiro terminal.
  reagendar(MS_PRIMEIRA);
  timer = setInterval(() => { tique(); }, MS_ENTRE);
  for (const evento of ['show', 'restore', 'focus']) j.on(evento, aoVoltar);
}

function parar() {
  clearInterval(timer);
  clearTimeout(atrasado);
  timer = null;
  atrasado = null;
  ultimoEnvio = '';
}

// O overlay. Refresca antes de responder (com o piso de 30s), porque quem abriu
// quer o numero de agora, nao o do ultimo tique.
async function detalhe() {
  await atualizar();
  return agora();
}

module.exports = {
  URL_USO, MS_ENTRE, MS_PRIMEIRA, MS_TIMEOUT, MS_PISO, MS_RETENTATIVA,
  iniciar, parar, agora, detalhe, atualizar, montarJanela, montarEscopos,
};
