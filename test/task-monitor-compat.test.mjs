import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { MultiAgentTasks, TASK_TEXT_LIMIT, registerAgentTasksTool, runWithTaskTrace } from '../task-monitor.js'

function harness(modern = true) {
  const root = { id: 'parent', session: { id: 'parent', header: {} } }
  const child = { id: 'child', session: { id: 'child', header: { origin: 'subagent' } } }
  const registry = new Map([['parent', root], ['child', child]])
  const listeners = new Map()
  const effects = []
  const tools = []
  const ctx = {
    agents: { get: (id) => registry.get(id), list: () => [...registry.values()], ...modern ? {} : { roots: () => [root] } },
    subagents: modern ? {
      rootOf: () => root, namesOf() {}, resolveName() {}, startActivation() {},
    } : {},
    reflect: { provide() {} },
    webServer: { getOrigin: () => 'http://localhost', register: () => () => {} },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    tools: { register: (definition, options) => { tools.push({ definition, options }); return () => {} } },
    logger: { warn() {} },
    on(name, callback) { listeners.set(name, callback) },
    effect(callback) { const dispose = callback(); effects.push(dispose); return dispose },
  }
  const tasks = new MultiAgentTasks(ctx)
  const begin = () => tasks.begin({ parentSessionId: 'parent', agent: 'dsh', label: 'task', cwd: '/workspace' })
  const emit = (name, ...args) => listeners.get(name)?.(...args)
  const edge = (runId, extra = {}) => ({ id: 'child', parentSessionId: 'parent', local: true, provider: 'spawn', runId, ...extra })
  const start = (runId) => emit('subagent/start', edge(runId))
  const end = (runId, stopReason = 'completed', extra = {}) => emit('subagent/end', edge(runId, { stopReason, ...extra }))
  const turn = (seq, type, data = {}) => emit('session/event', { id: 'child' }, { seq, type, data })
  const post = async (parentSessionId) => {
    const req = Readable.from([JSON.stringify({ action: 'continue', parentSessionId, childId: 'child', message: 'next' })])
    Object.assign(req, { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' } })
    const res = { writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
    await tasks.handleHttp(req, res)
    return res
  }
  return { ctx, tasks, root, child, registry, tools, effects, listeners, begin, start, end, turn, emit, edge, post }
}

for (const modern of [false, true]) {
  test(`${modern ? 'rc.2 registry' : 'rc.1 roots'} admits only exact roots for service, tool and HTTP continuation`, async () => {
    const h = harness(modern)
    await h.tasks.ready
    h.tasks.registerContinuationHandler((agent) => ({ accepted: agent.id }))
    registerAgentTasksTool(h.ctx, h.tasks)
    const { definition, options } = h.tools[0]
    assert.equal(options.when({ agent: h.root }), true)
    assert.equal(options.when({ agent: h.child }), false)
    assert.equal(options.when({ agent: { ...h.root } }), false)
    await assert.rejects(h.tasks.continueTask(h.child, {}), /exact parent root/)
    await assert.rejects(definition.execute({ action: 'list' }, { agent: h.child }), /exact root/)
    assert.equal((await h.post('parent')).status, 200)
    assert.equal((await h.post('child')).status, 400)
    assert.equal((await h.post('absent')).status, 400)
  })
}

test('rc.1 still settles at turn end without modern lifecycle events', async () => {
  const h = harness(false)
  await h.tasks.ready
  const trace = h.begin()
  h.tasks.bind(trace, 'child')
  assert.equal(h.listeners.has('subagent/end'), false)
  h.turn(1, 'turn/start')
  h.turn(2, 'assistant/message', { message: { content: [{ type: 'text', text: 'legacy answer' }] } })
  h.turn(3, 'turn/end', { reason: { kind: 'completed' } })
  assert.equal(trace.record.status, 'completed')
  assert.equal(trace.record.output, 'legacy answer')
})

test('rc.2 turn end stays provisional until paired epoch end, including blocked/refusal and duplicate results', async () => {
  const h = harness()
  await h.tasks.ready
  const trace = h.begin()
  h.start('run-1')
  h.tasks.bind(trace, 'child')
  let settlements = 0
  h.tasks.onSettlement(trace, () => settlements++)
  h.turn(1, 'turn/start')
  h.turn(2, 'assistant/message', { message: { content: [{ type: 'text', text: 'intermediate' }] } })
  h.turn(3, 'turn/end', { reason: { kind: 'blocked' } })
  assert.equal(trace.record.status, 'running')
  assert.equal(trace.record.archived, false)
  assert.equal(settlements, 0)
  h.turn(4, 'turn/start')
  assert.equal(trace.record.generation, 1)
  assert.equal(trace.record.continuationCount, 0)
  h.end('run-1', 'refusal', { lastAssistantMessage: [{ type: 'text', text: 'declined' }] })
  assert.equal(trace.record.status, 'refusal')
  assert.equal(trace.record.output, 'declined')
  const revision = h.tasks.revision
  h.end('run-1', 'completed')
  h.tasks.settle(trace, { stopReason: 'completed', output: 'late result' })
  assert.equal(h.tasks.revision, revision)
  assert.equal(settlements, 1)
})

test('rc.2 final activation result can settle after a completed turn without a lifecycle notification', async () => {
  const h = harness()
  const trace = h.begin()
  h.tasks.bind(trace, 'child')
  h.turn(1, 'turn/end', { reason: { kind: 'completed' } })
  h.tasks.settle(trace, { stopReason: 'aborted', output: 'queued input cancelled' })
  assert.equal(trace.record.status, 'aborted')
  assert.equal(trace.record.output, 'queued input cancelled')
})

test('rc.2 native continuation settles from a new run id without an activation result and rejects old generations', async () => {
  const h = harness()
  const original = h.begin()
  h.start('first')
  h.tasks.bind(original, 'child')
  h.end('first')
  const { trace, accept } = h.tasks.beginContinuation('parent', 'child')
  accept()
  let count = 0
  h.tasks.onSettlement(trace, () => count++)
  h.start('second')
  h.turn(1, 'turn/start')
  h.end('first', 'error')
  h.tasks.settle(original, { status: 'error', output: 'stale activation' })
  h.emit('subagent/end', h.edge('second', { parentSessionId: 'wrong-parent', stopReason: 'error' }))
  assert.equal(trace.record.status, 'running')
  h.turn(2, 'turn/end', { reason: { kind: 'completed' } })
  assert.equal(count, 0)
  h.end('second', 'max-tokens', { lastAssistantMessage: [{ type: 'text', text: 'partial' }] })
  assert.equal(trace.record.status, 'max-tokens')
  assert.equal(trace.record.output, 'partial')
  assert.equal(trace.record.continuationCount, 1)
  assert.equal(count, 1)
  h.turn(3, 'turn/start')
  assert.equal(trace.record.status, 'max-tokens', 'late turn event cannot reopen a terminal epoch')
})

test('rc.2 start/end racing before bind are retained, including dispatch trace attribution', async () => {
  for (const contextual of [false, true]) {
    const h = harness()
    const trace = h.begin()
    const run = () => { h.start('early'); h.end('early', 'error', { lastAssistantMessage: [{ type: 'text', text: 'early failure' }] }) }
    if (contextual) runWithTaskTrace(trace, run)
    else run()
    h.tasks.bind(trace, 'child')
    assert.equal(trace.record.status, 'error')
    assert.equal(trace.record.output, 'early failure')
  }
})

test('rollback invalidates callbacks even at the same generation and unmatched lifecycle ends do not settle', async () => {
  const h = harness()
  const original = h.begin()
  h.tasks.bind(original, 'child')
  h.tasks.settle(original, { status: 'completed', output: 'saved' })
  const attempt = h.tasks.beginContinuation('parent', 'child')
  attempt.rollback()
  h.tasks.settle(attempt.trace, { status: 'error', output: 'rejected attempt' })
  h.end('unknown', 'error')
  assert.equal(original.record.output, 'saved')
  assert.equal(original.record.status, 'completed')
})

test('native deadline bounds missing or stuck end, cleans once and cannot corrupt a later continuation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  const original = h.begin()
  h.tasks.bind(original, 'child')
  h.tasks.settle(original, { status: 'completed' })
  const { trace, accept } = h.tasks.beginContinuation('parent', 'child')
  accept()
  let interrupted = 0
  let settlements = 0
  h.tasks.armNativeDeadline(trace, 100, () => { interrupted++; return new Promise(() => {}) })
  h.tasks.onSettlement(trace, () => settlements++)
  h.start('timed')
  h.turn(1, 'turn/end', { reason: { kind: 'completed' } })
  t.mock.timers.tick(100)
  assert.equal(trace.record.status, 'error')
  assert.equal(h.tasks.detail('parent', 'child').canContinue, false)
  assert.throws(() => h.tasks.beginContinuation('parent', 'child'), /not been confirmed/)
  assert.equal(interrupted, 1)
  assert.equal(settlements, 1)
  h.end('timed', 'aborted')
  assert.equal(trace.record.status, 'aborted')
  assert.equal(h.tasks.detail('parent', 'child').canContinue, true)
  assert.equal(settlements, 1, 'confirmation does not repeat settlement callbacks')
  assert.equal(trace.record.activities.filter((entry) => entry.id === '2:end').length, 1)
  const next = h.tasks.beginContinuation('parent', 'child')
  h.start('next')
  h.end('timed', 'error')
  t.mock.timers.tick(1000)
  assert.equal(next.record.status, 'running')
  h.end('next', 'completed')
  assert.equal(next.record.status, 'completed')
})

test('normal settlement, rollback and monitor disposal cancel native deadlines; rc.1 deadlines remain caller-owned', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  await h.tasks.ready
  const trace = h.begin()
  h.tasks.bind(trace, 'child')
  let interrupted = 0
  h.tasks.armNativeDeadline(trace, 50, () => interrupted++)
  h.tasks.settle(trace, { status: 'completed' })
  const next = h.tasks.beginContinuation('parent', 'child')
  h.tasks.armNativeDeadline(next.trace, 50, () => interrupted++)
  next.rollback()
  const last = h.tasks.beginContinuation('parent', 'child')
  h.tasks.armNativeDeadline(last.trace, 50, () => interrupted++)
  await h.effects[0]()
  t.mock.timers.tick(100)
  assert.equal(interrupted, 0)
  assert.equal(h.tasks.nativeDeadlines.size, 0)
  const legacy = harness(false)
  const legacyTrace = legacy.begin()
  legacy.tasks.armNativeDeadline(legacyTrace, 50, () => interrupted++)
  t.mock.timers.tick(100)
  assert.equal(legacyTrace.record.status, 'starting')
})

test('a native publication that wins against startup timeout stays in the same generation until its end', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness()
  const trace = h.begin()
  h.tasks.armNativeDeadline(trace, 10, () => {})
  t.mock.timers.tick(10)
  runWithTaskTrace(trace, () => h.start('publication-race'))
  h.tasks.bind(trace, 'child')
  assert.equal(trace.record.trace, trace)
  assert.equal(trace.record.generation, 1)
  assert.equal(h.tasks.detail('parent', 'child').canContinue, false)
  h.end('publication-race', 'aborted')
  assert.equal(trace.record.status, 'aborted')
  assert.equal(h.tasks.detail('parent', 'child').canContinue, true)
})

test('early lifecycle results are text-bounded and preserve truncation when bound', () => {
  const h = harness()
  const trace = h.begin()
  h.start('large')
  h.end('large', 'completed', { lastAssistantMessage: [{ type: 'text', text: 'a'.repeat(TASK_TEXT_LIMIT * 2) }] })
  assert.equal(h.tasks.nativeRuns.get('large').result.output.length, TASK_TEXT_LIMIT)
  h.tasks.bind(trace, 'child')
  assert.equal(trace.record.output.length, TASK_TEXT_LIMIT)
  assert.equal(trace.record.truncated, true)
})
