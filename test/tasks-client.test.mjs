import test from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const MarkdownIt = require('markdown-it')
const sourceUrl = new URL('../tasks-client.js', import.meta.url)
const source = readFileSync(sourceUrl, 'utf8')

function timers() {
  let now = 0
  let sequence = 0
  const pending = new Map()
  return {
    setTimeout(callback, delay = 0) {
      const id = ++sequence
      pending.set(id, { callback, at: now + Number(delay) })
      return id
    },
    clearTimeout(id) { pending.delete(id) },
    get size() { return pending.size },
    async advance(ms) {
      now += ms
      for (;;) {
        const next = [...pending.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        pending.delete(next[0])
        next[1].callback()
        await new Promise((resolve) => setImmediate(resolve))
      }
    },
  }
}

function animationFrames() {
  let sequence = 0
  const pending = new Map()
  const cancelled = new Set()
  return {
    request(callback) {
      const id = ++sequence
      pending.set(id, callback)
      return id
    },
    cancel(id) {
      cancelled.add(id)
      pending.delete(id)
    },
    flush() {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback()
    },
    cancelled,
    get size() { return pending.size },
  }
}

function observerHarness() {
  const records = []
  const make = (kind) => class {
    constructor(callback) {
      this.kind = kind
      this.callback = callback
      this.targets = []
      this.disconnected = false
      records.push(this)
    }
    observe(target) { this.targets.push(target) }
    disconnect() { this.disconnected = true }
    trigger() { this.callback([], this) }
  }
  return { records, ResizeObserver: make('resize'), MutationObserver: make('mutation') }
}

function reactRuntime() {
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
    useLayoutEffect: (...args) => active.api.useLayoutEffect(...args),
    useMemo: (...args) => active.api.useMemo(...args),
    useCallback: (...args) => active.api.useCallback(...args),
  }
  function renderer(component, initialProps, options = {}) {
    let props = initialProps
    let tree
    let disposed = false
    let pendingLayout = []
    let pendingEffects = []
    const instances = new Map()
    const hostRefs = new Map()
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
          pendingEffects.push({ record: active.record, index, effect, deps, previous, kind: 'effect' })
          cells[index] = { deps, cleanup: previous?.cleanup }
        }
      },
      useLayoutEffect(effect, deps) {
        const index = active.cursor++
        const cells = active.record.cells
        const previous = cells[index]
        if (!previous || !same(previous.deps, deps)) {
          pendingLayout.push({ record: active.record, index, effect, deps, previous, kind: 'layout' })
          cells[index] = { deps, cleanup: previous?.cleanup }
        }
      },
      useMemo(factory, deps) {
        const index = active.cursor++
        const cells = active.record.cells
        const previous = cells[index]
        if (!previous || !same(previous.deps, deps)) cells[index] = { deps, value: factory() }
        return cells[index].value
      },
      useCallback(callback, deps) {
        return api.useMemo(() => callback, deps)
      },
      render(nextProps) {
        if (disposed) return tree
        if (nextProps) props = nextProps
        pendingLayout = []
        pendingEffects = []
        const seen = new Set()
        const currentRefs = new Map()
        const expand = (node, path) => {
          if (node === null || node === undefined || typeof node !== 'object') return node
          const key = node.props?.key ?? ''
          if (typeof node.type === 'function') {
            const id = `${path}/component-${typeId(node.type)}:${key}`
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
            return expand(rendered, id)
          }
          const refPath = `${path}/host-${node.type}:${key}`
          if (node.props?.ref) currentRefs.set(refPath, { ref: node.props.ref, props: node.props })
          return { ...node, children: (node.children || []).map((child, index) => expand(child, `${refPath}/${index}`)) }
        }
        tree = expand(React.createElement(component, props), 'root')
        for (const [id, record] of instances) {
          if (seen.has(id)) continue
          disposeRecord(record)
          instances.delete(id)
        }
        for (const [path, binding] of hostRefs) {
          if (currentRefs.has(path)) continue
          assignRef(binding.ref, null)
          hostRefs.delete(path)
        }
        for (const [path, current] of currentRefs) {
          const previous = hostRefs.get(path)
          if (previous?.ref === current.ref) continue
          if (previous) assignRef(previous.ref, null)
          const node = previous?.node ?? options.createNode?.(current.props, path) ?? null
          hostRefs.set(path, { ...current, node })
          assignRef(current.ref, node)
        }
        const flush = (pending) => {
          for (const item of pending) {
            if (item.record.disposed) continue
            item.previous?.cleanup?.()
            const cleanup = item.effect()
            item.record.cells[item.index] = {
              deps: item.deps,
              cleanup: typeof cleanup === 'function' ? cleanup : undefined,
            }
          }
        }
        flush(pendingLayout)
        flush(pendingEffects)
        active = undefined
        return tree
      },
      async settle(nextProps) {
        for (let index = 0; index < 6; index++) {
          api.render(nextProps)
          await new Promise((resolve) => setImmediate(resolve))
        }
        return api.render()
      },
      dispose() {
        if (disposed) return
        disposed = true
        for (const record of instances.values()) disposeRecord(record)
        for (const binding of hostRefs.values()) assignRef(binding.ref, null)
        instances.clear()
        hostRefs.clear()
      },
      get tree() { return tree },
    }
    return api
  }
  return { React, renderer }
}

function catalog(entries) {
  return Object.fromEntries(entries.map((entry) => [entry.id, entry]))
}

function setup(options = {}) {
  let plugin
  let moduleId
  const runtime = reactRuntime()
  const clock = options.clock || timers()
  const frames = options.frames || animationFrames()
  const requests = []
  const effects = new Set()
  const opened = []
  const files = []
  const tabRegistrations = []
  const slotRegistrations = []
  const slotInjections = []
  const eventDefinitions = []
  const listeners = new Set()
  let listSnapshot = options.list || { byId: {}, projectionsBySession: {} }
  let mounted = Object.hasOwn(options, 'mounted') ? options.mounted : 'parent-1'
  const dictionaries = []
  const fetchImpl = options.fetch || (async () => jsonResponse({ ok: true, value: { revision: 1, tasks: [] } }))
  const context = {
    window: {
      __ModuleLoader__: {
        load(registration) {
          moduleId = registration.id
          plugin = registration.factory((id) => {
            if (id === 'react') return runtime.React
            assert.equal(id, 'markdown-it')
            return MarkdownIt
          })
        },
      },
    },
    fetch: async (url, init) => {
      requests.push({ url, init })
      return fetchImpl(url, init)
    },
    AbortController,
    URLSearchParams,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    requestAnimationFrame: frames.request,
    cancelAnimationFrame: frames.cancel,
    ...(options.observers ? { ResizeObserver: options.observers.ResizeObserver, MutationObserver: options.observers.MutationObserver } : {}),
    console: { warn() {}, error() {} },
  }
  vm.runInNewContext(source, context, { filename: 'tasks-client.js' })
  const ctx = {
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') effects.add(dispose)
      return dispose
    },
    locale: {
      register(...args) { dictionaries.push(args); return () => {} },
      bind() {
        return (key, values = {}) => {
          const dict = dictionaries[0]?.[1]?.en || dictionaries[0]?.[2]?.en || {}
          return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dict[key] || key)
        }
      },
    },
    sidebarRightTabs: {
      register(definition) { tabRegistrations.push(definition); return () => {} },
    },
    sidebarRight: {
      mounted: { getSnapshot: () => mounted },
      openTab(kind, tabOptions) { opened.push({ kind, options: tabOptions }) },
      openResource(address) { files.push({ address }) },
    },
    sessions: {
      list: {
        getSnapshot: () => listSnapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      },
    },
    uiConversation: {
      events: { register(definition) { eventDefinitions.push(definition); return () => {} } },
    },
    slots: {
      inject(name, callback) { slotInjections.push(name); return callback() },
      register(spec, component) { slotRegistrations.push({ spec, component }); return () => {} },
    },
  }
  plugin.apply(ctx)
  const taskPanel = slotRegistrations.find((registration) => registration.spec.name === 'sidebar.right.pane.tab')
  const completion = slotRegistrations.find((registration) => registration.spec.name === 'conversation.chat.node')
  return {
    plugin, moduleId, requests, opened, files, tabRegistrations, slotRegistrations, slotInjections, eventDefinitions, dictionaries, clock, frames,
    taskPanel, completion,
    renderer: runtime.renderer,
    setList(next) { listSnapshot = next; for (const listener of [...listeners]) listener() },
    setMounted(next) { mounted = next },
    get listenerCount() { return listeners.size },
    dispose() { for (const dispose of effects) dispose(); effects.clear() },
  }
}

function nativePanelProps(props) {
  const parentSessionId = props.tab?.meta?.parentSessionId || props.scope?.sessionId
  return {
    sessionId: props.scope?.sessionId,
    useTabInfo: () => ({
      tab: {
        visible: props.visible,
        navigation: {
          params: {
            ...(parentSessionId ? { parentSessionId } : {}),
            ...(props.tab?.meta?.childId ? { childId: props.tab.meta.childId } : {}),
            ...(props.scope?.cwd ? { cwd: props.scope.cwd } : {}),
          },
          revision: props.tab?.navigationRevision ?? 0,
        },
      },
    }),
  }
}

function renderSidebarBody(app, props, options) {
  return app.renderer((nextProps) => app.taskPanel.component(nativePanelProps(nextProps)), props, options)
}

function jsonResponse(value, ok = true) {
  return { ok, json: async () => value }
}

function listWith(parentSessionId, entries, cwd = '/workspace') {
  return {
    byId: { [parentSessionId]: { id: parentSessionId, cwd } },
    projectionsBySession: {
      [parentSessionId]: { values: { subagentCatalog: entries } },
    },
  }
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return []
  return [...(!type || tree.type === type ? [tree] : []), ...(tree.children || []).flatMap((child) => nodes(child, type))]
}

function named(tree, name) {
  return nodes(tree).find(() => true)
}

function control(tree, name) {
  return nodes(tree, 'button').find((node) => node.props.name === name)
}

function assertFollowState(tree, following) {
  assert.equal(control(tree, 'jump-latest') !== undefined, !following)
  assert.doesNotMatch(text(tree), /Following latest activity|Paused while reading|正在跟随最新活动|已暂停跟随/)
}

function text(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (tree.type === 'style') return ''
  return (tree.children || []).map(text).join(' ')
}

function completionNode() {
  return {
    key: 'chat:1', kind: 'multi-agent-dispatch-settled', id: '1', target: 'chat', anchorSeq: 9,
    location: { kind: 'unresolved' }, visibility: 'visible',
    data: {
      seq: 9, time: 100,
      source: { kind: 'subagent-settled', form: 'notice', summary: 'Background subagent child-1 finished.', senderSessionId: 'child-1' },
      text: 'Background subagent child-1 finished.\nIts closing message:\nOriginal answer.',
    },
  }
}

const summary = {
  childId: 'child-1', parentSessionId: 'parent-1', agent: 'codex', label: 'Build task UI', cwd: '/workspace',
  reportPath: '/workspace/.dsh/agent-reports/task.md', status: 'running', startedAt: 1000, updatedAt: 4000,
}

test('registers the native right-sidebar definition, body and settlement renderer', () => {
  const app = setup()
  assert.equal(app.moduleId, 'dsh-multi-agent/tasks-ui')
  assert.deepEqual(app.plugin.inject, ['sidebarRightTabs', 'sidebarRight', 'sessions', 'uiConversation', 'slots', 'locale'])
  assert.equal(app.tabRegistrations.length, 1)
  const definition = app.tabRegistrations[0]
  assert.equal(definition.id, 'dsh-multi-agent/tasks')
  assert.equal(definition.kind, 'multi-agent:tasks')
  assert.equal(definition.keepMounted, true)
  assert.equal(definition.title(), 'Agent tasks')
  assert.equal(definition.guide.length, 1)
  assert.equal(definition.guide[0].id, 'tasks')
  assert.equal(definition.guide[0].order, 35)
  assert.equal(definition.guide[0].title(), 'Agent tasks')
  assert.equal(definition.guide[0].description(), 'A live console for delegated work in this main session.')
  assert.equal(app.taskPanel.spec.name, 'sidebar.right.pane.tab')
  assert.equal(app.taskPanel.spec.key, 'dsh-multi-agent/tasks')
  assert.equal(app.taskPanel.spec.locale, 'dsh-multi-agent-tasks-ui')
  assert.ok(app.slotInjections.includes('sidebar.right.pane.tab'))
  assert.equal(app.eventDefinitions[0].kind, 'multi-agent-dispatch-settled')
  assert.equal(app.completion.spec.name, 'conversation.chat.node')
  assert.equal(app.completion.spec.key, 'multi-agent-dispatch-settled')
  assert.equal(app.listenerCount, 1)
  app.dispose()
  assert.equal(app.listenerCount, 0)
})

test('auto-opens only new external catalog entries in the owning on-screen parent session', () => {
  const original = listWith('parent-1', [{ id: 'old', mode: 'external', createdAt: 1 }])
  const app = setup({ list: original })
  assert.equal(app.opened.length, 0)
  app.setList(listWith('parent-1', [
    { id: 'old', mode: 'external', createdAt: 1 },
    { id: 'local', mode: 'one-shot', createdAt: 2 },
    { id: 'new-external', mode: 'external', createdAt: 3, label: 'New task' },
  ], '/parent/cwd'))
  assert.equal(app.opened.length, 1)
  assert.deepEqual(app.opened[0], {
    kind: 'multi-agent:tasks',
    options: { params: { parentSessionId: 'parent-1', childId: 'new-external', cwd: '/parent/cwd' } },
  })
  app.setList(listWith('parent-1', [
    { id: 'old', mode: 'external', createdAt: 1 },
    { id: 'local', mode: 'one-shot', createdAt: 2 },
    { id: 'new-external', mode: 'external', createdAt: 3 },
  ]))
  assert.equal(app.opened.length, 1)
  app.dispose()
})

test('a historical parent is a baseline and background parents never open in another session', () => {
  const app = setup({ mounted: 'parent-1' })
  app.setList(listWith('historical', [{ id: 'old', mode: 'external' }]))
  assert.equal(app.opened.length, 0)
  app.setList(listWith('historical', [{ id: 'old', mode: 'external' }, { id: 'new', mode: 'external' }]))
  assert.equal(app.opened.length, 0)
  app.dispose()
})

test('new background work is not opened without an on-screen session', () => {
  const original = listWith('parent-1', [{ id: 'old', mode: 'external' }])
  const app = setup({ list: original, mounted: undefined })
  app.setList(listWith('parent-1', [{ id: 'old', mode: 'external' }, { id: 'new', mode: 'external' }]))
  assert.equal(app.opened.length, 0)
  app.dispose()
})

test('completion definition claims only subagent settlement and preserves renderer-ready original text', () => {
  const app = setup()
  const definition = app.eventDefinitions[0]
  assert.equal(definition.match({ type: 'assistant/message', data: {} }), null)
  assert.equal(definition.match({ type: 'user/message', data: { id: '2', source: { kind: 'user' } } }), null)
  const event = {
    type: 'user/message', seq: 9, time: 100,
    data: {
      id: '2',
      source: { kind: 'subagent-settled', summary: 'Settled.', senderSessionId: 'child-1' },
      content: [{ type: 'text', text: 'Settled.' }, { type: 'thinking', text: 'private reasoning' }, { type: 'text', text: 'Answer.' }],
    },
  }
  assert.deepEqual(definition.match(event), { id: '2', role: 'start', exclusive: true })
  const state = definition.start({}, { event })
  assert.equal(state.text, 'Settled.\nAnswer.')
  assert.equal(Object.hasOwn(state.source, 'stopReason'), false, 'legacy notices keep their absent reason')
  const modern = definition.start({}, { event: { ...event, data: { ...event.data, source: { ...event.data.source, stopReason: 'refusal' } } } })
  assert.equal(modern.source.stopReason, 'refusal')
  assert.equal(JSON.stringify(state).includes('private reasoning'), false)
  const node = definition.buildViewNode({ key: 'kind:2', id: '2', state, start: { event, location: { kind: 'turn', turn: 1 } }, matches: [] })
  assert.equal(node.kind, 'multi-agent-dispatch-settled')
  assert.equal(node.anchorSeq, 9)
  assert.deepEqual(node.location, { kind: 'turn', turn: 1 })
  assert.equal(node.data.text, 'Settled.\nAnswer.')
  app.dispose()
})

test('an invisible panel does no I/O; a visible panel fetches the owner route and renders main-session tasks', async () => {
  const app = setup({ fetch: async () => jsonResponse({ ok: true, value: { revision: 4, tasks: [summary] } }) })
  const props = { scope: { sessionId: 'parent-1', cwd: '/workspace' }, tab: { meta: {} }, visible: false }
  const view = renderSidebarBody(app, props)
  await view.settle()
  assert.equal(app.requests.length, 0)
  const tree = await view.settle({ ...props, visible: true })
  assert.equal(app.requests[0].url, '/multi-agent/tasks?parentSessionId=parent-1')
  assert.equal(app.requests[0].init.credentials, 'same-origin')
  assert.ok(app.requests[0].init.signal instanceof AbortSignal)
  assert.match(text(tree), /Main session/)
  assert.match(text(tree), /parent-1/)
  assert.match(text(tree), /Build task UI/)
  assert.match(text(tree), /Codex|codex/)
  assert.match(text(tree), /Running/)
  view.dispose()
  app.dispose()
})

test('the native body maps navigation params and tab visibility into the task panel', async () => {
  const app = setup({ fetch: async (url) => jsonResponse(url.includes('childId=')
    ? { ok: true, value: { task: summary } }
    : { ok: true, value: { revision: 1, tasks: [summary] } }) })
  let visible = false
  let revision = 1
  const props = {
    sessionId: 'mounted-parent',
    useTabInfo: () => ({
      tab: {
        visible,
        navigation: {
          params: { parentSessionId: 'navigation-parent', childId: 'child-1', cwd: '/navigation/cwd' },
          revision,
        },
      },
    }),
  }
  const view = app.renderer(app.taskPanel.component, props)
  await view.settle()
  assert.equal(app.requests.length, 0)
  visible = true
  revision = 2
  const tree = await view.settle()
  assert.ok(app.requests.some((request) => request.url === '/multi-agent/tasks?parentSessionId=navigation-parent'))
  assert.ok(app.requests.some((request) => request.url === '/multi-agent/tasks?parentSessionId=navigation-parent&childId=child-1'))
  assert.match(text(tree), /navigation-parent/)
  assert.equal(workspace(tree).props['data-task-id'], 'child-1')
  view.dispose()
  app.dispose()
})

test('the native start page uses its body session when navigation params are absent', async () => {
  const app = setup()
  const view = app.renderer(app.taskPanel.component, {
    sessionId: 'start-parent',
    useTabInfo: () => ({ tab: { visible: true, navigation: { revision: 0 } } }),
  })
  await view.settle()
  assert.equal(app.requests[0].url, '/multi-agent/tasks?parentSessionId=start-parent')
  assert.match(text(view.tree), /start-parent/)
  view.dispose()
  app.dispose()
})

test('the selected tab loads real activities, normalizes output and opens its Host report path', async () => {
  const detail = {
    ...summary, status: 'completed', finishedAt: 6000,
    output: [{ type: 'text', text: 'First.' }, { type: 'thinking', text: 'hidden' }, { type: 'text', text: 'Second.' }],
    activities: [
      { id: 'm1', type: 'message', time: 2000, text: 'Actual child message' },
      { id: 't1', type: 'tool', time: 3000, title: 'Read file', status: 'completed', text: 'client.js' },
      { id: 'x1', type: 'thinking', time: 3500, text: 'private chain' },
    ],
  }
  const app = setup({ fetch: async (url) => jsonResponse(url.includes('childId=')
    ? { ok: true, value: { task: detail } }
    : { ok: true, value: { revision: 1, tasks: [summary] } }) })
  const view = renderSidebarBody(app,{
    scope: { sessionId: 'parent-1', cwd: '/workspace' }, tab: { meta: {} }, visible: true,
  })
  const tree = await view.settle()
  assert.ok(app.requests.some((request) => request.url === '/multi-agent/tasks?parentSessionId=parent-1&childId=child-1'))
  assert.match(text(tree), /Actual child message/)
  assert.match(text(tree), /Read file/)
  assert.match(text(tree), /First\.\s+Second\./)
  assert.doesNotMatch(text(tree), /private chain|hidden/)
  assert.equal(nodes(tree, 'details').some((node) => node.props['data-task-id'] === 'child-1'), false)
  control(tree, 'report-child-1').props.onClick()
  assert.deepEqual(app.files, [{ address: 'dsh-resource://file/session/parent-1//workspace/.dsh/agent-reports/task.md' }])
  view.dispose()
  app.dispose()
})

test('selected-detail polling is visibility gated, retries null detail, and disposal aborts in-flight work', async () => {
  const clock = timers()
  let detailReads = 0
  const app = setup({
    clock,
    fetch: async (url) => {
      if (url.includes('childId=')) {
        detailReads += 1
        return jsonResponse({ ok: true, value: { task: detailReads === 1 ? null : summary } })
      }
      return jsonResponse({ ok: true, value: { revision: detailReads, tasks: [summary] } })
    },
  })
  const props = { scope: { sessionId: 'parent-1' }, tab: { meta: {} }, visible: true }
  const view = renderSidebarBody(app, props)
  await view.settle()
  assert.equal(app.requests.length, 2)
  assert.equal(detailReads, 1)
  const pendingBefore = clock.size
  await clock.advance(1500)
  await view.settle()
  assert.ok(detailReads >= 2, 'a null detail retries after the Host binding appears')
  const summaryReads = app.requests.filter((request) => !request.url.includes('childId=')).length
  const detailAfter = detailReads
  await view.settle({ ...props, visible: false })
  const pendingSignals = app.requests.map((request) => request.init.signal)
  await clock.advance(5000)
  assert.equal(app.requests.filter((request) => !request.url.includes('childId=')).length, summaryReads)
  assert.equal(detailReads, detailAfter)
  assert.ok(pendingSignals.every((signal) => signal.aborted))
  assert.ok(pendingBefore > 0)
  view.dispose()
  assert.equal(clock.size, 0)
  app.dispose()
})

test('completion card retries a missing Host record and opens native resources and the owning task tab', async () => {
  const clock = timers()
  let reads = 0
  const task = { ...summary, status: 'completed', output: 'Done.', finishedAt: 5000 }
  const app = setup({
    clock,
    fetch: async () => {
      reads += 1
      return jsonResponse({ ok: true, value: { task: reads < 2 ? null : task } })
    },
  })
  const view = app.renderer(app.completion.component, {
    node: completionNode(), sessionId: 'parent-1', cwd: '/workspace', openFile: () => assert.fail('must use sidebarRight.openResource'),
  })
  await view.settle()
  assert.equal(reads, 1)
  await clock.advance(1100)
  const tree = await view.settle()
  assert.equal(reads, 2)
  assert.match(text(tree), /Completed/)
  assert.match(text(tree), /Original answer/)
  control(tree, 'completion-report').props.onClick()
  assert.deepEqual(app.files, [{ address: 'dsh-resource://file/session/parent-1//workspace/.dsh/agent-reports/task.md' }])
  app.setMounted('another-parent')
  control(tree, 'completion-open-tasks').props.onClick()
  app.setMounted(undefined)
  control(tree, 'completion-open-tasks').props.onClick()
  assert.equal(app.opened.length, 0)
  app.setMounted('parent-1')
  control(tree, 'completion-open-tasks').props.onClick()
  assert.deepEqual(app.opened, [{
    kind: 'multi-agent:tasks',
    options: { params: { parentSessionId: 'parent-1', childId: 'child-1', cwd: '/workspace' } },
  }])
  view.dispose()
  app.dispose()
})

test('completion preserves the full original notice and reports monitoring unavailable after read failures', async () => {
  const clock = timers()
  const app = setup({ clock, fetch: async () => { throw new Error('private socket detail') } })
  const view = app.renderer(app.completion.component, {
    node: completionNode(), sessionId: 'parent-1', cwd: '/workspace',
  })
  await view.settle()
  for (let index = 0; index < 6; index++) await clock.advance(1100)
  const tree = await view.settle()
  assert.match(text(tree), /Original answer/)
  assert.match(text(tree), /Task monitoring unavailable/)
  assert.match(text(tree), /original notification is preserved/i)
  assert.doesNotMatch(text(tree), /private socket detail/)
  assert.equal(control(tree, 'completion-report'), undefined)
  assert.equal(control(tree, 'completion-open-tasks'), undefined)
  assert.equal(clock.size, 0)
  view.dispose()
  app.dispose()
})

test('legacy report paths remain clickable without claiming a verified task record', async () => {
  const app = setup({ fetch: async () => jsonResponse({ ok: true, value: { task: null } }) })
  const node = completionNode()
  const path = '/workspace/.dsh/agent-reports/legacy.md'
  node.data.text = `Report path: \`${path}\``
  const view = app.renderer(app.completion.component, { node, sessionId: 'parent-1', cwd: '/workspace' })
  const tree = await view.settle()
  const link = control(tree, 'notification-report')
  assert.ok(link)
  link.props.onClick()
  assert.deepEqual(app.files, [{ address: 'dsh-resource://file/session/parent-1//workspace/.dsh/agent-reports/legacy.md' }])
  assert.equal(control(tree, 'completion-report'), undefined)
  assert.equal(control(tree, 'completion-open-tasks'), undefined)
  view.dispose()
  app.dispose()
})

test('legacy notices open Windows drive report paths with native colon-preserving addresses', async () => {
  const cases = [
    ['backtick backslash', String.raw`C:\workspace\.dsh\agent-reports\windows-backtick.md`, true, 'C:/workspace/.dsh/agent-reports/windows-backtick.md'],
    ['bare backslash', String.raw`C:\workspace\.dsh\agent-reports\windows-bare.md`, false, 'C:/workspace/.dsh/agent-reports/windows-bare.md'],
    ['backtick slash', 'C:/workspace/.dsh/agent-reports/windows-backtick.md', true, 'C:/workspace/.dsh/agent-reports/windows-backtick.md'],
    ['bare slash', 'C:/workspace/.dsh/agent-reports/windows-bare.md', false, 'C:/workspace/.dsh/agent-reports/windows-bare.md'],
  ]
  for (const [name, path, quoted, encodedPath] of cases) {
    const app = setup({ fetch: async () => jsonResponse({ ok: true, value: { task: null } }) })
    const node = completionNode()
    node.data.text = `Report path: ${quoted ? `\`${path}\`` : path}`
    const view = app.renderer(app.completion.component, { node, sessionId: 'parent-1', cwd: 'C:\\workspace' })
    const tree = await view.settle()
    const link = control(tree, 'notification-report')
    assert.ok(link, name)
    link.props.onClick()
    assert.deepEqual(app.files, [{ address: `dsh-resource://file/session/parent-1/${encodedPath}` }], name)
    view.dispose()
    app.dispose()
  }
})

test('legacy notices do not treat drive-relative paths as absolute reports', async () => {
  const app = setup({ fetch: async () => jsonResponse({ ok: true, value: { task: null } }) })
  const node = completionNode()
  const backslash = String.raw`C:workspace\.dsh\agent-reports\relative.md`
  const slash = 'C:workspace/.dsh/agent-reports/relative.md'
  node.data.text = `Invalid reports: \`${backslash}\`, \`${slash}\`, ${backslash}, ${slash}`
  const view = app.renderer(app.completion.component, { node, sessionId: 'parent-1', cwd: 'C:\\workspace' })
  const tree = await view.settle()
  assert.equal(control(tree, 'notification-report'), undefined)
  view.dispose()
  app.dispose()
})

test('untracked native settlement displays its rc.2 reason, original notice and report without a misleading task action', async () => {
  for (const [reason, label] of [['refusal', 'Declined'], ['error', 'Error'], ['aborted', 'Aborted'], ['future-reason', 'Unknown'], [undefined, undefined]]) {
    const clock = timers()
    const app = setup({ clock, fetch: async () => jsonResponse({ ok: true, value: { task: null } }) })
    const node = completionNode()
    node.data.source.stopReason = reason
    const path = '/workspace/.dsh/agent-reports/native.md'
    node.data.text = `Native original notice. Report path: ${path}`
    const view = app.renderer(app.completion.component, { node, sessionId: 'parent-1', cwd: '/workspace' })
    let tree = await view.settle()
    assert.equal(control(tree, 'completion-open-tasks'), undefined, 'loading does not promise a local task')
    for (let index = 0; index < 4; index++) await clock.advance(1100)
    tree = await view.settle()
    assert.match(text(tree), /No local task details/)
    assert.match(text(tree), /Native original notice/)
    const badges = nodes(tree, 'span').filter((item) => item.props.className === 'matasks-badge').map(text)
    assert.deepEqual(badges, label ? [label] : [])
    assert.equal(control(tree, 'completion-open-tasks'), undefined)
    control(tree, 'notification-report').props.onClick()
    assert.equal(app.files[0].address, 'dsh-resource://file/session/parent-1//workspace/.dsh/agent-reports/native.md')
    assert.equal(clock.size, 0)
    view.dispose()
    app.dispose()
  }
})

test('failed list responses show an explicit error and never fabricate tasks or progress', async () => {
  const app = setup({ fetch: async () => jsonResponse({ ok: false, error: { message: 'secret diagnostic' } }, false) })
  const view = renderSidebarBody(app,{
    scope: { sessionId: 'parent-1' }, tab: { meta: {} }, visible: true,
  })
  const tree = await view.settle()
  assert.match(text(tree), /Task history unavailable/)
  assert.doesNotMatch(text(tree), /secret diagnostic/)
  assert.equal(nodes(tree, 'details').filter((node) => node.props['data-task-id']).length, 0)
  assert.ok(control(tree, 'refresh-tasks'))
  view.dispose()
  app.dispose()
})

test('Client uses text nodes rather than raw HTML and Host entry is an empty apply', async () => {
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|file:\/\/|subagentchat|agent_thought_chunk/)
  const host = await import('../tasks-ui.js')
  assert.equal(typeof host.apply, 'function')
  assert.doesNotThrow(() => host.apply())
})


test('an aborted previous-parent response cannot overwrite the newly selected session', async () => {
  let resolveOld
  const oldTask = { ...summary, childId: 'old-child', parentSessionId: 'parent-1', label: 'Stale old task' }
  const newTask = { ...summary, childId: 'new-child', parentSessionId: 'parent-2', label: 'Current new task' }
  const app = setup({ fetch: async (url) => {
    if (url.includes('parentSessionId=parent-1')) return new Promise((resolve) => { resolveOld = resolve })
    return jsonResponse({ ok: true, value: { revision: 2, tasks: [newTask] } })
  } })
  const first = { scope: { sessionId: 'parent-1' }, tab: { meta: {} }, visible: true }
  const view = renderSidebarBody(app,first)
  await view.settle()
  const second = { scope: { sessionId: 'parent-2' }, tab: { meta: {} }, visible: true }
  let tree = await view.settle(second)
  assert.match(text(tree), /Current new task/)
  assert.equal(app.requests[0].init.signal.aborted, true)
  resolveOld(jsonResponse({ ok: true, value: { revision: 1, tasks: [oldTask] } }))
  tree = await view.settle()
  assert.match(text(tree), /Current new task/)
  assert.doesNotMatch(text(tree), /Stale old task/)
  view.dispose()
  app.dispose()
})


test('an unresolved detail binding does not claim that the child has no recorded activity', async () => {
  const app = setup({ fetch: async (url) => jsonResponse(url.includes('childId=')
    ? { ok: true, value: { task: null } }
    : { ok: true, value: { revision: 1, tasks: [summary] } }) })
  const view = renderSidebarBody(app,{
    scope: { sessionId: 'parent-1' }, tab: { meta: {} }, visible: true,
  })
  const tree = await view.settle()
  assert.match(text(tree), /Waiting for task details/)
  assert.doesNotMatch(text(tree), /No message or tool activity has been recorded/)
  view.dispose()
  app.dispose()
})

function styleText(tree) {
  return nodes(tree, 'style').map((node) => node.children.join('')).join('\n')
}

function activityIds(tree, type = 'message') {
  return nodes(tree).filter((node) => node.props['data-activity-id'] && (type === null || node.props['data-activity-type'] === type)).map((node) => node.props['data-activity-id'])
}

function byRole(tree, role) {
  return nodes(tree).filter((node) => node.props.role === role)
}

function workspace(tree) {
  return byRole(tree, 'tabpanel')[0]
}

function activityViewport(tree) {
  return nodes(tree, 'div').find((node) => node.props.className === 'matasks-activity-viewport')
}

function mockViewport({ scrollHeight = 1000, clientHeight = 200, scrollTop = 0 } = {}) {
  let top = scrollTop
  const writes = []
  return {
    scrollHeight,
    clientHeight,
    writes,
    get scrollTop() { return top },
    set scrollTop(value) { top = value; writes.push(value) },
  }
}

function taskDetailApp(detail, tasks = [summary], options = {}) {
  return setup({
    ...options,
    fetch: async (url) => jsonResponse(url.includes('childId=')
      ? { ok: true, value: { task: typeof detail === 'function' ? detail(url) : detail } }
      : { ok: true, value: { revision: 1, tasks: typeof tasks === 'function' ? tasks() : tasks } }),
  })
}

async function renderTaskPanel(app, options = {}) {
  const viewport = options.viewport || mockViewport()
  const focused = []
  const props = {
    scope: { sessionId: options.parentSessionId || 'parent-1', cwd: '/workspace' },
    tab: { meta: { ...(options.focusChildId ? { childId: options.focusChildId } : {}) } },
    visible: options.visible ?? true,
  }
  const view = renderSidebarBody(app, props, {
    createNode(nodeProps) {
      if (nodeProps.className === 'matasks-activity-viewport') return viewport
      if (nodeProps.role === 'tab') return { focus: (focusOptions) => focused.push({ id: nodeProps.id, options: focusOptions }) }
      return {}
    },
  })
  const tree = await view.settle()
  return { view, tree, viewport, focused, props }
}

test('overview is one compact horizontal toolbar with icon actions and collapsed session details', async () => {
  const app = taskDetailApp(summary)
  const { view, tree } = await renderTaskPanel(app)
  const header = nodes(tree, 'header').find(node => node.props.className === 'matasks-overview')
  assert.ok(header)
  assert.match(text(nodes(header, 'h2')[0]), /Agent tasks/)
  assert.ok(nodes(header, 'span').some(node => node.props.className === 'matasks-overview-count'))
  assert.equal(nodes(tree, 'p').some(node => node.props.className === 'matasks-description'), false)
  assert.equal(nodes(tree, 'div').some(node => node.props.className === 'matasks-overview-line'), false)
  const refresh = control(header, 'refresh-tasks')
  const history = control(header, 'open-history')
  assert.equal(refresh.props['aria-label'], 'Refresh tasks')
  assert.ok(history.props['aria-label'])
  assert.equal(text(refresh).trim(), '')
  assert.ok(nodes(history, 'svg').length)
  const meta = nodes(header, 'details').find(node => node.props.className === 'matasks-session-meta')
  assert.equal(meta.props.open, undefined)
  assert.ok(nodes(meta, 'summary')[0].props['aria-label'])
  assert.equal(text(nodes(meta, 'summary')[0]).trim(), '')
  const target = { open: true }
  meta.props.onKeyDown({ key: 'Escape', currentTarget: target })
  assert.equal(target.open, false)
  const styles = styleText(tree)
  assert.match(styles, /\.matasks-overview\{[^}]*display:flex;align-items:center/)
  assert.doesNotMatch(styles, /\.matasks-overview\{[^}]*flex-direction:column/)
  assert.match(styles, /\.matasks-session-meta dl\{position:absolute/)
  view.dispose()
  app.dispose()
})

test('completed tasks use neutral gray and running tasks use green without changing error tones', async () => {
  for (const [status, tone] of [['completed', 'neutral'], ['running', 'active'], ['starting', 'idle'], ['error', 'error'], ['aborted', 'error'], ['refusal', 'error'], ['interrupted', 'warn'], ['max-tokens', 'warn']]) {
    const task = { ...summary, status, archived: false }
    const app = taskDetailApp(task, [task])
    const { view, tree } = await renderTaskPanel(app)
    const badges = nodes(tree, 'span').filter((node) => node.props.className === 'matasks-status')
    assert.ok(badges.length >= 2, 'task tab and detail both show the status')
    assert.ok(badges.every((badge) => badge.props['data-tone'] === tone), status)
    const styles = styleText(tree)
    assert.match(styles, /\.matasks-status\[data-tone=neutral\]\{color:var\(--dsw-alias-label-secondary\)\}/)
    assert.match(styles, /\.matasks-status\[data-tone=active\]\{color:var\(--dsw-alias-state-success-primary\)\}/)
    assert.match(styles, /\.matasks-status::before\{[^}]*background:currentColor/)
    view.dispose()
    app.dispose()
  }
})

test('the panel owns one bounded activity scroller, semantic tabs and natural-height completion cards', async () => {
  const task = { ...summary, status: 'completed', output: 'Done.' }
  const app = taskDetailApp(task)
  const { view, tree } = await renderTaskPanel(app)
  const root = nodes(tree, 'div').find((node) => node.props.className?.split(' ').includes('matasks'))
  assert.equal(root.props.className, 'matasks matasks-panel')
  const styles = styleText(tree)
  const panelRule = styles.match(/\.matasks-panel\{([^}]*)\}/)?.[1] || ''
  for (const declaration of ['display:flex', 'flex-direction:column', 'height:100%', 'min-height:0', 'overflow:hidden']) {
    assert.ok(panelRule.includes(declaration), `panel rule includes ${declaration}`)
  }
  assert.match(styles, /\.matasks-activity-viewport\{[^}]*flex:1 1 auto;[^}]*min-height:0;[^}]*overflow-y:auto/)
  assert.match(styles, /\.matasks-task-head\{position:sticky/)
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/)
  for (const token of ['bg-layer-1', 'bg-layer-2', 'border-l1', 'border-l2', 'brand-primary', 'brand-primary-soft', 'label-primary', 'label-secondary', 'state-error-primary', 'state-success-primary', 'state-warn-primary', 'state-idle-primary']) {
    assert.match(styles, new RegExp(`--dsw-alias-${token}`))
  }
  const baseRule = styles.match(/\.matasks\{([^}]*)\}/)?.[1] || ''
  assert.doesNotMatch(baseRule, /height:100%|overflow-y:auto/)
  assert.equal(byRole(tree, 'tablist').length, 1)
  assert.equal(byRole(tree, 'tab').length, 1)
  assert.equal(workspace(tree).props['aria-labelledby'], byRole(tree, 'tab')[0].props.id)
  assert.equal(byRole(tree, 'tab')[0].props['aria-controls'], workspace(tree).props.id)
  assert.equal(nodes(tree, 'details').find((node) => node.props.className === 'matasks-session-meta').props.open, undefined)
  assert.doesNotMatch(text(nodes(tree, 'div').find((node) => node.props.className === 'matasks-heading')), /parent-1/)

  const completion = app.renderer(app.completion.component, {
    node: completionNode(), sessionId: 'parent-1', cwd: '/workspace',
  })
  const completionTree = await completion.settle()
  const completionRoot = nodes(completionTree, 'article')[0]
  assert.equal(completionRoot.props.className, 'matasks matasks-completion')
  assert.doesNotMatch(completionRoot.props.className, /matasks-panel/)
  const original = nodes(completionTree, 'details').find((node) => node.props.className === 'matasks-original')
  assert.ok(original)
  assert.equal(original.props.open, undefined)
  completion.dispose()
  view.dispose()
  app.dispose()
})

test('selected tasks show full message and final output with compact collapsible tool details', async () => {
  const longOutput = `Final answer ${'output '.repeat(120)}\nlast line`
  const longMessage = `Message ${'body '.repeat(120)}`
  const longCommand = 'pnpm run verify -- --task="a very long delegated command" --flag-one --flag-two --flag-three'
  const fullToolOutput = `Tool output\n${'line\n'.repeat(100)}`
  const app = taskDetailApp({
    ...summary, status: 'completed', output: longOutput, truncated: true,
    activities: [
      { id: 'message-full', type: 'message', title: 'Assistant', text: longMessage },
      { id: 'tool-full', type: 'tool', title: longCommand, status: 'in_progress', text: fullToolOutput },
    ],
  })
  const { view, tree } = await renderTaskPanel(app)
  const outputSection = nodes(tree, 'section').find((node) => text(nodes(node, 'h3')[0]) === 'Final output')
  const outputText = nodes(outputSection).find((node) => node.props.className === 'matasks-markdown matasks-final-output-text')
  assert.equal(text(outputText).trim().replace(/\s+/g, ' '), longOutput.replace(/\s+/g, ' '))
  assert.equal(nodes(outputSection, 'details').length, 0)
  const content = nodes(tree, 'div').find((node) => node.props.className === 'matasks-activity-content')
  assert.equal(content.children.at(-1), outputSection)

  const message = nodes(tree, 'div').find((node) => node.props['data-activity-id'] === 'message-full')
  assert.equal(message.props.className, 'matasks-markdown matasks-message')
  assert.equal(text(message).trim().replace(/\s+/g, ' '), longMessage.trim().replace(/\s+/g, ' '))
  assert.equal(nodes(message, 'details').length, 0)

  const toolActivity = nodes(tree, 'details').find((node) => node.props.className === 'matasks-tool-activity')
  assert.ok(toolActivity)
  assert.equal(toolActivity.props.open, undefined)
  assert.match(text(nodes(toolActivity, 'summary')[0]), /Tool activity \(1\)/)
  const tool = nodes(toolActivity, 'li').find((node) => node.props['data-activity-id'] === 'tool-full')
  assert.match(text(tool), /In progress/)
  assert.doesNotMatch(text(tool), /in_progress/)
  const commandPreview = nodes(tool, 'code').find((node) => node.props.className === 'matasks-command-preview')
  assert.ok(commandPreview)
  assert.ok(text(commandPreview).length <= 180)
  const toolDisclosure = nodes(tool, 'details')[0]
  assert.equal(toolDisclosure.props.open, undefined)
  assert.equal(text(nodes(toolDisclosure, 'pre').find((node) => node.props.className === 'matasks-command')), longCommand)
  assert.equal(text(nodes(toolDisclosure, 'pre').find((node) => node.props.className === 'matasks-output')), fullToolOutput)
  assert.match(styleText(tree), /\.matasks-output\{max-height:none;overflow:visible\}/)
  assert.match(text(tree), /Some task content was truncated by the Host/)
  view.dispose()
  app.dispose()
})

test('message pagination retains chronological tool groups and full final output', async () => {
  const activities = Array.from({ length: 9 }, (_, index) => [
    { id: `message-${index}`, type: 'message', text: `Agent body ${index}` },
    { id: `tool-${index}`, type: 'tool', title: `command ${index}`, text: `tool output ${index}` },
  ]).flat()
  activities.splice(1, 0, { id: 'duplicate-status', type: 'status', text: 'duplicate lifecycle status' })
  const app = taskDetailApp({ ...summary, status: 'completed', output: 'Final agent result', activities })
  const { view, tree } = await renderTaskPanel(app)
  const timeline = nodes(tree, 'div').find((node) => node.props.className === 'matasks-timeline')
  assert.ok(timeline)
  assert.deepEqual(activityIds(timeline), Array.from({ length: 8 }, (_, index) => `message-${index + 1}`))
  assert.deepEqual(activityIds(timeline, null), [
    'tool-0',
    ...Array.from({ length: 8 }, (_, index) => [`message-${index + 1}`, `tool-${index + 1}`]).flat(),
  ])
  assert.equal(text(control(tree, 'earlier-activities')), 'Show earlier activity (1)')
  assert.ok(nodes(timeline).some((node) => node.props.className === 'matasks-markdown matasks-message' && text(node).trim() === 'Agent body 8'))
  const outputText = nodes(tree).find((node) => node.props.className === 'matasks-markdown matasks-final-output-text')
  assert.equal(text(outputText).trim(), 'Final agent result')
  assert.equal(nodes(tree).some((node) => node.props['data-activity-id'] === 'duplicate-status'), false)

  const toolGroups = nodes(timeline, 'details').filter((node) => node.props.className === 'matasks-tool-activity')
  assert.equal(toolGroups.length, 9)
  assert.ok(toolGroups.every((node) => node.props.open === undefined))
  const toolDisclosures = toolGroups.flatMap((group) => nodes(group, 'li')).flatMap((item) => nodes(item, 'details'))
  assert.equal(toolDisclosures.length, 9)
  assert.ok(toolDisclosures.every((node) => node.props.open === undefined))
  assert.equal(app.dictionaries[0][1].zh['activities.toolActivity'], '工具活动（{count}）')

  control(tree, 'earlier-activities').props.onClick()
  const expanded = view.render()
  assert.deepEqual(activityIds(expanded), Array.from({ length: 9 }, (_, index) => `message-${index}`))
  view.dispose()
  app.dispose()
})

test('one tab per child selects the newest, supports roving focus and keeps manual selection during polling', async () => {
  const clock = timers()
  const second = { ...summary, childId: 'child-2', agent: 'kimi-code', label: 'Review changes', startedAt: 2000 }
  let tasks = [summary, second]
  const app = taskDetailApp((url) => {
    const childId = new URLSearchParams(url.split('?')[1]).get('childId')
    return tasks.find((task) => task.childId === childId)
  }, () => tasks, { clock })
  const { view, viewport, focused } = await renderTaskPanel(app)
  let tree = view.tree
  let tabs = byRole(tree, 'tab')
  assert.equal(tabs.length, 2)
  assert.equal(new Set(tabs.map((tab) => tab.props.id)).size, 2)
  assert.deepEqual(tabs.map((tab) => tab.props.name), ['task-tab-child-2', 'task-tab-child-1'])
  assert.equal(tabs[0].props.tabIndex, 0)
  assert.equal(tabs[1].props.tabIndex, -1)
  assert.equal(workspace(tree).props['data-task-id'], 'child-2')
  assert.equal(app.requests.filter((request) => request.url.includes('childId=child-1')).length, 0)
  const firstDetailSignal = app.requests.find((request) => request.url.includes('childId=child-2')).init.signal

  control(tree, 'task-tab-child-1').props.onClick()
  tree = await view.settle()
  assert.equal(workspace(tree).props['data-task-id'], 'child-1')
  assert.equal(firstDetailSignal.aborted, true)
  assert.equal(app.requests.filter((request) => request.url.includes('childId=child-1')).length, 1)

  let prevented = false
  control(tree, 'task-tab-child-1').props.onKeyDown({ key: 'ArrowRight', preventDefault: () => { prevented = true } })
  tree = view.render()
  assert.equal(prevented, true)
  assert.equal(workspace(tree).props['data-task-id'], 'child-2')
  assert.deepEqual(focused.at(-1), { id: control(tree, 'task-tab-child-2').props.id, options: { preventScroll: true } })
  control(tree, 'task-tab-child-2').props.onKeyDown({ key: 'End', preventDefault() {} })
  tree = view.render()
  assert.equal(workspace(tree).props['data-task-id'], 'child-1')
  control(tree, 'task-tab-child-1').props.onKeyDown({ key: 'Home', preventDefault() {} })
  tree = view.render()
  assert.equal(workspace(tree).props['data-task-id'], 'child-2')
  control(tree, 'task-tab-child-2').props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} })
  tree = await view.settle()
  assert.equal(workspace(tree).props['data-task-id'], 'child-1')
  control(tree, 'task-tab-child-2').props.onClick()
  tree = await view.settle()

  tasks = [{ ...summary, childId: 'child-3', label: 'New earlier task', startedAt: 500 }, summary, second]
  await clock.advance(1500)
  tree = await view.settle()
  assert.deepEqual(byRole(tree, 'tab').map((tab) => tab.props.name), ['task-tab-child-2', 'task-tab-child-1', 'task-tab-child-3'])
  assert.equal(workspace(tree).props['data-task-id'], 'child-2')
  assert.ok(viewport)
  view.dispose()
  app.dispose()
})

test('tabs use stable newest-first ordering and real local creation times with explicit unknowns', async () => {
  const startedAt = '2024-03-04T05:06:07.000Z'
  const updatedAt = '2025-01-01T00:00:00.000Z'
  const newestA = { ...summary, childId: 'child-new-a', label: 'Newest A', startedAt, updatedAt }
  const newestB = { ...summary, childId: 'child-new-b', label: 'Newest B', startedAt }
  const older = { ...summary, childId: 'child-old', label: 'Older', startedAt: '2024-01-02T03:04:05.000Z' }
  const missingA = { ...summary, childId: 'child-missing-a', label: 'Missing A' }
  delete missingA.startedAt
  const missingB = { ...summary, childId: 'child-missing-b', label: 'Missing B', startedAt: 'not-a-time' }
  const tasks = [older, newestA, missingA, newestB, missingB]
  const app = taskDetailApp((url) => {
    const childId = new URLSearchParams(url.split('?')[1]).get('childId')
    return tasks.find((task) => task.childId === childId)
  }, tasks)
  const { view } = await renderTaskPanel(app)
  let tree = view.tree
  assert.deepEqual(byRole(tree, 'tab').map((tab) => tab.props.name), [
    'task-tab-child-new-a', 'task-tab-child-new-b', 'task-tab-child-old',
    'task-tab-child-missing-a', 'task-tab-child-missing-b',
  ])
  assert.equal(workspace(tree).props['data-task-id'], 'child-new-a')

  const date = new Date(startedAt)
  const options = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }
  const local = new Intl.DateTimeFormat(undefined, options).format(date)
  const full = new Intl.DateTimeFormat(undefined, { ...options, timeZoneName: 'long' }).format(date)
  const tabTime = nodes(control(tree, 'task-tab-child-new-a'), 'time')[0]
  const header = nodes(workspace(tree), 'header')[0]
  const headerTime = nodes(header, 'time')[0]
  for (const timeNode of [tabTime, headerTime]) {
    assert.ok(timeNode)
    assert.equal(timeNode.props.dateTime, startedAt)
    assert.notEqual(timeNode.props.dateTime, new Date(updatedAt).toISOString())
    assert.equal(text(timeNode), local)
    assert.equal(timeNode.props.title, `Created ${full}`)
  }
  assert.match(full, /GMT|UTC|Time|标准时间|時間/)
  assert.ok(nodes(header, 'span').find((node) => node.props.className === 'matasks-duration'))
  assert.doesNotMatch(text(header), /Duration unavailable/)

  for (const childId of ['child-missing-a', 'child-missing-b']) {
    const tab = control(tree, `task-tab-${childId}`)
    assert.equal(nodes(tab, 'time').length, 0)
    assert.equal(text(nodes(tab).find((node) => node.props.className === 'matasks-created')), 'Creation time unknown')
  }
  control(tree, 'task-tab-child-missing-a').props.onClick()
  tree = await view.settle()
  const unknownHeader = nodes(workspace(tree), 'header')[0]
  assert.equal(nodes(unknownHeader, 'time').length, 0)
  assert.match(text(unknownHeader), /Creation time unknown/)
  assert.match(text(unknownHeader), /Duration unavailable/)
  assert.equal(app.dictionaries[0][1].zh['tasks.createdUnknown'], '创建时间未知')
  view.dispose()
  app.dispose()
})

test('focusChildId applies once when its task arrives and a later value can target another task', async () => {
  const clock = timers()
  const second = { ...summary, childId: 'child-2', label: 'Focused task', startedAt: 2000 }
  const third = { ...summary, childId: 'child-3', label: 'Later focused task', startedAt: 3000 }
  let tasks = [summary]
  const app = taskDetailApp((url) => ({ ...summary, childId: new URLSearchParams(url.split('?')[1]).get('childId') }), () => tasks, { clock })
  const { view, props } = await renderTaskPanel(app, { focusChildId: 'child-2' })
  assert.equal(workspace(view.tree).props['data-task-id'], 'child-1')
  tasks = [summary, second]
  await clock.advance(1500)
  let tree = await view.settle()
  assert.equal(workspace(tree).props['data-task-id'], 'child-2')

  control(tree, 'task-tab-child-1').props.onClick()
  tree = await view.settle()
  assert.equal(workspace(tree).props['data-task-id'], 'child-1')
  await clock.advance(1500)
  tree = await view.settle()
  assert.equal(workspace(tree).props['data-task-id'], 'child-1', 'unchanged focus metadata must not override manual selection')

  const nextProps = { ...props, tab: { meta: { childId: 'child-3' } } }
  tree = await view.settle(nextProps)
  assert.equal(workspace(tree).props['data-task-id'], 'child-1')
  tasks = [summary, second, third]
  await clock.advance(1500)
  tree = await view.settle(nextProps)
  assert.equal(workspace(tree).props['data-task-id'], 'child-3')
  view.dispose()
  app.dispose()
})

test('a new navigation revision reselects the same task after a manual tab change', async () => {
  const second = { ...summary, childId: 'child-2', label: 'Second task', startedAt: 2000 }
  const app = taskDetailApp((url) => ({
    ...summary,
    childId: new URLSearchParams(url.split('?')[1]).get('childId'),
  }), [summary, second])
  const props = {
    scope: { sessionId: 'parent-1', cwd: '/workspace' },
    tab: { meta: { childId: 'child-1' }, navigationRevision: 1 },
    visible: true,
  }
  const view = renderSidebarBody(app, props)
  let tree = await view.settle()
  assert.equal(workspace(tree).props['data-task-id'], 'child-1')

  control(tree, 'task-tab-child-2').props.onClick()
  tree = await view.settle()
  assert.equal(workspace(tree).props['data-task-id'], 'child-2')

  tree = await view.settle({
    ...props,
    tab: { ...props.tab, navigationRevision: 2 },
  })
  assert.equal(workspace(tree).props['data-task-id'], 'child-1', 'a fresh open must select its requested task again')
  view.dispose()
  app.dispose()
})

test('same-id text and final output updates follow bottom while unchanged refreshes do not scroll', async () => {
  const clock = timers()
  const detail = {
    ...summary, output: 'Working', activities: [{ id: 'message-1', type: 'message', text: 'Start' }],
  }
  const app = taskDetailApp(detail, [summary], { clock })
  const viewport = mockViewport({ scrollHeight: 600, clientHeight: 200, scrollTop: 0 })
  const { view, tree } = await renderTaskPanel(app, { viewport })
  app.frames.flush()
  assert.equal(viewport.scrollTop, 400)
  activityViewport(tree).props.onScroll({ currentTarget: viewport })
  const writesAfterInitial = viewport.writes.length

  control(tree, 'refresh-tasks').props.onClick()
  await view.settle()
  assert.equal(viewport.scrollTop, 400)
  assert.equal(viewport.writes.length, writesAfterInitial)
  assert.equal(app.frames.size, 0)

  detail.activities[0].text += ' with appended text'
  detail.output = 'Final conclusion'
  viewport.scrollHeight = 760
  await clock.advance(1500)
  const updated = await view.settle()
  app.frames.flush()
  assert.equal(viewport.scrollTop, 560)
  assert.match(text(updated), /appended text/)
  assert.match(text(updated), /Final conclusion/)

  detail.activities[0].text += ' again'
  viewport.scrollHeight = 820
  await clock.advance(1500)
  const beforeEvent = await view.settle()
  activityViewport(beforeEvent).props.onScroll({ currentTarget: viewport })
  assertFollowState(view.render(), true)
  app.frames.flush()
  assert.equal(viewport.scrollTop, 620)
  view.dispose()
  app.dispose()
})

test('up-scroll pauses immediately, pinned history stays stable, and bottom or Jump restores following', async () => {
  const clock = timers()
  const detail = {
    ...summary,
    activities: Array.from({ length: 9 }, (_, index) => ({ id: `message-${index}`, type: 'message', text: `message ${index}` })),
  }
  const app = taskDetailApp(detail, [summary], { clock })
  const viewport = mockViewport()
  const { view, tree: initialTree } = await renderTaskPanel(app, { viewport })
  let tree = initialTree
  app.frames.flush()
  assert.deepEqual(activityIds(tree), Array.from({ length: 8 }, (_, index) => `message-${index + 1}`))

  viewport.scrollTop = 500
  activityViewport(tree).props.onScroll({ currentTarget: viewport })
  tree = view.render()
  assertFollowState(tree, false)
  assert.ok(control(tree, 'jump-latest'))

  detail.activities.push({ id: 'message-9', type: 'message', text: 'new message' })
  viewport.scrollHeight = 1100
  await clock.advance(1500)
  tree = await view.settle()
  app.frames.flush()
  assert.equal(viewport.scrollTop, 500)
  assert.deepEqual(activityIds(tree), Array.from({ length: 9 }, (_, index) => `message-${index + 1}`))

  control(tree, 'earlier-activities').props.onClick()
  viewport.scrollHeight = 1200
  tree = view.render()
  assert.equal(viewport.scrollTop, 600, 'history expansion preserves the reading anchor')
  assert.deepEqual(activityIds(tree), Array.from({ length: 10 }, (_, index) => `message-${index}`))
  assertFollowState(tree, false)

  viewport.scrollTop = 1000
  activityViewport(tree).props.onScroll({ currentTarget: viewport })
  tree = view.render()
  app.frames.flush()
  assertFollowState(tree, true)
  assert.equal(viewport.scrollTop, 1000)

  viewport.scrollTop = 400
  activityViewport(tree).props.onScroll({ currentTarget: viewport })
  tree = view.render()
  control(tree, 'jump-latest').props.onClick()
  tree = view.render()
  assert.equal(viewport.scrollTop, 1000)
  assertFollowState(tree, true)
  activityViewport(tree).props.onScroll({ currentTarget: viewport })
  assertFollowState(view.render(), true)
  view.dispose()
  app.dispose()
})

test('tab switches and parent sessions restore independent scrollTop and follow state', async () => {
  const second = { ...summary, childId: 'child-2', label: 'Second task', startedAt: 2000 }
  const parentTwoTask = { ...summary, parentSessionId: 'parent-2', label: 'Parent two task' }
  const app = setup({ fetch: async (url) => {
    const params = new URLSearchParams(url.split('?')[1])
    const parent = params.get('parentSessionId')
    const child = params.get('childId')
    const tasks = parent === 'parent-2' ? [parentTwoTask] : [summary, second]
    return jsonResponse(child
      ? { ok: true, value: { task: { ...summary, parentSessionId: parent, childId: child, activities: [{ id: `${parent}-${child}`, type: 'message', text: 'activity' }] } } }
      : { ok: true, value: { revision: 1, tasks } })
  } })
  const viewport = mockViewport()
  const { view, props } = await renderTaskPanel(app, { viewport, focusChildId: 'child-1' })
  app.frames.flush()
  let tree = view.tree
  viewport.scrollTop = 160
  activityViewport(tree).props.onScroll({ currentTarget: viewport })
  tree = view.render()
  assertFollowState(tree, false)

  control(tree, 'task-tab-child-2').props.onClick()
  tree = await view.settle()
  app.frames.flush()
  assert.equal(viewport.scrollTop, 800)
  control(tree, 'task-tab-child-1').props.onClick()
  tree = await view.settle()
  app.frames.flush()
  assert.equal(viewport.scrollTop, 160)
  assertFollowState(tree, false)

  const parentTwoProps = { ...props, scope: { sessionId: 'parent-2', cwd: '/workspace' }, tab: { meta: {} } }
  tree = await view.settle(parentTwoProps)
  app.frames.flush()
  assert.equal(workspace(tree).props['data-task-id'], 'child-1')
  assert.equal(viewport.scrollTop, 800)
  assertFollowState(tree, true)
  tree = await view.settle(props)
  app.frames.flush()
  assert.equal(viewport.scrollTop, 160)
  assertFollowState(tree, false)
  view.dispose()
  app.dispose()
})

test('resize observers preserve manual reading and resume automatic following after Back to latest', async () => {
  const observers = observerHarness()
  const detail = {
    ...summary, output: 'Final output',
    activities: [
      { id: 'earlier', type: 'message', text: 'Earlier full message' },
      { id: 'latest', type: 'message', text: 'Latest full message' },
    ],
  }
  const app = taskDetailApp(detail, [summary], { observers })
  const viewport = mockViewport({ scrollHeight: 600, clientHeight: 200 })
  const { view } = await renderTaskPanel(app, { viewport })
  app.frames.flush()
  assert.equal(viewport.scrollTop, 400)

  viewport.scrollTop = 250
  activityViewport(view.tree).props.onScroll({ currentTarget: viewport })
  let tree = view.render()
  assertFollowState(tree, false)
  viewport.scrollHeight = 900
  for (const observer of observers.records.filter((record) => !record.disconnected)) observer.trigger()
  app.frames.flush()
  assert.equal(viewport.scrollTop, 250)
  assertFollowState(view.render(), false)

  control(tree, 'jump-latest').props.onClick()
  assert.equal(viewport.scrollTop, 700)
  viewport.scrollHeight = 1000
  for (const observer of observers.records.filter((record) => !record.disconnected)) observer.trigger()
  app.frames.flush()
  assert.equal(viewport.scrollTop, 800)
  assertFollowState(view.render(), true)
  view.dispose()
  app.dispose()
})

test('tool group and tool output disclosures preserve reading position without changing follow state', async () => {
  const observers = observerHarness()
  const detail = {
    ...summary, output: 'Final output',
    activities: [
      { id: 'message', type: 'message', text: 'Agent body remains visible' },
      { id: 'tool-1', type: 'tool', title: 'first command', text: 'first tool output' },
      { id: 'tool-2', type: 'tool', title: 'second command', text: 'second tool output' },
    ],
  }
  const app = taskDetailApp(detail, [summary], { observers })
  const viewport = mockViewport({ scrollHeight: 600, clientHeight: 200 })
  const { view, tree: initialTree } = await renderTaskPanel(app, { viewport })
  let tree = initialTree
  app.frames.flush()
  assert.equal(viewport.scrollTop, 400)

  const toolActivity = nodes(tree, 'details').find((node) => node.props.className === 'matasks-tool-activity')
  toolActivity.props.onToggle()
  viewport.scrollHeight = 900
  for (const observer of observers.records.filter((record) => !record.disconnected)) observer.trigger()
  tree = view.render()
  app.frames.flush()
  assert.equal(viewport.scrollTop, 400)
  assertFollowState(tree, true)

  const tool = nodes(tree, 'li').find((node) => node.props['data-activity-id'] === 'tool-1')
  const toolDisclosure = nodes(tool, 'details')[0]
  toolDisclosure.props.onToggle()
  viewport.scrollHeight = 1000
  for (const observer of observers.records.filter((record) => !record.disconnected)) observer.trigger()
  tree = view.render()
  app.frames.flush()
  assert.equal(viewport.scrollTop, 400)
  assertFollowState(tree, true)

  viewport.scrollTop = 300
  activityViewport(tree).props.onScroll({ currentTarget: viewport })
  tree = view.render()
  assertFollowState(tree, false)
  const currentToolActivity = nodes(tree, 'details').find((node) => node.props.className === 'matasks-tool-activity')
  currentToolActivity.props.onToggle()
  viewport.scrollHeight = 600
  for (const observer of observers.records.filter((record) => !record.disconnected)) observer.trigger()
  tree = view.render()
  app.frames.flush()
  assert.equal(viewport.scrollTop, 300)
  assertFollowState(tree, false)
  view.dispose()
  app.dispose()
})

test('hidden panels and tab switches cancel requests, observers and scheduled frames', async () => {
  const observers = observerHarness()
  const second = { ...summary, childId: 'child-2', startedAt: 2000 }
  const app = taskDetailApp((url) => ({ ...summary, childId: new URLSearchParams(url.split('?')[1]).get('childId') }), [summary, second], { observers })
  const { view, tree, props } = await renderTaskPanel(app, { focusChildId: 'child-1' })
  assert.ok(app.frames.size > 0)
  assert.equal(observers.records.length, 2)
  const firstObservers = [...observers.records]
  const firstDetailSignal = app.requests.find((request) => request.url.includes('childId=child-1')).init.signal

  control(tree, 'task-tab-child-2').props.onClick()
  await view.settle()
  assert.equal(firstDetailSignal.aborted, true)
  assert.ok(firstObservers.every((observer) => observer.disconnected))
  assert.ok(observers.records.length >= 4)

  await view.settle({ ...props, visible: false })
  assert.ok(observers.records.every((observer) => observer.disconnected))
  assert.equal(app.frames.size, 0)
  assert.ok(app.requests.every((request) => request.init.signal.aborted))
  view.dispose()
  assert.equal(app.frames.size, 0)
  assert.equal(app.clock.size, 0)
  app.dispose()
})

test('show earlier uses the reading anchor after many new messages arrive', async () => {
  const clock = timers()
  const detail = { ...summary, activities: Array.from({ length: 100 }, (_, index) => ({ id: `m-${index}`, type: 'message', text: `Message ${index}` })) }
  const app = taskDetailApp(detail, [summary], { clock })
  const { view, viewport } = await renderTaskPanel(app)
  app.frames.flush()
  viewport.scrollTop = 400
  activityViewport(view.tree).props.onScroll({ currentTarget: viewport })
  view.render()
  detail.activities.push(...Array.from({ length: 30 }, (_, index) => ({ id: `m-${100 + index}`, type: 'message', text: 'New message' })))
  await clock.advance(1500)
  await view.settle()
  assert.equal(activityIds(view.tree)[0], 'm-92')
  control(view.tree, 'earlier-activities').props.onClick()
  view.render()
  assert.equal(activityIds(view.tree)[0], 'm-84', 'load older items relative to the retained reading anchor, not the live tail')
  assert.ok(activityIds(view.tree).includes('m-92'))
  assertFollowState(view.tree, false)
  view.dispose()
  app.dispose()
})

test('paused offsets survive unloaded tab restoration and hidden zero geometry', async () => {
  const second = { ...summary, childId: 'child-2', startedAt: 2000 }
  let delayFirst = false
  let resolveFirst
  const detail = { ...summary, activities: [{ id: 'm1', type: 'message', text: 'retained message' }] }
  const app = setup({ fetch: async (url) => {
    if (!url.includes('childId=')) return jsonResponse({ ok: true, value: { tasks: [summary, second] } })
    const childId = new URLSearchParams(url.split('?')[1]).get('childId')
    if (childId === 'child-1' && delayFirst) return new Promise((resolve) => { resolveFirst = resolve })
    return jsonResponse({ ok: true, value: { task: { ...detail, childId } } })
  } })
  const { view, viewport, props } = await renderTaskPanel(app, { focusChildId: 'child-1' })
  app.frames.flush()
  viewport.scrollTop = 180
  activityViewport(view.tree).props.onScroll({ currentTarget: viewport })
  control(view.render(), 'task-tab-child-2').props.onClick()
  await view.settle()
  app.frames.flush()
  delayFirst = true
  control(view.tree, 'task-tab-child-1').props.onClick()
  viewport.scrollHeight = 200
  viewport.scrollTop = 0
  await view.settle()
  assert.equal(viewport.scrollTop, 0)
  viewport.scrollHeight = 1000
  resolveFirst(jsonResponse({ ok: true, value: { task: detail } }))
  await view.settle()
  assert.equal(viewport.scrollTop, 180, 'restore after actual detail content is available')
  assertFollowState(view.tree, false)
  const oldOnScroll = activityViewport(view.tree).props.onScroll
  viewport.clientHeight = 0
  viewport.scrollTop = 0
  await view.settle({ ...props, visible: false })
  oldOnScroll({ currentTarget: viewport })
  viewport.clientHeight = 200
  delayFirst = false
  await view.settle(props)
  assert.equal(viewport.scrollTop, 180, 'hidden zero offset must not replace the saved reading position')
  assertFollowState(view.tree, false)
  view.dispose()
  app.dispose()
})

test('returning to a parent restores manual tab selection despite unchanged focus metadata', async () => {
  const second = { ...summary, childId: 'child-2', startedAt: 2000 }
  const app = taskDetailApp((url) => {
    const params = new URLSearchParams(url.split('?')[1])
    return { ...summary, childId: params.get('childId'), parentSessionId: params.get('parentSessionId') }
  }, [summary, second])
  const { view, props } = await renderTaskPanel(app, { focusChildId: 'child-1' })
  control(view.tree, 'task-tab-child-2').props.onClick()
  await view.settle()
  const initialPanelId = workspace(view.tree).props.id
  await view.settle({ ...props, scope: { sessionId: 'parent-2' }, tab: { meta: { childId: 'child-1' } } })
  assert.equal(workspace(view.tree).props['data-task-id'], 'child-1')
  assert.notEqual(workspace(view.tree).props.id, initialPanelId)
  await view.settle(props)
  assert.equal(workspace(view.tree).props['data-task-id'], 'child-2')
  assert.equal(workspace(view.tree).props.id, initialPanelId)
  view.dispose()
  app.dispose()
})

function taskHistory(tree) {
  return nodes(tree, 'section').find((node) => node.props.className === 'matasks-task-history')
}

function historyRow(tree, childId) {
  return nodes(tree, 'li').find((node) => node.props['data-history-task-id'] === childId)
}

function continueForm(tree) {
  return nodes(tree, 'form').find((node) => node.props.className === 'matasks-continue-form')
}

test('history opens a separate scrollable view and returning restores the active task reading position', async () => {
  const active = { ...summary, childId: 'active', label: 'Active task', startedAt: 1000 }
  const restored = { ...summary, childId: 'restored', label: 'Restored terminal', status: 'completed', startedAt: 4000, archived: false }
  const newestHistory = { ...summary, childId: 'history-new', label: 'Newest history', status: 'completed', startedAt: 3000 }
  const oldestHistory = { ...summary, childId: 'history-old', label: 'Oldest history', status: 'error', startedAt: 2000, archived: true, telemetry: { model: 'history-model', reasoningEffort: 'low', usage: { totalTokens: 7 }, usageScope: 'task' } }
  const tasks = [oldestHistory, active, newestHistory, restored]
  const app = taskDetailApp((url) => {
    const childId = new URLSearchParams(url.split('?')[1]).get('childId')
    return tasks.find((task) => task.childId === childId)
  }, tasks)
  const { view, viewport, tree } = await renderTaskPanel(app)
  assert.deepEqual(byRole(tree, 'tab').map((tab) => tab.props.name), ['task-tab-restored', 'task-tab-active'])
  assert.equal(taskHistory(tree), undefined, 'history must not occupy the active layout')
  assert.equal(historyRow(tree, 'history-new'), undefined)
  assert.equal(control(tree, 'open-history').props['aria-label'], 'History tasks (2)')
  assert.equal(text(control(tree, 'open-history')).trim(), '2')
  app.frames.flush()
  viewport.scrollTop = 166
  activityViewport(tree).props.onScroll({ currentTarget: viewport })
  view.render()
  const activeDetailSignal = app.requests.find((request) => request.url.includes('childId=restored')).init.signal
  control(view.tree, 'open-history').props.onClick()
  const historyTree = await view.settle()
  const history = taskHistory(historyTree)
  assert.ok(history)
  assert.equal(workspace(historyTree), undefined, 'history is an alternative view, never stacked above the workspace')
  assert.equal(byRole(historyTree, 'tab').length, 0)
  assert.equal(activeDetailSignal.aborted, true)
  assert.deepEqual(nodes(history, 'li').map((node) => node.props['data-history-task-id']), ['history-new', 'history-old'])
  assert.match(text(history), /reports and sessions/i)
  assert.ok(control(historyRow(historyTree, 'history-new'), 'restore-history-new'))
  assert.ok(control(historyRow(historyTree, 'history-old'), 'clear-history-old'))
  assert.match(styleText(historyTree), /\.matasks-history-body\{[^}]*min-height:0;[^}]*overflow-y:auto/)
  control(history, 'history-view-history-old').props.onClick()
  const expanded = await view.settle()
  assert.equal(taskHistory(expanded), undefined, 'opening historical detail removes the list from layout')
  assert.equal(workspace(expanded).props['data-task-id'], 'history-old')
  assert.match(telemetryText(expanded), /history-model/)
  assert.match(telemetryText(expanded), /Task tokens: 7/)
  const headingId = workspace(expanded).props['aria-labelledby']
  assert.ok(nodes(expanded).some((node) => node.props.id === headingId))
  control(expanded, 'back-current').props.onClick()
  await view.settle()
  app.frames.flush()
  assert.equal(workspace(view.tree).props['data-task-id'], 'restored')
  assert.equal(viewport.scrollTop, 166, 'return restores the original task reading position')
  assertFollowState(view.tree, false)
  control(view.tree, 'open-history').props.onClick()
  await view.settle()
  taskHistory(view.tree).props.onKeyDown({ key: 'Escape', preventDefault() {} })
  await view.settle()
  assert.equal(taskHistory(view.tree), undefined)
  assert.equal(workspace(view.tree).props['data-task-id'], 'restored')
  view.dispose()
  app.dispose()
})

test('history stays closed with an explicit active empty state until focusChildId selects an archived task', async () => {
  const archived = { ...summary, status: 'completed', output: 'Archived detail', activities: [{ id: 'old-message', type: 'message', text: 'Retained history body' }] }
  const app = taskDetailApp(archived, [archived])
  const { view, props, tree } = await renderTaskPanel(app)
  assert.equal(byRole(tree, 'tab').length, 0)
  assert.equal(workspace(tree), undefined)
  assert.equal(taskHistory(tree), undefined)
  assert.match(text(tree), /No active tasks/)
  assert.equal(control(tree, 'open-history').props['aria-label'], 'History tasks (1)')
  assert.doesNotMatch(text(tree), /No monitored tasks have been recorded/)

  const focused = await view.settle({ ...props, tab: { meta: { childId: 'child-1' } } })
  assert.equal(taskHistory(focused), undefined)
  assert.equal(workspace(focused).props['data-task-id'], 'child-1')
  assert.match(text(workspace(focused)), /Retained history body/)
  assert.match(text(workspace(focused)), /Archived detail/)
  view.dispose()
  app.dispose()
})

test('a selected running task keeps its detail and becomes selected history when it settles', async () => {
  const clock = timers()
  let tasks = [{ ...summary, archived: false }]
  const app = taskDetailApp((url) => {
    const childId = new URLSearchParams(url.split('?')[1]).get('childId')
    return tasks.find((task) => task.childId === childId)
  }, () => tasks, { clock })
  const { view } = await renderTaskPanel(app)
  assert.equal(workspace(view.tree).props['data-task-id'], 'child-1')
  assert.equal(taskHistory(view.tree), undefined)

  tasks = [{ ...summary, status: 'completed', finishedAt: 6000, output: 'Now settled' }]
  await clock.advance(1500)
  const tree = await view.settle()
  assert.equal(byRole(tree, 'tab').length, 0)
  assert.equal(workspace(tree).props['data-task-id'], 'child-1')
  assert.match(text(workspace(tree)), /Now settled/)
  assert.equal(taskHistory(tree), undefined, 'settlement must not open history or shrink the message area')
  assert.equal(historyRow(tree, 'child-1'), undefined)
  assert.ok(control(tree, 'back-current'))
  view.dispose()
  app.dispose()
})

test('archive, restore, single clear and archived-history clear use the Host action contract and refresh', async () => {
  let tasks = [
    { ...summary, childId: 'restored', label: 'Restored task', status: 'completed', startedAt: 3000, archived: false },
    { ...summary, childId: 'archived', label: 'Archived task', status: 'completed', startedAt: 2000 },
  ]
  const app = setup({ fetch: async (url, init = {}) => {
    if (init.method === 'POST') {
      const body = JSON.parse(init.body)
      if (body.action === 'archive' || body.action === 'restore') {
        tasks = tasks.map((task) => task.childId === body.childId ? { ...task, archived: body.action === 'archive' } : task)
      } else if (body.action === 'clear') {
        tasks = body.childId ? tasks.filter((task) => task.childId !== body.childId) : []
      }
      return jsonResponse({ ok: true, value: { childId: body.childId } })
    }
    const childId = new URLSearchParams(url.split('?')[1]).get('childId')
    return jsonResponse(childId
      ? { ok: true, value: { task: tasks.find((task) => task.childId === childId) || null } }
      : { ok: true, value: { revision: 1, tasks } })
  } })
  const { view } = await renderTaskPanel(app)
  let listReads = app.requests.filter((request) => !request.url.includes('childId=') && request.init.method !== 'POST').length

  await control(view.tree, 'archive-restored').props.onClick()
  let tree = await view.settle()
  assert.deepEqual(JSON.parse(app.requests.find((request) => request.init.method === 'POST').init.body), {
    parentSessionId: 'parent-1', action: 'archive', childId: 'restored',
  })
  assert.ok(app.requests.filter((request) => !request.url.includes('childId=') && request.init.method !== 'POST').length > listReads)
  assert.equal(workspace(tree).props['data-task-id'], 'restored')
  assert.equal(taskHistory(tree), undefined)
  control(tree, 'open-history').props.onClick()
  tree = await view.settle()

  listReads = app.requests.filter((request) => !request.url.includes('childId=') && request.init.method !== 'POST').length
  await control(tree, 'restore-archived').props.onClick()
  tree = await view.settle()
  assert.deepEqual(JSON.parse(app.requests.filter((request) => request.init.method === 'POST').at(-1).init.body), {
    parentSessionId: 'parent-1', action: 'restore', childId: 'archived',
  })
  assert.equal(control(tree, 'task-tab-archived'), undefined, 'active tabs do not share history layout')
  assert.ok(app.requests.filter((request) => !request.url.includes('childId=') && request.init.method !== 'POST').length > listReads)

  await control(tree, 'clear-restored').props.onClick()
  tree = await view.settle()
  assert.deepEqual(JSON.parse(app.requests.filter((request) => request.init.method === 'POST').at(-1).init.body), {
    parentSessionId: 'parent-1', action: 'clear', childId: 'restored',
  })
  assert.equal(historyRow(tree, 'restored'), undefined)
  control(tree, 'history-back').props.onClick()
  tree = await view.settle()
  assert.equal(workspace(tree).props['data-task-id'], 'archived')

  await control(tree, 'archive-archived').props.onClick()
  tree = await view.settle()
  control(tree, 'open-history').props.onClick()
  tree = await view.settle()
  await control(tree, 'clear-history').props.onClick()
  tree = await view.settle()
  assert.deepEqual(JSON.parse(app.requests.filter((request) => request.init.method === 'POST').at(-1).init.body), {
    parentSessionId: 'parent-1', action: 'clear',
  })
  assert.ok(taskHistory(tree))
  assert.match(text(taskHistory(tree)), /No archived tasks/)
  view.dispose()
  app.dispose()
})

test('continue submits a bounded message, disables while pending and shows Host failures or an accepted receipt', async () => {
  const task = { ...summary, status: 'completed', archived: false, canContinue: true }
  const pendingActions = []
  const app = setup({ fetch: async (url, init = {}) => {
    if (init.method === 'POST') return new Promise((resolve) => pendingActions.push({ init, resolve }))
    return jsonResponse(url.includes('childId=')
      ? { ok: true, value: { task } }
      : { ok: true, value: { revision: 1, tasks: [task] } })
  } })
  const { view } = await renderTaskPanel(app)
  const disclosure = nodes(view.tree, 'details').find((node) => node.props.className === 'matasks-continue')
  assert.ok(disclosure)
  assert.equal(disclosure.props.open, undefined)
  let input = nodes(continueForm(view.tree), 'textarea')[0]
  input.props.onChange({ currentTarget: { value: '  Follow up with tests  ' } })
  let tree = view.render()
  const submission = continueForm(tree).props.onSubmit({ preventDefault() {} })
  tree = view.render()
  input = nodes(continueForm(tree), 'textarea')[0]
  assert.equal(input.props.disabled, true)
  assert.equal(control(tree, 'continue-child-1').props.disabled, true)
  assert.equal(pendingActions.length, 1)
  assert.equal(pendingActions[0].init.credentials, 'same-origin')
  assert.equal(pendingActions[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(pendingActions[0].init.body), {
    parentSessionId: 'parent-1', action: 'continue', childId: 'child-1', message: 'Follow up with tests',
  })

  pendingActions[0].resolve(jsonResponse({ ok: false, error: { message: 'Provider rejected continuation' } }, false))
  await submission
  tree = await view.settle()
  assert.match(text(tree), /Provider rejected continuation/)
  assert.equal(nodes(continueForm(tree), 'textarea')[0].props.value, '  Follow up with tests  ')
  assert.equal(nodes(continueForm(tree), 'textarea')[0].props.disabled, false)

  const secondSubmission = continueForm(tree).props.onSubmit({ preventDefault() {} })
  assert.equal(pendingActions.length, 2)
  pendingActions[1].resolve(jsonResponse({ ok: true, value: { childId: 'child-1', subagentId: 'subagent-receipt-7' } }))
  await secondSubmission
  tree = await view.settle()
  assert.match(text(tree), /accepted by the Host/i)
  assert.match(text(tree), /not finished/i)
  assert.match(text(tree), /subagent-receipt-7/)
  assert.equal(nodes(continueForm(tree), 'textarea')[0].props.value, '')
  view.dispose()
  app.dispose()
})

test('continue is unavailable without explicit capability and preserves the Host reason', async () => {
  const task = { ...summary, status: 'completed', archived: false, continueReason: 'This provider cannot resume the saved session.' }
  const app = taskDetailApp(task, [task])
  const { view, tree } = await renderTaskPanel(app)
  assert.equal(continueForm(tree), undefined)
  assert.match(text(tree), /This provider cannot resume the saved session/)
  assert.equal(control(tree, 'continue-child-1'), undefined)
  assert.equal(app.requests.some((request) => request.init.method === 'POST'), false)
  view.dispose()
  app.dispose()
})

test('pending task actions abort on parent switches or hiding and never leak stale receipts or errors', async () => {
  const firstTask = { ...summary, childId: 'old-child', parentSessionId: 'parent-1', status: 'completed', archived: false }
  const secondTask = { ...summary, childId: 'new-child', parentSessionId: 'parent-2', status: 'completed', archived: false }
  const actions = []
  const app = setup({ fetch: async (url, init = {}) => {
    if (init.method === 'POST') return new Promise((resolve) => actions.push({ init, resolve }))
    const params = new URLSearchParams(url.split('?')[1])
    const parent = params.get('parentSessionId')
    const child = params.get('childId')
    const task = parent === 'parent-1' ? firstTask : secondTask
    return jsonResponse(child
      ? { ok: true, value: { task } }
      : { ok: true, value: { revision: 1, tasks: [task] } })
  } })
  const { view, props } = await renderTaskPanel(app)
  const oldAction = control(view.tree, 'archive-old-child').props.onClick()
  assert.equal(actions.length, 1)
  const newProps = { ...props, scope: { sessionId: 'parent-2' }, tab: { meta: {} } }
  await view.settle(newProps)
  assert.equal(actions[0].init.signal.aborted, true)
  actions[0].resolve(jsonResponse({ ok: false, error: { message: 'stale parent failure' } }, false))
  await oldAction
  let tree = await view.settle(newProps)
  assert.equal(workspace(tree).props['data-task-id'], 'new-child')
  assert.doesNotMatch(text(tree), /stale parent failure|accepted by the Host/i)

  const hiddenAction = control(tree, 'archive-new-child').props.onClick()
  assert.equal(actions.length, 2)
  await view.settle({ ...newProps, visible: false })
  assert.equal(actions[1].init.signal.aborted, true)
  actions[1].resolve(jsonResponse({ ok: true, value: { childId: 'new-child', subagentId: 'stale-receipt' } }))
  await hiddenAction
  tree = await view.settle({ ...newProps, visible: false })
  assert.doesNotMatch(text(tree), /stale-receipt|accepted by the Host/i)
  view.dispose()
  app.dispose()
})

test('task tabs, workspace badges and completion cards use Codex, Kimi Code and Antigravity labels', async () => {
  const tasks = [
    { ...summary, agent: 'codex', label: 'Codex task', startedAt: 1000 },
    { ...summary, childId: 'child-kimi', agent: 'kimi-code', label: 'Kimi task', startedAt: 2000 },
    { ...summary, childId: 'child-agy', agent: 'agy', label: 'Antigravity task', startedAt: 3000 },
  ]
  const app = taskDetailApp((url) => {
    const childId = new URLSearchParams(url.split('?')[1]).get('childId')
    return tasks.find((task) => task.childId === childId)
  }, tasks)
  const { view, tree } = await renderTaskPanel(app)
  const tabLabels = byRole(tree, 'tab').map((tab) => text(nodes(tab, 'span').find((node) => node.props.className === 'matasks-tab-provider')))
  assert.deepEqual(tabLabels, ['Antigravity (agy)', 'Kimi Code', 'Codex'])
  assert.ok(nodes(workspace(tree), 'span').some((node) => node.props.className === 'matasks-badge' && text(node) === 'Antigravity (agy)'))

  const node = completionNode()
  node.data.source.senderSessionId = 'child-agy'
  const completion = app.renderer(app.completion.component, { node, sessionId: 'parent-1', cwd: '/workspace' })
  const completionTree = await completion.settle()
  assert.ok(nodes(completionTree, 'span').some((item) => item.props.className === 'matasks-badge' && text(item) === 'Antigravity (agy)'))
  completion.dispose()
  view.dispose()
  app.dispose()
})

test('activity timeline interleaves full messages with chronological compact tool groups', async () => {
  const longMessage = `Full message ${'body '.repeat(90)}\nwithout a preview`
  const app = taskDetailApp({
    ...summary, status: 'completed', output: 'Final result not yet in the activity stream',
    activities: [
      { id: 'm1', type: 'message', text: longMessage },
      { id: 't1', type: 'tool', title: 'Read client.js', text: 'first full tool output' },
      { id: 't2', type: 'tool', title: 'Edit client.js', text: 'second full tool output' },
      { id: 'm2', type: 'message', text: 'Implementation complete.' },
      { id: 't3', type: 'tool', title: 'Run tests', text: 'all tests passed' },
    ],
  })
  const { view, tree } = await renderTaskPanel(app)
  const timeline = nodes(tree, 'div').find((node) => node.props.className === 'matasks-timeline')
  assert.ok(timeline)
  assert.deepEqual(nodes(timeline).filter((node) => node.props['data-activity-id']).map((node) => node.props['data-activity-id']), ['m1', 't1', 't2', 'm2', 't3'])
  const groups = nodes(timeline, 'details').filter((node) => node.props.className === 'matasks-tool-activity')
  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map((group) => nodes(group, 'li').filter((item) => item.props['data-activity-id']).length), [2, 1])
  assert.ok(groups.every((group) => group.props.open === undefined))
  assert.ok(groups.every((group) => nodes(group, 'svg').length > 0))
  assert.deepEqual(nodes(timeline, 'code').filter((node) => node.props.className === 'matasks-command-preview').map(text), ['Read client.js', 'Edit client.js', 'Run tests'])
  assert.ok(nodes(groups[0], 'details').filter((node) => node.props.className === 'matasks-tool-detail').every((node) => node.props.open === undefined))

  const messages = nodes(timeline, 'div').filter((node) => node.props.className === 'matasks-markdown matasks-message')
  assert.equal(messages.length, 2)
  assert.equal(text(messages[0]).trim().replace(/\s+/g, ' '), longMessage.replace(/\s+/g, ' '))
  assert.equal(nodes(messages[0], 'details').length, 0)
  assert.equal(nodes(messages[0], 'span').filter((node) => node.props.className === 'matasks-badge').length, 0)
  assert.equal(nodes(tree).some((node) => node.props.className === 'matasks-message-preview'), false)
  assert.equal(nodes(tree, 'li').some((node) => node.props.className?.split(' ').includes('matasks-activity')), false)
  assert.match(text(tree), /Final result not yet in the activity stream/)
  assert.equal(nodes(tree).some((node) => ['matasks-output-preview', 'matasks-output-disclosure'].includes(node.props.className)), false)
  view.dispose()
  app.dispose()
})

test('final output is omitted when it duplicates the last full message', async () => {
  const output = 'Repeated final answer'
  const app = taskDetailApp({
    ...summary, status: 'completed', output,
    activities: [{ id: 'last-message', type: 'message', text: output }],
  })
  const { view, tree } = await renderTaskPanel(app)
  assert.equal(nodes(tree, 'p').filter((node) => text(node) === output).length, 1)
  assert.equal(nodes(tree, 'h3').some((node) => text(node) === 'Final output'), false)
  view.dispose()
  app.dispose()
})

test('reading pause has no footer copy and exposes only an icon button back to latest', async () => {
  const detail = {
    ...summary,
    activities: Array.from({ length: 9 }, (_, index) => ({ id: `m-${index}`, type: 'message', text: `message ${index}` })),
  }
  const app = taskDetailApp(detail)
  const viewport = mockViewport()
  const { view } = await renderTaskPanel(app, { viewport })
  app.frames.flush()
  assert.equal(control(view.tree, 'jump-latest'), undefined)
  viewport.scrollTop = 300
  activityViewport(view.tree).props.onScroll({ currentTarget: viewport })
  const tree = view.render()
  const jump = control(tree, 'jump-latest')
  assert.ok(jump)
  assert.equal(jump.props.className, 'matasks-jump-latest')
  assert.equal(jump.props['aria-label'], 'Back to latest')
  assert.equal(text(jump).trim(), '')
  assert.equal(nodes(tree, 'footer').some((node) => node.props.className === 'matasks-follow-footer'), false)
  assert.doesNotMatch(text(tree), /Following latest activity|Paused while reading/)
  assert.equal(app.dictionaries[0][1].zh['tasks.jumpToLatest'], '回到最新')
  jump.props.onClick()
  assert.equal(viewport.scrollTop, 800)
  assert.equal(control(view.render(), 'jump-latest'), undefined)
  view.dispose()
  app.dispose()
})

test('messages and final output render Markdown semantics through real markdown-it tokens', async () => {
  const markdown = [
    '### Result **summary**',
    '',
    '- item with `inline code`',
    '  - nested item',
    '',
    '> quoted text',
    '',
    '3. third item',
    '4. fourth item',
    '',
    '| Name | Value |',
    '| --- | ---: |',
    '| A | B |',
    '',
    '```js',
    "const html = '<img src=x onerror=alert(1)>'",
    '```',
  ].join('\n')
  const app = taskDetailApp({
    ...summary, status: 'completed', output: '### Final **output**',
    activities: [{ id: 'markdown-message', type: 'message', text: markdown }],
  })
  const { view, tree } = await renderTaskPanel(app)
  const message = nodes(tree, 'div').find((node) => node.props['data-activity-id'] === 'markdown-message')
  assert.ok(message)
  assert.equal(message.props.className, 'matasks-markdown matasks-message')
  assert.equal(text(nodes(message, 'h3')[0]).trim().replace(/\s+/g, ' '), 'Result summary')
  assert.equal(text(nodes(message, 'strong')[0]), 'summary')
  assert.ok(nodes(message, 'ul').length >= 2)
  assert.ok(nodes(message, 'li').some((node) => text(node).includes('nested item')))
  assert.ok(nodes(message, 'code').some((node) => text(node) === 'inline code'))
  assert.match(text(nodes(message, 'blockquote')[0]), /quoted text/)
  assert.equal(nodes(message, 'table').length, 1)
  assert.ok(nodes(message, 'th').length >= 2)
  assert.ok(nodes(message, 'td').length >= 2)
  assert.equal(nodes(message, 'td')[1].props.style.textAlign, 'right')
  assert.equal(nodes(message, 'ol')[0].props.start, 3)
  const fence = nodes(message, 'pre')[0]
  assert.match(text(fence), /const html = '<img src=x onerror=alert\(1\)>'/)
  assert.equal(nodes(fence, 'code').length, 1)
  assert.equal(nodes(tree, 'img').length, 0)

  const finalOutput = nodes(tree, 'section').find((node) => node.props.className === 'matasks-final-output')
  assert.ok(nodes(finalOutput, 'strong').some((node) => text(node) === 'output'))
  assert.ok(nodes(finalOutput, 'div').some((node) => node.props.className === 'matasks-markdown matasks-final-output-text'))
  view.dispose()
  app.dispose()
})

test('Markdown links enforce external safety and open native file resources with encoded session addresses', async () => {
  const task = {
    ...summary, cwd: '/child/workspace',
    activities: [{
      id: 'links', type: 'message', text: [
        '[Absolute](/tmp/a%20b(1).md)',
        '[File URL](file:///tmp/c%20d.md)',
        '[Drive slash](C:/work/a%20b(1).md)',
        String.raw`[Drive backslash](<C:\work\a b(1).md>)`,
        '[Drive file URL](file:///C:/work/c%20d.md)',
        String.raw`[UNC](<\\\\server\\share\\reports\\final.md>)`,
        '[Relative](<././docs/My File(1).md>)',
        '[Web](https://example.com/a)',
        '[Mail](mailto:agent@example.com)',
        '[JS](javascript:alert(1))',
        '[Data](data:text/html,evil)',
        '[VB](vbscript:evil)',
        '[Protocol](//evil.example/x)',
        '<img src="https://evil.example/raw" onerror="alert(1)">',
        '![Remote alt](https://evil.example/image.png)',
      ].join('\n\n') },
    ],
  }
  const app = taskDetailApp(task, [task])
  const { view, tree } = await renderTaskPanel(app, { parentSessionId: 'parent / one:β' })
  const links = nodes(workspace(tree), 'a')
  const byLabel = (label) => links.find((link) => text(link).trim() === label)
  const sessionAddress = 'dsh-resource://file/session/parent%20%2F%20one:%CE%B2'
  for (const [label, suffix] of [
    ['Absolute', '//tmp/a%20b(1).md'],
    ['File URL', '//tmp/c%20d.md'],
    ['Drive slash', '/C:/work/a%20b(1).md'],
    ['Drive backslash', '/C:/work/a%20b(1).md'],
    ['Drive file URL', '/C:/work/c%20d.md'],
    ['UNC', '///server/share/reports/final.md'],
    ['Relative', '//child/workspace/docs/My%20File(1).md'],
  ]) {
    const link = byLabel(label)
    assert.ok(link, label)
    let prevented = false
    link.props.onClick({ preventDefault() { prevented = true } })
    assert.equal(prevented, true)
    assert.deepEqual(app.files.at(-1), { address: `${sessionAddress}${suffix}` })
  }
  for (const label of ['Web', 'Mail']) {
    assert.equal(byLabel(label).props.rel, 'noopener noreferrer')
    assert.equal(byLabel(label).props.target, '_blank')
  }
  assert.equal(byLabel('Web').props.href, 'https://example.com/a')
  assert.equal(byLabel('Mail').props.href, 'mailto:agent@example.com')
  for (const label of ['JS', 'Data', 'VB', 'Protocol']) assert.equal(byLabel(label), undefined, label)
  assert.equal(nodes(tree, 'img').length, 0)
  assert.equal(nodes(tree, 'script').length, 0)
  assert.match(text(tree), /Remote alt/)
  assert.match(text(tree), /<img src="https:\/\/evil\.example\/raw"/)
  assert.equal(links.some((link) => link.props.href?.includes('evil.example')), false)
  view.dispose()
  app.dispose()
})

test('relative Markdown paths use a Windows child cwd and remain relative without cwd', async () => {
  const cases = [
    {
      name: 'Windows child cwd',
      cwd: 'C:\\child\\workspace\\',
      expected: 'dsh-resource://file/session/parent-1/C:/child/workspace/docs/../My%20File(1).md',
    },
    {
      name: 'missing child cwd',
      cwd: undefined,
      expected: 'dsh-resource://file/session/parent-1/docs/../My%20File(1).md',
    },
  ]
  for (const scenario of cases) {
    const task = {
      ...summary,
      cwd: scenario.cwd,
      activities: [{ id: 'relative', type: 'message', text: '[Relative](<././docs/../My File(1).md>)' }],
    }
    const app = taskDetailApp(task, [task])
    const { view, tree } = await renderTaskPanel(app)
    const link = nodes(workspace(tree), 'a').find((node) => text(node).trim() === 'Relative')
    assert.ok(link, scenario.name)
    link.props.onClick({ preventDefault() {} })
    assert.deepEqual(app.files, [{ address: scenario.expected }], scenario.name)
    view.dispose()
    app.dispose()
  }
})

test('unclosed streaming Markdown remains renderable without raw HTML nodes', async () => {
  const app = taskDetailApp({
    ...summary,
    activities: [{ id: 'streaming', type: 'message', text: '### Streaming\n\n**open strong\n\n```js\nconst value = 1' }],
  })
  const { view, tree } = await renderTaskPanel(app)
  const message = nodes(tree, 'div').find((node) => node.props['data-activity-id'] === 'streaming')
  assert.equal(text(nodes(message, 'h3')[0]).trim(), 'Streaming')
  assert.match(text(nodes(message, 'pre')[0]), /const value = 1/)
  assert.match(text(tree), /\*\*open strong/)
  assert.equal(nodes(tree, 'script').length, 0)
  view.dispose()
  app.dispose()
})

function telemetryText(tree) {
  const line = nodes(tree, 'div').find((node) => node.props.className === 'matasks-telemetry')
  assert.ok(line)
  return text(line)
}

test('task telemetry shows actual model, configured effort and authoritative large token totals', async () => {
  const total = 1234567890
  const task = {
    ...summary,
    telemetry: {
      model: 'gpt-5', reasoningEffort: 'high', modelSource: 'reported', reasoningEffortSource: 'configured',
      usage: {
        inputTokens: 123, outputTokens: 456, totalTokens: total,
        cacheReadTokens: 0, cacheWriteTokens: 9, reasoningTokens: 0,
      },
      usageScope: 'turn',
    },
  }
  const app = taskDetailApp(task, [task])
  const { view, tree } = await renderTaskPanel(app)
  const content = telemetryText(tree)
  assert.match(content, /Model: gpt-5 · reported/)
  assert.match(content, /Reasoning effort: high · configured/)
  assert.match(content, new RegExp(`Turn tokens: ${new Intl.NumberFormat().format(total)}`))
  assert.doesNotMatch(content, /Turn tokens: 579/)
  const usage = nodes(tree, 'span').find((node) => node.props.className === 'matasks-token-usage')
  assert.match(usage.props.title, /Input: 123/)
  assert.match(usage.props.title, /Output: 456/)
  assert.match(usage.props.title, /Cache read: 0/)
  assert.match(usage.props.title, /Cache write: 9/)
  assert.match(usage.props.title, /Reasoning: 0/)
  assert.doesNotMatch(usage.props.title, /undefined|NaN/)
  assert.equal(app.dictionaries[0][1].zh['telemetry.source.configured'], '配置')
  assert.equal(app.dictionaries[0][1].zh['telemetry.source.reported'], '实际')
  view.dispose()
  app.dispose()
})

test('token totals use input plus output only when both are known and preserve zero or missing values', async () => {
  const cases = [
    { name: 'derived total with a real zero', telemetry: { usage: { inputTokens: 0, outputTokens: 12 }, usageScope: 'task' }, expected: 'Task tokens: 12' },
    { name: 'explicit zero total wins over other values', telemetry: { usage: { inputTokens: 99, outputTokens: 99, totalTokens: 0 }, usageScope: 'session' }, expected: 'Session tokens: 0' },
    { name: 'both zero can derive zero', telemetry: { usage: { inputTokens: 0, outputTokens: 0 }, usageScope: 'task' }, expected: 'Task tokens: 0' },
    { name: 'partial input is not a total', telemetry: { usage: { inputTokens: 8 } }, expected: 'Token: —' },
    { name: 'invalid values and sources are discarded', telemetry: { model: ' ', reasoningEffort: '', modelSource: 'bad', reasoningEffortSource: 'bad', usage: { inputTokens: -2, outputTokens: 2, totalTokens: '4', cacheReadTokens: NaN }, usageScope: 'bad' }, expected: 'Token: —' },
    { name: 'empty telemetry stays missing', telemetry: {}, expected: 'Token: —' },
    { name: 'legacy tasks have no telemetry', expected: 'Token: —' },
  ]
  for (const scenario of cases) {
    const task = { ...summary, ...(scenario.telemetry === undefined ? {} : { telemetry: scenario.telemetry }) }
    const app = taskDetailApp(task, [task])
    const { view, tree } = await renderTaskPanel(app)
    const content = telemetryText(tree)
    assert.ok(content.includes(scenario.expected), `${scenario.name}: ${content}`)
    if (['invalid values and sources are discarded', 'empty telemetry stays missing', 'legacy tasks have no telemetry'].includes(scenario.name)) {
      assert.match(content, /Model: Not provided/)
      assert.match(content, /Reasoning effort: Not provided/)
      assert.doesNotMatch(content, /NaN|undefined|bad/)
    }
    view.dispose()
    app.dispose()
  }
})

test('telemetry refreshes asynchronously and remains isolated between child tasks', async () => {
  const clock = timers()
  const first = {
    ...summary, childId: 'child-1', label: 'First telemetry', startedAt: 1000,
    telemetry: { model: 'first-model', usage: { totalTokens: 1 }, usageScope: 'task' },
  }
  const second = {
    ...summary, childId: 'child-2', label: 'Second telemetry', startedAt: 2000,
    telemetry: { model: 'second-model', usage: { totalTokens: 2 }, usageScope: 'task' },
  }
  let currentSecond = second.telemetry
  const tasks = [first, second]
  const app = taskDetailApp((url) => {
    const childId = new URLSearchParams(url.split('?')[1]).get('childId')
    return childId === 'child-2' ? { ...second, telemetry: currentSecond } : first
  }, tasks, { clock })
  const { view } = await renderTaskPanel(app)
  assert.match(telemetryText(view.tree), /second-model/)
  assert.match(telemetryText(view.tree), /Task tokens: 2/)

  currentSecond = { model: 'second-model-v2', reasoningEffort: 'medium', usage: { totalTokens: 22 }, usageScope: 'task' }
  await clock.advance(1500)
  let tree = await view.settle()
  assert.match(telemetryText(tree), /second-model-v2/)
  assert.match(telemetryText(tree), /Task tokens: 22/)

  control(tree, 'task-tab-child-1').props.onClick()
  tree = await view.settle()
  assert.match(telemetryText(tree), /first-model/)
  assert.match(telemetryText(tree), /Task tokens: 1/)
  assert.doesNotMatch(telemetryText(tree), /second-model-v2|Task tokens: 22/)
  control(tree, 'task-tab-child-2').props.onClick()
  tree = await view.settle()
  assert.match(telemetryText(tree), /second-model-v2/)
  assert.match(telemetryText(tree), /Task tokens: 22/)
  view.dispose()
  app.dispose()
})
