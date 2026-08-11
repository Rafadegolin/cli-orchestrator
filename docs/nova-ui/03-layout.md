# 03 — Layout

## Estrutura da janela

```
┌──────────────────────────────────────────────────────────────┐
│ Barra de título (38px) — marca · menus · busca ⌘K · tema · WM │
├───────────────┬──────────────────────────────────────────────┤
│               │ Toolbar (feature · nova sessão · ordenação)   │
│  Sidebar      ├──────────────────────────────────────────────┤
│  272px        │                                              │
│               │  Grade de painéis (scroll vertical)          │
│               │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

Raiz: `display:flex; flex-direction:column; height:100vh; overflow:hidden`.
Corpo: `flex:1; display:flex; min-height:0`.

### Barra de título — 38px, fixa
Área arrastável (`-webkit-app-region: drag`; botões precisam de `no-drag`).
Contém: marca + versão, menus (Arquivo/Editar/Ver/Janela), **gatilho de busca** alinhado
à direita (`flex: 0 1 240px`), alternador de tema, controles de janela.

### Sidebar — 272px, largura fixa
`flex: 0 0 272px; min-width: 0; overflow-x: hidden`. De cima para baixo:

1. **Placar** — contagem de sessões vivas, uso de CPU, barra segmentada de carga (14 segmentos).
2. **Fila de atenção** — só existe quando há sessões esperando.
3. **Projetos** — com worktrees aninhadas.
4. **Sessões** — todas, na ordem da grade.
5. **Rodapé fixo** — Retomar todas · Hooks · Como usar (F1).

Só o bloco central (2–4) rola: `flex:1; overflow-y:auto; overflow-x:hidden; min-width:0`.

### Toolbar
Campo de feature com prefixo `feat/` (`flex: 0 1 280px; min-width: 208px`) ·
**Nova sessão** (primário) · **Painel avulso** · dica contextual (uma linha, com reticências,
`flex: 1 1 0; min-width: 0`) · à direita, ordenação (Urgência/Projeto) e densidade (1/2/3).

### Grade
```css
display: grid;
grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
gap: 12px;
align-content: start;
```

| Densidade | Colunas | Altura do painel | Rótulo de status no cabeçalho |
|---|---|---|---|
| 1 | 1 | 460px | visível |
| 2 (padrão) | 2 | 320px | visível |
| 3 | 3 | 268px | oculto (bolinha assume) |

Altura fixa por densidade é intencional: a grade fica previsível e o scroll do terminal
acontece dentro do painel, não na página.

## Regras de compressão (janelas estreitas)

Aprendidas na validação — respeite ao portar:

1. **Todo container flex que contém texto recebe `min-width: 0`**, senão o filho força
   overflow horizontal.
2. **O nome da sessão nunca encolhe** (`flex: 0 0 auto; white-space: nowrap`). A compressão
   é absorvida, nesta ordem, por: rótulo de status → pill de projeto → dica da toolbar.
3. **Ações do painel são inegociáveis**: o grupo porta/ligar/fechar é `flex: 0 0 auto`.
   O botão fechar sempre alcançável.
4. Textos secundários usam `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`.
5. Nenhum scroll horizontal em lugar nenhum.

Larguras de referência: **1440px** (design), **1100px** (confortável),
**924px** (mínimo validado). Abaixo de ~1000px, prefira densidade 1 ou 2.
