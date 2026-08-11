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

function Test-Porta($porta) {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $porta); $true } catch { $false } finally { $c.Dispose() }
}

function Wait-Porta($porta, $querAberta, $segundos) {
  $fim = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $fim) {
    if ((Test-Porta $porta) -eq $querAberta) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*.dev-udata*' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }

# Espera a instancia velha SOLTAR a porta de eventos, em vez de dormir um tanto
# fixo. Subir com a 47615 ainda presa faz o app abrir sem servidor de eventos, e
# ai toda suite que depende de hook falha de um jeito que nao parece a causa.
if (-not (Wait-Porta 47615 $false 10)) {
  Write-Error "a porta 47615 continua ocupada -- algum outro programa a segura"
}

$log = Join-Path $udata 'app.log'
New-Item -ItemType Directory -Force -Path $udata | Out-Null

# Os testes cadastram e removem projetos. Sem isto eles mexeriam no
# ~/.orquestrador/projetos.json de verdade -- a lista do usuario.
$env:ORQ_DADOS = Join-Path $udata 'dados'
New-Item -ItemType Directory -Force -Path $env:ORQ_DADOS | Out-Null

$p = Start-Process -FilePath $exe `
  -ArgumentList @($raiz, '--remote-debugging-port=9222', "--user-data-dir=$udata") `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru

# So devolve o controle quando o app esta REALMENTE pronto: porta de depuracao
# para os testes dirigirem, e servidor de eventos para as bolinhas mudarem.
if (-not (Wait-Porta 9222 $true 25)) {
  Write-Error "o app subiu mas nao abriu a porta de depuracao -- veja $log.err"
}
if (-not (Wait-Porta 47615 $true 15)) {
  Write-Error "o app subiu sem servidor de eventos na 47615 -- os testes de hook falhariam sem motivo aparente"
}

Write-Output "PID=$($p.Id)  log=$log"
