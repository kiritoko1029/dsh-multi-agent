import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

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

const FOCUSABLE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary'])

function isFocusableNode(type, props) {
  if (props?.disabled) return false
  if (type === 'a') return typeof props?.href === 'string'
  if (FOCUSABLE_TAGS.has(type)) return true
  return typeof props?.tabIndex === 'number' && props.tabIndex >= 0
}

function createReactRuntime() {
  let active
  let typeSequence = 0
  const typeIds = new WeakMap()
  const typeId = (type) => {
    if (!typeIds.has(type)) typeIds.set(type, ++typeSequence)
    return typeIds.get(type)
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (...args) => active.api.useState(...args),
    useRef: (...args) => active.api.useRef(...args),
    useEffect: (...args) => active.api.useEffect(...args),
  }

  function createDocument() {
    const listeners = { keydown: new Set(), focusin: new Set() }
    return {
      activeElement: null,
      listeners,
      addEventListener(type, fn) {
        listeners[type] ??= new Set()
        listeners[type].add(fn)
      },
      removeEventListener(type, fn) {
        listeners[type]?.delete(fn)
      },
      dispatch(type, event) {
        for (const fn of [...(listeners[type] || [])]) fn(event)
      },
    }
  }

  function mountSlots(slots, doc) {
    let disposed = false
    let pendingEffects = []
    let renderTrees = {}
    const instances = new Map()
    const hostNodes = new Map()
    const hostRefs = new Map()
    const focusHistory = []
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))

    const disposeRecord = (record) => {
      if (record.disposed) return
      record.disposed = true
      for (const cell of record.cells) {
        cell?.cleanup?.()
        if (cell) cell.cleanup = undefined
      }
    }

    const assignRef = (ref, value) => {
      if (typeof ref === 'function') ref(value)
      else if (ref && typeof ref === 'object') ref.current = value
    }

    const makeHostNode = (path) => ({
      path,
      name: '',
      isConnected: true,
      focusable: false,
      disabled: false,
      insideHidden: false,
      focus() {
        focusHistory.push(this)
        doc.activeElement = this
      },
      contains(target) {
        if (!target) return false
        if (target === this) return true
        return typeof target.path === 'string' && target.path.startsWith(`${this.path}/`)
      },
      closest() { return null },
      querySelectorAll() {
        return [...hostNodes.values()].filter((node) =>
          node !== this &&
          node.path.startsWith(`${this.path}/`) &&
          node.focusable &&
          !node.disabled &&
          !node.insideHidden
        )
      },
    })

    const api = {
      useState(initial) {
        const { record } = active
        const index = active.cursor++
        if (!(index in record.cells)) record.cells[index] = { value: typeof initial === 'function' ? initial() : initial }
        return [record.cells[index].value, (next) => {
          if (disposed || record.disposed) return
          record.cells[index].value = typeof next === 'function' ? next(record.cells[index].value) : next
        }]
      },
      useRef(initial) {
        const index = active.cursor++
        const cells = active.record.cells
        if (!(index in cells)) cells[index] = { value: { current: initial } }
        return cells[index].value
      },
      useEffect(effect, deps) {
        const index = active.cursor++
        const cells = active.record.cells
        const previous = cells[index]
        if (!previous || !same(previous.deps, deps)) {
          pendingEffects.push({ record: active.record, index, effect, deps, previous })
          cells[index] = { deps, cleanup: previous?.cleanup }
        }
      },
    }

    function renderAll(slotProps = {}) {
      if (disposed) return renderTrees
      pendingEffects = []
      const seen = new Set()
      const currentHosts = new Map()
      const currentRefs = new Map()

      const expand = (node, path, inheritedDisabled = false, inheritedHidden = false) => {
        if (node === null || node === undefined || typeof node === 'boolean') return node
        if (typeof node !== 'object') return node
        const key = node.props?.key ?? ''
        if (typeof node.type === 'function') {
          const id = `${path}/c-${typeId(node.type)}:${key}`
          let record = instances.get(id)
          if (!record) {
            record = { cells: [], disposed: false }
            instances.set(id, record)
          }
          seen.add(id)
          const previousActive = active
          active = { record, api, cursor: 0 }
          const rendered = node.type({ ...node.props, ...(node.children.length ? { children: node.children } : {}) })
          active = previousActive
          return expand(rendered, id, inheritedDisabled, inheritedHidden)
        }
        const hostPath = `${path}/h-${node.type}:${key}`
        const disabled = inheritedDisabled || node.props?.disabled === true
        const insideHidden = inheritedHidden || node.props?.hidden === true
        const focusable = isFocusableNode(node.type, { ...node.props, disabled })
        currentHosts.set(hostPath, {
          name: node.props?.name || node.props?.className || node.type,
          focusable,
          disabled,
          insideHidden,
        })
        if (node.props?.ref) currentRefs.set(hostPath, { ref: node.props.ref })
        return {
          ...node,
          children: (node.children || []).map((child, index) =>
            expand(child, `${hostPath}/${index}`, node.type === 'fieldset' ? disabled : inheritedDisabled, insideHidden)
          ),
        }
      }

      const nextTrees = {}
      for (const [slotKey, entry] of Object.entries(slots)) {
        const extra = slotProps[slotKey] || {}
        nextTrees[slotKey] = expand(React.createElement(entry.component, extra), `slot:${slotKey}`)
      }
      renderTrees = nextTrees

      for (const [id, record] of instances) {
        if (seen.has(id)) continue
        disposeRecord(record)
        instances.delete(id)
      }
      for (const [path, node] of hostNodes) {
        if (currentHosts.has(path)) continue
        node.isConnected = false
        hostNodes.delete(path)
      }
      for (const [path, info] of currentHosts) {
        let node = hostNodes.get(path)
        if (!node) {
          node = makeHostNode(path)
          hostNodes.set(path, node)
        }
        node.isConnected = true
        node.name = info.name
        node.focusable = info.focusable
        node.disabled = info.disabled
        node.insideHidden = info.insideHidden
      }
      for (const [path, binding] of hostRefs) {
        if (currentRefs.has(path)) continue
        assignRef(binding.ref, null)
        hostRefs.delete(path)
      }
      for (const [path, current] of currentRefs) {
        const previous = hostRefs.get(path)
        const targetNode = hostNodes.get(path) || null
        if (previous?.ref === current.ref && previous?.node === targetNode) continue
        if (previous) assignRef(previous.ref, null)
        hostRefs.set(path, { ref: current.ref, node: targetNode })
        assignRef(current.ref, targetNode)
      }
      for (const item of pendingEffects) {
        if (item.record.disposed) continue
        item.previous?.cleanup?.()
        const cleanup = item.effect()
        item.record.cells[item.index] = {
          deps: item.deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      active = undefined
      return renderTrees
    }

    function dispose() {
      if (disposed) return
      disposed = true
      for (const record of instances.values()) disposeRecord(record)
      for (const binding of hostRefs.values()) assignRef(binding.ref, null)
      for (const node of hostNodes.values()) node.isConnected = false
      instances.clear()
      hostRefs.clear()
      hostNodes.clear()
    }

    return { renderAll, dispose, hostNodes, focusHistory, get trees() { return renderTrees } }
  }

  return { React, createDocument, mountSlots }
}

function setup(options = {}) {
  let plugin
  const effectCleanups = []
  const slotCleanups = []
  const slotInjections = []
  const registrations = []
  const calls = []
  const writes = { router: [], codex: [], acp: [], agy: [] }
  const catalogRequests = [], requestedForms = [], dictionaries = []
  const snapshots = Object.fromEntries(Object.entries(values).map(([key, value], index) => [key, {
    status: 'ready', writable: true, revision: index + 4, value: structuredClone(value), ...options.snapshots?.[key],
  }]))
  const listeners = { router: new Set(), codex: new Set(), acp: new Set(), agy: new Set() }
  const runtime = createReactRuntime()
  const doc = runtime.createDocument()
  let activeLang = options.lang || 'key'

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
  vm.runInNewContext(clientSource, {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => runtime.React) } } },
    document: doc,
    fetch: async (url) => {
      const owner = url.endsWith('codex') ? 'codex' : url.endsWith('agy') ? 'agy' : 'acp'
      calls.push(owner)
      catalogRequests.push(url)
      if (options.catalogFailure === owner) throw new Error('private diagnostic must not enter UI')
      if (options.catalogReason?.[owner]) {
        return { ok: true, json: async () => ({ ok: false, error: { code: 'catalog', reason: options.catalogReason[owner], message: 'Model catalog is unavailable' } }) }
      }
      return { ok: true, json: async () => ({ ok: true, value: catalogs[owner] }) }
    },
  })
  const bindTranslator = () => (key) => {
    if (activeLang === 'key') return key
    const dict = dictionaries.find((entry) => entry.ns === '@kiritoko1029/dsh-multi-agent')?.dict
    return dict?.[activeLang]?.[key] ?? key
  }
  const slotRegistry = new Set()
  plugin.apply({
    effect: (fn) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') effectCleanups.push(cleanup)
      return cleanup
    },
    locale: {
      register: (ns, dict) => {
        const entry = { ns, dict }
        dictionaries.push(entry)
        return () => {
          const idx = dictionaries.indexOf(entry)
          if (idx >= 0) dictionaries.splice(idx, 1)
        }
      },
      bind: bindTranslator,
    },
    configForms: { get: (ns) => { requestedForms.push(ns); return forms[ns] } },
    remote: { session: { modelCatalog: async () => { calls.push('dsh'); return { ok: true, value: catalogs.dsh } } } },
    slots: {
      inject: (name, callback) => {
        slotInjections.push(name)
        const cleanup = callback()
        if (typeof cleanup === 'function') slotCleanups.push(cleanup)
        return cleanup
      },
      register: (spec, component) => {
        const reg = { spec, component }
        registrations.push(reg)
        slotRegistry.add(reg)
        return () => slotRegistry.delete(reg)
      },
    },
  })

  const headerEntry = registrations.find(({ spec }) => spec.name === 'conversation.session.header.utilities')
  const overlayEntry = registrations.find(({ spec }) => spec.name === 'shell.overlay')
  const mounted = runtime.mountSlots({
    ...(headerEntry ? { header: headerEntry } : {}),
    ...(overlayEntry ? { overlay: overlayEntry } : {}),
  }, doc)

  return {
    plugin, registrations, slotInjections, slotRegistry, snapshots, writes, calls, catalogRequests, requestedForms, dictionaries, doc, mounted,
    headerEntry, overlayEntry,
    renderAll(slotProps) { return mounted.renderAll(slotProps) },
    renderHeader() { return mounted.renderAll().header },
    render() { return mounted.renderAll().overlay },
    open() {
      const header = this.renderHeader()
      const trigger = control(header, 'multi-agent-dispatch-trigger')
      assert.ok(trigger, 'header dispatch button must exist')
      trigger.props.onClick()
      return this.render()
    },
    async load() {
      this.open()
      await new Promise((resolve) => setImmediate(resolve))
      return this.render()
    },
    edit(name, value) { control(this.render(), name).props.onChange({ target: { value } }) },
    click(name) {
      const target = control(this.render(), name) || button(this.render(), name)
      assert.ok(target, `control ${name} must exist`)
      target.props.onClick?.()
    },
    async save() {
      const formNode = nodes(this.render(), 'form')[0]
      assert.ok(formNode, 'settings form must exist inside modal')
      return formNode.props.onSubmit({ preventDefault() {} })
    },
    update(owner, patch) { snapshots[owner] = { ...snapshots[owner], ...patch }; for (const listener of listeners[owner]) listener() },
    dispose() {
      mounted.dispose()
      for (const cleanup of effectCleanups) cleanup()
      assert.equal(slotRegistry.size, 0, 'all slot registrations must clean up')
      assert.equal(doc.listeners.keydown.size, 0, 'document keydown listeners must clean up')
      assert.equal(doc.listeners.focusin.size, 0, 'document focusin listeners must clean up')
      assert.ok(Object.values(listeners).every((set) => set.size === 0), 'form listeners must clean up')
    },
  }
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return []
  return [...(!type || tree.type === type ? [tree] : []), ...(tree.children || []).flatMap((child) => nodes(child, type))]
}
const control = (tree, name) => ['input', 'select', 'textarea', 'button'].flatMap((type) => nodes(tree, type)).find((node) => node.props.name === name)
const button = (tree, name) => nodes(tree, 'button').find((node) => node.props.name === name)
const listValues = (tree, name) => {
  const id = control(tree, name).props.list
  return nodes(tree, 'datalist').find((list) => list.props.id === id).children.map((child) => child.props.value)
}
const textOf = (tree) => {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (tree.type === 'style') return ''
  return (tree.children || []).map(textOf).join(' ')
}

test('removes settings.section and registers header utility and shell.overlay with no factory side effects', async () => {
  const app = setup({ lang: 'zh' })
  assert.ok(!app.slotInjections.includes('settings.section'), 'settings.section must not be injected')
  assert.equal(app.registrations.some(({ spec }) => spec.name === 'settings.section'), false, 'settings.section must not be registered')
  assert.deepEqual(
    app.registrations.map(({ spec }) => [spec.name, spec.id, spec.order]),
    [
      ['conversation.session.header.utilities', 'multi-agent-dispatch', 30],
      ['shell.overlay', 'multi-agent-dispatch', 30],
    ],
  )
  assert.equal(app.headerEntry.spec.label(), '多 Agent 派发')
  assert.equal(app.headerEntry.spec.locale, '@kiritoko1029/dsh-multi-agent')
  assert.equal(app.overlayEntry.spec.locale, '@kiritoko1029/dsh-multi-agent')

  const initial = app.renderAll()
  assert.equal(initial.overlay, null, 'overlay must render null when closed')
  const trigger = control(initial.header, 'multi-agent-dispatch-trigger')
  assert.equal(trigger.props['aria-label'], '多 Agent 派发')
  assert.equal(trigger.props.title, '打开多 Agent 派发设置')
  assert.equal(trigger.props['aria-haspopup'], 'dialog')
  assert.equal(trigger.props['aria-expanded'], false)
  assert.match(textOf(trigger), /多 Agent 派发/)

  const tree = await app.load()
  const reopenedHeader = app.renderHeader()
  assert.equal(control(reopenedHeader, 'multi-agent-dispatch-trigger').props['aria-expanded'], true)
  const dialog = nodes(tree, 'div').find((node) => node.props.role === 'dialog')
  assert.ok(dialog, 'overlay must render dialog when opened')
  assert.equal(dialog.props['aria-modal'], true)
  assert.equal(dialog.props['aria-labelledby'], 'ma-dispatch-modal-title')
  assert.equal(dialog.props['aria-describedby'], 'ma-dispatch-modal-desc')
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
  assert.ok(JSON.stringify(app.render()).includes('common.modelsErrorReason.unavailable'))
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

test('catalog failures state an actionable reason without leaking CLI output', async () => {
  const app = setup({ catalogReason: { agy: 'auth' } })
  const tree = await app.load()
  const rendered = JSON.stringify(tree)
  assert.ok(rendered.includes('common.modelsError'))
  assert.ok(rendered.includes('common.modelsErrorReason.auth'))
  assert.ok(!rendered.includes('private diagnostic'))
  assert.equal(control(tree, 'agy.model').props.value, 'agy/gemini-test')
  app.dispose()
})

test('proxy settings default to the system proxy and validate a custom address', async () => {
  const app = setup()
  let tree = await app.load()
  assert.equal(control(tree, 'agy.proxyMode').props.value, 'system')
  assert.equal(control(tree, 'agy.proxyUrl'), undefined)
  app.edit('agy.proxyMode', 'custom')
  tree = app.render()
  assert.equal(control(tree, 'agy.proxyUrl').props.value, '')
  app.edit('agy.proxyUrl', 'not a url')
  await app.save()
  assert.equal(app.writes.agy.length, 0)
  assert.ok(JSON.stringify(app.render()).includes('common.invalidProxyUrl'))
  app.edit('agy.proxyUrl', '127.0.0.1:7890')
  await app.save()
  assert.deepEqual(app.writes.agy[0].ops, [
    { op: 'set', path: ['proxyMode'], value: 'custom' },
    { op: 'set', path: ['proxyUrl'], value: '127.0.0.1:7890' },
  ])
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
  const dict = app.dictionaries.find((entry) => entry.ns === '@kiritoko1029/dsh-multi-agent').dict
  assert.deepEqual(Object.keys(dict.en).sort(), Object.keys(dict.zh).sort())
  for (const key of Object.keys(dict.en)) {
    assert.equal(typeof dict.en[key], 'string', `en ${key}`)
    assert.ok(dict.en[key].trim().length > 0, `en ${key} non-empty`)
    assert.equal(typeof dict.zh[key], 'string', `zh ${key}`)
    assert.ok(dict.zh[key].trim().length > 0, `zh ${key} non-empty`)
  }
  assert.equal(dict.en['unified.title'], 'Multi-agent dispatch')
  assert.equal(dict.zh['unified.title'], '多 Agent 派发')
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

test('modal closes via close button, Escape, and backdrop click with focus capture, restoration, and Tab trap', async () => {
  const app = setup()
  await app.load()
  const triggerNode = [...app.mounted.hostNodes.values()].find((node) => node.name === 'multi-agent-dispatch-trigger')
  const closeNode = [...app.mounted.hostNodes.values()].find((node) => node.name === 'modal-close')
  const dialogHost = [...app.mounted.hostNodes.values()].find((node) => node.name === 'ma-modal')
  assert.ok(triggerNode && closeNode && dialogHost)
  assert.equal(app.doc.activeElement, closeNode, 'opening modal moves focus inside modal')
  assert.equal(app.doc.listeners.keydown.size, 1)
  assert.equal(app.doc.listeners.focusin.size, 1)

  // Tab trap wraps from last focusable to first and Shift+Tab wraps backwards.
  const focusables = dialogHost.querySelectorAll()
  assert.ok(focusables.length > 5)
  const first = focusables[0]
  const last = focusables.at(-1)
  app.doc.activeElement = last
  let prevented = false
  app.doc.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(app.doc.activeElement, first)

  prevented = false
  app.doc.dispatch('keydown', { key: 'Tab', shiftKey: true, preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(app.doc.activeElement, last)

  // Focus escaping outside modal is pulled back inside while open.
  app.doc.dispatch('focusin', { target: triggerNode })
  assert.equal(dialogHost.contains(app.doc.activeElement), true)

  // IME composing Escape does not close the modal.
  app.doc.dispatch('keydown', { key: 'Escape', isComposing: true, preventDefault() {}, stopPropagation() {} })
  assert.ok(app.render(), 'composing Escape must not close modal')

  // Close button closes and restores focus to trigger.
  app.click('modal-close')
  assert.equal(app.render(), null)
  assert.equal(app.doc.activeElement, triggerNode, 'closing modal restores focus to header button')
  assert.equal(app.doc.listeners.keydown.size, 0)
  assert.equal(app.doc.listeners.focusin.size, 0)

  // Reopen and close via Escape.
  await app.load()
  app.doc.dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} })
  assert.equal(app.render(), null)
  assert.equal(app.doc.activeElement, triggerNode)

  // Reopen, drag from inner node onto backdrop must not close; direct backdrop click closes.
  let tree = await app.load()
  tree.props.onMouseDown({ target: { inner: true }, currentTarget: tree })
  tree.props.onClick({ target: tree, currentTarget: tree })
  assert.ok(app.render(), 'mouse drag starting inside modal must not close on backdrop mouseup')

  tree = app.render()
  tree.props.onMouseDown({ target: tree, currentTarget: tree })
  tree.props.onClick({ target: tree, currentTarget: tree })
  assert.equal(app.render(), null, 'direct backdrop click closes clean modal')
  assert.equal(app.doc.activeElement, triggerNode)
  app.dispose()
})

test('unsaved edits block silent close and allow continuing, saving & closing, or discarding', async () => {
  const app = setup()
  await app.load()
  app.edit('timeoutSeconds', '900')

  // Close button / Escape / backdrop show unsaved confirmation instead of silently dropping edits.
  app.click('modal-close')
  let tree = app.render()
  assert.ok(tree, 'modal must stay open when edits exist')
  assert.ok(nodes(tree, 'div').some((node) => node.props.role === 'alertdialog'))
  assert.equal(control(tree, 'timeoutSeconds').props.value, '900')

  // Escape while confirmation is visible returns to editing without discarding edits.
  app.doc.dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} })
  tree = app.render()
  assert.equal(nodes(tree, 'div').some((node) => node.props.role === 'alertdialog'), false)
  assert.equal(control(tree, 'timeoutSeconds').props.value, '900')

  // Backdrop click also triggers confirmation; Discard & close drops edits and closes.
  tree.props.onClick({ target: tree, currentTarget: tree })
  tree = app.render()
  assert.ok(nodes(tree, 'div').some((node) => node.props.role === 'alertdialog'))
  app.click('modal-discard-and-close')
  assert.equal(app.render(), null)
  assert.equal(app.writes.router.length, 0)

  // Reopen: invalid Save & close keeps modal open with error; valid Save & close writes and closes.
  await app.load()
  assert.equal(control(app.render(), 'timeoutSeconds').props.value, 1800)
  app.edit('acp.env', '{invalid')
  app.click('modal-close')
  await control(app.render(), 'modal-save-and-close').props.onClick()
  tree = app.render()
  assert.ok(tree, 'failed Save & close must keep modal open')
  assert.ok(JSON.stringify(tree).includes('common.invalidJson'))
  assert.equal(control(tree, 'acp.env').props.value, '{invalid')

  app.edit('acp.env', '{"MODE":"fast"}')
  app.click('modal-close')
  await control(app.render(), 'modal-save-and-close').props.onClick()
  assert.equal(app.render(), null, 'successful Save & close closes modal')
  assert.equal(app.snapshots.acp.value.env.MODE, 'fast')
  app.dispose()
})

test('section navigation filters views cleanly while preserving edits and auto-focuses error sections', async () => {
  const app = setup()
  await app.load()
  app.edit('acp.env', '{bad json')
  app.click('nav-models')
  let tree = app.render()
  assert.ok(control(tree, 'codex.model'))
  assert.equal(control(tree, 'selectionMode'), undefined)
  assert.equal(control(tree, 'acp.env'), undefined)

  // Validation error in runtime field jumps back to runtime section so error field is visible.
  await app.save()
  tree = app.render()
  assert.ok(control(tree, 'acp.env'), 'validation failure switches to offending section')
  assert.ok(JSON.stringify(tree).includes('common.invalidJson'))

  app.click('nav-policy')
  tree = app.render()
  assert.ok(control(tree, 'selectionMode'))
  assert.ok(control(tree, 'route.0.prompt'))
  assert.equal(control(tree, 'codex.model'), undefined)

  app.click('nav-all')
  tree = app.render()
  assert.ok(control(tree, 'codex.model'))
  assert.ok(control(tree, 'selectionMode'))
  assert.ok(control(tree, 'acp.env'))
  app.dispose()
})

test('loading, unavailable, and readonly states still render an accessible closable modal', async () => {
  const loading = setup({ snapshots: { router: { status: 'loading', writable: false } } })
  loading.open()
  let tree = loading.render()
  assert.ok(nodes(tree, 'div').some((node) => node.props.role === 'dialog'))
  assert.ok(JSON.stringify(tree).includes('common.loading'))
  loading.click('modal-footer-close')
  assert.equal(loading.render(), null)
  loading.dispose()

  const unavailable = setup({ snapshots: { router: { status: 'unavailable', writable: false } } })
  unavailable.open()
  tree = unavailable.render()
  assert.ok(JSON.stringify(tree).includes('common.unavailable'))
  unavailable.click('modal-close')
  assert.equal(unavailable.render(), null)
  unavailable.dispose()

  const readonly = setup({ snapshots: { router: { status: 'ready', writable: false } } })
  await readonly.load()
  tree = readonly.render()
  assert.ok(JSON.stringify(tree).includes('common.readonly'))
  assert.equal(button(tree, 'save-changes').props.disabled, true)
  readonly.doc.dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} })
  assert.equal(readonly.render(), null)
  readonly.dispose()
})

test('client styles use only --dsw-alias-* tokens, restore overlay pointer-events, and avoid Host DOM portals', async () => {
  const app = setup()
  const header = app.renderHeader()
  const overlay = await app.load()
  const styles = [...nodes(header, 'style'), ...nodes(overlay, 'style')].map((node) => node.children.join('')).join('\n')
  const cssVars = [...styles.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((match) => match[1])
  assert.ok(cssVars.length > 0)
  assert.ok(cssVars.every((name) => name.startsWith('--dsw-alias-')), `unexpected CSS variable: ${cssVars.join(', ')}`)
  assert.ok(!cssVars.includes('--dsw-alias-brand-primary-soft'), 'current DSH themes do not provide brand-primary-soft')
  assert.doesNotMatch(styles, /#[0-9a-fA-F]{3,8}\b|\brgba?\(/, 'must not hardcode hex or rgb colors')
  assert.match(styles, /\.ma-overlay-backdrop\{[^}]*pointer-events:auto/)
  assert.match(styles, /min\(1180px,calc\(100vw - 48px\)\)/)
  assert.match(styles, /85vh/)
  assert.doesNotMatch(clientSource, /document\.body|createPortal/)
  app.dispose()
})
