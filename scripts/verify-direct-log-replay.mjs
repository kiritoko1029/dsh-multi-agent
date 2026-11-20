// Validates direct-chat mirror carriers against the installed harness replay
// validators (Relationships state machine + Session.fromRestore), optionally
// re-checking a stored log file.
// Run with the installed Desktop runtime:
//   ELECTRON_RUN_AS_NODE=1 DSH_INSTALL_DIR=<...>/dsh \
//     "$DSH_NODE_EXECUTABLE" scripts/verify-direct-log-replay.mjs [--file <plain.jsonl>]
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const install = process.env.DSH_INSTALL_DIR
assert.ok(install, 'DSH_INSTALL_DIR is required')
const packages = resolve(install, '..')
const sessionModule = await import(pathToFileURL(resolve(packages, 'dsh-session/lib/index.js')))
const { Session, KNOWN_SESSION_EVENT_TYPES } = sessionModule
const { assertReleasedV4Relationships } = await import(pathToFileURL(resolve(packages, 'dsh-session-format-v3-to-v4/lib/index.js')))

function validateStoredLog(header, events) {
  assertReleasedV4Relationships({ header, events, inheritedEventCount: 0 }, KNOWN_SESSION_EVENT_TYPES)
  Session.fromRestore(header.id, events, header, 0, 'detached')
}

function parsePlainLog(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim())
  const header = JSON.parse(lines[0])
  assert.equal(header.type, 'session')
  const { type, ...rest } = header
  const events = lines.slice(1).map((line) => JSON.parse(line))
  return { header: rest, events }
}

const fileFlag = process.argv.indexOf('--file')
if (fileFlag !== -1) {
  const path = process.argv[fileFlag + 1]
  assert.ok(path, '--file requires a path to a decompressed session.v4.jsonl')
  const { header, events } = parsePlainLog(path)
  validateStoredLog(header, events)
  console.log(`stored log ${path} passes installed replay validation (${events.length} events)`)
} else {
  // A representative live-session shape: root turns, a native direct command
  // pair, the new synthetic mirror carriers, and a later root turn that must
  // still sequence correctly.
  let seq = -1
  const next = () => ++seq
  const event = (type, data, surfaceOp) => ({ type, seq: next(), time: 1795160000000 + seq, data, ...(surfaceOp ? { surfaceOp } : {}) })
  const events = [
    event('permission/preset', { preset: 'workspace-write' }),
    event('turn/start', { turn: 1 }),
    event('step/start', { turn: 1, step: 1 }),
    event('system/message', {
      turn: 1, step: 1,
      message: {
        id: 'sys-1', role: 'system', content: [{ type: 'text', text: 'system prompt' }],
        source: { kind: 'system-prompt' },
      },
    }, 'append'),
    event('step/end', { turn: 1, step: 1 }),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event('turn/start', { turn: 2 }),
    event('step/start', { turn: 2, step: 1 }),
    event('user/message', {
      id: 'user-1', role: 'user', content: [{ type: 'text', text: '发布当前这个新版本' }],
      source: { kind: 'user' },
    }, 'append'),
    event('assistant/message', {
      turn: 2, step: 1,
      message: {
        id: 'root-1', role: 'assistant', content: [{ type: 'text', text: 'root response' }],
        source: { kind: 'model', provider: 'magpie', model: 'k3.1-pro' },
      },
      stream: [],
    }, 'append'),
    event('step/end', { turn: 2, step: 1 }),
    event('turn/end', { turn: 2, reason: { kind: 'completed' } }),
    // Native composer command lifecycle for a direct send.
    event('command/run', { commandId: 'cmd-native-1', name: 'agent-codex', args: '发布当前这个新版本', source: { kind: 'user' } }),
    event('command/done', { commandId: 'cmd-native-1', kind: 'success' }),
    // New mirror carriers: one synthetic pair per completed child message.
    event('command/run', { commandId: 'ma-direct-msg-codex--m1', name: 'agent-codex', source: { kind: 'user' } }),
    event('command/done', { commandId: 'ma-direct-msg-codex--m1', kind: 'success', text: '已完成本地校验并将 0.14.0 推送到 main' }),
    event('command/run', { commandId: 'ma-direct-msg-codex--m2', name: 'agent-codex', source: { kind: 'user' } }),
    event('command/done', { commandId: 'ma-direct-msg-codex--m2', kind: 'success', text: '第二轮回复' }),
    // A later root turn must still open the expected next turn number.
    event('turn/start', { turn: 3 }),
    event('step/start', { turn: 3, step: 1 }),
    event('assistant/message', {
      turn: 3, step: 1,
      message: {
        id: 'root-2', role: 'assistant', content: [{ type: 'text', text: 'later root response' }],
        source: { kind: 'model', provider: 'magpie', model: 'k3.1-pro' },
      },
      stream: [],
    }, 'append'),
    event('step/end', { turn: 3, step: 1 }),
    event('turn/end', { turn: 3, reason: { kind: 'completed' } }),
  ]
  const header = {
    version: 4, id: 'session-verify-direct-log-replay', createdAt: 1795070277848,
    cwd: '/tmp', isSeeded: false,
  }
  validateStoredLog(header, events)
  console.log('synthetic direct mirror carriers pass installed replay validation')
}
