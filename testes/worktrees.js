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

  // Limpeza: o repo e descartavel, mas worktree deixa metadado no git.
  fs.rmSync(RAIZ, { recursive: true, force: true });

  console.log(falhas === 0 ? '\nWORKTREES_OK' : `\nWORKTREES_FALHOU (${falhas})`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
