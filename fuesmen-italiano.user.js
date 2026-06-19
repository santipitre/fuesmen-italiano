# ============================================================
#  Push-Worklist.ps1  -  Sube la worklist a Supabase (Fase 2b)
#  Corre SOLO en la maquina del admin. Usa la key secreta de scripts\supabase.secret.json
#  (esa key NO se sube a GitHub). Reemplazo total: borra lo anterior y sube lo actual.
#  NO sube nombre de paciente (minimizacion de datos).
# ============================================================

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Write-Host "=== Push-Worklist v3 ===" -ForegroundColor Magenta

$root       = Split-Path $PSScriptRoot -Parent
$secretPath = Join-Path $PSScriptRoot 'supabase.secret.json'
$wlPath     = Join-Path $root 'data\worklist_actual.json'

if (-not (Test-Path $secretPath)) {
  Write-Host "Falta scripts\supabase.secret.json con tu url y serviceRole." -ForegroundColor Red
  Read-Host "Enter para salir"; exit 1
}
$secret = Get-Content $secretPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $secret.serviceRole -or $secret.serviceRole -like 'PEGA_ACA*') {
  Write-Host "Falta pegar la key secreta en supabase.secret.json" -ForegroundColor Red
  Read-Host "Enter para salir"; exit 1
}
$base = $secret.url.TrimEnd('/') + '/rest/v1/fuesmen_worklist'
$headers = @{
  'apikey'        = $secret.serviceRole
  'Authorization' = 'Bearer ' + $secret.serviceRole
  'Content-Type'  = 'application/json'
  'Prefer'        = 'return=minimal'
}

if (-not (Test-Path $wlPath)) {
  Write-Host "No encuentro data\worklist_actual.json. Genera la worklist primero." -ForegroundColor Red
  Read-Host "Enter para salir"; exit 1
}
$rows = Get-Content $wlPath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host ("Worklist local: {0} turnos" -f $rows.Count) -ForegroundColor Cyan

$objs = foreach ($r in $rows) {
  [pscustomobject]@{
    periodo     = $(if ($r.Fecha -and $r.Fecha.Length -ge 7) { $r.Fecha.Substring(0,7) } else { 'sin-fecha' })
    turno_n     = [string]$r.TurnoN
    pedido_med  = [string]$r.PedidoMed
    dni         = [string]$r.DNI
    practicas   = [string]$r.Practicas
    fecha       = $(if ($r.Fecha) { [string]$r.Fecha } else { $null })
    alerta      = ($r.Alerta -eq 'SI')
    aseguradora = [string]$r.Aseguradora
  }
}
$objs = @($objs)

Write-Host "Borrando worklist anterior en la nube..." -ForegroundColor Cyan
Invoke-RestMethod -Method Delete -Uri ($base + '?id=gte.0') -Headers $headers -UserAgent 'fuesmen-push' | Out-Null

$batch = 500; $total = $objs.Count; $done = 0
for ($i = 0; $i -lt $total; $i += $batch) {
  $hi = [Math]::Min($i + $batch - 1, $total - 1)
  $slice = @($objs[$i..$hi])
  $body  = ConvertTo-Json $slice -Depth 4 -Compress
  if ($slice.Count -eq 1) { $body = '[' + $body + ']' }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  Invoke-RestMethod -Method Post -Uri $base -Headers $headers -Body $bytes -UserAgent 'fuesmen-push' | Out-Null
  $done += $slice.Count
  Write-Host ("  subidos {0}/{1}" -f $done, $total) -ForegroundColor DarkGray
}
Write-Host ("LISTO. {0} turnos en la nube." -f $total) -ForegroundColor Green
Read-Host "Enter para salir"
