'use strict';

// A ponta que precisa do Electron: registrar o esquema `orquestrador://`,
// guardar a janela, e entregar o pedido ao renderer.
//
// A separacao com o `pedido.js` e a mesma de sempre nesta casa: la mora tudo que
// DECIDE (parse, normalizacao, resolucao) e roda em Node puro, testavel sem
// abrir o app; aqui mora tudo que depende do processo principal.

const { app } = require('electron');
const path = require('path');

const empacotamento = require('./empacotamento');
const preferencias = require('./preferencias');
const projetos = require('./projetos');
const avisos = require('./avisos');
const pedidos = require('./pedido');

const ESQUEMA = 'orquestrador';

// Teto da fila de pedidos esperando o renderer ficar pronto.
const FILA_MAX = 8;

// Balde de fichas. Uma rajada de partidas e exatamente o que a fila da Fase 6
// existe para evitar, e a superficie externa e um jeito novo de produzir uma --
// de fora da maquina, ainda por cima.
const RITMO_MAX = 6;
const RITMO_JANELA = 10_000;

// Quanto o /abrir espera pelo veredito do renderer antes de responder "aceitei".
//
// O veredito (colisao de pasta, branch invalida, worktree recusada) sai em
// centenas de ms; o PAINEL usavel leva de 5 a 30 segundos -- fila da Fase 6,
// pty.spawn, shell, `git worktree add`, TUI subindo. Segurar o HTTP ate o painel
// existir seria contrato ruim; segurar ate o veredito devolve o motivo de
// verdade no caso comum e nunca pendura.
const MS_VEREDITO = 3_000;

// Rede de seguranca da deduplicacao: se o renderer nunca responder, a chave nao
// pode ficar presa para sempre.
const MS_EM_VOO = 60_000;

let janela = null;
let prontoParaEntregar = false;
const fila = [];
const emVoo = new Map();
const esperando = new Map();
let carimbos = [];
let seq = 0;

function definirJanela(j) {
  janela = j;
  // Uma janela recarregada (ou recriada pelo `activate` do macOS) ainda nao tem
  // `OrqProjetos` com a lista carregada. Sem zerar isto aqui, ela engoliria todo
  // pedido em silencio.
  prontoParaEntregar = false;
}

// Quem liga o sinal e o RENDERER, e nao o `did-finish-load`.
//
// `did-finish-load` diria que a pagina carregou, nao que `OrqProjetos` ja tem a
// lista de projetos -- e um pedido entregue antes disso vira "repo nao
// cadastrado" numa maquina onde ele esta cadastrado. Esse e o caso MAIS PROVAVEL
// de todos, porque com o app fechado e o proprio deeplink quem abre o app.
function pronto() {
  prontoParaEntregar = true;
  drenar();
}

// O guarda de `estado.emitir()`, mais a condicao acima.
function viva() {
  return Boolean(janela && !janela.isDestroyed() && !janela.webContents.isDestroyed());
}

function enviar(canal, carga) {
  if (!viva()) return false;
  janela.webContents.send(canal, carga);
  return true;
}

function drenar() {
  if (!prontoParaEntregar || !viva()) return;
  while (fila.length) enviar('abrir:pedido', fila.shift());
}

// Aviso na tela. Toda recusa passa por aqui, venha do deeplink ou do HTTP: pelo
// deeplink o Flow so copia a branch e nao tem como explicar o motivo, e pelo
// HTTP a pessoa esta olhando para o navegador, nao para o log.
function avisar(texto) {
  if (texto) enviar('abrir:aviso', { texto: String(texto) });
}

// ------------------------------------------------------------ protocolo

// Registro em TEMPO DE EXECUCAO, a cada arranque, e nao uma vez.
//
// A chave do registro guarda caminho ABSOLUTO. Mover a pasta do zip portatil ou
// do pacote -sac quebraria o link, e reregistrar sempre e o conserto -- e o
// mesmo problema que o `.lnk` do `atalho.js` ja tem.
//
// EM DESENVOLVIMENTO NAO REGISTRA POR PADRAO, e nao e timidez:
// `setAsDefaultProtocolClient` escreve em HKCU\Software\Classes, entao registrar
// a partir da arvore de codigo SEQUESTRA o esquema do app instalado da propria
// maquina -- e o sintoma ("o link parou de abrir o app") apareceria muito depois
// de alguem ter rodado `npm start` uma vez. Com ORQ_PROTOCOLO=1 da para testar
// de proposito, e ai o `--user-data-dir` vai junto: sem ele o link cairia num
// processo com o perfil padrao, que perde a 47615 e abre o dialogo de porta
// ocupada.
//
// O predicado e `ehEmpacotado()` (o codigo esta dentro de um .asar?) e nao
// `app.isPackaged`, pela razao inteira do `empacotamento.js`: no pacote -sac o
// executavel se chama electron.exe e o Electron responde "nao empacotado".
function registrarProtocolo() {
  try {
    if (empacotamento.ehEmpacotado()) return app.setAsDefaultProtocolClient(ESQUEMA);
    if (process.env.ORQ_PROTOCOLO !== '1') return false;
    return app.setAsDefaultProtocolClient(ESQUEMA, process.execPath, [
      path.resolve(process.argv[1] || '.'),
      `--user-data-dir=${app.getPath('userData')}`,
    ]);
  } catch (err) {
    // Registro de protocolo NUNCA vira dialogo -- a mesma politica do updater.
    console.error('[externo] nao consegui registrar o esquema:', (err && err.message) || err);
    return false;
  }
}

// ------------------------------------------------------------ ritmo

function passaNoRitmo() {
  const agora = Date.now();
  carimbos = carimbos.filter((t) => agora - t < RITMO_JANELA);
  if (carimbos.length >= RITMO_MAX) return false;
  carimbos.push(agora);
  return true;
}

// ------------------------------------------------------------ atender

function resposta(status, corpo) {
  return { status, corpo };
}

// Resolve `owner/repo` para UM projeto cadastrado.
//
// Quando nao acha, rele os remotes de todo mundo e tenta DE NOVO antes de
// desistir. E a unica hora em que pagar por um `git config` por projeto vale, e
// e o que faz "adicionei o remote ontem" se resolver sozinho em vez de virar um
// 404 que a pessoa nao entende.
function resolverProjeto(p) {
  if (!projetos.acharPorRepo(p.repo).length) {
    try { projetos.garantirRemotes({ forcar: true }); } catch { /* segue com o que tem */ }
  }
  // `resolver` refiltra a lista inteira por dentro, e e de proposito: assim UMA
  // funcao decide quem casa, e ela e a que roda em Node puro no teste.
  return pedidos.resolver(p, projetos.listar());
}

// Espera o veredito do renderer, com prazo.
function esperarVeredito(id) {
  return new Promise((ok) => {
    const prazo = setTimeout(() => {
      esperando.delete(id);
      ok(null);
    }, MS_VEREDITO);
    esperando.set(id, (r) => {
      clearTimeout(prazo);
      esperando.delete(id);
      ok(r);
    });
  });
}

// O renderer respondeu (via IPC `abrir:resposta`).
function veredito(r) {
  const id = r && r.id;
  if (!id) return;
  if (r.chave) soltar(r.chave);
  const fn = esperando.get(id);
  if (fn) fn(r);
  else if (r && r.ok === false && r.texto) avisar(r.texto);
}

function soltar(chave) {
  const t = emVoo.get(chave);
  if (t) clearTimeout(t);
  emVoo.delete(chave);
}

// O caminho unico dos dois canais.
//
// Devolve `{ status, corpo }` porque o /abrir precisa responder; o deeplink
// chama a mesma funcao e ignora o retorno (o aviso ja saiu na tela).
async function atender(bruto, { origem = '', canal = 'http' } = {}) {
  // O interruptor fecha a superficie INTEIRA, deeplink incluido. O portao de
  // Origin do `eventos.js` ja cobre o HTTP; aqui e o que impede o esquema
  // registrado no sistema de continuar abrindo sessao depois de alguem desligar.
  if (preferencias.carregar().externo === 'desligado') {
    return resposta(403, { ok: false, erro: 'externo-desligado' });
  }

  if (!passaNoRitmo()) {
    return resposta(429, { ok: false, erro: 'ritmo', texto: 'pedidos demais em pouco tempo' });
  }

  const n = pedidos.normalizarPedido(bruto);
  if (!n.ok) {
    avisar(`Pedido do Flow recusado: ${n.texto}`);
    return resposta(400, { ok: false, erro: n.erro, texto: n.texto });
  }
  const p = n.pedido;

  const prompt = pedidos.montarPrompt(p);
  if (!prompt.ok) {
    avisar(`Pedido do Flow recusado: ${prompt.texto}`);
    return resposta(400, { ok: false, erro: prompt.erro, texto: prompt.texto });
  }

  const alvo = resolverProjeto(p);
  if (!alvo.ok) {
    // NAO traz a janela para a frente: isso daria a qualquer origem permitida um
    // "incomodar o usuario" de graca, sem contrapartida nenhuma.
    avisar(alvo.texto);
    return resposta(alvo.erro === 'repo-ambiguo' ? 409 : 404, {
      ok: false,
      erro: alvo.erro,
      repo: alvo.repo,
      texto: alvo.texto,
      ...(alvo.opcoes ? { opcoes: alvo.opcoes } : {}),
      ...(alvo.acao ? { acao: alvo.acao } : {}),
    });
  }

  // A DEDUPLICACAO, e ela cobre o caminho NORMAL e nao uma borda.
  //
  // Com o app fechado, o Flow dispara o deeplink e DEPOIS re-sonda o /ping por
  // ~3s para mandar o POST: o mesmo pedido chega duas vezes. "Ja existe painel
  // nessa pasta" nao resolveria -- nesses 3 segundos o `git worktree add` ainda
  // esta rodando e nao ha painel nenhum.
  const chave = pedidos.chaveDoPedido(p);
  if (emVoo.has(chave)) {
    if (canal === 'http') avisos.trazerParaFrente();
    return resposta(200, {
      ok: true, aceito: true, jaPedido: true,
      projeto: { id: alvo.projeto.id, nome: alvo.projeto.nome },
      branch: p.branch,
    });
  }
  emVoo.set(chave, setTimeout(() => emVoo.delete(chave), MS_EM_VOO));

  const id = `px-${Date.now().toString(36)}-${(seq += 1).toString(36)}`;
  const carga = {
    id,
    chave,
    origem,
    canal,
    // O renderer recebe ID DE PROJETO, nunca caminho: e a segunda busca
    // independente pela mesma chave opaca, e e o que mantem "nunca um caminho"
    // verdadeiro tambem no sentido da entrada.
    projetoId: alvo.projeto.id,
    repo: p.repo,
    branch: p.branch,
    issue: { repo: p.repo, identificador: p.issue, titulo: p.title, url: p.url },
    prompt: prompt.prompt,
  };

  const entregue = prontoParaEntregar && viva() ? enviar('abrir:pedido', carga) : false;
  if (!entregue) {
    if (fila.length >= FILA_MAX) {
      soltar(chave);
      return resposta(429, { ok: false, erro: 'fila-cheia' });
    }
    fila.push(carga);
    drenar();
    return resposta(200, {
      ok: true, aceito: true, enfileirado: true, pedidoId: id,
      projeto: { id: alvo.projeto.id, nome: alvo.projeto.nome },
      branch: p.branch,
      promptPendente: Boolean(prompt.prompt),
    });
  }

  const r = await esperarVeredito(id);

  if (!r) {
    // Nao respondeu a tempo: o app resolve na tela, e o Flow ve o toast verde.
    return resposta(200, {
      ok: true, aceito: true, enfileirado: true, pedidoId: id,
      projeto: { id: alvo.projeto.id, nome: alvo.projeto.nome },
      branch: p.branch,
      promptPendente: Boolean(prompt.prompt),
    });
  }

  if (!r.ok) {
    avisar(r.texto);
    return resposta(r.status || 409, {
      ok: false, erro: r.erro || 'worktree', texto: r.texto,
      ...(r.branchAtual ? { branchAtual: r.branchAtual } : {}),
    });
  }

  avisos.trazerParaFrente();
  return resposta(200, {
    ok: true,
    aceito: true,
    enfileirado: false,
    pedidoId: id,
    projeto: { id: alvo.projeto.id, nome: alvo.projeto.nome },
    // O branch REALMENTE criado. Com branch literal ele coincide com o que o
    // Flow mandou; se um dia divergir, e a unica forma de a pessoa saber.
    branch: r.branch || p.branch,
    // Nome curto, nunca o caminho: mandar o layout de diretorios da pessoa para
    // uma pagina web e gratuito.
    worktree: r.worktree || '',
    jaAberta: Boolean(r.jaAberta),
    promptPendente: Boolean(prompt.prompt) && r.promptPendente !== false,
  });
}

// ------------------------------------------------------------ entradas

function deUrl(url) {
  const n = pedidos.deDeeplink(url);
  if (!n) return;
  if (!n.ok) { avisar(`Pedido do Flow recusado: ${n.texto}`); return; }
  // Fire-and-forget: nao ha para quem responder. O `catch` e obrigatorio -- uma
  // rejeicao aqui cairia na rede global do index.js, que so loga.
  atender(n.pedido, { canal: 'deeplink' })
    .catch((err) => console.error('[externo] deeplink falhou:', (err && err.stack) || err));
}

function deArgv(argv) {
  const url = pedidos.deArgv(argv);
  if (url) deUrl(url);
}

module.exports = {
  ESQUEMA,
  MS_VEREDITO,
  RITMO_MAX,
  FILA_MAX,
  definirJanela,
  pronto,
  registrarProtocolo,
  atender,
  veredito,
  deUrl,
  deArgv,
};
