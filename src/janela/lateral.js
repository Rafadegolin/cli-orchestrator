'use strict';

// A barra de status. Responde "onde eu preciso olhar agora?" em menos de um
// segundo, sem procurar.

const elLista = document.getElementById('lateral-lista');
const elContagem = document.getElementById('lateral-contagem');
const elFilaBloco = document.getElementById('bloco-fila');
const elFilaLista = document.getElementById('fila-lista');
const elFilaContagem = document.getElementById('fila-contagem');
const btnFilaDica = document.getElementById('fila-dica');
const btnHooks = document.getElementById('btn-hooks');
const elHooksRotulo = document.getElementById('hooks-rotulo');
const btnAvisos = document.getElementById('btn-avisos');
const elAvisosRotulo = document.getElementById('avisos-rotulo');
const btnAtualizar = document.getElementById('btn-atualizar');
const btnRetomarTodas = document.getElementById('btn-retomar-todas');
const elVersao = document.getElementById('lateral-versao');

// Ordem de urgencia, nao de projeto: quem espera ha mais tempo primeiro, depois
// quem terminou e precisa de revisao, depois quem esta rodando, por ultimo
// quem parou.
const PESO = { esperando: 0, terminou: 1, parada: 2, rodando: 3, iniciando: 4, encerrada: 5 };

// Painel dormindo vai para o fim, e por isso o peso NAO pode sair so do status:
// ele carrega 'iniciando' (peso 3) e cairia no meio da lista, na frente de
// sessoes vivas. Nao ha processo nenhum ali para exigir sua atencao.
const PESO_DORMINDO = 6;

// O rotulo diz o ESTADO. O motivo que veio do hook ("pedindo permissao",
// "parado ha 60s") vai para o title -- juntar os dois produzia coisas como
// "parado ha 60s ha 4min", com o "ha" duas vezes na mesma linha.
const ROTULO = {
  esperando: 'esperando',
  terminou: 'pronto para revisar',
  // `parada` NAO diz "esperando": ela acabou e nao ha nada pendente. Chamar
  // isso de espera era o falso alarme que um usuario relatou.
  parada: 'parada',
  rodando: 'trabalhando',
  iniciando: 'iniciando',
  encerrada: 'encerrada',
};

const ROTULO_DORMINDO = 'sessão salva';

// Painel de shell puro nao tem sessao do Claude dentro, entao nenhum hook fala
// por ele: o `rodando` que todo painel recebe ao nascer ficaria para sempre, e
// a lateral diria "trabalhando" sobre um prompt parado. O rotulo e fixo.
const ROTULO_TERMINAL = 'terminal';

const cards = new Map();

// Os dois status que merecem tirar voce de outra janela. `parada` NAO entra: e
// justamente a sessao que nao esta pedindo nada.
const PRECISA_AVISO = new Set(['esperando', 'terminou']);

// id -> status ja anunciado. Era um Set, e por isso um aviso de `esperando`
// engolia o `terminou` que viesse depois; guardando o status, cada mudanca que
// merece aviso ganha o seu.
const jaAvisado = new Map();

// id -> { titulo, corpo }. Aviso que NAO foi dado porque a janela estava em
// foco na hora. Fica guardado e sai quando voce troca de janela.
const avisoPendente = new Map();

// id -> true. Um lembrete por episodio, e so.
const jaLembrado = new Set();

// Quanto tempo esperando ate insistir uma vez. Uma sessao parada quarenta
// minutos gerava UM toast e nunca mais nada.
const MS_LEMBRETE = 5 * 60 * 1000;

// `tipoPainel`, e nao `tipo`: o nome comprido e cicatriz. `c.tipo` JA EXISTIA
// no card guardando o tipo da ESPERA que vem do hook (`permissao` / `ocioso`),
// e o `definirStatus` o reescreve a cada diff do Canal 2 -- entao o painel de
// terminal virava sessao comum no primeiro status que chegasse, e a lateral
// voltava a dizer "trabalhando". Mesma familia do `ligacoesPendentes`.
function registrar({ id, feature, cwd, tipoPainel }) {
  cards.set(id, {
    id, feature, cwd, tipoPainel: tipoPainel === 'terminal' ? 'terminal' : 'sessao',
    status: 'iniciando', motivo: '', desde: Date.now(),
  });
  redesenhar();
}

function remover(id) {
  cards.delete(id);
  esquecerAvisos(id);
  redesenhar();
}

function esquecerAvisos(id) {
  jaAvisado.delete(id);
  avisoPendente.delete(id);
  jaLembrado.delete(id);
}

function definirStatus(id, status, motivo = '', desde = Date.now(), extra = {}) {
  const c = cards.get(id);
  if (!c) return;
  c.status = status;
  c.motivo = motivo;
  c.desde = desde;
  // A pergunta do Claude e o tipo de espera: `permissao` tem o que aprovar,
  // `ocioso` esta so esperando voce digitar.
  c.pergunta = extra.pergunta || '';
  c.tipo = extra.tipo || '';

  window.OrqPainel.painelPorId.get(id)?.definirStatus(status, rotuloDe(c), motivo);
  window.OrqAprovacao?.atualizar(id, c);

  if (PRECISA_AVISO.has(status)) avisar(c);
  else esquecerAvisos(id);

  // Sessao que saiu de 'rodando' pode ter aberto vaga para quem esta na fila.
  window.OrqFila?.reavaliar();

  redesenhar();
}

function textoDoAviso(c) {
  if (c.status === 'terminou') {
    return { titulo: `${c.feature} terminou`, corpo: 'pronto para revisar' };
  }
  return { titulo: `${c.feature} está esperando`, corpo: c.motivo || 'pedindo permissão' };
}

// O aviso so sai depois de a gente TER CERTEZA de que vai sair.
//
// Antes o `jaAvisado` era marcado na primeira linha, e o teste de foco vinha
// depois: uma sessao que comecou a esperar com a janela na frente queimava ali
// a unica chance de aviso, e ao trocar de janela um minuto depois nada mais
// acontecia. Agora, com a janela em foco, o aviso fica PENDENTE e sai no blur.
async function avisar(c) {
  if (jaAvisado.get(c.id) === c.status) return;

  const aviso = { ...textoDoAviso(c), status: c.status };
  if (await window.orq.estaFocado()) {
    avisoPendente.set(c.id, aviso);
    return;
  }
  disparar(c.id, aviso);
}

function disparar(id, aviso) {
  jaAvisado.set(id, aviso.status);
  avisoPendente.delete(id);
  window.orq.notificar(aviso.titulo, aviso.corpo);
}

// Voce saiu da janela: o que ficou pendente sai agora -- desde que ainda seja
// verdade. Uma sessao que ja saiu do estado nao vira aviso atrasado.
window.orq.aoMudarFoco((focada) => {
  if (focada) return;
  for (const [id, aviso] of [...avisoPendente]) {
    const c = cards.get(id);
    if (!c || c.status !== aviso.status || estaDormindo(id)) {
      avisoPendente.delete(id);
      continue;
    }
    disparar(id, aviso);
  }
});

function estaDormindo(id) {
  return Boolean(window.OrqPainel.painelPorId.get(id)?.dormindo);
}

function pesoDe(c) {
  return estaDormindo(c.id) ? PESO_DORMINDO : (PESO[c.status] ?? 9);
}

// A UNICA fonte do rotulo. A lateral, a fila e o cabecalho do painel consomem
// esta funcao -- antes cada um montava o seu, e os tres ja tinham divergido.
function rotuloDe(c) {
  if (estaDormindo(c.id)) return ROTULO_DORMINDO;
  // Antes do resto: o status de um terminal nao significa nada, porque ninguem
  // o reporta.
  if (c.tipoPainel === 'terminal') return ROTULO_TERMINAL;
  if (c.status === 'esperando') return `esperando ${textoEspera(Date.now() - c.desde)}`;
  // `parada` tambem conta o tempo -- e a informacao util dela ("faz quanto que
  // esta ai?") --, so que sem a palavra "esperando" na frente.
  if (c.status === 'parada') return `parada ${textoEspera(Date.now() - c.desde)}`;
  return ROTULO[c.status] || c.status;
}

// NAO se chama `projetoDe`: projetos.js ja declara uma funcao com esse nome no
// mesmo escopo global compartilhado, e a ultima avaliada vence em silencio.
// Foi assim que a ordenacao por projeto quebrou -- este arquivo acabava
// chamando a de projetos.js, que espera um caminho e nao um card.
function nomeProjetoDe(c) {
  return window.OrqProjetos?.projetoDe?.(c.cwd)?.nome || '';
}

// Ordem da GRADE e da lista de sessoes: as duas seguem a mesma escolha, porque
// procurar uma sessao em duas ordenacoes diferentes ao mesmo tempo e pior que
// nao ordenar.
function ordenadas() {
  const porProjeto = window.OrqCasca?.ordem() === 'projeto';
  return [...cards.values()].sort((a, b) => {
    if (porProjeto) {
      return nomeProjetoDe(a).localeCompare(nomeProjetoDe(b))
        || a.feature.localeCompare(b.feature);
    }
    const d = pesoDe(a) - pesoDe(b);
    if (d !== 0) return d;
    // Dentro do mesmo peso, quem esta parado ha mais tempo vem primeiro.
    return a.desde - b.desde;
  });
}

// A fila de atencao NAO segue a ordenacao escolhida: ela e a fila, e fila e
// sempre por quem espera ha mais tempo. Ordenar por projeto aqui faria o
// Ctrl+Enter pular para a sessao errada.
// Terminal fica FORA: nao ha hook que o deixe amarelo, entao ele nunca deveria
// disputar o Ctrl+Enter. Guarda barato, defeito caro.
function filaAtencao() {
  return [...cards.values()]
    .filter((c) => c.status === 'esperando' && c.tipoPainel !== 'terminal' && !estaDormindo(c.id))
    .sort((a, b) => a.desde - b.desde);
}

function textoEspera(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  return `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

function redesenhar() {
  const lista = ordenadas();
  elContagem.textContent = String(lista.length);

  // Viva = tem processo. Painel restaurado dormindo aparece na lista, mas nao
  // conta no placar: ninguem esta gastando CPU por ele.
  const vivas = lista.filter((c) => {
    const p = window.OrqPainel.painelPorId.get(c.id);
    return c.status !== 'encerrada' && !(p && p.dormindo);
  }).length;
  window.OrqCasca?.definirVivas(vivas);

  elLista.replaceChildren(...lista.map((c) => {
    const painel = window.OrqPainel.painelPorId.get(c.id);

    const li = document.createElement('li');
    li.className = 'card'
      + (c.status === 'esperando' ? ' card-atencao' : '')
      // Redesenhar recria os cards, entao o foco tem de ser reaplicado aqui --
      // senao ele some sozinho na primeira mudanca de status de qualquer sessao.
      + (window.OrqGrade?.focado?.() === c.id ? ' card-focado' : '');
    li.dataset.id = c.id;

    const bolinha = document.createElement('span');
    bolinha.className = painel?.dormindo
      ? 'bolinha bolinha-dormindo'
      : `bolinha bolinha-${c.tipoPainel === 'terminal' ? 'terminal' : c.status}`;

    const nome = document.createElement('span');
    nome.className = 'card-nome';
    nome.textContent = c.feature;

    const sub = document.createElement('span');
    sub.className = 'card-sub';
    sub.dataset.status = c.status;
    sub.textContent = rotuloDe(c);

    const texto = document.createElement('span');
    texto.className = 'card-texto';
    texto.append(nome, sub);

    const porta = document.createElement('span');
    porta.className = 'card-porta';
    porta.textContent = painel?.portas?.length ? `:${painel.portas[0]}` : '';

    // O cartao nao tinha NENHUMA identidade de projeto -- so status. Com sessoes
    // de projetos diferentes lado a lado, a lista era uma coluna de nomes sem
    // agrupamento visivel.
    const tinta = window.OrqProjetos?.tintaDaPasta?.(c.cwd) || '';
    li.style.setProperty('--tinta', tinta);
    li.classList.toggle('card-tinto', Boolean(tinta));

    li.title = [c.cwd, c.motivo].filter(Boolean).join('\n');
    li.append(bolinha, texto, porta);
    li.addEventListener('click', () => window.OrqGrade.focarPainel(c.id));
    return li;
  }));

  redesenharFila();
  // A grade acompanha a mesma ordem, sem mover nenhum no do DOM.
  window.OrqGrade?.ordenarGrade?.(lista);
}

// O bloco ESPERANDO VOCE. So existe quando ha fila: um cabecalho vazio ocupando
// espaco na lateral e ruido permanente para avisar de algo que nao esta
// acontecendo.
function redesenharFila() {
  const espera = filaAtencao();
  elFilaBloco.hidden = espera.length === 0;
  if (!espera.length) {
    elFilaLista.replaceChildren();
    return;
  }

  elFilaContagem.textContent = String(espera.length);
  elFilaLista.replaceChildren(...espera.map((c) => {
    const li = document.createElement('li');
    li.dataset.id = c.id;
    li.title = c.motivo || 'esperando você';

    const bolinha = document.createElement('span');
    bolinha.className = 'bolinha bolinha-esperando';

    const nome = document.createElement('span');
    nome.className = 'fila-nome';
    nome.textContent = c.feature;

    const tempo = document.createElement('span');
    tempo.className = 'fila-espera';
    tempo.textContent = textoEspera(Date.now() - c.desde);

    li.append(bolinha, nome, tempo);
    li.addEventListener('click', () => window.OrqGrade.focarPainel(c.id));
    return li;
  }));
}

// UM unico intervalo para todos os cronometros. Um setInterval por card
// acordaria a CPU N vezes por segundo a toa e derrubaria a meta de consumo
// parado.
//
// Sai na primeira linha quando ninguem espera -- que e o estado normal da tela.
// Antes ele varria o DOM a cada segundo mesmo sem nada para atualizar.
setInterval(() => {
  // `parada` tambem conta tempo na tela, entao entra no laco. Sessao parada e o
  // estado mais comum de todos depois de um tempo de uso, entao a escrita e
  // CONDICIONAL: acima de um minuto o texto so muda uma vez a cada 60 voltas, e
  // reescrever a mesma string 59 vezes seria sujar o DOM por nada.
  const cronometrando = [...filaAtencao(), ...cards.values()].filter(
    (c, i, todos) => todos.indexOf(c) === i && (c.status === 'esperando' || c.status === 'parada'),
  );
  if (!cronometrando.length) return;

  for (const c of cronometrando) {
    const rotulo = rotuloDe(c);
    const decorrido = textoEspera(Date.now() - c.desde);

    const sub = elLista.querySelector(`.card[data-id="${CSS.escape(c.id)}"] .card-sub`);
    if (sub && sub.textContent !== rotulo) sub.textContent = rotulo;

    const naFila = elFilaLista.querySelector(`li[data-id="${CSS.escape(c.id)}"] .fila-espera`);
    if (naFila && naFila.textContent !== decorrido) naFila.textContent = decorrido;

    window.OrqPainel.painelPorId.get(c.id)?.atualizarRotulo(rotulo);

    // Insiste UMA vez. Sem isto, uma sessao travada quarenta minutos gerava um
    // toast la no inicio e nunca mais nada -- e quem nao estava olhando naquele
    // segundo nunca ficava sabendo.
    if (c.status === 'esperando'
        && jaAvisado.has(c.id)
        && !jaLembrado.has(c.id)
        && Date.now() - c.desde >= MS_LEMBRETE
        && !estaDormindo(c.id)) {
      jaLembrado.add(c.id);
      window.orq.notificar(`${c.feature} ainda está esperando`, decorrido);
    }
  }
}, 1000);

// O toque que faz o app valer a pena: pular direto para quem espera ha mais
// tempo, em vez de cacar painel.
function pularParaMaisAntigo() {
  // Da fila, e nao de ordenadas(): com a grade ordenada por projeto, o primeiro
  // da lista nao e quem espera ha mais tempo.
  const alvo = filaAtencao()[0] || ordenadas().find((c) => c.status === 'terminou');
  if (!alvo) return null;
  window.orq.focarJanela();
  window.OrqGrade.focarPainel(alvo.id);
  return alvo.id;
}

btnFilaDica?.addEventListener('click', pularParaMaisAntigo);

// `metaKey` junto do `ctrlKey` pela mesma razao do Ctrl+B e do Ctrl+K: no Mac
// o modificador e o ⌘, e este era o unico atalho que nao aceitava os dois.
window.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
    ev.preventDefault();
    pularParaMaisAntigo();
  }
});

// Diffs vindos do processo principal: { id, status, motivo, desde, pergunta, tipo }.
window.orq.aoMudarEstado(({ id, status, motivo, desde, pergunta, tipo }) =>
  definirStatus(id, status, motivo, desde, { pergunta, tipo }));

// ------------------------------------------------ o interruptor de avisos

// Ele NAO mexe na maquina de avisos daqui (`jaAvisado`, `avisoPendente`,
// `jaLembrado`): quem suprime e o processo principal, no `avisos.js`. Assim a
// contabilidade de "avisa uma vez por episodio" continua correta com o
// interruptor desligado, e religar no meio de uma espera ainda produz o
// lembrete de 5min. Ver o comentario do `preferencias.avisosLigados`.
function avisosLigados() {
  return window.OrqCasca?.ui().avisos !== 'desligados';
}

function alternarAvisos() {
  const antes = avisosLigados();
  window.OrqCasca?.mudar({ avisos: antes ? 'desligados' : 'ligados' });
  window.OrqToast?.mostrar(antes
    ? 'Notificações desligadas — a fila ESPERANDO VOCÊ continua marcando quem parou'
    : 'Notificações ligadas');
  return !antes;
}

function atualizarBotaoAvisos() {
  if (!btnAvisos) return;
  const ligados = avisosLigados();
  // Escreve so no rotulo, como o de hooks: mexer no textContent do botao
  // apagaria o switch, que e markup irmao.
  if (elAvisosRotulo) elAvisosRotulo.textContent = ligados ? 'ligados' : 'desligados';
  btnAvisos.classList.toggle('ligado', ligados);
  btnAvisos.setAttribute('aria-pressed', String(ligados));
  btnAvisos.title = ligados
    ? 'Avisa por notificação do sistema quando uma sessão para esperando você, e chama pela '
      + 'barra de tarefas ou pelo Dock. Clique para desligar os dois.'
    : `As notificações estão desligadas. A bolinha amarela, a fila ESPERANDO VOCÊ e o `
      + `${window.OrqShell.MOD}+Enter continuam funcionando normalmente.`;
}

btnAvisos?.addEventListener('click', alternarAvisos);
// Reage a mudanca vinda de outro caminho (a paleta), como o medidor de uso faz.
window.OrqCasca?.aoMudar(atualizarBotaoAvisos);
atualizarBotaoAvisos();

btnHooks?.addEventListener('click', async () => {
  const s = await window.orq.hooksSituacao();
  if (s.instalado) await window.orq.hooksDesinstalar();
  else await window.orq.hooksInstalar();
  atualizarBotaoHooks();
});

async function atualizarBotaoHooks() {
  if (!btnHooks) return;
  const s = await window.orq.hooksSituacao();

  // Tres estados, e nao dois. `parcial` e o caso que a versao anterior chamava
  // de "ligados": um hook nosso sobrevivendo em qualquer evento bastava. Se so
  // as entradas de Notification sumirem, o verde e o azul seguem mudando e so
  // o amarelo morre -- e a lateral dizia que estava tudo bem.
  const rotulo = s.instalado ? 'ligados' : (s.parcial ? 'desatualizados' : 'desligados');

  // Escreve so no rotulo: mexer no textContent do botao apagaria o switch, que
  // e markup irmao. O estado visual do switch sai da classe.
  if (elHooksRotulo) elHooksRotulo.textContent = rotulo;
  btnHooks.classList.toggle('ligado', Boolean(s.instalado));
  btnHooks.classList.toggle('hooks-parcial', Boolean(s.parcial));
  btnHooks.title = s.instalado
    ? `Hooks registrados em ${s.arquivo} (clique para remover)`
    : (s.parcial
      ? `Faltam ${s.faltando} hook(s) em ${s.arquivo} — clique para registrar de novo. `
        + 'Sem eles, parte das mudanças de status não chega.'
      : `Registrar hooks em ${s.arquivo} para as bolinhas mudarem sozinhas`);
}

// No arranque, AVISA em vez de esperar voce reparar no rotulo da lateral.
//
// Registro incompleto significa que parte das mudancas de status nao chega, e o
// sintoma disso e a tela parecer normal enquanto o amarelo nunca aparece. Quem
// nao olha para o rodape da lateral nao descobre. O app continua PERGUNTANDO
// antes de escrever no settings.json -- isto so leva voce ate o botao.
(async () => {
  await atualizarBotaoHooks();
  const s = await window.orq.hooksSituacao();
  if (!s.parcial) return;
  window.OrqToast?.mostrar(
    `Faltam ${s.faltando} hooks de status — clique em Hooks, no rodapé, para registrar`,
  );
})();

// Primeiro desenho com a lista vazia: sem isto a contagem de SESSOES nasce em
// branco em vez de zero, e o placar de sessoes vivas so aparece quando o
// primeiro painel abre.
redesenhar();

// -------------------------------------------------------- sessao anterior

// So aparece quando ha o que retomar. A fila da Fase 6 espaca as partidas, e e
// isso que torna "todas de uma vez" aceitavel.
function atualizarRetomarTodas() {
  if (!btnRetomarTodas) return;
  const n = window.OrqGrade?.dormindos?.().length || 0;
  btnRetomarTodas.hidden = n === 0;
  btnRetomarTodas.textContent = `Retomar todas (${n})`;
  btnRetomarTodas.title = 'Religa as sessões da última vez que você fechou o app. '
    + 'As partidas são espaçadas pela fila.';
}

btnRetomarTodas?.addEventListener('click', async () => {
  btnRetomarTodas.disabled = true;
  try {
    await window.OrqGrade.retomarTodas();
  } finally {
    btnRetomarTodas.disabled = false;
    atualizarRetomarTodas();
  }
});

// ------------------------------------------------------------ atualizacao

// O botao so existe quando ha o que aplicar. Atualizacao nunca deve interromper
// o trabalho: ela espera voce olhar para a lateral.
function mostrarAtualizacao(s) {
  if (!btnAtualizar) return;

  // Com a lateral recolhida este botao e invisivel, e ele e o UNICO aviso de
  // versao nova que o app da -- atualizacao nunca vira dialogo aqui. A marca no
  // botao de recolher e o que impede "some a lateral, some o aviso, para
  // sempre". Fica no #app porque quem a desenha e a barra de titulo.
  document.getElementById('app').dataset.atualizacao = s.disponivel ? 'sim' : 'nao';

  // No portatil nao ha instalador, mas quase sempre da para trocar so o
  // app.asar -- e ai o botao e o mesmo do instalado. So quando NAO da (mudou o
  // Electron, ou a pasta nao e gravavel) ele volta a mandar para o site, e
  // dizendo por que.
  if (s.portatil && s.disponivel && !s.leve) {
    btnAtualizar.hidden = false;
    btnAtualizar.disabled = false;
    btnAtualizar.textContent = `Baixar a versão ${s.disponivel}`;
    // "Desta vez" so vale no Windows, onde a recusa e circunstancial (mudou o
    // Electron, a pasta nao e gravavel). No macOS ela e permanente, e prometer
    // que da na proxima seria mentira.
    btnAtualizar.title = (window.OrqShell.EH_WIN
      ? `Desta vez não dá para atualizar de dentro do app: ${s.motivoPesado || 'a release não traz o pacote leve'}. `
      : `Neste sistema a atualização é pelo site: ${s.motivoPesado || 'o app não se troca sozinho aqui'}. `)
      + 'Abre a página da release para você baixar o pacote novo.';
    btnAtualizar.className = 'atualizar-pronta';
    return;
  }

  if (s.baixada) {
    btnAtualizar.hidden = false;
    btnAtualizar.disabled = false;
    btnAtualizar.textContent = `Atualizar para ${s.disponivel} e reiniciar`;
    btnAtualizar.title = s.leve
      ? 'Já está baixada. Fecha os painéis, troca o app e reabre sozinho.'
      : 'Fecha os painéis abertos e reinicia o app na versão nova';
    btnAtualizar.className = 'atualizar-pronta';
  } else if (s.disponivel) {
    btnAtualizar.hidden = false;
    btnAtualizar.disabled = true;
    // O caminho leve baixa um arquivo so e nao reporta progresso: mostrar
    // "0%" ali seria inventar um numero que nunca vai andar.
    btnAtualizar.textContent = s.leve
      ? `Baixando ${s.disponivel}...`
      : `Baixando ${s.disponivel}... ${s.percentual || 0}%`;
    btnAtualizar.title = 'A atualização está sendo baixada em segundo plano';
    btnAtualizar.className = '';
  } else {
    btnAtualizar.hidden = true;
  }
}

btnAtualizar?.addEventListener('click', async () => {
  btnAtualizar.disabled = true;
  const r = await window.orq.atualizacaoAplicar();
  // Se o usuario desistiu no dialogo, o botao volta a valer.
  if (!r?.aplicado) btnAtualizar.disabled = false;
});

// "Verificar se há versão nova", da paleta.
//
// O IPC `atualizacao:verificar` existia desde sempre com chamador SO nos testes.
// Ele fecha o outro lado do relato "preciso fechar e abrir o app": o gancho de
// foco cobre o caso comum, e isto cobre "acabei de publicar e quero ver agora".
//
// A logica mora aqui, e nao na paleta: a paleta nao tem logica propria, so chama
// funcao que ja existe no modulo dono do assunto.
async function verificarAtualizacao() {
  const s = await window.orq.atualizacaoSituacao();
  if (!s.ativo) {
    // Nao e enfeite: em `npm run dev` o updater esta desligado, e sem este ramo
    // o comando nao faria nada em silencio -- o tipo de botao morto que este app
    // evita.
    window.OrqToast?.mostrar('Esta cópia não recebe atualização automática (app não empacotado)');
    return false;
  }
  await window.orq.atualizacaoVerificar();
  window.OrqToast?.mostrar('Procurando versão nova — se houver, o aviso aparece no rodapé da lateral');
  return true;
}

window.orq.aoMudarAtualizacao(mostrarAtualizacao);

(async () => {
  const v = await window.orq.versao();
  if (elVersao) elVersao.textContent = `v${v}`;
  mostrarAtualizacao(await window.orq.atualizacaoSituacao());
})();

window.OrqLateral = {
  registrar, remover, definirStatus, pularParaMaisAntigo, cards, ordenadas, mostrarAtualizacao,
  atualizarRetomarTodas, filaAtencao, rotuloDe, pesoDe, textoEspera, redesenhar,
  verificarAtualizacao, alternarAvisos, avisosLigados,
};
