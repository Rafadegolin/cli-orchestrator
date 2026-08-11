'use strict';

// Seletor de ligacoes: escolhe a que este painel passa a ter acesso.
//
// Lista os outros painéis abertos e os projetos cadastrados. Sao a mesma coisa
// no fim -- um caminho de pasta para o --add-dir -- mas a distincao importa na
// tela porque so ha ligacao MUTUA quando existe painel do outro lado.

const elSeletor = document.getElementById('seletor-ligacoes');
const elSeletorLista = document.getElementById('seletor-lista');
const elSeletorTitulo = document.getElementById('seletor-titulo');
const btnSeletorFechar = document.getElementById('seletor-fechar');

let alvoAtual = null;

function fecharSeletor() {
  alvoAtual = null;
  elSeletor.hidden = true;
}

async function abrirSeletor(id) {
  const p = window.OrqPainel.painelPorId.get(id);
  if (!p) return;
  alvoAtual = id;

  elSeletorTitulo.textContent = `Ligar "${p.feature}" a…`;
  elSeletor.hidden = false;
  await desenharSeletor();
}

async function desenharSeletor() {
  const id = alvoAtual;
  const p = window.OrqPainel.painelPorId.get(id);
  if (!p) return fecharSeletor();

  const L = window.OrqLigacoes;
  const projetos = await window.orq.projetosListar();

  const alvos = [];

  for (const outro of window.OrqPainel.painelPorId.values()) {
    if (outro.id === id) continue;
    alvos.push({ caminho: outro.cwd, rotulo: outro.feature, tipo: 'painel' });
  }
  for (const proj of projetos) {
    if (!proj.existe) continue;
    if (L.normalizar(proj.caminho) === L.normalizar(p.cwd)) continue;
    // Ja listado como painel aberto: nao repete.
    if (alvos.some((a) => L.normalizar(a.caminho) === L.normalizar(proj.caminho))) continue;
    alvos.push({ caminho: proj.caminho, rotulo: proj.nome, tipo: 'projeto' });
  }

  if (!alvos.length) {
    const vazio = document.createElement('p');
    vazio.className = 'seletor-vazio';
    vazio.textContent = 'Nada para ligar: abra outro painel ou cadastre um projeto.';
    elSeletorLista.replaceChildren(vazio);
    return;
  }

  elSeletorLista.replaceChildren(...alvos.map((a) => {
    const ligado = L.jaLigado(id, a.caminho);

    const li = document.createElement('li');
    li.className = 'seletor-item' + (ligado ? ' seletor-ligado' : '');

    const nome = document.createElement('span');
    nome.className = 'seletor-nome';
    nome.textContent = a.rotulo;

    const tipo = document.createElement('span');
    tipo.className = 'seletor-tipo';
    // So ha contrapartida quando existe sessao do outro lado.
    tipo.textContent = a.tipo === 'painel' ? 'painel · mutua' : 'projeto · so de ida';
    tipo.title = a.tipo === 'painel'
      ? 'As duas sessoes passam a enxergar o repositorio uma da outra.'
      : 'Nao ha painel aberto nesta pasta, entao so esta sessao ganha acesso.';

    const caminho = document.createElement('span');
    caminho.className = 'seletor-caminho';
    caminho.textContent = a.caminho;
    caminho.title = a.caminho;

    const botao = document.createElement('button');
    botao.textContent = ligado ? 'desligar' : 'ligar';
    botao.className = ligado ? 'seletor-desligar' : 'seletor-ligar';
    botao.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      botao.disabled = true;
      botao.textContent = ligado ? 'desligando...' : 'ligando...';
      if (ligado) {
        const r = window.OrqLigacoes.desligar(id, a.caminho);
        if (r.precisaReiniciar) {
          // Nao existe "/remove-dir": o acesso so some de verdade na proxima
          // partida da sessao. Melhor dizer do que fingir que sumiu.
          botao.title = 'A sessao em andamento continua com acesso ate ser reiniciada.';
        }
      } else {
        await window.OrqLigacoes.ligar(id, a.caminho);
      }
      await desenharSeletor();
    });

    li.append(nome, tipo, caminho, botao);
    return li;
  }));
}

btnSeletorFechar?.addEventListener('click', fecharSeletor);
elSeletor?.addEventListener('click', (ev) => { if (ev.target === elSeletor) fecharSeletor(); });
window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !elSeletor.hidden) fecharSeletor(); });

window.OrqSeletorLigacoes = { abrir: abrirSeletor, fechar: fecharSeletor, desenhar: desenharSeletor };
