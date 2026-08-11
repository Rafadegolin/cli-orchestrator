'use strict';

// Colar o mesmo prompt em varias sessoes de uma vez.
//
// O trabalho dificil ja estava feito: `OrqLigacoes.enviarLinha` sabe que
// escrever "texto\r" de uma vez NAO envia nada para a TUI do Claude -- o CR
// vira quebra de linha e o texto fica parado na caixa de entrada. O Enter tem
// de ir separado, depois de uma pausa. Aqui so se escolhe para quem.
//
// Duas advertencias que nao sao enfeite:
//
//  1. Cinco sessoes e CINCO VEZES o custo em tokens e cinco execucoes
//     paralelas. A fila da Fase 6 nao cobre isso -- ela controla a partida do
//     painel, nao o que voce digita depois.
//  2. Sessao em `rodando` recebe o texto na fila do stdin e ele atrapalha o que
//     ela esta fazendo. Nao e proibido, a escolha e sua; mas nao acontece sem
//     voce ver.

(() => {
  const elOverlay = document.getElementById('enviar-varias');
  const elTexto = document.getElementById('enviar-texto');
  const elLista = document.getElementById('enviar-lista');
  const elAviso = document.getElementById('enviar-aviso');
  const elAtalhos = document.querySelector('.enviar-atalhos');
  const btnFechar = document.getElementById('enviar-fechar');
  const btnConfirmar = document.getElementById('enviar-confirmar');
  const btnCancelar = document.getElementById('enviar-cancelar');

  // Respiro entre uma sessao e a proxima. Cinco TUIs recebendo Enter no mesmo
  // milissegundo e exatamente a rajada que a fila da Fase 6 existe para evitar.
  const MS_ENTRE_SESSOES = 400;

  const escolhidas = new Set();

  // So sessao com PTY vivo: dormindo e encerrada nao tem para onde escrever.
  function candidatas() {
    const fora = new Set(['encerrada']);
    return [...(window.OrqPainel?.painelPorId.values() || [])]
      .filter((p) => !p.dormindo && !p.encerrado && !fora.has(p.status));
  }

  function ligadasA(painel) {
    if (!painel) return [];
    const L = window.OrqLigacoes;
    return (L?.ligacoesDe(painel.id) || [])
      .map((caminho) => L.painelEm(caminho))
      .filter(Boolean);
  }

  function desenhar() {
    const lista = candidatas();

    // Sessao que fechou enquanto o overlay estava aberto sai da selecao.
    for (const id of [...escolhidas]) {
      if (!lista.some((p) => p.id === id)) escolhidas.delete(id);
    }

    elLista.replaceChildren(...lista.map((p) => {
      const li = document.createElement('li');
      li.className = 'enviar-item' + (escolhidas.has(p.id) ? ' escolhida' : '');
      li.dataset.id = p.id;

      const marca = document.createElement('span');
      marca.className = 'enviar-marca';
      marca.textContent = escolhidas.has(p.id) ? '✓' : '';

      const nome = document.createElement('span');
      nome.className = 'enviar-nome';
      nome.textContent = p.feature;

      const estado = document.createElement('span');
      estado.className = 'enviar-estado mono';
      // Quem esta trabalhando vem marcado: o texto entra na fila dela.
      estado.textContent = p.status === 'rodando' ? 'trabalhando' : (p.elStatus?.textContent || '');
      if (p.status === 'rodando') estado.classList.add('enviar-ocupada');

      li.append(marca, nome, estado);
      li.addEventListener('click', () => {
        if (escolhidas.has(p.id)) escolhidas.delete(p.id);
        else escolhidas.add(p.id);
        desenhar();
      });
      return li;
    }));

    atualizarAviso();
  }

  function atualizarAviso() {
    const n = escolhidas.size;
    const ocupadas = candidatas().filter((p) => escolhidas.has(p.id) && p.status === 'rodando').length;

    if (!n) {
      elAviso.textContent = 'Escolha ao menos uma sessão.';
      elAviso.className = 'enviar-aviso';
      btnConfirmar.disabled = true;
      return;
    }

    btnConfirmar.disabled = false;
    const partes = [`Vai para ${n} ${n === 1 ? 'sessão' : 'sessões'} — ${n} ${n === 1 ? 'execução' : 'execuções'} e ${n}× o custo em tokens.`];
    if (ocupadas) {
      partes.push(`${ocupadas} ${ocupadas === 1 ? 'está trabalhando' : 'estão trabalhando'}: o texto entra na fila ${ocupadas === 1 ? 'dela' : 'delas'}.`);
    }
    elAviso.textContent = partes.join(' ');
    elAviso.className = ocupadas ? 'enviar-aviso enviar-cuidado' : 'enviar-aviso';
  }

  function selecionar(alvo) {
    const lista = candidatas();
    escolhidas.clear();
    if (alvo === 'todas') for (const p of lista) escolhidas.add(p.id);
    else if (alvo === 'esperando') for (const p of lista) { if (p.status === 'esperando') escolhidas.add(p.id); }
    else if (alvo === 'ligadas') {
      const focado = window.OrqPainel?.painelPorId.get(window.OrqGrade?.focado?.());
      if (focado) {
        escolhidas.add(focado.id);
        for (const p of ligadasA(focado)) escolhidas.add(p.id);
      }
    }
    desenhar();
  }

  async function enviar() {
    const texto = (elTexto.value || '').trim();
    if (!texto || !escolhidas.size) return { enviadas: 0 };

    const alvos = candidatas().filter((p) => escolhidas.has(p.id));
    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Enviando…';

    // SEQUENCIAL, e nao Promise.all: ver o comentario do respiro no topo.
    let enviadas = 0;
    for (const p of alvos) {
      // O painel pode ter sido fechado entre a escolha e a vez dele.
      if (!window.OrqPainel.painelPorId.has(p.id)) continue;
      await window.OrqLigacoes.enviarLinha(p.id, texto);
      enviadas += 1;
      await new Promise((r) => setTimeout(r, MS_ENTRE_SESSOES));
    }

    btnConfirmar.textContent = 'Enviar';
    fechar();
    window.OrqToast?.mostrar(`Enviado para ${enviadas} ${enviadas === 1 ? 'sessão' : 'sessões'}`);
    return { enviadas };
  }

  function abrir() {
    elOverlay.hidden = false;
    elTexto.value = '';
    escolhidas.clear();
    btnConfirmar.textContent = 'Enviar';
    desenhar();
    elTexto.focus();
  }

  function fechar() {
    elOverlay.hidden = true;
  }

  elAtalhos?.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-alvo]');
    if (b) selecionar(b.dataset.alvo);
  });

  btnFechar?.addEventListener('click', fechar);
  btnCancelar?.addEventListener('click', fechar);
  btnConfirmar?.addEventListener('click', enviar);
  window.OrqOverlays?.registrar(elOverlay, fechar);

  window.OrqEnviarVarias = {
    abrir, fechar, enviar, selecionar, candidatas,
    escolhidas: () => [...escolhidas],
    MS_ENTRE_SESSOES,
  };
})();
