import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, win32 } from 'node:path'
import MultiAgentAvailability, { defaultCodexCommands, detectExecutable, executableCandidates, resolveExecutable } from '../availability.js'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'multi-agent-availability-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function executable(path) {
  writeFileSync(path, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  chmodSync(path, 0o755)
  return path
}

function withEnvironment(values, run) {
  const keys = ['CODEX_COMMAND', 'KIMI_COMMAND', 'AGY_COMMAND', 'PATH', 'HOME']
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  try {
    for (const key of keys) {
      if (values[key] === undefined) delete process.env[key]
      else process.env[key] = values[key]
    }
    return run()
  } finally {
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function serviceContext() {
  const provided = []
  return {
    provided,
    reflect: {
      provide(name, service) { provided.push({ name, service }) },
    },
  }
}

test('detectExecutable checks absolute files and searches PATH with X_OK', (t) => {
  const directory = fixture(t)
  const empty = join(directory, 'empty')
  mkdirSync(empty)
  const codex = executable(join(directory, 'codex'))
  const plain = join(directory, 'plain')
  writeFileSync(plain, 'not executable', { mode: 0o644 })
  chmodSync(plain, 0o644)

  assert.equal(detectExecutable(codex, { PATH: empty }), true)
  assert.equal(detectExecutable(plain), false)
  assert.equal(detectExecutable(directory), false)
  assert.equal(detectExecutable(join(directory, 'missing')), false)
  assert.equal(detectExecutable(''), false)
  assert.equal(detectExecutable('codex', { PATH: `${empty}${delimiter}${directory}` }), true)
  assert.equal(detectExecutable('codex', { PATH: empty }), false)
  assert.equal(detectExecutable('codex', { PATH: '' }), false)
})

test('service detects default Codex from PATH and falls back to PATH Kimi', (t) => {
  const directory = fixture(t)
  executable(join(directory, 'codex'))
  executable(join(directory, 'kimi'))
  executable(join(directory, 'agy'))
  withEnvironment({
    CODEX_COMMAND: undefined,
    KIMI_COMMAND: join(directory, 'missing-kimi'),
    AGY_COMMAND: join(directory, 'missing-agy'),
    PATH: directory,
  }, () => {
    const ctx = serviceContext()
    const service = new MultiAgentAvailability(ctx)
    assert.equal(service.name, 'multiAgentAvailability')
    assert.equal(service.codex, true)
    assert.equal(service.codexCommand, join(directory, 'codex'))
    assert.equal(service.kimi, true)
    assert.equal(service.kimiCode, true)
    assert.equal(service.kimiCommand, join(directory, 'kimi'))
    assert.equal(service.agy, true)
    assert.equal(service.agyCommand, join(directory, 'agy'))
    assert.deepEqual(ctx.provided, [{ name: 'multiAgentAvailability', service }])
  })
})

test('service falls back to default Codex and Kimi paths under home', (t) => {
  const home = fixture(t)
  mkdirSync(join(home, '.vite-plus', 'bin'), { recursive: true })
  mkdirSync(join(home, '.kimi-code', 'bin'), { recursive: true })
  mkdirSync(join(home, '.local', 'bin'), { recursive: true })
  executable(join(home, '.vite-plus', 'bin', 'codex'))
  executable(join(home, '.kimi-code', 'bin', 'kimi'))
  executable(join(home, '.local', 'bin', 'agy'))
  withEnvironment({
    CODEX_COMMAND: undefined,
    KIMI_COMMAND: undefined,
    AGY_COMMAND: undefined,
    PATH: join(home, 'path-without-user-bin'),
    HOME: home,
  }, () => {
    const service = new MultiAgentAvailability(serviceContext())
    assert.equal(service.codex, true)
    assert.equal(service.kimi, true)
    assert.equal(service.kimiCode, true)
    assert.equal(service.agy, true)
    assert.equal(service.agyCommand, join(home, '.local', 'bin', 'agy'))
  })
})

test('service reports unavailable commands without spawning', (t) => {
  const directory = fixture(t)
  withEnvironment({
    CODEX_COMMAND: join(directory, 'missing-codex'),
    KIMI_COMMAND: join(directory, 'missing-kimi'),
    AGY_COMMAND: join(directory, 'missing-agy'),
    PATH: directory,
  }, () => {
    const service = new MultiAgentAvailability(serviceContext())
    assert.equal(service.codex, false)
    assert.equal(service.kimi, false)
    assert.equal(service.kimiCode, false)
    assert.equal(service.agy, false)
    assert.equal(service.agyCommand, undefined)
  })
})

test('Windows resolves native executable extensions without requiring extension-less files', (t) => {
  const directory = fixture(t)
  const nativeCodex = executable(join(directory, 'codex.exe'))
  assert.equal(resolveExecutable(join(directory, 'codex'), { PATH: '' }, 'win32'), nativeCodex)
  assert.equal(detectExecutable(join(directory, 'codex'), { PATH: '' }, 'win32'), true)
  assert.equal(resolveExecutable(join(directory, 'codex.cmd'), { PATH: '' }, 'win32'), undefined, 'DSH native runner must not receive a command shim')
})

test('Windows PATH uses semicolons and native exe/com candidates', () => {
  assert.deepEqual(executableCandidates('kimi', { Path: 'C:\\Tools;D:\\More Tools' }, 'win32'), [
    'C:\\Tools\\kimi.exe', 'C:\\Tools\\kimi.com',
    'D:\\More Tools\\kimi.exe', 'D:\\More Tools\\kimi.com',
  ])
  assert.deepEqual(executableCandidates('agy', { PATH: '' }, 'win32'), [])
})

test('Windows defaults cover official Codex, Kimi and agy install locations', () => {
  const environment = { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' }
  const home = 'C:\\Users\\tester'
  assert.ok(defaultCodexCommands('win32', environment, home).includes('C:\\Users\\tester\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex'))
  assert.deepEqual(executableCandidates(win32.join(home, '.kimi-code', 'bin', 'kimi'), environment, 'win32'), [
    'C:\\Users\\tester\\.kimi-code\\bin\\kimi.exe',
    'C:\\Users\\tester\\.kimi-code\\bin\\kimi.com',
  ])
  const service = new MultiAgentAvailability(serviceContext(), { platform: 'win32', environment, home })
  assert.equal(service.codex, false)
  assert.equal(service.kimiCode, false)
  assert.equal(service.agy, false)
})
