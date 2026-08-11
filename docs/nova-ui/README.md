# Orquestrador — Documentação da nova UI

Documentação de referência para implementar o redesenho da interface do Orquestrador
(app Electron de orquestração de CLIs do Claude Code).

Protótipo interativo de referência: `Orquestrador.dc.html` (raiz do projeto).
Tudo que está descrito aqui existe e funciona no protótipo — quando houver dúvida,
o protótipo é a fonte da verdade visual.

## Índice

| Documento | Conteúdo |
|---|---|
| [01-principios.md](01-principios.md) | Conceito do redesenho, decisões de produto e o que mudou |
| [02-tokens.md](02-tokens.md) | Cores, tipografia, espaçamento, raios, sombras, animações |
| [03-layout.md](03-layout.md) | Estrutura da janela, grid de painéis, densidades, responsividade |
| [04-componentes.md](04-componentes.md) | Especificação de cada componente da interface |
| [05-estados.md](05-estados.md) | Máquina de status das sessões e estados de tela |
| [06-interacoes.md](06-interacoes.md) | Fluxos, atalhos de teclado, feedback e microinterações |
| [07-conteudo.md](07-conteudo.md) | Tom de voz, textos da UI e conteúdo da ajuda |
| [08-implementacao.md](08-implementacao.md) | Modelo de dados, contratos e ordem sugerida de entrega |

## Resumo em uma frase

A tela deixa de ser "uma grade de terminais" e passa a ser **um painel de controle de atenção**:
o app responde, sem você procurar, à pergunta *"para onde eu olho agora?"*.
