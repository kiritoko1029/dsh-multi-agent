import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  NPM_REGISTRY,
  packageAssetName,
  publishVerifiedPackage,
  queryNpmIntegrity,
  verifyReleaseAsset,
} from '../scripts/publish-npm.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const repository = 'kiritoko1029/dsh-multi-agent'
const name = '@kiritoko1029/dsh-multi-agent'
const version = '0.9.3'
const integrity = 'sha512-dGVzdC1pbnRlZ3JpdHk='

function publicManifest() {
  return {
    name,
    version,
    publishConfig: { access: 'public', registry: NPM_REGISTRY },
    repository: { type: 'git', url: `git+https://github.com/${repository}.git` },
  }
}

function makeFixture(t) {
  const rootDir = mkdtempSync(join(tmpdir(), 'dsh-publish-npm-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  const distDir = join(rootDir, 'dist')
  const manifest = publicManifest()
  const assetName = packageAssetName(manifest)
  const contents = Buffer.from(`release asset for ${name}@${version}`)
  const sha256 = createHash('sha256').update(contents).digest('hex')
  mkdirSync(distDir)
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(distDir, assetName), contents)
  writeFileSync(join(distDir, `${assetName}.sha256`), `${sha256}  ${assetName}\n`)
  return { rootDir, distDir, manifest, assetName, contents, sha256 }
}

function verify(files, overrides = {}) {
  return verifyReleaseAsset({
    rootDir: files.rootDir,
    distDir: files.distDir,
    tag: `v${version}`,
    repository,
    expectedSha256: files.sha256,
    readManifest: () => structuredClone(files.manifest),
    ...overrides,
  })
}

const verified = { name, version, assetPath: '/tmp/package.tgz', integrity }

test('packageAssetName matches npm pack scoped and unscoped filenames', () => {
  assert.equal(packageAssetName({ name, version }), `kiritoko1029-dsh-multi-agent-${version}.tgz`)
  assert.equal(packageAssetName({ name: 'dsh-multi-agent', version }), `dsh-multi-agent-${version}.tgz`)
})

test('verifyReleaseAsset binds tag, manifests, Release digest, sidecar and SHA-512 integrity', (t) => {
  const files = makeFixture(t)
  const result = verify(files)
  assert.equal(result.name, name)
  assert.equal(result.version, version)
  assert.equal(result.sha256, files.sha256)
  assert.equal(result.integrity, `sha512-${createHash('sha512').update(files.contents).digest('base64')}`)
})

test('verifyReleaseAsset rejects a tag mismatch and missing Release digest', (t) => {
  const files = makeFixture(t)
  assert.throws(() => verify(files, { tag: 'v0.9.4' }), /does not match package.json version/)
  assert.throws(() => verify(files, { expectedSha256: undefined }), /release job TGZ SHA-256 output is required/)
  assert.throws(() => verify(files, { expectedSha256: '0'.repeat(64) }), /does not match the release job build digest/)
})

test('verifyReleaseAsset rejects unexpected assets and malformed or incorrect sidecars', (t) => {
  const files = makeFixture(t)
  writeFileSync(join(files.distDir, 'unexpected.tgz'), 'unexpected')
  assert.throws(() => verify(files), new RegExp(`dist must contain only ${files.assetName}`))
  rmSync(join(files.distDir, 'unexpected.tgz'))
  writeFileSync(join(files.distDir, `${files.assetName}.sha256`), `${files.sha256}  other.tgz\n`)
  assert.throws(() => verify(files), /sidecar must contain exactly one SHA-256 record/)
  writeFileSync(join(files.distDir, `${files.assetName}.sha256`), `${'0'.repeat(64)}  ${files.assetName}\n`)
  assert.throws(() => verify(files), /sidecar SHA-256 does not match/)
})

test('verifyReleaseAsset rejects TGZ manifest identity, registry and repository drift', async (t) => {
  const files = makeFixture(t)
  const cases = [
    [{ ...files.manifest, name: '@attacker/other' }, /TGZ package name does not match/],
    [{ ...files.manifest, version: '0.9.4' }, /TGZ package version does not match/],
    [{ ...files.manifest, publishConfig: { access: 'public', registry: 'https://example.com/' } }, /must target/],
    [{ ...files.manifest, repository: { url: 'git+https://github.com/attacker/other.git' } }, /repository must match/],
  ]
  for (const [manifest, expected] of cases) {
    await t.test(expected.source, () => {
      assert.throws(() => verify(files, { readManifest: () => manifest }), expected)
    })
  }
})

test('queryNpmIntegrity returns registry integrity and distinguishes E404', () => {
  const found = queryNpmIntegrity(name, version, (command, args) => {
    assert.equal(command, 'npm')
    assert.ok(args.includes(`${name}@${version}`))
    assert.ok(args.includes(`--registry=${NPM_REGISTRY}`))
    return { status: 0, stdout: JSON.stringify(integrity), stderr: '' }
  })
  assert.deepEqual(found, { found: true, integrity })
  const missing = queryNpmIntegrity(name, version, () => ({ status: 1, stdout: '', stderr: 'npm error code E404\n' }))
  assert.deepEqual(missing, { found: false })
})

test('queryNpmIntegrity fails closed on auth errors, invalid JSON and missing integrity', () => {
  assert.throws(() => queryNpmIntegrity(name, version, () => ({ status: 1, stdout: '', stderr: 'npm error code E401\n' })), /was not treated as absent/)
  assert.throws(() => queryNpmIntegrity(name, version, () => ({ status: 0, stdout: '{', stderr: '' })), /invalid JSON/)
  assert.throws(() => queryNpmIntegrity(name, version, () => ({ status: 0, stdout: 'null', stderr: '' })), /no usable dist.integrity/)
})

test('publishVerifiedPackage skips an existing version only when integrity matches', async () => {
  let publishes = 0
  const result = await publishVerifiedPackage(verified, {
    view: async () => ({ found: true, integrity }),
    publish: async () => { publishes += 1 },
    logger: { log() {}, warn() {} },
  })
  assert.deepEqual(result, { published: false, alreadyExists: true })
  assert.equal(publishes, 0)
  await assert.rejects(publishVerifiedPackage(verified, {
    view: async () => ({ found: true, integrity: 'sha512-different' }),
    publish: async () => { publishes += 1 },
  }), /already exists with different content/)
  assert.equal(publishes, 0)
})

test('publishVerifiedPackage publishes a new version and verifies its integrity', async () => {
  let views = 0
  let publishes = 0
  const result = await publishVerifiedPackage(verified, {
    view: async () => {
      views += 1
      return views === 1 ? { found: false } : { found: true, integrity }
    },
    publish: async (assetPath) => {
      publishes += 1
      assert.equal(assetPath, verified.assetPath)
    },
  })
  assert.deepEqual(result, { published: true, recoveredAfterPublishError: false })
  assert.equal(views, 2)
  assert.equal(publishes, 1)
})

test('publishVerifiedPackage recovers when publish errors after registry acceptance', async () => {
  let views = 0
  const result = await publishVerifiedPackage(verified, {
    view: async () => {
      views += 1
      return views === 1 ? { found: false } : { found: true, integrity }
    },
    publish: async () => { throw new Error('connection reset after upload') },
    logger: { log() {}, warn() {} },
  })
  assert.deepEqual(result, { published: false, recoveredAfterPublishError: true })
})

test('publishVerifiedPackage retries transient registry visibility before succeeding', async () => {
  let views = 0
  let sleeps = 0
  const result = await publishVerifiedPackage(verified, {
    view: async () => {
      views += 1
      if (views === 1) return { found: false }
      if (views === 2) throw new Error('temporary registry failure')
      if (views === 3) return { found: false }
      return { found: true, integrity }
    },
    publish: async () => {},
    sleep: async () => { sleeps += 1 },
    verifyAttempts: 4,
  })
  assert.equal(result.published, true)
  assert.equal(views, 4)
  assert.equal(sleeps, 2)
})

test('publishVerifiedPackage bounds an unconfirmed publish failure', async () => {
  let views = 0
  let sleeps = 0
  await assert.rejects(publishVerifiedPackage(verified, {
    view: async () => { views += 1; return { found: false } },
    publish: async () => { throw new Error('publish response lost') },
    sleep: async () => { sleeps += 1 },
    prePublishAttempts: 1,
    verifyAttempts: 3,
    logger: { log() {}, warn() {} },
  }), /publish response lost.*subsequent registry verification failed/)
  assert.equal(views, 4)
  assert.equal(sleeps, 2)
})

test('publishVerifiedPackage rejects content drift after publish', async () => {
  let views = 0
  await assert.rejects(publishVerifiedPackage(verified, {
    view: async () => {
      views += 1
      return views === 1 ? { found: false } : { found: true, integrity: 'sha512-different' }
    },
    publish: async () => {},
  }), /published npm .* has different dist.integrity/)
})

test('workflow uses OIDC Trusted Publishing, exact verification and no npm token', () => {
  const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, name)
  assert.equal(manifest.private, undefined)
  assert.deepEqual(manifest.publishConfig, { access: 'public', registry: NPM_REGISTRY })
  assert.match(workflow, /needs: release/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /npm@11\.20\.0/)
  assert.match(workflow, /EXPECTED_TGZ_SHA256: \$\{\{ needs\.release\.outputs\.tgz_sha256 \}\}/)
  assert.match(workflow, /run: node scripts\/publish-npm\.mjs/)
  assert.match(workflow, /run: npm test/)
  assert.ok(!workflow.includes('NPM_TOKEN'))
  assert.ok(!workflow.includes('NODE_AUTH_TOKEN'))
  assert.ok(!workflow.includes('npm publish dist/*.tgz'))

  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  for (const subpath of ['', '/availability', '/task-monitor', '/delegation-policy', '/acp-provider', '/agy-provider', '/codex-provider']) {
    assert.ok(patch.includes(`name: '${name}${subpath}'`), `Cordis entry must use ${name}${subpath}`)
  }
  assert.doesNotMatch(patch, /name: 'dsh-multi-agent(?:'|\/)/)
  const client = readFileSync(join(root, 'client.js'), 'utf8')
  assert.ok(client.includes(`id: '${name}',`), 'Client module id must equal the scoped package name')
  assert.ok(client.includes(`const NS = '${name}'`), 'Client locale namespace must follow the package name')
  const buildClient = readFileSync(join(root, 'scripts/build-client.mjs'), 'utf8')
  assert.ok(buildClient.includes('id: ${JSON.stringify(packageName)}'), 'generated Client id must come from package.json')
})
