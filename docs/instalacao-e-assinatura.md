# O Windows bloqueou o instalador — diagnóstico e opções

## O que exatamente está acontecendo

Não é o SmartScreen. É o **Controle Inteligente de Aplicativos** (Smart App Control, SAC), do
Windows 11:

> O controle inteligente de aplicativos bloqueou um aplicativo que pode não ser seguro.
> Bloqueamos `Orquestrador-0.1.7-instalador.exe` porque não conseguimos verificar seu fornecedor.

A diferença importa. O SmartScreen mostra "Mais informações → Executar assim mesmo"; **o SAC não tem
botão de contornar** — só "OK" e "Baixe aplicativos da Store".

O log do Code Integrity confirma que é imposição de **nível de assinatura**, não aviso de reputação:

```
Code Integrity determined that a process attempted to load ...instalador.exe
that did not meet the Enterprise signing level requirements
(Policy ID:{0283ac0f-fff1-49ae-ada1-8a933130cad6})
```

`npm run diagnostico` reproduz esse levantamento a qualquer momento: estado da assinatura, estado do
SAC, Mark of the Web e o evento do log.

## O que NÃO resolve

- **Certificado autoassinado, mesmo instalado como confiável nas máquinas de vocês.** A
  [documentação da Microsoft](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)
  é explícita: *"Code can be signed with any certificate, but Smart App Control only considers
  certificates issued by trusted providers."* O SAC valida contra o Microsoft Trusted Root Program,
  não contra a loja de confiança local.
- **Remover o Mark of the Web** (`Unblock-File`). O bloqueio é por nível de assinatura, não por zona
  de origem.
- **Assinatura ECC.** O SAC só aceita **RSA**.
- **Azure Trusted Signing** (hoje Azure Artifact Signing), que custaria US$ 9,99/mês:
  [só atende organizações dos EUA, Canadá, UE e Reino Unido](https://learn.microsoft.com/en-us/azure/artifact-signing/faq).
  Brasil não está na lista e não há previsão.

## O que o SAC julga é a IDENTIDADE do binário — medido em 11/08/2026

Esta seção dizia que o zip portátil era a saída grátis. **Estava errada**, e o erro tinha uma causa
clara: a medição fora feita com o executável compilado na própria máquina, que já rodara dezenas de
vezes ali. Testar o binário que a gente mesmo acabou de compilar não responde "o que acontece com
quem baixa".

Refeito, com o SAC em estado 1 (forçado):

| o que se testou | resultado |
|---|---|
| release baixada do GitHub, extraída, executada | **bloqueada** — evento 3077 |
| o exe extraído tinha Mark of the Web? | **não** (`Expand-Archive` não propaga) — e foi barrado assim mesmo |
| o app **recém-compilado aqui** (`dist\win-unpacked`) | **bloqueado** |
| o mesmo exe copiado para fora do OneDrive | **bloqueado** |
| `node_modules\electron\dist\electron.exe` (também **sem assinatura**) | **roda** |

As três primeiras linhas matam qualquer conserto pelo lado do arquivo: nem desbloquear, nem mudar de
pasta, nem compilar localmente. **Compilar na máquina também não resolve** — o binário sai novo no
mundo e a nuvem não o conhece.

A última linha é a que abre a saída. O `electron.exe` não é assinado e mesmo assim passa, porque é
**byte a byte o mesmo** para todo mundo que instala o Electron 43: a nuvem da Microsoft já sabe o que
ele é. Quem destrói essa reputação é o electron-builder, que renomeia o executável e reescreve ícone
e metadados — aquele hash passa a ser único, e único é o mesmo que desconhecido.

## A saída grátis de verdade: o pacote `-sac`

`npm run empacotar:sac` (`recursos/empacotar-sac.js`) monta um pacote que **não renomeia nada**: o
`electron.exe` original, intocado, com o nosso `resources/app.asar` ao lado — que é exatamente como o
Electron espera receber um app.

**Medido de ponta a ponta com o SAC ligado**, simulando o caminho real (zip com Mark of the Web da
zona internet, extraído sem desbloquear): abre, o xterm carrega de dentro do asar e o `node-pty` sobe
terminal de verdade. `npm run teste:sac` refaz essa prova.

O preço é cosmético, e está no `LEIA-ME.txt` do pacote:

- o processo aparece como **electron.exe** no Gerenciador de Tarefas;
- não há desinstalador: apagar a pasta remove o app.

**Atualizar não exige voltar aqui.** Entre duas versões nossas, quase sempre só o `app.asar` muda — 4
MB contra os 142 do pacote. Então o app baixa esse arquivo, confere o SHA-256 publicado e troca ao
reiniciar; a troca em si é um `.bat` que espera o `app.asar` ser solto (ele fica mapeado em memória
enquanto o app roda), renomeia o antigo para `.bak`, põe o novo e reabre. O pior caso é continuar na
versão velha — nunca ficar sem app. Quando o Electron ou o node-pty mudam de versão, o asar novo não
casa com o runtime no disco: aí não há troca leve, e o aviso manda baixar o pacote inteiro dizendo
por quê.

**O ícone precisou de duas coisas, não uma.** A janela aberta veste o `icon` da `BrowserWindow` — por
isso o `recursos/icone.ico` entra no asar. Mas **fixar na barra de tarefas não guarda a janela**:
guarda um atalho para o executável, e o Windows lê o ícone dos recursos do `.exe`, que é o do
Electron. Daí `Ctrl+K → Criar atalho no menu Iniciar`, que grava um `.lnk` com o nosso `.ico` e o
mesmo `AppUserModelID` que o app declara — é esse id que faz o Windows tratar a janela aberta e o
atalho fixado como a mesma coisa. O `.lnk` é criado na sua máquina, e não vai dentro do zip: ele
grava caminho absoluto e viajaria quebrado.

**Uma armadilha que só apareceu aqui:** `app.isPackaged` responde pelo **nome do executável**, e como
o nosso se chama `electron.exe`, o app se via em desenvolvimento. O updater se desligava sozinho — o
aviso de versão nova simplesmente nunca chegaria, sem nenhum erro. A pergunta certa é se o código
está sendo lido de dentro de um `.asar`.

**A garantia do pacote inteiro é uma linha:** o script compara o SHA-256 do `electron.exe` copiado
com o do npm e aborta se diferirem. Se algum passo tocar no executável, ele volta a ser bloqueado — e
o sintoma seria apenas alguém dizendo que não abre.

### Qual baixar

| Se o SAC estiver... | Baixe |
|---|---|
| **ligado** | `Orquestrador-X.Y.Z-sac.zip` → extrair → `Orquestrador.cmd` |
| desligado | `...-instalador.exe` (com atalho e auto-atualização) ou `...-portatil.zip` |

Com o SAC desligado, desbloquear o zip antes de extrair continua valendo — não pelo SAC, mas para
evitar o aviso do SmartScreen, que é outra coisa e essa sim tem "Executar assim mesmo".

### O que se perde

**A auto-atualização não se aplica sozinha.** Aplicar exigiria rodar o instalador, que é justamente o
que está bloqueado. O app detecta que está rodando em modo portátil (não há desinstalador ao lado do
executável) e, em vez de baixar, o aviso vira **"Baixar a versão X"**, abrindo a página da release.
Atualizar passa a ser: baixar o zip novo, desbloquear, extrair por cima.

Os seus dados não moram na pasta do app — projetos, sessão e porta ficam em `~/.orquestrador` —,
então substituir a pasta não perde nada.

## O que resolve de forma definitiva

### 1. Desligar o Smart App Control — grátis, imediato, e sem volta

`Segurança do Windows` → `Controle de aplicativos e navegador` → `Configurações do Controle
inteligente de aplicativos` → **Desativado**.

⚠️ **Uma vez desligado, só volta reinstalando o Windows.** É decisão de postura de segurança da
máquina, não uma configuração que se testa e reverte. Em máquina de desenvolvimento é uma escolha
comum e defensável; em máquina de usuário final, pense duas vezes.

Resolve para quem desligar, e só para essa máquina.

### 2. Certificado de code signing de uma CA do Microsoft Trusted Root Program

É a única saída que funciona para todo mundo sem mexer na segurança de cada máquina.

| | OV (Organization Validation) | EV (Extended Validation) |
|---|---|---|
| Custo aproximado | R$ 1.000 a 2.500/ano | mais caro |
| Satisfaz o SAC | sim (assinatura de CA confiável) | sim |
| Reputação no SmartScreen | vai sendo construída com o tempo | imediata |

Pontos práticos que costumam pegar de surpresa:

- **Desde 2023 a chave precisa viver em hardware** (token FIPS 140-2 nível 2) ou em HSM na nuvem.
  Não existe mais o `.pfx` que se copia para onde quiser.
- **Com token físico, o CI não consegue assinar.** O GitHub Actions não tem como plugar o token,
  então ou a assinatura passa a ser feita localmente antes de publicar, ou é preciso um serviço de
  assinatura em nuvem (alguns CAs oferecem HSM gerenciado com API).
- Precisa ser **RSA**, não ECC.

### 3. Microsoft Store

Aplicativo da Store é confiado automaticamente. É outro processo de publicação e provavelmente
desproporcional para uma ferramenta interna.

## O build já está pronto para assinar

Nada mais precisa ser configurado no `electron-builder.yml`. Basta ter as variáveis antes do build:

```
CSC_LINK           caminho do .pfx, ou o conteúdo em base64
CSC_KEY_PASSWORD   senha do .pfx
```

No CI, os mesmos valores vêm dos secrets `WINDOWS_CERT_BASE64` e `WINDOWS_CERT_PASSWORD` — já ligados
no workflow. **Sem os secrets o build continua funcionando**, só sai sem assinatura.

Para certificado em token de hardware não há `.pfx`: aí a assinatura sai por `signtoolOptions` com
`certificateSubjectName`, e só na máquina com o token plugado.

Depois de assinar, confirme com `npm run diagnostico` — ele mostra emissor, algoritmo e avisa se a
assinatura for ECC.

## Recomendação

**Comece perguntando pelo SAC** (`npm run diagnostico` responde).

- **SAC ligado** — o pacote `-sac`. Custa zero, funciona para quem baixa (não só para quem tem o
  repositório) e não exige mexer na segurança da máquina. O preço são as três diferenças cosméticas
  da seção acima.
- **SAC desligado** — o instalador, que dá atalho no menu Iniciar e auto-atualização.

Desligar o SAC também resolve e é grátis, mas **não tem volta sem reinstalar o Windows**. Com o
pacote `-sac` no ar não há mais motivo para pedir isso a ninguém.

Certificado OV continua sendo a única solução completa — ela devolve o instalador e a
auto-atualização para todo mundo. Só vale se o app sair da equipe, ou se as diferenças cosméticas do
pacote `-sac` passarem a incomodar.
