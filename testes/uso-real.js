'use strict';

// O SPIKE do medidor de uso. Node puro, fora da suite padrao (como o
// `ligacoes-reais.js`): fala com a API de verdade, usando a credencial de
// verdade.
//
// Existe porque o endpoint nao veio de documentacao nenhuma -- veio de strings
// do binario do CLI 2.1.220:
//
//   Mi.get("/api/oauth/usage", { timeout: 5000, refreshOAuth: true })
//   anthropic-ratelimit-unified-{status,reset,utilization}
//
// Ou seja: sabemos o CAMINHO, nao a base, nem o cabecalho de autorizacao, nem
// se as duas janelas (5h e 7d) chegam no corpo ou so nos cabecalhos. Este
// script responde as tres coisas medindo, que e como todo contrato do CLI foi
// estabelecido neste projeto.
//
// NUNCA imprime o token. Imprime o tamanho e os quatro primeiros caracteres do
// prefixo, so para dar para conferir que leu o campo certo.

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const MS_TIMEOUT = 5000;

// A ordem importa: a primeira que responder 200 vira a base do `uso.js`.
const BASES = [
  'https://api.anthropic.com',
  'https://console.anthropic.com',
  'https://claude.ai',
];

const CAMINHO = '/api/oauth/usage';

// O CLI conversa com a API por OAuth, e nao por chave de API. Este e o beta que
// ele declara; se o servidor recusar sem ele, a tentativa sem cabecalho abaixo
// mostra a diferenca.
const BETA = 'oauth-2025-04-20';

function credenciais() {
  const alvo = path.join(os.homedir(), '.claude', '.credentials.json');
  let bruto;
  try {
    bruto = JSON.parse(fs.readFileSync(alvo, 'utf8'));
  } catch (err) {
    console.log(`SEM CREDENCIAL  ${alvo}: ${err.message}`);
    return null;
  }

  const o = bruto?.claudeAiOauth || {};
  if (!o.accessToken) {
    console.log('SEM CREDENCIAL  claudeAiOauth.accessToken ausente');
    return null;
  }

  return {
    token: String(o.accessToken),
    expira: Number(o.expiresAt) || 0,
    assinatura: o.subscriptionType || '?',
    faixa: o.rateLimitTier || '?',
  };
}

function pedir(base, token, comBeta) {
  return new Promise((resolve) => {
    const url = new URL(CAMINHO, base);

    const cabecalhos = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'orquestrador-clis/spike',
    };
    if (comBeta) cabecalhos['anthropic-beta'] = BETA;

    const req = https.request(
      { method: 'GET', hostname: url.hostname, path: url.pathname, headers: cabecalhos },
      (res) => {
        let corpo = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { corpo += c; });
        res.on('end', () => resolve({ status: res.statusCode, cabecalhos: res.headers, corpo }));
      },
    );

    req.setTimeout(MS_TIMEOUT, () => { req.destroy(new Error(`timeout de ${MS_TIMEOUT}ms`)); });
    req.on('error', (err) => resolve({ erro: err.message }));
    req.end();
  });
}

function mostrarRateLimit(cabecalhos) {
  const nossos = Object.keys(cabecalhos)
    .filter((k) => k.toLowerCase().startsWith('anthropic-'))
    .sort();

  if (!nossos.length) {
    console.log('    (nenhum cabecalho anthropic-*)');
    return 0;
  }
  for (const k of nossos) console.log(`    ${k}: ${cabecalhos[k]}`);
  return nossos.filter((k) => k.includes('ratelimit')).length;
}

function mostrarCorpo(corpo) {
  const cru = String(corpo || '').trim();
  if (!cru) {
    console.log('    (corpo vazio)');
    return;
  }
  try {
    const j = JSON.parse(cru);
    console.log('    corpo (JSON):');
    console.log(JSON.stringify(j, null, 2).split('\n').map((l) => `      ${l}`).join('\n'));
  } catch {
    console.log(`    corpo (${cru.length} bytes, nao-JSON): ${cru.slice(0, 400)}`);
  }
}

(async () => {
  const cred = credenciais();
  if (!cred) {
    console.log('\nUSO_REAL_SEM_CREDENCIAL');
    process.exit(2);
  }

  const restam = cred.expira - Date.now();
  console.log('credencial lida de ~/.claude/.credentials.json');
  console.log(`  token: ${cred.token.length} caracteres, comeca com "${cred.token.slice(0, 4)}..."`);
  console.log(`  assinatura: ${cred.assinatura}   faixa: ${cred.faixa}`);
  console.log(`  expiresAt: ${new Date(cred.expira).toISOString()} (${
    restam > 0 ? `faltam ${Math.round(restam / 60000)}min` : 'VENCIDA'})`);

  if (restam <= 0) {
    console.log('\nToken vencido. Abra uma sessao do Claude para renovar e rode de novo.');
    console.log('\nUSO_REAL_VENCIDO');
    process.exit(2);
  }

  let vencedora = null;
  // Os dois sao testados sempre na base que der certo: saber que o beta e
  // DISPENSAVEL vale tanto quanto saber que ele funciona -- cabecalho a menos e
  // uma coisa a menos para quebrar quando a API mudar de versao.
  const beta = { com: null, sem: null };

  for (const base of BASES) {
    for (const comBeta of [true, false]) {
      const rotulo = `${base}${CAMINHO}  ${comBeta ? '(com anthropic-beta)' : '(sem anthropic-beta)'}`;
      console.log(`\n---- ${rotulo}`);

      const r = await pedir(base, cred.token, comBeta);
      if (r.erro) {
        console.log(`    ERRO DE REDE: ${r.erro}`);
        continue;
      }

      console.log(`    HTTP ${r.status}`);
      const quantosRate = mostrarRateLimit(r.cabecalhos);
      mostrarCorpo(r.corpo);

      if (!vencedora && r.status === 200) vencedora = { base, quantosRate, corpo: r.corpo };
      if (vencedora && base === vencedora.base) beta[comBeta ? 'com' : 'sem'] = r.status;
    }
    if (vencedora) break;
  }

  console.log('\n================ VEREDITO');
  if (!vencedora) {
    console.log('Nenhuma base respondeu 200.');
    console.log('A Etapa 2 do plano cai: o topo mostra tokens medidos, sem percentual.');
    console.log('\nUSO_REAL_FALHOU');
    process.exit(1);
  }

  console.log(`base: ${vencedora.base}`);
  console.log(`anthropic-beta: ${beta.sem === 200
    ? 'DISPENSAVEL (200 sem ele)'
    : `necessario (sem ele: ${beta.sem === null ? 'erro de rede' : `HTTP ${beta.sem}`})`}`);
  console.log(`cabecalhos de ratelimit: ${vencedora.quantosRate}${
    vencedora.quantosRate === 0 ? '  -> os numeros estao no CORPO, nao nos cabecalhos' : ''}`);

  try {
    const j = JSON.parse(vencedora.corpo);
    // As duas janelas que a tela mostra, do jeito que o app vai le-las.
    for (const chave of ['five_hour', 'seven_day']) {
      const w = j[chave];
      console.log(`${chave}: ${w ? `${w.utilization}%  reseta ${w.resets_at}` : '(ausente)'}`);
    }
    const limites = Array.isArray(j.limits) ? j.limits : [];
    console.log(`limits[]: ${limites.length ? limites.map((l) => `${l.kind}=${l.percent}%/${l.severity}`).join('  ') : '(ausente)'}`);
    // Chaves de codinome (tangelo, iguana_necktie...) sao buckets internos e
    // vem nulas: registrar que existem evita alguem "consertar" o parser depois.
    const nulas = Object.keys(j).filter((k) => j[k] === null);
    if (nulas.length) console.log(`chaves nulas ignoradas: ${nulas.join(', ')}`);
  } catch { /* corpo nao-JSON ja foi impresso acima */ }

  console.log('\nUSO_REAL_OK');
})();
