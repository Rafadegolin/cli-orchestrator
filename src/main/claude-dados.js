'use strict';

// A pasta do Claude Code, e o unico lugar do app que sabe o layout dela.
//
// A raiz `~/.claude` era conhecida em dois lugares depois que o medidor de uso
// entrou (a contagem de conversas do `projetos.js` e a credencial daqui), e
// duplicar isso e o mesmo tipo de coisa que fez o `arquivo.js` existir: um
// ganha conserto e o outro nao.
//
// TUDO AQUI E LAYOUT INTERNO DO CLI, nao contrato. A regra e degradar sem
// quebrar: pasta que mudou de nome vira zero conversas e medidor sem numero,
// nunca uma excecao subindo.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Irma do ORQ_DADOS: os testes apontam para uma pasta descartavel em vez de
// varrer os 512 MB de transcritos reais. Lida na CARGA do modulo, como la --
// quem testa precisa definir a env antes do require.
const RAIZ = process.env.ORQ_CLAUDE || path.join(os.homedir(), '.claude');

function raiz() {
  return RAIZ;
}

function pastaProjetos() {
  return path.join(RAIZ, 'projects');
}

// O Claude guarda os transcritos em `projects/<caminho-codificado>/`, e a
// codificacao (conferida em 19 pastas reais desta maquina) troca `:`, `\`, `/`
// e `.` por `-`.
function pastaDoProjeto(caminho) {
  return path.join(pastaProjetos(), path.resolve(String(caminho)).replace(/[:\\/.]/g, '-'));
}

// Quantas conversas o Claude ja guardou para uma pasta.
function conversas(caminho) {
  try {
    return fs.readdirSync(pastaDoProjeto(caminho)).filter((f) => f.endsWith('.jsonl')).length;
  } catch {
    return 0;
  }
}

// A credencial OAuth do proprio CLI.
//
// O TOKEN NAO PODE SAIR DO PROCESSO PRINCIPAL: nao vai para o `uso.json`, nao
// vai para a janela, nao vai para log. Esta funcao devolve o valor cru porque
// quem chama monta um cabecalho com ele e o descarta -- qualquer outro uso e
// bug.
function credenciais() {
  let bruto;
  try {
    bruto = JSON.parse(fs.readFileSync(path.join(RAIZ, '.credentials.json'), 'utf8'));
  } catch {
    return null;
  }

  const o = bruto && bruto.claudeAiOauth;
  if (!o || !o.accessToken) return null;

  return {
    token: String(o.accessToken),
    expira: Number(o.expiresAt) || 0,
    assinatura: o.subscriptionType || '',
    faixa: o.rateLimitTier || '',
  };
}

module.exports = { RAIZ, raiz, pastaProjetos, pastaDoProjeto, conversas, credenciais };
