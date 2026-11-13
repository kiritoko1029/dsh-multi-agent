import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { MultiAgentTasks, runWithTaskTrace, registerAgentTasksTool } from '../task-monitor.js'

function harness(saved = new Map()) {
  const root = { id: 'parent-a', session: { id: 'parent-a' } }
  const state = { root, saved, effects: [], tools: [] }
  const ctx = {
    reflect: { provide() {} },
    webServer: { getOrigin: () => 'http://localhost:1234', register(route) { state.route = route; return () => {} } },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    agents: { roots: () => [root] },
    tools: { register(tool) { state.tools.push(tool); return () => {} } },
    storageDomain: { open: async () => ({ table: () => ({ entries: () => saved.entries(), put: async (key, value) => { saved.set(key, structuredClone(value)) }, delete: async (key) => saved.delete(key) }), close: async () => {} }) },
    on(_name, callback) { state.event = callback },
    effect(fn) { const cleanup = fn(); state.effects.push(cleanup); return cleanup },
    logger: { warn() {} },
  }
  const tasks = new MultiAgentTasks(ctx)
  registerAgentTasksTool(ctx, tasks)
  const begin = (agent = 'dsh') => {
    const trace = tasks.begin({ parentSessionId: 'parent-a', agent, label: '任务', cwd: '/workspace', reportPath: '/workspace/report.md', providerName: agent === 'dsh' ? 'spawn' : 'codex-router', language: 'zh-CN' })
    tasks.bind(trace, 'child-original')
    return trace
  }
  const post = async (args, origin = 'http://localhost:1234') => {
    const req = Readable.from([JSON.stringify(args)])
    req.method = 'POST'; req.url = '/multi-agent/tasks'; req.headers = { origin, 'content-type': 'application/json' }
    const res = { writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
    await tasks.handleHttp(req, res)
    return res
  }
  return { ctx, state, tasks, begin, post }
}

test('terminal archive, restoration and clearing share parent-scoped service and tool semantics', async () => {
  const { tasks, begin, state } = harness()
  await tasks.ready
  const trace = begin()
  assert.throws(() => tasks.manage('parent-a', { action: 'clear', childId: 'child-original' }), /Running tasks/)
  tasks.settle(trace, { stopReason: 'completed', output: '结果' })
  assert.equal(tasks.list('parent-a').tasks[0].archived, true)
  const tool = state.tools[0]
  await tool.execute({ action: 'restore', childId: 'child-original' }, { agent: state.root })
  assert.equal(tasks.list('parent-a').tasks[0].archived, false)
  assert.throws(() => tasks.manage('other-parent', { action: 'clear', childId: 'child-original' }), /does not belong/)
  await tool.execute({ action: 'archive', childId: 'child-original' }, { agent: state.root })
  await tool.execute({ action: 'clear' }, { agent: state.root })
  assert.equal(tasks.list('parent-a').tasks.length, 0)
  assert.equal(tasks.detail('parent-a', 'child-original').reportPath, '/workspace/report.md')
  assert.equal(tasks.detail('parent-a', 'child-original').canContinue, true)
  assert.equal(tasks.detail('parent-a', 'child-original').activities.length, 0)
})

test('native continuation keeps identity, isolates generations, and archives again at turn end', async () => {
  const { tasks, begin, state } = harness()
  await tasks.ready
  const original = begin()
  tasks.settle(original, { stopReason: 'aborted' })
  const { trace, accept } = tasks.beginContinuation('parent-a', 'child-original')
  accept()
  assert.throws(() => tasks.beginContinuation('parent-a', 'child-original'), /still running/)
  let settled = 0
  tasks.onSettlement(trace, () => { settled += 1 })
  tasks.settle(original, { stopReason: 'error', output: 'stale' })
  assert.equal(tasks.detail('parent-a', 'child-original').status, 'starting')
  state.event({ id: 'child-original' }, { type: 'turn/start', seq: 10, data: {} })
  state.event({ id: 'child-original' }, { type: 'assistant/message', seq: 11, data: { message: { content: [{ type: 'text', text: '新结果' }, { type: 'reasoning', text: '不要展示' }] } } })
  state.event({ id: 'child-original' }, { type: 'turn/end', seq: 12, data: { reason: { kind: 'completed' } } })
  const detail = tasks.detail('parent-a', 'child-original')
  assert.equal(detail.status, 'completed')
  assert.equal(detail.archived, true)
  assert.equal(detail.output, '新结果')
  assert.equal(detail.continuationCount, 1)
  assert.equal(settled, 1)
  assert.equal(JSON.stringify(detail).includes('不要展示'), false)
  assert.equal(new Set(detail.activities.map((item) => item.id)).size, detail.activities.length)
})

test('external continuation persists its real session and aliases while retaining one logical task', async () => {
  const { tasks, begin, state } = harness()
  await tasks.ready
  const initial = begin('codex')
  runWithTaskTrace(initial, () => tasks.setExternalSession('codex', 'remote-thread'))
  tasks.settle(initial, { stopReason: 'completed', output: 'first' })
  const { trace, rollback } = tasks.beginContinuation('parent-a', 'child-original')
  assert.deepEqual(trace.resume, { agent: 'codex', sessionId: 'remote-thread' })
  rollback()
  assert.equal(tasks.detail('parent-a', 'child-original').output, 'first')
  const next = tasks.beginContinuation('parent-a', 'child-original')
  tasks.bindContinuation(next.trace, 'child-next-run')
  await tasks.pendingWrites
  assert.equal(tasks.list('parent-a').tasks.length, 1)
  assert.equal(tasks.detail('parent-a', 'child-next-run').childId, 'child-original')
  const restored = harness(state.saved)
  await restored.tasks.ready
  const task = restored.tasks.detail('parent-a', 'child-next-run')
  assert.equal(task.status, 'interrupted')
  assert.equal(task.archived, true)
  assert.equal(task.canContinue, true)
  assert.deepEqual(restored.tasks.getRecord('parent-a', 'child-original').continuation, { agent: 'codex', sessionId: 'remote-thread' })
})

test('agy external sessions persist a provider-specific continuation reference', async () => {
  const { tasks, begin, state } = harness()
  await tasks.ready
  const initial = begin('agy')
  runWithTaskTrace(initial, () => {
    tasks.setExternalSession('kimi-code', 'must-not-cross-provider')
    tasks.setExternalSession('agy', 'agy-session')
  })
  assert.equal(initial.record.continuation.agent, 'agy')
  assert.equal(initial.record.continuation.sessionId, 'agy-session')
  tasks.settle(initial, { stopReason: 'completed' })
  const { trace } = tasks.beginContinuation('parent-a', 'child-original')
  assert.deepEqual(trace.resume, { agent: 'agy', sessionId: 'agy-session' })
  await tasks.pendingWrites
  const restored = harness(state.saved)
  await restored.tasks.ready
  assert.deepEqual(restored.tasks.getRecord('parent-a', 'child-original').continuation, { agent: 'agy', sessionId: 'agy-session' })
})

test('owner POST validates same origin, rejects wrong parent, and routes continuation through the shared handler', async () => {
  const { tasks, begin, post, state } = harness()
  await tasks.ready
  const trace = begin()
  tasks.settle(trace, { stopReason: 'completed' })
  assert.equal((await post({ action: 'clear', parentSessionId: 'parent-a' }, 'https://untrusted.example')).status, 403)
  assert.equal((await post({ action: 'clear', parentSessionId: 'other', childId: 'child-original' })).status, 400)
  assert.equal((await post({ action: 'restore', parentSessionId: 'parent-a', childId: 'child-original' })).status, 200)
  let called = 0
  tasks.registerContinuationHandler(async (agent, args) => {
    assert.equal(agent, state.root)
    assert.equal(args.message, '继续改进')
    called += 1
    return { childId: args.childId, reusedSession: true }
  })
  const result = await post({ action: 'continue', parentSessionId: 'parent-a', childId: 'child-original', message: '继续改进' })
  assert.equal(result.status, 200)
  assert.equal(result.body.value.reusedSession, true)
  assert.equal(called, 1)
  assert.equal((await post({ action: 'continue', parentSessionId: 'other', childId: 'child-original', message: 'bad' })).status, 400)
})
