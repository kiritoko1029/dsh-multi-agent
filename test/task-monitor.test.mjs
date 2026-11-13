import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { MultiAgentTasks, TASK_ACTIVITY_LIMIT, TASK_RECORD_LIMIT, TASK_TEXT_LIMIT, runWithTaskTrace } from '../task-monitor.js'
import { createCodexObservationStream } from '../lib/task-monitor-codex.js'

function harness() {
  const state = { admission: { peer: { principal: { kind: 'owner' } } } }
  const ctx = {
    agents: { roots: () => [] },
    webServer: { getOrigin: () => 'http://localhost:1234', register(route) { state.route = route; return () => {} } },
    connection: { admit() { return state.admission } },
    effect(callback) { return callback() },
    logger: { warn() {} },
    reflect: { provide() {} },
  }
  const tasks = new MultiAgentTasks(ctx)
  const begin = (parentSessionId = 'parent-a') => tasks.begin({
    parentSessionId,
    agent: 'codex',
    label: 'Test task',
    cwd: '/workspace',
    reportPath: '/workspace/.dsh/agent-reports/test.md',
  })
  const request = async (query, method = 'GET') => {
    const response = {
      setHeader(name, value) { (this.headers ??= {})[name] = value },
      writeHead(status, headers) { this.status = status; this.headers = { ...this.headers, ...headers } },
      end(body) { this.body = JSON.parse(body) },
    }
    await state.route.handler({ method, url: `/multi-agent/tasks${query}` }, response)
    return response
  }
  return { state, tasks, begin, request }
}

test('concurrent ACP traces stay isolated across asynchronous work and ignore native calls', async () => {
  const { tasks, begin } = harness()
  const first = begin('parent-a')
  const second = begin('parent-b')
  tasks.bind(first, 'child-a')
  tasks.bind(second, 'child-b')
  const message = (text) => ({ sessionUpdate: 'agent_message_chunk', messageId: 'message-1', content: { type: 'text', text } })
  await Promise.all([
    runWithTaskTrace(first, async () => {
      await new Promise((resolve) => setImmediate(resolve))
      tasks.observeACP(message('first answer'))
      await new Promise((resolve) => setImmediate(resolve))
      tasks.observeACP({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'private reasoning' } })
    }),
    runWithTaskTrace(second, async () => {
      await new Promise((resolve) => setImmediate(resolve))
      tasks.observeACP(message('second answer'))
    }),
    Promise.resolve().then(() => tasks.observeACP(message('native must not bind'))),
  ])
  assert.equal(tasks.detail('parent-a', 'child-a').activities.at(-1).text, 'first answer')
  assert.equal(tasks.detail('parent-b', 'child-b').activities.at(-1).text, 'second answer')
  assert.equal(JSON.stringify(tasks.list('parent-a')).includes('private reasoning'), false)
  assert.equal(JSON.stringify(tasks.list('parent-a')).includes('native must not bind'), false)
})

test('ACP merges message chunks and tool starts/results without raw protocol payloads', async () => {
  const { tasks, begin } = harness()
  const trace = begin()
  runWithTaskTrace(trace, () => {
    tasks.observeACP({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'before activation' } })
    tasks.observeACP({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read file', status: 'pending', rawInput: { token: 'do-not-expose' } })
    tasks.observeACP({ sessionUpdate: 'tool_call_update', toolCallId: 't1', title: 'Read workspace file', status: 'in_progress' })
    tasks.observeACP({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: { env: 'do-not-expose' }, content: [{ type: 'content', content: { type: 'text', text: 'short result' } }] })
    tasks.observeACP({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: ' and after' } })
    tasks.observeACP({ sessionUpdate: 'unknown', value: 'ignored' })
  })
  tasks.bind(trace, 'child-a')
  const detail = tasks.detail('parent-a', 'child-a')
  assert.equal(detail.activities.length, 4)
  assert.deepEqual(detail.activities[1], {
    id: 'message:m1', type: 'message', time: detail.activities[1].time, title: 'Assistant', text: 'before activation and after',
  })
  assert.equal(detail.activities[2].title, 'Read workspace file')
  assert.equal(detail.activities[2].status, 'completed')
  assert.equal(detail.activities[2].text, 'short result')
  assert.equal(JSON.stringify(detail).includes('do-not-expose'), false)
})

test('ACP messages without ids keep separate positions around tool calls', () => {
  const { tasks, begin } = harness()
  const trace = begin()
  tasks.bind(trace, 'child-a')
  runWithTaskTrace(trace, () => {
    tasks.observeACP({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Before' } })
    tasks.observeACP({ sessionUpdate: 'tool_call', toolCallId: 't', title: 'Read' })
    tasks.observeACP({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'After' } })
  })
  const messages = tasks.detail('parent-a', 'child-a').activities.filter((a) => a.type === 'message')
  assert.deepEqual(messages.map((a) => a.text), ['Before', 'After'])
  assert.notEqual(messages[0].id, messages[1].id)
})

test('Codex emits public messages and merged tool items, never reasoning or raw frames', () => {
  const { tasks, begin } = harness()
  const trace = begin()
  tasks.bind(trace, 'child-a')
  runWithTaskTrace(trace, () => {
    tasks.observeCodex({ method: 'turn/started', params: { turn: { id: 'turn-1' } } })
    tasks.observeCodex({ method: 'item/started', params: { item: { id: 'tool-1', type: 'commandExecution', command: 'npm test', status: 'inProgress' } } })
    tasks.observeCodex({ method: 'item/completed', params: { item: { id: 'tool-1', type: 'commandExecution', command: 'npm test', status: 'completed', aggregatedOutput: 'ok' } } })
    tasks.observeCodex({ method: 'item/completed', params: { item: { id: 'message-1', type: 'agentMessage', phase: 'final_answer', text: 'done' } } })
    tasks.observeCodex({ method: 'item/completed', params: { item: { id: 'reasoning-1', type: 'reasoning', text: 'do-not-expose' } } })
    tasks.observeCodex({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } })
  })
  const detail = tasks.detail('parent-a', 'child-a')
  const tool = detail.activities.find((activity) => activity.id === 'tool:tool-1')
  assert.equal(tool.title, 'npm test')
  assert.equal(tool.status, 'completed')
  assert.equal(tool.text, 'ok')
  assert.equal(detail.activities.find((activity) => activity.id === 'message:message-1').text, 'done')
  assert.equal(JSON.stringify(detail).includes('do-not-expose'), false)
})

test('Codex observation Transform preserves arbitrary byte boundaries and ignores malformed frames', async () => {
  const frames = [
    Buffer.from(JSON.stringify({ method: 'turn/started', params: { turn: { id: 't' } } }) + '\n'),
    Buffer.from(JSON.stringify({ method: 'item/completed', params: { item: { type: 'agentMessage', text: '你好😀' } } }) + '\n\n'),
  ]
  const payload = Buffer.concat(frames)
  const observed = []
  const output = createCodexObservationStream((frame) => observed.push(frame))
  const source = new PassThrough()
  const received = []
  output.on('data', (chunk) => received.push(chunk))
  const ended = new Promise((resolve) => output.on('end', resolve))
  source.pipe(output)
  for (let offset = 0; offset < payload.length;) {
    const size = Math.min(1 + offset % 7, payload.length - offset)
    source.write(payload.subarray(offset, offset + size))
    await new Promise((resolve) => setImmediate(resolve))
    offset += size
  }
  source.end()
  await ended
  assert.deepEqual(Buffer.concat(received), payload)
  assert.equal(observed.length, 2)
  const malformed = createCodexObservationStream(() => { throw new Error('observer failure') })
  const malformedPayload = Buffer.from('not-json\n')
  malformed.write(malformedPayload)
  assert.deepEqual(malformed.read(), malformedPayload)
})

test('HTTP is owner-only and enforces parent isolation, missing history and method checks', async () => {
  const { state, tasks, begin, request } = harness()
  const trace = begin('parent-a')
  tasks.bind(trace, 'child-a')
  tasks.settle(trace, { stopReason: 'completed', output: [{ type: 'text', text: 'final output' }] })
  const listed = await request('?parentSessionId=parent-a')
  assert.equal(listed.status, 200)
  assert.equal(listed.body.ok, true)
  assert.equal(listed.body.value.tasks.length, 1)
  assert.equal(listed.body.value.tasks[0].childId, 'child-a')
  assert.equal(listed.body.value.tasks[0].output, 'final output')
  assert.equal(Object.hasOwn(listed.body.value.tasks[0], 'activities'), false)
  assert.equal((await request('?parentSessionId=parent-b')).body.value.tasks.length, 0)
  assert.equal((await request('?parentSessionId=parent-a&childId=child-a')).body.value.task.activities.at(-1).status, 'completed')
  assert.equal((await request('?parentSessionId=parent-a&childId=missing')).body.value.task, null)
  assert.equal((await request('?parentSessionId=parent-b&childId=child-a')).body.value.task, null)
  assert.equal((await request('')).status, 400)
  assert.equal((await request('?parentSessionId=parent-a', 'POST')).status, 403)
  assert.equal((await request('?parentSessionId=parent-a', 'DELETE')).status, 405)
  state.admission = { rejection: 401 }
  assert.equal((await request('?parentSessionId=parent-a')).status, 401)
  state.admission = { peer: { principal: { kind: 'shared' } } }
  assert.equal((await request('?parentSessionId=parent-a')).status, 403)
})

test('terminal status, text limits and bounded activities are explicitly marked', () => {
  const { tasks, begin } = harness()
  const trace = begin()
  tasks.bind(trace, 'child-a')
  tasks.settle(trace, { stopReason: 'max-tokens', output: [{ type: 'text', text: 'x'.repeat(TASK_TEXT_LIMIT + 1) }], diagnostic: 'safe diagnostic' })
  const completed = tasks.detail('parent-a', 'child-a')
  assert.equal(completed.status, 'max-tokens')
  assert.equal(completed.output.length, TASK_TEXT_LIMIT)
  assert.equal(completed.truncated, true)
  assert.ok(completed.finishedAt)
  tasks.settle(trace, { stopReason: 'completed', output: 'cannot replace terminal state' })
  assert.equal(tasks.detail('parent-a', 'child-a').status, 'max-tokens')

  const busy = begin()
  tasks.bind(busy, 'child-busy')
  runWithTaskTrace(busy, () => {
    for (let index = 0; index < TASK_ACTIVITY_LIMIT + 20; index++) tasks.observeACP({
      sessionUpdate: 'tool_call', toolCallId: `tool-${index}`, title: `Tool ${index}`,
    })
  })
  const truncated = tasks.detail('parent-a', 'child-busy')
  assert.equal(truncated.activities.length, TASK_ACTIVITY_LIMIT)
  assert.equal(truncated.truncated, true)
})

test('task retention keeps running records even when terminal capacity is full', () => {
  const { tasks, begin } = harness()
  const live = begin('parent-live')
  tasks.bind(live, 'live-child')
  for (let index = 0; index < TASK_RECORD_LIMIT + 20; index++) {
    const trace = begin('parent-a')
    tasks.bind(trace, `child-${index}`)
    tasks.settle(trace, { stopReason: 'completed' })
  }
  assert.equal(tasks.records.size, TASK_RECORD_LIMIT)
  assert.ok([...tasks.records].some((record) => record.childId === 'live-child'))
  assert.equal(tasks.detail('parent-a', 'child-0'), null)
  assert.ok(tasks.detail('parent-a', `child-${TASK_RECORD_LIMIT + 19}`))
})

test('retention never evicts running work when every record is active', () => {
  const { tasks, begin } = harness()
  for (let index = 0; index <= TASK_RECORD_LIMIT; index++) {
    const trace = begin('parent-a')
    tasks.bind(trace, `live-${index}`)
  }
  const firstTrace = [...tasks.records].find((record) => record.childId === 'live-0')
  const first = firstTrace.trace
  assert.equal(tasks.records.size, TASK_RECORD_LIMIT + 1)
  assert.ok(tasks.detail('parent-a', 'live-0'))
  assert.ok(tasks.detail('parent-a', `live-${TASK_RECORD_LIMIT}`))
  tasks.settle(first, { stopReason: 'completed' })
  const extra = begin('parent-a')
  tasks.bind(extra, 'extra')
  assert.equal(tasks.detail('parent-a', 'live-0'), null)
  assert.ok(tasks.detail('parent-a', `live-${TASK_RECORD_LIMIT}`))
})
