import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { apply as applyOfficial } from '@deepseek-ai/dsh-subagent-codex'
import { apply, Config, inject, name } from '../codex-provider.js'
import { runWithTaskTrace } from '../task-monitor.js'
import { codexWrapperArgv } from '../lib/codex-command.js'

const CODEX_APP_SERVER_SOURCE = `
let input = ''
let thread
let approvalReply = null
let turnEmissions = null
function finishTurn(extra) {
  const turn = turnEmissions.turn
  const params = turnEmissions.params
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'item/completed', params: {
    threadId: thread.id,
    turnId: turn.id,
    item: { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify({ thread: thread.params, turn: params, ...extra }) },
  } }) + '\\n')
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: thread.id, turn } }) + '\\n')
  turnEmissions = null
}
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
  while (true) {
    const end = input.indexOf('\\n')
    if (end < 0) break
    const line = input.slice(0, end)
    input = input.slice(end + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    const { id, method, params } = message
    if (method === undefined && id === 'srv-approval-1') {
      approvalReply = message.result
      finishTurn({ approval: approvalReply })
      continue
    }
    let result
    if (method === 'initialize') {
      result = {}
    } else if (method === 'thread/start') {
      // Echo the caller's own persistence choice so both the official
      // (ephemeral) and vendored (persistent) providers accept the thread.
      thread = { id: 'codex-test-thread', ephemeral: params.ephemeral === false ? false : true, params }
      result = { thread }
    } else if (method === 'turn/start') {
      const turn = { id: 'codex-test-turn', status: 'completed' }
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { turn } }) + '\\n')
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'turn/started', params: { threadId: thread.id, turn } }) + '\\n')
      if (process.env.CODEX_ASK_APPROVAL === 'command' || process.env.CODEX_ASK_APPROVAL === 'permissions') {
        turnEmissions = { turn, params }
        const ask = process.env.CODEX_ASK_APPROVAL === 'command'
          ? {
              method: 'item/commandExecution/requestApproval',
              params: { threadId: thread.id, turnId: turn.id, command: ['npm', 'test'], cwd: process.cwd(), availableDecisions: ['accept', 'decline', 'cancel'] },
            }
          : {
              method: 'item/permissions/requestApproval',
              params: { threadId: thread.id, turnId: turn.id, permissions: { command: ['git'] } },
            }
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'srv-approval-1', ...ask }) + '\\n')
        continue
      }
      turnEmissions = { turn, params }
      finishTurn({})
      continue
    } else if (method === 'turn/interrupt') {
      result = {}
    } else {
      throw new Error('unexpected Codex method: ' + method)
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
  }
})
process.stdin.on('end', () => process.exit(0))
`

function spawnCodexChild(spec) {
  const child = spawn(spec.argv[0], ['--eval', CODEX_APP_SERVER_SOURCE], {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }))
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    done,
    waitForExit: () => done,
    terminate() {
      child.kill('SIGTERM')
    },
  }
}

function harness(model, overrides = {}, availability = { codex: true, codexCommand: '/native/codex' }) {
  const state = { officialConfigs: [], starts: [], unregistered: 0 }
  const observations = []
  const tasks = { observeCodex(frame) { observations.push(frame) } }
  const ctx = {
    subagents: {
      registerProvider(provider) {
        state.provider = provider
        return () => { state.unregistered += 1 }
      },
    },
    webServer: { register: (route) => { state.catalogRoute = route; return () => {} } },
    subprocess: {
      spawn(spec) {
        state.catalogSpec = spec
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: { readFrom: () => ({ text: '{"models":[]}' }) } },
        }
      },
    },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    effect: (callback) => callback(),
    get(name) { return name === 'multiAgentTasks' ? tasks : availability },
    logger: { warn() {} },
  }
  function officialApply(officialCtx, config) {
    state.officialConfigs.push(config)
    const provider = {
      name: config.providerName,
      capabilities: { supportsResume: false },
      config,
      start(request) {
        const started = {
          request,
          receiver: this,
          model: this.config.model,
          hasModel: Object.hasOwn(this.config, 'model'),
          permissionMode: this.config.permissionMode,
          env: this.config.env,
          disposeGraceMs: this.config.disposeGraceMs,
        }
        state.starts.push(started)
        return started
      },
    }
    officialCtx.subagents.registerProvider(provider)
  }
  const config = {
    providerName: 'codex-router',
    model: { get: () => model.value },
    env: { CODEX_TEST: 'yes' },
    permissionMode: 'approve-for-me',
    disposeGraceMs: 4500,
    ...overrides,
  }
  apply(ctx, config, officialApply, { bundledCodexCommand: overrides.bundledCodexCommand })
  return { state, config, availability }
}

async function catalogResponse(state) {
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  }
  await state.catalogRoute.handler({ method: 'GET' }, response)
  return JSON.parse(response.body)
}

test('model catalog prefers the trimmed manual command and applies edits on reload', async () => {
  const config = { command: '  C:\\Program Files\\Codex\\codex.exe  ' }
  const { state } = harness({}, config)
  assert.equal((await catalogResponse(state)).ok, true)
  assert.deepEqual(state.catalogSpec.argv, ['C:\\Program Files\\Codex\\codex.exe', 'debug', 'models'])
  config.command = '/updated/codex'
  const updated = harness({}, config)
  await catalogResponse(updated.state)
  assert.deepEqual(updated.state.catalogSpec.argv, ['/updated/codex', 'debug', 'models'])
  delete config.command
  const cleared = harness({}, config)
  await catalogResponse(cleared.state)
  assert.deepEqual(cleared.state.catalogSpec.argv, ['/native/codex', 'debug', 'models'])
})

test('blank raw command never becomes an executable and detection remains live', async () => {
  const { state, availability } = harness({}, { command: ' \t\n ' })
  await catalogResponse(state)
  assert.deepEqual(state.catalogSpec.argv, ['/native/codex', 'debug', 'models'])
  availability.codexCommand = '/updated/native/codex'
  await catalogResponse(state)
  assert.deepEqual(state.catalogSpec.argv, ['/updated/native/codex', 'debug', 'models'])
})

test('model catalog uses the detected native Codex CLI and refreshes its live directory', async () => {
  const { state } = harness({ value: undefined })
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  }
  await state.catalogRoute.handler({ method: 'GET' }, response)
  assert.deepEqual(state.catalogSpec.argv, ['/native/codex', 'debug', 'models'])
  assert.equal(state.catalogSpec.argv.includes('--bundled'), false)
  assert.equal(response.status, 200)
})

test('exports an optional reloadable command with volatile model, effort and process settings', () => {
  assert.equal(name, 'codex-provider')
  assert.deepEqual(inject, ['subagents', 'subprocess', 'webServer', 'connection', 'multiAgentAvailability', 'multiAgentTasks'])

  const schema = Config.toJSON()
  const commandSchema = schema.refs[schema.refs[schema.uid].dict.command]
  assert.notEqual(commandSchema.meta.volatile, true)
  assert.notEqual(commandSchema.meta.required, true)
  const modelSchema = schema.refs[schema.refs[schema.uid].dict.model]
  assert.equal(modelSchema.meta.volatile, true)
  assert.notEqual(modelSchema.meta.required, true)
  const effortSchema = schema.refs[schema.refs[schema.uid].dict.reasoningEffort]
  assert.equal(effortSchema.meta.volatile, true)
  assert.notEqual(effortSchema.meta.required, true)
  for (const field of ['env', 'permissionPolicy', 'subagentPermissionMode', 'permissionMode', 'disposeGraceMs']) {
    assert.equal(schema.refs[schema.refs[schema.uid].dict[field]].meta.volatile, true)
  }

  const defaults = Config({})
  assert.equal(defaults.providerName, 'codex-router')
  assert.equal(defaults.command, undefined)
  assert.equal(Config({ command: '/manual/codex' }).command, '/manual/codex')
  assert.equal(defaults.model.get(), undefined)
  assert.deepEqual(defaults.env.get(), {})
  assert.equal(defaults.permissionPolicy.get(), 'main-session')
  assert.equal(defaults.subagentPermissionMode.get(), 'auto')
  assert.equal(defaults.permissionMode.get(), 'approve-for-me')
  assert.equal(defaults.disposeGraceMs.get(), 3000)
  assert.equal(Config({ model: 'gpt-5.1-codex' }).model.get(), 'gpt-5.1-codex')
  assert.equal(Config({ reasoningEffort: 'high' }).reasoningEffort.get(), 'high')
  assert.equal(Config({ permissionPolicy: 'human' }).permissionPolicy.get(), 'human')
  assert.equal(Config({ subagentPermissionMode: 'full-access' }).subagentPermissionMode.get(), 'full-access')

  assert.throws(() => Config({ model: '' }), /model/)
  assert.throws(() => Config({ command: '' }), /command/)
  assert.throws(() => Config({ command: ' \t\n ' }), /command/)
  assert.throws(() => Config({ reasoningEffort: '' }), /reasoningEffort/)
  assert.throws(() => Config({ providerName: 'codex' }), /providerName/)
  assert.throws(() => Config({ permissionMode: 'ask' }), /permissionMode/)
  assert.throws(() => Config({ permissionPolicy: 'maybe' }), /permissionPolicy/)
  assert.throws(() => Config({ subagentPermissionMode: 'sometimes' }), /subagentPermissionMode/)
  assert.throws(() => Config({ disposeGraceMs: 0 }), /disposeGraceMs/)
})

test('reads volatile environment, permission mode and disposal grace on every start', () => {
  const model = { value: undefined }
  const { state, config } = harness(model)
  config.env = { get: () => ({ CODEX_TEST: state.starts.length === 0 ? 'first' : 'second' }) }
  config.permissionMode = { get: () => state.starts.length === 0 ? 'never' : 'approve-for-me' }
  config.disposeGraceMs = { get: () => state.starts.length === 0 ? 1100 : 2200 }
  assert.deepEqual(state.provider.start({}).env, { CODEX_TEST: 'first' })
  assert.equal(state.starts[0].permissionMode, 'never')
  assert.equal(state.starts[0].disposeGraceMs, 1100)
  assert.deepEqual(state.provider.start({}).env, { CODEX_TEST: 'second' })
  assert.equal(state.starts[1].permissionMode, 'approve-for-me')
  assert.equal(state.starts[1].disposeGraceMs, 2200)
})

async function officialProtocolRun(values) {
  let provider
  const spawns = []
  const ctx = {
    get: (name) => name === 'multiAgentTasks' ? values.tasks : { codex: true, codexCommand: '/native/codex' },
    subprocess: { spawn(spec) { spawns.push(spec); return spawnCodexChild(spec) } },
    subagents: { registerProvider(value) { provider = value } },
    webServer: { register: () => () => {} },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    effect: (callback) => callback(),
    logger: { warn() {} },
  }
  const config = {
    providerName: 'codex-router',
    command: values.command,
    model: { get: () => values.model },
    reasoningEffort: { get: () => values.reasoningEffort },
    env: { get: () => values.env },
    permissionMode: { get: () => values.permissionMode },
    disposeGraceMs: { get: () => values.disposeGraceMs },
  }
  apply(ctx, config, applyOfficial)
  const run = await runWithTaskTrace(undefined, () => provider.start({
    cwd: process.cwd(),
    prompt: [{ type: 'text', text: 'Protocol observation only.' }],
    signal: AbortSignal.timeout(5000),
  }))
  try {
    const result = await run.result
    assert.equal(result.stopReason, 'completed')
    return { requests: JSON.parse(result.output[0].text), spawn: spawns[0] }
  } finally {
    await run.dispose()
  }
}

test('official Codex apply sends the latest reasoning effort in turn/start', async () => {
  const values = {
    model: 'gpt-test',
    reasoningEffort: 'high',
    env: { CODEX_PROTOCOL_TEST: 'yes' },
    permissionMode: 'approve-for-me',
    disposeGraceMs: 1000,
  }
  const first = await officialProtocolRun(values)
  assert.equal(first.requests.thread.model, 'gpt-test')
  assert.equal(first.requests.thread.approvalPolicy, 'on-request')
  assert.equal(first.requests.turn.effort, 'high')
  assert.deepEqual(first.spawn.env, { CODEX_PROTOCOL_TEST: 'yes' })
  assert.equal(first.spawn.graceMs, 1000)
  assert.equal(first.spawn.argv[0], process.execPath)
  assert.deepEqual(first.spawn.argv.slice(-2), ['app-server', '--stdio'])

  values.command = '/manual/codex'
  values.model = 'gpt-test-next'
  values.reasoningEffort = 'low'
  values.env = { CODEX_PROTOCOL_TEST: 'updated' }
  values.permissionMode = 'never'
  values.disposeGraceMs = 2000
  const second = await officialProtocolRun(values)
  assert.equal(second.requests.thread.model, 'gpt-test-next')
  assert.equal(second.requests.thread.approvalPolicy, 'never')
  assert.equal(second.requests.turn.effort, 'low')
  assert.deepEqual(second.spawn.env, { CODEX_PROTOCOL_TEST: 'updated' })
  assert.equal(second.spawn.graceMs, 2000)
  assert.deepEqual(second.spawn.argv, first.spawn.argv)
})

test('omitting Codex reasoning effort preserves native turn defaults', async () => {
  const observed = await officialProtocolRun({
    model: undefined,
    reasoningEffort: undefined,
    env: {},
    permissionMode: 'approve-for-me',
    disposeGraceMs: 1000,
  })
  assert.equal(Object.hasOwn(observed.requests.thread, 'model'), false)
  assert.equal(Object.hasOwn(observed.requests.turn, 'effort'), false)
})

test('Codex stdout observation preserves the official result and proxy method receivers', async () => {
  const frames = []
  const observed = await officialProtocolRun({
    model: 'gpt-test',
    reasoningEffort: 'high',
    env: {},
    permissionMode: 'approve-for-me',
    disposeGraceMs: 1000,
    tasks: { observeCodex(frame) { frames.push(frame); throw new Error('observer failure is contained') } },
  })
  assert.ok(observed.requests.turn.effort === 'high')
  assert.equal(frames.some((frame) => frame.method === 'turn/started'), true)
  assert.equal(frames.some((frame) => frame.method === 'item/completed'), true)
  assert.equal(frames.some((frame) => frame.method === 'turn/completed'), true)
})

test('registers through official apply and forwards compatible process settings', () => {
  const { state } = harness({ value: 'gpt-5.1-codex' }, { command: '/manual/codex' })
  assert.equal(state.provider.name, 'codex-router')
  assert.deepEqual(state.provider.capabilities, { supportsResume: false })
  assert.deepEqual(state.officialConfigs, [{
    providerName: 'codex-router',
    model: 'gpt-5.1-codex',
    env: { CODEX_TEST: 'yes' },
    permissionPolicy: 'main-session',
    subagentPermissionMode: 'auto',
    permissionMode: 'approve-for-me',
    disposeGraceMs: 4500,
  }])

  const request = { cwd: '/workspace' }
  const started = state.provider.start(request)
  assert.equal(started.request, request)
  assert.equal(started.receiver, state.provider)
  assert.equal(started.model, 'gpt-5.1-codex')
  assert.equal(started.permissionMode, 'approve-for-me')
  assert.deepEqual(started.env, { CODEX_TEST: 'yes' })
  assert.equal(started.disposeGraceMs, 4500)
  assert.equal(Object.hasOwn(state.provider.config, 'command'), false)
})

test('reads the latest volatile model on every subsequent start', () => {
  const model = { value: 'first-model' }
  const { state } = harness(model)
  assert.equal(state.provider.start({}).model, 'first-model')
  model.value = 'second-model'
  assert.equal(state.provider.start({}).model, 'second-model')
  model.value = 'third-model'
  assert.equal(state.provider.start({}).model, 'third-model')
  assert.equal(state.starts.length, 3)
})

test('omitting the volatile model inherits Codex settings and can change later', () => {
  const model = { value: undefined }
  const { state } = harness(model)
  assert.equal(Object.hasOwn(state.officialConfigs[0], 'model'), false)
  assert.equal(state.provider.start({}).hasModel, false)
  model.value = 'configured-later'
  assert.equal(state.provider.start({}).model, 'configured-later')
  model.value = undefined
  const inherited = state.provider.start({})
  assert.equal(inherited.hasModel, false)
  assert.equal(inherited.model, undefined)
})

test('apply also rejects the reserved official provider name', () => {
  let officialCalled = false
  assert.throws(() => apply({
    subagents: {},
    get: () => ({ codex: true }),
    logger: { warn() {} },
  }, {
    providerName: 'codex',
    model: { get: () => 'gpt-5.1-codex' },
  }, () => { officialCalled = true }), /reserved for the official provider/)
  assert.equal(officialCalled, false)
})

test('missing CLI skips registration and saving or clearing a manual command takes effect on reload', async () => {
  const availability = { codex: false }
  const savedConfig = {}
  const initial = harness({}, savedConfig, availability)
  assert.equal(initial.state.provider, undefined)
  assert.equal(initial.state.catalogRoute, undefined)
  assert.deepEqual(initial.state.officialConfigs, [])

  savedConfig.command = '/manual/codex'
  const reloaded = harness({}, savedConfig, availability)
  assert.ok(reloaded.state.provider)
  assert.equal((await catalogResponse(reloaded.state)).ok, true)
  assert.deepEqual(reloaded.state.catalogSpec.argv, ['/manual/codex', 'debug', 'models'])

  delete savedConfig.command
  const cleared = harness({}, savedConfig, availability)
  assert.equal(cleared.state.provider, undefined)
  assert.equal(cleared.state.catalogRoute, undefined)
  assert.deepEqual(cleared.state.officialConfigs, [])
})

test('an explicit manual command registers even when CLI detection fails', async () => {
  const { state } = harness({}, { command: ' /manual/codex ' }, { codex: false })
  assert.ok(state.provider)
  assert.equal(state.officialConfigs.length, 1)
  assert.equal((await catalogResponse(state)).ok, true)
  assert.deepEqual(state.catalogSpec.argv, ['/manual/codex', 'debug', 'models'])
})

test('missing CLI and a raw blank command skip both provider and catalog registration', () => {
  for (const availability of [{ codex: false }, {}]) {
    const { state } = harness({}, { command: ' \t\n ' }, availability)
    assert.equal(state.provider, undefined)
    assert.equal(state.catalogRoute, undefined)
    assert.deepEqual(state.officialConfigs, [])
  }
})

test('a whitespace detection result uses the runtime wrapper without treating it as a path', async () => {
  const { state } = harness({}, {}, { codex: true, codexCommand: ' \t ' })
  assert.equal((await catalogResponse(state)).ok, true)
  assert.deepEqual(state.catalogSpec.argv, codexWrapperArgv(['debug', 'models']))
})

test('the package native binary is a fallback when external CLI detection fails', async () => {
  const { state } = harness({}, { bundledCodexCommand: '/bundled/codex' }, { codex: false })
  assert.ok(state.provider)
  assert.equal((await catalogResponse(state)).ok, true)
  assert.deepEqual(state.catalogSpec.argv, ['/bundled/codex', 'debug', 'models'])
})

/** Run the plugin's own vendored provider (the production path) against the fake app-server. */
async function vendoredPermissionRun(values) {
  let provider
  const ctx = {
    get(name) {
      if (name === 'multiAgentTasks') return values.tasks
      if (name === 'approval') return values.approval
      if (name === 'userQuestions') return values.userQuestions
      return { codex: true, codexCommand: '/native/codex' }
    },
    subprocess: { spawn: (spec) => spawnCodexChild(spec) },
    subagents: { registerProvider(value) { provider = value } },
    webServer: { register: () => () => {} },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    effect: (callback) => callback(),
    logger: { warn() {} },
  }
  const config = {
    providerName: 'codex-router',
    command: process.execPath,
    model: { get: () => values.model },
    env: { get: () => values.env ?? {} },
    permissionMode: { get: () => values.permissionMode ?? 'approve-for-me' },
    ...(values.permissionPolicy === undefined ? {} : { permissionPolicy: { get: () => values.permissionPolicy } }),
    ...(values.subagentPermissionMode === undefined ? {} : { subagentPermissionMode: { get: () => values.subagentPermissionMode } }),
    disposeGraceMs: { get: () => 1000 },
  }
  apply(ctx, config)
  const run = await runWithTaskTrace(undefined, () => provider.start({
    cwd: process.cwd(),
    prompt: [{ type: 'text', text: 'Protocol observation only.' }],
    signal: AbortSignal.timeout(10000),
    ...(values.parent === undefined ? {} : { parent: values.parent }),
  }))
  try {
    const result = await run.result
    assert.equal(result.stopReason, 'completed')
    return { requests: JSON.parse(result.output[0].text) }
  } finally {
    await run.dispose()
  }
}

test('reject policy keeps the configured thread mode and declines asks', async () => {
  const observed = await vendoredPermissionRun({
    permissionPolicy: 'reject',
    permissionMode: 'approve-for-me',
    env: { CODEX_ASK_APPROVAL: 'command' },
  })
  assert.equal(observed.requests.thread.approvalPolicy, 'on-request')
  assert.equal(observed.requests.thread.approvalsReviewer, 'auto_review')
  assert.equal(observed.requests.thread.sandbox, 'workspace-write')
  assert.deepEqual(observed.requests.approval, { decision: 'decline' })
})

test('interactive policies start an ask-request thread without an auto reviewer', async () => {
  const observed = await vendoredPermissionRun({ permissionPolicy: 'main-session' })
  assert.equal(observed.requests.thread.approvalPolicy, 'on-request')
  assert.equal(observed.requests.thread.sandbox, 'workspace-write')
  assert.equal(Object.hasOwn(observed.requests.thread, 'approvalsReviewer'), false)
})

test('main-session approval grants a command ask through the approval chain', async () => {
  const asks = []
  const observed = await vendoredPermissionRun({
    permissionPolicy: 'main-session',
    env: { CODEX_ASK_APPROVAL: 'command' },
    parent: { id: 'parent-1' },
    approval: {
      async request(req) {
        asks.push(req)
        return 'allowed-once'
      },
    },
  })
  assert.equal(asks.length, 1)
  assert.match(asks[0].reason, /npm test/)
  assert.deepEqual(observed.requests.approval, { decision: 'accept' })
})

test('main-session rejection declines the command ask', async () => {
  const observed = await vendoredPermissionRun({
    permissionPolicy: 'main-session',
    env: { CODEX_ASK_APPROVAL: 'command' },
    parent: { id: 'parent-1' },
    approval: { async request() { return 'rejected' } },
  })
  assert.deepEqual(observed.requests.approval, { decision: 'decline' })
})

test('allow policy grants every ask including permission grants', async () => {
  const observed = await vendoredPermissionRun({
    permissionPolicy: 'allow',
    env: { CODEX_ASK_APPROVAL: 'permissions' },
  })
  assert.deepEqual(observed.requests.approval, { permissions: { command: ['git'] }, scope: 'turn' })
})

test('deny paths grant no permissions', async () => {
  const observed = await vendoredPermissionRun({
    permissionPolicy: 'reject',
    permissionMode: 'never',
    env: { CODEX_ASK_APPROVAL: 'permissions' },
  })
  assert.deepEqual(observed.requests.approval, { permissions: {}, scope: 'turn' })
})

test('sub-agent auto keeps Codex auto review and stays unattended', async () => {
  const observed = await vendoredPermissionRun({
    permissionPolicy: 'subagent',
    subagentPermissionMode: 'auto',
    env: { CODEX_ASK_APPROVAL: 'command' },
  })
  assert.equal(observed.requests.thread.approvalsReviewer, 'auto_review')
  assert.deepEqual(observed.requests.approval, { decision: 'decline' })
})

test('sub-agent auto respects an explicit never permissionMode', async () => {
  const observed = await vendoredPermissionRun({
    permissionPolicy: 'subagent',
    subagentPermissionMode: 'auto',
    permissionMode: 'never',
    env: { CODEX_ASK_APPROVAL: 'command' },
  })
  assert.equal(observed.requests.thread.approvalPolicy, 'never')
  assert.equal(Object.hasOwn(observed.requests.thread, 'approvalsReviewer'), false)
  assert.deepEqual(observed.requests.approval, { decision: 'decline' })
})

test('sub-agent full-access starts a bypass thread', async () => {
  const observed = await vendoredPermissionRun({ permissionPolicy: 'subagent', subagentPermissionMode: 'full-access' })
  assert.equal(observed.requests.thread.approvalPolicy, 'never')
  assert.equal(observed.requests.thread.sandbox, 'danger-full-access')
})

test('sub-agent ask-request surfaces every ask to the main session', async () => {
  const observed = await vendoredPermissionRun({
    permissionPolicy: 'subagent',
    subagentPermissionMode: 'ask-request',
    env: { CODEX_ASK_APPROVAL: 'command' },
    parent: { id: 'parent-1' },
    approval: { async request() { return 'allowed-once' } },
  })
  assert.equal(observed.requests.thread.approvalPolicy, 'on-request')
  assert.equal(Object.hasOwn(observed.requests.thread, 'approvalsReviewer'), false)
  assert.deepEqual(observed.requests.approval, { decision: 'accept' })
})

test('human policy answers map onto the interactive card', async () => {
  const observed = await vendoredPermissionRun({
    permissionPolicy: 'human',
    env: { CODEX_ASK_APPROVAL: 'command' },
    parent: { id: 'parent-1' },
    userQuestions: {
      async ask(request) {
        const question = request.questions[0]
        return { answers: [{ id: question.id, selected: [question.intent.approve] }] }
      },
    },
  })
  assert.deepEqual(observed.requests.approval, { decision: 'accept' })
})

test('without interactive services the vendored path denies fail-closed', async () => {
  const observed = await vendoredPermissionRun({
    permissionPolicy: 'main-session',
    env: { CODEX_ASK_APPROVAL: 'command' },
  })
  assert.deepEqual(observed.requests.approval, { decision: 'decline' })
})
