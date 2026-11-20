import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function miniReact() {
  let active
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (initial) => active.useState(initial), useRef: (initial) => active.useRef(initial),
    useEffect: (effect, deps) => active.useEffect(effect, deps),
  }
  function mount(component, props) {
    const cells = []
    let tree
    const same = (a, b) => a && b.length === b.length && a.every((value, index) => Object.is(value, b[index]))
    function render() {
      const pending = []
      let cursor = 0
      active = {
        useState(initial) {
          const index = cursor++
          if (!(index in cells)) cells[index] = { value: typeof initial === 'function' ? initial() : initial }
          return [cells[index].value, (next) => { cells[index].value = typeof next === 'function' ? next(cells[index].value) : next }]
        },
        useRef(initial) {
          const index = cursor++
          if (!(index in cells)) cells[index] = { value: { current: initial } }
          return cells[index].value
        },
        useEffect(effect, deps) {
          const index = cursor++
          const previous = cells[index]
          if (!previous || !same(previous.deps, deps)) {
            pending.push({ index, effect, previous })
            cells[index] = { deps, cleanup: previous?.cleanup }
          }
        },
      }
      tree = component(props)
      active = undefined
      for (const item of pending) {
        item.previous?.cleanup?.()
        const cleanup = item.effect()
        cells[item.index].cleanup = typeof cleanup === 'function' ? cleanup : undefined
      }
      return tree
    }
    return { render, dispose() { for (const cell of cells) cell?.cleanup?.() } }
  }
  return { React, mount }
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return []
  return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap((child) => find(child, predicate))]
}
const named = (tree, name) => find(tree, (node) => node.props?.name === name)[0]
const textOf = (tree) => !tree ? '' : typeof tree === 'string' ? tree : typeof tree === 'number' ? String(tree) : (tree.children || []).map(textOf).join(' ')
const flush = () => new Promise((resolve) => setImmediate(resolve))

function form(value, writes) {
  let snapshot = { value: structuredClone(value), status: 'ready', writable: true, revision: 0 }
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async mutate(ops, revision) {
      assert.equal(revision, snapshot.revision)
      writes.push(structuredClone(ops))
      const next = structuredClone(snapshot.value)
      for (const op of ops) {
        let target = next
        for (const key of op.path.slice(0, -1)) target = target[key] ??= {}
        if (op.op === 'unset') delete target[op.path.at(-1)]
        else target[op.path.at(-1)] = op.value
      }
      snapshot = { ...snapshot, value: next, revision: revision + 1 }
      for (const listener of listeners) listener()
      return true
    },
  }
}

function setup(options = {}) {
  const runtime = miniReact()
  const shared = {}
  const registrations = [
    { spec: { name: 'conversation.input.model' }, component: () => 'native-model' },
    { spec: { name: 'conversation.input.permission' }, component: () => 'native-permission' },
  ]
  const SINGLE_SLOTS = new Set(['conversation.input.activity', 'conversation.input.model', 'conversation.input.permission'])
  const activeEntry = (name) => registrations
    .filter((entry) => entry.spec.name === name)
    .sort((left, right) => (left.spec.priority ?? 0) - (right.spec.priority ?? 0))[0]
  const writes = { router: [], codex: [], acp: [], agy: [] }
  const forms = {
    router: form({ dsh: { directSandboxMode: 'default' } }, writes.router),
    codex: form({ model: 'codex-a', reasoningEffort: 'high', permissionPolicy: 'main-session' }, writes.codex),
    acp: form({ model: 'model-a', reasoningEffort: 'high', permission: 'main-session' }, writes.acp),
    agy: form({ model: 'agy-a', reasoningEffort: 'low', permission: 'main-session' }, writes.agy),
  }
  const catalog = { groups: [{ id: 'kimi', name: 'Kimi', models: [
    { id: 'model-a', name: 'Model A', reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
    { id: 'model-b', name: 'Model B', reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
  ] }] }
  const context = {
    locale: { register: () => () => {}, bind: () => (key) => key },
    configForms: { get: (name) => name === 'multi-agent-router' ? forms.router : name === 'codex-provider' ? forms.codex : name === 'kimi-code-acp' ? forms.acp : forms.agy },
    uiConversation: { events: { register: () => () => {} } },
    slots: {
      inject: (_name, callback) => callback(),
      register(spec, component) {
        const priority = spec.priority ?? 0
        if (SINGLE_SLOTS.has(spec.name) && registrations.some((entry) => entry.spec.name === spec.name && (entry.spec.priority ?? 0) === priority)) {
          throw new Error(`single slot "${spec.name}" already has a registration at priority ${priority}`)
        }
        const entry = { spec, component }
        registrations.push(entry)
        return () => {
          const index = registrations.indexOf(entry)
          if (index >= 0) registrations.splice(index, 1)
        }
      },
    },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: catalog }) } },
    effect(callback) { const cleanup = callback(); return typeof cleanup === 'function' ? cleanup : undefined },
  }
  for (const [file, icons] of [['direct-client.js', true], ['controls-client.js', false]]) {
    let plugin
    const window = { __ModuleLoader__: { load(entry) { plugin = entry.factory(() => icons ? {} : runtime.React, shared) } }, localStorage: { getItem: () => null, setItem() {} }, location: { protocol: 'http:' } }
    // Both factories receive React; the direct module additionally resolves its private icon map.
    window.__ModuleLoader__.load = ({ factory }) => { plugin = factory((id) => id === 'react' ? runtime.React : { deepseek: '<svg/>', openai: '<svg/>', kimi: '<svg/>', google: '<svg/>' }, shared) }
    vm.runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { window, fetch: async (url) => {
      if (file.includes('controls') && String(url).includes('model-catalog')) {
        if (options.catalogWait) await options.catalogWait
        if (options.catalogFail) return { ok: false, json: async () => ({ ok: false }) }
      }
      return { ok: true, json: async () => ({ ok: true, value: file.includes('controls') ? catalog : { tasks: [] } }) }
    } })
    plugin.apply(context)
  }
  return { runtime, shared, registrations, activeEntry, writes, catalog }
}

test('direct controls shadow native priority-0 seats for child agents and restore native controls for main', () => {
  const app = setup()
  const store = app.shared.directAgentStore
  assert.equal(app.activeEntry('conversation.input.model').component(), 'native-model')
  assert.equal(app.activeEntry('conversation.input.permission').component(), 'native-permission')
  store.set('session-1', 'kimi-code')
  store.activate('session-1')
  const modelSeat = app.activeEntry('conversation.input.model')
  const permissionSeat = app.activeEntry('conversation.input.permission')
  assert.ok((modelSeat.spec.priority ?? 0) < 0 && (modelSeat.spec.priority ?? 0) > -10)
  assert.ok((permissionSeat.spec.priority ?? 0) < 0 && (permissionSeat.spec.priority ?? 0) > -10)
  // Switching between direct agents keeps the shadowing registration in place without colliding or churning.
  store.set('session-1', 'codex')
  assert.strictEqual(app.activeEntry('conversation.input.model'), modelSeat)
  assert.strictEqual(app.activeEntry('conversation.input.permission'), permissionSeat)
  // Rendering a shadowing control for another session still on main returns null safely.
  const inactiveModel = app.runtime.mount(modelSeat.component, { sessionId: 'session-main', locked: false })
  const inactiveWrapped = inactiveModel.render()
  const inactiveMounted = app.runtime.mount(inactiveWrapped.type, inactiveWrapped.props)
  assert.equal(inactiveMounted.render(), null)
  inactiveMounted.dispose(); inactiveModel.dispose()
  store.set('session-1', 'main')
  assert.equal(app.activeEntry('conversation.input.model').component(), 'native-model')
  assert.equal(app.activeEntry('conversation.input.permission').component(), 'native-permission')
})

test('model control writes the selected child model and its default effort', async () => {
  const app = setup()
  const store = app.shared.directAgentStore
  store.set('session-1', 'kimi-code')
  store.activate('session-1')
  const entry = app.activeEntry('conversation.input.model')
  const wrapper = app.runtime.mount(entry.component, { sessionId: 'session-1', locked: false })
  const wrapped = wrapper.render()
  const mounted = app.runtime.mount(wrapped.type, wrapped.props)
  let tree = mounted.render()
  assert.match(textOf(named(tree, 'direct-model-control')), /model-a/)
  named(tree, 'direct-model-control').props.onClick()
  tree = mounted.render()
  await flush()
  tree = mounted.render()
  find(tree, (node) => node.type === 'button' && textOf(node).includes('controls.model'))[0].props.onClick()
  tree = mounted.render()
  const option = find(tree, (node) => node.type === 'button' && textOf(node).includes('Model B'))[0]
  option.props.onClick()
  await flush()
  assert.deepEqual(app.writes.acp.at(-1), [
    { op: 'set', path: ['model'], value: 'model-b' },
    { op: 'set', path: ['reasoningEffort'], value: 'low' },
  ])
  mounted.dispose(); wrapper.dispose()
})

test('model menu survives slow loading, failure and retry without crashing its slot', async () => {
  let release
  const options = { catalogWait: new Promise((resolve) => { release = resolve }), catalogFail: false }
  const app = setup(options)
  const store = app.shared.directAgentStore
  store.set('session-1', 'kimi-code')
  store.activate('session-1')
  const entry = app.activeEntry('conversation.input.model')
  const wrapper = app.runtime.mount(entry.component, { sessionId: 'session-1', locked: false })
  const wrapped = wrapper.render()
  const mounted = app.runtime.mount(wrapped.type, wrapped.props)
  let tree = mounted.render()
  named(tree, 'direct-model-control').props.onClick()
  tree = mounted.render()
  find(tree, (node) => node.type === 'button' && textOf(node).includes('controls.model'))[0].props.onClick()
  tree = mounted.render()
  let statusElement = find(tree, (node) => typeof node.type === 'function' && node.props?.retry)[0]
  let status = app.runtime.mount(statusElement.type, statusElement.props)
  assert.match(textOf(status.render()), /controls.loading/)
  status.dispose()
  options.catalogFail = true
  release()
  await flush()
  tree = mounted.render()
  statusElement = find(tree, (node) => typeof node.type === 'function' && node.props?.retry)[0]
  status = app.runtime.mount(statusElement.type, statusElement.props)
  const statusTree = status.render()
  assert.match(textOf(statusTree), /controls.catalogFailed/)
  options.catalogFail = false
  find(statusTree, (node) => node.type === 'button')[0].props.onClick()
  await flush()
  tree = mounted.render()
  assert.ok(find(tree, (node) => node.type === 'button' && textOf(node).includes('Model A')).length > 0)
  status.dispose(); mounted.dispose(); wrapper.dispose()
})

test('Codex reject and automatic choices reset the old native permission mode', async () => {
  const app = setup()
  const store = app.shared.directAgentStore
  store.set('session-1', 'codex')
  store.activate('session-1')
  const entry = app.activeEntry('conversation.input.permission')
  const wrapper = app.runtime.mount(entry.component, { sessionId: 'session-1', locked: false })
  const wrapped = wrapper.render()
  const mounted = app.runtime.mount(wrapped.type, wrapped.props)
  let tree = mounted.render()
  named(tree, 'direct-permission-control').props.onClick()
  tree = mounted.render()
  find(tree, (node) => node.type === 'button' && textOf(node).includes('controls.reject'))[0].props.onClick()
  await flush()
  assert.deepEqual(app.writes.codex.at(-1), [
    { op: 'set', path: ['permissionPolicy'], value: 'reject' },
    { op: 'set', path: ['subagentPermissionMode'], value: 'auto' },
    { op: 'set', path: ['permissionMode'], value: 'never' },
  ])
  tree = mounted.render()
  named(tree, 'direct-permission-control').props.onClick()
  tree = mounted.render()
  find(tree, (node) => node.type === 'button' && textOf(node).includes('controls.subagentAuto'))[0].props.onClick()
  tree = mounted.render()
  find(tree, (node) => node.type === 'input')[0].props.onChange({ currentTarget: { checked: true } })
  tree = mounted.render()
  find(tree, (node) => node.type === 'button' && textOf(node).includes('controls.confirm'))[0].props.onClick()
  await flush()
  assert.equal(app.writes.codex.at(-1).find((op) => op.path[0] === 'permissionMode').value, 'approve-for-me')
  mounted.dispose(); wrapper.dispose()
})

test('permission control confirms full access and DSH writes its native sandbox choice', async () => {
  const app = setup()
  const store = app.shared.directAgentStore
  store.set('session-1', 'kimi-code')
  store.activate('session-1')
  let entry = app.activeEntry('conversation.input.permission')
  let wrapper = app.runtime.mount(entry.component, { sessionId: 'session-1', locked: false })
  let wrapped = wrapper.render()
  let mounted = app.runtime.mount(wrapped.type, wrapped.props)
  let tree = mounted.render()
  named(tree, 'direct-permission-control').props.onClick()
  tree = mounted.render()
  find(tree, (node) => node.type === 'button' && textOf(node).includes('controls.fullAccess'))[0].props.onClick()
  tree = mounted.render()
  assert.equal(find(tree, (node) => node.type === 'button' && textOf(node).includes('controls.confirm'))[0].props.disabled, true)
  find(tree, (node) => node.type === 'input')[0].props.onChange({ currentTarget: { checked: true } })
  tree = mounted.render()
  find(tree, (node) => node.type === 'button' && textOf(node).includes('controls.confirm'))[0].props.onClick()
  await flush()
  assert.deepEqual(app.writes.acp.at(-1), [
    { op: 'set', path: ['permission'], value: 'subagent' },
    { op: 'set', path: ['subagentPermissionMode'], value: 'full-access' },
  ])
  mounted.dispose(); wrapper.dispose()

  store.set('session-1', 'dsh')
  entry = app.activeEntry('conversation.input.permission')
  wrapper = app.runtime.mount(entry.component, { sessionId: 'session-1', locked: false })
  wrapped = wrapper.render()
  mounted = app.runtime.mount(wrapped.type, wrapped.props)
  tree = mounted.render()
  named(tree, 'direct-permission-control').props.onClick()
  tree = mounted.render()
  find(tree, (node) => node.type === 'button' && textOf(node).includes('controls.readOnly'))[0].props.onClick()
  await flush()
  assert.deepEqual(app.writes.router.at(-1), [{ op: 'set', path: ['dsh', 'directSandboxMode'], value: 'read-only' }])
  mounted.dispose(); wrapper.dispose()
})
