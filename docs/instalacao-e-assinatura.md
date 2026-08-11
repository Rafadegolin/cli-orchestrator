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

## O que resolve

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

Para **você trabalhar hoje**: desligar o SAC nesta máquina, ciente de que não volta.

Para **distribuir para a equipe**: certificado OV. O EV só se valer a pena pagar a mais para não
enfrentar também o aviso do SmartScreen enquanto a reputação não se forma.
