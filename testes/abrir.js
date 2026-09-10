'use strict';

// Abrir sessao a pedido do Pronix Flow.
//
// NAO precisa do app rodando: tudo que decide alguma coisa neste caminho mora em
// modulo Node puro (`pedido.js`, `preferencias.js`, `worktrees.js`), e o roteador
// HTTP e exportado justamente para subir numa porta efemera aqui. Testar contra a
// 47615 seria brigar com o app instalado da propria maquina.
//
// A parte que precisa de tela -- o painel nascendo, o chip da issue -- fica no
// `teste:abrir-ui`.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(os.tmpdir(), `orq-teste-abrir-${Date.now()}`);

// ANTES de qualquer require dos modulos: `arquivo.PASTA` e lido no carregamento.
process.env.ORQ_DADOS = path.join(RAIZ, 'dados');

const pedido = require('../src/main/pedido');
const preferencias = require('../src/main/preferencias');
const worktrees = require('../src/main/worktrees');
const projetos = require('../src/main/projetos');
const eventos = require('../src/main/eventos');

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
}

const igual = (nome, a, b) => checar(nome, JSON.stringify(a) === JSON.stringify(b), `recebeu ${JSON.stringify(a)}`);

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

// Repositorio descartavel com um "remoto" de mentira ao lado, no molde do
// `testes/worktrees.js`.
function montarRepo() {
  fs.rmSync(RAIZ, { recursive: true, force: true });
  const origem = path.join(RAIZ, 'origem.git');
  const repo = path.join(RAIZ, 'repo');
  fs.mkdirSync(origem, { recursive: true });

  git(origem, ['init', '-q', '--bare', '-b', 'main']);
  git(RAIZ, ['clone', '-q', origem, 'repo']);
  git(repo, ['config', 'user.email', 'teste@exemplo.com']);
  git(repo, ['config', 'user.name', 'Teste']);
  // CRLF envenena a checagem de arvore limpa no Windows.
  git(repo, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(repo, 'leia.md'), 'oi\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'inicial']);
  git(repo, ['push', '-q', 'origin', 'main']);
  return { origem, repo };
}

(async () => {
  const { origem, repo } = montarRepo();

  // ------------------------------------------------ normalizacao de remote

  igual('https com .git', pedido.normalizarRepo('https://github.com/VDVTech/pronix-flow.git'), 'vdvtech/pronix-flow');
  igual('forma scp', pedido.normalizarRepo('git@github.com:VDVTech/pronix-flow.git'), 'vdvtech/pronix-flow');
  igual('ssh://', pedido.normalizarRepo('ssh://git@github.com/VDVTech/pronix-flow'), 'vdvtech/pronix-flow');
  igual('owner/repo cru', pedido.normalizarRepo('VDVTech/pronix-flow'), 'vdvtech/pronix-flow');
  igual('lixo vira null', pedido.normalizarRepo('nada'), null);
  igual('subgrupo mantem os niveis', pedido.normalizarRepo('https://gitlab.com/grupo/sub/app.git'), 'grupo/sub/app');
  // E a cauda de dois segmentos entra como chave alternativa, senao um `sub/app`
  // vindo do Flow nunca casaria com um remote de subgrupo.
  checar('subgrupo casa pela cauda', pedido.combinaRepo('sub/app', ['https://gitlab.com/grupo/sub/app.git']));

  // A credencial embutida nao pode chegar ao projetos.json.
  const comSegredo = pedido.normalizarRepo('https://alguem:tok_secreto@github.com/VDVTech/pronix-flow.git');
  checar('credencial embutida some', comSegredo === 'vdvtech/pronix-flow' && !comSegredo.includes('tok_secreto'), comSegredo);

  // O Flow manda o nome canonico com a caixa original: casar tem de ignorar caixa.
  checar('casa sem caixa', pedido.combinaRepo('VDVTech/Pronix-Flow', ['git@github.com:vdvtech/pronix-flow.git']));
  checar('casa https contra ssh', pedido.combinaRepo('acme/app', ['ssh://git@github.com/acme/app.git']));
  checar('nao casa repo diferente', !pedido.combinaRepo('acme/app', ['ssh://git@github.com/acme/outro.git']));

  // ------------------------------------------------------------ deeplink

  const url = 'orquestrador://abrir?repo=VDVTech%2Fpronix-flow&branch=feature%2FTECH-1120'
    + '&issue=TECH-1120&title=Vincular%20issue%20a%20um%20reposit%C3%B3rio&url=https%3A%2F%2Fflow.x%2Fi%2F1';
  const d = pedido.deDeeplink(url);
  checar('deeplink parseia', d && d.ok, JSON.stringify(d));
  igual('deeplink branch com barra', d.pedido.branch, 'feature/TECH-1120');
  igual('deeplink issue e string', d.pedido.issue, 'TECH-1120');
  igual('deeplink title com acento', d.pedido.title, 'Vincular issue a um repositório');

  // As armadilhas do `new URL` com esquema nao-especial, todas MEDIDAS: o host
  // nao e minusculizado e o pathname vem vazio. Rotear por pathname nao funciona.
  checar('host em maiuscula ainda casa', pedido.deDeeplink('orquestrador://ABRIR?repo=a%2Fb&branch=x').ok);
  checar('host com barra ainda casa', pedido.deDeeplink('orquestrador://abrir/?repo=a%2Fb&branch=x').ok);
  igual('esquema errado e ignorado', pedido.deDeeplink('http://abrir?repo=a/b&branch=x'), null);
  igual('host errado e ignorado', pedido.deDeeplink('orquestrador://outra?repo=a/b&branch=x'), null);

  // O argv nunca e indexado: no layout de dev o caminho do app ocupa o [1].
  igual('argv e VARRIDO', pedido.deArgv(['electron.exe', 'C:/proj', '--switch', 'orquestrador://abrir?x=1']), 'orquestrador://abrir?x=1');
  igual('argv sem deeplink', pedido.deArgv(['electron.exe', 'C:/proj']), null);

  // Controle no meio do texto nao sobrevive: `\r` e `\n` escritos no PTY sao
  // Enter, e um prompt que se envia sozinho quebra a promessa de "so digitado".
  igual('controle vira espaco', pedido.normalizarPedido({ repo: 'a/b', branch: 'x\r\ny' }).pedido.branch, 'x y');

  // -------------------------------------------------------------- resolver

  const P = (id, nome, remotes) => ({ id, nome, remotes, existe: true });
  const base = { repo: 'acme/app', repoOriginal: 'Acme/App', branch: 'feature/X', projeto: '' };

  igual('nao cadastrado', pedido.resolver(base, [P('pj1', 'outro', ['acme/outro'])]).erro, 'repo-nao-cadastrado');
  igual('casa exato', pedido.resolver(base, [P('pj1', 'app', ['acme/app'])]).projeto.id, 'pj1');

  // Fork: o repo canonico so aparece no `upstream`, e e ele que o Flow manda.
  igual('fork casa pelo upstream',
    pedido.resolver(base, [P('pj1', 'app', ['eu/app', 'acme/app'])]).projeto.id, 'pj1');

  const doisClones = [P('pj1', 'app', ['acme/app']), P('pj2', 'app-fork', ['acme/app'])];
  const amb = pedido.resolver(base, doisClones);
  igual('dois clones -> ambiguo', amb.erro, 'repo-ambiguo');
  igual('ambiguo lista opcoes', amb.opcoes.map((o) => o.id), ['pj1', 'pj2']);
  checar('ambiguo NAO devolve caminho', !JSON.stringify(amb).includes('caminho'));

  igual('desempate por id', pedido.resolver({ ...base, projeto: 'pj2' }, doisClones).projeto.id, 'pj2');
  // O id e DESEMPATE, nunca chave: com repo que nao casa, o id nao pode servir.
  igual('id sozinho nao abre nada',
    pedido.resolver({ ...base, repo: 'nao/existe', projeto: 'pj2' }, doisClones).erro, 'repo-nao-cadastrado');

  // Pasta que sumiu nao entra na conta.
  igual('projeto inexistente e ignorado',
    pedido.resolver(base, [{ ...P('pj1', 'app', ['acme/app']), existe: false }]).erro, 'repo-nao-cadastrado');

  // ---------------------------------------------------------- o prompt

  const pr = pedido.montarPrompt({ issue: 'TECH-1120', title: 'Vincular issue', url: 'https://flow.x/i/1', description: '' });
  igual('prompt monta com o que chega', pr.prompt, 'Trabalhe na issue TECH-1120 — Vincular issue\nhttps://flow.x/i/1');

  const comDesc = pedido.montarPrompt({ issue: 'T-1', title: 'x', url: '', description: 'corpo da issue' });
  checar('description entra quando o Flow mandar', comDesc.prompt.endsWith('corpo da issue'), comDesc.prompt);

  // O CLI recusa acima de 5000 EM SILENCIO. Recusa, e nao truncagem: prompt
  // cortado e prompt errado.
  const longo = pedido.montarPrompt({ issue: 'T', title: 'y'.repeat(6000), url: '', description: '' });
  igual('prompt longo e RECUSADO', longo.erro, 'prompt-longo');
  checar('a recusa diz o numero', /6\d{3}/.test(longo.texto), longo.texto);

  // A chave da issue tem de sobreviver ao slug -- o Flow avisa que perder o
  // `-1120` desfaz o vinculo issue<->branch em silencio.
  const slug = 'feature/TECH-1120'
    .normalize('NFD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 60);
  checar('slug preserva KEY-N', slug.includes('TECH-1120'), slug);

  // --------------------------------------------------------- allowlist

  const ui = preferencias.carregar();
  checar('Flow permitido', preferencias.origemPermitida('https://flow.pronixhub.com.br', ui));
  checar('Flow com barra e caixa', preferencias.origemPermitida('https://Flow.PronixHub.com.br/', ui));
  checar('evil.com recusado', !preferencias.origemPermitida('https://evil.com', ui));
  checar('sem Origin passa (curl)', preferencias.origemPermitida('', ui));
  checar('Origin null recusado', !preferencias.origemPermitida('null', ui));
  checar('loopback por hostname, qualquer porta', preferencias.origemPermitida('http://localhost:3100', ui));
  checar('loopback ipv6 com colchetes', preferencias.origemPermitida('http://[::1]:5173', ui));
  checar('http publico recusado', !preferencias.origemPermitida('http://flow.pronixhub.com.br', ui));
  checar('curinga nao e curinga', preferencias.canonizarOrigem('https://*.pronix.com') === null);
  checar('desligado fecha tudo, loopback inclusive',
    !preferencias.origemPermitida('http://localhost:3100', { ...ui, externo: 'desligado' }));
  igual('lista vazia FICA vazia', preferencias.normalizar({ origens: [] }).origens, []);
  igual('nao-array cai no padrao', preferencias.normalizar({ origens: 'x' }).origens, [preferencias.ORIGEM_FLOW]);

  // ------------------------------------------------------ branch e worktree

  checar('branch com barra e valido', worktrees.branchValido(repo, 'feature/TECH-1120'));
  checar('refs/heads/x RECUSADO', !worktrees.branchValido(repo, 'refs/heads/x'));
  checar('branch com hifen na frente RECUSADO', !worktrees.branchValido(repo, '-bad'));
  checar('branch "-" RECUSADO', !worktrees.branchValido(repo, '-'));
  checar('a..b recusado pelo git', !worktrees.branchValido(repo, 'a..b'));
  checar('espaco recusado pelo git', !worktrees.branchValido(repo, 'com espaco'));

  // O git ACEITA `con` como branch; quem nao aceita e o Windows como pasta.
  igual('nome reservado do Windows', worktrees.prever(repo, 'con', { branch: 'feature/x' }).motivo, 'nome-reservado');

  igual('branch invalida vira motivo proprio', worktrees.prever(repo, 'ok', { branch: 'refs/heads/x' }).motivo, 'branch');

  // `main` esta SEMPRE checado no proprio projeto -- deixou de ser hipotese no
  // momento em que o branch pode vir de fora.
  igual('branch ja checado em outra arvore', worktrees.prever(repo, 'qualquer', { branch: 'main' }).motivo, 'em-uso');

  // Sem branch, tudo continua exatamente como era.
  const semBranch = worktrees.prever(repo, 'feat-x');
  igual('compatibilidade: branch padrao', semBranch.branch, 'worktree-feat-x');
  igual('compatibilidade: sem motivo', semBranch.ok, true);

  // Criar num branch literal.
  const cr = await worktrees.criar(repo, 'feature-TECH-1120', { branch: 'feature/TECH-1120' });
  checar('criou a worktree', cr.ok, JSON.stringify(cr));
  igual('branch e o LITERAL', cr.branch, 'feature/TECH-1120');
  igual('origem: branch novo', cr.origem, 'novo');
  checar('marca que criou o branch', cr.branchCriado === true);
  igual('pasta segue a convencao',
    path.basename(cr.caminho), 'feature-TECH-1120');
  igual('o git concorda com o branch',
    git(cr.caminho, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'feature/TECH-1120');

  // A COLISAO: `feature/TECH-1120` e `feature-TECH-1120` disputam a mesma pasta.
  const col = worktrees.prever(repo, 'feature-TECH-1120', { branch: 'feature-TECH-1120' });
  igual('colisao detectada', col.motivo, 'colisao');
  igual('colisao nomeia o branch que ja esta la', col.branchAtual, 'feature/TECH-1120');
  checar('colisao nomeia o pedido', col.branchPedido === 'feature-TECH-1120', col.texto);

  // Reaproveitar a MESMA worktree e sucesso, nao colisao -- e o que faz o pedido
  // repetido do Flow encontrar a sessao de ontem em vez de um erro.
  const re = await worktrees.criar(repo, 'feature-TECH-1120', { branch: 'feature/TECH-1120' });
  checar('mesma worktree e reaproveitada', re.ok && re.criada === false, JSON.stringify(re));

  // `desfazer` NAO pode apagar branch que nao criamos.
  git(repo, ['branch', 'preexistente']);
  const cr2 = await worktrees.criar(repo, 'pre', { branch: 'preexistente' });
  checar('reaproveita branch local existente', cr2.ok, JSON.stringify(cr2));
  igual('origem: branch local', cr2.origem, 'local');
  checar('NAO marca branchCriado', cr2.branchCriado === false);
  await worktrees.desfazer(repo, cr2.caminho, cr2.branch, { apagarBranch: cr2.branchCriado });
  checar('desfazer preservou o branch de fora',
    worktrees.branchValido(repo, 'preexistente')
      && git(repo, ['branch', '--list', 'preexistente']).trim() !== '',
    git(repo, ['branch', '--list', 'preexistente']).trim());

  // Branch que so existe no remoto: busca e cria rastreando.
  git(repo, ['branch', 'feature/TECH-2000']);
  git(repo, ['push', '-q', 'origin', 'feature/TECH-2000']);
  git(repo, ['branch', '-D', 'feature/TECH-2000']);
  igual('acha o branch no remoto', worktrees.remotosComBranch(repo, 'feature/TECH-2000'), ['origin']);
  const cr3 = await worktrees.criar(repo, 'feature-TECH-2000', { branch: 'feature/TECH-2000' });
  checar('criou a partir do remoto', cr3.ok, JSON.stringify(cr3));
  igual('origem: remoto', cr3.origem, 'remoto');
  igual('rastreia o upstream',
    git(cr3.caminho, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).trim(),
    'origin/feature/TECH-2000');

  // ------------------------------------------------------------ remotes

  igual('remotesDe le a url', worktrees.remotesDe(repo).length, 1);
  const r1 = projetos.adicionar(repo);
  checar('cadastro guarda os remotes', Array.isArray(r1.projeto.remotes), JSON.stringify(r1.projeto.remotes));
  const alvoLocal = pedido.normalizarRepo(worktrees.remotesDe(repo)[0]);
  igual('acharPorRepo acha o clone', projetos.acharPorRepo(alvoLocal).length, 1);
  igual('acharPorRepo nao inventa', projetos.acharPorRepo('acme/nao-existe').length, 0);

  // -------------------------------------------------------- roteador HTTP

  const servidor = http.createServer(eventos.tratarSeguro);
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = servidor.address().port;

  const pedir = (caminho, o = {}) => new Promise((ok) => {
    const req = http.request({
      host: '127.0.0.1', port: porta, path: caminho, method: o.metodo || 'GET', headers: o.headers || {},
    }, (res) => {
      let c = '';
      res.on('data', (x) => { c += x; });
      res.on('end', () => ok({ status: res.statusCode, h: res.headers, corpo: c.trim() }));
    });
    req.setTimeout(5000, () => { req.destroy(); ok({ status: 0, h: {}, corpo: 'TIMEOUT' }); });
    req.on('error', () => ok({ status: 0, h: {}, corpo: 'ERRO' }));
    if (o.corpo) req.write(o.corpo);
    req.end();
  });

  const FLOW = preferencias.ORIGEM_FLOW;

  let r = await pedir('/ping');
  igual('/ping responde 200', r.status, 200);
  const ping = JSON.parse(r.corpo);
  checar('/ping se identifica', ping.app === 'orquestrador' && ping.api === 1, r.corpo);
  checar('/ping devolve CONTAGEM, nao a lista', typeof ping.projetos === 'number' && !Array.isArray(ping.projetos));
  checar('/ping nao vaza caminho', !r.corpo.includes(RAIZ) && !/[A-Za-z]:\\\\/.test(r.corpo), r.corpo);
  // `title` tem acento e emoji por contrato: contar caracteres em vez de bytes
  // entrega JSON truncado sem erro em nenhum dos dois lados.
  igual('content-length em BYTES', Number(r.h['content-length']), Buffer.byteLength(r.corpo + '\n'));

  r = await pedir('/ping', { headers: { origin: FLOW } });
  igual('ecoa a origem do Flow', r.h['access-control-allow-origin'], FLOW);
  igual('manda Vary: Origin', r.h.vary, 'Origin');

  r = await pedir('/ping', { headers: { origin: 'https://evil.com' } });
  igual('origem de fora -> 403', r.status, 403);
  checar('origem de fora NAO e ecoada', !r.h['access-control-allow-origin']);

  r = await pedir('/abrir', {
    metodo: 'OPTIONS',
    headers: { origin: FLOW, 'access-control-request-private-network': 'true' },
  });
  igual('preflight -> 204', r.status, 204);
  igual('preflight libera rede privada', r.h['access-control-allow-private-network'], 'true');
  igual('preflight libera content-type', r.h['access-control-allow-headers'], 'Content-Type');
  igual('preflight anuncia POST', r.h.allow, 'POST, OPTIONS');

  r = await pedir('/abrir', { metodo: 'OPTIONS', headers: { origin: 'https://evil.com' } });
  igual('preflight de fora -> 403', r.status, 403);

  // POST-only: GET com efeito colateral seria alcancavel por navegacao de topo,
  // que nao manda Origin nenhum e deixaria o portao sem o que ler.
  r = await pedir('/abrir', { metodo: 'GET', headers: { origin: FLOW } });
  igual('/abrir por GET -> 405', r.status, 405);

  r = await pedir('/abrir', { metodo: 'POST', headers: { origin: FLOW, 'content-type': 'text/plain' }, corpo: '{}' });
  igual('/abrir sem JSON -> 415', r.status, 415);

  r = await pedir('/abrir', {
    metodo: 'POST',
    headers: { origin: FLOW, 'content-type': 'application/json', host: 'evil.com' },
    corpo: '{}',
  });
  igual('Host de fora -> 403 (DNS rebinding)', r.status, 403);

  // O caminho do hook nao pode ter mudado nada.
  r = await pedir('/evento/Stop/x', { metodo: 'POST', corpo: '{}' });
  checar('hook segue respondendo 200 ok', r.status === 200 && r.corpo === 'ok', `${r.status} ${r.corpo}`);
  r = await pedir('/caminho/desconhecido');
  checar('desconhecido segue 200 mudo', r.status === 200 && r.corpo === 'ok');

  servidor.close();

  fs.rmSync(RAIZ, { recursive: true, force: true });

  console.log(falhas === 0 ? '\nABRIR_OK' : `\nABRIR_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
