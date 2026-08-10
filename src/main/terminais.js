'use strict';

// Cria, mata e alimenta os PTYs. Este modulo e o unico lugar do app que faz
// require do node-pty -- se um dia for preciso trocar por outra distribuicao
// (@lydell/node-pty, por exemplo), muda-se so a linha abaixo.
const pty = require('node-pty');
const { spawn } = require('child_process');

const NOME_TERM = 'xterm-256color';

// Um envio por quadro de video. Mandar cada pedaco na hora que chega custa
// centenas de eventos de IPC por segundo com um processo cuspindo log.
const MS_POR_QUADRO = 16;

// Teto de bytes acumulados por painel entre dois envios. Acima disso o inicio
// da fila e descartado: ninguem le 40.000 linhas passando voando, e o que o
// usuario quer ver e sempre o fim.
//
// 64 KB por quadro sao ~4 MB/s por painel, ou umas nove telas cheias a cada
// 16ms -- ordens de grandeza acima de qualquer leitura humana e invisivel no
// uso normal, onde a fila nunca chega perto disso. Sob enxurrada e o que
// segura a meta de CPU: o custo aqui e parsear e desenhar byte, entao o teto
// por quadro E o acelerador. Com 512 KB (~30 MB/s) a CPU passava de 25%.
const TETO_FILA_BYTES = 64 * 1024;

// Marcadores que o proprio Claude Code injeta no ambiente para dizer "voce
// esta DENTRO de uma sessao". Se o orquestrador for aberto de dentro de uma
// sessao (acontece o tempo todo em desenvolvimento), eles vazam pelo env
// herdado e cada painel nasce se achando sessao-filha daquela -- o sintoma
// visivel e "Transcript saving is off - inherited CLAUDE_CODE_CHILD_SESSION".
//
// Os painéis tem de hospedar sessoes de primeira classe, entao a identidade da
// sessao-pai e removida. Configuracao do usuario (ANTHROPIC_*, CLAUDE_EFFORT)
// nao e tocada.
const ENV_SESSAO_PAI = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_PID',
];

function envLimpo() {
  const e = { ...process.env };
  for (const chave of ENV_SESSAO_PAI) delete e[chave];
  return e;
}

const terminais = new Map();

let janela = null;
let agendado = null;

function definirJanela(j) {
  janela = j;
}

function janelaViva() {
  return janela && !janela.isDestroyed() && janela.webContents && !janela.webContents.isDestroyed();
}

function abrir({ id, cwd, comando, args = [], cols = 80, rows = 24, env = {} }) {
  if (terminais.has(id)) throw new Error(`terminal ja existe: ${id}`);

  const proc = pty.spawn(comando, args, {
    name: NOME_TERM,
    cols,
    rows,
    cwd,
    // encoding null faz o onData entregar Buffer em vez de string. Decodificar
    // aqui, serializar como string no IPC e re-decodificar na janela seria
    // trabalho triplicado -- o xterm.js tem rota otimizada para bytes.
    encoding: null,
    // ConPTY do proprio Windows, nao a conpty.dll empacotada no node-pty.
    // Medido com 4 painéis cuspindo log: a dll empacotada custa 26,7% de CPU
    // no processo principal contra 13,5% da do sistema -- o dobro, e e ela que
    // decide a meta de CPU sob carga (o renderer fica em ~1% nos dois casos).
    //
    // O preco e que o kill() do node-pty forka um conpty_console_list_agent
    // que chama AttachConsole, estoura, e a limpeza dos processos-neto se
    // perde. Por isso `fechar()` mata a arvore por conta propria -- ver la.
    useConptyDll: false,
    env: { ...envLimpo(), ...env, ORQ_ID: id },
  });

  const t = { proc, cwd, chunks: [], bytes: 0, vivo: true };
  terminais.set(id, t);

  proc.onData((dados) => enfileirar(id, dados));
  proc.onExit(({ exitCode, signal }) => {
    t.vivo = false;
    descarregar(); // nao deixa o ultimo pedaco de saida preso na fila
    if (janelaViva()) janela.webContents.send('terminal:fim', { id, exitCode, signal });
    terminais.delete(id);
  });

  return { id, pid: proc.pid };
}

function enfileirar(id, dados) {
  const t = terminais.get(id);
  if (!t) return;

  const buf = Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados), 'utf8');
  t.chunks.push(buf);
  t.bytes += buf.length;

  // Corta por bytes, nao por numero de chunks: o tamanho do chunk varia muito
  // e um teto de "400 pedacos" nao diz nada sobre memoria. Descarta chunks
  // inteiros do inicio para nao partir sequencia UTF-8 no meio.
  while (t.bytes > TETO_FILA_BYTES && t.chunks.length > 1) {
    t.bytes -= t.chunks.shift().length;
  }

  agendar();
}

function agendar() {
  if (agendado !== null) return;
  agendado = setTimeout(() => {
    agendado = null;
    descarregar();
  }, MS_POR_QUADRO);
}

function descarregar() {
  if (!janelaViva()) return;

  const lote = [];
  for (const [id, t] of terminais) {
    if (!t.bytes) continue;

    // Aloca exato e copia. Buffer.concat pode devolver uma view de um pool de
    // 8 KB, e o structured clone do IPC serializa o ArrayBuffer inteiro --
    // mandaria lixo de outros painéis junto.
    const bytes = new Uint8Array(t.bytes);
    let off = 0;
    for (const c of t.chunks) {
      bytes.set(c, off);
      off += c.length;
    }
    t.chunks.length = 0;
    t.bytes = 0;

    lote.push({ id, bytes });
  }

  if (lote.length) janela.webContents.send('terminal:dados', lote);
}

function escrever(id, texto) {
  const t = terminais.get(id);
  if (t && t.vivo) t.proc.write(texto);
}

function redimensionar(id, cols, rows) {
  const t = terminais.get(id);
  if (!t || !t.vivo) return;
  if (cols > 0 && rows > 0) {
    try {
      t.proc.resize(cols, rows);
    } catch {
      // o processo pode ter morrido entre o check e o resize
    }
  }
}

// Mata o processo e TODA a descendencia dele.
//
// Rede de seguranca, e assumidamente redundante na maioria dos casos: fechar o
// ConPTY ja derruba tudo que esta anexado ao console, e `testes/arvore.js`
// passa mesmo com esta funcao desligada. Ela existe porque o node-pty mantem
// uma limpeza extra da lista de processos do console -- justificada no codigo
// dele por servidores node que se DESTACAM do console e sobrevivem -- e essa
// limpeza depende de um agente auxiliar que estoura dentro do Electron com
// useConptyDll:false. Ou seja: o caminho de reserva do node-pty esta quebrado
// aqui, e este app existe justamente para rodar sessoes que sobem servidor.
// `taskkill /T` percorre a arvore pelo pai, sem depender do console.
function matarArvore(pid) {
  if (!pid) return;
  if (process.platform !== 'win32') {
    try { process.kill(-pid); } catch { /* ja morreu */ }
    return;
  }
  try {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch {
    // taskkill ausente: o kill do node-pty abaixo ainda derruba o shell
  }
}

function fechar(id) {
  const t = terminais.get(id);
  if (!t) return;
  t.vivo = false;
  matarArvore(t.proc.pid);
  try {
    t.proc.kill();
  } catch {
    // ja morreu
  }
  terminais.delete(id);
}

function fecharTodos() {
  for (const id of [...terminais.keys()]) fechar(id);
  if (agendado !== null) {
    clearTimeout(agendado);
    agendado = null;
  }
}

function cwdDe(id) {
  const t = terminais.get(id);
  return t ? t.cwd : null;
}

function idsAbertos() {
  return [...terminais.keys()];
}

module.exports = {
  definirJanela,
  abrir,
  escrever,
  redimensionar,
  fechar,
  fecharTodos,
  cwdDe,
  idsAbertos,
};
