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

const { execFileSync } = require('child_process');
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
    if (branch && baseBranch && branch !== baseBranch) {
      const log = gitSilencioso(projeto, ['log', '--oneline', `${baseBranch}..${branch}`]);
      if (log.ok) naoMesclados = log.saida.split(/\r?\n/).filter((l) => l.trim()).length;
    }

    return {
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
      prunable: 'prunable' in p,
    };
  });
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

// ------------------------------------------------------- .worktreeinclude

// Sem esse arquivo o worktree e um checkout limpo: o .env nao vai junto e a
// aplicacao nao sobe la dentro. O sintoma e a feature nova parecer "quebrada"
// sem motivo aparente.
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
  listar,
  podeArquivar,
  arquivar,
  situacaoInclude,
  criarInclude,
  processoVivo,
};
