<#
.SYNOPSIS
Backup Database PostgreSQL OLT-WEB.

.DESCRIPTION
Skrip ini melakukan dump database OLT-WEB, kemudian mengompresnya ke dalam format ZIP,
dan otomatis menghapus file backup yang umurnya lebih dari 7 hari.
#>

$BackupDir = "C:\OLT-WEB-Backups"
$DbName = "olt_db"
$DbUser = "postgres"
$DbPass = "falcom180"

# Cari pg_dump.exe (Mencari di instalasi default PostgreSQL)
$PgDumpPath = (Get-ChildItem -Path "C:\Program Files\PostgreSQL" -Filter "pg_dump.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName

if (-not $PgDumpPath) {
    Write-Error "pg_dump.exe tidak ditemukan di C:\Program Files\PostgreSQL. Pastikan PostgreSQL terinstal."
    exit 1
}

# Buat direktori backup jika belum ada
if (-not (Test-Path -Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$SqlFile = Join-Path -Path $BackupDir -ChildPath "olt_db_$Timestamp.sql"
$ZipFile = Join-Path -Path $BackupDir -ChildPath "olt_db_$Timestamp.zip"

Write-Host "Memulai backup ke $SqlFile ..."
$env:PGPASSWORD = $DbPass

# Eksekusi pg_dump
& $PgDumpPath -U $DbUser -h localhost -d $DbName -F c -f $SqlFile
$ExitCode = $LASTEXITCODE

if ($ExitCode -eq 0) {
    Write-Host "Backup database berhasil."
    
    # Kompres SQL ke ZIP
    Write-Host "Mengompresi ke $ZipFile ..."
    Compress-Archive -Path $SqlFile -DestinationPath $ZipFile -Force
    
    # Hapus file SQL asli untuk menghemat ruang
    Remove-Item -Path $SqlFile -Force
    
    Write-Host "Backup selesai: $ZipFile"
    
    # Bersihkan file backup lama (lebih dari 7 hari)
    Write-Host "Membersihkan backup yang lebih dari 7 hari..."
    $LimitDate = (Get-Date).AddDays(-7)
    Get-ChildItem -Path $BackupDir -Filter "*.zip" | Where-Object { $_.CreationTime -lt $LimitDate } | Remove-Item -Force
    Write-Host "Pembersihan selesai."
} else {
    Write-Error "Backup database gagal. Exit Code: $ExitCode"
}

# Hapus environment variable password
$env:PGPASSWORD = $null
