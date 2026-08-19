'use strict';
// Fases 4 e 5: hook -> servidor -> diff -> bolinha, e a barra lateral ordenada
// por urgencia com cronometro e Ctrl+Enter.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { conectar, checar, encerrar, esperar, zerarGrade } = require('./cdp');

const RAIZ = path.resolve(__dirname, '..');
const hooks = require(path.join(RAIZ, 'src', 'main', 'instalar-hooks'));
const RAIZ_URL = RAIZ.replace(/\\/g, '/');

// O Claude Code executa hooks num shell POSIX. No Windows achar o `sh`
// explicitamente importa: rodando o teste a partir do PowerShell ele nao esta
// no PATH, e spawnSync devolve status null -- o teste falharia inteiro culpando
// o app. Fora do Windows o `/bin/sh` e nativo e nao ha o que procurar. A busca
// mora no `comandos.js`, junto com o resto do que muda de sistema.
const SH = require('./comandos').acharSh();

// Dispara o hook exatamente como o Claude Code faz: shell POSIX, JSON no stdin
// por redirecionamento de arquivo (com stdin em pipe o curl espera o EOF e a
// medida de tempo mente).
function dispararHook(evento, tipo, { orqId = '', cwd = '', message = '' } = {}) {
  const cmd = hooks.comando(evento, tipo);
  const arq = path.join(__dirname, '.corpo-hook.json');
  // `message` e o que o Claude manda no corpo do hook de notificacao, e o que
  // a faixa de aprovacao mostra.
  fs.writeFileSync(arq, JSON.stringify({
    hook_event_name: evento, cwd, session_id: 'sess-teste', message,
  }), 'utf8');
  // O redirecionamento tem de valer para o GRUPO, e nao para o ultimo comando.
  // O comando do hook termina em `|| exit 0`, entao `cmd < arquivo` ligava o
  // arquivo ao `exit`, e o curl lia um stdin vazio: mandava content-length 0 e
  // o corpo do hook nunca chegava. Passou despercebido porque o evento e o tipo
  // vao na URL, entao o status mudava do mesmo jeito -- so o cwd e a pergunta
  // se perdiam, em silencio.
  const t0 = Date.now();
  const r = spawnSync(SH, ['-c', `{ ${cmd} ; } < "${arq.replace(/\\/g, '/')}"`], {
    env: { ...process.env, ORQ_ID: orqId }, encoding: 'utf8', timeout: 10000,
  });
  fs.rmSync(arq, { force: true });
  if (r.status === null) throw new Error(`o shell nao rodou (${SH}): ${r.error?.message || 'status null'}`);
  return { code: r.status, ms: Date.now() - t0 };
}

(async () => {
  const cdp = await conectar();
  await zerarGrade(cdp);

  // FIXA o estado, e nao so limpa a grade no fim.
  //
  // Esta suite le a ORDEM da lista na lateral, entao ela depende de tres
  // preferencias que outra suite pode ter deixado noutro valor: `ordem`
  // (com 'projeto' a lista sai em ordem de projeto e toda checagem de urgencia
  // falha), `densidade` (no slot 'p' os painéis mudam de tamanho) e `lateral`
  // (recolhida, o `#lateral-lista` nem esta na tela). Ja custou uma rodada
  // inteira culpando o app por sujeira de quem rodou antes.
  await cdp.avaliar(`window.OrqCasca.mudar({ ordem: 'urgencia', densidade: 2, lateral: 'aberta' })`);
  await esperar(300);

  checar('lateral carregou', await cdp.avaliar(`typeof window.OrqLateral?.ordenadas`) === 'function');

  const ids = [];
  for (const f of ['alpha', 'beta', 'gama']) {
    ids.push(await cdp.avaliar(`(async () => { const p = await window.OrqGrade.criarPainel(
      { cwd: ${JSON.stringify(RAIZ_URL)}, feature: '${f}' }); return p.id; })()`));
    await esperar(400);
  }
  await esperar(1500);
  checar('3 painéis registrados na lateral', await cdp.avaliar(`window.OrqLateral.cards.size`) === 3);

  // Pedido de permissao -> amarelo. Esta e a meta de 300ms da secao 2.
  const t0 = Date.now();
  const h1 = dispararHook('Notification', 'permissao', { orqId: ids[1] });
  let ms = -1;
  for (let i = 0; i < 60; i++) {
    if (await cdp.avaliar(`window.OrqLateral.cards.get(${JSON.stringify(ids[1])})?.status`) === 'esperando') {
      ms = Date.now() - t0; break;
    }
    await esperar(25);
  }
  checar('latencia do pedido ate a bolinha abaixo de 300ms', ms > 0 && ms < 300, `${ms}ms`);
  checar('o hook em si custou pouco', h1.ms < 300, `${h1.ms}ms, exit=${h1.code}`);
  checar('a bolinha do PAINEL tambem mudou',
    (await cdp.avaliar(`window.OrqPainel.painelPorId.get(${JSON.stringify(ids[1])}).elBolinha.className`)).includes('bolinha-esperando'));

  await esperar(1100);
  dispararHook('Stop', '', { orqId: ids[2] });
  await esperar(600);
  const ordem = JSON.parse(await cdp.avaliar(`JSON.stringify(window.OrqLateral.ordenadas().map(c => c.feature + ':' + c.status))`));
  checar('esperando vem primeiro, terminou em segundo',
    ordem[0].endsWith(':esperando') && ordem[1].endsWith(':terminou'), JSON.stringify(ordem));

  dispararHook('Notification', 'permissao', { orqId: ids[0] });
  await esperar(600);
  const ordem2 = JSON.parse(await cdp.avaliar(`JSON.stringify(window.OrqLateral.ordenadas().map(c => c.feature))`));
  checar('entre dois esperando, o mais antigo vem primeiro', ordem2[0] === 'beta', JSON.stringify(ordem2));

  await esperar(2200);
  const texto = await cdp.avaliar(`document.querySelector('.card-atencao .card-sub')?.textContent`);
  checar('card amarelo mostra ha quanto tempo espera', /h[aá] \d+s/.test(texto || ''), texto);

  // De ponta a ponta: o hook do Canal 2 faz o bloco ESPERANDO VOCE aparecer.
  // A suite ui.js cobre a fila pela API interna; esta checagem e a que prova
  // que ela esta ligada no que vem do Claude de verdade.
  const bloco = JSON.parse(await cdp.avaliar(`JSON.stringify({
    visivel: document.getElementById('bloco-fila').hidden === false,
    itens: document.querySelectorAll('#fila-lista li').length,
    contagem: document.getElementById('fila-contagem').textContent,
    primeiro: document.querySelector('#fila-lista .fila-nome')?.textContent || '',
  })`));
  checar('o hook faz a fila de atencao aparecer',
    bloco.visivel && bloco.itens === 2 && bloco.contagem === '2', JSON.stringify(bloco));
  checar('com o mais antigo no topo da fila', bloco.primeiro === 'beta', bloco.primeiro);

  // A pergunta que o Claude manda no corpo do hook chega ate a faixa. Prova o
  // caminho inteiro: curl -> eventos -> estado -> diff -> tela.
  dispararHook('Notification', 'permissao', {
    orqId: ids[2], message: 'Claude needs your permission to use Bash',
  });
  await esperar(700);
  const faixa = JSON.parse(await cdp.avaliar(`(() => {
    const p = window.OrqPainel.painelPorId.get(${JSON.stringify(ids[2])});
    return JSON.stringify({
      acesa: p.elRodape.classList.contains('tem-pedido'),
      texto: p.elRodape.querySelector('.rodape-pergunta')?.textContent || '',
      aprovar: !!p.elRodape.querySelector('.rodape-aprovar'),
    });
  })()`));
  checar('a pergunta do corpo do hook chega na faixa de aprovacao',
    faixa.acesa && faixa.aprovar && faixa.texto === 'Claude needs your permission to use Bash',
    JSON.stringify(faixa));

  // --- ocioso NAO e espera ------------------------------------------------
  //
  // Medido no binario do CLI: `idle_prompt` dispara 60s depois da ultima
  // mensagem com a sessao parada no prompt -- "acabou e ninguem esta
  // bloqueado". Enquanto ele virava `esperando`, uma sessao que tinha terminado
  // ficava amarela sozinha um minuto depois, sem ter pergunta nenhuma. Foi
  // relatado, e este e o teste que impede a volta.
  const filaAntes = await cdp.avaliar(`window.OrqLateral.filaAtencao().length`);
  dispararHook('Notification', 'ocioso', { orqId: ids[0] });
  await esperar(700);
  const ocioso = JSON.parse(await cdp.avaliar(`JSON.stringify({
    status: window.OrqLateral.cards.get(${JSON.stringify(ids[0])})?.status,
    rotulo: window.OrqLateral.rotuloDe(window.OrqLateral.cards.get(${JSON.stringify(ids[0])})),
    bolinha: window.OrqPainel.painelPorId.get(${JSON.stringify(ids[0])}).elBolinha.className,
    naFila: window.OrqLateral.filaAtencao().length,
  })`));
  checar('sessao ociosa NAO fica amarela: vira `parada`',
    ocioso.status === 'parada' && ocioso.bolinha.includes('bolinha-parada'), JSON.stringify(ocioso));
  checar('e o rotulo nao diz "esperando"',
    ocioso.rotulo.startsWith('parada') && !ocioso.rotulo.includes('esperando'), ocioso.rotulo);
  checar('nem entra na fila ESPERANDO VOCE',
    ocioso.naFila === filaAntes - 1, `${filaAntes} -> ${ocioso.naFila}`);

  // --- os matchers que faltavam -------------------------------------------
  //
  // `elicitation_dialog` e literalmente "Claude Code needs your input" e nao
  // tinha matcher registrado: a sessao ficava travada nessa pergunta com o
  // painel verde, para sempre.
  dispararHook('Notification', 'elicitacao', { orqId: ids[0] });
  await esperar(700);
  checar('elicitation_dialog acende o amarelo',
    await cdp.avaliar(`window.OrqLateral.cards.get(${JSON.stringify(ids[0])})?.status`) === 'esperando', '');

  dispararHook('Notification', 'permissao', { orqId: ids[0] });
  await esperar(600);

  checar('Ctrl+Enter foca quem espera ha mais tempo',
    await cdp.avaliar(`window.OrqLateral.pularParaMaisAntigo()`) === ids[1]);
  checar('o painel certo ficou com o foco visual',
    await cdp.avaliar(`document.querySelector('.painel-focado')?.dataset.id`) === ids[1]);

  dispararHook('UserPromptSubmit', '', { orqId: ids[1] });
  await esperar(600);
  checar('UserPromptSubmit volta para verde',
    await cdp.avaliar(`window.OrqLateral.cards.get(${JSON.stringify(ids[1])}).status`) === 'rodando');

  // Sem ORQ_ID, resolve pelo cwd descendente -- o caso do worktree, que o
  // `claude -w` cria em .claude/worktrees/<nome> DENTRO do projeto.
  //
  // Zera TODOS antes: a versao anterior deste teste so contava quantos estavam
  // esperando, e passava mesmo quando a resolucao por cwd nao acontecia --
  // sobrava alguem amarelo dos hooks anteriores. Foi assim que a perda do corpo
  // do hook (curl com stdin vazio) ficou invisivel.
  //
  // Zerar por HOOK, e nao por OrqLateral.definirStatus: o estado que decide se
  // ha diff a emitir mora no processo principal, e mexer so na janela deixa os
  // dois em desacordo -- o hook seguinte vira no-op e o teste falha sem que o
  // app tenha nada de errado.
  for (const id of ids) dispararHook('UserPromptSubmit', '', { orqId: id });
  await esperar(500);

  dispararHook('Notification', 'permissao', { orqId: '', cwd: `${RAIZ_URL}/.claude/worktrees/qualquer` });
  await esperar(700);
  const algum = JSON.parse(await cdp.avaliar(`JSON.stringify([...window.OrqLateral.cards.values()].map(c => c.status))`));
  checar('sem ORQ_ID, o cwd descendente achou UM painel',
    algum.filter((s) => s === 'esperando').length === 1, JSON.stringify(algum));

  encerrar('FASE45');
})().catch((e) => { console.error('ERRO', e.message); process.exit(3); });
