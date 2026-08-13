'use strict';

// Worktrees de cada projeto: listar para retomar o trabalho de ontem, e
// arquivar quando a feature acabou.
//
// Mecanica real do `claude -w`, medida contra o CLI 2.1.220:
//
//   worktree <projeto>/.claude/worktrees/feat-x
//   branch   refs/heads/worktree-feat-x
//   locked   claude session feat-x (pid 24172 start 639219707467220630)
//
// O Claude TRANCA o worktree e grava o PID da sessao no motivo do lock. Isso e
// o que permite distinguir "esta feature esta aberta agora" de "sobrou de uma
// sessao que morreu" -- a primeira nunca pode ser arquivada, a segunda e
// exatamente o lixo que se quer limpar.

const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Arquivos que tipicamente guardam configuracao local e ficam fora do git. So
// entram na sugestao se existirem E estiverem ignorados de verdade.
const CANDIDATOS_ENV = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production.local',
  '.env.test.local',
  '.npmrc',
];

// execFile com argumentos em ARRAY, nunca string com shell: os caminhos vem do
// usuario e podem conter espaco, & ou aspas. Montar linha de comando aqui seria
// injecao de shell servida de bandeja.
function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function gitSilencioso(cwd, args) {
  try {
    return { ok: true, saida: git(cwd, args) };
  } catch (err) {
    return { ok: false, saida: '', erro: (err.stderr || err.message || '').toString().trim() };
  }
}

// Git que TOCA A REDE. Caminho proprio, e por dois motivos que o `git()` acima
// nao cobre:
//
//  1. ele e `execFileSync` e BLOQUEIA o processo principal -- com um remoto
//     lento ou fora do ar, a janela inteira congelaria junto;
//  2. sem desligar o prompt, o Git Credential Manager abre uma JANELA pedindo
//     senha. Num repositorio privado sem credencial valida, uma busca de fundo
//     viraria um dialogo do nada, ou pior, uma espera infinita.
//
// Entao: assincrono, com prazo, e proibido de perguntar qualquer coisa. Sem
// credencial ele falha calado -- a mesma politica do updater, que tambem nunca
// vira dialogo por erro de rede.
const MS_REDE = 20_000;

function gitDeRede(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: MS_REDE,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_ASKPASS: '',
        SSH_ASKPASS: '',
      },
    }, (err, saida) => {
      if (err) resolve({ ok: false, saida: '', erro: (err.stderr || err.message || '').toString().trim() });
      else resolve({ ok: true, saida: String(saida) });
    });
  });
}

function processoVivo(pid) {
  if (!pid) return false;
  try {
    // Sinal 0 nao mata nada: so pergunta se o processo existe.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM significa que existe mas nao temos permissao -- ou seja, vivo.
    return err.code === 'EPERM';
  }
}

function ehRepositorio(projeto) {
  return gitSilencioso(projeto, ['rev-parse', '--git-dir']).ok;
}

// Parseia o formato --porcelain: blocos separados por linha em branco.
function blocos(saida) {
  return saida
    .split(/\r?\n\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((bloco) => {
      const info = {};
      for (const linha of bloco.split(/\r?\n/)) {
        const esp = linha.indexOf(' ');
        const chave = esp === -1 ? linha : linha.slice(0, esp);
        const valor = esp === -1 ? '' : linha.slice(esp + 1);
        info[chave] = valor;
      }
      return info;
    });
}

function listar(projeto) {
  if (!projeto || !fs.existsSync(projeto) || !ehRepositorio(projeto)) return [];

  const r = gitSilencioso(projeto, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return [];

  const partes = blocos(r.saida);
  if (!partes.length) return [];

  const principal = partes[0];
  const baseBranch = (principal.branch || '').replace('refs/heads/', '');

  return partes.slice(1).map((p) => {
    const caminho = path.resolve(p.worktree);
    const branch = (p.branch || '').replace('refs/heads/', '');
    const motivoLock = 'locked' in p ? (p.locked || 'sem motivo informado') : null;
    const pid = motivoLock ? Number((motivoLock.match(/pid\s+(\d+)/) || [])[1]) || null : null;

    const existe = fs.existsSync(caminho);

    // Worktree cuja pasta sumiu nao tem status para consultar.
    const st = existe ? gitSilencioso(caminho, ['status', '--porcelain']) : { ok: false, saida: '' };
    const sujos = st.ok ? st.saida.split(/\r?\n/).filter((l) => l.trim()).length : 0;

    let naoMesclados = 0;
    // O outro lado da mesma conta: quanto a worktree esta ATRAS da base. E
    // literalmente o caso do aviso que motivou isto -- a base andou e a worktree
    // continuou onde estava.
    let atrasDaBase = 0;
    if (branch && baseBranch && branch !== baseBranch) {
      const c = contar(projeto, `${branch}...${baseBranch}`);
      if (c) {
        naoMesclados = c.frente;
        atrasDaBase = c.atras;
      }
    }

    const wt = {
      nome: path.basename(caminho),
      caminho,
      branch,
      baseBranch,
      existe,
      travado: Boolean(motivoLock),
      motivoLock,
      pid,
      sessaoViva: processoVivo(pid),
      limpo: existe && st.ok && sujos === 0,
      sujos,
      naoMesclados,
      atrasDaBase,
      // O que o `limpo` NAO enxerga, e o `git worktree remove` apaga assim
      // mesmo. Ver `ignorados()`.
      ignorados: existe ? ignorados(caminho) : [],
      prunable: 'prunable' in p,
      // Quando esta feature foi mexida pela ultima vez. E a data do COMMIT, e
      // nao o mtime da pasta: um `npm install` ou um build reescreve arquivo e
      // faria uma worktree parada ha um mes parecer de hoje.
      ultimoCommit: branch ? ultimoCommit(projeto, branch) : '',
    };

    // Derivado, e nao uma regra nova: quem decide continua sendo `podeArquivar`.
    // Reimplementar o criterio na tela era o caminho curto para a lista dizer
    // uma coisa e o clique fazer outra.
    wt.candidata = podeArquivar(wt).pode;
    return wt;
  });
}

// Data ISO do ultimo commit do branch, ou '' se nao der para saber.
function ultimoCommit(projeto, branch) {
  const r = gitSilencioso(projeto, ['log', '-1', '--format=%cI', branch]);
  return r.ok ? r.saida.trim() : '';
}

// Quanto a pasta ocupa em disco.
//
// Fica FORA do `listar()` de proposito, e assincrona. `listar()` e sincrona e
// roda ao expandir um projeto; somar bytes de um checkout com `node_modules`
// sao dezenas de milhares de `stat` e travaria a janela inteira no clique.
//
// Com teto de tempo: numero aproximado com aviso de parcial e melhor que uma
// tela congelada contando bytes. Quem chama decide quando pagar isto.
const MS_TAMANHO = 8000;

async function tamanhoDe(caminho, { ms = MS_TAMANHO } = {}) {
  const limite = Date.now() + ms;
  let bytes = 0;
  let arquivos = 0;
  let parcial = false;

  const pilha = [caminho];
  while (pilha.length) {
    // `>=` e nao `>`: com teto zero o certo e nao varrer nada e se declarar
    // parcial. Com `>`, uma pasta pequena varrida dentro do mesmo milissegundo
    // voltava `parcial: false` para um teto que nao permitia trabalho nenhum.
    if (Date.now() >= limite) { parcial = true; break; }

    const dir = pilha.pop();
    let itens;
    try {
      itens = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // sumiu, ou sem permissao: nao e motivo para derrubar a conta
    }

    const aMedir = [];
    for (const it of itens) {
      // Link nao e seguido: contaria o alvo de novo, e um link circular nunca
      // terminaria.
      if (it.isSymbolicLink()) continue;
      const alvo = path.join(dir, it.name);
      if (it.isDirectory()) pilha.push(alvo);
      else aMedir.push(alvo);
    }

    // Em lote: no Windows o custo esta na ida ao disco por arquivo, e
    // sequencial isso multiplica por dezenas de milhares.
    await Promise.all(aMedir.map(async (a) => {
      try {
        const s = await fs.promises.stat(a);
        bytes += s.size;
        arquivos += 1;
      } catch { /* arquivo sumiu entre o readdir e o stat */ }
    }));
  }

  return { bytes, arquivos, parcial };
}

// ------------------------------------------------- ficar em dia com o remoto

// O caso que motivou isto: o merge foi feito NO SERVIDOR, a sessao estava
// isolada numa worktree, e o checkout principal ficou para tras sem ninguem
// perceber. Como nenhum comando deste app tocava a rede, esse estado era
// invisivel por construcao -- `baseBranch` e sempre a ref LOCAL.
function contar(cwd, intervalo) {
  const r = gitSilencioso(cwd, ['rev-list', '--left-right', '--count', intervalo]);
  if (!r.ok) return null;
  const [frente, atras] = r.saida.trim().split(/\s+/).map(Number);
  return Number.isFinite(frente) && Number.isFinite(atras) ? { frente, atras } : null;
}

// Quanto o checkout principal esta atras do proprio upstream, e quanto cada
// worktree esta atras da base. Sem `fetch`: so le o que ja esta no disco.
function situacaoRemoto(projeto) {
  const base = (gitSilencioso(projeto, ['rev-parse', '--abbrev-ref', 'HEAD']).saida || '').trim();
  if (!base || base === 'HEAD') return { base: '', upstream: '', atras: 0, frente: 0 };

  // Sem upstream configurado nao ha o que comparar -- e isso e um estado
  // normal (branch local), nao um erro.
  const up = gitSilencioso(projeto, ['rev-parse', '--abbrev-ref', `${base}@{u}`]);
  if (!up.ok) return { base, upstream: '', atras: 0, frente: 0 };

  const c = contar(projeto, `${base}...${base}@{u}`) || { frente: 0, atras: 0 };
  return { base, upstream: up.saida.trim(), frente: c.frente, atras: c.atras };
}

async function buscar(projeto) {
  if (!ehRepositorio(projeto)) return { ok: false, erro: 'nao e um repositorio' };
  const r = await gitDeRede(projeto, ['fetch', '--quiet', '--no-tags']);
  return r.ok ? { ok: true, ...situacaoRemoto(projeto) } : { ok: false, erro: r.erro };
}

// Atualizar e SEMPRE `--ff-only`.
//
// E o que torna isto seguro de oferecer: fast-forward nao cria merge nem
// conflito. Quando nao da, o git RECUSA -- e a recusa vira mensagem, no mesmo
// formato dos portoes do arquivar, em vez de deixar o checkout do usuario num
// estado que ele nao pediu.
function atualizar(projeto) {
  const s = situacaoRemoto(projeto);
  if (!s.upstream) return { ok: false, texto: `${s.base || 'HEAD'} nao tem upstream configurado.` };
  if (!s.atras) return { ok: true, jaEstava: true, ...s };

  // `--untracked-files=no` de proposito: aqui o que atrapalha um fast-forward e
  // alteracao em arquivo RASTREADO. Contar os nao rastreados recusaria a
  // atualizacao por causa de um `.env` ou um `dist/` parado na raiz -- coisa que
  // quase todo repositorio tem o tempo todo, e que nao impede merge nenhum.
  // (E se um deles for justamente sobrescrito pelo que vem, o proprio git
  // recusa e a mensagem dele aparece logo abaixo.)
  const sujo = gitSilencioso(projeto, ['status', '--porcelain', '--untracked-files=no']);
  const quantos = sujo.ok ? sujo.saida.split(/\r?\n/).filter((l) => l.trim()).length : 0;
  if (quantos) {
    return {
      ok: false,
      texto: `${quantos} ${quantos === 1 ? 'arquivo alterado' : 'arquivos alterados'} no checkout `
        + 'principal. Comite ou guarde antes de atualizar.',
    };
  }

  const r = gitSilencioso(projeto, ['merge', '--ff-only', s.upstream]);
  if (!r.ok) {
    // O git responde com cinco linhas de `hint:` sugerindo merge e rebase --
    // util no terminal, ilegivel num toast. Fica a linha que diz o que houve.
    const linhas = String(r.erro).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const motivo = linhas.find((l) => /^(fatal|error):/i.test(l)) || linhas[0] || '';
    return {
      ok: false,
      texto: `${s.base} e ${s.upstream} divergiram: ${motivo.replace(/^(fatal|error):\s*/i, '')}`,
    };
  }
  return { ok: true, avancou: s.atras, ...situacaoRemoto(projeto) };
}

// Arquivos que o git IGNORA dentro do worktree -- e que o arquivamento apaga
// sem dizer nada.
//
// `git status --porcelain`, que alimenta o `limpo`, nao lista arquivo ignorado.
// E `git worktree remove` (sem --force) recusa por arquivo rastreado sujo, mas
// remove ignorado calado. O resultado era o pior tipo de perda: silenciosa, e
// justamente do `.env` -- que este mesmo modulo INCENTIVA a copiar para dentro
// do worktree pelo `.worktreeinclude`. Editou o .env so ali dentro? Foi embora.
//
// So os candidatos conhecidos entram: listar `node_modules` inteiro seria
// ruido, e o que interessa e o que voce nao consegue recriar.
function ignorados(caminho) {
  const r = gitSilencioso(caminho, [
    'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory',
  ]);
  if (!r.ok) return [];

  const conhecidos = new Set(CANDIDATOS_ENV.map((c) => c.toLowerCase()));
  return r.saida
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .filter((l) => conhecidos.has(path.basename(l).toLowerCase()));
}

// Diz se da para arquivar, e QUAL dos motivos impede. Um "nao deu" generico
// obrigaria o usuario a ir descobrir no terminal -- exatamente o que este app
// existe para evitar.
function podeArquivar(wt) {
  if (!wt) return { pode: false, motivo: 'sumiu', texto: 'Worktree nao encontrado.' };

  if (wt.sessaoViva) {
    return {
      pode: false,
      motivo: 'sessao-viva',
      texto: `Ha uma sessao do Claude aberta neste worktree (pid ${wt.pid}). Feche a sessao antes de arquivar.`,
    };
  }
  if (wt.existe && !wt.limpo) {
    return {
      pode: false,
      motivo: 'modificado',
      texto: `${wt.sujos} ${wt.sujos === 1 ? 'arquivo modificado' : 'arquivos modificados'} sem commit. Comite ou descarte antes de arquivar.`,
    };
  }
  if (wt.naoMesclados > 0) {
    return {
      pode: false,
      motivo: 'nao-mesclado',
      texto: `${wt.naoMesclados} ${wt.naoMesclados === 1 ? 'commit ainda nao mesclado' : 'commits ainda nao mesclados'} em ${wt.baseBranch}. Mescle antes, senao o trabalho se perde.`,
    };
  }
  return { pode: true, motivo: null, texto: '' };
}

// Arquivar e irreversivel. Revalida TUDO na hora, ignorando o que a interface
// achava: a lista da tela pode ter minutos de idade e uma sessao pode ter
// subido nesse meio tempo.
function arquivar(projeto, caminho) {
  const alvo = listar(projeto).find((w) => path.resolve(w.caminho) === path.resolve(caminho));
  const veredito = podeArquivar(alvo);
  if (!veredito.pode) return { ok: false, ...veredito };

  // Trancado pelo Claude: destrancar so aqui, depois de comprovado que o lock
  // e orfao (sessaoViva ja foi checado acima).
  if (alvo.travado) {
    const un = gitSilencioso(projeto, ['worktree', 'unlock', alvo.caminho]);
    if (!un.ok) return { ok: false, motivo: 'unlock', texto: `Nao consegui destrancar: ${un.erro}` };
  }

  const rm = gitSilencioso(projeto, ['worktree', 'remove', alvo.caminho]);
  if (!rm.ok) {
    // Deixa como estava: retrancar evita meio-arquivamento silencioso.
    if (alvo.travado) gitSilencioso(projeto, ['worktree', 'lock', '--reason', alvo.motivoLock, alvo.caminho]);
    return { ok: false, motivo: 'remove', texto: `Nao consegui remover o worktree: ${rm.erro}` };
  }

  // `-d` minusculo de proposito, NUNCA `-D`: o -d se recusa a apagar branch com
  // commit nao mesclado, e essa recusa e a ultima rede antes de perder codigo.
  let branchRemovido = false;
  let avisoBranch = '';
  if (alvo.branch) {
    const br = gitSilencioso(projeto, ['branch', '-d', alvo.branch]);
    branchRemovido = br.ok;
    if (!br.ok) avisoBranch = `A pasta foi removida, mas o branch ${alvo.branch} ficou: ${br.erro}`;
  }

  gitSilencioso(projeto, ['worktree', 'prune']);

  return { ok: true, nome: alvo.nome, branch: alvo.branch, branchRemovido, avisoBranch };
}

// ------------------------------------------------------------- em lote

// Separa o que da para arquivar do que nao da, ANTES de perguntar qualquer
// coisa. O dialogo precisa listar o que vai acontecer de verdade, e nao o que a
// tela achava quando foi desenhada.
//
// `bloqueados` sao caminhos com painel deste app aberto: o unico portao que
// este modulo nao tem como conhecer sozinho (quem sabe de PTY e o index.js).
function triarLote(projeto, caminhos, { bloqueados = [] } = {}) {
  const norm = (p) => path.resolve(String(p || '')).toLowerCase();
  const presos = new Set(bloqueados.map(norm));
  const lista = listar(projeto);

  const aptas = [];
  const recusadas = [];

  for (const caminho of (Array.isArray(caminhos) ? caminhos : [])) {
    const alvo = lista.find((w) => norm(w.caminho) === norm(caminho));
    if (!alvo) {
      recusadas.push({
        caminho, nome: path.basename(String(caminho)), texto: 'Worktree nao encontrado.',
      });
      continue;
    }
    if (presos.has(norm(caminho))) {
      recusadas.push({
        caminho, nome: alvo.nome,
        texto: 'Ha um painel deste app aberto nesta pasta. Feche o painel antes de arquivar.',
      });
      continue;
    }
    const veredito = podeArquivar(alvo);
    if (veredito.pode) aptas.push(alvo);
    else recusadas.push({ caminho, nome: alvo.nome, texto: veredito.texto });
  }

  return { aptas, recusadas };
}

// Arquiva as ja triadas, EM SEQUENCIA.
//
// Nao e `caminhos.map(arquivar)`: sao varios comandos git no MESMO repositorio,
// e o git nao gosta de concorrencia no index nem no diretorio de worktrees.
// Cada `arquivar` revalida tudo por dentro de novo, entao uma sessao que suba
// no meio do lote ainda encontra portao fechado -- e uma recusa no meio nao
// derruba as outras, que e a razao de `projetos.adicionarVarios` existir.
function arquivarVarias(projeto, caminhos) {
  const arquivadas = [];
  const recusadas = [];
  const avisos = [];

  for (const caminho of (Array.isArray(caminhos) ? caminhos : [])) {
    const r = arquivar(projeto, caminho);
    if (r.ok) {
      arquivadas.push({ nome: r.nome, branch: r.branch, branchRemovido: r.branchRemovido });
      if (r.avisoBranch) avisos.push(r.avisoBranch);
    } else {
      recusadas.push({
        caminho, nome: path.basename(String(caminho)), texto: r.texto || 'falhou',
      });
    }
  }

  return { ok: arquivadas.length > 0, arquivadas, recusadas, avisos };
}

// ------------------------------------------------------- .worktreeinclude

// Sem esse arquivo o worktree e um checkout limpo: o .env nao vai junto e a
// aplicacao nao sobe la dentro. O sintoma e a feature nova parecer "quebrada"
// sem motivo aparente.
// Diff gigante nao pode travar a janela, e travar em silencio e pior que dizer
// "cortei aqui".
const MAX_DIFF = 400 * 1024;

function cortar(texto) {
  if (texto.length <= MAX_DIFF) return { texto, truncado: false };
  return { texto: texto.slice(0, MAX_DIFF), truncado: true };
}

// Arquivo novo que nem foi adicionado ao indice NAO aparece no `git diff`.
//
// Isso e um buraco no fluxo de revisao: a etiqueta da lateral conta o arquivo
// como alterado (ela vem do `git status`), e o diff mostraria menos coisa do
// que a etiqueta prometeu. Pior, um arquivo inteiro novo e justamente o que
// mais importa numa revisao.
//
// `--no-index` contra o vazio produz o diff do arquivo inteiro. Ele sai com
// codigo 1 quando ha diferenca -- que aqui e sempre --, entao o stdout tem de
// ser lido do erro. `git add -N` resolveria tambem, mas MEXERIA no indice do
// usuario, o que este app nao faz.
function naoRastreados(cwd, comum) {
  const st = gitSilencioso(cwd, ['status', '--porcelain', '--untracked-files=all']);
  if (!st.ok) return '';

  const novos = st.saida.split('\n')
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(3).trim())
    .filter(Boolean);

  let texto = '';
  for (const arq of novos) {
    try {
      texto += git(cwd, ['diff', ...comum, '--no-index', '--', '/dev/null', arq]);
    } catch (err) {
      texto += (err.stdout || '').toString();
    }
  }
  return texto;
}

// O que esta sessao mudou: o que ja foi commitado na branch e o que ainda nao.
//
// `base...branch` com TRES pontos e nao dois: tres pontos mostra o que a branch
// fez desde que divergiu, e nao o que a base andou depois. Com dois pontos, a
// base recebendo commits de outra pessoa apareceria como se fosse coisa sua,
// invertida.
function diff(projeto, caminho) {
  if (!ehRepositorio(projeto)) return { ok: false, texto: 'nao e um repositorio git' };
  if (!fs.existsSync(caminho)) return { ok: false, texto: 'a pasta do worktree nao existe mais' };

  const wt = listar(projeto).find((w) => path.resolve(w.caminho) === path.resolve(caminho));
  if (!wt) return { ok: false, texto: 'worktree nao encontrado neste projeto' };

  const comum = ['--no-color', '--no-ext-diff'];

  const commitado = wt.baseBranch
    ? gitSilencioso(caminho, ['diff', ...comum, `${wt.baseBranch}...${wt.branch}`])
    : { ok: false, saida: '' };

  // Nao commitado = o que esta no indice mais o que ainda nem foi adicionado.
  const staged = gitSilencioso(caminho, ['diff', ...comum, '--cached']);
  const solto = gitSilencioso(caminho, ['diff', ...comum]);

  const a = cortar(commitado.saida || '');
  const b = cortar(`${staged.saida || ''}${solto.saida || ''}${naoRastreados(caminho, comum)}`);

  return {
    ok: true,
    branch: wt.branch,
    baseBranch: wt.baseBranch,
    commitado: a.texto,
    naoCommitado: b.texto,
    truncado: a.truncado || b.truncado,
    vazio: !a.texto.trim() && !b.texto.trim(),
  };
}

function situacaoInclude(projeto) {
  if (!projeto || !fs.existsSync(projeto) || !ehRepositorio(projeto)) {
    return { aplicavel: false, existe: false, candidatos: [] };
  }

  const arquivo = path.join(projeto, '.worktreeinclude');
  const existe = fs.existsSync(arquivo);

  // So sugere o que existe E esta realmente ignorado: um .env versionado ja vai
  // junto no checkout e nao precisa ser copiado.
  const candidatos = CANDIDATOS_ENV.filter((nome) => {
    if (!fs.existsSync(path.join(projeto, nome))) return false;
    return gitSilencioso(projeto, ['check-ignore', '-q', nome]).ok;
  });

  return {
    aplicavel: true,
    existe,
    arquivo,
    candidatos,
    conteudo: existe ? fs.readFileSync(arquivo, 'utf8') : '',
    // So vale avisar se ha algo a copiar e ainda nao ha o arquivo.
    faltando: !existe && candidatos.length > 0,
  };
}

function criarInclude(projeto, linhas) {
  const arquivo = path.join(projeto, '.worktreeinclude');
  const conteudo =
    '# Arquivos ignorados pelo git que devem ser copiados para cada worktree novo.\n' +
    '# Sem isto o worktree e um checkout limpo e a aplicacao nao sobe la dentro.\n' +
    `${linhas.join('\n')}\n`;
  fs.writeFileSync(arquivo, conteudo, 'utf8');
  return { arquivo, conteudo };
}

module.exports = {
  CANDIDATOS_ENV,
  MS_TAMANHO,
  ignorados,
  situacaoRemoto,
  buscar,
  atualizar,
  listar,
  ultimoCommit,
  tamanhoDe,
  podeArquivar,
  arquivar,
  triarLote,
  arquivarVarias,
  diff,
  MAX_DIFF,
  situacaoInclude,
  criarInclude,
  processoVivo,
};
