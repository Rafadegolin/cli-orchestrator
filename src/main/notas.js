'use strict';

// O bloco de notas da grade: o texto mora AQUI, no processo principal, e o
// painel e so uma vista. Fechar o painel pelo × nao apaga nada; reabrir traz
// tudo de volta.
//
// Node puro, sem Electron, para o `teste:notas` exercitar sem app.
//
// A regra do modulo e uma so: NUNCA perder texto. Dai tres cuidados que os
// outros arquivos de estado nao precisam ter:
//  - arquivo ilegivel NAO e sobrescrito pelo padrao vazio na proxima gravacao:
//    ele e posto de lado (`notas.json.ilegivel-<data>`) antes de qualquer coisa;
//  - no arranque, uma copia `.bak` do ultimo arquivo BOM;
//  - acima dos tetos a gravacao e recusada inteira, e nunca cortada -- o que ja
//    esta no disco fica.

const fs = require('fs');

const arquivo = require('./arquivo');

const NOME = 'notas.json';
const VERSAO = 1;
const MAX_ABAS = 50;
// Por aba e no total. O total e o que importa para o debounce: regravar
// dezenas de MB a cada pausa de digitacao travaria o processo principal.
const MAX_ABA = 1024 * 1024;
const MAX_TOTAL = 5 * 1024 * 1024;
const MAX_TITULO = 80;

const aba = (o = {}) => ({
  id: o.id || `n${Date.now().toString(36)}`,
  titulo: o.titulo || '',
  texto: o.texto || '',
  criadaEm: o.criadaEm || Date.now(),
  editadaEm: o.editadaEm || Date.now(),
});

function padrao() {
  const a = aba({ id: 'n1' });
  return { versao: VERSAO, ativa: a.id, abas: [a] };
}

// A lista branca. O arquivo e do usuario e pode ser editado a mao: campo torto
// cai, aba sem texto valido cai, e o que sobra e sempre utilizavel.
function normalizar(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const vistos = new Set();
  const abas = (Array.isArray(b.abas) ? b.abas : [])
    .filter((a) => a && typeof a === 'object' && typeof a.texto === 'string')
    .map((a) => {
      let id = typeof a.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(a.id) ? a.id : '';
      if (!id || vistos.has(id)) id = `n${Math.random().toString(36).slice(2, 10)}`;
      vistos.add(id);
      const num = (v) => (Number.isFinite(v) && v > 0 ? v : Date.now());
      return {
        id,
        titulo: typeof a.titulo === 'string' ? a.titulo.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_TITULO) : '',
        texto: a.texto,
        criadaEm: num(a.criadaEm),
        editadaEm: num(a.editadaEm),
      };
    })
    .slice(0, MAX_ABAS);
  if (!abas.length) return padrao();
  const ativa = abas.some((a) => a.id === b.ativa) ? b.ativa : abas[0].id;
  return { versao: VERSAO, ativa, abas };
}

// O que a GRAVACAO recusa. Separado do `normalizar` de proposito: na leitura um
// arquivo grande demais ainda e lido inteiro (o texto e da pessoa); na
// gravacao, crescer alem do teto e recusado sem tocar no disco.
function excede(estado) {
  if (estado.abas.length > MAX_ABAS) return `no maximo ${MAX_ABAS} abas`;
  let total = 0;
  for (const a of estado.abas) {
    const n = Buffer.byteLength(a.texto, 'utf8');
    if (n > MAX_ABA) return `a aba "${a.titulo || 'sem titulo'}" passou de ${MAX_ABA / 1024 / 1024} MB`;
    total += n;
  }
  if (total > MAX_TOTAL) return `as notas passaram de ${MAX_TOTAL / 1024 / 1024} MB no total`;
  return '';
}

// Le o disco. Arquivo que existe e nao e JSON valido e POSTO DE LADO antes de
// devolver o padrao: senao a primeira gravacao da janela trocaria o texto da
// pessoa por uma aba vazia, para sempre.
function carregar() {
  const alvo = arquivo.caminho(NOME);
  let cru;
  try {
    cru = fs.readFileSync(alvo, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[notas] nao consegui ler:', err.message);
    return padrao();
  }
  try {
    return normalizar(JSON.parse(cru));
  } catch (err) {
    const lado = `${alvo}.ilegivel-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try { fs.renameSync(alvo, lado); } catch { /* fica onde esta; o .bak ainda existe */ }
    console.error(`[notas] ${NOME} ilegivel, guardado em ${lado}:`, err.message);
    return padrao();
  }
}

function salvar(bruto) {
  const estado = normalizar(bruto);
  const motivo = excede(estado);
  if (motivo) return { ok: false, texto: motivo };
  arquivo.gravarJson(NOME, estado);
  return { ok: true, editadaEm: Date.now() };
}

// Uma vez por arranque: copia o ultimo arquivo BOM para `.bak`. So copia se ele
// for legivel -- um arquivo estragado nao pode levar o backup bom junto.
function fazerBackup() {
  const alvo = arquivo.caminho(NOME);
  try {
    JSON.parse(fs.readFileSync(alvo, 'utf8'));
    fs.copyFileSync(alvo, `${alvo}.bak`);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  NOME, MAX_ABAS, MAX_ABA, MAX_TOTAL, MAX_TITULO,
  normalizar, excede, carregar, salvar, fazerBackup, padrao,
};
