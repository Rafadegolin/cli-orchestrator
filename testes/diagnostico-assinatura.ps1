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
  Write-Output '   Mas se o bloqueio for por nivel de assinatura, remover o MOTW nao resolve.'
} else {
  Write-Output '   sem MOTW (compilado localmente)'
}

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
Write-Output 'Detalhes e opcoes: docs/instalacao-e-assinatura.md'
