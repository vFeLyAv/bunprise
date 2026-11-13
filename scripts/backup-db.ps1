# Bunprise — encrypted backup of the production database to this PC. docs/ops-backups.md (Russian, step by step).
#
# What it does (free Supabase plan = no downloadable backups, so we make our own):
#   1. asks the Supabase CLI for its own `db dump` scripts (--dry-run; on Windows the CLI would run them in Docker,
#      which this PC does not have) and runs them with the native PostgreSQL 17 tools in Git Bash:
#        roles.sql            custom roles (Supabase's own roles are left out, they exist in every project)
#        schema.sql           our schemas (public, private, ...): tables, functions, RLS policies, grants
#        data.sql             ALL rows incl. auth (users, identities, sessions ...) and storage metadata, as COPY
#        auth-schema.sql      definition of the Supabase schema auth (users, identities ...) for the local restore
#                             drill only; a new Supabase project already has it. One schema per dump: the CLI's
#                             --dry-run pastes '-s a,b' as an unquoted a|b, which bash would read as a pipe
#      Photos are bytea columns in our tables, so they are inside data.sql.
#   2. manifest.json: rows per table (counted in data.sql), size + SHA-256 of every file, tool versions
#   3. 7-Zip AES-256 archive with encrypted file names (-mhe) -> <BackupRoot>\bunprise-db-YYYY-MM-DD_HHmmss.7z,
#      then tests it and compares its listing with the manifest
#   4. deletes the plaintext temp folder (always, also on errors), applies retention (8 newest, none older than 7 weeks at the time of a run = max 8 weeks)
#   5. one line in <BackupRoot>\backup.log (no personal data); on failure also LAST-BACKUP-FAILED.txt
#
# The Supabase login of `npx supabase login` is enough: with --linked the CLI mints a short-lived database login
# for each dump, so no database password is stored anywhere. The archive passphrase comes from the Windows
# Credential Manager (set once with -SetPassphrase); it never touches a file, a log or a command line.
#
# Exit codes: 0 = backup written and verified; 1 = backup failed; 2 = something is not set up (tools, passphrase).
#
#   pwsh -File scripts/backup-db.ps1 -SetPassphrase     # once: store the passphrase
#   pwsh -File scripts/backup-db.ps1                    # make a backup
param(
  [switch] $SetPassphrase,
  # outside the repo, never in git
  [string] $BackupRoot = 'E:\BALLR\_backups\bunprise',
  [int] $Keep = 8,
  # 49: with weekly runs no archive lives longer than 8 weeks (privacy text: "höchstens acht Wochen")
  [int] $MaxAgeDays = 49,
  # Supabase CLI package for npx. Pinned: the script relies on the shape of its --dry-run output.
  [string] $SupabaseCli = 'supabase@2.122.0',
  [string] $PgBin,
  # TESTS ONLY (backup-selftest.ps1): dump this database URL instead of the linked project
  [string] $DbUrl
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-common.ps1')

if ($SetPassphrase) {
  Set-BackupPassphrase
  exit 0
}

# --- the four dumps: file name + `supabase db dump` flags ------------------------------------------------------------
$parts = [ordered]@{
  'roles.sql'           = @('--role-only')
  'schema.sql'          = @()
  # the two storage tables are excluded as in Supabase's backup guide (vector buckets; not used by Bunprise)
  'data.sql'            = @('--data-only', '--use-copy', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes')
  'auth-schema.sql'     = @('-s', 'auth')
}

function Get-DumpScript([string[]] $Flags) {
  $target = if ($DbUrl) { @('--db-url', $DbUrl) } else { @('--linked') }
  $cliArgs = @('--yes', $SupabaseCli, 'db', 'dump') + $target + $Flags + @('--workdir', $script:RepoRoot, '--dry-run')
  # node + npm's npx-cli.js directly (no cmd.exe parsing of the arguments); fallback: npx.cmd through cmd
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npxCli = if ($node) { Join-Path (Split-Path -Parent $node.Source) 'node_modules\npm\bin\npx-cli.js' }
  $r = if ($npxCli -and (Test-Path -LiteralPath $npxCli)) {
    Invoke-Native -FilePath $node.Source -Arguments (@($npxCli) + $cliArgs)
  } else {
    Invoke-Native -FilePath 'cmd.exe' -Arguments @('/d', '/s', '/c', ('npx ' + ($cliArgs -join ' ')))
  }
  # stdout holds the database login (PGPASSWORD) in clear text: it stays in memory and is never printed or logged
  if ($r.ExitCode -ne 0) { throw "supabase db dump --dry-run failed (exit $($r.ExitCode)): $(Get-ErrorTail $r.Stderr)" }
  $start = $r.Stdout.IndexOf('#!/usr/bin/env bash')
  if ($start -lt 0) { throw "unexpected output of supabase db dump --dry-run (CLI $SupabaseCli changed?) - not executed" }
  $text = $r.Stdout.Substring($start)
  if ($text -notmatch '(?m)^pg_dump(all)? \\\r?$' -or $text -match '(?i)docker') {
    throw "unexpected output of supabase db dump --dry-run (CLI $SupabaseCli changed?) - not executed"
  }
  # The CLI's templates are written for the Linux tools in its Docker image, whose getopt accepts abbreviated long
  # options; the Windows build of PostgreSQL accepts only full names ("pg_dumpall: illegal option --
  # quote-all-identifier", found 27.10). --quote-all-identifier is the only abbreviation in the templates of CLI 2.122.0
  # (checked in the binary); give it its full name.
  return [regex]::Replace($text, '--quote-all-identifier(?![a-z])', '--quote-all-identifiers')
}

function Invoke-DumpScript([string] $Script, [string] $OutFile, [string] $Bash, [string] $PgClientBin) {
  # bash reads the whole script first (eval "$(cat)"), so pg_dump can never consume script text from stdin
  $prelude = "export PATH=$(ConvertTo-BashPath $PgClientBin):/usr/bin:`"`$PATH`"`nexec > $(ConvertTo-BashPath $OutFile)`n"
  $r = Invoke-Native -FilePath $Bash -Arguments @('--noprofile', '--norc', '-c', 'eval "$(cat)"') -StdinText ($prelude + $Script)
  if ($r.ExitCode -ne 0) {
    # bash could echo a script line in its error text: never let the temporary database password reach the log
    $errText = $r.Stderr
    if ($Script -match 'export PGPASSWORD="([^"]+)"') { $errText = $errText.Replace($Matches[1], '***') }
    throw "pg_dump failed for $(Split-Path -Leaf $OutFile) (exit $($r.ExitCode)): $(Get-ErrorTail $errText)"
  }
}

# --- run -----------------------------------------------------------------------------------------------------------
$started = Get-Date
$step = 'setup'
$work = $null
$partial = $null
$exitCode = 0
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$failedMarker = Join-Path $BackupRoot 'LAST-BACKUP-FAILED.txt'
try {
  $step = 'prerequisites'
  $sevenZip = Find-SevenZip
  $pgClient = Find-PgClientBin $PgBin
  $bash = Find-GitBash
  $passphrase = Get-BackupPassphrase

  # plaintext only in the user's own temp folder (readable by this Windows user only), deleted in `finally`
  $work = Join-Path ([IO.Path]::GetTempPath()) ('bunprise-backup-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null

  foreach ($name in $parts.Keys) {
    $step = "dump $name"
    Write-Host "== $step"
    $out = Join-Path $work $name
    Invoke-DumpScript -Script (Get-DumpScript $parts[$name]) -OutFile $out -Bash $bash -PgClientBin $pgClient
    if (-not (Test-Path -LiteralPath $out) -or (Get-Item -LiteralPath $out).Length -eq 0) { throw "$name is empty" }
  }

  $step = 'check dumps'
  $schemaText = [IO.File]::ReadAllText((Join-Path $work 'schema.sql'))
  if ($schemaText -notmatch '(?m)^CREATE TABLE ') { throw 'schema.sql contains no CREATE TABLE - wrong database?' }
  $tail = (Get-Content -LiteralPath (Join-Path $work 'data.sql') -Tail 3) -join "`n"
  if ($tail -notmatch 'RESET ALL;') { throw 'data.sql is incomplete (no end marker)' }
  $rows = Get-CopyRowCounts (Join-Path $work 'data.sql')
  if (-not $DbUrl -and -not $rows.Contains('auth.users')) { throw 'data.sql has no auth.users data' }

  $step = 'manifest'
  $pgDumpVersion = (& (Join-Path $pgClient 'pg_dump.exe') --version) -join ' '
  $files = [ordered]@{}
  foreach ($name in $parts.Keys) {
    $path = Join-Path $work $name
    $files[$name] = [ordered]@{ bytes = (Get-Item -LiteralPath $path).Length; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
  }
  $totalRows = 0; foreach ($v in $rows.Values) { $totalRows += $v }
  $manifest = [ordered]@{
    format         = 'bunprise-db-backup/1'
    created        = $started.ToString('o')
    source         = $(if ($DbUrl) { 'test database (--db-url)' } else { 'linked Supabase project' })
    supabase_cli   = $SupabaseCli
    pg_dump        = $pgDumpVersion
    files          = $files
    tables         = $rows
    total_rows     = $totalRows
  }
  [IO.File]::WriteAllText((Join-Path $work 'manifest.json'), ($manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

  $step = 'encrypt'
  $name = 'bunprise-db-' + $started.ToString('yyyy-MM-dd_HHmmss') + '.7z'
  $final = Join-Path $BackupRoot $name
  $partial = "$final.partial"
  if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  New-EncryptedArchive -SevenZip $sevenZip -Archive $partial -SourceDir $work -Passphrase $passphrase

  $step = 'verify'
  Test-EncryptedArchive -SevenZip $sevenZip -Archive $partial -Passphrase $passphrase
  $listing = Get-ArchiveListing -SevenZip $sevenZip -Archive $partial -Passphrase $passphrase
  foreach ($n in $files.Keys) {
    if (-not $listing.ContainsKey($n) -or $listing[$n] -ne $files[$n].bytes) { throw "archive check: $n missing or wrong size" }
  }
  if (-not $listing.ContainsKey('manifest.json')) { throw 'archive check: manifest.json missing' }
  Move-Item -LiteralPath $partial -Destination $final

  $step = 'retention'
  $deleted = Invoke-BackupRetention -Dir $BackupRoot -Keep $Keep -MaxAgeDays $MaxAgeDays
  $kept = @(Get-ChildItem -LiteralPath $BackupRoot -File -Filter 'bunprise-db-*.7z').Count

  $seconds = [int]((Get-Date) - $started).TotalSeconds
  $sizeKb = [math]::Round((Get-Item -LiteralPath $final).Length / 1KB)
  $line = "OK $name size=${sizeKb}KB tables=$($rows.Count) rows=$totalRows time=${seconds}s kept=$kept deleted=$($deleted.Count)"
  Write-BackupLog $BackupRoot $line
  if (Test-Path -LiteralPath $failedMarker) { Remove-Item -LiteralPath $failedMarker -Force }
  Write-Host "`n$line`n-> $final" -ForegroundColor Green
} catch {
  $msg = "$($_.Exception.Message)" -replace '\s+', ' '
  $exitCode = if ($msg.StartsWith('PREREQ:')) { 2 } else { 1 }
  $line = "FAIL step=`"$step`" exit=$exitCode $msg"
  Write-BackupLog $BackupRoot $line
  Set-Content -LiteralPath $failedMarker -Encoding utf8 -Value @(
    "Bunprise: the database backup FAILED at $((Get-Date).ToString('yyyy-MM-dd HH:mm')).",
    "Step: $step", "Error: $msg", '', 'What to do: docs/ops-backups.md, section "Если бэкап не сработал".')
  Write-Host "`n$line" -ForegroundColor Red
} finally {
  # an archive that was not verified is not a backup
  if ($partial -and (Test-Path -LiteralPath $partial)) { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue }
  if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
  if ($work -and (Test-Path -LiteralPath $work)) { Write-Warning "could not delete the plaintext temp folder $work - delete it by hand" }
}
exit $exitCode
