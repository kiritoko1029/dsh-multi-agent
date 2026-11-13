import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { dirname } from 'node:path'
import { executableCandidates } from '../availability.js'
import { bundledCodexExecutable } from '../lib/codex-command.js'
import { codexAppServerEnv } from '../lib/codex-run.js'
import { sameDirectory } from '../lib/path-compat.js'
import { assertDirectCommand, commandEnvironment } from '../lib/process-command.js'
import { probeAcpSession } from '../acp-provider.js'

test('Windows PATH parsing honors quoted directories and deterministic env keys', () => {
  assert.deepEqual(executableCandidates('kimi', { Path: 'C:\\Old', PATH: '"C:\\Tools; Special";D:\\More Tools' }, 'win32'), [
    'C:\\Tools; Special\\kimi.exe', 'C:\\Tools; Special\\kimi.com',
    'D:\\More Tools\\kimi.exe', 'D:\\More Tools\\kimi.com',
  ])
})

test('Windows native command validation rejects script shims before CreateProcess', () => {
  for (const command of ['codex.cmd', 'kimi.CMD', 'agy.bat', 'cli.js', 'cli.mjs', 'cli.cjs', 'cli.ps1']) {
    assert.throws(() => assertDirectCommand(command, 'win32'), /native \.exe\/\.com/)
  }
  assert.equal(assertDirectCommand('C:\\Program Files\\Codex\\codex.exe', 'win32'), 'C:\\Program Files\\Codex\\codex.exe')
  assert.equal(assertDirectCommand('codex.cmd', 'linux'), 'codex.cmd')
})

test('Windows env overlays remove case-insensitive duplicate keys', () => {
  const environment = commandEnvironment({ Path: 'D:\\Custom', OTHER: 'new' }, { PATH: 'C:\\Base', other: 'old', KEEP: 'yes' }, 'win32')
  assert.deepEqual(environment, { KEEP: 'yes', Path: 'D:\\Custom', OTHER: 'new' })
})

test('directory identity accepts aliases but rejects a different directory', () => {
  const cwd = process.cwd()
  assert.equal(sameDirectory(cwd, `${cwd}${cwd.endsWith('/') || cwd.endsWith('\\') ? '' : '/'}.`), true)
  assert.equal(sameDirectory(cwd, dirname(cwd)), false)
  if (process.platform === 'win32' && /^[a-z]:/i.test(cwd)) {
    const alternate = `${cwd[0] === cwd[0].toLowerCase() ? cwd[0].toUpperCase() : cwd[0].toLowerCase()}${cwd.slice(1)}`
    if (existsSync(alternate)) assert.equal(sameDirectory(cwd, alternate), true)
  }
})

test('Codex Electron mode is explicit only for the JS wrapper fallback', () => {
  assert.deepEqual(codexAppServerEnv(undefined, { KEEP: 'yes', ELECTRON_RUN_AS_NODE: '0' }, true), {
    KEEP: 'yes', ELECTRON_RUN_AS_NODE: '1',
  })
  const native = { KEEP: 'yes' }
  assert.equal(codexAppServerEnv('C:\\Codex\\codex.exe', native, true), native)
  assert.equal(codexAppServerEnv(undefined, native, false), native)
  const bundled = bundledCodexExecutable()
  if (bundled) assert.equal(existsSync(bundled), true)
})

test('ACP catalog observes done rejection without waiting for timeout or leaking it', async () => {
  const failure = new Error('spawn failed before ACP initialize')
  let waits = 0
  const child = {
    stdin: new Writable({ write(_chunk, _encoding, callback) { callback() } }),
    stdout: new Readable({ read() {} }),
    done: Promise.reject(failure),
    terminate() { throw new Error('a completed child must not be terminated again') },
    async waitForExit() { waits += 1; return true },
  }
  const ctx = { subprocess: { spawn: () => child } }
  await assert.rejects(probeAcpSession(ctx, {
    command: process.execPath, args: [], cwd: process.cwd(), env: {},
  }, undefined, 60000), (error) => error === failure)
  assert.equal(waits, 1)
})
