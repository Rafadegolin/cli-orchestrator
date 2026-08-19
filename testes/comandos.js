'use strict';

// Os comandos que os testes digitam DENTRO do painel, num shell so.
//
// O painel roda o shell nativo de cada sistema (`cmd.exe` no Windows, o seu
// shell de login fora dele), entao a carga de teste tambem muda: `for /L` e
// batch e nao existe em zsh, `%VAR%` nao expande la, e `start /b` nao tem
// equivalente direto.
//
// Ficam aqui e nao espalhados pelas suites porque sao a MESMA carga com duas
// escritas: quem for ler o teste quer ver "despeja 4000 linhas", e nao a
// sintaxe de batch.

const EH_WIN = process.platform === 'win32';

// Ecoa uma marca. Serve para provar que o shell respondeu.
const eco = (marca) => `echo ${marca}`;

// Despeja N linhas numeradas o mais rapido que o shell conseguir. E o que faz o
// lote de IPC e o corte de fila por bytes trabalharem de verdade.
function enchente(n, marca) {
  return EH_WIN
    ? `for /L %i in (1,1,${n}) do @echo ${marca}_%i`
    : `for i in $(seq 1 ${n}); do echo ${marca}_$i; done`;
}

// Le uma variavel de ambiente pela sintaxe do shell da vez.
const variavel = (nome) => (EH_WIN ? `%${nome}%` : `$${nome}`);

// Um processo filho que fica vivo e SOLTO do console, para provar que fechar o
// painel derruba a arvore inteira -- e nao so o shell.
//
// No Windows as aspas vazias do `start` sao obrigatorias: sem elas ele consome
// o primeiro argumento entre aspas como titulo da janela. Fora do Windows o
// `&` ja destaca, e o `ping` continua sendo o mesmo processo facil de contar.
const filhoLongo = () => (EH_WIN
  ? 'start "" /b ping -t 127.0.0.1'
  : 'ping 127.0.0.1 > /dev/null 2>&1 &');

// O shell POSIX usado para RODAR os hooks nos testes (nao dentro do painel).
// No Windows ele vem do Git; fora dele e nativo.
function acharSh() {
  if (!EH_WIN) return '/bin/sh';

  const fs = require('fs');
  const { spawnSync } = require('child_process');
  const candidatos = [
    'C:/Program Files/Git/usr/bin/sh.exe',
    'C:/Program Files/Git/bin/sh.exe',
    'C:/Program Files (x86)/Git/usr/bin/sh.exe',
  ];
  for (const c of candidatos) if (fs.existsSync(c)) return c;
  const r = spawnSync('where', ['sh'], { encoding: 'utf8' });
  const achado = (r.stdout || '').split(/\r?\n/).find((l) => l.trim().endsWith('.exe'));
  if (achado) return achado.trim();
  throw new Error('nao achei um shell POSIX (sh.exe). Instale o Git for Windows.');
}

module.exports = { EH_WIN, eco, enchente, variavel, filhoLongo, acharSh };
