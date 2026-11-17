'use strict';

// Confirmacao DENTRO do app (pedido do usuario: nada de dialogo nativo no
// arquivar). Um overlay so, reaproveitado, registrado no OrqOverlays: Esc ou
// clique fora cancelam, e o foco nasce no "Cancelar" -- Enter sozinho nunca
// apaga nada.
//
// `OrqConfirmar.pedir({ titulo, texto, blocos, botao, perigo })` -> Promise<bool>
// `OrqConfirmar.arquivar(projeto, caminhos)` -> Promise<{ aptas } | null>
//
// O arquivar e so ROTULO aqui: a previa vem do main (`worktrees:previa`, os
// mesmos portoes do `triarLote`), e o `arquivar` revalida tudo de novo no
// instante de apagar. A tela pode estar velha; o git, nao.

(() => {
  function criar(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
  }

  const elOverlay = criar('div', 'overlay');
  elOverlay.id = 'confirmar';
  elOverlay.hidden = true;
  const caixa = criar('div', 'modal-caixa confirmar-caixa');
  caixa.setAttribute('role', 'dialog');
  caixa.setAttribute('aria-modal', 'true');
  elOverlay.append(caixa);
  document.getElementById('app').append(elOverlay);

  let resolver = null;

  function fechar(resposta = false) {
    if (elOverlay.hidden) return;
    elOverlay.hidden = true;
    const r = resolver;
    resolver = null;
    if (r) r(resposta);
  }

  window.OrqOverlays?.registrar(elOverlay, () => fechar(false));

  // `blocos`: [{ rotulo, itens: [string | { texto, sub, tom }] }]
  function pedir({ titulo, texto = '', blocos = [], botao = 'Confirmar', perigo = false, rodape = '' }) {
    if (resolver) fechar(false);
    const h = criar('h2', '', titulo);
    h.id = 'confirmar-titulo';
    caixa.setAttribute('aria-labelledby', 'confirmar-titulo');
    const partes = [h];
    if (texto) partes.push(criar('p', 'modal-explica', texto));
    for (const b of blocos) {
      if (!b || !b.itens || !b.itens.length) continue;
      if (b.rotulo) partes.push(criar('div', 'modal-rotulo', b.rotulo));
      const lista = criar('ul', `confirmar-lista${b.tom ? ` confirmar-${b.tom}` : ''}`);
      for (const it of b.itens) {
        const li = criar('li', it.tom ? `confirmar-item-${it.tom}` : '');
        if (typeof it === 'string') li.textContent = it;
        else {
          li.append(criar('span', 'confirmar-item-texto', it.texto));
          if (it.sub) li.append(criar('span', 'confirmar-item-sub mono', it.sub));
        }
        lista.append(li);
      }
      partes.push(lista);
    }
    if (rodape) partes.push(criar('p', 'confirmar-rodape', rodape));
    const acoes = criar('div', 'modal-acoes');
    const cancelar = criar('button', '', 'Cancelar');
    cancelar.id = 'confirmar-cancelar';
    cancelar.addEventListener('click', () => fechar(false));
    const ok = criar('button', perigo ? 'confirmar-perigo' : 'primario', botao);
    ok.id = 'confirmar-ok';
    ok.addEventListener('click', () => fechar(true));
    acoes.append(cancelar, ok);
    partes.push(acoes);
    caixa.replaceChildren(...partes);
    elOverlay.hidden = false;
    cancelar.focus();
    return new Promise((r) => { resolver = r; });
  }

  // A confirmacao do arquivar: o que vai embora (pasta, branch, os arquivos que
  // o git ignora e que nenhum commit guarda), o script do projeto que roda
  // antes, e o que foi recusado e por que. `null` = nada a fazer ou cancelou.
  async function arquivar(projeto, caminhos) {
    const p = await window.orq.worktreesPrevia(projeto, caminhos);
    if (!p || !p.aptas || !p.aptas.length) {
      const motivo = p?.recusadas?.[0]?.texto || 'Nada para arquivar.';
      window.OrqToast?.mostrar(motivo);
      return null;
    }
    const uma = p.aptas.length === 1;
    const itens = p.aptas.map((w) => ({
      texto: w.nome,
      sub: w.branch + (w.ignorados.length ? `  ·  também apaga: ${w.ignorados.join(', ')}` : ''),
    }));
    const recusadas = (p.recusadas || []).map((r) => ({ texto: r.nome, sub: r.texto, tom: 'aviso' }));
    const ok = await pedir({
      titulo: uma ? `Arquivar ${p.aptas[0].nome}?` : `Arquivar ${p.aptas.length} worktrees?`,
      texto: 'Remove a pasta e o branch local de cada uma. O branch no remoto fica.',
      blocos: [
        { rotulo: uma ? 'Vai embora' : 'Vão embora', itens },
        p.aptas.some((w) => w.ignorados.length) && {
          rotulo: 'Atenção', itens: ['Arquivos que o git ignora (como o .env) não estão em commit nenhum e são apagados junto.'], tom: 'aviso',
        },
        p.script && { rotulo: 'Antes de apagar, roda', itens: [{ texto: p.script, sub: 'se ele falhar, nada é apagado' }] },
        recusadas.length && { rotulo: 'Ficam (não dá para arquivar)', itens: recusadas },
      ].filter(Boolean),
      rodape: 'Conferido agora: sem sessão aberta, sem alteração sem commit e sem commit fora da base. Isto não tem desfazer.',
      botao: uma ? 'Arquivar' : `Arquivar ${p.aptas.length}`,
      perigo: true,
    });
    return ok ? { aptas: p.aptas.map((w) => w.caminho) } : null;
  }

  window.OrqConfirmar = { pedir, arquivar, fechar, aberto: () => !elOverlay.hidden };
})();
