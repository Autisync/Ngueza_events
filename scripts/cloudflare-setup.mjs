#!/usr/bin/env node
/**
 * One-time production setup for Cloudflare media + scheduled jobs.
 *
 *   node scripts/cloudflare-setup.mjs            # do it
 *   node scripts/cloudflare-setup.mjs --dry-run  # print what it would do
 *
 * Run from the root of a CLEAN clone of main, on a machine with Node 20+
 * (step 5 deploys this checkout to production, so it refuses a dirty tree
 * or another branch):
 *
 *   git clone https://github.com/Autisync/Ngueza_events ngueza-setup
 *   cd ngueza-setup && node scripts/cloudflare-setup.mjs
 *
 * It:
 *
 *   1. signs in to Cloudflare (wrangler) and Vercel if needed — each opens
 *      a browser once;
 *   2. generates IMAGES_KEY and CRON_SECRET locally (never printed);
 *   3. deploys the image Worker (deploy/cloudflare-images) and the cron
 *      Worker (deploy/cloudflare-cron), and gives each its secret;
 *   4. sets IMAGES_PUBLIC_URL, IMAGES_KEY and CRON_SECRET on the Vercel
 *      project for Production and Preview, replacing older values;
 *   5. redeploys production on Vercel so the new values take effect.
 *
 * Safe to re-run: it generates fresh secrets and sets them everywhere at
 * once, so the Workers and the app always agree.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DRY = process.argv.includes('--dry-run')
const VERCEL_PROJECT = process.env.VERCEL_PROJECT ?? 'ngueza-events'
const VERCEL_SCOPE = process.env.VERCEL_SCOPE ?? 'enov'
const ROOT = process.cwd()
const ENVIRONMENTS = ['production', 'preview']

if (!existsSync(join(ROOT, 'deploy/cloudflare-images/wrangler.toml'))) {
  fail('Run this from the repository root (deploy/cloudflare-images/wrangler.toml not found).')
}

function gitOut(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function step(title) {
  console.log(`\n── ${title}`)
}

/** Runs a command. `input` is written to stdin and never echoed. */
function run(cmd, args, { cwd = ROOT, input, capture = false, allowFail = false } = {}) {
  const shown = `${cmd} ${args.join(' ')}${input !== undefined ? '   (value via stdin)' : ''}`
  if (DRY) {
    console.log(`  [dry-run] (${cwd === ROOT ? '.' : cwd.replace(ROOT, '.')}) ${shown}`)
    return { status: 0, stdout: capture ? 'https://ngueza-images.example.workers.dev' : '' }
  }
  const result = spawnSync(cmd, args, {
    cwd,
    input,
    encoding: 'utf8',
    shell: process.platform === 'win32', // npx is a .cmd on Windows
    stdio: [input !== undefined ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
  })
  if (capture) {
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
  }
  if (result.status !== 0 && !allowFail) fail(`Failed: ${shown}`)
  return result
}

const wrangler = (args, opts) => run('npx', ['--yes', 'wrangler@4', ...args], opts)
const vercel = (args, opts) => run('npx', ['--yes', 'vercel@latest', ...args, '--scope', VERCEL_SCOPE], opts)

// 0. Only ever deploy committed main -------------------------------------------
if (!DRY) {
  const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD'])
  const dirty = gitOut(['status', '--porcelain'])
  if (branch !== 'main') fail(`On branch "${branch}". Run this from a clean clone of main — step 5 deploys this checkout.`)
  if (dirty) fail('This checkout has uncommitted changes. Run from a clean clone of main — step 5 deploys this checkout.')
}

// 1. Sign in --------------------------------------------------------------
step('Cloudflare sign-in')
if (wrangler(['whoami'], { capture: true, allowFail: true }).status !== 0 && !DRY) {
  wrangler(['login'])
}

step('Vercel sign-in and project link')
if (vercel(['whoami'], { capture: true, allowFail: true }).status !== 0 && !DRY) {
  vercel(['login'])
}
vercel(['link', '--yes', '--project', VERCEL_PROJECT])

// 2. Secrets ----------------------------------------------------------------
const IMAGES_KEY = randomBytes(32).toString('hex')
const CRON_SECRET = randomBytes(32).toString('hex')

// 3. Workers ----------------------------------------------------------------
step('Deploying the image Worker (ngueza-images)')
const imagesDir = join(ROOT, 'deploy/cloudflare-images')
const deployed = wrangler(['deploy'], { cwd: imagesDir, capture: true })
const urlMatch = `${deployed.stdout}\n${deployed.stderr ?? ''}`.match(/https:\/\/ngueza-images\.[a-z0-9-]+\.workers\.dev/i)
if (!urlMatch) {
  fail('Deployed, but could not find the workers.dev URL in the output. Enable the workers.dev subdomain in the Cloudflare dashboard (Workers → ngueza-images → Settings → Domains) and re-run.')
}
const IMAGES_PUBLIC_URL = urlMatch[0]
wrangler(['secret', 'put', 'IMAGES_KEY'], { cwd: imagesDir, input: IMAGES_KEY })

step('Deploying the scheduled-jobs Worker (ngueza-cron)')
const cronDir = join(ROOT, 'deploy/cloudflare-cron')
wrangler(['deploy'], { cwd: cronDir })
wrangler(['secret', 'put', 'CRON_SECRET'], { cwd: cronDir, input: CRON_SECRET })

// 4. Vercel environment -----------------------------------------------------
step('Setting Vercel environment variables')
const values = { IMAGES_PUBLIC_URL, IMAGES_KEY, CRON_SECRET }
for (const [name, value] of Object.entries(values)) {
  for (const target of ENVIRONMENTS) {
    vercel(['env', 'rm', name, target, '--yes'], { capture: true, allowFail: true })
    vercel(['env', 'add', name, target], { input: value })
  }
  console.log(`  ✓ ${name}`)
}

// 5. Redeploy -----------------------------------------------------------------
step('Redeploying production on Vercel')
vercel(['deploy', '--prod', '--yes'])

console.log(`
✓ Done.

  Image Worker:   ${IMAGES_PUBLIC_URL}   (${IMAGES_PUBLIC_URL}/health → ok)
  Cron Worker:    ngueza-cron, every 5 min (expire) and 2 min (notify)

Check in a few minutes:  https://www.ngueza.co.ao/api/saude  → "ok": true
`)
