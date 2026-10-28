# Fase 10 — fechar o ciclo e despachar em escala

As fases 0 a 9 resolveram bem **para onde olhar**: fila de atenção, farejador, registro do CLI,
aprovação pela faixa. Este documento planeja o passo seguinte, a partir de um estudo do Orca
(Stably AI), do Conductor, do Agent View do próprio Claude Code e das comparações de ferramentas de
orquestração de 2026.

Como na Fase 9, cada item é detalhado contra o **código que já existe**, porque é isso que decide o
esforço real — e registra os riscos que só aparecem olhando de perto. Nada aqui foi medido ainda:
onde houver uma suposição sobre o CLI ou sobre uma biblioteca, ela está marcada como **a medir**.

---

## Por que estes itens, e não outros

O trabalho com várias sessões tem três tempos:

| tempo | pergunta | onde estamos |
|---|---|---|
| **Despachar** | quanto custa pôr uma tarefa para rodar? | razoável (Flow, dupla, projetos) |
| **Atender** | quanto tempo a sessão fica bloqueada esperando você? | **forte** |
| **Fechar** | quanto custa ir de "o agente terminou" até código integrado? | **fraco** |

O consenso das comparações de mercado é que *o gargalo deixa de ser o modelo e passa a ser o
operador*. O Orca e o Conductor investem quase tudo em **fechar** (comentário por linha no diff
voltando para o agente, commit/push/PR/CI dentro do app, scripts por workspace) e em **despachar em
escala** (orquestração via CLI, tarefas do GitHub/Linear).

### O que ficou de fora, de propósito

- **Suportar 30 agentes (Codex, Gemini…).** Nossa vantagem são hooks, registro e farejador, todos
  específicos do Claude Code. Agente genérico já roda hoje como `tipoPainel: 'terminal'`.
- **Navegador embutido / Design Mode / computer use.** Custo alto, fora do núcleo.
- **App de celular próprio.** O Remote Control nativo do Claude Code cobre isso; o certo é montar em
  cima dele, não reescrevê-lo.
- **Best-of-N** (um prompt para N worktrees, escolher o vencedor). Adiado, não descartado: ele
  reaproveita a dupla, o `enviar-varias`, o diff e a faxina, e fica mais barato depois do 10.1.

### A ameaça estratégica

O **Agent View** (`claude agents`, maio de 2026) traz para dentro do CLI a "lista de sessões em
segundo plano". O que nos diferencia é a grade de terminais vivos, a urgência, Windows, o Flow, as
faixas de porta e a aprovação inline. A regra para esta fase: **montar em cima do que o CLI oferece**
(como já foi feito com o registro de sessões e o `--prefill-b64`), nunca competir com ele.

---

## 10.1 Comentário por linha no diff, enviado ao agente

> **Feito.** Seleção por clique e Shift+clique (e não arrasto, que brigaria com a seleção de texto).
> A peça que não estava prevista aqui: colar texto multilinha exige o bracketed paste ligado, senão
> num shell cada linha seria executada. Detalhes no CLAUDE.md, "Comentar o diff para o agente".

**O item de maior retorno por linha de código.** Hoje o diff (`src/janela/diff.js`) é só leitura: ver
um problema exige trocar para o painel e descrever de memória onde está.

### O que muda

Clicar numa linha do diff (ou arrastar um intervalo) abre uma caixa de comentário. Os comentários se
acumulam num **rascunho por worktree**, e um botão "Enviar N comentários" monta um prompt único:

```
Revise estes pontos:

src/api/auth.ts:42-45
> trecho citado
o refresh nao pode rodar se o token ja expirou

src/web/login.tsx:118
...
```

### O que já existe e barateia

- `separar()` já parte o diff por arquivo; falta só ler o cabeçalho `@@ -a,b +c,d @@` para numerar as
  linhas do lado **novo** (linha `-` cita o número do lado antigo e diz isso).
- Escrever na caixa do Claude sem enviar é o `term.paste()` do botão Revisão
  (`Painel.colarRevisao`): bracketed paste, **sem Enter**. Mesmas recusas: `esperando` (o texto cairia
  no seletor de permissão), dormindo/encerrada vira toast.
- Achar o painel da worktree é `OrqLigacoes.painelEm(caminho)`.
- **Sem painel aberto na worktree**, o rascunho pode abrir a sessão com `claude -c` e o prompt no
  `--prefill-b64` — o mesmo `comPrefill` do Flow, com o mesmo teto (`MAX_LINHA`) e a mesma queda para
  a área de transferência.

### Riscos e decisões

- **Um arquivo por vez no DOM continua valendo.** Os marcadores de comentário vivem no modelo
  (`{ arquivo, de, ate, lado, texto }`) e são redesenhados só no arquivo aberto.
- **O rascunho não persiste** na primeira versão. Fechar o app com comentário não enviado perde o
  comentário — o diálogo de fechar avisa se houver rascunho.
- O diff envelhece: entre comentar e enviar o agente pode ter mexido no arquivo. O prompt cita o
  **trecho**, não só o número da linha, para o Claude se achar mesmo com a linha deslocada.
- `teste:diff-comentar` (novo): numeração das linhas com hunks múltiplos, arquivo novo (`/dev/null`),
  o prompt colado sem `\r`, e as recusas.

---

## 10.2 Scripts de setup, run e archive por projeto

Toda worktree nova nasce **sem `node_modules`**, e o agente gasta tokens e minutos descobrindo isso.
O Conductor resolve com três scripts por repositório; aqui eles casam com uma peça que ele não tem:
**as faixas de porta**.

### O que muda

| script | quando roda | onde |
|---|---|---|
| `setup` | ao criar a worktree (dupla, Flow, `claude -w`) | no PTY do painel, **antes** do `claude` |
| `run` | botão ▶ no cabeçalho | num painel `tipoPainel: 'terminal'` na mesma pasta |
| `arquivar` | antes do `worktree remove` | processo principal, com timeout |

Variáveis disponíveis aos scripts: `ORQ_RAIZ` (raiz do projeto, para copiar/linkar o que não está no
git), `ORQ_WORKTREE`, e as de porta de sempre (`PORT`, `ORQ_PORTA`, `ORQ_PORTAS`).

### Onde a configuração mora — decisão a tomar

- **No `projetos.json`** (por máquina): simples, e o arquivo já é do usuário.
- **Num arquivo do repositório** (`.orquestrador.json`, como o `conductor.json`): o time inteiro
  compartilha. Mas um repositório clonado passaria a **executar comando** ao abrir uma worktree.

Proposta: os dois, com **confiança por hash**. O arquivo do repo só roda depois de um diálogo que
mostra o comando, e o app grava no `projetos.json` o hash do que foi aprovado; mudou o texto, pergunta
de novo. `projetos.js` normaliza o campo novo, que entra na lista branca dele.

### Riscos

- **`setup && claude` repete a armadilha da bolinha verde para sempre.** Se o setup falha, o `&&`
  corta e o Claude nunca sobe — com o painel marcado `rodando` e nenhum hook para corrigir. O setup
  tem de rodar com separador **incondicional** (`&` no `cmd.exe`, `;` em bash/zsh), via `OrqShell`, e
  a falha fica visível no scrollback. **A medir:** se a saída do setup atrapalha o primeiro desenho da
  TUI (o `cls`/`clear` hoje vem antes de tudo).
- O comando inteiro continua sujeito ao **teto de 8191 do `cmd.exe`** e ao `MAX_LINHA`: setup longo
  deve ser um script no repo, não uma linha no JSON.
- **A porta do `run`.** Cada painel reserva o próprio bloco; o painel de `run` ganharia um bloco
  diferente do da sessão, e o Claude acharia que o servidor está em outra porta. O `portas.js`
  precisa de "reservar herdando do painel X" (o bloco é liberado quando o **último** dos dois fecha).
- O `arquivar` que falha **recusa o arquivamento com motivo**, na regra do módulo: nenhum caminho de
  recusa deixa resíduo. Timeout próprio, porque o `gitLento` existe justamente para o main não travar.

---

## 10.3 Git, PR e CI no cabeçalho do painel

Hoje "o agente terminou" vira, para fechar o trabalho, terminal externo + navegador. A informação
existe toda no git e no GitHub; falta trazê-la ao painel.

### O que muda

Um chip no cabeçalho (grupo da esquerda, depois da issue) com o estado da branch:

```
3 à frente · push pendente      →   PR #12 · CI ✓     →   PR #12 · CI ✗ 2 falhas
```

E o conceito **"pronto para revisar"**: sessão em `terminou` **com** commits à frente da base. É
o card que o operador quer achar no fim do dia, e hoje ele se parece com qualquer sessão parada.

### De onde vem cada dado

- **À frente / push pendente:** git local, nas funções que o `worktrees.js` já tem
  (`atrasDaBase` é a conta inversa) mais `rev-list @{u}..HEAD`.
- **PR e CI:** API REST do GitHub (`/repos/{o}/{r}/pulls?head=…`, `/commits/{sha}/check-runs`). O
  `owner/repo` já está gravado no cadastro (`remotes`, desde o Flow). **O `gh` não está instalado** e
  não deve virar dependência.
- **Credencial — decisão a tomar.** Repositório público responde sem token (60 req/h). Para privado,
  as opções são um token colado pelo usuário, guardado com `safeStorage`, ou o
  `git credential fill` com `GCM_INTERACTIVE=never` (o Git Credential Manager **nunca** pode abrir
  janela do nada — regra do `gitDeRede`). Sem credencial, o chip mostra só o que é local.

### Ações

- **Push** e **commit** por clique, sempre com diálogo dizendo o que vai acontecer.
- **Abrir PR sem token nenhum:** `https://github.com/{o}/{r}/compare/{base}...{branch}?expand=1`
  aberto no navegador pelo main (o mesmo IPC da issue: só `http`/`https`).

### Riscos e regras

- **CI vermelho NÃO é `esperando`.** O amarelo significa uma coisa só — tem pergunta te bloqueando —
  e foi caro chegar nisso (`idle_prompt` virou `parada` por esse motivo). CI e "pronto para revisar"
  entram na lateral como **outra seção**, abaixo da fila de atenção, sem disputar o Ctrl+Enter.
- **Nenhum relógio novo.** O orçamento de CPU parado está apertado. A consulta dispara no `Stop` da
  sessão, no `aoVoltar` da janela (com piso, no molde do `remoto.js`) e ao expandir o chip. Se algum
  relógio for inevitável, medir com `teste:fase2` antes de escolher a cadência.
- O chip é **rótulo, nunca portão** — mesma regra do `painel.branch`. Quem decide arquivar continua
  perguntando ao git na hora.
- **Todo widget novo no cabeçalho cobra do `@container`.** Definir em que degrau ele sai, e rodar o
  `teste:ui` em 924px na densidade 3.

---

## 10.4 Inbox de tarefas do Flow dentro do app

Hoje o contrato com o Pronix Flow é de mão única: o Flow empurra (`/abrir`, deeplink). Escolher a
próxima tarefa exige ir ao navegador.

### O que muda

Uma seção (ou overlay) "Minhas issues" com o que está atribuído a você no Flow, filtrável por
projeto cadastrado. Um clique abre a sessão — **pelo mesmo caminho do `/abrir`**, chamado por dentro
(`pedido.resolver` + `abrir-externo.js`), sem HTTP e sem duplicar a lógica de slug, branch literal,
worktree e prefill.

### Dependências do outro lado — é o que bloqueia

- Um endpoint de leitura no Flow (issues atribuídas, com `repo`, `branch`, `issue`, `title`, `url`,
  `description` — os mesmos campos do contrato de abrir).
- **Autenticação.** O Flow é web; o app precisaria de um token pessoal. Mesma guarda do 10.3:
  `safeStorage`, nunca em arquivo nosso em texto puro, nunca em log.

### Regras

- O **contrato é deles**, como o de abrir: mora em `apps/web/src/lib/orquestrador.ts` do outro repo.
- Sem relógio: busca ao abrir a seção e no `aoVoltar` com piso. Falha de rede nunca vira diálogo.
- A lista não guarda nada no disco: é sempre lida de novo.

---

## 10.5 Scrollback que sobrevive ao reinício

A Fase 7 recusou **manter processo vivo** com o app fechado, e com razão. Mas ela também deixou de
guardar a **saída**, e isso é outra coisa: retomar amanhã mostra um painel vazio, sem a última coisa
que a sessão disse.

### O que muda

Ao fechar o app (e ao arquivar um painel em dormência), as últimas ~500 linhas de cada painel são
serializadas. O painel restaurado mostra esse texto com um separador "— sessão anterior —"; ao
retomar, o `claude -c` desenha por baixo.

### Riscos

- **Versão do addon — a medir.** `@xterm/addon-serialize` tem de casar com o `@xterm/xterm@5.5.0`,
  e esta é exatamente a armadilha do `addon-webgl@0.19.0` (compilado contra as internals do xterm 6,
  quebra em silêncio). Pinar sem `^`, como o webgl.
- **Chave estável.** O id do painel é efêmero; a chave é feature + pasta, a mesma decisão do
  histórico e das ligações.
- **Custo.** Serializar só no `beforeunload` e ao dormir, nunca por relógio. Medir o tempo de
  serializar 8 painéis cheios, porque o `beforeunload` já faz a gravação imediata do `sessao.json`.
- **Privacidade.** Saída de terminal pode ter segredo. Os arquivos ficam em `~/.orquestrador/telas/`,
  com teto de tamanho, e são apagados ao remover o painel e na poda do arranque — a mesma postura dos
  transcritos que o próprio CLI guarda em `~/.claude`.

---

## 10.6 CLI `orq` e skill de orquestração

**O salto estratégico.** No Orca, um agente coordenador cria worktrees e despacha *workers* pela CLI
do app (com sinais de `ask` e `worker_done`). É a diferença entre um painel de controle e uma
plataforma: **o próprio Claude passa a operar o orquestrador**.

Aqui ele tem uma razão a mais: o *cross-session messaging* nativo do Claude Code é **bloqueado no
Windows** por portão de plataforma (`docs/fase-9-extras.md`). Um barramento nosso é exatamente o que
falta lá.

### Forma proposta

Rotas novas no servidor da 47615, sob `/orq/`, e uma **skill** instalada em
`~/.claude/skills/orquestrador/` que ensina o Claude a usá-las com **`curl`** — a mesma escolha dos
hooks: `curl.exe` já existe no Windows, sem binário nosso para empacotar e assinar. Um executável
`orq` pode vir depois, se a skill provar o valor.

| rota | faz | reaproveita |
|---|---|---|
| `POST /orq/criar` | worktree + painel + prompt inicial | `worktrees.criar`, `comPrefill`, `OrqFila` |
| `POST /orq/enviar` | texto para um painel (sem ou com Enter) | `OrqLigacoes.enviarLinha` |
| `GET /orq/status` | sessões, status, pergunta, branch | `estado.js` |
| `GET /orq/esperar` | long-poll até `terminou`/`esperando`, com timeout | diffs do `estado.js` |
| `GET /orq/diff` | diff da worktree do worker | `worktrees.diff` |

O sinal de `worker_done` **já existe**: é o `Stop` do Canal 2. O `ask` também: é o `esperando` com a
`pergunta` lida na faixa.

### Identidade e limites

- **Quem chama se identifica pelo `ORQ_ID`**, que já está no ambiente de todo PTY. O worker criado
  grava `pai`; o mapa desenha a relação com o mesmo SVG das ligações.
- **Profundidade 1:** worker não cria worker. Teto de filhos por coordenador. Toda partida passa
  pela `OrqFila` — uma rajada de sessões é o que a Fase 6 existe para evitar, e esta é uma forma nova
  de produzi-la **por dentro**.
- **Custo à vista:** o card do coordenador mostra quantos filhos tem e há quanto tempo.

### Segurança — mais estrita que o `/abrir`

O `/abrir` aceita `Origin` ausente porque contra código local não há defesa (quem roda como você já
pode spawnar `claude`). Aqui vale o mesmo raciocínio, com uma diferença: **nenhuma página web tem
motivo legítimo para chamar `/orq/*`**. Portanto: `Host` de loopback, POST com
`application/json` nas rotas de escrita, e **qualquer `Origin` presente é recusado**, sem allowlist.
O interruptor `externo` não cobre isto; ganha o seu próprio, desligado por padrão, e a instalação da
skill pede confirmação como a dos hooks.

### Spike antes de qualquer código (a medir)

- O timeout padrão da ferramenta Bash do CLI corta um long-poll longo: medir, e definir o `esperar`
  com teto abaixo dele, em laço.
- Se o Claude segue a skill de forma confiável num pedido de "divida esta feature em três".
- Comparar com os **agent teams** nativos (experimentais) — se eles chegarem ao Windows, o que sobra
  para nós é a parte visual e a fila, e o desenho deve deixar isso fácil de trocar.

---

## 10.7 Métricas de produtividade

> **Feito.** "Integrado" = arquivar com sucesso (linha `fechou` no JSONL), e o lead time parte do
> **último** `terminou`. As decisões e os detalhes estão no CLAUDE.md, seção do histórico.

"Aumentar a produtividade de verdade" sem número é opinião. O `historico.jsonl` já grava toda
transição com feature, projeto e horário (`CONTAM` já inclui `esperando`); falta a agregação.

### O que mostrar no overlay do histórico

- **Tempo esperando você, por dia** — o custo de atenção. É a métrica que a Fase 10 inteira deveria
  derrubar.
- **Tempo de resposta**: duração média de cada episódio `esperando`.
- **De `terminou` até integrado**: precisa de um evento novo de fechamento (arquivar com sucesso, ou
  branch mesclado na base visto pelo `remoto.js`). Grava uma linha `fechou` no mesmo JSONL.
- Sessões e features por dia.

### Por que vem PRIMEIRO na ordem

É barato (só agregação sobre dados existentes, Node puro, testável no `teste:historico`) e cria a
**linha de base** antes do 10.1. Sem ela, não dá para dizer depois se o resto ajudou.

As regras do módulo continuam: intervalo só conta com evento de fechamento, e subcontar é melhor que
mentir para cima.

---

## Ordem sugerida

1. **10.7 Métricas** — linha de base, custo baixo.
2. **10.1 Comentário no diff** — maior retorno, reaproveita quase tudo.
3. **10.2 Scripts** — corta o tempo morto de toda worktree nova; começar pelo `setup` e pelo `run`.
4. **10.3 Git/PR/CI** — local primeiro (à frente, push), GitHub depois, quando a credencial estiver
   decidida.
5. **10.5 Scrollback** — independente; pode entrar em paralelo a qualquer um.
6. **10.4 Inbox do Flow** — bloqueado pelo endpoint e pela autenticação do outro lado; pedir cedo.
7. **10.6 CLI `orq`** — spike primeiro, código só depois de o spike responder as três perguntas.

## Decisões em aberto

| item | decisão |
|---|---|
| 10.2 | configuração no `projetos.json`, no repo, ou nos dois com confiança por hash |
| 10.2 | separador incondicional do `setup` e efeito no primeiro desenho da TUI |
| 10.3 | fonte da credencial do GitHub (token + `safeStorage` ou `git credential fill`) |
| 10.4 | endpoint e autenticação do lado do Flow |
| 10.5 | versão do `addon-serialize` compatível com o xterm 5.5 |
| 10.6 | teto do long-poll frente ao timeout do Bash do CLI |

## Fontes do estudo

- Orca: [github.com/stablyai/orca](https://github.com/stablyai/orca), [onorca.dev](https://onorca.dev/),
  [notificações](https://onorca.dev/docs/notifications),
  [skill de orquestração](https://www.vibeindex.ai/skills/stablyai/orca/orchestration)
- Conductor: [scripts](https://docs.conductor.build/core/scripts),
  [changelog](https://conductor.build/changelog)
- Mercado: [Best Tools for Managing Parallel AI Coding Agents in 2026](https://dev.to/stravukarl/best-tools-for-managing-parallel-ai-coding-agents-in-2026-14l8),
  [9 Open-Source Agent Orchestrators](https://www.augmentcode.com/tools/open-source-agent-orchestrators)
- Claude Code: [Agent View](https://pasqualepillitteri.it/en/news/2384/claude-code-agent-view-cli-dashboard-sessions-2026),
  [Remote Control, Agent View e /goal](https://cjonsystems.substack.com/p/claude-codes-best-update-yet)

Não confirmado na pesquisa: como o Orca detecta "aguardando permissão" e como funcionam os
checkpoints do Conductor. Parte das comparações de mercado é escrita por fornecedores das próprias
ferramentas.
