'use strict';

// As rotas /orq/* (Fase 10.6), em Node puro: o ROTEADOR DE VERDADE numa porta
// efemera, o `orquestracao.js` com as pecas do Electron trocadas por falsas, e
// git de verdade num repositorio descartavel (o branch do worker nascendo do
// commit da coordenadora, e o diff real).
//
// O caminho pela janela (o painel nascendo, a fila, o prefill no PTY) fica no
// `teste:orquestracao-ui`.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// ANTES de qualquer require dos modulos: os dois sao lidos no carregamento.
const TMP = path.join(os.tmpdir(), `orq-teste-orquestracao-${Date.now()}`);
process.env.ORQ_DADOS = path.join(TMP, 'dados');
process.env.ORQ_CLAUDE = path.join(TMP, 'claude');

const eventos = require('../src/main/eventos');
const estado = require('../src/main/estado');
const preferencias = require('../src/main/preferencias');
const worktrees = require('../src/main/worktrees');
const orq = require('../src/main/orquestracao');
const skill = require('../src/main/skill-orquestrador');

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
  return ok;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

(async () => {
  // ------------------------------------------------------------ o repositorio

  const repo = path.join(TMP, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  // A coordenadora trabalha numa worktree propria, com um commit que a base nao tem.
  const coordWt = path.join(repo, '.claude', 'worktrees', 'coord');
  git(repo, ['worktree', 'add', '-q', '-b', 'worktree-coord', coordWt]);
  fs.writeFileSync(path.join(coordWt, 'interface.txt'), 'contrato combinado\n');
  git(coordWt, ['add', '-A']);
  git(coordWt, ['commit', '-q', '-m', 'interface']);
  const shaCoord = git(coordWt, ['rev-parse', 'HEAD']).trim();

  // ------------------------------------------------------------ as pecas falsas

  const cwds = new Map();
  const escritos = [];
  const pedidos = [];
  let relogio = Date.now();
  let seq = 0;
  let sessoesClaude = [];

  const abrirSessao = (id, cwd, feature) => {
    estado.registrar(id, { feature, cwd });
    estado.definirStatus(id, 'rodando', 'shell aberto');
    cwds.set(id, cwd);
  };
  abrirSessao('coord', coordWt, 'coord');
  abrirSessao('outra', repo, 'outra');

  orq.configurar({
    estado,
    terminais: { cwdDe: (id) => cwds.get(id) || null },
    projetos: { donoDe: (c) => (path.resolve(c).toLowerCase().startsWith(path.resolve(repo).toLowerCase()) ? { id: 'pj', nome: 'repo', caminho: repo } : null) },
    worktrees,
    // A janela falsa: cria a worktree de verdade, com o `desde`, e "abre o painel".
    pedirJanela: async (tipo, carga) => {
      pedidos.push({ tipo, carga });
      if (tipo === 'enviar') return { ok: true };
      const slug = carga.nome.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      const r = await worktrees.criar(repo, slug, { desde: carga.desde });
      if (!r.ok) return { ok: false, status: 409, erro: r.motivo, texto: r.texto };
      seq += 1;
      const id = `w${seq}`;
      abrirSessao(id, r.caminho, slug);
      return { ok: true, painel: id, nome: slug, branch: r.branch, worktree: r.caminho };
    },
    sessoesClaude: () => sessoesClaude,
    escrever: (id, t) => escritos.push({ id, t }),
    avisar: () => {},
    agora: () => relogio,
  });

  const servidor = http.createServer(eventos.tratarSeguro);
  eventos._handlersParaTeste({ aoOrq: orq.atender });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = servidor.address().port;

  const pedir = (caminho, o = {}) => new Promise((ok) => {
    const headers = { ...(o.id === undefined ? {} : { 'x-orq-id': o.id }), ...(o.headers || {}) };
    if (o.json !== undefined) headers['content-type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: o.metodo || 'GET', headers }, (res) => {
      let c = '';
      res.on('data', (x) => { c += x; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(c); } catch { /* corpo nao-json */ }
        ok({ status: res.statusCode, j, cru: c });
      });
    });
    req.setTimeout(120_000, () => { req.destroy(); ok({ status: 0, j: null, cru: 'TIMEOUT' }); });
    req.on('error', () => ok({ status: 0, j: null, cru: 'ERRO' }));
    if (o.json !== undefined) req.write(typeof o.json === 'string' ? o.json : JSON.stringify(o.json));
    else if (o.corpo) req.write(o.corpo);
    req.end();
  });
  const criar = (id, nome, prompt = 'faca a parte X') => pedir('/orq/criar', { metodo: 'POST', id, json: { nome, prompt } });

  // ------------------------------------------------------------ os portoes

  let r = await pedir('/orq/status', { id: 'coord' });
  checar('desligada por padrao: 503', r.status === 503 && r.j.erro === 'orquestracao-desligada', r.cru);

  preferencias.salvar({ orquestracao: 'ligada' });

  r = await pedir('/orq/status', { id: 'coord', headers: { host: 'evil.com' } });
  checar('Host de fora: 403 host-invalido', r.status === 403 && r.j.erro === 'host-invalido', r.cru);
  r = await pedir('/orq/status', { id: 'coord', headers: { origin: preferencias.ORIGEM_FLOW } });
  checar('QUALQUER Origin, ate a do Flow: 403', r.status === 403 && r.j.erro === 'origem-proibida', r.cru);
  r = await pedir('/orq/criar', { metodo: 'OPTIONS', id: 'coord', headers: { origin: 'https://x.com' } });
  checar('preflight tambem e recusado', r.status === 403, String(r.status));
  r = await pedir('/orq/nada', { id: 'coord' });
  checar('rota inventada: 404 com o nome das rotas', r.status === 404 && /criar, enviar, status/.test(r.j.texto), r.cru);
  r = await pedir('/orq/criar', { id: 'coord' });
  checar('criar por GET: 405', r.status === 405, r.cru);
  r = await pedir('/orq/criar', { metodo: 'POST', id: 'coord', corpo: '{"nome":"x","prompt":"y"}', headers: { 'content-type': 'text/plain' } });
  checar('criar sem application/json: 415', r.status === 415, r.cru);
  r = await pedir('/orq/criar', { metodo: 'POST', id: 'coord', json: '{torto' });
  checar('JSON torto: 400', r.status === 400 && r.j.erro === 'corpo-invalido', r.cru);
  r = await pedir('/orq/criar', { metodo: 'POST', id: 'coord', json: JSON.stringify({ nome: 'x', prompt: 'y'.repeat(20_000) }) });
  checar('corpo acima de 16 KB: 413', r.status === 413, r.cru);

  r = await pedir('/orq/status');
  checar('sem X-Orq-Id: 401', r.status === 401 && r.j.erro === 'sem-identidade', r.cru);
  r = await pedir('/orq/status', { id: '$ORQ_ID' });
  checar('$ORQ_ID nao expandido: 401', r.status === 401, r.cru);
  r = await pedir('/orq/status', { id: 'p-que-nao-existe' });
  checar('id que nao e sessao aberta: 403', r.status === 403 && r.j.erro === 'desconhecido', r.cru);

  // O hook continua igual: o ramo novo nao pode ter mudado o caminho dele.
  r = await pedir('/evento/Stop', { metodo: 'POST', corpo: '{}' });
  checar('o hook segue com o 200 de sempre', r.status === 200 && r.cru === 'ok', r.cru);

  // ------------------------------------------------------------ criar

  r = await criar('coord', 'parte-a', 'implemente a parte A');
  checar('criar: 201', r.status === 201 && r.j.worker && r.j.worker.id === 'w1', r.cru);
  checar('o branch do worker e worktree-<nome>', r.j.worker.branch === 'worktree-parte-a', r.cru);
  checar('nenhuma resposta carrega caminho de disco',
    !r.cru.toLowerCase().includes(TMP.toLowerCase().replace(/\\/g, '\\\\')) && !/[A-Za-z]:\\\\/.test(r.cru), r.cru);
  const wtA = path.join(repo, '.claude', 'worktrees', 'parte-a');
  checar('o worker nasceu do commit da COORDENADORA, nao da base',
    git(wtA, ['rev-parse', 'HEAD']).trim() === shaCoord && fs.existsSync(path.join(wtA, 'interface.txt')));
  checar('a janela recebeu o prompt e o pai', pedidos.at(-1).carga.prompt === 'implemente a parte A' && pedidos.at(-1).carga.pai === 'coord');

  r = await criar('w1', 'neto');
  checar('worker nao cria worker: 403 profundidade', r.status === 403 && r.j.erro === 'profundidade', r.cru);

  r = await criar('coord', 'parte-a');
  checar('nome repetido: recusado, nunca reaproveita', r.status === 409 && r.j.erro === 'existe', r.cru);

  r = await criar('coord', 'parte-b');
  r = await criar('coord', 'parte-c');
  checar('tres em 30s passam', r.status === 201, r.cru);
  r = await criar('coord', 'parte-d');
  checar('o quarto em 30s: 429 ritmo', r.status === 429 && r.j.erro === 'ritmo', r.cru);
  relogio += orq.RITMO_JANELA + 1;
  r = await criar('coord', 'parte-d');
  r = await criar('coord', 'parte-e');
  r = await criar('coord', 'parte-f');
  relogio += orq.RITMO_JANELA + 1;
  r = await criar('coord', 'parte-g');
  checar(`o ${orq.MAX_FILHOS + 1}o vivo: 429 teto-filhos`, r.status === 429 && r.j.erro === 'teto-filhos', r.cru);

  r = await criar('coord', 'x', 'y'.repeat(orq.MAX_PROMPT + 1));
  checar('prompt acima do teto: 413', r.status === 413, r.cru);

  // ------------------------------------------------------------ status e escopo

  r = await pedir('/orq/status', { id: 'coord' });
  checar('status lista os seis da coordenadora', r.status === 200 && r.j.workers.length === 6, r.cru);
  r = await pedir('/orq/status', { id: 'outra' });
  checar('outra coordenadora nao ve nenhum', r.status === 200 && r.j.workers.length === 0, r.cru);
  r = await pedir('/orq/esperar?id=w1&timeout=1', { id: 'outra' });
  checar('worker de outra coordenadora: 404, como se nao existisse', r.status === 404, r.cru);

  // ------------------------------------------------------------ esperar

  let t0 = Date.now();
  r = await pedir('/orq/esperar?id=w1&timeout=1', { id: 'coord' });
  checar('esperar com o worker rodando expira no teto', r.status === 200 && r.j.expirou === true && Date.now() - t0 >= 900, `${Date.now() - t0}ms ${r.cru}`);

  t0 = Date.now();
  const p1 = pedir('/orq/esperar?id=w1&timeout=30', { id: 'coord' });
  await esperar(300);
  estado.definirStatus('w1', 'terminou', 'Stop');
  r = await p1;
  checar('esperar solta no terminou, sem esperar o teto',
    r.j.expirou === false && r.j.worker.status === 'terminou' && Date.now() - t0 < 3000, `${Date.now() - t0}ms ${r.cru}`);

  r = await pedir('/orq/esperar?id=w1&timeout=30', { id: 'coord' });
  checar('ja terminado: devolve na hora', r.j.expirou === false && r.j.worker.status === 'terminou', r.cru);

  r = await pedir('/orq/esperar?id=w1&timeout=999', { id: 'coord', metodo: 'GET', headers: {} });
  checar('timeout acima de 90 e limitado (nao trava o teste)', r.status === 200, r.cru);

  // Depois de um `enviar`, o `terminou` de antes e VELHO.
  r = await pedir('/orq/enviar', { metodo: 'POST', id: 'coord', json: { id: 'w1', texto: 'agora a parte 2' } });
  checar('enviar: 200 e foi para a janela', r.status === 200 && pedidos.at(-1).tipo === 'enviar', r.cru);
  t0 = Date.now();
  r = await pedir('/orq/esperar?id=w1&timeout=1', { id: 'coord' });
  checar('depois do enviar, o terminou velho NAO solta a espera', r.j.expirou === true, r.cru);

  estado.definirStatus('w2', 'esperando', 'permissao', { pergunta: 'Do you want to create x?', tipo: 'permissao' });
  r = await pedir('/orq/esperar?id=w2&timeout=5', { id: 'coord' });
  checar('esperando solta a espera, com a pergunta', r.j.worker.status === 'esperando' && /create x/.test(r.j.worker.pergunta), r.cru);
  r = await pedir('/orq/enviar', { metodo: 'POST', id: 'coord', json: { id: 'w2', texto: '1' } });
  checar('enviar para worker em esperando: 409 (cairia no seletor)', r.status === 409 && r.j.erro === 'esperando', r.cru);

  // O curl desistiu no meio: a vaga do long-poll volta.
  const antes = orq._esperasAbertas();
  const sock = http.request({ host: '127.0.0.1', port: porta, path: '/orq/esperar?id=w3&timeout=60', headers: { 'x-orq-id': 'coord' } });
  sock.on('error', () => {});
  sock.end();
  await esperar(300);
  const durante = orq._esperasAbertas();
  sock.destroy();
  await esperar(300);
  checar('o curl que desiste solta a vaga do long-poll', durante === antes + 1 && orq._esperasAbertas() === antes, `${antes} ${durante} ${orq._esperasAbertas()}`);

  const p3 = pedir('/orq/esperar?id=w3&timeout=30', { id: 'coord' });
  await esperar(200);
  estado.remover('w3');
  cwds.delete('w3');
  r = await p3;
  checar('painel fechado no meio da espera: encerrada', r.j.worker.status === 'encerrada' && r.j.expirou === false, r.cru);

  // ------------------------------------------------------------ diff

  fs.writeFileSync(path.join(wtA, 'novo.js'), 'export const x = 1;\n');
  git(wtA, ['add', 'novo.js']);
  git(wtA, ['commit', '-q', '-m', 'novo']);
  fs.writeFileSync(path.join(wtA, 'solto.txt'), 'ainda nao rastreado\n');
  fs.writeFileSync(path.join(wtA, 'a.txt'), 'um\ndois\n');
  r = await pedir('/orq/diff?id=w1', { id: 'coord' });
  const nomes = (r.j && r.j.arquivos || []).map((a) => `${a.origem}:${a.arquivo}`);
  checar('o resumo tem o commitado, o alterado e o nao rastreado',
    nomes.includes('commitado:novo.js') && nomes.includes('nao-commitado:a.txt') && nomes.includes('nao-rastreado:solto.txt'), JSON.stringify(nomes));
  checar('e a base e a da coordenadora, nao a do projeto: interface.txt NAO aparece', !nomes.some((n) => n.endsWith('interface.txt')), JSON.stringify(nomes));
  r = await pedir(`/orq/diff?id=w1&arquivo=${encodeURIComponent('novo.js')}`, { id: 'coord' });
  checar('o diff de um arquivo e o diff de verdade', r.status === 200 && r.j.diff.includes('+export const x = 1;'), r.cru.slice(0, 300));
  r = await pedir(`/orq/diff?id=w1&arquivo=${encodeURIComponent('solto.txt')}`, { id: 'coord' });
  checar('arquivo nao rastreado tambem tem diff', r.status === 200 && r.j.diff.includes('+ainda nao rastreado'), r.cru.slice(0, 300));
  r = await pedir(`/orq/diff?id=w1&arquivo=${encodeURIComponent('../../a.txt')}`, { id: 'coord' });
  checar('arquivo para fora do repositorio: recusado', r.status === 409, r.cru);
  fs.writeFileSync(path.join(wtA, 'grande.txt'), `${'linha comprida '.repeat(20)}\n`.repeat(500));
  r = await pedir(`/orq/diff?id=w1&arquivo=grande.txt`, { id: 'coord' });
  checar(`diff grande e cortado em ${worktrees.MAX_DIFF_ORQ / 1024} KB e se declara`,
    r.j.truncado === true && r.j.diff.length === worktrees.MAX_DIFF_ORQ, String(r.j && r.j.diff && r.j.diff.length));

  // ------------------------------------------------------------ a partida

  // O Enter so sai quando o registro do CLI diz `idle` com o NOSSO name, na
  // pasta da worktree -- o medido no spike D.
  escritos.length = 0;
  sessoesClaude = [{ nome: 'parte-b', cwd: path.join(repo, '.claude', 'worktrees', 'parte-b'), status: 'busy' }];
  orq.tiquePartida();
  await esperar(500);
  checar('registro busy: nada de Enter', escritos.length === 0, JSON.stringify(escritos));
  sessoesClaude = [{ nome: 'parte-b', cwd: repo, status: 'idle' }];
  orq.tiquePartida();
  await esperar(500);
  checar('mesmo nome noutra pasta: nada de Enter', escritos.length === 0, JSON.stringify(escritos));
  sessoesClaude = [{ nome: 'parte-b', cwd: path.join(repo, '.claude', 'worktrees', 'parte-b'), status: 'idle' }];
  orq.tiquePartida();
  await esperar(500);
  checar('idle com o nome e a pasta: UM Enter no worker certo', escritos.length === 1 && escritos[0].id === 'w2' && escritos[0].t === '\r', JSON.stringify(escritos));
  orq.tiquePartida();
  await esperar(500);
  checar('e nunca um segundo', escritos.length === 1, JSON.stringify(escritos));

  // ------------------------------------------------------------ worktrees.criar({ desde })

  let c = await worktrees.criar(repo, 'xyz', { desde: '--help' });
  checar('desde com cara de opcao: recusado', !c.ok && c.motivo === 'desde', JSON.stringify(c));
  c = await worktrees.criar(repo, 'xyz', { desde: 'nao-existe-ref' });
  checar('desde que nao e commit: recusado', !c.ok && c.motivo === 'desde', JSON.stringify(c));
  c = await worktrees.criar(repo, 'sem-desde');
  checar('sem desde, nasce do HEAD do projeto como sempre',
    c.ok && git(c.caminho, ['rev-parse', 'HEAD']).trim() === git(repo, ['rev-parse', 'HEAD']).trim(), JSON.stringify(c));

  // ------------------------------------------------------------ a skill

  checar('a skill comeca ausente', !skill.situacao().instalada);
  let s = skill.instalar();
  const txt = fs.readFileSync(skill.arquivo(), 'utf8');
  checar('instalar grava no ORQ_CLAUDE', s.ok && skill.arquivo().startsWith(process.env.ORQ_CLAUDE), skill.arquivo());
  const comCurl = txt.split('\n').filter((l) => /\bcurl -s\b/.test(l));
  checar('toda chamada leva o X-Orq-Id', comCurl.length >= 6 && comCurl.every((l) => l.includes('X-Orq-Id: $ORQ_ID')), comCurl.join(' | '));
  checar('os tetos vem das constantes', txt.includes(`no maximo ${orq.ESPERAR_MAX_S}s`) && txt.includes(`${orq.MAX_PROMPT} caracteres`)
    && txt.includes(`${orq.MAX_FILHOS} vivos`));
  checar('situacao: instalada e atual', skill.situacao().instalada && skill.situacao().atual);
  s = skill.remover();
  checar('remover apaga a nossa', s.removida && !fs.existsSync(skill.arquivo()));
  fs.mkdirSync(path.dirname(skill.arquivo()), { recursive: true });
  fs.writeFileSync(skill.arquivo(), '---\nname: orquestrador\n---\nminha propria\n');
  checar('skill alheia com o mesmo nome: instalar recusa', !skill.instalar().ok);
  skill.remover();
  checar('e remover NAO toca nela', fs.readFileSync(skill.arquivo(), 'utf8').includes('minha propria'));

  // ------------------------------------------------------------ a preferencia

  checar('ui.json torto cai no DESLIGADO', preferencias.normalizar({ orquestracao: 'sim' }).orquestracao === 'desligada');

  servidor.close();
  orq._zerar();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* worktree presa no Windows */ }
  console.log(falhas === 0 ? '\nORQUESTRACAO_OK' : `\nORQUESTRACAO_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
