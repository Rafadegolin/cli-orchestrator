'use strict';
// O que muda de sistema operacional, num lugar so.
//
// Este app nasceu Windows-only, e o acoplamento nunca foi difuso: eram quatro
// `process.platform` no `src/` inteiro. Este modulo concentra as respostas para
// que elas nao voltem a se espalhar -- e fica SEM `require('electron')` de
// proposito, como o `worktrees.js`, para poder ser testado em Node puro.

const { execFileSync } = require('child_process');

const EH_WIN = process.platform === 'win32';
const EH_MAC = process.platform === 'darwin';

// O shell de cada plataforma. O `cmd.exe` abre em dezenas de ms contra centenas
// do PowerShell, e e o que segura a meta de 1,5s ate o primeiro terminal.
function shellPadrao() {
  return EH_WIN
    ? (process.env.ComSpec || 'cmd.exe')
    : (process.env.SHELL || '/bin/zsh');
}

// Fora do Windows o shell sobe como LOGIN shell.
//
// Sem o `-l` ele nao le `.zprofile`/`.bash_profile`, e o PATH de dentro do
// painel fica sendo o PATH que o Electron herdou -- que, quando o app e aberto
// pelo Finder, e um PATH minimo do launchd sem homebrew, sem nvm e sem o
// `claude`. O sintoma seria "funciona quando abro pelo terminal e nao funciona
// quando abro pelo icone", que e o pior tipo de defeito para diagnosticar.
function argsDoShell() {
  return EH_WIN ? [] : ['-l'];
}

// A metade que o `-l` NAO resolve: o proprio processo principal chama `git`
// direto (`worktrees.js`), e ele nao passa por shell nenhum. Aberto pelo
// Finder, isso falha com ENOENT em todo comando de worktree.
//
// A marca existe porque shell interativo cospe MOTD, banner de versao e o que
// mais o usuario tiver no rc -- ler a saida inteira como se fosse o PATH
// entregaria lixo. Tudo em try/catch: falhar aqui nao pode derrubar o arranque,
// e o pior caso e continuar com o PATH que ja tinhamos.
const MARCA_PATH = '__ORQ_PATH__';

function pathDoLogin() {
  const saida = execFileSync(shellPadrao(), ['-ilc', `echo "${MARCA_PATH}$PATH"`], {
    encoding: 'utf8',
    timeout: 4000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const linha = saida.split('\n').find((l) => l.includes(MARCA_PATH));
  return linha ? linha.slice(linha.indexOf(MARCA_PATH) + MARCA_PATH.length).trim() : '';
}

// Homebrew (arm64 e Intel) como rede: sao os dois lugares de onde o `git` e o
// `claude` costumam vir, e um rc quebrado nao pode custar o app inteiro.
const CAMINHOS_RESERVA = ['/opt/homebrew/bin', '/usr/local/bin'];

function corrigirPath() {
  if (EH_WIN) return process.env.PATH;

  const atual = String(process.env.PATH || '');
  const partes = [];
  try {
    partes.push(...pathDoLogin().split(':'));
  } catch {
    // Sem PATH do login seguimos com o herdado mais a reserva.
  }
  partes.push(...CAMINHOS_RESERVA, ...atual.split(':'));

  const vistos = new Set();
  const novo = partes
    .map((p) => p.trim())
    .filter((p) => p && !vistos.has(p) && vistos.add(p))
    .join(':');

  process.env.PATH = novo;
  return novo;
}

module.exports = { EH_WIN, EH_MAC, shellPadrao, argsDoShell, corrigirPath };
