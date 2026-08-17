'use strict';

// Tema, densidade da grade e ordenacao -- as escolhas que o usuario faz uma vez
// e espera encontrar do jeito que deixou.
//
// Arquivo separado do sessao.json de proposito: o arranjo de painéis muda o
// tempo todo e e regravado com debounce; preferencia muda por clique e e rara.
// Juntar os dois faria toda troca de tema reescrever a lista de painéis.

const arquivo = require('./arquivo');

const NOME = 'ui.json';
const VERSAO = 1;

// O molde da densidade personalizada: quantas colunas, quanto vale uma linha da
// grade, e o tamanho de cada POSICAO em celulas. `c` e span de colunas, `r` e
// span de linhas. Posicao sem entrada vale 1x1.
//
// A chave e a POSICAO, e nao a sessao: um molde e o formato da tela ("o da
// esquerda e grande"), nao um tamanho preso a uma feature que voce vai fechar
// amanha.
const MOLDE_PADRAO = {
  cols: 3,
  alturaLinha: 160,
  celulas: [{ c: 1, r: 2 }, { c: 1, r: 2 }, { c: 1, r: 1 }, { c: 1, r: 1 }],
};

const MAX_CELULAS = 40;
const MAX_LINHAS = 4;

const PADRAO = {
  tema: 'escuro',
  densidade: 2,
  ordem: 'urgencia',
  lateral: 'aberta',
  uso: 'barras',
  avisos: 'ligados',
  personalizado: MOLDE_PADRAO,
};

const limitar = (n, min, max, reserva) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : reserva;
};

function normalizarMolde(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const cols = limitar(b.cols, 1, 6, MOLDE_PADRAO.cols);
  const celulas = (Array.isArray(b.celulas) ? b.celulas : MOLDE_PADRAO.celulas)
    .slice(0, MAX_CELULAS)
    .map((c) => ({
      c: limitar(c && c.c, 1, cols, 1),
      r: limitar(c && c.r, 1, MAX_LINHAS, 1),
    }));
  return { cols, alturaLinha: limitar(b.alturaLinha, 90, 400, MOLDE_PADRAO.alturaLinha), celulas };
}

// Valor de arquivo nunca entra cru: um ui.json editado a mao com densidade 9
// quebraria o layout sem nenhuma mensagem que explicasse por que.
function normalizar(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  return {
    tema: b.tema === 'claro' ? 'claro' : 'escuro',
    // A quarta densidade nao e um numero: e o slot personalizado, onde a altura
    // vem de span de linhas em vez de um valor fixo por painel.
    densidade: b.densidade === 'p'
      ? 'p'
      : ([1, 2, 3].includes(Number(b.densidade)) ? Number(b.densidade) : PADRAO.densidade),
    ordem: b.ordem === 'projeto' ? 'projeto' : 'urgencia',
    // A lateral recolhida. O padrao e ABERTA: ela e onde ficam a fila de
    // atencao e o aviso de versao nova, e um app que nasce escondendo isso
    // parece quebrado para quem abre pela primeira vez.
    lateral: b.lateral === 'fechada' ? 'fechada' : 'aberta',
    // O medidor de uso do topo. O padrao e MOSTRAR: ele responde "posso
    // continuar?", e um app que esconde isso por padrao devolve a pergunta para
    // dentro do terminal, que e de onde ela veio.
    uso: b.uso === 'oculto' ? 'oculto' : 'barras',
    // A notificacao do sistema quando uma sessao para esperando. O padrao e
    // LIGADO: o app existe justamente para voce nao ficar olhando a tela, e
    // nascer calado seria deixar de fazer o que ele promete.
    //
    // Desligar cobre o toast E o piscar da barra de tarefas. Quem desliga esta
    // dizendo "nao me interrompa", e meia interrupcao pareceria a preferencia
    // nao funcionar.
    avisos: b.avisos === 'desligados' ? 'desligados' : 'ligados',
    personalizado: normalizarMolde(b.personalizado),
  };
}

// A decisao em UMA funcao, e do lado do processo principal.
//
// O portao NAO pode ficar no renderer: `lateral.js` guarda `jaAvisado` para
// avisar uma vez por episodio, e o lembrete de 5min exige `jaAvisado.has(id)`.
// Desistir antes de marcar deixaria a sessao sem lembrete para sempre, mesmo
// depois de religar; desistir depois queimaria o slot sem ter avisado. Aqui a
// contabilidade la continua correta e so o efeito e suprimido.
function avisosLigados(ui) {
  return (ui || carregar()).avisos !== 'desligados';
}

function carregar() {
  return normalizar(arquivo.lerJson(NOME, {}).ui);
}

function salvar(parcial) {
  const atual = carregar();
  const novo = normalizar({ ...atual, ...(parcial || {}) });
  arquivo.gravarJson(NOME, { versao: VERSAO, ui: novo });
  return novo;
}

module.exports = {
  carregar, salvar, normalizar, avisosLigados, PADRAO, MOLDE_PADRAO, NOME,
};
