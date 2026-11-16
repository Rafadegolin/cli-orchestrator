'use strict';

// Devolutiva ao solicitante: o botao "Resumo" do painel pede ao Claude DA
// SESSAO um resumo do que foi entregue, escrito para quem pediu a issue, e o
// texto vai parar no Pronix Flow como RASCUNHO (coluna Atividade da issue).
//
// Por que e o Claude da sessao, e nao um diff: na implementacao dupla a sessao
// atravessa dois repositorios (`--add-dir`), e o painel nem nasce de uma issue
// do Flow. Quem sabe o que foi feito, nos dois lados, e a conversa.
//
// O caminho, em tres atos:
//   1. `preparar` (IPC, do clique): le o contexto da issue no Flow, gera um
//      NONCE de uso unico e devolve o prompt -- a janela cola no terminal.
//   2. O Claude escreve o texto num arquivo e faz `curl --data-binary @arq`
//      para `POST /resumo/<nonce>` (eventos.js).
//   3. `receber`: confere o nonce, manda ao Flow com o token pessoal e responde
//      ao curl com `{ ok, url }`.
//
// O TOKEN NUNCA ENTRA NO TERMINAL: o Claude so entrega o texto a este processo,
// que e quem fala com o Flow (o `pfx_` mora cifrado no `flow-credencial.js`). O
// nonce amarra a resposta ao pedido -- e e a issue escolhida no clique que vale,
// nao algo que o modelo pudesse mandar.
//
// Node puro (sem Electron): o `teste:resumo` exercita tudo com dependencias
// falsas.

const crypto = require('crypto');
const flow = require('./flow');

const MS_VALIDADE = 20 * 60_000;
const MAX_PENDENTES = 50;
const MAX_DESCRICAO_PROMPT = 600;

// nonce -> { painelId, identificador, expira }
const pendentes = new Map();

let deps = {
  lerCredencial: () => null,
  buscarContexto: flow.buscarContexto,
  salvarResumo: flow.salvarResumo,
  aoSalvo: () => {},
  agora: () => Date.now(),
  porta: 47615,
};

function configurar(novas = {}) {
  deps = { ...deps, ...novas };
}

function limparVencidos() {
  const t = deps.agora();
  for (const [n, p] of pendentes) if (p.expira <= t) pendentes.delete(n);
}

// Uma linha so: o texto vai por `term.paste`, e a recusa de multilinha do
// `colarTexto` (shell executaria cada linha) nem entra em jogo.
const umaLinha = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function montarPrompt({ contexto, nonce, porta }) {
  const s = contexto.solicitante;
  const quem = s
    ? `${s.nome}${[s.cargo, s.departamento].filter(Boolean).length ? ` (${[s.cargo, s.departamento].filter(Boolean).join(' · ')})` : ''}, que pediu`
    : 'a pessoa que pediu';
  const desc = umaLinha(contexto.descricao);
  const pedido = desc
    ? ` Pedido original, para referência: "${desc.length > MAX_DESCRICAO_PROMPT ? `${desc.slice(0, MAX_DESCRICAO_PROMPT)}…` : desc}".`
    : '';
  const url = `http://127.0.0.1:${porta}/resumo/${nonce}`;

  return umaLinha(
    `[Devolutiva ao solicitante — ${contexto.issue}] Escreva, em português do Brasil, uma devolutiva para ${quem} `
    + `a issue ${contexto.issue} "${contexto.titulo}".${pedido} `
    + 'Quem vai ler não é técnico: nada de nomes de arquivo, função, tabela, branch, commit ou jargão — explique pelo efeito para quem usa. '
    + 'Baseie-se em TUDO o que foi implementado nesta sessão, em todos os repositórios envolvidos (não só no diretório atual). '
    + 'Formato: 120 a 250 palavras, texto simples (sem markdown, sem emojis), em quatro blocos curtos, cada um começando por uma linha com o título: '
    + '"O que foi pedido", "O que foi feito", "Como usar / onde ver", "Limites e próximos passos". '
    + 'Não altere código nem faça commit. '
    + 'Salve o texto num arquivo temporário em UTF-8, FORA do repositório, e envie com: '
    + `curl -s -X POST -H "content-type: text/plain; charset=utf-8" --data-binary @<arquivo> ${url} `
    + '— a resposta é JSON: com ok:true mostre o link (url) e apague o arquivo; com erro, mostre o campo texto. '
    + 'Esse endereço vale uma vez só e expira em 20 minutos.',
  );
}

// Ato 1. `painelId` so serve para o aviso de "salvo" voltar ao painel certo.
async function preparar({ painelId, identificador } = {}) {
  const cred = deps.lerCredencial();
  if (!cred) return { ok: false, erro: 'desconectado', texto: 'conecte o app ao Flow (Minhas issues) com um token pessoal' };

  const r = await deps.buscarContexto({ ...cred, identificador });
  if (!r.ok) return { ok: false, erro: r.erro, texto: r.texto };

  limparVencidos();
  if (pendentes.size >= MAX_PENDENTES) {
    return { ok: false, erro: 'muitos', texto: 'pedidos de devolutiva demais em aberto — espere alguns expirarem' };
  }
  const nonce = crypto.randomBytes(24).toString('base64url');
  pendentes.set(nonce, {
    painelId: String(painelId || ''),
    identificador: r.contexto.issue,
    expira: deps.agora() + MS_VALIDADE,
  });
  return {
    ok: true,
    contexto: r.contexto,
    prompt: montarPrompt({ contexto: r.contexto, nonce, porta: deps.porta }),
  };
}

// Ato 3. Devolve `{ status, corpo }` para o eventos.js responder ao curl.
//
// O nonce so e consumido no SUCESSO: se o Flow estiver fora, o Claude pode
// repetir o mesmo curl. Recusas do proprio texto (vazio, grande) tambem nao
// consomem -- o Claude corrige e reenvia.
async function receber({ nonce, texto } = {}) {
  limparVencidos();
  const p = pendentes.get(String(nonce || ''));
  if (!p) {
    return { status: 404, corpo: { ok: false, erro: 'nonce', texto: 'endereço de devolutiva inválido ou expirado — clique em Resumo de novo no orquestrador' } };
  }
  const cred = deps.lerCredencial();
  if (!cred) {
    return { status: 503, corpo: { ok: false, erro: 'desconectado', texto: 'o orquestrador não está conectado ao Flow' } };
  }
  const r = await deps.salvarResumo({ ...cred, identificador: p.identificador, texto });
  if (!r.ok) {
    const status = r.erro === 'vazio' || r.erro === 'grande' ? 400 : 502;
    return { status, corpo: { ok: false, erro: r.erro, texto: r.texto } };
  }
  pendentes.delete(String(nonce));
  try {
    deps.aoSalvo({ painelId: p.painelId, identificador: p.identificador, url: r.url });
  } catch { /* o aviso na janela e cortesia; a devolutiva ja esta salva */ }
  return {
    status: 200,
    corpo: { ok: true, issue: p.identificador, url: r.url, texto: `Devolutiva salva como rascunho em ${p.identificador}` },
  };
}

function _pendentesParaTeste() {
  return pendentes;
}

module.exports = {
  MS_VALIDADE,
  configurar,
  montarPrompt,
  preparar,
  receber,
  _pendentesParaTeste,
};
