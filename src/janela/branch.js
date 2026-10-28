'use strict';

// O chip de branch, PR e CI no cabecalho de cada painel (Fase 10.3).
//
// So DESENHA e pede: quem le o git, quem fala com o GitHub (e quem segura a
// credencial) e o processo principal, que empurra `branch:estado` quando algo
// muda -- no `Stop` da sessao, na volta da janela, ou depois de um push.
//
// E ROTULO, nunca portao: quem decide arquivar continua perguntando ao git na
// hora. E CI vermelho NAO vira `esperando`: o amarelo continua significando uma
// coisa so, "tem pergunta te bloqueando".

(() => {
  // id do painel -> o que o main mandou
  const porId = new Map();

  let elMenu = null;
  let idMenu = null;

  function de(id) {
    return porId.get(id) || null;
  }

  // O CI resumido num sinal so: pendente vence falha, que vence ok -- check
  // ainda rodando quer dizer que o veredito nao saiu.
  function textoCi(ci) {
    if (!ci || !ci.total) return '';
    if (ci.pendentes) return 'CI …';
    if (ci.falhas) return `CI ✗ ${ci.falhas}`;
    return 'CI ✓';
  }

  // `{ texto, tom }`, ou texto vazio quando nao ha nada a dizer: no branch base,
  // sem commit a frente e sem PR, o chip so ocuparia espaco.
  function rotulo(e) {
    if (!e || !e.ok || !e.branch) return { texto: '', tom: '' };
    const partes = [];
    let tom = '';
    const pr = e.pr;
    if (pr && pr.estado === 'mesclado') {
      partes.push(`PR #${pr.numero} mesclado`);
      tom = 'ok';
    } else if (pr && pr.estado === 'aberto') {
      partes.push(`PR #${pr.numero}${pr.rascunho ? ' rascunho' : ''}`);
      const ci = textoCi(e.ci);
      if (ci) partes.push(ci);
      if (e.ci && e.ci.falhas && !e.ci.pendentes) tom = 'falha';
      else if (e.ci && e.ci.total && !e.ci.pendentes) tom = 'ok';
    } else if (e.frente > 0) {
      partes.push(`${e.frente} à frente`);
    }
    if (e.semPush > 0 && partes.length) partes.push('push');
    else if (e.semPush > 0) partes.push(`${e.semPush} sem push`);
    return { texto: partes.join(' · '), tom };
  }

  function titulo(e) {
    if (!e || !e.ok || !e.branch) return '';
    const linhas = [`${e.branch}  (base: ${e.base || '?'})`];
    linhas.push(e.frente === 1 ? '1 commit à frente da base' : `${e.frente} commits à frente da base`);
    if (e.upstream) {
      linhas.push(e.semPush ? `${e.semPush} sem push para ${e.upstream}` : `em dia com ${e.upstream}`);
    } else {
      linhas.push('ainda não está no remoto');
    }
    if (e.pr) {
      const estado = { aberto: 'aberto', mesclado: 'mesclado', fechado: 'fechado' }[e.pr.estado] || e.pr.estado;
      linhas.push(`PR #${e.pr.numero} ${estado}${e.pr.rascunho ? ' (rascunho)' : ''}`);
    }
    if (e.ci && e.ci.total) {
      linhas.push(`CI: ${e.ci.total} checks, ${e.ci.falhas} com falha, ${e.ci.pendentes} rodando`);
    }
    if (e.github && e.acesso === false) linhas.push('GitHub sem acesso: o git desta máquina não tem login para ele');
    linhas.push('', 'Clique para enviar, abrir o PR ou atualizar.');
    return linhas.join('\n');
  }

  function desenhar(painel) {
    const el = painel && painel.elBranch;
    if (!el) return;
    const e = painel.tipoPainel === 'terminal' ? null : de(painel.id);
    const { texto, tom } = rotulo(e);
    el.hidden = !texto;
    el.textContent = texto;
    el.title = texto ? titulo(e) : '';
    el.classList.toggle('ci-falha', tom === 'falha');
    el.classList.toggle('ci-ok', tom === 'ok');
  }

  function aplicar(carga) {
    if (!carga || !carga.id) return;
    porId.set(carga.id, carga);
    const painel = window.OrqPainel?.painelPorId.get(carga.id);
    if (painel) desenhar(painel);
    window.OrqLateral?.redesenhar?.();
  }

  // "Pronto para revisar": o agente terminou, e ha trabalho na branch que ainda
  // nao foi integrado. PR mesclado ja nao esta pronto para nada -- esta feito.
  function prontoParaRevisar(id) {
    const e = de(id);
    if (!e || !e.ok || !(e.frente > 0)) return false;
    return !(e.pr && e.pr.estado === 'mesclado');
  }

  // ------------------------------------------------------------ o menu

  // Reusa o `.menu-ctx` do copiar.js: mesmo desenho, ciclo proprio.
  function montarMenu() {
    if (elMenu) return elMenu;
    elMenu = document.createElement('div');
    elMenu.className = 'menu-ctx menu-branch';
    elMenu.hidden = true;
    document.getElementById('app').append(elMenu);
    return elMenu;
  }

  function fecharMenu() {
    if (elMenu) elMenu.hidden = true;
    idMenu = null;
  }

  function menuAberto() {
    return Boolean(elMenu && !elMenu.hidden);
  }

  async function enviar(id) {
    const r = await window.orq.branchPush(id);
    if (r && r.ok) {
      window.OrqToast?.mostrar(`${r.branch} enviada para ${r.remoto}.`);
    } else if (r && r.texto) {
      window.OrqToast?.mostrar(r.texto);
    }
    return r;
  }

  async function abrirPr(id) {
    const r = await window.orq.branchAbrirPr(id);
    if (r && !r.ok && r.texto) window.OrqToast?.mostrar(r.texto);
    return r;
  }

  async function atualizar(id) {
    const r = await window.orq.branchAtualizar(id);
    if (r) aplicar({ id, ...r });
    return r;
  }

  function abrirMenu(id, x, y) {
    const e = de(id);
    const el = montarMenu();
    idMenu = id;

    const itens = [];
    if (e && e.ok && e.branch && (e.semPush > 0 || !e.upstream)) {
      itens.push({ rotulo: e.upstream ? `Enviar ${e.semPush} commit${e.semPush === 1 ? '' : 's'} (push)` : 'Enviar a branch (push)', acao: enviar });
    }
    if (e && e.ok && e.branch) {
      const temPr = e.pr && e.pr.estado === 'aberto';
      itens.push({
        rotulo: temPr ? `Abrir o PR #${e.pr.numero}` : 'Criar PR no GitHub',
        acao: abrirPr,
        desligado: !e.upstream || (e.upstream && e.github === false),
      });
    }
    itens.push({ rotulo: 'Atualizar', acao: atualizar });

    el.replaceChildren(...itens.map((item) => {
      const b = document.createElement('button');
      b.textContent = item.rotulo;
      b.disabled = Boolean(item.desligado);
      b.addEventListener('click', () => {
        const alvo = idMenu;
        fecharMenu();
        if (alvo) item.acao(alvo);
      });
      return b;
    }));

    el.hidden = false;
    const larg = el.offsetWidth;
    const alt = el.offsetHeight;
    el.style.left = `${Math.min(x, window.innerWidth - larg - 4)}px`;
    el.style.top = `${Math.min(y, window.innerHeight - alt - 4)}px`;
    return el;
  }

  // Mesma etiqueta do menu do copiar.js: fecha em clique fora, rolagem, saida
  // da janela e Esc -- este em CAPTURA, senao chegaria tambem ao PTY.
  window.addEventListener('mousedown', (ev) => {
    if (menuAberto() && !elMenu.contains(ev.target)) fecharMenu();
  }, true);
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !menuAberto()) return;
    ev.preventDefault();
    ev.stopPropagation();
    fecharMenu();
  }, true);
  window.addEventListener('blur', fecharMenu);
  window.addEventListener('scroll', fecharMenu, true);

  window.orq.aoMudarBranch?.(aplicar);
  // Carga inicial: a janela pode ter sido recarregada com o main ja sabendo.
  window.orq.branchEstado?.().then((lista) => { for (const c of lista || []) aplicar(c); }).catch(() => {});

  window.OrqBranch = {
    de, rotulo, titulo, desenhar, aplicar, prontoParaRevisar,
    abrirMenu, fecharMenu, menuAberto, enviar, abrirPr, atualizar,
  };
})();
