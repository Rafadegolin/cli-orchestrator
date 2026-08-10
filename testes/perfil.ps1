# CPU e RAM POR PROCESSO do app: main, renderer, gpu, utility.
#
# E a primeira coisa a rodar quando uma meta estourar, ANTES de mexer em
# qualquer pipeline. Foi este perfil que mostrou que o gargalo sob carga estava
# no processo principal lendo o ConPTY (26,7%) e nao no renderer (1,3%) -- a
# spec (6.6) manda procurar em tres lugares que, nesta maquina, nao eram nenhum
# dos culpados.
#
# Uso: powershell -File testes/perfil.ps1 -Segundos 30
param([int]$Segundos = 30, [switch]$Json)

function Procs {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -like '*.dev-udata*' } |
    ForEach-Object {
      $tipo = 'main'
      if ($_.CommandLine -match '--type=([a-zA-Z-]+)') { $tipo = $Matches[1] }
      [pscustomobject]@{ Id = $_.ProcessId; Tipo = $tipo }
    }
}

$antes = @{}
foreach ($p in Procs) {
  $o = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
  if ($o) { $antes[$p.Id] = @{ t = $o.TotalProcessorTime.TotalSeconds; tipo = $p.Tipo } }
}

if ($antes.Count -eq 0) { Write-Output 'app nao esta rodando (use: npm run dev)'; exit 1 }

$r0 = Get-Date
Start-Sleep -Seconds $Segundos
$decorrido = ((Get-Date) - $r0).TotalSeconds
$nucleos = [Environment]::ProcessorCount

# Casa as amostras POR PID: somar tudo e subtrair da delta negativa quando um
# processo morre entre as duas leituras.
$linhas = @()
foreach ($p in Procs) {
  $o = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
  if ($o -and $antes.ContainsKey($p.Id)) {
    $d = $o.TotalProcessorTime.TotalSeconds - $antes[$p.Id].t
    $linhas += [pscustomobject]@{
      Tipo   = $p.Tipo
      Pid    = $p.Id
      CpuPct = [math]::Round(($d / $decorrido / $nucleos) * 100, 2)
      RamMb  = [math]::Round($o.WorkingSet64 / 1MB, 1)
    }
  }
}

$totalCpu = [math]::Round((($linhas | Measure-Object CpuPct -Sum).Sum), 2)
$totalRam = [math]::Round((($linhas | Measure-Object RamMb -Sum).Sum), 1)

# -Json para quem consome isto de um script: raspar tabela formatada quebra na
# primeira mudanca de largura de coluna.
if ($Json) {
  $porTipo = @{}
  foreach ($l in $linhas) {
    if ($porTipo.ContainsKey($l.Tipo)) { $porTipo[$l.Tipo] += $l.CpuPct } else { $porTipo[$l.Tipo] = $l.CpuPct }
  }
  [pscustomobject]@{
    processos = $linhas.Count
    porTipo   = $porTipo
    cpuTotal  = $totalCpu
    ramMb     = $totalRam
    nucleos   = $nucleos
  } | ConvertTo-Json -Compress
  exit 0
}

$linhas | Sort-Object CpuPct -Descending | Format-Table -AutoSize
Write-Output "TOTAL  cpu=$totalCpu% de $nucleos nucleos   ram=$totalRam MB"

# Os shells e o ConPTY tambem gastam CPU e NAO sao do app: contam separado para
# nao inflar o numero que se compara com a meta.
foreach ($nome in @('cmd', 'OpenConsole', 'conhost')) {
  $ps = Get-Process -Name $nome -ErrorAction SilentlyContinue
  if ($ps) { Write-Output "fora do app: $nome x$(@($ps).Count)" }
}
