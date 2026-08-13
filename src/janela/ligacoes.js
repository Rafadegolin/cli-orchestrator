'use strict';

// Ligar uma sessao a outro repositorio.
//
// O caso que motivou: uma feature que atravessa repos -- backend num, frontend
// noutro. Ligados, cada lado enxerga o codigo do outro e para de reexplicar o
// contrato da API.
//
// Nao e metafora nossa: o Claude Code tem `--add-dir` como flag e `/add-dir`
// como comando de barra. O app so orquestra.
//
// TUDO ABAIXO FOI MEDIDO CONTRA O CLI 2.1.220, nao presumido:
//
//  1. Escrever "texto\r" de uma vez NAO envia nada para a TUI do Claude: o CR
//     vira quebra de linha e o texto fica parado na caixa de entrada. Tem de
//     digitar, esperar, e mandar o Enter separado -- e o que `enviarLinha` faz.
//     (Com o cmd.exe funciona de qualquer jeito; ele nao e TUI.)
//  2. `/add-dir` abre um prompt de confirmacao com tres opcoes. Sem responder,
//     a ligacao nao acontece.
//  3. Lancar a sessao com `--add-dir` NAO pede confirmacao nenhuma.

// A TUI precisa de um respiro entre o texto e o Enter, senao os dois chegam
// juntos e viram colagem -- que e exatamente o caso 1 acima.
const MS_ANTES_DO_ENTER = 700;

// Quanto esperar o prompt de confirmacao do /add-dir aparecer.
const MS_ESPERA_CONFIRMACAO = 12_000;

// Trecho do prompt de confirmacao. Ler bytes do terminal e algo que a spec
// proibe PARA STATUS -- e com razao, porque quebra a cada atualizacao. Aqui nao
// e status: e uma interacao pontual que a gente mesmo acabou de provocar, e o
// pior caso de errar e um Enter sobrando numa caixa vazia.
//
// Confirmado no binario do CLI 2.1.220: e o `title` do dialogo
// (`wh.jsx(nr,{title:"Add directory to workspace",...})`), e as opcoes sao
// "Yes, for this session" / "Yes, and remember this directory".
const MARCA_CONFIRMACAO = 'Add directory to workspace';

// Como se sabe que DEU CERTO. Medido no spike contra o CLI real: o Enter
// confirma mesmo (diferente do prompt de permissao, que exige o digito), e a
// sessao responde com "Added <caminho> as a working directory for this
// session". Toda comparacao roda sobre o texto ACHATADO -- no spike essa
// resposta veio quebrada entre "as" e "a working directory", e era por isso que
// uma ligacao bem-sucedida parecia ter falhado.
const MARCA_SUCESSO = 'as a working directory';
const MARCA_JA_TINHA = 'is already';

// Sessao ocupada ou esperando nao pode receber texto: em `esperando` o caminho
// seria digitado DENTRO do seletor de permissao, que responde a digitos -- um
// numero no caminho escolheria uma opcao e o Enter seguinte confirmaria.
const STATUS_QUE_RECUSAM = new Set(['esperando']);

function painel(id) {
  return window.OrqPainel?.painelPorId.get(id);
}

function normalizar(p) {
  return String(p || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

// Digita e envia como dois atos. Retorna quando o Enter ja foi mandado.
async function enviarLinha(id, texto) {
  window.orq.escrever(id, texto);
  await new Promise((r) => setTimeout(r, MS_ANTES_DO_ENTER));
  window.orq.escrever(id, '\r');
}

// A leitura mora no Painel (`textoDoBuffer`), que e quem sabe se ha bytes
// pendentes por o painel estar fora da vista. Ler `term.buffer` daqui direto,
// como era antes, devolvia texto velho nesse caso -- e a confirmacao do
// /add-dir podia nunca ser encontrada.
function bufferAchatado(id) {
  return window.OrqPainel.achatar(painel(id)?.textoDoBuffer() || '');
}

// Espera um trecho aparecer NO QUE CHEGOU DEPOIS de agora.
//
// O `textoDoBuffer()` inclui o scrollback inteiro, entao uma confirmacao de
// dez minutos atras casava na primeira volta do laco: o app achava que o
// dialogo estava na tela, esperava 800ms e disparava um Enter no que quer que
// estivesse ali. Na pratica, a SEGUNDA ligacao de uma sessao nao fazia nada e
// reportava sucesso. Guardar o tamanho antes e olhar so a cauda resolve.
async function esperarNovoNoBuffer(id, trecho, ms, desde) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const texto = bufferAchatado(id);
    if (texto.length >= desde && texto.slice(desde).includes(trecho)) return true;
    // O buffer pode ter ENCOLHIDO (o `cls`, ou o scrollback girando). Ai a
    // marca de corte nao vale mais e o jeito honesto e olhar tudo.
    if (texto.length < desde && texto.includes(trecho)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// Insere as flags logo depois de `claude`, unico ponto seguro: `cls && claude
// -w x` tem de virar `cls && claude --add-dir "..." -w x`, e nao terminar com a
// flag depois do argumento.
//
// Caminho SEMPRE entre aspas: "C:\Program Files\..." sem aspas quebraria a
// linha de comando em dois argumentos.
function comAddDir(comando, caminhos) {
  const lista = [...new Set((caminhos || []).filter(Boolean))];
  if (!comando || !lista.length) return comando;
  if (!/\bclaude\b/.test(comando)) return comando;

  const flags = lista.map((c) => `--add-dir "${c.replace(/\//g, '\\')}"`).join(' ');
  return comando.replace(/\bclaude\b/, `claude ${flags}`);
}

function ligacoesDe(id) {
  return painel(id)?.ligacoes || [];
}

function jaLigado(id, caminho) {
  return ligacoesDe(id).some((c) => normalizar(c) === normalizar(caminho));
}

// Painel aberto naquela pasta, se houver -- e quem recebe o espelho da ligacao.
function painelEm(caminho) {
  for (const p of window.OrqPainel?.painelPorId.values() || []) {
    if (normalizar(p.cwd) === normalizar(caminho)) return p;
  }
  return null;
}

// Aplica numa sessao que ja esta rodando. O comando e a resposta aparecem no
// terminal: nada acontece escondido do usuario.
// `ms` e parametro (e nao so a constante) para o teste conseguir exercitar o
// caminho do ESTOURO sem esperar doze segundos por caso. Mesma convencao do
// `{ confirmar = true }` que os dialogos do processo principal ja usam.
async function aplicarEmSessaoViva(id, caminho, ms = MS_ESPERA_CONFIRMACAO) {
  const p = painel(id);
  if (!p || p.encerrado) return { aplicado: false, motivo: 'painel não existe mais' };
  if (p.dormindo) return { aplicado: false, motivo: 'dormindo' };
  if (STATUS_QUE_RECUSAM.has(p.status)) {
    return { aplicado: false, motivo: 'a sessão está esperando uma resposta sua' };
  }

  const desde = bufferAchatado(id).length;
  await enviarLinha(id, `/add-dir ${caminho}`);

  // O /add-dir pergunta antes de liberar o diretorio. O Enter aceita a opcao 1,
  // "Yes, for this session" -- e nao a 2, "remember", que mudaria estado alem
  // desta sessao sem o usuario ter pedido isso. (Medido: aqui o Enter resolve;
  // no prompt de PERMISSAO nao, e por isso os dois foram medidos separados.)
  const perguntou = await esperarNovoNoBuffer(id, MARCA_CONFIRMACAO, ms, desde);
  if (perguntou) {
    await new Promise((r) => setTimeout(r, 800));
    window.orq.escrever(id, '\r');
  }

  // Confirmar nao e o mesmo que ter dado certo: quem diz isso e a sessao.
  const ok = await esperarNovoNoBuffer(id, MARCA_SUCESSO, ms, desde)
    || bufferAchatado(id).slice(desde).includes(MARCA_JA_TINHA);

  if (!ok) {
    return {
      aplicado: false,
      motivo: perguntou
        ? 'o Claude não confirmou o acesso'
        : 'o Claude não pediu a confirmação a tempo',
    };
  }
  return { aplicado: true };
}

// Ligacao e MUTUA quando os dois lados sao painéis: cada sessao enxerga o repo
// da outra. Quando o alvo e so um projeto cadastrado, nao ha sessao do outro
// lado para receber a contrapartida -- fica de ida, e a interface diz isso.
// Registra a ligacao num painel. Devolve o que aconteceu do lado do CLI.
//
// A ORDEM AQUI E O CONSERTO PRINCIPAL. Antes o registro era gravado primeiro e
// o CLI depois, sem ninguem olhar o resultado: se a aplicacao falhasse, a
// ligacao ficava registrada assim mesmo, o seletor ja mostrava "desligar" e a
// proxima tentativa caia no `novo === false` e nao mandava NADA. A falha virava
// permanente e sem saida pela interface -- e essa e a forma exata do relato
// "nao esta ligando".
//
// Agora: painel dormindo registra (a flag `--add-dir` entra na proxima
// partida); sessao viva so registra depois de a sessao confirmar; e falha deixa
// o registro PENDENTE, que e o que permite tentar de novo.
async function registrarEm(p, caminho, aplicar, ms) {
  if (jaLigado(p.id, caminho) && !pendenteEm(p.id, caminho)) {
    return { mudou: false, aplicado: true };
  }

  if (!aplicar || p.dormindo) {
    guardar(p, caminho, { pendente: false });
    return { mudou: true, aplicado: true, sóAoRetomar: Boolean(p.dormindo) };
  }

  const r = await aplicarEmSessaoViva(p.id, caminho, ms);
  guardar(p, caminho, { pendente: !r.aplicado });
  return { mudou: true, aplicado: r.aplicado, motivo: r.motivo };
}

// O campo e `ligacoesPendentes`, e o nome comprido tem motivo: `pendentes` JA
// EXISTE no Painel e guarda os Uint8Array de saida de painel fora da vista
// (Fase 6.1), com `pendentesBytes` contando o total. Este arquivo escrevia
// STRINGS naquele mesmo array sem mexer no contador, entao o
// `descarregarPendentes()` seguinte alocava um buffer menor que o conteudo e
// caia em `junto.set(string, off)`: os bytes viravam zero e o offset podia
// estourar com RangeError. Uma ligacao que falhava corrompia a saida de um
// painel que estivesse rolado para fora da tela.
function guardar(p, caminho, { pendente }) {
  if (!jaLigado(p.id, caminho)) p.ligacoes = [...ligacoesDe(p.id), caminho];
  p.ligacoesPendentes = (p.ligacoesPendentes || []).filter((c) => normalizar(c) !== normalizar(caminho));
  if (pendente) p.ligacoesPendentes.push(caminho);
  p.mostrarLigacoes?.();
}

// Ligacao registrada que o CLI ainda nao aceitou. Existir como ESTADO e o que
// devolve o botao de tentar de novo -- antes isso era um silencio.
function pendenteEm(id, caminho) {
  return (painel(id)?.ligacoesPendentes || []).some((c) => normalizar(c) === normalizar(caminho));
}

async function ligar(id, caminho, { aplicar = true, ms = MS_ESPERA_CONFIRMACAO } = {}) {
  const p = painel(id);
  if (!p || !caminho) return { ok: false };
  if (normalizar(p.cwd) === normalizar(caminho)) {
    return { ok: false, motivo: 'um painel nao se liga a si mesmo' };
  }

  const aqui = await registrarEm(p, caminho, aplicar, ms);

  // Espelho: se ha painel do outro lado, ele passa a enxergar este.
  const outro = painelEm(caminho);
  let la = null;
  if (outro && outro.id !== p.id) la = await registrarEm(outro, p.cwd, aplicar, ms);

  window.OrqGrade?.salvarSessao?.();

  const falhou = [aqui, la].filter((r) => r && r.mudou && !r.aplicado);
  const ok = falhou.length === 0;

  // O resultado deixou de ser descartado: sem isto, uma falha do lado do CLI
  // era indistinguivel de sucesso para quem estava olhando a tela.
  if (!ok) {
    window.OrqToast?.mostrar(`Não consegui ligar: ${falhou[0].motivo}. Clique em aplicar para tentar de novo.`);
  } else if (aqui.sóAoRetomar) {
    window.OrqToast?.mostrar('Ligação registrada: vale quando você retomar a sessão.');
  }

  return {
    ok,
    novo: aqui.mudou,
    mutua: Boolean(outro),
    aplicado: ok,
    motivo: ok ? '' : falhou[0].motivo,
  };
}

// Desligar tira dos dois lados. Nao ha como retirar um diretorio de uma sessao
// ja rodando -- o efeito completo so vale na proxima partida, e a interface
// avisa em vez de fingir que sumiu.
function desligar(id, caminho) {
  const p = painel(id);
  if (!p) return { ok: false };

  p.ligacoes = ligacoesDe(id).filter((c) => normalizar(c) !== normalizar(caminho));
  p.ligacoesPendentes = (p.ligacoesPendentes || []).filter((c) => normalizar(c) !== normalizar(caminho));
  p.mostrarLigacoes?.();

  const outro = painelEm(caminho);
  if (outro) {
    outro.ligacoes = ligacoesDe(outro.id).filter((c) => normalizar(c) !== normalizar(p.cwd));
    outro.ligacoesPendentes = (outro.ligacoesPendentes || []).filter((c) => normalizar(c) !== normalizar(p.cwd));
    outro.mostrarLigacoes?.();
  }

  window.OrqGrade?.salvarSessao?.();
  return { ok: true, precisaReiniciar: !p.dormindo };
}

window.OrqLigacoes = {
  MS_ANTES_DO_ENTER,
  MARCA_CONFIRMACAO,
  MARCA_SUCESSO,
  enviarLinha,
  comAddDir,
  ligar,
  desligar,
  ligacoesDe,
  jaLigado,
  pendenteEm,
  painelEm,
  aplicarEmSessaoViva,
  esperarNovoNoBuffer,
  normalizar,
};
