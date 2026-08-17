'use strict';

// Ficar em dia com o remoto: quem busca, quando, e quem avisa a tela.
//
// O caso que motivou o modulo e o mesmo do `worktrees.situacaoRemoto`: o merge
// acontece NO SERVIDOR enquanto a sessao trabalha isolada numa worktree, e o
// checkout principal envelhece sem nada avisar. So que a mecanica de buscar
// vivia no RENDERER (`projetos.js`), e de la ela tinha tres defeitos somados:
//
//  1. `if (document.hidden) return;` PULAVA o tique sem reagendar. Um tique
//     perdido custava dez minutos inteiros -- e abrir o app minimizado jogava
//     fora o primeiro, entao o primeiro fetch de verdade so saia em 10min20s;
//  2. nao havia gatilho nenhum: nem ao expandir um projeto, nem ao voltar para
//     a janela, nem botao manual;
//  3. a rede era gasta com TODOS os projetos e o resultado jogado fora para os
//     fechados -- o aviso de "atras" so era desenhado no card expandido.
//
// Aqui o relogio e o do `uso.js`, que ja pagou esse aprendizado: piso de tempo,
// coalescencia, retentativa unica, e `aoVoltar` nos eventos da janela. O que
// muda para o renderer e que ele deixa de perguntar e passa a ser AVISADO.
//
// NAO mora dentro do `worktrees.js` de proposito: aquele modulo e Node puro, sem
// Electron, e e isso que permite o `teste:worktrees` rodar sem abrir o app.
// Arrastar `BrowserWindow` para la custaria a suite mais barata do projeto.

const projetos = require('./projetos');
const worktrees = require('./worktrees');

// Dez minutos, como antes. Encurtar NAO era o conserto: o que doia era nunca
// reconsultar ao voltar para a janela, e os gatilhos abaixo resolvem isso em
// segundos. Rede a cada poucos minutos contraria a meta de consumo parado.
const MS_ENTRE = 10 * 60 * 1000;

// Longe do arranque: a meta e 1,5s ate o primeiro terminal.
const MS_PRIMEIRA = 20_000;

// Entre duas buscas DO MESMO projeto. Sem ele, expandir e recolher um card em
// sequencia viraria um `git fetch` por clique.
const MS_PISO = 60_000;

// Uma segunda chance depois de falhar, e uma so: ficar offline nao pode virar
// marretada na rede.
const MS_RETENTATIVA = 60_000;

// Quantos `git fetch` no ar ao mesmo tempo.
//
// Antes era serie pura, e o pior caso por ciclo era N x 20s (o prazo do
// `gitDeRede`): com seis projetos e um remoto fora do ar, dois minutos.
//
// Isto NAO contraria a regra de que "o git nao gosta de concorrencia" -- aquela
// e sobre o MESMO repositorio, e a coalescencia por caminho logo abaixo garante
// que um repositorio nunca tem dois fetch simultaneos. Sao projetos diferentes,
// em pastas diferentes.
const LIMITE = 3;

let janela = null;
let timer = null;
let atrasado = null;
let ultimoEnvio = '';
let ultimoTique = 0;

// caminho -> { ok, base, upstream, atras, frente, em, erro }
const situacoes = new Map();
// caminho -> Promise, enquanto o fetch daquele projeto esta no ar.
const buscando = new Map();
// Quem ja falhou e ainda tem direito a uma retentativa.
const falhados = new Set();

function janelaViva() {
  return Boolean(janela && !janela.isDestroyed() && !janela.webContents.isDestroyed());
}

function visivel() {
  // A mesma guarda do `metricas.js` e do `uso.js`: janela escondida nao tem
  // quem olhe o resultado, e nao ha por que gastar rede.
  return Boolean(janela && !janela.isDestroyed() && janela.isVisible() && !janela.isMinimized());
}

function agora() {
  return [...situacoes.entries()].map(([caminho, s]) => ({ caminho, ...s }));
}

function emitir() {
  if (!janelaViva()) return;

  const carga = agora();
  // Mandar o mesmo valor a cada tique faria a arvore de projetos se redesenhar a
  // toa -- e `desenharProjetos()` reconstroi a lista inteira.
  const marca = JSON.stringify(carga);
  if (marca === ultimoEnvio) return;
  ultimoEnvio = marca;

  janela.webContents.send('git:estado', carga);
}

// Busca UM projeto, com piso de tempo e coalescencia.
//
// A coalescencia (`buscando`) e o que torna seguro chamar isto de varios lugares
// ao mesmo tempo: o relogio, o clique em expandir e o "buscar agora" da paleta
// podem cair juntos, e ainda assim sai um fetch so.
function atualizarUm(caminho, { forcar = false } = {}) {
  const chave = String(caminho || '');
  if (!chave) return Promise.resolve(null);

  const emCurso = buscando.get(chave);
  if (emCurso) return emCurso;

  const anterior = situacoes.get(chave);
  if (!forcar && anterior && anterior.em && Date.now() - anterior.em < MS_PISO) {
    return Promise.resolve(anterior);
  }

  const tarefa = (async () => {
    try {
      const r = await worktrees.buscar(chave);
      situacoes.set(chave, { ...r, em: Date.now() });
      // Falha de rede NUNCA vira dialogo -- a mesma politica do updater e do
      // `gitDeRede`. Sem credencial ou sem internet, o app so continua
      // mostrando o que ja sabia.
      if (!r.ok) {
        falhados.add(chave);
        console.error(`[remoto] ${chave}: ${r.erro}`);
      } else {
        falhados.delete(chave);
      }
    } catch (err) {
      situacoes.set(chave, { ok: false, erro: String(err?.message || err), em: Date.now() });
      falhados.add(chave);
    } finally {
      buscando.delete(chave);
    }
    return situacoes.get(chave);
  })();

  buscando.set(chave, tarefa);
  return tarefa;
}

// Roda `tarefa` sobre `itens` com no maximo `LIMITE` no ar.
async function comLimite(itens, tarefa) {
  const fila = [...itens];
  const correndo = [];

  while (fila.length || correndo.length) {
    while (fila.length && correndo.length < LIMITE) {
      const item = fila.shift();
      const p = tarefa(item).finally(() => {
        correndo.splice(correndo.indexOf(p), 1);
      });
      correndo.push(p);
    }
    if (correndo.length) await Promise.race(correndo);
  }
}

function alvos() {
  return projetos.listar().filter((p) => p.existe && p.git).map((p) => p.caminho);
}

function reagendar(ms, { retentativa = false } = {}) {
  clearTimeout(atrasado);
  atrasado = setTimeout(() => { atrasado = null; tique({ retentativa }); }, ms);
}

// `forcar` dispensa a guarda de visibilidade E o piso -- e o "buscar agora" da
// paleta, que tem de funcionar mesmo com a janela acabando de aparecer.
// `retentativa` dispensa so o piso: a segunda chance vem exatamente no limite
// dele, e sem isto ela devolveria o proprio erro em cache sem tocar a rede.
async function tique({ forcar = false, retentativa = false } = {}) {
  if (!forcar && !visivel()) return agora();

  ultimoTique = Date.now();
  falhados.clear();

  await comLimite(alvos(), (c) => atualizarUm(c, { forcar: forcar || retentativa }));
  emitir();

  // Retentativa UNICA. Sem ela, uma falha de dois segundos no arranque custava o
  // ciclo inteiro de dez minutos; e como este tique so agenda outra quando ELE
  // proprio nao e a retentativa, ficar offline nao vira um fetch por minuto para
  // sempre. O ciclo seguinte comeca com direito a uma nova.
  if (falhados.size && !retentativa) reagendar(MS_RETENTATIVA, { retentativa: true });

  return agora();
}

// A janela voltou.
//
// E o gatilho que faltava: sem ele, o unico era o relogio de dez minutos, e o
// relato foi exatamente esse -- "demora a aparecer o botao de pull". Abrir o app
// minimizado era o pior caso, com o primeiro fetch so em 10min20s.
function aoVoltar() {
  if (!ultimoTique || Date.now() - ultimoTique >= MS_ENTRE) tique();
}

function iniciar(j) {
  janela = j;
  parar();
  reagendar(MS_PRIMEIRA);
  timer = setInterval(() => { tique(); }, MS_ENTRE);
  for (const evento of ['show', 'restore', 'focus']) j.on(evento, aoVoltar);
}

function parar() {
  clearInterval(timer);
  clearTimeout(atrasado);
  timer = null;
  atrasado = null;
  ultimoEnvio = '';
  // Remover os ouvintes, e nao so os relogios: `iniciar()` pode rodar de novo
  // pelo `app.on('activate')`, e sem isto cada volta empilharia mais um
  // `aoVoltar` na mesma janela.
  if (janela && !janela.isDestroyed()) {
    for (const evento of ['show', 'restore', 'focus']) janela.removeListener(evento, aoVoltar);
  }
}

module.exports = {
  MS_ENTRE, MS_PRIMEIRA, MS_PISO, MS_RETENTATIVA, LIMITE,
  iniciar, parar, agora, tique, atualizarUm, emitir,
  // Para o teste poder montar o estado sem rede.
  _situacoes: situacoes,
};
