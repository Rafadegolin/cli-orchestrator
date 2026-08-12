Windows. **Qual baixar depende do Controle Inteligente de Aplicativos (SAC).**

| Se o SAC estiver... | Baixe | Como abrir |
|---|---|---|
| **ligado** | `Orquestrador-*-sac.zip` | Extraia e rode `Orquestrador.cmd` |
| desligado | `Orquestrador-*-instalador.exe` | Um clique, com atalho e auto-atualização |

Para saber qual é o seu caso: **Segurança do Windows → Controle de aplicativo e navegador →
Controle inteligente de aplicativos**.

O app não é assinado. Com o SAC ligado, **o instalador e o zip portátil são os dois bloqueados**, e
não há conserto pelo lado do arquivo — nem desbloquear, nem compilar na própria máquina. O pacote
`-sac` roda sobre o `electron.exe` original, que o Windows já conhece; em troca, o processo aparece
como `electron.exe` e não há atalho no menu Iniciar.

As medições estão em [docs/instalacao-e-assinatura.md](https://github.com/Rafadegolin/cli-orchestrator/blob/main/docs/instalacao-e-assinatura.md).
