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
      p('Ele mostra várias sessões do Claude Code ao mesmo tempo, numa grade, cada uma identificada '
        + 'pela feature, misturando projetos diferentes.'),
      lista([
        '<b>Ver todos os terminais de uma vez</b>, em vez de uma sessão por vez com lista lateral.',
        '<b>Saber na hora quem parou te esperando</b>, e há quanto tempo, pela bolinha de status.',
        '<b>Ordenar por urgência</b>, e não por repositório: quem espera há mais tempo aparece em cima.',
      ]),
      p('Cada sessão roda no próprio worktree, com a própria faixa de portas. Duas features do mesmo '
        + 'projeto não brigam pelos arquivos nem pela porta 3000.'),
    ],
  },
  {
    id: 'comecar',
    titulo: 'Primeiros passos',
    blocos: [
      passos([
        '<b>Instale os hooks</b> no botão "Hooks: instalar", no rodapé desta barra lateral. '
          + 'É o que faz as bolinhas mudarem sozinhas.',
        '<b>Cadastre um projeto</b> no <b>+</b> da seção PROJETOS: escolha a pasta do repositório.',
        '<b>Digite o nome da feature</b> no campo de cima e <b>clique no projeto</b>. '
          + 'O painel abre e o Claude sobe sozinho.',
      ]),
      aviso('Sem os hooks o app funciona, mas os status ficam parados — e é o status que faz a grade '
        + 'valer a pena. O app pergunta antes de editar o <code>{arquivoHooks}</code>, faz backup e '
        + 'preserva o que já estiver lá.'),
    ],
  },
  {
    id: 'sessoes',
    titulo: 'Abrir sessões',
    blocos: [
      p('Clicar num projeto abre um painel na pasta dele e roda o Claude. O que roda depende do campo '
        + 'de feature:'),
      tabela(['Campo de feature', 'O que acontece'], [
        ['com nome', 'Roda <code>claude -w nome</code>: cria um worktree isolado para a feature. '
          + 'O nome é limpo automaticamente (acento e símbolo viram tracinho), porque ele vira nome de branch.'],
        ['vazio', 'Roda <code>claude</code> na pasta do projeto, sem worktree.'],
      ]),
      p('O botão <b>Novo painel</b> abre um seletor de pasta, para abrir um painel avulso em qualquer '
        + 'lugar sem cadastrar projeto.'),
      p('Projeto que não é repositório git aparece com a etiqueta <b>sem git</b> e nunca recebe '
        + '<code>-w</code> — worktree exige git.'),
    ],
  },
  {
    id: 'status',
    titulo: 'As bolinhas de status',
    blocos: [
      p('Vêm dos hooks do Claude Code, não de ler o texto do terminal. Por isso são confiáveis e '
        + 'mudam em menos de um décimo de segundo, mesmo com o painel fora da tela.'),
      tabela(['Cor', 'Significa'], [
        ['<span class="ajuda-bolinha bolinha-esperando"></span> amarela', 'Parou te esperando: pedindo permissão, ou ociosa. O cronômetro conta desde quando.'],
        ['<span class="ajuda-bolinha bolinha-rodando"></span> verde', 'Trabalhando.'],
        ['<span class="ajuda-bolinha bolinha-terminou"></span> azul', 'Terminou; pronto para você revisar.'],
        ['<span class="ajuda-bolinha bolinha-encerrada"></span> cinza', 'Sessão encerrada, ou painel adormecido esperando você retomar.'],
      ]),
    ],
  },
  {
    id: 'lateral',
    titulo: 'A barra lateral e a fila',
    blocos: [
      p('A lista de SESSÕES é ordenada por <b>urgência</b>, não por projeto: primeiro quem espera há '
        + 'mais tempo, depois quem terminou, depois quem está rodando, por último quem parou.'),
      lista([
        'Clicar num card <b>foca o painel</b> correspondente.',
        '<b>Ctrl+Enter</b> pula direto para quem espera há mais tempo e já põe o cursor lá.',
        'Quando o app não está em primeiro plano, uma <b>notificação do sistema</b> avisa que alguém ficou amarelo.',
      ]),
    ],
  },
  {
    id: 'worktrees',
    titulo: 'Worktrees: retomar e arquivar',
    blocos: [
      p('A seta ao lado de cada projeto abre a lista dos worktrees existentes — o trabalho de ontem.'),
      lista([
        '<b>Clicar</b> abre um painel dentro do worktree continuando a última conversa dali.',
        'O <b>×</b> arquiva: remove a pasta do worktree e o branch.',
      ]),
      p('A etiqueta de cada worktree diz o que impede arquivá-lo:'),
      tabela(['Etiqueta', 'Por que não dá para arquivar'], [
        ['aberto agora', 'Há uma sessão do Claude viva nele.'],
        ['N alterados', 'Há arquivo modificado sem commit.'],
        ['N commits', 'Há commit que ainda não foi para o branch base.'],
        ['(sem etiqueta)', 'Está limpo: pode arquivar.'],
      ]),
      aviso('Arquivar não tem desfazer, então o app confere tudo de novo na hora de arquivar — e '
        + 'também se recusa se houver um painel deste app aberto naquela pasta.'),
    ],
  },
  {
    id: 'env',
    titulo: 'Arquivos que o worktree não leva',
    blocos: [
      p('Um worktree é um checkout limpo: arquivos ignorados pelo git, como o <code>.env</code>, não '
        + 'vão junto. Sem eles a aplicação não sobe lá dentro, e a feature nova parece quebrada sem motivo.'),
      p('Quando o app detecta essa situação, aparece um aviso na lista de worktrees com o botão de criar '
        + 'um <code>.worktreeinclude</code> listando o que copiar para cada worktree novo.'),
    ],
  },
  {
    id: 'portas',
    titulo: 'Portas: rodar dois servidores ao mesmo tempo',
    blocos: [
      p('Cada painel reserva <b>{portasPorPainel} portas livres</b> a partir da <b>{portaBase}</b>, e '
        + 'a primeira aparece no cabeçalho do painel. Isso é o que permite subir o dev de duas features '
        + 'do mesmo projeto sem uma derrubar a outra.'),
      p('As portas chegam ao terminal como variáveis de ambiente:'),
      tabela(['Variável', 'Para que serve'], [
        ['<code>PORT</code>', 'A convenção que Next, Nest e Express já leem sozinhos.'],
        ['<code>ORQ_PORTA</code>', 'A mesma porta, com nome explícito.'],
        ['<code>ORQ_PORTAS</code>', 'As {portasPorPainel} separadas por vírgula, para monorepo que sobe vários apps.'],
      ]),
      aviso('Metade do trabalho fica no seu projeto: ele precisa LER a variável. Veja a tabela abaixo.'),
      tabela(['Stack', 'O que fazer no projeto'], [
        ['Next', 'O <code>next dev</code> já respeita <code>PORT</code>. Um <code>-p 3001</code> fixo no script <b>vence</b> a variável e precisa sair.'],
        ['Vite', 'Ignora <code>PORT</code>. Use <code>vite --port %PORT%</code>, ou leia <code>process.env.PORT</code> no vite.config.'],
        ['Nest / Express', 'Garanta <code>app.listen(process.env.PORT ?? 3000)</code>.'],
        ['Turborepo', 'Cada app pega uma posição de <code>ORQ_PORTAS</code>.'],
      ]),
    ],
  },
  {
    id: 'ligacoes',
    titulo: 'Ligar sessões de repositórios diferentes',
    blocos: [
      p('Para uma feature que mexe no backend e no frontend ao mesmo tempo, em repositórios separados: '
        + 'o botão <b>ligar</b> no cabeçalho do painel dá a esta sessão acesso ao código da outra. '
        + 'Elas param de reexplicar o contrato da API uma para a outra.'),
      lista([
        'Ligar a <b>outro painel aberto</b> é <b>mútuo</b>: cada lado enxerga o repositório do outro.',
        'Ligar a um <b>projeto cadastrado sem painel</b> é <b>só de ida</b>, porque não há sessão do outro lado.',
        'Numa sessão já rodando o app usa <code>/add-dir</code>, e você vê o comando e a confirmação acontecerem no terminal.',
      ]),
      aviso('Desligar tira o registro dos dois lados, mas a sessão que já está rodando só perde o acesso '
        + 'ao ser reiniciada — não existe comando para remover um diretório de uma sessão viva.'),
    ],
  },
  {
    id: 'grade',
    titulo: 'A grade de painéis',
    blocos: [
      lista([
        'Até 4 painéis a grade usa 2 colunas; acima disso, 3.',
        'Cada painel tem altura mínima; com muitos painéis a grade <b>rola</b> em vez de espremer todo mundo.',
        'Painel fora da área visível <b>para de desenhar</b> e guarda a saída, escrevendo tudo de uma vez quando volta. Nada se perde.',
        'A etiqueta <code>webgl</code> ou <code>canvas</code> mostra o renderizador. As vagas de WebGL vão para os painéis visíveis.',
        'Clicar num painel dá foco; só o painel focado recebe o teclado. O <b>×</b> fecha e mata o processo de verdade.',
      ]),
    ],
  },
  {
    id: 'fila',
    titulo: 'A fila de partida',
    blocos: [
      p('Várias sessões do Claude partindo ao mesmo tempo saturam a máquina. Quando já há <b>{tetoFila} '
        + 'sessões rodando</b>, a próxima fica retida e o painel mostra <b>na fila</b>; ela parte sozinha '
        + 'quando abrir vaga.'),
      p('Você nunca fica preso atrás disso: <b>clicar na etiqueta</b> começa na hora, e uma espera longa '
        + 'demais parte por conta própria.'),
    ],
  },
  {
    id: 'fechar',
    titulo: 'Fechar, reabrir e atualizar',
    blocos: [
      p('O arranjo de painéis é salvo. Ao reabrir, eles voltam <b>adormecidos</b>, com um botão de '
        + 'retomar em cada um e um <b>Retomar todas</b> na lateral — nada sobe sozinho sem você pedir.'),
      p('Fechar o app com sessão rodando pede confirmação, dizendo quantas serão interrompidas.'),
      p('Quando sai versão nova, o aviso aparece no rodapé da lateral. Na versão portátil o botão abre a '
        + 'página da release para você baixar o zip novo; na instalada, ele aplica e reinicia.'),
      p('Seus dados ficam em <code>{pastaDados}</code>, fora da pasta do app: projetos, arranjo de '
        + 'painéis e a porta do servidor de eventos. Trocar a pasta do app não perde nada.'),
    ],
  },
  {
    id: 'atalhos',
    titulo: 'Atalhos',
    blocos: [
      tabela(['Tecla', 'O que faz'], [
        ['<kbd>Ctrl</kbd>+<kbd>Enter</kbd>', 'Pula para a sessão que espera há mais tempo'],
        ['<kbd>F1</kbd>', 'Abre esta ajuda'],
        ['<kbd>Esc</kbd>', 'Fecha esta ajuda ou o seletor de ligações'],
        ['<kbd>Enter</kbd> no campo de feature', 'Mesmo que clicar em “Novo painel”'],
      ]),
    ],
  },
  {
    id: 'problemas',
    titulo: 'Quando algo não funciona',
    blocos: [
      tabela(['Sintoma', 'Causa provável'], [
        ['As bolinhas não mudam de cor', 'Os hooks não estão instalados. Use o botão no rodapé da lateral.'],
        ['O dev server subiu na porta errada', 'O projeto não lê a variável <code>PORT</code>. Veja a seção de portas.'],
        ['A aplicação não sobe dentro do worktree', 'Falta o <code>.worktreeinclude</code> com o <code>.env</code>.'],
        ['Não consigo arquivar um worktree', 'A etiqueta dele diz o motivo: sessão viva, alteração sem commit ou commit fora da base.'],
        ['O painel abriu mas o comando não rodou', 'Pode estar na fila de partida. A etiqueta <b>na fila</b> aparece no cabeçalho; clique nela para começar agora.'],
      ]),
      p('O servidor que recebe os avisos do Claude Code escuta em <code>127.0.0.1:{portaEventos}</code>, '
        + 'só nesta máquina. Com o app fechado, os hooks falham em silêncio e não atrapalham suas sessões.'),
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
