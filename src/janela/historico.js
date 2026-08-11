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

  function desenhar(linhas) {
    if (!linhas.length) {
      const vazio = document.createElement('p');
      vazio.className = 'historico-vazio';
      vazio.textContent = 'Ainda não há histórico. Ele começa a ser gravado assim que as sessões '
        + 'mudam de status — o que depende dos hooks estarem ligados.';
      elCorpo.replaceChildren(vazio);
      return;
    }

    const tabela = document.createElement('table');
    tabela.className = 'ajuda-tabela historico-tabela';

    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const c of ['Feature', 'Projeto', 'Trabalhando', 'Esperando você', 'Interrupções', 'Última vez']) {
      const th = document.createElement('th');
      th.textContent = c;
      tr.append(th);
    }
    thead.append(tr);

    const tbody = document.createElement('tbody');
    for (const r of linhas) {
      const linha = document.createElement('tr');
      for (const [texto, classe] of [
        [r.feature, 'historico-feature'],
        [r.projeto || '—', ''],
        [duracao(r.trabalhando), 'historico-num'],
        [duracao(r.esperando), 'historico-num historico-espera'],
        [String(r.interrupcoes), 'historico-num'],
        [quando(r.ultima), ''],
      ]) {
        const td = document.createElement('td');
        td.className = classe;
        td.textContent = texto;
        linha.append(td);
      }
      tbody.append(linha);
    }

    tabela.append(thead, tbody);

    const nota = document.createElement('p');
    nota.className = 'historico-nota';
    nota.textContent = 'Só entram intervalos com começo e fim. Se o app cair com uma sessão aberta, '
      + 'aquele intervalo se perde — subcontar é melhor que inventar tempo que não houve.';

    elCorpo.replaceChildren(tabela, nota);
  }

  async function abrir() {
    elHistorico.hidden = false;
    elCorpo.replaceChildren();
    const linhas = await window.orq.historico();
    desenhar(linhas || []);
  }

  function fechar() {
    elHistorico.hidden = true;
  }

  btnFechar?.addEventListener('click', fechar);
  elPlacar?.addEventListener('click', abrir);
  window.OrqOverlays?.registrar(elHistorico, fechar);

  window.OrqHistorico = { abrir, fechar, duracao, quando };
})();
