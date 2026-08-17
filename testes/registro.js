'use strict';
// O registro de sessoes do CLI como terceira fonte de status.
//
// Node puro, sem app: `ORQ_CLAUDE` reaponta a pasta `~/.claude` (irma do
// ORQ_DADOS), entao da para montar o registro a mao e cobrar a REGRA sem
// depender de uma sessao do Claude de verdade.
//
// A regra em uma linha: `waiting` acende, `busy` apaga, `idle` nao faz nada. Os
// numeros que a justificam sairam do `npm run spike:aprovacao` e estao no
// cabecalho do `src/main/registro.js`.

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ_CLAUDE = path.join(os.tmpdir(), 'orq-teste-registro-claude');
process.env.ORQ_CLAUDE = RAIZ_CLAUDE;

const claudeDados = require('../src/main/claude-dados');
const estado = require('../src/main/estado');
const registro = require('../src/main/registro');

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
}

const PASTA_SESSOES = path.join(RAIZ_CLAUDE, 'sessions');

function gravarSessao(pid, campos) {
  fs.mkdirSync(PASTA_SESSOES, { recursive: true });
  fs.writeFileSync(path.join(PASTA_SESSOES, `${pid}.json`), JSON.stringify({
    pid, sessionId: `s-${pid}`, version: '2.1.227', kind: 'interactive', ...campos,
  }), 'utf8');
}

function statusDoPainel(id) {
  return estado.todas().find((s) => s.id === id)?.status;
}

(() => {
  fs.rmSync(RAIZ_CLAUDE, { recursive: true, force: true });

  const PROJ = path.join(os.tmpdir(), 'orq-teste-registro-proj');
  const WT = path.join(PROJ, '.claude', 'worktrees', 'feat-x');

  // --- a leitura ----------------------------------------------------------
  checar('sem a pasta, devolve lista vazia em vez de estourar',
    JSON.stringify(claudeDados.sessoes()) === '[]', '');

  gravarSessao(111, { cwd: PROJ, name: 'alfa', status: 'busy', updatedAt: 1 });
  gravarSessao(222, { cwd: WT, name: 'beta', status: 'waiting', updatedAt: 2 });
  fs.writeFileSync(path.join(PASTA_SESSOES, 'torto.json'), '{ isto nao e json', 'utf8');

  const lidas = claudeDados.sessoes({ pidVivo: () => true });
  checar('le as sessoes e ignora o arquivo torto', lidas.length === 2,
    lidas.map((s) => s.nome).join(','));
  checar('e traz nome, cwd e status', lidas.some((s) => s.nome === 'beta' && s.status === 'waiting'),
    JSON.stringify(lidas.find((s) => s.pid === 222)));

  // Arquivo de sessao morta fica para tras -- e uma sessao "viva" que na verdade
  // morreu e pior que nenhuma informacao.
  const soVivo = claudeDados.sessoes({ pidVivo: (pid) => pid === 222 });
  checar('descarta pid morto', soVivo.length === 1 && soVivo[0].pid === 222,
    soVivo.map((s) => s.pid).join(','));

  // --- a regra ------------------------------------------------------------
  //
  // As features casam com o `name` gravado no registro porque `montarComando`
  // lanca com `--name <slug>`, e o slug E o feature do painel.
  estado.registrar('p-alfa', { feature: 'alfa', cwd: PROJ });
  estado.registrar('p-beta', { feature: 'beta', cwd: WT });

  estado.definirStatus('p-alfa', 'rodando');
  estado.definirStatus('p-beta', 'rodando');

  registro.tique({ lista: claudeDados.sessoes({ pidVivo: () => true }) });

  checar('`waiting` ACENDE: o CLI diz que a sessao esta parada esperando voce',
    statusDoPainel('p-beta') === 'esperando', String(statusDoPainel('p-beta')));
  checar('e `busy` nao mexe em quem ja esta rodando',
    statusDoPainel('p-alfa') === 'rodando', String(statusDoPainel('p-alfa')));

  // `busy` apaga amarelo preso -- o mesmo papel do MARCA_TRABALHANDO, e pela
  // mesma razao: e sobre o AGORA.
  gravarSessao(222, { cwd: WT, name: 'beta', status: 'busy', updatedAt: 3 });
  registro.tique({ lista: claudeDados.sessoes({ pidVivo: () => true }) });
  checar('`busy` APAGA um esperando preso',
    statusDoPainel('p-beta') === 'rodando', String(statusDoPainel('p-beta')));

  // O erro que custou caro uma vez: `idle_prompt` acendendo amarelo numa sessao
  // que tinha acabado. Sessao ociosa pode ter terminado OU estar esperando voce
  // digitar, e o registro nao distingue -- entao ele nao decide.
  gravarSessao(222, { cwd: WT, name: 'beta', status: 'idle', updatedAt: 4 });
  registro.tique({ lista: claudeDados.sessoes({ pidVivo: () => true }) });
  checar('`idle` NAO acende nada', statusDoPainel('p-beta') === 'rodando',
    String(statusDoPainel('p-beta')));

  estado.definirStatus('p-beta', 'terminou');
  registro.tique({ lista: claudeDados.sessoes({ pidVivo: () => true }) });
  checar('e `idle` tambem nao derruba um `terminou`',
    statusDoPainel('p-beta') === 'terminou', String(statusDoPainel('p-beta')));

  // --- a pergunta da faixa nao pode ser apagada ---------------------------
  //
  // O registro nao sabe O QUE esta sendo perguntado. Se ele sobrescrevesse um
  // `esperando` que ja existe, a faixa de aprovacao perderia a pergunta que o
  // farejador acabou de ler -- e voltaria a mostrar a frase generica do hook.
  estado.definirStatus('p-beta', 'esperando', 'pedindo permissao',
    { pergunta: 'Do you want to create marca.txt?', tipo: 'permissao' });
  gravarSessao(222, { cwd: WT, name: 'beta', status: 'waiting', updatedAt: 5 });
  registro.tique({ lista: claudeDados.sessoes({ pidVivo: () => true }) });
  const beta = estado.todas().find((s) => s.id === 'p-beta');
  checar('um `waiting` sobre um `esperando` que ja existe nao apaga a pergunta',
    beta.pergunta === 'Do you want to create marca.txt?', JSON.stringify(beta.pergunta));

  // --- correlacao por cwd DESCENDENTE -------------------------------------
  //
  // `claude -w` move a sessao para `<projeto>/.claude/worktrees/<nome>`, entao o
  // cwd do registro nao e o cwd de spawn do painel. Foi assim que `p-beta`
  // casou acima; aqui isso vira afirmacao explicita.
  checar('a sessao dentro do worktree casou com o painel do projeto',
    estado.resolver({ cwd: WT }) === 'p-beta', String(estado.resolver({ cwd: WT })));

  // --- SESSAO DE ESTRANHO NAO MEXE EM PAINEL NENHUM ------------------------
  //
  // Este e o teste mais importante do arquivo, e ele existe porque a primeira
  // versao casava so por `cwd` -- e ai uma sessao do Claude aberta A MAO na
  // pasta do projeto (o desenvolvimento deste proprio app) passava a mandar no
  // status dos painéis dali. Foi o `teste:ui` que denunciou, com dois testes de
  // ordenacao falhando do nada.
  //
  // O portao e o NOME: sessao que este app nao lancou com `--name` nao tem como
  // ser provada nossa, entao nao decide nada.
  estado.definirStatus('p-alfa', 'rodando');
  gravarSessao(333, {
    cwd: PROJ, name: 'cli-orchestrator-c6', nameSource: 'derived', status: 'waiting', updatedAt: 9,
  });
  const antes = statusDoPainel('p-alfa');
  const mexeu = registro.tique({ lista: claudeDados.sessoes({ pidVivo: () => true }) });
  checar('sessao de fora, na MESMA pasta, nao acende painel nenhum',
    statusDoPainel('p-alfa') === antes && !mexeu.some((m) => m.id === 'p-alfa'),
    `${antes} -> ${statusDoPainel('p-alfa')}`);
  checar('e ela nao tem dono', registro.donoDe({
    nome: 'cli-orchestrator-c6', cwd: PROJ, status: 'waiting',
  }) === null, '');
  // Sessao sem nome nenhum tambem nao: e o caso de `cls && claude` puro.
  checar('sessao sem nome tambem nao tem dono',
    registro.donoDe({ nome: '', cwd: PROJ, status: 'waiting' }) === null, '');

  // --- nada de estado deixado para tras -----------------------------------
  estado.remover('p-alfa');
  estado.remover('p-beta');
  fs.rmSync(RAIZ_CLAUDE, { recursive: true, force: true });

  console.log(falhas ? `\n${falhas} FALHARAM` : '\nREGISTRO_OK');
  process.exit(falhas ? 1 : 0);
})();
