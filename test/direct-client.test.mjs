import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../direct-client.js', import.meta.url), 'utf8')
const icons = Object.fromEntries(['deepseek', 'openai', 'kimi', 'google'].map((id) => [
  id, readFileSync(new URL(`../assets/icons/${id}.svg`, import.meta.url), 'utf8'),
]))

function miniReact() {
  let active
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (initial) => active.useState(initial),
    useRef: (initial) => active.useRef(initial),
    useEffect: (effect, deps) => active.useEffect(effect, deps),
  }
  function mount(component, props) {
    const cells = []
    let pending = []
    let tree
    const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
    function render() {
      pending = []
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
    return { render, get tree() { return tree }, dispose() { for (const cell of cells) cell?.cleanup?.() } }
  }
  return { React, mount }
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return []
  return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap((child) => find(child, predicate))]
}
const named = (tree, type, name) => find(tree, (node) => node.type === type && node.props?.name === name)[0]

function setup() {
  const runtime = miniReact()
  const registrations = []
  const definitions = []
  const cleanups = []
  let plugin
  const win = {
    __ModuleLoader__: { load(entry) { plugin = entry.factory((id) => id === 'react' ? runtime.React : icons) } },
    localStorage: { getItem: () => null, setItem() {} },
    location: { protocol: 'http:' },
  }
  vm.runInNewContext(source, { window: win })
  plugin.apply({
    locale: { register() { return () => {} }, bind: () => (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), key) },
    uiConversation: { events: { register(definition) { definitions.push(definition); return () => {} } } },
    effect(callback) { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup); return cleanup },
    slots: {
      inject(_name, callback) { return callback() },
      register(spec, component) {
        const entry = { spec, component }
        registrations.push(entry)
        return () => registrations.splice(registrations.indexOf(entry), 1)
      },
    },
  })
  return { runtime, registrations, definitions, cleanups }
}

test('direct Agent selection preserves the native composer and only swaps internal command prefixes', () => {
  const app = setup()
  assert.equal(app.registrations.some((entry) => entry.spec.name === 'conversation.composer'), false)
  const activity = app.registrations.find((entry) => entry.spec.name === 'conversation.input.activity')
  assert.ok(activity)
  assert.ok((activity.spec.priority ?? 0) < 0, 'activity picker shadows priority-0 single slot entries')
  let input = { draft: 'hello', draftRev: 1, attachmentIds: ['file-1'], phase: 'plain' }
  const writes = []
  const props = {
    sessionId: 'session-1', useInput: (selector) => selector(input),
    inputActions: {
      setDraft(value) { input = { ...input, draft: value, draftRev: input.draftRev + 1 }; writes.push(value) },
      persistDraft() {},
    },
  }
  const wrapper = app.runtime.mount(activity.component, props)
  const wrapped = wrapper.render()
  const direct = app.runtime.mount(wrapped.type, wrapped.props)
  let pickerTree = direct.render()
  const picker = app.runtime.mount(pickerTree.type, pickerTree.props)
  let tree = picker.render()
  named(tree, 'button', 'direct-agent-picker').props.onClick()
  tree = picker.render()
  named(tree, 'button', 'direct-agent-codex').props.onClick()
  pickerTree = direct.render()
  assert.equal(input.draft, '/agent-codex hello')
  assert.deepEqual(input.attachmentIds, ['file-1'])

  pickerTree.props.store.set('session-1', 'kimi-code')
  pickerTree = direct.render()
  assert.equal(input.draft, '/agent-kimi hello')
  pickerTree.props.store.set('session-1', 'main')
  pickerTree = direct.render()
  assert.equal(input.draft, 'hello')

  input = { ...input, draft: '' }
  pickerTree.props.store.set('session-1', 'agy')
  pickerTree = direct.render()
  assert.equal(input.draft, '/agent-agy ')
  assert.deepEqual(input.attachmentIds, ['file-1'])
  assert.equal(writes.includes('undefined'), false)

  const hiddenCommands = app.registrations.filter((entry) => entry.spec.name === 'conversation.chat.commandview')
  assert.deepEqual(hiddenCommands.map((entry) => entry.spec.key).sort(), ['agent-agy', 'agent-codex', 'agent-dsh', 'agent-kimi'])
  for (const command of hiddenCommands) assert.equal(command.component(), null)
  picker.dispose()
  direct.dispose()
  wrapper.dispose()
  for (const cleanup of app.cleanups) cleanup()
})

test('direct replies become visible native assistant nodes carried by legal command pairs', () => {
  const app = setup()
  const definition = app.definitions.find((entry) => entry.kind === 'multi-agent-direct-assistant')
  const event = {
    type: 'command/done', seq: 13, time: 100,
    data: { commandId: 'ma-direct-msg-codex--message-a', kind: 'success', text: '**回复**' },
  }
  assert.equal(definition.match(event).role, 'start')
  assert.equal(definition.match(event).exclusive, true)
  const state = definition.start(undefined, { event })
  const node = definition.buildViewNode({ key: 'node-a', id: 'message-a', state, start: { location: { kind: 'unresolved' } } })
  assert.equal(node.kind, 'assistant-step')
  assert.equal(node.visibility, 'visible')
  assert.equal(node.anchorSeq, 12.9)
  assert.equal(node.data.finalNode.messageId, 'ma-direct-msg-codex--message-a')
  assert.equal(node.data.finalNode.providerMetadata.provider, 'multi-agent-codex')
  assert.equal(node.data.blocks[0].text, '**回复**')
  assert.equal(definition.match({ ...event, data: { ...event.data, commandId: 'cmd-native-1' } }), null)
  assert.equal(definition.match({ ...event, data: { ...event.data, kind: 'error', text: 'boom' } }), null)
  assert.equal(definition.match({ ...event, data: { ...event.data, text: '' } }), null)
  assert.equal(definition.match({ type: 'assistant/message', surfaceOp: 'append', seq: 20, data: {} }), null)
  for (const cleanup of app.cleanups) cleanup()
})

test('direct user input becomes a chat node anchored to its command run', () => {
  const app = setup()
  const definition = app.definitions.find((entry) => entry.kind === 'multi-agent-direct-input')
  const event = {
    type: 'command/run', seq: 12, time: 100,
    data: { commandId: 'cmd-native-12', name: 'agent-codex', args: '发布当前这个新版本', source: { kind: 'user' } },
  }
  assert.equal(definition.match(event).role, 'start')
  assert.equal(definition.match(event).exclusive, true)
  const state = definition.start(undefined, { event })
  const node = definition.buildViewNode({ key: 'node-u', id: 'input-12', state, start: { location: { kind: 'unresolved' } } })
  assert.equal(node.kind, 'multi-agent-direct-input')
  assert.equal(node.visibility, 'visible')
  assert.equal(node.anchorSeq, 11.9)
  assert.equal(node.data.text, '发布当前这个新版本')
  assert.equal(node.data.commandId, 'cmd-native-12')
  assert.equal(definition.match({ ...event, data: { ...event.data, commandId: 'ma-direct-msg-codex--x' } }), null, 'synthetic assistant runs are excluded')
  assert.equal(definition.match({ ...event, data: { ...event.data, args: '' } }), null)
  assert.equal(definition.match({ ...event, data: { ...event.data, name: 'goal' } }), null)
  const userView = app.registrations.find((entry) => entry.spec.name === 'conversation.chat.node' && entry.spec.key === 'multi-agent-direct-input')
  assert.ok(userView, 'user input bubble view is registered')
  const rendered = userView.component({ node, renderFactorySlot: (_slot, props) => props.text })
  assert.equal(rendered.props.className, 'ma-direct-user-row')
  for (const cleanup of app.cleanups) cleanup()
})

test('a throwing subscriber cannot block direct agent selection or closing the picker menu', () => {
  const app = setup()
  const activity = app.registrations.find((entry) => entry.spec.name === 'conversation.input.activity')
  let input = { draft: '', draftRev: 1, attachmentIds: [], phase: 'plain' }
  const props = {
    sessionId: 'session-err', useInput: (selector) => selector(input),
    inputActions: {
      setDraft(value) { input = { ...input, draft: value, draftRev: input.draftRev + 1 } },
      persistDraft() {},
    },
  }
  const wrapper = app.runtime.mount(activity.component, props)
  const wrapped = wrapper.render()
  const direct = app.runtime.mount(wrapped.type, wrapped.props)
  let pickerTree = direct.render()
  const unsub = pickerTree.props.store.subscribe(() => { throw new Error('broken listener') })
  const picker = app.runtime.mount(pickerTree.type, pickerTree.props)
  let tree = picker.render()
  named(tree, 'button', 'direct-agent-picker').props.onClick()
  tree = picker.render()
  assert.ok(named(tree, 'button', 'direct-agent-codex'))
  named(tree, 'button', 'direct-agent-codex').props.onClick()
  tree = picker.render()
  assert.equal(named(tree, 'button', 'direct-agent-codex'), undefined, 'picker menu closes even if another listener throws')
  pickerTree = direct.render()
  assert.equal(pickerTree.props.selected, 'codex')
  assert.equal(input.draft, '/agent-codex ')
  unsub()
  picker.dispose()
  direct.dispose()
  wrapper.dispose()
  for (const cleanup of app.cleanups) cleanup()
})
