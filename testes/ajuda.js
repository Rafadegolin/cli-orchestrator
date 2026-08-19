'use strict';
// A ajuda dentro do app.
//
// O teste que mais importa e o ultimo: os numeros citados na ajuda tem de bater
// com as constantes REAIS do app. Documentacao que repete constante a mao vira
// mentira na primeira mudanca de codigo, e ninguem percebe.

const { conectar, checar, encerrar, esperar } = require('./cdp');

const textoDaAjuda = `(() => document.getElementById('ajuda-corpo').textContent)()`;

(async () => {
  const cdp = await conectar();

  checar('modulo de ajuda carregou', await cdp.avaliar(`typeof window.OrqAjuda?.abrir`) === 'function');

  const escondida = await cdp.avaliar(`document.getElementById('ajuda').hidden`);
  checar('a ajuda comeca fechada', escondida === true, String(escondida));

  await cdp.avaliar(`(async () => { await window.OrqAjuda.abrir(); return 'ok'; })()`);
  await esperar(700);

  const aberta = JSON.parse(await cdp.avaliar(`(() => JSON.stringify({
    visivel: document.getElementById('ajuda').hidden === false,
    secoes: document.querySelectorAll('.ajuda-secao').length,
    itensIndice: document.querySelectorAll('#ajuda-indice button').length,
    definidas: window.OrqAjuda.SECOES.length,
  }))()`));

  checar('abriu', aberta.visivel === true, JSON.stringify(aberta));
  checar('todas as secoes definidas foram renderizadas',
    aberta.secoes === aberta.definidas && aberta.secoes >= 10, JSON.stringify(aberta));
  checar('o indice tem uma entrada por secao, sem sobrar nem faltar',
    aberta.itensIndice === aberta.secoes, JSON.stringify(aberta));

  // Cada item do indice tem de apontar para uma secao que existe.
  const orfaos = JSON.parse(await cdp.avaliar(`(() => {
    const faltando = [...document.querySelectorAll('#ajuda-indice button')]
      .map(b => b.dataset.para)
      .filter(id => !document.getElementById('ajuda-sec-' + id));
    return JSON.stringify(faltando);
  })()`));
  checar('nenhum item do indice aponta para secao inexistente', orfaos.length === 0, JSON.stringify(orfaos));

  // --- o conteudo cobre o app de ponta a ponta ---------------------------
  const texto = await cdp.avaliar(textoDaAjuda);
  // Os padroes toleram as DUAS grafias de proposito: o texto da tela e
  // acentuado, mas prender o teste a um acento faria uma revisao de redacao
  // derrubar a suite sem nada estar errado.
  const assuntos = {
    'hooks': /hook/i,
    'bolinhas de status': /amarela|bolinha/i,
    'worktree': /worktree/i,
    'portas': /PORT\b|porta/i,
    'ligacoes entre repos': /ligar|add-dir|reposit[oó]rio/i,
    'fila de partida': /fila/i,
    'retomar apos fechar': /retomar|adormecid/i,
    'atalhos': /Ctrl|F1/i,
    'problemas': /n[aã]o funciona|sintoma|causa/i,
  };
  for (const [nome, re] of Object.entries(assuntos)) {
    checar(`a ajuda cobre: ${nome}`, re.test(texto), '');
  }

  // --- navegacao pelo indice ---------------------------------------------
  const navegou = await cdp.avaliar(`(() => {
    const b = [...document.querySelectorAll('#ajuda-indice button')].find(x => x.dataset.para === 'portas');
    if (!b) return 'sem item';
    b.click();
    return document.querySelector('#ajuda-indice button.ativo')?.dataset.para || 'nenhum ativo';
  })()`);
  checar('clicar no indice marca a secao como ativa', navegou === 'portas', navegou);

  // --- fechar -------------------------------------------------------------
  await cdp.avaliar(`window.OrqAjuda.fechar()`);
  checar('fecha', await cdp.avaliar(`document.getElementById('ajuda').hidden`) === true, '');

  await cdp.avaliar(`document.getElementById('btn-ajuda').click()`);
  await esperar(600);
  checar('o botao da lateral abre',
    await cdp.avaliar(`document.getElementById('ajuda').hidden`) === false, '');

  await cdp.avaliar(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await esperar(300);
  checar('Esc fecha', await cdp.avaliar(`document.getElementById('ajuda').hidden`) === true, '');

  await cdp.avaliar(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' }))`);
  await esperar(700);
  checar('F1 abre', await cdp.avaliar(`document.getElementById('ajuda').hidden`) === false, '');

  // --- O QUE MAIS IMPORTA: os numeros batem com o codigo -----------------
  const real = JSON.parse(await cdp.avaliar(`(async () => JSON.stringify({
    ...(await window.orq.constantes()),
    tetoFila: window.OrqFila.TETO_RODANDO,
  }))()`));
  const conteudo = await cdp.avaliar(textoDaAjuda);

  checar('a porta base citada e a que o app usa de verdade',
    conteudo.includes(String(real.portaBase)), `codigo diz ${real.portaBase}`);
  checar('a quantidade de portas por painel confere',
    conteudo.includes(String(real.portasPorPainel)), `codigo diz ${real.portasPorPainel}`);
  checar('o teto da fila confere',
    conteudo.includes(String(real.tetoFila)), `codigo diz ${real.tetoFila}`);
  checar('a porta do servidor de eventos confere',
    conteudo.includes(String(real.portaEventos)), `codigo diz ${real.portaEventos}`);
  checar('a pasta de dados citada e a real',
    conteudo.includes(real.pastaDados), real.pastaDados);
  // `includes(String(n))` puro passaria a toa aqui: o teto da fila tambem e 4, e
  // "10" aparece em qualquer texto. A unidade junto e o que amarra o numero.
  checar('o intervalo da busca do remoto confere',
    conteudo.includes(`${real.minutosBusca} minutos`), `codigo diz ${real.minutosBusca}`);
  checar('o intervalo do medidor de uso confere',
    conteudo.includes(`${real.minutosUso} minutos`), `codigo diz ${real.minutosUso}`);

  // Nenhum marcador de substituicao pode ter escapado para a tela.
  const sobrou = (conteudo.match(/\{[a-zA-Z]+\}/g) || []);
  checar('nenhum {marcador} ficou sem substituir', sobrou.length === 0, sobrou.join(','));

  // --- o que muda por plataforma ------------------------------------------
  //
  // A ajuda descrevia um app Windows: teclas Ctrl, barra de tarefas, menu
  // Iniciar. Estes checam o MECANISMO, que e o que da para provar aqui -- a
  // aparencia no Mac so se ve num Mac.
  checar('o modificador dos atalhos vem do codigo, e nao digitado no texto',
    real.mod === (process.platform === 'darwin' ? '⌘' : 'Ctrl'), String(real.mod));
  checar('e ele chegou renderizado na tabela de atalhos',
    conteudo.includes(`${real.mod}+K`) && conteudo.includes(`${real.mod}+Enter`), String(real.mod));
  checar('a tecla da ajuda tambem', conteudo.includes(real.ajudaTecla), String(real.ajudaTecla));
  checar('a sintaxe de variavel de ambiente e a do shell certo',
    conteudo.includes(`--port ${real.porta}`), String(real.porta));

  // `soEm` esconde a secao inteira, e o indice tem de sumir junto -- e isso que
  // mantem o teste de contagem la em cima valendo nas duas plataformas.
  const porPlataforma = await cdp.avaliar(`(() => {
    const ids = window.OrqAjuda.SECOES.map(s => s.id);
    return {
      ids,
      temMac: ids.includes('macos'),
      indice: [...document.querySelectorAll('#ajuda-indice button')].map(b => b.dataset.para),
    };
  })()`);
  const ehMac = process.platform === 'darwin';
  checar(`a secao macOS ${ehMac ? 'aparece' : 'fica de fora'} nesta plataforma`,
    porPlataforma.temMac === ehMac, porPlataforma.ids.join(','));
  checar('e o indice acompanha, sem entrada orfa',
    JSON.stringify(porPlataforma.indice) === JSON.stringify(porPlataforma.ids),
    porPlataforma.indice.join(','));
  checar(`a linha do menu Iniciar ${ehMac ? 'nao aparece' : 'aparece'} aqui`,
    /menu Iniciar/.test(conteudo) === !ehMac, '');

  // A secao que NAO aparece aqui ainda precisa ser bem-formada, senao o defeito
  // so apareceria na outra plataforma -- que e onde ninguem esta olhando.
  const macOk = await cdp.avaliar(`(() => {
    const s = window.OrqAjuda.TODAS_SECOES.find(x => x.id === 'macos');
    if (!s) return 'secao macos nao existe';
    if (s.soEm !== 'darwin') return 'soEm errado: ' + s.soEm;
    if (!s.titulo || !s.blocos.length) return 'secao vazia';
    for (const b of s.blocos) {
      if (!b || !b.tipo) return 'bloco sem tipo';
      if (b.tipo === 'tabela') {
        if (b.cabecalho.length !== 2) return 'cabecalho de 2 colunas esperado';
        const torta = b.linhas.find(l => l.length !== b.cabecalho.length);
        if (torta) return 'linha com numero de colunas diferente do cabecalho';
      }
    }
    return 'ok';
  })()`);
  checar('a secao macOS existe e e bem-formada, mesmo sem renderizar aqui', macOk === 'ok', String(macOk));

  await cdp.avaliar(`window.OrqAjuda.fechar()`);
  encerrar('AJUDA');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
