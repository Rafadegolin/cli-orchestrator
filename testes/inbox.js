'use strict';

// A inbox do Pronix Flow (Fase 10.4), em Node puro: o que DECIDE -- endereco,
// formato do token, leitura defensiva da resposta, em que projeto cada issue
// abriria, e o GET com `fetch` falso.
//
// O caminho na tela (conectar, listar, abrir pelo mesmo caminho do /abrir) fica
// no `teste:inbox-ui`.

const os = require('os');
const path = require('path');

// ANTES de qualquer require dos modulos: `arquivo.PASTA` e lido no carregamento.
process.env.ORQ_DADOS = path.join(os.tmpdir(), `orq-teste-inbox-${Date.now()}`);

const flow = require('../src/main/flow');
const pedido = require('../src/main/pedido');
const { ORIGEM_FLOW } = require('../src/main/preferencias');

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
  return ok;
}
const igual = (nome, a, b) => checar(nome, JSON.stringify(a) === JSON.stringify(b), `recebeu ${JSON.stringify(a)}`);

const TOKEN = `pfx_${'a'.repeat(43)}`;

// Uma issue como o Flow a manda (`OrqInboxIssueDto`).
function doFlow(over = {}) {
  return {
    id: 'i1',
    repo: 'VDVTech/pronix-flow',
    branch: 'feature/TECH-7',
    issue: 'TECH-7',
    title: 'Título com acento',
    url: 'https://flow.pronixhub.com.br/teams/t1/issues/i1',
    description: 'Primeiro parágrafo.\n\nSegundo.',
    state: { name: 'Em progresso', type: 'STARTED' },
    priority: 'HIGH',
    team: { key: 'TECH', name: 'Tecnologia' },
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

// `fetch` falso: guarda o que pediram e devolve o que o teste mandar.
function falso(status, corpo, { json = true } = {}) {
  const chamadas = [];
  const fn = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => { if (!json) throw new Error('nao e json'); return corpo; },
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

(async () => {
  // ------------------------------------------------------------ endereco

  igual('vazio cai na origem de producao', flow.normalizarBase(''), ORIGEM_FLOW);
  igual('o caminho colado e descartado', flow.normalizarBase('https://flow.x.com/teams/abc?y=1'), 'https://flow.x.com');
  igual('http no loopback serve (o Flow de dev)', flow.normalizarBase('http://localhost:3100/'), 'http://localhost:3100');
  igual('http fora do loopback NAO serve: o token viajaria aberto', flow.normalizarBase('http://flow.x.com'), '');
  igual('credencial embutida na URL e recusada', flow.normalizarBase('https://u:s@flow.x.com'), '');
  igual('esquema estranho e recusado', flow.normalizarBase('file:///c:/x'), '');
  igual('lixo e recusado', flow.normalizarBase('nao e url'), '');

  // ------------------------------------------------------------ token

  checar('token do Flow passa', flow.tokenValido(TOKEN));
  checar('com espaco em volta (colado) passa', flow.tokenValido(`  ${TOKEN}\n`));
  checar('JWT nao passa', !flow.tokenValido('eyJhbGciOiJIUzI1NiJ9.e30.x'));
  checar('sem a marca nao passa', !flow.tokenValido('a'.repeat(47)));
  checar('curto demais nao passa', !flow.tokenValido('pfx_abc'));

  // ------------------------------------------------------------ descricao

  const curta = 'texto curto';
  igual('descricao curta passa inteira', flow.cortarDescricao(curta), curta);
  const longa = 'x'.repeat(9000);
  const cortada = flow.cortarDescricao(longa);
  checar('descricao longa e cortada no teto', cortada.length === flow.MAX_DESCRICAO, String(cortada.length));
  checar('e o corte se declara', cortada.includes('truncada'));

  // O motivo do corte: sem ele, o montarPrompt RECUSA, e uma issue longa nunca
  // abriria pela inbox.
  const n = pedido.normalizarPedido(flow.paraPedido(
    flow.normalizarInbox({ issues: [doFlow({ description: longa })] }).issues[0],
  ));
  checar('o pedido de uma issue longa normaliza', n.ok, JSON.stringify(n));
  checar('e o prompt dela NAO e recusado', pedido.montarPrompt(n.pedido).ok);
  checar('paragrafos sobrevivem ate o prompt',
    pedido.montarPrompt(pedido.normalizarPedido(flow.paraPedido(
      flow.normalizarInbox({ issues: [doFlow()] }).issues[0],
    )).pedido).prompt === 'Primeiro parágrafo.\n\nSegundo.');

  // ------------------------------------------------------------ a resposta

  const inbox = flow.normalizarInbox({
    user: { name: 'Ana', email: 'ana@x.com' },
    issues: [
      doFlow(),
      doFlow({ id: '' }),            // sem id
      doFlow({ id: 'i3', branch: 7 }), // branch de outra forma
      null,
      'lixo',
      doFlow({ id: 'i4', repo: null, url: 'javascript:alert(1)' }),
    ],
  });
  igual('o usuario vem', inbox.usuario, { nome: 'Ana', email: 'ana@x.com' });
  igual('linha torta cai SOZINHA, sem derrubar a lista', inbox.issues.map((i) => i.id), ['i1', 'i4']);
  igual('url que nao e http some', inbox.issues[1].url, '');
  igual('repo nulo fica nulo', inbox.issues[1].repo, null);
  igual('resposta sem issues vira lista vazia', flow.normalizarInbox({}).issues, []);
  igual('resposta que nem e objeto tambem', flow.normalizarInbox('x').issues, []);

  // ------------------------------------------------------------ anotar

  const projetos = [
    { id: 'p1', nome: 'flow', existe: true, remotes: ['https://github.com/VDVTech/pronix-flow.git'] },
    { id: 'p2', nome: 'api-a', existe: true, remotes: ['git@github.com:VDVTech/duplo.git'] },
    { id: 'p3', nome: 'api-b', existe: true, remotes: ['https://github.com/VDVTech/duplo'] },
    { id: 'p4', nome: 'sumido', existe: false, remotes: ['https://github.com/VDVTech/sumido.git'] },
  ];
  const anotadas = flow.anotar([
    ...flow.normalizarInbox({ issues: [doFlow()] }).issues,
    ...flow.normalizarInbox({ issues: [doFlow({ id: 'a2', repo: null })] }).issues,
    ...flow.normalizarInbox({ issues: [doFlow({ id: 'a3', repo: 'acme/nada' })] }).issues,
    ...flow.normalizarInbox({ issues: [doFlow({ id: 'a4', repo: 'VDVTech/duplo' })] }).issues,
    ...flow.normalizarInbox({ issues: [doFlow({ id: 'a5', repo: 'VDVTech/sumido' })] }).issues,
  ], projetos);
  igual('repo cadastrado aponta o projeto', anotadas[0].projeto, { id: 'p1', nome: 'flow' });
  igual('sem repo diz o motivo', anotadas[1].motivo, 'sem-repo');
  igual('repo desconhecido diz o motivo', anotadas[2].motivo, 'repo-nao-cadastrado');
  igual('dois projetos para o mesmo repo: ambiguo, sem chutar', anotadas[3].motivo, 'repo-ambiguo');
  igual('pasta que sumiu nao conta como cadastrada', anotadas[4].motivo, 'repo-nao-cadastrado');

  // ------------------------------------------------------------ o GET

  const ok = falso(200, { user: { name: 'Ana', email: 'a@x' }, issues: [doFlow()] });
  const r = await flow.buscarInbox({ base: 'https://flow.x.com/qualquer', token: ` ${TOKEN} `, buscar: ok });
  checar('GET responde ok', r.ok, JSON.stringify(r));
  igual('na rota do contrato, na ORIGEM', ok.chamadas[0].url, `https://flow.x.com${flow.CAMINHO}`);
  igual('com o token no Bearer, sem o espaco colado', ok.chamadas[0].opcoes.headers.Authorization, `Bearer ${TOKEN}`);
  checar('o retorno NAO carrega o token', !JSON.stringify(r).includes(TOKEN));

  const nenhum = falso(200, {});
  const semToken = await flow.buscarInbox({ base: '', token: 'nao-e-token', buscar: nenhum });
  checar('token fora do formato nem vai a rede', !semToken.ok && nenhum.chamadas.length === 0, JSON.stringify(semToken));
  const urlRuim = await flow.buscarInbox({ base: 'http://flow.x.com', token: TOKEN, buscar: nenhum });
  checar('http publico nem vai a rede', !urlRuim.ok && urlRuim.erro === 'url' && nenhum.chamadas.length === 0);

  const casos = [
    [401, 'token'],
    [404, 'versao'],
    [500, 'servidor'],
  ];
  for (const [status, erro] of casos) {
    const x = await flow.buscarInbox({ base: '', token: TOKEN, buscar: falso(status, {}) });
    checar(`${status} vira erro '${erro}'`, !x.ok && x.erro === erro, JSON.stringify(x));
    checar(`  e o erro do ${status} NAO carrega o token`, !JSON.stringify(x).includes(TOKEN));
  }

  const json = await flow.buscarInbox({ base: '', token: TOKEN, buscar: falso(200, null, { json: false }) });
  checar('resposta que nao e JSON vira erro, nao excecao', !json.ok && json.erro === 'formato');

  const rede = await flow.buscarInbox({
    base: '', token: TOKEN, buscar: async () => { throw new Error(`falhou com ${TOKEN}`); },
  });
  checar('rede fora vira erro, nao excecao', !rede.ok && rede.erro === 'rede', JSON.stringify(rede));
  checar('nem a mensagem do erro de rede vaza o token', !JSON.stringify(rede).includes(TOKEN));

  console.log(falhas === 0 ? '\nINBOX_OK' : `\nINBOX_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
