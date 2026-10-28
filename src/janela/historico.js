'use strict';

// Tempo por feature: quanto cada uma levou e quantas vezes te interrompeu.
//
// Abre pelo PLACAR da lateral, que ja resume o *agora* e passa a levar ao *ao
// longo do tempo*. Nao entra no rodape, que ja esta cheio.

(() => {
  const elHistorico = document.getElementById('historico');
  const elCorpo = document.getElementById('historico-corpo');
  const btnFechar = document.getElementById('historico-fechar');
  const elPlacar = document.getElementById('placar');

  // Duracao para gente ler, nao para maquina: acima de uma hora ninguem quer
  // contar minutos.
  function duracao(ms) {
    const min = Math.round(ms / 60000);
    if (min < 1) return '—';
    if (min < 60) return `${min}min`;
    const h = Math.floor(min / 60);
    const resto = min % 60;
    return resto ? `${h}h${String(resto).padStart(2, '0')}` : `${h}h`;
  }

  function quando(t) {
    if (!t) return '—';
    const dias = Math.floor((Date.now() - t) / 86400000);
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return `há ${dias} dias`;
    return new Date(t).toLocaleDateString('pt-BR');
  }

  // `null` e "nao ha o que medir", que e diferente de zero.
  function duracaoOuNada(ms) {
    return ms == null ? '—' : duracao(ms);
  }

  // A chave vem do main como data LOCAL (`YYYY-MM-DD`), e e lida aqui como
  // local tambem: `new Date('2026-01-05')` seria meia-noite UTC, ou seja o dia
  // anterior no Brasil.
  function rotuloDia(chave) {
    const [a, m, d] = chave.split('-').map(Number);
    const data = new Date(a, m - 1, d);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dias = Math.round((hoje - data) / 86400000);
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'ontem';
    return data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  }

  function criar(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
  }

  function tabela(classe, colunas, linhas) {
    const t = criar('table', `ajuda-tabela ${classe}`);
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const c of colunas) tr.append(criar('th', '', c));
    thead.append(tr);
    const tbody = document.createElement('tbody');
    for (const celulas of linhas) {
      const linha = document.createElement('tr');
      for (const [texto, cls] of celulas) linha.append(criar('td', cls, texto));
      tbody.append(linha);
    }
    t.append(thead, tbody);
    return t;
  }

  // A linha de base da Fase 10: o que ela inteira deveria derrubar.
  function desenharBase(m) {
    const { totais } = m;
    const blocos = [];

    blocos.push(criar('h3', 'historico-titulo', `Linha de base — últimos ${m.dias.length} dias`));

    const chips = criar('div', 'historico-chips');
    for (const [rotulo, valor, cls] of [
      ['Esperando você', duracaoOuNada(totais.esperando || null), 'historico-espera'],
      ['Resposta (mediana)', duracaoOuNada(totais.respostaMediana), ''],
      ['Integradas', String(totais.integradas), ''],
      ['Terminou → integrado', duracaoOuNada(totais.leadMediano), ''],
    ]) {
      const chip = criar('div', 'historico-chip');
      chip.append(criar('span', 'historico-chip-rotulo', rotulo), criar('b', `historico-num ${cls}`, valor));
      chips.append(chip);
    }
    blocos.push(chips);

    blocos.push(tabela('historico-dias',
      ['Dia', 'Esperando você', 'Episódios', 'Resposta', 'Sessões', 'Features', 'Integradas'],
      m.dias.map((d) => [
        [rotuloDia(d.dia), ''],
        [d.esperando ? duracao(d.esperando) : '—', 'historico-num historico-espera'],
        [String(d.episodios), 'historico-num'],
        [duracaoOuNada(d.respostaMediana), 'historico-num'],
        [String(d.sessoes), 'historico-num'],
        [String(d.features), 'historico-num'],
        [String(d.integradas), 'historico-num'],
      ])));

    return blocos;
  }

  function desenhar(linhas, metricas) {
    if (!linhas.length) {
      const vazio = document.createElement('p');
      vazio.className = 'historico-vazio';
      vazio.textContent = 'Ainda não há histórico. Ele começa a ser gravado assim que as sessões '
        + 'mudam de status — o que depende dos hooks estarem ligados.';
      elCorpo.replaceChildren(vazio);
      return;
    }

    const porFeature = tabela('historico-tabela',
      ['Feature', 'Projeto', 'Trabalhando', 'Esperando você', 'Interrupções', 'Terminou → integrado',
        'Última vez'],
      linhas.map((r) => [
        [r.feature, 'historico-feature'],
        [r.projeto || '—', ''],
        [duracao(r.trabalhando), 'historico-num'],
        [duracao(r.esperando), 'historico-num historico-espera'],
        [String(r.interrupcoes), 'historico-num'],
        [duracaoOuNada(r.leadTime), 'historico-num'],
        [quando(r.ultima), ''],
      ]));

    const nota = criar('p', 'historico-nota',
      'Só entram intervalos com começo e fim. Se o app cair com uma sessão aberta, '
      + 'aquele intervalo se perde — subcontar é melhor que inventar tempo que não houve. '
      + '"Integrada" é uma worktree arquivada pelo app, o que exige o trabalho já estar na base. '
      + 'A resposta não conta a espera encerrada fechando o painel.');

    elCorpo.replaceChildren(
      ...(metricas ? desenharBase(metricas) : []),
      criar('h3', 'historico-titulo', 'Por feature'),
      porFeature,
      nota,
    );
  }

  async function abrir() {
    elHistorico.hidden = false;
    elCorpo.replaceChildren();
    const [linhas, metricas] = await Promise.all([
      window.orq.historico(),
      window.orq.historicoMetricas(),
    ]);
    desenhar(linhas || [], metricas || null);
  }

  function fechar() {
    elHistorico.hidden = true;
  }

  btnFechar?.addEventListener('click', fechar);
  elPlacar?.addEventListener('click', abrir);
  window.OrqOverlays?.registrar(elHistorico, fechar);

  window.OrqHistorico = { abrir, fechar, duracao, quando };
})();
