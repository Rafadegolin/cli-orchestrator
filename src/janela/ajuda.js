'use strict';

// A ajuda dentro do app: como usar tudo, sem sair para o navegador.
//
// O conteudo e uma estrutura de dados, nao HTML solto, por dois motivos: o
// indice se monta sozinho a partir das secoes (nao ha como um sumiu do outro),
// e os NUMEROS vem das constantes reais do app (`{portaBase}` e afins), em vez
// de digitados no texto -- documentacao que repete constante a mao vira mentira
// na primeira mudanca de codigo.

const elAjuda = document.getElementById('ajuda');
const elAjudaIndice = document.getElementById('ajuda-indice');
const elAjudaCorpo = document.getElementById('ajuda-corpo');
const btnAjuda = document.getElementById('btn-ajuda');
const btnAjudaFechar = document.getElementById('ajuda-fechar');

let constantes = {
  portaBase: 3100,
  portasPorPainel: 5,
  portaEventos: 47615,
  pastaDados: '~/.orquestrador',
  arquivoHooks: '~/.claude/settings.json',
};

const p = (texto) => ({ tipo: 'p', texto });
const aviso = (texto) => ({ tipo: 'aviso', texto });
const passos = (itens) => ({ tipo: 'passos', itens });
const lista = (itens) => ({ tipo: 'lista', itens });
const tabela = (cabecalho, linhas) => ({ tipo: 'tabela', cabecalho, linhas });

const SECOES = [
  {
    id: 'oque',
    titulo: 'O que este app faz',
    blocos: [
      p('Ele mostra varias sessoes do Claude Code ao mesmo tempo, numa grade, cada uma identificada '
        + 'pela feature, misturando projetos diferentes.'),
      lista([
        '<b>Ver todos os terminais de uma vez</b>, em vez de uma sessao por vez com lista lateral.',
        '<b>Saber na hora quem parou te esperando</b>, e ha quanto tempo, pela bolinha de status.',
        '<b>Ordenar por urgencia</b>, e nao por repositorio: quem espera ha mais tempo aparece em cima.',
      ]),
      p('Cada sessao roda no proprio worktree, com a propria faixa de portas. Duas features do mesmo '
        + 'projeto nao brigam pelos arquivos nem pela porta 3000.'),
    ],
  },
  {
    id: 'comecar',
    titulo: 'Primeiros passos',
    blocos: [
      passos([
        '<b>Instale os hooks</b> no botao "Hooks: instalar", no rodape desta barra lateral. '
          + 'E o que faz as bolinhas mudarem sozinhas.',
        '<b>Cadastre um projeto</b> no <b>+</b> da secao PROJETOS: escolha a pasta do repositorio.',
        '<b>Digite o nome da feature</b> no campo de cima e <b>clique no projeto</b>. '
          + 'O painel abre e o Claude sobe sozinho.',
      ]),
      aviso('Sem os hooks o app funciona, mas os status ficam parados — e e o status que faz a grade '
        + 'valer a pena. O app pergunta antes de editar o <code>{arquivoHooks}</code>, faz backup e '
        + 'preserva o que ja estiver la.'),
    ],
  },
  {
    id: 'sessoes',
    titulo: 'Abrir sessoes',
    blocos: [
      p('Clicar num projeto abre um painel na pasta dele e roda o Claude. O que roda depende do campo '
        + 'de feature:'),
      tabela(['Campo de feature', 'O que acontece'], [
        ['com nome', 'Roda <code>claude -w nome</code>: cria um worktree isolado para a feature. '
          + 'O nome e limpo automaticamente (acento e simbolo viram tracinho), porque ele vira nome de branch.'],
        ['vazio', 'Roda <code>claude</code> na pasta do projeto, sem worktree.'],
      ]),
      p('O botao <b>Novo painel</b> abre um seletor de pasta, para abrir um painel avulso em qualquer '
        + 'lugar sem cadastrar projeto.'),
      p('Projeto que nao e repositorio git aparece com a etiqueta <b>sem git</b> e nunca recebe '
        + '<code>-w</code> — worktree exige git.'),
    ],
  },
  {
    id: 'status',
    titulo: 'As bolinhas de status',
    blocos: [
      p('Vem dos hooks do Claude Code, nao de ler o texto do terminal. Por isso sao confiaveis e '
        + 'mudam em menos de um decimo de segundo, mesmo com o painel fora da tela.'),
      tabela(['Cor', 'Significa'], [
        ['<span class="ajuda-bolinha bolinha-esperando"></span> amarela', 'Parou te esperando: pedindo permissao, ou ociosa. O cronometro conta desde quando.'],
        ['<span class="ajuda-bolinha bolinha-rodando"></span> verde', 'Trabalhando.'],
        ['<span class="ajuda-bolinha bolinha-terminou"></span> azul', 'Terminou; pronto para voce revisar.'],
        ['<span class="ajuda-bolinha bolinha-encerrada"></span> cinza', 'Sessao encerrada, ou painel adormecido esperando voce retomar.'],
      ]),
    ],
  },
  {
    id: 'lateral',
    titulo: 'A barra lateral e a fila',
    blocos: [
      p('A lista de SESSOES e ordenada por <b>urgencia</b>, nao por projeto: primeiro quem espera ha '
        + 'mais tempo, depois quem terminou, depois quem esta rodando, por ultimo quem parou.'),
      lista([
        'Clicar num card <b>foca o painel</b> correspondente.',
        '<b>Ctrl+Enter</b> pula direto para quem espera ha mais tempo e ja poe o cursor la.',
        'Quando o app nao esta em primeiro plano, uma <b>notificacao do sistema</b> avisa que alguem ficou amarelo.',
      ]),
    ],
  },
  {
    id: 'worktrees',
    titulo: 'Worktrees: retomar e arquivar',
    blocos: [
      p('A seta ao lado de cada projeto abre a lista dos worktrees existentes — o trabalho de ontem.'),
      lista([
        '<b>Clicar</b> abre um painel dentro do worktree continuando a ultima conversa dali.',
        'O <b>×</b> arquiva: remove a pasta do worktree e o branch.',
      ]),
      p('A etiqueta de cada worktree diz o que impede arquiva-lo:'),
      tabela(['Etiqueta', 'Por que nao da para arquivar'], [
        ['aberto agora', 'Ha uma sessao do Claude viva nele.'],
        ['N alterados', 'Ha arquivo modificado sem commit.'],
        ['N commits', 'Ha commit que ainda nao foi para o branch base.'],
        ['(sem etiqueta)', 'Esta limpo: pode arquivar.'],
      ]),
      aviso('Arquivar nao tem desfazer, entao o app confere tudo de novo na hora de arquivar — e '
        + 'tambem se recusa se houver um painel deste app aberto naquela pasta.'),
    ],
  },
  {
    id: 'env',
    titulo: 'Arquivos que o worktree nao leva',
    blocos: [
      p('Um worktree e um checkout limpo: arquivos ignorados pelo git, como o <code>.env</code>, nao '
        + 'vao junto. Sem eles a aplicacao nao sobe la dentro, e a feature nova parece quebrada sem motivo.'),
      p('Quando o app detecta essa situacao, aparece um aviso na lista de worktrees com o botao de criar '
        + 'um <code>.worktreeinclude</code> listando o que copiar para cada worktree novo.'),
    ],
  },
  {
    id: 'portas',
    titulo: 'Portas: rodar dois servidores ao mesmo tempo',
    blocos: [
      p('Cada painel reserva <b>{portasPorPainel} portas livres</b> a partir da <b>{portaBase}</b>, e '
        + 'a primeira aparece no cabecalho do painel. Isso e o que permite subir o dev de duas features '
        + 'do mesmo projeto sem uma derrubar a outra.'),
      p('As portas chegam ao terminal como variaveis de ambiente:'),
      tabela(['Variavel', 'Para que serve'], [
        ['<code>PORT</code>', 'A convencao que Next, Nest e Express ja leem sozinhos.'],
        ['<code>ORQ_PORTA</code>', 'A mesma porta, com nome explicito.'],
        ['<code>ORQ_PORTAS</code>', 'As {portasPorPainel} separadas por virgula, para monorepo que sobe varios apps.'],
      ]),
      aviso('Metade do trabalho fica no seu projeto: ele precisa LER a variavel. Veja a tabela abaixo.'),
      tabela(['Stack', 'O que fazer no projeto'], [
        ['Next', 'O <code>next dev</code> ja respeita <code>PORT</code>. Um <code>-p 3001</code> fixo no script <b>vence</b> a variavel e precisa sair.'],
        ['Vite', 'Ignora <code>PORT</code>. Use <code>vite --port %PORT%</code>, ou leia <code>process.env.PORT</code> no vite.config.'],
        ['Nest / Express', 'Garanta <code>app.listen(process.env.PORT ?? 3000)</code>.'],
        ['Turborepo', 'Cada app pega uma posicao de <code>ORQ_PORTAS</code>.'],
      ]),
    ],
  },
  {
    id: 'ligacoes',
    titulo: 'Ligar sessoes de repositorios diferentes',
    blocos: [
      p('Para uma feature que mexe no backend e no frontend ao mesmo tempo, em repositorios separados: '
        + 'o botao <b>ligar</b> no cabecalho do painel da a esta sessao acesso ao codigo da outra. '
        + 'Elas param de reexplicar o contrato da API uma para a outra.'),
      lista([
        'Ligar a <b>outro painel aberto</b> e <b>mutuo</b>: cada lado enxerga o repositorio do outro.',
        'Ligar a um <b>projeto cadastrado sem painel</b> e <b>so de ida</b>, porque nao ha sessao do outro lado.',
        'Numa sessao ja rodando o app usa <code>/add-dir</code>, e voce ve o comando e a confirmacao acontecerem no terminal.',
      ]),
      aviso('Desligar tira o registro dos dois lados, mas a sessao que ja esta rodando so perde o acesso '
        + 'ao ser reiniciada — nao existe comando para remover um diretorio de uma sessao viva.'),
    ],
  },
  {
    id: 'grade',
    titulo: 'A grade de paineis',
    blocos: [
      lista([
        'Ate 4 paineis a grade usa 2 colunas; acima disso, 3.',
        'Cada painel tem altura minima; com muitos paineis a grade <b>rola</b> em vez de espremer todo mundo.',
        'Painel fora da area visivel <b>para de desenhar</b> e guarda a saida, escrevendo tudo de uma vez quando volta. Nada se perde.',
        'A etiqueta <code>webgl</code> ou <code>canvas</code> mostra o renderizador. As vagas de WebGL vao para os paineis visiveis.',
        'Clicar num painel da foco; so o painel focado recebe o teclado. O <b>×</b> fecha e mata o processo de verdade.',
      ]),
    ],
  },
  {
    id: 'fila',
    titulo: 'A fila de partida',
    blocos: [
      p('Varias sessoes do Claude partindo ao mesmo tempo saturam a maquina. Quando ja ha <b>{tetoFila} '
        + 'sessoes rodando</b>, a proxima fica retida e o painel mostra <b>na fila</b>; ela parte sozinha '
        + 'quando abrir vaga.'),
      p('Voce nunca fica preso atras disso: <b>clicar na etiqueta</b> comeca na hora, e uma espera longa '
        + 'demais parte por conta propria.'),
    ],
  },
  {
    id: 'fechar',
    titulo: 'Fechar, reabrir e atualizar',
    blocos: [
      p('O arranjo de paineis e salvo. Ao reabrir, eles voltam <b>adormecidos</b>, com um botao de '
        + 'retomar em cada um e um <b>Retomar todas</b> na lateral — nada sobe sozinho sem voce pedir.'),
      p('Fechar o app com sessao rodando pede confirmacao, dizendo quantas serao interrompidas.'),
      p('Quando sai versao nova, o aviso aparece no rodape da lateral. Na versao portatil o botao abre a '
        + 'pagina da release para voce baixar o zip novo; na instalada, ele aplica e reinicia.'),
      p('Seus dados ficam em <code>{pastaDados}</code>, fora da pasta do app: projetos, arranjo de '
        + 'paineis e a porta do servidor de eventos. Trocar a pasta do app nao perde nada.'),
    ],
  },
  {
    id: 'atalhos',
    titulo: 'Atalhos',
    blocos: [
      tabela(['Tecla', 'O que faz'], [
        ['<kbd>Ctrl</kbd>+<kbd>Enter</kbd>', 'Pula para a sessao que espera ha mais tempo'],
        ['<kbd>F1</kbd>', 'Abre esta ajuda'],
        ['<kbd>Esc</kbd>', 'Fecha esta ajuda ou o seletor de ligacoes'],
        ['<kbd>Enter</kbd> no campo de feature', 'Mesmo que clicar em "Novo painel"'],
      ]),
    ],
  },
  {
    id: 'problemas',
    titulo: 'Quando algo nao funciona',
    blocos: [
      tabela(['Sintoma', 'Causa provavel'], [
        ['As bolinhas nao mudam de cor', 'Os hooks nao estao instalados. Use o botao no rodape da lateral.'],
        ['O dev server subiu na porta errada', 'O projeto nao le a variavel <code>PORT</code>. Veja a secao de portas.'],
        ['A aplicacao nao sobe dentro do worktree', 'Falta o <code>.worktreeinclude</code> com o <code>.env</code>.'],
        ['Nao consigo arquivar um worktree', 'A etiqueta dele diz o motivo: sessao viva, alteracao sem commit ou commit fora da base.'],
        ['O painel abriu mas o comando nao rodou', 'Pode estar na fila de partida. A etiqueta <b>na fila</b> aparece no cabecalho; clique nela para comecar agora.'],
      ]),
      p('O servidor que recebe os avisos do Claude Code escuta em <code>127.0.0.1:{portaEventos}</code>, '
        + 'so nesta maquina. Com o app fechado, os hooks falham em silencio e nao atrapalham suas sessoes.'),
    ],
  },
];

// ------------------------------------------------------------ renderizacao

function preencher(texto) {
  return String(texto).replace(/\{(\w+)\}/g, (_, chave) =>
    (constantes[chave] !== undefined ? constantes[chave] : `{${chave}}`));
}

function montarBloco(b) {
  if (b.tipo === 'p') {
    const el = document.createElement('p');
    el.innerHTML = preencher(b.texto);
    return el;
  }
  if (b.tipo === 'aviso') {
    const el = document.createElement('p');
    el.className = 'ajuda-aviso';
    el.innerHTML = preencher(b.texto);
    return el;
  }
  if (b.tipo === 'lista' || b.tipo === 'passos') {
    const el = document.createElement(b.tipo === 'passos' ? 'ol' : 'ul');
    el.className = b.tipo === 'passos' ? 'ajuda-passos' : 'ajuda-lista';
    for (const item of b.itens) {
      const li = document.createElement('li');
      li.innerHTML = preencher(item);
      el.append(li);
    }
    return el;
  }
  if (b.tipo === 'tabela') {
    const el = document.createElement('table');
    el.className = 'ajuda-tabela';
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const c of b.cabecalho) {
      const th = document.createElement('th');
      th.textContent = c;
      tr.append(th);
    }
    thead.append(tr);
    const tbody = document.createElement('tbody');
    for (const linha of b.linhas) {
      const l = document.createElement('tr');
      for (const celula of linha) {
        const td = document.createElement('td');
        td.innerHTML = preencher(celula);
        l.append(td);
      }
      tbody.append(l);
    }
    el.append(thead, tbody);
    return el;
  }
  return document.createElement('span');
}

function desenharAjuda() {
  // O indice sai das MESMAS secoes que o corpo: nao ha como um ficar sem o outro.
  elAjudaIndice.replaceChildren(...SECOES.map((s) => {
    const li = document.createElement('li');
    const a = document.createElement('button');
    a.textContent = s.titulo;
    a.dataset.para = s.id;
    a.addEventListener('click', () => {
      document.getElementById(`ajuda-sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      marcarAtivo(s.id);
    });
    li.append(a);
    return li;
  }));

  elAjudaCorpo.replaceChildren(...SECOES.map((s) => {
    const sec = document.createElement('section');
    sec.id = `ajuda-sec-${s.id}`;
    sec.className = 'ajuda-secao';
    const h = document.createElement('h3');
    h.textContent = s.titulo;
    sec.append(h, ...s.blocos.map(montarBloco));
    return sec;
  }));
}

function marcarAtivo(id) {
  for (const b of elAjudaIndice.querySelectorAll('button')) {
    b.classList.toggle('ativo', b.dataset.para === id);
  }
}

async function abrirAjuda(secao) {
  try {
    const c = await window.orq.constantes();
    constantes = { ...constantes, ...c };
  } catch { /* usa os padroes */ }
  constantes.tetoFila = window.OrqFila?.TETO_RODANDO ?? 4;

  desenharAjuda();
  elAjuda.hidden = false;
  elAjudaCorpo.scrollTop = 0;
  marcarAtivo(secao || SECOES[0].id);
  if (secao) document.getElementById(`ajuda-sec-${secao}`)?.scrollIntoView({ block: 'start' });
}

function fecharAjuda() {
  elAjuda.hidden = true;
}

btnAjuda?.addEventListener('click', () => abrirAjuda());
btnAjudaFechar?.addEventListener('click', fecharAjuda);
elAjuda?.addEventListener('click', (ev) => { if (ev.target === elAjuda) fecharAjuda(); });

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'F1') { ev.preventDefault(); elAjuda.hidden ? abrirAjuda() : fecharAjuda(); }
  if (ev.key === 'Escape' && !elAjuda.hidden) fecharAjuda();
});

// Quem chega numa grade vazia precisa saber por onde comecar.
document.getElementById('vazio-ajuda')?.addEventListener('click', (ev) => {
  ev.preventDefault();
  abrirAjuda('comecar');
});

window.OrqAjuda = { abrir: abrirAjuda, fechar: fecharAjuda, SECOES, constantes: () => constantes };
