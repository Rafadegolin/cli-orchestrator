'use strict';

// Servidor HTTP que recebe os hooks do Claude Code.
//
// Regras nao negociaveis (secao 10 da spec):
//  1. Responde 200 antes de processar qualquer coisa. Hook lento trava a
//     sessao de trabalho do usuario, e o app nunca pode atrapalhar.
//  2. Escuta so em 127.0.0.1 -- e um servidor sem autenticacao.
//  3. Porta fixa, gravada num arquivo conhecido.
//  4. App fechado -> o hook falha em silencio e segue a vida.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const estado = require('./estado');

const PORTA = 47615;
const ENDERECO = '127.0.0.1';
const PASTA_CONFIG = path.join(os.homedir(), '.orquestrador');
const ARQ_PORTA = path.join(PASTA_CONFIG, 'porta');

// Teto de corpo: e um JSON de hook, nao um upload.
const MAX_CORPO = 256 * 1024;
const MS_CORPO = 200;

let servidor = null;
let aoEvento = null;

function responder(res) {
  if (res.writableEnded) return;
  res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '2' });
  res.end('ok');
}

function tratar(req, res) {
  // Rota: /evento/<Evento>/<tipo>. Evento e tipo vao no PATH, nao em query
  // string: um `&` fora de aspas e separador de comando no cmd.exe e quebra a
  // URL em duas, e nao da para confiar em como cada shell trata as aspas do
  // comando registrado no settings.json.
  const url = new URL(req.url, `http://${ENDERECO}`);
  const partes = url.pathname.split('/').filter(Boolean);
  if (partes[0] !== 'evento') {
    responder(res);
    return;
  }

  const evento = decodeURIComponent(partes[1] || '');
  const tipo = decodeURIComponent(partes[2] || '');
  // Se o shell nao expandiu a variavel, chega o literal ($ORQ_ID ou %ORQ_ID%).
  // Nesse caso ignora e deixa a resolucao por cwd assumir.
  const cabecalhoId = (req.headers['x-orq-id'] || '').trim();
  const orqId = cabecalhoId && !/[$%]/.test(cabecalhoId) ? cabecalhoId : null;

  let corpo = '';
  let terminou = false;

  const finalizar = () => {
    if (terminou) return;
    terminou = true;
    clearTimeout(prazo);

    // Responde ANTES de qualquer processamento. Consumir o corpo (poucas
    // centenas de bytes ja em transito) e barato; o que nao pode segurar a
    // resposta e o trabalho de estado -- hook lento trava a sessao do usuario.
    responder(res);

    setImmediate(() => {
      let json = {};
      try {
        json = corpo ? JSON.parse(corpo) : {};
      } catch {
        json = {};
      }

      const r = estado.aplicar({
        evento: evento || json.hook_event_name || '',
        tipo,
        cwd: json.cwd || '',
        orqId,
        sessionId: json.session_id,
      });

      if (aoEvento) aoEvento({ evento, tipo, orqId, cwd: json.cwd, resultado: r });
    });
  };

  // Nao espera o corpo para sempre: se o cliente sumir, segue com o que tem.
  const prazo = setTimeout(finalizar, MS_CORPO);

  req.on('data', (c) => {
    if (corpo.length < MAX_CORPO) corpo += c;
  });
  req.on('end', finalizar);
  req.on('error', finalizar);
}

// A porta e fixa (o comando do hook a leva embutida), entao reabrir o app antes
// do processo anterior soltar o socket da EADDRINUSE -- e o usuario que so
// fechou e abriu de novo cai num aviso de porta ocupada e fica sem bolinhas.
// A instancia velha some em menos de um segundo; esperar por ela e mais honesto
// que reclamar.
const TENTATIVAS = 8;
const MS_ENTRE_TENTATIVAS = 250;

function tentarEscutar() {
  return new Promise((ok, falha) => {
    const s = http.createServer(tratar);
    s.once('error', (err) => { s.close(); falha(err); });
    s.listen(PORTA, ENDERECO, () => { servidor = s; ok(PORTA); });
  });
}

async function iniciar(callback) {
  aoEvento = callback || null;

  for (let i = 0; i < TENTATIVAS; i++) {
    try {
      await tentarEscutar();
      try {
        fs.mkdirSync(PASTA_CONFIG, { recursive: true });
        fs.writeFileSync(ARQ_PORTA, String(PORTA), 'utf8');
      } catch {
        // sem o arquivo o hook ainda funciona: a porta vai embutida no comando
      }
      return PORTA;
    } catch (err) {
      const ultima = i === TENTATIVAS - 1;
      if (err.code !== 'EADDRINUSE' || ultima) {
        throw err.code === 'EADDRINUSE'
          ? new Error(`porta ${PORTA} ocupada por outro programa`)
          : err;
      }
      await new Promise((s) => setTimeout(s, MS_ENTRE_TENTATIVAS));
    }
  }
}

function parar() {
  if (servidor) {
    servidor.close();
    servidor = null;
  }
}

module.exports = { iniciar, parar, PORTA, ENDERECO, ARQ_PORTA };
