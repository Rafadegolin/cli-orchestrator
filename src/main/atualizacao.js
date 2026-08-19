'use strict';

// Auto-atualizacao pelas releases do GitHub.
//
// A regra que manda aqui: este app hospeda sessoes de trabalho VIVAS. Reiniciar
// por conta propria mataria os painéis abertos no meio de uma tarefa. Entao o
// download acontece sozinho, mas quem decide aplicar e sempre o usuario.

const { app, dialog, shell } = require('electron');
const terminais = require('./terminais');
const leve = require('./atualizacao-asar');
const avisos = require('./avisos');
const { ehEmpacotado, ehPortatil } = require('./empacotamento');

const PAGINA_RELEASES = 'https://github.com/Rafadegolin/cli-orchestrator/releases/latest';

// `ehPortatil` mora em empacotamento.js porque decide mais de uma coisa. Aqui
// ela importa porque o updater aplica a atualizacao rodando o INSTALADOR, e
// quem esta no portatil nao tem instalador nenhum -- baixar um so para ele ser
// recusado (ou, com o Smart App Control ligado, barrado como todo binario nao
// assinado que vem da internet) seria mandar a pessoa para um beco sem saida.

// 4h entre checagens, com UM intervalo so. E raro sair versao nova, e acordar a
// CPU para consultar o GitHub o tempo todo contraria a meta de consumo parado.
const MS_ENTRE_CHECAGENS = 4 * 60 * 60 * 1000;

// Atraso da primeira checagem: a meta e 1,5s ate o primeiro terminal, e rede no
// arranque competiria com isso.
const MS_PRIMEIRA_CHECAGEM = 10_000;

let janela = null;
let timer = null;
let atualizador = null;

const situacao = {
  ativo: false,
  versaoAtual: app.getVersion(),
  disponivel: null,
  baixada: false,
  percentual: 0,
  portatil: false,
  // Nos layouts em pasta, da para trocar so o app.asar em vez de repor a pasta
  // inteira -- ver atualizacao-asar.js. `motivoPesado` diz por que NAO deu,
  // quando nao deu: mandar para o site sem explicar e aviso que se aprende a
  // ignorar.
  leve: false,
  motivoPesado: null,
  // Quando a ultima checagem saiu. Vai para a janela junto do resto porque e o
  // unico fato observavel de fora que prova o gancho de foco funcionando -- e
  // `atualizacao:situacao` ja e IPC publico.
  verificadaEm: 0,
};

function avisarJanela() {
  if (janela && !janela.isDestroyed() && !janela.webContents.isDestroyed()) {
    janela.webContents.send('atualizacao:estado', { ...situacao });
  }
}

function iniciar(j) {
  janela = j;

  situacao.portatil = ehPortatil();

  // Fora de um app empacotado nao ha o que consultar: o electron-updater
  // precisa do app.asar e do arquivo de metadados que o electron-builder gera.
  if (!ehEmpacotado()) {
    console.log('[atualizacao] app nao empacotado, updater desligado');
    return;
  }

  // Layout em pasta: o electron-updater nao entra nem para checar. Tudo que ele
  // sabe fazer com o resultado e rodar o instalador, e aqui nao ha instalador
  // -- a checagem e a troca sao do atualizacao-asar.js, que baixa 4 MB em vez
  // de 142 e nao depende de nada assinado.
  //
  // FORA DO WINDOWS ESTE E SEMPRE O CAMINHO, e de proposito: nao ha NSIS, e o
  // `ehPortatil()` (que procura um `Uninstall *.exe`) devolve true por
  // construcao. O electron-updater tambem nao serviria -- no macOS ele so
  // aplica atualizacao em bundle ASSINADO, e este nao e. O `atualizacao-asar`
  // recusa a troca leve la, entao sobra o aviso com o link, que e o combinado.
  if (situacao.portatil) {
    agendar(j);
    return;
  }

  try {
    atualizador = require('electron-updater').autoUpdater;
  } catch (err) {
    console.error('[atualizacao] electron-updater indisponivel:', err.message);
    return;
  }

  atualizador.logger = {
    info: (m) => console.log('[atualizacao]', m),
    warn: (m) => console.warn('[atualizacao]', m),
    error: (m) => console.error('[atualizacao]', m),
    debug: () => {},
  };

  // Daqui para baixo e so o app INSTALADO pelo NSIS, onde existe instalador
  // para rodar. Baixar sozinho e aplicar na saida sao seguros nesse caso.
  atualizador.autoDownload = true;
  atualizador.autoInstallOnAppQuit = true;

  atualizador.on('update-available', (info) => {
    situacao.disponivel = info?.version || null;
    avisarJanela();
  });

  atualizador.on('update-not-available', () => {
    situacao.disponivel = null;
    situacao.baixada = false;
    avisarJanela();
  });

  atualizador.on('download-progress', (p) => {
    situacao.percentual = Math.round(p?.percent || 0);
    avisarJanela();
  });

  atualizador.on('update-downloaded', (info) => {
    situacao.baixada = true;
    situacao.disponivel = info?.version || situacao.disponivel;
    situacao.percentual = 100;
    avisarJanela();
    notificar();
  });

  // Sem internet, GitHub fora do ar, release malformada: nada disso pode virar
  // dialogo. O app nunca deve incomodar por causa de atualizacao.
  atualizador.on('error', (err) => {
    console.error('[atualizacao] falhou:', err?.message || err);
  });

  agendar(j);
}

// O relogio, mais o gancho de janela. Extraido porque o ramo portatil da
// `return` antes de chegar aqui, e os dois precisam das mesmas tres coisas.
function agendar(j) {
  situacao.ativo = true;
  setTimeout(verificar, MS_PRIMEIRA_CHECAGEM);
  timer = setInterval(verificar, MS_ENTRE_CHECAGENS);
  for (const evento of ['show', 'restore', 'focus']) j.on(evento, aoVoltar);
}

// A janela voltou.
//
// Este e o conserto do relato "quando sai uma release, preciso fechar e abrir o
// app para aparecer o botao de reiniciar". A causa nao era o intervalo: era nao
// existir gatilho NENHUM alem do relogio -- nem ao voltar para a janela, nem
// botao manual (o IPC `atualizacao:verificar` existia com chamador so nos
// testes). Fechar e reabrir "funcionava" porque a primeira checagem sai 10s
// depois do arranque.
//
// Molde do `uso.js`: piso de tempo, porque `focus` dispara a cada alt-tab e sem
// ele um dia normal de trabalho viraria dezenas de consultas ao GitHub.
const MS_PISO_FOCO = 30 * 60 * 1000;

function aoVoltar() {
  if (!situacao.ativo) return;
  if (Date.now() - situacao.verificadaEm < MS_PISO_FOCO) return;
  verificar();
}

function verificar() {
  // O carimbo e gravado aqui, mas o piso so e consultado no `aoVoltar`: se ele
  // valesse aqui dentro, o "verificar agora" da paleta ficaria refem dele --
  // que e justamente o comando de quem nao quer esperar.
  situacao.verificadaEm = Date.now();
  if (situacao.portatil) return verificarLeve();
  if (!atualizador) return;
  atualizador.checkForUpdates().catch((err) => {
    console.error('[atualizacao] checagem falhou:', err?.message || err);
  });
}

// O caminho dos layouts em pasta. Nao passa pelo electron-updater: ele so sabe
// aplicar rodando o instalador, e aqui nao ha instalador nenhum.
//
// Baixa ja na checagem, como o updater faz no instalado -- sao ~4 MB, e ter o
// arquivo pronto e o que torna "atualizar e reiniciar" instantaneo em vez de
// uma espera depois do clique.
// Qual versao esta preparada no disco.
//
// `situacao.baixada` sozinha nao dizia isso, e o defeito era do tipo pior
// possivel: a tela certa e o arquivo errado. Uma release publicada DEPOIS, na
// mesma execucao, atualizava `disponivel` para Y e caia no `if (baixada) return`
// -- entao o rodape passava a prometer "Atualizar para Y e reiniciar" com o
// `app.asar.novo` de X ainda no disco.
let versaoBaixada = null;

async function verificarLeve() {
  try {
    const info = await leve.verificar();

    // O equivalente do `update-not-available` do NSIS, que o caminho leve nunca
    // teve: sem versao nova, nao ha nada baixado para anunciar.
    if (!info.disponivel) {
      versaoBaixada = null;
      Object.assign(situacao, {
        disponivel: null, baixada: false, leve: false, motivoPesado: null, percentual: 0,
      });
      avisarJanela();
      return;
    }

    situacao.disponivel = info.versao;
    situacao.leve = info.leve;
    situacao.motivoPesado = info.motivo;
    // Por VERSAO, e nao por "ja baixei alguma coisa".
    situacao.baixada = versaoBaixada === info.versao;
    situacao.percentual = situacao.baixada ? 100 : 0;
    avisarJanela();

    if (!info.leve || situacao.baixada) return;

    const r = await leve.preparar(info);
    versaoBaixada = info.versao;
    situacao.baixada = true;
    situacao.percentual = 100;
    console.log(`[atualizacao] asar ${info.versao} pronto (${Math.round(r.bytes / 1024)} KB)`);
    avisarJanela();
    notificar();
  } catch (err) {
    // Mesma regra de sempre: sem internet ou release malformada nao vira
    // dialogo, so log. E a atualizacao leve cai para o caminho do site.
    console.error('[atualizacao] checagem leve falhou:', err?.message || err);
    // ...MAS so se nao houver asar pronto. Antes isto derrubava `leve` sempre, e
    // uma falha de rede transformava "atualizar e reiniciar" em "baixe pelo
    // site" com o arquivo ja no disco ao lado, esperando.
    if (!situacao.baixada) situacao.leve = false;
    avisarJanela();
  }
}

// Passa pelo `avisos.js`, o mesmo caminho do aviso de sessao esperando: ele
// carrega o portao da preferencia e o handler de clique, que antes estava
// copiado aqui e no `index.js`.
//
// Obedecer ao interruptor e deliberado. Quem desliga avisos esta dizendo "nao me
// interrompa", e manter ligado justamente o menos urgente seria o pior
// resultado. E aqui nao se perde nada: atualizacao tem canal DURAVEL -- o botao
// no rodape da lateral e a bolinha do `data-atualizacao` --, reescrito a cada
// `avisarJanela()` e relido no arranque. Toast perdido nao custa informacao.
function notificar() {
  // A janela em foco ja mostra o botao no rodape; toast por cima seria ruido.
  if (janela && !janela.isDestroyed() && janela.isFocused()) return;

  avisos.notificar({
    titulo: 'Atualizacao pronta',
    corpo: `A versao ${situacao.disponivel} esta baixada. Reinicie o app quando quiser aplicar.`,
    silencioso: true,
  });
}

// Chamado pela janela depois que o usuario clica em atualizar. O dialogo diz
// quantos painéis vao morrer -- reiniciar com seis sessoes do Claude no meio de
// uma tarefa e exatamente o que nao pode acontecer sem aviso.
// `confirmar: false` segue a mesma convencao de `worktrees:arquivar` e
// `projetos:remover`: o CDP nao dirige dialogo nativo, e o caminho executado e
// exatamente o mesmo, so sem a pergunta na frente.
async function aplicar({ confirmar = true } = {}) {
  // Portatil sem atualizacao leve possivel (mudou o Electron, ou a pasta nao e
  // gravavel): so resta o download completo, e o botao leva ate ele.
  if (situacao.portatil && !(situacao.leve && situacao.baixada)) {
    await shell.openExternal(PAGINA_RELEASES);
    return { aplicado: false, portatil: true, abriu: PAGINA_RELEASES };
  }

  if (!situacao.portatil && (!atualizador || !situacao.baixada)) return { aplicado: false };

  const abertos = terminais.idsAbertos().length;
  const detalhe = abertos
    ? `${abertos} ${abertos === 1 ? 'painel aberto sera fechado' : 'painéis abertos serao fechados'} e ${abertos === 1 ? 'seu processo sera encerrado' : 'seus processos serao encerrados'}.\n\nSessoes do Claude em andamento serao interrompidas.`
    : 'Nenhum painel aberto no momento.';

  // No leve nao ha instalador nem "aplica sozinho na saida": a troca so
  // acontece por este caminho, entao a frase de conforto do instalado seria
  // mentira aqui.
  const rodape = situacao.portatil
    ? '\n\nO app fecha, troca o arquivo e reabre sozinho. Leva um instante.'
    : '\n\nSe preferir, e so fechar o app normalmente depois: a atualizacao se aplica sozinha na saida.';

  if (confirmar) {
    const { response } = await dialog.showMessageBox(janela, {
      type: 'question',
      buttons: ['Reiniciar e atualizar', 'Agora nao'],
      defaultId: 1,
      cancelId: 1,
      title: 'Aplicar atualizacao',
      message: `Instalar a versao ${situacao.disponivel} e reiniciar?`,
      detail: `${detalhe}${rodape}`,
    });
    if (response !== 0) return { aplicado: false };
  }

  if (situacao.portatil) {
    // O .bat espera este processo morrer para poder mexer no app.asar, que
    // esta mapeado em memoria enquanto o app vive. Por isso dispara ANTES e sai
    // logo em seguida.
    //
    // O `disparado` e conferido antes do `quit` porque fora do Windows a troca
    // leve nao existe: sem isto, um dia em que o portao de cima mudasse, o app
    // fecharia sem nada para reabri-lo. O guarda custa uma linha e o erro que
    // ele evita e o app sumir da tela.
    const r = leve.aplicar();
    if (!r.disparado) {
      await shell.openExternal(PAGINA_RELEASES);
      return { aplicado: false, portatil: true, abriu: PAGINA_RELEASES, motivo: r.motivo };
    }
    app.quit();
    return { aplicado: true, leve: true };
  }

  // isSilent=false mostra o progresso do instalador; isForceRunAfter=true
  // reabre o app depois.
  atualizador.quitAndInstall(false, true);
  return { aplicado: true };
}

function parar() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // Os ouvintes tambem, e nao so o relogio: `iniciar()` pode rodar de novo pelo
  // `app.on('activate')`, e sem isto cada volta empilharia mais um `aoVoltar`.
  if (janela && !janela.isDestroyed()) {
    for (const evento of ['show', 'restore', 'focus']) janela.removeListener(evento, aoVoltar);
  }
}

module.exports = { iniciar, verificar, aplicar, parar, situacao };
