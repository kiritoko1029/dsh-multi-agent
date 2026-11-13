import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { apply } from '../index.js'
import { DEFAULT_REPORT_DIRECTORY } from '../lib/reports.js'
import { MultiAgentTasks } from '../task-monitor.js'

const WORKSPACE = resolve(tmpdir(), 'dsh-router-workspace')
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function makeConfig(overrides = {}) {
  return {
    selectionMode: 'auto',
    codex: { enabled: true, providerName: 'codex', label: 'Codex', description: 'Coding agent' },
    kimiCode: { enabled: true, providerName: 'kimi-code', label: 'Kimi Code', description: 'Kimi agent' },
    agy: { enabled: true, providerName: 'agy', label: 'Antigravity', description: 'Antigravity agent' },
    dsh: { enabled: true, providerName: 'spawn', label: 'DSH', description: 'Native DSH agent' },
    routes: [
      { agent: 'codex', prompt: 'Debug code.' },
      { agent: 'kimi-code', prompt: 'Build UI.' },
      { agent: 'agy', prompt: 'Build Android integration.' },
    ],
    timeoutSeconds: 1800,
    ...overrides,
  }
}

function harness(config = makeConfig(), activationOverrides = {}, answer, modern = false) {
  const state = { starts: [], questions: [], activations: [], effects: [] }
  const rootAgent = { id: 'parent-session', options: { provider: 'parent-provider', model: 'parent-model' }, session: { id: 'parent-session', header: { origin: 'user' }, requestHeader: () => undefined } }
  state.roots = [rootAgent]
  const ctx = {
    agents: {
      ...modern ? {} : { roots: () => state.roots },
      get: (id) => state.roots.find((agent) => agent.id === id),
      list: () => [...state.roots],
    },
    workingDirectory: { get: (session) => {
      assert.equal(session, rootAgent.session)
      return WORKSPACE
    } },
    tools: {
      register(definition, options) {
        if (definition.name === 'continue_agent') {
          state.continueDefinition = definition
          return () => { state.continueDefinition = undefined }
        }
        if (definition.name === 'agent_tasks') {
          state.agentTasksDefinition = definition
          state.agentTasksOptions = options
          return () => { state.agentTasksDefinition = undefined }
        }
        state.definition = definition
        state.toolOptions = options
        return () => { state.definition = undefined }
      },
      get(name) { return state.definition?.name === name ? state.definition : undefined },
    },
    webServer: { register(route) { state.taskRoute = route; return () => {} } },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    reflect: { provide(name, value) { state[name] = value; ctx[name] = value } },
    get(name) { return state[name] },
    subagents: {
      ...modern ? {
        rootOf: (agent) => agent,
        namesOf() {},
        resolveName() {},
      } : {},
      resolveMaxDepth: () => 1,
      getProvider(name) {
        if (name === 'missing') return undefined
        return (state.providers ??= {})[name] ??= { name }
      },
      async startActivation(spec) {
        state.starts.push(spec)
        const activation = {
          childId: `child-${state.starts.length}`,
          result: Promise.resolve({ output: [], stopReason: 'completed' }),
          dispose: async () => { activation.disposed = true },
          ...activationOverrides,
        }
        state.activations.push(activation)
        return activation
      },
    },
    systemPrompt: {
      getSectionOrder() { return 1 },
      section(section) { state.section = section; return () => {} },
    },
    sessionProjections: {
      register: async (definition) => ({ stateOf: () => definition.key === 'multiAgentConversationLanguage' ? { sample: state.languageSample || '' } : state.allowedModels }),
    },
    llm: {
      resolveCallConfig: async (config) => {
        state.modelCalls = [...(state.modelCalls || []), config]
        return config
      },
    },
    userQuestions: {
      async ask(request) {
        state.questions.push(request)
        if (answer) return answer(request)
        const first = request.questions[0].options[0]
        return { answers: [{ id: 'dispatch-agent', selected: [first.label] }] }
      },
    },
    effect(callback) {
      const disposer = callback()
      state.activationCleanup ??= disposer
      if (typeof disposer === 'function') state.effects.push(disposer)
      return disposer
    },
    logger: { warn() {} },
  }
  new MultiAgentTasks(ctx)
  // Router disposal must not dispose the independently owned monitor service.
  state.effects = []
  apply(ctx, config)
  const exec = { agent: rootAgent, signal: new AbortController().signal, callId: 'call-1' }
  const args = {
    description: 'Test delegation',
    task: 'Perform the test task.',
    expected_output: 'Return the exact test result.',
  }
  return { ctx, state, exec, args }
}

test('the global prompt encourages delegation for every root session with the tool', () => {
  const { state, exec } = harness()
  const rootPrompt = state.section.text({ agent: exec.agent, scope: exec.agent })
  assert.match(rootPrompt, /Proactively use `dispatch_agent`/)
  assert.match(rootPrompt, /delegate those portions by default/)
  assert.equal(state.section.text({ agent: { id: 'child' }, scope: exec.agent }), '')
  assert.match(state.section.text({ agent: exec.agent, scope: undefined }), /Proactively use `dispatch_agent`/)
  state.definition = undefined
  assert.equal(state.section.text({ agent: exec.agent, scope: exec.agent }), '')
})

test('auto routing starts the selected provider with a composed task', async () => {
  const { state, exec, args } = harness()
  const value = await state.definition.execute({ ...args, agent: 'kimi-code', route_reason: 'UI task', context: 'Relevant context.', report_path: 'reports/test.md' }, exec)
  assert.equal(value.kind, 'activation')
  assert.equal(value.routeReason, 'UI task')
  assert.equal(value.agent, 'kimi-code')
  assert.equal(value.route, 'model')
  const expectedReportPath = resolve(WORKSPACE, 'reports', 'test.md')
  assert.equal(value.reportPath, expectedReportPath)
  assert.equal(value.timeoutSeconds, 1800)
  assert.equal(state.starts.length, 1)
  assert.equal(state.starts[0].provider, 'kimi-code')
  assert.equal(state.starts[0].delivery, 'parent')
  const prompt = state.starts[0].request.prompt[0].text
  assert.match(prompt, /Perform the test task/)
  assert.match(prompt, /Relevant context/)
  assert.match(prompt, /exact test result/)
  assert.match(prompt, new RegExp(escapeRegExp(expectedReportPath)))
  const detail = await state.agentTasksDefinition.execute({ action: 'detail', childId: value.subagentId }, exec)
  assert.equal(detail.task.childId, value.subagentId)
  assert.equal(detail.task.parentSessionId, 'parent-session')
  assert.equal(detail.task.status, 'completed')
  assert.deepEqual(detail.task.activities.map((activity) => activity.id), ['start', 'running', 'end'])
})

test('dispatch propagates main conversation language into all provider prompts', async () => {
  const { state, exec, args } = harness()
  state.languageSample = '请用中文检查代码并输出报告。'
  for (const agent of ['dsh', 'codex', 'kimi-code', 'agy']) {
    await state.definition.execute({ ...args, agent }, exec)
    assert.match(state.starts.at(-1).request.prompt[0].text, /请用中文检查代码并输出报告/)
  }
  await state.definition.execute({ ...args, agent: 'codex', language: 'fr' }, exec)
  assert.match(state.starts.at(-1).request.prompt[0].text, /Use "fr" as the main conversation language/)
  assert.doesNotMatch(state.starts.at(-1).request.prompt[0].text, /请用中文/)
  assert.match(state.definition.parameters.properties.description.description, /main conversation's language/)
  assert.match(state.section.text({ agent: exec.agent }), /Always pass `language`/)
  const starts = state.starts.length
  await assert.rejects(state.definition.execute({ ...args, agent: 'codex', language: ' ' }, exec), /language must be/)
  assert.equal(state.starts.length, starts)
})

test('agent_tasks accepts only exact roots and cannot cross parent session boundaries', async () => {
  const { state, exec, args } = harness()
  const value = await state.definition.execute({ ...args, agent: 'codex' }, exec)
  await assert.rejects(state.agentTasksDefinition.execute({ action: 'list' }, { ...exec, agent: undefined }), /exact root\/main agent/)
  await assert.rejects(state.agentTasksDefinition.execute({ action: 'list' }, { ...exec, agent: { ...exec.agent } }), /exact root\/main agent/)
  const otherRoot = { ...exec.agent, id: 'other-parent', session: { id: 'other-parent' } }
  state.roots.push(otherRoot)
  const listed = await state.agentTasksDefinition.execute({ action: 'list' }, { ...exec, agent: otherRoot })
  assert.deepEqual(listed.tasks, [])
  assert.deepEqual(await state.agentTasksDefinition.execute({ action: 'detail', childId: value.subagentId }, { ...exec, agent: otherRoot }), { task: null })
  await assert.rejects(state.agentTasksDefinition.execute({ action: 'detail' }, exec), /requires a childId/)
  assert.equal(state.agentTasksOptions.when({ agent: exec.agent }), true)
  assert.equal(state.agentTasksOptions.when({ agent: { id: 'nested' } }), false)
})

test('omitted report_path gets a unique default report and a visible start result', async () => {
  const { state, exec, args } = harness()
  const first = await state.definition.execute({ ...args, agent: 'codex' }, exec)
  const second = await state.definition.execute({ ...args, agent: 'codex' }, exec)
  const defaultDirPrefix = escapeRegExp(join(WORKSPACE, DEFAULT_REPORT_DIRECTORY) + sep)
  assert.match(first.reportPath, new RegExp(`^${defaultDirPrefix}.+-test-delegation-.+\\.md$`))
  assert.notEqual(first.reportPath, second.reportPath)
  assert.match(state.starts[0].request.prompt[0].text, new RegExp(escapeRegExp(first.reportPath)))
  assert.match(state.definition.output.render(args, first)[0].text, new RegExp(`Report path: ${escapeRegExp(first.reportPath)}`))
})

test('DSH dispatch passes configured default model options to the native spawn provider', async () => {
  const { state, exec, args } = harness(makeConfig({
    dsh: {
      enabled: true, providerName: 'spawn', label: 'DSH', description: 'Native DSH agent',
      defaultProvider: 'deepseek', defaultModel: 'deepseek-chat', defaultReasoningEffort: 'high',
    },
  }))
  const value = await state.definition.execute({ ...args, agent: 'dsh' }, exec)
  assert.equal(value.provider, 'deepseek')
  assert.equal(value.model, 'deepseek-chat')
  assert.equal(value.reasoningEffort, 'high')
  assert.deepEqual(state.starts[0].request.agentOptions, { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' })
  assert.equal(state.starts[0].request.maxDepth, 1)
})

test('DSH per-call model selection is validated against Session policy', async () => {
  const { state, exec, args } = harness()
  state.allowedModels = [{ provider: 'openai', model: 'gpt-test' }]
  const value = await state.definition.execute({ ...args, agent: 'dsh', provider: 'openai', model: 'gpt-test', reasoning_effort: 'medium' }, exec)
  assert.equal(value.model, 'gpt-test')
  assert.deepEqual(state.starts[0].request.agentOptions, { provider: 'openai', model: 'gpt-test', reasoningEffort: 'medium' })
  await assert.rejects(state.definition.execute({ ...args, agent: 'dsh', provider: 'other', model: 'not-allowed' }, exec), /not allowed for this Session/)
  assert.equal(state.starts.length, 1)
})

test('model overrides cannot be sent to external Codex, Kimi or agy providers', async () => {
  const { state, exec, args } = harness()
  await assert.rejects(state.definition.execute({ ...args, agent: 'codex', provider: 'openai', model: 'gpt-test' }, exec), /only when agent is dsh/)
  await assert.rejects(state.definition.execute({ ...args, agent: 'agy', model: 'gemini-test' }, exec), /only when agent is dsh/)
  assert.equal(state.starts.length, 0)
})

test('auto routing uses an explicit default only when the model omitted agent', async () => {
  const { state, exec, args } = harness(makeConfig({ defaultAgent: 'codex' }))
  const value = await state.definition.execute(args, exec)
  assert.equal(value.agent, 'codex')
  assert.equal(value.route, 'default')
})

test('blank required task fields fail before routing', async () => {
  const { state, exec, args } = harness()
  await assert.rejects(state.definition.execute({ ...args, task: '   ' }, exec), /non-empty `task`/)
  assert.equal(state.starts.length, 0)
})

test('nested agents cannot see or execute the dispatcher', async () => {
  const { state, exec, args } = harness()
  assert.equal(state.toolOptions.when({ agent: exec.agent }), true)
  const child = { id: 'owned-child' }
  assert.equal(state.toolOptions.when({ agent: child }), false)
  await assert.rejects(state.definition.execute({ ...args, agent: 'codex' }, { ...exec, agent: child }), /only from a root\/main agent/)
  assert.equal(state.starts.length, 0)
})

test('auto routing rejects ambiguity when no default exists', async () => {
  const { state, exec, args } = harness()
  await assert.rejects(state.definition.execute(args, exec), /No agent was selected/)
  assert.equal(state.starts.length, 0)
})

test('ask-if-ambiguous maps the user selection', async () => {
  const selected = harness(makeConfig({ selectionMode: 'ask-if-ambiguous' }))
  const value = await selected.state.definition.execute(selected.args, selected.exec)
  assert.equal(value.route, 'user')
  assert.equal(value.agent, 'codex')
  assert.equal(selected.state.questions.length, 1)
})

test('skipping agent selection cancels without starting work', async () => {
  const skipped = harness(
    makeConfig({ selectionMode: 'ask-if-ambiguous' }),
    {},
    () => ({ answers: [{ id: 'dispatch-agent', selected: [] }] }),
  )
  const value = await skipped.state.definition.execute(skipped.args, skipped.exec)
  assert.deepEqual(value, { kind: 'cancelled', reason: 'the user skipped agent selection' })
  assert.equal(skipped.state.starts.length, 0)
})

test('always-ask recommends the model choice but the user can override it', async () => {
  const { state, exec, args } = harness(
    makeConfig({ selectionMode: 'always-ask' }),
    {},
    (request) => ({ answers: [{ id: 'dispatch-agent', selected: [request.questions[0].options[1].label] }] }),
  )
  const value = await state.definition.execute({ ...args, agent: 'codex' }, exec)
  assert.equal(value.route, 'user')
  assert.equal(value.agent, 'kimi-code')
  assert.match(state.questions[0].questions[0].options[0].label, /Recommended/)
})

test('recommendation suffix collisions fail instead of selecting the wrong agent', async () => {
  const { state, exec, args } = harness(makeConfig({
    selectionMode: 'always-ask',
    codex: { enabled: true, providerName: 'codex', label: 'Kimi Code (Recommended)', description: 'Colliding label' },
    kimiCode: { enabled: true, providerName: 'kimi-code', label: 'Kimi Code', description: 'Colliding label' },
  }))
  await assert.rejects(state.definition.execute({ ...args, agent: 'kimi-code' }, exec), /option labels are ambiguous/)
  assert.equal(state.questions.length, 0)
  assert.equal(state.starts.length, 0)
})

test('missing external providers fall back to native DSH', async () => {
  const { state, exec, args } = harness(makeConfig({
    codex: { enabled: true, providerName: 'missing', label: 'Codex', description: 'Unavailable Codex' },
  }))
  const value = await state.definition.execute({ ...args, agent: 'codex' }, exec)
  assert.equal(value.agent, 'dsh')
  assert.equal(value.route, 'fallback')
  assert.equal(state.starts[0].provider, 'spawn')
  assert.match(value.routeReason, /fell back to local DSH/)
})

test('unavailable providers fail before starting an activation', async () => {
  const { state, exec, args } = harness(makeConfig({
    kimiCode: { enabled: true, providerName: 'missing', label: 'Kimi Code', description: 'Missing provider' },
    dsh: { enabled: false, providerName: 'spawn', label: 'DSH', description: 'Disabled fallback' },
  }))
  await assert.rejects(state.definition.execute({ ...args, agent: 'kimi-code' }, exec), /Agent "dsh" is not enabled/)
  assert.equal(state.starts.length, 0)
})

test('duplicate display labels fail fast because user choices would be ambiguous', () => {
  assert.throws(() => harness(makeConfig({
    kimiCode: { enabled: true, providerName: 'kimi-code', label: 'Codex', description: 'Duplicate label' },
  })), /unique agent labels/)
})

test('startup timeout aborts an unpublished activation', async () => {
  const { ctx, state, exec, args } = harness(makeConfig({ timeoutSeconds: 0.001 }))
  ctx.subagents.startActivation = ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  await assert.rejects(state.definition.execute({ ...args, agent: 'codex' }, exec), /timed out during startup/)
  assert.equal(state.multiAgentTasks.records.size, 1)
  assert.equal([...state.multiAgentTasks.records][0].status, 'aborted')
  assert.match([...state.multiAgentTasks.records][0].diagnostic, /startup failed/)
})

for (const agent of ['dsh', 'codex', 'kimi-code', 'agy']) {
  test(`${agent} background child survives run_code completion cleanup`, async () => {
    let resolveResult
    const pending = new Promise((resolve) => { resolveResult = resolve })
    const { state, exec: rootExec, args } = harness(makeConfig(), { result: pending })
    const controller = new AbortController()
    const exec = { ...rootExec, signal: controller.signal, callId: 'call-ptc:1' }
    const value = await state.definition.execute({ ...args, agent }, exec)
    // PTC disposes the evaluation signal after returning the activation receipt.
    controller.abort(new Error('PTC execution ended'))
    await Promise.resolve()
    assert.notEqual(state.activations[0].disposed, true)
    assert.equal(state.starts[0].signal.aborted, false)
    assert.equal(state.multiAgentTasks.detail('parent-session', value.subagentId).status, 'running')
    resolveResult({ output: [{ type: 'text', text: 'background work completed' }], stopReason: 'completed' })
    await Promise.resolve()
    const detail = state.multiAgentTasks.detail('parent-session', value.subagentId)
    assert.equal(detail.status, 'completed')
    assert.equal(detail.output, 'background work completed')
  })
}

test('caller cancellation during startup still aborts unpublished work', async () => {
  const { ctx, state, exec, args } = harness()
  const controller = new AbortController()
  ctx.subagents.startActivation = ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    controller.abort(new Error('caller cancelled startup'))
  })
  await assert.rejects(state.definition.execute({ ...args, agent: 'codex' }, { ...exec, signal: controller.signal }), /caller cancelled startup/)
  assert.equal([...state.multiAgentTasks.records][0].status, 'aborted')
})

test('caller cancellation racing with publication preserves an accepted activation', async () => {
  let resolveResult
  const pending = new Promise((resolve) => { resolveResult = resolve })
  const { ctx, state, exec, args } = harness(makeConfig(), { result: pending })
  const controller = new AbortController()
  const originalStart = ctx.subagents.startActivation
  ctx.subagents.startActivation = async (spec) => {
    const activation = await originalStart(spec)
    controller.abort(new Error('cancelled during publication'))
    return activation
  }
  await state.definition.execute({ ...args, agent: 'dsh' }, { ...exec, signal: controller.signal })
  assert.equal(state.starts[0].signal.aborted, true)
  assert.notEqual(state.activations[0].disposed, true)
  resolveResult({ output: [], stopReason: 'completed' })
})

test('publication-gap caller abort does not suppress a later deadline', async () => {
  let resolveResult
  const pending = new Promise((resolve) => { resolveResult = resolve })
  const { ctx, state, exec, args } = harness(makeConfig({ timeoutSeconds: 0.01 }), { result: pending })
  const controller = new AbortController()
  const originalStart = ctx.subagents.startActivation
  let disposalCount = 0
  ctx.subagents.startActivation = async (spec) => {
    const activation = await originalStart(spec)
    activation.dispose = async () => { disposalCount += 1 }
    controller.abort(new Error('PTC cleanup at publication'))
    return activation
  }
  await state.definition.execute({ ...args, agent: 'dsh' }, { ...exec, signal: controller.signal })
  assert.equal(disposalCount, 0)
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(disposalCount, 1)
  resolveResult({ output: [], stopReason: 'aborted' })
})

test('deadline racing with publication still disposes an accepted activation', async () => {
  let resolveResult
  const pending = new Promise((resolve) => { resolveResult = resolve })
  const { ctx, state, exec, args } = harness(makeConfig({ timeoutSeconds: 0.001 }), { result: pending })
  const originalStart = ctx.subagents.startActivation
  ctx.subagents.startActivation = async (spec) => {
    const activation = await originalStart(spec)
    await new Promise((resolve) => setTimeout(resolve, 10))
    return activation
  }
  await state.definition.execute({ ...args, agent: 'codex' }, exec)
  assert.equal(state.activations[0].disposed, true)
  resolveResult({ output: [], stopReason: 'aborted' })
})

test('router reload preserves an accepted child and its deadline', async () => {
  let resolveResult
  const pending = new Promise((resolve) => { resolveResult = resolve })
  const { state, exec, args } = harness(makeConfig({ timeoutSeconds: 0.02 }), { result: pending })
  await state.definition.execute({ ...args, agent: 'codex' }, exec)
  for (const dispose of state.effects) dispose()
  assert.notEqual(state.activations[0].disposed, true)
  await new Promise((resolve) => setTimeout(resolve, 35))
  assert.equal(state.activations[0].disposed, true)
  resolveResult({ output: [], stopReason: 'aborted' })
})

test('wall-clock timeout remains effective after caller cleanup', async () => {
  let resolveResult
  const pending = new Promise((resolve) => { resolveResult = resolve })
  const { state, exec, args } = harness(makeConfig({ timeoutSeconds: 0.001 }), { result: pending })
  const controller = new AbortController()
  const value = await state.definition.execute({ ...args, agent: 'codex' }, { ...exec, signal: controller.signal })
  assert.equal(value.kind, 'activation')
  controller.abort(new Error('PTC execution ended'))
  assert.notEqual(state.activations[0].disposed, true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(state.activations[0].disposed, true)
  resolveResult({ output: [], stopReason: 'aborted' })
})

test('rc.2 四种派发均传顶层参数，DSH 深度与显式 effort 清除保持完整', async () => {
  const { state, exec, args } = harness(makeConfig(), {}, undefined, true)
  exec.agent.options.reasoningEffort = 'high'
  assert.equal(state.toolOptions.when({ agent: exec.agent }), true)
  assert.match(state.definition.parameters.properties.reasoning_effort.description, /requires provider and model/)
  assert.match(state.definition.output.schema.oneOf[0].properties.timeoutSeconds.description, /this activation/)
  for (const agent of ['dsh', 'codex', 'kimi-code', 'agy']) {
    const value = await state.definition.execute({
      ...args, agent, cwd: 'child-dir', language: 'zh-CN',
      ...agent === 'dsh' ? { provider: 'parent-provider', model: 'parent-model' } : {},
    }, exec)
    const sent = state.starts.at(-1)
    assert.equal(value.kind, 'activation')
    assert.equal(Object.hasOwn(sent, 'request'), false)
    assert.equal(sent.parent, exec.agent)
    assert.equal(sent.cwd, 'child-dir')
    assert.equal(sent.delivery, 'parent')
    assert.match(sent.prompt[0].text, /Perform the test task/)
    if (agent === 'dsh') {
      assert.equal(sent.maxDepth, 1)
      assert.equal(Object.hasOwn(sent.agentOptions, 'reasoningEffort'), true)
      assert.equal(sent.agentOptions.reasoningEffort, undefined)
    } else {
      assert.equal(Object.hasOwn(sent, 'maxDepth'), false)
      assert.equal(Object.hasOwn(sent, 'agentOptions'), false)
    }
  }
  assert.equal(state.starts.length, 4)
})

for (const modern of [false, true]) {
  const version = modern ? 'rc.2' : 'rc.1'
  test(`${version} dispatch 不重试可能已被接收的失败启动`, async () => {
    const { ctx, state, exec, args } = harness(makeConfig(), {}, undefined, modern)
    let calls = 0
    const failure = new Error('publication may have happened')
    ctx.subagents.startActivation = async () => { calls++; throw failure }
    await assert.rejects(state.definition.execute({ ...args, agent: 'codex' }, exec), (error) => error === failure)
    assert.equal(calls, 1)
    assert.equal([...state.multiAgentTasks.records][0].status, 'error')
  })

  test(`${version} 普通历史 fork 可派发，失效父对象在启动前拒绝`, async () => {
    const { ctx, state, exec, args } = harness(makeConfig(), {}, undefined, modern)
    exec.agent.session.header.parentSession = 'old-parent'
    assert.equal(state.toolOptions.when({ agent: exec.agent }), true)
    await state.definition.execute({ ...args, agent: 'dsh' }, exec)
    ctx.agents.get = () => undefined
    assert.equal(state.toolOptions.when({ agent: exec.agent }), false)
    await assert.rejects(state.definition.execute({ ...args, agent: 'dsh' }, exec), /root\/main agent/)
    assert.equal(state.starts.length, 1)
  })
}

test('runtime 契约丢失时派发明确拒绝且不创建 task trace 或 probe activation', async () => {
  const { ctx, state, exec, args } = harness()
  delete ctx.agents.roots
  await assert.rejects(state.definition.execute({ ...args, agent: 'dsh' }, exec), /Unsupported DSH/)
  assert.equal(state.starts.length, 0)
  assert.equal(state.multiAgentTasks.records.size, 0)
})

test('rc.2 发布后的调用方清理不取消任务，期限只回收该 activation', async () => {
  let resolveResult
  const result = new Promise((resolve) => { resolveResult = resolve })
  const { ctx, state, exec, args } = harness(makeConfig({ timeoutSeconds: 0.005 }), { result }, undefined, true)
  let drains = 0
  ctx.subagents.drainDescendants = () => { drains++ }
  const control = new AbortController()
  await state.definition.execute({ ...args, agent: 'dsh' }, { ...exec, signal: control.signal })
  control.abort(new Error('PTC cleanup'))
  assert.equal(state.starts[0].signal.aborted, false)
  assert.notEqual(state.activations[0].disposed, true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(state.activations[0].disposed, true)
  assert.equal(drains, 0)
  resolveResult({ output: [], stopReason: 'aborted' })
})
