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

// A origem do Pronix Flow em producao. Loopback nao precisa entrar na lista --
// ele passa por hostname, ver `origemPermitida`.
const ORIGEM_FLOW = 'https://flow.pronixhub.com.br';
const MAX_ORIGENS = 20;

const PADRAO = {
  tema: 'escuro',
  densidade: 2,
  ordem: 'urgencia',
  lateral: 'aberta',
  uso: 'barras',
  avisos: 'ligados',
  // As rotas /ping e /abrir, que e por onde o Pronix Flow pede uma sessao.
  externo: 'ligado',
  origens: [ORIGEM_FLOW],
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
    // O interruptor da superficie externa. Par `ligado/desligado`, como `avisos`
    // -- o projeto padroniza pares, e um meio-termo obrigaria a explicar na
    // ajuda dois canais que a pessoa nem sabe que existem.
    externo: b.externo === 'desligado' ? 'desligado' : 'ligado',
    // A LISTA DE ORIGENS, e a UNICA chave deste arquivo em que `[]` NAO cai no
    // padrao.
    //
    // Em todas as outras, valor torto vira padrao (a densidade 9 do comentario
    // la em cima). Aqui `[]` e uma escolha legitima -- "nenhum site, so loopback
    // e o curl" -- e devolver a lista padrao para quem apagou a lista seria a
    // preferencia trabalhando contra quem a editou. Por isso o teste e
    // `Array.isArray`, e nao `.length`: ausente ou nao-array cai no padrao,
    // vazio fica vazio.
    origens: Array.isArray(b.origens) ? normalizarOrigens(b.origens) : [...PADRAO.origens],
    personalizado: normalizarMolde(b.personalizado),
  };
}

// ------------------------------------------------------------ origens

// `new URL(x).origin` ja descarta caminho, query e hash, normaliza a caixa do
// host e some com a porta padrao -- e por isso "https://Flow.PronixHub.com.br/"
// e "https://flow.pronixhub.com.br" nao viram duas entradas diferentes.
//
// Tres recusas que nao sao obvias:
//  - SEM ESQUEMA nao ha origem. `new URL('flow.pronixhub.com.br')` estoura, e
//    isso e o certo: o cabecalho `Origin` sempre traz esquema, entao uma entrada
//    sem ele nunca casaria com nada.
//  - `*` NAO E CURINGA E NAO ESTOURA. MEDIDO: `new URL('https://*.pronix.com')`
//    passa, com hostname literal '*.pronix.com'. Sem esta recusa, um curinga
//    escrito a mao no ui.json vira uma entrada que nao casa com nada e PARECE
//    ter funcionado -- e do outro lado, acreditar que "curinga funciona" abriria
//    a superficie para qualquer subdominio.
//  - `http:` so em loopback. Uma origem http publica na lista seria um canal que
//    qualquer rede no caminho reescreve.
function canonizarOrigem(bruto) {
  const texto = String(bruto || '').trim();
  if (!texto || texto.length > 200) return null;
  let u;
  try { u = new URL(texto); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.hostname.includes('*')) return null;
  if (u.protocol === 'http:' && !hostnameLocal(u.hostname)) return null;
  return u.origin;
}

// MEDIDO: `new URL('http://[::1]:5173').hostname` e '[::1]', COM colchetes.
// Escrito do jeito obvio (`=== '::1'`), o teste de loopback nunca dispara.
function hostnameLocal(h) {
  const n = String(h || '').toLowerCase();
  return n === '127.0.0.1' || n === 'localhost' || n === '[::1]';
}

function normalizarOrigens(bruto) {
  const vistas = new Set();
  const saida = [];
  for (const item of bruto.slice(0, MAX_ORIGENS)) {
    const o = canonizarOrigem(item);
    if (!o || vistas.has(o)) continue;
    vistas.add(o);
    saida.push(o);
  }
  return saida;
}

// A DECISAO EM UMA FUNCAO SO, do lado do processo principal -- o molde do
// `avisosLigados` logo abaixo. Ela existe para o `teste:preferencias` cobrar a
// politica em Node puro, sem app: handler de HTTP nao da para testar assim, e
// esta lista e a unica coisa entre o Pronix Flow e qualquer pagina da internet.
//
// `desligado` vem PRIMEIRO e vale para todos, loopback inclusive: o interruptor
// fecha a superficie, e um localhost que passasse por cima dele nao seria um
// interruptor.
//
// SEM `Origin` NAO HA NAVEGADOR (curl, os testes, outro programa desta maquina),
// e isso e ACEITO. A razao e desconfortavel: contra codigo local nao ha defesa
// possivel AQUI -- quem roda como voce ja pode editar o ~/.claude/settings.json
// e spawnar `claude`, entao inventar um segredo neste servidor so mudaria o
// arquivo de onde o atacante local o leria. O unico atacante que este servidor
// PODE recusar e uma pagina web, e ela sempre manda Origin num POST.
//
// Loopback e por HOSTNAME, e nao por origem inteira: o Flow em desenvolvimento
// roda em localhost:3100, e exigir a porta seria pedir que cada dev server fosse
// cadastrado a mao.
function origemPermitida(origem, ui) {
  const u = ui || carregar();
  if (u.externo === 'desligado') return false;
  if (!origem) return true;
  const o = canonizarOrigem(origem);
  // `Origin: null` (iframe com sandbox, `data:`, `file:`) cai aqui sozinho,
  // porque `new URL('null')` estoura. NAO abrir excecao para ele.
  if (!o) return false;
  try { return hostnameLocal(new URL(o).hostname) || u.origens.includes(o); } catch { return false; }
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
  origemPermitida, canonizarOrigem, ORIGEM_FLOW, MAX_ORIGENS,
};
