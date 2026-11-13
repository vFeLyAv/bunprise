# Bunprise — shared helpers for the database backup scripts (dot-sourced, not run on its own):
#   backup-db.ps1, restore-db-test.ps1, backup-selftest.ps1, install-pg-client.ps1, register-backup-task.ps1
# docs/ops-backups.md explains the whole procedure (Russian).
#
# Secrets: the backup passphrase lives ONLY in the Windows Credential Manager of Felix's account (generic credential
# "Bunprise DB backup", protected by Windows DPAPI) or, for tests, in a process-only environment variable. It is never
# written to a file, a log or a command line: 7-Zip receives it on its standard input.

Set-StrictMode -Version Latest

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:CredentialTarget = 'Bunprise DB backup'
$script:PassphraseEnvVar = 'BUNPRISE_BACKUP_PASSPHRASE'

# ---------------------------------------------------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------------------------------------------------

function Find-SevenZip {
  foreach ($candidate in @((Join-Path $env:ProgramFiles '7-Zip\7z.exe'), (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe'))) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  $cmd = Get-Command 7z.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw 'PREREQ: 7-Zip not found (expected C:\Program Files\7-Zip\7z.exe). Install: winget install 7zip.7zip'
}

# PostgreSQL 17 client tools (pg_dump, pg_dumpall, psql) — scripts/install-pg-client.ps1
function Find-PgClientBin([string] $PgBin) {
  $dirs = @($PgBin, $env:BUNPRISE_PG_BIN, (Join-Path $env:LOCALAPPDATA 'Programs\pgsql-17\bin')) | Where-Object { $_ }
  foreach ($dir in $dirs) {
    if ((Test-Path -LiteralPath (Join-Path $dir 'pg_dump.exe')) -and (Test-Path -LiteralPath (Join-Path $dir 'psql.exe'))) {
      return (Resolve-Path -LiteralPath $dir).Path
    }
  }
  throw 'PREREQ: PostgreSQL 17 client tools not found. Run once: pwsh -File scripts/install-pg-client.ps1'
}

# Git Bash (NOT C:\Windows\System32\bash.exe, which is WSL): runs the Supabase CLI's own pg_dump script.
function Find-GitBash {
  $candidates = @((Join-Path $env:ProgramFiles 'Git\bin\bash.exe'))
  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($git) { $candidates += (Join-Path (Split-Path -Parent (Split-Path -Parent $git.Source)) 'bin\bash.exe') }
  foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate) { return $candidate } }
  throw 'PREREQ: Git Bash not found (expected C:\Program Files\Git\bin\bash.exe). Install Git for Windows.'
}

# initdb / pg_ctl / postgres of the embedded PostgreSQL 17 the concurrency tests use (packages/db-tests, ADR-0002)
function Find-EmbeddedPgBin {
  $dir = Join-Path $script:RepoRoot 'node_modules\@embedded-postgres\windows-x64\native\bin'
  if (-not (Test-Path -LiteralPath (Join-Path $dir 'pg_ctl.exe'))) {
    throw "PREREQ: embedded PostgreSQL not found in $dir. Run once in the repo: npm install"
  }
  return $dir
}

# C:\Users\x y\f.sql -> '/c/Users/x y/f.sql' (single-quoted for bash)
function ConvertTo-BashPath([string] $Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $posix = '/' + $full.Substring(0, 1).ToLowerInvariant() + $full.Substring(2).Replace('\', '/')
  return "'" + $posix.Replace("'", "'\''") + "'"
}

# Runs a program without a shell. StdinText (LF line ends, UTF-8) goes to its standard input — this is how secrets reach
# child processes (never on the command line, which other programs can read). Env adds variables for the child only.
function Invoke-Native {
  param(
    [Parameter(Mandatory)] [string] $FilePath,
    [string[]] $Arguments = @(),
    [string] $StdinText,
    [hashtable] $Env = @{},
    [string] $WorkingDirectory = $script:RepoRoot,
    # pg_ctl start: the server it launches inherits stdout/stderr, so captured pipes would never close. Run it with
    # the parent's handles instead (pg_ctl -s -l <file> keeps it quiet).
    [switch] $NoCapture
  )
  $psi = [Diagnostics.ProcessStartInfo]::new($FilePath)
  foreach ($a in $Arguments) { $psi.ArgumentList.Add($a) }
  foreach ($k in $Env.Keys) { $psi.Environment[$k] = [string] $Env[$k] }
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  if ($NoCapture) {
    $p = [Diagnostics.Process]::Start($psi)
    try { $p.WaitForExit(); return [pscustomobject]@{ ExitCode = $p.ExitCode; Stdout = ''; Stderr = '' } } finally { $p.Dispose() }
  }
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $psi.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
  $p = [Diagnostics.Process]::Start($psi)
  try {
    $out = $p.StandardOutput.ReadToEndAsync()
    $err = $p.StandardError.ReadToEndAsync()
    if ($StdinText) {
      $bytes = [Text.UTF8Encoding]::new($false).GetBytes($StdinText.Replace("`r`n", "`n"))
      try { $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length) } catch [IO.IOException] { }  # child exited early
    }
    try { $p.StandardInput.Close() } catch [IO.IOException] { }
    $p.WaitForExit()
    return [pscustomobject]@{ ExitCode = $p.ExitCode; Stdout = $out.Result; Stderr = $err.Result }
  } finally {
    $p.Dispose()
  }
}

# Last lines of a tool's error output, for the console / log. Never pass dump CONTENT through here.
function Get-ErrorTail([string] $Text, [int] $Lines = 6) {
  if (-not $Text) { return '' }
  return ((($Text -split "`r?`n") | Where-Object { $_.Trim() }) | Select-Object -Last $Lines) -join ' | '
}

# ---------------------------------------------------------------------------------------------------------------------
# Passphrase (Windows Credential Manager, generic credential, this user + this PC only)
# ---------------------------------------------------------------------------------------------------------------------

if (-not ('Bunprise.CredStore' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
namespace Bunprise {
  public static class CredStore {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
      public int Flags; public int Type; public string TargetName; public string Comment;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
      public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
      public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWriteW(ref CREDENTIAL credential, int flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDeleteW(string target, int type, int flags);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);
    private const int CRED_TYPE_GENERIC = 1;
    private const int CRED_PERSIST_LOCAL_MACHINE = 2;

    public static string Read(string target) {
      IntPtr p;
      if (!CredReadW(target, CRED_TYPE_GENERIC, 0, out p)) return null;
      try {
        var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
        if (c.CredentialBlobSize == 0) return null;
        return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
      } finally { CredFree(p); }
    }

    public static void Write(string target, string userName, string secret) {
      byte[] blob = Encoding.Unicode.GetBytes(secret);
      var c = new CREDENTIAL();
      c.Type = CRED_TYPE_GENERIC; c.TargetName = target; c.UserName = userName;
      c.Persist = CRED_PERSIST_LOCAL_MACHINE; c.CredentialBlobSize = blob.Length;
      c.CredentialBlob = Marshal.AllocHGlobal(blob.Length);
      try {
        Marshal.Copy(blob, 0, c.CredentialBlob, blob.Length);
        if (!CredWriteW(ref c, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
      } finally {
        Array.Clear(blob, 0, blob.Length);
        Marshal.FreeHGlobal(c.CredentialBlob);
      }
    }

    public static bool Delete(string target) { return CredDeleteW(target, CRED_TYPE_GENERIC, 0); }
  }
}
'@
}

# Env var (tests only) > Credential Manager. Throws with a hint when neither is set.
function Get-BackupPassphrase {
  $fromEnv = [Environment]::GetEnvironmentVariable($script:PassphraseEnvVar, 'Process')
  if ($fromEnv) { return $fromEnv }
  $stored = [Bunprise.CredStore]::Read($script:CredentialTarget)
  if ($stored) { return $stored }
  throw "PREREQ: no backup passphrase in the Windows Credential Manager ('$script:CredentialTarget'). Run once: pwsh -File scripts/backup-db.ps1 -SetPassphrase"
}

function Set-BackupPassphrase {
  Write-Host 'Passphrase for the backup archives (AES-256). Generate a long one (20+ characters) in your password'
  Write-Host 'manager and keep it THERE too: without it no backup can ever be opened. Input is not shown.'
  $a = Read-Host -AsSecureString 'Passphrase'
  $b = Read-Host -AsSecureString 'Repeat'
  $plainA = [Net.NetworkCredential]::new('', $a).Password
  $plainB = [Net.NetworkCredential]::new('', $b).Password
  if ($plainA -cne $plainB) { throw 'The two entries differ - nothing saved.' }
  if ($plainA.Length -lt 16) { throw 'Too short: use at least 16 characters (better 20+ from the password manager) - nothing saved.' }
  [Bunprise.CredStore]::Write($script:CredentialTarget, $env:USERNAME, $plainA)
  Write-Host "Saved in the Windows Credential Manager as '$script:CredentialTarget' (Windows credentials, this user, this PC)."
}

# ---------------------------------------------------------------------------------------------------------------------
# 7-Zip with the passphrase on stdin
# ---------------------------------------------------------------------------------------------------------------------

# 7z a -p (no value) asks for the password once and reads it from stdin; t / x / l WITHOUT -p ask when they meet an
# encrypted archive. (Checked with 7-Zip 26.00: `t -p` with an empty value would test with an EMPTY password.)
function New-EncryptedArchive([string] $SevenZip, [string] $Archive, [string] $SourceDir, [string] $Passphrase) {
  $r = Invoke-Native -FilePath $SevenZip -WorkingDirectory $SourceDir -StdinText "$Passphrase`n" -Arguments @(
    'a', '-t7z', '-mx=7', '-mhe=on', '-mmt=on', '-bso0', '-bsp0', '-p', $Archive, '*')
  if ($r.ExitCode -ne 0) { throw "7-Zip could not create the archive (exit $($r.ExitCode)): $(Get-ErrorTail $r.Stderr)" }
}

function Test-EncryptedArchive([string] $SevenZip, [string] $Archive, [string] $Passphrase) {
  $r = Invoke-Native -FilePath $SevenZip -StdinText "$Passphrase`n" -Arguments @('t', '-bso0', '-bsp0', $Archive)
  if ($r.ExitCode -ne 0) { throw "archive test failed (exit $($r.ExitCode); wrong passphrase or damaged file): $(Get-ErrorTail $r.Stderr)" }
}

# name -> size of every file inside (decrypts only the header)
function Get-ArchiveListing([string] $SevenZip, [string] $Archive, [string] $Passphrase) {
  $r = Invoke-Native -FilePath $SevenZip -StdinText "$Passphrase`n" -Arguments @('l', '-slt', '-ba', $Archive)
  if ($r.ExitCode -ne 0) { throw "archive listing failed (exit $($r.ExitCode)): $(Get-ErrorTail $r.Stderr)" }
  $files = @{}
  $name = $null
  foreach ($line in ($r.Stdout -split "`r?`n")) {
    if ($line -match '^Path = (.+)$') { $name = $Matches[1] }
    elseif ($line -match '^Size = (\d+)$' -and $name) { $files[$name] = [int64] $Matches[1]; $name = $null }
  }
  return $files
}

function Expand-EncryptedArchive([string] $SevenZip, [string] $Archive, [string] $Destination, [string] $Passphrase) {
  $r = Invoke-Native -FilePath $SevenZip -StdinText "$Passphrase`n" -Arguments @('x', '-y', '-bso0', '-bsp0', "-o$Destination", $Archive)
  if ($r.ExitCode -ne 0) { throw "could not unpack the archive (exit $($r.ExitCode); wrong passphrase or damaged file): $(Get-ErrorTail $r.Stderr)" }
}

# ---------------------------------------------------------------------------------------------------------------------
# Dump files
# ---------------------------------------------------------------------------------------------------------------------

# Rows per table in a data dump made with --use-copy: every row is exactly one line between `COPY ... FROM stdin;` and
# `\.` (COPY text format escapes newlines inside values). Reads line by line; returns "schema.table" -> rows.
function Get-CopyRowCounts([string] $DataFile) {
  $counts = [ordered]@{}
  $reader = [IO.StreamReader]::new($DataFile, [Text.UTF8Encoding]::new($false))
  try {
    $table = $null
    while ($null -ne ($line = $reader.ReadLine())) {
      if ($null -eq $table) {
        if ($line -match '^COPY "([^"]+)"\."([^"]+)" .*FROM stdin;$') { $table = "$($Matches[1]).$($Matches[2])"; $counts[$table] = 0 }
      } elseif ($line -eq '\.') {
        $table = $null
      } else {
        $counts[$table]++
      }
    }
    if ($null -ne $table) { throw "data dump is cut off inside the COPY block of $table" }
  } finally { $reader.Dispose() }
  return $counts
}

# ---------------------------------------------------------------------------------------------------------------------
# Throwaway local PostgreSQL 17 (embedded binaries, 127.0.0.1, random port and password, deleted by Stop-LocalPg)
# ---------------------------------------------------------------------------------------------------------------------

function Get-FreePort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}

function Start-LocalPg([string] $Root) {
  $bin = Find-EmbeddedPgBin
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  $dataDir = Join-Path $Root 'pgdata'
  $password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).Replace('/', 'x').Replace('+', 'y').TrimEnd('=')
  # initdb reads the superuser password only from a file: in the private temp folder, deleted right after initdb
  $pwFile = Join-Path $Root 'pw.txt'
  [IO.File]::WriteAllText($pwFile, $password)
  try {
    $r = Invoke-Native -FilePath (Join-Path $bin 'initdb.exe') -Arguments @(
      '-D', $dataDir, '-U', 'postgres', "--pwfile=$pwFile", '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--no-sync')
    if ($r.ExitCode -ne 0) { throw "initdb failed: $(Get-ErrorTail ($r.Stderr + $r.Stdout))" }
  } finally { Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue }

  # pg_ctl, not postgres.exe directly: PostgreSQL refuses an elevated Windows token, pg_ctl drops it (see src/realpg.ts)
  $log = Join-Path $Root 'server.log'
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $port = Get-FreePort
    $r = Invoke-Native -NoCapture -FilePath (Join-Path $bin 'pg_ctl.exe') -Arguments @(
      'start', '-D', $dataDir, '-w', '-t', '60', '-s', '-l', $log,
      '-o', "-p $port -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_wal_size=1GB")
    if ($r.ExitCode -eq 0) {
      return [pscustomobject]@{ Port = $port; Password = $password; DataDir = $dataDir; PgCtl = (Join-Path $bin 'pg_ctl.exe'); Root = $Root }
    }
  }
  throw "pg_ctl could not start the local PostgreSQL: $(Get-ErrorTail (Get-Content -Raw -LiteralPath $log -ErrorAction SilentlyContinue))"
}

function Stop-LocalPg($Pg) {
  if (-not $Pg) { return }
  foreach ($mode in 'fast', 'immediate') {
    $r = Invoke-Native -FilePath $Pg.PgCtl -Arguments @('stop', '-D', $Pg.DataDir, '-m', $mode, '-w', '-t', '30', '-s')
    if ($r.ExitCode -eq 0) { return }
  }
  Write-Warning "local PostgreSQL in $($Pg.DataDir) did not stop cleanly"
}

# psql against a Start-LocalPg cluster. -File runs a file, -Sql a command. StopOnError = ON_ERROR_STOP + one transaction.
function Invoke-LocalPsql {
  param($Pg, [string] $PgBin, [string] $File, [string] $Sql, [string] $Database = 'postgres', [switch] $StopOnError, [switch] $Tuples)
  $psqlArgs = @('-h', '127.0.0.1', '-p', "$($Pg.Port)", '-U', 'postgres', '-d', $Database, '-X', '-q', '-v', "ON_ERROR_STOP=$([int][bool]$StopOnError)")
  if ($StopOnError) { $psqlArgs += '--single-transaction' }
  if ($Tuples) { $psqlArgs += @('-t', '-A', '-F', '|') }
  if ($File) { $psqlArgs += @('-f', $File) }
  if ($Sql) { $psqlArgs += @('-c', $Sql) }
  return Invoke-Native -FilePath (Join-Path $PgBin 'psql.exe') -Arguments $psqlArgs -Env @{ PGPASSWORD = $Pg.Password; PGCLIENTENCODING = 'UTF8'; PGOPTIONS = '-c client_min_messages=warning' }
}

# ---------------------------------------------------------------------------------------------------------------------
# Retention: keep the newest $Keep archives and none older than $MaxAgeDays; the newest one is always kept.
# Only files named exactly bunprise-db-YYYY-MM-DD_HHmmss.7z are touched. Returns the names it deleted.
# ---------------------------------------------------------------------------------------------------------------------

function Invoke-BackupRetention([string] $Dir, [int] $Keep, [int] $MaxAgeDays, [datetime] $Now = (Get-Date)) {
  $archives = @(Get-ChildItem -LiteralPath $Dir -File -Filter 'bunprise-db-*.7z' | ForEach-Object {
      if ($_.Name -match '^bunprise-db-(\d{4}-\d{2}-\d{2}_\d{6})\.7z$') {
        [pscustomobject]@{ File = $_; Stamp = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd_HHmmss', [Globalization.CultureInfo]::InvariantCulture) }
      }
    } | Sort-Object Stamp -Descending)
  $deleted = [Collections.Generic.List[string]]::new()
  for ($i = 1; $i -lt $archives.Count; $i++) {
    $a = $archives[$i]
    if ($i -ge $Keep -or ($Now - $a.Stamp).TotalDays -gt $MaxAgeDays) {
      Remove-Item -LiteralPath $a.File.FullName -Force
      $deleted.Add($a.File.Name)
    }
  }
  # half-written archives of a run that was killed (never verified, so never a backup)
  Get-ChildItem -LiteralPath $Dir -File -Filter 'bunprise-db-*.partial' |
    Where-Object { ($Now - $_.LastWriteTime).TotalHours -gt 12 } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force; $deleted.Add($_.Name) }
  return , $deleted.ToArray()
}

# One line per run in <backup dir>\backup.log: time, status, archive name, sizes, counts, error text of the tool.
# Never personal data, never the passphrase, never dump content.
function Write-BackupLog([string] $Dir, [string] $Line) {
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  try { Add-Content -LiteralPath (Join-Path $Dir 'backup.log') -Value "$stamp $Line" -Encoding utf8 } catch { Write-Warning "could not write backup.log: $_" }
}
