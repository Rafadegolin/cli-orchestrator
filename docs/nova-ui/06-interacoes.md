# 06 — Interações

## Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Ctrl+Enter` | Focar a sessão que espera há mais tempo; sem ninguém esperando, toast "Ninguém esperando por você" |
| `⌘K` / `Ctrl+K` | Abrir/fechar a paleta de comandos |
| `F1` | Abrir a ajuda |
| `Esc` | Fechar ajuda, paleta ou modal |
| `1` `2` `3` | Densidade da grade (ignorado com foco em input) |

Todos registrados em `window` com `preventDefault`; teclas numéricas são ignoradas quando
`document.activeElement` é um campo de texto.

## Fluxos

### Criar sessão
1. Usuário digita o nome da feature (opcional). A dica da toolbar muda ao vivo para
   `cria worktree feat/<slug>` ou `sem nome de feature, roda na pasta do projeto`.
2. Clica em **Nova sessão** ou em um projeto na sidebar.
3. O slug normaliza espaços para `-` e vira minúsculas (vai virar nome de branch).
4. O painel entra na grade com `orqPop`, recebe foco, o campo é limpo e o toast confirma:
   `Worktree feat/<slug> criado em <projeto>`.
5. A porta é a próxima livre da faixa do projeto (passo de 5).

### Responder uma sessão que espera
Três caminhos, todos válidos: clicar no item da fila · `Ctrl+Enter` · **Aprovar** direto no
painel. Aprovar move a sessão para `running`, limpa a pergunta, zera o tempo de espera e
remove o item da fila.

### Retomar sessões salvas
Individual pelo botão **Retomar** dentro do painel; em lote por **Retomar todas (n)** no
rodapé da sidebar. Ambos confirmam por toast.

### Cadastrar projeto
Modal → caminho da pasta → faixa de portas → **Cadastrar**. O projeto entra na árvore e
o toast confirma. O nome exibido vem do último segmento do caminho.

### Ligar sessões
O chip `ligar` no cabeçalho alterna a ligação. Ativo, mostra `↔ origem` em verde.

## Microinterações — inventário

| Gatilho | Resposta |
|---|---|
| Hover no painel | Sobe 2px |
| Hover em item da fila | Desloca 3px à direita |
| Hover em botão primário | `brightness(1.08)` e sobe 1px |
| Hover em fechar | Ícone e borda em `--danger` |
| Foco no campo de feature | Borda `--acc`, fundo passa a `--bg3` |
| Sessão trabalhando | Bolinha pulsando + cursor piscando |
| Sessão esperando | Pulso âmbar na bolinha e no item da fila |
| Painel criado | `orqPop` 320ms |
| Ação concluída | Toast por 2,2s |

## Feedback: quando usar cada canal

- **Toast** — ação concluída cujo efeito não é totalmente visível (worktree criado, projeto
  cadastrado, foco movido).
- **Estado no próprio elemento** — tudo que é contínuo (status, ligação, hooks).
- **Modal** — apenas ajuda e cadastro de projeto. Nada mais deve bloquear a tela.
