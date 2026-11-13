import test from 'node:test'
import assert from 'node:assert/strict'
import { MultiAgentTasks, runWithTaskTrace } from '../task-monitor.js'
import { acpConfigTelemetry, acpUsage, addUsage, codexUsage, mergeTelemetry } from '../lib/task-telemetry.js'

function harness(saved = new Map()) {
  const state = {}
  const ctx = {
    agents: { roots: () => [] },
    reflect: { provide() {} },
    webServer: { register: () => () => {} },
    storageDomain: { open: async () => ({
      table: () => ({
        entries: () => saved.entries(),
        put: async (key, value) => saved.set(key, structuredClone(value)),
        delete: async (key) => saved.delete(key),
      }),
      close: async () => {},
    }) },
    on(_name, callback) { state.event = callback },
    effect: (callback) => callback(),
    logger: { warn() {} },
  }
  const tasks = new MultiAgentTasks(ctx)
  return { tasks, state, saved }
}

function nativeMessage(seq, inputTokens, outputTokens, extra = {}) {
  return { seq, type: 'assistant/message', data: {
    message: { source: { kind: 'model', provider: 'native', model: 'dsh-model' }, content: [] },
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cacheReadTokens: 2, reasoningTokens: 1, ...extra },
  } }
}

test('DSH buffers only pre-bind telemetry, replays by seq, accumulates calls and survives reload', async () => {
  const { tasks, state, saved } = harness()
  await tasks.ready
  const trace = tasks.begin({ parentSessionId: 'parent', agent: 'dsh', label: 'task', cwd: '/workspace' })
  state.event({ id: 'child' }, { seq: 1, type: 'request/header', data: { header: { config: { model: 'header-model', reasoningEffort: 'high' } } } })
  state.event({ id: 'child' }, nativeMessage(2, 10, 3))
  state.event({ id: 'other-child' }, nativeMessage(1, 999, 999))
  assert.equal(trace.record.telemetry, undefined)
  tasks.bind(trace, 'child')
  assert.deepEqual(trace.record.telemetry, {
    model: 'dsh-model', modelSource: 'reported', reasoningEffort: 'high', reasoningEffortSource: 'reported',
    usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13, cacheReadTokens: 2, reasoningTokens: 1 }, usageScope: 'task',
  })
  state.event({ id: 'child' }, nativeMessage(2, 10, 3))
  state.event({ id: 'child' }, nativeMessage(3, 5, 2, { cacheReadTokens: 1, reasoningTokens: 0 }))
  assert.deepEqual(trace.record.telemetry.usage, { inputTokens: 15, outputTokens: 5, totalTokens: 20, cacheReadTokens: 3, reasoningTokens: 1 })
  tasks.settle(trace, { stopReason: 'completed' })
  await tasks.pendingWrites
  assert.equal([...saved.values()][0].nativeSeq, 3)
  assert.deepEqual([...saved.values()][0].telemetry.usage, { inputTokens: 15, outputTokens: 5, totalTokens: 20, cacheReadTokens: 3, reasoningTokens: 1 })
  const restored = harness(saved)
  await restored.tasks.ready
  assert.deepEqual(restored.tasks.detail('parent', 'child').telemetry, trace.record.telemetry)
  restored.state.event({ id: 'child' }, nativeMessage(3, 5, 2, { cacheReadTokens: 1, reasoningTokens: 0 }))
  await restored.tasks.pendingWrites
  assert.deepEqual(restored.tasks.getRecord('parent', 'child').telemetry.usage, trace.record.telemetry.usage)
})

test('DSH usageless assistant messages still report model without inventing zero tokens', async () => {
  const { tasks, state } = harness()
  await tasks.ready
  const trace = tasks.begin({ parentSessionId: 'parent', agent: 'dsh', label: 'task', cwd: '/workspace' })
  tasks.bind(trace, 'child')
  state.event({ id: 'child' }, { seq: 1, type: 'assistant/message', data: { message: { source: { kind: 'model', model: 'reported-model' }, content: [] } } })
  assert.deepEqual(trace.record.telemetry, { model: 'reported-model', modelSource: 'reported' })
})

test('Codex replaces authoritative thread-total snapshots without adding turns or duplicates', async () => {
  const { tasks } = harness()
  await tasks.ready
  const trace = tasks.begin({ parentSessionId: 'parent', agent: 'codex', label: 'task', cwd: '/workspace' })
  tasks.bind(trace, 'child')
  const last = { inputTokens: 9, cachedInputTokens: 4, cacheWriteInputTokens: 2, outputTokens: 3, reasoningOutputTokens: 1, totalTokens: 16 }
  const total = (inputTokens, outputTokens, totalTokens) => ({ inputTokens, cachedInputTokens: 4, cacheWriteInputTokens: 2, outputTokens, reasoningOutputTokens: 1, totalTokens })
  runWithTaskTrace(trace, () => {
    tasks.setExternalSession('codex', 'thread')
    tasks.observeCodex({ result: { thread: { id: 'thread', model: 'remote-model', reasoningEffort: 'xhigh' } } })
    tasks.observeCodex({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn-1', tokenUsage: { last, total: total(6, 4, 10) } } })
    tasks.observeCodex({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn-1', tokenUsage: { last, total: total(15, 10, 25) } } })
    tasks.observeCodex({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn-1', tokenUsage: { last, total: total(15, 10, 25) } } })
  })
  assert.deepEqual(trace.record.telemetry, {
    model: 'remote-model', modelSource: 'reported', reasoningEffort: 'xhigh', reasoningEffortSource: 'reported',
    usage: { inputTokens: 15, outputTokens: 10, totalTokens: 25, cacheReadTokens: 4, cacheWriteTokens: 2, reasoningTokens: 1 }, usageScope: 'session',
  })
  tasks.settle(trace, { stopReason: 'completed' })
  const next = tasks.beginContinuation('parent', 'child')
  runWithTaskTrace(next.trace, () => {
    tasks.observeCodex({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn-2', tokenUsage: { last, total: total(25, 15, 40) } } })
    tasks.observeCodex({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn-2', tokenUsage: { last, total: total(25, 15, 40) } } })
  })
  assert.equal(next.record.telemetry.usage.inputTokens, 25)
  assert.equal(next.record.telemetry.usage.totalTokens, 40)
})

test('ACP telemetry maps actual usage and ignores context occupancy', () => {
  assert.deepEqual(acpUsage({ totalTokens: 22, inputTokens: 12, outputTokens: 10, cachedReadTokens: 3, cachedWriteTokens: 2, thoughtTokens: 4 }), {
    inputTokens: 12, outputTokens: 10, totalTokens: 22, cacheReadTokens: 3, cacheWriteTokens: 2, reasoningTokens: 4,
  })
  assert.equal(acpUsage({ used: 200, size: 1000 }), undefined)
  assert.deepEqual(acpConfigTelemetry([
    { category: 'model', id: 'model', currentValue: 'model-family' },
    { category: 'thought_level', id: 'thought_level', currentValue: 'high' },
  ]), { model: 'model-family', modelSource: 'reported', reasoningEffort: 'high', reasoningEffortSource: 'reported' })
})

test('usage aggregation retains known fields and does not fabricate absent totals', () => {
  assert.deepEqual(addUsage({ inputTokens: 1 }, { inputTokens: 2, outputTokens: 3 }), { inputTokens: 3, outputTokens: 3 })
  assert.deepEqual(mergeTelemetry({ model: 'old', modelSource: 'configured' }, { model: 'new', modelSource: 'reported' }), { model: 'new', modelSource: 'reported' })
  assert.equal(codexUsage({ totalTokens: -1 }), undefined)
})

test('legacy stored records load without telemetry and configured telemetry persists through summary/detail', async () => {
  const saved = new Map([['legacy', {
    childId: 'legacy', parentSessionId: 'parent', agent: 'codex', label: 'old', cwd: '/workspace',
    status: 'completed', startedAt: 1, updatedAt: 2, archived: true, hidden: false, aliases: [], continuationCount: 0, truncated: false,
  }]])
  const { tasks } = harness(saved)
  await tasks.ready
  assert.equal(Object.hasOwn(tasks.summary(tasks.getRecord('parent', 'legacy')), 'telemetry'), false)
  const trace = tasks.begin({ parentSessionId: 'parent', agent: 'codex', label: 'configured', cwd: '/workspace' })
  tasks.bind(trace, 'configured')
  runWithTaskTrace(trace, () => tasks.setTelemetry({ model: 'configured-model', modelSource: 'configured', reasoningEffort: 'low', reasoningEffortSource: 'configured' }))
  tasks.settle(trace, { stopReason: 'completed' })
  await tasks.pendingWrites
  assert.deepEqual(tasks.list('parent').tasks.find((task) => task.childId === 'configured').telemetry, {
    model: 'configured-model', modelSource: 'configured', reasoningEffort: 'low', reasoningEffortSource: 'configured',
  })
  const restored = harness(saved)
  await restored.tasks.ready
  assert.deepEqual(restored.tasks.detail('parent', 'configured').telemetry, trace.record.telemetry)
})

test('continuation keeps last reported model and rollback restores previous telemetry', async () => {
  const { tasks } = harness()
  await tasks.ready
  const trace = tasks.begin({ parentSessionId: 'parent', agent: 'codex', label: 'task', cwd: '/workspace' })
  tasks.bind(trace, 'child')
  runWithTaskTrace(trace, () => {
    tasks.setExternalSession('codex', 'thread')
    tasks.setTelemetry({ model: 'first-model', modelSource: 'reported', reasoningEffort: 'high', reasoningEffortSource: 'reported', usage: { inputTokens: 3 }, usageScope: 'task' })
  })
  tasks.settle(trace, { stopReason: 'completed' })
  const first = tasks.beginContinuation('parent', 'child')
  runWithTaskTrace(first.trace, () => tasks.setTelemetry({ model: 'second-model', modelSource: 'reported' }))
  first.rollback()
  assert.deepEqual(tasks.detail('parent', 'child').telemetry, trace.record.telemetry)
  const second = tasks.beginContinuation('parent', 'child')
  assert.equal(second.record.telemetry.model, 'first-model')
  assert.equal(second.record.telemetry.usage.inputTokens, 3)
})

test('invalid telemetry updates cannot poison storage or replace the last valid value', async () => {
  const { tasks, saved } = harness()
  await tasks.ready
  const trace = tasks.begin({ parentSessionId: 'parent', agent: 'codex', label: 'task', cwd: '/workspace' })
  tasks.bind(trace, 'child')
  runWithTaskTrace(trace, () => {
    tasks.setTelemetry({ model: 'valid-model', modelSource: 'reported', reasoningEffort: 'high', reasoningEffortSource: 'reported', usage: { inputTokens: 2 } })
    for (const update of [
      { model: 'x'.repeat(513), modelSource: 'reported' },
      { reasoningEffort: 'x'.repeat(129), reasoningEffortSource: 'reported' },
      { usage: { inputTokens: -1 } },
      { usage: { totalTokens: 1.5 } },
      { usage: { outputTokens: Number.MAX_SAFE_INTEGER + 1 } },
      { usageScope: 'unknown' },
    ]) tasks.setTelemetry(update)
  })
  assert.deepEqual(trace.record.telemetry, {
    model: 'valid-model', modelSource: 'reported', reasoningEffort: 'high', reasoningEffortSource: 'reported', usage: { inputTokens: 2 },
  })
  await tasks.pendingWrites
  assert.deepEqual([...saved.values()][0].telemetry, trace.record.telemetry)
})

test('model changes clear stale reported effort unless the new session supplies it', () => {
  assert.deepEqual(mergeTelemetry({ model: 'old', modelSource: 'reported', reasoningEffort: 'high', reasoningEffortSource: 'reported' }, {
    model: 'new', modelSource: 'reported', clearReasoningEffortOnModelChange: true,
  }), { model: 'new', modelSource: 'reported' })
  assert.deepEqual(mergeTelemetry({ model: 'old', modelSource: 'reported', reasoningEffort: 'high', reasoningEffortSource: 'reported' }, {
    model: 'new', modelSource: 'reported', reasoningEffort: 'low', reasoningEffortSource: 'reported', clearReasoningEffortOnModelChange: true,
  }), { model: 'new', modelSource: 'reported', reasoningEffort: 'low', reasoningEffortSource: 'reported' })
  assert.deepEqual(mergeTelemetry({ model: 'old', modelSource: 'reported', reasoningEffort: 'high', reasoningEffortSource: 'reported' }, {
    model: 'new', modelSource: 'reported', reasoningEffortSource: 'configured',
  }), { model: 'new', modelSource: 'reported' })
  assert.deepEqual(mergeTelemetry({ model: 'old', modelSource: 'reported', reasoningEffort: 'high', reasoningEffortSource: 'reported' }, {
    model: 'old', modelSource: 'reported', clearReasoningEffort: true,
  }), { model: 'old', modelSource: 'reported' })
})

test('live external telemetry persists immediately, increments revision once and clears unavailable ACP effort', async () => {
  const { tasks, saved } = harness()
  await tasks.ready
  const trace = tasks.begin({ parentSessionId: 'parent', agent: 'agy', label: 'task', cwd: '/workspace' })
  tasks.bind(trace, 'live-child')
  await tasks.pendingWrites
  const revision = tasks.revision
  const initial = acpConfigTelemetry([
    { category: 'model', id: 'model', currentValue: 'model-a' },
    { category: 'thought_level', id: 'thought_level', currentValue: 'high' },
  ])
  runWithTaskTrace(trace, () => tasks.setTelemetry(initial))
  await tasks.pendingWrites
  assert.equal(tasks.revision, revision + 1)
  assert.deepEqual([...saved.values()][0].telemetry, initial)
  assert.equal([...saved.values()][0].status, 'running')
  runWithTaskTrace(trace, () => tasks.setTelemetry(initial))
  assert.equal(tasks.revision, revision + 1, 'duplicate snapshots do not invalidate UI')
  const update = acpConfigTelemetry([{ category: 'model', id: 'model', currentValue: 'model-b' }])
  runWithTaskTrace(trace, () => tasks.setTelemetry(update))
  await tasks.pendingWrites
  assert.deepEqual([...saved.values()][0].telemetry, { model: 'model-b', modelSource: 'reported' })
  assert.equal(tasks.detail('parent', 'live-child').telemetry.reasoningEffort, undefined)
})

test('DSH explicit empty effort clears the previous model effort at the same event checkpoint', async () => {
  const { tasks, state, saved } = harness()
  await tasks.ready
  const trace = tasks.begin({ parentSessionId: 'parent', agent: 'dsh', label: 'task', cwd: '/workspace' })
  tasks.bind(trace, 'child')
  state.event({ id: 'child' }, { seq: 1, type: 'request/header', data: { header: { config: { model: 'model-a', reasoningEffort: 'high' } } } })
  state.event({ id: 'child' }, { seq: 2, type: 'request/header', data: { header: { config: { model: 'model-b', reasoningEffort: '' } } } })
  assert.deepEqual(trace.record.telemetry, { model: 'model-b', modelSource: 'reported' })
  await tasks.pendingWrites
  assert.equal([...saved.values()][0].nativeSeq, 2)
  assert.deepEqual([...saved.values()][0].telemetry, trace.record.telemetry)
})

test('pending native telemetry remains bounded and native continuation preserves pre-bind events across rollback', async () => {
  const { tasks, state } = harness()
  await tasks.ready
  const trace = tasks.begin({ parentSessionId: 'parent', agent: 'dsh', label: 'task', cwd: '/workspace' })
  tasks.bind(trace, 'child')
  state.event({ id: 'child' }, { seq: 1, type: 'request/header', data: { header: { config: { model: 'old-model' } } } })
  runWithTaskTrace(trace, () => tasks.setTelemetry({ model: 'old-model', modelSource: 'reported' }))
  tasks.settle(trace, { stopReason: 'completed' })
  state.event({ id: 'child' }, { seq: 2, type: 'request/header', data: { header: { config: { model: 'continued-model', reasoningEffort: 'low' } } } })
  const first = tasks.beginContinuation('parent', 'child')
  assert.equal(first.record.telemetry.model, 'continued-model')
  first.rollback()
  assert.equal(first.record.telemetry.model, 'old-model')
  const second = tasks.beginContinuation('parent', 'child')
  assert.equal(second.record.telemetry.model, 'continued-model')
  assert.equal(second.record.nativeSeq, 2)
  for (let index = 0; index < 100; index++) state.event({ id: 'unbound' }, { seq: index, type: 'request/context', data: { model: `model-${index}` } })
  assert.equal(tasks.pendingNativeTelemetry.get('unbound').length, 64)
  assert.equal(tasks.pendingNativeTelemetry.get('unbound')[0].seq, 36)
})

test('Codex total snapshots are idempotent across persistence restore and last-only updates stay unknown', async () => {
  const { tasks, saved } = harness()
  await tasks.ready
  const trace = tasks.begin({ parentSessionId: 'parent', agent: 'codex', label: 'task', cwd: '/workspace' })
  tasks.bind(trace, 'child')
  runWithTaskTrace(trace, () => {
    tasks.setExternalSession('codex', 'thread')
    tasks.observeCodex({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn', tokenUsage: { last: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } } } })
    assert.equal(trace.record.telemetry, undefined)
    tasks.observeCodex({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn', tokenUsage: { total: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } } } })
  })
  tasks.settle(trace, { stopReason: 'completed' })
  await tasks.pendingWrites
  const restored = harness(saved)
  await restored.tasks.ready
  const next = restored.tasks.beginContinuation('parent', 'child')
  runWithTaskTrace(next.trace, () => {
    restored.tasks.observeCodex({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn', tokenUsage: { total: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } } } })
    restored.tasks.observeCodex({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'next-turn', tokenUsage: { total: { inputTokens: 6, outputTokens: 3, totalTokens: 9 } } } })
  })
  assert.deepEqual(next.record.telemetry.usage, { inputTokens: 6, outputTokens: 3, totalTokens: 9 })
  assert.equal(next.record.telemetry.usageScope, 'session')
})
