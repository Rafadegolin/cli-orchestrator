'use strict';

// Monta e destroi painéis na grade. Sem biblioteca de layout: CSS Grid resolve.

// Sem desestruturar: painel.js e grade.js sao scripts classicos e dividem o
// mesmo escopo lexico global -- redeclarar `Painel` aqui e SyntaxError.
const OrqP = window.OrqPainel;
const porId = OrqP.painelPorId;

const elGrade = document.getElementById('grade');
const elVazio = document.getElementById('vazio');
const elNome = document.getElementById('nome-feature');
const btnNovo = document.getElementById('btn-novo');

let seq = 0;
let focado = null;

function novoId() {
  seq += 1;
  return `p${seq}-${Date.now().toString(36)}`;
}

function ajustarColunas() {
  const n = elGrade.childElementCount;
  const colunas = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  elGrade.style.setProperty('--colunas', String(colunas));
  elVazio.hidden = n > 0;
}

async function criarPainel({ cwd, feature, comandoInicial }) {
  const id = novoId();

  const painel = new OrqP.Painel({
    id,
    feature: feature || OrqP.nomeCurto(cwd),
    cwd,
    aoFocar: (pid) => { focado = pid; marcarFocado(); },
    aoFechar: () => { ajustarColunas(); window.OrqLateral?.remover(id); },
  });

  elGrade.append(painel.el);
  ajustarColunas();

  // O fit precisa do elemento ja no DOM e com tamanho para calcular cols/rows.
  painel.ajustar();

  // Registrar ANTES de abrir o terminal: o primeiro byte pode voltar do PTY
  // enquanto o await ainda esta pendente, e ai o gancho chegaria tarde.
  if (comandoInicial) {
    painel.aoPrimeiroDado(() => window.orq.escrever(id, `${comandoInicial}\r`));
  }

  try {
    window.OrqLateral?.registrar({ id, feature: painel.feature, cwd });
    const aberto = await window.orq.abrirTerminal({
      id,
      cwd,
      feature: painel.feature,
      cols: painel.term.cols,
      rows: painel.term.rows,
    });
    painel.definirPortas(aberto?.portas);
    painel.definirStatus('rodando', 'shell aberto');
  } catch (err) {
    painel.definirStatus('encerrada', String(err));
    painel.term.write(`\r\n\x1b[31mfalhou ao abrir: ${String(err)}\x1b[0m\r\n`);
    return painel;
  }

  painel.focar();
  return painel;
}

function marcarFocado() {
  for (const [id, p] of porId) {
    p.el.classList.toggle('painel-focado', id === focado);
  }
}

function focarPainel(id) {
  const p = porId.get(id);
  if (p) p.focar();
}

// ------------------------------------------------------------ eventos

btnNovo.addEventListener('click', async () => {
  const cwd = await window.orq.escolherPasta();
  if (!cwd) return;
  const feature = elNome.value.trim();
  elNome.value = '';
  await criarPainel({ cwd, feature });
});

elNome.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') btnNovo.click();
});

// Um unico ouvinte para todos os painéis: o lote chega com todos juntos.
window.orq.aoReceberDados((lote) => {
  for (const { id, bytes } of lote) {
    porId.get(id)?.escreverBytes(bytes);
  }
});

window.orq.aoTerminar(({ id, exitCode }) => {
  porId.get(id)?.marcarFim(exitCode);
  window.OrqLateral?.definirStatus(id, 'encerrada');
});

// A janela inteira mudou de tamanho: todos os painéis precisam refluir, cada
// um com seu proprio debounce.
window.addEventListener('resize', () => {
  for (const p of porId.values()) p.agendarAjuste();
});

window.OrqGrade = { criarPainel, focarPainel, painelPorId: porId };
