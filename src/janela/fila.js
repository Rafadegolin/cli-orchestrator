'use strict';

// Fila de partida: teto de sessoes iniciando ao mesmo tempo.
//
// Seis Claude Code partindo juntos saturam a maquina, e ai tudo fica lento --
// inclusive este app, que leva a culpa. O que o app NAO consegue e pausar uma
// sessao em andamento; o que ele consegue e espacar as partidas.
//
// Mora na janela porque os dois insumos ja estao aqui: o status de cada sessao
// (OrqLateral.cards, alimentado pelos diffs dos hooks) e o comandoInicial.

const TETO_RODANDO = 4;

// Nenhuma retencao pode ser eterna. Uma sessao que fica verde a tarde toda nao
// pode bloquear as outras para sempre, entao existe um limite de paciencia.
const MS_ESPERA_MAXIMA = 60_000;

// Uma sessao recem-partida so vira 'rodando' quando o hook reporta, o que leva
// cerca de um segundo. Sem contabilizar esse intervalo, liberar UMA vaga
// esvaziava a fila inteira: a cada volta do laco a conta ainda dizia que havia
// espaco, e todos partiam juntos -- exatamente a rajada que o teto existe para
// evitar.
const partindo = new Map(); // id -> instante da partida

// Quanto tempo uma partida segura a vaga sem confirmacao do hook. Com hooks
// instalados o normal e menos de 1s, e este prazo nunca e alcancado. SEM hooks
// nenhuma sessao reporta 'rodando' nunca, e ai este prazo vira o proprio
// espacamento entre partidas -- que e o objetivo original de qualquer forma.
const MS_GRACA_PARTIDA = 8_000;

const fila = [];

function contarRodando() {
  const cards = window.OrqLateral?.cards;
  if (!cards) return 0;
  let n = 0;
  for (const c of cards.values()) if (c.status === 'rodando') n += 1;
  return n;
}

function limparPartindo() {
  const cards = window.OrqLateral?.cards;
  const agora = Date.now();
  for (const [id, quando] of partindo) {
    // Ja reportou: a partir daqui quem conta e o contarRodando(), senao seria
    // contado duas vezes.
    if (cards?.get(id)?.status === 'rodando') { partindo.delete(id); continue; }
    if (agora - quando > MS_GRACA_PARTIDA) partindo.delete(id);
  }
}

function ocupadas() {
  limparPartindo();
  return contarRodando() + partindo.size;
}

function haVaga() {
  return ocupadas() < TETO_RODANDO;
}

// Se os hooks nao estiverem instalados, nenhuma sessao reporta 'rodando', a
// conta da zero e a fila simplesmente nunca entra em acao. E a degradacao certa:
// melhor nao estrangular do que estrangular por engano.
function pedirVaga(id, executar) {
  if (haVaga()) {
    partindo.set(id, Date.now());
    executar();
    return { enfileirado: false };
  }

  const item = { id, executar, desde: Date.now(), timer: null };
  item.timer = setTimeout(() => liberarItem(item, 'tempo'), MS_ESPERA_MAXIMA);
  fila.push(item);

  window.OrqPainel?.painelPorId.get(id)?.definirFila(posicao(id), () => liberarItem(item, 'clique'));
  return { enfileirado: true, posicao: posicao(id) };
}

function posicao(id) {
  return fila.findIndex((x) => x.id === id) + 1;
}

function liberarItem(item, motivo) {
  const i = fila.indexOf(item);
  if (i === -1) return false;
  fila.splice(i, 1);
  clearTimeout(item.timer);

  // Executa SEMPRE. Condicionar a existir o objeto do painel era errado: quem
  // cancela e o remover(), chamado quando o painel e fechado. Com a checagem
  // aqui, qualquer painel ausente fazia o comando ser descartado em silencio --
  // a sessao simplesmente nunca comecava e nada explicava o porque.
  window.OrqPainel?.painelPorId.get(item.id)?.definirFila(0);
  partindo.set(item.id, Date.now());
  item.executar(motivo);

  redesenharPosicoes();
  return true;
}

function redesenharPosicoes() {
  fila.forEach((item, i) => {
    window.OrqPainel?.painelPorId.get(item.id)?.definirFila(i + 1, () => liberarItem(item, 'clique'));
  });
}

// Chamado quando o status de qualquer sessao muda: se abriu vaga, o proximo
// parte.
function reavaliar() {
  while (fila.length && haVaga()) {
    if (!liberarItem(fila[0], 'vaga')) break;
  }
}

// Painel fechado antes de partir sai da fila sem executar nada.
function remover(id) {
  const item = fila.find((x) => x.id === id);
  if (!item) return;
  fila.splice(fila.indexOf(item), 1);
  clearTimeout(item.timer);
  redesenharPosicoes();
}

window.OrqFila = {
  TETO_RODANDO,
  MS_ESPERA_MAXIMA,
  MS_GRACA_PARTIDA,
  pedirVaga,
  reavaliar,
  remover,
  contarRodando,
  ocupadas,
  haVaga,
  tamanho: () => fila.length,
  emEspera: () => fila.map((x) => x.id),
  // Para os testes conseguirem simular o hook confirmando a partida.
  esquecerPartida: (id) => partindo.delete(id),
};
