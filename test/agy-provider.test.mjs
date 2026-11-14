import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { apply, Config, inject, name } from '../agy-provider.js'
import { setSystemProxyReader } from '../lib/proxy.js'
import { runWithTaskTrace } from '../task-monitor.js'

// Keep proxy injection deterministic: no host registry lookup during tests.
setSystemProxyReader(() => undefined)

const ACP_AGENT_SOURCE = `
let input = ''
const events = []
const models = [
  { value: 'gemini-test', name: 'Gemini Test' },
  { value: 'claude-test', name: 'Claude Test' },
]
const options = model => [
  { type: 'select', id: 'model', category: 'model', currentValue: model, options: models },
  { type: 'select', id: 'thought_level', category: 'thought_level', currentValue: 'medium', options: [
    { value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' },
    ...(model === 'gemini-test' ? [{ value: 'high', name: 'High' }] : []),
  ] },
]
let model = models[0].value
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  input += chunk
  while (true) {
    const end = input.indexOf('\\n')
    if (end < 0) break
    const line = input.slice(0, end)
    input = input.slice(end + 1)
    if (!line.trim()) continue
    const { id, method, params } = JSON.parse(line)
    if (id === undefined) continue
    let result
    if (method === 'initialize') {
      events.push({ method })
      result = { protocolVersion: params.protocolVersion, agentCapabilities: {
        loadSession: process.env.ACP_NO_LOAD !== '1',
        ...(process.env.ACP_RESUME === '1' ? { sessionCapabilities: { resume: {} } } : {}),
      } }
    } else if (method === 'session/new') {
      events.push({ method })
      model = models[0].value
      result = { sessionId: 'agy-test-session', configOptions: options(model) }
    } else if (method === 'session/resume' || method === 'session/load') {
      events.push({ method, sessionId: params.sessionId })
      if (method === 'session/load' && process.env.ACP_EMPTY_HISTORY !== '1') {
        for (const [sessionId, sessionUpdate, text] of [
          ['other-session', 'agent_message_chunk', 'OTHER SESSION MUST BE IGNORED'],
          ...(process.env.ACP_AGENT_HISTORY_ONLY === '1' ? [] : [[params.sessionId, 'user_message_chunk', 'OLD USER REPLAY']]),
          [params.sessionId, 'agent_message_chunk', 'OLD ASSISTANT REPLAY'],
        ]) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
          sessionId, update: { sessionUpdate, content: { type: 'text', text } },
        } }) + '\\n')
      }
      result = method === 'session/resume'
        ? { sessionId: params.sessionId, configOptions: options(model) }
        : {}
    } else if (method === 'session/set_config_option') {
      events.push({ method, sessionId: params.sessionId, configId: params.configId, value: params.value })
      if (params.configId === 'model') model = params.value
      result = { configOptions: options(model) }
    } else if (method === 'session/prompt') {
      events.push({ method, sessionId: params.sessionId })
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(events) } },
      } }) + '\\n')
      result = { stopReason: 'end_turn', ...(process.env.ACP_USAGE === '1' ? { usage: {
        totalTokens: 42, inputTokens: 30, outputTokens: 12, cachedReadTokens: 5, cachedWriteTokens: 2, thoughtTokens: 3,
      } } : {}) }
    } else {
      throw new Error('unexpected ACP method: ' + method)
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
  }
})
process.stdin.on('end', () => process.exit(0))
`

function spawnAcpChild(spec) {
  const child = spawn(spec.argv[0], spec.argv.slice(1), {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }))
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    done,
    async waitForExit(signal) {
      if (signal === undefined) return done
      if (signal.aborted) return undefined
      let onAbort
      try {
        return await Promise.race([done, new Promise((resolve) => {
          onAbort = () => resolve(undefined)
          signal.addEventListener('abort', onAbort, { once: true })
        })])
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
    },
    terminate() { child.kill('SIGTERM') },
  }
}

function harness({ model: initialModel, reasoningEffort: initialEffort, available = true, env = {}, proxyMode, proxyUrl, manualCommand, permission = 'allow', parent, permissionPresets, sandboxPolicy, approval } = {}) {
  let model = initialModel
  let reasoningEffort = initialEffort
  const state = { observations: [], saved: [], warnings: [], spawns: [] }
  const config = {
    providerName: 'agy',
    command: manualCommand ?? (available ? process.execPath : undefined),
    args: ['--eval', ACP_AGENT_SOURCE],
    permission,
    env,
    proxyMode,
    proxyUrl,
    model: { get: () => model },
    reasoningEffort: { get: () => reasoningEffort },
    disposeEofGraceMs: 1000,
    disposeGraceMs: 1000,
  }
  const ctx = {
    get(key) {
      if (key === 'multiAgentTasks') return {
        observeACP(update) { state.observations.push(update) },
        setExternalSession(agent, sessionId) { state.saved.push({ agent, sessionId }) },
        setTelemetry(update) { (state.telemetry ??= []).push(update) },
      }
      if (key === 'approval') return approval
      if (key === 'permissionPresets') return permissionPresets
      if (key === 'sandboxPolicy') return sandboxPolicy
      return { agy: available, ...(available ? { agyCommand: '/detected/agy' } : {}) }
    },
    subprocess: { spawn(spec) {
      state.spawns.push(spec)
      // The fake child is Node rather than agy; record the real agy argv but
      // remove the agy-only switch before starting the protocol fixture.
      return spawnAcpChild({ ...spec, argv: spec.argv.filter((value) => value !== '--dangerously-skip-permissions') })
    } },
    subagents: { registerProvider(value) { state.provider = value } },
    webServer: { register(route) { state.route = route; return () => {} } },
    effect: (callback) => callback(),
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    logger: { warn(message) { state.warnings.push(message) } },
  }
  apply(ctx, config)
  return {
    state,
    setCommand(value) { config.command = value },
    setModel(value) { model = value },
    setReasoningEffort(value) { reasoningEffort = value },
    async run(trace) {
      const run = await runWithTaskTrace(trace, () => state.provider.start({
        cwd: process.cwd(), prompt: [{ type: 'text', text: 'Return ACP requests.' }],
        signal: new AbortController().signal,
        ...(parent === undefined ? {} : { parent }),
      }))
      try {
        const result = await run.result
        assert.equal(result.stopReason, 'completed')
        return { ...state, requests: JSON.parse(result.output[0].text) }
      } finally {
        await run.dispose()
      }
    },
  }
}

test('agy provider exports independent volatile ACP configuration', () => {
  assert.equal(name, 'agy-provider')
  assert.ok(inject.includes('multiAgentAvailability'))
  const defaults = Config({})
  assert.equal(defaults.providerName, 'agy')
  assert.equal(defaults.command.get(), undefined)
  assert.deepEqual(defaults.args.get(), ['acp', '--stdio'])
  assert.equal(defaults.model.get(), undefined)
  assert.equal(defaults.reasoningEffort.get(), undefined)
  assert.equal(Config({ model: 'gemini-test' }).model.get(), 'gemini-test')
  assert.equal(Config({ reasoningEffort: 'high' }).reasoningEffort.get(), 'high')
  assert.throws(() => Config({ providerName: 'kimi-code' }), /providerName/)
  const schema = Config.toJSON()
  for (const field of ['command', 'args', 'permission', 'env', 'proxyMode', 'proxyUrl', 'model', 'reasoningEffort', 'disposeEofGraceMs', 'disposeGraceMs']) {
    assert.equal(schema.refs[schema.refs[schema.uid].dict[field]].meta.volatile, true)
  }
})

test('agy injects the configured proxy into the child environment', async () => {
  const agent = harness({ proxyMode: 'custom', proxyUrl: 'http://10.0.0.2:8080' })
  await agent.run()
  assert.equal(agent.state.spawns[0].env.HTTPS_PROXY, 'http://10.0.0.2:8080')
  assert.equal(agent.state.spawns[0].env.HTTP_PROXY, 'http://10.0.0.2:8080')
  assert.equal(agent.state.spawns[0].env.NO_PROXY, 'localhost,127.0.0.1')
})

test('agy bypasses an inherited proxy when the proxy mode is none', async () => {
  const agent = harness({ proxyMode: 'none' })
  await agent.run()
  assert.equal(agent.state.spawns[0].env.NO_PROXY, '*')
  assert.equal(agent.state.spawns[0].env.HTTPS_PROXY, undefined)
})

test('unavailable agy skips provider and model catalog registration', () => {
  const { state } = harness({ available: false })
  assert.equal(state.provider, undefined)
  assert.equal(state.route, undefined)
  assert.match(state.warnings[0], /Antigravity is unavailable/)
})

test('an explicit agy command registers even when automatic detection fails', () => {
  const { state } = harness({ available: false, manualCommand: process.execPath })
  assert.ok(state.provider)
  assert.equal(state.provider.config.command, process.execPath)
})

test('agy command remains live across volatile settings edits', () => {
  const agent = harness()
  agent.setCommand('C:\\Tools\\agy.exe')
  assert.equal(agent.state.provider.config.command, 'C:\\Tools\\agy.exe')
  agent.setCommand(undefined)
  assert.equal(agent.state.provider.config.command, '/detected/agy')
})

test('new sessions set agy model family then thought_level using current ACP options', async () => {
  const agent = harness({ model: 'gemini-test', reasoningEffort: 'high' })
  assert.deepEqual((await agent.run()).requests, [
    { method: 'initialize' }, { method: 'session/new' },
    { method: 'session/set_config_option', sessionId: 'agy-test-session', configId: 'model', value: 'gemini-test' },
    { method: 'session/set_config_option', sessionId: 'agy-test-session', configId: 'thought_level', value: 'high' },
    { method: 'session/prompt', sessionId: 'agy-test-session' },
  ])
  agent.setModel('claude-test')
  agent.setReasoningEffort('low')
  const next = await agent.run()
  assert.equal(next.requests[2].value, 'claude-test')
  assert.equal(next.requests[3].configId, 'thought_level')
  assert.equal(next.requests[3].value, 'low')
  assert.deepEqual(next.saved, [{ agent: 'agy', sessionId: 'agy-test-session' }, { agent: 'agy', sessionId: 'agy-test-session' }])
})

test('omitted agy model and effort preserve native session defaults', async () => {
  const agent = harness()
  assert.deepEqual((await agent.run()).requests.map((request) => request.method), ['initialize', 'session/new', 'session/prompt'])
})

test('agy inherits the native full preset through its bypass flag', async () => {
  const agent = harness({
    permission: 'main-session',
    parent: { id: 'parent-1', session: { id: 'session-1' } },
    permissionPresets: {
      current: () => 'full',
      resolve: () => ({ approval: 'never', sandbox: 'danger-full-access' }),
    },
  })
  await agent.run()
  assert.equal(agent.state.spawns[0].argv.includes('--dangerously-skip-permissions'), true)
})

test('agy does not bypass permissions for a non-full main-session preset', async () => {
  const agent = harness({
    permission: 'main-session',
    parent: { id: 'parent-1', session: { id: 'session-1' } },
    permissionPresets: {
      current: () => 'custom',
      resolve: () => { throw new Error('custom preset has no named resolver') },
    },
    approval: { defaultPolicy: 'ask', overrideOf: () => undefined },
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
  })
  await agent.run()
  assert.equal(agent.state.spawns[0].argv.includes('--dangerously-skip-permissions'), false)
})

test('agy rejects unavailable models and efforts before prompt', async () => {
  await assert.rejects(harness({ model: 'not-advertised' }).run(), /set-model/)
  await assert.rejects(harness({ model: 'claude-test', reasoningEffort: 'high' }).run(), /set-reasoning-effort/)
})

test('agy prefers load over resume and excludes replayed history from output and observations', async () => {
  const agent = harness({ model: 'claude-test', reasoningEffort: 'high', env: { ACP_RESUME: '1' } })
  const result = await agent.run({ record: { cwd: process.cwd() }, resume: { agent: 'agy', sessionId: 'saved-agy' } })
  assert.deepEqual(result.requests, [
    { method: 'initialize' },
    { method: 'session/load', sessionId: 'saved-agy' },
    { method: 'session/prompt', sessionId: 'saved-agy' },
  ])
  assert.deepEqual(result.saved, [{ agent: 'agy', sessionId: 'saved-agy' }])
  assert.equal(JSON.stringify(result.observations).includes('REPLAY'), false)
  await assert.rejects(agent.run({ record: { cwd: process.cwd() }, resume: { agent: 'kimi-code', sessionId: 'wrong-provider' } }), /Invalid saved Antigravity session/)
})

test('agy rejects successful but empty load before prompt and preserves native persistence diagnosis', async () => {
  const agent = harness({ env: { ACP_RESUME: '1', ACP_EMPTY_HISTORY: '1' } })
  let childSpawned = false
  const originalSpawn = agent.state.provider.ctx.subprocess.spawn
  agent.state.provider.ctx.subprocess.spawn = (spec) => { childSpawned = true; return originalSpawn(spec) }
  await assert.rejects(agent.run({ record: { cwd: process.cwd() }, resume: { agent: 'agy', sessionId: 'saved-agy' } }), (error) => {
    assert.match(error.message, /resume-session/)
    assert.match(error.cause?.message, /loaded no user or assistant history/)
    assert.match(error.cause?.message, /may not have been persisted/)
    assert.equal(childSpawned, true)
    return true
  })
  assert.equal(agent.state.warnings.some((message) => message.includes('Native session history may not have been persisted')), true)
})

test('agy requires loadSession capability instead of using history-free resume', async () => {
  const agent = harness({ env: { ACP_RESUME: '1', ACP_NO_LOAD: '1' } })
  await assert.rejects(agent.run({ record: { cwd: process.cwd() }, resume: { agent: 'agy', sessionId: 'saved-agy' } }), (error) => {
    assert.match(error.message, /resume-session/)
    assert.match(error.cause?.message, /requires ACP session\/load support/)
    return true
  })
})

test('agy accepts an agent-only replay and does not require a user chunk', async () => {
  const agent = harness({ env: { ACP_AGENT_HISTORY_ONLY: '1' } })
  const result = await agent.run({ record: { cwd: process.cwd() }, resume: { agent: 'agy', sessionId: 'saved-agy' } })
  assert.deepEqual(result.requests.map((request) => request.method), ['initialize', 'session/load', 'session/prompt'])
  assert.equal(JSON.stringify(result.observations).includes('OLD ASSISTANT REPLAY'), false)
})

test('agy refuses a changed continuation workspace', async () => {
  await assert.rejects(harness().run({ record: { cwd: '/' }, resume: { agent: 'agy', sessionId: 'saved' } }), /saved workspace/)
})

test('model catalog uses ACP configOptions and records per-model thought levels', async () => {
  const { state } = harness()
  assert.equal(state.route.path, '/multi-agent/model-catalog/agy')
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body } }
  await state.route.handler({ method: 'GET' }, response)
  assert.equal(response.status, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.ok, true)
  assert.deepEqual(body.value, {
    groups: [{ id: 'agy', name: 'Google Antigravity', models: [
      { id: 'gemini-test', name: 'Gemini Test', reasoning: {
        efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium',
      } },
      { id: 'claude-test', name: 'Claude Test', reasoning: {
        efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }], defaultEffort: 'medium',
      } },
    ] }],
    failures: [],
  })
})

test('agy reports session model and effort and maps optional prompt usage without context occupancy', async () => {
  const agent = harness({ env: { ACP_USAGE: '1' } })
  await agent.run()
  assert.deepEqual(agent.state.telemetry, [
    { model: 'gemini-test', modelSource: 'reported', reasoningEffort: 'medium', reasoningEffortSource: 'reported' },
    { usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42, cacheReadTokens: 5, cacheWriteTokens: 2, reasoningTokens: 3 }, usageScope: 'session' },
  ])
})

test('agy continuation does not mistake load replay for current usage or replace reported model with config', async () => {
  const agent = harness({ model: 'claude-test', reasoningEffort: 'high', env: { ACP_RESUME: '1' } })
  await agent.run({ record: { cwd: process.cwd() }, resume: { agent: 'agy', sessionId: 'saved-agy' } })
  assert.equal((agent.state.telemetry ?? []).some((value) => value?.modelSource === 'configured'), false)
  assert.equal((agent.state.telemetry ?? []).some((value) => value?.usage !== undefined), false)
})
