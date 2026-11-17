'use strict';

// PR e CI de uma branch, pela API REST do GitHub (Fase 10.3).
//
// Sem `gh` (nao esta instalado e nao vira dependencia) e sem token proprio: a
// credencial e a que o git DESTA maquina ja tem, lida por `git credential fill`
// com o Git Credential Manager proibido de abrir janela.
//
// MEDIDO aqui antes do codigo (git 2.55, GCM do Git for Windows):
//  - com login guardado, `fill` responde em ~0,3s, sem janela;
//  - sem credencial para o host, falha em ~0,4s com "terminal prompts
//    disabled" -- e nao pergunta nada;
//  - `/pulls?head=` e `/commits/{sha}/check-runs` respondem 200 com e sem
//    token num repositorio publico (sem token: 60 consultas por hora).
//
// O token e lido no instante da chamada e morre ali, como o do medidor de uso:
// nao vai para arquivo, nao vai para a janela, nao vai para log, nem em erro.
//
// Node puro, sem Electron: `teste:branch` exercita tudo com `fetch` falso.

const { execFile } = require('child_process');

const API = 'https://api.github.com';
const MS_CREDENCIAL = 5_000;
const MS_API = 10_000;

// `{ dono, repo }` quando o remoto e do github.com, senao `null`.
//
// O `pedido.normalizarRepo` nao serve aqui: ele descarta o HOST, e um GitLab com
// o mesmo `owner/repo` viraria uma consulta ao GitHub sobre outro projeto.
// Credencial embutida na URL (`https://user:token@github.com/...`) cai junto com
// o resto do que nao e caminho.
function repoGithub(url) {
  const bruto = String(url || '').trim();
  if (!bruto) return null;
  let host = '';
  let caminho = '';
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(bruto);
  if (scp) {
    host = scp[1];
    caminho = scp[2];
  } else {
    try {
      const u = new URL(bruto);
      host = u.hostname;
      caminho = u.pathname;
    } catch {
      return null;
    }
  }
  if (host.toLowerCase() !== 'github.com') return null;
  const partes = caminho.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  return { dono: partes[0], repo: partes[1] };
}

// A senha que o git usaria para o github.com, ou '' -- nunca estoura.
function credencial() {
  return new Promise((resolve) => {
    let filho;
    try {
      filho = execFile('git', ['credential', 'fill'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: MS_CREDENCIAL,
        env: {
          ...process.env,
          GCM_INTERACTIVE: 'never',
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
        },
      }, (err, saida) => {
        if (err) return resolve('');
        resolve((/^password=(.*)$/m.exec(saida || '') || [])[1] || '');
      });
      filho.stdin.end('protocol=https\nhost=github.com\n\n');
    } catch {
      resolve('');
    }
  });
}

// Um GET na API. Devolve `{ status, corpo }`; rede fora vira status 0.
async function get(caminho, token, buscar) {
  const cabecalhos = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'orquestrador',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  try {
    const r = await buscar(`${API}${caminho}`, { headers: cabecalhos, signal: AbortSignal.timeout(MS_API) });
    let corpo = null;
    try { corpo = await r.json(); } catch { corpo = null; }
    return { status: r.status, corpo };
  } catch {
    return { status: 0, corpo: null };
  }
}

// Com token, e se o token for recusado (401), uma vez SEM: repositorio publico
// ainda responde, e um token vencido nao pode apagar o que da para saber.
async function getComFallback(caminho, token, buscar) {
  const r = await get(caminho, token, buscar);
  if (r.status === 401 && token) return get(caminho, '', buscar);
  return r;
}

// Conta como falha o que impede o merge de quem olha: o "neutral" e o
// "skipped" nao.
const FALHAS = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

function resumirChecks(corpo) {
  const runs = Array.isArray(corpo && corpo.check_runs) ? corpo.check_runs : [];
  let falhas = 0;
  let pendentes = 0;
  for (const c of runs) {
    if (c.status !== 'completed') pendentes += 1;
    else if (FALHAS.has(c.conclusion)) falhas += 1;
  }
  return { total: runs.length, falhas, pendentes };
}

// O PR da branch: o ABERTO, se houver; senao o mais recente (mesclado ou
// fechado), que e o que diz "isto ja foi integrado".
function escolherPr(lista) {
  const prs = Array.isArray(lista) ? lista : [];
  const p = prs.find((x) => x.state === 'open') || prs[0];
  if (!p) return null;
  return {
    numero: p.number,
    estado: p.state === 'open' ? 'aberto' : (p.merged_at ? 'mesclado' : 'fechado'),
    rascunho: Boolean(p.draft),
    url: typeof p.html_url === 'string' ? p.html_url : '',
  };
}

// `{ acesso, pr, ci }`. `acesso: false` e o repositorio que nao responde (privado
// sem credencial, ou rede fora): o chip fica so no que e local.
async function consultar({ dono, repo, branch, sha }, { buscar = fetch, lerCredencial = credencial } = {}) {
  const token = await lerCredencial();
  const base = `/repos/${encodeURIComponent(dono)}/${encodeURIComponent(repo)}`;

  const prs = await getComFallback(
    `${base}/pulls?head=${encodeURIComponent(`${dono}:${branch}`)}&state=all&per_page=5`, token, buscar);
  if (prs.status !== 200) return { acesso: false };

  let ci = null;
  if (sha) {
    const checks = await getComFallback(`${base}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
      token, buscar);
    if (checks.status === 200) ci = resumirChecks(checks.corpo);
  }
  return { acesso: true, pr: escolherPr(prs.corpo), ci };
}

// Abrir PR sem token nenhum: a pagina de compare do proprio GitHub ja oferece o
// formulario. Cada segmento codificado, com a `/` do branch preservada --
// `feature%2FTECH-1` o GitHub nao acha.
function urlNovoPr(dono, repo, base, branch) {
  const seg = (s) => String(s).split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${encodeURIComponent(dono)}/${encodeURIComponent(repo)}/compare/`
    + `${seg(base)}...${seg(branch)}?expand=1`;
}

// ------------------------------------------------ painel Git (redesign R7)
//
// Escrita no GitHub: criar PR e mesclar, mais a leitura detalhada do PR (checks
// POR NOME, revisoes, se da para mesclar) e o trecho do log de um check que
// falhou. Mesma credencial do git, lida na chamada e descartada.
//
// ESCRITA EXIGE TOKEN: sem ele (ou com 401/403) a resposta e
// `{ ok: false, acesso: false }`, e a tela cai para abrir o GitHub no
// navegador -- como era antes. Nenhuma mensagem de erro carrega o token.

async function requisitar(metodo, caminho, token, buscar, corpo) {
  const cabecalhos = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'orquestrador',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  try {
    const r = await buscar(`${API}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(MS_API),
    });
    let dados = null;
    try { dados = await r.json(); } catch { dados = null; }
    return { status: r.status, corpo: dados };
  } catch {
    return { status: 0, corpo: null };
  }
}

// A frase do GitHub para um erro de escrita, sem nada que nao seja dele.
function motivoGithub(r) {
  if (!r || !r.status) return 'o GitHub nao respondeu (rede?)';
  const c = r.corpo || {};
  const detalhe = Array.isArray(c.errors) && c.errors.length
    ? (c.errors[0].message || c.errors[0].code || '') : '';
  return String(detalhe || c.message || `HTTP ${r.status}`).slice(0, 300);
}

const caminhoRepo = (dono, repo) => `/repos/${encodeURIComponent(dono)}/${encodeURIComponent(repo)}`;

function listarChecks(corpo) {
  const runs = Array.isArray(corpo && corpo.check_runs) ? corpo.check_runs : [];
  return runs.map((c) => {
    const ini = Date.parse(c.started_at || '');
    const fim = Date.parse(c.completed_at || '');
    let situacao = 'pendente';
    if (c.status === 'completed') {
      if (FALHAS.has(c.conclusion)) situacao = 'falhou';
      else if (c.conclusion === 'success') situacao = 'ok';
      else situacao = 'pulado';
    }
    return {
      id: c.id,
      nome: String(c.name || '').slice(0, 120),
      situacao,
      segundos: ini && fim ? Math.max(0, Math.round((fim - ini) / 1000)) : null,
      url: typeof c.html_url === 'string' ? c.html_url : '',
    };
  });
}

// O PR em detalhe, para a aba "PR e CI" do painel Git.
async function detalhesPr({ dono, repo, numero }, { buscar = fetch, lerCredencial = credencial } = {}) {
  const token = await lerCredencial();
  const base = caminhoRepo(dono, repo);
  const pr = await getComFallback(`${base}/pulls/${Number(numero)}`, token, buscar);
  if (pr.status !== 200 || !pr.corpo) return { ok: false, acesso: false, texto: motivoGithub(pr) };
  const p = pr.corpo;

  const revisoes = await getComFallback(`${base}/pulls/${Number(numero)}/reviews?per_page=100`, token, buscar);
  // Vale a ULTIMA revisao de cada pessoa: quem pediu mudanca e depois aprovou
  // conta como aprovacao.
  const porPessoa = new Map();
  for (const r of Array.isArray(revisoes.corpo) ? revisoes.corpo : []) {
    if (r && r.user && r.state && r.state !== 'COMMENTED') porPessoa.set(r.user.login, r.state);
  }
  const estados = [...porPessoa.values()];

  const sha = p.head && p.head.sha ? p.head.sha : '';
  let checks = [];
  if (sha) {
    const c = await getComFallback(`${base}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`, token, buscar);
    if (c.status === 200) checks = listarChecks(c.corpo);
  }

  return {
    ok: true,
    numero: p.number,
    titulo: String(p.title || ''),
    corpo: String(p.body || '').slice(0, 4000),
    estado: p.state === 'open' ? 'aberto' : (p.merged_at ? 'mesclado' : 'fechado'),
    rascunho: Boolean(p.draft),
    url: typeof p.html_url === 'string' ? p.html_url : '',
    base: p.base && p.base.ref ? p.base.ref : '',
    head: p.head && p.head.ref ? p.head.ref : '',
    sha,
    mesclavel: p.mergeable === true,
    estadoMescla: String(p.mergeable_state || ''),
    aprovacoes: estados.filter((e) => e === 'APPROVED').length,
    mudancasPedidas: estados.filter((e) => e === 'CHANGES_REQUESTED').length,
    checks,
    temToken: Boolean(token),
  };
}

async function criarPr({ dono, repo, head, base, titulo, corpo = '', rascunho = false },
  { buscar = fetch, lerCredencial = credencial } = {}) {
  const titulo1 = String(titulo || '').trim();
  if (!titulo1) return { ok: false, texto: 'O PR precisa de um título.' };
  const token = await lerCredencial();
  if (!token) return { ok: false, acesso: false, texto: 'Sem credencial do GitHub nesta máquina para criar o PR.' };
  const r = await requisitar('POST', `${caminhoRepo(dono, repo)}/pulls`, token, buscar, {
    title: titulo1.slice(0, 256),
    body: String(corpo || '').slice(0, 60_000),
    head,
    base,
    draft: Boolean(rascunho),
  });
  if (r.status === 201 && r.corpo) {
    return { ok: true, numero: r.corpo.number, url: typeof r.corpo.html_url === 'string' ? r.corpo.html_url : '' };
  }
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    return { ok: false, acesso: false, texto: `O GitHub recusou criar o PR (${motivoGithub(r)}).` };
  }
  return { ok: false, texto: `O GitHub recusou criar o PR: ${motivoGithub(r)}` };
}

const METODOS = new Set(['squash', 'merge', 'rebase']);

// Mesclar com o `sha` do head que estava NA TELA: se alguem empurrou depois, o
// GitHub responde 409 e nada e mesclado -- a tela pode estar velha, o merge nao.
async function mesclar({ dono, repo, numero, metodo = 'squash', sha },
  { buscar = fetch, lerCredencial = credencial } = {}) {
  if (!METODOS.has(metodo)) return { ok: false, texto: 'Método de merge desconhecido.' };
  if (!sha) return { ok: false, texto: 'Sem o commit do PR para conferir: atualize e tente de novo.' };
  const token = await lerCredencial();
  if (!token) return { ok: false, acesso: false, texto: 'Sem credencial do GitHub nesta máquina para mesclar.' };
  const r = await requisitar('PUT', `${caminhoRepo(dono, repo)}/pulls/${Number(numero)}/merge`, token, buscar, {
    merge_method: metodo,
    sha,
  });
  if (r.status === 200 && r.corpo && r.corpo.merged) return { ok: true, sha: r.corpo.sha || '' };
  if (r.status === 409) return { ok: false, texto: 'O PR mudou desde que a tela foi lida (novo push). Atualize e confira de novo.' };
  if (r.status === 405) return { ok: false, texto: `O GitHub nao deixa mesclar agora: ${motivoGithub(r)}` };
  if (r.status === 401 || r.status === 403) return { ok: false, acesso: false, texto: `Sem permissão para mesclar (${motivoGithub(r)}).` };
  return { ok: false, texto: `O merge foi recusado: ${motivoGithub(r)}` };
}

// O fim do log de um check que falhou (GitHub Actions: o id do check-run e o
// do job). O GitHub responde com redirect para o texto; o fetch segue, e larga
// o cabecalho de autorizacao ao mudar de origem.
const MAX_LOG = 32 * 1024;

async function logDoCheck({ dono, repo, id }, { buscar = fetch, lerCredencial = credencial } = {}) {
  const token = await lerCredencial();
  try {
    const cab = { 'User-Agent': 'orquestrador', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) cab.Authorization = `Bearer ${token}`;
    const r = await buscar(`${API}${caminhoRepo(dono, repo)}/actions/jobs/${Number(id)}/logs`, {
      headers: cab, signal: AbortSignal.timeout(MS_API),
    });
    if (r.status !== 200) return { ok: false, texto: `Log indisponível (HTTP ${r.status}).` };
    let texto = await r.text();
    if (texto.length > MAX_LOG) texto = texto.slice(-MAX_LOG);
    // Sem o carimbo de hora do Actions no comeco de cada linha.
    const linhas = texto.split(/\r?\n/).map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ''))
      .filter((l) => l.trim());
    return { ok: true, linhas: linhas.slice(-40) };
  } catch {
    return { ok: false, texto: 'O GitHub não respondeu.' };
  }
}

module.exports = {
  repoGithub, credencial, consultar, resumirChecks, escolherPr, urlNovoPr,
  detalhesPr, criarPr, mesclar, logDoCheck, listarChecks, motivoGithub,
};
