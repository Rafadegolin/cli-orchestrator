# Fase 9 — extras, detalhados

As fases 0 a 8 da spec estão implementadas. O que resta são extras opcionais. Este documento detalha
cada um contra o **código que já existe**, porque é isso que decide o esforço real de cada um — e
registra os riscos que só aparecem quando se olha de perto.

Ordem sugerida ao final.

---

## 1. Visão de mapa (canvas) com ligações entre sessões

> Extra que não está na spec original. Nasceu de um problema concreto: **uma feature que atravessa
> repositórios** — backend no `vdvsistema` (Nest) e frontend no `pronixcheckout` (Next), mesma
> feature, repos separados.

Hoje isso são dois painéis que não sabem um do outro. Você explica o contrato da API duas vezes, e
quando um lado muda o outro não fica sabendo.

### A visão

Um modo alternativo à grade: painéis viram nós que você posiciona livremente, com deslocamento pela
tela, e **ligações desenhadas entre eles**. A grade continua existindo — o mapa é outro jeito de
olhar o mesmo conjunto de sessões, não um substituto.

### O problema técnico do zoom, e a saída

O xterm desenha em canvas/WebGL na densidade do monitor. Um `transform: scale()` no container deixa
o texto **borrado** e não re-rasteriza a textura do WebGL — é a armadilha clássica de terminal dentro
de canvas.

A saída é **nível de detalhe**: abaixo de certo zoom, o painel é trocado por um cartão (cabeçalho,
bolinha de status e as últimas linhas em texto simples); o terminal de verdade só existe em 1:1.
Isso casa com o que a Fase 6 já faz — painel fora da área visível já para de desenhar e acumula num
buffer de 200 KB, então o cartão não perde saída nenhuma.

### O que "ligar" significa, em três camadas

Cada camada entrega valor sozinha e pode ser feita separada. **A camada 1 é a que resolve o problema
do multi-repo**; as outras duas são conveniência em cima dela.

> **Camada 1 IMPLEMENTADA** (`src/janela/ligacoes.js`). O botão `ligar` no cabeçalho de cada painel
> abre o seletor com os outros painéis e os projetos cadastrados. Provado de ponta a ponta em
> `npm run teste:ligacoes-reais`: sem ligação o Claude diz que não alcança o outro repositório;
> depois do `ligar()`, uma sessão **já viva** passa a ler o código de lá.
>
> Três descobertas do caminho, todas registradas no `CLAUDE.md`: escrever `"texto\r"` de uma vez não
> envia nada para a TUI (o Enter tem de ir separado); `/add-dir` pede confirmação; e lançar com
> `--add-dir` não pede nada.

**Camada 1 — acesso cruzado ao repositório.** Verificado contra o CLI 2.1.220:

- `--add-dir <dir>` existe como flag: dá acesso de leitura a outro diretório e **traz o `CLAUDE.md`
  dele junto** (a documentação do `--bare` lista `--add-dir` entre as fontes de contexto).
- `/add-dir` existe como **comando de barra**, então uma ligação criada numa sessão **já rodando** é
  aplicada na hora — basta escrever `/add-dir <caminho>` no PTY, capacidade que o app já tem
  (`window.orq.escrever`). Sem reiniciar sessão.

Ligar A→B passa a significar: a sessão de A enxerga o repositório de B. É nativo, confiável, e não
depende de nenhuma gambiarra nossa.

**Camada 2 — contexto compartilhado da feature.** Um arquivo por feature
(`~/.orquestrador/features/<slug>/contexto.md`) e um `--append-system-prompt` instruindo as sessões
ligadas a registrarem ali as decisões de contrato ("mudei `/api/pedidos` para incluir `desconto`").

**Isto é cooperativo, não garantido.** Depende de as sessões seguirem a instrução — não há como o app
forçar. Vale como convenção útil, não como mecanismo confiável.

**Camada 3 — relé por evento.** Quando A emite `Stop` (hook que já existe e já move a bolinha para
azul), injetar em B um aviso curto: "o backend terminou, leia o contexto".

**É aqui que mais se erra.** Escrever numa sessão ocupada enfileira texto no stdin e atrapalha o que
ela está fazendo. Regra: só injetar quando o alvo estiver em `terminou` ou `esperando`, **nunca** em
`rodando`. E o texto injetado precisa ser visível no terminal, para você entender de onde veio.

### O que já existe e barateia

- Posições e ligações cabem no `sessao.json` da Fase 7 — a persistência e a restauração já estão de pé.
- `escrever(id, texto)` já entrega ao PTY certo.
- Os hooks já dão `Stop`, `UserPromptSubmit` e `Notification`.
- O corte por visibilidade da Fase 6 já resolve o caso de painel fora da área visível, que num mapa
  passa a ser a regra e não a exceção.

### Riscos

- **O grafo pode virar enfeite.** O valor está nas camadas 1 e 3; se só houver linhas bonitas, é
  ferramenta de organizar caixinha. Construir a camada 1 primeiro é o que evita isso.
- **Direção da ligação.** A enxergar B não faz B enxergar A. Precisa ficar explícito na interface se
  a linha é seta (um sentido) ou aresta (os dois) — e "os dois" custa dois `/add-dir`.
- **Custo.** Cada injeção de prompt é uma chamada ao modelo. Difundir para N sessões custa N vezes.

---

## 2. Ver o diff da sessão sem sair do app

> **FEITO.** `worktrees.diff()` + `src/janela/diff.js`. Clicar na etiqueta do worktree na lateral
> abre o diff: lista de arquivos à esquerda, hunks de um arquivo por vez à direita.
>
> Duas coisas que só apareceram na implementação: `base...branch` precisa de **três** pontos (com
> dois, commits que outra pessoa pôs na base apareceriam como seus, invertidos), e **arquivo novo
> não rastreado não aparece no `git diff`** — enquanto a etiqueta da lateral já o conta como
> alterado. Resolvido com `--no-index` contra o vazio, sem mexer no índice do usuário.

A spec chama de "o que fecha o ciclo de revisão": a bolinha fica azul, você abre o diff ao lado e
decide mesclar ou arquivar sem trocar de janela.

**Já pronto:** `src/main/worktrees.js` tem toda a canalização git (`execFile` com argumentos em
array), sabe o `baseBranch` do worktree principal e já conta `naoMesclados`. `git diff <base>...<branch>`
é praticamente de graça.

**O trabalho é o visualizador.** Sem biblioteca — seria a primeira dependência de UI do projeto — dá
para fazer um diff colorido em DOM puro, legível, sem realce de sintaxe.

**Encaixe:** a lista de worktrees na lateral já mostra `2 alterados` e `1 commit`. Clicar na etiqueta
abre o diff.

---

## 3. Colar prompt em várias sessões de uma vez

> **FEITO.** `src/janela/enviar-varias.js`, aberto pela paleta. A ressalva abaixo virou interface: a
> contagem aparece antes de enviar, e quem está `rodando` vem marcado. O envio é sequencial com
> respiro entre sessões — cinco TUIs recebendo Enter no mesmo milissegundo é a rajada que a fila da
> Fase 6 existe para evitar.

O mais barato de todos. `escrever(id, texto)` já existe; falta uma caixa de texto e a seleção de
quais painéis.

**Com o mapa, isso fica melhor:** o grupo passa a ser definido pelas ligações em vez de caixinhas de
seleção — "manda para tudo que está ligado a esta feature".

**Ressalva que a spec não menciona:** disparar o mesmo prompt em cinco sessões custa cinco vezes em
tokens e sobe cinco execuções paralelas. A fila de partida da Fase 6 **não cobre isso** — ela só
controla a partida do painel, não o que você digita depois. Precisa de um aviso com a contagem.

---

## 4. Histórico de tempo por feature

> **FEITO.** `src/main/historico.js`, JSONL append-only, aberto pelo placar da lateral.
>
> O cuidado que decidiu o desenho: **intervalo só conta quando tem evento de fechamento**. Sem isso,
> uma sessão aberta na sexta com o app fechado no fim de semana viraria "trabalhou 3 dias". O
> `before-quit` fecha os intervalos abertos; numa queda perde-se o último, e subcontar é melhor que
> mentir para cima.

Quanto tempo cada feature levou e quantas vezes te interrompeu.

**Os dados já passam pelo app:** `src/main/estado.js` guarda status e `desde` de cada transição,
alimentado pelos hooks. Falta gravar as transições e somar: tempo em `rodando`, número de entradas em
`esperando`.

É o extra que responde se o app está valendo a pena — e o único que **fica pior quanto mais tarde
começar**, porque histórico não se recupera retroativamente.

---

## 5. Layouts salvos

> **FEITO.** `src/main/layouts.js`, pela paleta. Ficou ainda mais barato do que este documento
> previa: tema, densidade e ordenação já persistiam em `ui.json` desde o redesenho, e o retrato dos
> painéis é o mesmo que a Fase 7 grava. Aplicar traz os painéis **dormindo**, e pergunta antes se
> houver sessão rodando.

"Modo revisão" com 2 painéis grandes, "modo tocaia" com 8 pequenos.

Ficou barato depois da Fase 7: já há persistência em JSON, a contagem de colunas é uma variável CSS
(`--colunas`) e a altura mínima é um número. Um layout é esses valores mais o conjunto de painéis.

Esforço baixo, valor de conforto.

---

## 6. Aprovar permissão pelo próprio card

> **FEITO** na fatia 3 do redesenho (`src/janela/aprovacao.js`), e **o aviso abaixo estava certo**.
> Medido contra o CLI real antes de escrever qualquer código:
>
> - `\r` sozinho **não aprova** — deixa o prompt idêntico na tela. Quem aceita a opção 1 é o dígito
>   `1`, sem Enter depois. (Diferente da confirmação do `/add-dir`, que responde ao Enter: são dois
>   widgets diferentes do mesmo CLI.)
> - Por sorte do desenho, isso torna a falha benigna: um `1` fora de hora vira caractere visível na
>   caixa de entrada, **não enviado**. Um Enter às cegas mandaria mensagem vazia.
> - A trava reconfere o buffer **no clique**, não quando a faixa apareceu; sem as marcas do prompt na
>   tela, não escreve nada.

**Era mais arriscado do que parecia.** A spec descreve "um botão que digita sim no PTY certo", mas o
prompt de permissão do Claude Code não é sim/não em texto — é uma lista interativa navegada por
setas. Um Enter cego pode selecionar "não, e explique o que fazer diferente", ou aprovar algo que
você não leu.

**Metade já existia, e era a metade segura:** `Ctrl+Enter` já pulava para quem espera há mais tempo e
punha o cursor lá.

---

## Ordem sugerida

1. ~~**Camada 1 do mapa**~~ — **feita**.
2. ~~**Diff no app**~~ — **feito**.
3. **Colar prompt em várias** — barato, e melhor ainda com as ligações prontas.
4. ~~**Histórico**~~ — **feito**.
5. ~~**Canvas propriamente dito**~~ — **feito** (`src/janela/mapa.js`). Sem zoom contínuo: o
   terminal nunca é escalado, e o nível de detalhe virou um interruptor de dois estados — 1:1 com
   painéis vivos, ou visão geral onde o painel é **trocado** por um cartão. Escalar borraria o
   xterm, como este documento já previa.
6. **Layouts salvos** — mais barato ainda agora: tema, densidade e ordenação já persistem em
   `ui.json`, então um layout é esse conjunto mais a lista de painéis.
   ~~aprovação por card~~ — **feita**.

**Todos feitos, e a camada 1 ganhou um passo a mais:** a **implementação dupla**
(`src/janela/dupla.js`). Ligar duas sessões resolvia o acesso cruzado, mas ainda eram duas conversas
— e o relato de campo foi exatamente esse: *"hoje abro os dois repositórios, entro nas respectivas
branches e abro um terminal normal com o Claude para aplicar nos 2 repos de uma vez, sem ter que
gerar handoff"*. Agora o app cria a mesma worktree nos dois repositórios e abre **uma** sessão com a
outra em `--add-dir`.

Para isso o app precisou aprender a **criar** worktree (`worktrees.criar`), coisa que nunca fez: até
aqui a criação era 100% do `claude -w` digitado no PTY. As três consequências que decidiram o desenho
— a convenção do branch, o `cwd` do painel ser a worktree e a cópia do `.worktreeinclude` que o CLI
fazia por nós — estão no `CLAUDE.md`.

O que sobrou do item 1 são as camadas 2 e 3 (contexto compartilhado por feature e
relé por evento), que o próprio documento marca como cooperativas e arriscadas — e que só valem
depois de o mapa provar uso no dia a dia.

> Pré-requisito de vários: os hooks precisam estar registrados no `~/.claude/settings.json` (botão na
> barra lateral). Sem eles não há bolinha amarela para aprovar, nem transições para o histórico, nem
> evento de `Stop` para o relé.

## Cross-session messaging: bloqueado no Windows, e não é configuração

O Claude Code anunciou *"on macOS and Linux, your Claude Code sessions can now message each other"*.
**Não dá para usar aqui, e não adianta procurar a chave que liga.** Medido no binário do CLI 2.1.227:

```js
function PS(){ if(Yt()==="windows") return !1;
               return rt("tengu_harbor_kite",!1) || Boolean(re.CLAUDE_CODE_HARBOR_KITE) }
var JHo="Cross-session messaging is not available in this session.";
```

O `return !1` de plataforma vem **antes** da flag de rollout e da variável de ambiente — não há env
var, config nem canário que contorne. As consequências, todas no mesmo portão `PS()`:

- a ferramenta `ListAgents` não é registrada (`isEnabled(){return PS()}`), e o slash command
  `/list-agents` (alias `/peers`) some da lista;
- `SendMessage` para os esquemas `uds:` e `bridge:` responde com o texto acima;
- o socket nunca sobe: `[uds-messaging] Skipped: cross-session messaging gate off`;
- a política de entrada é forçada a `{ policy: "refuse", refuseCause: "kill-switch" }`.

A razão técnica é o transporte: **Unix domain socket**, com verificação de identidade do remetente
por `SO_PEERCRED`/`LOCAL_PEERPID`. Não é uma limitação arbitrária, e por isso não deve ser esperada
para breve. **Não tente de novo** — mesmo espírito do `PreToolUse`, que o `CLAUDE.md` já marca assim.

### O que sobrou, e é melhor do que parecia

O **registro de sessões vivas** que esse recurso usa continua sendo escrito no Windows, em
`~/.claude/sessions/<pid>.json` — e a flag `-n, --name` funciona. Os dois viraram código:

- `montarComando` lança com `--name <slug>`, então o título do terminal, a caixa de prompt e o
  seletor do `/resume` passam a dizer a feature (sem ele, o CLI inventa um e marca
  `nameSource: "derived"`). Medido: `--name` convive com `-w`, e o `(requires --worktree)` que
  aparece perto no `--help` é do `--tmux`;
- `src/main/registro.js` lê o arquivo e usa `status` como **terceira fonte de status** — ver o
  cabeçalho dele para os números do spike e para as duas regras (`waiting` acende, `busy` apaga,
  `idle` não faz nada).

O achado que justifica tudo isso: existe um status **`waiting`**, que é o CLI dizendo afirmativamente
"estou parado esperando a pessoa" — sem deduzir nada de texto de tela, funcionando com painel fora da
vista e **sem hooks instalados**.
