import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { apply, Config, inject, AcpProvider } from '../acp-provider.js'
import { createPermissionAsker } from '../lib/permission-policy.js'
import { setSystemProxyReader } from '../lib/proxy.js'
import { runWithTaskTrace } from '../task-monitor.js'

// Keep proxy injection deterministic: no host registry lookup during tests.
setSystemProxyReader(() => undefined)

const ACP_AGENT_SOURCE = `
let input = ''
const events = []
let pendingPromptId = null
let pendingSessionId = null
let permissionAsked = false
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
    // Replies to the permission request this child issued.
    if (method === undefined && id === 'perm-ask-1') {
      events.push({ permission: message.result })
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', method: 'session/update',
        params: { sessionId: pendingSessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(events) } } },
      }) + '\\n')
      if (pendingPromptId !== null) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: pendingPromptId, result: { stopReason: 'end_turn' } }) + '\\n')
        pendingPromptId = null
      }
      continue
    }
    let result
    if (method === 'initialize') {
      events.push({ method })
      result = { protocolVersion: params.protocolVersion, agentCapabilities: process.env.ACP_RESUME_MODE === 'resume' ? { loadSession: true, sessionCapabilities: { resume: {} } } : process.env.ACP_RESUME_MODE === 'load' ? { loadSession: true } : {} }
    } else if (method === 'session/resume' || method === 'session/load') {
      events.push({ method, sessionId: params.sessionId })
      if (method === 'session/load') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OLD REPLAY MUST BE IGNORED' } } } }) + '\\n')
      result = {}
    } else if (method === 'session/new') {
      events.push({ method })
      result = {
        sessionId: 'acp-test-session',
        configOptions: [
          { type: 'select', id: 'model', category: 'model', options: [] },
          {
            type: 'select', id: 'thinking', category: 'thought_level', currentValue: 'max',
            options: [{ value: 'low' }, { value: 'high' }, { value: 'max' }],
          },
        ],
      }
    } else if (method === 'session/set_config_option') {
      events.push({ method, sessionId: params.sessionId, configId: params.configId, value: params.value })
      result = { configOptions: [{
        type: 'select', id: 'thinking', category: 'thought_level', currentValue: 'high',
        options: (params.value === 'model-with-medium' ? ['medium'] : ['low', 'high', 'max']).map(value => ({ value })),
      }] }
    } else if (method === 'session/prompt') {
      events.push({ method, sessionId: params.sessionId })
      if (process.env.ACP_ASK_PERMISSION && !permissionAsked) {
        permissionAsked = true
        pendingPromptId = id
        pendingSessionId = params.sessionId
        const alwaysOnly = process.env.ACP_ASK_PERMISSION === 'always-only'
        const shape = process.env.ACP_PERMISSION_SHAPE
        const toolCall = shape === 'kimi-write'
          ? { toolCallId: 'perm-tool-1', title: 'Write', content: [{ type: 'content', content: { type: 'text', text: 'Requesting approval to Writing /tmp/probe/hello.txt' } }] }
          : shape === 'kimi-command'
            ? { toolCallId: 'perm-tool-1', title: 'Bash', content: [{ type: 'content', content: { type: 'text', text: 'Requesting approval to Running: echo probe-ok' } }] }
            : shape === 'agy-write'
              ? { toolCallId: 'perm-tool-1', kind: 'edit', status: 'pending', title: 'File hello.txt', name: 'write_file', content: [{ type: 'diff', path: '/tmp/probe/hello.txt', newText: 'hello from probe\\n' }], locations: [{ path: '/tmp/probe/hello.txt' }], rawInput: { Content: 'hello from probe\\n', Overwrite: true, Path: '/tmp/probe/hello.txt' } }
              : shape === 'agy-command'
                ? { toolCallId: 'perm-tool-1', kind: 'execute', status: 'pending', title: 'echo probe-ok', name: 'run_command', rawInput: { CommandLine: 'echo probe-ok' } }
                : { kind: 'execute', title: 'Run project tests', toolCallId: 'perm-tool-1' }
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id: 'perm-ask-1', method: 'session/request_permission',
          params: {
            sessionId: params.sessionId,
            toolCall,
            options: alwaysOnly ? [
              { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
              { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
            ] : [
              { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
              { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
              { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
            ],
          },
        }) + '\\n')
        continue
      }
      const notification = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: JSON.stringify(events) },
          },
        },
      }
      process.stdout.write(JSON.stringify(notification) + '\\n')
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', method: 'session/update', params: {
          sessionId: params.sessionId,
          update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Read report', status: 'pending' },
        },
      }) + '\\n')
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', method: 'session/update', params: {
          sessionId: params.sessionId,
          update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'read ok' } }] },
        },
      }) + '\\n')
      result = { stopReason: 'end_turn' }
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
        return await Promise.race([
          done,
          new Promise((resolve) => {
            onAbort = () => resolve(undefined)
            signal.addEventListener('abort', onAbort, { once: true })
          }),
        ])
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
    },
    terminate() {
      child.kill('SIGTERM')
    },
  }
}

function harness(initialModel, initialEffort, env = {}, availability = { kimiCode: true }, options = {}) {
  let model = initialModel
  let reasoningEffort = initialEffort
  let provider
  const config = {
    providerName: 'kimi-code',
    command: process.execPath,
    args: ['--eval', ACP_AGENT_SOURCE],
    permission: options.permission ?? 'reject',
    ...(options.subagentPermissionMode === undefined ? {} : { subagentPermissionMode: options.subagentPermissionMode }),
    env,
    model: { get: () => model },
    reasoningEffort: { get: () => reasoningEffort },
    disposeEofGraceMs: 1000,
    disposeGraceMs: 1000,
  }
  const observations = []
  const saved = []
  const tasks = { observeACP(update) { observations.push(update) }, setExternalSession(agent, sessionId) { saved.push({ agent, sessionId }) } }
  const ctx = {
    get(name) {
      if (name === 'multiAgentTasks') return tasks
      if (name === 'approval') return options.approval
      if (name === 'userQuestions') return options.userQuestions
      if (name === 'permissionPresets') return options.permissionPresets
      if (name === 'sandboxPolicy') return options.sandboxPolicy
      assert.equal(name, 'multiAgentAvailability')
      return availability
    },
    subprocess: { spawn: spawnAcpChild },
    subagents: { registerProvider(value) { provider = value } },
    webServer: { register: () => () => {} },
    effect: (callback) => callback(),
    logger: { warn() {} },
  }
  apply(ctx, config)
  return {
    provider,
    setCommand(value) { config.command = value },
    setModel(value) { model = value },
    setReasoningEffort(value) { reasoningEffort = value },
    async run(trace) {
      const run = await runWithTaskTrace(trace, () => provider.start({
        cwd: process.cwd(),
        prompt: [{ type: 'text', text: 'Return the observed ACP requests.' }],
        signal: options.signal ?? new AbortController().signal,
        ...(options.parent === undefined ? {} : { parent: options.parent }),
      }))
      try {
        const result = await run.result
        assert.equal(result.stopReason, 'completed')
        assert.equal(result.output.length, 1)
        assert.equal(result.output[0].type, 'text')
        return { requests: JSON.parse(result.output[0].text), observations, saved }
      } finally {
        await run.dispose()
      }
    },
  }
}

test('model and reasoning effort Config are optional and volatile', () => {
  const omitted = Config({ command: 'kimi' })
  assert.equal(omitted.model.get(), undefined)
  assert.equal(omitted.reasoningEffort.get(), undefined)
  assert.equal(omitted.permission.get(), 'main-session')
  assert.equal(omitted.subagentPermissionMode.get(), 'auto')
  assert.equal(Config({ command: 'kimi', permission: 'human' }).permission.get(), 'human')
  assert.equal(Config({ command: 'kimi', subagentPermissionMode: 'ask-request' }).subagentPermissionMode.get(), 'ask-request')
  assert.throws(() => Config({ command: 'kimi', permission: 'maybe' }), /permission/)
  assert.throws(() => Config({ command: 'kimi', subagentPermissionMode: 'sometimes' }), /subagentPermissionMode/)
  const configured = Config({ command: 'kimi', model: 'kimi-first' })
  assert.equal(configured.model.get(), 'kimi-first')
  assert.equal(Config({ command: 'kimi', reasoningEffort: 'high' }).reasoningEffort.get(), 'high')
  const schema = Config.toJSON()
  assert.equal(schema.refs[schema.refs[schema.uid].dict.reasoningEffort].meta.volatile, true)
})

test('custom Kimi provider names retain Kimi continuation identity', () => {
  const provider = new AcpProvider('my-kimi', {}, {})
  assert.equal(provider.name, 'my-kimi')
  assert.equal(provider.dialect.agent, 'kimi-code')
})

test('inject declares the unified availability service', () => {
  assert.ok(inject.includes('multiAgentAvailability'))
})

test('unavailable Kimi Code skips provider and model route registration with a warning', () => {
  let providerRegistrations = 0
  let routeRegistrations = 0
  const warnings = []
  const ctx = {
    get(name) {
      assert.equal(name, 'multiAgentAvailability')
      return { kimiCode: false }
    },
    subagents: { registerProvider() { providerRegistrations += 1 } },
    webServer: { register() { routeRegistrations += 1; return () => {} } },
    effect() { throw new Error('unavailable provider must not install effects') },
    logger: { warn(message) { warnings.push(message) } },
  }
  apply(ctx, {})
  assert.equal(providerRegistrations, 0)
  assert.equal(routeRegistrations, 0)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Kimi Code is unavailable/)
})

test('an explicit Kimi command registers even when automatic detection fails', () => {
  const agent = harness(undefined, undefined, {}, { kimiCode: false })
  assert.equal(agent.provider.config.command, process.execPath)
})

test('Kimi command remains live across volatile settings edits', () => {
  const agent = harness()
  agent.setCommand('C:\\Tools\\kimi.exe')
  assert.equal(agent.provider.config.command, 'C:\\Tools\\kimi.exe')
  agent.setCommand(undefined)
  assert.equal(agent.provider.config.command, undefined)
})

test('each start resolves the current model between session/new and session/prompt', async () => {
  const agent = harness('kimi-first')
  assert.deepEqual((await agent.run()).requests, [
    { method: 'initialize' },
    { method: 'session/new' },
    { method: 'session/set_config_option', sessionId: 'acp-test-session', configId: 'model', value: 'kimi-first' },
    { method: 'session/prompt', sessionId: 'acp-test-session' },
  ])

  agent.setModel('kimi-second')
  assert.deepEqual((await agent.run()).requests, [
    { method: 'initialize' },
    { method: 'session/new' },
    { method: 'session/set_config_option', sessionId: 'acp-test-session', configId: 'model', value: 'kimi-second' },
    { method: 'session/prompt', sessionId: 'acp-test-session' },
  ])
})

test('omitted model preserves the native ACP default', async () => {
  const agent = harness(undefined)
  assert.deepEqual((await agent.run()).requests, [
    { method: 'initialize' },
    { method: 'session/new' },
    { method: 'session/prompt', sessionId: 'acp-test-session' },
  ])
})

test('each start sets the latest effort through the advertised thinking option', async () => {
  const agent = harness(undefined, 'low')
  assert.deepEqual((await agent.run()).requests, [
    { method: 'initialize' },
    { method: 'session/new' },
    { method: 'session/set_config_option', sessionId: 'acp-test-session', configId: 'thinking', value: 'low' },
    { method: 'session/prompt', sessionId: 'acp-test-session' },
  ])
  agent.setReasoningEffort('max')
  assert.deepEqual((await agent.run()).requests[2], {
    method: 'session/set_config_option', sessionId: 'acp-test-session', configId: 'thinking', value: 'max',
  })
  agent.setReasoningEffort(undefined)
  assert.deepEqual((await agent.run()).requests, [
    { method: 'initialize' },
    { method: 'session/new' },
    { method: 'session/prompt', sessionId: 'acp-test-session' },
  ])
})

test('effort validation uses the selected model options rather than session defaults', async () => {
  const agent = harness('model-with-medium', 'medium')
  const events = (await agent.run()).requests
  assert.ok(events.some((event) => event.configId === 'thinking' && event.value === 'medium'))
})

test('unsupported effort fails before session/prompt', async () => {
  const agent = harness(undefined, 'medium')
  await assert.rejects(agent.run(), (error) => {
    assert.match(error.message, /set-reasoning-effort/)
    assert.match(error.cause?.message, /does not support reasoningEffort "medium"/)
    return true
  })
})

for (const mode of ['resume', 'load']) {
  test(`Kimi session/${mode} reuses the saved id without replay or global model overrides`, async () => {
    const agent = harness('different-global-model', 'high', { ACP_RESUME_MODE: mode })
    const trace = { record: { cwd: process.cwd() }, resume: { agent: 'kimi-code', sessionId: 'original-session' } }
    const result = await agent.run(trace)
    assert.deepEqual(result.requests, [{ method: 'initialize' }, { method: `session/${mode}`, sessionId: 'original-session' }, { method: 'session/prompt', sessionId: 'original-session' }])
    assert.equal(JSON.stringify(result.observations).includes('OLD REPLAY'), false)
    assert.deepEqual(result.saved, [{ agent: 'kimi-code', sessionId: 'original-session' }])
  })
}

test('Kimi refuses unsupported resume rather than creating a new session', async () => {
  const agent = harness(undefined)
  await assert.rejects(agent.run({ record: { cwd: process.cwd() }, resume: { agent: 'kimi-code', sessionId: 'original-session' } }), /resume-session/)
})

test('Kimi rejects a different saved workspace before startup', async () => {
  const agent = harness(undefined)
  await assert.rejects(agent.run({ record: { cwd: '/' }, resume: { agent: 'kimi-code', sessionId: 'original-session' } }), /saved workspace/)
})

test('official ACP updates are observed while preserving folded output', async () => {
  const agent = harness(undefined)
  const run = await agent.run()
  assert.ok(run.requests.some((request) => request.method === 'session/prompt'))
  assert.equal(run.observations.some((update) => update.sessionUpdate === 'agent_message_chunk'), true)
  assert.equal(run.observations.some((update) => update.sessionUpdate === 'tool_call'), true)
  assert.equal(run.observations.some((update) => update.sessionUpdate === 'tool_call_update' && update.status === 'completed'), true)
})

/** The permission decision one permission-mode run observed, if any. */
function permissionEntry(requests) {
  return requests.find((entry) => entry && typeof entry === 'object' && entry.permission !== undefined)?.permission
}

test('permission policy reject denies the ask without interactive services', async () => {
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, { permission: 'reject' })
  const { requests } = await agent.run()
  // A denial prefers the child's explicit reject option over a cancellation.
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'reject-once' } })
})

test('permission policy allow selects the offered allow_once option', async () => {
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, { permission: 'allow' })
  const { requests } = await agent.run()
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'allow-once' } })
})

test('a one-shot approval never widens into allow_always when allow_once is absent', async () => {
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: 'always-only' }, { kimiCode: true }, { permission: 'allow' })
  const { requests } = await agent.run()
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'reject-once' } })
})

test('full-access keeps the persistent grant when allow_always is offered', async () => {
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, { permission: 'subagent', subagentPermissionMode: 'full-access' })
  const { requests } = await agent.run()
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'allow-always' } })
})

test('sub-agent auto accepts the agent-gated ask once', async () => {
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, { permission: 'subagent', subagentPermissionMode: 'auto' })
  const { requests } = await agent.run()
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'allow-once' } })
})

test('a decision arriving after the run was aborted is discarded', async () => {
  const controller = new AbortController()
  const asker = createPermissionAsker({
    ctx: { get: (name) => name === 'approval' ? {
      async request() {
        controller.abort()
        return 'allowed-once'
      },
    } : undefined },
    parent: { id: 'parent-1' },
    policy: 'main-session',
    subagentMode: 'auto',
    backend: 'acp',
    agentLabel: 'Kimi',
    language: 'en',
    signal: controller.signal,
  })
  const decision = await asker({ kindLabel: 'command', title: 'rm -rf build' })
  // The approval chain answered after the run aborted; the late grant must
  // never leak through as an allow.
  assert.deepEqual(decision, { outcome: 'deny', scope: 'once', source: 'cancelled' })
})

test('a throwing asker still answers the child fail-closed', async () => {
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, {
    permission: 'main-session',
    parent: { id: 'parent-1' },
    approval: { async request() { throw new Error('boom') } },
    userQuestions: { async ask() { throw new Error('also boom') } },
  })
  const { requests } = await agent.run()
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'reject-once' } })
})

test('main-session policy routes through the session approval chain', async () => {
  const approvalRequests = []
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, {
    permission: 'main-session',
    parent: { id: 'parent-1' },
    approval: {
      async request(req) {
        approvalRequests.push(req)
        return 'allowed-once'
      },
    },
  })
  const { requests } = await agent.run()
  assert.equal(approvalRequests.length, 1)
  assert.equal(approvalRequests[0].agent.id, 'parent-1')
  assert.match(approvalRequests[0].reason, /Run project tests/)
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'allow-once' } })
})

test('kimi-style write ask names the target file in the approval reason', async () => {
  const approvalRequests = []
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1', ACP_PERMISSION_SHAPE: 'kimi-write' }, { kimiCode: true }, {
    permission: 'main-session',
    parent: { id: 'parent-1' },
    approval: {
      async request(req) {
        approvalRequests.push(req)
        return 'allowed-once'
      },
    },
  })
  await agent.run()
  assert.equal(approvalRequests.length, 1)
  assert.match(approvalRequests[0].reason, /Sub-agent permission request \(write\)/)
  assert.match(approvalRequests[0].reason, /Write/)
  assert.match(approvalRequests[0].reason, /Writing \/tmp\/probe\/hello\.txt/)
})

test('kimi-style command ask carries the command line in the approval reason', async () => {
  const approvalRequests = []
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1', ACP_PERMISSION_SHAPE: 'kimi-command' }, { kimiCode: true }, {
    permission: 'main-session',
    parent: { id: 'parent-1' },
    approval: {
      async request(req) {
        approvalRequests.push(req)
        return 'allowed-once'
      },
    },
  })
  await agent.run()
  assert.equal(approvalRequests.length, 1)
  assert.match(approvalRequests[0].reason, /Sub-agent permission request \(command\)/)
  assert.match(approvalRequests[0].reason, /Running: echo probe-ok/)
})

test('agy-style write ask carries path and content preview in the approval reason', async () => {
  const approvalRequests = []
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1', ACP_PERMISSION_SHAPE: 'agy-write' }, { kimiCode: true }, {
    permission: 'main-session',
    parent: { id: 'parent-1' },
    approval: {
      async request(req) {
        approvalRequests.push(req)
        return 'allowed-once'
      },
    },
  })
  await agent.run()
  assert.equal(approvalRequests.length, 1)
  assert.match(approvalRequests[0].reason, /Sub-agent permission request \(edit\)/)
  assert.match(approvalRequests[0].reason, /path: \/tmp\/probe\/hello\.txt/)
  assert.match(approvalRequests[0].reason, /content: hello from probe/)
})

test('agy-style command ask carries the command line in the approval reason', async () => {
  const approvalRequests = []
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1', ACP_PERMISSION_SHAPE: 'agy-command' }, { kimiCode: true }, {
    permission: 'main-session',
    parent: { id: 'parent-1' },
    approval: {
      async request(req) {
        approvalRequests.push(req)
        return 'allowed-once'
      },
    },
  })
  await agent.run()
  assert.equal(approvalRequests.length, 1)
  assert.match(approvalRequests[0].reason, /Sub-agent permission request \(execute\)/)
  assert.match(approvalRequests[0].reason, /command: echo probe-ok/)
})

test('a Chinese task renders the permission heading with a Chinese kind label', async () => {
  const approvalRequests = []
  const asker = createPermissionAsker({
    ctx: { get: (name) => name === 'approval' ? {
      async request(request) {
        approvalRequests.push(request)
        return 'allowed-once'
      },
    } : undefined },
    parent: { id: 'parent-1' },
    policy: 'main-session',
    subagentMode: 'auto',
    backend: 'acp',
    agentLabel: 'Kimi',
    language: 'zh-CN',
    signal: new AbortController().signal,
  })
  const decision = await asker({ kindLabel: 'write', title: 'Write', detail: 'path: /tmp/probe/hello.txt' })
  assert.deepEqual(decision, { outcome: 'allow', scope: 'once', source: 'main-session' })
  assert.match(approvalRequests[0].reason, /子代理权限请求（写入文件）/)
  assert.match(approvalRequests[0].reason, /path: \/tmp\/probe\/hello\.txt/)
  await asker({ kindLabel: 'execute', title: 'echo probe-ok', detail: 'command: echo probe-ok' })
  assert.match(approvalRequests[1].reason, /子代理权限请求（执行命令）/)
})

test('main-session full preset auto-approves ACP requests without calling the native chain', async () => {
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, {
    permission: 'main-session',
    parent: { id: 'parent-1', session: { id: 'session-1' } },
    permissionPresets: {
      current: () => 'full',
      resolve: () => ({ approval: 'never', sandbox: 'danger-full-access' }),
    },
    approval: { async request() { throw new Error('must not be called') } },
    userQuestions: { async ask() { throw new Error('must not be called') } },
  })
  const { requests } = await agent.run()
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'allow-always' } })
})

test('main-session rejection denies the ask without falling through to a card', async () => {
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, {
    permission: 'main-session',
    parent: { id: 'parent-1' },
    approval: { async request() { return 'rejected' } },
    userQuestions: { async ask() { throw new Error('must not be called') } },
  })
  const { requests } = await agent.run()
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'reject-once' } })
})

test('a closed parent turn falls back to the interactive human card', async () => {
  const questions = []
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, {
    permission: 'main-session',
    parent: { id: 'parent-1' },
    approval: { async request() { throw new Error('approval.request() outside an open turn') } },
    userQuestions: {
      async ask(request) {
        questions.push(request)
        const labels = request.questions[0].options.map((option) => option.label)
        return { answers: [{ id: request.questions[0].id, selected: [labels.at(-1)] }] }
      },
    },
  })
  const { requests } = await agent.run()
  assert.equal(questions.length, 1)
  assert.equal(questions[0].questions[0].intent.kind, 'approval')
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'reject-once' } })
})

test('human policy answers map onto allow_always when offered', async () => {
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, {
    permission: 'human',
    parent: { id: 'parent-1' },
    userQuestions: {
      async ask(request) {
        const question = request.questions[0]
        return { answers: [{ id: question.id, selected: [question.intent.always] }] }
      },
    },
  })
  const { requests } = await agent.run()
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'allow-always' } })
})

test('missing interactive services deny asks fail-closed', async () => {
  const agent = harness(undefined, undefined, { ACP_ASK_PERMISSION: '1' }, { kimiCode: true }, {
    permission: 'human',
  })
  const { requests } = await agent.run()
  assert.deepEqual(permissionEntry(requests), { outcome: { outcome: 'selected', optionId: 'reject-once' } })
})
