'use strict';

// Ligar uma sessao a outro repositorio.
//
// O caso que motivou: uma feature que atravessa repos -- backend num, frontend
// noutro. Ligados, cada lado enxerga o codigo do outro e para de reexplicar o
// contrato da API.
//
// Nao e metafora nossa: o Claude Code tem `--add-dir` como flag e `/add-dir`
// como comando de barra. O app so orquestra.
//
// TUDO ABAIXO FOI MEDIDO CONTRA O CLI 2.1.220, nao presumido:
//
//  1. Escrever "texto\r" de uma vez NAO envia nada para a TUI do Claude: o CR
//     vira quebra de linha e o texto fica parado na caixa de entrada. Tem de
//     digitar, esperar, e mandar o Enter separado -- e o que `enviarLinha` faz.
//     (Com o cmd.exe funciona de qualquer jeito; ele nao e TUI.)
//  2. `/add-dir` abre um prompt de confirmacao com tres opcoes. Sem responder,
//     a ligacao nao acontece.
//  3. Lancar a sessao com `--add-dir` NAO pede confirmacao nenhuma.

// A TUI precisa de um respiro entre o texto e o Enter, senao os dois chegam
// juntos e viram colagem -- que e exatamente o caso 1 acima.
const MS_ANTES_DO_ENTER = 700;

// Quanto esperar o prompt de confirmacao do /add-dir aparecer.
const MS_ESPERA_CONFIRMACAO = 12_000;

// Trecho do prompt de confirmacao. Ler bytes do terminal e algo que a spec
// proibe PARA STATUS -- e com razao, porque quebra a cada atualizacao. Aqui nao
// e status: e uma interacao pontual que a gente mesmo acabou de provocar, e o
// pior caso de errar e um Enter sobrando numa caixa vazia.
const MARCA_CONFIRMACAO = 'Add directory to workspace';

function painel(id) {
  return window.OrqPainel?.painelPorId.get(id);
}

function normalizar(p) {
  return String(p || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

// Digita e envia como dois atos. Retorna quando o Enter ja foi mandado.
async function enviarLinha(id, texto) {
  window.orq.escrever(id, texto);
  await new Promise((r) => setTimeout(r, MS_ANTES_DO_ENTER));
  window.orq.escrever(id, '\r');
}

// A leitura mora no Painel (`textoDoBuffer`), que e quem sabe se ha bytes
// pendentes por o painel estar fora da vista. Ler `term.buffer` daqui direto,
// como era antes, devolvia texto velho nesse caso -- e a confirmacao do
// /add-dir podia nunca ser encontrada.
async function esperarNoBuffer(id, trecho, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if ((painel(id)?.textoDoBuffer() || '').includes(trecho)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// Insere as flags logo depois de `claude`, unico ponto seguro: `cls && claude
// -w x` tem de virar `cls && claude --add-dir "..." -w x`, e nao terminar com a
// flag depois do argumento.
//
// Caminho SEMPRE entre aspas: "C:\Program Files\..." sem aspas quebraria a
// linha de comando em dois argumentos.
function comAddDir(comando, caminhos) {
  const lista = [...new Set((caminhos || []).filter(Boolean))];
  if (!comando || !lista.length) return comando;
  if (!/\bclaude\b/.test(comando)) return comando;

  const flags = lista.map((c) => `--add-dir "${c.replace(/\//g, '\\')}"`).join(' ');
  return comando.replace(/\bclaude\b/, `claude ${flags}`);
}

function ligacoesDe(id) {
  return painel(id)?.ligacoes || [];
}

function jaLigado(id, caminho) {
  return ligacoesDe(id).some((c) => normalizar(c) === normalizar(caminho));
}

// Painel aberto naquela pasta, se houver -- e quem recebe o espelho da ligacao.
function painelEm(caminho) {
  for (const p of window.OrqPainel?.painelPorId.values() || []) {
    if (normalizar(p.cwd) === normalizar(caminho)) return p;
  }
  return null;
}

// Aplica numa sessao que ja esta rodando. O comando e a resposta aparecem no
// terminal: nada acontece escondido do usuario.
async function aplicarEmSessaoViva(id, caminho) {
  const p = painel(id);
  if (!p || p.dormindo || p.encerrado) return { aplicado: false, motivo: 'sem sessao viva' };

  await enviarLinha(id, `/add-dir ${caminho}`);

  // O /add-dir pergunta antes de liberar o diretorio. Responder o Enter aceita
  // a opcao 1, "Yes, for this session" -- e nao a 2, "remember", que mudaria
  // estado alem desta sessao sem o usuario ter pedido isso.
  const perguntou = await esperarNoBuffer(id, MARCA_CONFIRMACAO, MS_ESPERA_CONFIRMACAO);
  if (perguntou) {
    await new Promise((r) => setTimeout(r, 800));
    window.orq.escrever(id, '\r');
  }
  return { aplicado: true, confirmou: perguntou };
}

// Ligacao e MUTUA quando os dois lados sao painéis: cada sessao enxerga o repo
// da outra. Quando o alvo e so um projeto cadastrado, nao ha sessao do outro
// lado para receber a contrapartida -- fica de ida, e a interface diz isso.
async function ligar(id, caminho, { aplicar = true } = {}) {
  const p = painel(id);
  if (!p || !caminho) return { ok: false };
  if (normalizar(p.cwd) === normalizar(caminho)) {
    return { ok: false, motivo: 'um painel nao se liga a si mesmo' };
  }

  const novo = !jaLigado(id, caminho);
  if (novo) {
    p.ligacoes = [...ligacoesDe(id), caminho];
    p.mostrarLigacoes?.();
    if (aplicar) await aplicarEmSessaoViva(id, caminho);
  }

  // Espelho: se ha painel do outro lado, ele passa a enxergar este.
  const outro = painelEm(caminho);
  let mutua = false;
  if (outro && !jaLigado(outro.id, p.cwd)) {
    outro.ligacoes = [...ligacoesDe(outro.id), p.cwd];
    outro.mostrarLigacoes?.();
    if (aplicar) await aplicarEmSessaoViva(outro.id, p.cwd);
    mutua = true;
  }

  window.OrqGrade?.salvarSessao?.();
  return { ok: true, novo, mutua: mutua || Boolean(outro) };
}

// Desligar tira dos dois lados. Nao ha como retirar um diretorio de uma sessao
// ja rodando -- o efeito completo so vale na proxima partida, e a interface
// avisa em vez de fingir que sumiu.
function desligar(id, caminho) {
  const p = painel(id);
  if (!p) return { ok: false };

  p.ligacoes = ligacoesDe(id).filter((c) => normalizar(c) !== normalizar(caminho));
  p.mostrarLigacoes?.();

  const outro = painelEm(caminho);
  if (outro) {
    outro.ligacoes = ligacoesDe(outro.id).filter((c) => normalizar(c) !== normalizar(p.cwd));
    outro.mostrarLigacoes?.();
  }

  window.OrqGrade?.salvarSessao?.();
  return { ok: true, precisaReiniciar: !p.dormindo };
}

window.OrqLigacoes = {
  MS_ANTES_DO_ENTER,
  MARCA_CONFIRMACAO,
  enviarLinha,
  comAddDir,
  ligar,
  desligar,
  ligacoesDe,
  jaLigado,
  painelEm,
  aplicarEmSessaoViva,
  normalizar,
};
