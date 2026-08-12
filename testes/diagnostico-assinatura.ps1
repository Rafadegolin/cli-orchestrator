# Por que o Windows bloqueou o instalador?
#
# Responde as quatro perguntas que decidem o remedio, para nao precisar
# redescobrir isso da proxima vez:
#   1. o binario esta assinado?
#   2. o Smart App Control esta ligado?
#   3. o arquivo veio da internet (Mark of the Web)?
#   4. o que o Code Integrity registrou no log?
#
# Uso: npm run diagnostico  [-Arquivo <caminho do exe>]
param([string]$Arquivo = '')

$raiz = Split-Path -Parent $PSScriptRoot

if (-not $Arquivo) {
  $Arquivo = (Get-ChildItem (Join-Path $raiz 'dist\*.exe') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not $Arquivo -or -not (Test-Path $Arquivo)) {
  Write-Output 'Nenhum instalador encontrado. Rode `npm run empacotar` ou passe -Arquivo <caminho>.'
  exit 1
}

Write-Output "arquivo: $Arquivo"
Write-Output ''

Write-Output '=== 1. assinatura ==='
$sig = Get-AuthenticodeSignature $Arquivo
Write-Output "   status: $($sig.Status)"
if ($sig.SignerCertificate) {
  Write-Output "   emitido para: $($sig.SignerCertificate.Subject)"
  Write-Output "   emitido por:  $($sig.SignerCertificate.Issuer)"
  Write-Output "   algoritmo:    $($sig.SignerCertificate.PublicKey.Oid.FriendlyName)"
  # O SAC nao aceita ECC; se aparecer ECC aqui, a assinatura nao serve.
  if ($sig.SignerCertificate.PublicKey.Oid.FriendlyName -notlike 'RSA*') {
    Write-Output '   ATENCAO: o Smart App Control nao aceita assinatura ECC, so RSA.'
  }
} else {
  Write-Output '   SEM ASSINATURA -- e a causa do bloqueio no Windows 11 com SAC ligado.'
}

Write-Output ''
Write-Output '=== 2. Smart App Control ==='
$v = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' `
  -Name VerifiedAndReputablePolicyState -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState
switch ($v) {
  0 { Write-Output '   DESLIGADO -- nao e ele que esta bloqueando' }
  1 { Write-Output '   LIGADO -- bloqueia binario sem assinatura de CA confiavel, sem opcao de contornar' }
  2 { Write-Output '   AVALIACAO -- pode bloquear; ainda esta aprendendo' }
  default { Write-Output "   indisponivel nesta maquina (valor: $v)" }
}

Write-Output ''
Write-Output '=== 3. Mark of the Web (veio da internet?) ==='
$z = Get-Content $Arquivo -Stream Zone.Identifier -ErrorAction SilentlyContinue
if ($z) {
  Write-Output '   TEM MOTW (baixado). Remover com: Unblock-File'
} else {
  # Ausencia de MOTW nao prova origem local: o Expand-Archive nao propaga a
  # marca, entao exe extraido de zip baixado tambem cai aqui.
  Write-Output '   sem MOTW (compilado localmente, ou extraido de um zip)'
}
Write-Output '   MEDIDO: com o SAC ligado o bloqueio acontece MESMO SEM MOTW --'
Write-Output '   quem decide e o nivel de assinatura, nao a marca de origem.'

Write-Output ''
Write-Output '=== 4. o que o Code Integrity registrou ==='
$nome = Split-Path $Arquivo -Leaf
try {
  $ev = Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 300 -ErrorAction Stop |
    Where-Object { $_.Message -like "*$nome*" } | Select-Object -First 2
  if ($ev) {
    foreach ($e in $ev) {
      Write-Output "   [$($e.TimeCreated)] id=$($e.Id)"
      ($e.Message -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 3) | ForEach-Object { Write-Output "      $_" }
    }
  } else {
    Write-Output '   nenhum evento para este arquivo'
  }
} catch {
  Write-Output "   nao consegui ler o log: $($_.Exception.Message)"
}

Write-Output ''
Write-Output '=== o que fazer ==='
if ($v -eq 1 -and -not $sig.SignerCertificate) {
  Write-Output '   SAC ligado + binario sem assinatura: nada BAIXADO deste repositorio abre,'
  Write-Output '   nem o instalador nem o zip portatil. Nao ha passo do lado do arquivo.'
  Write-Output '   Caminhos gratuitos, nesta ordem:'
  Write-Output '     1. compilar aqui:  npm install && npm run empacotar'
  Write-Output '        e rodar         dist\win-unpacked\Orquestrador.exe'
  Write-Output '     2. rodar do codigo: npm install && npm start'
  Write-Output '     3. desligar o SAC (IRREVERSIVEL: religar exige reinstalar o Windows)'
} elseif ($v -eq 1) {
  Write-Output '   SAC ligado, mas o binario esta assinado -- se ainda bloquear, veja o item 4.'
} else {
  Write-Output '   O SAC nao esta bloqueando. Se aparecer aviso, e o SmartScreen,'
  Write-Output '   que tem o botao "Mais informacoes" -> "Executar assim mesmo".'
}

Write-Output ''
Write-Output 'Detalhes e opcoes: docs/instalacao-e-assinatura.md'
