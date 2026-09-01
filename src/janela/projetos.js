'use strict';

// Cadastro de projetos na lateral. Um clique abre painel na pasta certa com o
// Claude ja subindo, em vez de navegar no dialogo nativo e digitar toda vez.
//
// Nomes prefixados de proposito: painel.js, grade.js, lateral.js e este arquivo
// sao scripts classicos e dividem UM escopo lexico global -- repetir um nome de
// topo entre eles e SyntaxError e derruba o arquivo inteiro em silencio.

const elProjetosLista = document.getElementById('projetos-lista');
const elProjetosContagem = document.getElementById('projetos-contagem');
const btnProjetoAdd = document.getElementById('btn-projeto-add');
const elFeatureProjeto = document.getElementById('nome-feature');

// Marcas de acentuacao que sobram do normalize('NFD'). Construido a partir de
// string para o arquivo nao guardar caracteres combinantes literais, que sao
// invisiveis no editor e se perdem em qualquer edicao futura.
const ACENTOS = new RegExp('[\u0300-\u036f]', 'g');

let projetosCache = [];

// "Nova sessao" precisa saber em QUAL projeto. O ultimo que voce abriu e o
// palpite certo na esmagadora maioria das vezes -- e quando nao for, clicar no
// projeto na lateral continua sendo um clique.
let ultimoProjetoId = null;

// Identidade visual do projeto, estavel entre execucoes: a mesma pasta tem
// sempre a mesma cor. Hash simples do caminho -- nao precisa ser criptografia,
// precisa ser reproduzivel.
// Paleta PROPRIA (estilo.css, `--proj-1..10`), e nao mais os tokens de status.
// Antes esta lista era ['var(--acc)', 'var(--info)', 'var(--warn)', ...]: um
// projeto podia nascer com a cor de "rodando" e outro com a de "esperando", e
// cor que significa duas coisas nao significa nenhuma.
const TINTAS = Array.from({ length: 10 }, (_, i) => `var(--proj-${i + 1})`);

// O hash e sobre o caminho em minusculas: `projetoDe` ja casa sem diferenciar
// caixa, e sem isto a MESMA pasta cadastrada com outra grafia mudava de cor.
function tintaDe(caminho) {
  const chave = String(caminho || '').toLowerCase();
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) >>> 0;
  return TINTAS[h % TINTAS.length];
}

// A cor de um PROJETO: a escolhida a mao, se houver; senao a sorteada.
//
// Sortear por hash e estavel, mas nao evita colisao: com dez tons, duas pastas
// caindo na mesma cor e questao de tempo. Projeto novo ja nasce com a cor menos
// usada (o principal cuida disso); esta funcao e o que faz a escolha manual
// valer mais que o sorteio.
function tintaDoProjeto(p) {
  return p && p.cor ? `var(--proj-${p.cor})` : tintaDe(p?.caminho || '');
}

// A cor de uma PASTA: a do projeto quando e a raiz, e um tom mais claro da
// mesma familia quando esta dentro dele (worktree, subpasta).
//
// Mesma familia de proposito: `api` e `api/auth-refresh` tem de se ler como
// parentes, e nao como dois projetos diferentes. O `color-mix` faz isso sem
// precisar de uma segunda paleta -- e clareia contra o fundo do painel, entao
// funciona nos dois temas com uma linha so.
function tintaDaPasta(caminho) {
  const p = projetoDe(caminho);
  if (!p) return '';
  return p.dentro ? `color-mix(in srgb, ${p.tinta} 55%, var(--bg1))` : p.tinta;
}

// Declarados aqui em cima, junto do resto do estado: desenharProjetos() os usa
// e ficar dependendo da ordem de avaliacao para nao cair na zona morta e o tipo
// de coisa que quebra na primeira reordenacao inocente.
const expandidos = new Set();
const detalhes = new Map(); // id -> { carregando, worktrees, include }

// caminho achatado -> { ok, base, upstream, atras, frente }, empurrado pelo
// processo principal no canal `git:estado`.
//
// A busca do remoto morava AQUI, num setInterval do renderer com
// `if (document.hidden) return;` -- que pulava o tique sem reagendar, entao um
// tique perdido custava dez minutos e abrir o app minimizado empurrava o
// primeiro fetch para 10min20s. Agora o relogio e do `src/main/remoto.js`, que
// tem os eventos de janela que o renderer nao tem.
const gitPorProjeto = new Map();

function atrasoDe(caminho) {
  const s = gitPorProjeto.get(achatarCaminho(caminho));
  return s && s.atras > 0 ? s : null;
}

// Transforma o nome digitado em algo seguro para DOIS destinos perigosos ao
// mesmo tempo:
//   1. uma linha de comando de shell -- "feature & shutdown -s" executaria o
//      segundo comando;
//   2. um nome de branch do git, que rejeita espaco, ~, ^, :, ?, *, [ e afins.
// Sobra so [A-Za-z0-9._-], sem acento, sem repeticao de separador.
function slugFeature(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(ACENTOS, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 60)
    .replace(/[-._]+$/g, '');
}

// O `limpar()` do OrqShell e `cls` no Windows e `clear` no macOS. Nao e
// detalhe: em bash/zsh o `cls && claude` CURTO-CIRCUITA -- o `cls` falha, o
// `&&` corta, e o Claude nunca sobe. O `&&` em si vale nos dois shells.
//
// O cmd.exe custa dezenas de ms para abrir, contra centenas do PowerShell -- e
// o que segura a meta de abertura no Windows.
// O `--name` e NOSSO, e nao do worktree.
//
// Medido contra o CLI 2.1.227: `-n, --name <name>` e independente do `-w` (o
// "(requires --worktree)" que aparece perto no `--help` e do `--tmux`), os dois
// convivem, e o registro que o CLI mantem em `~/.claude/sessions/<pid>.json`
// passa a gravar o nome dado -- sem ele vem um `nameSource: "derived"` com um
// nome que o proprio CLI inventa.
//
// Ganho concreto: o titulo do terminal, a caixa de prompt e o seletor do
// `/resume` passam a dizer a feature. Nao confundir com o nome do BRANCH, que
// continua sendo `worktree-<slug>` e nao tem como ser escolhido.
//
// `worktree: false` e para quem JA esta dentro de uma worktree pronta -- a
// implementacao dupla, onde o app criou as duas antes de abrir o painel. Ali o
// `-w` criaria uma SEGUNDA worktree dentro da primeira. Fica como opcao daqui,
// e nao como string montada la, para um lugar so continuar sabendo a forma do
// comando.
function montarComando(feature, ehGit, { worktree = true } = {}) {
  const slug = slugFeature(feature);
  const limpa = window.OrqShell.limpar();
  if (!slug) return `${limpa} && claude`;
  // Sem repositorio git nao existe worktree: `claude -w` falharia e o usuario
  // veria so um erro no terminal sem entender por que. O nome, esse, vale
  // igual.
  if (!ehGit || !worktree) return `${limpa} && claude --name ${slug}`;
  return `${limpa} && claude --name ${slug} -w ${slug}`;
}

// Caminho comparavel: separador unico, sem barra no fim, minusculo.
//
// Sem normalizar `\` e `/` a comparacao vira loteria -- o mesmo caminho vindo
// por outra rota (o git imprime com barra normal, um dialogo devolve com barra
// invertida) deixava de casar, e o projeto sumia sem erro nenhum. O
// `OrqLigacoes.normalizar` ja fazia isso; aqui faltava.
function achatarCaminho(p) {
  return String(p || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

// A qual projeto uma pasta pertence. Casa pelo prefixo MAIS ESPECIFICO: um
// worktree vive em <projeto>/.claude/worktrees/<feat>, e com dois projetos
// aninhados o de dentro tem de ganhar.
function projetoDe(caminho) {
  const alvo = achatarCaminho(caminho);
  if (!alvo) return null;

  let melhor = null;
  for (const p of projetosCache) {
    const base = achatarCaminho(p.caminho);
    const dentro = alvo === base || alvo.startsWith(`${base}/`);
    if (dentro && (!melhor || base.length > melhor.base.length)) {
      melhor = {
        base,
        nome: p.nome,
        caminho: p.caminho,
        tinta: tintaDoProjeto(p),
        // `dentro` distingue a raiz do projeto de uma pasta abaixo dela --
        // worktree, quase sempre. A informacao ja estava aqui e ninguem usava.
        dentro: alvo !== base,
      };
    }
  }
  return melhor;
}

async function carregarProjetos() {
  projetosCache = await window.orq.projetosListar();
  desenharProjetos();
  // A lista chega depois dos painéis restaurados: sem isto o cabecalho deles
  // ficaria com o nome da pasta ate alguem reabrir o app.
  for (const p of window.OrqPainel?.painelPorId?.values() || []) p.mostrarProjeto?.();
  window.OrqLateral?.redesenhar?.();
  return projetosCache;
}

function desenharProjetos() {
  elProjetosContagem.textContent = String(projetosCache.length);

  if (!projetosCache.length) {
    // Cartao, e nao uma linha de texto: sem projeto cadastrado o app nao faz
    // nada, entao o proximo passo tem de estar a um clique e nao escondido no
    // `+` do cabecalho da secao.
    const vazio = document.createElement('li');
    vazio.className = 'projeto-vazio';

    const frase = document.createElement('p');
    frase.textContent = 'Nenhum repositório ainda. Cadastre um para abrir sessões com um clique.';

    const botao = document.createElement('button');
    botao.textContent = 'Cadastrar projeto';
    botao.addEventListener('click', cadastrarProjeto);

    vazio.append(frase, botao);
    elProjetosLista.replaceChildren(vazio);
    return;
  }

  elProjetosLista.replaceChildren(...projetosCache.map((p) => {
    const li = document.createElement('li');
    li.className = 'projeto' + (p.existe ? '' : ' projeto-sumiu');
    li.dataset.id = p.id;

    const nome = document.createElement('span');
    nome.className = 'projeto-nome';
    nome.textContent = p.nome;

    // Fica VAZIA no caso normal (projeto que existe e tem git), e e assim desde
    // sempre -- so que o CSS lhe dava borda e padding, entao o vazio virava uma
    // pilula de ~12x4px na linha de todo projeto saudavel. Quem some com ela e a
    // regra `.projeto-marca:empty`, no estilo.css: resolve na fonte do desenho e
    // vale para qualquer ramo que apareca aqui depois.
    const marca = document.createElement('span');
    marca.className = 'projeto-marca';
    if (!p.existe) {
      marca.textContent = 'sumiu';
      marca.title = `Pasta não encontrada: ${p.caminho}`;
    } else if (!p.git) {
      marca.textContent = 'sem git';
      marca.title = 'Não é um repositório git: abre sem worktree';
    }

    // O atraso do remoto, na linha FECHADA.
    //
    // Antes o fetch rodava para todos os projetos e o resultado era jogado fora
    // para os fechados: o aviso so existia dentro do card expandido, e quem nao
    // expandia nunca ficava sabendo que a base tinha envelhecido.
    const atras = document.createElement('span');
    atras.className = 'projeto-atras';
    const situacao = p.existe && p.git ? atrasoDe(p.caminho) : null;
    if (situacao) {
      atras.textContent = `↓ ${situacao.atras}`;
      atras.title = `${situacao.base} está ${situacao.atras} commit`
        + `${situacao.atras === 1 ? '' : 's'} atrás de ${situacao.upstream}.\n`
        + 'Clique para abrir o projeto e atualizar.';
      // Expande em vez de atualizar direto. `--ff-only` e seguro, mas um chip de
      // 20px rodando merge no checkout de alguem e surpresa -- e o card aberto e
      // onde a frase inteira explica o que vai acontecer.
      atras.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!expandidos.has(p.id)) {
          expandidos.add(p.id);
          desenharProjetos();
          carregarDetalhes(p.id);
        }
      });
    }

    const btnRemover = document.createElement('button');
    btnRemover.className = 'projeto-remover';
    btnRemover.textContent = '×';
    btnRemover.title = 'Remover da lista (a pasta não é apagada)';
    btnRemover.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const r = await window.orq.projetosRemover(p.id);
      if (r.projetos) { projetosCache = r.projetos; desenharProjetos(); }
    });

    // Seta de expandir: so faz sentido em repositorio git, que e onde existe
    // worktree para listar.
    //
    // `disabled`, e NAO `hidden`: o atributo cai na regra global
    // `[hidden] { display: none !important }`, e sumir do flex leva junto um dos
    // `gap: 9px` da linha -- o quadradinho de cor dos projetos sem git ficava
    // desalinhado de todos os outros. O CSS usa `visibility: hidden`, que
    // preserva a caixa e ja tira do tab order.
    const aberto = expandidos.has(p.id);
    const btnAbrir = document.createElement('button');
    btnAbrir.className = 'projeto-expandir';
    btnAbrir.textContent = aberto ? '▾' : '▸';
    btnAbrir.title = aberto
      ? 'Ocultar os worktrees deste projeto'
      : 'Ver os worktrees deste projeto';
    btnAbrir.setAttribute('aria-label', btnAbrir.title);
    btnAbrir.setAttribute('aria-expanded', String(aberto));
    btnAbrir.disabled = !p.git || !p.existe;
    btnAbrir.addEventListener('click', (ev) => {
      ev.stopPropagation();
      alternarWorktrees(p.id);
    });

    // O quadradinho de cor virou BOTAO: e onde a cor esta, entao e onde a gente
    // procura para troca-la. `stopPropagation` porque a linha inteira abre
    // sessao.
    const tinta = document.createElement('button');
    tinta.className = 'projeto-tinta';
    tinta.style.background = tintaDoProjeto(p);
    tinta.title = 'Trocar a cor deste projeto';
    tinta.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.OrqCorProjeto?.abrir(p.id);
    });

    const linha = document.createElement('div');
    linha.className = 'projeto-linha';
    linha.append(btnAbrir, tinta, nome, atras, marca, btnRemover);
    linha.title = p.caminho;
    // Passa pela escolha, que agora pergunta SEMPRE -- mesmo sem conversa
    // guardada ha o que escolher: sessao do Claude ou so um terminal. A paleta
    // e o botao "Nova sessao" continuam indo direto ao `abrirProjeto`, porque
    // neles voce ja escolheu o que queria.
    linha.addEventListener('click', () => (window.OrqEscolhaSessao
      ? window.OrqEscolhaSessao.abrir(p.id)
      : abrirProjeto(p.id)));

    li.append(linha);

    if (expandidos.has(p.id)) {
      const caixa = document.createElement('div');
      caixa.className = 'projeto-detalhe';
      caixa.dataset.para = p.id;
      caixa.append(desenharDetalhe(p));
      li.append(caixa);
    }

    return li;
  }));
}

// Ler worktree custa varios comandos git por projeto, entao so acontece quando
// voce expande -- nao no desenho da lista.
function desenharDetalhe(p) {
  const frag = document.createDocumentFragment();
  const d = detalhes.get(p.id);

  if (!d || d.carregando) {
    const carregando = document.createElement('p');
    carregando.className = 'wt-vazio';
    carregando.textContent = 'lendo os worktrees…';
    frag.append(carregando);
    return frag;
  }

  // Aviso do .worktreeinclude: sem ele o worktree nasce sem .env e a aplicacao
  // nao sobe la dentro.
  if (d.include && d.include.faltando) {
    const aviso = document.createElement('div');
    aviso.className = 'wt-aviso';

    const txt = document.createElement('span');
    txt.textContent = `${d.include.candidatos.join(', ')} fica de fora dos worktrees novos`;
    txt.title = 'Um worktree é um checkout limpo: arquivos ignorados pelo git não vão junto, '
      + 'e sem eles a aplicação não sobe.';

    const btn = document.createElement('button');
    btn.textContent = 'criar .worktreeinclude';
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const r = await window.orq.includeCriar(p.caminho, d.include.candidatos);
      if (r.ok) carregarDetalhes(p.id);
    });

    aviso.append(txt, btn);
    frag.append(aviso);
  }

  // O checkout principal ficou para tras do servidor.
  //
  // Este e o caso que motivou a feature: o merge acontece no servidor enquanto a
  // sessao trabalha isolada numa worktree, e a base local envelhece sem nada
  // avisar -- ate uma sessao reclamar que a main esta atrasada. Mesma faixa
  // ambar do .worktreeinclude, que ja e a forma "avisa e oferece o conserto"
  // desta tela.
  if (d.git && d.git.atras > 0) {
    const aviso = document.createElement('div');
    aviso.className = 'wt-aviso';

    const txt = document.createElement('span');
    txt.textContent = `${d.git.base} está ${d.git.atras} commit${d.git.atras === 1 ? '' : 's'} `
      + `atrás de ${d.git.upstream}`;
    txt.title = 'O checkout principal ficou para trás do servidor. As worktrees nascem a partir '
      + 'dele, então elas herdam o atraso.';

    const btn = document.createElement('button');
    btn.textContent = 'atualizar';
    btn.title = 'Faz fast-forward do checkout principal. Se não for fast-forward, recusa em vez '
      + 'de criar merge ou conflito.';
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'atualizando…';
      const r = await window.orq.gitAtualizar(p.caminho);
      window.OrqToast?.mostrar(r.ok
        ? `${d.git.base} avançou ${r.avancou || 0} commit${r.avancou === 1 ? '' : 's'}`
        : r.texto);
      // Mover a base muda o `naoMesclados` e o `atrasDaBase` de TODA worktree, e
      // com eles o portao do arquivar.
      carregarDetalhes(p.id);
    });

    aviso.append(txt, btn);
    frag.append(aviso);
  }

  if (!d.worktrees.length) {
    const vazio = document.createElement('p');
    vazio.className = 'wt-vazio';
    vazio.textContent = 'Nenhum worktree. Digite o nome de uma feature e clique no projeto.';
    frag.append(vazio);
    return frag;
  }

  // O CONTADOR PASSIVO, e o caminho para a faxina.
  //
  // Fechar um painel nunca apagou pasta nem branch, entao o que sobra so
  // aparecia para quem expandisse o projeto e contasse as linhas na mao. Dizer
  // "N worktrees, N prontas" na primeira linha e o que transforma "nunca lembro
  // de limpar" em "da para ver que esta sujo".
  const prontas = d.worktrees.filter((w) => w.candidata).length;
  const resumo = document.createElement('div');
  resumo.className = 'wt-resumo';

  const conta = document.createElement('span');
  conta.textContent = `${d.worktrees.length} worktree${d.worktrees.length === 1 ? '' : 's'}`
    + (prontas ? ` · ${prontas} pronta${prontas === 1 ? '' : 's'} para arquivar` : '');
  conta.title = 'Cada worktree é um checkout inteiro do projeto, com node_modules próprio.\n'
    + 'Fechar o painel não apaga nada: a pasta e o branch ficam no disco.';

  const btnLimpar = document.createElement('button');
  btnLimpar.className = 'wt-limpar' + (prontas ? ' wt-limpar-ativo' : '');
  btnLimpar.textContent = 'limpar…';
  btnLimpar.title = prontas
    ? `Ver tamanho em disco e arquivar várias de uma vez (${prontas} pronta${prontas === 1 ? '' : 's'})`
    : 'Ver tamanho em disco de cada worktree e o que impede arquivar';
  btnLimpar.addEventListener('click', (ev) => {
    ev.stopPropagation();
    window.OrqLimpeza?.abrir(p.caminho, p.nome);
  });

  resumo.append(conta, btnLimpar);
  frag.append(resumo);

  const ol = document.createElement('ol');
  ol.className = 'wt-lista';

  for (const w of d.worktrees) {
    const li = document.createElement('li');
    li.className = 'wt';
    li.title = `${w.caminho}\nbranch: ${w.branch}`;

    const nome = document.createElement('span');
    nome.className = 'wt-nome';
    nome.textContent = w.nome;

    // A etiqueta e o que responde "posso arquivar isto?" sem tentar e falhar.
    // A etiqueta diz o que impede arquivar; clicar nela mostra O QUE mudou.
    // E o fim do ciclo de revisao: bolinha azul, abre o diff, decide.
    const etiqueta = document.createElement('button');
    etiqueta.className = 'wt-marca';
    etiqueta.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.OrqDiff?.abrir(p.caminho, w.caminho, w.nome);
    });
    let impedimento = '';
    etiqueta.textContent = 'ver diff';
    if (w.sessaoViva) {
      etiqueta.textContent = 'aberto agora';
      etiqueta.classList.add('wt-viva');
      impedimento = `Sessão do Claude rodando (pid ${w.pid}).`;
    } else if (!w.limpo) {
      etiqueta.textContent = `${w.sujos} alterado${w.sujos === 1 ? '' : 's'}`;
      etiqueta.classList.add('wt-sujo');
      impedimento = 'Há alteração sem commit.';
    } else if (w.naoMesclados > 0) {
      etiqueta.textContent = `${w.naoMesclados} commit${w.naoMesclados === 1 ? '' : 's'}`;
      etiqueta.classList.add('wt-sujo');
      impedimento = `Há commit fora de ${w.baseBranch}.`;
    }
    etiqueta.title = impedimento
      ? `${impedimento}\nClique para ver o que mudou.`
      : 'Ver o que esta sessão mudou';

    const btnArquivar = document.createElement('button');
    btnArquivar.className = 'wt-arquivar';
    btnArquivar.textContent = '×';
    btnArquivar.disabled = Boolean(impedimento);
    btnArquivar.title = impedimento
      ? `Não dá para arquivar: ${impedimento}`
      : `Arquivar: remove a pasta e o branch ${w.branch}`;
    btnArquivar.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const r = await window.orq.worktreesArquivar(p.caminho, w.caminho);
      if (!r.ok && r.texto) btnArquivar.title = r.texto;
      // O `git branch -d` pode ter recusado (commit nao mesclado) mesmo com a
      // pasta ja removida. Isso vem em `ok: true` com `avisoBranch`, e estava
      // sendo descartado -- o branch sobrevivia e ninguem ficava sabendo.
      if (r.ok && r.avisoBranch) window.OrqToast?.mostrar(r.avisoBranch);
      carregarDetalhes(p.id);
    });

    li.append(nome, etiqueta, btnArquivar);
    li.addEventListener('click', (ev) => { ev.stopPropagation(); retomar(p, w); });
    ol.append(li);
  }

  frag.append(ol);
  return frag;
}

async function carregarDetalhes(id) {
  const p = projetosCache.find((x) => x.id === id);
  if (!p) return;

  detalhes.set(id, { carregando: true, worktrees: [], include: null, git: null });
  desenharProjetos();

  // Expandir tambem BUSCA, mas fora do `Promise.all` de proposito: disparado e
  // esquecido, sem `await`. A invariante continua valendo -- expandir um projeto
  // nao pode depender de internet para desenhar -- e o push `git:estado` corrige
  // a tela quando o fetch voltar, um ou vinte segundos depois. O piso de 60s
  // mora no processo principal, entao expandir e recolher em sequencia nao vira
  // um fetch por clique.
  if (p.existe && p.git) window.orq.gitBuscarUm?.(p.caminho);

  // `gitSituacao` e leitura pura: le o que o ultimo fetch ja trouxe, sem tocar a
  // rede. Quem busca e a rotina de fundo -- expandir um projeto nao pode
  // depender de internet para desenhar.
  const [worktrees, include, git] = await Promise.all([
    window.orq.worktreesListar(p.caminho),
    window.orq.includeSituacao(p.caminho),
    window.orq.gitSituacao(p.caminho),
  ]);

  detalhes.set(id, { carregando: false, worktrees, include, git });
  desenharProjetos();
}

// Expandir ou recolher os worktrees de um projeto.
//
// Numa funcao propria porque agora tem dois chamadores: a seta da linha e o chip
// de atraso. A paleta pode virar o terceiro.
function alternarWorktrees(id) {
  if (expandidos.has(id)) expandidos.delete(id);
  else expandidos.add(id);
  desenharProjetos();
  if (expandidos.has(id)) carregarDetalhes(id);
  return expandidos.has(id);
}

// Redesenha os detalhes de todo projeto ABERTO na arvore.
//
// Existe para a tela de limpeza: arquivar em lote muda a lista de worktrees, e
// o card que ficou atras dela mostraria as arquivadas ate alguem recolher e
// expandir de novo. Projeto fechado nao paga nada -- ler worktree sao varios
// comandos git por projeto.
function recarregarDetalhes() {
  for (const id of expandidos) carregarDetalhes(id);
}

// O RESULTADO da busca, empurrado pelo processo principal.
//
// O relogio ficava aqui e tinha tres defeitos somados: pulava o tique com a
// janela oculta sem reagendar (um tique perdido custava dez minutos), nao tinha
// gatilho nenhum alem do proprio relogio, e gastava rede com todos os projetos
// jogando o resultado fora para os fechados. Hoje quem busca e o
// `src/main/remoto.js`, que tem os eventos `show`/`restore`/`focus` da janela.
//
// Ganho colateral: antes cada ciclo chamava `carregarDetalhes` por projeto
// aberto, e cada uma disparava um `worktreesListar` SINCRONO de dezenas de
// comandos git no processo principal. Agora o ciclo so atualiza este mapa.
function aplicarEstadoGit(lista) {
  if (!Array.isArray(lista)) return;
  for (const s of lista) {
    if (!s || !s.caminho) continue;
    gitPorProjeto.set(achatarCaminho(s.caminho), s);
    // O card aberto mostra a mesma informacao pela frase inteira, com o botao
    // de atualizar: manter os dois de acordo sai de graca aqui.
    const p = projetosCache.find((x) => achatarCaminho(x.caminho) === achatarCaminho(s.caminho));
    const d = p && detalhes.get(p.id);
    if (d && s.ok) d.git = { base: s.base, upstream: s.upstream, atras: s.atras, frente: s.frente };
  }
  desenharProjetos();
}

window.orq.aoMudarGit?.(aplicarEstadoGit);

// "Buscar novidades no remoto", da paleta. Dispensa o piso de tempo -- e o unico
// caminho que dispensa: os outros tres (relogio, expandir, voltar para a janela)
// existem para nao gastar rede a toa, e este existe para quando voce SABE que
// acabaram de mesclar alguma coisa.
async function buscarAgora() {
  window.OrqToast?.mostrar('Buscando no remoto…');
  const lista = await window.orq.gitBuscarTodos();
  aplicarEstadoGit(lista);

  const responderam = (lista || []).filter((s) => s.ok);
  const atrasados = responderam.filter((s) => s.atras > 0).length;
  if (!responderam.length) {
    // Toast, NUNCA dialogo: e a mesma politica do `gitDeRede` e do updater --
    // sem credencial ou sem rede, o app so continua mostrando o que sabia.
    window.OrqToast?.mostrar('Não consegui falar com nenhum servidor.');
    return lista;
  }
  window.OrqToast?.mostrar(`${responderam.length} projeto${responderam.length === 1 ? '' : 's'} `
    + `buscado${responderam.length === 1 ? '' : 's'} · `
    + (atrasados ? `${atrasados} atrás do servidor` : 'tudo em dia'));
  return lista;
}

// Leitura inicial: o primeiro push so vem no primeiro tique, e ate la a arvore
// ficaria sem o chip mesmo com o dado ja no processo principal (o app pode ter
// sido reaberto com a janela ja carregada).
window.orq.gitEstado?.().then(aplicarEstadoGit).catch(() => {});

// Retomar o trabalho de ontem: painel na pasta do worktree, continuando a
// ultima conversa dali. `claude -c` sem conversa anterior nao falha -- ele
// simplesmente abre uma sessao nova (medido contra o CLI 2.1.220), por isso
// nao ha fallback aqui.
const COMANDO_RETOMAR = `${window.OrqShell.limpar()} && claude -c`;

function retomar(projeto, w, { comandoInicial } = {}) {
  if (w.sessaoViva) {
    // Ja existe sessao viva: se o painel for deste app, focar em vez de abrir
    // outro em cima.
    for (const [id, painel] of window.OrqPainel.painelPorId) {
      if (String(painel.cwd || '').toLowerCase() === w.caminho.toLowerCase()) {
        window.OrqGrade.focarPainel(id);
        return null;
      }
    }
  }
  return window.OrqGrade.criarPainel({
    cwd: w.caminho,
    feature: w.nome,
    comandoInicial: comandoInicial || COMANDO_RETOMAR,
  });
}

// `terminal: true` abre um shell na pasta e NAO manda comando nenhum. E
// sentinela, e nao `comandoInicial: ''`: a conta la embaixo e
// `comandoInicial || montarComando(...)`, entao string vazia cairia de volta no
// padrao e o Claude subiria assim mesmo.
async function abrirProjeto(id, { comandoInicial, terminal = false } = {}) {
  const p = projetosCache.find((x) => x.id === id);
  if (!p) return null;

  if (!p.existe) {
    // Abrir um painel numa pasta que sumiu so produz um erro cru de spawn.
    desenharProjetos();
    return null;
  }

  const feature = (elFeatureProjeto?.value || '').trim();
  if (elFeatureProjeto) elFeatureProjeto.value = '';
  window.OrqCasca?.atualizarDica();
  ultimoProjetoId = p.id;

  return window.OrqGrade.criarPainel({
    cwd: p.caminho,
    feature: slugFeature(feature) || p.nome,
    comandoInicial: terminal ? '' : (comandoInicial || montarComando(feature, p.git)),
    tipoPainel: terminal ? 'terminal' : 'sessao',
  });
}

// O botao "Nova sessao" da barra: usa o ultimo projeto aberto, senao o unico,
// senao o primeiro da lista. Sem nenhum projeto cadastrado nao ha o que
// adivinhar -- abre o cadastro, que e o passo que falta de verdade.
async function abrirUltimo() {
  if (!projetosCache.length) return cadastrarProjeto();
  const alvo = projetosCache.find((p) => p.id === ultimoProjetoId && p.existe)
    || projetosCache.find((p) => p.existe);
  if (!alvo) return null;
  return abrirProjeto(alvo.id);
}

// Abre o modal, que e quem escolhe pasta E faixa de portas. O dialogo nativo
// virou o botao "Procurar" de dentro dele: a escolha e a gravacao continuam
// separadas, e agora o caminho tambem pode ser digitado.
function cadastrarProjeto() {
  if (window.OrqModalProjeto) return window.OrqModalProjeto.abrir();
  return null;
}

btnProjetoAdd?.addEventListener('click', cadastrarProjeto);
document.getElementById('vazio-cadastrar')?.addEventListener('click', cadastrarProjeto);
document.getElementById('btn-nova-sessao')?.addEventListener('click', abrirUltimo);

carregarProjetos();

window.OrqProjetos = {
  slugFeature,
  montarComando,
  carregarProjetos,
  abrirProjeto,
  abrirUltimo,
  cadastrarProjeto,
  carregarDetalhes,
  recarregarDetalhes,
  alternarWorktrees,
  aplicarEstadoGit,
  atrasoDe,
  buscarAgora,
  retomar,
  tintaDe,
  tintaDoProjeto,
  tintaDaPasta,
  projetoDe,
  COMANDO_RETOMAR,
  expandidos,
  detalhes,
  lista: () => projetosCache,
};
