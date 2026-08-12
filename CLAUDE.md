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
npm run teste:layouts     # Node puro: gravar, substituir e normalizar layouts
npm run teste:ajuda       # a ajuda no app, e se os numeros dela batem com o codigo
npm run teste:ligacoes    # mecanica das ligacoes, sem invocar o Claude
npm run teste:ligacoes-reais # com Claude de verdade: ~3min e consome tokens
npm run teste:aprovacao-reais # aprovar um pedido real: ~2min e consome tokens
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
    de quem usa, pela paleta: ele grava caminho absoluto e viajaria quebrado dentro do zip.
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
- Desinstalar roda `--remover-hooks` pelo `recursos/instalador.nsh`. Sem isso os hooks ficariam no
  `settings.json` para sempre e toda sessao pagaria ~310ms por evento falando com um app que nao
  existe mais.

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
- **Preferencias em `ui.json`** (`preferencias.js`), separado do `sessao.json`: arranjo muda o tempo
  todo e e regravado com debounce, preferencia muda por clique. Juntar faria toda troca de tema
  reescrever a lista de painéis.
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
- Posicoes vao para o `sessao.json`, com `x`/`y` normalizados como os outros campos.
- **No mapa, densidade e ordenacao somem da toolbar**: `--cols` nao se aplica a elemento posicionado
  e `style.order` idem. Controle que existe e nao faz nada e pior que controle ausente.
- Arrastar e pelo CABECALHO. Pelo corpo roubaria a selecao de texto do terminal.

### O `<svg>` dentro do `#grade` quebrou a ordem dos painéis

As linhas do mapa vivem num `<svg>` que fica como filho do `#grade`. `retratoSessao()` numerava a
ordem pelo indice de **todos** os filhos, entao o svg empurrava todo painel em um e a Fase 7 gravava
`1,2,3` no lugar de `0,1,2`. `atualizarVazio()` tinha o mesmo defeito: contava filhos e achava que
havia sessao aberta com a grade vazia.

Ambos agora contam PAINEIS (`porId`), nunca filhos do elemento. **Nao presuma que todo filho do
`#grade` e um painel.**

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
- Ler o buffer do terminal para achar o prompt de confirmacao e a **unica** excecao a regra de nunca
  interpretar bytes do Canal 1 — e nao e status, e uma interacao pontual que o proprio app acabou de
  provocar. Se o texto mudar, o pior caso e um Enter sobrando numa caixa vazia.

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
