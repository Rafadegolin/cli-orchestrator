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

O mais barato de todos. `escrever(id, texto)` já existe; falta uma caixa de texto e a seleção de
quais painéis.

**Com o mapa, isso fica melhor:** o grupo passa a ser definido pelas ligações em vez de caixinhas de
seleção — "manda para tudo que está ligado a esta feature".

**Ressalva que a spec não menciona:** disparar o mesmo prompt em cinco sessões custa cinco vezes em
tokens e sobe cinco execuções paralelas. A fila de partida da Fase 6 **não cobre isso** — ela só
controla a partida do painel, não o que você digita depois. Precisa de um aviso com a contagem.

---

## 4. Histórico de tempo por feature

Quanto tempo cada feature levou e quantas vezes te interrompeu.

**Os dados já passam pelo app:** `src/main/estado.js` guarda status e `desde` de cada transição,
alimentado pelos hooks. Falta gravar as transições e somar: tempo em `rodando`, número de entradas em
`esperando`.

É o extra que responde se o app está valendo a pena — e o único que **fica pior quanto mais tarde
começar**, porque histórico não se recupera retroativamente.

---

## 5. Layouts salvos

"Modo revisão" com 2 painéis grandes, "modo tocaia" com 8 pequenos.

Ficou barato depois da Fase 7: já há persistência em JSON, a contagem de colunas é uma variável CSS
(`--colunas`) e a altura mínima é um número. Um layout é esses valores mais o conjunto de painéis.

Esforço baixo, valor de conforto.

---

## 6. Aprovar permissão pelo próprio card

**Mais arriscado do que parece.** A spec descreve "um botão que digita sim no PTY certo", mas o
prompt de permissão do Claude Code não é sim/não em texto — é uma lista interativa navegada por
setas. Um Enter cego pode selecionar "não, e explique o que fazer diferente", ou aprovar algo que
você não leu.

**Metade já existe, e é a metade segura:** `Ctrl+Enter` já pula para quem espera há mais tempo e põe
o cursor lá. O que falta é a aprovação cega — que só vale depois de inspecionar o formato real do
prompt.

---

## Ordem sugerida

1. **Camada 1 do mapa** (`--add-dir` / `/add-dir` entre sessões ligadas). Resolve o problema
   multi-repo e não depende do canvas estar pronto — dá para entregar como um "ligar a" no menu do
   painel, e o canvas vem depois como forma de visualizar.
2. **Diff no app** — fecha o ciclo de revisão.
3. **Colar prompt em várias** — barato, e melhor ainda com as ligações prontas.
4. **Histórico** — começar cedo por causa do acúmulo.
5. **Canvas propriamente dito** (posicionamento, ligações desenhadas, nível de detalhe).
6. **Layouts salvos**, e **aprovação por card** só depois de inspecionar o prompt.

> Pré-requisito de vários: os hooks precisam estar registrados no `~/.claude/settings.json` (botão na
> barra lateral). Sem eles não há bolinha amarela para aprovar, nem transições para o histórico, nem
> evento de `Stop` para o relé.
