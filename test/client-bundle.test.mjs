import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEME_CHANGE_EVENT, THEME_IDS, THEME_STORAGE_KEY } from '../lib/ui-theme.js'

const root = fileURLToPath(new URL('..', import.meta.url))

function stageBuildRoot(t) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-client-bundle-'))
  t.after(() => {
    const linkedModules = join(tempRoot, 'node_modules')
    try {
      if (lstatSync(linkedModules).isSymbolicLink()) rmSync(linkedModules, { recursive: false, force: true })
    } catch {}
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })
  mkdirSync(join(tempRoot, 'scripts'), { recursive: true })
  mkdirSync(join(tempRoot, 'lib'), { recursive: true })
  cpSync(join(root, 'package.json'), join(tempRoot, 'package.json'))
  cpSync(join(root, 'client.js'), join(tempRoot, 'client.js'))
  cpSync(join(root, 'tasks-client.js'), join(tempRoot, 'tasks-client.js'))
  cpSync(join(root, 'lib', 'ui-theme.js'), join(tempRoot, 'lib', 'ui-theme.js'))
  cpSync(join(root, 'lib', 'task-indicator-store.js'), join(tempRoot, 'lib', 'task-indicator-store.js'))
  cpSync(join(root, 'scripts', 'build-client.mjs'), join(tempRoot, 'scripts', 'build-client.mjs'))
  try {
    symlinkSync(join(root, 'node_modules'), join(tempRoot, 'node_modules'), 'junction')
  } catch {
    mkdirSync(join(tempRoot, 'node_modules'), { recursive: true })
    cpSync(join(root, 'node_modules', 'markdown-it'), join(tempRoot, 'node_modules', 'markdown-it'), {
      recursive: true,
      dereference: true,
    })
  }
  return tempRoot
}

function assertBundleRuntime(source) {
  const entries = []
  const sandbox = { window: { __ModuleLoader__: { load: entry => entries.push(entry) } } }
  vm.runInNewContext(source, sandbox, { timeout: 3000 })
  assert.equal(entries.length, 1)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(entries[0].id, manifest.name)
  assert.equal(sandbox.markdownit, undefined)
  assert.equal(Object.keys(sandbox.window).join(','), '__ModuleLoader__', 'bundle must not attach extra window globals')
  const imports = []
  const plugin = entries[0].factory(id => {
    imports.push(id)
    assert.equal(id, 'react', 'third-party parser and internal theme module must not need a Host runtime module')
    return { createElement() {}, memo: component => component }
  })
  assert.deepEqual(imports, ['react', 'react'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(sandbox.markdownit, undefined, 'parser must not leak a global')
  assert.ok(source.includes('markdown-it 14.1.0'))
  assert.ok(source.includes('THIRD_PARTY_NOTICES.md'))
  assert.ok(source.includes(THEME_STORAGE_KEY))
  assert.ok(source.includes(THEME_CHANGE_EVENT))
  for (const id of THEME_IDS) {
    assert.ok(source.includes(`'${id}'`), `bundle must declare theme id ${id}`)
  }
}

function createMiniReact() {
  let active
  let seq = 0
  const ids = new WeakMap()
  const idOf = (fn) => {
    if (!ids.has(fn)) ids.set(fn, ++seq)
    return ids.get(fn)
  }
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (init) => active.useState(init),
    useRef: (init) => active.useRef(init),
    useEffect: (fn, deps) => active.useEffect(fn, deps),
    useLayoutEffect: (fn, deps) => active.useEffect(fn, deps),
    useMemo: (fn, deps) => active.useMemo(fn, deps),
    useCallback: (fn, deps) => active.useMemo(() => fn, deps),
  }
  function mount(roots) {
    const records = new Map()
    let pending = []
    function renderAll() {
      pending = []
      const seen = new Set()
      const expand = (node, path) => {
        if (!node || typeof node !== 'object') return node
        const key = node.props?.key ?? ''
        if (typeof node.type === 'function') {
          const recId = `${path}/c-${idOf(node.type)}:${key}`
          let rec = records.get(recId)
          if (!rec) { rec = { cells: [], disposed: false }; records.set(recId, rec) }
          seen.add(recId)
          let cursor = 0
          const prev = active
          active = {
            useState(init) {
              const i = cursor++
              if (!(i in rec.cells)) rec.cells[i] = { value: typeof init === 'function' ? init() : init }
              return [rec.cells[i].value, (next) => {
                if (rec.disposed) return
                rec.cells[i].value = typeof next === 'function' ? next(rec.cells[i].value) : next
              }]
            },
            useRef(init) {
              const i = cursor++
              if (!(i in rec.cells)) rec.cells[i] = { value: { current: init } }
              return rec.cells[i].value
            },
            useEffect(fn, deps) {
              const i = cursor++
              const old = rec.cells[i]
              if (!old || !same(old.deps, deps)) {
                pending.push({ rec, i, fn, deps, cleanup: old?.cleanup })
                rec.cells[i] = { deps, cleanup: old?.cleanup }
              }
            },
            useMemo(fn, deps) {
              const i = cursor++
              const old = rec.cells[i]
              if (!old || !same(old.deps, deps)) rec.cells[i] = { deps, value: fn() }
              return rec.cells[i].value
            },
          }
          const out = node.type({ ...node.props, ...(node.children.length ? { children: node.children } : {}) })
          active = prev
          return expand(out, recId)
        }
        return { ...node, children: (node.children || []).map((c, idx) => expand(c, `${path}/h-${node.type}:${key}/${idx}`)) }
      }
      const out = {}
      for (const [k, make] of Object.entries(roots)) out[k] = expand(make(), `root:${k}`)
      for (const [id, rec] of records) {
        if (!seen.has(id)) {
          rec.disposed = true
          for (const cell of rec.cells) cell?.cleanup?.()
          records.delete(id)
        }
      }
      for (const item of pending) {
        if (item.rec.disposed) continue
        item.cleanup?.()
        const cleanup = item.fn()
        item.rec.cells[item.i] = { deps: item.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
      }
      return out
    }
    return {
      renderAll,
      dispose() {
        for (const rec of records.values()) {
          rec.disposed = true
          for (const cell of rec.cells) cell?.cleanup?.()
        }
        records.clear()
      },
    }
  }
  return { React, mount }
}

function findNodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return []
  return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap((c) => findNodes(c, predicate))]
}

test('built Client embeds Markdown parser and UI theme privately, needs only React at runtime, and matches checked-in bundle', (t) => {
  const tempRoot = stageBuildRoot(t)
  execFileSync(process.execPath, [join(tempRoot, 'scripts', 'build-client.mjs')], { cwd: tempRoot })
  const builtSource = readFileSync(join(tempRoot, 'client-bundle.js'), 'utf8')
  assertBundleRuntime(builtSource)
  const checkedInSource = readFileSync(new URL('../client-bundle.js', import.meta.url), 'utf8')
  assertBundleRuntime(checkedInSource)
  assert.equal(checkedInSource, builtSource, 'checked-in client-bundle.js must be rebuilt from current sources')
})

test('client-bundle synchronizes themes instantly across settings modal, task panel, and completion card even when localStorage throws', () => {
  const checkedInSource = readFileSync(new URL('../client-bundle.js', import.meta.url), 'utf8')
  for (const storageBroken of [false, true]) {
    const storeMap = new Map()
    const winListeners = new Map()
    const win = {
      localStorage: storageBroken
        ? {
            getItem() { throw new Error('SecurityError') },
            setItem() { throw new Error('QuotaExceededError') },
          }
        : {
            getItem: (k) => (storeMap.has(k) ? storeMap.get(k) : null),
            setItem: (k, v) => { storeMap.set(k, String(v)) },
          },
      addEventListener(type, fn) {
        if (!winListeners.has(type)) winListeners.set(type, new Set())
        winListeners.get(type).add(fn)
      },
      removeEventListener(type, fn) {
        winListeners.get(type)?.delete(fn)
      },
      dispatchEvent(event) {
        for (const fn of [...(winListeners.get(event.type) || [])]) fn(event)
        return true
      },
      CustomEvent,
      __ModuleLoader__: { load(entry) { win._entry = entry } },
    }
    const doc = { addEventListener() {}, removeEventListener() {}, activeElement: null }
    vm.runInNewContext(checkedInSource, {
      window: win,
      document: doc,
      CustomEvent,
      AbortController,
      URLSearchParams,
      setTimeout: () => 1,
      clearTimeout: () => {},
      fetch: async () => ({ ok: true, json: async () => ({ ok: true, value: { revision: 1, tasks: [], groups: [], failures: [] } }) }),
    }, { timeout: 3000 })

    const runtime = createMiniReact()
    const plugin = win._entry.factory(() => runtime.React)
    const slots = new Map()
    const effectCleanups = []
    const formStub = {
      getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: { selectionMode: 'auto', timeoutSeconds: 1800, routes: [{ agent: 'codex', prompt: 'test' }] } }),
      subscribe: () => () => {},
      mutate: async () => true,
    }
    const ctx = {
      inject: (_deps, fn) => fn(ctx),
      effect: (fn) => { const off = fn(); if (typeof off === 'function') effectCleanups.push(off); return off },
      locale: { register: () => () => {}, bind: () => (k) => k },
      configForms: { get: () => formStub },
      remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }) } },
      sidebarRightTabs: { register: () => () => {} },
      sidebarRight: { mounted: { getSnapshot: () => 's1' }, openTab() {}, openResource() {} },
      sessions: { list: { getSnapshot: () => ({}), subscribe: () => () => {} } },
      uiConversation: { events: { register: () => () => {} } },
      slots: {
        inject: (_name, cb) => cb(),
        register: (spec, comp) => { slots.set(`${spec.name}:${spec.key || spec.id}`, comp); return () => {} },
      },
    }
    plugin.apply(ctx)

    const HeaderComp = slots.get('conversation.session.header.utilities:multi-agent-dispatch')
    const OverlayComp = slots.get('shell.overlay:multi-agent-dispatch')
    const TasksComp = slots.get('sidebar.right.pane.tab:dsh-multi-agent/tasks')
    const CompletionComp = slots.get('conversation.chat.node:multi-agent-dispatch-settled')

    const app = runtime.mount({
      header: () => runtime.React.createElement(HeaderComp, {}),
      overlay: () => runtime.React.createElement(OverlayComp, {}),
      tasks: () => runtime.React.createElement(TasksComp, {
        sessionId: 's1',
        useTabInfo: () => ({ tab: { visible: false, navigation: { revision: 0 } } }),
      }),
      completion: () => runtime.React.createElement(CompletionComp, {
        sessionId: 's1',
        node: { data: { text: 'done', source: { senderSessionId: '' } } },
      }),
    })

    let trees = app.renderAll()
    const trigger = findNodes(trees.header, (n) => n.type === 'button' && n.props.name === 'multi-agent-dispatch-trigger')[0]
    trigger.props.onClick()
    trees = app.renderAll()

    assert.equal(trees.overlay.props['data-ma-theme'], 'system')
    assert.equal(trees.tasks.props['data-ma-theme'], 'system')
    assert.equal(trees.completion.props['data-ma-theme'], 'system')

    // Switch via header <select name="modal-theme">
    const select = findNodes(trees.overlay, (n) => n.type === 'select' && n.props.name === 'modal-theme')[0]
    select.props.onChange({ target: { value: 'midnight' } })
    trees = app.renderAll()
    assert.equal(trees.overlay.props['data-ma-theme'], 'midnight')
    assert.equal(trees.tasks.props['data-ma-theme'], 'midnight')
    assert.equal(trees.completion.props['data-ma-theme'], 'midnight')
    if (!storageBroken) assert.equal(storeMap.get(THEME_STORAGE_KEY), 'midnight')

    // The header select is the only appearance control; no duplicate sidebar radio remains.
    const paperRadio = findNodes(trees.overlay, (n) => n.type === 'button' && n.props.name === 'theme-choice-paper')[0]
    assert.equal(paperRadio, undefined)
    select.props.onChange({ target: { value: 'paper' } })
    trees = app.renderAll()
    assert.equal(trees.overlay.props['data-ma-theme'], 'paper')
    assert.equal(trees.tasks.props['data-ma-theme'], 'paper')
    assert.equal(trees.completion.props['data-ma-theme'], 'paper')
    if (!storageBroken) assert.equal(storeMap.get(THEME_STORAGE_KEY), 'paper')

    app.dispose()
    for (const off of effectCleanups) off()
    assert.equal(winListeners.get('storage')?.size ?? 0, 0, 'storage listeners must clean up')
    assert.equal(winListeners.get(THEME_CHANGE_EVENT)?.size ?? 0, 0, 'theme change listeners must clean up')
  }
})
