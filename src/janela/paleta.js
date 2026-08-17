'use strict';

// A paleta de comandos (Ctrl+K).
//
// NAO TEM LOGICA PROPRIA: e uma porta para o que ja existe. Todo item chama uma
// funcao que ja estava la e ja tem teste. Se um comando precisar de codigo novo,
// ele nao pertence a paleta -- pertence ao modulo dono do assunto.
//
// Dentro de uma IIFE, como casca.js e aprovacao.js: os scripts da janela dividem
// um escopo global e `npm run teste:ui` reprova nome de topo repetido.

(() => {
  const elPaleta = document.getElementById('paleta');
  const elBusca = document.getElementById('paleta-busca');
  const elLista = document.getElementById('paleta-lista');
  const btnBusca = document.getElementById('btn-busca');

  // A cor da tag por categoria, como no doc 04.
  const COR = {
    ir: 'var(--warn)',
    nova: 'var(--acc)',
    todas: 'var(--acc)',
    tema: 'var(--info)',
    layout: 'var(--info)',
    ajuda: 'var(--info)',
  };

  // Construido a partir de string, e nao com os caracteres literais: marcas
  // combinantes sao invisiveis no editor e se perdem em qualquer edicao futura.
  const ACENTOS = new RegExp('[\u0300-\u036f]', 'g');

  // A tela e acentuada desde a fatia 2. Obrigar a digitar "sessão" para achar
  // "sessão" seria hostil -- e ninguem digita acento numa caixa de busca.
  function achatar(texto) {
    return String(texto || '').normalize('NFD').replace(ACENTOS, '').toLowerCase();
  }

  let selecionado = 0;
  let itensVisiveis = [];

  // Monta a lista TODA VEZ que abre: sessoes e projetos mudam o tempo todo, e
  // uma paleta que mostra a sessao que voce fechou ha um minuto e pior que nao
  // ter paleta.
  function comandos() {
    const lista = [];
    const escuro = window.OrqCasca?.tema() !== 'claro';

    lista.push({
      tag: 'ir',
      rotulo: 'Pular para quem espera há mais tempo',
      dica: 'ctrl+enter',
      correr: () => window.OrqLateral?.pularParaMaisAntigo(),
    });

    for (const c of window.OrqLateral?.ordenadas?.() || []) {
      lista.push({
        tag: 'ir',
        rotulo: `Ir para ${c.feature}`,
        dica: window.OrqLateral.rotuloDe(c),
        correr: () => window.OrqGrade.focarPainel(c.id),
      });
    }

    lista.push({
      tag: 'nova',
      rotulo: 'Nova sessão no último projeto',
      dica: '',
      correr: () => window.OrqProjetos?.abrirUltimo(),
    });

    for (const p of window.OrqProjetos?.lista?.() || []) {
      if (!p.existe) continue;
      lista.push({
        tag: 'nova',
        rotulo: `Nova sessão em ${p.nome}`,
        dica: p.git ? 'worktree' : 'sem git',
        correr: () => window.OrqProjetos.abrirProjeto(p.id),
      });
    }

    const vivas = window.OrqEnviarVarias?.candidatas().length || 0;
    if (vivas > 1) {
      lista.push({
        tag: 'todas',
        rotulo: `Enviar um prompt para várias sessões (${vivas} vivas)`,
        dica: '',
        correr: () => window.OrqEnviarVarias.abrir(),
      });
    }

    // Uma entrada por projeto com git: a faxina e sempre DE um repositorio, e
    // nao ha uma lista global de worktrees para limpar de uma vez.
    for (const p of window.OrqProjetos?.lista?.() || []) {
      if (!p.existe || !p.git) continue;
      lista.push({
        tag: 'worktree',
        rotulo: `Limpar worktrees de ${p.nome}`,
        dica: 'espaço em disco',
        correr: () => window.OrqLimpeza?.abrir(p.caminho, p.nome),
      });
    }

    // Buscar do remoto acontece sozinho (ao expandir um projeto, ao voltar para
    // a janela, e de tempos em tempos), mas o caso "sei que acabaram de mesclar
    // e quero ver agora" nao e resolvido por nenhum dos tres: o piso de tempo
    // barra. Este e o unico caminho que dispensa o piso.
    lista.push({
      tag: 'git',
      rotulo: 'Buscar novidades no remoto',
      dica: 'todos os projetos',
      correr: () => window.OrqProjetos?.buscarAgora?.(),
    });

    const dormindo = window.OrqGrade?.dormindos?.().length || 0;
    if (dormindo) {
      lista.push({
        tag: 'todas',
        rotulo: `Retomar todas as sessões salvas (${dormindo})`,
        dica: '',
        correr: () => window.OrqGrade.retomarTodas(),
      });
    }

    lista.push({
      tag: 'tema',
      rotulo: escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro',
      dica: '',
      correr: () => window.OrqCasca.mudar({ tema: escuro ? 'claro' : 'escuro' }),
    });

    lista.push({
      tag: 'tema',
      rotulo: window.OrqCasca?.lateral() === 'fechada'
        ? 'Mostrar a barra lateral'
        : 'Ocultar a barra lateral',
      dica: 'ctrl+b',
      correr: () => window.OrqCasca.alternarLateral(),
    });

    // Com a lateral recolhida, o interruptor de hooks fica fora de alcance -- e
    // sem hooks nao ha bolinha de status nenhuma. A paleta passa a ser o outro
    // caminho para ele.
    lista.push({
      tag: 'app',
      rotulo: 'Ligar ou desligar os hooks de status',
      dica: '',
      correr: () => document.getElementById('btn-hooks')?.click(),
    });

    // O rodape da lateral some com Ctrl+B, e "recolher nao pode esconder o unico
    // caminho para nada" -- a mesma razao pela qual o interruptor de hooks ja
    // esta aqui.
    lista.push({
      tag: 'app',
      rotulo: window.OrqLateral?.avisosLigados()
        ? 'Desligar as notificações do sistema'
        : 'Ligar as notificações do sistema',
      dica: 'sessão esperando',
      correr: () => window.OrqLateral?.alternarAvisos(),
    });

    // Atualizacao nunca vira dialogo neste app, entao o unico canal era o rodape
    // da lateral -- que some com Ctrl+B. E a checagem so acontecia de tempos em
    // tempos: este e o caminho para "acabou de sair uma release, quero agora".
    lista.push({
      tag: 'app',
      rotulo: 'Verificar se há versão nova',
      dica: 'atualização',
      correr: () => window.OrqLateral?.verificarAtualizacao(),
    });

    for (const l of window.OrqLayouts?.listar() || []) {
      lista.push({
        tag: 'layout',
        rotulo: `Aplicar layout ${l.nome}`,
        dica: `${l.paineis.length} ${l.paineis.length === 1 ? 'painel' : 'painéis'}`,
        correr: () => window.OrqLayouts.aplicar(l.nome),
      });
    }

    lista.push({
      tag: 'layout',
      rotulo: 'Salvar este arranjo como layout',
      dica: '',
      correr: () => {
        const nome = window.prompt('Nome do layout:', '');
        if (nome) window.OrqLayouts.salvarAtual(nome);
      },
    });

    lista.push({
      tag: 'layout',
      rotulo: 'Redefinir o layout personalizado',
      dica: 'todos do mesmo tamanho',
      correr: () => window.OrqPersonalizado?.redefinir(),
    });

    lista.push({
      tag: 'nova',
      rotulo: 'Cadastrar projeto',
      dica: '',
      correr: () => window.OrqModalProjeto?.abrir(),
    });

    lista.push({
      tag: 'app',
      rotulo: 'Criar atalho no menu Iniciar',
      dica: 'para fixar com o icone certo',
      correr: async () => {
        const r = await window.orq.atalhoCriar();
        window.OrqToast?.mostrar(r.erro
          ? `Não deu para criar o atalho: ${r.erro}`
          : 'Atalho criado no menu Iniciar — fixe a partir dali');
      },
    });

    lista.push({
      tag: 'ajuda',
      rotulo: 'Ver tempo por feature',
      dica: '',
      correr: () => window.OrqHistorico?.abrir(),
    });

    lista.push({
      tag: 'ajuda',
      rotulo: 'Ver uso do Claude Code',
      dica: 'sessão de 5h e semana',
      correr: () => window.OrqUso?.abrir(),
    });

    // O medidor pode ser escondido, e ai este item e o unico caminho de volta --
    // o proprio botao que se alternaria some junto.
    lista.push({
      tag: 'tema',
      rotulo: window.OrqCasca?.ui().uso === 'oculto'
        ? 'Mostrar o medidor de uso no topo'
        : 'Ocultar o medidor de uso no topo',
      dica: '',
      correr: () => window.OrqUso?.alternar(),
    });

    lista.push({
      tag: 'ajuda',
      rotulo: 'Abrir Como usar',
      dica: 'F1',
      correr: () => window.OrqAjuda.abrir(),
    });

    return lista;
  }

  function desenhar() {
    const busca = achatar(elBusca.value);
    itensVisiveis = comandos().filter((c) => !busca || achatar(`${c.tag} ${c.rotulo}`).includes(busca));
    if (selecionado >= itensVisiveis.length) selecionado = Math.max(0, itensVisiveis.length - 1);

    if (!itensVisiveis.length) {
      const vazio = document.createElement('li');
      vazio.className = 'paleta-vazio';
      vazio.textContent = 'Nada encontrado';
      elLista.replaceChildren(vazio);
      return;
    }

    elLista.replaceChildren(...itensVisiveis.map((c, i) => {
      const li = document.createElement('li');
      li.className = 'paleta-item' + (i === selecionado ? ' selecionado' : '');
      li.dataset.indice = String(i);

      const tag = document.createElement('span');
      tag.className = 'paleta-tag mono';
      tag.textContent = c.tag;
      tag.style.color = COR[c.tag] || 'var(--fg3)';

      const rotulo = document.createElement('span');
      rotulo.className = 'paleta-rotulo';
      rotulo.textContent = c.rotulo;

      const dica = document.createElement('span');
      dica.className = 'paleta-dica mono';
      dica.textContent = c.dica || '';

      li.append(tag, rotulo, dica);
      li.addEventListener('click', () => executar(i));
      return li;
    }));
  }

  function executar(i) {
    const alvo = itensVisiveis[i];
    if (!alvo) return false;
    // Fecha ANTES de correr: varios comandos abrem outro overlay (ajuda, modal)
    // ou mexem no foco, e a paleta ainda aberta por cima atrapalharia os dois.
    fechar();
    try {
      alvo.correr();
    } catch (err) {
      console.error('[paleta] comando falhou:', err);
    }
    return true;
  }

  function abrir() {
    elPaleta.hidden = false;
    elBusca.value = '';
    selecionado = 0;
    desenhar();
    elBusca.focus();
  }

  function fechar() {
    elPaleta.hidden = true;
    // Devolve o teclado para o painel focado, senao a proxima tecla se perde.
    const id = window.OrqGrade?.focado?.();
    if (id) window.OrqGrade.focarPainel(id);
  }

  function alternar() {
    if (elPaleta.hidden) abrir();
    else fechar();
  }

  elBusca.addEventListener('input', () => { selecionado = 0; desenhar(); });

  elBusca.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      selecionado = Math.min(selecionado + 1, itensVisiveis.length - 1);
      desenhar();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      selecionado = Math.max(selecionado - 1, 0);
      desenhar();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      executar(selecionado);
    }
  });

  btnBusca?.addEventListener('click', abrir);

  window.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'k') return;
    ev.preventDefault();
    alternar();
  });

  window.OrqOverlays?.registrar(elPaleta, fechar);

  // A paleta so aparece na barra de titulo agora que faz alguma coisa.
  if (btnBusca) btnBusca.hidden = false;

  window.OrqPaleta = { abrir, fechar, alternar, comandos, itens: () => itensVisiveis, executar };
})();
