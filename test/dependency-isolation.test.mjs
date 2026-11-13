import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootManifestPath = fileURLToPath(new URL('../package.json', import.meta.url))

function packageManifest(anchor, name) {
  const require = createRequire(anchor)
  for (const searchPath of require.resolve.paths(name) ?? []) {
    const manifestPath = join(searchPath, name, 'package.json')
    if (existsSync(manifestPath)) {
      const realPath = realpathSync(manifestPath)
      return { path: realPath, value: JSON.parse(readFileSync(realPath, 'utf8')) }
    }
  }
  return undefined
}

function isHostRuntimePackage(name) {
  return name === '@deepseek-ai/cordis' || name.startsWith('@deepseek-ai/dsh-')
}

test('ordinary dependency closure contains no DSH Host runtime package', () => {
  const root = JSON.parse(readFileSync(rootManifestPath, 'utf8'))
  assert.equal(root.dependencies['@deepseek-ai/cordis'], undefined)
  assert.equal(root.peerDependencies['@deepseek-ai/cordis'], '~4.1.0')
  assert.equal(root.dsh.client.inject.includes('dsh-better-sidebar'), false)
  assert.ok(root.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'))
  assert.ok(root.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-documentpreview'))
  for (const name of ['@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-subagent-acp', '@deepseek-ai/dsh-subagent-codex', '@deepseek-ai/dsh-sdk-protocol']) {
    assert.equal(root.dependencies?.[name], undefined, `${name} must not be installed into the profile`)
  }

  const visited = new Set()
  const queue = ['dependencies', 'optionalDependencies'].flatMap((field) =>
    Object.keys(root[field] ?? {}).map((name) => ({ anchor: rootManifestPath, name, optional: field === 'optionalDependencies' })))
  while (queue.length > 0) {
    const { anchor, name, optional } = queue.shift()
    const manifest = packageManifest(anchor, name)
    if (manifest === undefined) {
      assert.equal(optional, true, `Required dependency ${name} is missing`)
      continue
    }
    const identity = `${name}\0${manifest.path}`
    if (visited.has(identity)) continue
    visited.add(identity)
    assert.equal(isHostRuntimePackage(name), false, `${name} would be physically installed and may shadow the Host`)
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const dependency of Object.keys(manifest.value[field] ?? {})) {
        queue.push({ anchor: manifest.path, name: dependency, optional: field === 'optionalDependencies' })
      }
    }
  }
  assert.ok([...visited].some((key) => key.startsWith('@agentclientprotocol/sdk\0')))
  assert.ok([...visited].some((key) => key.startsWith('@openai/codex\0')))
})
