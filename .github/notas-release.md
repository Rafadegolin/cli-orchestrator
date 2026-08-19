## Windows

**Qual baixar depende do Controle Inteligente de Aplicativos (SAC).**

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

## macOS (Apple Silicon)

Baixe o `Orquestrador-*-mac-arm64.zip`, extraia, e na **primeira** abertura clique no app com o
**botão direito → Abrir**, confirmando na caixa. Depois disso ele abre com duplo clique.

Esse passo existe porque o app não é assinado — mas aqui, diferente do SAC, **existe saída**, e é
uma vez por máquina. Pela linha de comando: `xattr -dr com.apple.quarantine Orquestrador.app`.

Duas coisas funcionam diferente, e o app avisa em cada uma: a atualização é baixada pelo site em
vez de aplicada sozinha, e o medidor de uso lê a credencial do Chaveiro, pedindo autorização na
primeira vez. Hooks, worktrees, portas e ligações são iguais. **⌘** no lugar do Ctrl, e a ajuda
abre por **⌘+/**.
