import test from 'node:test'
import assert from 'node:assert/strict'
import { runWithTaskTrace } from '../task-monitor.js'
import { registerTaskContinuation } from '../lib/task-continuation.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness(options = {}) {
  const state = {
    sends: [], starts: [], interrupts: [], effects: [], settlements: [],
    rollbacks: 0, binds: [], settings: { timeoutSeconds: 1800, taskPreamble: '' },
  }
  const agent = { id: 'parent-a', session: { id: 'parent-a', header: { origin: 'user' } } }
  const record = {
    parentSessionId: 'parent-a', childId: 'logical-child', activeChildId: 'logical-child',
    agent: 'dsh', providerName: 'spawn', label: '原任务', cwd: '/workspace',
    reportPath: '/workspace/report.md', language: 'zh-CN', status: 'starting', archived: false,
    ...options.record,
  }
  const trace = { record, generation: 2, resume: record.continuation }
  const tasks = {
    registerContinuationHandler(handler) {
      state.handler = handler
      return () => { state.handlerDisposed = true }
    },
    beginContinuation(parentId, childId) {
      state.begin = { parentId, childId }
      if (options.beginError) throw options.beginError
      return { trace, record, accept() { state.accepted = true }, rollback() { state.rollbacks += 1; record.status = 'completed' } }
    },
    bindContinuation(receivedTrace, childId) {
      assert.equal(receivedTrace, trace)
      state.binds.push(childId)
      record.activeChildId = childId
    },
    settle(receivedTrace, result) {
      assert.equal(receivedTrace, trace)
      state.settlements.push(result)
      record.status = result.status
      state.settlement?.()
    },
    armNativeDeadline(receivedTrace, timeoutMs, interrupt) {
      assert.equal(receivedTrace, trace)
      assert.ok(timeoutMs > 0 && timeoutMs <= state.settings.timeoutSeconds * 1000)
      state.nativeDeadline = { timeoutMs, interrupt }
      return () => { state.nativeDeadlineDisposed = true }
    },
    onSettlement(receivedTrace, callback) {
      assert.equal(receivedTrace, trace)
      state.settlement = callback
      state.settlementDisposed = false
      return () => { state.settlementDisposed = true }
    },
  }
  const ctx = {
    agents: {
      ...options.modern ? {} : { roots: () => [agent] },
      get: (id) => id === agent.id ? agent : undefined,
      list: () => [agent],
    },
    tools: {
      register(definition, registration) {
        state.definition = definition
        state.registration = registration
        return () => { state.toolDisposed = true }
      },
    },
    subagents: {
      ...options.modern ? { rootOf: (caller) => caller, namesOf() {}, resolveName() {} } : {},
      async sendMessage(sender, targetId, content, sendOptions) {
        state.sends.push({ sender, targetId, content, options: sendOptions })
        if (options.send) return options.send(sender, targetId, content, sendOptions)
        return 'message-1'
      },
      interrupt(target, authority) { state.interrupts.push({ target, authority }) },
      getProvider(name) { return options.providerAvailable === false ? undefined : { name } },
      async startActivation(spec) {
        state.starts.push(spec)
        const trace = options.captureTrace?.()
        state.traceProbe = trace?.resume
        if (options.start) return options.start(spec)
        return {
          childId: 'managed-resume', result: new Promise(() => {}),
          async dispose() { state.disposed = (state.disposed || 0) + 1 },
        }
      },
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') state.effects.push(dispose)
      return dispose
    },
    logger: { warn(message) { (state.warnings ??= []).push(message) } },
  }
  registerTaskContinuation(ctx, {
    tasks,
    getSettings: () => state.settings,
    resolveTaskLanguage: async (args) => args.language ? { language: args.language } : { parentLanguageSample: '请继续' },
  })
  return { state, ctx, tasks, agent, record, trace }
}

const args = { childId: 'logical-child', message: '补充测试并更新报告' }

test('注册 root-only continue_agent 与共享业务入口', async () => {
  const { state, agent } = harness()
  assert.equal(state.definition.name, 'continue_agent')
  assert.equal(state.definition.isConcurrencySafe(), true)
  assert.equal(state.registration.when({ agent }), true)
  assert.equal(state.registration.when({ agent: { id: 'nested' } }), false)
  assert.equal(state.definition.parameters.additionalProperties, false)
  assert.deepEqual(state.definition.parameters.required, ['childId', 'message'])
  const value = await state.definition.execute(args, { agent, signal: new AbortController().signal })
  assert.equal(value.kind, 'continuation')
  await assert.rejects(state.definition.execute(args, { agent: { session: { id: 'parent-a' } }, signal: new AbortController().signal }), /exact root/)
  assert.equal(state.sends.length, 1)
  for (const dispose of state.effects) dispose()
  assert.equal(state.handlerDisposed, true)
  assert.equal(state.toolDisposed, true)
})

test('DSH 使用原 activeChildId 续接，保留逻辑 ID 与报告并继承语言', async () => {
  const { state, agent, record } = harness({ record: { activeChildId: 'current-native' } })
  const value = await state.handler(agent, args, new AbortController().signal)
  assert.deepEqual(value, {
    kind: 'continuation', childId: 'logical-child', subagentId: 'current-native', messageId: 'message-1',
    reusedSession: true, agent: 'dsh', reportPath: '/workspace/report.md',
  })
  assert.equal(state.sends[0].targetId, 'current-native')
  assert.equal(state.sends[0].options.signal.aborted, false)
  const prompt = state.sends[0].content[0].text
  assert.match(prompt, /补充测试并更新报告/)
  assert.match(prompt, /Use "zh-CN" as the main conversation language/)
  assert.match(prompt, /Complete the requested improvements and update the existing task report/)
  assert.match(prompt, /\/workspace\/report.md/)
  assert.equal(record.label, '原任务')
  assert.equal(record.cwd, '/workspace')
})

test('外部续接在 trace 中启动同 provider，绑定新 managed ID 且保留逻辑 ID', async () => {
  const result = deferred()
  const { state, agent, record, trace } = harness({
    record: { agent: 'codex', providerName: 'codex-router', continuation: { agent: 'codex', sessionId: 'saved-codex' } },
    captureTrace: () => runWithTaskTrace(undefined, () => trace),
    start: async () => ({ childId: 'managed-2', result: result.promise, async dispose() {} }),
  })
  const value = await state.handler(agent, args, new AbortController().signal)
  assert.equal(value.childId, 'logical-child')
  assert.equal(value.subagentId, 'managed-2')
  assert.equal(value.reusedSession, true)
  assert.equal(state.starts[0].provider, 'codex-router')
  assert.equal(state.starts[0].label, '原任务')
  assert.equal(state.starts[0].request.cwd, '/workspace')
  assert.equal(state.starts[0].delivery, 'parent')
  assert.equal(trace.resume.sessionId, 'saved-codex')
  assert.equal(state.traceProbe, trace.resume)
  assert.deepEqual(state.binds, ['managed-2'])
  assert.equal(record.childId, 'logical-child')
  result.resolve({ status: 'completed', output: [] })
  await Promise.resolve()
  assert.equal(state.settlements[0].status, 'completed')
  assert.equal(state.settlementDisposed, true)
})

test('agy 续接保留 agy provider、会话引用与输出 schema', async () => {
  const { state, agent } = harness({
    record: { agent: 'agy', providerName: 'agy', continuation: { agent: 'agy', sessionId: 'saved-agy' } },
    captureTrace: () => ({ resume: { agent: 'agy', sessionId: 'saved-agy' } }),
  })
  const value = await state.handler(agent, args, new AbortController().signal)
  assert.equal(value.agent, 'agy')
  assert.equal(state.starts[0].provider, 'agy')
  assert.equal(state.traceProbe.agent, 'agy')
  assert.equal(state.traceProbe.sessionId, 'saved-agy')
  assert.ok(state.definition.output.schema.properties.agent.enum.includes('agy'))
})

test('启动失败 rollback 且不透传 provider 协议细节', async () => {
  const { state, agent } = harness({
    record: { agent: 'codex', providerName: 'codex-router', continuation: { agent: 'codex', sessionId: 'saved' } },
    start: async () => { throw new Error('raw provider env SECRET=do-not-leak') },
  })
  await assert.rejects(state.handler(agent, args, new AbortController().signal), (error) => {
    assert.match(error.message, /no new session was dispatched/)
    assert.doesNotMatch(error.message, /SECRET|raw provider/)
    return true
  })
  assert.equal(state.rollbacks, 1)
  assert.equal(state.settlementDisposed, true)
})

test('beginContinuation 拒绝跨 parent 或 busy 后不再启动', async () => {
  for (const message of ['task belongs to another parent', 'task continuation is already busy']) {
    const { state, agent } = harness({ beginError: new Error(`continue_agent: ${message}`) })
    await assert.rejects(state.handler(agent, args, new AbortController().signal), new RegExp(message))
    assert.equal(state.sends.length, 0)
    assert.equal(state.starts.length, 0)
    assert.equal(state.rollbacks, 0)
  }
})

test('调用方取消只中止启动，接收后 abort 不销毁任务', async () => {
  const controller = new AbortController()
  const { state, agent } = harness({
    send: async (_sender, _target, _content, { signal }) => {
      controller.abort(new Error('PTC cleanup'))
      assert.equal(signal.aborted, true)
      return 'accepted-message'
    },
  })
  const value = await state.handler(agent, args, controller.signal)
  assert.equal(value.messageId, 'accepted-message')
  assert.equal(state.rollbacks, 0)
  assert.equal(state.interrupts.length, 0)
})

test('外部超时 dispose 已接收 activation，settlement 清理 deadline', async () => {
  const result = deferred()
  const { state, agent } = harness({
    record: { agent: 'codex', continuation: { agent: 'codex', sessionId: 'saved' } },
    start: async () => ({
      childId: 'managed-timeout', result: result.promise,
      async dispose() { state.disposed = (state.disposed || 0) + 1 },
    }),
  })
  state.settings.timeoutSeconds = 0.005
  await state.handler(agent, args, new AbortController().signal)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(state.disposed, 1)
  result.resolve({ status: 'aborted' })
  await Promise.resolve()
  assert.equal(state.settlementDisposed, true)
})

test('已接收外部 activation 在 deadline 与 settlement 竞态时仅 dispose 一次', async () => {
  const result = deferred()
  const { state, agent } = harness({
    record: { agent: 'codex', continuation: { agent: 'codex', sessionId: 'saved' } },
    start: async () => ({
      childId: 'managed-race', result: result.promise,
      async dispose() {
        state.disposed = (state.disposed || 0) + 1
        result.resolve({ status: 'aborted' })
      },
    }),
  })
  state.settings.timeoutSeconds = 0.005
  await state.handler(agent, args, new AbortController().signal)
  await new Promise((resolve) => setTimeout(resolve, 20))
  await Promise.resolve()
  assert.equal(state.disposed, 1)
})

test('原生超时使用 ancestor interrupt，且不改变 child ID', async () => {
  const { state, agent } = harness()
  state.settings.timeoutSeconds = 0.005
  await state.handler(agent, args, new AbortController().signal)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(state.interrupts, [{ target: 'logical-child', authority: { kind: 'ancestor', agent } }])
  assert.equal(state.binds.length, 0)
  state.settlement()
})

test('显式语言优先，缺省时优先 saved record.language', async () => {
  const { state, agent } = harness()
  await state.handler(agent, { ...args, language: 'en' }, new AbortController().signal)
  assert.match(state.sends[0].content[0].text, /Use "en" as the main conversation language/)
  const other = harness({ record: { language: undefined } })
  await other.state.handler(other.agent, args, new AbortController().signal)
  assert.match(other.state.sends[0].content[0].text, /parentLanguageSample|请继续/)
})

test('外部缺少 resume 数据或 provider 时回滚，不创建新会话', async () => {
  for (const options of [
    { record: { agent: 'codex' } },
    { record: { agent: 'codex', continuation: { agent: 'codex', sessionId: 'saved' } }, providerAvailable: false },
  ]) {
    const { state, agent } = harness(options)
    await assert.rejects(state.handler(agent, args, new AbortController().signal), /continue_agent:/)
    assert.equal(state.starts.length, 0)
    assert.equal(state.rollbacks, 1)
  }
})

for (const modern of [false, true]) {
  const version = modern ? 'rc.2' : 'rc.1'
  test(`${version} 外部续接一次编码，保留原父对象、cwd、prompt、report 和 resume trace`, async () => {
    const result = deferred()
    const { state, agent, trace, record } = harness({
      modern,
      record: { agent: 'kimi-code', providerName: 'kimi-code', continuation: { agent: 'kimi-code', sessionId: 'saved-kimi' } },
      start: () => ({ childId: 'resumed', result: result.promise, async dispose() {} }),
    })
    agent.session.header.parentSession = 'old-fork-parent'
    assert.equal(state.registration.when({ agent }), true)
    const control = new AbortController()
    const value = await state.handler(agent, args, control.signal)
    const sent = state.starts[0]
    const request = modern ? sent : sent.request
    assert.equal(Object.hasOwn(sent, 'request'), !modern)
    assert.equal(request.parent, agent)
    assert.equal(request.cwd, record.cwd)
    assert.match(request.prompt[0].text, /\/workspace\/report.md/)
    assert.equal(sent.provider, record.providerName)
    assert.equal(trace.resume.sessionId, 'saved-kimi')
    assert.equal(value.childId, 'logical-child')
    assert.equal(state.starts.length, 1)
    control.abort(new Error('caller cleanup'))
    assert.equal(sent.signal.aborted, false)
    result.resolve({ stopReason: 'completed', output: [] })
    await Promise.resolve()
    assert.equal(state.settlementDisposed, true)
  })

  test(`${version} 原生续接维持 sendMessage 签名，失效对象不进入 continuation`, async () => {
    const { ctx, state, agent } = harness({ modern })
    await state.handler(agent, args, new AbortController().signal)
    assert.equal(state.starts.length, 0)
    assert.equal(state.sends[0].sender, agent)
    assert.equal(state.sends[0].targetId, 'logical-child')
    state.settlement()
    ctx.agents.get = () => undefined
    assert.equal(state.registration.when({ agent }), false)
    await assert.rejects(state.handler(agent, args), /exact root/)
    assert.equal(state.sends.length, 1)
  })

  test(`${version} 外部启动失败 rollback 且不换格式重试`, async () => {
    const { state, agent } = harness({
      modern,
      record: { agent: 'codex', continuation: { agent: 'codex', sessionId: 'saved' } },
      start: () => { throw new Error('failed after startup') },
    })
    await assert.rejects(state.handler(agent, args), /failed to resume/)
    assert.equal(state.starts.length, 1)
    assert.equal(state.rollbacks, 1)
  })
}

test('rc.2 未管理子级与未知 runtime 不获得续接权限', async () => {
  const { ctx, state, agent } = harness({ modern: true })
  ctx.subagents.rootOf = () => { throw new Error('unmanaged child') }
  assert.equal(state.registration.when({ agent }), false)
  await assert.rejects(state.handler(agent, args), /exact root/)
  delete ctx.subagents.resolveName
  await assert.rejects(state.handler(agent, args), /Unsupported DSH/)
  assert.equal(state.starts.length, 0)
  assert.equal(state.sends.length, 0)
  assert.equal(state.begin, undefined)
})
