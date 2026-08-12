'use strict';

// Arrastar arquivo para dentro de um terminal.
//
// O que acontece ao soltar: o CAMINHO ABSOLUTO entra na caixa de entrada do
// Claude, entre aspas e com um espaco no fim. Nada e enviado -- o Enter continua
// sendo seu. E o que qualquer terminal faz ao receber um arquivo, e e a escolha
// segura: um arrasto sem querer nao dispara execucao nem custo de token, e da
// para escrever a pergunta antes ou depois do caminho.
//
// DUAS ARMADILHAS QUE ESTE ARQUIVO EXISTE PARA EVITAR:
//
//  1. Sem `preventDefault` no `dragover` E no `drop` DA JANELA INTEIRA, o
//     Electron NAVEGA o renderer para o arquivo solto -- o app simplesmente
//     vira a imagem que voce arrastou, e nao ha volta sem recarregar. Por isso
//     os ouvintes sao na window, e nao so no painel.
//  2. `file.path` nao existe mais desde o Electron 32. Quem devolve o caminho e
//     o `webUtils.getPathForFile`, e ele so pode ser chamado no preload.

(() => {
  // Caminho sempre entre aspas: "C:\Program Files\..." sem aspas viraria dois
  // argumentos na cabeca de quem le. Mesma regra do --add-dir.
  const comoArgumento = (caminho) => `"${caminho}" `;

  let realcado = null;

  function realcar(el) {
    if (realcado === el) return;
    realcado?.classList.remove('painel-recebendo');
    realcado = el;
    realcado?.classList.add('painel-recebendo');
  }

  function painelDe(alvo) {
    const el = alvo?.closest?.('.painel');
    if (!el) return null;
    const p = window.OrqPainel?.painelPorId.get(el.dataset.id);
    return p && !p.dormindo && !p.encerrado ? p : null;
  }

  function aoArrastar(ev) {
    // Sem isto o Electron abre o arquivo no lugar do app.
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    realcar(painelDe(ev.target)?.el || null);
  }

  function aoSair(ev) {
    // `dragleave` dispara ao passar de um filho para outro dentro do mesmo
    // painel. So limpa quando o ponteiro sai da janela de verdade.
    if (ev.relatedTarget) return;
    realcar(null);
  }

  function aoSoltar(ev) {
    ev.preventDefault();
    realcar(null);

    const arquivos = [...(ev.dataTransfer?.files || [])];
    if (!arquivos.length) return;

    const p = painelDe(ev.target);
    if (!p) {
      // Soltar fora de um painel nao pode ser um silencio: o arquivo "some" e
      // ninguem entende por que.
      window.OrqToast?.mostrar('Solte o arquivo em cima de um terminal aberto');
      return;
    }

    inserir(p, arquivos.map((f) => window.orq.caminhoDoArquivo(f)).filter(Boolean));
  }

  // Separado do evento de propósito: e aqui que mora a regra (aspas, foco, e
  // NENHUM `\r`), e e o que o teste consegue exercitar -- um File sintetico nao
  // tem caminho no disco, entao o arrasto de verdade so da para provar na mao.
  function inserir(p, caminhos) {
    if (!caminhos.length) {
      window.OrqToast?.mostrar('Não consegui ler o caminho desse arquivo');
      return false;
    }

    p.focar();
    // Sem `\r`, nunca. Soltar um arquivo nao pode disparar execucao nem custo.
    window.orq.escrever(p.id, caminhos.map(comoArgumento).join(''));
    window.OrqToast?.mostrar(caminhos.length === 1
      ? 'Caminho inserido — o Enter é seu'
      : `${caminhos.length} caminhos inseridos — o Enter é seu`);
    return true;
  }

  window.addEventListener('dragover', aoArrastar);
  window.addEventListener('dragleave', aoSair);
  window.addEventListener('drop', aoSoltar);
  // Soltar fora da janela do app (no vazio do desktop) tambem cancela o realce.
  window.addEventListener('dragend', () => realcar(null));

  window.OrqAnexos = { comoArgumento, painelDe, aoSoltar, inserir };
})();
