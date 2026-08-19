'use strict';

// Sobe o app com a porta de depuracao aberta, para os testes poderem dirigi-lo.
// E a porta de entrada de toda a suite: `npm run dev`.
//
// NO WINDOWS ELE DELEGA PARA O `subir.ps1` DE SEMPRE, sem reimplementar nada.
// Aquele script e o que produziu todos os numeros medidos deste projeto (CPU
// parado, RAM por painel, latencia de tecla), e reescreve-lo em Node so para
// unificar seria trocar uma coisa que funciona por uma que ainda precisa ser
// provada -- num lugar onde a prova e justamente o que esta em jogo.
//
// Fora do Windows ele faz o mesmo trabalho com as ferramentas de la: `ps` no
// lugar do WMI, `spawn` no lugar do Start-Process. As duas esperas continuam
// sendo as mesmas, e sao elas que importam: a porta de depuracao (9222) e o
// servidor de eventos (47615). Devolver o controle antes da segunda faz toda
// suite que depende de hook falhar de um jeito que nao parece a causa.

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const UDATA = path.join(RAIZ, '.dev-udata');
const PORTA_CDP = 9222;
const PORTA_EVENTOS = 47615;

// --------------------------------------------------------------- Windows

if (process.platform === 'win32') {
  const r = spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'subir.ps1'),
  ], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

// ----------------------------------------------------------------- POSIX

const exe = path.join(RAIZ, 'node_modules', 'electron', 'dist',
  process.platform === 'darwin'
    ? path.join('Electron.app', 'Contents', 'MacOS', 'Electron')
    : 'electron');

if (!fs.existsSync(exe)) {
  console.error('Electron nao instalado. Rode: npm install && npx install-electron');
  process.exit(1);
}

function portaAberta(porta) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: porta });
    const fim = (v) => { s.destroy(); resolve(v); };
    s.once('connect', () => fim(true));
    s.once('error', () => fim(false));
    s.setTimeout(700, () => fim(false));
  });
}

async function esperarPorta(porta, querAberta, segundos) {
  const limite = Date.now() + segundos * 1000;
  while (Date.now() < limite) {
    if (await portaAberta(porta) === querAberta) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// Mata so as instancias DESTE projeto, filtradas pelo user-data-dir proprio --
// nunca outro app Electron da maquina. O `-ax -o pid=,command=` e o formato
// portatil entre macOS e Linux; `pgrep -f` nao existe em toda instalacao.
function matarAntigas() {
  let saida = '';
  try {
    saida = execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' });
  } catch {
    return;
  }
  for (const linha of saida.split('\n')) {
    if (!linha.includes('.dev-udata')) continue;
    const pid = Number(linha.trim().split(/\s+/)[0]);
    // Nunca a si mesmo: a marca aparece na linha de comando deste processo
    // tambem, e essa e a forma classica de um script de medicao se matar.
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    try { process.kill(pid, 'SIGKILL'); } catch { /* ja morreu */ }
  }
}

// O `spawn-helper` do node-pty vem do npm sem bit de execucao, e sem ele o
// `pty.spawn` falha com EACCES -- a janela sobe e nenhum painel funciona. Aqui
// e o caminho de quem roda do codigo-fonte; os outros dois (empacotar local e
// CI) chamam o mesmo script.
require('../recursos/preparar-mac').preparar();

(async () => {
  matarAntigas();

  // Espera a instancia velha SOLTAR a porta de eventos, em vez de dormir um
  // tanto fixo. Subir com a 47615 ainda presa faz o app abrir sem servidor de
  // eventos, e ai as bolinhas nunca mudam.
  if (!await esperarPorta(PORTA_EVENTOS, false, 10)) {
    console.error('a porta 47615 continua ocupada -- algum outro programa a segura');
    process.exit(1);
  }

  fs.mkdirSync(UDATA, { recursive: true });
  const log = path.join(UDATA, 'app.log');

  // Os testes cadastram e removem projetos. Sem isto eles mexeriam no
  // ~/.orquestrador/projetos.json de verdade -- a lista do usuario.
  const dados = path.join(UDATA, 'dados');
  fs.mkdirSync(dados, { recursive: true });

  const saida = fs.openSync(log, 'a');
  const erro = fs.openSync(`${log}.err`, 'a');
  const p = spawn(exe, [RAIZ, `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${UDATA}`], {
    env: { ...process.env, ORQ_DADOS: dados },
    stdio: ['ignore', saida, erro],
    detached: true,
  });
  p.unref();

  if (!await esperarPorta(PORTA_CDP, true, 25)) {
    console.error(`o app subiu mas nao abriu a porta de depuracao -- veja ${log}.err`);
    process.exit(1);
  }
  if (!await esperarPorta(PORTA_EVENTOS, true, 15)) {
    console.error('o app subiu sem servidor de eventos na 47615 -- os testes de hook falhariam sem motivo aparente');
    process.exit(1);
  }

  console.log(`PID=${p.pid}  log=${log}`);
})();
