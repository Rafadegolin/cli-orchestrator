'use strict';
// O que muda de shell entre Windows e macOS, do lado da janela.
//
// A janela monta os comandos que vao para o PTY (`montarComando`, os
// `COMANDO_RETOMAR`, o `--add-dir` das ligacoes) e ate aqui nao sabia em que
// sistema estava. O `plataforma` vem do preload como VALOR, e nao por invoke:
// comando e montado no clique, e um await chegaria depois.
//
// Fica numa IIFE de proposito: `painel.js`, `grade.js` e `lateral.js` sao
// scripts classicos e dividem um escopo global -- ver o CLAUDE.md.

(() => {
  const PLATAFORMA = (window.orq && window.orq.plataforma) || 'win32';
  const EH_WIN = PLATAFORMA === 'win32';
  const EH_MAC = PLATAFORMA === 'darwin';

  // `cls` nao existe em bash/zsh, e o pior e que `cls && claude` CURTO-CIRCUITA:
  // o `cls` falha, o `&&` corta, e o Claude nunca sobe -- sem erro visivel alem
  // de "command not found". O `&&` em si funciona nos dois shells.
  const limpar = () => (EH_WIN ? 'cls' : 'clear');

  // Caminho como argumento de linha de comando. As aspas valem nos dois lados
  // ("C:\Program Files\..." ou "/Users/eu/Meus Projetos/..." sem elas viram
  // dois argumentos); a troca de barra e SO do Windows -- aplicada no macOS ela
  // produziria `"\Users\eu\repo"`, que nao existe.
  const citar = (caminho) => `"${EH_WIN ? String(caminho).replace(/\//g, '\\') : caminho}"`;

  // O modificador dos atalhos, para rotulo de tela. Ctrl no Windows, ⌘ no Mac.
  const MOD = EH_MAC ? '⌘' : 'Ctrl';
  const ALT = EH_MAC ? '⌥' : 'Alt';

  window.OrqShell = { PLATAFORMA, EH_WIN, EH_MAC, MOD, ALT, limpar, citar };
})();
