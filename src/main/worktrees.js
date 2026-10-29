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

const { exec, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const plataforma = require('./plataforma');

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

// Prazo do git de DISCO. Ate existir, um `index.lock` preso congelava o app
// para sempre, sem sintoma nenhum: nao ha erro, nao ha log, a janela so para de
// responder. Quinze segundos e generoso para disco local.
const MS_GIT = 15_000;

// `worktree remove` tem prazo proprio, e muito maior: ele apaga um checkout
// inteiro com `node_modules`, e passar de 15s ali e NORMAL, nao sintoma. Matar
// no meio deixaria exatamente o meio-arquivamento que este modulo proibe.
const MS_GIT_REMOVER = 120_000;

// execFile com argumentos em ARRAY, nunca string com shell: os caminhos vem do
// usuario e podem conter espaco, & ou aspas. Montar linha de comando aqui seria
// injecao de shell servida de bandeja.
function opcoesGit(cwd, ms) {
  return {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: ms,
  };
}

// Timeout e estouro de buffer chegam SEM `stderr`: o `err.stderr` vem vazio e a
// recusa virava "Nao consegui remover o worktree: " -- frase cortada no meio,
// que nao diz nada a quem le. Traduzir aqui e o que mantem a promessa do modulo
// de sempre dizer QUAL portao impediu.
function motivoDoErro(err, ms) {
  if (err && err.killed) return `o git nao respondeu em ${Math.round(ms / 1000)} segundos`;
  if (err && err.code === 'ENOBUFS') return 'o git respondeu mais do que cabia na leitura';
  return ((err && (err.stderr || err.message)) || '').toString().trim();
}

function git(cwd, args, { ms = MS_GIT } = {}) {
  return execFileSync('git', args, opcoesGit(cwd, ms));
}

function gitSilencioso(cwd, args, { ms = MS_GIT } = {}) {
  try {
    return { ok: true, saida: git(cwd, args, { ms }) };
  } catch (err) {
    return { ok: false, saida: '', erro: motivoDoErro(err, ms) };
  }
}

// O MESMO git, assincrono. Existe para o caminho de ESCRITA (arquivar), e nao
// para leitura: `listar()` segue sincrono, e e isso que mantem este modulo
// utilizavel em Node puro, sem app, pelo `teste:worktrees`.
//
// A razao de existir e medida: um lote de 10 worktrees eram ~280 comandos
// sincronos mais dez `worktree remove` apagando `node_modules`, e o processo
// principal ficava 20-60s sem responder -- o Windows oferecia fechar a janela, e
// o relato chegou como "a aplicacao crashou". Com `await`, o loop de eventos
// respira entre cada comando: o servidor de hooks continua aceitando conexao e a
// tela mostra progresso.
//
// NAO CONFUNDIR COM `gitDeRede` logo abaixo: aquele carrega o ambiente que
// proibe o Git Credential Manager de perguntar, e e so para rede.
function gitLento(cwd, args, { ms = MS_GIT } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, opcoesGit(cwd, ms), (err, saida) => {
      if (err) resolve({ ok: false, saida: '', erro: motivoDoErro(err, ms) });
      else resolve({ ok: true, saida: String(saida) });
    });
  });
}

// O script de `arquivar` do projeto (Fase 10.2). Este e o unico lugar do modulo
// que roda linha de SHELL, e de proposito: o texto foi escrito pelo usuario no
// cadastro do projeto, e e um comando de shell por definicao (`npm run x && y`).
// Os caminhos continuam fora da linha -- vao por `cwd` e pelo ambiente.
//
// Assincrono e com prazo pelo mesmo motivo do `gitLento`: um script preso nao
// pode congelar o processo principal que hospeda as sessoes.
const MS_SCRIPT_ARQUIVAR = 60_000;

//
// O prazo e NOSSO, e nao o `timeout` do `exec`: aquele mata so o shell, e o
// processo que o script lancou fica vivo com o `cwd` DENTRO da worktree -- no
// Windows isso trava a pasta, e o arquivar seguinte morre com "Permission
// denied". Foi o teste que pegou. Aqui o estouro derruba a ARVORE e so entao
// responde.
function matarArvore(filho) {
  return new Promise((resolve) => {
    if (!filho.pid) return resolve();
    if (process.platform !== 'win32') {
      try { process.kill(-filho.pid, 'SIGKILL'); } catch { /* ja morreu */ }
      return resolve();
    }
    execFile('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

function rodarScript(linha, { cwd, raiz, ms = MS_SCRIPT_ARQUIVAR }) {
  return new Promise((resolve) => {
    let estourou = false;
    const filho = exec(linha, {
      cwd,
      env: { ...process.env, ORQ_RAIZ: raiz, ORQ_WORKTREE: cwd },
      shell: plataforma.shellPadrao(),
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      // Grupo de processos proprio fora do Windows, para o `kill(-pid)` alcancar
      // os netos. No Windows o `taskkill /T` anda pela arvore sozinho.
      detached: process.platform !== 'win32',
    }, (err, saida, erro) => {
      clearTimeout(relogio);
      if (estourou) return;
      if (!err) return resolve({ ok: true });
      // A ULTIMA linha que o script disse: e quase sempre a do erro, e a
      // recusa cabe num title e num toast.
      const ultimaDe = (t) => String(t || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';
      const ultima = ultimaDe(erro) || ultimaDe(saida);
      resolve({ ok: false, erro: `saiu com codigo ${err.code}${ultima ? ` (${ultima})` : ''}` });
    });
    const relogio = setTimeout(async () => {
      estourou = true;
      await matarArvore(filho);
      resolve({ ok: false, erro: `nao terminou em ${Math.ceil(ms / 1000)} segundos` });
    }, ms);
  });
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

// Caminho normalizado para COMPARAR, nunca para usar.
//
// O git imprime com barra normal, um dialogo do Windows devolve com barra
// invertida, e o Windows nao distingue maiuscula de minuscula. Sem normalizar,
// o mesmo caminho vindo por outra rota deixa de casar e o defeito aparece longe
// da causa. E a irma do `projetoDe()` do renderer -- que o main nao pode
// importar, porque `src/janela` nao existe do lado de ca.
function chave(p) {
  return path.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function mesmoCaminho(a, b) {
  return chave(a) === chave(b);
}

// `filho` esta DENTRO de `pai` (ou e o proprio).
//
// O `+ path.sep` nao e detalhe: sem ele, `wt-auth` casaria com
// `wt-auth-refresh` e arquivar uma feature seria barrado por outra de nome
// parecido -- ou pior, no portao de painel aberto, NAO seria barrado quando
// devia.
function dentroDe(pai, filho) {
  const a = chave(pai);
  const b = chave(filho);
  return b === a || b.startsWith(a + path.sep);
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

// UM montador do objeto `wt`, usado pelo `listar()` e pelo `lerUma()`.
//
// Dois montadores separados seria o mesmo defeito que o `rotuloDe()` resolveu na
// fatia 2: cada lado monta o seu, e um dia os dois ja divergiram. Aqui o preco
// de divergir seria pior que um rotulo errado -- `podeArquivar` le este objeto,
// entao um campo montado diferente vira um portao que abre quando devia fechar.
//
// `completo: false` pula os dois campos que so a TELA usa (`ignorados` para o
// texto do dialogo, `ultimoCommit` para a coluna de idade). Nenhum dos dois
// alimenta `podeArquivar` -- conferido campo a campo -- entao quem so precisa do
// veredito paga 2 comandos em vez de 4.
function montarWt(p, { projeto, baseBranch, completo = true }) {
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
    ignorados: completo && existe ? ignorados(caminho) : [],
    prunable: 'prunable' in p,
    // Quando esta feature foi mexida pela ultima vez. E a data do COMMIT, e
    // nao o mtime da pasta: um `npm install` ou um build reescreve arquivo e
    // faria uma worktree parada ha um mes parecer de hoje.
    ultimoCommit: completo && branch ? ultimoCommit(projeto, branch) : '',
  };

  // Derivado, e nao uma regra nova: quem decide continua sendo `podeArquivar`.
  // Reimplementar o criterio na tela era o caminho curto para a lista dizer
  // uma coisa e o clique fazer outra.
  wt.candidata = podeArquivar(wt).pode;
  return wt;
}

function listar(projeto) {
  if (!projeto || !fs.existsSync(projeto) || !ehRepositorio(projeto)) return [];

  const r = gitSilencioso(projeto, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return [];

  const partes = blocos(r.saida);
  if (!partes.length) return [];

  const principal = partes[0];
  const baseBranch = (principal.branch || '').replace('refs/heads/', '');

  return partes
    .slice(1)
    // Bloco sem `worktree` nao existe no formato do git, mas o parser `blocos()`
    // nao valida nada -- e `path.resolve(undefined)` e um ERR_INVALID_ARG_TYPE
    // cru subindo de dentro de uma leitura. Descartar e a resposta certa: a
    // lista fica sem o bloco torto em vez de nao existir.
    .filter((p) => p && p.worktree)
    .map((p) => montarWt(p, { projeto, baseBranch }));
}

// UMA worktree, revalidada na hora, com comandos so DELA.
//
// Existe porque `arquivar()` chamava `listar(projeto)` para achar o alvo -- e
// num lote isso e quadratico: cada item relia o projeto inteiro, e dez worktrees
// viravam 280 comandos git sincronos. Medido; foi a causa do app parar de
// responder no meio da faxina.
//
// O que NAO muda e a invariante: continua revalidando na hora, ignorando o que a
// interface achava. Ela e sobre FRESCOR, e nao sobre reler o projeto inteiro --
// `podeArquivar` le apenas campos do proprio alvo, entao o estado dos vizinhos
// nunca entrou em decisao nenhuma. Sao 3 comandos em vez de 42.
function lerUma(projeto, caminho) {
  const r = gitSilencioso(projeto, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return null;

  const partes = blocos(r.saida).filter((p) => p && p.worktree);
  if (!partes.length) return null;

  const baseBranch = (partes[0].branch || '').replace('refs/heads/', '');
  const alvo = partes.slice(1).find((p) => mesmoCaminho(p.worktree, caminho));
  if (!alvo) return null;

  return montarWt(alvo, { projeto, baseBranch, completo: false });
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
  // Sem o `ehRepositorio` que havia aqui: era um comando SINCRONO a mais por
  // projeto, a cada ciclo da busca de fundo, para descobrir o que o proprio
  // `fetch` responde de graca uma linha abaixo.
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

// ------------------------------------------------- a branch de uma sessao

// O estado da branch de uma pasta qualquer -- worktree ou checkout principal --
// para o chip do cabecalho (Fase 10.3). E ROTULO, nunca portao: quem decide
// arquivar continua perguntando ao git na hora.
//
// ASSINCRONA, so com `gitLento`: e chamada a cada `Stop` de cada sessao, e o
// `listar()` sincrono ja tem a historia de como spawn por ciclo travou o main.
//
// `base` e o branch do checkout PRINCIPAL, a mesma regra do `baseBranch` do
// `listar()`: o `--git-common-dir` de uma worktree aponta para o `.git` da raiz.
async function estadoBranch(dir) {
  const r = (args) => gitLento(dir, args).then((x) => (x.ok ? x.saida.trim() : null));

  const branch = await r(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === null) return { ok: false };
  const sha = await r(['rev-parse', 'HEAD']);

  const comum = await r(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const raiz = comum ? path.dirname(comum) : dir;
  const base = (await gitLento(raiz, ['rev-parse', '--abbrev-ref', 'HEAD'])).saida.trim();

  // `HEAD` destacado: sem branch nao ha o que empurrar nem PR a procurar.
  const nome = branch === 'HEAD' ? '' : branch;
  let frente = 0;
  if (nome && base && nome !== base) {
    frente = Number(await r(['rev-list', '--count', `${base}..HEAD`])) || 0;
  }

  const upstream = nome ? (await r(['rev-parse', '--abbrev-ref', '@{u}'])) || '' : '';
  const remoto = upstream ? ((await r(['config', `branch.${nome}.remote`])) || upstream.split('/')[0]) : '';
  const semPush = upstream ? Number(await r(['rev-list', '--count', '@{u}..HEAD'])) || 0 : frente;
  // A URL do remoto e o que diz se ha GitHub do outro lado. So com upstream:
  // branch que nunca subiu nao tem PR nem CI a consultar.
  const urlRemoto = remoto ? (await r(['config', `remote.${remoto}.url`])) || '' : '';

  return { ok: true, branch: nome, base, frente, upstream, remoto, urlRemoto, semPush, sha: sha || '' };
}

// Para onde vai um push de branch SEM upstream: `origin`, ou o unico remoto que
// existir. Com varios e nenhum `origin`, adivinhar seria mandar codigo para o
// lugar errado -- recusa e diz por que.
async function remotoDoPush(dir) {
  const r = await gitLento(dir, ['remote']);
  const nomes = r.ok ? r.saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  if (nomes.includes('origin')) return { ok: true, remoto: 'origin' };
  if (nomes.length === 1) return { ok: true, remoto: nomes[0] };
  if (!nomes.length) return { ok: false, texto: 'Este repositorio nao tem remoto configurado.' };
  return { ok: false, texto: `Ha ${nomes.length} remotos e nenhum se chama origin: faca o primeiro push no terminal.` };
}

// Push da branch atual, por clique e com dialogo (quem pergunta e o index.js).
//
// NUNCA `--force`: branch divergida e recusada pelo git e a recusa vira uma
// linha, como no `atualizar`. Pelo `gitDeRede`: e rede, e o Git Credential
// Manager nao pode abrir janela do nada.
async function push(dir) {
  const e = await estadoBranch(dir);
  if (!e.ok || !e.branch) return { ok: false, texto: 'Nao ha branch para enviar aqui (HEAD destacado?).' };

  let args;
  let remoto = e.remoto;
  if (e.upstream) {
    args = ['push', remoto, `HEAD:${e.upstream.slice(remoto.length + 1)}`];
  } else {
    const alvo = await remotoDoPush(dir);
    if (!alvo.ok) return alvo;
    remoto = alvo.remoto;
    args = ['push', '-u', remoto, e.branch];
  }

  const r = await gitDeRede(dir, args);
  if (!r.ok) {
    const linhas = String(r.erro).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const motivo = linhas.find((l) => /^(fatal|error|!)/i.test(l)) || linhas[0] || '';
    return { ok: false, texto: `O push foi recusado: ${motivo.replace(/^(fatal|error):\s*/i, '')}` };
  }
  return { ok: true, remoto, branch: e.branch, enviados: e.semPush };
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
//
// ASSINCRONA de proposito. Nao e enfeite: o `worktree remove` apaga um checkout
// inteiro com `node_modules`, e sincrono ele bloqueava o processo principal --
// nada de IPC, nada de hooks, e a janela que o Windows oferece fechar. O `await`
// devolve o loop entre cada comando.
//
// `prune` NAO roda aqui quando ha lote: e limpeza de metadado GLOBAL, entao
// `arquivarVarias` a faz uma vez no fim, em vez de N vezes.
//
// `script` e o `arquivar` do projeto (Fase 10.2): roda DEPOIS dos portoes e
// ANTES de qualquer coisa ser apagada. Falhou, recusa -- e nada mudou no disco,
// que e a regra do modulo. Se ele sujar a arvore, o `worktree remove` sem force
// recusa adiante e o worktree e retrancado como em qualquer outra falha.
async function arquivar(projeto, caminho, { podar = true, script = '', msScript = MS_SCRIPT_ARQUIVAR } = {}) {
  const alvo = lerUma(projeto, caminho);
  const veredito = podeArquivar(alvo);
  if (!veredito.pode) return { ok: false, ...veredito };

  if (script) {
    const sc = await rodarScript(script, { cwd: alvo.caminho, raiz: projeto, ms: msScript });
    if (!sc.ok) return { ok: false, motivo: 'script', texto: `O script de arquivar falhou: ${sc.erro}` };
  }

  // Trancado pelo Claude: destrancar so aqui, depois de comprovado que o lock
  // e orfao (sessaoViva ja foi checado acima).
  if (alvo.travado) {
    const un = await gitLento(projeto, ['worktree', 'unlock', alvo.caminho]);
    if (!un.ok) return { ok: false, motivo: 'unlock', texto: `Nao consegui destrancar: ${un.erro}` };
  }

  const rm = await gitLento(projeto, ['worktree', 'remove', alvo.caminho], { ms: MS_GIT_REMOVER });
  if (!rm.ok) {
    // Deixa como estava: retrancar evita meio-arquivamento silencioso.
    if (alvo.travado) await gitLento(projeto, ['worktree', 'lock', '--reason', alvo.motivoLock, alvo.caminho]);
    return { ok: false, motivo: 'remove', texto: `Nao consegui remover o worktree: ${rm.erro}` };
  }

  // `-d` minusculo de proposito, NUNCA `-D`: o -d se recusa a apagar branch com
  // commit nao mesclado, e essa recusa e a ultima rede antes de perder codigo.
  let branchRemovido = false;
  let avisoBranch = '';
  if (alvo.branch) {
    const br = await gitLento(projeto, ['branch', '-d', alvo.branch]);
    branchRemovido = br.ok;
    if (!br.ok) avisoBranch = `A pasta foi removida, mas o branch ${alvo.branch} ficou: ${br.erro}`;
  }

  if (podar) await gitLento(projeto, ['worktree', 'prune']);

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
  const lista = listar(projeto);

  const aptas = [];
  const recusadas = [];

  for (const caminho of (Array.isArray(caminhos) ? caminhos : [])) {
    const alvo = lista.find((w) => mesmoCaminho(w.caminho, caminho));
    if (!alvo) {
      recusadas.push({
        caminho, nome: path.basename(String(caminho)), texto: 'Worktree nao encontrado.',
      });
      continue;
    }
    // `dentroDe`, e nao igualdade: um painel aberto numa SUBPASTA do worktree
    // passava por este portao, e o `worktree remove` apagava a pasta debaixo do
    // terminal de alguem. A direcao importa -- painel na raiz do projeto nao
    // impede arquivar uma worktree dele.
    if (bloqueados.some((b) => dentroDe(caminho, b))) {
      recusadas.push({
        caminho, nome: alvo.nome,
        texto: 'Ha um painel deste app aberto dentro desta pasta. Feche o painel antes de arquivar.',
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
// `aoProgresso` fica no MODULO, e nao no handler de IPC: handler nao se testa em
// Node puro, e e por isso que `triarLote` e `arquivarVarias` moram aqui desde o
// comeco. Quem avisa a janela e o `index.js`.
async function arquivarVarias(projeto, caminhos, { aoProgresso = null, script = '' } = {}) {
  const lista = Array.isArray(caminhos) ? caminhos : [];
  const arquivadas = [];
  const recusadas = [];
  const avisos = [];

  for (let i = 0; i < lista.length; i += 1) {
    const caminho = lista[i];
    const nome = path.basename(String(caminho));
    if (aoProgresso) aoProgresso({ feito: i, total: lista.length, nome });

    // `podar: false`: o `worktree prune` limpa metadado do repositorio inteiro,
    // entao roda UMA vez no fim em vez de uma por item.
    const r = await arquivar(projeto, caminho, { podar: false, script });
    if (r.ok) {
      arquivadas.push({ nome: r.nome, branch: r.branch, branchRemovido: r.branchRemovido });
      if (r.avisoBranch) avisos.push(r.avisoBranch);
    } else {
      recusadas.push({ caminho, nome, texto: r.texto || 'falhou' });
    }
  }

  if (arquivadas.length) await gitLento(projeto, ['worktree', 'prune']);
  if (aoProgresso) aoProgresso({ feito: lista.length, total: lista.length, nome: '' });

  return { ok: arquivadas.length > 0, arquivadas, recusadas, avisos };
}

// ------------------------------------------------------------ criar

// Ate aqui, o app NUNCA criou worktree: quem criava era o CLI, com o `-w <slug>`
// digitado no PTY. Isto existe para a implementacao DUPLA, onde a segunda
// worktree e num repositorio que nao tem painel nenhum -- nao ha CLI ali para
// pedir.
//
// A convencao de caminho e de branch e a MESMA do `claude -w` (o cabecalho deste
// arquivo), e isso nao e gosto: `listar()`, `podeArquivar()`, a faxina, o diff e
// a etiqueta da lateral leem esse formato. Fugir dele criaria uma worktree que o
// resto do app so enxerga pela metade.
const SLUG_VALIDO = /^[A-Za-z0-9._-]+$/;

function caminhoDeWorktree(projeto, slug) {
  return path.join(projeto, '.claude', 'worktrees', slug);
}

function branchDeWorktree(slug) {
  return `worktree-${slug}`;
}

function temBranch(projeto, branch) {
  return gitSilencioso(projeto, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
}

// Nomes de pasta que o Windows nao deixa criar, e que o git ACEITA como branch.
//
// MEDIDO: `git check-ref-format --branch con` sai com 0, e `nul` e `aux`
// tambem. Como o slug vira nome de pasta, o `worktree add` morreria com um erro
// de sistema que nao explica nada. So nome puro -- `feat/nul` vira `feat-nul`,
// que e uma pasta legitima.
const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Nome de branch valido segundo o PROPRIO git, e nao segundo um regex nosso.
//
// `check-ref-format --branch` e a mesma funcao que recusa um `git branch`, entao
// ela cobre os cantos que um regex daqui esqueceria (`..`, `@{`, terminar em
// `.lock`). MEDIDO com git 2.55: aceita `feature/TECH-1120`, `FEAT/X`, `master`;
// recusa `-bad`, `a..b`, `HEAD`, `x.lock`, `com espaco`, `@{-1}`, `x/`.
//
// Os dois portoes ANTES da chamada nao sao paranoia:
//  - `refs/heads/x` PASSA no check-ref-format, e `worktree add -b refs/heads/x`
//    criaria `refs/heads/refs/heads/x`;
//  - `-` no comeco e argumento de git disfarcado de branch, e pior: o
//    `git worktree add` documenta que `<commit-ish>` pode ser um `-` puro,
//    "synonymous with @{-1}". Um branch chamado `-` abriria o branch anterior.
function branchValido(projeto, nome) {
  const b = String(nome || '');
  if (!b || b.startsWith('-') || /^refs\//.test(b)) return false;
  return gitSilencioso(projeto, ['check-ref-format', '--branch', b]).ok;
}

// Em QUAL worktree este branch ja esta checado, ou null.
//
// `git worktree add` recusa o mesmo branch em duas arvores, e ate agora isso era
// impossivel: o branch era sempre `worktree-<slug>`, privado deste app. Com
// branch vindo de fora, `main` esta SEMPRE checado no proprio projeto. Custa
// zero comandos novos -- e a mesma leitura que `listar()` ja faz.
function worktreeComBranch(projeto, branch) {
  const r = gitSilencioso(projeto, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return null;
  const alvo = `refs/heads/${branch}`;
  const b = blocos(r.saida).find((p) => p && p.worktree && p.branch === alvo);
  return b ? path.resolve(b.worktree) : null;
}

// Em quais remotos este branch ja existe, LENDO O DISCO.
//
// Sem rede: `for-each-ref` so olha `refs/remotes`, que e o que um fetch anterior
// deixou. E o que permite `prever()` continuar sincrona e funcionando offline --
// que e o que ela promete desde o comeco, e o que deixa o dialogo dizer o que
// vai acontecer ANTES de qualquer escrita.
function remotosComBranch(projeto, branch) {
  const r = gitSilencioso(projeto, ['for-each-ref', '--format=%(refname)', `refs/remotes/*/${branch}`]);
  if (!r.ok) return [];
  const prefixo = 'refs/remotes/';
  return r.saida.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith(prefixo))
    .map((l) => l.slice(prefixo.length))
    // O `*` do for-each-ref casa atravessando `/`, entao `refs/remotes/a/b/x`
    // entraria para o branch `x`. So vale quem termina no branch pedido e cujo
    // nome de remoto nao tem barra.
    .filter((s) => s.endsWith(`/${branch}`))
    .map((s) => s.slice(0, s.length - branch.length - 1))
    .filter((remoto) => remoto && !remoto.includes('/'));
}

// As URLs de TODOS os remotes, cruas.
//
// Todos, e nao so `origin`: quem clonou um fork tem o repo da organizacao em
// `upstream`, e e justamente o nome canonico que o Pronix Flow manda. Sai com 1
// quando nao ha remote nenhum, dai o `gitSilencioso`.
//
// Le pelo git, e nao o `.git/config` como texto, porque e o git que resolve
// `includeIf`, `insteadOf` e o `.git` que e ARQUIVO dentro de um worktree.
// A traducao para `owner/repo` mora no `pedido.js`, que e string pura e testavel
// sem repositorio nenhum.
function remotesDe(projeto) {
  const r = gitSilencioso(projeto, ['config', '--get-regexp', '^remote\\..*\\.url$']);
  if (!r.ok) return [];
  return r.saida.split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.slice(l.indexOf(' ') + 1).trim())
    .filter(Boolean);
}

// So LEITURA. Alimenta o "criar / reaproveitar" do dialogo antes de qualquer
// escrita, para o usuario ver o que vai acontecer com cada repositorio.
//
// `branch` opcional: sem ele vale `worktree-<slug>`, que e a convencao do
// `claude -w` e o comportamento de sempre. Com ele, o branch e literalmente o
// que veio -- e o que faz `feature/TECH-1120` aparecer assim na PR, em vez do
// `worktree-feature-TECH-1120` que nenhuma regra de CI casa.
function prever(projeto, slug, { branch: pedido = '' } = {}) {
  const caminho = caminhoDeWorktree(projeto, slug);
  const branch = String(pedido || '') || branchDeWorktree(slug);

  if (!projeto || !fs.existsSync(projeto)) {
    return { ok: false, motivo: 'pasta', texto: 'a pasta do projeto nao existe' };
  }
  if (!ehRepositorio(projeto)) {
    return { ok: false, motivo: 'sem-git', texto: 'nao e um repositorio git' };
  }
  if (!SLUG_VALIDO.test(String(slug || ''))) {
    // Com branch pedido, "nome invalido" nao diz nada: o branch podia estar
    // certo e so o slug ter morrido (`slugFeature('很长的分支')` e vazio).
    return {
      ok: false,
      motivo: 'nome',
      slug: String(slug || ''),
      branchPedido: branch,
      texto: pedido
        ? `"${pedido}" nao produz nome de pasta usavel (sobrou "${slug}")`
        : 'nome invalido para pasta e branch',
    };
  }
  if (RESERVADOS_WINDOWS.test(String(slug))) {
    return {
      ok: false,
      motivo: 'nome-reservado',
      slug: String(slug),
      texto: `"${slug}" e um nome de pasta reservado no Windows`,
    };
  }
  if (pedido && !branchValido(projeto, branch)) {
    return {
      ok: false,
      motivo: 'branch',
      branchPedido: branch,
      texto: `"${branch}" nao e um nome de branch valido para o git`,
    };
  }

  const wt = lerUma(projeto, caminho);
  // Registrada E com a pasta no disco: da para reaproveitar de verdade.
  const existe = Boolean(wt && wt.existe);

  // A COLISAO. `slugFeature` colapsa `/` em `-`, entao `feature/TECH-1120` e
  // `feature-TECH-1120` disputam a MESMA pasta -- e o mesmo vale para caixa
  // diferente num disco que ignora caixa, e para dois branches longos cortados
  // em 60 caracteres. Comparar com o branch que esta NO DISCO cobre os quatro de
  // uma vez, e nomear `branchAtual` e o que deixa a pessoa entender por que dois
  // branches obviamente diferentes colidiram.
  if (existe && wt.branch && wt.branch !== branch) {
    return {
      ok: false,
      motivo: 'colisao',
      caminho,
      slug: String(slug),
      branchPedido: branch,
      branchAtual: wt.branch,
      texto: `a pasta ${slug} ja e a worktree do branch ${wt.branch}. `
        + `Para abrir ${branch} escolha outro nome de pasta.`,
    };
  }

  // Branch ja aberto em OUTRA arvore. Deixou de ser hipotese no momento em que o
  // branch pode vir de fora: `main` esta sempre checado no proprio projeto.
  const ocupada = worktreeComBranch(projeto, branch);
  if (ocupada && !mesmoCaminho(ocupada, caminho)) {
    return {
      ok: false,
      motivo: 'em-uso',
      caminho,
      branch,
      ocupada,
      texto: `o branch ${branch} ja esta checado em ${ocupada}`,
    };
  }

  const branchExiste = temBranch(projeto, branch);
  const remotos = branchExiste ? [] : remotosComBranch(projeto, branch);

  return {
    ok: true,
    caminho,
    slug: String(slug),
    branch,
    existe,
    branchExiste,
    remotos,
    branchAtual: existe ? wt.branch : '',
    // De onde o branch vai sair, para o dialogo e a resposta HTTP dizerem sem
    // reimplementar o criterio.
    origem: existe ? 'reaproveitada' : (branchExiste ? 'local' : (remotos.length ? 'remoto' : 'novo')),
    acao: existe ? 'reaproveitar' : 'criar',
  };
}

// Cria (ou reaproveita) a worktree `<projeto>/.claude/worktrees/<slug>`.
//
// ASSINCRONA pela mesma razao de `arquivar`: escrita neste modulo nunca e
// sincrona. `worktree add` faz um checkout inteiro, e sincrono ele bloquearia o
// processo principal -- sem IPC, sem hooks, e a janela que o Windows oferece
// fechar.
// `desde` (Fase 10.6, o worker do orquestrador): o commit de onde o branch NOVO
// nasce -- o da sessao coordenadora, para o worker enxergar o que ela ja
// commitou. Ele exige que tudo seja novo: reaproveitar uma pasta ou um branch
// com o mesmo nome entregaria a um worker o trabalho de uma sessao antiga, e
// quem pediu (o modelo) nao teria como saber. Sem `desde`, nada muda.
async function criar(projeto, slug, { branch: pedido = '', buscar: buscarRemoto = true, desde = '' } = {}) {
  const p = prever(projeto, slug, { branch: pedido });
  if (!p.ok) return p;

  if (desde) {
    if (p.existe || p.branchExiste || p.remotos.length) {
      return {
        ok: false,
        motivo: 'existe',
        texto: `ja existe uma worktree ou um branch chamado ${p.branch}; escolha outro nome`,
      };
    }
    // O mesmo portao do `branchValido`: `-` no comeco e argumento disfarcado.
    const ref = String(desde);
    if (ref.startsWith('-') || !gitSilencioso(projeto, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) {
      return { ok: false, motivo: 'desde', texto: `o ponto de partida ${ref} nao e um commit deste repositorio` };
    }
  }

  // Reaproveitar, nunca recriar: e o que deixa reabrir a mesma dupla amanha so
  // redigitando o nome. Recriar apagaria trabalho.
  if (p.existe) {
    return {
      ok: true, caminho: p.caminho, branch: p.branch, origem: p.origem,
      criada: false, branchCriado: false, avisos: [],
    };
  }

  // Pasta apagada a mao deixa o registro orfao, e o `add` recusa por causa dele.
  // Podar antes e o que transforma esse caso num sucesso em vez de um erro que
  // so o `git worktree prune` na mao resolveria.
  await gitLento(projeto, ['worktree', 'prune']);

  const avisos = [];
  let args;
  let branchCriado = false;

  if (p.branchExiste) {
    // Branch ja existe local: aproveita, em vez de `-b`, que falharia. E o caso
    // de quem arquivou a pasta e manteve o branch -- que e exatamente o que
    // `arquivar` faz quando o `-d` recusa por commit nao mesclado.
    args = ['worktree', 'add', p.caminho, p.branch];
  } else if (p.remotos.length) {
    // So no remoto: busca ANTES e cria rastreando, com o upstream EXPLICITO.
    //
    // Nem `--guess-remote` nem o DWIM puro do `worktree add` servem aqui.
    // O `--guess-remote` so vale quando o `<commit-ish>` e OMITIDO e casa contra
    // `$(basename <path>)` -- que aqui e o SLUG (`feature-TECH-1120`), e nao o
    // branch (`feature/TECH-1120`): ele procuraria um branch remoto com o nome
    // da pasta, nao acharia, e cairia em branch orfao. O DWIM puro usa a ref de
    // rastreio COMO ESTA NO DISCO, sem buscar, entao a worktree pode nascer de
    // uma copia de uma semana atras sem nada dizer -- e o codigo de saida nao
    // conta qual dos tres caminhos foi tomado, o que quebraria a promessa de
    // "criar / reaproveitar" do `prever`.
    const remoto = p.remotos.includes('origin') ? 'origin' : p.remotos[0];
    if (buscarRemoto) {
      // O UNICO passo de rede, e por isso pelo `gitDeRede`: um repositorio
      // privado sem credencial valida abriria uma JANELA do Git Credential
      // Manager do nada, e o `execFileSync` congelaria o processo principal
      // enquanto um remoto lento pendura.
      const f = await gitDeRede(projeto, ['fetch', '--no-tags', remoto, p.branch]);
      // Falha de rede NAO recusa: a ref de rastreio ja esta no disco, foi por
      // ela que chegamos aqui. Vira aviso -- a mesma politica do updater.
      if (!f.ok) {
        avisos.push(`nao consegui atualizar ${remoto}/${p.branch}; a worktree saiu da copia local`);
      }
    }
    args = ['worktree', 'add', '--track', '-b', p.branch, p.caminho, `${remoto}/${p.branch}`];
    branchCriado = true;
  } else {
    // Em lugar nenhum: forka do HEAD do projeto -- ou do `desde`, quando veio.
    args = ['worktree', 'add', '-b', p.branch, p.caminho, ...(desde ? [String(desde)] : [])];
    branchCriado = true;
  }

  const r = await gitLento(projeto, args, { ms: MS_GIT_REMOVER });
  if (!r.ok) return { ok: false, motivo: 'add', texto: `Nao consegui criar o worktree: ${r.erro}` };

  return {
    ok: true,
    caminho: p.caminho,
    branch: p.branch,
    origem: p.origem,
    criada: true,
    // Quem criou o BRANCH, que e diferente de quem criou a pasta. E o que o
    // `desfazer` precisa para nao apagar branch de outra pessoa.
    branchCriado,
    avisos: [...avisos, ...copiarInclude(projeto, p.caminho)],
  };
}

// Quem copia o `.env` para dentro do worktree hoje e o CLI, ao rodar o `-w`.
// Criando com `git worktree add`, NINGUEM copia -- e o sintoma e o pior tipo: a
// feature nova parecendo "quebrada" sem motivo, longe da causa. E o mesmo
// defeito que `situacaoInclude()` existe para prevenir, e seria reintroduzido
// pela porta dos fundos.
//
// Falha vira AVISO, nunca excecao: o `.worktreeinclude` e editado a mao, e um
// nome torto ali nao pode derrubar a criacao inteira.
function copiarInclude(projeto, destino) {
  const avisos = [];
  let linhas = [];
  try {
    const inc = situacaoInclude(projeto);
    if (!inc.existe) return avisos;
    linhas = String(inc.conteudo || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return avisos;
  }

  for (const linha of linhas) {
    const origem = path.resolve(projeto, linha);
    // O arquivo e do usuario: uma linha `../../segredos` nao pode virar copia de
    // qualquer lugar do disco para dentro do worktree.
    if (!dentroDe(projeto, origem)) {
      avisos.push(`"${linha}" esta fora do projeto e nao foi copiado`);
      continue;
    }
    if (!fs.existsSync(origem)) continue;
    try {
      fs.cpSync(origem, path.resolve(destino, linha), { recursive: true });
    } catch (err) {
      avisos.push(`nao consegui copiar "${linha}": ${err.message}`);
    }
  }
  return avisos;
}

// Desfaz uma worktree recem-criada, e SO uma recem-criada.
//
// Existe para a dupla: se o segundo repositorio falhar, o primeiro nao pode
// ficar para tras -- e a regra da casa, nenhum caminho de recusa deixa residuo.
// Seguro porque a pasta tem segundos de vida e nao ha trabalho dentro.
//
// `--force` e `-D` de proposito, e e a diferenca para o `arquivar`: la o `-d`
// minusculo e a ultima rede antes de perder codigo, e aqui nao existe codigo a
// perder -- o branch tem a idade do comando anterior, e o `copiarInclude`
// acabou de deixar a arvore suja com o `.env`, que faria as duas versoes
// educadas recusarem sempre.
//
// `apagarBranch` EXISTE PORQUE AQUELE "o branch tem a idade do comando anterior"
// nem sempre foi verdade, e deixou de ser de vez quando o branch passou a poder
// vir de fora. `criar` reaproveita branch que ja existia (o caso de quem
// arquivou a pasta e o `arquivar` deixou o branch para tras por ter commit nao
// mesclado), e com o branch vindo do Pronix Flow o caso extremo e real: abrir
// uma sessao em `main` no primeiro repositorio, o segundo falhar, e o `main`
// local ser apagado. Quem passa o valor e o chamador, com o `branchCriado` que
// o `criar` devolve.
async function desfazer(projeto, caminho, branch, { apagarBranch = true } = {}) {
  const rm = await gitLento(projeto, ['worktree', 'remove', '--force', caminho], { ms: MS_GIT_REMOVER });
  if (!rm.ok) return { ok: false, texto: rm.erro };
  if (branch && apagarBranch) await gitLento(projeto, ['branch', '-D', branch]);
  return { ok: true };
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

  // `lerUma` e nao `listar`: daqui so saem `baseBranch` e `branch`, e reler o
  // projeto inteiro custava 42 comandos git sincronos para abrir um diff.
  const wt = lerUma(projeto, caminho);
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

// O diff para o COORDENADOR do 10.6, que le pela ferramenta Bash do CLI.
//
// Duas diferencas do `diff()` acima, e as duas sao medidas, nao gosto:
//  - ASSINCRONO (`gitLento`): o modelo chama isto quantas vezes quiser, e o
//    `diff()` sincrono congelaria o processo que hospeda todas as sessoes a
//    cada chamada;
//  - teto de 60 KB e RESUMO primeiro: a saida da ferramenta Bash do CLI nao
//    aguenta os 400 KB que a janela aguenta. Sem `arquivo` volta a lista
//    (`--numstat`), com `arquivo` volta o diff daquele arquivo.
//
// A base e a de onde o worker PARTIU (o branch da coordenadora), e nao a base do
// projeto: com tres pontos, e o que o worker fez desde que nasceu.
const MAX_DIFF_ORQ = 60 * 1024;

function numstat(saida, origem) {
  return String(saida || '').split('\n').filter(Boolean).map((l) => {
    const [mais, menos, ...resto] = l.split('\t');
    return { arquivo: resto.join('\t'), mais: mais === '-' ? null : Number(mais), menos: menos === '-' ? null : Number(menos), origem };
  }).filter((x) => x.arquivo);
}

async function diffLento(caminho, { base = '', arquivo = '' } = {}) {
  if (!fs.existsSync(caminho)) return { ok: false, texto: 'a pasta do worktree nao existe mais' };
  const b = String(base || '');
  if (!b || b.startsWith('-')) return { ok: false, texto: 'sem base para comparar' };
  const comum = ['--no-color', '--no-ext-diff'];

  if (!arquivo) {
    const [commitado, indice, solto, status] = await Promise.all([
      gitLento(caminho, ['diff', ...comum, '--numstat', `${b}...HEAD`]),
      gitLento(caminho, ['diff', ...comum, '--numstat', '--cached']),
      gitLento(caminho, ['diff', ...comum, '--numstat']),
      gitLento(caminho, ['status', '--porcelain', '--untracked-files=all']),
    ]);
    if (!commitado.ok) return { ok: false, texto: `nao consegui comparar com ${b}: ${commitado.erro}` };
    const novos = String(status.saida || '').split('\n').filter((l) => l.startsWith('??'))
      .map((l) => ({ arquivo: l.slice(3).trim(), mais: null, menos: null, origem: 'nao-rastreado' }));
    const arquivos = [
      ...numstat(commitado.saida, 'commitado'),
      ...numstat(indice.saida, 'nao-commitado'),
      ...numstat(solto.saida, 'nao-commitado'),
      ...novos,
    ];
    return { ok: true, base: b, arquivos, vazio: arquivos.length === 0 };
  }

  const alvo = String(arquivo);
  // Caminho do repositorio, nunca absoluto nem para fora: e texto do modelo.
  if (path.isAbsolute(alvo) || alvo.split(/[\\/]/).includes('..')) {
    return { ok: false, texto: 'arquivo tem de ser um caminho relativo dentro do repositorio' };
  }
  const [commitado, indice, solto] = await Promise.all([
    gitLento(caminho, ['diff', ...comum, `${b}...HEAD`, '--', alvo]),
    gitLento(caminho, ['diff', ...comum, '--cached', '--', alvo]),
    gitLento(caminho, ['diff', ...comum, '--', alvo]),
  ]);
  let texto = `${commitado.saida || ''}${indice.saida || ''}${solto.saida || ''}`;
  if (!texto && fs.existsSync(path.join(caminho, alvo))) {
    // Nao rastreado: o mesmo --no-index do `naoRastreados`, que sai com 1.
    const r = await new Promise((ok) => {
      execFile('git', ['diff', ...comum, '--no-index', '--', '/dev/null', alvo], opcoesGit(caminho, MS_GIT),
        (_err, saida) => ok(String(saida || '')));
    });
    texto = r;
  }
  const truncado = texto.length > MAX_DIFF_ORQ;
  return { ok: true, base: b, arquivo: alvo, diff: truncado ? texto.slice(0, MAX_DIFF_ORQ) : texto, truncado };
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
  MS_GIT,
  MS_GIT_REMOVER,
  MS_SCRIPT_ARQUIVAR,
  estadoBranch,
  push,
  ignorados,
  situacaoRemoto,
  buscar,
  atualizar,
  listar,
  lerUma,
  dentroDe,
  mesmoCaminho,
  processoVivo,
  ultimoCommit,
  tamanhoDe,
  podeArquivar,
  arquivar,
  prever,
  criar,
  desfazer,
  branchValido,
  worktreeComBranch,
  remotosComBranch,
  remotesDe,
  RESERVADOS_WINDOWS,
  caminhoDeWorktree,
  branchDeWorktree,
  triarLote,
  arquivarVarias,
  diff,
  MAX_DIFF,
  diffLento,
  MAX_DIFF_ORQ,
  situacaoInclude,
  criarInclude,
  processoVivo,
};
