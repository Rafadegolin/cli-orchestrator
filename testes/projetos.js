'use strict';
// Cadastro de projetos: persistencia, deduplicacao, abertura com comando
// inicial, sanitizacao do nome da feature e remocao.
//
// Nao invoca o Claude de verdade: a montagem do comando e funcao pura e e
// testada direto, e a abertura usa um comandoInicial de teste com `echo`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
const RAIZ_URL = RAIZ.replace(/\\/g, '/');
// Mesmo caminho que subir.ps1 passa ao app pela env ORQ_DADOS.
const ARQ = path.join(RAIZ, '.dev-udata', 'dados', 'projetos.json');

function lerArquivo() {
  try {
    return JSON.parse(fs.readFileSync(ARQ, 'utf8')).projetos || [];
  } catch {
    return [];
  }
}

(async () => {
  const cdp = await conectar();
  await zerarGrade(cdp);

  checar('modulo de projetos carregou', await cdp.avaliar(`typeof window.OrqProjetos?.montarComando`) === 'function');

  // --- sanitizacao: funcao pura, sem precisar de painel ------------------
  const casos = JSON.parse(await cdp.avaliar(`JSON.stringify({
    normal:   window.OrqProjetos.montarComando('minha-feature', true),
    injecao:  window.OrqProjetos.montarComando('feat: a & shutdown -s', true),
    acento:   window.OrqProjetos.montarComando('correcao de preco', true),
    vazio:    window.OrqProjetos.montarComando('', true),
    semGit:   window.OrqProjetos.montarComando('minha-feature', false),
    soSimbolo: window.OrqProjetos.montarComando('!!!', true)
  })`));

  checar('feature normal vira worktree', casos.normal === 'cls && claude -w minha-feature', casos.normal);
  checar('metacaractere de shell nao sobrevive',
    !casos.injecao.includes('&&  ') && !/&(?!&)/.test(casos.injecao.replace('cls && ', '')) && !casos.injecao.includes(' -s'),
    casos.injecao);
  checar('espaco nao sobrevive (quebraria o nome do branch)',
    casos.acento === 'cls && claude -w correcao-de-preco', casos.acento);
  checar('sem nome de feature, roda claude puro', casos.vazio === 'cls && claude', casos.vazio);
  checar('projeto sem git nunca recebe -w', !casos.semGit.includes('-w'), casos.semGit);
  checar('nome so de simbolos cai para claude puro', casos.soSimbolo === 'cls && claude', casos.soSimbolo);

  // --- cadastro ----------------------------------------------------------
  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) await window.orq.projetosRemover(p.id, false);
    await window.OrqProjetos.carregarProjetos();
    return 'ok';
  })()`);

  const r1 = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.projetosAdicionar(${JSON.stringify(RAIZ_URL)});
    await window.OrqProjetos.carregarProjetos();
    return JSON.stringify({ novo: r.novo, total: r.projetos.length, nome: r.projeto.nome, git: r.projetos[0].git });
  })()`));
  checar('projeto cadastrado', r1.novo === true && r1.total === 1, JSON.stringify(r1));
  checar('detectou que e repositorio git', r1.git === true, String(r1.git));
  checar('gravou no arquivo em disco', lerArquivo().length === 1, `${lerArquivo().length} no JSON`);

  const naTela = await cdp.avaliar(`document.querySelectorAll('#projetos-lista .projeto').length`);
  checar('apareceu na lateral', naTela === 1, String(naTela));

  // Mesmo caminho com outra caixa e com barra no fim: nao pode duplicar.
  const r2 = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.projetosAdicionar(${JSON.stringify(RAIZ_URL.toUpperCase() + '/')});
    return JSON.stringify({ novo: r.novo, total: r.projetos.length });
  })()`));
  checar('caminho repetido nao duplica', r2.novo === false && r2.total === 1, JSON.stringify(r2));

  // --- pasta que nao existe ---------------------------------------------
  //
  // A recusa volta como TEXTO, e nao como excecao: quem chama e o modal, onde o
  // caminho e digitado, e pasta errada e erro de uso -- tem de virar mensagem
  // na tela, nao estouro no IPC.
  const erro = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.projetosAdicionar('C:/nao/existe/mesmo');
    return JSON.stringify({ erro: r.erro || '', criou: Boolean(r.projeto), total: r.projetos.length });
  })()`));
  checar('recusa pasta inexistente, com motivo legivel',
    Boolean(erro.erro) && !erro.criou && erro.total === 1, JSON.stringify(erro));

  // --- abertura a partir do projeto -------------------------------------
  const id = await cdp.avaliar(`window.OrqProjetos.lista()[0].id`);
  const painel = JSON.parse(await cdp.avaliar(`(async () => {
    document.getElementById('nome-feature').value = 'feat de teste';
    const p = await window.OrqProjetos.abrirProjeto(${JSON.stringify(id)},
      { comandoInicial: 'echo ORQ_COMANDO_INICIAL_OK' });
    return JSON.stringify({ id: p.id, cwd: p.cwd, feature: p.feature });
  })()`));
  checar('painel abriu na pasta do projeto',
    painel.cwd.replace(/\\/g, '/').toLowerCase() === RAIZ_URL.toLowerCase(), painel.cwd);
  checar('feature do painel foi sanitizada', painel.feature === 'feat-de-teste', painel.feature);
  checar('campo de feature foi limpo apos abrir',
    await cdp.avaliar(`document.getElementById('nome-feature').value`) === '', '');

  await esperar(4000);
  const buffer = await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(painel.id)});
    const b = p.term.buffer.active; let t = '';
    for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\\n';
    return t;
  })()`);
  checar('o comando inicial chegou no PTY e executou',
    buffer.includes('ORQ_COMANDO_INICIAL_OK'), buffer.split('\n').filter(Boolean).slice(-2).join(' | '));

  // --- remocao -----------------------------------------------------------
  const r3 = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.projetosRemover(${JSON.stringify(id)}, false);
    await window.OrqProjetos.carregarProjetos();
    return JSON.stringify({ removido: r.removido, total: r.projetos.length });
  })()`));
  checar('projeto removido da lista', r3.removido === true && r3.total === 0, JSON.stringify(r3));
  checar('removido tambem do arquivo', lerArquivo().length === 0, `${lerArquivo().length} no JSON`);
  checar('a pasta do projeto continua no disco', fs.existsSync(RAIZ), RAIZ);

  encerrar('PROJETOS');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
