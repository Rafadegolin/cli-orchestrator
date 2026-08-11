'use strict';

// Uma faixa de portas por painel -- a "regra de ouro do isolamento" da spec.
//
// Isolar os arquivos em worktrees nao basta: duas features do mesmo projeto
// rodando `npm run dev` disputam a MESMA porta e a segunda nao sobe. O app
// reserva um bloco livre por painel e exporta no ambiente do PTY.

const net = require('net');

// Foge dos padroes conhecidos: 3000/3001 (Next) e 5173 (Vite). Assim a primeira
// porta entregue nao colide com um dev server que voce subiu fora do app.
const BASE = 3100;
const TETO = 3999;

// Cinco seguidas porque monorepo com `turbo run dev` sobe varios apps de uma vez
// e uma porta so recolocaria a colisao de volta.
const POR_PAINEL = 5;

// painel -> [portas]
const reservadas = new Map();

function emUso() {
  const usadas = new Set();
  for (const portas of reservadas.values()) for (const p of portas) usadas.add(p);
  return usadas;
}

// Livre de verdade: tenta escutar. Uma lista interna de "ja entreguei" nao sabe
// que um processo de fora esta segurando a porta -- e e justamente esse o caso
// que faz o dev server morrer com EADDRINUSE.
function livre(porta) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    // 127.0.0.1 e nao 0.0.0.0: e onde um dev server local escuta, e testar em
    // 0.0.0.0 daria falso negativo com porta ocupada so em outra interface.
    s.listen(porta, '127.0.0.1');
  });
}

async function blocoLivre(inicio, fim, usadas) {
  for (let base = inicio; base + POR_PAINEL - 1 <= fim; base++) {
    if (usadas.has(base)) continue;

    const bloco = [];
    for (let i = 0; i < POR_PAINEL; i++) {
      const p = base + i;
      if (usadas.has(p)) break;
      // eslint-disable-next-line no-await-in-loop
      if (!(await livre(p))) break;
      bloco.push(p);
    }
    if (bloco.length === POR_PAINEL) return bloco;
  }
  return null;
}

// `faixa` e o par [inicio, fim] do projeto dono da pasta; sem ela vale a faixa
// padrao. `emUso()` continua GLOBAL, entao duas faixas que se sobreponham por
// engano ainda nao entregam a mesma porta duas vezes.
async function reservar(id, faixa) {
  if (reservadas.has(id)) return reservadas.get(id);

  const [inicio, fim] = Array.isArray(faixa) && faixa.length === 2 ? faixa : [BASE, TETO];

  const bloco = await blocoLivre(inicio, fim, emUso());
  if (!bloco) {
    // Sem bloco livre o painel ainda abre: perder o terminal por causa de porta
    // seria pior que ficar sem a variavel.
    console.error(`[portas] nenhum bloco livre entre ${inicio} e ${fim}`);
    return [];
  }

  reservadas.set(id, bloco);
  return bloco;
}

function liberar(id) {
  reservadas.delete(id);
}

function de(id) {
  return reservadas.get(id) || [];
}

// As tres variaveis servem a publicos diferentes:
//   PORT        -- a convencao que Next, Nest e Express ja leem sozinhos
//   ORQ_PORTA   -- nome explicito, para quando PORT ja significar outra coisa
//   ORQ_PORTAS  -- o bloco inteiro, para o monorepo distribuir entre os apps
function comoEnv(portas) {
  if (!portas || !portas.length) return {};
  return {
    PORT: String(portas[0]),
    ORQ_PORTA: String(portas[0]),
    ORQ_PORTAS: portas.join(','),
  };
}

module.exports = { BASE, TETO, POR_PAINEL, reservar, liberar, de, comoEnv, livre };
