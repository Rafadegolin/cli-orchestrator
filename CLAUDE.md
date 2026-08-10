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

**Estado:** Fases 0, 1, 2, 4 e 5 implementadas, mais o cadastro de projetos (abaixo). Fora do escopo
por ora: Fase 3 (o app criar e arquivar worktree pela interface), Fase 6 (otimizacoes sob carga),
Fase 7 (restaurar sessoes ao reabrir) e Fase 8 (instalador).

## Comandos

```
npm start                 # roda o app
npm run dev               # roda com a porta de depuracao 9222, para os testes dirigirem
npm run teste:fase1       # 1 painel: PTY, lote de IPC, resize, enxurrada
npm run teste:fase2       # 8 painéis: grade, orcamento WebGL, RAM/CPU (leva ~90s)
npm run teste:fase45      # hooks -> bolinha -> lateral ordenada
npm run teste:projetos    # cadastro, dedupe, comando inicial, sanitizacao
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
