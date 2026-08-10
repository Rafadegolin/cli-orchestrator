# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que e

App Electron que mostra varias sessoes do Claude Code simultaneas numa grade, cada uma identificada
por feature, misturando projetos diferentes. Resolve tres coisas que nenhuma ferramenta entrega
juntas: ver todos os terminais ao mesmo tempo, saber na hora qual sessao parou pedindo permissao (e
ha quanto tempo), e ordenar por urgencia em vez de por repositorio.

`docs/orquestrador-clis-documentacao.md` e a especificacao de construcao (portugues, Fases 0 a 9) e
segue sendo a fonte do raciocinio por tras de cada regra. Este arquivo registra o que foi construido
e o que foi **medido** — onde os dois divergem, vale o que esta aqui.

**Estado:** **todas as fases da spec (0 a 8) implementadas**, mais o cadastro de projetos. O que
resta sao os extras da Fase 9, em ordem de retorno: ver o diff da sessao sem sair do app, aprovar
permissao pelo proprio card, layouts salvos, colar prompt em varias sessoes, historico de tempo por
feature.

## Comandos

```
npm start                 # roda o app
npm run dev               # roda com a porta de depuracao 9222, para os testes dirigirem
npm run teste:fase1       # 1 painel: PTY, lote de IPC, resize, enxurrada
npm run teste:fase2       # 8 painéis: grade, orcamento WebGL, RAM/CPU (leva ~90s)
npm run teste:fase45      # hooks -> bolinha -> lateral ordenada
npm run teste:projetos    # cadastro, dedupe, comando inicial, sanitizacao
npm run teste:portas      # blocos sem colisao e dois servidores no ar ao mesmo tempo
npm run teste:worktrees   # Node puro, sem app: listar, recusas e arquivar
npm run teste:worktrees-ui # a lista na lateral, retomar e arquivar pela tela
npm run teste:fase6       # grade rolavel, painel invisivel, fila de partida
npm run teste:fase7       # sessao salva, painel dormindo, retomar
npm run perfil            # CPU/RAM POR PROCESSO (use -Json para consumir em script)
npm run teste:metas       # latencia de tecla e CPU sob carga (leva ~90s)
node testes/arvore.js     # fechar painel mata a arvore de processos

npm run empacotar         # instalador em dist/, sem publicar
npm run teste:empacotado  # roda o app EMPACOTADO (nao precisa do npm run dev)
npm run teste:atualizacao # app empacotado antigo detecta e baixa a release nova
npm run icone             # regenera recursos/icone.ico
```

Publicar versao nova: `npm version patch` e depois `git push --follow-tags`. A tag `v*` dispara o
workflow, que empacota e publica a release.

Os testes dirigem o app **de fora** via CDP (`testes/cdp.js`), sem instrumentar o codigo de producao.
Suba o app com `npm run dev` antes de rodar qualquer `teste:*`. **Uma instancia por vez** — duas
brigam pela porta 9222 e pelo cache do perfil, e a segunda morre com erro de bind.

**Nao existe `electron-rebuild` aqui e nao adicione.** O `node-pty@1.1.0` distribui binario
**Node-API** pronto em `prebuilds/win32-x64`, e N-API e ABI-estavel entre Node e Electron. Rodar
`node-gyp` so quebraria: esta maquina nao tem as Build Tools do Visual Studio.

## Armadilhas de instalacao (todas ja pagas)

- **npm 11 bloqueia install scripts.** O `node-pty` fica sem preparar se nao for aprovado. O
  `package.json` tem `allowScripts: { "node-pty@1.1.0": true }`; se a versao mudar, rode
  `npm approve-scripts node-pty`.
- **Electron 43 nao tem mais `postinstall`.** O binario nao vem sozinho no `npm install` — rode
  `npx install-electron` (bin declarado pelo proprio pacote).
- **Versoes do xterm sao um conjunto casado, nao independentes.** `@xterm/xterm@5.5.0` +
  `@xterm/addon-webgl@0.18.0` (pinado sem `^`). O `addon-webgl@0.19.0` e compilado contra as
  internals do xterm 6 e estoura `Cannot read properties of undefined (reading '_isDisposed')` ao
  carregar — o painel cai para canvas em silencio. O peer `^5.0.0` do `addon-canvas` e metadado
  desatualizado (a propria beta dele ainda declara `^5`), nao sinal de incompatibilidade.

## Arquitetura: dois canais separados

Decisao estruturante. Nunca misture os dois.

- **Canal 1 — bytes do terminal.** `node-pty` (`src/main/terminais.js`) -> lote de IPC -> xterm.js
  (`src/janela/painel.js`). Volumoso e quente.
- **Canal 2 — eventos de status.** Hooks do Claude Code -> `curl` -> servidor HTTP local
  (`src/main/eventos.js`) -> `src/main/estado.js` -> **diffs** para a janela. Leve e raro.

**Nunca deduza status lendo os bytes do Canal 1.** E fragil e quebra a cada atualizacao do Claude
Code; o Canal 2 existe exatamente para isso.

Arquivos: `src/main/{index,terminais,eventos,estado,instalar-hooks,projetos}.js`,
`src/preload/ponte.js`, `src/janela/{index.html,painel,grade,lateral,projetos}.js`. Nomes de arquivo
e de funcao em portugues.

## Empacotamento e atualizacao

Instalador NSIS de um clique, por usuario (`%LOCALAPPDATA%`, sem UAC nem na instalacao nem nas
atualizacoes). Release publicada pelo GitHub Actions ao criar uma tag `v*`:
`npm version patch` seguido de `git push --follow-tags`.

- **`asarUnpack` do `node-pty` e a armadilha n1.** Modulo nativo dentro do asar nao carrega: a janela
  abre normalmente e **nenhum terminal funciona**, enquanto em desenvolvimento esta tudo perfeito.
  `testes/empacotado.js` existe para pegar exatamente isso.
- **`npmRebuild: false`.** Sem isso o electron-builder chama o `@electron/rebuild`, que cai no
  node-gyp e falha com `Could not find any Python installation to use`. Nao ha o que recompilar — o
  binario do `node-pty` e Node-API.
- **`verifyUpdateCodeSignature: false`.** O padrao e `true` e, sem certificado, rejeitaria toda
  atualizacao baixada. O preco de nao assinar e o aviso de "aplicativo desconhecido" do Windows.
- **A janela carrega o xterm por `<script src="../../node_modules/...">`**, caminho que no app
  empacotado resolve **dentro do asar**. Funciona, mas e frageis a mudancas em `files:` — se a janela
  subir em branco no instalador, e aqui.
- **O updater nunca reinicia sozinho.** Este app hospeda sessoes vivas; o download acontece em
  segundo plano, mas aplicar e decisao do usuario, e o dialogo diz quantos painéis serao fechados.
  `autoInstallOnAppQuit` cobre o caso tranquilo: fechou o app, aplica na saida.
- Erro de atualizacao **nunca** vira dialogo — sem internet ou GitHub fora do ar, so log.
- Desinstalar roda `--remover-hooks` pelo `recursos/instalador.nsh`. Sem isso os hooks ficariam no
  `settings.json` para sempre e toda sessao pagaria ~310ms por evento falando com um app que nao
  existe mais.

## Sobreviver ao fechar e reabrir (Fase 7)

`src/main/sessao.js` grava o arranjo em `~/.orquestrador/sessao.json` (feature, cwd,
`comandoInicial`, ordem). `src/main/arquivo.js` concentra a gravacao atomica (`.tmp` + `rename`) que
antes existia so no `projetos.js` — duplicar isso em dois lugares e o tipo de coisa que diverge em
silencio.

- **Nao guarda a saida dos terminais** (3000 linhas por painel), e **nao mantem processo vivo com o
  app fechado**. A spec e explicita: isso viraria servico em segundo plano, com processo orfao e
  sessao zumbi.
- **Painel restaurado volta dormindo**, com botao de retomar. Religar seis sessoes sozinho no
  arranque e caro e ninguem pediu. O botao "retomar todas" existe porque a fila da Fase 6 espaca as
  partidas.
- Quem sabe o arranjo e a **janela**, nao o processo principal: painel dormindo nao tem PTY e
  portanto nao aparece em `terminais`. O renderer manda um retrato a cada mudanca, com debounce de
  500ms, mais uma gravacao imediata no `beforeunload` (fechar dentro da janela do debounce perderia
  justo o arranjo que voce acabou de montar).
- **`restaurarSessao` roda no evento `load`, nao no carregamento do script.** `grade.js` e avaliado
  antes de `lateral.js`; restaurar direto deixava `window.OrqLateral` indefinido, os painéis
  restaurados nao entravam na lista de sessoes e o botao "retomar todas" nunca aparecia.
- Painel dormindo **nunca pega vaga de WebGL** — cinco painéis restaurados nao podem tomar as vagas
  dos que voce esta usando.
- Pasta que sumiu (worktree arquivado com o app fechado) volta como indisponivel, com "remover" no
  lugar de "retomar": abrir PTY ali so produz erro cru de spawn.

**Fechar com sessao rodando pede confirmacao**, dizendo quantas serao interrompidas. A trava
`fechamentoAutorizado` existe porque o `quitAndInstall` do updater tambem fecha a janela — sem ela,
aplicar atualizacao pediria confirmacao no meio do reinicio.

## Grade rolavel, painel invisivel e fila de partida (Fase 6)

- **A grade rola** (`grid-auto-rows: minmax(220px, 1fr)` + `overflow-y: auto`). Antes usava
  `overflow: hidden` com `1fr` puro, e 16 painéis viravam faixas de ~110px. E este e o pre-requisito
  do item 6.1: sem rolagem, **nenhum painel ficava fora da tela** e o `IntersectionObserver` nao
  teria o que observar.
- **Painel fora da vista nao desenha**: os bytes vao para um buffer de 200 KB e sao escritos de uma
  vez quando ele volta. O corte descarta **pedacos inteiros** do inicio, nunca por offset de byte --
  cortar no meio de um `Uint8Array` parte sequencia UTF-8. `painel.descartadosBytes` conta o que foi
  jogado fora, e e por ele que o teste prova que o corte aconteceu (inferir por numero de linha da
  falso negativo quando a enchente para antes de encher o buffer).
- **O orcamento de WebGL segue a visibilidade**, nao so o `ordemDeUso`. Com grade rolavel, um painel
  focado ha tres minutos e fora da vista seguraria uma vaga enquanto um painel que voce esta olhando
  desenha em canvas.

### O ganho real do 6.1 nesta maquina, medido

Com 8 painéis cuspindo log, metade rolada para fora:

| | todos a vista | metade fora |
|---|---|---|
| renderer | 0,34% | **0,16%** |
| principal | 13,83% | 12,23% |

O renderer de fato **cai pela metade**, como a spec promete. So que ele e 0,3% de uma maquina de 12
nucleos: o ganho absoluto e de ~0,2 ponto percentual. **O custo do app sob carga esta no processo
principal lendo o ConPTY, nao no desenho.** O valor do 6.1 aqui e memoria e escala (painel fora da
vista nao segura contexto WebGL nem cresce buffer), nao CPU. Nao vale "otimizar o render" de novo.

### Fila de partida (`src/janela/fila.js`)

Teto de 4 sessoes com bolinha verde; acima disso o comando fica retido e o painel mostra `na fila`.

- **Uma sessao recem-partida so vira 'rodando' quando o hook reporta**, cerca de um segundo depois.
  Sem contabilizar esse intervalo (`partindo`), liberar UMA vaga esvaziava a fila INTEIRA -- a cada
  volta do laco a conta ainda dizia que havia espaco. Era exatamente a rajada que o teto existe para
  evitar, e foi o teste que pegou.
- **Nada pode ser retido para sempre**: escape por tempo (60s), escape manual (clicar na etiqueta), e
  a partida so segura vaga por 8s sem confirmacao. Sem hooks instalados nenhuma sessao reporta
  `rodando`, e esse prazo de 8s vira o proprio espacamento entre partidas.
- `liberarItem` executa **sempre**. Condicionar a existir o objeto do painel fazia o comando ser
  descartado em silencio: a sessao nunca comecava e nada explicava por que.

## Worktrees: listar, retomar e arquivar

`src/main/worktrees.js`. Mecanica real do `claude -w`, medida contra o CLI 2.1.220 e nao presumida:

```
worktree <projeto>/.claude/worktrees/feat-x
branch   refs/heads/worktree-feat-x
locked   claude session feat-x (pid 24172 start 639219707467220630)
```

- **O Claude tranca o worktree e grava o PID da sessao no motivo do lock.** E dai que sai o sinal
  mais util do modulo: PID vivo (`process.kill(pid, 0)`) significa "aberto agora"; PID morto
  significa lock orfao, que e justamente o lixo a limpar. Worktree trancado **recusa**
  `git worktree remove`, entao arquivar exige `unlock` antes — e so quando o lock e comprovadamente
  orfao.
- **`git branch -d` minusculo, NUNCA `-D`.** O `-d` se recusa a apagar branch com commit nao
  mesclado, e essa recusa e a ultima rede antes de perder codigo.
- **`arquivar` revalida tudo na hora**, ignorando o que a interface achava: a lista da tela pode ter
  minutos e uma sessao pode ter subido nesse meio tempo.
- **Nenhum caminho de recusa pode deixar residuo.** Se o `remove` falhar depois do `unlock`, o
  worktree e retrancado — meio-arquivamento silencioso e pior que nao arquivar.
- Quatro portoes antes de apagar: sessao viva, alteracao sem commit, commit fora da base, e painel
  deste app aberto na pasta (`terminais.cwdDe`). Cada recusa diz **qual** deles impediu — um "nao
  deu" generico obrigaria a ir descobrir no terminal, que e o que este app existe para evitar.
- Todos os comandos usam `execFile` com argumentos em **array**: os caminhos vem do usuario e podem
  conter espaco ou `&`.

**Retomar** abre painel na pasta do worktree com `cls && claude -c`. Sem fallback de proposito:
medido, `claude -c` num diretorio sem conversa anterior sai com codigo **0** e simplesmente abre
sessao nova, entao um `|| claude` nunca dispararia.

**`.worktreeinclude`**: o worktree e um checkout limpo, entao arquivo ignorado pelo git nao vai
junto e a aplicacao nao sobe la dentro — o sintoma e a feature nova parecer "quebrada" sem motivo.
O app detecta arquivos de ambiente que existam **e** estejam ignorados (`git check-ignore`) e oferece
criar o arquivo, sempre com dialogo: e um arquivo novo no repositorio do usuario.

## Uma faixa de portas por painel

Isolar arquivos em worktree nao basta: duas features do mesmo projeto rodando `npm run dev` disputam
a mesma porta e a segunda morre com `EADDRINUSE`. `src/main/portas.js` reserva **5 portas livres
consecutivas por painel** a partir de 3100 e injeta no ambiente do PTY.

- **Livre e testado com `listen()` de verdade**, nao com uma lista interna de "ja entreguei" — um
  processo de fora pode estar segurando a porta, e e justamente esse o caso que mata o dev server.
- O socket de teste fecha na hora (quem precisa escutar e o dev server). Sobra uma janela de corrida
  minima; a contabilidade por painel garante o que importa, que e nunca entregar o mesmo bloco duas
  vezes.
- Base 3100 foge do 3000/3001 do Next e do 5173 do Vite.
- Cinco portas porque `turbo run dev` sobe varios apps de uma vez, e uma so recolocaria a colisao.
- Reservar acontece **antes** de criar o PTY: a variavel tem de existir desde o nascimento do
  processo, senao o dev ja subiu na porta errada.

Variaveis exportadas: **`PORT`** (a convencao que Next, Nest e Express leem sozinhos), `ORQ_PORTA`
(nome explicito) e `ORQ_PORTAS` (o bloco inteiro, separado por virgula).

**Metade do trabalho fica no outro repositorio** — o app garante a porta, mas o projeto precisa
le-la:

| Stack | O que fazer |
|---|---|
| Next | `next dev` sozinho ja respeita `PORT`. Uma flag `-p 3001` fixa no script **vence a env** e precisa sair. |
| Vite | Ignora `PORT`. Use `vite --port %PORT%` no script, ou `server: { port: Number(process.env.PORT) \|\| 5173 }` no `vite.config`. |
| Nest / Express | Garantir `app.listen(process.env.PORT ?? 3000)`. |
| Turborepo | Cada app pega uma posicao de `ORQ_PORTAS`. |

## Cadastro de projetos

Lista de pastas salva em `~/.orquestrador/projetos.json` (a env `ORQ_DADOS` reaponta o arquivo — e o
que impede os testes de mexerem na lista real). Clicar num projeto abre painel na pasta e manda
`cls && claude` sozinho.

- **`cls && claude`, nao `cls; claude`.** O shell do app e o `cmd.exe`, onde `;` nao separa comandos
  (isso e PowerShell). O `cmd.exe` custa dezenas de ms para abrir contra centenas do PowerShell, e e
  o que segura a meta de abertura.
- **O nome da feature e sanitizado antes de virar comando** (`slugFeature`). Ele vai para dois
  destinos perigosos ao mesmo tempo: uma linha de comando de shell (`feat & shutdown -s` executaria
  o segundo comando) e um nome de branch do git (que rejeita espaco, `~`, `^`, `:`). Sobra so
  `[A-Za-z0-9._-]`.
- **Projeto sem `.git` nunca recebe `-w`** — `claude --worktree` falha fora de um repositorio e o
  usuario so veria um erro cru. A deteccao e refeita a cada leitura da lista, porque uma pasta pode
  virar repositorio depois de cadastrada.
- **`projetos:adicionar` recebe o caminho pronto**, sem abrir dialogo por dentro: separa a escolha da
  gravacao e e o que torna o fluxo testavel, ja que o CDP nao dirige dialogo nativo do Windows.
- Gravacao atomica (`.tmp` + `rename`): o app morrer no meio de um `writeFile` nao pode zerar a lista.
- Remover projeto tira **so o cadastro** — a pasta no disco nunca e tocada, e o dialogo diz isso.

## Invariantes — quebre uma e a meta correspondente cai junto

**Canal 1**
- Um envio de IPC **por quadro (~16ms) com todos os painéis no mesmo lote**. Nunca mande chunk na
  hora que chega.
- `encoding: null` no spawn e `Uint8Array` no IPC. Decodificar no main, serializar como string e
  re-decodificar na janela e trabalho triplicado.
- Ao montar o lote, **aloque exato e copie**: `Buffer.concat` pode devolver uma view de um pool de
  8 KB, e o structured clone serializa o ArrayBuffer inteiro — vazaria bytes de outros painéis.
- Corte de fila **por bytes** (64 KB por quadro), descartando chunks inteiros do inicio. Cortar por
  numero de chunks nao diz nada sobre memoria, e cortar no meio de um chunk parte sequencia UTF-8.
- **`useConptyDll: false`** — ConPTY do Windows, nao a dll empacotada no node-pty. Medido com 4
  painéis cuspindo log: a dll empacotada custa **26,7%** de CPU no processo principal contra
  **13,5%** da do sistema. E ela que decide a meta de CPU sob carga; o renderer fica em ~1% nos dois
  casos.
- **`fechar()` mata a arvore com `taskkill /T /F`.** Com `useConptyDll: false` o `kill()` do node-pty
  forka um `conpty_console_list_agent` que chama `AttachConsole` e estoura dentro do Electron — o
  PTY e os sockets sao liberados normalmente (isso e sincrono), mas a limpeza extra de processos de
  console se perde. E rede de seguranca assumida: `testes/arvore.js` passa mesmo sem ela, porque
  fechar o ConPTY ja derruba o que esta anexado ao console. Vale pelo caso que o node-pty documenta
  (servidores node que se destacam do console) — e este app existe para rodar sessoes que sobem
  servidor. O crash do agente aparece em `.dev-udata/app.log.err` ao fechar painel; e ruido, nao
  falha.
- `scrollback: 3000`; debounce de 100ms antes de `fit()` + `pty.resize()`.
- **Os marcadores de sessao do Claude sao removidos do env do PTY** (`ENV_SESSAO_PAI` em
  `terminais.js`: `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, …). Abrir o
  orquestrador de dentro de uma sessao — o que acontece o tempo todo em desenvolvimento — fazia cada
  painel nascer se achando sessao-filha daquela, com o sintoma visivel
  `Transcript saving is off - inherited CLAUDE_CODE_CHILD_SESSION`. Os painéis tem de hospedar
  sessoes de primeira classe. Config do usuario (`ANTHROPIC_*`, `CLAUDE_EFFORT`) nao e tocada.
- **Comando inicial so e enviado no primeiro byte de volta do PTY** (`painel.aoPrimeiroDado`, com
  fallback de 1,5s). Escrever assim que `abrirTerminal` resolve nao e seguro: o `pty.spawn` ja
  retornou, mas com ConPTY os bytes enviados antes de o shell anexar ao pseudoconsole podem se
  perder — bug intermitente, do tipo que so aparece na maquina lenta. O gancho e registrado **antes**
  do `await`, senao o primeiro byte pode chegar durante ele.

**Janela**
- **Uma unica `BrowserWindow`**, N instancias de xterm.
- Teto de **8 contextos WebGL** com queda para canvas, mais `onContextLoss`. O navegador mata o
  contexto mais antigo sem avisar e o painel fica preto.
- **Registre o painel em `painelPorId`/`ordemDeUso` ANTES de montar o terminal**: o renderizador e
  escolhido pela posicao em `ordemDeUso`, e um id ainda nao registrado da `indexOf === -1`, fazendo
  todo painel nascer em canvas.
- `Painel.destruir()` avisa a lateral por dentro. Destruir por codigo (nao pelo botao) tem de
  limpar o card do mesmo jeito, senao sobra card orfao.
- **`painel.js`, `grade.js` e `lateral.js` sao scripts classicos e dividem UM escopo lexico global.**
  Redeclarar um nome de topo entre eles e `SyntaxError` e o arquivo inteiro nao carrega. Referencie
  pelo namespace (`OrqP.Painel`) em vez de desestruturar.
- **Um unico `setInterval` de 1s** para todos os cronometros.

**Canal 2**
- Emita **diffs** (`{ id, status, motivo, desde }`), nunca a lista inteira.
- O servidor responde 200 **antes** de qualquer processamento (o trabalho de estado vai para
  `setImmediate`). Consumir o corpo antes de responder e ok — e rapido; responder antes de consumir
  faz o curl esperar o proprio timeout.
- Escute so em `127.0.0.1`. Porta fixa 47615, gravada em `~/.orquestrador/porta`.

## O contrato do hook (medido contra o CLI 2.1.220, nao suposto)

```
curl -s --connect-timeout 0.2 -m 2 -H "X-Orq-Id: $ORQ_ID" --data-binary @- \
  http://127.0.0.1:47615/evento/<Evento>/<tipo> || exit 0
```

- **O Claude Code executa hooks num shell POSIX.** `$ORQ_ID` expande; `%ORQ_ID%` chega literal.
  (A spec sugeria a sintaxe do cmd — esta errada nesse ponto.)
- **Evento e tipo vao no PATH, nunca em query string.** Um `&` fora de aspas e separador de comando
  e o curl recebe duas URLs quebradas, perdendo o evento em silencio.
- **`--connect-timeout 0.2` nao e detalhe.** Com o app fechado, o Windows nao devolve RST na hora
  numa porta fechada do loopback: sem ele cada hook custa ~2s, com ele ~310ms. Sempre `exit 0`.
- **`curl.exe` do Windows, sem binario proprio.** ~6ms com o app aberto, contra os ~80ms de arranque
  do Node que a spec rejeita — e sem `.exe` desconhecido para empacotar e assinar.
- Um matcher por tipo de notificacao (`permission_prompt`, `idle_prompt`), para o proprio Claude
  separar e o app nao ter de adivinhar pelo corpo.

**Correlacao evento -> painel, nesta ordem:** `ORQ_ID` (env injetado no PTY, herdado pelos filhos)
-> `cwd` exato -> `cwd` descendente do cwd de spawn do painel. A spec manda usar so o `cwd`, e isso
nao basta aqui: `claude -w` move a sessao para `<projeto>/.claude/worktrees/<nome>`, entao o cwd do
hook nao e o do painel. A regra do descendente cobre esse caso; o `ORQ_ID` cobre o resto.

**Registre os hooks no nivel do USUARIO** (`~/.claude/settings.json`). Hooks de escopo de projeto
nao sobrevivem ao worktree — ele e um checkout limpo e o `.claude/settings.json` so vai junto se
estiver commitado. `instalar-hooks.js` faz merge preservando tudo, grava backup antes, e o app
**sempre pergunta** — o arquivo e do usuario.

## Medido nesta maquina (12 nucleos, RTX 2050)

| Meta da secao 2 | Medido | |
|---|---|---|
| CPU parado, 8 painéis (< 2%) | **0,06–0,1%** | ok |
| CPU, 4 painéis cuspindo log (< 25%) | **13,3%** | ok |
| RAM total, 8 painéis (< 700 MB) | **375–400 MB** | ok |
| RAM por painel (< 40 MB) | **11–14 MB marginal** | ok no marginal |
| Abertura ate o 1o terminal (< 1,5s) | **443ms** | ok |
| Permissao -> bolinha amarela (< 300ms) | **71–79ms** | ok |
| Tecla -> tela (< 16ms) | **~30ms** ida e volta | ver abaixo |

Duas ressalvas honestas, ambas sobre a **metrica**, nao sobre o codigo:

- **RAM por painel.** A base fixa do Electron 43 e ~277 MB com zero painéis (~283 MB com a porta de
  depuracao). O custo marginal por painel e 11–20 MB. A metrica crua `total ÷ N` da ~50 MB com 8
  painéis porque amortiza essa base — so fecharia abaixo de 40 MB com 12+ painéis, independente da
  qualidade do codigo.
- **Tecla -> tela.** O custo proprio do app e ~5ms (write -> processado) mais ate 16ms do lote. Os
  ~30ms medidos sao a ida e volta completa incluindo o `cmd.exe` processar o echo — terminal nao
  faz eco local, entao esse piso nao e removivel sem quebrar a semantica do PTY.

A meta de CPU sob carga so fechou depois de trocar o backend de ConPTY. Vale registrar porque a
spec (6.6) manda procurar o gargalo em tres lugares — IPC sem lote, canvas onde devia ser WebGL,
re-render da lateral — e nenhum dos tres era: com 4 painéis cuspindo log o **renderer fica em 1,3%**
e o processo **principal** em 26,7%. O custo estava no caminho de leitura do PTY, nao no desenho.
Perfile por processo antes de mexer no pipeline de render.

## Ao medir qualquer coisa aqui

Tres formas de obter numero falso, todas ja encontradas:

1. **Janela em segundo plano.** O Chromium limita `setTimeout`/rAF a ~1/s e **toda** latencia abaixo
   de 1s le exatamente ~1000ms. Meca por evento (`onWriteParsed`), nao por polling; `testes/metas.js`
   traz a janela para frente e aborta se os timers ainda estiverem limitados.
2. **`spawnSync` mentindo sobre o custo do hook.** Com args em array (`['cmd.exe','/c',cmd]`) o Node
   reescapa a string e destroi as aspas do `-H` (o curl descarta o cabecalho calado); com o corpo em
   `input:` (stdin em pipe) o curl espera EOF ate estourar o `-m`. Use um `.cmd` com o corpo por
   redirecionamento de arquivo.
3. **PowerShell aninhado em string.** `-Filter "Name='electron.exe'"` dentro de `powershell -Command`
   perde as aspas e devolve 0, e um teste de RAM passa vazio. Use `-File` com um `.ps1`.
4. **`sh` nao esta no PATH do PowerShell.** `spawnSync('sh', ...)` devolve `status: null` e o teste
   de hooks falha inteiro culpando o app. `testes/fase45.js` resolve o caminho do `sh.exe` do Git.
5. **Processo de medicao contando a si mesmo.** Filtrar processos por uma marca na linha de comando
   pega tambem o `powershell` que faz a contagem, porque a marca esta no comando dele.

Para somar CPU de varios processos, case as amostras **por pid**: somar tudo e subtrair da delta
negativa quando um processo morre entre as duas leituras.
