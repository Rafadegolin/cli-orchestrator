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

async function carregarProjetos() {
  projetosCache = await window.orq.projetosListar();
  desenharProjetos();
  return projetosCache;
}

function desenharProjetos() {
  elProjetosContagem.textContent = String(projetosCache.length);

  if (!projetosCache.length) {
    const vazio = document.createElement('li');
    vazio.className = 'projeto-vazio';
    vazio.textContent = 'Nenhum projeto. Use o + para cadastrar.';
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
      marca.title = `Pasta nao encontrada: ${p.caminho}`;
    } else if (!p.git) {
      marca.textContent = 'sem git';
      marca.title = 'Nao e um repositorio git: abre sem worktree';
    }

    const btnRemover = document.createElement('button');
    btnRemover.className = 'projeto-remover';
    btnRemover.textContent = '×';
    btnRemover.title = 'Remover da lista (a pasta nao e apagada)';
    btnRemover.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const r = await window.orq.projetosRemover(p.id);
      if (r.projetos) { projetosCache = r.projetos; desenharProjetos(); }
    });

    li.append(nome, marca, btnRemover);
    li.title = p.caminho;
    li.addEventListener('click', () => abrirProjeto(p.id));
    return li;
  }));
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

  return window.OrqGrade.criarPainel({
    cwd: p.caminho,
    feature: slugFeature(feature) || p.nome,
    comandoInicial: comandoInicial || montarComando(feature, p.git),
  });
}

async function cadastrarProjeto() {
  const caminho = await window.orq.escolherPasta();
  if (!caminho) return null;
  const r = await window.orq.projetosAdicionar(caminho);
  if (r.projetos) { projetosCache = r.projetos; desenharProjetos(); }
  return r;
}

btnProjetoAdd?.addEventListener('click', cadastrarProjeto);

carregarProjetos();

window.OrqProjetos = {
  slugFeature,
  montarComando,
  carregarProjetos,
  abrirProjeto,
  cadastrarProjeto,
  lista: () => projetosCache,
};
