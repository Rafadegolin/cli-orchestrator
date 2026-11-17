'use strict';
// Configuracoes (redesign R6): a pagina de tela cheia.
//
// Confere a fiacao, nao as regras (cada controle chama uma funcao que ja tem
// teste proprio): Ctrl+, abre e cobre a lateral; um controle muda a tela E o
// ui.json; a busca filtra; uma origem invalida e recusada e uma valida entra e
// sai; o texto da Revisao chega ao painel; Esc volta para as sessoes.

const os = require('os');
const { conectar, checar, encerrar, esperar, zerarGrade, aoFrente } = require('./cdp');

(async () => {
  const cdp = await conectar();
  await aoFrente(cdp);
  await zerarGrade(cdp);
  const original = JSON.parse(await cdp.avaliar(`window.orq.uiCarregar().then(JSON.stringify)`));

  await cdp.avaliar(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }))`);
  await esperar(900);
  const aberta = JSON.parse(await cdp.avaliar(`JSON.stringify({
    vista: window.OrqVistas.atual(),
    lateral: getComputedStyle(document.getElementById('lateral')).display,
    linhas: document.querySelectorAll('#configuracoes .cfg-linha').length,
    grupos: [...document.querySelectorAll('#configuracoes .cfg-grupo-titulo')].map(h => h.textContent),
  })`));
  checar('Ctrl+, abre as configuracoes', aberta.vista === 'config', JSON.stringify(aberta));
  checar('em tela cheia: a lateral some', aberta.lateral === 'none', aberta.lateral);
  checar('com os cinco grupos', aberta.grupos.length === 5, aberta.grupos.join(' | '));
  checar('e linhas de verdade em cada um', aberta.linhas >= 15, String(aberta.linhas));

  // Um controle: o tema. Muda a tela e o disco.
  await cdp.avaliar(`[...document.querySelectorAll('#configuracoes .segmentado button')].find(b => b.textContent === 'Claro').click()`);
  await esperar(700);
  const tema = JSON.parse(await cdp.avaliar(`window.orq.uiCarregar().then(u => JSON.stringify({
    disco: u.tema, classe: document.documentElement.classList.contains('claro'),
    marcado: [...document.querySelectorAll('#configuracoes .segmentado button.ativa')].map(b => b.textContent).includes('Claro'),
  }))`));
  checar('o tema muda na tela, no disco e no proprio controle',
    tema.disco === 'claro' && tema.classe && tema.marcado, JSON.stringify(tema));
  await cdp.avaliar(`window.OrqCasca.mudar({ tema: ${JSON.stringify(original.tema)} })`);
  await esperar(500);

  // A busca filtra linhas, ignorando acento.
  const busca = JSON.parse(await cdp.avaliar(`(async () => {
    const b = document.getElementById('cfg-busca');
    b.value = 'revisao'; b.dispatchEvent(new Event('input'));
    const visiveis = [...document.querySelectorAll('#configuracoes .cfg-linha')].filter(l => !l.hidden && l.offsetParent)
      .map(l => l.querySelector('.cfg-titulo').textContent);
    b.value = ''; b.dispatchEvent(new Event('input'));
    return JSON.stringify(visiveis);
  })()`));
  checar('a busca filtra (e ignora acento)',
    busca.length >= 1 && busca.length <= 3 && busca.some((t) => /Revisão/.test(t)), JSON.stringify(busca));

  // Origens: invalida recusada, valida entra e sai.
  const tentar = (origem) => cdp.avaliar(`(async () => {
    const c = document.getElementById('cfg-origem-nova');
    c.value = ${JSON.stringify(origem)};
    document.getElementById('cfg-origem-adicionar').click();
    await new Promise(r => setTimeout(r, 700));
    const u = await window.orq.uiCarregar();
    return JSON.stringify({ origens: u.origens, erro: !document.getElementById('cfg-origem-erro')?.hidden });
  })()`).then(JSON.parse);
  const ruim = await tentar('http://evil.example.com');
  checar('origem http publica e recusada, com aviso', !ruim.origens.includes('http://evil.example.com') && ruim.erro,
    JSON.stringify(ruim));
  const boa = await tentar('https://teste.example.com');
  checar('origem https valida entra na lista', boa.origens.includes('https://teste.example.com'), JSON.stringify(boa));
  await cdp.avaliar(`window.orq.uiSalvar({ origens: ${JSON.stringify(original.origens)} })`);

  // O texto da Revisao chega ao painel, com o marcador {branch}.
  const id = await cdp.avaliar(`(async () => (await window.OrqGrade.criarPainel({ cwd: ${JSON.stringify(os.homedir())}, feature: 'cfg-rev' })).id)()`);
  await cdp.avaliar(`window.OrqVistas.ir('config')`);
  await esperar(600);
  const rev = JSON.parse(await cdp.avaliar(`(async () => {
    const c = document.getElementById('cfg-texto-revisao');
    c.value = 'Revise tudo e suba {branch}';
    [...document.querySelectorAll('#configuracoes .cfg-botao')].find(b => b.textContent === 'Salvar texto').click();
    await new Promise(r => setTimeout(r, 600));
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(id)});
    const texto = p.textoRevisao();
    window.OrqCasca.mudar({ textoRevisao: '' });
    await new Promise(r => setTimeout(r, 300));
    return JSON.stringify({ texto, padrao: p.textoRevisao() });
  })()`));
  checar('o texto proprio da Revisao chega ao painel, com {branch} trocado',
    rev.texto === 'Revise tudo e suba na respectiva branch', rev.texto);
  checar('e restaurar volta ao texto embutido', /evitar erros e gaps/.test(rev.padrao), rev.padrao);

  await cdp.avaliar(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await esperar(500);
  checar('Esc volta para as sessoes', await cdp.avaliar(`window.OrqVistas.atual()`) === 'sessoes', '');

  await zerarGrade(cdp);
  encerrar('CONFIG_UI');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
