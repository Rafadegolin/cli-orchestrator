<img src="recursos/icone.png" width="72" align="left" alt="">

# Orquestrador de CLIs

**Várias sessões do Claude Code ao mesmo tempo, numa grade, ordenadas por quem está te esperando.**

<br clear="left">

![Quatro sessões na grade: uma pedindo permissão, uma trabalhando, uma pronta para revisar e um terminal](recursos/tela.png)

## O que ele resolve

Três coisas que nenhuma ferramenta entrega juntas:

- **Ver todos os terminais ao mesmo tempo**, numa grade — não uma sessão por vez com lista lateral.
- **Saber na hora qual sessão parou te esperando**, e há quanto tempo. A bolinha fica amarela sozinha,
  em menos de 100ms, mesmo com o painel fora da tela.
- **Misturar projetos diferentes no mesmo painel**, ordenados por urgência e não por repositório.

Cada sessão roda no seu próprio worktree, com sua própria faixa de portas. Duas features do mesmo
projeto não brigam pelos arquivos nem pela porta 3000.

---

## Instalar

### Windows

Na [página de releases](https://github.com/Rafadegolin/cli-orchestrator/releases/latest) há mais de um
arquivo, e **qual baixar depende do Controle Inteligente de Aplicativos (SAC)** — o recurso do
Windows 11 que bloqueia programa sem assinatura de uma CA reconhecida. Este app não é assinado.

| Se o SAC estiver... | Baixe | Como abrir |
|---|---|---|
| **ligado** | `Orquestrador-X.Y.Z-**sac**.zip` | Extraia e rode **`Orquestrador.cmd`** |
| desligado | `...-instalador.exe` | Um clique, com atalho no menu Iniciar e auto-atualização |

Para saber qual é o seu caso: **Segurança do Windows → Controle de aplicativo e navegador → Controle
inteligente de aplicativos**.

> **Por que existe um pacote só para isso.** Com o SAC ligado, o instalador e o zip portátil são os
> dois bloqueados — e não há conserto pelo lado do arquivo: desbloquear não adianta, e **nem
> compilar na sua própria máquina** (medido: o binário sai novo no mundo, e é a identidade dele que
> o SAC julga). O pacote `-sac` roda sobre o `electron.exe` **original**, que o Windows já conhece.
> Em troca, o processo aparece como `electron.exe`. Detalhes e as medições em
> [docs/instalacao-e-assinatura.md](docs/instalacao-e-assinatura.md).

Nesse pacote, para ter atalho no menu Iniciar — e o ícone certo ao **fixar na barra de tarefas** —
abra o app e use **Ctrl+K → Criar atalho no menu Iniciar**, e fixe a partir dele. Fixando o
executável direto, o Windows tira o ícone do próprio `electron.exe`.

### macOS (Apple Silicon)

Baixe o `Orquestrador-X.Y.Z-mac-arm64.zip`, extraia, e na **primeira** abertura clique no app com o
**botão direito → Abrir**, confirmando na caixa que aparece. Depois disso ele abre com duplo clique
como qualquer outro.

> Esse passo existe porque o app não é assinado, e o Gatekeeper recusa o duplo clique nesse caso.
> Diferente do SAC do Windows, aqui **existe saída** — é uma vez por máquina. Quem preferir a linha
> de comando: `xattr -dr com.apple.quarantine /caminho/Orquestrador.app`.

Duas coisas funcionam diferente ali, e o app avisa em cada uma: a **atualização** é baixada pelo
site em vez de aplicada sozinha, e o **medidor de uso** lê a credencial do Chaveiro, pedindo
autorização na primeira vez. O resto — hooks, worktrees, portas, ligações — é igual.

Na primeira vez, **F1** (ou **⌘+/** no Mac) abre o manual completo dentro do próprio app, e lá há
uma seção só sobre o que muda no macOS.

Requisitos: Windows 10/11 ou macOS em Apple Silicon, e o [Claude Code](https://claude.com/claude-code)
instalado e autenticado. Nenhum dos pacotes precisa de Node — ele só é necessário para rodar do
código-fonte.

### Ligue os hooks na primeira vez

No rodapé da barra lateral há o interruptor **Hooks**. Ligá-lo registra no seu
`~/.claude/settings.json` os avisos que fazem as bolinhas mudarem sozinhas.

O app pergunta antes, faz backup do arquivo e preserva o que já estiver lá. Sem os hooks o app
funciona, mas os status ficam parados — e é justamente o status que faz a grade valer a pena.

---

## Usando

**Cadastre um projeto.** No `+` da seção PROJETOS, aponte a pasta do repositório e escolha a faixa de
portas dele. Fica salvo, e vale também para os worktrees desse projeto.

**Ache tudo com `Ctrl+K`.** A paleta de comandos pula para qualquer sessão, abre uma nova em qualquer
projeto, troca o tema e abre a ajuda — sem procurar na tela. A busca ignora acento.

**Abra uma sessão.** Digite o nome no campo de cima e clique no projeto. A dica ao lado mostra
exatamente o que vai ser criado — o worktree e o branch — antes de você clicar. Sem nome, abre
`claude` direto na pasta do projeto, sem worktree.

**Retome o trabalho de ontem.** A seta ao lado do projeto lista os worktrees existentes. Um clique
abre o painel dentro dele continuando a última conversa. A etiqueta diz o que impede arquivar cada
um — `aberto agora`, `2 alterados`, `1 commit` — e o `×` arquiva os que estão limpos, removendo pasta
e branch.

**Ligue sessões de repositórios diferentes.** Uma feature que mexe no backend e no frontend ao mesmo
tempo: o botão `ligar` no cabeçalho do painel dá a cada sessão acesso ao código da outra. Elas param
de reexplicar o contrato da API uma para a outra.

**Ou implemente nos dois de uma vez.** **Implementação dupla** vai um passo além de ligar: escolha
dois projetos e dê a **cada um** o nome do branch dele — o backend vai para `worktree-api-pix` e o
frontend para `worktree-issue-42`, uma issue por repositório — e o app cria as duas worktrees e abre
**uma** sessão que enxerga as duas. O Claude lê e escreve nos dois lados na mesma conversa — sem
handoff, sem abrir um terminal fora do app. Worktree que já existe é reaproveitada, e o diálogo
mostra o nome real do branch antes de você confirmar.

**Copie do terminal.** `Ctrl+C` copia quando há texto selecionado e continua interrompendo quando não
há; `Ctrl+Shift+C` copia sempre, `Ctrl+Shift+V` cola, e o botão direito abre Copiar / Colar /
Selecionar tudo.

**Atenda a fila.** `Ctrl+Enter` pula direto para a sessão que está esperando há mais tempo e põe o
cursor lá. Quando o app não está em primeiro plano, você recebe notificação do sistema.

**Aprove sem entrar no terminal.** Quando o Claude pede permissão, a pergunta aparece no rodapé do
painel com os botões **Aprovar** e **Ver**. Aprovar responde "1. Yes" ao pedido que está na tela —
nunca "não perguntar mais", e nunca às cegas: se o app não achar o pedido no terminal, ele não
escreve nada e leva você até lá.

**Feche sem medo.** O arranjo é salvo. Ao reabrir, os painéis voltam adormecidos com um botão de
retomar — e um "Retomar todas" na lateral.

### Ajuda dentro do app

**F1** (ou **⌘+/** no Mac), ou o botão **Como usar** no rodapé da lateral. É o manual completo — cada
recurso, os atalhos, as portas, os hooks e uma seção de problemas comuns com sintoma e causa.

Os números que ela cita (portas, limites, caminho da pasta de dados) são lidos do app em execução, não
copiados à mão, então não envelhecem quando o código muda.

### Portas

Cada painel recebe **5 portas livres** a partir da 3100, exportadas como `PORT`, `ORQ_PORTA` e
`ORQ_PORTAS`. A porta aparece no cabeçalho do painel.

Para o seu projeto usá-las, ele precisa ler a variável:

| Stack | O que fazer |
|---|---|
| Next | `next dev` já respeita `PORT`. Se houver `-p 3001` fixo no script, ele vence a variável e precisa sair. |
| Vite | Ignora `PORT`. Use `vite --port %PORT%`, ou `server: { port: Number(process.env.PORT) \|\| 5173 }`. |
| Nest / Express | Garanta `app.listen(process.env.PORT ?? 3000)`. |
| Turborepo | Cada app pega uma posição de `ORQ_PORTAS`. |

### Arquivos que o worktree não leva

Um worktree é um checkout limpo: o `.env` não vai junto, e sem ele a aplicação não sobe. Quando o app
detecta essa situação, oferece criar um `.worktreeinclude` listando o que copiar.

---

## Atualizar

O app avisa quando sai versão nova, e o botão na lateral **aplica e reinicia** — inclusive nos
pacotes em zip, que não têm instalador. Ali ele baixa só o próprio código (~4 MB, não os 142 do
pacote), confere o SHA-256 e troca ao reiniciar. Você não precisa voltar ao GitHub.

A exceção é quando a versão nova muda algo além do nosso código — o Electron, por exemplo. Aí a troca
leve não serve, e o botão leva à página da release dizendo por quê.

Seus dados não ficam na pasta do app: projetos, sessão e configuração moram em `~/.orquestrador`, e
não se perdem ao substituir a pasta.

---

## Desenvolvimento

```bash
npm install
npx install-electron        # o Electron 43 nao baixa o binario sozinho
npm start                   # roda o app
npm run dev                 # roda com a porta de depuracao, para os testes
npm run empacotar           # gera instalador e zip portatil em dist/ (Windows)
npm run empacotar:sac       # o pacote que abre com o Smart App Control ligado
npm run empacotar:mac       # zip arm64 em dist/ (roda no proprio Mac)
```

Os testes dirigem o app de fora via CDP, sem instrumentar o código de produção. Suba com
`npm run dev` antes de rodar qualquer um — e **uma instância por vez**.

No macOS rodam `fase1`, `fase45`, `fase6`, `portas`, `worktrees`, `ajuda`, `terminal` e `arvore`. Os
demais medem CPU/RAM por WMI ou testam SAC e assinatura do Windows, e não têm correspondente lá.

```bash
npm run teste:fase1         # PTY, lote de IPC, resize, enxurrada
npm run teste:fase2         # grade, orcamento de WebGL, RAM e CPU
npm run teste:fase45        # hooks, bolinhas, ordenacao por urgencia
npm run teste:fase6         # painel fora da tela, fila de partida
npm run teste:fase7         # sessao salva, painel dormindo, retomar
npm run teste:projetos      # cadastro e comando inicial
npm run teste:terminal      # abrir terminal do projeto, sem o Claude
npm run teste:portas        # dois servidores no ar ao mesmo tempo
npm run teste:worktrees     # listar, recusar e arquivar
npm run teste:ajuda         # a ajuda, e se os numeros dela batem com o codigo
npm run teste:ligacoes      # mecanica das ligacoes
npm run teste:sac           # o pacote -sac abre e o terminal funciona
npm run diagnostico         # por que o Windows bloqueou o instalador
npm run perfil              # CPU e RAM por processo
```

- [`docs/orquestrador-clis-documentacao.md`](docs/orquestrador-clis-documentacao.md) — a
  especificação de construção, com as metas de performance e o raciocínio de cada decisão.
- [`docs/fase-9-extras.md`](docs/fase-9-extras.md) — o que ainda pode ser feito.
- [`docs/instalacao-e-assinatura.md`](docs/instalacao-e-assinatura.md) — o bloqueio do Windows,
  por que acontece e as opções.
- [`CLAUDE.md`](CLAUDE.md) — invariantes e armadilhas para quem for mexer no código.
