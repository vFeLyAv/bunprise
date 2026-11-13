# Bunprise — self-test of the backup scripts with SYNTHETIC data only (no production database, no real people).
# docs/ops-backups.md. Run after changing backup-db.ps1 / restore-db-test.ps1 / backup-common.ps1.
#
#   1. throwaway local PostgreSQL 17 (embedded, packages/db-tests) + the test shims + every supabase/migrations/*.sql
#   2. invented people (example.test), an occasion, 300 wishes (with umlauts, tabs and line breaks), invite, reservation
#   3. backup-db.ps1 -DbUrl <that database> into a temp folder, with a random test passphrase (process env var only)
#   4. restore-db-test.ps1 on the archive -> must PASS; again with a wrong passphrase -> must FAIL
#   5. retention rule on dummy files (8 newest, max 49 days, newest always kept)
# Everything is deleted at the end. Exit code 0 = all good.
#
#   pwsh -File scripts/backup-selftest.ps1
param([string] $PgBin)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-common.ps1')

$seed = @'
\set ON_ERROR_STOP 1
insert into auth.users (email, raw_user_meta_data) values
  ('anna@example.test', '{"name": "Anna"}'), ('ben@example.test', '{"name": "Ben"}'),
  ('cem@example.test', '{"name": "Cem"}'), ('dana@example.test', '{"name": "Dana Müller-Öztürk"}');
insert into public.consents (profile_id, kind, version, locale)
  select u.id, lv.kind, lv.version, 'de' from auth.users u cross join public.legal_versions lv;
select id as host from auth.users where email = 'anna@example.test' \gset
select id as ben from auth.users where email = 'ben@example.test' \gset
select id as cem from auth.users where email = 'cem@example.test' \gset

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'host', true), set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', :'host', 'role', 'authenticated')::text, true);
insert into public.occasions (host_id, title, starts_at, tz, place_text)
  values (:'host', 'Geburtstag Anna', now() + interval '30 days', 'Europe/Berlin', 'Bei Anna, Straße 1') returning id as occ \gset
commit;
select id as wl from public.wishlists where occasion_id = :'occ' \gset

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'host', true), set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', :'host', 'role', 'authenticated')::text, true);
insert into public.wishes (wishlist_id, title, priority, note)
  values (:'wl', 'Kopfhörer', 3, E'Farbe: schwarz\nGröße:\tM — "bitte" \\ danke') returning id as w1 \gset
insert into public.wishes (wishlist_id, title, priority, note)
  select :'wl', 'Wunsch Nr. ' || g, 1 + g % 3, case when g % 7 = 0 then E'zwei\nZeilen' end from generate_series(1, 299) g;
select public.create_invite(:'occ') ->> 'token' as token \gset
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'ben', true), set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', :'ben', 'role', 'authenticated')::text, true);
select public.accept_invite(:'token');
select public.reserve_wish(:'w1');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'cem', true), set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', :'cem', 'role', 'authenticated')::text, true);
select public.accept_invite(:'token');
commit;

select 'seeded: ' || (select count(*) from auth.users) || ' users, ' || (select count(*) from public.wishes) || ' wishes, '
  || (select count(*) from public.reservations) || ' reservation(s)';
'@

$failures = [Collections.Generic.List[string]]::new()
function Check([bool] $ok, [string] $what) {
  if ($ok) { Write-Host "  ok   $what" -ForegroundColor Green } else { Write-Host "  FAIL $what" -ForegroundColor Red; $failures.Add($what) }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('bunprise-selftest-' + [guid]::NewGuid().ToString('N'))
$src = $null
$pwsh = (Get-Process -Id $PID).Path
try {
  $pgClient = Find-PgClientBin $PgBin
  New-Item -ItemType Directory -Path $root | Out-Null

  Write-Host '== synthetic source database' -ForegroundColor Cyan
  $src = Start-LocalPg (Join-Path $root 'src')
  $files = @(Join-Path $script:RepoRoot 'packages\db-tests\shims\000_supabase_shims.sql') +
    @(Get-ChildItem -LiteralPath (Join-Path $script:RepoRoot 'supabase\migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object FullName)
  foreach ($f in $files) {
    $r = Invoke-LocalPsql -Pg $src -PgBin $pgClient -File $f -StopOnError
    if ($r.ExitCode -ne 0) { throw "$(Split-Path -Leaf $f) failed: $(Get-ErrorTail $r.Stderr)" }
  }
  $seedFile = Join-Path $root 'seed.sql'
  [IO.File]::WriteAllText($seedFile, $seed, [Text.UTF8Encoding]::new($false))
  $r = Invoke-LocalPsql -Pg $src -PgBin $pgClient -File $seedFile -StopOnError -Tuples
  if ($r.ExitCode -ne 0) { throw "seed failed: $(Get-ErrorTail $r.Stderr)" }
  Write-Host "  $($files.Count) SQL files applied; $(($r.Stdout -split "`n" | Where-Object { $_ -like 'seeded:*' }))"

  # random test passphrase, for the child processes of this run only
  [Environment]::SetEnvironmentVariable($script:PassphraseEnvVar, [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)), 'Process')
  $backups = Join-Path $root 'backups'
  $dbUrl = "postgresql://postgres:$($src.Password)@127.0.0.1:$($src.Port)/postgres"

  Write-Host '== backup-db.ps1 (synthetic database)' -ForegroundColor Cyan
  & $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'backup-db.ps1') -DbUrl $dbUrl -BackupRoot $backups -PgBin $pgClient
  Check ($LASTEXITCODE -eq 0) 'backup-db.ps1 exit code 0'
  $archives = @(Get-ChildItem -LiteralPath $backups -Filter 'bunprise-db-*.7z' -ErrorAction SilentlyContinue)
  Check ($archives.Count -eq 1) 'exactly one archive written'
  Check (@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'bunprise-backup-*').Count -eq 0) 'no plaintext temp folder left behind'
  Check ((Get-Content -LiteralPath (Join-Path $backups 'backup.log') -Raw) -match ' OK bunprise-db-') 'backup.log has an OK line'
  if ($archives.Count -ge 1) {
    $head = [IO.File]::ReadAllBytes($archives[0].FullName)
    $asText = [Text.Encoding]::UTF8.GetString($head)
    Check ($asText -notmatch 'example\.test|CREATE TABLE|Kopfh') 'archive bytes contain no readable SQL, e-mail or file names'
  }
  Stop-LocalPg $src; $src = $null

  Write-Host '== restore-db-test.ps1 (must PASS)' -ForegroundColor Cyan
  & $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'restore-db-test.ps1') -BackupRoot $backups -PgBin $pgClient -NoLog
  Check ($LASTEXITCODE -eq 0) 'restore drill PASS'

  Write-Host '== restore-db-test.ps1 with a wrong passphrase (must FAIL)' -ForegroundColor Cyan
  [Environment]::SetEnvironmentVariable($script:PassphraseEnvVar, 'definitely-the-wrong-passphrase', 'Process')
  & $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'restore-db-test.ps1') -BackupRoot $backups -PgBin $pgClient -NoLog
  Check ($LASTEXITCODE -eq 1) 'wrong passphrase -> exit code 1'
  Check (@(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'bunprise-restore-*').Count -eq 0) 'no decrypted temp folder left behind'

  Write-Host '== retention' -ForegroundColor Cyan
  $ret = Join-Path $root 'retention'
  New-Item -ItemType Directory -Path $ret | Out-Null
  $now = Get-Date '2026-12-31 12:00'
  0..11 | ForEach-Object { New-Item -ItemType File -Path (Join-Path $ret ('bunprise-db-' + $now.AddDays(-7 * $_).ToString('yyyy-MM-dd_HHmmss') + '.7z')) | Out-Null }
  New-Item -ItemType File -Path (Join-Path $ret 'notes.7z') | Out-Null
  $deleted = Invoke-BackupRetention -Dir $ret -Keep 8 -MaxAgeDays 49 -Now $now
  $left = @(Get-ChildItem -LiteralPath $ret -Filter 'bunprise-db-*.7z' | Sort-Object Name -Descending)
  Check ($left.Count -eq 8 -and $deleted.Count -eq 4) "12 weekly archives -> 8 kept, 4 deleted (kept $($left.Count), deleted $($deleted.Count))"
  Check ($left[0].Name -eq ('bunprise-db-' + $now.ToString('yyyy-MM-dd_HHmmss') + '.7z')) 'the newest archive is kept'
  Check (Test-Path -LiteralPath (Join-Path $ret 'notes.7z')) 'files with other names are never touched'
  Get-ChildItem -LiteralPath $ret -Filter 'bunprise-db-*.7z' | Remove-Item
  0..2 | ForEach-Object { New-Item -ItemType File -Path (Join-Path $ret ('bunprise-db-' + $now.AddDays(-100 - $_).ToString('yyyy-MM-dd_HHmmss') + '.7z')) | Out-Null }
  $null = Invoke-BackupRetention -Dir $ret -Keep 8 -MaxAgeDays 49 -Now $now
  Check (@(Get-ChildItem -LiteralPath $ret -Filter 'bunprise-db-*.7z').Count -eq 1) 'only old archives -> the newest one survives, older than 49 days go'
} catch {
  $failures.Add("$($_.Exception.Message)")
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  [Environment]::SetEnvironmentVariable($script:PassphraseEnvVar, $null, 'Process')
  Stop-LocalPg $src
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}
if ($failures.Count) { Write-Host "`nSELFTEST FAILED ($($failures.Count))" -ForegroundColor Red; exit 1 }
Write-Host "`nSELFTEST PASSED" -ForegroundColor Green
exit 0
