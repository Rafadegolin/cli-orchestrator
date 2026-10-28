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

module.exports = { repoGithub, credencial, consultar, resumirChecks, escolherPr, urlNovoPr };
