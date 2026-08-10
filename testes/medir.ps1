# Mede RAM e CPU do app. Discrimina os processos DESTE app pelo user-data-dir
# de desenvolvimento, que aparece na linha de comando de todos os filhos
# (renderer, gpu, utility).
param([int]$SegundosCpu = 0)

function PidsApp {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -like '*.dev-udata*' } |
    ForEach-Object { $_.ProcessId }
}

# Tempo de CPU POR PID, para casar as duas amostras processo a processo. Somar
# tudo e subtrair da delta negativa quando um processo morre entre as amostras.
function CpuPorPid($ids) {
  $h = @{}
  foreach ($i in $ids) {
    $p = Get-Process -Id $i -ErrorAction SilentlyContinue
    if ($p) { $h[$i] = $p.TotalProcessorTime.TotalSeconds }
  }
  return $h
}

$ids = @(PidsApp)
if ($ids.Count -eq 0) { Write-Output '{"erro":"app nao esta rodando"}'; exit 1 }

$mb = [math]::Round((($ids | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).WorkingSet64 } | Measure-Object -Sum).Sum) / 1MB, 1)

$cpuPct = -1
if ($SegundosCpu -gt 0) {
  $a = CpuPorPid $ids
  $r0 = Get-Date
  Start-Sleep -Seconds $SegundosCpu
  $b = CpuPorPid @(PidsApp)
  $decorrido = ((Get-Date) - $r0).TotalSeconds
  $delta = 0.0
  foreach ($k in $b.Keys) { if ($a.ContainsKey($k)) { $delta += ($b[$k] - $a[$k]) } }
  $cpuPct = [math]::Round(($delta / $decorrido / [Environment]::ProcessorCount) * 100, 2)
}

[pscustomobject]@{
  processos = $ids.Count
  ramMb     = $mb
  cpuPct    = $cpuPct
  nucleos   = [Environment]::ProcessorCount
} | ConvertTo-Json -Compress
