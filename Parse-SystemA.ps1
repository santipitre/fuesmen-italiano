# ============================================================================
#  Parse-SystemA.ps1
#  Lee el export .xls/.xlsx del Sistema A (HIS FUESMEN), lo valida,
#  deduplica a turnos unicos y genera la worklist + reportes.
#
#  Uso directo (sin tablero):
#    powershell -ExecutionPolicy Bypass -File Parse-SystemA.ps1 `
#       -InputFile "C:\ruta\Estadistica.xls" -OutDir "..\data" -DateFilter "2026-03-01"
#
#  Tambien se invoca desde Server.ps1 (dot-source) via la funcion Invoke-ParseSystemA.
# ============================================================================

function Read-ExcelToRows {
    param([string]$Path)
    # Lee la primera hoja con Excel COM. Devuelve: @{ Headers=[string[]]; Rows=[object[][]] }
    if (-not (Test-Path $Path)) { throw "No existe el archivo: $Path" }

    $excel = $null; $wb = $null
    try {
        $excel = New-Object -ComObject Excel.Application
    } catch {
        throw "No se pudo iniciar Excel. Este motor necesita Microsoft Excel instalado para leer archivos .xls. (Detalle: $($_.Exception.Message))"
    }
    try {
        $excel.Visible = $false
        $excel.DisplayAlerts = $false
        $wb = $excel.Workbooks.Open($Path, 0, $true)   # UpdateLinks=0, ReadOnly=$true
        $ws = $wb.Worksheets.Item(1)
        $used = $ws.UsedRange
        # Una sola llamada COM trae toda la grilla (rapido).
        $grid = $used.Value2
        $rowsN = $used.Rows.Count
        $colsN = $used.Columns.Count

        $headers = @()
        for ($c = 1; $c -le $colsN; $c++) {
            $h = $grid.GetValue(1, $c)
            $headers += ([string]$h).Trim()
        }
        $data = New-Object System.Collections.ArrayList
        for ($r = 2; $r -le $rowsN; $r++) {
            $row = New-Object object[] $colsN
            for ($c = 1; $c -le $colsN; $c++) { $row[$c-1] = $grid.GetValue($r, $c) }
            [void]$data.Add($row)
        }
        return @{ Headers = $headers; Rows = $data }
    }
    finally {
        if ($wb)    { $wb.Close($false) | Out-Null }
        if ($excel) { $excel.Quit() | Out-Null }
        # Liberar COM para no dejar EXCEL.EXE colgado
        if ($wb)    { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) }
        if ($excel) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
    }
}

function ConvertTo-CleanString {
    param($v)
    if ($null -eq $v) { return "" }
    if ($v -is [double]) {
        # Numero entero (DNI, turno) sin notacion cientifica ni decimales
        if ([math]::Floor($v) -eq $v) { return ([int64]$v).ToString() }
        return $v.ToString()
    }
    return ([string]$v).Trim()
}

function ConvertTo-FechaStr {
    param($v)
    if ($null -eq $v) { return "" }
    try {
        if ($v -is [double]) { return [DateTime]::FromOADate($v).ToString('yyyy-MM-dd') }
        $d = [datetime]::Parse([string]$v); return $d.ToString('yyyy-MM-dd')
    } catch { return "" }
}

function Invoke-ParseSystemA {
    param(
        [Parameter(Mandatory)][string]$InputFile,
        [Parameter(Mandatory)][string]$OutDir,
        [string]$DateFilter = "",            # "" = todas las fechas; o "yyyy-MM-dd"
        [string]$EstadoValido = "REA",
        [hashtable]$Columnas
    )

    if (-not $Columnas) {
        $Columnas = @{ turno='Turno N°'; documento='Documento'; paciente='Paciente'; fecha='Turno Fecha'; estudio='Estudio'; estado='Estado'; servicio='Servicio'; aseguradora='Aseguradora'; cuenta='Cuenta'; tipoTurno='Tipo Turno'; numFactura='N° Factura'; numOrden='N° Orden'; numReferencia='Nº Referencia' }
    }
    if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

    # Si la ruta no tiene extension o no existe, probar .xls / .xlsx (al copiar de Descargas a veces falta)
    if (-not (Test-Path $InputFile)) {
        foreach ($ext in '.xls','.xlsx') {
            if (Test-Path ($InputFile + $ext)) { $InputFile = $InputFile + $ext; break }
        }
    }

    $parsed  = Read-ExcelToRows -Path $InputFile
    $headers = $parsed.Headers

    # Mapear nombre de columna -> indice (0-based). Tolerante a may/min y espacios.
    # Normaliza encabezados: saca acentos/simbolos raros (ej. el ° de "Turno N°" que
    # a veces llega mal codificado como "NÂ°") para que el match sea robusto.
    function Format-Hdr([string]$s) {
        return ((($s -replace '[^A-Za-z0-9 ]',' ') -replace '\s+',' ').Trim()).ToLower()
    }
    function Get-ColIndex([string]$name) {
        $tn = Format-Hdr $name
        for ($i=0; $i -lt $headers.Count; $i++) {
            if ((Format-Hdr $headers[$i]) -eq $tn) { return $i }
        }
        return -1
    }
    $idx = @{}
    foreach ($k in $Columnas.Keys) {
        $idx[$k] = Get-ColIndex $Columnas[$k]
        if ($idx[$k] -lt 0) { throw "No se encontro la columna '$($Columnas[$k])' en el archivo. Revisa scripts\config.json." }
    }

    # ---- Recorrer filas, filtrar Estado y fecha ----
    $turnos      = @{}   # turnoN -> objeto agregado
    $practKeys   = @{}   # "DNI|fecha|estudio" -> set de turnos (para detectar colisiones)
    $excluidos   = New-Object System.Collections.ArrayList
    $totalFilas  = 0

    foreach ($row in $parsed.Rows) {
        $totalFilas++
        $turnoN  = ConvertTo-CleanString $row[$idx.turno]
        $estado  = ConvertTo-CleanString $row[$idx.estado]
        $fecha   = ConvertTo-FechaStr   $row[$idx.fecha]
        $dni     = ConvertTo-CleanString $row[$idx.documento]
        $pac     = ConvertTo-CleanString $row[$idx.paciente]
        $estudio = ConvertTo-CleanString $row[$idx.estudio]
        $serv    = ConvertTo-CleanString $row[$idx.servicio]
        $aseg    = ConvertTo-CleanString $row[$idx.aseguradora]
        $cuenta  = ConvertTo-CleanString $row[$idx.cuenta]
        $tipo    = ConvertTo-CleanString $row[$idx.tipoTurno]
        $nfac    = ConvertTo-CleanString $row[$idx.numFactura]
        $nord    = ConvertTo-CleanString $row[$idx.numOrden]
        $nref    = ConvertTo-CleanString $row[$idx.numReferencia]

        if ($turnoN -eq "") { continue }

        # Filtro de fecha (si se pidio): yyyy-MM = mes entero; yyyy-MM-dd = dia exacto
        if ($DateFilter -ne "") {
            if ($DateFilter.Length -eq 7) { if (-not $fecha.StartsWith($DateFilter)) { continue } }
            else { if ($fecha -ne $DateFilter) { continue } }
        }

        # Filtro de Estado: solo realizados
        if ($estado -ne $EstadoValido) {
            [void]$excluidos.Add([pscustomobject]@{ TurnoN=$turnoN; DNI=$dni; Paciente=$pac; Fecha=$fecha; Estado=$estado })
            continue
        }

        if (-not $turnos.ContainsKey($turnoN)) {
            $turnos[$turnoN] = [pscustomobject]@{
                TurnoN=$turnoN; DNI=$dni; Paciente=$pac; Fecha=$fecha;
                Servicio=$serv; Aseguradora=""; Cuenta=""; TipoTurno=$tipo; Alerta=""; Pedidos=(New-Object System.Collections.Generic.HashSet[string]); Practicas=(New-Object System.Collections.Generic.HashSet[string]);
                nPrestaciones=0; Revisar="" ; SinDNI=($dni -eq "")
            }
        }
        $t = $turnos[$turnoN]
        if ($estudio -ne "") { [void]$t.Practicas.Add($estudio) }
        # Aseguradora del turno: si alguna prestacion es HAREFIELD, gana esa; si no, la primera no vacia.
        # La Cuenta se toma de la MISMA fila que define la aseguradora (para que queden consistentes).
        if ($aseg -match 'HAREFIELD') { $t.Aseguradora = $aseg; $t.Cuenta = $cuenta }
        elseif ($t.Aseguradora -eq "" -and $aseg -ne "") { $t.Aseguradora = $aseg; $t.Cuenta = $cuenta }
        $t.nPrestaciones++
        # Bandera roja (tramite incompleto). Filas ya son REA. A) PARTICULAR + N Factura 0 ; B) N Orden 0
        if (($aseg -match 'PARTICULAR' -and $nfac -eq '0') -or ($nord -eq '0')) { $t.Alerta = "SI" }
        # N de pedido medico = Nº Referencia corto (3-6 digitos); los largos "000023..." son otra cosa
        if ($nref -match '^\d{3,6}$') { [void]$t.Pedidos.Add($nref) }

        # Registrar clave DNI+fecha+estudio para deteccion de ambiguedad
        $pk = "$dni|$fecha|$estudio"
        if (-not $practKeys.ContainsKey($pk)) { $practKeys[$pk] = (New-Object System.Collections.Generic.HashSet[string]) }
        [void]$practKeys[$pk].Add($turnoN)
    }

    # ---- Marcar turnos ambiguos (misma clave DNI+fecha+practica en >1 turno) ----
    $clavesAmbiguas = New-Object System.Collections.Generic.HashSet[string]
    foreach ($kv in $practKeys.GetEnumerator()) { if ($kv.Value.Count -gt 1) { [void]$clavesAmbiguas.Add($kv.Key) } }

    $worklist = New-Object System.Collections.ArrayList
    foreach ($t in $turnos.Values) {
        $amb = $false
        foreach ($p in $t.Practicas) { if ($clavesAmbiguas.Contains("$($t.DNI)|$($t.Fecha)|$p")) { $amb = $true; break } }
        $obj = [pscustomobject]@{
            TurnoN        = $t.TurnoN
            DNI           = $t.DNI
            Paciente      = $t.Paciente
            Fecha         = $t.Fecha
            Practicas     = (($t.Practicas | Sort-Object) -join ' | ')
            nPrestaciones = $t.nPrestaciones
            Servicio      = $t.Servicio
            Aseguradora   = $t.Aseguradora
            Cuenta        = $t.Cuenta
            TipoTurno     = $t.TipoTurno
            Alerta        = $t.Alerta
            PedidoMed     = (($t.Pedidos | Sort-Object) -join ', ')
            Revisar       = $(if ($amb -or $t.SinDNI) { "SI" } else { "" })
            Estado_Carga  = "PENDIENTE"   # PENDIENTE | CARGADO | ERROR (lo usa la fase de carga en B)
        }
        [void]$worklist.Add($obj)
    }
    $worklist = $worklist | Sort-Object Fecha, TurnoN

    # ---- Escribir salidas ----
    $stamp = if ($DateFilter -ne "") { $DateFilter } else { "completo" }
    $wlPath  = Join-Path $OutDir "worklist_$stamp.csv"
    $exPath  = Join-Path $OutDir "excluidos_$stamp.csv"
    $amPath  = Join-Path $OutDir "revisar_manual_$stamp.csv"
    $jsonPath= Join-Path $OutDir "worklist_actual.json"

    $worklist | Export-Csv -Path $wlPath -NoTypeInformation -Encoding UTF8
    $excluidos | Export-Csv -Path $exPath -NoTypeInformation -Encoding UTF8
    ($worklist | Where-Object { $_.Revisar -eq "SI" }) | Export-Csv -Path $amPath -NoTypeInformation -Encoding UTF8
    $worklist | ConvertTo-Json -Depth 4 | Out-File -FilePath $jsonPath -Encoding UTF8

    $resumen = [pscustomobject]@{
        archivo        = (Split-Path $InputFile -Leaf)
        fechaFiltro    = $(if ($DateFilter -ne "") { $DateFilter } else { "TODAS" })
        filasLeidas    = $totalFilas
        turnosUnicos   = $worklist.Count
        aRevisar       = ($worklist | Where-Object { $_.Revisar -eq "SI" }).Count
        excluidosNoREA = $excluidos.Count
        archivoWorklist= $wlPath
        archivoExcluidos=$exPath
        archivoRevisar = $amPath
        generado       = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    }
    $resumen | ConvertTo-Json | Out-File -FilePath (Join-Path $OutDir "resumen_actual.json") -Encoding UTF8

    return [pscustomobject]@{ resumen=$resumen; worklist=$worklist }
}

# ---- Ejecucion directa por linea de comandos (opcional) ----
# Solo corre si se invoca el script directamente Y se paso -InputFile.
# Ej: powershell -File Parse-SystemA.ps1 -InputFile "C:\x.xls" -OutDir "..\data" -DateFilter "2026-03-01"
if ($MyInvocation.InvocationName -ne '.') {
    $cli = @{}
    for ($i=0; $i -lt $args.Count; $i++) {
        if ($args[$i] -match '^-(.+)') { $cli[$Matches[1]] = $args[$i+1]; $i++ }
    }
    if ($cli.ContainsKey('InputFile')) {
        $r = Invoke-ParseSystemA -InputFile $cli['InputFile'] `
              -OutDir $(if ($cli.OutDir) { $cli['OutDir'] } else { Join-Path $PSScriptRoot '..\data' }) `
              -DateFilter $(if ($cli.DateFilter) { $cli['DateFilter'] } else { '' })
        $r.resumen | Format-List
    }
}
