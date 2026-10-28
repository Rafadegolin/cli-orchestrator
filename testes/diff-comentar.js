'use strict';
// Comentar linhas no diff e colar no agente (Fase 10.1).
//
// Sem invocar o Claude. Duas pecas substituem o CLI:
//  - o painel que recebe a colagem roda um `node` que so CONSOME a entrada, e
//    nao um cmd.exe. Num shell, cada linha colada sem bracketed paste seria
//    executada -- e um `> trecho` do prompt viraria redirecionamento, criando
//    arquivo. Quem liga o bracketed paste e o proprio teste, escrevendo a
//    sequencia no xterm como se o programa a tivesse pedido;
//  - o caminho "sem painel" troca o comando de retomar por `echo claude -c`,
//    como o `teste:abrir-ui`: o shell ecoa o que o CLI receberia, e o base64 do
//    buffer e decodificado para provar que o prompt chegou.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

async function ate(fn, cond, ms = 10000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    ultimo = await fn();
    if (cond(ultimo)) return ultimo;
    await esperar(200);
  }
  return ultimo;
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Um repositorio descartavel com uma worktree na convencao do `claude -w`:
// `<raiz>/.claude/worktrees/<slug>` no branch `worktree-<slug>`.
function montarRepo() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-diff-comentar-'));
  git(raiz, ['init', '-q', '-b', 'main']);
  git(raiz, ['config', 'user.email', 'teste@exemplo']);
  git(raiz, ['config', 'user.name', 'teste']);
  const linhas = Array.from({ length: 30 }, (_, i) => `linha ${i + 1}`);
  fs.writeFileSync(path.join(raiz, 'a.txt'), `${linhas.join('\n')}\n`);
  git(raiz, ['add', '.']);
  git(raiz, ['commit', '-q', '-m', 'base']);

  const slug = 'diff-comentar';
  const wt = path.join(raiz, '.claude', 'worktrees', slug);
  git(raiz, ['worktree', 'add', '-q', '-b', `worktree-${slug}`, wt]);

  // Dois hunks no mesmo arquivo (linhas 5 e 25), e um arquivo novo.
  const mudadas = linhas.slice();
  mudadas[4] = 'linha 5 mudada';
  mudadas[24] = 'linha 25 mudada';
  fs.writeFileSync(path.join(wt, 'a.txt'), `${mudadas.join('\n')}\n`);
  fs.writeFileSync(path.join(wt, 'novo.txt'), 'um\ndois\n');
  return { raiz, wt, slug };
}

(async () => {
  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqDiff.fechar()`);

  // --- 1. numeracao, sem app -------------------------------------------------
  const DIFF = [
    'diff --git a/x.js b/x.js',
    'index 111..222 100644',
    '--- a/x.js',
    '+++ b/x.js',
    '@@ -10,3 +10,4 @@ function f() {',
    ' contexto',
    '-velha',
    '+nova 1',
    '+nova 2',
    ' fim',
    '@@ -40,2 +41,2 @@',
    '-removida',
    '+posta',
    ' depois',
    'diff --git a/n.txt b/n.txt',
    'new file mode 100644',
    'index 0000000..333',
    '--- /dev/null',
    '+++ b/n.txt',
    '@@ -0,0 +1,2 @@',
    '+um',
    '+dois',
  ].join('\n');

  const num = JSON.parse(await cdp.avaliar(`JSON.stringify(
    window.OrqDiff.separar(${JSON.stringify(DIFF)}, 'teste').map(a => a.numeradas))`));
  const [x, n] = num;
  const em = (a, texto) => a.find((l) => l.texto === texto);
  checar('contexto numera os dois lados', em(x, ' contexto').antiga === 10 && em(x, ' contexto').nova === 10,
    JSON.stringify(em(x, ' contexto')));
  checar('linha removida so tem o numero antigo', em(x, '-velha').antiga === 11 && em(x, '-velha').nova === null);
  checar('linhas novas andam so o lado novo', em(x, '+nova 1').nova === 11 && em(x, '+nova 2').nova === 12
    && em(x, ' fim').nova === 13 && em(x, ' fim').antiga === 12, JSON.stringify(x.slice(5, 10)));
  checar('o segundo hunk recomeca do proprio cabecalho',
    em(x, '-removida').antiga === 40 && em(x, '+posta').nova === 41 && em(x, ' depois').nova === 42);
  checar('cabecalho e meta nao tem numero',
    x.slice(0, 5).every((l) => l.antiga === null && l.nova === null), '');
  checar('arquivo novo (/dev/null) comeca em +1', em(n, '+um').nova === 1 && em(n, '+dois').nova === 2);

  // --- 2. o comentario e o prompt -------------------------------------------
  const prompt = JSON.parse(await cdp.avaliar(`(() => {
    const [a, b] = window.OrqDiff.separar(${JSON.stringify(DIFF)}, 'teste');
    const i = (t) => a.numeradas.findIndex(l => l.texto === t);
    const c1 = window.OrqDiff.comentarioDe(a, i(' contexto'), i('+nova 2'), 'confere isto\\r\\n');
    const c2 = window.OrqDiff.comentarioDe(a, i('-removida'), i('-removida'), 'por que saiu?');
    const c3 = window.OrqDiff.comentarioDe(b, 0, b.numeradas.length - 1, 'arquivo novo');
    return JSON.stringify({ c1, c2, c3, texto: window.OrqDiff.montarPrompt([c1, c2, c3]) });
  })()`));
  checar('intervalo misto usa o lado novo', prompt.c1.lado === 'nova' && prompt.c1.de === 10 && prompt.c1.ate === 12,
    JSON.stringify(prompt.c1));
  checar('so linhas removidas caem no lado antigo', prompt.c2.lado === 'antiga' && prompt.c2.de === 40);
  checar('selecao que pega o cabecalho ignora o que nao tem numero',
    prompt.c3.de === 1 && prompt.c3.ate === 2 && prompt.c3.trecho.length === 2, JSON.stringify(prompt.c3));
  const ESPERADO = [
    'Revise estes pontos:',
    '',
    'x.js:10-12',
    '>  contexto',
    '> -velha',
    '> +nova 1',
    '> +nova 2',
    'confere isto',
    '',
    'x.js:40 (linha removida; numeração antiga)',
    '> -removida',
    'por que saiu?',
    '',
    'n.txt:1-2',
    '> +um',
    '> +dois',
    'arquivo novo',
  ].join('\n');
  checar('o prompt tem a forma combinada', prompt.texto === ESPERADO, JSON.stringify(prompt.texto));
  checar('sem \\r e sem quebra no fim', !/\r/.test(prompt.texto) && !/\s$/.test(prompt.texto));

  const corte = JSON.parse(await cdp.avaliar(`(() => {
    const linhas = ['diff --git a/l.txt b/l.txt', '--- a/l.txt', '+++ b/l.txt', '@@ -0,0 +1,20 @@'];
    for (let k = 1; k <= 20; k++) linhas.push('+l' + k);
    const [a] = window.OrqDiff.separar(linhas.join('\\n'), 't');
    const c = window.OrqDiff.comentarioDe(a, 4, a.numeradas.length - 1, 'longo');
    return JSON.stringify({ n: c.trecho.length, ultimo: c.trecho[c.trecho.length - 1], de: c.de, ate: c.ate });
  })()`));
  checar('trecho longo e cortado com reticencias, mas a referencia continua inteira',
    corte.n === 13 && corte.ultimo === '…' && corte.de === 1 && corte.ate === 20, JSON.stringify(corte));

  // --- 3. pela tela, contra um repositorio de verdade ------------------------
  const { raiz, wt, slug } = montarRepo();
  await cdp.avaliar(`window.OrqDiff.abrir(${JSON.stringify(raiz)}, ${JSON.stringify(wt)}, ${JSON.stringify(slug)})`);
  const arquivos = await ate(() => cdp.avaliar(`window.OrqDiff.arquivos().map(a => a.nome).join(',')`),
    (s) => s.includes('a.txt'), 8000);
  checar('o diff da worktree abre com o arquivo alterado e o novo',
    arquivos.includes('a.txt') && arquivos.includes('novo.txt'), arquivos);

  // Clique na linha mudada e Shift+clique duas linhas abaixo.
  const clicar = (texto, shift = false) => cdp.avaliar(`(() => {
    const alvo = [...document.querySelectorAll('#diff-corpo .diff-comentavel')]
      .find(d => d.textContent === ${JSON.stringify(texto)});
    if (!alvo) return false;
    alvo.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: ${shift} }));
    return true;
  })()`);
  await cdp.avaliar(`document.querySelector('#diff-arquivos .diff-arquivo').click()`);
  checar('clicar numa linha abre a caixa', await clicar('+linha 5 mudada')
    && await cdp.avaliar(`!!document.querySelector('#diff-corpo .diff-editor-campo')`));
  await clicar(' linha 7', true);
  checar('Shift+clique estende o intervalo',
    await cdp.avaliar(`document.querySelectorAll('#diff-corpo .diff-selecionada').length`) >= 3);

  // Esc com a caixa aberta cancela o comentario, e o overlay fica.
  await esperar(100);
  await cdp.avaliar(`document.querySelector('.diff-editor-campo').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  checar('Esc na caixa cancela o comentario e o overlay continua aberto',
    await cdp.avaliar(`!document.querySelector('.diff-editor') && !document.getElementById('diff').hidden`));

  // Comenta de novo e salva com Enter.
  const comentar = async (texto, linha, shiftAte) => {
    await clicar(linha);
    if (shiftAte) await clicar(shiftAte, true);
    await esperar(50);
    await cdp.avaliar(`(() => {
      const c = document.querySelector('.diff-editor-campo');
      c.value = ${JSON.stringify(texto)};
      c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
  };
  await comentar('isto quebra o parser', '+linha 5 mudada', ' linha 7');
  await comentar('confere o fim', '+linha 25 mudada');
  const rasc = JSON.parse(await cdp.avaliar(`JSON.stringify(window.OrqDiff.rascunho())`));
  checar('dois comentarios no rascunho, com a numeracao do arquivo novo',
    rasc.length === 2 && rasc[0].de === 5 && rasc[0].ate === 7 && rasc[1].de === 25,
    JSON.stringify(rasc.map((c) => [c.de, c.ate, c.texto])));
  checar('as notas aparecem no arquivo aberto',
    await cdp.avaliar(`document.querySelectorAll('#diff-corpo .diff-nota').length`) === 2);
  checar('o rodape conta o rascunho',
    (await cdp.avaliar(`document.getElementById('diff-rodape').hidden ? '' : document.getElementById('diff-colar').textContent`))
      .includes('2 comentários'));
  checar('o processo principal sabe do rascunho (dialogo de fechar)',
    await ate(() => cdp.avaliar(`window.orq.rascunhoDiffNoMain()`), (v) => v === 2, 3000) === 2);

  // O rascunho e por worktree e sobrevive a fechar e reabrir o overlay.
  await cdp.avaliar(`window.OrqDiff.fechar()`);
  await cdp.avaliar(`window.OrqDiff.abrir(${JSON.stringify(raiz)}, ${JSON.stringify(wt)}, ${JSON.stringify(slug)})`);
  await ate(() => cdp.avaliar(`window.OrqDiff.arquivos().length`), (k) => k > 0, 8000);
  checar('reabrir o diff mantem o rascunho', (await cdp.avaliar(`window.OrqDiff.rascunho().length`)) === 2);

  // --- 4. colar na sessao da worktree ----------------------------------------
  // O painel fica na RAIZ com `feature` = slug: e como o `claude -w` abre. E
  // roda um node que so consome a entrada (ver o cabecalho).
  const id = await cdp.avaliar(`(async () => {
    const p = await window.OrqGrade.criarPainel({
      cwd: ${JSON.stringify(raiz)}, feature: ${JSON.stringify(slug)},
      comandoInicial: 'node -e "process.stdin.on(\\'data\\', () => {})"',
    });
    return p.id;
  })()`);
  const P = `window.OrqPainel.painelPorId.get(${JSON.stringify(id)})`;
  await ate(() => cdp.avaliar(`${P}.textoDaTela({ flush: true })`), (t) => /node -e/.test(t), 8000);
  await esperar(1500);

  checar('a sessao do `claude -w` e achada pela raiz + feature',
    await cdp.avaliar(`window.OrqDiff.painelDaWorktree(${JSON.stringify(raiz)}, ${JSON.stringify(wt)}, ${JSON.stringify(slug)})?.id`) === id);

  await cdp.avaliar(`(() => {
    const p = ${P};
    window.__colas = [];
    window.__dados = [];
    const original = p.term.paste.bind(p.term);
    p.term.paste = (t) => { window.__colas.push(t); original(t); };
    window.__espiao = p.term.onData((d) => window.__dados.push(d));
  })()`);

  // Recusa: sem bracketed paste (o que um shell seria), multilinha nao cola.
  checar('sem bracketed paste, texto multilinha nao e colado',
    await cdp.avaliar(`${P}.colarTexto('a\\nb')`) === false
      && await cdp.avaliar(`window.__colas.length`) === 0);

  // O programa "pede" bracketed paste, como a TUI do Claude faz.
  await cdp.avaliar(`new Promise(ok => ${P}.term.write('\\x1b[?2004h', ok))`);

  await cdp.avaliar(`${P}.definirStatus('esperando', 'esperando')`);
  checar('em esperando, nao cola', await cdp.avaliar(`${P}.colarTexto('a\\nb')`) === false);
  await cdp.avaliar(`${P}.definirStatus('rodando', 'rodando')`);

  await cdp.avaliar(`${P}.tipoPainel = 'terminal'`);
  checar('painel de terminal nao recebe multilinha', await cdp.avaliar(`${P}.colarTexto('a\\nb')`) === false);
  await cdp.avaliar(`${P}.tipoPainel = 'sessao'`);
  checar('nenhuma das recusas escreveu nada', await cdp.avaliar(`window.__colas.length`) === 0);

  const esperado = JSON.parse(await cdp.avaliar(`JSON.stringify(window.OrqDiff.montarPrompt(window.OrqDiff.rascunho()))`));
  await cdp.avaliar(`document.getElementById('diff-colar').click()`);
  await esperar(400);
  const dados = JSON.parse(await cdp.avaliar(`JSON.stringify(window.__dados)`));
  const junto = dados.join('');
  checar('colou uma vez so, com o prompt do rascunho',
    (await cdp.avaliar(`window.__colas.length`)) === 1
      && (await cdp.avaliar(`window.__colas[0]`)) === esperado, `${dados.length} pacotes`);
  const ini = junto.indexOf('\x1b[200~');
  const fim = junto.indexOf('\x1b[201~');
  checar('chegou ao PTY embrulhado em bracketed paste',
    ini === 0 && fim > ini && junto.split('\x1b[200~').length === 2, JSON.stringify(junto.slice(0, 40)));
  checar('e nada depois do fim da colagem (nenhum Enter)', fim + 6 === junto.length, JSON.stringify(junto.slice(fim)));
  checar('colar limpa o rascunho, fecha o diff e o main volta a zero',
    (await cdp.avaliar(`window.OrqDiff.rascunho().length`)) === 0
      && await cdp.avaliar(`document.getElementById('diff').hidden`) === true
      && await ate(() => cdp.avaliar(`window.orq.rascunhoDiffNoMain()`), (v) => v === 0, 3000) === 0);
  await cdp.avaliar(`window.__espiao.dispose()`);

  // --- 5. sem painel: abre a sessao na worktree com o prompt no prefill -------
  await zerarGrade(cdp);
  await cdp.avaliar(`window.OrqDiff.abrir(${JSON.stringify(raiz)}, ${JSON.stringify(wt)}, ${JSON.stringify(slug)})`);
  await ate(() => cdp.avaliar(`window.OrqDiff.arquivos().length`), (k) => k > 0, 8000);
  await cdp.avaliar(`document.querySelector('#diff-arquivos .diff-arquivo').click()`);
  await comentar('sem painel', '+linha 5 mudada');
  const prompt2 = JSON.parse(await cdp.avaliar(`JSON.stringify(window.OrqDiff.montarPrompt(window.OrqDiff.rascunho()))`));

  const original = await cdp.avaliar(`window.OrqProjetos.COMANDO_RETOMAR`);
  await cdp.avaliar(`window.OrqProjetos.COMANDO_RETOMAR = 'echo claude -c'`);
  const temPrefill = await cdp.avaliar(`window.orq.claudePrefill()`);
  await cdp.avaliar(`window.OrqDiff.colar()`);
  await cdp.avaliar(`window.OrqProjetos.COMANDO_RETOMAR = ${JSON.stringify(original)}`);

  const novo = JSON.parse(await ate(() => cdp.avaliar(`JSON.stringify([...window.OrqPainel.painelPorId.values()]
    .map(p => ({ id: p.id, cwd: p.cwd, feature: p.feature })))`), (s) => JSON.parse(s).length > 0, 8000));
  checar('abriu um painel na WORKTREE, com a feature dela',
    novo.length === 1 && novo[0].cwd.toLowerCase() === wt.toLowerCase() && novo[0].feature === slug,
    JSON.stringify(novo));

  if (temPrefill) {
    const PN = `window.OrqPainel.painelPorId.get(${JSON.stringify(novo[0].id)})`;
    const tela = await ate(() => cdp.avaliar(`${PN}.textoDoBuffer()`), (t) => /--prefill-b64 \S+/.test(t), 10000);
    const b64 = (/--prefill-b64 (\S+)/.exec(tela) || [])[1] || '';
    const decodificado = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    checar('o comando leva `claude -c` com o prompt no --prefill-b64',
      /claude --deep-link-origin --prefill-b64 \S+ -c/.test(tela) && decodificado === prompt2,
      JSON.stringify(decodificado.slice(0, 60)));
  } else {
    console.log('AVISO  o CLI desta maquina nao tem --prefill-b64: o caminho testado foi o da area de transferencia');
  }

  await zerarGrade(cdp);
  try {
    git(raiz, ['worktree', 'remove', '--force', wt]);
  } catch { /* ok */ }
  fs.rmSync(raiz, { recursive: true, force: true });
  encerrar('DIFF_COMENTAR');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
