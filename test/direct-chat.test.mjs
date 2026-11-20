import test from 'node:test'
import assert from 'node:assert/strict'
import { MultiAgentTasks, currentTaskTrace, runWithTaskTrace } from '../task-monitor.js'
import { registerDirectChat } from '../lib/direct-chat.js'

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function harness() {
  const state = { starts: [], traces: [], events: [], sent: [], cleanups: [], listeners: new Map(), commands: new Map(), children: new Map() }
  const session = {
    id: 'parent', header: { origin: 'user' }, requestHeader: () => undefined,
    append(type, data, intent) {
      const event = { type, data, intent, seq: state.events.length }
      state.events.push(event)
      return event
    },
  }
  const agent = { id: 'parent', session, options: {}, followup() { state.followups = (state.followups || 0) + 1 } }
  const ctx = {
    agents: {
      get: (id) => id === 'parent' ? agent : state.children.get(id),
      list: () => [agent, ...state.children.values()],
      turnBoundaryOf: () => ({ lastTurn: 0 }),
    },
    subagents: {
      rootOf: () => agent,
      namesOf() {}, resolveName() {}, resolveMaxDepth: () => 1,
      getProvider: (name) => ({ name }),
      async startActivation(spec) {
        state.starts.push(spec)
        state.traces.push(currentTaskTrace())
        const result = deferred()
        const activation = { childId: `child-${state.starts.length}`, result: result.promise, dispose: async () => {}, resultDeferred: result }
        state.activations ??= []
        state.activations.push(activation)
        return activation
      },
      async sendMessage(sender, targetId, content) {
        state.sent.push({ sender, targetId, content })
        return 'message-1'
      },
      interrupt() {},
    },
    commands: {
      register(definition) {
        state.commands.set(definition.name, definition)
        return () => state.commands.delete(definition.name)
      },
    },
    workingDirectory: { get: () => '/workspace' },
    webServer: { getOrigin: () => 'http://localhost', register() { return () => {} } },
    connection: { requestRejection: () => undefined },
    reflect: { provide() {} },
    on(event, listener) {
      const listeners = state.listeners.get(event) ?? new Set()
      listeners.add(listener)
      state.listeners.set(event, listeners)
      return () => listeners.delete(listener)
    },
    effect(callback) { const cleanup = callback(); if (typeof cleanup === 'function') state.cleanups.push(cleanup); return cleanup },
    logger: { warn() {} },
  }
  const tasks = new MultiAgentTasks(ctx)
  const settings = {
    timeoutSeconds: 30,
    codex: { enabled: true, providerName: 'codex-router', label: 'Codex' },
    kimiCode: { enabled: true, providerName: 'kimi-code', label: 'Kimi Code' },
    agy: { enabled: true, providerName: 'agy', label: 'Antigravity' },
    dsh: { enabled: true, providerName: 'spawn', label: 'DSH' },
  }
  const send = registerDirectChat(ctx, { tasks, getSettings: () => settings, resolveDshModel: async (_args, current) => {
    const dsh = current.dsh
    if (!dsh.defaultProvider && !dsh.defaultModel && !dsh.defaultReasoningEffort) return undefined
    return {
      provider: dsh.defaultProvider ?? 'parent-provider', model: dsh.defaultModel ?? 'parent-model',
      ...(dsh.defaultReasoningEffort ? { reasoningEffort: dsh.defaultReasoningEffort } : {}),
    }
  } })
  return { state, ctx, tasks, agent, send, settings }
}

test('direct chat sends raw text with caller delivery and mirrors complete public messages once', async () => {
  const { state, tasks, agent, send } = harness()
  const receipt = await send(agent, { agent: 'codex', message: '  请直接回答  ' })
  assert.equal(receipt.accepted, true)
  assert.equal(receipt.agent, 'codex')
  assert.equal(receipt.continued, false)
  assert.equal(state.starts[0].provider, 'codex-router')
  assert.equal(state.starts[0].delivery, 'caller')
  assert.deepEqual(state.starts[0].prompt, [{ type: 'text', text: '请直接回答' }])
  assert.equal(state.starts[0].reportPath, undefined)
  assert.equal(state.followups, undefined)
  assert.equal(state.events[0].type, 'command/run')
  assert.equal(state.events[0].data.name, 'agent-codex')
  assert.equal(state.events[0].data.args, '请直接回答')
  assert.ok(state.events[0].data.commandId.startsWith('ma-direct-user-'))
  assert.equal(state.events[1].type, 'command/done')
  assert.equal(state.events.filter((event) => event.type === 'user/message' || event.type === 'assistant/message').length, 0)

  const trace = state.traces[0]
  runWithTaskTrace(trace, () => {
    tasks.observeACP({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: '你好' } })
    tasks.observeACP({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: '，世界' } })
    assert.equal(state.events.filter((event) => event.type === 'command/run' && String(event.data.commandId).startsWith('ma-direct-msg-')).length, 0)
    tasks.observeACP({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read', status: 'completed' })
  })
  const mirrorRuns = state.events.filter((event) => event.type === 'command/run' && String(event.data.commandId).startsWith('ma-direct-msg-'))
  const mirrorDones = state.events.filter((event) => event.type === 'command/done' && String(event.data.commandId).startsWith('ma-direct-msg-'))
  assert.equal(mirrorRuns.length, 1)
  assert.equal(mirrorRuns[0].data.name, 'agent-codex')
  assert.equal(mirrorRuns[0].data.source.kind, 'user')
  assert.equal(mirrorDones.length, 1)
  assert.equal(mirrorDones[0].data.kind, 'success')
  assert.equal(mirrorDones[0].data.text, '你好，世界')
  assert.equal(mirrorDones[0].data.commandId, mirrorRuns[0].data.commandId)
  state.activations[0].resultDeferred.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '你好，世界' }] })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(state.events.filter((event) => event.type === 'command/done' && String(event.data.commandId).startsWith('ma-direct-msg-')).length, 1, 'final output must not duplicate the mirrored message')
  assert.equal(tasks.detail('parent', receipt.childId).direct, true)
  assert.equal(tasks.detail('parent', receipt.childId).status, 'completed')
})

test('direct chat resumes the same external session and rejects overlapping direct sends', async () => {
  const { state, tasks, agent, send } = harness()
  const first = await send(agent, { agent: 'codex', message: 'first' })
  await assert.rejects(send(agent, { agent: 'kimi-code', message: 'parallel' }), /wait for the current direct Agent response/)
  assert.equal(state.starts.length, 1)
  const record = tasks.getRecord('parent', first.childId)
  record.continuation = { agent: 'codex', sessionId: 'native-codex-thread' }
  state.activations[0].resultDeferred.resolve({ stopReason: 'completed', output: [] })
  await new Promise((resolve) => setImmediate(resolve))

  const second = await send(agent, { agent: 'codex', message: 'second' })
  assert.equal(second.continued, true)
  assert.equal(second.childId, first.childId)
  assert.equal(second.subagentId, 'child-2')
  assert.equal(state.starts.length, 2)
  assert.equal(state.starts[1].provider, 'codex-router')
  assert.deepEqual(state.starts[1].prompt, [{ type: 'text', text: 'second' }])
  assert.equal(state.traces[1].resume.sessionId, 'native-codex-thread')
  assert.equal(record.continuationCount, 1)
  assert.equal(state.events.filter((event) => event.type === 'command/run' && String(event.data.commandId).startsWith('ma-direct-user-')).length, 2)
  state.activations[1].resultDeferred.resolve({ stopReason: 'completed', output: [] })
  await new Promise((resolve) => setImmediate(resolve))
})

test('direct DSH follow-up uses native messaging instead of creating a new child', async () => {
  const { state, agent, send } = harness()
  const first = await send(agent, { agent: 'dsh', message: 'native first' })
  assert.equal(state.starts[0].maxDepth, 1)
  state.activations[0].resultDeferred.resolve({ stopReason: 'completed', output: [] })
  await new Promise((resolve) => setImmediate(resolve))
  const second = await send(agent, { agent: 'dsh', message: 'native second' })
  assert.equal(second.continued, true)
  assert.equal(second.childId, first.childId)
  assert.equal(state.starts.length, 1)
  assert.equal(state.sent.length, 1)
  assert.equal(state.sent[0].targetId, first.childId)
  assert.deepEqual(state.sent[0].content, [{ type: 'text', text: 'native second' }])
})

test('direct status covers unbound admission and root pre-step waits for direct settlement', async () => {
  const { state, tasks, agent, send } = harness()
  const receipt = await send(agent, { agent: 'codex', message: 'serialize me' })
  assert.equal(tasks.directStatus('parent').active, true)
  let entered = false
  const listener = [...state.listeners.get('agent/pre-step')][0]
  const waiting = listener({ agent, signal: new AbortController().signal }, async () => { entered = true })
  assert.equal(entered, false)
  state.activations[0].resultDeferred.resolve({ stopReason: 'completed', output: [] })
  await new Promise((resolve) => setImmediate(resolve))
  await waiting
  assert.equal(entered, true)
  assert.equal(tasks.directStatus('parent').active, false)
  assert.equal(receipt.childId, 'child-1')
})

test('direct startup has a bounded admission deadline and main-running calls fail before startup', async () => {
  const { state, ctx, agent, send, settings } = harness()
  agent.status = 'running'
  await assert.rejects(send(agent, { agent: 'codex', message: 'busy' }), /wait for the main Agent turn/)
  assert.equal(state.starts.length, 0)
  agent.status = 'idle'
  settings.timeoutSeconds = 1
  ctx.subagents.startActivation = (spec) => {
    state.starts.push(spec)
    return new Promise((_resolve, reject) => {
      spec.signal.addEventListener('abort', () => reject(spec.signal.reason), { once: true })
    })
  }
  const started = Date.now()
  await assert.rejects(send(agent, { agent: 'codex', message: 'never admits' }), /startup timed out/)
  assert.ok(Date.now() - started >= 900 && Date.now() - started < 3000)
  assert.equal(state.events.length, 0)
})

test('accepted child survives mirror failure and returns an explicit warning', async () => {
  const { state, agent, send } = harness()
  agent.session.append = () => { throw new Error('surface unavailable') }
  const receipt = await send(agent, { agent: 'codex', message: 'accepted but not mirrored' })
  assert.equal(receipt.accepted, true)
  assert.equal(receipt.mirrored, false)
  assert.match(receipt.warning, /conversation mirror failed/)
  assert.equal(state.activations.length, 1)
  state.activations[0].resultDeferred.resolve({ stopReason: 'completed', output: [] })
  await new Promise((resolve) => setImmediate(resolve))
})

test('direct DSH startup and continuation apply selected model and sandbox options', async () => {
  const { state, tasks, agent, send, settings } = harness()
  settings.dsh.defaultProvider = 'provider-a'
  settings.dsh.defaultModel = 'model-a'
  settings.dsh.defaultReasoningEffort = 'high'
  settings.dsh.directSandboxMode = 'read-only'
  const first = await send(agent, { agent: 'dsh', message: 'native options' })
  assert.deepEqual(state.starts[0].agentOptions, { provider: 'provider-a', model: 'model-a', reasoningEffort: 'high' })
  const childEvents = []
  let sandboxMode = 'workspace-write'
  const child = {
    id: first.childId,
    session: { id: first.childId, header: { origin: 'subagent', parentSession: 'parent' }, append(type, data) { childEvents.push({ type, data }); if (type === 'sandbox/mode') sandboxMode = data.mode } },
    ctx: { get: (name) => name === 'sandboxPolicy' ? { resolve: () => ({ mode: sandboxMode }) } : undefined },
    model: {
      select(selection) { (state.modelSelections ??= []).push(selection); state.childModel = selection },
      current: () => state.childModel,
    },
  }
  state.children.set(first.childId, child)
  ;[...state.listeners.get('agent/created')][0]({ agent: child })
  assert.deepEqual(state.modelSelections[0], { provider: 'provider-a', model: 'model-a', reasoningEffort: 'high' })
  assert.equal(childEvents[0].data.mode, 'read-only')
  state.activations[0].resultDeferred.resolve({ stopReason: 'completed', output: [] })
  await new Promise((resolve) => setImmediate(resolve))

  settings.dsh.defaultModel = 'model-b'
  settings.dsh.defaultReasoningEffort = 'max'
  settings.dsh.directSandboxMode = 'danger-full-access'
  await send(agent, { agent: 'dsh', message: 'apply updated options' })
  assert.equal(state.modelSelections.at(-1).model, 'model-b')
  assert.equal(state.modelSelections.at(-1).reasoningEffort, 'max')
  assert.equal(childEvents.at(-1).data.mode, 'danger-full-access')
  assert.equal(state.sent.length, 1)
  tasks.settle(tasks.getRecord('parent', first.childId).trace, { stopReason: 'completed', output: [] })
})

test('direct DSH inheritance uses the current pending main model and failed restrictions reject creation', async () => {
  const { state, agent, send, settings } = harness()
  agent.session.requestHeader = () => ({ config: { provider: 'old-provider', model: 'old-model', reasoningEffort: 'high' } })
  agent.model = { current: () => ({ provider: 'current-provider', model: 'current-model', reasoningEffort: 'low' }) }
  await send(agent, { agent: 'dsh', message: 'inherit current' })
  assert.deepEqual(state.starts[0].agentOptions, { provider: 'current-provider', model: 'current-model', reasoningEffort: 'low' })
  state.activations[0].resultDeferred.resolve({ stopReason: 'completed', output: [] })
  await new Promise((resolve) => setImmediate(resolve))

  settings.dsh.directSandboxMode = 'read-only'
  const second = await send(agent, { agent: 'dsh', message: 'must not run with old access' })
  const child = {
    id: second.childId,
    session: { id: second.childId, header: { origin: 'subagent', parentSession: 'parent' }, append() {} },
    ctx: { get: () => ({ resolve: () => ({ mode: 'danger-full-access' }) }) },
    model: { select() {}, current: () => agent.model.current() },
  }
  const listener = [...state.listeners.get('agent/created')][0]
  assert.throws(() => listener({ agent: child }), /sandbox could not be verified/)
})

test('native composer commands forward text and attachment blocks without a model turn', async () => {
  const { state, agent } = harness()
  assert.deepEqual([...state.commands.keys()].sort(), ['agent-agy', 'agent-codex', 'agent-dsh', 'agent-kimi'])
  const command = state.commands.get('agent-kimi')
  assert.equal(command.recordInput, true)
  assert.equal(command.input.attachments, true)
  const file = { type: 'file', attachment: { attachmentId: 'file-1', name: 'notes.txt', bytes: 4 } }
  const result = await command.handler({
    commandId: 'command-1', agent, rawInput: '  hello native  ', attachments: [file], signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'success')
  assert.equal(result.sourceEventSeq, undefined)
  assert.equal(state.starts[0].provider, 'kimi-code')
  assert.deepEqual(state.starts[0].prompt, [{ type: 'text', text: 'hello native' }, file])
  assert.equal(state.events.filter((event) => event.type === 'command/run' && String(event.data.commandId).startsWith('ma-direct-user-')).length, 0, 'composer sends reuse the native command/run anchor')
  assert.equal(state.events.filter((event) => event.type === 'user/message').length, 0)
  assert.equal(state.followups, undefined)
  state.activations[0].resultDeferred.resolve({ stopReason: 'completed', output: [] })
  await new Promise((resolve) => setImmediate(resolve))
})

test('direct chat validates enabled agents and never wakes the parent model on startup failure', async () => {
  const { state, agent, send } = harness()
  await assert.rejects(send(agent, { agent: 'missing', message: 'test' }), /not enabled/)
  await assert.rejects(send(agent, { agent: 'codex', message: ' ' }), /message or attachment is required/)
  assert.equal(state.starts.length, 0)
  assert.equal(state.events.length, 0)
  assert.equal(state.followups, undefined)
})
