import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../delegation-policy.js'
import { DECLARE_EXCEPTION, nativeDeclarationProjection as definition, validateDeclaration } from '../lib/delegation-policy.js'

const declaration = { tool: 'spawn_teammate', purpose: 'ongoing_collaboration', description: 'Iterative reviewer', reason: 'Review and revise several staged implementations through ongoing messages.' }
function replay(events, id = 'parent') { return events.reduce(definition.apply, definition.init({ id })) }
function call(name, id, args = {}) { return { type: 'tool/call', data: { name, callId: id, arguments: JSON.stringify(args) } } }
function result(id, value, isError = false) { return { type: 'tool/result', data: { message: { toolCallId: id, isError }, meta: value ? { multiAgentNativeDeclaration: value } : {} } } }
const receipt = { version: 1, sessionId: 'parent', ...declaration }

async function setup(modern = false) {
  const roots = [{ id: 'parent', session: { id: 'parent' } }, { id: 'other', session: { id: 'other' } }]
  const events = new Map(roots.map((root) => [root.session, []]))
  const registrations = new Map([['dispatch_agent', { name: 'dispatch_agent' }], ['spawn_teammate', {}], ['subagent_fork', {}]])
  const cleanup = []
  let guard, prompt
  const ctx = {
    agents: {
      ...modern ? {} : { roots: () => roots },
      get: (id) => roots.find((agent) => agent.id === id),
      list: () => [...roots],
    },
    subagents: modern ? { rootOf: (agent) => agent, namesOf() {}, resolveName() {}, startActivation() {} } : {},
    sessionProjections: { register: async () => ({ stateOf: (session) => replay(events.get(session), session.id) }) },
    tools: {
      get(name, scope, toolSet) { return toolSet ? toolSet.get(name) : registrations.get(name) },
      guard(fn) { guard = fn; return () => { guard = undefined } },
      register(tool) { registrations.set(tool.name, tool); return () => registrations.delete(tool.name) },
    },
    effect(fn) { const off = fn(); cleanup.push(off); return off },
    systemPrompt: { section(value) { prompt = value; return () => {} } },
  }
  await apply(ctx)
  const exec = (name, id, args, agent = roots[0]) => ({ name, callId: id, arguments: args, agent, signal: new AbortController().signal })
  const append = (event, agent = roots[0]) => events.get(agent.session).push(event)
  const declare = async (args = declaration) => {
    const tool = registrations.get(DECLARE_EXCEPTION)
    append(call(DECLARE_EXCEPTION, 'declare', args))
    const value = await tool.execute(args, exec(DECLARE_EXCEPTION, 'declare', args))
    append(result('declare', value))
  }
  return { ctx, roots, registrations, append, exec, declare, guard: (e) => guard?.(e), prompt: () => prompt, dispose: () => cleanup.reverse().forEach((off) => off?.()) }
}

test('ordinary native calls are blocked only for root agents with the admitted dispatcher', async () => {
  const app = await setup()
  for (const name of ['subagent', 'subagent_codex']) assert.match(app.guard(app.exec(name, 'x', {})), /Use dispatch_agent/)
  assert.equal(app.guard(app.exec('subagent', 'x', {}, { id: 'child' })), undefined)
  const invocation = app.exec('subagent', 'x', {})
  assert.equal(app.guard({ ...invocation, toolSet: new Map() }), undefined)
  assert.equal(app.guard({ ...invocation, toolSet: new Map([['dispatch_agent', {}]]) }), undefined)
  app.registrations.delete('dispatch_agent')
  assert.equal(app.guard(invocation), undefined)
  app.dispose()
})

test('structured declaration covers one matching native attempt including failure', async () => {
  const app = await setup()
  assert.match(app.guard(app.exec('spawn_teammate', 'missing', declaration)), /declare_delegate_exception/)
  await app.declare()
  app.append(call('spawn_teammate', 'one', { description: declaration.description }))
  assert.equal(app.guard(app.exec('spawn_teammate', 'one', declaration)), undefined)
  // Rechecking the same invocation is safe; a parallel call cannot spend it again.
  assert.equal(app.guard(app.exec('spawn_teammate', 'one', declaration)), undefined)
  app.append(call('spawn_teammate', 'two', declaration))
  assert.match(app.guard(app.exec('spawn_teammate', 'two', declaration)), /declare_delegate_exception/)
  app.append(result('one', undefined, true))
  assert.match(app.guard(app.exec('spawn_teammate', 'three', declaration)), /declare_delegate_exception/)
  app.dispose()
})

test('declarations are session-bound, expire at turn end, and cannot be forged by unrelated results', () => {
  const log = [call(DECLARE_EXCEPTION, 'declare'), result('declare', receipt)]
  assert.equal(replay(log).receipt.description, declaration.description)
  assert.equal(replay(log, 'forked-session').receipt, null)
  assert.equal(replay([...log, { type: 'turn/end', data: { turn: 1 } }]).receipt, null)
  assert.equal(replay([result('unrelated', receipt)]).receipt, null)
  assert.equal(replay([call(DECLARE_EXCEPTION, 'declare'), result('declare', receipt, true)]).receipt, null)
})

test('wrong tool or description does not consume a declaration and duplicate declarations fail', async () => {
  const app = await setup()
  await app.declare()
  await assert.rejects(app.declare(), /previously declared/)
  app.append(call('subagent_fork', 'wrong-tool', declaration))
  app.append(call('spawn_teammate', 'wrong-label', { description: 'Other task' }))
  assert.match(app.guard(app.exec('subagent_fork', 'wrong-tool', declaration)), /declare_delegate_exception/)
  app.append(call('spawn_teammate', 'right', declaration))
  assert.equal(app.guard(app.exec('spawn_teammate', 'right', declaration)), undefined)
  assert.match(app.guard(app.exec('spawn_teammate', 'right', declaration, app.roots[1])), /declare_delegate_exception/)
  app.dispose()
})

test('existing messages, waits, interrupts, and task board actions are unaffected', async () => {
  const app = await setup()
  for (const name of ['dispatch_agent', 'send_message', 'wait_agent', 'interrupt_agent', 'list_agents', 'team_task_create', 'team_task_update']) assert.equal(app.guard(app.exec(name, 'x', {})), undefined)
  assert.match(app.prompt().text({ scope: app.roots[0] }), /all ordinary NEW independent tasks/)
  app.dispose()
  assert.equal(app.guard(app.exec('subagent', 'x', {})), undefined)
  assert.equal(app.registrations.has(DECLARE_EXCEPTION), false)
})

test('Fork requires context purpose; invalid declarations and unavailable native tools reject', async () => {
  assert.throws(() => validateDeclaration({ ...declaration, tool: 'subagent' }))
  assert.throws(() => validateDeclaration({ ...declaration, purpose: 'context_inheritance' }))
  assert.throws(() => validateDeclaration({ ...declaration, reason: '   ' }))
  const app = await setup()
  app.registrations.delete('spawn_teammate')
  await assert.rejects(app.declare(), /not available/)
  const fork = { ...declaration, tool: 'subagent_fork', purpose: 'context_inheritance' }
  await app.declare(fork)
  app.append(call('subagent_fork', 'fork', fork))
  assert.equal(app.guard(app.exec('subagent_fork', 'fork', fork)), undefined)
  app.dispose()
})

test('rc.2 元数据和提示词只声明 Fork 例外，持续协作通过 DSH dispatch', async () => {
  const app = await setup(true)
  const tool = app.registrations.get(DECLARE_EXCEPTION)
  assert.deepEqual(tool.parameters.properties.tool.enum, ['subagent_fork'])
  assert.deepEqual(tool.parameters.properties.purpose.enum, ['context_inheritance'])
  const prompt = app.prompt().text({ agent: app.roots[0] })
  assert.doesNotMatch(JSON.stringify(tool) + prompt, /spawn_teammate|ongoing_collaboration/)
  assert.match(prompt, /dispatch_agent with agent: dsh/)
  await assert.rejects(app.declare(declaration), /dispatch_agent with agent: dsh/)
  const fork = { ...declaration, tool: 'subagent_fork', purpose: 'context_inheritance' }
  await app.declare(fork)
  app.append(call('subagent_fork', 'fork', fork))
  assert.equal(app.guard(app.exec('subagent_fork', 'fork', fork)), undefined)
  app.append(call('subagent_fork', 'again', fork))
  assert.match(app.guard(app.exec('subagent_fork', 'again', fork)), /declare_delegate_exception/)
  assert.match(app.guard(app.exec('subagent', 'direct', {})), /Use dispatch_agent/)
  assert.equal(app.guard(app.exec('read_file', 'ordinary', {})), undefined)
  app.dispose()
})

test('rc.2 不接受历史 Team 声明绕过新策略，且不放宽子代理或替身访问', async () => {
  const app = await setup(true)
  app.append(call(DECLARE_EXCEPTION, 'old-declaration', declaration))
  app.append(result('old-declaration', receipt))
  app.append(call('spawn_teammate', 'old-team', declaration))
  assert.match(app.guard(app.exec('spawn_teammate', 'old-team', declaration)), /dispatch_agent with agent: dsh/)
  const tool = app.registrations.get(DECLARE_EXCEPTION)
  for (const agent of [{ ...app.roots[0] }, { id: 'child', session: { id: 'child', header: { origin: 'subagent' } } }]) {
    await assert.rejects(tool.execute(declaration, app.exec(DECLARE_EXCEPTION, 'bad', declaration, agent)), /root agent/)
    assert.equal(app.prompt().text({ agent }), '')
  }
  // Ordinary historical forks are roots when the runtime says so.
  app.roots[0].session.header = { parentSession: 'old-parent', origin: 'user' }
  assert.match(app.prompt().text({ agent: app.roots[0] }), /Delegation policy/)
  app.dispose()
})

test('rc.1 仍提供 Team/Fork 两个例外与旧提示词', async () => {
  const app = await setup()
  assert.deepEqual(app.registrations.get(DECLARE_EXCEPTION).parameters.properties.tool.enum, ['spawn_teammate', 'subagent_fork'])
  assert.match(app.prompt().text({ agent: app.roots[0] }), /spawn_teammate/)
  await app.declare()
  app.append(call('spawn_teammate', 'team', declaration))
  assert.equal(app.guard(app.exec('spawn_teammate', 'team', declaration)), undefined)
  app.dispose()
})
