# Bunprise — publish the web app (and with it the Telegram Mini App) to Cloudflare. docs/release-web.md, step 4.
#
# Only after Felix's explicit OK for this deploy. Needs once: `npx wrangler login` (Felix's own Cloudflare account).
# No secrets in here: Vite reads the public Supabase key from apps/web/.env.local (never printed); the Worker needs
# only SUPABASE_URL (workers/edge/wrangler.jsonc).
#
#   powershell -ExecutionPolicy Bypass -File scripts/release-web.ps1 -AppUrl https://bunprise.de -DryRun
#   powershell -ExecutionPolicy Bypass -File scripts/release-web.ps1 -AppUrl https://bunprise.de
param(
  # the app's address: https://<host>, no path, no trailing slash; the host must be the custom domain in wrangler.jsonc
  [Parameter(Mandatory = $true)] [string] $AppUrl,
  # everything (check, production build, budget, Worker bundle) — but nothing is uploaded
  [switch] $DryRun
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Step([string] $name, [scriptblock] $run) {
  Write-Host "`n== $name" -ForegroundColor Cyan
  & $run
  if ($LASTEXITCODE -ne 0) { throw "$name failed (exit $LASTEXITCODE) - nothing was published" }
}

if ($AppUrl -notmatch '^https://[a-z0-9.-]+$') { throw "AppUrl must look like https://bunprise.de (no path, no trailing slash)" }
# The build's address and the Worker's custom domain must be the same site (sign-in redirects, PWA, Telegram).
$appHost = $AppUrl.Substring('https://'.Length)
$wrangler = Get-Content -Raw -LiteralPath (Join-Path $repo 'workers/edge/wrangler.jsonc')
if ($wrangler -notmatch ('"pattern":\s*"' + [regex]::Escape($appHost) + '",\s*"custom_domain":\s*true')) { throw "$appHost is not the custom domain in workers/edge/wrangler.jsonc" }

Set-Location -LiteralPath $repo
# Publish exactly a commit: the build reads the working tree, and helpers often edit it in parallel (27.10). Any
# uncommitted change in what goes into the app or the Worker stops the release (docs/ may differ).
$dirty = @(git status --porcelain -- apps workers packages supabase scripts | Where-Object { $_ })
if ($dirty.Count -gt 0) {
  throw "uncommitted changes in the app / Worker / database files - commit them (or wait for the helpers) first; nothing was published:`n$($dirty -join "`n")"
}
Step 'npm run check (types, lint, all tests, build, budget)' { npm run check }

# Production flags: the same choices as the live preview on 5174 (run-real-preview.ps1), with the real address.
$env:VITE_DEMO = '0'
$env:VITE_GOOGLE_ENABLED = '1'
$env:VITE_APPLE_ENABLED = '0'
$env:VITE_LISTS = '1'
# the bring-along list "Mitbringen" (features/potluck): ON with the pilot-3 release (Felix 25.10). Publish ONLY after
# Felix's db push of 20261025150000_potluck.sql + 20261025160000_legal_versions_pilot_3.sql (the app calls its RPCs)
$env:VITE_POTLUCK = '1'
# in-app invitations "Freunde einladen" (features/invitations): ON with the 4th release (Felix 26.10: «так включи
# приглашения и исправь Datenschutz и AGB»), together with the pilot-4 legal texts. Publish ONLY after Felix's db push of
# 20261026180000 + 20261026190000 + 20261026200000_legal_versions_pilot_4 + 20261027120000_occasion_invitations +
# 20261027130000_occasion_invitations_on (the app calls the invitation RPCs) — docs/handoffs/2026-10-27-in-app-invites.md
$env:VITE_INVITES = '1'
# 5th release (Felix 27.10: «так все включаем») — ON, together with the pilot-5 legal texts
# (20261027220000_legal_versions_pilot_5). Publish ONLY after Felix's db push of every 20261027140000…20261027230000
# migration (the app calls their RPCs) — docs/handoffs/2026-10-27-release-5-steps.md:
#   Web Push "X lädt dich ein" (features/push): also needs the Worker secrets + Vault secret (push-keys.mjs) BEFORE this
#   publish; the database switch (web_push_on) follows AFTER it, once /api/push/key answers 200 — until then switching
#   push on in the app answers "unavailable" (features/push/device.ts:121), nothing is stored (docs/handoffs/2026-10-27-web-push.md)
$env:VITE_PUSH = '1'
#   one wish in several lists (lib/api/wishPlaces.ts) + 20261027230000_shared_wishes_on — docs/handoffs/2026-10-27-shared-wishes.md
$env:VITE_SHARED_WISHES = '1'
#   covers (occasion motifs): 20261027140000_occasion_cover_theme — docs/handoffs/2026-10-27-occasion-covers.md
$env:VITE_COVERS = '1'
#   friend codes ("Mein Code", QR): 20261027160000_friend_codes — docs/handoffs/2026-10-27-add-friends.md
$env:VITE_FRIEND_CODES = '1'
#   Kalender-Abo: 20261027170000_calendar_feed + Worker CALENDAR_FEED (wrangler.jsonc) + the Worker secret
#   SUPABASE_PUBLISHABLE_KEY — docs/handoffs/2026-10-27-calendar.md
$env:VITE_CALENDAR_FEED = '1'
# the invitation e-mail (features/inviteEmail): still OFF in the 6th release (Felix 31.10: no Brevo key yet;
#   docs/handoffs/2026-10-27-invite-email.md). 20261028000000_invite_email is pushed with this release but creates the
#   feature switched off; ON needs the Worker secret BREVO_API_KEY + a privacy text built WITH inviteemail (pilot-7) +
#   the database switch (supabase/emergency/invite_email_on.sql) first
$env:VITE_INVITE_EMAIL = '0'
# "Anzahl" + "Passt zusammen" (features/wishes, lib/api/wishExtras.ts): ON with the 6th release (Felix 31.10), together
#   with the pilot-6 privacy text that describes both. Publish ONLY after Felix's db push of
#   20261030120000_wish_quantity_together + 20261031120000_legal_versions_pilot_6 + 20261031130000_wish_extras_on (the
#   database switch) — docs/handoffs/2026-10-31-release-6-steps.md, docs/handoffs/2026-10-30-quantity-together.md
$env:VITE_WISH_QUANTITY = '1'
$env:VITE_WISH_TOGETHER = '1'
$env:VITE_TURNSTILE_SITE_KEY = ' '
$env:VITE_APP_URL = $AppUrl
$env:VITE_SUPABASE_URL = 'https://wqubtdwpnsbnergjkhzl.supabase.co'
[Environment]::SetEnvironmentVariable('BUNPRISE_ISOLATED_CHECK', $null, 'Process')

Step 'production build' { npm run build -w @bunprise/web }
Step 'bundle budget of the production build' { node apps/web/scripts/size.mjs }

# The build must carry the public Supabase key (from .env.local) and the real address, and no demo backend.
$assets = Join-Path $repo 'apps/web/dist/assets'
if (-not (Select-String -Path "$assets/*.js" -SimpleMatch -Pattern $AppUrl -Quiet)) { throw "the build does not contain $AppUrl" }
if (-not (Select-String -Path "$assets/*.js" -SimpleMatch -Pattern 'wqubtdwpnsbnergjkhzl.supabase.co' -Quiet)) { throw 'the build has no Supabase address' }
if (Select-String -Path "$assets/*.js" -SimpleMatch -Pattern 'mockServiceWorker' -Quiet) { throw 'the build contains the demo backend (MSW)' }
# The public key must be in (else sign-in fails only in the browser — Codex review 24.10); a SECRET key never.
# Only key VALUES count: supabase-js itself contains the bare prefixes in a startsWith check. Nothing is printed.
if (-not (Select-String -Path "$assets/*.js" -Pattern 'sb_publishable_[A-Za-z0-9_-]{10,}' -Quiet)) { throw 'the build has no Supabase publishable key (apps/web/.env.local)' }
if (Select-String -Path "$assets/*.js" -Pattern 'sb_secret_[A-Za-z0-9_-]{10,}' -Quiet) { throw 'the build contains a Supabase SECRET key - stop, nothing was published' }
if (Test-Path (Join-Path $repo 'apps/web/dist/mockServiceWorker.js')) { throw 'dist contains mockServiceWorker.js (demo backend)' }

Set-Location -LiteralPath (Join-Path $repo 'workers/edge')
if ($DryRun) {
  $out = Join-Path ([IO.Path]::GetTempPath()) 'bunprise-release-dry-run'
  Step 'Worker bundle (dry run, nothing uploaded)' { npx wrangler deploy --dry-run --outdir $out }
  Write-Host "`nDry run OK: $AppUrl would be published. Nothing was uploaded." -ForegroundColor Green
} else {
  Step 'publish to Cloudflare' { npx wrangler deploy }
  Write-Host "`nPublished. Next: curl -I $AppUrl (headers), then docs/release-web.md step 5." -ForegroundColor Green
}
