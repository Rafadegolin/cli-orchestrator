'use strict';

// O bloco de notas, em Node puro: o que mora no main e decide se o texto da
// pessoa sobrevive. A regra do modulo e uma so -- nunca perder texto --, entao
// os testes que importam sao os do arquivo estragado e os do teto.
//
// O caminho na tela (abas, busca, fechar e reabrir, reload) fica no
// `teste:notas-ui`.

const fs = require('fs');
const os = require('os');
const path = require('path');

// ANTES do require: `arquivo.PASTA` e lido no carregamento.
const TMP = path.join(os.tmpdir(), `orq-teste-notas-${Date.now()}`);
process.env.ORQ_DADOS = TMP;

const notas = require('../src/main/notas');

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
  return ok;
}
const ARQ = path.join(TMP, notas.NOME);

// ------------------------------------------------------------ sem arquivo

let e = notas.carregar();
checar('sem arquivo: uma aba vazia, pronta para escrever', e.abas.length === 1 && e.abas[0].texto === '' && e.ativa === e.abas[0].id);
checar('e sem arquivo nao ha backup a fazer', notas.fazerBackup() === false);

// ------------------------------------------------------------ gravar e ler

const estado = {
  ativa: 'b',
  abas: [
    { id: 'a', titulo: '', texto: 'primeira\nlinha dois', criadaEm: 1, editadaEm: 2 },
    { id: 'b', titulo: 'Rascunho', texto: 'acentuação, emoji 🚀 e\ttab', criadaEm: 3, editadaEm: 4 },
  ],
};
let r = notas.salvar(estado);
checar('salvar grava', r.ok && fs.existsSync(ARQ), JSON.stringify(r));
e = notas.carregar();
checar('e o texto volta byte a byte', e.abas[1].texto === 'acentuação, emoji 🚀 e\ttab' && e.abas[0].texto === 'primeira\nlinha dois');
checar('a aba ativa e o titulo voltam', e.ativa === 'b' && e.abas[1].titulo === 'Rascunho');
checar('a gravacao e atomica: nao sobra .tmp', !fs.existsSync(`${ARQ}.tmp`));

// ------------------------------------------------------------ normalizar

const torto = notas.normalizar({
  ativa: 'nao-existe',
  abas: [
    { id: 'x', texto: 'ok' },
    { id: 'x', texto: 'id repetido' },
    { id: '../../etc', texto: 'id torto' },
    { id: 'y', texto: 42 },
    null,
    'lixo',
    { id: 'z', titulo: 'com\nquebra', texto: '' },
  ],
});
checar('aba sem texto valido cai, o resto fica', torto.abas.length === 4, JSON.stringify(torto.abas.map((a) => a.id)));
checar('id repetido ou torto ganha um id novo', new Set(torto.abas.map((a) => a.id)).size === 4
  && torto.abas.every((a) => /^[A-Za-z0-9_-]+$/.test(a.id)));
checar('ativa que nao existe cai na primeira', torto.ativa === torto.abas[0].id);
checar('quebra de linha no titulo vira espaco', torto.abas[3].titulo === 'com quebra', torto.abas[3].titulo);
checar('nada utilizavel: uma aba vazia', notas.normalizar({ abas: [] }).abas.length === 1);

// ------------------------------------------------------------ tetos

const antes = fs.readFileSync(ARQ, 'utf8');
r = notas.salvar({ abas: [{ id: 'g', texto: 'x'.repeat(notas.MAX_ABA + 1) }] });
checar('aba acima de 1 MB: gravacao recusada', !r.ok && /MB/.test(r.texto), JSON.stringify(r).slice(0, 120));
checar('e o que estava no disco ficou INTACTO', fs.readFileSync(ARQ, 'utf8') === antes);
const meio = 'y'.repeat(notas.MAX_ABA - 10);
r = notas.salvar({ abas: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, texto: meio })) });
checar('acima de 5 MB no total: recusada', !r.ok && /total/.test(r.texto), JSON.stringify(r).slice(0, 120));
checar('mais de 50 abas: so as 50 primeiras sao lidas',
  notas.normalizar({ abas: Array.from({ length: 60 }, (_, i) => ({ id: `q${i}`, texto: 'a' })) }).abas.length === notas.MAX_ABAS);

// ------------------------------------------------------------ backup e arquivo estragado

checar('backup do arquivo bom', notas.fazerBackup() === true && fs.readFileSync(`${ARQ}.bak`, 'utf8') === antes);

fs.writeFileSync(ARQ, '{"abas": [ {"id": "a", "texto": "metade');
e = notas.carregar();
checar('arquivo estragado: o app abre com uma aba vazia', e.abas.length === 1 && e.abas[0].texto === '');
const lado = fs.readdirSync(TMP).filter((n) => n.startsWith(`${notas.NOME}.ilegivel-`));
checar('e o estragado foi POSTO DE LADO, nao vai ser sobrescrito', lado.length === 1 && !fs.existsSync(ARQ), lado.join(','));
checar('o conteudo dele continua la para recuperar',
  lado.length === 1 && fs.readFileSync(path.join(TMP, lado[0]), 'utf8').includes('metade'));
checar('um arquivo estragado NAO estraga o backup bom', notas.fazerBackup() === false && fs.readFileSync(`${ARQ}.bak`, 'utf8') === antes);

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* segue */ }
console.log(falhas === 0 ? '\nNOTAS_OK' : `\nNOTAS_FALHOU (${falhas})`);
process.exit(falhas === 0 ? 0 : 1);
