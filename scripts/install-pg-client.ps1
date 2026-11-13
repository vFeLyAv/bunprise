# Bunprise — install the PostgreSQL 17 client tools (pg_dump, pg_dumpall, psql) for the database backup.
# docs/ops-backups.md, step 1. Run once; no admin rights, no account, nothing is installed system-wide.
#
# Why: `supabase db dump` runs pg_dump inside Docker on Windows, and this PC has no Docker. backup-db.ps1 asks the
# Supabase CLI for the exact dump script (`--dry-run`) and runs it with these native tools instead.
#
# Source: the official Windows binaries of PostgreSQL by EnterpriseDB (linked from postgresql.org/download/windows).
# Only the bin folder (~70 MB) is kept, under %LOCALAPPDATA%\Programs\pgsql-17\bin. The download is checked against
# a pinned SHA-256 before anything is unpacked. (Not by code signature: in the EDB zip only stackbuilder.exe is signed —
# pg_dump.exe, psql.exe and the DLLs are not; found 27.10 on the real download.) The pinned hash was cross-checked with
# an independent source, the Scoop "versions" bucket (bucket/postgresql17.json, version 17.11). A new -Version needs
# its own -Sha256 (look it up the same way). Remove = delete that folder.
#
#   pwsh -File scripts/install-pg-client.ps1
param(
  # 17.x matches the hosted Supabase database (supabase/.temp/postgres-version: 17.11.x). pg_dump must be >= the server.
  [string] $Version = '17.11-1',
  # SHA-256 of postgresql-$Version-windows-x64-binaries.zip (27.10: our download = Scoop versions/postgresql17.json)
  [string] $Sha256 = '6EABDF00D2893713B75DB4336A23C3FDF505F056E217EC6E2E95D901750CFEA3',
  [string] $Target = (Join-Path $env:LOCALAPPDATA 'Programs\pgsql-17')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-common.ps1')

$sevenZip = Find-SevenZip
if (Test-Path -LiteralPath (Join-Path $Target 'bin\pg_dump.exe')) {
  Write-Host "Already installed: $(& (Join-Path $Target 'bin\pg_dump.exe') --version)"
  exit 0
}

$url = "https://get.enterprisedb.com/postgresql/postgresql-$Version-windows-x64-binaries.zip"
$work = Join-Path ([IO.Path]::GetTempPath()) ("bunprise-pgclient-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $zip = Join-Path $work 'pgsql.zip'
  Write-Host "Downloading $url (~340 MB) ..."
  $ProgressPreference = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest very slow
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
  Write-Host "SHA-256 of the download: $hash"
  if ($hash -ne $Sha256.ToUpperInvariant()) { throw "the download does not match the pinned SHA-256 $Sha256 - not installed" }

  # only pgsql\bin (programs + their DLLs); the server, docs and pgAdmin are not needed
  & $sevenZip x $zip "-o$work\x" 'pgsql\bin\*' -y -bso0 -bsp0
  if ($LASTEXITCODE -ne 0) { throw "7-Zip could not unpack the download (exit $LASTEXITCODE)" }

  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  Move-Item -LiteralPath (Join-Path $work 'x\pgsql\bin') -Destination (Join-Path $Target 'bin')
  Write-Host "Installed to $Target\bin"
  & (Join-Path $Target 'bin\pg_dump.exe') --version
  & (Join-Path $Target 'bin\psql.exe') --version
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
