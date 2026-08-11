# 05 — Estados

## Status da sessão

Quatro estados. Cada um define bolinha, animação, rótulo, corpo do painel e ordem na grade.

| Status | Bolinha | Animação | Rótulo | Corpo do painel | Ordem |
|---|---|---|---|---|---|
| `running` | `--acc` sólida | `orqPulse` | `trabalhando` | Terminal ao vivo | 2º |
| `waiting` | `--warn` sólida | `orqWait` | `esperando há Nm` | Terminal + barra de aprovação | **1º** |
| `idle` | `--fg3` sólida | nenhuma | `ocioso` | Terminal (última saída) | 3º |
| `suspended` | vazada | nenhuma | `sessão salva` | Estado "Retomar" | 4º |

Dentro de `waiting`, o desempate é **maior tempo de espera primeiro** — é a regra que
sustenta a fila de atenção e o Ctrl+Enter.

### Transições

```
suspended --[Retomar / Retomar todas]--> running
running   --[hook: pergunta pendente]--> waiting
waiting   --[Aprovar / resposta no terminal]--> running
running   --[hook: fim de turno]--> idle
idle      --[nova instrução]--> running
qualquer  --[Fechar painel]--> removida
```

> Sem hooks instalados, o app não recebe as transições e todas as sessões ficam paradas em
> `running`. É por isso que a instalação dos hooks é o passo 1 do onboarding e o switch fica
> permanentemente visível no rodapé da sidebar.

## Estados de tela

### Vazio — sem sessões
Marca de 76px com ponto pulsante, título "Nenhuma sessão aberta", parágrafo explicando
worktree + portas + Claude automático, ações **Cadastrar projeto** / **Como usar**, e três
fatos curtos (worktree · portas · hooks). A grade fica `display: none`.

### Vazio — sem projetos
Dentro da seção Projetos, cartão tracejado com uma frase e o botão **Cadastrar projeto**.
Os dois vazios podem coexistir (primeira execução).

### Foco
Uma sessão focada por vez: painel com borda e anel `--acc`, item correspondente na sidebar
com fundo `--bg3`. Foco muda ao clicar no painel, no item da sidebar, na fila, via Ctrl+Enter
ou ao criar/retomar uma sessão.

### Ligação entre sessões
Sessão com `link` mostra `↔ origem` no cabeçalho, em `--acc`. É uma relação direcionada:
a saída da origem alimenta o contexto do destino, inclusive entre repositórios diferentes.
