# 01 — Princípios do redesenho

## O problema que a UI antiga tinha

A versão anterior mostrava tudo com o mesmo peso visual: todos os painéis idênticos,
a barra lateral listando sessões em ordem de criação, e o status resumido em uma bolinha
de 6px sem rótulo. Funcionava, mas o usuário precisava **varrer a tela** para descobrir
o que exigia atenção — exatamente o trabalho que o app deveria eliminar.

## Os quatro princípios

### 1. Urgência é a organização padrão
A ordem natural da informação não é o repositório nem a ordem de criação: é **quem parou
te esperando, há mais tempo**. A barra lateral abre com a "Fila de atenção" e a grade ordena
por urgência por padrão (ordenação por projeto continua disponível como alternância).

### 2. Status legível, não codificado
Toda bolinha vem acompanhada de texto: `trabalhando`, `esperando há 12m`, `ocioso`,
`sessão salva`. A cor acelera quem já conhece; o texto ensina quem está chegando.
Cor nunca é o único portador de significado (acessibilidade).

### 3. Resolver sem entrar
Quando o Claude pede aprovação, a pergunta e os botões **Aprovar / Ver** aparecem no rodapé
do painel. O caso mais comum de interação deixa de exigir foco no terminal e digitação.

### 4. Densidade é escolha do usuário
1, 2 ou 3 colunas (atalhos `1` `2` `3`). A UI se adapta: em 3 colunas o rótulo textual de
status some do cabeçalho e a bolinha assume, porque o espaço vale mais que a redundância.

## Sensação de produto premium

O que carrega essa percepção, em ordem de impacto:

- **Hierarquia tipográfica real** — Space Grotesk (interface) + JetBrains Mono (terminal,
  portas, caminhos, atalhos). Nada de fonte única para tudo.
- **Profundidade contida** — uma sombra longa e suave por superfície elevada
  (`--shadow`), nunca bordas duras empilhadas.
- **Movimento com propósito** — pulso na bolinha de quem trabalha, pulso âmbar em quem espera,
  entrada de painel em 320ms, cursor piscando no terminal. Nada mais se mexe sozinho.
- **Superfícies escalonadas** — quatro níveis de fundo (`--bg0` … `--bg3`) em vez de
  cinza único com bordas.
- **O terminal permanece escuro nos dois temas.** Código monoespaçado sobre fundo claro
  quebra a leitura; é uma decisão deliberada, não um esquecimento.

## O que mudou, item a item

| Antes | Agora |
|---|---|
| Sessões listadas por ordem de criação | Fila de atenção no topo + ordenação por urgência |
| Bolinha sem rótulo | Bolinha + texto de status + tempo de espera |
| Aprovação só dentro do terminal | Barra de ação inline no painel (Aprovar / Ver) |
| Grade fixa | Densidade 1/2/3 colunas com atalho |
| Sem busca | Paleta de comandos (⌘K / Ctrl+K) |
| Projetos como lista plana | Projetos com worktrees aninhadas e porta de cada uma |
| Cadastro de projeto sem opções | Modal com pasta + faixa de portas |
| Só tema escuro | Escuro e claro, com terminal sempre escuro |
| Ajuda em texto corrido | Ajuda seccionada, com blocos de tipos (parágrafo, lista, nota, atalho) |
