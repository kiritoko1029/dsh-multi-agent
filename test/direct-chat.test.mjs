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
  const state = { starts: [], traces: [], events: [], sent: [], cleanups: [], listeners: new Map(), commands: new Map() }
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
      get: (id) => id === 'parent' ? agent : undefined,
      list: () => [agent],
      turnBoundaryOf: () => ({ lastTurn: 0 }),
    },
    subagents: {
      rootOf: (candidate) => candidate,
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
  const send = registerDirectChat(ctx, { tasks, getSettings: () => settings, resolveDshModel: async () => undefined })
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
  assert.equal(state.events[0].type, 'user/message')
  assert.equal(state.events[0].data.content[0].text, '请直接回答')

  const trace = state.traces[0]
  runWithTaskTrace(trace, () => {
    tasks.observeACP({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: '你好' } })
    tasks.observeACP({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: '，世界' } })
    assert.equal(state.events.filter((event) => event.type === 'assistant/message').length, 0)
    tasks.observeACP({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read', status: 'completed' })
  })
  assert.equal(state.events.filter((event) => event.type === 'assistant/message').length, 1)
  assert.equal(state.events.at(-1).data.message.content[0].text, '你好，世界')
  assert.equal(state.events.at(-1).data.turn, 1_000_000_000)
  state.activations[0].resultDeferred.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '你好，世界' }] })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(state.events.filter((event) => event.type === 'assistant/message').length, 1, 'final output must not duplicate the mirrored message')
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
  assert.equal(state.events.filter((event) => event.type === 'user/message').length, 2)
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

test('native composer commands forward text and attachment blocks without a model turn', async () => {
  const { state, agent } = harness()
  assert.deepEqual([...state.commands.keys()].sort(), ['agent-agy', 'agent-codex', 'agent-dsh', 'agent-kimi'])
  const command = state.commands.get('agent-kimi')
  assert.equal(command.recordInput, false)
  assert.equal(command.input.attachments, true)
  const file = { type: 'file', attachment: { attachmentId: 'file-1', name: 'notes.txt', bytes: 4 } }
  const result = await command.handler({
    commandId: 'command-1', agent, rawInput: '  hello native  ', attachments: [file], signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'success')
  assert.equal(result.sourceEventSeq, 0)
  assert.equal(state.starts[0].provider, 'kimi-code')
  assert.deepEqual(state.starts[0].prompt, [{ type: 'text', text: 'hello native' }, file])
  assert.deepEqual(state.events[0].data.content, [{ type: 'text', text: 'hello native' }, file])
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
