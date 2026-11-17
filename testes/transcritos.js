'use strict';
// O leitor de conversas do Claude Code (redesign R8), em Node puro, com
// transcritos FALSOS numa pasta descartavel (ORQ_CLAUDE / ORQ_DADOS):
// - titulo, primeiro pedido, ultima fala, modelo, PR e contagem;
// - fala de verdade x meta, subagente, resultado de ferramenta e comando;
// - arquivo GRANDE: le so cabeca e cauda (o meio nao e lido);
// - worktree do projeto entra junto; outro projeto fica de fora;
// - busca e paginacao; cache por mtime + tamanho;
// - o detalhe recusa caminho fora da pasta do CLI.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { checar, encerrar } = require('./cdp');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-transcritos-'));
process.env.ORQ_CLAUDE = path.join(base, 'claude');
process.env.ORQ_DADOS = path.join(base, 'dados');
fs.mkdirSync(process.env.ORQ_DADOS, { recursive: true });

const claudeDados = require('../src/main/claude-dados');
const transcritos = require('../src/main/transcritos');

const PROJ = path.join(base, 'repos', 'meu-app');
const WT = path.join(PROJ, '.claude', 'worktrees', 'feat-x');
const OUTRO = path.join(base, 'repos', 'outro');

function escrever(pastaProj, id, registros) {
  const dir = claudeDados.pastaDoProjeto(pastaProj);
  fs.mkdirSync(dir, { recursive: true });
  const arq = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(arq, registros.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return arq;
}

const u = (texto, extra = {}) => ({ type: 'user', sessionId: 'x', cwd: PROJ, gitBranch: 'main', message: { role: 'user', content: texto }, ...extra });
const a = (texto, extra = {}) => ({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: texto }] }, ...extra });

(async () => {
  const s1 = '11111111-1111-1111-1111-111111111111';
  escrever(PROJ, s1, [
    u('<command-name>/clear</command-name>'),
    u('instrucao meta', { isMeta: true }),
    { ...u([{ type: 'tool_result', content: 'x' }]) },
    u('Corrige o login com SSO', { sessionId: s1 }),
    a('Vou olhar o fluxo.'),
    u('sub', { isSidechain: true }),
    { type: 'ai-title', aiTitle: 'Login SSO' },
    { type: 'custom-title', customTitle: 'sso-login' },
    { type: 'pr-link', prNumber: 77, prUrl: 'https://github.com/o/r/pull/77' },
    a('Pronto: o login com SSO funciona e os testes passam.'),
    { type: 'system', subtype: 'turn_duration', messageCount: 12 },
  ]);

  // Uma conversa grande: cabeca e cauda com marcas, e o MEIO com uma marca que
  // so apareceria se o arquivo fosse lido inteiro.
  const s2 = '22222222-2222-2222-2222-222222222222';
  const meio = [];
  for (let i = 0; i < 6000; i++) meio.push(a(`MEIO_NAO_LIDO ${'x'.repeat(200)}`));
  escrever(WT, s2, [
    u('PRIMEIRO_DA_WORKTREE', { sessionId: s2, cwd: WT, gitBranch: 'worktree-feat-x' }),
    ...meio,
    a('ULTIMA_FALA_DA_WORKTREE'),
  ]);

  escrever(OUTRO, '33333333-3333-3333-3333-333333333333', [u('de outro projeto'), a('ok')]);

  const r = await transcritos.listar({ projetos: [PROJ] });
  const porId = Object.fromEntries(r.itens.map((x) => [x.sessionId, x]));
  checar('lista o projeto E a worktree dele, e nao o outro projeto', r.total === 2 && porId[s1] && porId[s2],
    JSON.stringify(r.itens.map((x) => x.sessionId)));

  const x = porId[s1];
  checar('o titulo e o custom-title', x.titulo === 'sso-login', x.titulo);
  checar('o primeiro pedido pula comando, meta e resultado de ferramenta', x.primeiro === 'Corrige o login com SSO', x.primeiro);
  checar('a ultima fala e do agente principal', x.ultimo === 'Pronto: o login com SSO funciona e os testes passam.', x.ultimo);
  checar('modelo, PR e contagem', x.modelo === 'claude-opus-5-5' && x.pr.numero === 77 && x.msgs === 12,
    JSON.stringify({ m: x.modelo, pr: x.pr, msgs: x.msgs }));

  const g = porId[s2];
  const tamanho = fs.statSync(g.arquivo).size;
  checar('o arquivo grande e maior que cabeca + cauda', tamanho > transcritos.CABECA + transcritos.CAUDA, String(tamanho));
  checar('dele saem o primeiro pedido (cabeca) e a ultima fala (cauda)',
    g.primeiro === 'PRIMEIRO_DA_WORKTREE' && g.ultimo === 'ULTIMA_FALA_DA_WORKTREE', JSON.stringify({ p: g.primeiro, u: g.ultimo }));
  checar('sem turn_duration, a contagem vira piso', g.msgs === null && g.msgsPiso > 0, JSON.stringify({ m: g.msgs, p: g.msgsPiso }));
  checar('com o cwd e o branch da conversa', g.cwd === WT && g.branch === 'worktree-feat-x', JSON.stringify({ c: g.cwd, b: g.branch }));

  const busca = await transcritos.listar({ projetos: [PROJ], busca: 'sso' });
  checar('a busca filtra por titulo e falas', busca.total === 1 && busca.itens[0].sessionId === s1, JSON.stringify(busca.itens.map((i) => i.sessionId)));

  const todos = await transcritos.listar({ projetos: [] });
  checar('sem projetos, lista tudo do Claude Code', todos.total === 3, String(todos.total));

  // Cache: mexer no arquivo invalida; nao mexer reaproveita.
  const d = transcritos.detalhe(x.arquivo);
  checar('o detalhe traz o primeiro pedido e os ultimos turnos',
    d.ok && d.primeiro === 'Corrige o login com SSO' && d.turnos.at(-1).texto.startsWith('Pronto'), JSON.stringify(d).slice(0, 200));
  const fora = transcritos.detalhe(path.join(base, 'fora.jsonl'));
  checar('o detalhe recusa caminho fora da pasta do CLI', !fora.ok, fora.texto);
  const naoJsonl = transcritos.detalhe(path.join(claudeDados.pastaProjetos(), 'x.txt'));
  checar('e recusa o que nao e .jsonl', !naoJsonl.ok, naoJsonl.texto);

  escrever(PROJ, s1, [u('Outro pedido', { sessionId: s1 }), a('Outra resposta')]);
  const depois = await transcritos.listar({ projetos: [PROJ], busca: 'outra resposta' });
  checar('arquivo alterado e relido (o cache e por mtime e tamanho)', depois.total === 1, String(depois.total));

  fs.rmSync(base, { recursive: true, force: true });
  encerrar('TRANSCRITOS');
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
