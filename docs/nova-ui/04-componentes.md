# 04 — Componentes

## Painel de sessão

O cartão principal. `border-radius: 14px`, fundo `--bg1`, sombra `--shadow`,
entrada `orqPop 320ms`, hover `translateY(-2px)`.

### Cabeçalho (altura ~38px, fundo `--bg2`)
Da esquerda para a direita:

| Elemento | Regra |
|---|---|
| Bolinha de status | 7px, cor por status, animação por status |
| **Nome da sessão** | 12,5px / 700 — nunca encolhe |
| Pill do projeto | 10px mono, fundo `--bg3`, encolhe com reticências |
| Rótulo de status | 10px mono, cor do status, some na densidade 3 |
| Porta | 10px mono, cor `--info`, borda `--line` |
| Ligar | chip alternável; ativo mostra `↔ nome-da-origem` em `--acc` |
| Fechar | 20px, hover `--danger` |

Borda do painel: `--acc` quando focado · `rgba(255,180,84,.35)` quando esperando ·
`--line` no restante.

### Corpo — três variantes mutuamente exclusivas

**a) Terminal (running / waiting / idle)** — fundo `--term`, JetBrains Mono 11,5px,
scroll próprio, cursor piscando ao final. Linhas são `{ texto, cor }`.

**b) Sessão salva (suspended)** — centralizado: rótulo `SESSÃO ANTERIOR`, caminho do
worktree em mono, metadados (última mensagem, arquivos alterados) e botão **Retomar**
(contorno em `--acc`, preenche no hover).

**c) Barra de aprovação (waiting)** — faixa `--warnd` abaixo do terminal com a pergunta
pendente e os botões **Aprovar** (sólido âmbar) e **Ver** (contorno).

## Fila de atenção (sidebar)

Só renderiza quando há sessões em `waiting`. Cabeçalho `ESPERANDO VOCÊ` em `--warn`
com badge de contagem. Cada item: bolinha pulsante, nome, tempo de espera à direita,
fundo `--warnd`, hover desloca 3px para a direita. No rodapé do bloco, o lembrete
`ctrl+enter › ir para a mais antiga`.

## Árvore de projetos

Item de projeto: quadrado de tinta 6px (identidade do projeto), nome, badge `git`/`sem git`.
Clicar abre uma nova sessão naquele projeto usando o campo de feature.
Worktrees aparecem indentadas sob uma guia vertical, com a branch em mono e a porta à direita;
hover pinta guia e texto de `--acc`.

## Rodapé da sidebar

- **Retomar todas (n)** — botão sólido, só aparece quando existem sessões salvas.
- **Hooks** — linha com switch real (trilho 26×15, botão 11px) e rótulo ligados/desligados.
- **Como usar** — contorno, com `F1` alinhado à direita.

## Paleta de comandos (⌘K / Ctrl+K)

Overlay com blur, cartão `--glass` de 560px a 14vh do topo. Campo de busca de 14px sem borda,
divisor, e lista filtrada. Cada item: tag mono colorida por categoria (`ir`, `nova`, `todas`,
`tema`, `ajuda`), rótulo, atalho à direita. Fecha ao executar, ao clicar fora ou com Esc.

## Modal — Cadastrar projeto

520px. Título, explicação de uma linha, campo de pasta (mono) + botão Procurar,
seleção de faixa de portas em três opções (`3100–3199`, `4000–4099`, `5200–5299`),
e ações Cadastrar / Cancelar. O nome do projeto é derivado do último segmento do caminho.

## Modal — Como usar

900×620. Navegação lateral de seções (fundo `--bg2`) + conteúdo. O conteúdo é uma lista
de blocos tipados, para que o texto seja dado e não markup:

| Tipo | Renderização |
|---|---|
| `p` | parágrafo 13,5px, `line-height 1.7` |
| `li` | marcador circular `--acc` de 5px + texto |
| `note` | bloco com barra lateral `--acc` e fundo `--accd` |
| `key` | linha com tecla em caixa mono (largura mínima 92px) + descrição |

## Toast

Centralizado na base, `--glass`, ponto verde + mensagem, entrada `orqUp`, some em 2,2s.
Confirma toda ação irreversível ou invisível (criar worktree, retomar, fechar, cadastrar).
