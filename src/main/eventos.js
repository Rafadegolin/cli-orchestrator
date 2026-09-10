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
const preferencias = require('./preferencias');
const projetos = require('./projetos');

const PORTA = 47615;
const ENDERECO = '127.0.0.1';
const PASTA_CONFIG = path.join(os.homedir(), '.orquestrador');
const ARQ_PORTA = path.join(PASTA_CONFIG, 'porta');

// Teto de corpo: e um JSON de hook, nao um upload.
const MAX_CORPO = 256 * 1024;
const MS_CORPO = 200;

// O corpo do /abrir vem de um navegador, e nao de um `curl` que ja esta em
// transito: prazo maior, teto menor (sao cinco campos curtos).
const MAX_CORPO_EXTERNO = 64 * 1024;
const MS_CORPO_EXTERNO = 5_000;

// A versao do app, INJETADA no `iniciar()`.
//
// Este modulo nao requer `electron`, e nada que ele importa requer -- e e isso
// que permitiria um teste em Node puro subir o roteador de verdade. Chamar
// `app.getVersion()` aqui quebraria a propriedade, e de um jeito traicoeiro: em
// Node puro `require('electron')` devolve uma STRING (o caminho do binario),
// entao `{ app }` sai `undefined` e a falha aparece na chamada, nao no require.
let versaoApp = '';

let servidor = null;
let aoEvento = null;
let aoAbrir = null;

function responder(res) {
  if (res.writableEnded) return;
  res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '2' });
  res.end('ok');
}

// O `responder()` acima e do caminho do HOOK e fica INTOCADO: contrato diferente
// (200 antes de processar), corpo fixo, e um `content-length` cravado que so
// pode existir porque 'ok' e ASCII.
//
// Aqui o corpo carrega o `title` da issue, que por contrato do Pronix Flow e
// texto livre com acento e emoji. `String.length` conta unidades UTF-16: dois
// bytes a menos no `content-length` entregam JSON truncado, sem erro em nenhum
// dos dois lados.
function responderJson(res, status, dados, extras) {
  if (res.writableEnded) return;
  const corpo = Buffer.from(`${JSON.stringify(dados)}\n`, 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    // Acao, nunca cacheavel.
    'cache-control': 'no-store',
    'content-length': String(corpo.length),
    ...(extras || {}),
  });
  res.end(corpo);
}

function tratar(req, res) {
  const url = new URL(req.url, `http://${ENDERECO}`);
  const partes = url.pathname.split('/').filter(Boolean);

  // O HOOK PRIMEIRO, E SEM NENHUMA CONDICAO NOVA NO CAMINHO DELE.
  //
  // Ele e o trecho mais exercitado do app (roda para todo evento de toda sessao)
  // e a regra dele -- responder 200 ANTES de processar -- e a unica coisa nesta
  // funcao que nao pode mudar. Por isso o `if` dele fica em cima: metodo,
  // Origin, Host e content-type sao portoes da superficie EXTERNA, e nenhum
  // deles pode virar trabalho no caminho do hook.
  if (partes[0] === 'evento') { tratarEvento(req, res, partes); return; }

  if (partes[0] === 'ping' || partes[0] === 'abrir') { tratarExterno(req, res, partes[0]); return; }

  // Caminho desconhecido continua com o 200 mudo de sempre. NAO vira 404: quem
  // bate aqui e varredor de porta, e um 404 com corpo so entrega informacao.
  responder(res);
}

// Rota: /evento/<Evento>/<tipo>. Evento e tipo vao no PATH, nao em query
// string: um `&` fora de aspas e separador de comando no cmd.exe e quebra a URL
// em duas, e nao da para confiar em como cada shell trata as aspas do comando
// registrado no settings.json.
function tratarEvento(req, res, partes) {
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
      } catch (err) {
        // Corpo ilegivel some em silencio e leva junto o cwd e a pergunta, sem
        // nada explicando por que a faixa de aprovacao ficou generica.
        console.error(`[eventos] corpo do hook ilegivel (${corpo.length}B):`, err.message);
        json = {};
      }
      if (!corpo) console.error(`[eventos] ${evento}/${tipo}: corpo VAZIO`);

      // Guarda propria, alem da rede global do `index.js`.
      //
      // Este `setImmediate` nao tem NADA acima dele na pilha: sem try/catch, um
      // throw aqui e um `uncaughtException` que mataria o processo principal e
      // levaria todas as sessoes vivas junto -- por causa de um hook. E ele roda
      // para TODO hook que chega, entao e o caminho mais exercitado do app.
      //
      // A rede global e o cinto; esta e o suspensorio, e e a que produz log util:
      // so aqui da para dizer QUAL evento quebrou.
      try {
        const r = estado.aplicar({
          evento: evento || json.hook_event_name || '',
          tipo,
          cwd: json.cwd || '',
          orqId,
          sessionId: json.session_id,
          // A frase que o Claude mostraria na notificacao do sistema. E o que a
          // faixa de aprovacao exibe -- sem isto ela so teria "Esperando voce".
          mensagem: typeof json.message === 'string' ? json.message : '',
        });

        if (aoEvento) aoEvento({ evento, tipo, orqId, cwd: json.cwd, resultado: r });
      } catch (err) {
        console.error(`[eventos] ${evento}/${tipo} falhou:`, (err && err.stack) || err);
      }
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

// --------------------------------------------------- a superficie externa

// As rotas que o Pronix Flow usa: `/ping` para saber se estamos de pe, `/abrir`
// para pedir uma sessao. O contrato inteiro esta no CLAUDE.md e no
// `apps/web/src/lib/orquestrador.ts` do lado deles.
//
// CORS NAO E O PORTAO, e isso e a coisa mais facil de errar aqui. Cabecalho de
// CORS decide se a PAGINA LE a resposta; ele nao impede o pedido de chegar. Um
// POST `text/plain` e "simples", roda o handler inteiro, e so a resposta e
// escondida da pagina. Quem impede o EFEITO e a conjuncao abaixo, avaliada antes
// de qualquer coisa acontecer:
//
//   1. `Host` de loopback           -> DNS rebinding (uma pagina em evil.com que
//                                      resolve para 127.0.0.1 e same-origin
//                                      consigo mesma, e mandaria Host: evil.com)
//   2. /abrir e POST-only           -> tira <img>, <iframe>, prefetch e
//                                      NAVEGACAO DE TOPO, que nao manda Origin
//                                      nenhum e deixaria o portao 4 sem o que ler
//   3. content-type application/json-> <form> nao produz, e forca preflight; e o
//                                      que promove o portao 4 de "quase sempre"
//                                      para "sempre"
//   4. `Origin` na allowlist        -> o unico portao que separa o Flow de
//                                      qualquer site
//   5. `externo: 'ligado'`          -> o interruptor, conferido ANTES do 4 para
//                                      quem depura com curl receber o motivo
//                                      verdadeiro
//
// Pior caso, dito na cara: evil.com consegue descobrir que o app esta rodando
// (um fetch `no-cors` distingue "recusou conexao" de "conectou" por erro e por
// tempo). Isso NAO tem conserto, e vale para todo servidor local que ja existiu.

function hostLocal(bruto) {
  const h = String(bruto || '').trim().toLowerCase();
  if (!h) return false;
  // `[::1]:47615` -> `[::1]`; `127.0.0.1:47615` -> `127.0.0.1`.
  const semPorta = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
  return semPorta === '127.0.0.1' || semPorta === 'localhost' || semPorta === '[::1]';
}

// Sem Origin nao ha nada a negociar (curl, teste, outro programa local). Com
// Origin nao permitida, NADA e devolvido: sem `Access-Control-Allow-Origin` o
// navegador se recusa a entregar a resposta a pagina.
//
// E NUNCA ecoar uma Origin que nao foi validada -- e o bug classico que
// transforma uma politica de CORS em nenhuma politica.
//
// Nunca `Access-Control-Allow-Credentials`: nao ha o que autenticar, e ligar
// isso forcaria sair do padrao de ecoar a origem. Relacionado e nao obvio:
// COOKIE IGNORA PORTA, entao qualquer outro programa servindo em 127.0.0.1 pode
// plantar um que o navegador anexaria aos nossos pedidos. Nada aqui le `Cookie`,
// e e para continuar assim.
function cabecalhosCors(origem, permitida) {
  if (!origem || !permitida) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origem,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    // Curto de proposito: a lista de origens vive no ui.json e pode mudar a
    // qualquer momento. Um max-age longo deixaria um preflight velho valendo
    // depois de alguem tirar a origem da lista.
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function tratarExterno(req, res, rota) {
  const metodo = String(req.method || 'GET').toUpperCase();
  const origem = String(req.headers.origin || '').trim();
  const ui = preferencias.carregar();
  const ligado = ui.externo !== 'desligado';
  const permitida = ligado && preferencias.origemPermitida(origem, ui);
  const cors = cabecalhosCors(origem, permitida);
  const allow = rota === 'abrir' ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS';

  if (!hostLocal(req.headers.host)) {
    responderJson(res, 403, { ok: false, erro: 'host-invalido' }, cors);
    return;
  }

  if (metodo === 'OPTIONS') {
    const extras = { ...cors, allow };
    // PRIVATE NETWORK ACCESS (Chrome). A pagina do Flow e https publica e o alvo
    // e 127.0.0.1: para o Chrome isso e "publico -> privado". Enquanto o
    // preflight de PNA existir, ele manda este cabecalho no pedido e exige a
    // resposta abaixo. Quando o Chrome trocar isso pela PERMISSAO de Local
    // Network Access, ele simplesmente para de mandar o cabecalho e este `if`
    // para de valer -- nao ha nada a remover, e nada quebra.
    if (String(req.headers['access-control-request-private-network']) === 'true' && permitida) {
      extras['access-control-allow-private-network'] = 'true';
    }
    if (res.writableEnded) return;
    res.writeHead(permitida ? 204 : 403, extras);
    res.end();
    return;
  }

  if (!ligado) {
    responderJson(res, 403, {
      ok: false,
      erro: 'externo-desligado',
      texto: 'as rotas externas estao desligadas no ui.json (externo: "desligado")',
    }, cors);
    return;
  }
  if (!permitida) {
    responderJson(res, 403, { ok: false, erro: 'origem-nao-permitida', origem }, cors);
    return;
  }

  if (rota === 'ping') {
    if (metodo !== 'GET' && metodo !== 'HEAD') {
      responderJson(res, 405, { ok: false, erro: 'metodo' }, { ...cors, allow });
      return;
    }
    // `projetos` e CONTAGEM, e tem de continuar sendo: a lista seriam os nomes e
    // os caminhos de tudo em que a pessoa trabalha -- o maior vazamento gratuito
    // disponivel nesta superficie.
    //
    // `app` e `api` existem para o Flow nao confundir outro programa que tenha
    // pego a 47615 com a gente: a porta e fixa e o servidor nao tem autenticacao.
    let quantos = 0;
    try { quantos = projetos.listar().length; } catch { quantos = 0; }
    responderJson(res, 200, {
      ok: true,
      app: 'orquestrador',
      api: 1,
      version: versaoApp,
      port: PORTA,
      protocolo: 'orquestrador',
      projetos: quantos,
    }, cors);
    return;
  }

  // ------------------------------------------------------------- /abrir

  if (metodo !== 'POST') {
    responderJson(res, 405, { ok: false, erro: 'metodo' }, { ...cors, allow });
    return;
  }
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
    responderJson(res, 415, { ok: false, erro: 'tipo-invalido' }, cors);
    return;
  }
  if (!aoAbrir) {
    responderJson(res, 503, { ok: false, erro: 'sem-handler' }, cors);
    return;
  }

  let corpo = '';
  let grande = false;
  let terminou = false;

  const seguir = () => {
    if (terminou) return;
    terminou = true;
    clearTimeout(prazo);

    if (grande) {
      responderJson(res, 413, { ok: false, erro: 'corpo-grande' }, cors);
      return;
    }

    let json;
    try {
      json = corpo ? JSON.parse(corpo) : {};
    } catch {
      responderJson(res, 400, { ok: false, erro: 'corpo-invalido' }, cors);
      return;
    }

    // `tratarExterno` NAO e `async` de proposito: uma promessa rejeitada
    // escaparia do try/catch sincrono do `tratarSeguro` e cairia na rede global
    // do index.js, que so loga -- deixando o socket aberto ate o cliente
    // desistir. Aqui o `.catch` e obrigatorio, e responde.
    Promise.resolve()
      .then(() => aoAbrir(json, { origem }))
      .then((r) => responderJson(res, (r && r.status) || 200, (r && r.corpo) || { ok: true }, cors))
      .catch((err) => {
        console.error('[eventos] /abrir falhou:', (err && err.stack) || err);
        responderJson(res, 500, { ok: false, erro: 'falha-interna' }, cors);
      });
  };

  const prazo = setTimeout(seguir, MS_CORPO_EXTERNO);

  req.on('data', (c) => {
    if (corpo.length + c.length > MAX_CORPO_EXTERNO) { grande = true; return; }
    corpo += c;
  });
  req.on('end', seguir);
  req.on('error', seguir);
}

// A porta e fixa (o comando do hook a leva embutida), entao reabrir o app antes
// do processo anterior soltar o socket da EADDRINUSE -- e o usuario que so
// fechou e abriu de novo cai num aviso de porta ocupada e fica sem bolinhas.
// A instancia velha some em menos de um segundo; esperar por ela e mais honesto
// que reclamar.
const TENTATIVAS = 8;
const MS_ENTRE_TENTATIVAS = 250;

// `tratar` roda como ouvinte de `request`, ou seja sem nada acima dele na
// pilha: um throw ali e morte do processo principal. E ele e alcancavel de fora
// -- `decodeURIComponent` estoura com `%ZZ`, e `new URL` com caminho torto.
// Responder 200 e seguir e o certo: o hook nao pode ficar esperando, e um evento
// perdido custa uma bolinha, nao o app.
function tratarSeguro(req, res) {
  try {
    tratar(req, res);
  } catch (err) {
    console.error('[eventos] pedido invalido:', (err && err.message) || err);
    try { responder(res); } catch { /* conexao ja foi embora */ }
  }
}

function tentarEscutar() {
  return new Promise((ok, falha) => {
    const s = http.createServer(tratarSeguro);
    s.once('error', (err) => { s.close(); falha(err); });
    s.listen(PORTA, ENDERECO, () => { servidor = s; ok(PORTA); });
  });
}

// Objeto, e nao dois positionais, e nao um setter depois do `await`.
//
// O servidor comeca a escutar DENTRO desta funcao (`tentarEscutar`), entao um
// `definirAbrir()` chamado depois deixaria uma janela -- curta, mas no exato
// momento do arranque, que e justamente quando o Flow re-sonda o /ping depois de
// disparar o deeplink -- com o socket aceitando e o /abrir sem handler.
//
// E dois callbacks do mesmo formato lado a lado (`iniciar(cb, abrir)`) e o que
// este projeto ja recusou por escrito no `index.js`: trocar os dois de lugar nao
// daria erro nenhum.
async function iniciar({ aoEvento: cbEvento = null, aoAbrir: cbAbrir = null, versao = '' } = {}) {
  aoEvento = cbEvento;
  aoAbrir = cbAbrir;
  versaoApp = String(versao || '');

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

// `tratarSeguro` e exportado para o teste subir o ROTEADOR DE VERDADE numa porta
// efemera, em Node puro. Testar contra a 47615 seria brigar com o app instalado
// da propria maquina, e reimplementar um roteador de mentira no teste seria
// testar o roteador de mentira.
module.exports = {
  iniciar, parar, PORTA, ENDERECO, ARQ_PORTA,
  tratarSeguro, hostLocal, cabecalhosCors,
};
