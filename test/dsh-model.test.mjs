import test from 'node:test'
import assert from 'node:assert/strict'
import { createDshModelResolver } from '../lib/dsh-model.js'

function harness(allowed, modern = false) {
  const calls = []
  const ctx = {
    agents: modern ? { get() {}, list() {} } : { roots() {} },
    subagents: modern ? { rootOf() {}, namesOf() {}, resolveName() {}, startActivation() {} } : {},
    sessionProjections: { register: async () => ({ stateOf: () => allowed }) },
    llm: { resolveCallConfig: async (config) => { calls.push(config); return config } },
  }
  const exec = {
    agent: {
      options: { provider: 'parent-provider', model: 'parent-model' },
      session: { requestHeader: () => undefined },
    },
    signal: new AbortController().signal,
  }
  return { resolve: createDshModelResolver(ctx), calls, exec, ctx }
}

const emptyDsh = {}

test('no explicit or configured model keeps native DSH inheritance', async () => {
  const { resolve, calls, exec } = harness(undefined)
  assert.equal(await resolve({}, { dsh: emptyDsh }, exec), undefined)
  assert.equal(calls.length, 0)
})

test('defaultModel alone inherits the parent provider and validates the route', async () => {
  const { resolve, calls, exec } = harness(undefined)
  const options = await resolve({}, { dsh: { defaultModel: 'child-model' } }, exec)
  assert.deepEqual(options, { provider: 'parent-provider', model: 'child-model' })
  assert.deepEqual(calls, [{ provider: 'parent-provider', model: 'child-model' }])
})

test('provider and model must be supplied together for per-call selection', async () => {
  const { resolve, exec } = harness(undefined)
  await assert.rejects(resolve({ provider: 'openai' }, { dsh: emptyDsh }, exec), /must be supplied together/)
  await assert.rejects(resolve({ model: 'gpt-test' }, { dsh: emptyDsh }, exec), /must be supplied together/)
})

test('changing the route without effort clears the configured inherited effort', async () => {
  const { resolve, calls, exec } = harness([{ provider: 'openai', model: 'gpt-test' }])
  const options = await resolve(
    { provider: 'openai', model: 'gpt-test' },
    { dsh: { defaultProvider: 'parent-provider', defaultModel: 'parent-model', defaultReasoningEffort: 'high' } },
    exec,
  )
  assert.deepEqual(options, { provider: 'openai', model: 'gpt-test' })
  assert.deepEqual(calls, [{ provider: 'openai', model: 'gpt-test' }])
})

test('parent route and effort remain selectable when no policy was recorded', async () => {
  const { resolve, exec } = harness(undefined)
  const options = await resolve({ provider: 'parent-provider', model: 'parent-model', reasoning_effort: 'high' }, { dsh: emptyDsh }, exec)
  assert.deepEqual(options, { provider: 'parent-provider', model: 'parent-model', reasoningEffort: 'high' })
})

for (const modern of [false, true]) {
  const version = modern ? 'rc.2' : 'rc.1'
  test(`${version} effort-only 与显式相同 route 的缺省 effort 按代际处理`, async () => {
    const { resolve, exec, calls } = harness(undefined, modern)
    exec.agent.options.reasoningEffort = 'parent-high'
    const settings = { dsh: { defaultReasoningEffort: 'configured-high' } }
    if (modern) {
      await assert.rejects(resolve({ reasoning_effort: 'low' }, settings, exec), /requires both/)
      assert.equal(calls.length, 0)
    } else {
      assert.equal((await resolve({ reasoning_effort: 'low' }, settings, exec)).reasoningEffort, 'low')
    }
    const explicitRoute = { provider: 'parent-provider', model: 'parent-model' }
    const selected = await resolve(explicitRoute, settings, exec)
    assert.equal(selected.reasoningEffort, modern ? undefined : 'configured-high')
    assert.equal(Object.hasOwn(selected, 'reasoningEffort'), true)
    const noDefaults = await resolve(explicitRoute, { dsh: {} }, exec)
    assert.equal(Object.hasOwn(noDefaults, 'reasoningEffort'), modern)
    // The Host merges requested options over compatible parent options.
    assert.equal({ ...exec.agent.options, ...noDefaults }.reasoningEffort, modern ? undefined : 'parent-high')
  })

  test(`${version} 显式 route allowlist、完整 effort 与坏参数仍受校验`, async () => {
    const { resolve, exec, calls } = harness([{ provider: 'child-provider', model: 'child-model' }], modern)
    const settings = { dsh: { defaultReasoningEffort: 'high' } }
    const route = { provider: 'child-provider', model: 'child-model' }
    const selected = await resolve(route, settings, exec)
    assert.equal(Object.hasOwn(selected, 'reasoningEffort'), modern)
    assert.equal(selected.reasoningEffort, undefined)
    assert.equal((await resolve({ ...route, reasoning_effort: 'low' }, settings, exec)).reasoningEffort, 'low')
    await assert.rejects(resolve({ provider: 'parent-provider', model: 'parent-model' }, settings, exec), /not allowed/)
    for (const field of ['provider', 'model', 'reasoning_effort']) {
      await assert.rejects(resolve({ ...route, [field]: ' ' }, settings, exec), /non-empty/)
    }
    assert.equal(calls.length, 2)
  })

  test(`${version} 配置默认值不当作模型显式选择，requestHeader 是继承来源`, async () => {
    const { resolve, exec } = harness(undefined, modern)
    exec.agent.session.requestHeader = () => ({ config: { provider: 'live-provider', model: 'live-model', reasoningEffort: 'live-high' } })
    const inherited = await resolve({}, { dsh: {} }, exec)
    assert.equal(inherited, undefined)
    const configured = await resolve({}, { dsh: { defaultModel: 'configured-model', defaultReasoningEffort: 'medium' } }, exec)
    assert.deepEqual(configured, { provider: 'live-provider', model: 'configured-model', reasoningEffort: 'medium' })
    const route = { provider: 'live-provider', model: 'live-model' }
    const selected = await resolve(route, { dsh: {} }, exec)
    assert.equal(Object.hasOwn(selected, 'reasoningEffort'), modern)
  })
}

test('rc.2 纯配置的相同 route 预检验证实际继承 effort', async () => {
  const { resolve, exec, calls } = harness(undefined, true)
  exec.agent.options.reasoningEffort = 'high'
  const options = await resolve({}, { dsh: { defaultModel: 'parent-model' } }, exec)
  assert.equal(Object.hasOwn(options, 'reasoningEffort'), false)
  assert.equal(calls[0].reasoningEffort, 'high')
})

test('未知 runtime 的模型解析明确拒绝，不能默认沿用任一版本规则', async () => {
  const { resolve, exec, ctx, calls } = harness(undefined)
  delete ctx.agents.roots
  await assert.rejects(resolve({}, { dsh: {} }, exec), /Unsupported DSH/)
  assert.equal(calls.length, 0)
})
