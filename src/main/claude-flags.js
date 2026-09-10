'use strict';

// O CLI ainda aceita `--prefill-b64`?
//
// POR QUE ISTO EXISTE. O primeiro prompt de uma sessao aberta pelo Pronix Flow
// vai como `claude --deep-link-origin --prefill-b64 <b64url>`, e essas opcoes
// sao INTERNAS do CLI: elas nao aparecem no `--help` (`hideHelp()`). Isso por si
// so nao seria novidade -- o `claude-dados.js` ja depende do layout interno de
// `~/.claude`, e a regra da casa e "se mudar, degrada sem quebrar".
//
// So que aqui NAO DEGRADA. MEDIDO: `claude --zzz-not-real` responde
// `error: unknown option '--zzz-not-real'` e SAI. Sem esta sonda, o dia em que a
// flag sumisse todo painel aberto por deeplink abriria um shell morto -- e como
// o `index.js` marca todo painel novo como `rodando` e nenhum hook o corrige, a
// bolinha ficaria VERDE para sempre sobre um terminal que nunca subiu.
//
// O TRUQUE DA SONDA, medido contra o CLI 2.1.267: `--tmux` no Windows falha
// DEPOIS do parse dos argumentos, entao a mensagem separa os dois casos:
//
//   claude --prefill-b64 aGk --deep-link-origin --tmux
//     -> "Error: --tmux requires --worktree"        a flag existe
//     -> "error: unknown option '--prefill-b64'"    a flag sumiu
//
// ~200ms, uma vez por execucao do app, sem subir sessao, sem rede e sem token.
// Nao e relogio: o orcamento de CPU parado deste app ja esta apertado, e o
// CLAUDE.md tem a historia de um poller de 2s que sozinho custou 0,25pp.

const { execFile } = require('child_process');

const MS_SONDA = 8_000;

// Memoizado por execucao: a resposta nao muda enquanto o app vive, e uma
// atualizacao do CLI no meio do expediente e caso para reabrir o app.
let promessa = null;

function binario() {
  // Irma do `ORQ_CLAUDE` e do `ORQ_DADOS`: e o que deixa o teste apontar para um
  // script de mentira sem tocar no CLI real.
  return process.env.ORQ_CLAUDE_BIN || 'claude';
}

function sondar() {
  return new Promise((resolve) => {
    execFile(
      binario(),
      ['--prefill-b64', 'aGk', '--deep-link-origin', '--tmux'],
      { encoding: 'utf8', windowsHide: true, timeout: MS_SONDA },
      (err, saida, erro) => {
        const texto = `${saida || ''}${erro || ''}${(err && err.message) || ''}`;
        // ENOENT: o CLI nao esta no PATH. Nao e "a flag sumiu" -- e "nao da para
        // saber" --, mas o resultado pratico e o mesmo: nao arriscar o prefill.
        if (err && err.code === 'ENOENT') { resolve(false); return; }
        if (/unknown option/i.test(texto)) { resolve(false); return; }
        // O parse passou. A mensagem do `--tmux` e a confirmacao positiva; se o
        // CLI um dia parar de recusar o `--tmux` no Windows, a ausencia de
        // "unknown option" continua sendo a resposta certa.
        resolve(true);
      },
    );
  });
}

function suportaPrefill() {
  if (!promessa) {
    promessa = sondar().catch((err) => {
      console.error('[claude-flags] sonda falhou:', (err && err.message) || err);
      return false;
    });
  }
  return promessa;
}

// So para o teste: esquece a resposta memoizada.
function esquecer() {
  promessa = null;
}

module.exports = { suportaPrefill, esquecer, MS_SONDA };
