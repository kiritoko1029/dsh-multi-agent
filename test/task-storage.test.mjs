import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { MultiAgentTasks } from '../task-monitor.js'

function setup(storageDomain) {
  const effects = []
  const state = { effects, warnings: [] }
  const ctx = {
    agents: { roots: () => [] },
    storageDomain,
    webServer: { register(route) { state.route = route; return () => {} }, getOrigin: () => 'http://localhost:1234' },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    reflect: { provide() {} },
    logger: { warn(...args) { state.warnings.push(args) } },
    effect(callback) { const cleanup = callback(); effects.push(cleanup); return cleanup },
  }
  return { state, tasks: new MultiAgentTasks(ctx) }
}

const newTask = (tasks) => tasks.begin({ parentSessionId: 'parent', agent: 'dsh', label: '任务', cwd: '/workspace', reportPath: '/workspace/report.md' })

test('task storage identifiers satisfy the installed DSH backend contract and snapshots are JSON-safe', async () => {
  // @deepseek-ai/dsh-storage 0.2.2-rc.1 exports this exact UNIT_NAME_RE.
  const validName = /^[a-z][a-z0-9_]*$/
  const saved = new Map()
  let closed = 0
  const { tasks, state } = setup({ open: async (spec) => {
    assert.match(spec.name, validName)
    for (const name of Object.keys(spec.tables)) assert.match(name, validName)
    return {
      table: () => ({ entries: () => saved.entries(), put: async (key, value) => {
        assert.match(key, /^[a-zA-Z0-9_-]+$/)
        assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
        spec.tables.tasks.valueSchema.parse(value)
        saved.set(key, value)
      }, delete: async (key) => saved.delete(key) }),
      close: async () => { closed += 1 },
    }
  } })
  await tasks.ready
  assert.equal(tasks.initializationError, undefined)
  const trace = newTask(tasks)
  tasks.bind(trace, 'child')
  tasks.settle(trace, { stopReason: 'completed', output: '已完成' })
  await tasks.pendingWrites
  assert.equal(saved.size, 1)
  assert.equal([...saved.values()][0].archived, true)
  assert.equal(tasks.storageError, undefined)
  for (const cleanup of state.effects) await cleanup?.()
  assert.equal(closed, 1)
})

test('storage initialization failure is contained and task operations fail explicitly', async () => {
  const { tasks, state } = setup({ open: async () => { throw new Error('backend unavailable') } })
  await new Promise((resolve) => setImmediate(resolve))
  await tasks.ready
  assert.match(tasks.initializationError.message, /backend unavailable/)
  assert.equal(state.warnings.length, 1)
  assert.throws(() => newTask(tasks), /storage is unavailable/)
  assert.throws(() => tasks.manage('parent', { action: 'clear' }), /storage is unavailable/)
  const response = { writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
  await state.route.handler({ method: 'GET', url: '/multi-agent/tasks?parentSessionId=parent' }, response)
  assert.equal(response.status, 503)
  assert.equal(response.body.ok, false)
  for (const cleanup of state.effects) await cleanup?.()
})

test('partial initialization and domain-close failures cannot reject plugin disposal', async () => {
  let closed = 0
  const { tasks, state } = setup({ open: async () => ({
    table() { throw new Error('table unavailable') },
    close: async () => { closed += 1; throw new Error('close unavailable') },
  }) })
  await tasks.ready
  assert.match(tasks.initializationError.message, /table unavailable/)
  for (const cleanup of state.effects) await cleanup?.()
  assert.equal(closed, 1)
})

test('a strict Node process survives startup rejection before any consumer awaits readiness', () => {
  const moduleUrl = new URL('../task-monitor.js', import.meta.url).href
  const script = `
    import { MultiAgentTasks } from ${JSON.stringify(moduleUrl)};
    const effects=[];
    const ctx={agents:{roots:()=>[]},storageDomain:{open:async()=>{throw new Error('invalid storage fixture')}},
      webServer:{register:()=>()=>{}},connection:{},reflect:{provide(){}},logger:{warn(){}},
      effect(fn){const cleanup=fn();effects.push(cleanup);return cleanup}};
    const tasks=new MultiAgentTasks(ctx);
    await new Promise(resolve=>setImmediate(resolve));
    await tasks.ready;
    if(!tasks.initializationError) throw new Error('fixture did not fail');
    for(const cleanup of effects) await cleanup?.();
    console.log('HOST_SURVIVED_STORAGE_FAILURE');
  `
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /HOST_SURVIVED_STORAGE_FAILURE/)
  assert.doesNotMatch(result.stderr, /UnhandledPromiseRejection|PromiseRejectionHandledWarning/)
})
