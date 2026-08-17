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

// O registro de sessoes VIVAS que o CLI mantem, um arquivo por PID.
//
// Descoberto ao investigar o "cross-session messaging" anunciado para macOS e
// Linux: o recurso em si e bloqueado no Windows por um portao de plataforma
// dentro do binario (ver docs/fase-9-extras.md), mas o REGISTRO que ele usa e
// escrito aqui do mesmo jeito. Verificado ao vivo no CLI 2.1.227:
//
//   {"pid":6580,"sessionId":"06c67f20-...","cwd":"...\\worktrees\\feature-TECH-758",
//    "version":"2.1.227","peerProtocol":1,"kind":"interactive",
//    "name":"fix-specialist-booking-timeout","status":"busy","updatedAt":1786976880964}
//
// Como todo o resto deste arquivo, e LAYOUT INTERNO e nao contrato: se a pasta
// mudar de nome ou o formato mudar, isto devolve lista vazia e o app perde uma
// ajuda sem perder nada.
//
// O `pid` e conferido de verdade porque arquivo de sessao morta fica para tras
// -- e uma sessao "viva" que na verdade morreu e pior que nenhuma informacao.
function sessoes({ pidVivo } = {}) {
  const vivo = typeof pidVivo === 'function' ? pidVivo : () => true;

  let nomes;
  try {
    nomes = fs.readdirSync(path.join(RAIZ, 'sessions')).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const saida = [];
  for (const n of nomes) {
    let s;
    try {
      s = JSON.parse(fs.readFileSync(path.join(RAIZ, 'sessions', n), 'utf8'));
    } catch {
      continue; // arquivo torto ou sendo escrito agora: nao derruba os outros
    }
    if (!s || !s.pid || !vivo(Number(s.pid))) continue;
    saida.push({
      pid: Number(s.pid),
      sessionId: String(s.sessionId || ''),
      cwd: String(s.cwd || ''),
      nome: String(s.name || ''),
      status: String(s.status || ''),
      em: Number(s.statusUpdatedAt || s.updatedAt || 0),
    });
  }
  return saida;
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

module.exports = {
  RAIZ, raiz, pastaProjetos, pastaDoProjeto, conversas, sessoes, credenciais,
};
