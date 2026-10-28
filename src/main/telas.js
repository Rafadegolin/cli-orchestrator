'use strict';

// A saida de cada painel, guardada ao fechar o app e mostrada no painel
// restaurado (Fase 10.5).
//
// Isto REVE uma decisao da Fase 7, que nao guardava saida nenhuma. O que ela
// recusou com razao continua recusado: nenhum processo fica vivo e o painel
// volta DORMINDO. O que muda e que ele volta com a ultima coisa que a sessao
// disse, e nao vazio.
//
// Saida de terminal pode ter segredo, entao:
//  - a pasta e so nossa (`~/.orquestrador/telas/`), com teto por arquivo;
//  - o nome do arquivo e um hash: nem a feature nem o caminho aparecem nele;
//  - o fechamento grava o arranjo INTEIRO e apaga o resto -- e a poda;
//  - fechar o painel apaga na hora, e desligar a preferencia apaga a pasta.
//
// Node puro, sem Electron: o `teste:telas` exercita tudo com `ORQ_DADOS`.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const arquivo = require('./arquivo');

const PASTA = arquivo.caminho('telas');
const EXT = '.ans';
const TETO_BYTES = 256 * 1024;
const DIAS_PODA = 30;

// A mesma chave do historico e das ligacoes: feature + pasta, nunca o id do
// painel, que muda a cada abertura. Caixa e separador nao contam -- o Windows
// nao diferencia `C:\Proj` de `c:/proj`.
function chave(cwd, feature) {
  const pasta = path.resolve(String(cwd || '')).replace(/[\\/]+$/, '').toLowerCase();
  return crypto.createHash('sha1').update(`${pasta}\u0000${String(feature || '')}`).digest('hex').slice(0, 16);
}

function caminhoDe(k) {
  return path.join(PASTA, `${k}${EXT}`);
}

// Acima do teto, corta no INICIO -- o fim e o que a sessao disse por ultimo --
// e numa quebra de linha: cortar no meio de uma sequencia de escape deixaria o
// primeiro trecho com cor errada, ou um `ESC[` solto engolindo texto.
function cortar(conteudo) {
  const t = String(conteudo || '');
  if (Buffer.byteLength(t, 'utf8') <= TETO_BYTES) return t;
  const bytes = Buffer.from(t, 'utf8');
  let resto = bytes.subarray(bytes.length - TETO_BYTES).toString('utf8');
  const nl = resto.indexOf('\n');
  if (nl >= 0) resto = resto.slice(nl + 1);
  return resto;
}

function gravarUm(k, conteudo) {
  const alvo = caminhoDe(k);
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, conteudo, 'utf8');
  fs.renameSync(tmp, alvo);
}

function listarChaves() {
  try {
    return fs.readdirSync(PASTA).filter((n) => n.endsWith(EXT)).map((n) => n.slice(0, -EXT.length));
  } catch {
    return [];
  }
}

// Grava o arranjo do fechamento, e APAGA o que nao esta nele: painel fechado,
// worktree arquivada e layout trocado somem aqui. `lista` vazia apaga tudo.
function salvar(lista) {
  const t0 = Date.now();
  fs.mkdirSync(PASTA, { recursive: true });
  const manter = new Set();
  let gravados = 0;
  for (const item of Array.isArray(lista) ? lista : []) {
    if (!item || !item.cwd || typeof item.conteudo !== 'string' || !item.conteudo) continue;
    const k = chave(item.cwd, item.feature);
    manter.add(k);
    try {
      gravarUm(k, cortar(item.conteudo));
      gravados += 1;
    } catch (err) {
      console.error(`[telas] nao gravei ${k}: ${err.message}`);
    }
  }
  let apagados = 0;
  for (const k of listarChaves()) {
    if (manter.has(k)) continue;
    try { fs.rmSync(caminhoDe(k), { force: true }); apagados += 1; } catch { /* segue */ }
  }
  return { gravados, apagados, ms: Date.now() - t0 };
}

function carregar(cwd, feature) {
  const alvo = caminhoDe(chave(cwd, feature));
  try {
    const conteudo = fs.readFileSync(alvo, 'utf8');
    if (!conteudo) return null;
    return { conteudo, salvoEm: fs.statSync(alvo).mtimeMs };
  } catch {
    return null;
  }
}

function apagar(cwd, feature) {
  try { fs.rmSync(caminhoDe(chave(cwd, feature)), { force: true }); } catch { /* ja nao existia */ }
}

// Desligar a preferencia: quem desliga por privacidade espera que o que ja
// estava gravado suma junto.
function apagarTudo() {
  try { fs.rmSync(PASTA, { recursive: true, force: true }); } catch { /* segue */ }
}

// A rede para o app que caiu antes de fechar (sem fechamento, nao ha a poda
// pela lista). Roda uma vez no arranque, ao lado do `historico.podar()`.
function podar({ dias = DIAS_PODA, agora = Date.now() } = {}) {
  const limite = agora - dias * 86_400_000;
  let apagados = 0;
  for (const k of listarChaves()) {
    try {
      if (fs.statSync(caminhoDe(k)).mtimeMs < limite) {
        fs.rmSync(caminhoDe(k), { force: true });
        apagados += 1;
      }
    } catch { /* segue */ }
  }
  // `.tmp` orfao de uma gravacao interrompida.
  try {
    for (const n of fs.readdirSync(PASTA)) if (n.endsWith('.tmp')) fs.rmSync(path.join(PASTA, n), { force: true });
  } catch { /* sem pasta */ }
  return { apagados };
}

module.exports = {
  PASTA, TETO_BYTES, DIAS_PODA,
  chave, cortar, salvar, carregar, apagar, apagarTudo, podar, listarChaves,
};
