'use strict';
// A parte da Fase 3 que vive na janela: expandir o projeto, ver os worktrees
// com a etiqueta certa, retomar e arquivar.
//
// Usa um repositorio descartavel com o lock do Claude simulado, entao nenhuma
// sessao de verdade e aberta.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

const REPO = path.join(os.tmpdir(), 'orq-teste-wt-ui');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function montarRepo() {
  fs.rmSync(REPO, { recursive: true, force: true });
  fs.mkdirSync(REPO, { recursive: true });
  git(REPO, 'init', '-q', '-b', 'main');
  git(REPO, 'config', 'user.email', 'teste@teste');
  git(REPO, 'config', 'user.name', 'teste');
  fs.writeFileSync(path.join(REPO, 'leiame.txt'), 'base\n');
  fs.writeFileSync(path.join(REPO, '.gitignore'), '.env\n');
  git(REPO, 'add', '-A');
  git(REPO, 'commit', '-qm', 'inicial');
  fs.writeFileSync(path.join(REPO, '.env'), 'SEGREDO=1\n');

  const cria = (nome, pid) => {
    const destino = path.join(REPO, '.claude', 'worktrees', nome);
    git(REPO, 'worktree', 'add', '-q', '-b', `worktree-${nome}`, destino);
    git(REPO, 'worktree', 'lock', '--reason',
      `claude session ${nome} (pid ${pid} start 639219707467220630)`, destino);
    return destino;
  };

  return {
    limpo: cria('limpo', 999999),          // lock orfao: arquivavel
    aberto: cria('aberto', process.pid),   // sessao viva: intocavel
  };
}

(async () => {
  const dirs = montarRepo();
  const cdp = await conectar();
  await zerarGrade(cdp);

  // Cadastra o repo de teste como projeto.
  const id = await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    const r = await window.orq.projetosAdicionar(${JSON.stringify(REPO.replace(/\\/g, '/'))});
    await window.OrqProjetos.carregarProjetos();
    return r.projeto.id;
  })()`);

  checar('o comando de retomada e o esperado',
    await cdp.avaliar(`window.OrqProjetos.COMANDO_RETOMAR`) === 'cls && claude -c',
    await cdp.avaliar(`window.OrqProjetos.COMANDO_RETOMAR`));

  // --- expandir ----------------------------------------------------------
  await cdp.avaliar(`(async () => { window.OrqProjetos.expandidos.add(${JSON.stringify(id)});
    await window.OrqProjetos.carregarDetalhes(${JSON.stringify(id)}); return 'ok'; })()`);
  await esperar(1200);

  const tela = JSON.parse(await cdp.avaliar(`(() => {
    const itens = [...document.querySelectorAll('.wt')].map(li => ({
      nome: li.querySelector('.wt-nome').textContent,
      marca: li.querySelector('.wt-marca').textContent,
      arquivarDesabilitado: li.querySelector('.wt-arquivar').disabled,
    }));
    return JSON.stringify({ itens, aviso: !!document.querySelector('.wt-aviso') });
  })()`));

  checar('a lista mostra os dois worktrees', tela.itens.length === 2,
    tela.itens.map((i) => i.nome).join(','));

  const aberto = tela.itens.find((i) => i.nome === 'aberto');
  const limpo = tela.itens.find((i) => i.nome === 'limpo');

  checar('worktree com sessao viva aparece como "aberto agora"',
    aberto && aberto.marca === 'aberto agora', JSON.stringify(aberto));
  checar('e o arquivar dele fica desabilitado',
    aberto && aberto.arquivarDesabilitado === true, String(aberto && aberto.arquivarDesabilitado));
  // A etiqueta deixou de ser so o motivo do impedimento: ela agora e SEMPRE o
  // caminho para o diff. Sem impedimento, e isso que ela oferece.
  checar('worktree limpo nao anuncia impedimento nenhum, e oferece o diff',
    limpo && limpo.marca === 'ver diff', JSON.stringify(limpo));
  checar('e o arquivar dele fica liberado',
    limpo && limpo.arquivarDesabilitado === false, String(limpo && limpo.arquivarDesabilitado));

  checar('avisa que o .env fica de fora dos worktrees novos', tela.aviso === true, '');

  // --- retomar -----------------------------------------------------------
  const painel = JSON.parse(await cdp.avaliar(`(async () => {
    const p = window.OrqProjetos.lista()[0];
    const w = window.OrqProjetos.detalhes.get(p.id).worktrees.find(x => x.nome === 'limpo');
    const painel = await window.OrqProjetos.retomar(p, w, { comandoInicial: 'echo RETOMEI_AQUI' });
    return JSON.stringify({ id: painel.id, cwd: painel.cwd, feature: painel.feature });
  })()`));

  checar('retomar abre o painel DENTRO da pasta do worktree',
    painel.cwd.replace(/\\/g, '/').toLowerCase() === dirs.limpo.replace(/\\/g, '/').toLowerCase(),
    painel.cwd);
  checar('o painel herda o nome do worktree', painel.feature === 'limpo', painel.feature);

  await esperar(3500);
  const buffer = await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(painel.id)});
    const b = p.term.buffer.active; let t = '';
    for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\\n';
    return t;
  })()`);
  checar('o comando de retomada roda na pasta certa', buffer.includes('RETOMEI_AQUI'),
    buffer.split('\n').filter(Boolean).slice(-1)[0]);

  // --- arquivar com painel aberto tem de ser recusado --------------------
  const comPainel = JSON.parse(await cdp.avaliar(`(async () => {
    const p = window.OrqProjetos.lista()[0];
    const w = window.OrqProjetos.detalhes.get(p.id).worktrees.find(x => x.nome === 'limpo');
    return JSON.stringify(await window.orq.worktreesArquivar(p.caminho, w.caminho, false));
  })()`));
  checar('arquivar e recusado enquanto ha painel aberto na pasta',
    comPainel.ok === false && comPainel.motivo === 'painel-aberto', JSON.stringify(comPainel));
  checar('a pasta continua no disco apos a recusa', fs.existsSync(dirs.limpo), dirs.limpo);

  // --- arquivar de verdade, com o painel fechado -------------------------
  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(painel.id)}).destruir()`);
  await esperar(2500);

  const arquivou = JSON.parse(await cdp.avaliar(`(async () => {
    const p = window.OrqProjetos.lista()[0];
    const w = window.OrqProjetos.detalhes.get(p.id).worktrees.find(x => x.nome === 'limpo');
    const r = await window.orq.worktreesArquivar(p.caminho, w.caminho, false);
    await window.OrqProjetos.carregarDetalhes(p.id);
    return JSON.stringify(r);
  })()`));
  checar('com o painel fechado, arquiva', arquivou.ok === true, JSON.stringify(arquivou));
  checar('a pasta do worktree sumiu', !fs.existsSync(dirs.limpo), dirs.limpo);

  await esperar(800);
  const restante = JSON.parse(await cdp.avaliar(
    `JSON.stringify([...document.querySelectorAll('.wt-nome')].map(e => e.textContent))`));
  checar('a lista na tela ficou so com o que esta aberto',
    restante.length === 1 && restante[0] === 'aberto', restante.join(','));

  // --- a tela de limpeza -------------------------------------------------
  //
  // Fechar um painel nunca apagou pasta nem branch, entao worktree se acumula
  // em silencio. Esta tela existe para isso ficar visivel e sair em um clique.
  const dNova = path.join(REPO, '.claude', 'worktrees', 'nova');
  git(REPO, 'worktree', 'add', '-q', '-b', 'worktree-nova', dNova);
  git(REPO, 'worktree', 'lock', '--reason',
    'claude session nova (pid 999999 start 639219707467220630)', dNova);

  const projeto = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqProjetos.lista()[0];
    return JSON.stringify({ caminho: p.caminho, nome: p.nome, id: p.id });
  })()`));

  await cdp.avaliar(`window.OrqLimpeza.abrir(${JSON.stringify(projeto.caminho)},
    ${JSON.stringify(projeto.nome)})`);
  await esperar(2500); // o tamanho em disco chega depois da lista

  const limpeza = JSON.parse(await cdp.avaliar(`(() => {
    const itens = [...document.querySelectorAll('.limpeza-item')].map(li => ({
      nome: li.querySelector('.limpeza-nome').textContent,
      marcado: li.querySelector('.limpeza-caixa').checked,
      travado: li.querySelector('.limpeza-caixa').disabled,
      marca: li.querySelector('.limpeza-marca').textContent,
      meta: li.querySelector('.limpeza-meta').textContent,
    }));
    return JSON.stringify({
      aberta: !document.getElementById('limpeza').hidden,
      itens,
      resumo: document.getElementById('limpeza-resumo').textContent,
      marcados: window.OrqLimpeza.marcados().length,
    });
  })()`));

  checar('a tela de limpeza abre com as duas worktrees',
    limpeza.aberta && limpeza.itens.length === 2,
    JSON.stringify(limpeza.itens.map((i) => i.nome)));

  const nova = limpeza.itens.find((i) => i.nome === 'nova');
  const aberta = limpeza.itens.find((i) => i.nome === 'aberto');

  checar('a candidata vem MARCADA por padrao',
    nova?.marcado === true && nova?.travado === false, JSON.stringify(nova));
  // Some-la esconderia justamente a que voce quer entender por que nao sai.
  checar('a que tem sessao viva aparece, mas desmarcada e travada',
    aberta?.marcado === false && aberta?.travado === true, JSON.stringify(aberta));
  checar('e diz o motivo em vez de um "nao deu" generico',
    aberta?.marca === 'aberto agora', aberta?.marca);
  checar('o tamanho em disco chega e nao fica em reticencias',
    /\d/.test(nova?.meta || '') && !/^…$/.test(nova?.meta || ''), nova?.meta);
  checar('e o resumo conta so o que vai sair',
    limpeza.marcados === 1 && /1 marcada/.test(limpeza.resumo), limpeza.resumo);

  // Arquivar em lote, sem o dialogo nativo (o CDP nao dirige dialogo do Windows).
  const lote = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.worktreesArquivarVarias(
      ${JSON.stringify(projeto.caminho)}, window.OrqLimpeza.marcados(), false);
    return JSON.stringify(r);
  })()`));
  checar('arquivar as marcadas remove a pasta e o branch',
    lote.ok === true && lote.arquivadas.length === 1 && !fs.existsSync(dNova),
    JSON.stringify(lote.arquivadas));

  const branches = git(REPO, 'branch', '--list');
  checar('o branch da arquivada tambem foi embora',
    !branches.includes('worktree-nova'), branches.replace(/\s+/g, ' ').trim());

  await cdp.avaliar('window.OrqLimpeza.fechar()');

  // Limpeza.
  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos(); return 'ok';
  })()`);
  await zerarGrade(cdp);
  fs.rmSync(REPO, { recursive: true, force: true });

  encerrar('WORKTREES_UI');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
