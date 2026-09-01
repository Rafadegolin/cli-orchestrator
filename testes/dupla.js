'use strict';
// Implementacao dupla: duas worktrees, UM painel.
//
// Prova as quatro coisas que decidem se a feature esta certa:
//
//   1. as duas worktrees nascem no disco, com o nome que a tela prometeu;
//   2. abre UM painel so, na worktree do repositorio escolhido -- e nao na raiz,
//      senao `p.cwd` mentiria sobre onde a sessao esta;
//   3. o comando leva `--add-dir` do outro lado e NAO leva `-w`, que criaria uma
//      segunda worktree dentro da primeira;
//   4. rodar de novo com o mesmo nome REAPROVEITA, em vez de recriar.
//
// Repositorios descartaveis, e nada da lista real do usuario e tocado: o
// `ORQ_DADOS` do `npm run dev` ja reaponta o projetos.json.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

const RAIZ = path.join(os.tmpdir(), `orq-teste-dupla-${Date.now()}`);

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function montarRepo(nome) {
  const dir = path.join(RAIZ, nome);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'teste@orq.local');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'leia.md'), `# ${nome}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'inicial');
  return dir;
}

async function ate(fn, cond, ms = 15000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    ultimo = await fn();
    if (cond(ultimo)) return ultimo;
    await esperar(200);
  }
  return ultimo;
}

(async () => {
  const cdp = await conectar();
  await zerarGrade(cdp);

  const back = montarRepo('backend');
  const front = montarRepo('frontend');
  // Sem git: tem de ficar FORA da lista do dialogo -- `claude -w` falharia ali,
  // e oferecer o que so sabe falhar e pior que nao oferecer.
  const avulso = path.join(RAIZ, 'sem-git');
  fs.mkdirSync(avulso, { recursive: true });

  checar('modulo carregou', await cdp.avaliar(`typeof window.OrqDupla?.abrir`) === 'function');

  const ids = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.projetosAdicionarVarios(${JSON.stringify([back, front, avulso])});
    await window.OrqProjetos.carregarProjetos();
    const acha = (c) => (window.OrqProjetos.lista().find((p) =>
      p.caminho.toLowerCase() === String(c).toLowerCase()) || {}).id || '';
    return JSON.stringify({
      back: acha(${JSON.stringify(back)}),
      front: acha(${JSON.stringify(front)}),
      avulso: acha(${JSON.stringify(avulso)}),
      recusados: (r.recusados || []).length,
    });
  })()`));
  checar('os tres projetos foram cadastrados',
    Boolean(ids.back && ids.front && ids.avulso), JSON.stringify(ids));

  // --- o dialogo -----------------------------------------------------------
  const aberto = JSON.parse(await cdp.avaliar(`(() => {
    window.OrqDupla.abrir();
    const opcoes = [...document.getElementById('dupla-a').options].map((o) => o.value);
    return JSON.stringify({
      aberta: window.OrqDupla.aberta(),
      temBack: opcoes.includes(${JSON.stringify(ids.back)}),
      temFront: opcoes.includes(${JSON.stringify(ids.front)}),
      temAvulso: opcoes.includes(${JSON.stringify(ids.avulso)}),
      aVaiParaB: document.getElementById('dupla-a').value !== document.getElementById('dupla-b').value,
    });
  })()`));
  checar('o dialogo abre', aberto.aberta === true, JSON.stringify(aberto));
  checar('lista os projetos com git', aberto.temBack && aberto.temFront, JSON.stringify(aberto));
  // Sem `.git` nao existe worktree.
  checar('e deixa de fora o projeto sem git', aberto.temAvulso === false, JSON.stringify(aberto));
  // Dois selects com o mesmo padrao fariam o primeiro clique ser sempre um erro.
  checar('os dois selects nao nascem no mesmo repo', aberto.aVaiParaB === true, JSON.stringify(aberto));

  // A tela nao pode prometer um nome e o git receber outro.
  const dica = await cdp.avaliar(`(() => {
    const el = document.getElementById('dupla-nome');
    el.value = 'PIX Checkout!';
    el.dispatchEvent(new Event('input'));
    return document.getElementById('dupla-dica').textContent;
  })()`);
  checar('a dica mostra o nome REAL do branch',
    /worktree-PIX-Checkout\b/.test(String(dica)), String(dica));

  // --- a previa diz o que vai acontecer com cada lado ----------------------
  await cdp.avaliar(`(() => {
    document.getElementById('dupla-a').value = ${JSON.stringify(ids.back)};
    document.getElementById('dupla-b').value = ${JSON.stringify(ids.front)};
    const el = document.getElementById('dupla-nome');
    el.value = 'pix';
    el.dispatchEvent(new Event('input'));
    document.getElementById('dupla-a').dispatchEvent(new Event('change'));
    return 'ok';
  })()`);
  const previa = await ate(
    () => cdp.avaliar(`document.getElementById('dupla-previa').textContent`),
    (t) => String(t).includes('criar'), 8000,
  );
  checar('a previa diz "criar" nos dois lados',
    (String(previa).match(/criar/g) || []).length === 2, String(previa));

  // --- confirmar -----------------------------------------------------------
  await cdp.avaliar(`window.OrqDupla.confirmar()`);
  await ate(() => cdp.avaliar(`window.OrqPainel.painelPorId.size`), (n) => n === 1, 20000);

  const wtBack = path.join(back, '.claude', 'worktrees', 'pix');
  const wtFront = path.join(front, '.claude', 'worktrees', 'pix');
  checar('a worktree do backend existe', fs.existsSync(wtBack), wtBack);
  checar('a worktree do frontend existe', fs.existsSync(wtFront), wtFront);
  checar('o branch e worktree-pix nos dois',
    git(back, 'branch', '--list', 'worktree-pix').trim().length > 0
    && git(front, 'branch', '--list', 'worktree-pix').trim().length > 0);

  const painel = JSON.parse(await cdp.avaliar(`(() => {
    const [p] = [...window.OrqPainel.painelPorId.values()];
    return JSON.stringify({
      quantos: window.OrqPainel.painelPorId.size,
      cwd: p.cwd, feature: p.feature, tipoPainel: p.tipoPainel,
      comandoInicial: p.comandoInicial, ligacoes: p.ligacoes,
      comFlags: window.OrqLigacoes.comAddDir(p.comandoInicial, p.ligacoes),
    });
  })()`));

  // UM painel, e nao dois: a dupla e uma conversa so.
  checar('abriu UM painel so', painel.quantos === 1, JSON.stringify(painel));
  // O cwd e a WORKTREE. Na raiz, `p.cwd` mentiria sobre onde a sessao esta e
  // quebraria `painelEm()` e o portao que protege o arquivar.
  checar('o painel abriu DENTRO da worktree do anfitriao',
    String(painel.cwd).toLowerCase() === wtBack.toLowerCase(), painel.cwd);
  checar('a feature e o slug', painel.feature === 'pix', painel.feature);
  // A worktree ja existe: `-w` criaria uma segunda dentro dela.
  checar('o comando NAO leva -w', !/\s-w\s/.test(String(painel.comandoInicial)), painel.comandoInicial);
  checar('mas leva o --name', /--name pix/.test(String(painel.comandoInicial)), painel.comandoInicial);
  checar('a ligacao aponta para a worktree do outro repo',
    painel.ligacoes.length === 1
    && String(painel.ligacoes[0]).toLowerCase() === wtFront.toLowerCase(), JSON.stringify(painel.ligacoes));
  // E o que faz a sessao enxergar os dois repositorios -- sem confirmacao
  // nenhuma, porque lancar com --add-dir nao pede.
  checar('o comando final ganha o --add-dir do outro lado',
    painel.comFlags.includes('--add-dir') && painel.comFlags.toLowerCase().includes(wtFront.toLowerCase().replace(/\//g, '\\')),
    painel.comFlags);

  // Sem campo novo: `retratoSessao` ja grava `ligacoes`, e `despertar` reaplica.
  const retrato = JSON.parse(await cdp.avaliar(`JSON.stringify(window.OrqGrade.retratoSessao())`));
  checar('a sessao salva carrega a ligacao',
    retrato.length === 1 && retrato[0].ligacoes.length === 1, JSON.stringify(retrato));

  // --- rodar de novo REAPROVEITA -------------------------------------------
  await zerarGrade(cdp);
  const previa2 = await cdp.avaliar(`(async () => {
    const r = await window.orq.worktreesPreverDupla(
      ${JSON.stringify(back)}, ${JSON.stringify(front)}, 'pix');
    return JSON.stringify({ a: r.a.acao, b: r.b.acao, existeA: r.a.existe, existeB: r.b.existe });
  })()`);
  const p2 = JSON.parse(previa2);
  checar('a segunda vez diz "reaproveitar" nos dois',
    p2.a === 'reaproveitar' && p2.b === 'reaproveitar', previa2);

  const denovo = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.worktreesCriarDupla(
      ${JSON.stringify(back)}, ${JSON.stringify(front)}, 'pix');
    return JSON.stringify({ ok: r.ok, criadaA: r.a.criada, criadaB: r.b.criada });
  })()`));
  checar('e nao recria nada', denovo.ok === true && denovo.criadaA === false && denovo.criadaB === false,
    JSON.stringify(denovo));

  // --- recusa: repositorio invalido ----------------------------------------
  const recusa = JSON.parse(await cdp.avaliar(`(async () => {
    const r = await window.orq.worktreesCriarDupla(
      ${JSON.stringify(back)}, ${JSON.stringify(avulso)}, 'outra');
    return JSON.stringify(r);
  })()`));
  checar('recusa quando o segundo nao e repositorio', recusa.ok === false, JSON.stringify(recusa));
  checar('e diz qual lado impediu', recusa.onde === 'b', JSON.stringify(recusa));
  // Nenhum caminho de recusa pode deixar residuo: a primeira nao pode ficar.
  checar('e desfaz a primeira, sem deixar meia dupla',
    !fs.existsSync(path.join(back, '.claude', 'worktrees', 'outra')),
    path.join(back, '.claude', 'worktrees', 'outra'));

  // --- limpeza -------------------------------------------------------------
  await zerarGrade(cdp);
  await cdp.avaliar(`(async () => {
    for (const id of ${JSON.stringify([ids.back, ids.front, ids.avulso])}) {
      await window.orq.projetosRemover(id, false);
    }
    await window.OrqProjetos.carregarProjetos();
  })()`);
  fs.rmSync(RAIZ, { recursive: true, force: true });

  encerrar('DUPLA');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
