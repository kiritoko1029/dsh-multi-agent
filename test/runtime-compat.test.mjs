import test from 'node:test'
import assert from 'node:assert/strict'
import { isRootAgent, findRootAgent, isModernSubagentRuntime, startManagedActivation } from '../lib/runtime-compat.js'

function harness(modern) {
  const root = { id: 'root', session: { id: 'root', header: { origin: 'user', parentSession: 'historical-parent', cwd: '/workspace' } } }
  const child = { id: 'child', session: { id: 'child', header: { origin: 'subagent' } } }
  const live = new Map([[root.id, root], [child.id, child]])
  const calls = []
  const ctx = {
    agents: { get: (id) => live.get(id), list: () => [...live.values()], ...modern ? {} : { roots: () => [root] } },
    subagents: {
      ...modern ? {
        rootOf: (agent) => agent === root || agent === child ? root : (() => { throw new Error('no active runtime owner') })(),
        namesOf() { throw new Error('detection must not call namesOf') },
        resolveName() { throw new Error('detection must not resolve names') },
      } : {},
      startActivation(spec) { assert.equal(this, ctx.subagents); calls.push(spec); return Promise.resolve({ childId: 'accepted' }) },
    },
  }
  const spec = {
    provider: 'spawn', label: '任务', childId: 'reserved', parent: root,
    prompt: [{ type: 'text', text: 'work' }], cwd: '/workspace', agentOptions: { provider: 'p', model: 'm', reasoningEffort: undefined },
    agentPreset: 'preset', outputSchema: { type: 'object' }, maxDepth: 1,
    signal: new AbortController().signal, delivery: 'parent',
  }
  return { ctx, root, child, live, calls, spec }
}

for (const modern of [false, true]) {
  const version = modern ? 'rc.2' : 'rc.1'
  test(`${version} 无副作用识别契约，普通历史 fork 保留主代理身份`, () => {
    const { ctx, root, calls } = harness(modern)
    assert.equal(isModernSubagentRuntime(ctx), modern)
    assert.equal(calls.length, 0)
    assert.equal(isRootAgent(ctx, root), true)
    assert.equal(findRootAgent(ctx, 'root'), root)
    assert.equal(findRootAgent(ctx, 'historical-parent'), undefined)
    assert.equal(findRootAgent(ctx, ''), undefined)
  })

  test(`${version} 拒绝失效对象、同 ID 替身、子代理及不一致会话 ID`, () => {
    const { ctx, root, child, live } = harness(modern)
    assert.equal(isRootAgent(ctx, { ...root }), false)
    assert.equal(isRootAgent(ctx, child), false)
    assert.equal(findRootAgent(ctx, 'child'), undefined)
    assert.equal(isRootAgent(ctx, undefined), false)
    root.session.id = 'different'
    assert.equal(isRootAgent(ctx, root), false)
    root.session.id = root.id
    root.session.header.origin = 'subagent'
    assert.equal(isRootAgent(ctx, root), false)
    root.session.header.origin = 'user'
    live.delete(root.id)
    assert.equal(isRootAgent(ctx, root), false)
    assert.equal(findRootAgent(ctx, 'root'), undefined)
  })

  test(`${version} 精确编码一次 activation，保留身份、signal 及显式 undefined effort`, async () => {
    const { ctx, calls, spec } = harness(modern)
    Object.freeze(spec)
    const receipt = await startManagedActivation(ctx, spec)
    assert.equal(receipt.childId, 'accepted')
    assert.equal(calls.length, 1)
    const sent = calls[0]
    const request = modern ? sent : sent.request
    assert.equal(sent.provider, spec.provider)
    assert.equal(sent.label, spec.label)
    assert.equal(sent.childId, spec.childId)
    assert.equal(sent.signal, spec.signal)
    assert.equal(sent.delivery, spec.delivery)
    assert.equal(request.parent, spec.parent)
    assert.equal(request.prompt, spec.prompt)
    assert.equal(request.cwd, spec.cwd)
    assert.equal(request.agentOptions, spec.agentOptions)
    assert.equal(request.agentPreset, spec.agentPreset)
    assert.equal(request.outputSchema, spec.outputSchema)
    assert.equal(request.maxDepth, 1)
    assert.equal(Object.hasOwn(request.agentOptions, 'reasoningEffort'), true)
    assert.equal(Object.hasOwn(sent, 'request'), !modern)
    if (!modern) assert.equal(Object.hasOwn(sent, 'parent'), false)
    assert.equal(Object.hasOwn(spec, 'request'), false)
  })

  test(`${version} 同步或异步启动失败只调用一次且原样保留错误`, async () => {
    for (const asyncFailure of [false, true]) {
      const { ctx, spec } = harness(modern)
      let calls = 0
      const failure = new Error('provider failed after possible publication')
      ctx.subagents.startActivation = () => { calls++; if (asyncFailure) return Promise.reject(failure); throw failure }
      await assert.rejects(async () => startManagedActivation(ctx, spec), (error) => error === failure)
      assert.equal(calls, 1)
    }
  })

  test(`${version} 取消、旧嵌套参数和失效父对象在启动前拒绝`, () => {
    const { ctx, spec, calls } = harness(modern)
    assert.throws(() => startManagedActivation(ctx, { ...spec, request: {} }), /flat/)
    assert.throws(() => startManagedActivation(ctx, { ...spec, parent: { ...spec.parent } }), /exact live root/)
    const control = new AbortController()
    control.abort(new Error('cancelled before publication'))
    assert.throws(() => startManagedActivation(ctx, { ...spec, signal: control.signal }), /cancelled before publication/)
    assert.equal(calls.length, 0)
  })
}

test('旧 roots 契约不会因单独存在 rootOf 被误判为现代格式', async () => {
  const { ctx, spec, calls } = harness(false)
  ctx.subagents.rootOf = () => { throw new Error('do not probe') }
  assert.equal(isModernSubagentRuntime(ctx), false)
  await startManagedActivation(ctx, spec)
  assert.equal(calls[0].request.parent, spec.parent)
})

test('rc.2 未管理子级或归属查询拒绝时不授予 root 权限', () => {
  const { ctx, root, child } = harness(true)
  delete child.session.header.origin
  assert.equal(isRootAgent(ctx, child), false)
  ctx.subagents.rootOf = () => { throw new Error('no active runtime owner') }
  assert.equal(isRootAgent(ctx, root), false)
  assert.equal(findRootAgent(ctx, 'root'), undefined)
})

test('陌生或混合契约明确拒绝，不探测启动或推测参数格式', () => {
  for (const mutate of [
    (ctx) => { delete ctx.subagents.namesOf },
    (ctx) => { delete ctx.subagents.resolveName },
    (ctx) => { delete ctx.agents.get },
    (ctx) => { delete ctx.agents.list },
    (ctx) => { ctx.agents.roots = null },
    (ctx) => { ctx.agents.roots = () => [] },
    (ctx) => { delete ctx.subagents.startActivation },
  ]) {
    const { ctx, calls, spec } = harness(true)
    mutate(ctx)
    assert.throws(() => isModernSubagentRuntime(ctx), /Unsupported DSH/)
    assert.throws(() => startManagedActivation(ctx, spec), /Unsupported DSH/)
    assert.equal(calls.length, 0)
  }
  assert.throws(() => isModernSubagentRuntime({}), /Unsupported DSH/)
})

test('命名参数只允许现代契约，legacy 不默默丢失 name', async () => {
  const old = harness(false)
  assert.throws(() => startManagedActivation(old.ctx, { ...old.spec, name: 'reviewer' }), /require the rc.2/)
  assert.equal(old.calls.length, 0)
  const modern = harness(true)
  await startManagedActivation(modern.ctx, { ...modern.spec, name: 'reviewer' })
  assert.equal(modern.calls[0].name, 'reviewer')
})
