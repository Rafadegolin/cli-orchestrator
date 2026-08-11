# 02 — Tokens visuais

Todos os tokens são custom properties CSS declaradas no container raiz `.orq`.
O tema claro é a classe `.orq.light` sobrescrevendo as mesmas variáveis — nenhum
componente conhece o tema, só consome tokens.

## Cor

### Tema escuro (padrão)

| Token | Valor | Uso |
|---|---|---|
| `--bg0` | `#0a0c0f` | Fundo da aplicação / área de conteúdo |
| `--bg1` | `#0d1014` | Superfícies: barra de título, sidebar, painéis, modais |
| `--bg2` | `#12161b` | Superfície secundária: inputs, cabeçalho de painel, toolbar |
| `--bg3` | `#171d24` | Hover, chips, estado selecionado |
| `--line` | `#1e242c` | Bordas e divisores |
| `--line2` | `#2b333d` | Bordas em destaque, hover de borda, scrollbar |
| `--fg` | `#e8ecf2` | Texto primário |
| `--fg2` | `#a3adba` | Texto secundário |
| `--fg3` | `#68727e` | Texto terciário, metadados, placeholders |
| `--acc` | `#3ddc97` | Acento: ações primárias, status "trabalhando" |
| `--accd` | `rgba(61,220,151,.10)` | Fundo suave do acento |
| `--warn` | `#ffb454` | Status "esperando você", fila de atenção |
| `--warnd` | `rgba(255,180,84,.10)` | Fundo suave de espera |
| `--info` | `#7aa2f7` | Portas, informação neutra |
| `--danger` | `#f7768e` | Fechar, destrutivo |
| `--term` | `#0b0e12` | Fundo do terminal (idêntico nos dois temas) |
| `--termfg` | `#c8d3e0` | Texto do terminal |
| `--shadow` | `0 18px 50px -20px rgba(0,0,0,.9)` | Elevação |
| `--glass` | `rgba(18,22,27,.86)` | Superfície com blur (paleta, toast) |

### Tema claro

| Token | Valor |
|---|---|
| `--bg0` | `#eef0f3` |
| `--bg1` | `#ffffff` |
| `--bg2` | `#f6f7f9` |
| `--bg3` | `#eceff3` |
| `--line` | `#e0e4ea` |
| `--line2` | `#ccd2db` |
| `--fg` | `#121619` |
| `--fg2` | `#4d5661` |
| `--fg3` | `#828c99` |
| `--acc` | `#0e9d68` |
| `--accd` | `rgba(14,157,104,.09)` |
| `--warn` | `#b8721a` |
| `--warnd` | `rgba(184,114,26,.10)` |
| `--info` | `#3b6fd4` |
| `--danger` | `#d1435f` |
| `--term` / `--termfg` | inalterados |
| `--shadow` | `0 18px 44px -24px rgba(16,24,40,.35)` |
| `--glass` | `rgba(255,255,255,.9)` |

> Acento e aviso escurecem no tema claro para manter contraste AA sobre branco.
> Nunca reutilize o verde `#3ddc97` como texto sobre fundo claro.

### Texto colorido dentro do terminal

| Papel | Cor |
|---|---|
| Comando executado | `var(--acc)` |
| Saída normal | `var(--termfg)` |
| Caminho / ruído | `#6b7686` |
| Aviso, pergunta pendente | `var(--warn)` |
| Progresso / info | `var(--info)` |

## Tipografia

| Família | Uso | Pesos |
|---|---|---|
| **Space Grotesk** | Toda a interface: títulos, botões, rótulos, ajuda | 400 / 500 / 600 / 700 |
| **JetBrains Mono** | Terminal, portas, caminhos, branches, atalhos, badges numéricos | 400 / 500 / 700 |

Escala em uso (px):

| Tamanho | Aplicação |
|---|---|
| 26 / 700 | Contador de sessões vivas (sidebar) |
| 24 / 700 | Título do estado vazio |
| 16 / 700 | Título de modal |
| 15 / 700 | Título da seção de ajuda |
| 13,5 / 400 | Corpo da ajuda |
| 12,5 / 600-700 | Nome de sessão, botões, itens de lista |
| 11,5 | Texto auxiliar, dicas |
| 11,5 mono | Terminal |
| 10 mono | Portas, chips, branches, metadados |
| 9,5 / 700 · letter-spacing .16em · uppercase | Cabeçalhos de seção |

Ajustes: títulos usam `letter-spacing: -.01em` a `-.03em`; parágrafos usam
`line-height: 1.7` e `text-wrap: pretty`. Terminal usa `line-height: 1.65`.

## Espaçamento, raio e forma

- Escala de espaçamento: **4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 22 px**.
- Raios: `5-6px` chips e badges · `7-8px` botões pequenos · `9-10px` botões e campos ·
  `11-14px` cartões e painéis · `16-18px` modais · `24px` marca do estado vazio · `20px+` pílulas.
- Bordas: sempre `1px solid var(--line)`; destaque troca a cor, nunca a espessura.
- Foco de painel: `border-color: var(--acc)` + `box-shadow: 0 0 0 1px var(--acc), var(--shadow)`.

## Movimento

| Nome | Duração / curva | Onde |
|---|---|---|
| `orqPulse` | 2,4s infinito | Bolinha verde (trabalhando) |
| `orqWait` | 1,8–2s infinito | Bolinha âmbar e itens da fila |
| `orqBlink` | 1,05s step-end | Cursor do terminal |
| `orqPop` | 200–320ms ease | Entrada de painéis, modais, paleta |
| `orqUp` | 220ms ease | Toast |
| `orqFade` | 160–400ms ease | Overlays e estado vazio |

Transições de interação: `.14s–.18s ease` para cor de fundo, borda e `transform`.
Hover de painel: `translateY(-2px)`. Hover de item de fila: `translateX(3px)`.

> Respeite `prefers-reduced-motion`: desligue `orqPulse`, `orqWait` e `orqBlink`,
> mantendo apenas mudanças de cor.
