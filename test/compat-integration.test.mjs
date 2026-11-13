import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { apply } from '../index.js'
import { MultiAgentTasks } from '../task-monitor.js'

// Full plugin wiring with strict rc.1/rc.2 service shapes. No real Host or LLM.
function harness(modern, timeoutSeconds = 10) {
  const listeners = new Map()
  const definitions = new Map()
  const effects = []
  const runs = []
  const starts = []
  const root = { id: 'parent', session: { id: 'parent', header: {}, requestHeader: () => undefined }, options: { provider: 'test', model: 'test' } }
  const emit = (name, ...args) => { for (const listener of listeners.get(name) ?? []) listener(...args) }
  let interrupts = 0
  const provider = { name: 'spawn' }
  const ctx = {
    agents: { get: (id) => id === root.id ? root : undefined, list: () => [root], ...modern ? {} : { roots: () => [root] } },
    subagents: {
      ...modern ? { rootOf: (agent) => agent, namesOf() {}, resolveName() {} } : {},
      resolveMaxDepth: () => 1,
      getProvider: () => provider,
      async startActivation(spec) {
        starts.push(spec)
        const request = modern ? spec : spec.request
        assert.equal(request.parent, root)
        assert.equal(Object.hasOwn(spec, 'request'), !modern)
        const deferred = Promise.withResolvers()
        const activation = { childId: 'child', result: deferred.promise, dispose: async () => { interrupts++ } }
        runs.push(deferred)
        if (modern) emit('subagent/start', { id: 'child', parentSessionId: 'parent', runId: `epoch-${runs.length}`, local: true, provider: 'spawn' })
        return activation
      },
      async sendMessage(sender, target, content, options) {
        assert.equal(sender, root)
        assert.equal(target, 'child')
        assert.ok(content[0].text.includes('Follow up'))
        options.signal.throwIfAborted()
        runs.push(Promise.withResolvers())
        if (modern) emit('subagent/start', { id: 'child', parentSessionId: 'parent', runId: `epoch-${runs.length}`, local: true, provider: 'spawn' })
        return `message-${runs.length}`
      },
      interrupt() { interrupts++ },
    },
    workingDirectory: { get: () => '/workspace' },
    tools: { register(definition, options) { definitions.set(definition.name, { definition, options }); return () => definitions.delete(definition.name) }, get(name) { return definitions.get(name)?.definition } },
    systemPrompt: { getSectionOrder: () => 1, section: () => () => {} },
    sessionProjections: { register: async () => ({ stateOf: () => ({ sample: '' }) }) },
    llm: { resolveCallConfig: async (config) => config },
    userQuestions: { ask: async () => { throw new Error('Unexpected question') } },
    webServer: { register: () => () => {} },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    reflect: { provide(name, value) { ctx[name] = value } },
    get(name) { return ctx[name] },
    on(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); return () => listeners.get(name).delete(listener) },
    effect(callback) { const dispose = callback(); if (typeof dispose === 'function') effects.push(dispose); return dispose },
    logger: { warn() {} },
  }
  const tasks = new MultiAgentTasks(ctx)
  apply(ctx, {
    selectionMode: 'auto', timeoutSeconds, routes: [],
    dsh: { enabled: true, providerName: 'spawn', label: 'DSH', description: 'Native' },
    codex: { enabled: false }, kimiCode: { enabled: false }, agy: { enabled: false },
  })
  const exec = { agent: root, signal: new AbortController().signal, callId: 'call' }
  let seq = 0
  const sessionEvent = (type, data) => emit('session/event', { id: 'child' }, { type, data, seq: ++seq, time: Date.now() })
  const finish = (reason = 'completed') => {
    if (modern) emit('subagent/end', { id: 'child', parentSessionId: 'parent', runId: `epoch-${runs.length}`, local: true, provider: 'spawn', stopReason: reason, lastAssistantMessage: [{ type: 'text', text: 'Done' }] })
    runs.at(-1)?.resolve({ stopReason: reason, output: [{ type: 'text', text: 'Done' }] })
  }
  return {
    ctx, tasks, starts, sessionEvent, finish, emit,
    get interrupts() { return interrupts },
    record: () => tasks.getRecord('parent', 'child'),
    async dispatch() { return definitions.get('dispatch_agent').definition.execute({ agent: 'dsh', description: 'Compatibility', task: 'Read only fixture', expected_output: 'Fixture result', language: 'en' }, exec) },
    async continue() { return definitions.get('continue_agent').definition.execute({ childId: 'child', message: 'Follow up', language: 'en' }, exec) },
    async close() {
      for (const run of runs) run.resolve({ stopReason: 'aborted', output: [] })
      await delay(0)
      for (const dispose of effects.reverse()) await dispose()
    },
  }
}

for (const modern of [false, true]) {
  test(`${modern ? 'rc.2' : 'rc.1'} router + monitor + native continuation preserve identity and settlement`, async () => {
    const h = harness(modern)
    try {
      const receipt = await h.dispatch()
      assert.equal(receipt.subagentId, 'child')
      h.sessionEvent('turn/start', { turn: 1 })
      h.sessionEvent('turn/end', { turn: 1, reason: { kind: 'completed' } })
      assert.equal(h.record().status, modern ? 'running' : 'completed')
      h.finish()
      await delay(0)
      assert.equal(h.record().status, 'completed')
      const continued = await h.continue()
      assert.equal(continued.childId, 'child')
      assert.equal(continued.reusedSession, true)
      h.sessionEvent('turn/start', { turn: 2 })
      h.sessionEvent('turn/end', { turn: 2, reason: { kind: 'completed' } })
      assert.equal(h.record().status, modern ? 'running' : 'completed')
      h.finish()
      await delay(0)
      assert.equal(h.record().status, 'completed')
      assert.equal(h.record().continuationCount, 1)
      assert.equal(h.starts.length, 1, 'native continuation must not create another activation via dispatch')
    } finally { await h.close() }
  })
}

test('rc.2 native continuation timeout remains bounded without a result promise or an end event', async () => {
  const h = harness(true, 0.025)
  try {
    await h.dispatch()
    h.finish()
    await delay(0)
    await h.continue()
    h.sessionEvent('turn/start', { turn: 2 })
    h.sessionEvent('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await delay(60)
    assert.equal(h.interrupts, 1, 'the deadline must request cancellation exactly once')
    assert.equal(h.record().nativeAwaitingEnd, true)
    assert.equal(h.record().status, 'error', 'unconfirmed timeout must not stay running or claim successful cancellation')
    assert.throws(() => h.tasks.beginContinuation('parent', 'child'), /not been confirmed/)
    h.finish('aborted')
    assert.equal(h.record().status, 'aborted')
    assert.equal(h.record().nativeAwaitingEnd, false)
  } finally { await h.close() }
})

for (const earlyEnd of [false, true]) {
  test(`rc.2 native admission rejection after start${earlyEnd ? ' and end' : ''} restores prior state and invalidates late events`, async () => {
    const h = harness(true)
    try {
      await h.dispatch()
      h.finish()
      await delay(0)
      const original = h.ctx.subagents.sendMessage
      h.ctx.subagents.sendMessage = async (...args) => {
        await original(...args)
        if (earlyEnd) h.finish('aborted')
        assert.equal(h.tasks.detail('parent', 'child').canContinue, false)
        assert.throws(() => h.tasks.beginContinuation('parent', 'child'), /admission/)
        throw new Error('Native admission rejected after materialization')
      }
      await assert.rejects(h.continue(), /failed to resume/)
      assert.equal(h.record().status, 'completed')
      assert.equal(h.record().output, 'Done')
      assert.equal(h.record().continuationCount, 0)
      assert.equal(h.tasks.detail('parent', 'child').canContinue, true)
      h.ctx.subagents.sendMessage = original
      await h.continue()
      h.emit('subagent/end', { id: 'child', parentSessionId: 'parent', runId: 'epoch-2', local: true, stopReason: 'error' })
      assert.equal(h.record().status, 'running', 'rejected attempt cannot overwrite the next accepted run')
      h.finish()
      assert.equal(h.record().status, 'completed')
      assert.equal(h.record().continuationCount, 1)
    } finally { await h.close() }
  })
}

test('rc.2 early epoch end cannot disarm the pending admission startup deadline', async () => {
  const h = harness(true, 0.015)
  try {
    await h.dispatch()
    h.finish()
    await delay(0)
    const original = h.ctx.subagents.sendMessage
    h.ctx.subagents.sendMessage = async (...args) => {
      await original(...args)
      h.finish('aborted')
      const signal = args[3].signal
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    }
    const keepingTestAlive = delay(40)
    await assert.rejects(h.continue(), /startup timed out|continuation timed out/)
    assert.equal(h.record().status, 'completed')
    assert.equal(h.record().continuationCount, 0)
    assert.equal(h.tasks.detail('parent', 'child').canContinue, true)
    await keepingTestAlive
  } finally { await h.close() }
})

test('rc.2 rejected native continuation restores the previous terminal task on startup timeout', async () => {
  const h = harness(true, 0.015)
  try {
    await h.dispatch()
    h.finish()
    await delay(0)
    h.ctx.subagents.sendMessage = (_sender, _target, _content, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const keepingTestAlive = delay(40)
    await assert.rejects(h.continue(), /startup timed out|continuation timed out/)
    assert.equal(h.record().status, 'completed')
    assert.equal(h.record().continuationCount, 0)
    assert.notEqual(h.record().nativeAwaitingEnd, true)
    assert.equal(h.interrupts, 0)
    await keepingTestAlive
  } finally { await h.close() }
})

for (const continuation of [false, true]) {
  test(`rc.2 ${continuation ? 'continuation' : 'dispatch'} publication-gap timeout keeps acceptance and cancels exactly once`, async () => {
    const h = harness(true, 0.015)
    try {
      if (continuation) {
        await h.dispatch()
        h.finish()
        await delay(0)
      }
      const method = continuation ? 'sendMessage' : 'startActivation'
      const original = h.ctx.subagents[method]
      h.ctx.subagents[method] = async (...args) => {
        const receipt = await original(...args)
        await delay(35)
        return receipt
      }
      const receipt = await (continuation ? h.continue() : h.dispatch())
      assert.equal(receipt.subagentId, 'child')
      await delay(15)
      assert.equal(h.interrupts, 1)
      assert.equal(h.record().nativeAwaitingEnd, true)
      h.finish('aborted')
      await delay(0)
      assert.equal(h.record().status, 'aborted')
    } finally { await h.close() }
  })
}

test('rc.2 first activation timeout cannot leave a stuck task looking active forever', async () => {
  const h = harness(true, 0.025)
  try {
    await h.dispatch()
    await delay(60)
    assert.equal(h.interrupts, 1)
    assert.equal(h.record().nativeAwaitingEnd, true)
    assert.equal(h.record().status, 'error')
    h.finish('aborted')
    await delay(0)
    assert.equal(h.record().status, 'aborted')
  } finally { await h.close() }
})
