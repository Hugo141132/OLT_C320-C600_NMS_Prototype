<#
.SYNOPSIS
Mendaftarkan Windows Task Scheduler untuk Backup OLT-WEB.

.DESCRIPTION
Skrip ini akan membuat Scheduled Task yang menjalankan backup_olt.ps1
setiap hari pada jam 02:00 pagi dengan hak akses tertinggi.
#>

# Path absolut ke skrip backup
$ScriptPath = Join-Path -Path $PSScriptRoot -ChildPath "backup_olt.ps1"
$TaskName = "OLT-WEB-DailyBackup"

if (-not (Test-Path -Path $ScriptPath)) {
    Write-Error "File $ScriptPath tidak ditemukan!"
    exit 1
}

# Hapus task lama jika sudah ada
$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($ExistingTask) {
    Write-Host "Menghapus task lama: $TaskName"
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Write-Host "Mendaftarkan task: $TaskName pada jam 02:00 pagi setiap hari..."

$Action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-WindowStyle Hidden -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`""
$Trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$Task = New-ScheduledTask -Action $Action -Principal $Principal -Trigger $Trigger
Register-ScheduledTask $TaskName -InputObject $Task | Out-Null

Write-Host "Task '$TaskName' berhasil didaftarkan! Backup akan berjalan otomatis setiap hari jam 2 pagi."
