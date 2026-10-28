'use strict';
// O botao "Revisao" do cabecalho do painel.
//
// O que ele promete: colar o pedido de revisao na caixa do Claude SEM enviar,
// no singular numa sessao so e no plural na dupla (sessao com ligacao), e nao
// escrever nada quando o terminal esta parado num pedido de permissao.
//
// Sem invocar o Claude: o painel e um shell puro, que ecoa o que recebe. Isso
// basta para provar que o texto chegou ao PTY e que nao foi executado.

const os = require('os');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

const UMA = 'depois pode commitar e dar push na respectiva branch';
const DUPLA = 'depois pode commitar e dar push nas respectivas branchs';

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

(async () => {
  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);

  const id = await cdp.avaliar(`(async () => {
    const p = await window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(os.tmpdir())}, feature: 'revisao' });
    return p.id;
  })()`);
  const P = `window.OrqPainel.painelPorId.get(${JSON.stringify(id)})`;

  // O shell tem de estar de pe antes de colar, senao o eco se perde.
  await ate(() => cdp.avaliar(`${P}.textoDaTela({ flush: true }).length`), (n) => n > 0, 8000);
  await esperar(500);

  // Espiao no paste: conta as chamadas e guarda o texto, sem impedir a colagem.
  await cdp.avaliar(`(() => {
    const p = ${P};
    window.__colas = [];
    const original = p.term.paste.bind(p.term);
    p.term.paste = (t) => { window.__colas.push(t); original(t); };
  })()`);

  const visivel = await cdp.avaliar(`(() => {
    const b = ${P}.el.querySelector('.painel-revisao');
    return !!b && !b.hidden && b.offsetWidth > 0;
  })()`);
  checar('o botão aparece no cabeçalho', visivel);
  checar('o title diz o texto singular',
    (await cdp.avaliar(`${P}.el.querySelector('.painel-revisao').title`)).includes(UMA));

  // --- sessao individual ----------------------------------------------------
  await cdp.avaliar(`${P}.el.querySelector('.painel-revisao').click()`);
  const colas1 = JSON.parse(await cdp.avaliar(`JSON.stringify(window.__colas)`));
  checar('colou uma vez, no singular', colas1.length === 1 && colas1[0].includes(UMA), JSON.stringify(colas1));
  checar('o texto colado não tem Enter', !/[\r\n]/.test(colas1[0] || ''));
  const tela = await ate(
    () => cdp.avaliar(`${P}.textoDaTela({ flush: true })`),
    (t) => t.includes('respectiva branch'), 5000);
  checar('o texto chegou ao terminal', tela.includes('respectiva branch'));
  // O cmd.exe responderia "nao e reconhecido" se o texto tivesse sido executado.
  await esperar(800);
  const depois = await cdp.avaliar(`${P}.textoDaTela({ flush: true })`);
  checar('não foi enviado (o shell não executou nada)', !/reconhecido|not recognized|command not found/i.test(depois));

  // Limpa a linha do shell (Esc no cmd apaga a linha digitada; Ctrl+U nos POSIX).
  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(id)}, '\\x1b\\x15')`);

  // --- dupla (sessao com ligacao) -------------------------------------------
  await cdp.avaliar(`(() => { const p = ${P}; p.ligacoes = [${JSON.stringify(os.homedir())}]; p.mostrarLigacoes(); })()`);
  checar('com ligação, o title passa ao plural',
    (await cdp.avaliar(`${P}.el.querySelector('.painel-revisao').title`)).includes(DUPLA));
  await cdp.avaliar(`${P}.el.querySelector('.painel-revisao').click()`);
  const colas2 = JSON.parse(await cdp.avaliar(`JSON.stringify(window.__colas)`));
  checar('na dupla colou o plural', colas2.length === 2 && colas2[1].includes(DUPLA), JSON.stringify(colas2));
  await cdp.avaliar(`window.orq.escrever(${JSON.stringify(id)}, '\\x1b\\x15')`);

  // --- esperando: recusa ----------------------------------------------------
  await cdp.avaliar(`${P}.definirStatus('esperando', 'esperando')`);
  await cdp.avaliar(`${P}.el.querySelector('.painel-revisao').click()`);
  const colas3 = JSON.parse(await cdp.avaliar(`JSON.stringify(window.__colas)`));
  checar('com pedido na tela, não escreve nada', colas3.length === 2, JSON.stringify(colas3));
  await cdp.avaliar(`${P}.definirStatus('rodando', 'rodando')`);

  // --- painel de terminal: sem botao ----------------------------------------
  await cdp.avaliar(`(() => { const p = ${P}; p.tipoPainel = 'terminal'; p.mostrarLigacoes(); })()`);
  checar('painel de terminal não mostra o botão',
    await cdp.avaliar(`${P}.el.querySelector('.painel-revisao').hidden`) === true);

  await zerarGrade(cdp);
  encerrar('REVISAO');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
