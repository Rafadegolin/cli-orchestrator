'use strict';

// O estado da branch de cada painel, para o chip do cabecalho e a secao
// "Pronto para revisar" da lateral (Fase 10.3).
//
// NENHUM RELOGIO, de proposito: o orcamento de CPU parado ja esta apertado, e
// todo relogio novo cobra dele (ver `registro.js`). Os gatilhos sao os momentos
// em que a resposta muda ou alguem vai olhar:
//
//   - o `Stop` da sessao (`aoTerminar`), que e quando o agente acabou de commitar;
//   - a janela voltando (`aoVoltar`), com piso, no molde do `remoto.js`;
//   - o painel nascendo (so a parte LOCAL);
//   - o "Atualizar" do chip, e depois de um push.
//
// O GitHub so e consultado com upstream -- branch que nunca subiu nao tem PR
// nem CI -- e com piso por pasta: sem token sobram 60 consultas por hora.

const estado = require('./estado');
const worktrees = require('./worktrees');
const github = require('./github');

const MS_PISO_GITHUB = 60_000;
const MS_PISO_VOLTAR = 120_000;

let janela = null;
let ultimoVoltar = 0;

// id -> { ok, branch, base, frente, upstream, semPush, gh, em }
const porId = new Map();
// pasta -> Promise, enquanto a leitura daquela pasta esta no ar.
const lendo = new Map();
// pasta -> { em, resultado } da ultima consulta ao GitHub.
const githubPorPasta = new Map();
const ultimoEnvio = new Map();

function janelaViva() {
  return Boolean(janela && !janela.isDestroyed() && !janela.webContents.isDestroyed());
}

// A pasta onde a SESSAO esta, e nao onde o painel nasceu: o `claude -w` abre na
// raiz e migra para a worktree, e os hooks ja contaram para onde (`cwdSessao`).
function pastaDe(id) {
  const s = estado.todas().find((x) => x.id === id);
  return s ? (s.cwdSessao || s.cwd || '') : '';
}

// O que vai para a janela. Sem `sha` e sem URL de remoto: a janela so precisa
// do que desenha.
function publico(e) {
  if (!e || !e.ok) return { ok: false };
  return {
    ok: true,
    branch: e.branch,
    base: e.base,
    frente: e.frente,
    upstream: e.upstream,
    semPush: e.semPush,
    github: Boolean(e.repo),
    acesso: e.gh ? e.gh.acesso : null,
    pr: e.gh && e.gh.pr ? e.gh.pr : null,
    ci: e.gh && e.gh.ci ? e.gh.ci : null,
  };
}

function emitir(id) {
  if (!janelaViva()) return;
  const carga = { id, ...publico(porId.get(id)) };
  // Mesmo valor de novo nao redesenha nada -- `Stop` chega a cada resposta.
  const marca = JSON.stringify(carga);
  if (ultimoEnvio.get(id) === marca) return;
  ultimoEnvio.set(id, marca);
  janela.webContents.send('branch:estado', carga);
}

async function lerPasta(pasta, { github: comGithub, forcar }) {
  const local = await worktrees.estadoBranch(pasta);
  if (!local.ok) return local;

  const repo = local.upstream ? github.repoGithub(local.urlRemoto) : null;
  const e = { ...local, repo, gh: null };
  if (!repo) return e;

  const anterior = githubPorPasta.get(pasta);
  const fresco = anterior && Date.now() - anterior.em < MS_PISO_GITHUB && anterior.sha === local.sha;
  if (anterior && (!comGithub || (fresco && !forcar))) {
    e.gh = anterior.resultado;
    return e;
  }
  if (!comGithub) return e;

  try {
    const resultado = await github.consultar({ ...repo, branch: local.branch, sha: local.sha });
    githubPorPasta.set(pasta, { em: Date.now(), sha: local.sha, resultado });
    e.gh = resultado;
  } catch (err) {
    // Erro de rede NUNCA vira dialogo, e a mensagem nao leva token (o modulo
    // do GitHub nunca o coloca em erro nenhum).
    console.error(`[branches] ${pasta}: ${String(err?.message || err)}`);
  }
  return e;
}

// Refaz UM painel. Coalescido por pasta: o `Stop` e o "Atualizar" podem cair
// juntos e ainda assim sai uma leitura so.
async function atualizar(id, { github: comGithub = true, forcar = false } = {}) {
  const pasta = pastaDe(id);
  if (!pasta) return null;

  const chave = `${pasta}|${comGithub ? 1 : 0}`;
  let tarefa = lendo.get(chave);
  if (!tarefa) {
    tarefa = lerPasta(pasta, { github: comGithub, forcar }).finally(() => lendo.delete(chave));
    lendo.set(chave, tarefa);
  }
  const e = await tarefa;
  if (!pastaDe(id)) return null; // o painel fechou no meio
  porId.set(id, { ...e, em: Date.now() });
  emitir(id);
  return publico(e);
}

function aoTerminar(id) {
  if (id) atualizar(id, { forcar: true }).catch(() => {});
}

function aoVoltar() {
  if (Date.now() - ultimoVoltar < MS_PISO_VOLTAR) return;
  ultimoVoltar = Date.now();
  for (const s of estado.todas()) atualizar(s.id).catch(() => {});
}

function remover(id) {
  porId.delete(id);
  ultimoEnvio.delete(id);
}

function agora() {
  return [...porId.entries()].map(([id, e]) => ({ id, ...publico(e) }));
}

// O necessario para o push e o PR, lido de novo na hora: o chip e rotulo, e o
// que estava nele pode ter um minuto.
async function paraAcao(id) {
  const pasta = pastaDe(id);
  if (!pasta) return null;
  const local = await worktrees.estadoBranch(pasta);
  return { pasta, local, repo: local.ok && local.upstream ? github.repoGithub(local.urlRemoto) : null };
}

function iniciar(j) {
  parar();
  janela = j;
  for (const evento of ['show', 'restore', 'focus']) j.on(evento, aoVoltar);
}

function parar() {
  if (janela && !janela.isDestroyed()) {
    for (const evento of ['show', 'restore', 'focus']) janela.removeListener(evento, aoVoltar);
  }
  ultimoEnvio.clear();
}

module.exports = {
  MS_PISO_GITHUB, MS_PISO_VOLTAR,
  iniciar, parar, atualizar, aoTerminar, aoVoltar, remover, agora, paraAcao, publico,
};
