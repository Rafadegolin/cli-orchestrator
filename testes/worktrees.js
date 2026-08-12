'use strict';
// Worktrees: listar, retomar e arquivar com seguranca.
//
// Nao precisa do app rodando -- o modulo e Node puro. E monta um repositorio
// descartavel simulando o lock do Claude (`claude session x (pid N start 1)`),
// o que permite testar "sessao viva" e "lock orfao" sem abrir sessao de
// verdade.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const wt = require('../src/main/worktrees');

const RAIZ = path.join(os.tmpdir(), 'orq-teste-worktrees');

let falhas = 0;
function checar(nome, ok, detalhe = '') {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  -- ' + detalhe : ''}`);
  if (!ok) falhas++;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function montarRepo() {
  fs.rmSync(RAIZ, { recursive: true, force: true });
  fs.mkdirSync(RAIZ, { recursive: true });

  git(RAIZ, 'init', '-q', '-b', 'main');
  git(RAIZ, 'config', 'user.email', 'teste@teste');
  git(RAIZ, 'config', 'user.name', 'teste');
  // Sem conversao de fim de linha: o teste escreve arquivos com \n e o Windows
  // devolve \r\n, o que faz arquivo recem-commitado aparecer como MODIFICADO e
  // envenena qualquer checagem de "arvore limpa".
  git(RAIZ, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(RAIZ, 'leiame.txt'), 'base\n');
  fs.writeFileSync(path.join(RAIZ, '.gitignore'), '.env\n.env.local\n');
  git(RAIZ, 'add', '-A');
  git(RAIZ, 'commit', '-qm', 'inicial');

  fs.mkdirSync(path.join(RAIZ, '.claude', 'worktrees'), { recursive: true });
}

// Cria worktree no mesmo lugar e com o mesmo padrao de branch que o `claude -w`.
function criarWorktree(nome, { pidDoLock } = {}) {
  const destino = path.join(RAIZ, '.claude', 'worktrees', nome);
  git(RAIZ, 'worktree', 'add', '-q', '-b', `worktree-${nome}`, destino);
  if (pidDoLock !== undefined) {
    git(RAIZ, 'worktree', 'lock', '--reason',
      `claude session ${nome} (pid ${pidDoLock} start 639219707467220630)`, destino);
  }
  return destino;
}

function achar(nome) {
  return wt.listar(RAIZ).find((w) => w.nome === nome);
}

(async () => {
  montarRepo();

  // --- listagem ----------------------------------------------------------
  const dLimpo = criarWorktree('limpo', { pidDoLock: 999999 });   // pid que nao existe
  const dViva = criarWorktree('viva', { pidDoLock: process.pid }); // pid deste teste, vivo
  const dSujo = criarWorktree('sujo', { pidDoLock: 999999 });
  const dCommit = criarWorktree('commitado', { pidDoLock: 999999 });

  const lista = wt.listar(RAIZ);
  checar('lista encontra os 4 worktrees e ignora o principal', lista.length === 4,
    lista.map((w) => w.nome).join(','));
  checar('nome e branch seguem o padrao do claude -w',
    achar('limpo').branch === 'worktree-limpo', achar('limpo').branch);
  checar('a base e o branch do worktree principal', achar('limpo').baseBranch === 'main',
    achar('limpo').baseBranch);

  // --- sessao viva x lock orfao ------------------------------------------
  checar('lock com PID vivo e reconhecido como sessao aberta',
    achar('viva').sessaoViva === true, `pid=${achar('viva').pid}`);
  checar('lock com PID inexistente e reconhecido como orfao',
    achar('limpo').sessaoViva === false, `pid=${achar('limpo').pid}`);

  checar('arquivar recusa worktree com sessao viva',
    wt.podeArquivar(achar('viva')).motivo === 'sessao-viva',
    wt.podeArquivar(achar('viva')).texto);

  // --- alteracao nao commitada -------------------------------------------
  fs.writeFileSync(path.join(dSujo, 'novo.txt'), 'trabalho nao salvo\n');
  const vSujo = wt.podeArquivar(achar('sujo'));
  checar('arquivar recusa worktree com arquivo modificado', vSujo.motivo === 'modificado', vSujo.texto);

  // --- commit nao mesclado ------------------------------------------------
  fs.writeFileSync(path.join(dCommit, 'feito.txt'), 'trabalho commitado\n');
  git(dCommit, 'add', '-A');
  git(dCommit, 'commit', '-qm', 'trabalho da feature');
  const vCommit = wt.podeArquivar(achar('commitado'));
  checar('arquivar recusa worktree com commit nao mesclado', vCommit.motivo === 'nao-mesclado', vCommit.texto);
  checar('a recusa diz quantos commits se perderiam',
    achar('commitado').naoMesclados === 1, String(achar('commitado').naoMesclados));

  // --- nenhuma recusa pode deixar residuo ---------------------------------
  for (const nome of ['viva', 'sujo', 'commitado']) {
    const r = wt.arquivar(RAIZ, achar(nome).caminho);
    checar(`recusa de "${nome}" nao executa nada`, r.ok === false, r.motivo);
  }
  const depoisDasRecusas = wt.listar(RAIZ);
  checar('apos as recusas, os 4 worktrees continuam intactos', depoisDasRecusas.length === 4,
    depoisDasRecusas.map((w) => w.nome).join(','));
  checar('e continuam trancados como estavam',
    depoisDasRecusas.filter((w) => w.travado).length === 4,
    depoisDasRecusas.map((w) => `${w.nome}:${w.travado}`).join(' '));

  // --- o que o `limpo` NAO enxerga ----------------------------------------
  //
  // `git status --porcelain` nao lista arquivo ignorado, e o `git worktree
  // remove` apaga ignorado sem reclamar. O `.env` dentro do worktree sumia em
  // silencio -- e e o app que incentiva copiar o .env para la, pelo
  // .worktreeinclude. Nao bloqueia: o dialogo passa a NOMEAR o que vai apagar.
  fs.writeFileSync(path.join(dLimpo, '.env'), 'TOKEN=abc\n');
  // Ignorado, mas NAO e um dos candidatos conhecidos: nao pode entrar na lista,
  // senao o dialogo viraria um despejo de node_modules.
  fs.mkdirSync(path.join(dLimpo, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dLimpo, 'node_modules', 'x.js'), '\n');
  // Pelo `info/exclude`, e nao pelo `.gitignore`: o `.gitignore` e VERSIONADO, e
  // o worktree carrega a versao da propria branch -- editar la nao ignoraria
  // nada aqui, e ainda sujaria a arvore. O `info/exclude` mora no diretorio
  // comum e vale para todos os worktrees.
  fs.appendFileSync(path.join(RAIZ, '.git', 'info', 'exclude'), '\nnode_modules/\n');

  const comEnv = achar('limpo');
  checar('o .env ignorado aparece na lista de ignorados',
    comEnv.ignorados.includes('.env'), JSON.stringify(comEnv.ignorados));
  checar('e o worktree continua "limpo" -- e por isso que o portao precisava existir',
    comEnv.limpo === true && comEnv.sujos === 0, JSON.stringify({ l: comEnv.limpo, s: comEnv.sujos }));
  checar('ignorado que nao e arquivo de ambiente fica de fora',
    !comEnv.ignorados.some((i) => i.includes('node_modules')), JSON.stringify(comEnv.ignorados));
  checar('e ter .env NAO impede de arquivar (so avisa)',
    wt.podeArquivar(comEnv).pode === true, JSON.stringify(wt.podeArquivar(comEnv)));

  // --- arquivar de verdade o que esta limpo -------------------------------
  const r = wt.arquivar(RAIZ, dLimpo);
  checar('arquiva o worktree limpo', r.ok === true, JSON.stringify(r));
  checar('a pasta do worktree sumiu do disco', !fs.existsSync(dLimpo), dLimpo);
  checar('o branch tambem foi removido', r.branchRemovido === true, r.avisoBranch || '');

  const branches = git(RAIZ, 'branch', '--list').split(/\r?\n/).map((l) => l.trim().replace(/^\*\s*/, ''));
  checar('git branch confirma que worktree-limpo nao existe mais',
    !branches.includes('worktree-limpo'), branches.filter(Boolean).join(','));
  checar('a lista agora tem 3', wt.listar(RAIZ).length === 3,
    wt.listar(RAIZ).map((w) => w.nome).join(','));

  // --- .worktreeinclude ---------------------------------------------------
  let inc = wt.situacaoInclude(RAIZ);
  checar('sem .env nenhum, nao ha o que avisar', inc.faltando === false,
    JSON.stringify({ existe: inc.existe, candidatos: inc.candidatos }));

  fs.writeFileSync(path.join(RAIZ, '.env'), 'SEGREDO=1\n');
  fs.writeFileSync(path.join(RAIZ, 'visivel.txt'), 'versionado\n');
  inc = wt.situacaoInclude(RAIZ);
  checar('detecta .env ignorado sem .worktreeinclude', inc.faltando === true,
    JSON.stringify(inc.candidatos));
  checar('so sugere arquivo ignorado, nao versionado',
    inc.candidatos.includes('.env') && !inc.candidatos.includes('visivel.txt'),
    inc.candidatos.join(','));

  wt.criarInclude(RAIZ, inc.candidatos);
  inc = wt.situacaoInclude(RAIZ);
  checar('depois de criar, o aviso some', inc.faltando === false && inc.existe === true, '');
  checar('o arquivo lista o .env', inc.conteudo.includes('.env'),
    inc.conteudo.split('\n').filter((l) => l && !l.startsWith('#')).join('|'));

  // --- diff ---------------------------------------------------------------
  //
  // Fecha o ciclo de revisao: a etiqueta na lateral deixa de so dizer o que
  // impede arquivar e passa a mostrar o QUE mudou.
  const paraDiff = wt.listar(RAIZ).find((w) => !w.sessaoViva && w.existe);
  checar('ha um worktree para diferenciar', Boolean(paraDiff),
    wt.listar(RAIZ).map((w) => w.nome).join(','));

  // Um commit na branch e uma alteracao ainda nao commitada: o diff tem de
  // separar as duas coisas.
  fs.writeFileSync(path.join(paraDiff.caminho, 'commitado.txt'), 'ESTA_COMMITADO\n');
  git(paraDiff.caminho, 'add', '.');
  git(paraDiff.caminho, 'commit', '-m', 'commit do teste de diff');
  fs.writeFileSync(path.join(paraDiff.caminho, 'solto.txt'), 'AINDA_NAO_COMMITADO\n');
  git(paraDiff.caminho, 'add', 'solto.txt');
  // Arquivo novo que nem foi adicionado: nao aparece no `git diff`, mas a
  // etiqueta da lateral ja o conta como alterado.
  fs.writeFileSync(path.join(paraDiff.caminho, 'nem-adicionado.txt'), 'ARQUIVO_NOVO_INTEIRO\n');

  const d = wt.diff(RAIZ, paraDiff.caminho);
  checar('o diff foi lido', d.ok === true, JSON.stringify({ ok: d.ok, texto: d.texto }));
  checar('separa o que ja foi commitado na branch',
    d.commitado.includes('commitado.txt'), d.commitado.split('\n')[0] || '(vazio)');
  checar('e o que ainda nao foi',
    d.naoCommitado.includes('solto.txt'), d.naoCommitado.split('\n')[0] || '(vazio)');
  checar('nao mistura os dois lados',
    !d.commitado.includes('solto.txt'), '');
  checar('e mostra tambem o arquivo novo que nem foi adicionado',
    d.naoCommitado.includes('nem-adicionado.txt')
    && d.naoCommitado.includes('ARQUIVO_NOVO_INTEIRO'),
    d.naoCommitado.includes('nem-adicionado.txt') ? 'sem conteudo' : 'nem citado');
  checar('e diz de qual branch para qual base',
    Boolean(d.branch) && Boolean(d.baseBranch), `${d.branch} vs ${d.baseBranch}`);

  // Pasta que sumiu volta como recusa, e nao como excecao.
  const sumiu = wt.diff(RAIZ, path.join(RAIZ, 'nao', 'existe'));
  checar('worktree inexistente vira recusa com motivo, sem estourar',
    sumiu.ok === false && Boolean(sumiu.texto), JSON.stringify(sumiu));

  // --- ficar em dia com o remoto -----------------------------------------
  //
  // O remoto e um `--bare` numa pasta temporaria: da para exercitar atras/em
  // dia, o fast-forward e as duas recusas SEM tocar a rede. Testar contra o
  // GitHub seria testar o GitHub.
  const REMOTO = path.join(os.tmpdir(), `orq-teste-remoto-${Date.now()}`);
  // `-b main` no bare tambem: sem isso o HEAD dele nasce apontando para
  // `master`, o clone nao faz checkout de nada ("remote HEAD refers to
  // nonexistent ref") e commita numa branch que ninguem esta olhando -- o teste
  // passava a medir o nada.
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', REMOTO], { encoding: 'utf8' });
  git(RAIZ, 'remote', 'add', 'origin', REMOTO);
  git(RAIZ, 'push', '-q', '-u', 'origin', 'main');

  const emDia = wt.situacaoRemoto(RAIZ);
  checar('com tudo empurrado, nao ha atraso',
    emDia.base === 'main' && emDia.upstream === 'origin/main' && emDia.atras === 0,
    JSON.stringify(emDia));

  // Alguem commitou no servidor -- e este checkout nao sabe. E o caso real: o
  // merge acontece no servidor enquanto a sessao trabalha isolada na worktree.
  const CLONE = path.join(os.tmpdir(), `orq-teste-clone-${Date.now()}`);
  execFileSync('git', ['clone', '-q', REMOTO, CLONE], { encoding: 'utf8' });
  git(CLONE, 'config', 'user.email', 'outro@teste');
  git(CLONE, 'config', 'user.name', 'outro');
  git(CLONE, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(CLONE, 'do-servidor.txt'), 'veio de fora\n');
  git(CLONE, 'add', '-A');
  git(CLONE, 'commit', '-qm', 'commit do servidor');
  git(CLONE, 'push', '-q');

  checar('antes do fetch o app nao pode ADIVINHAR que ficou atras',
    wt.situacaoRemoto(RAIZ).atras === 0, '');

  const busca = await wt.buscar(RAIZ);
  checar('buscar traz o que ha de novo', busca.ok === true, JSON.stringify(busca));
  checar('e ai sim a base aparece atrasada',
    busca.atras === 1 && busca.frente === 0, JSON.stringify(busca));

  // Arvore suja recusa, com motivo -- mesma gramatica dos portoes do arquivar.
  fs.writeFileSync(path.join(RAIZ, 'leiame.txt'), 'mexido\n');
  const sujo = wt.atualizar(RAIZ);
  checar('com alteracao sem commit, atualizar RECUSA e diz por que',
    sujo.ok === false && /alterado/.test(sujo.texto), JSON.stringify(sujo));
  git(RAIZ, 'checkout', '-q', '--', 'leiame.txt');

  const subiu = wt.atualizar(RAIZ);
  checar('com a arvore limpa, o fast-forward acontece',
    subiu.ok === true && subiu.avancou === 1, JSON.stringify(subiu));
  checar('e depois nao ha mais atraso', wt.situacaoRemoto(RAIZ).atras === 0, '');
  checar('o arquivo do servidor chegou ao disco',
    fs.existsSync(path.join(RAIZ, 'do-servidor.txt')), '');

  // Historias divergentes: `--ff-only` tem de RECUSAR em vez de criar merge.
  fs.writeFileSync(path.join(CLONE, 'lado-b.txt'), 'b\n');
  git(CLONE, 'add', '--', 'lado-b.txt');
  git(CLONE, 'commit', '-qm', 'lado b');
  git(CLONE, 'push', '-q');
  // `add` do ARQUIVO, e nunca `add -A` aqui: os worktrees deste teste vivem em
  // `.claude/worktrees/` DENTRO do repo, e cada um tem um `.git` -- o `-A`
  // adiciona a pasta como gitlink e deixa a arvore permanentemente "modificada".
  fs.writeFileSync(path.join(RAIZ, 'lado-a.txt'), 'a\n');
  git(RAIZ, 'add', '--', 'lado-a.txt');
  git(RAIZ, 'commit', '-qm', 'lado a');
  await wt.buscar(RAIZ);

  // A checagem e sobre DIVERGENCIA, entao a arvore tem de estar limpa aqui --
  // senao a recusa medida seria a de arquivo alterado, que ja foi testada acima.
  const restou = git(RAIZ, 'status', '--porcelain', '--untracked-files=no').trim();
  checar('a arvore esta limpa antes de medir a divergencia', restou === '', restou);

  const divergiu = wt.atualizar(RAIZ);
  checar('divergiu: recusa em vez de criar merge ou conflito',
    divergiu.ok === false && /divergiram/i.test(divergiu.texto), JSON.stringify(divergiu));
  checar('e a recusa cabe numa linha, sem as cinco dicas do git',
    divergiu.texto.split('\n').length === 1 && divergiu.texto.length < 160, divergiu.texto);
  checar('e o commit local continua intacto',
    git(RAIZ, 'log', '--oneline', '-1').includes('lado a'), '');

  // Sem upstream nao ha o que comparar, e isso e estado normal.
  git(RAIZ, 'checkout', '-q', '-b', 'sem-upstream');
  const solto = wt.situacaoRemoto(RAIZ);
  checar('branch sem upstream nao vira erro nem atraso',
    solto.upstream === '' && solto.atras === 0, JSON.stringify(solto));
  git(RAIZ, 'checkout', '-q', 'main');

  fs.rmSync(REMOTO, { recursive: true, force: true });
  fs.rmSync(CLONE, { recursive: true, force: true });

  // Limpeza: o repo e descartavel, mas worktree deixa metadado no git.
  fs.rmSync(RAIZ, { recursive: true, force: true });

  console.log(falhas === 0 ? '\nWORKTREES_OK' : `\nWORKTREES_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
