# Bunprise — restore drill: proves that a backup archive can really be restored. docs/ops-backups.md.
#
# Decrypts a backup (default: the newest in E:\BALLR\_backups\bunprise) into a private temp folder, restores it into a
# throwaway LOCAL PostgreSQL 17 (the embedded one of packages/db-tests; 127.0.0.1, random port + password) and checks:
#   - every file matches the SHA-256 in manifest.json;
#   - every table of our schemas (public, private) and auth.users / auth.identities is restored with exactly as many
#     rows as the backup holds; every other restored table too;
#   - no foreign key points into nothing (checked by query; the restore itself loads with triggers off);
#   - every public table has RLS switched on, and every RLS policy of schema.sql exists again.
# Tables of Supabase services that do not exist locally (pg_cron, pg_net ...) are listed as "skipped" — on a real
# Supabase project they exist. Afterwards the server is stopped and ALL decrypted data is deleted (also on errors).
#
# Output: counts and table names only. A data error message from psql could quote a value: it is shown on this console
# only, never written to a file.
#
# Exit codes: 0 = PASS; 1 = FAIL (restore incomplete); 2 = not set up (tools, passphrase, no archive).
#
#   pwsh -File scripts/restore-db-test.ps1                       # newest backup
#   pwsh -File scripts/restore-db-test.ps1 -Archive <path.7z>
param(
  [string] $Archive,
  [string] $BackupRoot = 'E:\BALLR\_backups\bunprise',
  [string] $PgBin,
  # no line in backup.log (backup-selftest.ps1)
  [switch] $NoLog
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-common.ps1')

# Supabase roles that schema.sql / auth-schema.sql reference (owners, grants). roles.sql leaves them out on purpose.
$prelude = @'
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin',
    'supabase_auth_admin', 'supabase_storage_admin', 'supabase_functions_admin', 'supabase_realtime_admin',
    'supabase_replication_admin', 'supabase_read_only_user', 'supabase_etl_admin', 'dashboard_user', 'pgbouncer',
    'pgsodium_keyholder', 'pgsodium_keyiduser', 'pgsodium_keymaker', 'pgtle_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
  end loop;
end $$;
alter role service_role bypassrls;
create schema if not exists extensions;
'@

# Foreign keys whose rows point to nothing (MATCH SIMPLE: rows with a NULL key column are not checked).
$fkCheck = @'
create function pg_temp.fk_orphans() returns table (fk text, orphans bigint) language plpgsql as $$
declare r record; v_null text; v_join text; n bigint;
begin
  for r in select c.conname, c.conrelid::regclass as child, c.confrelid::regclass as parent, c.conkey, c.confkey
           from pg_constraint c where c.contype = 'f' loop
    select string_agg(format('c.%I is not null', a.attname), ' and '),
           string_agg(format('c.%I = p.%I', a.attname, pa.attname), ' and ')
      into v_null, v_join
      from unnest(r.conkey, r.confkey) as k(ck, pk)
      join pg_attribute a on a.attrelid = r.child and a.attnum = k.ck
      join pg_attribute pa on pa.attrelid = r.parent and pa.attnum = k.pk;
    execute format('select count(*) from %s c where %s and not exists (select 1 from %s p where %s)',
                   r.child, v_null, r.parent, v_join) into n;
    if n > 0 then fk := r.child::text || ' ' || r.conname; orphans := n; return next; end if;
  end loop;
end $$;
select 'ORPHAN|' || fk || '|' || orphans from pg_temp.fk_orphans();
select 'NORLS|' || c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
select 'POLICIES|' || count(*) from pg_policies where schemaname not in ('auth', 'storage');
'@

function Format-QualifiedName([string] $Name) {
  $schema, $table = $Name.Split('.', 2)
  return '"' + $schema.Replace('"', '""') + '"."' + $table.Replace('"', '""') + '"'
}

# data.sql -> only the COPY blocks (and sequence values) whose table / sequence exists in the drill database
function Write-RestorableData([string] $Source, [string] $Target, [hashtable] $Tables, [hashtable] $Sequences) {
  $skipped = [Collections.Generic.List[string]]::new()
  $reader = [IO.StreamReader]::new($Source, [Text.UTF8Encoding]::new($false))
  $writer = [IO.StreamWriter]::new($Target, $false, [Text.UTF8Encoding]::new($false))
  $writer.NewLine = "`n"
  try {
    $mode = 'sql'   # sql | keep | skip
    while ($null -ne ($line = $reader.ReadLine())) {
      if ($mode -eq 'sql') {
        if ($line -match '^COPY "([^"]+)"\."([^"]+)" .*FROM stdin;$') {
          $name = "$($Matches[1]).$($Matches[2])"
          if ($Tables.ContainsKey($name)) { $mode = 'keep'; $writer.WriteLine($line) } else { $mode = 'skip'; $skipped.Add($name) }
          continue
        }
        if ($line -match "^SELECT pg_catalog\.setval\('`"([^`"]+)`"\.`"([^`"]+)`"'" -and -not $Sequences.ContainsKey("$($Matches[1]).$($Matches[2])")) { continue }
        $writer.WriteLine($line)
      } else {
        if ($mode -eq 'keep') { $writer.WriteLine($line) }
        if ($line -eq '\.') { $mode = 'sql' }
      }
    }
  } finally { $reader.Dispose(); $writer.Dispose() }
  return , $skipped.ToArray()
}

function Show-SchemaErrors([string] $Label, [string] $Stderr) {
  $errors = @(($Stderr -split "`r?`n") | Where-Object { $_ -match 'ERROR:' } | ForEach-Object { ($_ -replace '^psql:.*?:\d+:\s*', '').Trim() })
  if ($errors.Count -eq 0) { Write-Host "   $Label`: no errors"; return 0 }
  Write-Host "   $Label`: $($errors.Count) statements failed (expected for Supabase-only extensions/roles); first ones:"
  $errors | Select-Object -Unique -First 6 | ForEach-Object { Write-Host "     - $_" -ForegroundColor DarkGray }
  return $errors.Count
}

$work = $null
$pg = $null
$exitCode = 0
$problems = [Collections.Generic.List[string]]::new()
try {
  $sevenZip = Find-SevenZip
  $pgClient = Find-PgClientBin $PgBin
  $null = Find-EmbeddedPgBin
  if (-not $Archive) {
    $newest = Get-ChildItem -LiteralPath $BackupRoot -File -Filter 'bunprise-db-*.7z' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $newest) { throw "PREREQ: no backup archive in $BackupRoot" }
    $Archive = $newest.FullName
  }
  if (-not (Test-Path -LiteralPath $Archive)) { throw "PREREQ: archive not found: $Archive" }
  $passphrase = Get-BackupPassphrase
  Write-Host "Restore drill for $(Split-Path -Leaf $Archive)" -ForegroundColor Cyan

  $work = Join-Path ([IO.Path]::GetTempPath()) ('bunprise-restore-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  $files = Join-Path $work 'files'

  Write-Host '== 1. decrypt + check SHA-256'
  Expand-EncryptedArchive -SevenZip $sevenZip -Archive $Archive -Destination $files -Passphrase $passphrase
  $manifest = Get-Content -Raw -LiteralPath (Join-Path $files 'manifest.json') | ConvertFrom-Json -AsHashtable
  foreach ($name in $manifest.files.Keys) {
    $hash = (Get-FileHash -LiteralPath (Join-Path $files $name) -Algorithm SHA256).Hash
    if ($hash -ne $manifest.files[$name].sha256) { throw "$name does not match its SHA-256 in manifest.json" }
  }
  Write-Host "   $($manifest.files.Count) files OK; backup made $($manifest.created) from: $($manifest.source)"

  Write-Host '== 2. start a throwaway local PostgreSQL'
  $pg = Start-LocalPg (Join-Path $work 'pg')
  $preludeFile = Join-Path $work 'prelude.sql'
  [IO.File]::WriteAllText($preludeFile, $prelude)
  $r = Invoke-LocalPsql -Pg $pg -PgBin $pgClient -File $preludeFile -StopOnError
  if ($r.ExitCode -ne 0) { throw "prelude failed: $(Get-ErrorTail $r.Stderr)" }

  Write-Host '== 3. roles, Supabase schemas, our schema'
  foreach ($name in 'roles.sql', 'auth-schema.sql', 'schema.sql') {
    $r = Invoke-LocalPsql -Pg $pg -PgBin $pgClient -File (Join-Path $files $name)
    $null = Show-SchemaErrors $name $r.Stderr
  }

  Write-Host '== 4. data (one transaction, stops at the first error)'
  $q = Invoke-LocalPsql -Pg $pg -PgBin $pgClient -Tuples -Sql @"
select 'T|' || n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema')
union all
select 'S|' || n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'S'
"@
  if ($q.ExitCode -ne 0) { throw "catalog query failed: $(Get-ErrorTail $q.Stderr)" }
  $localTables = @{}; $localSeqs = @{}
  foreach ($line in ($q.Stdout -split "`r?`n")) {
    if ($line -match '^T\|(.+)$') { $localTables[$Matches[1]] = $true }
    elseif ($line -match '^S\|(.+)$') { $localSeqs[$Matches[1]] = $true }
  }
  $restorable = Join-Path $work 'data-restorable.sql'
  $skipped = Write-RestorableData -Source (Join-Path $files 'data.sql') -Target $restorable -Tables $localTables -Sequences $localSeqs
  $r = Invoke-LocalPsql -Pg $pg -PgBin $pgClient -File $restorable -StopOnError
  if ($r.ExitCode -ne 0) { throw "data restore failed: $(Get-ErrorTail $r.Stderr 4)" }
  if ($skipped.Count) { Write-Host "   skipped (Supabase service tables that do not exist locally): $($skipped -join ', ')" -ForegroundColor DarkGray }

  Write-Host '== 5. checks'
  $required = @($manifest.tables.Keys | Where-Object { $_ -match '^(public|private)\.' -or $_ -in 'auth.users', 'auth.identities' })
  $toCount = @($manifest.tables.Keys | Where-Object { $localTables.ContainsKey($_) })
  foreach ($t in $required) { if (-not $localTables.ContainsKey($t)) { $problems.Add("table $t was not restored") } }
  $restoredRows = 0
  if ($toCount.Count) {
    $countSql = ($toCount | ForEach-Object { "select '$($_.Replace("'", "''"))' || '|' || count(*) from $(Format-QualifiedName $_)" }) -join "`nunion all "
    $c = Invoke-LocalPsql -Pg $pg -PgBin $pgClient -Tuples -Sql $countSql
    if ($c.ExitCode -ne 0) { throw "row count query failed: $(Get-ErrorTail $c.Stderr)" }
    foreach ($line in ($c.Stdout -split "`r?`n")) {
      if ($line -match '^(.+)\|(\d+)$') {
        $expected = [int64] $manifest.tables[$Matches[1]]
        $restoredRows += [int64] $Matches[2]
        if ([int64] $Matches[2] -ne $expected) { $problems.Add("$($Matches[1]): $($Matches[2]) rows restored, backup has $expected") }
      }
    }
  }
  Write-Host "   rows: $restoredRows restored in $($toCount.Count) tables (backup: $($manifest.total_rows) rows in $($manifest.tables.Count) tables)"

  $checkFile = Join-Path $work 'checks.sql'
  [IO.File]::WriteAllText($checkFile, $fkCheck)
  $c = Invoke-LocalPsql -Pg $pg -PgBin $pgClient -Tuples -File $checkFile -StopOnError
  if ($c.ExitCode -ne 0) { throw "check queries failed: $(Get-ErrorTail $c.Stderr)" }
  $policies = 0
  foreach ($line in ($c.Stdout -split "`r?`n")) {
    if ($line -match '^ORPHAN\|(.+)\|(\d+)$') { $problems.Add("foreign key $($Matches[1]): $($Matches[2]) rows point to nothing") }
    elseif ($line -match '^NORLS\|(.+)$') { $problems.Add("RLS is off on $($Matches[1])") }
    elseif ($line -match '^POLICIES\|(\d+)$') { $policies = [int] $Matches[1] }
  }
  $expectedPolicies = ([regex]::Matches([IO.File]::ReadAllText((Join-Path $files 'schema.sql')), '(?m)^CREATE POLICY ')).Count
  if ($policies -ne $expectedPolicies) { $problems.Add("RLS policies: $policies restored, schema.sql has $expectedPolicies") }
  Write-Host "   foreign keys checked; RLS policies: $policies of $expectedPolicies"

  $s = Invoke-LocalPsql -Pg $pg -PgBin $pgClient -Tuples -Sql @'
select 'users ' || (select count(*) from auth.users)
  || ' | profiles ' || coalesce((select count(*)::text from public.profiles), '-')
  || ' | profiles without account ' || coalesce((select count(*)::text from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id)), '-')
'@
  if ($s.ExitCode -eq 0) { Write-Host "   $($s.Stdout.Trim())" }

  if ($problems.Count) {
    $exitCode = 1
    Write-Host "`nFAIL - the backup did not restore completely:" -ForegroundColor Red
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    if (-not $NoLog) { Write-BackupLog $BackupRoot "DRILL FAIL $(Split-Path -Leaf $Archive) problems=$($problems.Count)" }
  } else {
    Write-Host "`nPASS - $(Split-Path -Leaf $Archive) restores completely ($restoredRows rows, $($toCount.Count) tables)." -ForegroundColor Green
    if (-not $NoLog) { Write-BackupLog $BackupRoot "DRILL PASS $(Split-Path -Leaf $Archive) tables=$($toCount.Count) rows=$restoredRows" }
  }
} catch {
  $msg = "$($_.Exception.Message)" -replace '\s+', ' '
  $exitCode = if ($msg.StartsWith('PREREQ:')) { 2 } else { 1 }
  Write-Host "`nFAIL - $msg" -ForegroundColor Red
  if (-not $NoLog -and $exitCode -eq 1) { Write-BackupLog $BackupRoot "DRILL FAIL $(if ($Archive) { Split-Path -Leaf $Archive }) error" }
} finally {
  Stop-LocalPg $pg
  if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
  if ($work -and (Test-Path -LiteralPath $work)) { Write-Warning "could not delete the decrypted temp folder $work - delete it by hand" }
}
exit $exitCode
