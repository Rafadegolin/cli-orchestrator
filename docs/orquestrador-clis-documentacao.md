# Orquestrador de CLIs — documentação de construção

App instalável no computador que mostra vários Claude Code rodando ao mesmo tempo, cada um identificado pela feature, em projetos iguais ou diferentes.

---

## 1. O problema que o app resolve

Três coisas que nenhuma ferramenta atual entrega juntas:

1. **Ver todos os terminais ao mesmo tempo**, numa grade, não uma sessão por vez com lista lateral.
2. **Saber na hora qual sessão parou te esperando** (pedindo permissão) e há quanto tempo.
3. **Misturar projetos diferentes no mesmo painel**, ordenados por status e não por repositório.

Tudo o mais — worktree isolado, diff, branch — já existe pronto e vamos apenas usar, não reconstruir.

---

## 2. Metas de performance

Fixe estes números antes de escrever a primeira linha. Eles decidem quase todas as escolhas técnicas do documento.

| O que | Meta | Como medir |
|---|---|---|
| Latência de tecla até aparecer na tela | abaixo de 16ms | gravação de tela a 120fps, ou `performance.now()` no keydown vs no render |
| Uso de CPU com 8 painéis parados | abaixo de 2% | Gerenciador de Tarefas, média de 60s |
| Uso de CPU com 4 painéis cuspindo log | abaixo de 25% | rodar `yes` em 4 painéis |
| RAM por painel aberto | abaixo de 40 MB | soma dos processos, dividido pelo nº de painéis |
| RAM total com 8 painéis | abaixo de 700 MB | idem |
| Tempo de abertura do app até o primeiro terminal | abaixo de 1,5s | cronômetro |
| Atraso entre o Claude pedir permissão e a bolinha ficar amarela | abaixo de 300ms | log com timestamp nos dois lados |

Se em qualquer fase você estourar uma dessas metas, pare e conserte antes de seguir. Performance não se conserta no final.

---

## 3. Decisões de stack

### Electron + xterm.js + node-pty

**Por que Electron e não Tauri:** os dois usam um navegador para desenhar a tela, então o custo de render é o mesmo. A diferença real é o processo Node por trás. O `node-pty` é a biblioteca madura para abrir terminais de verdade no Windows (via ConPTY) e ela é feita para Node. No Tauri você usaria `portable-pty` em Rust — funciona e gasta menos RAM base (uns 80 MB a menos), mas você vai gastar duas semanas a mais e reescrever a ponte de dados. **Comece no Electron.** Se depois de meses o app ficar essencial pra você, migrar o backend pra Rust é um projeto separado e bem delimitado.

**Por que xterm.js:** é o mesmo emulador de terminal que o VS Code usa. Suporta renderização por WebGL, que é o que segura as metas de CPU acima. Não existe alternativa séria.

### Versões e pacotes

```
electron
@xterm/xterm
@xterm/addon-webgl
@xterm/addon-canvas       (plano B quando faltar contexto WebGL)
@xterm/addon-fit
node-pty
electron-builder          (só na fase do instalador)
```

Confira as versões atuais na hora de instalar — o ecossistema muda rápido. O `xterm` mudou de nome para `@xterm/xterm`; pacotes chamados só `xterm` são a versão antiga.

### O que NÃO usar

- **Nada de React, Vue ou framework de UI nos painéis de terminal.** O xterm.js já controla o DOM dele. Um framework por cima só adiciona re-render inútil. Se quiser framework, use só na barra lateral, e mesmo assim é dispensável — a barra tem 10 elementos.
- **Nada de biblioteca de layout de grade.** CSS Grid resolve.
- **Nada de banco de dados.** Um arquivo JSON com o estado das sessões basta.

---

## 4. Arquitetura em uma página

```
┌─────────────────────────────────────────────────────────────┐
│ PROCESSO PRINCIPAL (Node)                                   │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐   │
│  │ Gerenciador  │   │ Servidor de  │   │ Estado das     │   │
│  │ de terminais │   │ eventos      │   │ sessões        │   │
│  │ (node-pty)   │   │ (HTTP local) │   │ (memória+JSON) │   │
│  └──────┬───────┘   └──────▲───────┘   └────────────────┘   │
│         │ bytes            │ POST                           │
└─────────┼──────────────────┼────────────────────────────────┘
          │ IPC em lote      │
          ▼                  │
┌──────────────────┐    ┌────┴─────────────────────────────┐
│ JANELA (1 só)    │    │ Claude Code rodando nos worktrees│
│ grade de xterm   │    │ dispara hooks a cada evento      │
│ + barra lateral  │    └──────────────────────────────────┘
└──────────────────┘
```

Dois canais de informação, e é importante entender que são separados:

- **Canal 1 (bytes do terminal):** o que você vê escrito na tela. Vem do `node-pty`, é volumoso, precisa ser rápido.
- **Canal 2 (eventos de status):** a bolinha colorida. Vem dos hooks do Claude Code via HTTP, é leve e raro.

Nunca tente extrair status lendo os bytes do canal 1. É frágil e quebra a cada atualização do Claude Code. O canal 2 existe exatamente para isso.

---

## 5. Estrutura de pastas

```
orquestrador/
  package.json
  src/
    main/
      index.js            arranque, janela, ciclo de vida
      terminais.js        cria, mata e alimenta os PTYs
      eventos.js          servidor HTTP que recebe os hooks
      estado.js           quem está rodando, esperando, pronto
      worktrees.js        cria e remove worktree via git
      instalar-hooks.js   escreve os hooks no settings.json do Claude
    preload/
      ponte.js            expõe só o necessário para a janela
    janela/
      index.html
      grade.js            monta e destrói painéis de terminal
      painel.js           um painel: xterm + cabeçalho
      lateral.js          a barra de status
      estilo.css
  recursos/
    icone.ico
```

---

## 6. Fase 0 — preparar a máquina

**Objetivo:** ter tudo instalado antes de perder tempo com erro de compilação.

**Passos:**

1. Node LTS instalado.
2. `npm init` e instalar Electron.
3. Instalar `node-pty`. **Esta é a única parte que costuma dar problema no Windows.** Ele tem código nativo e pode tentar compilar. Se cair na compilação, instale as ferramentas de build do Visual Studio (workload "Desktop development with C++") — ou, melhor, use uma versão que já venha com binário pronto para a sua versão de Electron.
4. Rodar `electron-rebuild` depois de instalar o `node-pty`. Módulos nativos precisam ser recompilados contra a versão do Node que vem dentro do Electron, não contra o seu Node do sistema. **Este é o erro nº 1 de quem faz app de terminal e não sabe por que "o módulo não abre".**

**Pronto quando:** `npm start` abre uma janela em branco e um `require('node-pty')` no processo principal não estoura erro.

---

## 7. Fase 1 — uma janela com um terminal de verdade

**Objetivo:** um painel só, mas funcionando de verdade — você digita, o shell responde, o redimensionamento funciona.

**Entregar:**

- Janela Electron com `contextIsolation: true` e um preload.
- Um `xterm.js` ocupando a tela.
- Um `node-pty` rodando o seu shell.
- Digitação indo da tela para o PTY, e bytes do PTY voltando para a tela.

**O laço básico:**

```js
// main/terminais.js
const pty = require('node-pty');

function abrir(id, cwd, comando, args, janela) {
  const p = pty.spawn(comando, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env, ORQ_ID: id },
  });

  p.onData((dados) => enfileirar(id, dados, janela));
  p.onExit(({ exitCode }) => janela.webContents.send('terminal:fim', { id, exitCode }));
  return p;
}
```

**Já nesta fase, o detalhe que decide a performance do app inteiro:** não mande cada pedacinho de dado para a janela na hora que ele chega. Um comando que cospe log dispara centenas de eventos por segundo, e cada envio pelo IPC tem custo fixo. Junte tudo e mande uma vez por quadro de vídeo:

```js
// main/terminais.js
const filas = new Map();
let agendado = false;

function enfileirar(id, dados, janela) {
  if (!filas.has(id)) filas.set(id, []);
  const fila = filas.get(id);
  fila.push(dados);

  // se um processo enlouquecer, joga fora o histórico antigo
  // e mantém só o fim, que é o que o usuário vai ver
  if (fila.length > 400) fila.splice(0, fila.length - 200);

  if (!agendado) {
    agendado = true;
    setTimeout(() => {
      agendado = false;
      const lote = [];
      for (const [tid, pedacos] of filas) {
        if (pedacos.length) lote.push({ id: tid, texto: pedacos.join('') });
        pedacos.length = 0;
      }
      if (lote.length) janela.webContents.send('terminal:dados', lote);
    }, 16);
  }
}
```

Um `setTimeout` de 16ms, um envio por quadro, todos os painéis no mesmo lote. Isso sozinho é a diferença entre 60% e 15% de CPU com quatro terminais ativos.

**Armadilhas:**

- **Redimensionar é caro.** Cada mudança de tamanho reflui o buffer inteiro do terminal. Aplique um atraso de uns 100ms depois que o usuário para de arrastar, e só então chame `fit()` e `pty.resize()`.
- **Windows quebra a linha diferente.** Se o texto sair duplicando linha ou embolando, confira se está usando `xterm-256color` e ConPTY (o `node-pty` moderno usa por padrão).

**Pronto quando:** você digita `dir`, vê a saída, redimensiona a janela e o texto reflui certo. Meta de latência de tecla já vale aqui.

---

## 8. Fase 2 — vários terminais na grade

**Objetivo:** N painéis na mesma janela, cada um com seu PTY, cada um com um cabeçalho identificando a feature.

**Entregar:**

- CSS Grid com layout automático (2 colunas até 4 painéis, 3 colunas acima disso).
- Cabeçalho por painel: bolinha de status, nome da feature, nome do branch/worktree.
- Botão de fechar painel que mata o PTY de verdade.
- Clique no painel dá foco ao terminal (e só o painel focado recebe teclado).

**Uma janela só, nunca uma por painel.** Cada `BrowserWindow` do Electron é um processo de renderização separado com uns 60 MB de custo fixo. Oito janelas destroem sua meta de RAM. Oito instâncias de xterm dentro de uma janela custam uma fração disso.

**A pegadinha do WebGL:** o navegador limita o número de contextos WebGL vivos ao mesmo tempo (na prática, algo em torno de 16 — e quando estoura, ele **mata o contexto mais antigo sem avisar**, e um painel seu fica preto). Como você quer suportar muitos painéis, a regra é:

- Painel visível e focado → renderizador WebGL.
- Painel visível mas sem foco → WebGL também, até o limite que você definir (sugestão: 8).
- Acima disso, ou painel fora da tela → renderizador de canvas.

Guarde um contador de contextos ativos no lado da janela e escute o evento de perda de contexto do addon WebGL para cair pro canvas automaticamente.

**Armadilhas:**

- Não crie e destrua instâncias de xterm quando o usuário troca de aba ou rola a lista. Criar é caro. Esconda com `visibility` e mantenha viva, ou use um pool de instâncias reaproveitadas.
- Limite o histórico de rolagem: `scrollback: 3000` por painel. O padrão é 1000, e gente costuma aumentar para 100.000 sem pensar — isso são dezenas de MB por painel.

**Pronto quando:** 8 painéis abertos com um shell em cada, e o app está dentro da meta de RAM e de CPU parado.

---

## 9. Fase 3 — worktrees e sessões do Claude

**Objetivo:** cada painel deixa de rodar um shell qualquer e passa a rodar uma sessão do Claude Code isolada.

**Entregar:**

- Botão "nova sessão": você escolhe o projeto e digita o nome da feature.
- O app roda `claude --worktree nome-da-feature` dentro da pasta do projeto.
- Lista dos worktrees existentes de cada projeto, para retomar trabalho de ontem.
- Botão de arquivar: remove o worktree e o branch quando a feature acabou.

**Deixe o Claude Code criar o worktree.** Você poderia chamar `git worktree add` na mão, mas a flag `--worktree` já cuida do nome do branch, da pasta, da limpeza automática quando não houve mudança, e de reabrir um worktree existente se você passar um nome que já existe. Menos código seu, menos bug seu.

**O arquivo que salva sua vida:** crie um `.worktreeinclude` na raiz de cada projeto listando os arquivos ignorados pelo git que precisam ser copiados para cada worktree novo — tipicamente `.env`, `.env.local`, arquivos de configuração local. Sem isso, o worktree é um checkout limpo e a sua aplicação simplesmente não sobe lá dentro. Só arquivos que estão no `.gitignore` são copiados; arquivos versionados nunca são duplicados.

**O custo de disco que ninguém avisa:** cada worktree é uma pasta de trabalho completa. Se o projeto tem `node_modules` de 800 MB, seis worktrees são 4,8 GB. Duas saídas:

1. Usar `pnpm`, que guarda os pacotes num repositório central e liga por atalho — os worktrees passam a custar quase nada.
2. Ter um script de preparação que roda ao criar o worktree e instala só o necessário.

**A regra de ouro do isolamento:** portas. Duas features rodando `npm run dev` na porta 3000 brigam. Faça o app atribuir uma porta por painel e exportar como variável de ambiente na criação do PTY, e deixe o projeto ler dela.

**Pronto quando:** você abre três sessões do Claude em três features do mesmo projeto, elas editam arquivos ao mesmo tempo, e nenhuma enxerga o arquivo da outra.

---

## 10. Fase 4 — servidor de eventos

**Objetivo:** a bolinha de status muda sozinha, sem ler nada do terminal.

**Como funciona:** o Claude Code dispara hooks em eventos do ciclo de vida. O app sobe um servidor HTTP local, registra os hooks apontando para ele, e recebe cada evento como um POST com um JSON no corpo — contendo o identificador da sessão, a pasta de trabalho e o tipo do evento.

**Os eventos que interessam e o que fazer com cada um:**

| Evento do Claude | Filtro | Vira o status |
|---|---|---|
| `Notification` | `permission_prompt` | 🟡 esperando você (liga o cronômetro) |
| `Notification` | `idle_prompt` | 🟡 parado há 60s |
| `UserPromptSubmit` | — | 🟢 rodando (desliga o amarelo) |
| `PostToolUse` | — | 🟢 rodando (batimento de vida) |
| `Stop` | — | 🔵 terminou, pronto para revisar |
| `SessionStart` | — | 🟢 sessão viva |
| `SessionEnd` | — | ⚪ encerrada |
| `WorktreeCreate` | — | cria o card sozinho |
| `WorktreeRemove` | — | some com o card sozinho |

**O que registrar no `~/.claude/settings.json`:**

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt|idle_prompt",
        "hooks": [{ "type": "command", "command": "orq-aviso", "timeout": 3 }]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "orq-aviso", "timeout": 3 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "orq-aviso", "timeout": 3 }] }
    ]
  }
}
```

O `orq-aviso` é um executável mínimo que o seu app instala: lê o JSON da entrada padrão, faz um POST para `http://127.0.0.1:PORTA/evento`, e sai. Escreva em Go ou Rust e compile — um script Node aqui custa 80ms de arranque do interpretador **por evento**, e o hook tem tempo limitado para responder.

**Regras não negociáveis do servidor de eventos:**

1. **Responda 200 na primeira linha do handler**, antes de processar qualquer coisa. Se o seu servidor demorar, o hook estoura o tempo limite e o Claude Code do usuário fica travado. Você nunca deve deixar seu app atrapalhar a sessão de trabalho.
2. **Escute só em `127.0.0.1`**, nunca em `0.0.0.0`. É um servidor sem autenticação na máquina do usuário.
3. **Porta fixa, gravada num arquivo conhecido.** O executável do hook precisa saber para onde mandar. Grave a porta em `~/.orquestrador/porta` no arranque.
4. **Se o app estiver fechado, o hook falha em silêncio e segue a vida.** Isso é obrigatório: o Claude Code do usuário não pode quebrar porque o orquestrador não está aberto.

**A chave de ligação entre evento e painel é a pasta (`cwd`).** Cada sessão roda num worktree diferente, então a pasta identifica o painel sem ambiguidade. É mais confiável que o identificador de sessão, porque este muda quando a pessoa reinicia a sessão no mesmo worktree.

**Pronto quando:** você aciona um pedido de permissão de propósito numa sessão e a bolinha fica amarela em menos de 300ms, mesmo com aquele painel fora da tela.

---

## 11. Fase 5 — painel de status

**Objetivo:** a resposta para "onde eu preciso olhar agora?" em menos de um segundo, sem procurar.

**Entregar:**

- Barra lateral com todas as sessões de todos os projetos.
- **Ordenação por urgência, não por projeto:** primeiro quem está esperando você há mais tempo, depois quem terminou e precisa de revisão, depois quem está rodando, por último quem está parado.
- Agrupamento por projeto como opção secundária, desligada por padrão.
- Cronômetro no card amarelo: "esperando há 4min".
- Clicar no card leva o foco para o painel correspondente.
- Notificação do sistema quando alguém entra em amarelo e o app não está em primeiro plano.

**O toque que faz o app valer a pena:** um atalho de teclado tipo `Ctrl+Enter` que pula direto para a sessão que está esperando há mais tempo e já coloca o cursor lá. Você deixa de caçar e passa a atender uma fila.

**Cuidado com o cronômetro:** não crie um `setInterval` por card. Um único intervalo de 1 segundo atualiza todos os textos. Dez intervalos independentes acordam a CPU dez vezes por segundo à toa e derrubam sua meta de consumo parado.

**Pronto quando:** com 8 sessões abertas e a janela minimizada, você recebe a notificação, aperta o atalho e cai direto no terminal certo.

---

## 12. Fase 6 — deixar rápido de verdade

Até aqui você tem um app funcional. Esta fase é sobre segurar as metas da seção 2 sob carga real.

**6.1 — Painéis fora da tela não desenham.** Quando um painel sai da área visível, pare de escrever nele. Acumule os bytes num buffer circular no lado da janela (guarde só os últimos ~200 KB, o resto o usuário não vai ler mesmo) e escreva tudo de uma vez quando ele voltar a aparecer. Use `IntersectionObserver` para detectar. Ganho típico: metade da CPU numa grade grande.

**6.2 — Cuidado com processo despejando log.** Se um painel receber mais de alguns MB por segundo, você não tem obrigação de renderizar tudo. Descarte o meio e mantenha o fim, exatamente como o corte de fila da Fase 1 faz. Ninguém lê 40.000 linhas passando voando.

**6.3 — Mande bytes, não texto decodificado.** Decodificar UTF-8 no processo principal, serializar como string no IPC e re-decodificar na janela é trabalho triplicado. Mande `Uint8Array` e deixe o xterm.js decodificar — ele tem uma rota otimizada para isso.

**6.4 — Mande diffs de estado, não o estado inteiro.** Quando uma sessão muda de status, mande `{ id, status }`, não a lista completa de sessões. Parece bobo com 8 sessões, mas é o que impede a barra lateral de re-renderizar inteira várias vezes por segundo.

**6.5 — Limite quantas sessões podem rodar de verdade ao mesmo tempo.** Seis Claude Code rodando testes em paralelo saturam qualquer máquina, e aí tudo fica lento — inclusive o seu app, que leva a culpa. Coloque um teto configurável (comece em 4) e uma fila para o resto.

**6.6 — Meça, não adivinhe.** Ligue o `--trace-warnings` e o profiler do Chrome DevTools numa sessão de carga real: 4 painéis com build rodando. Se algo estiver fora da meta, o gargalo vai estar em um destes três lugares, nesta ordem de probabilidade: envio de IPC sem lote, renderizador em canvas onde devia ser WebGL, ou re-render da barra lateral.

**Pronto quando:** todas as metas da seção 2 passam num teste de 30 minutos com uso real.

---

## 13. Fase 7 — sobreviver ao fechar e reabrir

**Objetivo:** fechar o app não perde o seu trabalho.

**Entregar:**

- Salvar em JSON: projetos cadastrados, worktrees abertos, nome dado a cada feature, layout da grade.
- Ao reabrir, reconstruir os painéis e oferecer "retomar" em cada um.
- Restaurar não deve religar tudo sozinho — abra os painéis vazios com um botão de retomar. Ligar seis sessões do Claude de uma vez no arranque é hostil e caro.

**O que NÃO tentar:** manter os processos vivos com o app fechado. Isso vira um serviço em segundo plano, com uma classe inteira de problemas nova (processos órfãos, sessão zumbi comendo CPU, atualização quebrando estado). Se quiser isso um dia, é outro projeto.

**Pronto quando:** você fecha com 5 painéis, reabre, e em dois cliques está de volta ao mesmo lugar.

---

## 14. Fase 8 — instalador

**Objetivo:** virar um app instalável de verdade, não um `npm start`.

**Entregar:**

- `electron-builder` gerando instalador para Windows.
- Ícone, nome, atalho no menu iniciar.
- Instalação automática do executável do hook e registro no `settings.json` do Claude na primeira execução — **sempre perguntando antes**, porque você está editando um arquivo de configuração que é do usuário, não seu.
- Ao desinstalar, remover os hooks que você registrou.

**Armadilhas:**

- Módulo nativo (`node-pty`) precisa ir empacotado corretamente. Configure `asarUnpack` para ele, senão o app instalado não abre terminal nenhum enquanto na sua máquina de desenvolvimento funciona perfeitamente.
- Sem assinatura de código, o Windows vai mostrar aviso de aplicativo desconhecido. Para uso pessoal, tudo bem. Para distribuir, precisa de certificado pago.

**Pronto quando:** você instala numa máquina limpa e funciona sem ter Node instalado.

---

## 15. Fase 9 — extras que valem a pena depois

Em ordem de retorno pelo esforço:

1. **Ver o diff de uma sessão sem sair do app.** `git diff` do worktree contra a base, renderizado ao lado. É o que fecha o ciclo de revisão.
2. **Aprovar permissão pelo próprio painel de status.** Sem trocar de painel, um botão que digita "sim" no PTY certo.
3. **Layouts salvos.** "Modo revisão" com 2 painéis grandes, "modo tocaia" com 8 pequenos.
4. **Colar prompt em várias sessões de uma vez.** Útil para "roda o lint e conserta" em três features.
5. **Histórico de tempo por feature.** Quanto tempo cada uma levou, quantas vezes te interrompeu.

---

## 16. Armadilhas conhecidas, resumidas

| Armadilha | Sintoma | Solução |
|---|---|---|
| Não rodou `electron-rebuild` | Módulo nativo não carrega | Rebuild contra a versão do Electron |
| IPC sem lote | CPU alta com log correndo | Junte e mande uma vez por quadro |
| Uma janela por painel | RAM estourada | Uma janela, N instâncias de xterm |
| Estourar contextos WebGL | Painel fica preto do nada | Contador + queda para canvas |
| Scrollback enorme | RAM cresce sozinha | Teto de 3000 linhas |
| Faltou `.worktreeinclude` | App não sobe no worktree | Liste os `.env` |
| Portas em conflito | Segunda feature não sobe | Porta por painel via variável de ambiente |
| Hook lento | Sessão do Claude trava | Responda 200 na hora, execute depois |
| Hook em Node | 80ms perdidos por evento | Binário compilado |
| `setInterval` por card | CPU parada acima da meta | Um intervalo só para todos |

---

## 17. Ordem de ataque se o tempo apertar

O caminho mais curto até o app já ser útil:

1. **Fase 1** — um terminal funcionando com o envio em lote já feito.
2. **Fase 2** — a grade.
3. **Fase 4** — o servidor de eventos e as bolinhas.
4. **Fase 5** — a ordenação por urgência e o atalho de pular para quem está esperando.

Com essas quatro você já tem as três coisas que não existem em lugar nenhum. As fases 3, 6, 7 e 8 são o que transforma isso em algo que você usa por meses sem irritação — mas dá para adiar todas elas rodando `claude --worktree` na mão dentro do painel.

Estimativa honesta: um fim de semana até o fim da Fase 2, mais uma semana até o fim da Fase 5. As fases restantes, mais duas ou três semanas de trabalho não contínuo.
