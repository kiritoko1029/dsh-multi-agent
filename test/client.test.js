import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const values = {
  router: { selectionMode: 'auto', timeoutSeconds: 1800, dsh: { defaultProvider: 'magpie', defaultModel: 'kimi/k3.1-pro', defaultReasoningEffort: 'high' }, routes: [{ agent: 'codex', prompt: 'Debug code.' }, { agent: 'kimi-code', prompt: 'Build UI.' }] },
  codex: { model: 'gpt-test', reasoningEffort: 'high', permissionMode: 'approve-for-me', env: {}, disposeGraceMs: 3000 },
  acp: { command: '/old/kimi', model: 'kimi-code/k3', reasoningEffort: 'max', args: ['acp'], permission: 'allow', env: {}, disposeEofGraceMs: 6000, disposeGraceMs: 3000 },
  agy: { command: '/old/agy', model: 'agy/gemini-test', reasoningEffort: 'high', args: ['acp'], permission: 'reject', env: {}, disposeEofGraceMs: 6000, disposeGraceMs: 3000 },
}
const model = (id, efforts) => ({ id, name: id, reasoning: { efforts: efforts.map((id) => ({ id, name: id })) } })
const catalogs = {
  dsh: { groups: [{ id: 'magpie', name: 'Magpie', models: [model('kimi/k3.1-pro', ['high', 'max'])] }], failures: [] },
  codex: { groups: [{ id: 'codex', name: 'Codex', models: [model('gpt-test', ['low', 'medium', 'high', 'xhigh'])] }], failures: [] },
  acp: { groups: [{ id: 'kimi', name: 'Kimi', models: [model('kimi-code/k3', ['high', 'max'])] }], failures: [] },
  agy: { groups: [{ id: 'agy', name: 'Antigravity', models: [model('agy/gemini-test', ['low', 'high'])] }], failures: [] },
}

function setup(options = {}) {
  let plugin, cursor = 0
  const cells = [], pendingEffects = [], cleanups = [], registrations = [], calls = []
  const writes = { router: [], codex: [], acp: [], agy: [] }
  const catalogRequests = [], requestedForms = [], dictionaries = []
  const snapshots = Object.fromEntries(Object.entries(values).map(([key, value], index) => [key, {
    status: 'ready', writable: true, revision: index + 4, value: structuredClone(value), ...options.snapshots?.[key],
  }]))
  const listeners = { router: new Set(), codex: new Set(), acp: new Set(), agy: new Set() }
  const state = (initial) => {
    const i = cursor++
    if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial
    return [cells[i], (next) => { cells[i] = typeof next === 'function' ? next(cells[i]) : next }]
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: state,
    useRef: (value) => state(() => ({ current: value }))[0],
    useEffect: (effect) => { const i = cursor++; if (!(i in cells)) { cells[i] = true; pendingEffects.push(effect) } },
  }
  const form = (owner) => ({
    getSnapshot: () => snapshots[owner],
    subscribe: (listener) => { listeners[owner].add(listener); return () => listeners[owner].delete(listener) },
    async mutate(ops, revision) {
      writes[owner].push(structuredClone({ ops, revision }))
      if (options.reject === owner) return false
      assert.equal(revision, snapshots[owner].revision)
      const value = structuredClone(snapshots[owner].value)
      for (const op of ops) {
        let node = value
        for (const key of op.path.slice(0, -1)) node = node[key] ??= {}
        if (op.op === 'unset') delete node[op.path.at(-1)]
        else node[op.path.at(-1)] = op.value
      }
      snapshots[owner] = { ...snapshots[owner], value, revision: revision + 1 }
      for (const listener of listeners[owner]) listener()
      return true
    },
  })
  const forms = { 'multi-agent-router': form('router'), 'codex-provider': form('codex'), 'kimi-code-acp': form('acp'), 'agy-acp': form('agy') }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => React) } } },
    fetch: async (url) => {
      const owner = url.endsWith('codex') ? 'codex' : url.endsWith('agy') ? 'agy' : 'acp'
      calls.push(owner)
      catalogRequests.push(url)
      if (options.catalogFailure === owner) throw new Error('private diagnostic must not enter UI')
      return { ok: true, json: async () => ({ ok: true, value: catalogs[owner] }) }
    },
  })
  plugin.apply({
    effect: (fn) => fn(),
    locale: { register: (ns, dict) => { dictionaries.push({ ns, dict }); return () => {} }, bind: () => (key) => key },
    configForms: { get: (ns) => { requestedForms.push(ns); return forms[ns] } },
    remote: { session: { modelCatalog: async () => { calls.push('dsh'); return { ok: true, value: catalogs.dsh } } } },
    slots: { inject: (_name, callback) => callback(), register: (spec, component) => { registrations.push({ spec, component }); return () => {} } },
  })
  const expand = (node) => {
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type(node.props))
    return { ...node, children: (node.children || []).map(expand) }
  }
  return {
    registrations, snapshots, writes, calls, catalogRequests, requestedForms, dictionaries,
    render() {
      cursor = 0
      const entry = registrations[0]
      const tree = expand(entry.component({ ...entry.spec.inject(), t: (key) => key }))
      for (const effect of pendingEffects.splice(0)) cleanups.push(effect())
      return tree
    },
    async load() { this.render(); await new Promise((resolve) => setImmediate(resolve)); return this.render() },
    edit(name, value) { control(this.render(), name).props.onChange({ target: { value } }) },
    async save() { await this.render().props.onSubmit({ preventDefault() {} }) },
    update(owner, patch) { snapshots[owner] = { ...snapshots[owner], ...patch }; for (const listener of listeners[owner]) listener() },
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); assert.ok(Object.values(listeners).every((set) => set.size === 0)) },
  }
}
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return []
  return [...(tree.type === type ? [tree] : []), ...(tree.children || []).flatMap((child) => nodes(child, type))]
}
const control = (tree, name) => ['input', 'select', 'textarea'].flatMap((type) => nodes(tree, type)).find((node) => node.props.name === name)
const listValues = (tree, name) => {
  const id = control(tree, name).props.list
  return nodes(tree, 'datalist').find((list) => list.props.id === id).children.map((child) => child.props.value)
}

test('registers one DSH settings entry and keeps all existing configuration values', async () => {
  const app = setup()
  assert.deepEqual(app.registrations.map(({ spec }) => [spec.name, spec.id]), [['settings.section', 'multi-agent-dispatch']])
  const tree = await app.load()
  for (const name of ['selectionMode', 'timeoutSeconds', 'route.0.prompt', 'dsh.defaultProvider', 'dsh.defaultModel', 'dsh.defaultReasoningEffort', 'codex.model', 'codex.reasoningEffort', 'codex.command', 'codex.permissionPolicy', 'codex.permissionMode', 'codex.env', 'codex.disposeGraceMs', 'acp.model', 'acp.reasoningEffort', 'acp.command', 'acp.args', 'acp.env', 'acp.permission', 'acp.disposeGraceMs', 'acp.disposeEofGraceMs']) assert.ok(control(tree, name), name)
  assert.equal(control(tree, 'codex.reasoningEffort').props.value, 'high')
  assert.equal(control(tree, 'acp.reasoningEffort').props.value, 'max')
  assert.equal(control(tree, 'codex.model').props.value, 'gpt-test')
  assert.equal(control(tree, 'acp.args').props.value, '[\n  "acp"\n]')
  app.dispose()
})

test('all models and efforts precede routing and runtime controls, async catalogs populate normally', async () => {
  const app = setup()
  const tree = await app.load()
  assert.deepEqual(app.calls.sort(), ['acp', 'agy', 'codex', 'dsh'])
  const names = nodes(tree, 'input').map((node) => node.props.name)
  assert.deepEqual(names.slice(0, 12), ['dsh.defaultProvider', 'dsh.defaultModel', 'dsh.defaultReasoningEffort', 'codex.model', 'codex.reasoningEffort', 'codex.command', 'acp.model', 'acp.reasoningEffort', 'acp.command', 'agy.model', 'agy.reasoningEffort', 'agy.command'])
  assert.deepEqual(listValues(tree, 'codex.reasoningEffort'), ['low', 'medium', 'high', 'xhigh'])
  assert.deepEqual(listValues(tree, 'acp.reasoningEffort'), ['high', 'max'])
  assert.deepEqual(listValues(tree, 'agy.reasoningEffort'), ['low', 'high'])
  assert.deepEqual(listValues(tree, 'dsh.defaultModel'), ['kimi/k3.1-pro'])
  app.dispose()
})

test('one save writes every edited namespace with its own revision', async () => {
  const app = setup()
  await app.load()
  app.edit('timeoutSeconds', '120')
  app.edit('codex.reasoningEffort', 'xhigh')
  app.edit('acp.reasoningEffort', 'high')
  await app.save()
  assert.deepEqual(app.writes.router, [{ revision: 4, ops: [{ op: 'set', path: ['timeoutSeconds'], value: 120 }] }])
  assert.deepEqual(app.writes.codex, [{ revision: 5, ops: [{ op: 'set', path: ['reasoningEffort'], value: 'xhigh' }] }])
  assert.deepEqual(app.writes.acp, [{ revision: 6, ops: [{ op: 'set', path: ['reasoningEffort'], value: 'high' }] }])
  assert.ok(JSON.stringify(app.render()).includes('common.success'))
  app.dispose()
})

test('manual model input is preserved and changing a model clears stale effort', async () => {
  const app = setup()
  await app.load()
  app.edit('codex.model', 'custom/model-not-in-catalog')
  assert.equal(control(app.render(), 'codex.reasoningEffort').props.value, '')
  app.edit('codex.reasoningEffort', 'custom-effort')
  await app.save()
  assert.equal(app.snapshots.codex.value.model, 'custom/model-not-in-catalog')
  assert.equal(app.snapshots.codex.value.reasoningEffort, 'custom-effort')
  app.edit('acp.reasoningEffort', '')
  await app.save()
  assert.equal(app.snapshots.acp.value.reasoningEffort, undefined)
  app.dispose()
})

test('stale revisions reject all writes and partial save retains only failed edits', async () => {
  const conflict = setup()
  await conflict.load()
  conflict.edit('timeoutSeconds', '120')
  conflict.update('codex', { revision: 55 })
  await conflict.save()
  assert.equal(conflict.writes.router.length, 0)
  assert.ok(JSON.stringify(conflict.render()).includes('common.conflict'))
  conflict.dispose()
  const partial = setup({ reject: 'acp' })
  await partial.load()
  partial.edit('codex.reasoningEffort', 'xhigh')
  partial.edit('acp.reasoningEffort', 'high')
  await partial.save()
  assert.ok(JSON.stringify(partial.render()).includes('unified.partial'))
  assert.equal(control(partial.render(), 'acp.reasoningEffort').props.value, 'high')
  await partial.save()
  assert.equal(partial.writes.codex.length, 1)
  assert.equal(partial.writes.acp.length, 2)
  partial.dispose()
})

test('invalid JSON prevents writes; failed catalog does not prevent manual selection', async () => {
  const app = setup({ catalogFailure: 'codex' })
  await app.load()
  assert.ok(JSON.stringify(app.render()).includes('common.modelsError'))
  assert.ok(!JSON.stringify(app.render()).includes('private diagnostic'))
  app.edit('acp.env', '{bad json')
  await app.save()
  assert.equal(app.writes.acp.length, 0)
  app.edit('acp.env', '{"REGION":"cn"}')
  app.edit('codex.reasoningEffort', 'high')
  await app.save()
  assert.equal(app.snapshots.acp.value.env.REGION, 'cn')
  assert.equal(app.writes.codex.length, 1)
  app.dispose()
})

test('unavailable external provider does not block DSH settings', async () => {
  const app = setup({ snapshots: { acp: { status: 'unavailable', writable: false } } })
  await app.load()
  assert.ok(JSON.stringify(app.render()).includes('unified.disabled'))
  app.edit('timeoutSeconds', '300')
  await app.save()
  assert.equal(app.snapshots.router.value.timeoutSeconds, 300)
  app.dispose()
})

test('discovers the independent agy provider and renders its catalog, runtime fields and bilingual labels', async () => {
  const app = setup()
  const tree = await app.load()
  assert.ok(app.requestedForms.includes('agy-acp'))
  assert.ok(app.catalogRequests.includes('/multi-agent/model-catalog/agy'))
  for (const name of ['agy.model', 'agy.reasoningEffort', 'agy.command', 'agy.args', 'agy.permission', 'agy.env', 'agy.disposeEofGraceMs', 'agy.disposeGraceMs']) assert.ok(control(tree, name), name)
  assert.equal(control(tree, 'agy.model').props.value, 'agy/gemini-test')
  assert.equal(control(tree, 'agy.command').props.value, '/old/agy')
  assert.deepEqual(listValues(tree, 'agy.reasoningEffort'), ['low', 'high'])
  const dict = app.dictionaries.find((entry) => entry.ns === 'dsh-multi-agent').dict
  for (const key of ['agy.summary', 'agy.title', 'agy.description', 'agy.model', 'agy.command', 'agy.args', 'agy.permission', 'agy.permission.main-session', 'agy.permission.human', 'agy.permission.allow', 'agy.permission.reject', 'agy.permission.subagent', 'agy.subagentMode', 'agy.subagentMode.auto', 'agy.subagentMode.full-access', 'agy.subagentMode.ask-request', 'agy.permissionWarning', 'agy.env', 'agy.envHint', 'agy.disposeEofGraceMs', 'agy.disposeGraceMs']) {
    assert.equal(typeof dict.en[key], 'string', `en ${key}`)
    assert.equal(typeof dict.zh[key], 'string', `zh ${key}`)
  }
  assert.match(dict.en['router.description'], /Antigravity \(agy\)/)
  assert.match(dict.zh['router.description'], /Antigravity \(agy\)/)
  app.dispose()
})

test('agy edits use the agy-acp revision and never leak into the Kimi ACP group', async () => {
  const app = setup()
  await app.load()
  app.edit('agy.command', '/opt/agy')
  app.edit('agy.args', '["acp", "--remote"]')
  app.edit('agy.permission', 'allow')
  app.edit('agy.env', '{"REGION":"us"}')
  app.edit('agy.disposeEofGraceMs', '7000')
  app.edit('agy.disposeGraceMs', '4000')
  app.edit('agy.model', 'agy/custom')
  app.edit('agy.reasoningEffort', 'low')
  app.edit('acp.command', '/new/kimi')
  await app.save()
  assert.deepEqual(app.writes.agy, [{
    revision: 7,
    ops: [
      { op: 'set', path: ['command'], value: '/opt/agy' },
      { op: 'set', path: ['args'], value: ['acp', '--remote'] },
      { op: 'set', path: ['permission'], value: 'allow' },
      { op: 'set', path: ['env'], value: { REGION: 'us' } },
      { op: 'set', path: ['disposeEofGraceMs'], value: 7000 },
      { op: 'set', path: ['disposeGraceMs'], value: 4000 },
      { op: 'set', path: ['model'], value: 'agy/custom' },
      { op: 'set', path: ['reasoningEffort'], value: 'low' },
    ],
  }])
  assert.deepEqual(app.writes.acp, [{ revision: 6, ops: [{ op: 'set', path: ['command'], value: '/new/kimi' }] }])
  assert.equal(app.snapshots.acp.value.model, 'kimi-code/k3')
  app.dispose()
})

test('agy is available as a fallback and prompt-routing agent', async () => {
  const app = setup()
  const tree = await app.load()
  for (const name of ['defaultAgent', 'route.0.agent']) {
    assert.ok(control(tree, name).children.some((option) => option.props.value === 'agy' && option.children.includes('Antigravity (agy)')), name)
  }
  app.edit('route.0.agent', 'agy')
  await app.save()
  assert.equal(app.snapshots.router.value.routes[0].agent, 'agy')
  app.dispose()
})

test('an unavailable agy provider stays disabled without blocking other provider saves', async () => {
  const app = setup({ snapshots: { agy: { status: 'unavailable', writable: false } } })
  const tree = await app.load()
  const agyFields = nodes(tree, 'fieldset').find((fieldset) => fieldset.children.some((child) => child?.type === 'h3' && child.children.includes('agy.title')) && nodes(fieldset, 'input').some((input) => input.props.name === 'agy.command'))
  assert.ok(agyFields)
  assert.equal(agyFields.props.disabled, true)
  app.edit('acp.reasoningEffort', 'high')
  app.edit('timeoutSeconds', '300')
  await app.save()
  assert.equal(app.snapshots.acp.value.reasoningEffort, 'high')
  assert.equal(app.snapshots.router.value.timeoutSeconds, 300)
  assert.equal(app.writes.agy.length, 0)
  assert.ok(JSON.stringify(app.render()).includes('common.success'))
  app.dispose()
})

test('a rejected agy save retains only agy edits after other groups commit', async () => {
  const app = setup({ reject: 'agy' })
  await app.load()
  app.edit('agy.reasoningEffort', 'low')
  app.edit('acp.reasoningEffort', 'high')
  await app.save()
  assert.equal(app.snapshots.acp.value.reasoningEffort, 'high')
  assert.equal(control(app.render(), 'agy.reasoningEffort').props.value, 'low')
  assert.equal(app.writes.acp.length, 1)
  assert.equal(app.writes.agy.length, 1)
  await app.save()
  assert.equal(app.writes.acp.length, 1)
  assert.equal(app.writes.agy.length, 2)
  app.dispose()
})

test('manual CLI paths override auto-detection and blank values restore it', async () => {
  const app = setup()
  await app.load()
  app.edit('codex.command', 'C:\\Tools\\codex.exe')
  app.edit('acp.command', '')
  app.edit('agy.command', '   ')
  await app.save()
  assert.deepEqual(app.writes.codex[0].ops, [{ op: 'set', path: ['command'], value: 'C:\\Tools\\codex.exe' }])
  assert.deepEqual(app.writes.acp[0].ops, [{ op: 'unset', path: ['command'] }])
  assert.deepEqual(app.writes.agy[0].ops, [{ op: 'unset', path: ['command'] }])
  assert.equal(app.snapshots.acp.value.command, undefined)
  assert.equal(app.snapshots.agy.value.command, undefined)
  app.dispose()
})

test('permission policies offer five choices and sub-agent levels appear only when selected', async () => {
  const app = setup()
  let tree = await app.load()
  for (const name of ['acp.permission', 'agy.permission', 'codex.permissionPolicy']) {
    const select = control(tree, name)
    assert.ok(select, name)
    assert.deepEqual(select.children.map((option) => option.props.value), ['main-session', 'human', 'allow', 'reject', 'subagent'], name)
    assert.equal(select.props.value, name === 'codex.permissionPolicy' ? 'main-session' : name === 'acp.permission' ? 'allow' : 'reject', name)
  }
  for (const name of ['acp.subagentPermissionMode', 'agy.subagentPermissionMode', 'codex.subagentPermissionMode']) {
    assert.equal(control(tree, name), undefined, name)
  }
  app.edit('acp.permission', 'subagent')
  tree = app.render()
  assert.equal(control(tree, 'acp.subagentPermissionMode').props.value, 'auto')
  assert.deepEqual(control(tree, 'acp.subagentPermissionMode').children.map((option) => option.props.value), ['auto', 'full-access', 'ask-request'])
  app.edit('acp.subagentPermissionMode', 'ask-request')
  app.edit('codex.permissionPolicy', 'subagent')
  app.edit('codex.subagentPermissionMode', 'full-access')
  await app.save()
  assert.deepEqual(app.writes.acp.some((write) => write.ops.some((op) => op.op === 'set' && op.path.join('.') === 'permission' && op.value === 'subagent')), true)
  assert.deepEqual(app.writes.acp.some((write) => write.ops.some((op) => op.op === 'set' && op.path.join('.') === 'subagentPermissionMode' && op.value === 'ask-request')), true)
  assert.deepEqual(app.writes.codex.some((write) => write.ops.some((op) => op.op === 'set' && op.path.join('.') === 'permissionPolicy' && op.value === 'subagent')), true)
  assert.deepEqual(app.writes.codex.some((write) => write.ops.some((op) => op.op === 'set' && op.path.join('.') === 'subagentPermissionMode' && op.value === 'full-access')), true)
  app.dispose()
})

test('switching away from sub-agent discards the stale sub-agent level edit', async () => {
  const app = setup()
  await app.load()
  app.edit('acp.permission', 'subagent')
  app.edit('acp.subagentPermissionMode', 'full-access')
  app.edit('acp.permission', 'human')
  await app.save()
  assert.deepEqual(app.writes.acp.some((write) => write.ops.some((op) => op.op === 'set' && op.path.join('.') === 'permission' && op.value === 'human')), true)
  assert.deepEqual(app.writes.acp.every((write) => write.ops.every((op) => op.path.join('.') !== 'subagentPermissionMode')), true)
  app.dispose()
})
