import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const NPM_REGISTRY = 'https://registry.npmjs.org/'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function packageAssetName(manifest) {
  const slug = manifest.name.replace(/^@/, '').replace(/\//g, '-')
  return `${slug}-${manifest.version}.tgz`
}

function readArchiveManifest(assetPath) {
  const result = spawnSync('tar', ['-xOf', assetPath, 'package/package.json'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
  if (result.error) throw result.error
  assert(result.status === 0, `cannot read package/package.json from ${assetPath}`)
  return JSON.parse(result.stdout)
}

function assertPublicManifest(manifest, label, repository) {
  assert(manifest.private !== true, `${label} is private`)
  assert(manifest.publishConfig?.access === 'public', `${label} must set publishConfig.access=public`)
  assert(manifest.publishConfig?.registry === NPM_REGISTRY, `${label} must target ${NPM_REGISTRY}`)
  assert(
    manifest.repository?.url === `git+https://github.com/${repository}.git`,
    `${label} repository must match ${repository}`,
  )
}

export function verifyReleaseAsset({
  rootDir = process.cwd(),
  distDir = join(process.cwd(), 'dist'),
  tag = process.env.GITHUB_REF_NAME,
  repository = process.env.GITHUB_REPOSITORY,
  expectedSha256 = process.env.EXPECTED_TGZ_SHA256,
  readManifest = readArchiveManifest,
} = {}) {
  const rootManifest = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
  assert(typeof tag === 'string' && tag.startsWith('v'), 'release tag must start with v')
  assert(tag.slice(1) === rootManifest.version, `tag ${tag} does not match package.json version ${rootManifest.version}`)
  assert(typeof repository === 'string' && repository.length > 0, 'GITHUB_REPOSITORY is required')
  assertPublicManifest(rootManifest, 'checkout package.json', repository)

  const assetName = packageAssetName(rootManifest)
  const entries = readdirSync(distDir, { withFileTypes: true })
  const tgzFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.tgz')).map((entry) => entry.name)
  const shaFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sha256')).map((entry) => entry.name)
  assert(tgzFiles.length === 1 && tgzFiles[0] === assetName, `dist must contain only ${assetName}`)
  assert(shaFiles.length === 1 && shaFiles[0] === `${assetName}.sha256`, `dist must contain only ${assetName}.sha256`)

  const assetPath = join(distDir, assetName)
  const contents = readFileSync(assetPath)
  const actualSha256 = createHash('sha256').update(contents).digest('hex')
  assert(typeof expectedSha256 === 'string' && /^[0-9a-f]{64}$/.test(expectedSha256), 'release job TGZ SHA-256 output is required')
  assert(actualSha256 === expectedSha256, 'downloaded TGZ does not match the release job build digest')

  const escapedName = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sidecar = readFileSync(`${assetPath}.sha256`, 'utf8')
  const match = sidecar.match(new RegExp(`^([0-9a-f]{64})  ${escapedName}\r?\n?$`))
  assert(match, `sidecar must contain exactly one SHA-256 record for ${assetName}`)
  assert(match[1] === actualSha256, 'sidecar SHA-256 does not match the downloaded TGZ')

  const archiveManifest = readManifest(assetPath)
  assert(archiveManifest.name === rootManifest.name, 'TGZ package name does not match checkout package.json')
  assert(archiveManifest.version === rootManifest.version, 'TGZ package version does not match the release tag')
  assertPublicManifest(archiveManifest, 'TGZ package/package.json', repository)
  assert(
    archiveManifest.repository?.url === rootManifest.repository?.url,
    'TGZ repository does not match checkout package.json',
  )

  return {
    name: rootManifest.name,
    version: rootManifest.version,
    assetPath,
    sha256: actualSha256,
    integrity: `sha512-${createHash('sha512').update(contents).digest('base64')}`,
  }
}

export function queryNpmIntegrity(name, version, run = spawnSync) {
  const result = run('npm', [
    'view', `${name}@${version}`, 'dist.integrity', '--json', `--registry=${NPM_REGISTRY}`,
  ], { encoding: 'utf8', env: process.env, maxBuffer: 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status === 0) {
    let integrity
    try {
      integrity = JSON.parse(result.stdout)
    } catch {
      throw new Error('npm view returned invalid JSON')
    }
    assert(typeof integrity === 'string' && integrity.startsWith('sha512-'), `npm ${name}@${version} has no usable dist.integrity`)
    return { found: true, integrity }
  }
  if (/\bE404\b/.test(result.stderr || '')) return { found: false }
  throw new Error(`npm view failed with exit code ${result.status}; the package was not treated as absent`)
}

function publishPackage(assetPath) {
  // npm 11.5.1+ exchanges GitHub's OIDC identity for short-lived registry
  // credentials. No NODE_AUTH_TOKEN or other long-lived npm token is used.
  const result = spawnSync('npm', [
    'publish', assetPath, '--access', 'public', '--provenance', `--registry=${NPM_REGISTRY}`,
  ], { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  assert(result.status === 0, `npm publish failed with exit code ${result.status}`)
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))

export async function publishVerifiedPackage(verified, {
  view = queryNpmIntegrity,
  publish = publishPackage,
  sleep = wait,
  logger = console,
  prePublishAttempts = 3,
  verifyAttempts = 12,
  retryDelayMs = 5000,
} = {}) {
  const { name, version, assetPath, integrity } = verified

  async function lookup(attempts, retryMissing) {
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await view(name, version)
        if (result?.found) return result
        lastError = new Error(`npm ${name}@${version} is not visible`)
        if (!retryMissing) return null
      } catch (error) {
        lastError = error
      }
      if (attempt < attempts) await sleep(retryDelayMs)
    }
    throw lastError || new Error(`cannot verify npm ${name}@${version}`)
  }

  const existing = await lookup(prePublishAttempts, false)
  if (existing) {
    assert(existing.integrity === integrity, `npm ${name}@${version} already exists with different content; refusing to overwrite`)
    logger.log(`npm ${name}@${version} already exists with matching dist.integrity; skipping duplicate publish`)
    return { published: false, alreadyExists: true }
  }

  let publishError = null
  try {
    await publish(assetPath)
  } catch (error) {
    publishError = error
    logger.warn(`npm publish returned an error; checking whether the registry accepted ${name}@${version} before failing`)
  }

  try {
    const published = await lookup(verifyAttempts, true)
    assert(published.integrity === integrity, `published npm ${name}@${version} has different dist.integrity`)
  } catch (verificationError) {
    if (publishError) {
      throw new Error(`${publishError.message}; subsequent registry verification failed: ${verificationError.message}`)
    }
    throw verificationError
  }

  return { published: !publishError, recoveredAfterPublishError: Boolean(publishError) }
}

async function main() {
  assert(process.env.GITHUB_ACTIONS === 'true', 'Trusted Publishing must run in GitHub Actions')
  assert(
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    'GitHub OIDC credentials are unavailable; publish-npm requires id-token: write',
  )
  const verified = verifyReleaseAsset()
  const result = await publishVerifiedPackage(verified)
  console.log(`Verified npm ${verified.name}@${verified.version}: ${JSON.stringify(result)}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  })
}
