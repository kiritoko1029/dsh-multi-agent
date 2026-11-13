import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function stageBuildRoot(t) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-client-bundle-'))
  t.after(() => {
    const linkedModules = join(tempRoot, 'node_modules')
    try {
      if (lstatSync(linkedModules).isSymbolicLink()) rmSync(linkedModules, { recursive: false, force: true })
    } catch {}
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })
  mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
  cpSync(join(root, 'client.js'), join(tempRoot, 'client.js'))
  cpSync(join(root, 'tasks-client.js'), join(tempRoot, 'tasks-client.js'))
  cpSync(join(root, 'scripts', 'build-client.mjs'), join(tempRoot, 'scripts', 'build-client.mjs'))
  try {
    symlinkSync(join(root, 'node_modules'), join(tempRoot, 'node_modules'), 'junction')
  } catch {
    mkdirSync(join(tempRoot, 'node_modules'), { recursive: true })
    cpSync(join(root, 'node_modules', 'markdown-it'), join(tempRoot, 'node_modules', 'markdown-it'), {
      recursive: true,
      dereference: true,
    })
  }
  return tempRoot
}

function assertBundleRuntime(source) {
  const entries = []
  const sandbox = { window: { __ModuleLoader__: { load: entry => entries.push(entry) } } }
  vm.runInNewContext(source, sandbox, { timeout: 3000 })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'dsh-multi-agent')
  assert.equal(sandbox.markdownit, undefined)
  const imports = []
  const plugin = entries[0].factory(id => {
    imports.push(id)
    assert.equal(id, 'react', 'third-party parser must not need a Host runtime module')
    return { createElement() {}, memo: component => component }
  })
  assert.deepEqual(imports, ['react', 'react'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(sandbox.markdownit, undefined, 'parser must not leak a global')
  assert.ok(source.includes('markdown-it 14.1.0'))
  assert.ok(source.includes('THIRD_PARTY_NOTICES.md'))
}

test('built Client embeds Markdown parser privately and needs only React at runtime', (t) => {
  const tempRoot = stageBuildRoot(t)
  execFileSync(process.execPath, [join(tempRoot, 'scripts', 'build-client.mjs')], { cwd: tempRoot })
  const builtSource = readFileSync(join(tempRoot, 'client-bundle.js'), 'utf8')
  assertBundleRuntime(builtSource)
  // Also ensure the checked-in bundle remains runnable without mutating the workspace.
  const checkedInSource = readFileSync(new URL('../client-bundle.js', import.meta.url), 'utf8')
  assertBundleRuntime(checkedInSource)
})
