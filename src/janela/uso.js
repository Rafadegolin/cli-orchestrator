'use strict';

// O medidor de uso do Claude Code, no topo da janela.
//
// Responde "posso continuar?" sem voce entrar num painel para digitar /usage --
// dentro de uma das sessoes que este app existe justamente para voce nao ter de
// entrar. Com oito paineis abertos, o unico jeito de descobrir que a janela de
// 5h acabou era ser barrado por ela.
//
// Sao duas janelas, e as duas sao da CONTA INTEIRA: incluem o que voce gastou
// fora deste app. Vem da mesma origem que o /usage do CLI le.
//
// NAO EXISTE numero estimado aqui. Sem a consulta, o medidor mostra travessao e
// diz por que no tooltip -- porcentagem inventada e pior que porcentagem
// nenhuma, porque parece util.

(() => {
  const elUso = document.getElementById('uso');
  const elDetalhe = document.getElementById('uso-detalhe');
  const elCorpo = document.getElementById('uso-corpo');
  const btnFechar = document.getElementById('uso-fechar');

  const pares = new Map(
    [...document.querySelectorAll('#uso .uso-par')].map((el) => [el.dataset.tipo, el]),
  );

  // As faixas. A do servidor (`severity`) vence a nossa quando e mais grave: ele
  // sabe do limite, nos so sabemos da porcentagem.
  const APERTADO = 75;
  const ESTOURANDO = 90;

  let ultima = null;

  function faixa(pct, gravidade) {
    if (pct >= ESTOURANDO || gravidade === 'critical' || gravidade === 'rejected') return 'estourando';
    if (pct >= APERTADO || (gravidade && gravidade !== 'normal')) return 'apertado';
    return '';
  }

  function quandoReseta(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    // Acima de um dia a hora sozinha engana: "reseta 02:00" parece hoje de
    // madrugada quando na verdade e sabado.
    if (ms - Date.now() > 20 * 3600 * 1000) {
      return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${hora}`;
    }
    return hora;
  }

  const MOTIVOS = {
    'sem credencial do Claude': 'não achei a credencial do Claude Code nesta máquina',
    'credencial vencida': 'a credencial do Claude venceu — abra uma sessão do Claude para renovar',
    'ainda nao consultado': 'ainda estou consultando',
  };

  const explicar = (motivo) => MOTIVOS[motivo] || motivo || 'não consegui consultar';

  const NOMES = { five_hour: 'Sessão atual (5 horas)', seven_day: 'Semana' };

  // ------------------------------------------------------------ o medidor

  function desenhar(u) {
    ultima = u;
    if (!u) return;

    const mostrar = window.OrqCasca?.ui ? window.OrqCasca.ui().uso !== 'oculto' : true;

    if (u.ok && u.janelas && u.janelas.length) {
      elUso.classList.remove('sem-limite');

      for (const j of u.janelas) {
        const par = pares.get(j.tipo);
        if (!par) continue;
        par.querySelector('.uso-pct').textContent = `${j.pct}%`;
        par.querySelector('.uso-barra i').style.width = `${j.pct}%`;
        par.classList.remove('apertado', 'estourando');
        const f = faixa(j.pct, j.gravidade);
        if (f) par.classList.add(f);
      }

      const linhas = u.janelas.map((j) => {
        const reseta = quandoReseta(j.reseta);
        return `${j.rotulo}: ${j.pct}%${reseta ? ` — reseta ${reseta}` : ''}`;
      });
      elUso.title = `Uso do Claude Code (conta inteira)\n${linhas.join('\n')}`;
      elUso.hidden = !mostrar;
      return;
    }

    // Sem consulta: travessao e o motivo. A barra sai de cena porque sem teto
    // ela nao significa nada.
    elUso.classList.add('sem-limite');
    for (const par of pares.values()) {
      par.classList.remove('apertado', 'estourando');
      par.querySelector('.uso-pct').textContent = '—';
    }
    elUso.title = `Uso do Claude Code: ${explicar(u.motivo)}.`;

    // Antes da primeira resposta o medidor nem aparece -- dois travessoes no
    // topo, no arranque, so parecem app quebrado.
    elUso.hidden = !mostrar || !u.em;
  }

  // ------------------------------------------------------------ o detalhe

  const criar = (tag, classe, texto) => {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined) el.textContent = texto;
    return el;
  };

  function blocoJanela(j, nome) {
    const bloco = criar('div', `uso-bloco ${faixa(j.pct, j.gravidade)}`.trim());

    const linha = criar('div', 'uso-linha');
    linha.append(criar('h3', '', nome || NOMES[j.tipo] || j.rotulo));
    linha.append(criar('span', 'uso-num', `${j.pct}%`));
    const reseta = quandoReseta(j.reseta);
    if (reseta) linha.append(criar('span', 'uso-reset', `reseta ${reseta}`));
    bloco.append(linha);

    const barra = criar('div', 'uso-grande');
    const dentro = criar('i');
    dentro.style.width = `${j.pct}%`;
    barra.append(dentro);
    bloco.append(barra);

    return bloco;
  }

  function desenharDetalhe(d) {
    const partes = [];

    if (d.ok && d.janelas?.length) {
      for (const j of d.janelas) partes.push(blocoJanela(j));
      // Limite por modelo (o `weekly_scoped` da resposta). So aparece quando ja
      // consumiu algo: uma linha "Fable 0%" em toda abertura seria ruido.
      for (const e of d.escopos || []) {
        partes.push(blocoJanela(e, `Semana — ${e.rotulo}`));
      }
      partes.push(criar('p', 'historico-nota',
        'São da conta inteira: incluem o que você gastou com o Claude fora deste app.'));
    } else {
      partes.push(criar('p', 'uso-aviso',
        `Não consegui consultar: ${explicar(d.motivo)}.`));
      partes.push(criar('p', 'historico-nota',
        'O app não estima esse número por conta própria — sem a consulta, ele prefere não dizer nada '
        + 'a dizer uma porcentagem inventada.'));
    }

    elCorpo.replaceChildren(...partes);
  }

  async function abrir() {
    elDetalhe.hidden = false;
    elCorpo.replaceChildren(criar('p', 'historico-vazio', 'Consultando…'));
    const d = await window.orq.usoDetalhe();
    // Fechou enquanto carregava: nao adianta desenhar.
    if (elDetalhe.hidden) return;
    desenharDetalhe(d || {});
    if (d) desenhar(d);
  }

  function fechar() {
    elDetalhe.hidden = true;
  }

  function alternar() {
    const atual = window.OrqCasca?.ui ? window.OrqCasca.ui().uso : 'barras';
    window.OrqCasca?.mudar({ uso: atual === 'oculto' ? 'barras' : 'oculto' });
  }

  elUso?.addEventListener('click', abrir);
  btnFechar?.addEventListener('click', fechar);
  window.OrqOverlays?.registrar(elDetalhe, fechar);

  // A preferencia so decide se o medidor APARECE; ela nao desliga a consulta,
  // que e o que alimenta o detalhe pela paleta.
  window.OrqCasca?.aoMudar(() => desenhar(ultima));

  window.orq.aoMudarUso(desenhar);

  (async () => {
    try {
      desenhar(await window.orq.uso());
    } catch { /* o push do main chega logo depois */ }
  })();

  window.OrqUso = { abrir, fechar, alternar, desenhar, faixa, quandoReseta };
})();
