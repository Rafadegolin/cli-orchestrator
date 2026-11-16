'use strict';

// O bloco de notas contra o app DE VERDADE: digitar (pelo `Input.insertText`
// do CDP, que e o caminho do teclado), abas, fechar o painel e reabrir, RELOAD
// da janela no meio do debounce, Ctrl+F, formatacao, o atalho de abrir/fechar,
// HTML hostil no arquivo, e mandar o texto para uma sessao sem Enter (em
// Markdown).
//
// Precisa do `npm run dev` no ar. O que decide se o texto sobrevive no disco
// (tetos, arquivo estragado, backup) fica no `teste:notas`, em Node puro.
//
// O `notas.json` do perfil de desenvolvimento e guardado antes e devolvido no
// fim: o teste nao pode apagar a nota de quem desenvolve.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const PASTA_SHELL = path.join(os.tmpdir(), `orq-teste-notas-ui-${Date.now()}`);
const N = '[...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas)';

function hook(caminho, id, corpo) {
  return new Promise((ok) => {
    const req = http.request({ host: '127.0.0.1', port: 47615, path: caminho, method: 'POST', headers: { 'x-orq-id': id } }, (res) => {
      res.resume();
      res.on('end', ok);
    });
    req.on('error', ok);
    req.end(JSON.stringify(corpo));
  });
}

(async () => {
  let cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  const c = JSON.parse(await cdp.avaliar('window.orq.constantes().then((x) => JSON.stringify(x))'));
  const ARQ = c.arquivoNotas;
  const antes = fs.existsSync(ARQ) ? fs.readFileSync(ARQ, 'utf8') : null;
  fs.rmSync(ARQ, { force: true });
  // O estado da janela foi lido antes de apagarmos o arquivo: recarregar zera.
  await cdp.enviar('Page.reload');
  await esperar(4000);
  cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  const digitar = (texto) => cdp.enviar('Input.insertText', { text: texto });
  const tecla = async (key, code, mods = 0, vk = 0) => {
    await cdp.enviar('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await cdp.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  const CTRL = 2;
  const SHIFT = 8;
  const notasPaineis = () => cdp.avaliar('[...window.OrqPainel.painelPorId.values()].filter((p) => p.ehNotas).length');
  const valor = () => cdp.avaliar(`${N}?.notas.texto() ?? null`);
  const html = () => cdp.avaliar(`${N}?.notas.editor.innerHTML ?? null`);
  const focarTexto = () => cdp.avaliar(`(() => { const p = ${N}; p.focar(); p.notas.editor.focus(); return 'ok'; })()`);
  const cursorNoFim = () => cdp.avaliar(`(() => { const n = ${N}.notas; n.editor.focus(); const t = n.texto(); n.selecionar(t.length, t.length); return 'ok'; })()`);
  const lerDisco = () => { try { return JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch { return null; } };

  // ------------------------------------------------------------ abrir e escrever

  await cdp.avaliar('window.OrqNotas.abrir()');
  await esperar(800);
  checar('o bloco abre como painel na grade', await notasPaineis() === 1);
  await focarTexto();
  await digitar('primeira nota\nlinha com a palavra alvo\noutra linha alvo');
  await esperar(900);
  let disco = lerDisco();
  checar('o que se digita chega ao disco sozinho (debounce)',
    disco && disco.abas[0].texto === 'primeira nota\nlinha com a palavra alvo\noutra linha alvo', JSON.stringify(disco).slice(0, 300));
  checar('e o html vai junto', disco && typeof disco.abas[0].html === 'string' && disco.abas[0].html.includes('alvo'));
  const titulo = await cdp.avaliar(`document.querySelector('.painel-notas .notas-aba.ativa .notas-aba-nome')?.textContent`);
  checar('a aba se chama pela primeira linha', titulo === 'primeira nota', String(titulo));

  await cdp.avaliar(`document.querySelector('.painel-notas .notas-nova').click()`);
  await esperar(200);
  await digitar('segunda aba NOTA-MARCA-4242');
  await esperar(900);
  disco = lerDisco();
  checar('a segunda aba tambem foi gravada, e e a ativa',
    disco && disco.abas.length === 2 && disco.abas[1].texto === 'segunda aba NOTA-MARCA-4242' && disco.ativa === disco.abas[1].id,
    JSON.stringify(disco && disco.abas.map((a) => a.texto)));

  checar('o bloco NAO entra na lateral',
    await cdp.avaliar(`!document.querySelector('.card[data-id="' + ${N}.id + '"]')`));
  checar('e o painelEm nunca o devolve',
    await cdp.avaliar(`window.OrqLigacoes.painelEm(${JSON.stringify(c.pastaDados)}) === null`));

  // ------------------------------------------------------------ fechar e reabrir

  await cdp.avaliar(`document.querySelector('.painel-notas .painel-fechar').click()`);
  await esperar(500);
  checar('o × fecha o painel', await notasPaineis() === 0);
  await cdp.avaliar('window.OrqNotas.abrir()');
  await esperar(800);
  checar('reabrir traz o texto da aba ativa', await valor() === 'segunda aba NOTA-MARCA-4242', String(await valor()));
  checar('e as duas abas', await cdp.avaliar(`document.querySelectorAll('.painel-notas .notas-aba').length`) === 2);
  await cdp.avaliar('window.OrqNotas.abrir()');
  await esperar(400);
  checar('abrir de novo foca o mesmo, sem duplicar', await notasPaineis() === 1);

  // ------------------------------------------------------------ reload no meio do debounce

  await cursorNoFim();
  await digitar(' + escrito agora');
  // SEM esperar o debounce: so o `sendSync` do beforeunload salva isto.
  await cdp.enviar('Page.reload');
  await esperar(5000);
  cdp = await conectar();
  await aoFrente(cdp);
  for (let i = 0; i < 20 && (await notasPaineis()) !== 1; i++) await esperar(300);
  await esperar(800);
  checar('depois do reload o bloco volta sozinho na grade', await notasPaineis() === 1);
  checar('com a frase digitada um instante antes do reload', await valor() === 'segunda aba NOTA-MARCA-4242 + escrito agora', String(await valor()));

  // ------------------------------------------------------------ Ctrl+F

  await cdp.avaliar(`document.querySelectorAll('.painel-notas .notas-aba')[0].click()`);
  await esperar(200);
  await focarTexto();
  await tecla('f', 'KeyF', CTRL, 70);
  await esperar(200);
  checar('Ctrl+F abre a busca', await cdp.avaliar(`document.querySelector('.painel-notas .notas-busca').hidden === false`));
  await digitar('ALVO');
  await esperar(200);
  let conta = await cdp.avaliar(`document.querySelector('.painel-notas .notas-busca-conta').textContent`);
  checar('a busca ignora maiusculas e conta', conta === '1/2', conta);
  checar('os achados ficam realcados', await cdp.avaliar(`CSS.highlights.get('notas-achado')?.size ?? 0`) === 2);
  await tecla('Enter', 'Enter', 0, 13);
  await esperar(150);
  conta = await cdp.avaliar(`document.querySelector('.painel-notas .notas-busca-conta').textContent`);
  const achado = await cdp.avaliar(`${N}.notas.achadoAtual()`);
  checar('Enter vai para o proximo, e o foco continua na busca', conta === '2/2' && achado === 'alvo'
    && await cdp.avaliar(`document.activeElement.classList.contains('notas-busca-campo')`), `${conta} ${achado}`);
  await tecla('Escape', 'Escape', 0, 27);
  await esperar(150);
  checar('Esc fecha a busca', await cdp.avaliar(`document.querySelector('.painel-notas .notas-busca').hidden === true`));
  checar('e seleciona o achado atual no texto', await cdp.avaliar(`${N}.notas.selecao()`) === 'alvo');
  checar('e apaga o realce', !(await cdp.avaliar(`CSS.highlights.has('notas-achado')`)));

  // ------------------------------------------------------------ quebra automatica

  // Uma aba a parte, no fim: as outras secoes contam as abas pelo indice.
  await cdp.avaliar(`document.querySelector('.painel-notas .notas-nova').click()`);
  await esperar(200);
  const paragrafo = 'integração do checkout com o CRM e ja levamos alguns dados para la '.repeat(12);
  // A marca fica no MEIO, com texto de sobra depois: no fim, a rolagem parava
  // no maximo e o teste passaria mesmo com a conta errada.
  const p4 = `${paragrafo}\n${paragrafo}\n${paragrafo}\n${paragrafo}`;
  await digitar(`${p4}\nhttps://exemplo.com/${'x'.repeat(400)}\n${p4}\n\nmeio QUEBRA-MARCA-77\n${p4}\n${p4}`);
  await esperar(300);
  const larg = JSON.parse(await cdp.avaliar(`(() => { const t = ${N}.notas.editor; return JSON.stringify([t.scrollWidth, t.clientWidth, t.scrollHeight, t.clientHeight]); })()`));
  checar('linha longa quebra na largura, sem rolagem horizontal', larg[0] <= larg[1], JSON.stringify(larg));
  checar('e o texto quebrado passa bem da altura do painel (a busca tem o que rolar)', larg[2] > larg[3] * 3, JSON.stringify(larg));
  await cdp.avaliar(`(() => { const n = ${N}.notas; n.editor.focus(); n.selecionar(0, 0); n.editor.scrollTop = 0; return 'ok'; })()`);
  await tecla('f', 'KeyF', CTRL, 70);
  await esperar(200);
  await digitar('QUEBRA-MARCA');
  await esperar(200);
  await tecla('Enter', 'Enter', 0, 13);
  await esperar(150);
  // Onde a marca esta de verdade: o retangulo do texto, medido sem o app.
  const vis = JSON.parse(await cdp.avaliar(`(() => {
    const ed = ${N}.notas.editor;
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let no;
    while ((no = w.nextNode()) && !no.data.includes('QUEBRA-MARCA'));
    const r = document.createRange();
    r.setStart(no, no.data.indexOf('QUEBRA-MARCA'));
    r.setEnd(no, no.data.indexOf('QUEBRA-MARCA') + 12);
    const a = r.getBoundingClientRect();
    const e = ed.getBoundingClientRect();
    return JSON.stringify({ topo: a.top - e.top, fundo: a.bottom - e.top, alt: ed.clientHeight, scroll: ed.scrollTop, max: ed.scrollHeight - ed.clientHeight });
  })()`));
  checar('a busca rola ate o achado no texto quebrado (e nao so ate o fim)',
    vis.topo >= 0 && vis.fundo <= vis.alt && vis.scroll < vis.max - 50, JSON.stringify(vis));
  await tecla('Escape', 'Escape', 0, 27);
  await esperar(150);
  await cdp.avaliar(`document.querySelectorAll('.painel-notas .notas-aba')[0].click()`);
  await esperar(200);

  // ------------------------------------------------------------ teclas que nao podem vazar

  const dens = await cdp.avaliar(`document.getElementById('app').dataset.densidade`);
  await cursorNoFim();
  await digitar('3');
  await tecla('Enter', 'Enter', CTRL, 13);
  await esperar(200);
  checar('digitar 3 na nota nao troca a densidade', await cdp.avaliar(`document.getElementById('app').dataset.densidade`) === dens);
  checar('e o 3 entrou no texto', (await valor()).endsWith('alvo3'), JSON.stringify((await valor()).slice(-10)));

  // ------------------------------------------------------------ formatacao

  const lateral = await cdp.avaliar(`document.getElementById('app').dataset.lateral`);
  // "primeira" (0..8) em negrito pelo Ctrl+B DE VERDADE: no bloco ele e
  // negrito, e nao a lateral.
  await cdp.avaliar(`(() => { const n = ${N}.notas; n.editor.focus(); n.selecionar(0, 8); return 'ok'; })()`);
  await tecla('b', 'KeyB', CTRL, 66);
  await esperar(200);
  checar('Ctrl+B no bloco poe negrito', /<b>primeira<\/b>/.test(await html()), await html());
  checar('e NAO recolhe a lateral', await cdp.avaliar(`document.getElementById('app').dataset.lateral`) === lateral);
  // "nota" (9..13) em italico pelo botao da barra.
  await cdp.avaliar(`(() => { const n = ${N}.notas; n.editor.focus(); n.selecionar(9, 13); return 'ok'; })()`);
  await cdp.avaliar(`document.querySelector('.painel-notas .notas-formato[data-formato="italic"]').click()`);
  await esperar(200);
  checar('o botao de italico formata a selecao', /<i>nota<\/i>/.test(await html()), await html());
  checar('o texto puro nao muda com a formatacao', (await valor()).startsWith('primeira nota\nlinha com a palavra alvo'), await valor());
  // A ultima linha vira lista.
  await cdp.avaliar(`(() => { const n = ${N}.notas; n.editor.focus(); const t = n.texto(); n.selecionar(t.length - 2, t.length - 2); return 'ok'; })()`);
  await cdp.avaliar(`document.querySelector('.painel-notas .notas-formato[data-formato="insertUnorderedList"]').click()`);
  await esperar(200);
  const md = await cdp.avaliar(`(() => { const n = ${N}.notas; n.editor.focus(); n.selecionar(0, 0); return n.markdown(); })()`);
  checar('para a sessao vai Markdown: negrito, italico e lista',
    md.startsWith('**primeira** _nota_\n') && md.includes('\n- outra linha alvo3'), JSON.stringify(md));
  await esperar(900);
  disco = lerDisco();
  checar('a formatacao chega ao disco', disco && /<b>primeira<\/b>/.test(disco.abas[0].html) && /<li>/.test(disco.abas[0].html));

  // ------------------------------------------------------------ atalho de abrir/fechar

  await focarTexto();
  await tecla('N', 'KeyN', CTRL | SHIFT, 78);
  await esperar(500);
  checar('Ctrl+Shift+N com o foco no bloco fecha o bloco', await notasPaineis() === 0);
  fs.mkdirSync(PASTA_SHELL, { recursive: true });
  const shell = await cdp.avaliar(`window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(PASTA_SHELL)}, feature: 'receptora' }).then((p) => p.id)`);
  await esperar(2000);
  const P = `window.OrqPainel.painelPorId.get(${JSON.stringify(shell)})`;
  await cdp.avaliar(`(() => { const p = ${P}; window.__vazou = 0; window.__vistos = []; window.__sub = p.term.onData((d) => { window.__vistos.push(d); if (d.replace(/\\x1b\\[[IO]/g, '')) window.__vazou++; }); p.focar(); p.term.focus(); return 'ok'; })()`);
  await tecla('N', 'KeyN', CTRL | SHIFT, 78);
  await esperar(900);
  checar('com o foco num terminal, o atalho abre o bloco', await notasPaineis() === 1);
  // O ConPTY liga o aviso de foco (modo 1004): perder o foco para o bloco manda
  // ESC[O, e isso e o terminal funcionando. A tecla em si nao pode chegar.
  checar('e a tecla nao chega ao PTY', await cdp.avaliar('(() => { window.__sub.dispose(); return window.__vazou; })()') === 0,
    await cdp.avaliar('JSON.stringify(window.__vistos)'));
  checar('e a formatacao voltou com o bloco', /<b>primeira<\/b>/.test(await html() || ''), await html());

  // ------------------------------------------------------------ mandar para uma sessao

  await cdp.avaliar(`document.querySelectorAll('.painel-notas .notas-aba')[1].click()`);
  await esperar(200);
  // Seleciona so a marca.
  await cdp.avaliar(`(() => { const n = ${N}.notas; n.editor.focus(); const i = n.texto().indexOf('NOTA-MARCA-4242'); n.selecionar(i, i + 15); return 'ok'; })()`);
  await cdp.avaliar(`document.querySelector('.painel-notas .notas-enviar').click()`);
  await esperar(200);
  const itens = JSON.parse(await cdp.avaliar(`JSON.stringify([...document.querySelectorAll('.menu-notas button')].map((b) => b.textContent))`));
  checar('o menu lista as sessoes, e nao o proprio bloco', itens.includes('receptora') && !itens.includes('Bloco de notas'), JSON.stringify(itens));
  await cdp.avaliar(`[...document.querySelectorAll('.menu-notas button')].find((b) => b.textContent === 'receptora').click()`);
  await esperar(1500);
  const buf = await cdp.avaliar(`window.OrqPainel.achatar(${P}.textoDoBuffer())`);
  checar('a selecao chegou ao terminal da sessao', buf.includes('NOTA-MARCA-4242'), buf.slice(-200));
  checar('e NAO foi enviada: nenhum Enter, o cmd nao executou nada',
    !/reconhecido|not recognized/i.test(buf), buf.slice(-200));

  await hook('/evento/Notification/permissao', shell, { cwd: PASTA_SHELL, message: 'Claude needs your permission' });
  await esperar(400);
  await cdp.avaliar(`(() => { const n = ${N}.notas; n.editor.focus(); n.selecionar(0, 11); return 'ok'; })()`);
  await cdp.avaliar(`document.querySelector('.painel-notas .notas-enviar').click()`);
  await esperar(200);
  await cdp.avaliar(`[...document.querySelectorAll('.menu-notas button')].find((b) => b.textContent === 'receptora')?.click()`);
  await esperar(800);
  const buf2 = await cdp.avaliar(`window.OrqPainel.achatar(${P}.textoDoBuffer())`);
  checar('com a sessao esperando, o texto e recusado', !buf2.includes('segunda aba'), buf2.slice(-200));

  // ------------------------------------------------------------ HTML hostil no arquivo

  await cdp.avaliar(`(() => { for (const p of [...window.OrqPainel.painelPorId.values()]) p.destruir(); return 'ok'; })()`);
  await esperar(1500);
  fs.writeFileSync(ARQ, JSON.stringify({
    versao: 1,
    ativa: 'h',
    abas: [{
      id: 'h',
      titulo: '',
      texto: 'ok',
      html: '<img src="x" onerror="window.__xss=1"><script>window.__xss=2</script>'
        + '<b style="color:red" onclick="window.__xss=3">ok</b><a href="https://x">link</a><iframe src="x"></iframe>',
    }],
  }));
  await cdp.enviar('Page.reload');
  await esperar(4000);
  cdp = await conectar();
  await aoFrente(cdp);
  await cdp.avaliar('window.OrqNotas.abrir()');
  await esperar(1000);
  checar('HTML hostil do arquivo chega LIMPO: so as tags da lista, sem atributo', await html() === '<b>ok</b>link', await html());
  checar('e nada dele rodou', await cdp.avaliar('window.__xss === undefined'));

  // ------------------------------------------------------------ faxina

  await cdp.avaliar(`(() => { for (const p of [...window.OrqPainel.painelPorId.values()]) p.destruir(); return 'ok'; })()`);
  await esperar(1500);
  if (antes === null) fs.rmSync(ARQ, { force: true });
  else fs.writeFileSync(ARQ, antes);
  // O estado em memoria da janela ainda tem o texto do teste: recarregar faz ela
  // reler o arquivo devolvido, em vez de regrava-lo na proxima abertura.
  await cdp.enviar('Page.reload');
  await esperar(3000);
  try { fs.rmSync(PASTA_SHELL, { recursive: true, force: true }); } catch { /* pasta presa */ }

  encerrar('NOTAS_UI');
})().catch((e) => { console.error('ERRO', e.stack || e.message); process.exit(3); });
