'use strict';

// O registro de sessoes do proprio CLI, como TERCEIRA fonte de status.
//
// De onde ele veio: a investigacao do "cross-session messaging" anunciado para
// macOS e Linux. O recurso e bloqueado no Windows por um portao de plataforma
// dentro do binario (ver docs/fase-9-extras.md) -- mas o registro que ele usa,
// `~/.claude/sessions/<pid>.json`, continua sendo escrito aqui.
//
// E ele MEDE o que o app antes so conseguia deduzir. Do `npm run spike:aprovacao`
// com um pedido de permissao real (CLI 2.1.227), amostrando o registro no mesmo
// instante de cada captura de tela:
//
//   [3753ms] prompt na tela   tela=permissao  app=rodando    registro=waiting
//   [5257ms] prompt na tela   tela=permissao  app=esperando  registro=waiting
//   [6267ms] respondido       trabalhando=SIM app=rodando    registro=busy
//   [7274ms] acabou           --              app=terminou   registro=idle
//
// Tres achados:
//
//  1. existe um status `waiting`, e ele e AFIRMATIVO -- o CLI dizendo "estou
//     parado esperando a pessoa". Nao e deducao de texto de tela;
//  2. ele apareceu 1,5s ANTES do farejador, e naquela corrida o hook de
//     permissao nem chegou a disparar antes da resposta (o CLI arma um
//     temporizador de ~6s antes de notificar);
//  3. `busy` so apareceu no instante em que a tela tinha sinal de trabalho, e
//     nunca com o prompt na tela -- e o que autoriza usa-lo para APAGAR.
//
// AS REGRAS, e por que sao so estas duas:
//
//  - `waiting` ACENDE `esperando`. Mesma direcao do farejador, e o erro barato
//    (acender a toa e ruido).
//  - `busy` APAGA um `esperando` preso. Mesmo papel do `MARCA_TRABALHANDO`, e
//    pela mesma razao: e sobre o AGORA.
//  - `idle` nao faz nada. Sessao ociosa pode ter acabado OU estar esperando
//    voce digitar, e confundir os dois foi exatamente o bug do `idle_prompt`
//    acendendo amarelo em sessao que tinha terminado.
//
// O que ele acrescenta ao farejador, que ja faz duas dessas coisas: funciona com
// painel FORA DA VISTA (o farejador so le painel visivel), funciona SEM HOOKS
// instalados, e nao depende de casar texto de tela -- que muda a cada versao do
// CLI.
//
// Layout INTERNO do CLI, como o resto do `claude-dados.js`: se mudar, `sessoes()`
// devolve vazio e o app volta a depender do Canal 2 e do farejador. Degrada sem
// quebrar.

const claudeDados = require('./claude-dados');
const estado = require('./estado');
const worktrees = require('./worktrees');

// CINCO segundos, e o numero foi MEDIDO -- comecou em 2s, no ritmo do
// `metricas.js`, e isso custou caro. `npm run teste:fase2`, CPU parado com 8
// painéis (meta do projeto: abaixo de 2%):
//
//   2s   -> 1,86%      (duas corridas: 1,88 e 1,84)
//   5s   -> 1,63%
//   60s  -> 1,42%
//
// Ou seja: a 2s este modulo sozinho comia ~0,44 ponto percentual, um QUARTO do
// orcamento inteiro do app, para refinar status. O custo nao esta em ler tres
// arquivos de 1 KB -- esta em acordar o processo o tempo todo, que impede o
// Windows de agrupar temporizadores e deixar a CPU dormir.
//
// Cinco segundos e o ponto certo porque so UM dos tres ganhos depende da
// cadencia. Funcionar com painel fora da vista e funcionar sem hooks instalados
// valem igual em qualquer ritmo; so "chegar antes do hook" precisa de pressa --
// e o hook de permissao nao pode chegar em menos de ~6s, porque o CLI arma esse
// temporizador antes de notificar. Para o painel visivel, o farejador ja acende
// em ~1,5s.
const MS_ENTRE = 5000;

let janela = null;
let timer = null;

function visivel() {
  return Boolean(janela && !janela.isDestroyed() && janela.isVisible() && !janela.isMinimized());
}

// A quem esta sessao pertence -- e AQUI mora a parte perigosa do modulo.
//
// Casar so por `cwd` esta ERRADO, e o teste provou na hora: uma sessao do Claude
// aberta a mao na pasta do projeto (o proprio desenvolvimento deste app, por
// exemplo) casava com qualquer painel dali e passava a mexer no status dele. O
// registro lista TODAS as sessoes da maquina, e nao so as que este app lancou.
//
// Por isso o portao e o NOME: `montarComando` lanca com `--name <slug>`, e esse
// slug e exatamente o `feature` do painel. Sessao que o app nao nomeou nao tem
// como ser provada nossa -- e entao ela nao decide nada. O `cwd` fica como
// segunda confirmacao, nunca como chave.
//
// Consequencia honesta: painel aberto sem nome de feature (`cls && claude` puro)
// nao recebe status por esta via. Preferir isso a atribuir a sessao de um
// estranho a um painel -- que e justamente o erro caro deste app.
function donoDe(s) {
  if (!s.nome || !s.cwd) return null;

  const porCwd = estado.resolver({ cwd: s.cwd });
  if (!porCwd) return null;

  const painel = estado.todas().find((x) => x.id === porCwd);
  if (!painel || painel.feature !== s.nome) return null;

  return porCwd;
}

// Uma passada. Exportada para o teste poder chamar sem relogio.
function tique({ lista = null } = {}) {
  const sessoes = lista || claudeDados.sessoes({ pidVivo: worktrees.processoVivo });
  const aplicadas = [];

  for (const s of sessoes) {
    const id = donoDe(s);
    if (!id) continue;

    const atual = estado.todas().find((x) => x.id === id);
    if (!atual) continue;

    if (s.status === 'waiting' && (atual.status === 'rodando' || atual.status === 'iniciando')) {
      // Sem `pergunta`: o registro nao diz O QUE esta sendo perguntado. Quem
      // preenche isso e o farejador (lendo a tela) ou o hook -- e por isso o
      // `definirStatus` daqui nunca sobrescreve um `esperando` que ja existe,
      // senao apagaria a pergunta que a faixa de aprovacao mostra.
      estado.definirStatus(id, 'esperando', 'esperando voce');
      aplicadas.push({ id, de: atual.status, para: 'esperando' });
    } else if (s.status === 'busy' && atual.status === 'esperando') {
      estado.definirStatus(id, 'rodando', '');
      aplicadas.push({ id, de: atual.status, para: 'rodando' });
    }
  }

  return aplicadas;
}

function iniciar(j) {
  janela = j;
  parar();
  timer = setInterval(() => { if (visivel()) tique(); }, MS_ENTRE);
}

function parar() {
  clearInterval(timer);
  timer = null;
}

module.exports = { MS_ENTRE, iniciar, parar, tique, donoDe };
