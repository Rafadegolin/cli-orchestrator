# Sobe o app com a porta de depuracao aberta, para os testes poderem dirigi-lo.
#
# Mata so as instancias DESTE projeto (filtradas pelo user-data-dir proprio),
# nunca outros apps Electron da maquina. O user-data-dir separado tambem evita
# a briga de cache que aparece quando duas instancias compartilham o perfil.

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$udata = Join-Path $raiz '.dev-udata'
$exe = Join-Path $raiz 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path $exe)) {
  Write-Error "Electron nao instalado. Rode: npm install; npx install-electron"
}

Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*.dev-udata*' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }

Start-Sleep -Milliseconds 700

$log = Join-Path $udata 'app.log'
New-Item -ItemType Directory -Force -Path $udata | Out-Null

# Os testes cadastram e removem projetos. Sem isto eles mexeriam no
# ~/.orquestrador/projetos.json de verdade -- a lista do usuario.
$env:ORQ_DADOS = Join-Path $udata 'dados'
New-Item -ItemType Directory -Force -Path $env:ORQ_DADOS | Out-Null

$p = Start-Process -FilePath $exe `
  -ArgumentList @($raiz, '--remote-debugging-port=9222', "--user-data-dir=$udata") `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru

Write-Output "PID=$($p.Id)  log=$log"
