'use strict';

// Os scripts `setup`, `run` e `arquivar` de um projeto (Fase 10.2).
//
// So edita: quem decide quando cada um roda e o resto do app (`grade.js`,
// `painel.js`, `worktrees.arquivar`). E quem VALIDA e o processo principal
// (`projetos.normalizarScripts`), que recusa quebra de linha e texto comprido --
// aqui a recusa so vira a linha de erro do modal.

(() => {
  const CAMPOS = ['setup', 'run', 'arquivar'];

  const elOverlay = document.getElementById('scripts-projeto');
  const elTitulo = document.getElementById('scripts-titulo');
  const elErro = document.getElementById('scripts-erro');
  const btnSalvar = document.getElementById('scripts-salvar');
  const btnCancelar = document.getElementById('scripts-cancelar');
  const campos = Object.fromEntries(CAMPOS.map((c) => [c, document.getElementById(`scripts-${c}`)]));

  let alvo = null;

  function mostrarErro(texto) {
    elErro.textContent = texto || '';
    elErro.hidden = !texto;
  }

  function fechar() {
    alvo = null;
    elOverlay.hidden = true;
  }

  function abrir(id) {
    const p = window.OrqProjetos.lista().find((x) => x.id === id);
    if (!p) return;
    alvo = id;
    elTitulo.textContent = `Scripts de ${p.nome}`;
    for (const c of CAMPOS) campos[c].value = (p.scripts && p.scripts[c]) || '';
    mostrarErro('');
    elOverlay.hidden = false;
    campos.setup.focus();
  }

  async function salvar() {
    const id = alvo;
    if (!id) return null;
    const scripts = Object.fromEntries(CAMPOS.map((c) => [c, campos[c].value]));
    const r = await window.orq.projetosDefinirScripts(id, scripts);
    if (!r.ok) {
      mostrarErro(r.erro || 'Não consegui salvar');
      return r;
    }
    // Recarregar o cache redesenha o botao ▶ de todo painel aberto
    // (`carregarProjetos` chama o `mostrarProjeto` de todos).
    await window.OrqProjetos.carregarProjetos();
    fechar();
    return r;
  }

  btnSalvar?.addEventListener('click', salvar);
  btnCancelar?.addEventListener('click', fechar);
  for (const c of CAMPOS) {
    campos[c]?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); salvar(); }
    });
  }
  window.OrqOverlays?.registrar(elOverlay, fechar);

  window.OrqScriptsProjeto = { abrir, fechar, salvar, aberto: () => elOverlay.hidden === false };
})();
