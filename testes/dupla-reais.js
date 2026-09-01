'use strict';
// A prova de que a implementacao DUPLA funciona: com Claude de verdade.
//
// Separado do `teste:dupla` porque e lento (~4 min) e consome tokens. O outro
// prova a MECANICA -- que as worktrees nascem, que o comando leva `--add-dir` e
// nao leva `-w`. Este prova a unica coisa que so o modelo pode responder: que a
// sessao alcanca o outro repositorio para LER **e para ESCREVER**.
//
// A parte de escrever e a que importa. `--add-dir` e descrito como "additional
// directories to allow tool access to", e a documentacao antiga deste projeto
// chamava isso de "acesso de LEITURA" -- se fosse so leitura, a feature inteira
// seria um leitor de codigo alheio, e nao uma implementacao nos dois lados.
//
// Dois caminhos, no molde do `ligacoes-reais.js`:
//
//   1. headless (`claude -p`), barato e deterministico: sem a flag nao alcanca,
//      com a flag le e escreve;
//   2. pela interface, do botao ate a sessao viva: prova o caminho que o usuario
//      percorre de verdade.
//
// O segredo mora no repo LIGADO, nunca no anfitriao -- se estivesse nos dois, um
// acerto nao provaria nada.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

const BASE = path.join(os.tmpdir(), 'orq-teste-dupla-reais');
// Um nome por repositorio: cada um tem a sua issue. Nomes DIFERENTES de
// proposito -- com o mesmo slug dos dois lados, um vazamento de nome passaria
// despercebido.
const SLUG_A = 'api-contrato';
const SLUG_B = 'issue-contrato';
const SEGREDO = 'CONTRATO_PEDIDOS_V9';
const MARCA_ESCRITA = 'ESCRITO_PELA_DUPLA';

const wtDe = (repo, slug) => path.join(repo, '.claude', 'worktrees', slug);

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function montarRepo(nome, arquivos) {
  const dir = path.join(BASE, nome);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'teste@orq.local');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'core.autocrlf', 'false');
  for (const [arq, conteudo] of Object.entries(arquivos)) {
    fs.writeFileSync(path.join(dir, arq), conteudo);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'inicial');
  return dir;
}

const ler = (id) => `(() => {
  const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
  const b = p.term.buffer.active; let t = '';
  for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\\n';
  return t;
})()`;

async function ateQue(cdp, expr, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cdp.avaliar(expr)) return true;
    await esperar(500);
  }
  return false;
}

(async () => {
  fs.rmSync(BASE, { recursive: true, force: true });
  // O anfitriao NAO tem o contrato: e isso que torna a leitura uma prova.
  const back = montarRepo('backend', {
    'leiame.md': '# backend\n\nO contrato nao esta neste repositorio.\n',
  });
  const front = montarRepo('frontend', {
    'contrato.md': `# Contrato\n\nIdentificador: ${SEGREDO}\n`,
  });

  const cdp = await conectar();
  await zerarGrade(cdp);

  // --- 1. headless: a flag sozinha, sem app e sem TUI ---------------------
  //
  // Aqui as worktrees ainda nem existem; o que se testa e o `--add-dir` cru
  // entre os dois repositorios, que e o mecanismo em que a feature se apoia.
  const PERGUNTA = 'Leia contrato.md do diretorio adicional e responda APENAS o identificador da versao.';

  const semFlag = spawnSync('claude', ['-p', `"${PERGUNTA}"`], {
    cwd: back, encoding: 'utf8', timeout: 240000, shell: true,
  });
  checar('sem a ligacao, a sessao NAO alcanca o outro repositorio',
    !`${semFlag.stdout || ''}`.includes(SEGREDO),
    `${semFlag.stdout || ''}`.trim().slice(0, 90).replace(/\s+/g, ' '));

  const comFlag = spawnSync('claude', ['-p', `"${PERGUNTA}"`, '--add-dir', `"${front}"`], {
    cwd: back, encoding: 'utf8', timeout: 240000, shell: true,
  });
  checar('com --add-dir, ela LE o arquivo do outro repositorio',
    `${comFlag.stdout || ''}`.includes(SEGREDO),
    `${comFlag.stdout || ''}`.trim().slice(0, 90).replace(/\s+/g, ' '));

  // A prova que decide se a feature vale: ESCREVER do outro lado. Se
  // `--add-dir` fosse so leitura, a "implementacao dupla" nao implementaria
  // nada no segundo repositorio.
  const alvo = path.join(front, 'do-backend.txt');
  spawnSync('claude', [
    '-p', `"Crie o arquivo do-backend.txt na raiz do diretorio adicional, com o texto ${MARCA_ESCRITA}. Responda apenas 'ok'."`,
    '--add-dir', `"${front}"`, '--allowedTools', 'Write',
  ], { cwd: back, encoding: 'utf8', timeout: 240000, shell: true });

  const escreveu = fs.existsSync(alvo) && fs.readFileSync(alvo, 'utf8').includes(MARCA_ESCRITA);
  checar('e ESCREVE nele: --add-dir e acesso de ferramenta, nao so de leitura',
    escreveu, escreveu ? '' : 'o arquivo nao apareceu no repositorio ligado');
  fs.rmSync(alvo, { force: true });

  // --- 2. pela interface, do botao ate a sessao viva -----------------------
  const ids = JSON.parse(await cdp.avaliar(`(async () => {
    await window.orq.projetosAdicionarVarios(${JSON.stringify([back, front])});
    await window.OrqProjetos.carregarProjetos();
    const acha = (c) => (window.OrqProjetos.lista().find((p) =>
      p.caminho.toLowerCase() === String(c).toLowerCase()) || {}).id || '';
    return JSON.stringify({ back: acha(${JSON.stringify(back)}), front: acha(${JSON.stringify(front)}) });
  })()`));
  checar('os dois projetos foram cadastrados', Boolean(ids.back && ids.front), JSON.stringify(ids));

  // Abre o dialogo e confirma, exatamente como um clique faria: o anfitriao e o
  // backend (onde o contrato NAO esta), e o frontend entra por --add-dir.
  await cdp.avaliar(`(async () => {
    window.OrqDupla.abrir();
    document.getElementById('dupla-a').value = ${JSON.stringify(ids.back)};
    document.getElementById('dupla-b').value = ${JSON.stringify(ids.front)};
    document.getElementById('dupla-a').dispatchEvent(new Event('change'));
    const a = document.getElementById('dupla-nome-a');
    const b = document.getElementById('dupla-nome-b');
    a.value = ${JSON.stringify(SLUG_A)};
    b.value = ${JSON.stringify(SLUG_B)};
    a.dispatchEvent(new Event('input'));
    b.dispatchEvent(new Event('input'));
    return 'ok';
  })()`);
  await esperar(1200);
  await cdp.avaliar(`window.OrqDupla.confirmar()`);

  const abriu = await ateQue(cdp, `window.OrqPainel.painelPorId.size === 1`, 30000);
  checar('o dialogo criou as duas worktrees e abriu o painel', abriu, '');
  checar('a worktree do anfitriao existe', fs.existsSync(wtDe(back, SLUG_A)), wtDe(back, SLUG_A));
  checar('a worktree do repo ligado existe', fs.existsSync(wtDe(front, SLUG_B)), wtDe(front, SLUG_B));
  // O contrato viajou junto no checkout do frontend, e continua fora do backend.
  checar('o contrato esta SO na worktree ligada',
    fs.existsSync(path.join(wtDe(front, SLUG_B), 'contrato.md'))
    && !fs.existsSync(path.join(wtDe(back, SLUG_A), 'contrato.md')), '');

  const id = await cdp.avaliar(`[...window.OrqPainel.painelPorId.keys()][0]`);

  // Pasta nova pede confianca antes de subir a TUI.
  if (await ateQue(cdp, `${ler(id)}.includes('trust')`, 60000)) {
    await esperar(1500);
    await cdp.avaliar(`window.orq.escrever(${JSON.stringify(id)}, '\\r')`);
    await esperar(4000);
  }
  const pronto = await ateQue(cdp, `${ler(id)}.includes('for shortcuts')`, 120000);
  checar('a sessao da dupla subiu', pronto, '');
  await esperar(2500);

  // Sem `enviarLinha` o texto fica parado na caixa: a TUI do Claude precisa do
  // Enter separado, com respiro. Medido, e ja documentado no CLAUDE.md.
  await cdp.avaliar(`(async () => { await window.OrqLigacoes.enviarLinha(
    ${JSON.stringify(id)}, ${JSON.stringify(PERGUNTA)}); return 'ok'; })()`);

  const leu = await ateQue(cdp, `${ler(id)}.includes(${JSON.stringify(SEGREDO)})`, 240000);
  checar('a sessao unica LE o codigo do outro repositorio, sem nenhuma confirmacao',
    leu, '');
  if (!leu) {
    const t = await cdp.avaliar(ler(id));
    console.log(t.split('\n').filter((l) => l.trim()).slice(-16).join('\n'));
  }

  // --- limpeza -------------------------------------------------------------
  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(id)})?.destruir()`);
  await esperar(2000);
  await zerarGrade(cdp);
  await cdp.avaliar(`window.orq.sessaoSalvar([])`);
  await cdp.avaliar(`(async () => {
    for (const pid of ${JSON.stringify([ids.back, ids.front])}) await window.orq.projetosRemover(pid, false);
    await window.OrqProjetos.carregarProjetos();
  })()`);
  fs.rmSync(BASE, { recursive: true, force: true });

  encerrar('DUPLA_REAIS');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
