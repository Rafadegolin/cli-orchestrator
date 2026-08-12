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

// `cls && claude`, e nao `cls; claude`: o shell do app e o cmd.exe, onde `;`
// nao separa comandos (isso e PowerShell). O cmd.exe custa dezenas de ms para
// abrir, contra centenas do PowerShell -- e o que segura a meta de abertura.
function montarComando(feature, ehGit) {
  const slug = slugFeature(feature);
  // Sem repositorio git nao existe worktree: `claude -w` falharia e o usuario
  // veria so um erro no terminal sem entender por que.
  if (!slug || !ehGit) return 'cls && claude';
  return `cls && claude -w ${slug}`;
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
        tinta: tintaDe(p.caminho),
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

    const marca = document.createElement('span');
    marca.className = 'projeto-marca';
    if (!p.existe) {
      marca.textContent = 'sumiu';
      marca.title = `Pasta não encontrada: ${p.caminho}`;
    } else if (!p.git) {
      marca.textContent = 'sem git';
      marca.title = 'Não é um repositório git: abre sem worktree';
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
    const btnAbrir = document.createElement('button');
    btnAbrir.className = 'projeto-expandir';
    btnAbrir.textContent = expandidos.has(p.id) ? '▾' : '▸';
    btnAbrir.title = 'Ver os worktrees deste projeto';
    btnAbrir.hidden = !p.git || !p.existe;
    btnAbrir.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (expandidos.has(p.id)) expandidos.delete(p.id);
      else expandidos.add(p.id);
      desenharProjetos();
      if (expandidos.has(p.id)) carregarDetalhes(p.id);
    });

    const tinta = document.createElement('span');
    tinta.className = 'projeto-tinta';
    tinta.style.background = tintaDe(p.caminho);

    const linha = document.createElement('div');
    linha.className = 'projeto-linha';
    linha.append(btnAbrir, tinta, nome, marca, btnRemover);
    linha.title = p.caminho;
    // Passa pela escolha: com conversa anterior guardada ela pergunta, e sem
    // nenhuma cai direto no `abrirProjeto`. A paleta continua indo direto ao
    // `abrirProjeto` -- la voce ja escolheu o que queria.
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

// A BUSCA periodica.
//
// Segue o padrao do updater (intervalo longo, primeira checagem atrasada) e nao
// o do medidor de CPU: rede de fundo a cada poucos segundos contraria a meta de
// consumo parado, e versao nova de repositorio nao aparece a cada 2s.
//
// Nada aqui bloqueia nem interrompe: se der erro, se nao houver credencial ou
// se nao houver rede, o app simplesmente continua mostrando o que sabia.
const MS_ENTRE_BUSCAS = 10 * 60 * 1000;
const MS_PRIMEIRA_BUSCA = 20_000;

async function buscarDeTodos() {
  if (document.hidden) return;
  for (const p of projetosCache) {
    if (!p.existe || !p.git) continue;
    await window.orq.gitBuscar(p.caminho);
    // Redesenha so o que ja esta aberto: projeto fechado nao mostra isto.
    if (expandidos.has(p.id)) await carregarDetalhes(p.id);
  }
}

setTimeout(() => {
  buscarDeTodos();
  setInterval(buscarDeTodos, MS_ENTRE_BUSCAS);
}, MS_PRIMEIRA_BUSCA);

// Retomar o trabalho de ontem: painel na pasta do worktree, continuando a
// ultima conversa dali. `claude -c` sem conversa anterior nao falha -- ele
// simplesmente abre uma sessao nova (medido contra o CLI 2.1.220), por isso
// nao ha fallback aqui.
const COMANDO_RETOMAR = 'cls && claude -c';

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

async function abrirProjeto(id, { comandoInicial } = {}) {
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
    comandoInicial: comandoInicial || montarComando(feature, p.git),
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
  retomar,
  tintaDe,
  tintaDaPasta,
  projetoDe,
  COMANDO_RETOMAR,
  expandidos,
  detalhes,
  lista: () => projetosCache,
};
