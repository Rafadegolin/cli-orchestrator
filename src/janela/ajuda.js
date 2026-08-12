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
  minutosUso: 5,
};

const p = (texto) => ({ tipo: 'p', texto });
const aviso = (texto) => ({ tipo: 'aviso', texto });
const passos = (itens) => ({ tipo: 'passos', itens });
const lista = (itens) => ({ tipo: 'lista', itens });
const tabela = (cabecalho, linhas) => ({ tipo: 'tabela', cabecalho, linhas });
// O bloco `key` do doc 04: tecla em caixa mono e a descricao ao lado. So para
// atalhos -- os outros assuntos continuam em tabela, que carrega duas colunas
// de significado e viraria lista sem sentido.
const teclas = (pares) => ({ tipo: 'teclas', pares });

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
        '<b>Cadastre um projeto</b> no <b>+</b> da seção PROJETOS: escolha a pasta do repositório. '
          + 'Se você tem vários, <b>Várias…</b> aceita escolher tudo de uma vez, e cada um já sai '
          + 'com sua própria faixa de portas.',
        '<b>Digite o nome da feature</b> no campo de cima e <b>clique no projeto</b>. '
          + 'O painel abre e o Claude sobe sozinho.',
      ]),
      aviso('Sem os hooks o app funciona, mas os status ficam parados — e é o status que faz a grade '
        + 'valer a pena. O app pergunta antes de editar o <code>{arquivoHooks}</code>, faz backup e '
        + 'preserva o que já estiver lá. Se o botão disser <b>desatualizados</b>, é porque o app '
        + 'passou a registrar mais eventos do que os que estão lá: clique para registrar de novo.'),
    ],
  },
  {
    id: 'sessoes',
    titulo: 'Abrir sessões',
    blocos: [
      p('Clicar num projeto abre um painel na pasta dele e roda o Claude. O que roda depende do campo '
        + 'de feature:'),
      tabela(['Campo do nome', 'O que acontece'], [
        ['com nome', 'Roda <code>claude -w nome</code>: cria um worktree isolado. O nome é limpo '
          + 'automaticamente (acento e símbolo viram tracinho), porque ele vira nome de branch. '
          + 'A dica ao lado do campo mostra o nome exato do worktree e do branch antes de você clicar.'],
        ['vazio', 'Roda <code>claude</code> na pasta do projeto, sem worktree.'],
      ]),
      aviso('O <b>branch</b> criado se chama <code>worktree-&lt;nome&gt;</code>. Esse prefixo é do '
        + 'próprio Claude Code — a flag <code>-w</code> aceita só o nome, e não o nome do branch. '
        + 'O app mostra o resultado na dica em vez de esconder.'),
      p('<b>Nova sessão</b> (ou <b>Enter</b> no campo de feature) abre no último projeto que você '
        + 'usou. <b>Painel avulso</b> abre um seletor de pasta, para trabalhar em qualquer lugar '
        + 'sem cadastrar projeto.'),
      p('Projeto que não é repositório git aparece com a etiqueta <b>sem git</b> e nunca recebe '
        + '<code>-w</code> — worktree exige git.'),
      p('<b>Se o Claude já conversou naquela pasta antes</b>, clicar no projeto pergunta se você '
        + 'quer uma sessão nova ou retomar uma anterior. Retomar roda <code>claude -r</code>, que '
        + 'abre o seletor de conversas do próprio Claude dentro do painel — quem escolhe qual é '
        + 'você. Sem conversa guardada não há pergunta: abre nova direto.'),
      p('<b>Arrastar um arquivo para cima de um terminal</b> escreve o caminho dele na caixa de '
        + 'entrada do Claude, entre aspas. Serve para documento, print, o que for. <b>Nada é '
        + 'enviado</b>: o Enter continua sendo seu, então dá para escrever a pergunta junto e um '
        + 'arrasto sem querer não custa nada.'),
    ],
  },
  {
    id: 'status',
    titulo: 'As bolinhas de status',
    blocos: [
      p('Vêm dos hooks do Claude Code, não de ler o texto do terminal. Por isso são confiáveis e '
        + 'mudam em menos de um décimo de segundo, mesmo com o painel fora da tela.'),
      tabela(['Cor', 'Significa'], [
        ['<span class="ajuda-bolinha bolinha-esperando"></span> amarela', '<b>Tem uma pergunta te bloqueando</b>: permissão ou uma resposta. Só isso é amarelo, e é o único estado que entra na fila e notifica.'],
        ['<span class="ajuda-bolinha bolinha-rodando"></span> verde', 'Trabalhando.'],
        ['<span class="ajuda-bolinha bolinha-terminou"></span> azul', 'Terminou; pronto para você revisar.'],
        ['<span class="ajuda-bolinha bolinha-parada"></span> apagada', 'Acabou e ficou parada, sem nada pendente. Não te chama.'],
        ['<span class="ajuda-bolinha bolinha-encerrada"></span> cinza', 'Sessão encerrada.'],
        ['<span class="ajuda-bolinha bolinha-dormindo"></span> vazada', 'Sessão salva da última vez que você fechou o app, esperando você retomar.'],
      ]),
      p('Ao lado da bolinha vem sempre o texto — <b>trabalhando</b>, <b>esperando há 12min</b>, '
        + '<b>pronto para revisar</b>, <b>parada há 40min</b>, <b>sessão salva</b>. A cor acelera '
        + 'quem já conhece; o texto ensina quem está chegando. O motivo exato do Claude fica no '
        + 'balão ao passar o mouse.'),
      aviso('<b>Amarelo significa uma coisa só: alguém travado te esperando.</b> Uma sessão que '
        + 'apenas terminou e ficou parada não fica amarela — ela era, e isso enchia a fila de '
        + 'sessões que não pediam nada. Quando aparece amarelo, é porque tem pergunta.'),
    ],
  },
  {
    id: 'lateral',
    titulo: 'A barra lateral e a fila de atenção',
    blocos: [
      p('O bloco <b>ESPERANDO VOCÊ</b> aparece no topo da lateral assim que alguma sessão para te '
        + 'esperando, com o tempo de cada uma. Ele some sozinho quando a última é atendida — fila '
        + 'vazia não ocupa espaço.'),
      lista([
        'A fila é sempre por <b>quem espera há mais tempo</b>, mesmo com a grade ordenada por projeto.',
        '<b>Ctrl+Enter</b> pula direto para a mais antiga e já põe o cursor lá.',
        'Clicar num item da fila (ou num card de SESSÕES) foca o painel correspondente.',
        'Quando o app não está em primeiro plano, uma <b>notificação do sistema</b> avisa.',
      ]),
      p('A lista de SESSÕES segue a mesma ordem da grade, e o placar no alto mostra quantas sessões '
        + 'estão vivas e quanto do processador o app está usando.'),
    ],
  },
  {
    id: 'aprovar',
    titulo: 'Aprovar sem entrar no terminal',
    blocos: [
      p('Quando o Claude pede permissão para alguma coisa, a pergunta aparece no <b>rodapé do '
        + 'painel</b>, com os botões <b>Aprovar</b> e <b>Ver</b>. O caso mais comum de interação '
        + 'deixa de exigir que você entre no terminal e digite.'),
      lista([
        '<b>Aprovar</b> responde <code>1. Yes</code> ao pedido que está na tela — nunca a opção de '
          + '"não perguntar mais", que mudaria o comportamento da sessão inteira.',
        '<b>Ver</b> só leva o cursor até o terminal, sem responder nada.',
        'Sessão que parou apenas <b>ociosa</b> aparece sem o botão: ali não há o que aprovar, ela '
          + 'está esperando você digitar.',
      ]),
      aviso('O app confere o pedido na tela do terminal antes de responder. Se ele não achar — '
        + 'porque você já respondeu por lá, por exemplo — <b>não escreve nada</b>: leva você ao '
        + 'painel e avisa. Aprovar nunca acontece às cegas.'),
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
      p('Cada painel reserva <b>{portasPorPainel} portas livres</b>, e a primeira aparece no '
        + 'cabeçalho do painel. Isso é o que permite subir o dev de duas features do mesmo projeto '
        + 'sem uma derrubar a outra.'),
      p('A faixa é <b>escolhida por projeto</b> na hora de cadastrar, e vale também para os '
        + 'worktrees dele. Assim dois projetos rodando ao mesmo tempo nem chegam perto um do outro. '
        + 'Projeto cadastrado sem escolher faixa usa a padrão, a partir da <b>{portaBase}</b>.'),
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
      p('<b>Quando o repositório fica para trás:</b> se o merge acontece no servidor enquanto você '
        + 'trabalha numa worktree, o checkout principal envelhece sem avisar — e as worktrees novas '
        + 'nascem a partir dele. O app busca do remoto de tempos em tempos e, quando há atraso, '
        + 'mostra <b>&lt;branch&gt; está N commits atrás</b> ao expandir o projeto, com um botão '
        + 'para atualizar. A atualização é sempre <b>fast-forward</b>: se não der, ela recusa em vez '
        + 'de criar merge ou conflito no seu checkout.'),
    ],
  },
  {
    id: 'grade',
    titulo: 'A grade: densidade, ordem e tema',
    blocos: [
      p('À direita da barra de cima ficam as duas escolhas que mudam a cara da grade, e as duas '
        + 'são lembradas entre execuções:'),
      tabela(['Controle', 'O que faz'], [
        ['Urgência / Projeto', 'Ordena a grade e a lista de sessões. Em <b>Urgência</b>, quem espera '
          + 'vem primeiro; em <b>Projeto</b>, agrupa por repositório.'],
        ['1 · 2 · 3', 'Quantas colunas. Cada densidade tem uma altura fixa de painel, para a grade '
          + 'ficar previsível. Na 3 o rótulo de status some e a bolinha assume.'],
        ['P', 'O slot personalizado: aqui cada painel pode ter um tamanho diferente. Arraste a '
          + '<b>alça do canto inferior direito</b> e ele cresce em colunas e linhas da grade — por '
          + 'exemplo dois terminais grandes lado a lado e dois pequenos dividindo a terceira coluna.'],
      ]),
      aviso('O personalizado é um <b>molde por posição</b>, e não um tamanho preso a uma sessão: ele '
        + 'guarda "o primeiro painel é grande, o terceiro é pequeno". Com a ordenação por '
        + '<b>Urgência</b> a forma da tela fica parada, mas quem ocupa o slot grande muda conforme os '
        + 'status mudam. Para redefinir, procure <b>layout</b> na paleta.'),
      p('O botão de tema fica na barra de título, ao lado da busca. O <b>terminal continua escuro '
        + 'nos dois temas</b>: código monoespaçado sobre fundo claro atrapalha a leitura.'),
      p('No canto esquerdo da barra de título, o primeiro botão <b>recolhe a barra lateral</b> '
        + '(<b>Ctrl+B</b>), e a grade ocupa o espaço dela — os terminais refluem sozinhos. A escolha '
        + 'é lembrada. Com ela recolhida, a fila de atenção continua alcançável por <b>Ctrl+Enter</b> '
        + 'e o resto pela paleta; se sair versão nova, uma bolinha acende no próprio botão, porque '
        + 'o aviso de atualização mora lá dentro.'),
      p('Cada painel tem uma <b>faixa colorida no topo</b> com a cor do projeto — worktrees do mesmo '
        + 'projeto usam um tom mais claro da mesma cor, para se lerem como parentes. A mesma cor '
        + 'aparece à esquerda de cada item na lista de sessões. Para trocar, <b>clique no quadradinho '
        + 'de cor</b> ao lado do nome do projeto: os tons já usados por outro projeto vêm marcados.'),
      lista([
        'Com muitos painéis a grade <b>rola</b> em vez de espremer todo mundo.',
        '<b>Alt+setas</b> pulam para o terminal ao lado, acima ou abaixo — sem tirar a mão do teclado.',
        'O painel em que você está <b>não muda de lugar</b> quando outra sessão passa a esperar.',
        'Painel fora da área visível <b>para de desenhar</b> e guarda a saída, escrevendo tudo de uma vez quando volta. Nada se perde.',
        'Clicar num painel dá foco; só o painel focado recebe o teclado. O <b>×</b> fecha e mata o processo de verdade.',
      ]),
    ],
  },
  {
    id: 'mapa',
    titulo: 'O mapa: painéis onde você quiser',
    blocos: [
      p('<b>Mapa</b>, ao lado de <b>Grade</b> na barra de cima, troca a grade por uma superfície onde '
        + 'cada painel tem lugar e tamanho próprios — e as <b>ligações entre sessões viram linhas</b> '
        + 'desenhadas entre elas. São os mesmos painéis: trocar de modo não reinicia nada.'),
      tabela(['Gesto', 'O que faz'], [
        ['Arrastar o cabeçalho', 'Move o painel. O corpo não move nada: ali é o terminal, e arrastar '
          + 'dali roubaria a seleção de texto.'],
        ['Arrastar a alça do canto', 'Redimensiona, como uma janela. O terminal <b>reflui</b> — ganha '
          + 'ou perde colunas de verdade, em vez de esticar a imagem.'],
        ['Visão geral', 'Troca os painéis por cartões para você ver o conjunto. O terminal não é '
          + 'encolhido, é trocado: escalar borraria o texto.'],
      ]),
      p('Posição e tamanho <b>encaixam de 20 em 20 pixels</b>, na mesma malha das bolinhas do fundo — '
        + 'por isso os painéis ficam alinhados entre si sem você mirar. Tudo é lembrado junto com o '
        + 'arranjo: fechar e reabrir o app devolve o mapa como você deixou.'),
      p('No mapa somem a densidade e a ordenação: nenhuma das duas tem efeito sobre painel posicionado '
        + 'à mão, e controle que não faz nada é pior que controle ausente.'),
    ],
  },
  {
    id: 'paleta',
    titulo: 'A paleta de comandos',
    blocos: [
      p('<b>Ctrl+K</b> (ou o campo de busca na barra de título) abre a paleta: um lugar só para '
        + 'chegar a qualquer sessão, projeto ou ação, sem procurar na tela.'),
      lista([
        'Digite parte do nome de uma sessão para pular direto para ela.',
        'A busca <b>ignora acento</b>: procurar por <code>sessao</code> acha "sessão".',
        'Setas para navegar, <b>Enter</b> para executar o primeiro, <b>Esc</b> para fechar.',
      ]),
    ],
  },
  {
    id: 'uso',
    titulo: 'Quanto do seu Claude já foi',
    blocos: [
      p('O medidor no topo mostra duas coisas: <b>5h</b> é a janela da sessão atual e <b>7d</b> é a '
        + 'semana. São da <b>conta inteira</b> — incluem o que você gastou fora deste app. É o mesmo '
        + 'que o <code>/usage</code> responde dentro de um painel, sem você precisar entrar em um.'),
      p('<b>Clique nele</b> (ou procure "uso" na paleta) para ver as duas barras grandes com a hora '
        + 'do reset de cada uma.'),
      aviso('Se aparecer <b>—</b> no lugar da porcentagem, é porque a consulta não foi: sem internet, '
        + 'ou com a credencial do Claude vencida — abrir uma sessão renova. O app <b>não estima</b> '
        + 'esse número por conta própria. Ele consulta a cada {minutosUso} minutos, e só com a '
        + 'janela à vista.'),
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
      p('Quando sai versão nova, o aviso aparece no rodapé da lateral, e o botão <b>aplica e '
        + 'reinicia</b> — inclusive nos pacotes em pasta, que não têm instalador: ali o app baixa '
        + 'só o próprio código (alguns MB, não o pacote inteiro), confere a integridade e troca ao '
        + 'reiniciar.'),
      p('Quando a versão nova muda algo além do nosso código — o Electron, por exemplo —, a troca '
        + 'leve não serve, e aí o botão volta a levar você para a página da release dizendo por quê.'),
      p('Seus dados ficam em <code>{pastaDados}</code>, fora da pasta do app: projetos, arranjo de '
        + 'painéis e a porta do servidor de eventos. Trocar a pasta do app não perde nada.'),
    ],
  },
  {
    id: 'atalhos',
    titulo: 'Atalhos',
    blocos: [
      teclas([
        ['Ctrl+Enter', 'Pula para a sessão que espera há mais tempo'],
        ['Ctrl+K', 'Abre a paleta de comandos'],
        ['Ctrl+B', 'Recolhe ou mostra a barra lateral'],
        ['Alt+setas', 'Pula para o terminal ao lado, acima ou abaixo'],
        ['F1', 'Abre esta ajuda'],
        ['Esc', 'Fecha o que estiver aberto por cima'],
        ['1 2 3', 'Densidade da grade: 1, 2 ou 3 colunas'],
        ['4', 'O slot personalizado (a quarta pílula da barra)'],
        ['Enter', 'No campo de feature, o mesmo que <b>Nova sessão</b>'],
      ]),
      p('As teclas <b>1</b> a <b>4</b> são ignoradas enquanto você digita num campo de '
        + 'texto ou dentro de um terminal — só valem quando o teclado não está em uso.'),
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
        ['Cliquei em Aprovar e nada aconteceu', 'O pedido não estava mais na tela do terminal — provavelmente já foi respondido. O app avisa e leva você até lá em vez de responder às cegas.'],
        ['Fixei na barra de tarefas e virou o ícone do Electron', 'Fixar guarda um atalho para o executável, e no pacote compatível com o SAC o executável é o do próprio Electron. Use <b>Ctrl+K → Criar atalho no menu Iniciar</b> e fixe a partir dele.'],
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
  if (b.tipo === 'teclas') {
    const el = document.createElement('div');
    el.className = 'ajuda-teclas';
    for (const [k, texto] of b.pares) {
      const linha = document.createElement('div');
      linha.className = 'ajuda-tecla';
      const caixa = document.createElement('span');
      caixa.className = 'ajuda-tecla-caixa mono';
      caixa.textContent = k;
      const desc = document.createElement('span');
      desc.innerHTML = preencher(texto);
      linha.append(caixa, desc);
      el.append(linha);
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

// Esc e clique-fora vem do registro unico (casca.js), que fecha so o overlay
// do topo -- com a paleta aberta por cima da ajuda, um Esc nao pode fechar as
// duas de uma vez.
window.OrqOverlays?.registrar(elAjuda, fecharAjuda);

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'F1') { ev.preventDefault(); elAjuda.hidden ? abrirAjuda() : fecharAjuda(); }
});

// Quem chega numa grade vazia precisa saber por onde comecar.
document.getElementById('vazio-ajuda')?.addEventListener('click', (ev) => {
  ev.preventDefault();
  abrirAjuda('comecar');
});

window.OrqAjuda = { abrir: abrirAjuda, fechar: fecharAjuda, SECOES, constantes: () => constantes };
