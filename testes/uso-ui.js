'use strict';
// O medidor de uso na tela. Dirige o app de fora, por CDP.
//
// O que este teste protege, em ordem de importancia:
//
//  1. o medidor NAO PODE inventar porcentagem. Sem a consulta ele mostra
//     travessao e esconde a barra -- barra sem teto nao significa nada;
//  2. ele nao pode ESTOURAR a barra de titulo em 924px, que e a largura minima
//     da janela. O #titulo ja reserva ~140px para os botoes do Windows;
//  3. ele tem de ser <button>, senao a regra de arraste da barra (que e por
//     TAG) o torna arrastavel e ele deixa de receber clique.

const { conectar, checar, encerrar, esperar, aoFrente } = require('./cdp');

(async () => {
  const cdp = await conectar();
  await aoFrente(cdp);

  // O medidor so aparece depois da primeira consulta (15s do arranque). Espera
  // por EVENTO de conteudo, nao por um sleep fixo.
  let pronto = false;
  for (let i = 0; i < 40 && !pronto; i++) {
    pronto = await cdp.avaliar(`(() => {
      const u = document.getElementById('uso');
      return !!u && !u.hidden;
    })()`);
    if (!pronto) await esperar(1000);
  }
  checar('o medidor aparece no topo', pronto, pronto ? '' : 'nao apareceu em 40s');

  // --- 1. onde ele mora ---------------------------------------------------
  const lugar = JSON.parse(await cdp.avaliar(`(() => {
    const u = document.getElementById('uso');
    const t = document.getElementById('titulo');
    const b = document.getElementById('btn-busca');
    const cu = u.getBoundingClientRect();
    const ct = t.getBoundingClientRect();
    const cb = b.getBoundingClientRect();
    return JSON.stringify({
      tag: u.tagName,
      dentroDoTitulo: t.contains(u),
      antesDaBusca: cu.right <= cb.left + 1,
      dentroDaFaixa: cu.top >= ct.top - 1 && cu.bottom <= ct.bottom + 1,
      arraste: getComputedStyle(u).webkitAppRegion || getComputedStyle(u).getPropertyValue('-webkit-app-region'),
    });
  })()`));

  checar('e um <button> (a regra de no-drag da barra e por TAG)', lugar.tag === 'BUTTON', lugar.tag);
  checar('mora dentro da barra de titulo', lugar.dentroDoTitulo && lugar.dentroDaFaixa,
    JSON.stringify(lugar));
  checar('fica ANTES da busca, sem cobri-la', lugar.antesDaBusca, '');
  checar('e nao e area de arrastar a janela', lugar.arraste !== 'drag', String(lugar.arraste));

  // --- 2. o que ele diz ---------------------------------------------------
  const leitura = JSON.parse(await cdp.avaliar(`(() => {
    const u = document.getElementById('uso');
    const pares = [...u.querySelectorAll('.uso-par')].map((p) => ({
      tipo: p.dataset.tipo,
      texto: p.querySelector('.uso-pct').textContent,
      largura: p.querySelector('.uso-barra i').style.width,
      barraVisivel: getComputedStyle(p.querySelector('.uso-barra')).display !== 'none',
    }));
    return JSON.stringify({ semLimite: u.classList.contains('sem-limite'), pares, titulo: u.title });
  })()`));

  if (leitura.semLimite) {
    checar('sem a consulta: nao mostra porcentagem nenhuma',
      leitura.pares.every((p) => p.texto === '—'),
      JSON.stringify(leitura.pares.map((p) => p.texto)));
    checar('sem a consulta: a barra some (sem teto, ela nao significa nada)',
      leitura.pares.every((p) => !p.barraVisivel), '');
    checar('sem a consulta: o titulo explica por que',
      /Uso do Claude Code: /.test(leitura.titulo), leitura.titulo);
  } else {
    checar('com a API: os dois valores sao porcentagem',
      leitura.pares.length === 2 && leitura.pares.every((p) => /^\d+%$/.test(p.texto)),
      JSON.stringify(leitura.pares.map((p) => `${p.tipo}=${p.texto}`)));
    checar('a barra acompanha o numero',
      leitura.pares.every((p) => p.largura === p.texto),
      JSON.stringify(leitura.pares.map((p) => `${p.texto} -> ${p.largura}`)));
    checar('o titulo diz que e da conta inteira e quando reseta',
      /conta inteira/.test(leitura.titulo) && /reseta/.test(leitura.titulo),
      leitura.titulo.replace(/\n/g, ' | '));
  }

  // --- 3. as faixas de cor ------------------------------------------------
  const faixas = JSON.parse(await cdp.avaliar(`JSON.stringify({
    tranquilo: window.OrqUso.faixa(10, 'normal'),
    apertado: window.OrqUso.faixa(80, 'normal'),
    estourando: window.OrqUso.faixa(95, 'normal'),
    servidorMandou: window.OrqUso.faixa(3, 'warning'),
  })`));
  checar('a cor segue a porcentagem',
    faixas.tranquilo === '' && faixas.apertado === 'apertado' && faixas.estourando === 'estourando',
    JSON.stringify(faixas));
  checar('e a gravidade do SERVIDOR vence a nossa conta',
    faixas.servidorMandou === 'apertado', faixas.servidorMandou);

  // --- 4. o detalhe --------------------------------------------------------
  await cdp.avaliar('window.OrqUso.abrir()');
  await esperar(1200);

  const detalhe = JSON.parse(await cdp.avaliar(`(() => {
    const d = document.getElementById('uso-detalhe');
    const c = document.getElementById('uso-corpo');
    return JSON.stringify({
      aberto: !d.hidden,
      noTopo: window.OrqOverlays.noTopo()?.el?.id,
      texto: c.textContent.slice(0, 4000),
      blocos: c.querySelectorAll('.uso-bloco').length,
      // O detalhe e SO as duas barras: qualquer tabela aqui e sobra que
      // voltou sem querer.
      tabelas: c.querySelectorAll('table').length,
    });
  })()`));

  checar('o detalhe abre', detalhe.aberto, '');
  checar('e entra na pilha de overlays (o Esc fecha ELE)',
    detalhe.noTopo === 'uso-detalhe', String(detalhe.noTopo));
  checar('mostra as duas janelas como barras', detalhe.blocos >= 2, `${detalhe.blocos} blocos`);
  checar('e NADA alem delas -- sem tabela de gastos', detalhe.tabelas === 0,
    `${detalhe.tabelas} tabela(s)`);
  checar('diz que o numero e da conta inteira',
    /conta inteira/.test(detalhe.texto), detalhe.texto.slice(0, 200));

  // Esc fecha o topo da pilha.
  await cdp.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await cdp.avaliar(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await esperar(300);
  checar('Esc fecha o detalhe',
    await cdp.avaliar(`document.getElementById('uso-detalhe').hidden`), '');

  // --- 5. compressao: nada estoura ate a largura minima da janela ---------
  const larguras = [1440, 1240, 1100, 1040, 940, 924];
  const estouros = [];
  for (const w of larguras) {
    await cdp.enviar('Emulation.setDeviceMetricsOverride', {
      width: w, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    await esperar(250);
    const r = JSON.parse(await cdp.avaliar(`(() => {
      const t = document.getElementById('titulo');
      return JSON.stringify({
        titulo: t.scrollWidth - t.clientWidth,
        pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        usoVisivel: !document.getElementById('uso').hidden,
      });
    })()`));
    if (r.titulo > 0 || r.pagina > 0) estouros.push(`${w}px: titulo +${r.titulo}, pagina +${r.pagina}`);
  }
  await cdp.enviar('Emulation.clearDeviceMetricsOverride');
  checar('a barra de titulo nao estoura em nenhuma largura ate 924px',
    estouros.length === 0, estouros.join(' / '));

  // --- 6. a preferencia esconde e devolve ---------------------------------
  await cdp.avaliar('window.OrqUso.alternar()');
  await esperar(300);
  const oculto = await cdp.avaliar(`JSON.stringify({
    escondido: document.getElementById('uso').hidden,
    pref: window.OrqCasca.ui().uso,
  })`);
  const o = JSON.parse(oculto);
  checar('esconder o medidor some com ele e grava a preferencia',
    o.escondido && o.pref === 'oculto', oculto);

  await cdp.avaliar('window.OrqUso.alternar()');
  await esperar(300);
  checar('e mostrar traz de volta',
    !(await cdp.avaliar(`document.getElementById('uso').hidden`))
    && (await cdp.avaliar(`window.OrqCasca.ui().uso`)) === 'barras', '');

  // Deixa o estado como achou: suite que deixa lixo quebra a proxima.
  await cdp.avaliar(`window.orq.uiSalvar({ uso: 'barras' })`);

  encerrar('USO_UI');
})();
