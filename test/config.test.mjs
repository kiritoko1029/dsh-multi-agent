import test from 'node:test'
import assert from 'node:assert/strict'
import { currentRouterConfig, currentValue, dynamicAcpConfig } from '../lib/config.js'

test('volatile and ordinary fields resolve to one router snapshot', () => {
  let mode = 'auto'
  const config = {
    selectionMode: { get: () => mode },
    defaultAgent: undefined,
    codex: { enabled: true },
    kimiCode: { enabled: true },
    agy: { enabled: true },
    dsh: { enabled: true, defaultModel: 'child-model' },
    routes: { get: () => [{ agent: 'codex', prompt: 'Debug.' }] },
    additionalInstructions: { get: () => '' },
    taskPreamble: { get: () => '' },
    timeoutSeconds: { get: () => 123 },
  }
  assert.deepEqual(currentRouterConfig(config), {
    selectionMode: 'auto', defaultAgent: undefined,
    codex: { enabled: true }, kimiCode: { enabled: true }, agy: { enabled: true },
    dsh: { enabled: true, defaultModel: 'child-model' },
    routes: [{ agent: 'codex', prompt: 'Debug.' }],
    additionalInstructions: '', taskPreamble: '', timeoutSeconds: 123,
  })
  mode = 'always-ask'
  assert.equal(currentRouterConfig(config).selectionMode, 'always-ask')
})

test('DSH nested model and effort references resolve after live settings edits', () => {
  let effort = 'high'
  const config = { dsh: { enabled: true, defaultModel: { get: () => 'model' }, defaultReasoningEffort: { get: () => effort } } }
  assert.deepEqual(currentRouterConfig(config).dsh, { enabled: true, defaultModel: 'model', defaultReasoningEffort: 'high' })
  effort = 'low'
  assert.equal(currentRouterConfig(config).dsh.defaultReasoningEffort, 'low')
})

test('ACP runtime getters read the latest values on every access', () => {
  const values = {
    providerName: 'kimi-code', command: '/first/kimi', args: ['acp'], permission: 'reject', env: {},
    disposeEofGraceMs: 6000, disposeGraceMs: 3000,
  }
  const config = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { get: () => values[key] }]))
  const runtime = dynamicAcpConfig(config)
  assert.equal(runtime.command, '/first/kimi')
  assert.equal(runtime.permission, 'reject')
  values.command = '/second/kimi'
  values.permission = 'allow'
  values.disposeGraceMs = 4000
  assert.equal(runtime.command, '/second/kimi')
  assert.equal(runtime.permission, 'allow')
  assert.equal(runtime.disposeGraceMs, 4000)
  assert.equal(currentValue('ordinary'), 'ordinary')
  values.model = 'first-model'
  values.reasoningEffort = 'high'
  config.model = { get: () => values.model }
  config.reasoningEffort = { get: () => values.reasoningEffort }
  const withModels = dynamicAcpConfig(config)
  assert.equal(withModels.model, 'first-model')
  assert.equal(withModels.reasoningEffort, 'high')
  values.model = 'second-model'
  values.reasoningEffort = 'low'
  assert.equal(withModels.model, 'second-model')
  assert.equal(withModels.reasoningEffort, 'low')
})

test('legacy router snapshots without agy remain unchanged', () => {
  const snapshot = currentRouterConfig({ codex: {}, kimiCode: {}, dsh: {}, routes: [] })
  assert.equal(Object.hasOwn(snapshot, 'agy'), false)
})
