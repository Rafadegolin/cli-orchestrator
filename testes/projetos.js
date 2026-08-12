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

  // --- lote: um caminho ruim nao derruba os bons -------------------------
  //
  // `adicionar` LANCA quando a pasta nao existe; num laco ingenuo, um caminho
  // torto no meio abortaria a importacao inteira. E cada `adicionar` reescreve
  // o arquivo todo -- dez projetos seriam dez ciclos de escrita atomica.
  const LOTE = path.join(os.tmpdir(), `orq-teste-lote-${Date.now()}`);
  const bomA = path.join(LOTE, 'lote-a');
  const bomB = path.join(LOTE, 'lote-b');
  fs.mkdirSync(bomA, { recursive: true });
  fs.mkdirSync(bomB, { recursive: true });

  const lote = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.projetosAdicionarVarios(${JSON.stringify([
    bomA.replace(/\\/g, '/'),
    path.join(LOTE, 'nao-existe').replace(/\\/g, '/'),
    bomB.replace(/\\/g, '/'),
    bomA.replace(/\\/g, '/'),
  ])});
    return JSON.stringify({
      novos: r.novos.map((p) => p.nome),
      faixas: r.novos.map((p) => p.faixa),
      jaExistiam: r.jaExistiam.length,
      recusados: r.recusados,
      total: r.projetos.length,
    });
  })()`));

  checar('o lote cadastra os caminhos bons', lote.novos.length === 2, JSON.stringify(lote.novos));
  checar('o caminho ruim vira recusa com motivo, sem derrubar o resto',
    lote.recusados.length === 1 && /nao existe/.test(lote.recusados[0].motivo),
    JSON.stringify(lote.recusados));
  checar('repetido dentro do proprio lote nao entra duas vezes',
    lote.jaExistiam === 1, String(lote.jaExistiam));
  checar('cada projeto do lote ganha faixa de portas propria, sem colidir',
    lote.faixas.length === 2 && lote.faixas[0][0] !== lote.faixas[1][0],
    JSON.stringify(lote.faixas));

  // Limpa: estes tres nao podem sobrar para as checagens seguintes.
  // A lista do PROCESSO PRINCIPAL, e nao o cache do renderer: o cache so
  // acompanha depois de `carregarProjetos()`, e limpar por ele deixava para tras
  // exatamente o que este teste acabou de criar.
  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) {
      if (p.caminho.includes('orq-teste-lote-')) {
        await window.orq.projetosRemover(p.id, false);
      }
    }
    await window.OrqProjetos.carregarProjetos();
    return 'ok';
  })()`);
  fs.rmSync(LOTE, { recursive: true, force: true });

  // --- cor do projeto ------------------------------------------------------
  //
  // Sortear pelo caminho e estavel, mas nao distinto: com dez tons, duas pastas
  // caem na mesma cor cedo ou tarde -- foi relatado. Projeto novo passa a nascer
  // com a cor MENOS usada, e da para trocar a mao.
  const COR = path.join(os.tmpdir(), `orq-teste-cor-${Date.now()}`);
  const pastasCor = ['um', 'dois', 'tres'].map((n) => {
    const d = path.join(COR, n);
    fs.mkdirSync(d, { recursive: true });
    return d.replace(/\\/g, '/');
  });

  const cores = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.projetosAdicionarVarios(${JSON.stringify(pastasCor)});
    await window.OrqProjetos.carregarProjetos();
    return JSON.stringify(r.novos.map((p) => p.cor));
  })()`));
  checar('projeto novo nasce com cor, e o lote nao repete nenhuma',
    cores.length === 3 && new Set(cores).size === 3, JSON.stringify(cores));

  const idCor = await cdp.avaliar(
    `window.OrqProjetos.lista().find((p) => p.caminho.includes('orq-teste-cor-')).id`);

  const trocou = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.projetosDefinirCor(${JSON.stringify(idCor)}, 7);
    await window.OrqProjetos.carregarProjetos();
    const p = window.OrqProjetos.lista().find((x) => x.id === ${JSON.stringify(idCor)});
    return JSON.stringify({ ok: r.ok, cor: p.cor, tinta: window.OrqProjetos.tintaDoProjeto(p) });
  })()`));
  checar('escolher a cor a mao vale mais que o sorteio',
    trocou.ok && trocou.cor === 7 && trocou.tinta === 'var(--proj-7)', JSON.stringify(trocou));

  const voltou = JSON.parse(await cdp.avaliar(`(async () => {
    await window.orq.projetosDefinirCor(${JSON.stringify(idCor)}, null);
    await window.OrqProjetos.carregarProjetos();
    const p = window.OrqProjetos.lista().find((x) => x.id === ${JSON.stringify(idCor)});
    return JSON.stringify({ cor: p.cor, tinta: window.OrqProjetos.tintaDoProjeto(p) });
  })()`));
  checar('"automatica" volta a sortear pelo caminho',
    voltou.cor === null && /^var\(--proj-\d+\)$/.test(voltou.tinta), JSON.stringify(voltou));

  const torta = JSON.parse(await cdp.avaliar(`(async () => JSON.stringify(
    await window.orq.projetosDefinirCor(${JSON.stringify(idCor)}, 99)))()`));
  checar('cor fora da paleta e recusada, sem gravar nada',
    torta.ok === false && Boolean(torta.erro), JSON.stringify(torta));

  await cdp.avaliar(`(async () => {
    for (const p of await window.orq.projetosListar()) {
      if (p.caminho.includes('orq-teste-cor-')) await window.orq.projetosRemover(p.id, false);
    }
    await window.OrqProjetos.carregarProjetos();
    return 'ok';
  })()`);
  fs.rmSync(COR, { recursive: true, force: true });

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
