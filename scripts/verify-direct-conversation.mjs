// Run with the installed Desktop runtime:
// ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" scripts/verify-direct-conversation.mjs
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const workspace = fileURLToPath(new URL('..', import.meta.url))
const install = process.env.DSH_INSTALL_DIR
assert.ok(install, 'DSH_INSTALL_DIR is required')
const packages = resolve(install, '..')
function copyFile(source, target) {
  const content = readFileSync(source, 'utf8')
  writeFileSync(target, source.endsWith('.ts') ? stripTypeScriptTypes(content, { mode: 'transform' }) : content)
}
function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else copyFile(from, to)
  }
}
const temp = mkdtempSync(join(tmpdir(), 'dsh-direct-assembler-'))
try {
  mkdirSync(join(temp, 'conversation'), { recursive: true })
  mkdirSync(join(temp, 'chat'), { recursive: true })
  writeFileSync(join(temp, 'package.json'), '{"type":"module"}')
  mkdirSync(join(temp, 'node_modules', '@deepseek-ai'), { recursive: true })
  const storePackage = join(temp, 'node_modules', '@deepseek-ai', 'dsh-client-store')
  const valuesPackage = join(temp, 'node_modules', '@deepseek-ai', 'dsh-util-values')
  mkdirSync(storePackage, { recursive: true })
  mkdirSync(valuesPackage, { recursive: true })
  writeFileSync(join(storePackage, 'package.json'), '{"type":"module","exports":"./index.js"}')
  writeFileSync(join(storePackage, 'index.js'), `export function createSnapshotStore(initial) {
    let value = initial
    const listeners = new Set()
    return {
      getSnapshot: () => value,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      set(next) { value = next; for (const listener of [...listeners]) listener() },
    }
  }
  export function notifySubscribers(listeners) { for (const listener of [...listeners]) listener() }`)
  writeFileSync(join(valuesPackage, 'package.json'), '{"type":"module","exports":"./index.js"}')
  writeFileSync(join(valuesPackage, 'index.js'), 'export function assertNever(value) { throw new Error(`Unexpected value: ${value}`) }')
  const apiPackage = join(temp, 'node_modules', '@deepseek-ai', 'dsh-api-session-controller')
  mkdirSync(apiPackage, { recursive: true })
  writeFileSync(join(apiPackage, 'package.json'), '{"type":"module","exports":{"./client":"./client.js"}}')
  writeFileSync(join(apiPackage, 'client.js'), '')
  for (const directory of ['contract', 'conversation']) {
    copyDirectory(join(packages, 'dsh-client-ui-conversation', 'src', 'client', directory), join(temp, 'conversation', directory))
  }
  const chatSources = join(packages, 'dsh-client-ui-chat', 'src', 'client', 'conversation-nodes')
  for (const name of ['assistant.ts', 'common.ts', 'event-projection.ts']) {
    copyFile(join(chatSources, name), join(temp, 'chat', name))
  }
  const { ConversationNodeAssembler } = await import(pathToFileURL(join(temp, 'conversation', 'conversation', 'assembler.ts')))
  const { assistantDefinition } = await import(pathToFileURL(join(temp, 'chat', 'assistant.ts')))

  let plugin
  const window = {
    __ModuleLoader__: { load(entry) { plugin = entry.factory(() => ({})) } },
    localStorage: { getItem: () => null, setItem() {} },
  }
  vm.runInNewContext(readFileSync(join(workspace, 'direct-client.js'), 'utf8'), { window })
  const definitions = []
  plugin.apply({
    locale: { register: () => () => {}, bind: () => (key) => key },
    uiConversation: { events: { register(definition) { definitions.push(definition); return () => {} } } },
    slots: { inject: () => () => {} },
    effect(callback) { callback(); return () => {} },
  })
  assert.equal(definitions.length, 1)
  const directDefinition = definitions[0]
  const eventDefinitions = { entries: () => [assistantDefinition, directDefinition], fallbackEntry: () => undefined }
  const viewDefinitions = {
    entries: () => [{
      target: 'chat',
      create() {
        let current = []
        return {
          empty: [],
          replace({ nodes }) { current = [...nodes]; return current },
          apply({ upserts, removes }) {
            const next = new Map(current.map((node) => [node.key, node]))
            for (const key of removes || []) next.delete(key)
            for (const node of upserts) next.set(node.key, node)
            current = [...next.values()].sort((left, right) => left.anchorSeq - right.anchorSeq)
            return current
          },
        }
      },
    }],
  }
  const assembler = new ConversationNodeAssembler(eventDefinitions, viewDefinitions)
  const event = (seq, id, text) => ({
    type: 'assistant/message', surfaceOp: 'append', seq, time: 100 + seq,
    data: {
      turn: 1_000_000_000, step: 0,
      message: {
        id, role: 'assistant', content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'multi-agent-codex', model: 'codex' },
      },
      stream: [],
    },
  })
  const rootEvents = [
    { type: 'turn/start', seq: 1, time: 101, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: 102, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message', surfaceOp: 'append', seq: 3, time: 103,
      data: {
        turn: 1, step: 1,
        message: {
          id: 'root-message', role: 'assistant', content: [{ type: 'text', text: 'root response' }],
          source: { kind: 'model', provider: 'deepseek', model: 'chat' },
        },
        stream: [],
      },
    },
  ]
  assembler.replaceWindow([...rootEvents, event(4, 'm1', 'first')].map((event) => ({ type: 'event', event })), false)
  assembler.activateTarget('chat')
  let nodes = assembler.snapshot('chat')
  assert.equal(nodes.length, 2)
  assert.equal(nodes.find((node) => node.data.finalNode?.messageId === 'root-message')?.data.blocks[0].text, 'root response')
  assert.equal(nodes.find((node) => node.data.finalNode?.messageId === 'm1')?.visibility, 'visible')
  assembler.append({ type: 'event', event: event(5, 'm2', 'second') })
  assembler.flush()
  nodes = assembler.snapshot('chat')
  assert.equal(nodes.length, 3)
  assert.deepEqual([...nodes].map((node) => node.data.finalNode?.messageId).sort(), ['m1', 'm2', 'root-message'])
  assembler.append({ type: 'event', event: event(6, 'm3', 'continued') })
  assembler.flush()
  nodes = assembler.snapshot('chat')
  assert.equal(nodes.length, 4)
  assert.equal(nodes.find((node) => node.data.finalNode?.messageId === 'root-message')?.data.blocks[0].text, 'root response')
  assert.ok([...nodes].every((node) => node.kind === 'assistant-step' && node.visibility === 'visible'))
  console.log('rc.5 assembler verified: direct first/multiple/continued replies are visible and do not overwrite an existing root assistant Step')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
