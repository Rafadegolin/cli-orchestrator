'use strict';

// O pedido que chega DE FORA: do Pronix Flow, por deeplink ou por HTTP.
//
// Node puro, sem Electron, pela mesma razao do `worktrees.js` e do
// `plataforma.js`: handler de IPC e handler de HTTP nao dao para testar sem
// subir o app, e tudo que decide alguma coisa aqui precisa de teste. O que
// depende do Electron (protocolo, janela, fila) mora no `externo.js`.
//
// O CONTRATO E DO FLOW, e ja esta implementado do lado de la
// (`apps/web/src/lib/orquestrador.ts`). Mudar qualquer campo aqui exige mudar
// aquele arquivo:
//
//   POST /abrir  { repo, branch, issue, title, url, description }
//   orquestrador://abrir?repo=&branch=&issue=&title=&url=&description=
//
// `issue` e STRING (TECH-1120), nao numero, e `url` aponta para a issue no
// Flow -- nao para o GitHub.

const MAX_TEXTO = 255;
const MAX_PROMPT = 5000;
const MAX_URL = 2000;

// ------------------------------------------------------------ repositorio

// `owner/repo` minusculo, a partir de qualquer forma de URL de remote que o git
// aceita. Devolve null para o que nao da para reconhecer -- nunca um palpite.
//
// O Flow manda o nome canonico com a caixa original (VDVTech/pronix-flow), e um
// clone pode ter sido feito por https enquanto outro usou ssh. Por isso a
// comparacao e sempre minuscula dos dois lados.
//
// A credencial embutida (https://user:token@host/...) e descartada AQUI, e nao
// depois: o resultado desta funcao vai para o `projetos.json`, que e um arquivo
// em claro na pasta do usuario.
function normalizarRepo(bruto) {
  let texto = String(bruto || '').trim();
  if (!texto || texto.length > MAX_URL) return null;

  // Forma scp (`git@host:owner/repo.git`), que nao e URL para o `new URL`.
  const scp = texto.match(/^[^@/]+@([^:/]+):(.+)$/);
  if (scp) texto = `ssh://${scp[1]}/${scp[2]}`;

  let caminho;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(texto)) {
    let u;
    try { u = new URL(texto); } catch { return null; }
    caminho = u.pathname;
  } else {
    // Ja veio como `owner/repo` (que e o que o Flow manda) ou `host/owner/repo`.
    caminho = texto;
  }

  const partes = caminho
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  if (partes.length < 2) return null;

  // O `.git` do fim e do transporte, nao do nome.
  partes[partes.length - 1] = partes[partes.length - 1].replace(/\.git$/i, '');
  if (!partes[partes.length - 1]) return null;

  return partes.join('/').toLowerCase();
}

// Todas as leituras plausiveis de um remote, para o casamento.
//
// `https://github.com/acme/app.git` normaliza para `github.com/acme/app`, e o
// Flow manda `acme/app`. Sem a cauda de dois segmentos, nada casaria. Subgrupo
// de GitLab (`grupo/sub/repo`) sobrevive porque a leitura cheia continua na
// lista.
function chavesDeRepo(bruto) {
  const cheio = normalizarRepo(bruto);
  if (!cheio) return [];
  const partes = cheio.split('/');
  const chaves = new Set([cheio]);
  if (partes.length > 2) chaves.add(partes.slice(-2).join('/'));
  return [...chaves];
}

function combinaRepo(alvo, remotes) {
  const querido = new Set(chavesDeRepo(alvo));
  if (!querido.size) return false;
  for (const r of remotes || []) {
    for (const k of chavesDeRepo(r)) if (querido.has(k)) return true;
  }
  return false;
}

// ------------------------------------------------------------ o pedido

// Campo de UMA linha: branch, titulo, identificador. Eles viram rotulo de painel,
// `sessao.json` e argumento de git, e ali quebra de linha nao tem o que fazer.
function limpar(v, max = MAX_TEXTO) {
  return String(v == null ? '' : v)
    // Runs colapsam num espaco so: um `\r\n` e UMA quebra, e nao duas.
    //
    // `\r` e `\n` escritos no PTY sao Enter. Um prompt que carrega quebra de linha se
    // ENVIA sozinho, e "a gente nunca manda" falharia por dentro -- por isso a
    // varredura pega C0 e DEL inteiros, e nao so os dois obvios.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);
}

// Texto de VARIAS linhas: a descricao da issue, que so vai para o prompt.
//
// O `limpar` achatava a descricao num bloco so, e o argumento dele nao vale aqui:
// o prompt NUNCA e digitado no PTY. Ele vai como `--prefill-b64` (base64url, sem
// nenhum caractere de controle na linha de comando) ou para a area de
// transferencia -- ver o `comPrefill` em `src/janela/projetos.js`.
//
// `\n` e `\t` ficam porque o validador do CLI os aceita. O resto do C0 e o DEL
// continuam caindo: ali a recusa do CLI e MUDA, e a sessao abriria com a caixa
// vazia. Linha em branco repetida NAO e colapsada -- o texto chega como foi
// escrito no Flow.
function limparTexto(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);
}

function urlSegura(v) {
  const t = String(v || '').trim();
  if (!t || t.length > MAX_URL) return '';
  try {
    const u = new URL(t);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
  } catch { return ''; }
}

// Forma canonica do pedido, vinda de qualquer um dos dois canais.
//
// `branch` NAO e validada como ref aqui: quem sabe recusar nome de branch e o
// git (`worktrees.branchValido`), e ele nao mora neste modulo. Aqui so cai o que
// nem chega a ser texto utilizavel.
function normalizarPedido(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const repo = normalizarRepo(b.repo);
  const branch = limpar(b.branch, 200);

  if (!repo) return { ok: false, erro: 'repo-invalido', texto: 'repo tem de ser owner/repo' };
  if (!branch) return { ok: false, erro: 'branch-invalida', texto: 'branch vazia' };

  return {
    ok: true,
    pedido: {
      repo,
      // O que o Flow mandou, com a caixa original -- so para ecoar em mensagem.
      repoOriginal: limpar(b.repo),
      branch,
      issue: limpar(b.issue, 60),
      title: limpar(b.title),
      url: urlSegura(b.url),
      // Multilinha de proposito: paragrafos e listas da issue chegam ao prompt
      // como foram escritos. Ver `limparTexto`.
      description: limparTexto(b.description, MAX_PROMPT),
      // Desempate de ambiguidade, e SO isso -- ver `resolver`.
      projeto: limpar(b.projeto, 80),
    },
  };
}

// Do deeplink `orquestrador://abrir?...`.
//
// MEDIDO: `new URL('orquestrador://ABRIR/?x=1').host` e 'ABRIR' -- esquema
// nao-especial NAO e minusculizado pelo parser -- e `.pathname` vem VAZIO (ou
// '/' quando ha barra no fim). Por isso a rota sai do `host`, nunca do
// `pathname`.
function deDeeplink(bruto) {
  let u;
  try { u = new URL(String(bruto || '')); } catch { return null; }
  if (u.protocol !== 'orquestrador:') return null;
  if (u.host.toLowerCase() !== 'abrir') return null;

  const q = u.searchParams;
  return normalizarPedido({
    repo: q.get('repo'),
    branch: q.get('branch'),
    issue: q.get('issue'),
    title: q.get('title'),
    url: q.get('url'),
    description: q.get('description'),
    projeto: q.get('projeto'),
  });
}

// Acha o deeplink no argv VARRENDO, em vez de indexar.
//
// No layout de desenvolvimento o caminho do app ocupa o argv[1], e o Electron
// pode por switches do Chromium no argv do `second-instance`. E a mesma decisao
// que o `--remover-hooks` do `index.js` ja tomou e documentou.
function deArgv(argv) {
  for (const a of argv || []) {
    if (/^orquestrador:\/\//i.test(String(a))) return String(a);
  }
  return null;
}

// A chave de deduplicacao.
//
// Com o app fechado, o Flow dispara o deeplink E DEPOIS re-sonda o /ping por
// ~3s para mandar o POST. Ou seja: o MESMO pedido chega duas vezes, e isso e o
// caminho normal, nao a borda. "Ja existe painel nessa pasta" nao resolve --
// nesses 3 segundos o `git worktree add` ainda esta rodando.
function chaveDoPedido(p) {
  return `${p.repo}|${String(p.branch || '').toLowerCase()}`;
}

// ------------------------------------------------------------ resolucao

// De `owner/repo` para UM projeto cadastrado.
//
// A REGRA QUE NAO PODE SER CONTORNADA E UMA QUESTAO DE ASSINATURA: esta funcao
// recebe a lista de projetos e devolve UM ITEM DELA. Nao existe caminho de
// codigo em que uma string do pedido vire caminho de disco -- nao porque alguem
// se lembre de validar, mas porque aqui nao ha nenhuma construcao de caminho.
//
// `pedido.projeto` e DESEMPATE, nunca chave de busca. Se ele valesse sozinho,
// `{ repo: 'qualquer-coisa', projeto: 'pj-x' }` abriria o pj-x, e a regra teria
// virado "qualquer id serve".
function resolver(pedido, projetos) {
  const lista = Array.isArray(projetos) ? projetos : [];
  const candidatos = lista.filter((p) => p && p.existe && combinaRepo(pedido.repo, p.remotes));

  if (!candidatos.length) {
    return {
      ok: false,
      erro: 'repo-nao-cadastrado',
      repo: pedido.repo,
      texto: `Nenhum projeto cadastrado aponta para ${pedido.repoOriginal || pedido.repo}.`,
      acao: 'cadastrar',
    };
  }

  if (candidatos.length > 1) {
    const escolhido = pedido.projeto
      ? candidatos.find((p) => p.id === pedido.projeto)
      : null;
    if (!escolhido) {
      return {
        ok: false,
        erro: 'repo-ambiguo',
        repo: pedido.repo,
        texto: `${candidatos.length} projetos cadastrados apontam para ${pedido.repo}.`,
        opcoes: candidatos.map((p) => ({ id: p.id, nome: p.nome })),
      };
    }
    return { ok: true, projeto: escolhido };
  }

  return { ok: true, projeto: candidatos[0] };
}

// ------------------------------------------------------------ o prompt

// O primeiro prompt, montado AQUI porque o Flow nao manda um.
//
// Ele vai para a caixa de entrada do Claude e NAO e enviado -- ver o
// `--prefill-b64` no `src/janela/projetos.js`. Se tudo falhar, o pior resultado
// e texto visivel parado na caixa, que e a mesma propriedade do digito `1` da
// aprovacao.
//
// O corte e RECUSA, e nao truncagem: prompt cortado e prompt errado, e o CLI
// recusa acima de 5000 EM SILENCIO (a recusa vai para o log de depuracao dele, e
// a sessao abre com a caixa vazia). Melhor dizer o numero.
function montarPrompt(pedido) {
  const linhas = [];
  const cabeca = [pedido.issue, pedido.title].filter(Boolean).join(' — ');
  if (cabeca) linhas.push(`Trabalhe na issue ${cabeca}`);
  if (pedido.url) linhas.push(pedido.url);
  if (pedido.description) linhas.push('', pedido.description);

  const texto = linhas.join('\n').trim();
  if (texto.length > MAX_PROMPT) {
    return {
      ok: false,
      erro: 'prompt-longo',
      texto: `o contexto tem ${texto.length} caracteres; o limite do CLI e ${MAX_PROMPT}`,
    };
  }
  return { ok: true, prompt: texto };
}

module.exports = {
  MAX_TEXTO,
  MAX_PROMPT,
  normalizarRepo,
  chavesDeRepo,
  combinaRepo,
  normalizarPedido,
  deDeeplink,
  deArgv,
  chaveDoPedido,
  resolver,
  montarPrompt,
  urlSegura,
};
