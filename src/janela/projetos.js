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
const TINTAS = ['var(--acc)', 'var(--info)', 'var(--warn)', '#c678dd', '#56b6c2', '#e5c07b'];

function tintaDe(caminho) {
  let h = 0;
  for (let i = 0; i < caminho.length; i++) h = (h * 31 + caminho.charCodeAt(i)) >>> 0;
  return TINTAS[h % TINTAS.length];
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

// A qual projeto uma pasta pertence. Casa pelo prefixo MAIS ESPECIFICO: um
// worktree vive em <projeto>/.claude/worktrees/<feat>, e com dois projetos
// aninhados o de dentro tem de ganhar.
function projetoDe(caminho) {
  const alvo = String(caminho || '').replace(/[\\/]+$/, '').toLowerCase();
  if (!alvo) return null;

  let melhor = null;
  for (const p of projetosCache) {
    const base = String(p.caminho).replace(/[\\/]+$/, '').toLowerCase();
    const dentro = alvo === base || alvo.startsWith(`${base}\\`) || alvo.startsWith(`${base}/`);
    if (dentro && (!melhor || base.length > melhor.base.length)) {
      melhor = { base, nome: p.nome, caminho: p.caminho, tinta: tintaDe(p.caminho) };
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
    linha.addEventListener('click', () => abrirProjeto(p.id));

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
    const etiqueta = document.createElement('span');
    etiqueta.className = 'wt-marca';
    let impedimento = '';
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

  detalhes.set(id, { carregando: true, worktrees: [], include: null });
  desenharProjetos();

  const [worktrees, include] = await Promise.all([
    window.orq.worktreesListar(p.caminho),
    window.orq.includeSituacao(p.caminho),
  ]);

  detalhes.set(id, { carregando: false, worktrees, include });
  desenharProjetos();
}

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
  projetoDe,
  COMANDO_RETOMAR,
  expandidos,
  detalhes,
  lista: () => projetosCache,
};
