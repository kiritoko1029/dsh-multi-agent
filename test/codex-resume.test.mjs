import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { getEventListeners } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { apply } from '../codex-provider.js'
import { setSystemProxyReader } from '../lib/proxy.js'
import { runWithTaskTrace } from '../task-monitor.js'

// Keep proxy injection deterministic: no host registry lookup during tests.
setSystemProxyReader(() => undefined)

const require = createRequire(import.meta.url)
const codexPackagePath = require.resolve('@openai/codex/package.json')
const codexPackage = JSON.parse(readFileSync(codexPackagePath, 'utf8'))
const WRAPPER_ARGV = [process.execPath, resolve(dirname(codexPackagePath), codexPackage.bin.codex), 'app-server', '--stdio']
const DEFAULT_ARGV = ['/native/codex', 'app-server', '--stdio']

const CODEX_APP_SERVER_SOURCE = `
let input = ''
let thread
let nextServerRequest = 100
const pending = new Map()
const requests = []
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
const approval = (params) => {
  const id = 'server-' + nextServerRequest++
  send({ id, method: 'item/commandExecution/requestApproval', params })
  return new Promise((resolve) => pending.set(id, resolve))
}
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  input += chunk
  while (true) {
    const end = input.indexOf('\\n')
    if (end < 0) break
    const line = input.slice(0, end)
    input = input.slice(end + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.method === undefined) {
      pending.get(message.id)?.(message.result)
      pending.delete(message.id)
      continue
    }
    const { id, method, params } = message
    if (id === undefined) continue
    requests.push({ method, params })
    if (method === 'initialize') {
      send({ id, result: {} })
    } else if (method === 'thread/start') {
      if (process.env.CODEX_TEST_EPHEMERAL === 'true') {
        send({ id, result: { thread: { id: 'ephemeral-thread', ephemeral: true, cwd: params.cwd } } })
        continue
      }
      thread = { id: 'saved-thread', ephemeral: false, cwd: params.cwd, model: 'reported-start-model', reasoningEffort: 'medium' }
      send({ id, result: { thread } })
    } else if (method === 'thread/resume') {
      if (process.env.CODEX_TEST_RESUME === 'missing') {
        send({ id, error: { code: -32602, message: 'thread not found' } })
        continue
      }
      if (process.env.CODEX_TEST_RESUME === 'wrong-id') {
        send({ id, result: { thread: { id: 'other-thread', ephemeral: false, cwd: params.cwd } } })
        continue
      }
      if (process.env.CODEX_TEST_RESUME === 'wrong-cwd') {
        send({ id, result: { thread: { id: params.threadId, ephemeral: false, cwd: '/different' } } })
        continue
      }
      if (process.env.CODEX_TEST_RESUME === 'ephemeral') {
        send({ id, result: { thread: { id: params.threadId, ephemeral: true, cwd: params.cwd } } })
        continue
      }
      thread = { id: params.threadId, ephemeral: false, cwd: params.cwd }
      send({ id, result: { thread: { ...thread, model: 'remote-model' } } })
      if (process.env.CODEX_TEST_HISTORY === 'true' && process.env.CODEX_TEST_HISTORY_SENT !== 'true') {
        process.env.CODEX_TEST_HISTORY_SENT = 'true'
        send({ method: 'item/completed', params: {
          threadId: thread.id, turnId: 'old-turn',
          item: { type: 'agentMessage', phase: 'final_answer', text: 'OLD HISTORY MUST NOT RETURN' },
        } })
      }
    } else if (method === 'turn/start') {
      if (process.env.CODEX_TEST_PAUSE_TURN === 'true') continue
      const turn = { id: 'turn-' + requests.filter(request => request.method === 'turn/start').length, status: 'completed' }
      send({ id, result: { turn } })
      if (process.env.CODEX_TEST_APPROVAL === 'true') {
        const decision = await approval({ threadId: thread.id, turnId: turn.id, availableDecisions: ['decline'] })
        requests.push({ method: 'approval/result', params: decision })
      }
      send({ method: 'turn/started', params: { threadId: thread.id, turn } })
      send({ method: 'thread/tokenUsage/updated', params: { threadId: thread.id, turnId: turn.id, tokenUsage: {
        last: { inputTokens: 7, cachedInputTokens: 3, cacheWriteInputTokens: 1, outputTokens: 2, reasoningOutputTokens: 1, totalTokens: 13 },
        total: { inputTokens: 100, cachedInputTokens: 30, outputTokens: 20, reasoningOutputTokens: 4, totalTokens: 150 },
      } } })
      send({ method: 'item/completed', params: {
        threadId: thread.id, turnId: turn.id,
        item: { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(requests) },
      } })
      send({ method: 'turn/completed', params: { threadId: thread.id, turn } })
    } else if (method === 'turn/interrupt') {
      send({ id, result: {} })
    } else {
      throw new Error('unexpected Codex method: ' + method)
    }
  }
})
process.stdin.on('end', () => process.exit(0))
`

function spawnCodexChild(spec, state) {
  // Exercise the real protocol with a local fixture while asserting the requested argv separately.
  const child = spawn(process.execPath, ['--eval', CODEX_APP_SERVER_SOURCE], {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (exitCode, signal) => { state.exited += 1; resolve({ exitCode, signal }) })
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    done,
    waitForExit: () => done,
    terminate() { state.terminated += 1; child.kill('SIGTERM') },
  }
}

function harness(overrides = {}) {
  let provider
  const state = { spawns: [], children: [], exited: 0, terminated: 0 }
  const values = {
    model: 'configured-model',
    reasoningEffort: 'high',
    env: {},
    permissionMode: 'approve-for-me',
    disposeGraceMs: 1000,
    ...overrides,
  }
  const saved = []
  const errors = []
  const tasks = {
    observeCodex(frame) {
      (state.telemetryFrames ??= []).push(frame)
      const thread = frame.result?.thread
      if (thread) tasks.setTelemetry({
        ...typeof thread.model === 'string' ? { model: thread.model, modelSource: 'reported' } : {},
        ...typeof thread.reasoningEffort === 'string' ? { reasoningEffort: thread.reasoningEffort, reasoningEffortSource: 'reported' } : {},
      })
      if (frame.method === 'thread/tokenUsage/updated') tasks.setTelemetry({
        usage: {
          inputTokens: frame.params.tokenUsage.total.inputTokens,
          outputTokens: frame.params.tokenUsage.total.outputTokens,
          totalTokens: frame.params.tokenUsage.total.totalTokens,
          cacheReadTokens: frame.params.tokenUsage.total.cachedInputTokens,
          cacheWriteTokens: frame.params.tokenUsage.total.cacheWriteInputTokens,
          reasoningTokens: frame.params.tokenUsage.total.reasoningOutputTokens,
        },
        usageScope: 'session',
      })
    },
    setExternalSession(agent, sessionId) { saved.push({ agent, sessionId }) },
    setTelemetry(update) { (state.telemetry ??= []).push(update) },
  }
  const ctx = {
    get: (name) => name === 'multiAgentTasks' ? tasks : values.availability ?? { codex: true, codexCommand: '/native/codex' },
    subprocess: { spawn(spec) {
      state.spawns.push(spec)
      const child = spawnCodexChild(spec, state)
      state.children.push(child)
      values.onSpawn?.()
      return child
    } },
    subagents: { registerProvider(value) { provider = value } },
    webServer: { register: () => () => {} },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    effect: (callback) => callback(),
    logger: { warn(...args) { errors.push(args) } },
  }
  apply(ctx, {
    providerName: 'codex-router',
    command: values.command,
    model: { get: () => values.model },
    reasoningEffort: { get: () => values.reasoningEffort },
    env: { get: () => values.env },
    permissionMode: { get: () => values.permissionMode },
    ...(values.permissionPolicy === undefined ? {} : { permissionPolicy: { get: () => values.permissionPolicy } }),
    disposeGraceMs: { get: () => values.disposeGraceMs },
  }, undefined, { bundledCodexCommand: values.bundledCodexCommand })
  return { provider, values, saved, errors, state }
}

async function start(harness, { resume, cwd = process.cwd(), savedCwd = process.cwd(), trace = true, signal = AbortSignal.timeout(5000) } = {}) {
  const context = trace === false ? undefined : resume === undefined ? {
    record: { cwd: savedCwd, agent: 'codex' },
  } : {
    record: { cwd: savedCwd },
    resume: { agent: 'codex', sessionId: resume },
  }
  return runWithTaskTrace(context, () => harness.provider.start({
    cwd,
    prompt: [{ type: 'text', text: 'Protocol test only.' }],
    signal,
  }))
}

async function successfulRun(harness, options) {
  const run = await start(harness, options)
  try {
    const result = await run.result
    assert.equal(result.stopReason, 'completed')
    return { run, requests: JSON.parse(result.output[0].text) }
  } finally {
    await run.dispose()
  }
}

test('new Codex runs persist the real thread id and apply current model, effort and permission', async () => {
  const state = harness({ env: { CODEX_PROTOCOL_ONLY: 'true' }, permissionPolicy: 'reject' })
  const { requests } = await successfulRun(state)
  assert.deepEqual(requests.map((request) => request.method), ['initialize', 'thread/start', 'turn/start'])
  const thread = requests[1].params
  const turn = requests[2].params
  assert.equal(thread.ephemeral, false)
  assert.equal(thread.model, 'configured-model')
  assert.equal(thread.approvalPolicy, 'on-request')
  assert.equal(thread.approvalsReviewer, 'auto_review')
  assert.equal(thread.sandbox, 'workspace-write')
  assert.equal(turn.threadId, 'saved-thread')
  assert.equal(turn.effort, 'high')
  assert.deepEqual(state.saved, [{ agent: 'codex', sessionId: 'saved-thread' }])
  assert.ok(state.state.telemetry.some((value) => value?.model === 'configured-model' && value?.modelSource === 'configured'))
  assert.ok(state.state.telemetry.some((value) => value?.model === 'reported-start-model' && value?.modelSource === 'reported'))
  assert.ok(state.state.telemetry.some((value) => value?.usageScope === 'session' && value.usage.totalTokens === 150 && value.usage.cacheReadTokens === 30))
  assert.deepEqual(state.state.spawns[0].argv, DEFAULT_ARGV)
})

test('resume uses only thread/resume and the saved cwd, preserving remote model and effort by default', async () => {
  const state = harness()
  const { requests } = await successfulRun(state, { resume: 'saved-thread' })
  assert.deepEqual(requests.map((request) => request.method), ['initialize', 'thread/resume', 'turn/start'])
  const resume = requests[1].params
  const turn = requests[2].params
  assert.equal(resume.threadId, 'saved-thread')
  assert.equal(resume.cwd, process.cwd())
  assert.equal(resume.excludeTurns, true)
  assert.equal(resume.approvalPolicy, 'on-request')
  assert.equal(Object.hasOwn(resume, 'model'), false)
  assert.equal(Object.hasOwn(turn, 'model'), false)
  assert.equal(Object.hasOwn(turn, 'effort'), false)
  assert.equal(turn.threadId, 'saved-thread')
  assert.deepEqual(state.saved, [{ agent: 'codex', sessionId: 'saved-thread' }])
  assert.deepEqual(state.state.spawns[0].argv, DEFAULT_ARGV)
})

test('manual CLI argv preserves the entire trimmed path and all process and turn settings', async () => {
  const state = harness({ command: '  C:\\Program Files\\Codex\\codex.exe  ', env: { CODEX_PROTOCOL_ONLY: 'true' } })
  assert.equal(state.provider.config.command, 'C:\\Program Files\\Codex\\codex.exe')
  const { requests } = await successfulRun(state)
  const spec = state.state.spawns[0]
  assert.deepEqual(spec.argv, ['C:\\Program Files\\Codex\\codex.exe', 'app-server', '--stdio'])
  assert.equal(spec.cwd, process.cwd())
  assert.deepEqual(spec.env, { CODEX_PROTOCOL_ONLY: 'true' })
  assert.equal(spec.graceMs, 1000)
  assert.deepEqual(spec.stdio, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  assert.equal(requests[1].params.model, 'configured-model')
  assert.equal(requests[1].params.approvalPolicy, 'on-request')
  assert.equal(requests[2].params.effort, 'high')
  assert.equal(state.state.exited, 1)
})

test('reloaded manual CLI settings apply to old saved sessions and clearing restores auto selection', async () => {
  const savedConfig = { command: '/manual/codex', availability: { codex: false } }
  const state = harness(savedConfig)
  const manual = await successfulRun(state, { resume: 'saved-thread' })
  assert.deepEqual(state.state.spawns[0].argv, ['/manual/codex', 'app-server', '--stdio'])
  assert.equal(manual.requests[1].method, 'thread/resume')
  assert.equal(Object.hasOwn(manual.requests[1].params, 'model'), false)
  assert.equal(Object.hasOwn(manual.requests[2].params, 'effort'), false)
  savedConfig.command = '/updated/codex'
  const updated = harness(savedConfig)
  await successfulRun(updated, { resume: 'saved-thread' })
  assert.deepEqual(updated.state.spawns[0].argv, ['/updated/codex', 'app-server', '--stdio'])
  delete savedConfig.command
  const unavailable = harness(savedConfig)
  assert.equal(unavailable.provider, undefined)
  assert.equal(unavailable.state.spawns.length, 0)
  savedConfig.availability = { codex: true, codexCommand: '/native/codex' }
  const automatic = harness(savedConfig)
  await successfulRun(automatic, { resume: 'saved-thread' })
  assert.deepEqual(automatic.state.spawns[0].argv, DEFAULT_ARGV)
  assert.equal(automatic.provider.config.command, '/native/codex')
  assert.equal(state.state.exited, 1)
  assert.equal(updated.state.exited, 1)
  assert.equal(automatic.state.exited, 1)
})

test('raw whitespace command falls back to the runtime wrapper when no native command exists', async () => {
  const state = harness({ command: ' \t\n ', availability: { codex: true } })
  await successfulRun(state)
  assert.deepEqual(state.state.spawns[0].argv, WRAPPER_ARGV)
})

test('manual CLI startup cancellation cleans up the child and abort listeners', async () => {
  const controller = new AbortController()
  const state = harness({ command: '/manual/codex', onSpawn: () => queueMicrotask(() => controller.abort()) })
  await assert.rejects(start(state, { resume: 'saved-thread', signal: controller.signal }), /aborted before run publication/)
  assert.deepEqual(state.state.spawns[0].argv, ['/manual/codex', 'app-server', '--stdio'])
  assert.equal(state.state.exited, 1)
  assert.equal(state.state.terminated, 1)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  assert.equal(state.state.children[0].stderr.listenerCount('data'), 0)
  assert.deepEqual(state.saved, [])
})

test('an already cancelled manual CLI resume never spawns', async () => {
  const state = harness({ command: '/manual/codex' })
  await assert.rejects(start(state, { resume: 'saved-thread', signal: AbortSignal.abort() }), /aborted before app-server startup/)
  assert.equal(state.state.spawns.length, 0)
  assert.deepEqual(state.saved, [])
})

test('manual CLI resumed turn cancellation settles aborted and disposes exactly once', async () => {
  const controller = new AbortController()
  const state = harness({ command: '/manual/codex', env: { CODEX_TEST_PAUSE_TURN: 'true' } })
  const run = await start(state, { resume: 'saved-thread', signal: controller.signal })
  try {
    controller.abort()
    assert.equal((await run.result).stopReason, 'aborted')
  } finally {
    await Promise.all([run.dispose(), run.dispose()])
  }
  assert.equal(state.state.exited, 1)
  assert.equal(state.state.terminated, 1)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  assert.equal(state.state.children[0].stderr.listenerCount('data'), 0)
})

test('resume output excludes historical messages and every run gets a distinct managed id', async () => {
  const state = harness({ env: { CODEX_TEST_HISTORY: 'true' } })
  const first = await successfulRun(state, { resume: 'saved-thread' })
  const second = await successfulRun(state, { resume: 'saved-thread' })
  assert.notEqual(first.run.id, second.run.id)
  for (const { requests } of [first, second]) {
    assert.equal(requests.filter((request) => request.method === 'thread/start').length, 0)
  }
})

for (const [mode, pattern] of [
  ['missing', /thread-resume/],
  ['wrong-id', /thread-resume/],
  ['wrong-cwd', /thread-resume/],
  ['ephemeral', /thread-resume/],
]) {
test(`resume ${mode} fails without thread/start fallback`, async () => {
    const state = harness({ command: '/manual/codex', env: { CODEX_TEST_RESUME: mode } })
    await assert.rejects(async () => { await start(state, { resume: 'saved-thread' }) }, pattern)
    assert.deepEqual(state.saved, [])
    assert.equal(state.state.exited, 1)
    assert.equal(state.state.terminated, 1)
  })
}

test('a non-persistent new thread is rejected and never registered as resumable', async () => {
  const state = harness({ env: { CODEX_TEST_EPHEMERAL: 'true' } })
  await assert.rejects(async () => { await start(state) }, /thread-start/)
  assert.deepEqual(state.saved, [])
})

test('resume rejects a changed cwd before spawning an app-server', async () => {
  const state = harness()
  await assert.rejects(async () => { await start(state, { resume: 'saved-thread', cwd: '/' }) }, /saved cwd/)
  assert.deepEqual(state.saved, [])
})

test('unattended approval behavior and diagnostics remain active on resumed turns', async () => {
  const state = harness({ env: { CODEX_TEST_APPROVAL: 'true' }, permissionMode: 'never', permissionPolicy: 'reject' })
  const { requests } = await successfulRun(state, { resume: 'saved-thread' })
  assert.equal(requests[1].params.approvalPolicy, 'never')
  assert.deepEqual(requests.find((request) => request.method === 'approval/result').params, { decision: 'decline' })
})
