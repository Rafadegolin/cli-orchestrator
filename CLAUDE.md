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

**Estado:** **todas as fases da spec (0 a 8) implementadas**, mais o cadastro de projetos e o
**redesenho de `docs/nova-ui/` completo (fatias 1 a 5)**. O que resta sao os extras da Fase 9,
detalhados em `docs/fase-9-extras.md` — incluindo um que nao esta na spec original: **visao de mapa
com ligacoes entre sessoes**, para uma feature que atravessa repositorios (backend e frontend em
repos separados).

Ali ja esta levantado o que o CLI oferece para isso: `--add-dir` como flag **e** `/add-dir` como
comando de barra, o que permite ligar duas sessoes **sem reiniciar** nenhuma delas.

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
npm run teste:ui          # tokens, tema, densidade, fontes, paleta, overlays e contraste
npm run teste:historico   # Node puro, sem app: agregacao de tempo por feature
npm run teste:registro    # Node puro: o registro de sessoes do CLI como fonte de status
npm run teste:uso         # o medidor de uso no topo: leitura, faixas, compressao
npm run teste:uso-real    # o spike: fala com a API de uso de verdade (nao consome tokens)
npm run teste:layouts     # Node puro: gravar, substituir e normalizar layouts
npm run teste:ajuda       # a ajuda no app, e se os numeros dela batem com o codigo
npm run teste:ligacoes    # mecanica das ligacoes, sem invocar o Claude
npm run teste:ligacoes-reais # com Claude de verdade: ~3min e consome tokens
npm run teste:aprovacao    # formas do pedido e o farejador, sem invocar o Claude
npm run teste:aprovacao-reais # aprovar um pedido real: ~2min e consome tokens
npm run spike:aprovacao   # MEDE as marcas contra o CLI real: consome tokens
npm run perfil            # CPU/RAM POR PROCESSO (use -Json para consumir em script)
npm run teste:metas       # latencia de tecla e CPU sob carga (leva ~90s)
node testes/arvore.js     # fechar painel mata a arvore de processos

npm run empacotar         # instalador e zip portatil em dist/, sem publicar
npm run empacotar:sac     # o pacote que abre com o Smart App Control ligado
npm run teste:sac         # o pacote -sac: exe intocado, e o terminal funciona
npm run teste:atualizacao-leve # baixa, confere o sha, troca o asar e reabre (sem GitHub)
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
Code; o Canal 2 existe exatamente para isso. As tres excecoes sao conscientes, estreitas e medidas
(o farejador de permissao, a confirmacao do `/add-dir` e a leitura da pergunta na faixa) — e quando
alguma delas muda status, ela **avisa o processo principal**, senao a janela e o main passam a ter
verdades diferentes.

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
  atualizacao baixada.
- **O app NAO e assinado, e no Windows 11 com Smart App Control ligado TODO BINARIO BAIXADO daqui e
  bloqueado** — sem botao de contornar. Nao e o SmartScreen: o log do Code Integrity acusa
  `did not meet the Enterprise signing level requirements`. Certificado autoassinado **nao** resolve
  (o SAC so aceita CA do Microsoft Trusted Root Program, e so RSA), e o Azure Trusted Signing nao
  atende o Brasil.
- **O SAC julga a IDENTIDADE do binario, e nada mais.** Medido em 11/08/2026 com o SAC em estado 1,
  depois de a afirmacao antiga ("ele barrou o instalador, nao o executavel") ter sido falsificada:

  | testado | resultado |
  |---|---|
  | release baixada, extraida, executada | bloqueada (evento 3077) |
  | ...e o exe extraido estava **sem MOTW** (`Expand-Archive` nao propaga) | barrado assim mesmo |
  | app **recem-compilado aqui** (`dist\win-unpacked`) | **bloqueado** |
  | o mesmo exe copiado para fora do OneDrive | bloqueado |
  | `node_modules/electron/dist/electron.exe`, tambem **sem assinatura** | **roda** |

  Ou seja: nem desbloquear, nem mudar de pasta, nem compilar localmente. A medicao antiga enganava
  porque fora feita sobre um binario ja rodado dezenas de vezes na propria maquina — o teste errado.
  E a ultima linha e a saida: o `electron.exe` passa **sem assinatura** porque e byte a byte o mesmo
  para todo mundo. Quem destroi essa reputacao e o electron-builder ao renomear o executavel e
  reescrever icone e metadados.
- **`npm run empacotar:sac` e o pacote que abre com o SAC ligado** (`recursos/empacotar-sac.js`): o
  `electron.exe` ORIGINAL mais o nosso `app.asar` ao lado, sem renomear nada. Provado de ponta a
  ponta em `npm run teste:sac`, inclusive pelo caminho real (zip com MOTW, extraido sem desbloquear).
  - **Tocar no executavel e o unico jeito de quebrar isso**, e o sintoma seria so alguem dizendo que
    nao abre — por isso o script compara o SHA-256 com o do npm e aborta se diferir. Renomear para
    `Orquestrador.exe` e a "melhoria" tentadora que reintroduz o bug.
  - O icone da barra de tarefas passou a vir do `icon` da `BrowserWindow` (e `recursos/icone.ico`
    entrou no `files:` do asar): aqui nao ha executavel nosso para carrega-lo. **Isso cobre a janela
    aberta, mas nao o FIXAR**: ao fixar, o Windows guarda um atalho e le o icone dos recursos do
    `.exe` — que e o do Electron. Dai `src/main/atalho.js`, que cria um `.lnk` no menu Iniciar com o
    nosso `.ico` e o `appUserModelId`, mais `app.setAppUserModelId` no `index.js` com o MESMO id (e
    ele que faz o Windows entender que a janela aberta e aquele atalho). O `.lnk` e criado na maquina
    de quem usa — **sozinho, no arranque**, nos layouts portatil e `-sac` (`atalho.garantir()`), e
    pela paleta como caminho manual: ele grava caminho absoluto e viajaria quebrado dentro do zip.
    **Sem um atalho carregando o mesmo AppUserModelID, o Windows descarta os toasts do app em
    silencio** — e este app avisa por toast quando uma sessao para pedindo permissao.
- **`app.isPackaged` MENTE neste projeto, e a falha e muda.** O Electron responde pelo NOME do
  executavel (`electron.exe` -> "nao empacotado"), e o pacote `-sac` roda sobre exatamente esse nome.
  O updater inteiro se desligava sozinho: nenhum aviso de versao nova, para sempre, sem um erro
  sequer. `src/main/empacotamento.js` pergunta o que interessa — se o codigo esta sendo lido de dentro
  de um `.asar`. O `electron-updater` tem a mesma checagem por dentro, entao no `-sac` ele ainda
  precisa de `forceDevUpdateConfig = true` mais `setFeedURL` (que dispensa ler o `app-update.yml`).
  Aplicar segue desligado ali, porque o layout e sempre `portatil`.
  - O zip sai pelo **bsdtar do Windows** (`%SystemRoot%\System32\tar.exe`), e cada detalhe custou uma
    tentativa: o `Compress-Archive` morre no meio porque o Electron distribui arquivos com data fora
    da faixa do formato zip; `tar` solto no PATH acha o GNU tar do Git, que nao escreve zip;
    `--options zip:compression=deflate` e obrigatorio (sem ele o pacote sai com 359 MB em vez de 142);
    e o caminho tem de ir relativo, porque o bsdtar le `C:\...` depois do `-f` como `maquina:caminho`.
- **`npm run teste:empacotado` nao roda mais nesta maquina** — o exe do electron-builder e bloqueado.
  O teste detecta o SAC e diz isso, em vez de morrer com `spawn UNKNOWN`, que e como o Windows relata
  a recusa (o erro e **sincrono** no `spawn`, entao um handler de `'error'` nunca rodaria).
- **Nos layouts em pasta a atualizacao troca SO o `app.asar`** (`src/main/atualizacao-asar.js`), e o
  electron-updater nem entra: tudo que ele sabe fazer com o resultado e rodar o instalador. Entre
  duas versoes nossas quase sempre so o asar muda — 4 MB contra 142.
  - **O `runtime` do `sac.json` e o que impede a troca burra.** Se o Electron ou o node-pty mudarem
    de versao, o asar novo nao casa com o que esta no disco: nao ha troca leve, e o aviso volta a ser
    "Baixar a versao X" **com o motivo escrito**. Ao subir qualquer um dos dois, e isso que faz todo
    mundo receber o pacote inteiro em vez de um app quebrado.
  - **A troca e um `.bat`**, porque este processo nao consegue sobrescrever o proprio `app.asar` —
    ele fica mapeado em memoria enquanto o app vive. A espera dele NAO e pelo PID sumir do
    `tasklist` (saida traduzida, PID reaproveitado): e tentar o `move` ate ele parar de falhar, que e
    a condicao real. Ele renomeia o antigo para `.bak` antes de por o novo, e devolve se algo der
    errado: o pior caso e continuar na versao velha, nunca ficar sem app. Deixa um `troca.log` ao
    lado — depois que o app morre nao ha console para ver, e essa e a unica pista que sobra.
  - **O relancamento repete os argumentos** com que o app tinha sido aberto.
  - No teste, o app que volta **nao aparece no CDP**: ele reabre cerca de um segundo depois do
    anterior morrer, e o socket da 9222 ainda esta preso — o Chromium sobe sem depuracao. Por isso
    `testes/atualizacao-leve.js` prova o retorno por fatos (processo vivo, atalho recriado pelo nosso
    main, sha do asar no lugar), e nao pelo depurador. Em uso real ninguem passa porta de depuracao.
  - O teste e HERMETICO: `ORQ_META_ATUALIZACAO` reaponta a origem para um servidor local, como o
    `ORQ_DADOS` faz com a pasta de dados. Testar troca de codigo contra o GitHub seria testar o
    GitHub.
- `npm run diagnostico` responde assinatura, estado do SAC, MOTW e o evento do Code Integrity de uma
  vez. Opcoes e passo a passo em `docs/instalacao-e-assinatura.md`. O build ja aceita
  `CSC_LINK`/`CSC_KEY_PASSWORD` se um dia houver certificado.
- **A janela carrega o xterm por `<script src="../../node_modules/...">`**, caminho que no app
  empacotado resolve **dentro do asar**. Funciona, mas e frageis a mudancas em `files:` — se a janela
  subir em branco no instalador, e aqui.
- **O updater nunca reinicia sozinho.** Este app hospeda sessoes vivas; o download acontece em
  segundo plano, mas aplicar e decisao do usuario, e o dialogo diz quantos painéis serao fechados.
  `autoInstallOnAppQuit` cobre o caso tranquilo: fechou o app, aplica na saida.
- Erro de atualizacao **nunca** vira dialogo — sem internet ou GitHub fora do ar, so log.
- **"Preciso fechar e abrir o app para aparecer o botao de reiniciar" — e nao era o intervalo de 4h.**
  Nao havia gatilho NENHUM alem do relogio: nem ao voltar para a janela, nem `powerMonitor`, nem botao
  manual (o IPC `atualizacao:verificar` existia com chamador **so nos testes**). Fechar e reabrir
  "funcionava" porque a primeira checagem sai 10s depois do arranque. Entrou o `aoVoltar` em
  `show`/`restore`/`focus` no molde do `uso.js`, com piso de **30min** — `focus` dispara a cada
  alt-tab, e sem piso um dia de trabalho viraria dezenas de consultas ao GitHub. O carimbo
  (`verificadaEm`) e gravado dentro do `verificar()`, mas o piso so e consultado no `aoVoltar`: se
  valesse la dentro, o "verificar agora" da paleta ficaria refem dele. **O intervalo continua 4h** —
  encurtar nao conserta o relato e, no caminho leve, cada checagem **baixa 4 MB** na mesma passada.
- **O toast do `update-downloaded` NAO ganhou `avisoPendente`.** Aquele mecanismo existe porque sessao
  esperando e um EVENTO com prazo e o toast e o unico canal fora da janela. Atualizacao e **estado
  duravel**: o botao no rodape e a bolinha ficam la, sao reescritos a cada `avisarJanela()` e relidos
  no arranque. Toast perdido nao custa informacao — e o contrario programaria o app para jogar um
  toast sobre a coisa menos urgente que ele sabe.
- **`baixada` nao dizia de QUE VERSAO, e o defeito era do pior tipo: a tela certa e o arquivo errado.**
  No caminho leve, `if (!info.leve || situacao.baixada) return;` fazia uma release publicada DEPOIS,
  na mesma execucao, atualizar `disponivel` para Y sem baixar o asar de Y — e o rodape passava a
  prometer "Atualizar para Y e reiniciar" com o `app.asar.novo` de X no disco. Agora ha um
  `versaoBaixada` e a comparacao e por versao; e sem versao nova tudo e zerado, que era o equivalente
  do `update-not-available` que o leve nunca teve. No `catch`, `situacao.leve = false` virou
  `if (!situacao.baixada)`: uma falha de rede transformava "atualizar e reiniciar" em "baixe pelo
  site" **com o arquivo pronto ao lado**.
- `parar()` remove os ouvintes de janela, e nao so o relogio: `iniciar()` roda de novo pelo
  `app.on('activate')`.
- Desinstalar roda `--remover-hooks` pelo `recursos/instalador.nsh`. Sem isso os hooks ficariam no
  `settings.json` para sempre e toda sessao pagaria ~310ms por evento falando com um app que nao
  existe mais.
  - **E `${ifNot} ${isUpdated}` em volta disso NAO e detalhe.** O instalador de um clique **roda o
    desinstalador antigo antes de instalar a versao nova** (`installSection.nsh` ->
    `uninstallOldVersion`), entao sem o guarda a macro rodava ali tambem: **toda atualizacao apagava
    os hooks**, e nada os reinstalava — `instalar()` so roda por IPC, com clique e dialogo. O
    sintoma foi "sempre que atualiza preciso instalar os hooks de novo", e demorou a ser ligado a
    causa porque a tela continua parecendo normal. O electron-builder ja passa `--updated` e define
    `${isUpdated}`; o template usa esse mesmo teste para nao apagar dados do usuario.
  - Quem usa o zip portatil ou o `-sac` nunca sofreu disso: a troca leve mexe so no `app.asar`.

## A nova UI (docs/nova-ui)

`docs/nova-ui/` (8 documentos) mais `docs/Orquestrador.dc.html` (o prototipo, com estilo inline de
cada elemento) especificam o redesenho: a tela deixa de ser "uma grade de terminais" e vira **um
painel de controle de atencao**. Entregue em fatias; **a fatia 1, a casca, esta feita**.

**O prototipo e referencia VISUAL, nao arquitetural.** Ele re-renderiza tudo a cada `setState` e tem
um terminal falso (`lines: TermLine[]`). Aqui o xterm e dono do proprio DOM: **reconstruir um painel
destroi o terminal**. Tudo continua imperativo — cria uma vez, muta depois.

Onde o documento descreve o app errado, vale o app. Dois pontos: `linkSessions` nao encaminha saida
de uma sessao para outra (e `--add-dir`, acesso a pasta, mutuo), e os 4 status do doc 05 sao um
subconjunto dos 5 que os hooks entregam — `terminou` (evento `Stop`) fica, com cor propria.

- **A marca da tela e a MESMA do icone do app** (grade de quatro painéis com as bolinhas de status),
  desenhada como `<svg>` inline no `index.html` — em dois tamanhos, com as linhas de texto so no
  grande. Ela **nao responde ao tema**: e a mesma imagem que aparece na barra de tarefas, e marca que
  troca de cor deixa de ser marca. A anterior (quadrado verde com um furo) veio do prototipo e nao
  tinha relacao nenhuma com o icone.
- **Tokens em `estilo.css`**, tema claro e `html.claro` sobrescrevendo as MESMAS variaveis. Nao
  existe regra `.claro .algumacoisa` no arquivo; se voce precisar de uma, o token que falta e o
  problema. **O terminal fica escuro nos dois temas** (`--term`/`--termfg`, repetidos como literais
  no `TEMA` do `painel.js`) — codigo monoespacado sobre fundo claro quebra a leitura.
- **Fontes vendorizadas** em `src/janela/fontes/` (Space Grotesk + JetBrains Mono, subsets latin e
  latin-ext, OFL). Baixadas uma vez e commitadas: o CSP e `font-src 'self'` e o app tem de abrir sem
  internet. `teste:ui` confere com `document.fonts.check` — sem isso o app cai em fallback e a tela
  fica "quase certa" sem ninguem perceber.
- **Barra de titulo:** `titleBarStyle: 'hidden'` + `titleBarOverlay`. Os tres botoes continuam sendo
  os do Windows (Snap Layouts preservado); a faixa e nossa. Duas consequencias: a cor deles nao sai
  do CSS (o `ui:salvar` chama `setTitleBarOverlay`), e o `#titulo` reserva a area deles com
  `padding-right: calc(100vw - env(titlebar-area-width))`.
- **Densidade 1/2/3** (`--cols` e `--altura-painel` vindos de `#app[data-densidade]`) com altura
  FIXA por densidade. As colunas nao dependem mais da contagem de painéis: numero que muda sozinho a
  cada painel aberto e o oposto de uma grade previsivel.
- **Mais o slot `P`** (`src/janela/personalizado.js`), onde a altura deixa de ser fixa e vira **span
  de linhas** — ver a secao propria abaixo.
- **Preferencias em `ui.json`** (`preferencias.js`), separado do `sessao.json`: arranjo muda o tempo
  todo e e regravado com debounce, preferencia muda por clique. Juntar faria toda troca de tema
  reescrever a lista de painéis.
- **A lateral recolhe** (`#btn-lateral` no canto esquerdo da barra de titulo, ou **Ctrl+B**), e a
  escolha fica no `ui.json` — ver a secao propria abaixo.
- **Placar de CPU** (`metricas.js`): `app.getAppMetrics()` a cada 2s, **so com a janela visivel**, e
  emitindo **so quando o valor arredondado muda**. Soma dividida pelos nucleos, para falar a mesma
  lingua das medidas deste projeto (13,3% da maquina, e nao 160% de um nucleo).

### Tres armadilhas que a fatia 1 pagou

1. **`[hidden]` perde para qualquer regra com `display`.** `#lateral-pe button { display: flex }`
   fazia "Retomar todas (0)" aparecer com zero sessoes salvas, e `.painel-dormindo` com
   `position:absolute; display:flex` cobria o terminal INTEIRO de todo painel — a tela parecia
   funcionar e nenhum terminal desenhava. Existe um `[hidden] { display: none !important }` no topo
   do arquivo; nao o remova.
2. **Animar `box-shadow` custa CPU de verdade.** As bolinhas pulsando levaram o consumo parado com
   oito painéis de 0,06% para **2,39%** — acima da meta de 2%. O pulso agora e um pseudo-elemento
   animando `transform` e `opacity`, que vao para o compositor: **0,02%**, abaixo do baseline
   original. Mesmo desenho, ordem de grandeza a menos.
3. **Quem rola e o `#conteudo`, nao o `#grade`.** O `IntersectionObserver` do painel aponta para
   ele. Apontar para um elemento que nao rola faz todo painel contar como visivel para sempre, e a
   economia inteira da Fase 6.1 (buffer em vez de desenho, sem vaga de WebGL) some em silencio —
   sem nenhum erro, so a conta de CPU subindo.

### Fatia 2: urgencia e status legivel

A tela responde "para onde eu olho agora?" sem voce procurar.

- **`rotuloDe(card)` em `lateral.js` e a UNICA fonte do rotulo**, consumida pela lateral, pela fila e
  pelo cabecalho do painel. Antes cada um montava o seu e os tres ja tinham divergido.
- **O rotulo diz o ESTADO; o motivo do hook vai para o `title`.** Concatenar os dois produzia
  `parado ha 60s ha 4min`, com o "ha" duas vezes na mesma linha. `esperando ha 12min` e o rotulo;
  `pedindo permissao` e o tooltip — e vira o texto da barra de aprovacao na fatia 3.
- **A fila de atencao nao segue a ordenacao escolhida.** Ela e a fila: sempre por quem espera ha mais
  tempo. Com a grade ordenada por projeto, `filaAtencao()[0]` continua sendo o alvo certo do
  Ctrl+Enter — `ordenadas()[0]` nao seria.
- **O peso da ordenacao nao sai so do status.** Painel dormindo carrega `iniciando` (peso 3) e
  cairia no meio da lista, na frente de sessoes vivas; `PESO_DORMINDO` o manda para o fim.
- **Ordenar e por `style.order`, nunca movendo nos.** Mover o elemento de um xterm dispara reflow e
  `fit()` em cascata a cada mudanca de status — e status muda o tempo todo. A ordem salva pela Fase 7
  continua sendo a do DOM (ordem de criacao): a ordenacao da tela e uma VISTA, nao o arranjo.
- **O painel FOCADO nao sai do lugar** (`fixarFocado`, em `grade.js`). A ordenacao por urgencia e
  global: uma mudanca de status em qualquer sessao recalculava a posicao de todas, e o painel em que
  voce estava digitando saltava por causa de OUTRO — num `#conteudo` rolavel, ate para fora da tela.
  Foi relatado assim. O guarda e minimo de proposito: o focado fica no indice que ja ocupava e os
  outros reorganizam em volta; sem foco, nada muda. So vale na grade — no mapa `style.order` nao tem
  efeito. `OrqGrade.desfocar()` existe para o teste medir a ordenacao pura.
- **`focado` e limpo quando o painel morre.** Antes ficava apontando para um id morto; agora isso
  faria o guarda defender um painel que nao existe.
- **Alt+setas andam entre terminais** (`src/janela/navegar.js`), em **captura com
  `stopPropagation`**: medido no xterm 5.5, ele reescreve Alt+Seta para `\x1b[1;5D` (Ctrl+Seta) e
  manda ao PTY — em fase de bolha o byte ja teria ido embora e o cursor do Claude andaria junto. A
  escolha do alvo e por **geometria**, nao por indice: assim funciona igual na grade, na densidade
  personalizada (spans diferentes) e no mapa, com o mesmo codigo.
- **O cronometro de 1s sai na primeira linha quando ninguem espera**, que e o estado normal da tela.
  Antes ele varria o DOM a cada segundo sem nada para atualizar.
- **A pill do cabecalho diz o PROJETO** (`OrqProjetos.projetoDe`, casando pelo prefixo mais
  especifico). Para painel de worktree o cwd e `<projeto>/.claude/worktrees/<feat>`, entao o nome
  curto da pasta era o nome da feature — repetido logo ao lado, sem informar nada.

### Fatia 3: aprovar sem entrar no terminal

`src/janela/aprovacao.js`. E a UNICA parte do app que escreve no PTY por conta propria, e por isso
tudo aqui foi MEDIDO contra o CLI real, num spike, antes de qualquer codigo.

**O prompt de permissao tem esta forma** (capturada, nao suposta):

```
 Do you want to create marca.txt?
 ❯ 1. Yes
   2. Yes, allow all edits during this session (shift+tab)
   3. No
 Esc to cancel · Tab to amend
```

Tres achados que mudaram o desenho:

1. **`\r` SOZINHO NAO APROVA.** Medido: o Enter deixa o prompt identico na tela e a acao nao
   acontece. Quem aceita a opcao 1 e o **digito `1`**, sozinho, sem Enter depois. Isso e diferente
   da confirmacao do `/add-dir`, que responde ao Enter — sao dois widgets diferentes do mesmo CLI, e
   e exatamente por isso que os dois precisaram ser medidos separadamente.
   Consequencia boa: se a trava falhar, o `1` vira o caractere "1" na caixa de entrada — visivel,
   inofensivo e **nao enviado**. O desenho inicial, com Enter, mandaria mensagem vazia.
2. **O `message` do hook e generico** (`Claude needs your permission`). A pergunta de verdade esta no
   buffer, na linha `Do you want to ...?` — e e ela que a faixa mostra, porque aprovar sem saber o
   que se aprova nao e aprovar. O `message` fica de reserva ate a leitura acontecer.
3. **`echo` nao serve de provocacao em teste**: o CLI o executa sem pedir permissao, e a sessao
   nunca fica `esperando`. Escrever arquivo (ferramenta Write) pede.

**A trava:** `aprovar()` reconfere o buffer no momento do CLIQUE, nao no momento em que a faixa
apareceu — entre voce responder no proprio terminal e o hook avisar o app existe cerca de um segundo
em que a faixa ainda esta la. Sem as duas marcas na tela, **nao escreve nada**: foca o painel e
avisa por toast. E **nunca a opcao 2**, que mudaria o comportamento da sessao inteira.

**`permissao` e `ocioso` nao sao a mesma coisa.** Os dois viram `esperando` e entram na fila, mas so
o primeiro tem o que aprovar — sessao ociosa espera voce DIGITAR. A faixa do `ocioso` vem sem botao.

**O espaco da faixa e reservado sempre** (`.painel-rodape`, `flex: 0 0 34px`), vazia com o fundo do
terminal. Se ela entrasse e saisse, a altura do terminal mudaria a cada ida e volta de `esperando`,
disparando `fit()` e `pty.resize()` **no exato momento em que o prompt esta na tela** — o pior
instante para a TUI do Claude redesenhar. Custa 13% da altura na densidade 3, e vale.

**`Painel.textoDoBuffer()`** e a unica leitura de buffer do app. Ela descarrega os bytes pendentes
antes de ler: painel fora da vista nao escreve no xterm (Fase 6.1), entao ler `term.buffer` direto
devolvia texto velho — defeito que ja existia calado na confirmacao do `/add-dir`. O `term.write` do
xterm e **assincrono**, entao o que o flush entregou aparece no passo seguinte do parser; por isso
todo mundo que espera algo no buffer usa laco com intervalo, nunca uma leitura unica.

### Fatias 4 e 5: paleta, modais e o que o contraste revelou

- **A paleta (`paleta.js`, Ctrl+K) nao tem logica propria**: todo item chama uma funcao que ja
  existia e ja tinha teste. Se um comando precisar de codigo novo, ele nao pertence a paleta —
  pertence ao modulo dono do assunto. A busca **ignora acento** (`normalize('NFD')`), porque desde a
  fatia 2 a tela e acentuada e ninguem digita acento em caixa de busca.
- **Um registro so de overlays** (`OrqOverlays` em `casca.js`): o Esc fecha **o topo da pilha** e
  para ali. Antes cada overlay tinha o proprio `keydown`, e com a paleta aberta por cima da ajuda um
  Esc fechava as duas.
- **Faixa de portas por projeto**, resolvida no PROCESSO PRINCIPAL (`projetos.faixaDe`), nao na
  janela: assim painel de projeto, de worktree e avulso pegam a faixa certa sem cada chamador ter de
  lembrar de passar. `emUso()` continua global, entao faixas sobrepostas por engano ainda nao
  entregam a mesma porta duas vezes.
- **`projetos:adicionar` devolve `{ erro }` em vez de estourar.** Quem chama e o modal, onde o
  caminho e digitado: pasta errada e erro de USO e tem de virar mensagem na tela.
- **Menus na barra de titulo ficaram de fora**, por decisao. Tudo que ofereceriam ja esta a um
  clique ou a uma tecla, e a paleta alcanca o resto; menu que duplica o que ja existe e so mais um
  lugar para procurar.

### Contraste AA e calculado, nao olhado

`npm run teste:ui` le os tokens do app rodando e computa a razao WCAG dos pares que carregam texto,
nos dois temas. **Os valores do doc 02 reprovavam, e nao por pouco** — medido, nao suposto:

| par | doc 02 | corrigido |
|---|---|---|
| `--fg3` sobre `--bg1` (escuro) | 3,90 | **5,16** (`#7d8690`) |
| `--fg3` sobre `--bg1` (claro) | 3,41 | **5,46** (`#636a74`) |
| `--acc` como texto (claro) | 3,48 | **5,29** (`#0b7b52`) |
| `--warn` como texto (claro) | 3,85 | **5,25** (`#995f16`) |
| branco sobre `--acc` (claro) | 3,48 | **5,29** |

O ultimo e o mais grave: era o texto do **botao primario** do app. `--fg3` carrega metadado de 10px,
texto pequeno, onde AA nao da desconto. Ao mexer em qualquer token de cor, rode o teste — ele falha
com a lista de pares e as razoes.

### Texto: acento so no que o usuario le

Textos de tela sao acentuados (`sessões`, `Esperando você`, `esperando há 12min`). Codigo, nomes de
arquivo, identificadores, ids de secao da ajuda e comentarios continuam sem acento. As fontes
vendorizadas trazem o subset latin-ext.

Ao mexer em texto, cuidado com teste que casa string: os padroes de `testes/ajuda.js` toleram as duas
grafias de proposito (`n[aã]o funciona`), senao uma revisao de redacao derruba a suite sem nada estar
errado.

### O escopo global compartilhado tem teste agora

A armadilha dos scripts classicos deixou de ser so um aviso. `testes/ui.js` LE A FONTE de
`src/janela/*.js` e falha se o mesmo nome de topo for declarado em dois arquivos.

Ela ja tinha cobrado duas vezes: `remover` (fila/lateral, que so funcionava porque `window.OrqFila`
captura a referencia antes de `lateral.js` ser avaliado) e `projetoDe` (lateral/projetos, que quebrou
a ordenacao por projeto — a de `projetos.js` vencia e recebia um card onde esperava um caminho).
Declaracao de funcao nao estoura como `const`: a ultima vence **em silencio**.

### A ordem da compressao esta nos `flex-shrink`

O doc 03 manda a compressao ser absorvida por rotulo de status -> pill do projeto -> nome. Isso
**nao** e media query: o flexbox distribui o deficit em uma passada so, proporcional a
`flex-shrink x tamanho base`. Por isso os pesos sao **1000 / 200 / 1** e nao 3 / 2 / 1 — com numeros
proximos o nome ainda perdia 4px em 924px enquanto a pill tinha espaco de sobra para ceder.

Para o painel muito estreito (densidade 3 em 924px da painéis de **200px**) nenhum peso resolve: nao
cabem nome e tres chips. Ali entra `container-type: inline-size` no `.painel` e `@container` que
esconde, por prioridade, a pill e o chip de ligar, depois a porta. Nome e fechar nunca saem: um
identifica o painel, o outro e a saida.

## O nome da sessao e o nome do branch

O campo do topo nao tem prefixo, e a dica ao lado mostra **o nome real** do worktree e do branch
antes de voce clicar.

O `feat/` que ficava ali veio do prototipo e **nunca chegou a branch nenhum**: quem nomeia e o
`claude -w`, que sempre monta `worktree-<nome>`. Medido: a flag aceita `[name]` e mais nada, sem
opcao de dizer o branch. A tela prometia `feat/auth-refresh` e o git recebia `worktree-auth-refresh`.

Dar o nome exato exigiria o app criar o worktree (`git worktree add -b`) em vez do CLI — e isso
custaria as duas coisas que o `-w` faz junto: a **trava com o PID** no lock (de onde sai o "aberto
agora" da lateral) e a copia do `.worktreeinclude`. Nao vale; mostrar a verdade vale.

O `slugFeature` continua limpando o nome: ele ainda vai para uma linha de comando de shell e para um
ref do git.

## Enviar um prompt para varias sessoes

`src/janela/enviar-varias.js`. Reusa `OrqLigacoes.enviarLinha`, que ja sabe que a TUI do Claude
precisa do Enter separado do texto.

- **Envio SEQUENCIAL, com respiro entre sessoes**, nunca `Promise.all`: cinco TUIs recebendo Enter no
  mesmo milissegundo e a rajada que a fila da Fase 6 existe para evitar.
- **A contagem aparece antes de enviar.** Cinco sessoes e cinco vezes o custo em tokens e cinco
  execucoes paralelas, e **a fila da Fase 6 nao cobre isso** — ela controla a partida do painel, nao
  o que voce digita depois.
- **Sessao em `rodando` vem marcada.** O texto entra na fila do stdin e atrapalha o que ela esta
  fazendo. Nao e proibido; so nao acontece sem voce ver.
- Dormindo e encerrada ficam de fora: nao ha para onde escrever.

## O mapa

`src/janela/mapa.js`. Modo alternativo a grade (`#app[data-modo]`), com os painéis posicionados
livremente e as ligacoes desenhadas entre eles.

**A regra que decide o desenho todo: o terminal NUNCA e escalado.** `transform: scale()` borra o
xterm e nao re-rasteriza a textura do WebGL. Por isso nao ha zoom continuo, e sim dois estados: 1:1
com painéis de verdade, e **visao geral** onde o painel vira cartao — o terminal e TROCADO, nao
encolhido. Nada se perde: painel sem area visivel ja acumula a saida num buffer desde a Fase 6.1.

- **Trocar de modo nao recria painel nenhum**: os painéis continuam no mesmo pai e so mudam de
  posicionamento. Recriar destruiria os terminais.
- Posicoes e tamanhos vao para o `sessao.json`, com `x`/`y`/`w`/`h` normalizados como os outros
  campos.
- **No mapa, densidade e ordenacao somem da toolbar**: `--cols` nao se aplica a elemento posicionado
  e `style.order` idem. Controle que existe e nao faz nada e pior que controle ausente.
- Arrastar e pelo CABECALHO. Pelo corpo roubaria a selecao de texto do terminal.

### O tamanho do painel e MODELO, e o CSS e so o valor de partida

`p.w`/`p.h` moram no objeto do painel, como `x`/`y` ja moravam, e `aplicarPosicoes()` os escreve
inline. O `width: 420px; height: 300px` do `estilo.css` ficou sendo apenas o que vale antes de o
`redesenhar()` rodar. Antes os mesmos 420x300 estavam escritos nos dois lugares, sem nada mantendo
os dois em sincronia.

- **Arrastar e redimensionar encaixam numa malha de 20px** — a MESMA do `background-size` das
  bolinhas do fundo, e por isso os painéis ficam alinhados entre si sem ninguem mirar. A
  auto-arrumacao ja caia na malha por acidente feliz: `FOLGA` (40), `LARGURA+FOLGA` (460) e
  `ALTURA+FOLGA` (340) sao todos multiplos de 20.
- **Piso de 280x180.** Os 280 nao sao redondos por gosto: abaixo de 260px o `@container` do painel
  esconde a pill do projeto, e encolher ao maximo nao pode custar informacao do cabecalho.
- **Na visao geral o inline TEM de ser limpo.** Estilo inline vence folha de estilo, entao sem
  `p.el.style.width = ''` o cartao continuaria com o tamanho do painel — e o `width: 260px` do CSS
  nunca chegaria a valer.
- **As pontas da linha de ligacao saem do centro REAL.** Com 420x300 escrito no codigo, um painel
  redimensionado deixava a linha apontando para o vazio; e o mesmo defeito ja acontecia, calado,
  com os cartoes de 260px da visao geral. No 1:1 o tamanho vem do modelo (de graca); na visao geral,
  onde a altura e automatica e nao ha modelo, sai de uma leitura de `offset*` **por redesenho**,
  nunca por linha desenhada.
- **O redesenho das linhas passou a ser por `requestAnimationFrame`.** Arrastar e redimensionar sao
  continuos, e reconstruir o SVG inteiro a cada `mousemove` punha um rebuild dentro do laco de
  eventos.
- O `fit()` depois de redimensionar sai do `ResizeObserver` do painel, com o debounce de 100ms dele:
  quem arrasta por dois segundos paga um reflow, nao duzentos.

### O fundo de bolinhas vai no `#grade`, nao no `#conteudo`

Quem rola e o `#conteudo`, mas quem **contem** os painéis e o `#grade`. Pondo o padrao no `#grade`,
as bolinhas rolam junto com os painéis — e e isso que faz o mapa parecer uma superficie em vez de
caixas flutuando. De quebra a origem do padrao vira a mesma origem de `left/top`, entao a malha de
20px do encaixe cai exatamente sobre as bolinhas.

O `#conteudo` perde os 14px de `padding` no modo mapa: com eles, sobrava uma faixa lisa em volta do
quadro. Token proprio (`--ponto`) nos dois temas; ele nao carrega texto, entao nao entra na conta de
contraste AA do `teste:ui`.

### O `<svg>` dentro do `#grade` quebrou a ordem dos painéis

As linhas do mapa vivem num `<svg>` que fica como filho do `#grade`. `retratoSessao()` numerava a
ordem pelo indice de **todos** os filhos, entao o svg empurrava todo painel em um e a Fase 7 gravava
`1,2,3` no lugar de `0,1,2`. `atualizarVazio()` tinha o mesmo defeito: contava filhos e achava que
havia sessao aberta com a grade vazia.

Ambos agora contam PAINEIS (`porId`), nunca filhos do elemento. **Nao presuma que todo filho do
`#grade` e um painel.**

## Recolher a barra lateral

`#btn-lateral` no canto esquerdo da barra de titulo, **Ctrl+B**, ou pela paleta. A escolha vai para o
`ui.json` (`lateral: 'aberta' | 'fechada'`), com padrao **aberta**: um app que nasce escondendo a
fila de atencao parece quebrado para quem abre pela primeira vez.

- **E `display: none`, nao largura animada.** Animar a largura reflui a grade a cada quadro, e cada
  reflow arrasta junto o `fit()` de todo terminal a vista. Recolher e instantaneo, e nada aqui chama
  `fit()`: o `ResizeObserver` de cada painel ja pega a largura nova com o debounce dele — o mesmo
  caminho da troca de densidade.
- **O Ctrl+B e registrado na fase de CAPTURA, com `stopPropagation`.** O xterm escuta no proprio
  textarea, que e mais fundo que a `window`: em captura o ouvinte roda ANTES dele e o terminal nunca
  recebe o `\x02`. Em fase de bolha (que e como o Ctrl+K da paleta esta) a tecla chegaria ao PTY
  **alem** de alternar a lateral. O teste cobra isso comparando o buffer do terminal antes e depois.
- **Recolher nao pode esconder o unico caminho para nada.** Dois pontos ficavam so ali: o
  interruptor de hooks, que virou item da paleta, e o **aviso de versao nova** — atualizacao nunca
  vira dialogo neste app, entao o botao no rodape da lateral era o unico canal. Dai o
  `data-atualizacao` que o `mostrarAtualizacao()` escreve no `#app`: com a lateral fechada e uma
  versao disponivel, acende uma bolinha no proprio botao de recolher.

## O slot personalizado da grade (a quarta densidade)

`src/janela/personalizado.js`. A quarta pilula ao lado de 1/2/3 (tecla **4**), onde cada painel pode
ter um tamanho diferente: dois terminais grandes lado a lado e dois pequenos dividindo a terceira
coluna, por exemplo.

- **A altura deixa de ser fixa e vira span de LINHAS.** `#app[data-densidade="p"]` troca
  `.painel { height: var(--altura-painel) }` por `height: auto` e poe `grid-auto-rows` no `#grade`;
  cada painel ganha `grid-column: span C` / `grid-row: span R` inline. O posicionamento automatico
  do CSS Grid acomoda o resto — **nenhuma coordenada explicita**, nenhuma biblioteca.
- **Sem `grid-auto-flow: dense`.** Empacotamento denso reordena itens visualmente e brigaria com o
  `style.order` que `ordenarGrade()` escreve.
- **O molde e por POSICAO, nao por sessao.** Ele guarda "o primeiro painel e grande, o terceiro e
  pequeno". Tamanho preso a uma feature morreria junto com ela; um molde vale para o proximo
  conjunto de sessoes. A consequencia honesta, e que esta escrita na ajuda: com ordenacao por
  **Urgencia** a FORMA da tela fica parada e quem ocupa o slot grande muda conforme os status mudam.
- **Aplicar pendura no fim de `ordenarGrade()`**, que e o unico ponto por onde toda reordenacao
  passa. Pendurar em outro lugar seria pendurar em varios.
- **`densidade` deixou de ser sempre numero.** `'p'` teve de entrar em tres listas brancas
  (`preferencias.js`, `layouts.js` e a comparacao do `casca.js`) — e a do `casca.js` e a traicoeira:
  `Number('p')` e `NaN`, que nao casa nem consigo mesmo, entao a pilula nunca ficaria marcada.
- A conversao de pixels para celulas soma o `gap` dos dois lados (`(px + 12) / (celula + 12)`):
  N celulas ocupam `N*celula + (N-1)*gap`, e sem isso um painel de exatamente 2 celulas arredondava
  para 1.
- Redefinir e um item da paleta (`tag: layout`). Nao ha botao proprio: o molde se desenha arrastando.
- O molde mora no `ui.json` (`{ cols, alturaLinha, celulas }`), com `normalizar` limitando tudo —
  `npm run teste:preferencias` cobra isso, porque `ui.json` e do usuario e pode ser editado a mao.

**A alca de redimensionar e UMA so, compartilhada com o mapa** (`.painel-alca`, criada sempre no
`_montarDom`). Quem escuta o arrasto e o modulo dono do modo — o mapa encaixa na malha de 20px, este
encaixa em celulas. A cor dela e `--termfg`, e nao `--fg3`: ela cai sempre sobre a faixa de rodape,
que usa o fundo do TERMINAL (escuro nos dois temas), e com `--fg3` ela sumia no tema claro. O rodape
ganhou `padding-right` nos dois modos, senao a alca cobriria o canto do botao **Aprovar**.

## Layouts salvos

`src/main/layouts.js` + `src/janela/layouts.js`, pela paleta (`tag: layout`).

Um layout **nao inventa estrutura**: e o `retratoSessao()` que a grade ja produz, mais as tres
preferencias que o `ui.json` ja guarda. Por isso ficou barato depois da Fase 7 e do redesenho.

- **Salvar com nome repetido SUBSTITUI** aquele layout. Dois "modo revisao" na lista seria a pior das
  duas opcoes.
- **Aplicar fecha os painéis atuais**, entao pergunta antes quando ha sessao rodando, dizendo
  quantas — a mesma regra que fechar o app ja segue.
- Os painéis voltam **dormindo**, como na Fase 7: religar seis sessoes sozinho e caro e ninguem
  pediu. O "Retomar todas" da lateral esta ali para isso.

## O medidor de uso do Claude, no topo

`src/main/uso.js` + `src/janela/uso.js`. Duas barrinhas na barra de titulo (`5h` e `7d`), com o
detalhe num overlay. Responde "posso continuar?" sem voce entrar num painel para digitar `/usage` —
dentro de uma das sessoes que o app existe para voce nao ter de entrar.

- **Nao existe percentual no disco, e isso foi PROCURADO.** Nenhum arquivo de `~/.claude/` guarda
  utilizacao, janela de reset ou status; grep por `ratelimit|resetsAt|weekly|utilization` em todos
  os `.json` de la e nos 710 `.jsonl` de transcrito da zero. E nao ha subcomando `claude usage` —
  `/usage` e so da TUI. Ou se consulta a rede, ou nao se sabe.
- **O contrato saiu de um spike, nao de documentacao** (`testes/uso-real.js`, contra o CLI 2.1.220):
  `GET https://api.anthropic.com/api/oauth/usage` com `Authorization: Bearer <accessToken>` devolve
  200 e, no CORPO, `five_hour`/`seven_day` (`utilization` + `resets_at`) mais um array `limits[]` com
  `kind` (`session`/`weekly_all`/`weekly_scoped`), `percent`, `severity` e `resets_at`.
  - Duas suposicoes tiradas da leitura do binario que o spike **desmentiu**: nao vem cabecalho
    `anthropic-ratelimit-*` nenhum nesta resposta, e o `anthropic-beta` e **dispensavel** (200 sem
    ele). O primeiro plano lia cabecalho e teria lido vazio.
  - `limits[]` e a fonte preferida porque traz `severity` — o servidor dizendo se esta apertado vale
    mais que um limiar de porcentagem inventado aqui. Os objetos soltos ficam de reserva: se a forma
    mudar, o app perde a cor mas nao perde o numero.
  - Chaves de codinome (`tangelo`, `iguana_necktie`, `nimbus_quill`…) vem nulas e sao ignoradas de
    proposito. Nao "conserte" o parser para le-las.
- **O token e lido no instante da chamada e morre ali.** Nao vai para arquivo nosso, nao vai para a
  janela, nao vai para log — nem em caso de erro. Com `expiresAt` vencido o app **nem tenta**: quem
  renova token e uma sessao do Claude, e e isso que a tela diz. O app nao faz refresh de credencial
  de ninguem.
- **Sem consulta, o medidor mostra `—`, nunca um numero estimado.** Chegou a existir uma varredura
  dos transcritos que somava tokens por projeto (com dedupe por `message.id`, porque o `usage` das
  linhas e cumulativo e somar linha a linha inflava 2,4x). Foi **removida a pedido**: a tela mostra
  so as duas barras. Se ela voltar um dia, o dedupe e o primeiro teste a escrever.
- Relogio de 5min, primeira em 15s, **so com a janela visivel** (a guarda do `metricas.js`, nao a do
  updater), e emite so quando algum valor muda.
  - **Um tique perdido nao pode custar cinco minutos.** Abrir o app minimizado pulava o primeiro e o
    proximo so viria no ciclo seguinte, com o medidor vazio e nada explicando. Dai o `aoVoltar` nos
    eventos `show`/`restore`/`focus` e uma retentativa unica 60s depois de falhar — uma so, para
    ficar offline nao virar marretada na rede. Foi o teste que pegou isso.
- Erro **nunca** vira dialogo, como no updater e no `gitDeRede`.
- `src/main/claude-dados.js` passou a ser o unico lugar que conhece o layout de `~/.claude` (raiz,
  codificacao de caminho e credencial); `projetos.conversas` foi para la. A env **`ORQ_CLAUDE`** e
  irma do `ORQ_DADOS` e reaponta a pasta — e o que permite testar o modo sem credencial sem tocar na
  credencial real.
- O botao TEM de ser `<button>`: a regra de arraste da barra de titulo e por TAG
  (`#titulo button, #titulo input { -webkit-app-region: no-drag }`), e um `<div>` ali nasce
  arrastavel e **nao recebe clique nem hover**.
- Compressao em tres degraus (1240 / 1040 / 940px): caem os rotulos, depois a barra da semana,
  depois a semana inteira. A de 5h e a ultima a sair porque e a que muda enquanto voce trabalha.

## Historico de tempo por feature

`src/main/historico.js`. Grava em `~/.orquestrador/historico.jsonl`: **uma linha JSON por transicao,
append-only**.

- **Foge de proposito da gravacao atomica do `arquivo.js`.** Reescrever o arquivo inteiro a cada
  mudanca de status seria caro e cresceria sem limite. Append e O(1), e uma ultima linha truncada por
  queda de energia e descartada na leitura em vez de corromper o resto. A poda, essa sim, usa
  `.tmp` + rename: e reescrita inteira, uma vez por arranque.
- **Intervalo so conta quando tem evento de fechamento.** O `before-quit` grava um `fim` para cada
  sessao viva; sem isso, uma sessao aberta na sexta com o app fechado no fim de semana apareceria
  como "trabalhou 3 dias". Numa queda perde-se o ultimo intervalo — **subcontar e melhor que mentir
  para cima**, e o teste que garante isso e o mais importante do modulo.
- **A chave e feature + projeto, nunca o id do painel.** Id e efemero; a feature sobrevive a fechar e
  reabrir. Mesma decisao ja tomada nas ligacoes, onde a chave e a pasta.
- Uma passagem so: `estado.js` ja e o ponto unico por onde toda transicao vai, entao o historico
  pendura ali (`anotar`) e nao precisa observar mais nada.
- Abre clicando no **placar da lateral** — que ja resume o *agora* e leva ao *ao longo do tempo*.

## Diff dentro do app

`worktrees.diff()` mais `src/janela/diff.js`.

- **`base...branch` com TRES pontos**, nao dois: tres pontos mostra o que a branch fez desde que
  divergiu. Com dois, commits que outra pessoa colocou na base apareceriam como se fossem seus,
  invertidos.
- **Arquivo novo nao rastreado NAO aparece no `git diff`** — e a etiqueta da lateral ja o conta como
  alterado, entao o diff mostraria menos do que a etiqueta prometeu. Resolvido com
  `diff --no-index -- /dev/null <arq>`, que sai com codigo 1 quando ha diferenca (sempre, aqui) e
  por isso tem o stdout lido do erro. `git add -N` resolveria tambem, mas **mexeria no indice do
  usuario** — este app nao faz isso.
- **Um arquivo por vez no DOM.** Nao e estetica: um diff de 200 arquivos renderizado inteiro sao
  dezenas de milhares de nos. Lista a esquerda, hunks de um arquivo a direita, e a arvore fica
  pequena por construcao — sem virtualizacao e sem biblioteca.
- Teto de 400 KB por lado, com aviso explicito de truncagem. Travar em silencio e pior que dizer
  "cortei aqui".

## Overlays: a pilha e por ordem de ABERTURA

`OrqOverlays` em `casca.js` registra ajuda, seletor, paleta, modal, historico e diff. O Esc fecha **o
topo da pilha**, e o `z-index` acompanha a mesma ordem.

Com ordem do HTML — que foi a primeira tentativa — abrir o historico com a ajuda aberta mostrava a
ajuda por cima (ela vem depois no documento) enquanto o Esc fechava o historico: **voce via um e
fechava outro**. Quem detecta a abertura e um `MutationObserver` no atributo `hidden`, e nao um aviso
que cada modulo precisa lembrar de dar.

## A ajuda dentro do app

`src/janela/ajuda.js`, aberta pelo botao na lateral ou por **F1**.

O conteudo e uma **estrutura de dados**, nao HTML solto, e isso resolve dois problemas de uma vez:

- **O indice se monta a partir das mesmas secoes que o corpo**, entao nao ha como um ficar sem o
  outro. O teste confere que a contagem bate e que nenhum item aponta para secao inexistente.
- **Os numeros vem das constantes reais** (`{portaBase}`, `{tetoFila}`, `{pastaDados}`…), servidas
  pelo IPC `app:constantes`. Documentacao que repete constante a mao vira mentira na primeira
  mudanca de codigo, e ninguem percebe. `npm run teste:ajuda` compara o texto renderizado com os
  valores que o app usa de verdade, e falha se divergirem ou se algum `{marcador}` escapar.

## Ligar sessoes entre repositorios

`src/janela/ligacoes.js`. Uma feature que atravessa repos (backend num, frontend noutro) vira duas
sessoes que enxergam o codigo uma da outra, via `--add-dir` / `/add-dir` do proprio Claude Code.

**Tres regras medidas contra o CLI 2.1.220, nao presumidas:**

1. **Escrever `"texto\r"` de uma vez NAO envia nada para a TUI do Claude.** O CR vira quebra de linha
   e o texto fica parado na caixa de entrada — comportamento de colagem. Tem de digitar, esperar
   ~700ms, e mandar o `\r` separado. E o que `enviarLinha()` faz, e vale para qualquer injecao futura
   (o extra de "colar prompt em varias sessoes" vai precisar da mesma coisa).
   Com o `cmd.exe` funciona de qualquer jeito, porque ele nao e TUI — por isso o `comandoInicial`
   nunca sofreu com isso.
2. **`/add-dir` abre um prompt de confirmacao** ("Add directory to workspace") com tres opcoes. Sem
   responder, a ligacao nao acontece. O app responde a opcao 1 (*this session*), **nunca** a 2
   (*remember*), que mudaria estado alem da sessao sem o usuario ter pedido.
3. **Lancar com `--add-dir` NAO pede confirmacao.** Por isso sessao nova ja nasce ligada e so a
   sessao viva precisa da danca acima.

Detalhes que decidem correcao:

- **Ligacao e entre PASTAS, nao entre ids de painel.** Id e efemero (`p1-msn...` muda a cada
  abertura); pasta sobrevive ao fechar e reabrir, e e o que o `--add-dir` consome.
- `comAddDir` insere a flag **depois de `claude` e antes dos argumentos** (`cls && claude --add-dir
  "..." -w feat`), com o caminho **entre aspas** — `C:\Program Files\...` sem aspas viraria dois
  argumentos.
- **Mutua entre painéis, so de ida para projeto sem painel**: nao ha sessao do outro lado para
  receber a contrapartida, e o seletor diz isso na etiqueta.
- **Nao existe `/remove-dir`**: desligar limpa o registro dos dois lados, mas a sessao em andamento
  so perde o acesso ao reiniciar. A interface avisa em vez de fingir que sumiu.
- Ler o buffer do terminal para achar o prompt de confirmacao e uma excecao consciente a regra de
  nunca interpretar bytes do Canal 1 — e nao e status, e uma interacao pontual que o proprio app
  acabou de provocar. Se o texto mudar, o pior caso e um Enter sobrando numa caixa vazia.

**O registro so existe depois de o CLI concordar** — e este era o defeito relatado como "nao esta
ligando". Antes `ligar()` gravava `p.ligacoes` **antes e independentemente** do lado do CLI, e
descartava o resultado. Falhou? O registro ficava, o seletor ja mostrava "desligar", e a proxima
tentativa caia no `novo === false` e **nao mandava nada**: a falha virava permanente e sem saida pela
interface.

- Sessao viva grava **so depois** de a sessao responder; painel dormindo grava sem aplicar (a flag
  entra na proxima partida) e o toast diz isso.
- Falha deixa a ligacao **pendente**, e o seletor troca o botao para **aplicar** — e o que devolve a
  chance de tentar de novo. O campo e **`p.ligacoesPendentes`**, e o nome comprido e cicatriz: ele se
  chamava `pendentes`, que **JA EXISTIA no Painel** guardando os `Uint8Array` de saida de painel fora
  da vista (Fase 6.1), com `pendentesBytes` contando o total. Uma ligacao que falhava empurrava uma
  **string** naquele array sem mexer no contador, e o `descarregarPendentes()` seguinte alocava um
  buffer menor que o conteudo e fazia `junto.set(string, off)`: bytes viravam zero, e o offset podia
  estourar com `RangeError`. O sintoma seria a saida de OUTRO painel — um que estivesse rolado para
  fora da tela — voltando corrompida, longe o bastante da causa para custar uma tarde. Ele tambem
  passou a ir para o `sessao.json`: sem isso, reabrir o app transformava toda ligacao pendente em
  "aplicada" na interface, e o botao de tentar de novo sumia.
- A leitura do buffer olha so o que chegou **depois** do envio: o `textoDoBuffer()` inclui o
  scrollback, entao uma confirmacao de dez minutos atras casava na primeira volta e o app disparava
  um Enter no que estivesse na tela. Na pratica a **segunda** ligacao de uma sessao nao fazia nada e
  reportava sucesso.
- Toast em toda recusa, e portao por status: em `esperando` o app **recusa** escrever, porque o
  caminho seria digitado dentro do seletor de permissao — que responde a digitos.
- Medido no spike: **o Enter confirma o `/add-dir`** (diferente do prompt de permissao, que exige o
  digito), e as opcoes sao `Yes, for this session` / `Yes, and remember this directory`. A marca
  `Add directory to workspace` esta certa — confirmada como o `title` do dialogo no binario. O que
  falhava era a leitura, nao a marca (ver a secao sobre `isWrapped`).

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
- **Os portoes sao todos LOCAIS: `push` nao libera nada.** Nao ha nenhuma checagem de remoto no app;
  o portao e `git log <base>..<branch>`. Branch com push e sem merge na base **e recusado**, e nada
  aqui apaga branch remoto. Quem libera e o merge na base.
- **Arquivo IGNORADO pelo git some junto, e nenhum portao via isso.** `git status --porcelain` nao
  lista ignorado, e `git worktree remove` apaga sem reclamar — o `.env` ia embora em silencio, e e
  este mesmo modulo que incentiva copia-lo para dentro do worktree pelo `.worktreeinclude`. Agora
  `ignorados()` (`git ls-files --others --ignored --exclude-standard`) entra no `listar()` e o
  dialogo **nomeia** o que vai apagar. Nao bloqueia: so para de apagar calado.
- **Fechar o painel nao apaga NADA.** `destruir()` mata a arvore de processos e limpa a tela; nao ha
  uma chamada de filesystem ou git em todo esse caminho. Apagar exige o `×` da linha do worktree, com
  dialogo cujo padrao e Cancelar.
- Todos os comandos usam `execFile` com argumentos em **array**: os caminhos vem do usuario e podem
  conter espaco ou `&`.

### A faxina (`limpeza.js`), e por que ela precisou existir

A consequencia honesta do item acima: pasta, branch **e o lock com o PID ja morto** ficam no disco
para sempre. Cada worktree e um checkout inteiro, com `node_modules` proprio — uma feature por dia
vira alguns GB por semana que ninguem ve, porque o unico caminho para limpar era o `×` de uma linha
dentro de um card expandido, uma por vez. Foi relatado como pergunta: *"com o tempo nao vai encher o
computador?"*. Vai.

`src/janela/limpeza.js` e a **mesma acao em lote**, com o que interessa na frente. O que ela NAO faz
e igualmente importante: **nada automatico**. Continua valendo a regra da casa — so apaga por clique
explicito, e com o dialogo nativo nomeando o que vai embora, inclusive os arquivos que o git ignora.

- **`candidata` e derivado, nao regra nova.** Sai de `podeArquivar(wt).pode`, dentro do `listar()`.
  Reimplementar o criterio na tela era o caminho curto para a lista dizer uma coisa e o clique fazer
  outra.
- **`tamanhoDe()` e assincrona e fica FORA do `listar()`.** O `listar()` e sincrono e roda ao
  expandir um projeto; somar bytes de um checkout com `node_modules` sao dezenas de milhares de
  `stat`. Medido aqui: 10.091 arquivos e 5,6 GB em **270ms** com os `stat` em lote por diretorio —
  rapido, mas nao a ponto de merecer entrar no caminho sincrono. Tem teto de tempo, e o parcial se
  declara (`≥ 400 MB`) em vez de mentir para baixo.
  - O corte usa `Date.now() >= limite`, e nao `>`: com teto zero o certo e nao varrer nada e se
    declarar parcial. Com `>`, uma pasta pequena varrida dentro do mesmo milissegundo voltava
    `parcial: false` para um teto que nao permitia trabalho nenhum. Foi o teste que pegou.
- **`ultimoCommit` e a data do COMMIT, nunca o `mtime` da pasta.** Um `npm install` ou um build
  reescreve arquivo e faria uma worktree parada ha um mes parecer de hoje.
- **Lote nao e um laco de `arquivar`.** `triarLote()` separa apto de recusado ANTES de perguntar (o
  dialogo tem de listar o que vai acontecer de verdade), e `arquivarVarias()` executa **em
  sequencia** — sao varios comandos git no mesmo repositorio, e o git nao gosta de concorrencia no
  index. Cada `arquivar` revalida tudo por dentro, entao uma sessao que suba no meio do lote ainda
  encontra portao fechado. Uma recusa no meio **nao derruba as outras**, e volta com motivo: mesma
  razao pela qual `projetos.adicionarVarios` existe.
  - As duas ficam no **modulo**, e nao no handler, porque handler de IPC nao da para testar em Node
    puro. O `index.js` so acrescenta o portao que so ele conhece (painel aberto na pasta) e o
    dialogo.
- **Impedida aparece na lista, desmarcada e travada.** Some-la esconderia justamente a worktree que
  voce quer entender por que nao sai.
- O contador no card (`N worktrees · N prontas para arquivar`) e o que transforma "nunca lembro de
  limpar" em "da para ver que esta sujo".

### O lote era QUADRATICO, e o sintoma foi "a aplicacao crashou"

Relatado assim: limpar umas dez worktrees de um projeto funcionou, e o app morreu no fim. **Nao era
crash.** `arquivar()` chamava `listar(projeto)` para achar o alvo (`worktrees.js`), e `listar()`
dispara `2 + 4N` comandos git **sincronos**. Num lote, cada item relia o projeto inteiro:
`Σ(6+4k)` — 34 comandos com 3 worktrees, **280 com 10**. Somando a triagem, a abertura da tela e o
pos-lote, dava **~379 comandos sincronos**, e o processo principal ficava **20-60s sem responder**:
sem IPC, sem hooks aceitos, e o Windows oferecendo fechar a janela que nao responde.

Tres consertos, e o primeiro e o que importa:

- **`lerUma(projeto, caminho)`, 3 comandos em vez de 42.** `podeArquivar` le **so campos do alvo** —
  conferido campo a campo —, entao revalidar o projeto inteiro nunca foi necessario. A invariante
  ("`arquivar` revalida tudo na hora") e sobre **frescor**, e continua de pe: o teste tranca a
  segunda worktree com PID vivo **entre** a triagem e a execucao e exige a recusa. Receber o objeto
  ja triado, ou memoizar o `listar` por lote, foram **recusados** — os dois congelam o mundo no
  instante da triagem, que e exatamente o cenario que o portao existe para pegar.
- **Git assincrono no caminho de ESCRITA** (`gitLento`). Ceder o loop so entre itens nao resolveria:
  o comando caro e o `worktree remove` apagando `node_modules`. `listar()` continua sincrono — e o
  que mantem `teste:worktrees` rodando em Node puro, sem app. A sequencialidade continua de
  proposito (`for` com `await`, nunca `Promise.all`).
- **`timeout` no `git()`**, que nao existia: 15s para leitura, 120s para `worktree remove` (apagar
  5 GB legitimamente passa de 15s, e matar no meio deixa o meio-arquivamento que este modulo
  proibe). **Timeout chega com `err.stderr` VAZIO**, e a recusa saia como
  `"Nao consegui remover o worktree: "` — frase cortada. `motivoDoErro` traduz.

Medido pelo teste, que conta spawns de git e falha se o custo voltar a crescer: **lote de 5 passou
de 90 para 31 comandos**, e o `teste:worktrees-ui` prova que `cdp.avaliar('1+1')` responde em **1ms**
no meio do lote.

Junto vieram: `worktree prune` **uma vez por lote** em vez de uma por item; progresso na tela
(`worktrees:progresso`, com o callback no MODULO e nao no handler, porque handler de IPC nao se
testa em Node puro); `try/finally` no `arquivarMarcadas` (sem ele, qualquer rejeicao do main deixava
o botao preso em `arquivando…` **para sempre**, e era por ai que toda excecao virava "travou" na
tela); e o pos-lote deixou de chamar `abrir()`, que **reabria o overlay ja fechado com Esc**.

### `dentroDe`, e a rede de seguranca que faltava

- **O portao de painel aberto comparava caminho EXATO.** Painel aberto em `<worktree>/src` passava, e
  o `worktree remove` apagava a pasta debaixo do terminal de alguem. `dentroDe(pai, filho)` exige
  `pai + separador` — sem isso `wt-auth` casaria com `wt-auth-refresh`.
- **Nao existia `uncaughtException` nem `unhandledRejection` em todo o `src/`.** Este processo
  hospeda as sessoes: quando ele morre, todas morrem junto. O caminho mais exposto era o
  `setImmediate` do `eventos.js`, que roda para **todo hook que chega** e nao tinha guarda nenhuma —
  um throw ali matava o app em silencio. Agora sao duas camadas (a global no `index.js`, e um
  `try/catch` dentro do `setImmediate`, que e o unico lugar que sabe QUAL hook quebrou), e as duas
  so **logam**. Nunca dialogo: excecao que se repete viraria fila de modais em cima de sessoes
  rodando. O custo assumido — rede global mascara defeito — e mitigado pelo prefixo
  `[falha-contida]` e pela stack inteira no log.

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
- **Importar em lote nao e `adicionar` num laco.** `adicionar` **lanca** quando a pasta nao existe, e
  um caminho torto derrubaria a importacao inteira; e `gravar()` reescreve o arquivo todo, entao N
  projetos seriam N ciclos de escrita atomica. `adicionarVarios` acumula, grava **uma vez**, e devolve
  `{ novos, jaExistiam, recusados }` — cada recusa com motivo, em vez de uma excecao. Um toast so com
  o resumo: o toast e um de cada vez, e N deles se atropelariam.
- **A faixa de portas do lote sai de `proximaFaixa()`**, o proximo bloco de 100 livre a partir de
  3100. As tres faixas fixas do modal servem para cadastrar um projeto; dez de uma vez nao cabem
  nelas.
- **`app:escolherPastas` e handler SEPARADO do `escolherPasta`**, e nao um parametro nele: o "Painel
  avulso" depende do contrato de string unica, e trocar o retorno para array quebraria aquele caminho
  em silencio.
- **Clicar num projeto com conversa anterior pergunta** antes de abrir: sessao nova, ou retomar. O
  "retomar" e `cls && claude -r`, que abre o **seletor do proprio Claude** dentro do painel — o app
  nao precisa saber id de sessao nenhum. A contagem sai de
  `~/.claude/projects/<caminho-codificado>/*.jsonl`, com a codificacao trocando `:`, `\`, `/` e `.`
  por `-` (conferida em 19 pastas reais). Isso e layout **interno** do CLI: se mudar, a contagem vira
  zero e o app so deixa de oferecer o retomar — degrada sem quebrar. Worktree tem pasta propria,
  entao a contagem de um projeto nao inclui as conversas das worktrees dele.

## A cor do projeto, e o tom da worktree

`tintaDe()` em `projetos.js` sorteia entre `--proj-1..10` (`estilo.css`), **paleta propria**. Antes a
lista era `['var(--acc)', 'var(--info)', 'var(--warn)', ...]`: um projeto podia nascer com a cor de
"rodando" e outro com a de "esperando", e cor que significa duas coisas nao significa nenhuma.

- **A faixa vai no FRAME do painel** (`.painel-tinto::before`), e nao dentro da pill: abaixo de 260px
  de largura o `@container` esconde a pill inteira — justamente quando ha muitos painéis e
  identificar e mais dificil.
- **Nao pode ser `border-color`**: a borda do painel ja carrega foco (`--acc`), esperando
  (`--warn-linha`) e alvo de arrasto.
- **Worktree e a mesma cor mais clara** (`color-mix` contra `--bg1`, em `tintaDaPasta`), e nao uma
  cor diferente: `api` e `api/auth-refresh` tem de se ler como parentes. Quem distingue os dois e o
  `dentro` que `projetoDe()` passou a devolver.
- **Sortear e estavel, mas nao distinto.** Com dez tons, duas pastas caem na mesma cor cedo ou tarde
  — foi relatado. Duas respostas: projeto novo nasce com a cor **menos usada** (`proximaCor()`, no
  processo principal, e o lote de importacao conta os que ele mesmo acabou de criar), e da para
  escolher a mao clicando no quadradinho da arvore (`cor-projeto.js`). O que se guarda no
  `projetos.json` e o **indice** 1..10, nunca o valor: o token e quem decide o tom em cada tema, e um
  `#a78bfa` gravado ali ficaria errado no tema claro para sempre. Sem `cor` valida, volta ao sorteio.
- **Chip vazio nao e chip.** `.projeto-marca` e criada SEMPRE e so recebe texto em dois ramos
  (`sumiu`, `sem git`) — sem `else` e sem guarda no append. Com `border` e `padding`, o vazio virava
  uma pilula de ~12x4px na linha de **todo projeto saudavel**, mais os dois `gap: 9px` em volta.
  Resolvido com `.projeto-marca:empty { display: none }`, e nao com uma condicao no append: a regra
  vale para qualquer ramo futuro, e `:empty` (0,2,0) vence `.projeto-marca` (0,1,0), sobrevivendo a
  alguem acrescentar `display` ao bloco de cima — que e a armadilha n1 deste arquivo.
- **`.projeto-expandir` media ~14x11px**, contra os 24x24 da WCAG 2.2 — era o menor alvo de clique da
  lateral, e o relato foi "precisa clicar muito exatamente no icone". O truque para crescer sem
  crescer a linha e `margin: -3px 0` numa caixa de 24px: a altura do conteudo da linha e 18px (a do
  `.projeto-remover`), entao a margem-box continua 18px e a **border-box**, que e a caixa de clique, e
  24x24 de verdade.
  - E ele usa **`disabled` + `visibility: hidden`, nunca o atributo `hidden`**: aquele cai na regra
    global `[hidden] { display: none !important }`, e sumir do flex leva junto um dos `gap: 9px` — o
    quadradinho de cor dos projetos SEM GIT ficava desalinhado de todos os outros. O `teste:projetos`
    compara a coluna do `.projeto-tinta` das duas linhas.
- Um botao de TEXTO nao pode ter id terminado em `-fechar`: existe uma regra generica
  `[id$="-fechar"]` para o `×` dos overlays (26x26 e `margin-left: auto`), e o botao sai deformado e
  fora da caixa. Aconteceu com o "Fechar" deste modal.
- **O cartao da lateral ganhou a cor** — ele nao tinha identidade de projeto nenhuma, so status.
- **`projetoDe()` passou a normalizar `\` e `/`.** Sem isso o mesmo caminho vindo por outra rota
  (o git imprime com barra normal; um dialogo devolve com barra invertida) deixava de casar, e o
  projeto sumia sem erro nenhum — o defeito aparecia como "a cor nao aplicou".
- `mostrarProjeto()` **limpa** o estilo quando nao ha projeto: antes o inline ficava para sempre, e
  descadastrar um projeto deixava a cor dele no painel.

## Ficar em dia com o remoto

`worktrees.situacaoRemoto/buscar/atualizar`. O caso que motivou: o merge acontece **no servidor**
enquanto a sessao trabalha isolada numa worktree, e o checkout principal envelhece sem nada avisar —
invisivel por construcao, porque `baseBranch` e sempre a ref local e nenhum comando do app tocava a
rede.

- **Git de rede tem caminho PROPRIO** (`gitDeRede`), e nao o `git()` de sempre: aquele e
  `execFileSync` e **bloqueia o processo principal** — um remoto lento congelaria a janela inteira.
- **Proibido perguntar.** `GIT_TERMINAL_PROMPT=0` e `GCM_INTERACTIVE=never`: o Git Credential Manager
  abre JANELA pedindo senha, e uma busca de fundo nao pode virar dialogo do nada nem esperar para
  sempre. Sem credencial, falha calado — mesma politica do updater.
- **Atualizar e sempre `merge --ff-only`**, por clique. Fast-forward nao cria merge nem conflito;
  quando nao da, o git recusa e a recusa vira uma linha (as cinco `hint:` dele nao cabem num toast).
- **O portao de arvore suja conta so arquivo RASTREADO** (`--untracked-files=no`): um `.env` ou um
  `dist/` parado na raiz nao impede fast-forward nenhum, e recusar por causa deles seria recusar
  quase sempre.
- A busca periodica fica em **10min, primeira depois de 20s, so com a janela visivel**, e nunca no
  ritmo do `metricas.js` — rede a cada 2s contraria a meta de consumo parado.
- `atrasDaBase` por worktree e o outro lado da mesma conta: a base andou e a worktree ficou.

### O relogio da busca mudou de processo, e nao foi encurtado

Relatado como "as vezes demora a aparecer o botao de pull". **Nao era o intervalo.** O relogio vivia
no RENDERER (`projetos.js`) e tinha tres defeitos somados:

1. `if (document.hidden) return;` **pulava o tique sem reagendar**, com o `setInterval` seguindo
   correndo — um tique perdido custava **dez minutos inteiros**, e abrir o app minimizado jogava fora
   o dos 20s: o primeiro fetch real so saia em **10min20s**;
2. nao havia gatilho nenhum alem do proprio relogio. Expandir um projeto **nao** buscava, e nao havia
   botao manual;
3. a rede era gasta com TODOS os projetos e **o resultado era jogado fora para os fechados** — o
   aviso so era desenhado no card expandido.

`src/main/remoto.js` e o `uso.js` aplicado a isso: `aoVoltar` em `show`/`restore`/`focus`, piso de
60s por projeto, coalescencia por caminho, retentativa unica, e **push** `git:estado` em vez de pull.

- **O relogio TEM de ficar no main**: o renderer nao tem os eventos da `BrowserWindow`, o aviso
  precisa chegar em projeto FECHADO (o que exige push de qualquer jeito), e recarregar o renderer
  zerava o relogio. Ele nao vai dentro do `worktrees.js` porque aquele e **Node puro sem Electron**,
  e e o que permite `teste:worktrees` rodar sem app.
- **Concorrencia 3 nao contraria "o git nao gosta de concorrencia"** — aquela regra e sobre o MESMO
  repositorio, e a coalescencia garante que um repo nunca tem dois `fetch` no ar. Pior caso por ciclo
  caiu de N x 20s (2min com 6 projetos e um remoto morto) para ~40s.
- **`MS_ENTRE` fica em 10 minutos.** Os dois casos reais sao "abri o app agora" e "voltei para a
  janela agora", e os gatilhos resolvem ambos em segundos. Encurtar multiplicaria os `fetch` de fundo
  sem tocar no que doia.
- **Expandir busca, mas FORA do `Promise.all`** — disparado e esquecido. A invariante continua
  valendo: desenhar o card nunca depende de internet; o push corrige a tela quando o fetch voltar.
- **O aviso de atraso saiu para a LINHA do projeto** (`.projeto-atras`, `↓ N`), ao lado da
  `.projeto-marca`. Clicar EXPANDE o card em vez de atualizar: `--ff-only` e seguro, mas um chip de
  20px rodando merge no checkout de alguem e surpresa, e o card aberto e onde a frase inteira
  explica o que vai acontecer.
- **Ganho colateral grande:** cada ciclo chamava `carregarDetalhes` por projeto aberto, e cada uma
  disparava um `worktreesListar` **sincrono**. Com 6 projetos e 1 expandido com 10 worktrees, o ciclo
  caiu de **83 spawns (77 sincronos, ~4,6s de main travado) para 24 (18 sincronos, ~1,1s)**.
- O `ehRepositorio` que abria o `buscar()` saiu: era um comando sincrono por projeto, a cada ciclo,
  para descobrir o que o proprio `fetch` responde de graca.

## Arrastar arquivo para dentro do terminal

`src/janela/anexos.js`. Soltar um arquivo em cima de um painel escreve o **caminho absoluto entre
aspas**, com um espaco no fim. **Nada e enviado** — o Enter continua sendo do usuario, entao da para
escrever a pergunta junto e um arrasto sem querer nao dispara execucao nem custo de token.

- **`preventDefault` no `dragover` E no `drop` da JANELA INTEIRA**, e nao so do painel: sem isso o
  Electron **navega o renderer para o arquivo solto** e o app vira a imagem que voce arrastou.
- **`file.path` nao existe mais desde o Electron 32** (aqui e o 43). Quem devolve o caminho e
  `webUtils.getPathForFile`, chamado no preload — funciona com `sandbox: true`, que e como a janela
  sobe.
- Soltar fora de um painel vira toast: sem isso o arquivo "some" e ninguem entende por que.
- O teste cobre a regra (aspas, e o buffer NAO crescer com resposta) e o `preventDefault`. O arrasto
  do sistema operacional em si nao da para simular: um `File` criado por script nao tem caminho no
  disco, que e justamente o que o `webUtils` devolve.
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
  Redeclarar um `const`/`let` de topo entre eles e `SyntaxError` e o arquivo inteiro nao carrega;
  redeclarar uma FUNCAO nao estoura — a ultima vence em silencio, que e pior. Referencie pelo
  namespace (`OrqP.Painel`) em vez de desestruturar. `npm run teste:ui` falha se dois arquivos
  declararem o mesmo nome. (`casca.js` foge disso por estar inteiro dentro de uma IIFE — e o caminho
  preferido para arquivo novo.)
- **O `root` do `IntersectionObserver` e o `#conteudo`**, que e quem rola. Ver a armadilha 3 acima.
- **Nada de re-renderizar painel.** O xterm e dono do DOM dele; a UI muta o cabecalho, nunca o
  reconstroi. Ordenar a grade tambem e por `style.order`, sem mover nos.
- **Um unico `setInterval` de 1s** para todos os cronometros.

**Canal 2**
- Emita **diffs** (`{ id, status, motivo, desde, pergunta, tipo }`), nunca a lista inteira.
- **O processo principal e o dono do status, e a janela nunca pinta status sem contar para ele.**
  Quem descobre algo pela tela (o farejador do `aprovacao.js`) manda `estado:farejado` — se pintar so
  no renderer, os dois ficam com verdades diferentes e o `aplicar()` seguinte descarta o evento como
  "nao mudou nada", deixando a bolinha presa. Ja aconteceu; ver a secao do farejador.
- O servidor responde 200 **antes** de qualquer processamento (o trabalho de estado vai para
  `setImmediate`). Consumir o corpo antes de responder e ok — e rapido; responder antes de consumir
  faz o curl esperar o proprio timeout.
- Escute so em `127.0.0.1`. Porta fixa 47615, gravada em `~/.orquestrador/porta`.

## O aviso de espera: o que foi medido DENTRO do CLI

Dois relatos de campo, opostos na aparencia e com a mesma raiz: *"estava esperando e nao avisou"* e
*"apareceu 'Esperando voce' numa sessao que ja tinha terminado"*. As respostas sairam de ler o
binario do CLI 2.1.220, nao de supor.

- **O hook de permissao nao pode chegar em menos de ~6 SEGUNDOS.** A funcao que emite a notificacao
  arma um temporizador de `Q3f = 6000` e so dispara se `Date.now() - lastInteractionTime >= 6000` --
  e zera esse relogio quando o dialogo monta:

  ```js
  function ADr(e,t){ useEffect(()=>{UNr()},[]);                    // UNr() zera lastInteractionTime
    Rc(()=>{ if(nkS(Q3f)) dAe({message:e,notificationType:t}) }, n?null:Q3f) }
  var Q3f=6000;  function nkS(e){return Date.now()-MN()>=e}
  async function bz(e){ ... await TL({hookInput:{hook_event_name:"Notification",...},matchQuery:o}) }
  ```

  **Isso corrige um numero desta documentacao.** A tabela de metas diz "permissao -> bolinha amarela,
  medido 71–79ms". O numero e honesto mas mede a perna hook -> bolinha; a perna CLI -> hook nunca
  tinha sido medida. **De ponta a ponta sao ~6s + 71ms.** O `idle_prompt` e pior: 60s
  (`messageIdleNotifThresholdMs: 60000`).
- **Sao OITO tipos de notificacao, e o app registrava dois.** A lista autoritativa esta no binario
  (`matcherMetadata:{fieldToMatch:"notification_type",values:[...]}`):
  `permission_prompt · idle_prompt · auth_success · elicitation_dialog · elicitation_complete ·
  elicitation_response · agent_needs_input · agent_completed`. **`elicitation_dialog` e literalmente
  "Claude Code needs your input"** — sem matcher, uma sessao travada nessa pergunta ficava verde
  para sempre. Hoje o app registra tambem `elicitation_dialog`, `agent_needs_input` e
  `agent_completed`.
- **`idle_prompt` NAO e espera, e virou status proprio (`parada`).** Ele significa "faz 60s que a
  sessao esta parada no prompt" — acabou, ninguem bloqueado. Enquanto ele e o `permission_prompt`
  viravam o mesmo `esperando`, uma sessao que terminava ficava amarela sozinha um minuto depois. O
  amarelo voltou a significar **uma coisa so**: tem pergunta te bloqueando. `parada` fica fora da
  fila e nao notifica.
- **O farejador do Canal 1** (`aprovacao.js`) cobre os 6 segundos: le as duas marcas que ja
  autorizam escrever no PTY e acende o amarelo na hora. So painel visivel, e lendo so a tela
  (`textoDaTela`), sem flush: painel fora da vista nao paga o custo nem perde a economia da Fase
  6.1. E a terceira excecao consciente a regra de nao deduzir status do Canal 1; as outras duas sao
  o `/add-dir` e a leitura da pergunta na faixa.

### O farejador passou a ter DUAS MAOS, e o amarelo deixou de ficar preso

O relato: painel marcado `esperando ha 43s` com o terminal mostrando `* Fluttering… (1m 8s · ↓ 3.9k
tokens)`. Duas causas somadas, e nenhuma se resolvia so acendendo mais cedo.

1. **Havia DOIS DONOS DA VERDADE.** `farejar()` acendia chamando `OrqLateral.definirStatus`, que e
   **so do renderer** — o `preload` nao expunha setter nenhum. O processo principal seguia achando
   `rodando`, entao quando o `PostToolUse` chegava, `estado.aplicar()` comparava com o que **ele**
   guardava, concluia `mudou: false` e **nao emitia diff**. O amarelo aceso pela janela nao tinha
   como ser apagado por hook nenhum: ficava ate um `Stop`. Dai o IPC **`estado:farejado`**, e o
   `estado.definirStatus` que passou a carregar `pergunta`/`tipo` (sem eles, o diff chegava sem os
   campos e `lateral.definirStatus` zerava a pergunta do card).
2. **Prompt RESPONDIDO continua rolando na tela.** Para quem so procura as duas marcas, ele e
   identico a um pendente — e o farejador reacendia a cada 1,5s por cima de uma sessao que ja
   voltara a trabalhar. O comentario antigo do arquivo chamava isso de recurso.

**A regra "so o Canal 2 apaga" foi revista de proposito**, e o que a torna segura e a marca nova:
`MARCA_TRABALHANDO` (`esc to interrupt`, e o rodape de tokens). Ela e **afirmativa** e some assim que
o CLI volta a esperar.

- **Acender:** pedido na tela **e** nenhum sinal de trabalho.
- **Apagar:** sinal de trabalho — **mesmo com o prompt ainda na tela**. Essa ultima parte e o caso da
  captura: exigir que o prompt tivesse sumido deixava o bug de pe. Quem desempata e o tempo verbal
  de cada marca: o prompt na tela e **historico** (pode ter sido respondido ha um minuto), o sinal de
  trabalho e sobre o **agora**.
- **Nunca se apaga pela AUSENCIA do prompt.** O custo de errar e assimetrico: acender a toa e ruido,
  apagar a toa esconde uma sessao bloqueada.

**`PreToolUse` NAO foi registrado, e isso foi MEDIDO** (`npm run spike:aprovacao`, um pedido real
contra o CLI). A ordem dos hooks em volta de um prompt de permissao, com o carimbo de cada um:

```
[  6827ms] PreToolUse
[  8736ms] PostToolUse
[ 11014ms] PreToolUse          <- a ferramenta seguinte, a que vai pedir permissao
[ 17571ms] Notification/permissao
```

Ou seja: `PreToolUse` roda **antes** do prompt — e o gancho que um hook usa para devolver
`permissionDecision` —, entao ele nao marca "permissao concedida". Registra-lo so somaria um hook
por uso de ferramenta (~310ms com o app fechado) sem trazer informacao de status. **Nao tente de
novo.**

O mesmo spike mediu o ganho do farejador: o amarelo acendeu aos **5s**, e o hook so chegou aos
**17,5s** — doze segundos de vantagem, bem mais que os ~6s do temporizador do CLI (aqui o pedido
veio depois de outra ferramenta rodar).

E mediu a separacao das marcas, que e o que torna o apagador seguro: em **14 capturas, ZERO** tinham
prompt e sinal de trabalho na mesma tela. As capturas cruas ficam em
`%TEMP%\orq-spike-aprovacao\capturas.json` — se o CLI mudar a forma do prompt, e ali que se compara.

### `pedidoNaTela` le a TELA, e nao o scrollback

Ela lia `textoDoBuffer()`, ou seja as **3000 linhas** de historico, e `MARCA_PERGUNTA.exec` devolve o
**primeiro** match: a trava que autoriza escrever no PTY podia estar conferindo uma pergunta de dez
minutos atras e liberando um `1` em cima do que estivesse na tela agora. E o mesmo defeito que
`esperarNovoNoBuffer` ja tinha consertado para o `/add-dir` — so que aqui o resultado e uma tecla no
terminal de alguem. Hoje le `textoDaTela({ flush: true })`.

### As FORMAS de pedido, e por que o plano nao ganha botao

Havia uma pergunta so e uma tecla fixa, e os dois viraram mentira quando apareceu o segundo formato:

```
Claude has written up a plan and is ready to execute. Would you like to proceed?
> 1. Yes, and use auto mode
  2. Yes, manually approve edits
  3. Tell Claude what to change
```

Isso nao casava com `Do you want to ...?`, entao a faixa ficava com a frase generica do hook
("Claude Code needs your approval for the plan") e o clique caia no toast **"Nao achei o pedido na
tela"**. Foi relatado com print.

**Ampliar so a regex teria sido pior que o bug**: ali a opcao 1 e `Yes, and use auto mode`, que liga
o modo automatico da sessao inteira. Aprovar por POSICAO ("e sempre a 1") escalaria permissao sem
ninguem pedir — a mesma coisa que o app ja recusa na opcao 2 do prompt de permissao e no "remember"
do `/add-dir`. Por isso o plano entra como forma **reconhecida e NAO aprovavel**: a faixa mostra a
pergunta certa, o amarelo fica correto, o toast de erro some, e o botao nao existe ali. Escolher
entre auto mode e aprovacao manual e decisao de quem trabalha.

O botao nasce presente (o caso comum E o prompt de permissao) e **sai** quando a leitura da tela
volta com uma forma nao aprovavel. Quem protege esse ~1s e a trava de sempre: `aprovar()` reconfere
no CLIQUE.
- **`jaAvisado` era marcado ANTES do teste de foco.** Uma sessao que comecava a esperar com a janela
  na frente queimava ali a unica chance de aviso: ao trocar de janela um minuto depois, nada. Agora
  o aviso fica **pendente** e sai no `blur`. `Stop` tambem passou a avisar (`terminou`), e um
  lembrete insiste uma vez apos 5min. `flashFrame` acompanha todo aviso, porque o toast do Windows
  pode ser descartado em silencio e ele e o unico sinal que sobra.
- **O botao de hooks mentia.** `estaInstalado()` devolvia `true` se **um** hook nosso sobrevivesse em
  qualquer evento — sumindo so as entradas de `Notification`, o verde e o azul seguiam mudando, o
  amarelo morria, e a lateral dizia "ligados". Agora `situacao()` confere o conjunto inteiro e diz
  **`desatualizados`** quando falta algo.

### Desligar os avisos: o portao vai no MAIN, e nao no `lateral.js`

`src/main/avisos.js` concentra os dois canais que incomodam fora da janela (o toast e o
`flashFrame`), com a preferencia `avisos: 'ligados' | 'desligados'` no `ui.json`. Quatro razoes para
ele nao ficar no renderer, e a primeira e a que decide:

1. **O portao no renderer corrompe a contabilidade.** `lateral.js` guarda `jaAvisado` (avisa uma vez
   por episodio) e o lembrete de 5min **exige `jaAvisado.has(id)`**. Desistir ANTES de marcar
   deixaria a sessao sem lembrete para sempre, **mesmo depois de religar**; desistir DEPOIS queimaria
   o slot sem ter avisado. Nao ha posicao boa dentro de `avisar()`. Com o portao no main, a
   contabilidade la continua correta e so o efeito e suprimido.
2. Invariante da casa: o processo principal e o dono da verdade.
3. **`flashFrame` so existe no main**, e e o unico sinal que sobra quando o Windows descarta o toast.
4. **O toast de atualizacao nao passa pelo `app:notificar`** — ele montava o proprio `Notification`.
   Num portao no renderer ele escaparia por construcao. Centralizar matou de quebra a duplicacao do
   handler de clique, que estava copiado no `index.js` e no `atualizacao.js`.

Dois estados, nao tres: o projeto padroniza pares (`aberta/fechada`, `barras/oculto`), e o
meio-termo obrigaria a explicar na ajuda dois canais que a pessoa nem sabe que existem. **O toast de
atualizacao obedece ao mesmo interruptor** — quem desliga esta dizendo "nao me interrompa", e manter
ligado justamente o menos urgente seria o pior resultado; e ali nao se perde nada, porque
atualizacao tem canal DURAVEL (o botao no rodape e a bolinha do `data-atualizacao`).

O `.switch` deixou de ser do `#btn-hooks`: as cores saem da classe `ligado` em
`#lateral-pe button.ligado` (1,2,1), que vence o `.mono` generico (1,1,1) e perde para as regras de
`hooks-parcial` (2,1,0) — que e o que se quer, porque "desatualizados" nao pode se pintar de verde.

**O CDP nao enxerga toast do sistema operacional.** Por isso a DECISAO mora em
`preferencias.avisosLigados()`, que o `teste:preferencias` cobra em Node puro, e o `teste:ui` cobra
so a fiacao da tela.

## O registro de sessoes do CLI: a terceira fonte de status

`~/.claude/sessions/<pid>.json`, lido por `claude-dados.sessoes()` e consumido por
`src/main/registro.js`. Veio da investigacao do **cross-session messaging** anunciado para macOS e
Linux: o recurso e bloqueado no Windows por um portao de plataforma dentro do binario
(`function PS(){ if(Yt()==="windows") return !1; ... }`, antes da flag de rollout e da env — ver
`docs/fase-9-extras.md`, e **nao tente de novo**). Mas o registro que ele usa continua sendo escrito
aqui.

**Medido no `npm run spike:aprovacao`** (que agora amostra o registro no mesmo instante de cada
captura de tela), com um pedido de permissao real contra o CLI 2.1.227:

| momento | tela | app | registro |
|---|---|---|---|
| prompt na tela, 3,7s | `pedido=permissao` | `rodando` | **`waiting`** |
| prompt na tela, 5,3s | `pedido=permissao` | `esperando` | **`waiting`** |
| respondido, 6,3s | `trabalhando=SIM` | `rodando` | `busy` |
| acabou, 7,3s | — | `terminou` | `idle` |

Existe um status **`waiting`**, e ele e **afirmativo**: o CLI dizendo "estou parado esperando a
pessoa", sem deduzir nada de texto de tela. Naquela corrida ele apareceu **1,5s antes do farejador**,
e o hook de permissao nem chegou a disparar antes da resposta (o CLI arma ~6s antes de notificar).

**As regras, e so estas:**
- **`waiting` ACENDE** `esperando` — mesma direcao do farejador, e o erro barato.
- **`busy` APAGA** um `esperando` preso — mesmo papel do `MARCA_TRABALHANDO`, e pela mesma razao: e
  sobre o AGORA. O spike mostrou `busy` so no instante em que a tela tinha sinal de trabalho, nunca
  com o prompt na tela.
- **`idle` nao faz nada.** Sessao ociosa pode ter acabado OU estar esperando voce digitar, e
  confundir os dois foi exatamente o bug do `idle_prompt` acendendo amarelo em sessao que terminou.

O que ele acrescenta ao farejador, que ja faz duas dessas coisas: funciona com **painel fora da
vista** (o farejador so le painel visivel), funciona **sem hooks instalados**, e nao depende de casar
texto de tela.

### A correlacao e pelo NOME, e isso nao e detalhe

Casar por `cwd` esta ERRADO, e o `teste:ui` denunciou na primeira corrida com dois testes de
ordenacao falhando do nada: o registro lista **todas** as sessoes da maquina, entao uma sessao aberta
a mao na pasta do projeto — o desenvolvimento deste proprio app — casava com qualquer painel dali e
passava a mandar no status dele.

O portao e o nome: `montarComando` lanca com **`--name <slug>`**, e esse slug e exatamente o
`feature` do painel. Sessao que o app nao nomeou nao tem como ser provada nossa, e entao **nao decide
nada**. O `cwd` fica como segunda confirmacao, nunca como chave. Consequencia honesta, e preferivel:
painel aberto sem nome de feature (`cls && claude` puro) nao recebe status por esta via.

**`-n, --name` foi medido**: e independente do `-w` (o `(requires --worktree)` que aparece perto no
`--help` e do **`--tmux`**), os dois convivem, e o registro passa a gravar o nome dado — sem ele vem
um `nameSource: "derived"` com um nome que o CLI inventa. De quebra, o titulo do terminal, a caixa de
prompt e o seletor do `/resume` passam a dizer a feature. **Nao confundir com o nome do BRANCH**, que
continua `worktree-<slug>` e nao tem como ser escolhido.

Como todo o `claude-dados.js`, isto e **layout interno e nao contrato**: se mudar, `sessoes()`
devolve vazio e o app volta a depender do Canal 2 e do farejador. Degrada sem quebrar.

### O intervalo de 5s foi medido, e comecou errado

Nasceu em 2s, no ritmo do `metricas.js`. Isso custou **um quarto do orcamento de CPU do app** — e o
`teste:fase2` pegou:

| `MS_ENTRE` | CPU parado, 8 painéis (meta: < 2%) |
|---|---|
| 2s | **1,86%** (1,88 e 1,84 em duas corridas) |
| 5s | **1,63%** |
| 60s | 1,42% |

O custo nao esta em ler tres arquivos de 1 KB: esta em **acordar o processo o tempo todo**, o que
impede o Windows de agrupar temporizadores e deixar a CPU dormir. A licao vale para qualquer relogio
novo aqui — meca antes de escolher a cadencia, e nao copie a do vizinho.

Cinco segundos e o ponto certo porque **so um dos tres ganhos depende da cadencia**: painel fora da
vista e ausencia de hooks valem igual em qualquer ritmo, e "chegar antes do hook" so precisa vencer
os ~6s do temporizador do CLI. Para painel visivel, o farejador ja acende em ~1,5s.

## Ler o buffer do terminal: `isWrapped` decide se funciona

`textoDoBuffer()` e `textoDaTela()` juntam as linhas **respeitando `isWrapped`**: continuacao de
quebra automatica cola na anterior, quebra de verdade vira `\n`. E `OrqPainel.achatar()` colapsa
espacos antes de qualquer comparacao.

Isso nao e polimento — e a diferenca entre achar e nao achar. Medido no spike do `/add-dir`: a
resposta de sucesso chegou partida (`...repo-alvo as` / `a working directory...`) e o
`.includes('as a working directory')` nunca via nada, **mesmo com a ligacao tendo funcionado**. Com
painel de 200px numa grade, isso deixa de ser caso raro e vira o caso normal. As marcas do
`aprovacao.js` tambem deixaram de ser ancoradas em `^...$` pelo mesmo motivo.

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
| Permissao -> bolinha amarela (< 300ms) | **71–79ms** do hook; **~6s** do CLI | ver acima |
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

1. **Janela em segundo plano — a armadilha que mais custa tempo.** O Chromium PAUSA os passos de
   renderizacao, e com eles:
   - `setTimeout`/rAF caem para ~1/s, entao **toda** latencia abaixo de 1s le exatamente ~1000ms;
   - **`IntersectionObserver` e `ResizeObserver` param de ser entregues** — painel rolado para fora
     nunca e marcado invisivel, resize nunca reflui, e o teste falha sem nada ter mudado no app.

   Use `aoFrente(cdp)` de `testes/cdp.js` em qualquer suite que dependa de layout (`fase1`, `fase6`,
   `metas` ja usam). Ele traz a janela para frente e **confirma** que os timers voltaram ao normal
   antes de seguir. Meca latencia por evento (`onWriteParsed`), nunca por polling.
2. **`spawnSync` mentindo sobre o custo do hook.** Com args em array (`['cmd.exe','/c',cmd]`) o Node
   reescapa a string e destroi as aspas do `-H` (o curl descarta o cabecalho calado); com o corpo em
   `input:` (stdin em pipe) o curl espera EOF ate estourar o `-m`. Use um `.cmd` com o corpo por
   redirecionamento de arquivo.
3. **`comando < arquivo` quando o comando termina em `|| exit 0`.** O redirecionamento cola no
   `exit`, e nao no `curl` — que le um stdin vazio e manda `content-length: 0`. O corpo do hook
   nunca chegava, **e nada denunciava**: evento e tipo vao na URL, entao o status mudava do mesmo
   jeito e so o `cwd` e a pergunta se perdiam. Agrupe: `sh -c '{ CMD ; } < arquivo'`.
   O teste que deveria ter pego isso (`resolucao por cwd descendente`) so contava *quantos* painéis
   estavam esperando, e passava com o amarelo que sobrou dos hooks anteriores. Um teste que nao zera
   o estado antes nao esta testando — esta torcendo.
3. **PowerShell aninhado em string.** `-Filter "Name='electron.exe'"` dentro de `powershell -Command`
   perde as aspas e devolve 0, e um teste de RAM passa vazio. Use `-File` com um `.ps1`.
4. **`sh` nao esta no PATH do PowerShell.** `spawnSync('sh', ...)` devolve `status: null` e o teste
   de hooks falha inteiro culpando o app. `testes/fase45.js` resolve o caminho do `sh.exe` do Git.
5. **Processo de medicao contando a si mesmo.** Filtrar processos por uma marca na linha de comando
   pega tambem o `powershell` que faz a contagem, porque a marca esta no comando dele.

Para somar CPU de varios processos, case as amostras **por pid**: somar tudo e subtrair da delta
negativa quando um processo morre entre as duas leituras.

6. **Comparar numero medido COM depurador contra base medida SEM.** O CDP conectado custa ~150 MB.
   Com a base tirada do `npm run perfil` (sem depurador) e o total tirado do teste (com), a conta
   dava 31 MB por painel em vez dos 15 reais — a diferenca era o proprio depurador dividido por
   oito. `fase2.js` agora **mede a base na hora**, com a grade vazia e nas mesmas condicoes: assim
   qualquer overhead comum aos dois lados se cancela, e o numero para de depender de quantas suites
   rodaram antes.
7. **Suite que deixa estado quebra a proxima.** Ja aconteceu duas vezes: `ui.js` deixando painéis no
   `sessao.json` (a `fase7` restaurava os dela mais o que sobrou) e o app deixado no modo mapa (onde
   `style.order` nao tem efeito visual e meia duzia de checagens de ordem falha por nada). Toda
   suite agora **fixa o estado no comeco**, e nao so limpa no fim.

### O que mudou nos numeros com o redesenho

| | Fase 2 | agora |
|---|---|---|
| Base do app, 0 painéis, sem depurador | 283 MB | **330 MB** |
| RAM marginal por painel | 11–20 MB | **15–28 MB** |
| CPU parado, 8 painéis | 0,06–0,1% | **~1,6%** |

Os ~47 MB a mais na base sao DOM e scripts dos overlays (paleta, modais, historico, diff, mapa), nao
custo de painel. O CPU parado subiu porque agora ele e medido com a **janela em primeiro plano**
(`aoFrente` no `fase2`), e quase tudo dele esta no **processo de GPU** compondo as animacoes de
pulso — com a janela oculta o Chromium pausa a renderizacao e o mesmo app le 0,02%. O numero maior e
o honesto: e o caso real, com alguem olhando a tela.

**O orcamento de CPU parado ja esta apertado, e todo relogio novo cobra dele.** Medido: o poller do
`registro.js` a cada 2s levava os 1,6% para **1,86%** — 0,25pp por um modulo que le tres arquivos de
1 KB. O custo nao e o trabalho, e **acordar o processo**: temporizador frequente impede o Windows de
agrupar timers e deixar a CPU dormir. Antes de escolher a cadencia de qualquer relogio novo, rode o
`teste:fase2` com dois valores e compare — copiar o intervalo do modulo vizinho e como este passou
perto de estourar a meta.
