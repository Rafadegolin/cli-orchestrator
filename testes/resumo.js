'use strict';

// Devolutiva ao solicitante, em Node puro: o cliente do Flow (contexto e
// gravacao, com `fetch` falso), o nonce do resumo.js (uso unico, prazo, so
// consumido no sucesso), o prompt de uma linha, e a rota /resumo/<nonce> no
// ROTEADOR DE VERDADE (eventos.tratarSeguro numa porta efemera).
//
// O botao e o seletor (resumo-issue.js) dependem da janela; `candidatos` e puro
// e e exercitado aqui num sandbox.

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const vm = require('vm');

process.env.ORQ_DADOS = path.join(os.tmpdir(), `orq-teste-resumo-${Date.now()}`);

const flow = require('../src/main/flow');
const resumo = require('../src/main/resumo');
const eventos = require('../src/main/eventos');

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
  return ok;
}

const TOKEN = `pfx_${'a'.repeat(43)}`;
const BASE = 'https://flow.exemplo';

function falso(status, corpo) {
  const chamadas = [];
  const buscar = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => { if (corpo === undefined) throw new Error('sem corpo'); return corpo; },
    };
  };
  return { buscar, chamadas };
}

const CONTEXTO_FLOW = {
  id: 'i1',
  issue: 'TECH-3641',
  title: 'Melhoria de demandas',
  url: 'https://flow.exemplo/teams/t1/issues/i1',
  description: 'Linha 1\n\nLinha 2',
  requester: { hubUserId: 'h1', name: 'Bia Souza', department: 'Comercial', position: 'Gerente', photoUrl: null },
};

(async () => {
  // ------------------------------------------------------- cliente do Flow

  checar('identificador: TECH-1 vale', flow.identificadorValido('TECH-1'));
  checar('identificador: minusculo vale', flow.identificadorValido('tech-3641'));
  checar('identificador: lixo nao vale', !['', 'TECH', '1-2', 'feature/TECH-1', 'T-1'].some(flow.identificadorValido));

  let f = falso(200, CONTEXTO_FLOW);
  let r = await flow.buscarContexto({ base: BASE, token: TOKEN, identificador: 'tech-3641', buscar: f.buscar });
  checar('contexto: GET na rota certa', f.chamadas[0].url === 'https://flow.exemplo/api/orquestrador/issues/tech-3641', f.chamadas[0].url);
  checar('contexto: Bearer no cabecalho', f.chamadas[0].opcoes.headers.Authorization === `Bearer ${TOKEN}`);
  checar('contexto: solicitante normalizado', r.ok && r.contexto.solicitante.nome === 'Bia Souza' && r.contexto.solicitante.cargo === 'Gerente');
  checar('contexto: issue e titulo', r.ok && r.contexto.issue === 'TECH-3641' && r.contexto.titulo === 'Melhoria de demandas');

  f = falso(200, { ...CONTEXTO_FLOW, requester: null });
  r = await flow.buscarContexto({ base: BASE, token: TOKEN, identificador: 'TECH-3641', buscar: f.buscar });
  checar('contexto: sem solicitante -> null', r.ok && r.contexto.solicitante === null);

  f = falso(404, { statusCode: 404, message: 'Issue TECH-9 não encontrada' });
  r = await flow.buscarContexto({ base: BASE, token: TOKEN, identificador: 'TECH-9', buscar: f.buscar });
  checar('contexto: 404 vira nao-encontrada', !r.ok && r.erro === 'nao-encontrada', JSON.stringify(r));

  f = falso(200, CONTEXTO_FLOW);
  r = await flow.buscarContexto({ base: BASE, token: TOKEN, identificador: 'feature/TECH-1', buscar: f.buscar });
  checar('contexto: identificador invalido nem vai a rede', !r.ok && f.chamadas.length === 0);

  r = await flow.buscarContexto({ base: 'http://flow.exemplo', token: TOKEN, identificador: 'TECH-1', buscar: f.buscar });
  checar('contexto: http fora do loopback recusado (token nao vaza)', !r.ok && r.erro === 'url' && f.chamadas.length === 0);

  f = falso(201, { id: 's1', url: 'https://flow.exemplo/teams/t1/issues/i1' });
  r = await flow.salvarResumo({ base: BASE, token: TOKEN, identificador: 'TECH-3641', texto: '  a\r\nb  ', buscar: f.buscar });
  checar('salvar: POST na rota certa', f.chamadas[0].url.endsWith('/api/orquestrador/issues/TECH-3641/summaries') && f.chamadas[0].opcoes.method === 'POST');
  checar('salvar: corpo JSON com CRLF normalizado e aparado', f.chamadas[0].opcoes.body === JSON.stringify({ body: 'a\nb' }), f.chamadas[0].opcoes.body);
  checar('salvar: devolve a url', r.ok && r.url === 'https://flow.exemplo/teams/t1/issues/i1');

  f = falso(201, {});
  r = await flow.salvarResumo({ base: BASE, token: TOKEN, identificador: 'TECH-1', texto: '   ', buscar: f.buscar });
  checar('salvar: vazio recusado sem rede', !r.ok && r.erro === 'vazio' && f.chamadas.length === 0);
  r = await flow.salvarResumo({ base: BASE, token: TOKEN, identificador: 'TECH-1', texto: 'x'.repeat(flow.MAX_RESUMO + 1), buscar: f.buscar });
  checar('salvar: acima do teto recusado sem rede', !r.ok && r.erro === 'grande' && f.chamadas.length === 0);

  f = falso(401, {});
  r = await flow.salvarResumo({ base: BASE, token: TOKEN, identificador: 'TECH-1', texto: 'ok', buscar: f.buscar });
  checar('salvar: 401 vira erro de token, sem o token no texto', !r.ok && r.erro === 'token' && !JSON.stringify(r).includes(TOKEN));

  // ------------------------------------------------------- prompt

  const prompt = resumo.montarPrompt({
    contexto: { issue: 'TECH-3641', titulo: 'Melhoria', descricao: 'a\n\nb', solicitante: { nome: 'Bia', cargo: 'Gerente', departamento: 'Comercial' } },
    nonce: 'NONCE123',
    porta: 47615,
  });
  checar('prompt: uma linha so', !/[\r\n]/.test(prompt));
  checar('prompt: cita solicitante, cargo e issue', prompt.includes('Bia (Gerente · Comercial)') && prompt.includes('TECH-3641 "Melhoria"'));
  checar('prompt: url do nonce no loopback', prompt.includes('http://127.0.0.1:47615/resumo/NONCE123'));
  checar('prompt: pede todos os repositorios', prompt.includes('todos os repositórios'));
  checar('prompt: sem token nenhum', !prompt.includes('pfx_'));
  const semReq = resumo.montarPrompt({ contexto: { issue: 'TECH-1', titulo: 'X', descricao: '', solicitante: null }, nonce: 'n', porta: 1 });
  checar('prompt: sem solicitante fala de quem pediu', semReq.includes('a pessoa que pediu'));

  // ------------------------------------------------------- nonce

  let relogio = 1_000_000;
  let salvos = [];
  let avisos = [];
  let respostaSalvar = { ok: true, url: 'https://flow.exemplo/teams/t1/issues/i1' };
  resumo.configurar({
    lerCredencial: () => ({ base: BASE, token: TOKEN }),
    buscarContexto: async ({ identificador }) => (
      identificador === 'TECH-404'
        ? { ok: false, erro: 'nao-encontrada', texto: 'não existe' }
        : { ok: true, contexto: { issue: identificador.toUpperCase(), titulo: 'T', url: 'u', descricao: '', solicitante: null } }),
    salvarResumo: async (args) => { salvos.push(args); return respostaSalvar; },
    aoSalvo: (info) => avisos.push(info),
    agora: () => relogio,
    porta: 47615,
  });
  const nonceDe = (p) => /\/resumo\/([A-Za-z0-9_-]+)/.exec(p)[1];

  let prep = await resumo.preparar({ painelId: 'p1', identificador: 'tech-7' });
  checar('preparar: ok com prompt', prep.ok && typeof prep.prompt === 'string');
  const n1 = nonceDe(prep.prompt);
  checar('preparar: nonce longo (>= 32 chars)', n1.length >= 32, n1);

  prep = await resumo.preparar({ painelId: 'p1', identificador: 'TECH-404' });
  checar('preparar: issue inexistente nao gera nonce', !prep.ok && resumo._pendentesParaTeste().size === 1);

  let rec = await resumo.receber({ nonce: 'inventado', texto: 'oi' });
  checar('receber: nonce desconhecido -> 404', rec.status === 404 && salvos.length === 0);

  respostaSalvar = { ok: false, erro: 'rede', texto: 'fora' };
  rec = await resumo.receber({ nonce: n1, texto: 'Entregamos.' });
  checar('receber: Flow fora -> 502 e o nonce SOBREVIVE', rec.status === 502 && resumo._pendentesParaTeste().has(n1));

  respostaSalvar = { ok: true, url: 'https://flow.exemplo/teams/t1/issues/i1' };
  rec = await resumo.receber({ nonce: n1, texto: 'Entregamos.' });
  checar('receber: grava na issue do CLIQUE', rec.status === 200 && salvos.at(-1).identificador === 'TECH-7' && salvos.at(-1).texto === 'Entregamos.');
  checar('receber: avisa a janela com o painel certo', avisos.length === 1 && avisos[0].painelId === 'p1' && avisos[0].identificador === 'TECH-7');
  rec = await resumo.receber({ nonce: n1, texto: 'de novo' });
  checar('receber: nonce de uso unico', rec.status === 404);

  prep = await resumo.preparar({ painelId: 'p2', identificador: 'TECH-8' });
  const n2 = nonceDe(prep.prompt);
  relogio += resumo.MS_VALIDADE + 1;
  rec = await resumo.receber({ nonce: n2, texto: 'tarde' });
  checar('receber: nonce vencido -> 404', rec.status === 404);

  // ------------------------------------------------------- rota /resumo

  relogio = 5_000_000;
  prep = await resumo.preparar({ painelId: 'p3', identificador: 'TECH-9' });
  const n3 = nonceDe(prep.prompt);

  const servidor = http.createServer(eventos.tratarSeguro);
  eventos._handlersParaTeste({ aoResumo: resumo.receber });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = servidor.address().port;

  const pedir = (caminho, { metodo = 'POST', headers = {}, corpo } = {}) => new Promise((ok) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers }, (res) => {
      let c = '';
      res.on('data', (x) => { c += x; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(c); } catch { /* nao-json */ }
        ok({ status: res.statusCode, j, cru: c });
      });
    });
    req.on('error', () => ok({ status: 0, j: null, cru: 'ERRO' }));
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
  const TEXTO = { 'content-type': 'text/plain; charset=utf-8' };

  let h = await pedir(`/resumo/${n3}`, { headers: { ...TEXTO, origin: 'https://evil.exemplo' }, corpo: 'x' });
  checar('rota: com Origin -> 403', h.status === 403 && h.j.erro === 'origem-proibida');
  h = await pedir(`/resumo/${n3}`, { metodo: 'GET' });
  checar('rota: GET -> 405', h.status === 405);
  h = await pedir(`/resumo/${n3}`, { headers: { 'content-type': 'application/json' }, corpo: '{}' });
  checar('rota: content-type errado -> 415', h.status === 415);
  h = await pedir(`/resumo/${n3}`, { headers: { ...TEXTO, host: 'evil.exemplo' }, corpo: 'x' });
  checar('rota: Host de fora (DNS rebinding) -> 403', h.status === 403 && h.j.erro === 'host-invalido');
  h = await pedir(`/resumo/${n3}`, { headers: TEXTO, corpo: 'x'.repeat(200 * 1024) });
  checar('rota: corpo enorme -> 413', h.status === 413);

  // Acento e emoji cortados em pedacos: tem de chegar inteiro.
  const acentuado = 'O que foi feito: integração com o solicitante — ação concluída ✅';
  h = await pedir(`/resumo/${n3}`, { headers: TEXTO, corpo: Buffer.from(acentuado, 'utf8') });
  checar('rota: 200 com url', h.status === 200 && h.j.ok && h.j.url === 'https://flow.exemplo/teams/t1/issues/i1', h.cru);
  checar('rota: UTF-8 chega intacto', salvos.at(-1).texto === acentuado, salvos.at(-1).texto);
  h = await pedir(`/resumo/${n3}`, { headers: TEXTO, corpo: 'de novo' });
  checar('rota: segunda vez -> 404', h.status === 404);

  servidor.close();

  // ------------------------------------------------------- candidatos (janela)

  const codigo = fs.readFileSync(path.join(__dirname, '../src/janela/resumo-issue.js'), 'utf8');
  const el = () => ({ addEventListener() {}, hidden: true });
  const caixa = {
    window: { orq: { aoSalvarResumo() {} }, OrqOverlays: { registrar() {} } },
    document: { getElementById: el },
  };
  caixa.window.window = caixa.window;
  vm.runInNewContext(codigo, { ...caixa, window: caixa.window, document: caixa.document });
  const { candidatos } = caixa.window.OrqResumo;
  const lista = candidatos({
    issue: null,
    branch: 'worktree-feature-TECH-3679',
    feature: 'feature-TECH-3679',
    cwd: 'C:/x/pronix-flow/.claude/worktrees/feature-TECH-3679',
    ligacoes: ['C:/x/PronixCRM/.claude/worktrees/feature-TECH-3680'],
  }).map((c) => c.id);
  checar('candidatos: dupla sugere as duas issues, sem repetir', JSON.stringify(lista) === JSON.stringify(['TECH-3679', 'TECH-3680']), JSON.stringify(lista));
  const comChip = candidatos({ issue: { identificador: 'TECH-1' }, branch: 'feature/tech-1', feature: '', cwd: '', ligacoes: [] }).map((c) => c.id);
  checar('candidatos: chip do painel primeiro, caixa normalizada', JSON.stringify(comChip) === JSON.stringify(['TECH-1']), JSON.stringify(comChip));
  const numeroMaior = candidatos({ issue: null, branch: 'feature/TECH-71010', feature: '', cwd: '', ligacoes: [] }).map((c) => c.id);
  checar('candidatos: TECH-71010 nao vira TECH-7101', JSON.stringify(numeroMaior) === JSON.stringify(['TECH-71010']));

  try { fs.rmSync(process.env.ORQ_DADOS, { recursive: true, force: true }); } catch { /* ok */ }
  console.log(falhas === 0 ? '\nRESUMO_OK' : `\nRESUMO_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
