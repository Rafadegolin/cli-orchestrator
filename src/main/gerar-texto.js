'use strict';

// O botao "Gerar" do painel Git (redesign R7): a mensagem de commit, ou o
// titulo e a descricao do PR, escritos pelo `claude -p` em SEGUNDO PLANO --
// decisao do usuario. Nao passa pela sessao do painel (que pode estar no meio
// de outra coisa) e nao usa ferramenta nenhuma: o diff vai no proprio prompt.
//
// Custa alguns centavos por clique (o tooltip diz isso) e leva de 5 a 15
// segundos. Um por pasta de cada vez; prazo de 90s.
//
// O ambiente e o `envLimpo` do terminais.js, injetado: rodando de dentro de
// uma sessao do Claude Code, o processo filho nao pode herdar a identidade
// dela. Node puro -- o `teste:gerar` troca o binario por um script falso pelo
// `ORQ_CLAUDE_BIN`, a mesma porta da sonda do claude-flags.js.

const { execFile } = require('child_process');

const MS_GERAR = 90_000;
const MAX_DIFF = 20_000;
const emAndamento = new Set();

// O comando a rodar. `ORQ_CLAUDE_SCRIPT` (so teste) roda um script .js pelo
// proprio Node: no Windows o Node recusa executar `.cmd` sem shell, e passar
// por shell com um diff no meio seria pedir problema de aspas.
function comando() {
  if (process.env.ORQ_CLAUDE_SCRIPT) return [process.execPath, [process.env.ORQ_CLAUDE_SCRIPT]];
  return [process.env.ORQ_CLAUDE_BIN || 'claude', []];
}

function montarPrompt(modo, { stat, diff, issue }) {
  const corte = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n[... diff cortado ...]` : diff;
  const contexto = [
    issue ? `Issue: ${issue}` : '',
    'Resumo das alteracoes (git diff --stat):',
    stat || '(vazio)',
    '',
    'Diff:',
    corte || '(vazio)',
  ].filter((l) => l !== '').join('\n');

  if (modo === 'pr') {
    return 'Escreva o titulo e a descricao de um pull request para as alteracoes abaixo, em portugues do Brasil. '
      + 'Responda SO no formato:\nTITULO: <uma linha, ate 72 caracteres>\nDESCRICAO:\n<markdown curto: o que mudou e por que, '
      + 'em topicos, e como testar>\n\n' + contexto;
  }
  return 'Escreva a mensagem de commit para as alteracoes abaixo, em portugues do Brasil, no estilo: '
    + 'uma linha de assunto de ate 72 caracteres, uma linha em branco e um paragrafo curto explicando o porque. '
    + 'Responda SO com a mensagem, sem cercas de codigo e sem comentarios.\n\n' + contexto;
}

// Separa "TITULO: ...\nDESCRICAO:\n..." do modo PR.
function separarPr(texto) {
  const t = /TITULO:\s*(.+)/i.exec(texto);
  const d = /DESCRICAO:\s*\n?([\s\S]*)$/i.exec(texto);
  return {
    titulo: (t ? t[1] : texto.split('\n')[0] || '').trim().slice(0, 256),
    corpo: (d ? d[1] : '').trim(),
  };
}

// `modo`: 'commit' ou 'pr'. `entrada`: { stat, diff, issue }. `env`: o
// ambiente ja limpo. Devolve { ok, texto } ou { ok, titulo, corpo }.
function gerar(pasta, modo, entrada, { env = process.env, ms = MS_GERAR } = {}) {
  if (emAndamento.has(pasta)) return Promise.resolve({ ok: false, texto: 'Já estou gerando um texto para esta pasta.' });
  if (!(entrada.stat || entrada.diff)) return Promise.resolve({ ok: false, texto: 'Não há alteração para descrever.' });
  emAndamento.add(pasta);
  const prompt = montarPrompt(modo, entrada);
  // O prompt vai pela ENTRADA PADRAO, e nao como argumento: com ate 20 KB de
  // diff dentro, a linha de comando encostaria no limite do Windows, e um
  // argumento gigante e o pior lugar para caractere especial.
  const [bin, prefixo] = comando();
  return new Promise((resolve) => {
    let filho;
    try {
      // `--no-session-persistence`: sem ela o `-p` grava uma conversa na pasta
      // da worktree, e o proximo `claude -c` dali (Retomar, comentario do diff)
      // continuaria a conversa do "Gerar" em vez da sessao de trabalho.
      // `--tools ''` desliga as ferramentas; `--allowedTools` e so lista de
      // permissao, e o modelo ainda podia ler arquivos. A lista variadica fica
      // por ULTIMO para nao engolir outra flag.
      filho = execFile(bin, [...prefixo, '-p', '--output-format', 'text', '--no-session-persistence', '--tools', ''], {
        cwd: pasta,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: ms,
        maxBuffer: 1024 * 1024,
      }, aoTerminar);
    } catch (err) {
      emAndamento.delete(pasta);
      resolve({ ok: false, texto: `Não deu para chamar o Claude Code: ${err.code || err.message}` });
      return;
    }
    filho.stdin.on('error', () => {});
    filho.stdin.end(prompt);

    function aoTerminar(err, saida, erro) {
      emAndamento.delete(pasta);
      if (err) {
        if (err.code === 'ENOENT') { resolve({ ok: false, texto: 'O Claude Code não está no PATH.' }); return; }
        if (err.killed) { resolve({ ok: false, texto: 'O Claude demorou demais para responder.' }); return; }
        const linha = String(erro || err.message || '').split(/\r?\n/).find((l) => l.trim()) || '';
        resolve({ ok: false, texto: `Não deu para gerar: ${linha.slice(0, 200)}` });
        return;
      }
      const texto = String(saida || '').replace(/^```\w*\n?|```\s*$/g, '').trim();
      if (!texto) { resolve({ ok: false, texto: 'O Claude respondeu vazio.' }); return; }
      resolve(modo === 'pr' ? { ok: true, ...separarPr(texto) } : { ok: true, texto });
    }
  });
}

module.exports = { gerar, montarPrompt, separarPr, MS_GERAR, MAX_DIFF };
