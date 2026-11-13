// Web Push keys for the Worker (docs/handoffs/2026-10-27-web-push.md). Run by FELIX, on his own computer, once:
//   node workers/edge/scripts/push-keys.mjs            → creates the keys and hands them straight to Cloudflare
//                                                          (npx wrangler secret put …): the private key is never shown
//   node workers/edge/scripts/push-keys.mjs --print    → only prints the three values (to paste by hand)
// It makes:
//   VAPID_PRIVATE_KEY     the Worker's signing key (P-256 scalar, base64url) — the secret that matters most
//   VAPID_PUBLIC_KEY      its public half (65-byte point, base64url) — not secret; browsers subscribe with it
//   PUSH_DISPATCH_SECRET  shared with the database (Supabase Vault "push_dispatch_secret"): signs the batches
// and prints, ONCE, the SQL line that puts the dispatch secret into Supabase Vault (paste it into the SQL editor).
// Nothing is written to a file. Running it again makes NEW keys: every device must then switch push on again.
// Uses only Node's own crypto (no package from the internet).

import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const config = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.jsonc')
const printOnly = process.argv.includes('--print')

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const jwk = privateKey.export({ format: 'jwk' })
const fromB64 = (value) => Buffer.from(value, 'base64url')
const publicRaw = Buffer.concat([Buffer.from([4]), fromB64(jwk.x), fromB64(jwk.y)])
if (publicRaw.length !== 65 || fromB64(jwk.d).length !== 32) throw new Error('unexpected key size')

const secrets = {
  VAPID_PRIVATE_KEY: jwk.d,
  VAPID_PUBLIC_KEY: publicRaw.toString('base64url'),
  PUSH_DISPATCH_SECRET: randomBytes(32).toString('base64url'),
}

if (printOnly) {
  console.log('\nThree Worker secrets (paste each into `npx wrangler secret put <NAME> -c workers/edge/wrangler.jsonc`):\n')
  for (const [name, value] of Object.entries(secrets)) console.log(`${name}=${value}`)
} else {
  for (const [name, value] of Object.entries(secrets)) {
    process.stdout.write(`wrangler secret put ${name} … `)
    const result = spawnSync('npx', ['wrangler', 'secret', 'put', name, '-c', config], {
      input: `${value}\n`, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (result.status !== 0) {
      console.log('FAILED')
      console.error(result.stderr || result.stdout)
      console.error('\nNothing is lost: run the script again (it makes new keys). Logged in? `npx wrangler login`.')
      process.exit(1)
    }
    console.log('ok')
  }
  console.log(`\nVAPID public key (not secret): ${secrets.VAPID_PUBLIC_KEY}`)
}

console.log('\nNow the database: Supabase dashboard → SQL Editor → paste and run this ONE line (it contains the secret;')
console.log('do not save it as a snippet, do not send it to anyone):\n')
console.log(`select vault.create_secret('${secrets.PUSH_DISPATCH_SECRET}', 'push_dispatch_secret', 'Web Push: signs the batches to the Worker');`)
console.log('\n(Already there from an earlier run? Then instead:')
console.log(`select vault.update_secret((select id from vault.secrets where name = 'push_dispatch_secret'), '${secrets.PUSH_DISPATCH_SECRET}');)\n`)
