# 07 — Conteúdo e tom de voz

## Princípios de escrita

- **Português direto, sem jargão de UI.** "Esperando você", não "Aguardando interação do usuário".
- **Segunda pessoa, verbo no presente.** "Ele mostra várias sessões ao mesmo tempo."
- **Nomes técnicos permanecem em inglês** quando são o termo real: worktree, branch, hooks, git.
- **Rótulos curtos, dicas explicativas.** O botão diz `Nova sessão`; a dica ao lado explica
  o que vai acontecer com o nome digitado.
- **Sem exclamação, sem emoji, sem "Ops!".**

## Textos-chave da interface

| Local | Texto |
|---|---|
| Cabeçalho da fila | `ESPERANDO VOCÊ` |
| Lembrete da fila | `ctrl+enter › ir para a mais antiga` |
| Dica com feature | `cria worktree feat/<slug>` |
| Dica sem feature | `sem nome de feature, roda na pasta do projeto` |
| Busca | `Buscar sessão, projeto, comando…` |
| Vazio (título) | `Nenhuma sessão aberta` |
| Vazio (corpo) | `Cadastre um repositório, digite o nome da feature e o Orquestrador cria o worktree, reserva a faixa de portas e sobe o Claude sozinho.` |
| Sem projetos | `Nenhum repositório ainda. Cadastre um para abrir sessões com um clique.` |
| Painel salvo | `SESSÃO ANTERIOR` + caminho + `Retomar` |
| Aprovação | `Esperando você` (ou a pergunta real do Claude) |
| Toasts | `Worktree feat/x criado em y` · `Sessão x retomada` · `Painel x fechado` · `Projeto x cadastrado` · `Foco em x` · `Ninguém esperando por você` |

## Estrutura da ajuda (F1)

Seis seções, cada uma composta por blocos tipados (`p`, `li`, `note`, `key`):

1. **O que este app faz** — a proposta em um parágrafo, três benefícios em lista,
   fechamento sobre isolamento por worktree e faixa de portas.
2. **Primeiros passos** — hooks → cadastrar projeto → nome da feature + clique no projeto.
   Nota sobre backup do `settings.json`.
3. **As bolinhas de status** — o que cada cor significa (ver 05-estados).
4. **Worktrees e portas** — com e sem nome de feature; nota sobre a faixa de portas.
5. **Ligar sessões** — o que o chip faz e para que serve.
6. **Atalhos** — a tabela de teclas.

Ao adicionar uma seção, mantenha o padrão: **um parágrafo de contexto antes de qualquer lista**,
e nunca mais de uma nota por seção.
