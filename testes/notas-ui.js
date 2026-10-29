'use strict';

// O bloco de notas contra o app DE VERDADE: digitar (pelo `Input.insertText`
// do CDP, que e o caminho do teclado), abas, fechar o painel e reabrir, RELOAD
// da janela no meio do debounce, Ctrl+F, e mandar o texto para uma sessao sem
// Enter.
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
    await cdp.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers: mods, windowsVirtualKeyCode: vk });
    await cdp.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: mods, windowsVirtualKeyCode: vk });
  };
  const notasPaineis = () => cdp.avaliar('[...window.OrqPainel.painelPorId.values()].filter((p) => p.ehNotas).length');
  const valor = () => cdp.avaliar(`[...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas)?.notas.textarea.value ?? null`);
  const focarTexto = () => cdp.avaliar(`[...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).notas.textarea.focus()`);
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
    disco && disco.abas[0].texto === 'primeira nota\nlinha com a palavra alvo\noutra linha alvo', JSON.stringify(disco).slice(0, 200));
  const titulo = await cdp.avaliar(`document.querySelector('.painel-notas .notas-aba.ativa .notas-aba-nome')?.textContent`);
  checar('a aba se chama pela primeira linha', titulo === 'primeira nota', String(titulo));

  await cdp.avaliar(`document.querySelector('.painel-notas .notas-nova').click()`);
  await esperar(200);
  await digitar('segunda aba NOTA-MARCA-4242');
  await esperar(900);
  disco = lerDisco();
  checar('a segunda aba tambem foi gravada, e e a ativa',
    disco && disco.abas.length === 2 && disco.abas[1].texto === 'segunda aba NOTA-MARCA-4242' && disco.ativa === disco.abas[1].id);

  checar('o bloco NAO entra na lateral',
    await cdp.avaliar(`!document.querySelector('.card[data-id="' + [...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).id + '"]')`));
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

  await focarTexto();
  await cdp.avaliar(`(() => { const t = [...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).notas.textarea; t.setSelectionRange(t.value.length, t.value.length); })()`);
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
  await tecla('f', 'KeyF', 2, 70);
  await esperar(200);
  checar('Ctrl+F abre a busca', await cdp.avaliar(`document.querySelector('.painel-notas .notas-busca').hidden === false`));
  await digitar('ALVO');
  await esperar(200);
  let conta = await cdp.avaliar(`document.querySelector('.painel-notas .notas-busca-conta').textContent`);
  checar('a busca ignora maiusculas e conta', conta === '1/2', conta);
  await tecla('Enter', 'Enter', 0, 13);
  await esperar(150);
  conta = await cdp.avaliar(`document.querySelector('.painel-notas .notas-busca-conta').textContent`);
  const sel = JSON.parse(await cdp.avaliar(`(() => { const t = [...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).notas.textarea; return JSON.stringify(t.value.slice(t.selectionStart, t.selectionEnd)); })()`));
  checar('Enter vai para o proximo e seleciona', conta === '2/2' && sel === 'alvo', `${conta} ${sel}`);
  await tecla('Escape', 'Escape', 0, 27);
  await esperar(150);
  checar('Esc fecha a busca', await cdp.avaliar(`document.querySelector('.painel-notas .notas-busca').hidden === true`));

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
  const larg = JSON.parse(await cdp.avaliar(`(() => { const t = [...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).notas.textarea; return JSON.stringify([t.scrollWidth, t.clientWidth, t.scrollHeight, t.clientHeight]); })()`));
  checar('linha longa quebra na largura, sem rolagem horizontal', larg[0] <= larg[1], JSON.stringify(larg));
  checar('e o texto quebrado passa bem da altura do painel (a busca tem o que rolar)', larg[2] > larg[3] * 3, JSON.stringify(larg));
  await cdp.avaliar(`[...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).notas.textarea.setSelectionRange(0, 0)`);
  await cdp.avaliar(`[...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).notas.textarea.scrollTop = 0`);
  await focarTexto();
  await tecla('f', 'KeyF', 2, 70);
  await esperar(200);
  await digitar('QUEBRA-MARCA');
  await esperar(200);
  await tecla('Enter', 'Enter', 0, 13);
  await esperar(150);
  // Onde a marca esta de verdade, medido sem o espelho do app: uma copia da
  // textarea, com a mesma largura e altura zero, com o texto ate a linha da
  // marca -- o scrollHeight dela e o fundo dessa linha.
  const vis = JSON.parse(await cdp.avaliar(`(() => {
    const t = [...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).notas.textarea;
    const c = t.cloneNode();
    c.style.cssText = 'position:absolute;left:-99999px;height:0;width:' + t.offsetWidth + 'px';
    t.parentNode.append(c);
    const fimLinha = t.value.indexOf('\\n', t.value.indexOf('QUEBRA-MARCA'));
    c.value = t.value.slice(0, fimLinha);
    const est = getComputedStyle(t);
    const marca = c.scrollHeight - parseFloat(est.paddingBottom) - parseFloat(est.lineHeight);
    c.remove();
    return JSON.stringify({ topo: t.scrollTop, alt: t.clientHeight, max: t.scrollHeight - t.clientHeight, marca });
  })()`));
  checar('a busca rola ate o achado no texto quebrado (e nao so ate o fim)',
    vis.marca >= vis.topo && vis.marca <= vis.topo + vis.alt - 10 && vis.topo < vis.max - 50, JSON.stringify(vis));
  await tecla('Escape', 'Escape', 0, 27);
  await esperar(150);
  await cdp.avaliar(`document.querySelectorAll('.painel-notas .notas-aba')[0].click()`);
  await esperar(200);

  // ------------------------------------------------------------ teclas que nao podem vazar

  const dens = await cdp.avaliar(`document.getElementById('app').dataset.densidade`);
  await focarTexto();
  await cdp.avaliar(`(() => { const t = [...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).notas.textarea; t.setSelectionRange(t.value.length, t.value.length); })()`);
  await digitar('3');
  await tecla('Enter', 'Enter', 2, 13);
  await esperar(200);
  checar('digitar 3 na nota nao troca a densidade', await cdp.avaliar(`document.getElementById('app').dataset.densidade`) === dens);
  checar('e o 3 entrou no texto', (await valor()).endsWith('alvo3'), JSON.stringify((await valor()).slice(-10)));

  // ------------------------------------------------------------ mandar para uma sessao

  fs.mkdirSync(PASTA_SHELL, { recursive: true });
  const shell = await cdp.avaliar(`window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(PASTA_SHELL)}, feature: 'receptora' }).then((p) => p.id)`);
  await esperar(2000);
  await cdp.avaliar(`document.querySelectorAll('.painel-notas .notas-aba')[1].click()`);
  await esperar(200);
  // Seleciona so a marca.
  await cdp.avaliar(`(() => { const t = [...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).notas.textarea; const i = t.value.indexOf('NOTA-MARCA-4242'); t.setSelectionRange(i, i + 15); })()`);
  await cdp.avaliar(`document.querySelector('.painel-notas .notas-enviar').click()`);
  await esperar(200);
  const itens = JSON.parse(await cdp.avaliar(`JSON.stringify([...document.querySelectorAll('.menu-notas button')].map((b) => b.textContent))`));
  checar('o menu lista as sessoes, e nao o proprio bloco', itens.includes('receptora') && !itens.includes('Bloco de notas'), JSON.stringify(itens));
  await cdp.avaliar(`[...document.querySelectorAll('.menu-notas button')].find((b) => b.textContent === 'receptora').click()`);
  await esperar(1500);
  const buf = await cdp.avaliar(`window.OrqPainel.achatar(window.OrqPainel.painelPorId.get(${JSON.stringify(shell)}).textoDoBuffer())`);
  checar('a selecao chegou ao terminal da sessao', buf.includes('NOTA-MARCA-4242'), buf.slice(-200));
  checar('e NAO foi enviada: nenhum Enter, o cmd nao executou nada',
    !/reconhecido|not recognized/i.test(buf), buf.slice(-200));

  await hook('/evento/Notification/permissao', shell, { cwd: PASTA_SHELL, message: 'Claude needs your permission' });
  await esperar(400);
  await cdp.avaliar(`(() => { const t = [...window.OrqPainel.painelPorId.values()].find((p) => p.ehNotas).notas.textarea; t.setSelectionRange(0, 11); })()`);
  await cdp.avaliar(`document.querySelector('.painel-notas .notas-enviar').click()`);
  await esperar(200);
  await cdp.avaliar(`[...document.querySelectorAll('.menu-notas button')].find((b) => b.textContent === 'receptora')?.click()`);
  await esperar(800);
  const buf2 = await cdp.avaliar(`window.OrqPainel.achatar(window.OrqPainel.painelPorId.get(${JSON.stringify(shell)}).textoDoBuffer())`);
  checar('com a sessao esperando, o texto e recusado', !buf2.includes('segunda aba'), buf2.slice(-200));

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
