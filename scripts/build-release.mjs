import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Build the release artifact for the current package version:
//   dist/<name>-<version>.tgz            npm-format plugin package
//   dist/<name>-<version>.tgz.sha256     `sha256sum`-compatible checksum
// Runs identically on macOS, Linux and Windows so CI and local releases agree.
const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const slug = manifest.name.replace(/^@/, '').replace(/\//g, '-')
const expected = `${slug}-${manifest.version}.tgz`
// Node refuses to spawn a .cmd file without a shell (EINVAL since the
// CVE-2024-27980 fix), so Windows runs one quoted command through cmd.exe.
const windows = process.platform === 'win32'

mkdirSync(dist, { recursive: true })
// Keep dist/ deterministic: stale artifacts from earlier versions must not ship.
for (const name of readdirSync(dist)) {
  if (name.endsWith('.tgz') || name.endsWith('.sha256')) rmSync(join(dist, name), { force: true })
}

if (windows) execSync(`npm.cmd pack --pack-destination "${dist}"`, { cwd: root, stdio: 'inherit' })
else execFileSync('npm', ['pack', '--pack-destination', dist], { cwd: root, stdio: 'inherit' })

const artifact = join(dist, expected)
if (!existsSync(artifact)) {
  throw new Error(`Expected ${expected} in dist/, found: ${readdirSync(dist).join(', ') || '(nothing)'}`)
}

const digest = createHash('sha256').update(readFileSync(artifact)).digest('hex')
writeFileSync(`${artifact}.sha256`, `${digest}  ${expected}\n`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha256=${digest}\n`)

console.log(`\nArtifact: dist/${expected}`)
console.log(`SHA-256:  ${digest}`)
