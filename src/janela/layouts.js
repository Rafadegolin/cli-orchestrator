'use strict';

// Layouts salvos, pela paleta.
//
// Nao ha tela propria: salvar pede o nome numa caixa, aplicar e um item da
// paleta por layout. Modal para isso seria cerimonia demais para uma acao que
// e, no fundo, "volta para aquele arranjo".

(() => {
  let cache = [];

  async function recarregar() {
    cache = await window.orq.layoutsListar();
    return cache;
  }

  // O retrato que a grade ja produz, mais as tres preferencias que a casca ja
  // guarda. Nada de estrutura nova.
  function retratoAtual(nome) {
    const ui = window.OrqCasca.ui();
    return {
      nome,
      tema: ui.tema,
      densidade: ui.densidade,
      ordem: ui.ordem,
      paineis: window.OrqGrade.retratoSessao(),
    };
  }

  async function salvarAtual(nome) {
    const limpo = String(nome || '').trim();
    if (!limpo) return { ok: false, erro: 'sem nome' };

    const r = await window.orq.layoutsSalvar(retratoAtual(limpo));
    if (r.ok) {
      cache = r.layouts;
      window.OrqToast?.mostrar(`Layout "${limpo}" salvo`);
    } else {
      window.OrqToast?.mostrar(r.erro || 'não consegui salvar o layout');
    }
    return r;
  }

  // Aplicar FECHA os painéis atuais. Quando ha sessao rodando isso interrompe
  // trabalho, entao pergunta antes dizendo quantas -- a mesma regra que fechar
  // o app ja segue.
  async function aplicar(nome, { confirmar = true } = {}) {
    const layout = (cache.find((l) => l.nome === nome))
      || (await recarregar()).find((l) => l.nome === nome);
    if (!layout) return { ok: false, erro: 'layout não encontrado' };

    const rodando = [...window.OrqPainel.painelPorId.values()]
      .filter((p) => !p.dormindo && p.status === 'rodando').length;

    if (confirmar && rodando) {
      const ok = window.confirm(
        `${rodando} ${rodando === 1 ? 'sessão está rodando' : 'sessões estão rodando'}.\n\n`
        + `Aplicar o layout "${nome}" fecha ${rodando === 1 ? 'ela' : 'elas'}.`,
      );
      if (!ok) return { ok: false, cancelado: true };
    }

    for (const p of [...window.OrqPainel.painelPorId.values()]) p.destruir();

    window.OrqCasca.mudar({ tema: layout.tema, densidade: layout.densidade, ordem: layout.ordem });

    // Voltam DORMINDO, como na Fase 7: religar seis sessoes sozinho e caro e
    // ninguem pediu. O "Retomar todas" da lateral esta ali para isso.
    for (const p of layout.paineis) {
      await window.OrqGrade.criarPainel({
        cwd: p.cwd,
        feature: p.feature,
        comandoInicial: p.comandoInicial,
        tipoPainel: p.tipoPainel,
        ligacoes: p.ligacoes,
        dormindo: true,
      });
    }

    window.OrqLateral?.atualizarRetomarTodas?.();
    window.OrqToast?.mostrar(`Layout "${nome}" aplicado — ${layout.paineis.length} painéis dormindo`);
    return { ok: true, paineis: layout.paineis.length };
  }

  async function remover(nome) {
    const r = await window.orq.layoutsRemover(nome);
    cache = r.layouts;
    if (r.removido) window.OrqToast?.mostrar(`Layout "${nome}" removido`);
    return r;
  }

  recarregar();

  window.OrqLayouts = { listar: () => cache, recarregar, salvarAtual, aplicar, remover, retratoAtual };
})();
