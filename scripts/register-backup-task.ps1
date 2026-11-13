# Bunprise — weekly backup in the Windows Task Scheduler. docs/ops-backups.md, "Расписание".
#
# Task "\Bunprise\Bunprise DB backup": every Sunday 03:00 (change with -Day / -At) runs scripts/backup-db.ps1.
#   - "Run only when user is logged on" (LogonType Interactive), on purpose: the backup needs two things that Windows
#     only unlocks inside Felix's logged-on session — the Supabase CLI login (`npx supabase login`) and the archive
#     passphrase in the Credential Manager. "Run whether user is logged on or not" would need Felix's Windows password
#     stored in the Task Scheduler (and the variant without a stored password cannot read the Credential Manager).
#   - StartWhenAvailable: if the PC was off or nobody was logged on at 03:00, the backup runs as soon as possible
#     afterwards (a few minutes after the next logon).
#   - -WakeToRun (optional): wake the PC from sleep for it (not from "shut down").
#   - one run at a time, max 1 hour, also on battery.
# No admin rights needed (a task for yourself). Remove: -Unregister.
#
#   pwsh -File scripts/register-backup-task.ps1
#   pwsh -File scripts/register-backup-task.ps1 -Day Sunday -At 20:00 -WakeToRun
#   pwsh -File scripts/register-backup-task.ps1 -Unregister
param(
  [ValidateSet('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')]
  [string] $Day = 'Sunday',
  [string] $At = '03:00',
  [switch] $WakeToRun,
  [switch] $Unregister
)
$ErrorActionPreference = 'Stop'
$taskName = 'Bunprise DB backup'
$taskPath = '\Bunprise\'

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false
  Write-Host "Removed task $taskPath$taskName"
  exit 0
}

$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$backupScript = Join-Path $PSScriptRoot 'backup-db.ps1'
$repo = Split-Path -Parent $PSScriptRoot

$action = New-ScheduledTaskAction -Execute $pwsh -WorkingDirectory $repo `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$backupScript`""
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $Day -At $At
$settingsArgs = @{
  StartWhenAvailable         = $true
  AllowStartIfOnBatteries    = $true
  DontStopIfGoingOnBatteries = $true
  ExecutionTimeLimit         = (New-TimeSpan -Hours 1)
  MultipleInstances          = 'IgnoreNew'
  WakeToRun                  = [bool] $WakeToRun
}
$settings = New-ScheduledTaskSettingsSet @settingsArgs
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description 'Weekly encrypted backup of the Bunprise Supabase database (docs/ops-backups.md).' -Force | Out-Null

$info = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath | Get-ScheduledTaskInfo
Write-Host "Registered $taskPath$taskName : every $Day at $At (only while you are logged on; missed runs start as soon as possible)."
Write-Host "Next run: $($info.NextRunTime)"
Write-Host "Test it now: Start-ScheduledTask -TaskPath '$taskPath' -TaskName '$taskName'   then look at E:\BALLR\_backups\bunprise\backup.log"
