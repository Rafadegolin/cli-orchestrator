'use strict';
// Fase 6: grade rolavel, painel fora da tela que nao desenha, orcamento de
// WebGL por visibilidade e fila de partida.
//
// Espera por CONDICAO, nao por sleep fixo: o IntersectionObserver e assincrono
// e trocar de renderizador mexe no layout, entao tempo fixo aqui vira teste
// intermitente -- que e pior que teste nenhum.

const path = require('path');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..').replace(/\\/g, '/');

async function ateQue(cdp, expressao, ms = 8000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await cdp.avaliar(expressao)) return true;
    await esperar(200);
  }
  return false;
}

async function abrirVarios(cdp, n, prefixo) {
  for (let i = 1; i <= n; i++) {
    await cdp.avaliar(`(async () => { await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ)}, feature: '${prefixo}-${i}' }); return 'ok'; })()`);
    await esperar(350);
  }
  await esperar(1200);
}

const buffer = (id) => `(() => {
  const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
  const b = p.term.buffer.active; let t = '';
  for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\\n';
  return t;
})()`;

(async () => {
  const cdp = await conectar();

  // Sem isto o IntersectionObserver nao e entregue e NADA aqui funciona: o
  // Chromium pausa a renderizacao com a janela em segundo plano.
  const frente = await aoFrente(cdp);
  checar('a janela esta em primeiro plano (os observers dependem disso)', frente, '');

  await zerarGrade(cdp);

  // --- 1. grade rolavel ---------------------------------------------------
  await abrirVarios(cdp, 4, 'poucos');
  const poucos = JSON.parse(await cdp.avaliar(`(() => {
    const g = document.getElementById('grade');
    return JSON.stringify({ rola: g.scrollHeight > g.clientHeight + 2 });
  })()`));
  checar('com 4 painéis a grade nao rola', poucos.rola === false, JSON.stringify(poucos));

  await abrirVarios(cdp, 8, 'muitos');
  const muitos = JSON.parse(await cdp.avaliar(`(() => {
    const g = document.getElementById('grade');
    const hs = [...document.querySelectorAll('.painel')].map(e => Math.round(e.getBoundingClientRect().height));
    return JSON.stringify({ n: hs.length, rola: g.scrollHeight > g.clientHeight + 2, min: Math.min(...hs) });
  })()`));
  checar('com 12 painéis a grade passa a rolar', muitos.rola === true, JSON.stringify(muitos));
  checar('e nenhum painel fica abaixo da altura minima', muitos.min >= 215, `min=${muitos.min}px`);

  // --- 2. visibilidade ----------------------------------------------------
  //
  // Uma coluna so empurra a maioria para fora de vez, sem precisar abrir 20
  // shells. Com 3 colunas a ultima fileira ficava PARCIALMENTE visivel, e
  // threshold:0 conta um pixel como visivel -- correto, mas inutil aqui.
  await cdp.avaliar(`document.getElementById('grade').style.setProperty('--colunas', '1')`);
  await cdp.avaliar(`document.getElementById('grade').scrollTop = 0`);
  const assentou = await ateQue(cdp,
    `[...window.OrqGrade.painelPorId.values()].filter(p => !p.visivel).length >= 4`);
  checar('painéis rolados para fora sao detectados como invisiveis', assentou, '');

  const vis = JSON.parse(await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()];
    return JSON.stringify({ visiveis: ps.filter(p => p.visivel).length, total: ps.length });
  })()`));
  checar('e parte deles continua a vista', vis.visiveis > 0 && vis.visiveis < vis.total, JSON.stringify(vis));

  // --- 3. o teste central: invisivel nao desenha, e nada se perde ---------
  //
  // Escolhe o ULTIMO invisivel: os do fim da lista nao voltam a vista quando o
  // layout se acomoda.
  const alvo = await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()].filter(p => !p.visivel);
    return ps.length ? ps[ps.length - 1].id : '';
  })()`);
  if (!checar('achei um painel fora da vista para testar', Boolean(alvo), alvo)) encerrar('FASE6');

  const estavel = await ateQue(cdp,
    `window.OrqPainel.painelPorId.get(${JSON.stringify(alvo)}).visivel === false`, 3000);
  checar('e ele segue invisivel de forma estavel', estavel, '');

  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(alvo)}, 'echo ORQ_INVISIVEL_1\\r')`);
  const reteve = await ateQue(cdp,
    `window.OrqPainel.painelPorId.get(${JSON.stringify(alvo)}).pendentesBytes > 0`);
  checar('bytes de painel invisivel ficam retidos no buffer', reteve, '');

  const naTela = await cdp.avaliar(`${buffer(alvo)}.includes('ORQ_INVISIVEL_1')`);
  checar('e NAO entram no terminal enquanto ele esta fora da vista', naTela === false, String(naTela));

  // Traz de volta a vista: o conteudo tem de aparecer inteiro.
  await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(alvo)}).el.scrollIntoView({ block: 'center' })`);
  const voltou = await ateQue(cdp,
    `window.OrqPainel.painelPorId.get(${JSON.stringify(alvo)}).visivel === true`);
  checar('ao voltar a vista, o painel se marca visivel', voltou, '');

  const apareceu = await ateQue(cdp, `${buffer(alvo)}.includes('ORQ_INVISIVEL_1')`);
  checar('e NADA se perdeu: a saida retida aparece na tela', apareceu, '');
  checar('o buffer retido foi zerado',
    await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(alvo)}).pendentesBytes`) === 0, '');

  // --- 4. enxurrada em painel invisivel respeita o teto -------------------
  const alvo2 = await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()].filter(p => !p.visivel);
    return ps.length ? ps[ps.length - 1].id : '';
  })()`);
  if (alvo2) {
    await cdp.avaliar(`window.orq.escrever(${JSON.stringify(alvo2)}, 'for /L %i in (1,1,60000) do @echo ENCHENTE_%i\\r')`);

    // Espera o corte ACONTECER, em vez de supor que ja aconteceu: se a enchente
    // parar antes de encher 200 KB, nada e descartado -- e ai o teste estaria
    // cobrando um comportamento que corretamente nao ocorreu.
    const cortou = await ateQue(cdp,
      `window.OrqPainel.painelPorId.get(${JSON.stringify(alvo2)}).descartadosBytes > 0`, 30000);
    checar('com o buffer cheio, o painel invisivel comeca a descartar', cortou, '');

    const cheio = await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(alvo2)}).pendentesBytes`);
    checar('e o retido nunca passa do teto de ~200 KB',
      cheio <= 210 * 1024, `${Math.round(cheio / 1024)} KB`);

    await cdp.avaliar(`window.orq.escrever(${JSON.stringify(alvo2)}, '\\u0003')`);
    await esperar(1500);
    await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(alvo2)}).el.scrollIntoView({ block: 'center' })`);
    await ateQue(cdp, `window.OrqPainel.painelPorId.get(${JSON.stringify(alvo2)}).visivel === true`);
    await ateQue(cdp, `${buffer(alvo2)}.includes('ENCHENTE_')`);

    const fim = JSON.parse(await cdp.avaliar(`(() => {
      const t = ${buffer(alvo2)};
      const ns = [...t.matchAll(/ENCHENTE_(\\d+)/g)].map(m => Number(m[1]));
      return JSON.stringify({ temInicio: /ENCHENTE_1\\n/.test(t),
        menor: ns.length ? Math.min(...ns) : -1, maior: ns.length ? Math.max(...ns) : -1 });
    })()`));
    checar('o que sobrou e o FIM da enxurrada, nao o comeco',
      fim.temInicio === false && fim.menor > 1 && fim.maior > fim.menor, JSON.stringify(fim));
  }

  // --- 5. WebGL vai para quem esta a vista --------------------------------
  const webgl = JSON.parse(await cdp.avaliar(`(() => {
    const ps = [...window.OrqGrade.painelPorId.values()];
    return JSON.stringify({
      invisiveisComWebgl: ps.filter(p => !p.visivel && p.tipoRender === 'webgl').length,
      visiveisComWebgl: ps.filter(p => p.visivel && p.tipoRender === 'webgl').length,
      visiveis: ps.filter(p => p.visivel).length,
    });
  })()`));
  checar('nenhum painel fora da vista segura contexto WebGL',
    webgl.invisiveisComWebgl === 0, JSON.stringify(webgl));
  checar('as vagas de WebGL ficam com os visiveis',
    webgl.visiveisComWebgl === Math.min(8, webgl.visiveis), JSON.stringify(webgl));

  // --- 6. fila de partida -------------------------------------------------
  await zerarGrade(cdp);

  checar('o teto padrao e 4', await cdp.avaliar(`window.OrqFila.TETO_RODANDO`) === 4, '');

  // Estado limpo: sem cards e sem partidas pendentes de rodadas anteriores.
  await cdp.avaliar(`(() => {
    for (const k of [...window.OrqLateral.cards.keys()]) window.OrqLateral.cards.delete(k);
    for (const id of window.OrqFila.emEspera()) window.OrqFila.remover(id);
    window.__ordem = [];
    return 'ok';
  })()`);

  // Sem sessao 'rodando' (o caso de quem nao instalou os hooks) nada e retido.
  const semHooks = JSON.parse(await cdp.avaliar(`(() => {
    const r = window.OrqFila.pedirVaga('p-0', () => window.__ordem.push('p-0'));
    window.OrqFila.esquecerPartida('p-0');
    return JSON.stringify({ enfileirado: r.enfileirado, ordem: window.__ordem });
  })()`));
  checar('sem sessao rodando, o comando parte na hora',
    semHooks.enfileirado === false && semHooks.ordem.join() === 'p-0', JSON.stringify(semHooks));

  // Teto cheio: os tres seguintes ficam retidos.
  const retidos = JSON.parse(await cdp.avaliar(`(() => {
    for (let i = 1; i <= 4; i++) {
      window.OrqLateral.cards.set('ocupado-' + i,
        { id: 'ocupado-' + i, feature: 'x', status: 'rodando', desde: Date.now(), motivo: '' });
    }
    for (const id of ['p-1', 'p-2', 'p-3']) window.OrqFila.pedirVaga(id, () => window.__ordem.push(id));
    return JSON.stringify({ ocupadas: window.OrqFila.ocupadas(), naFila: window.OrqFila.tamanho(), ordem: window.__ordem });
  })()`));
  checar('com o teto cheio, os seguintes ficam retidos',
    retidos.naFila === 3 && retidos.ordem.join() === 'p-0', JSON.stringify(retidos));

  // O defeito que este teste pegou: abrir UMA vaga soltava a fila INTEIRA,
  // porque a sessao recem-partida ainda nao reportou 'rodando'.
  const umaVaga = JSON.parse(await cdp.avaliar(`(() => {
    window.OrqLateral.cards.get('ocupado-1').status = 'terminou';
    window.OrqFila.reavaliar();
    return JSON.stringify({ naFila: window.OrqFila.tamanho(), ordem: window.__ordem });
  })()`));
  checar('abrir uma vaga solta exatamente UM, nao a fila inteira',
    umaVaga.naFila === 2 && umaVaga.ordem.join() === 'p-0,p-1', JSON.stringify(umaVaga));

  const insiste = JSON.parse(await cdp.avaliar(`(() => {
    window.OrqFila.reavaliar();
    return JSON.stringify({ naFila: window.OrqFila.tamanho(), ordem: window.__ordem });
  })()`));
  checar('sem confirmacao da partida, os demais seguem retidos',
    insiste.naFila === 2, JSON.stringify(insiste));

  // Confirmar a partida do p-1 devolve UMA vaga (a que ele estava segurando
  // provisoriamente), entao sai exatamente mais um.
  const confirma = JSON.parse(await cdp.avaliar(`(() => {
    window.OrqFila.esquecerPartida('p-1');
    window.OrqFila.reavaliar();
    return JSON.stringify({ naFila: window.OrqFila.tamanho(), ordem: window.__ordem });
  })()`));
  checar('confirmada a partida anterior, sai exatamente o proximo',
    confirma.ordem.join() === 'p-0,p-1,p-2' && confirma.naFila === 1, JSON.stringify(confirma));

  const escapes = JSON.parse(await cdp.avaliar(`JSON.stringify({
    tempo: window.OrqFila.MS_ESPERA_MAXIMA, graca: window.OrqFila.MS_GRACA_PARTIDA })`));
  checar('existe escape por tempo: reter para sempre seria o pior defeito',
    escapes.tempo > 0 && escapes.tempo <= 120000, `${escapes.tempo}ms`);
  checar('e a partida nao segura vaga indefinidamente quando nao ha hooks',
    escapes.graca > 0 && escapes.graca <= 15000, `${escapes.graca}ms`);

  await cdp.avaliar(`(() => {
    for (const k of [...window.OrqLateral.cards.keys()]) window.OrqLateral.cards.delete(k);
    for (const id of window.OrqFila.emEspera()) window.OrqFila.remover(id);
    for (const id of ['p-0','p-1','p-2','p-3']) window.OrqFila.esquecerPartida(id);
    return 'ok';
  })()`);
  await zerarGrade(cdp);

  encerrar('FASE6');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
