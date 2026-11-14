import test from 'node:test'
import assert from 'node:assert/strict'
import { createPermissionAsker, resolveMainSessionFullAccess } from '../lib/permission-policy.js'

function permissionContext({ preset = 'custom', approval = 'ask', sandbox = 'workspace-write', outcome = 'rejected', throwPreset = false } = {}) {
  const state = { nativeRequests: 0 }
  const native = {
    defaultPolicy: approval,
    overrideOf: () => undefined,
    request: async () => {
      state.nativeRequests += 1
      return outcome
    },
    note: () => {},
  }
  const services = {
    approval: native,
    permissionPresets: preset === undefined ? undefined : {
      current: () => {
        if (throwPreset) throw new Error('preset unavailable')
        return preset
      },
      resolve: (name) => ({
        approval: name === 'full' ? 'never' : 'ask',
        sandbox: name === 'full' ? 'danger-full-access' : 'workspace-write',
      }),
    },
    sandboxPolicy: { resolve: () => ({ mode: sandbox }) },
  }
  return {
    state,
    ctx: { get: (name) => services[name] },
  }
}

function asker(ctx, options = {}) {
  const ask = createPermissionAsker({
    ctx,
    parent: { id: 'parent', session: { id: 'parent-session' } },
    policy: 'main-session',
    backend: 'codex',
    agentLabel: 'Codex',
    ...options,
  })
  return { decide: ask }
}

test('main session full preset inherits always-allow without calling the rejected native chain', async () => {
  const { ctx, state } = permissionContext({ preset: 'full' })
  const parent = { id: 'parent', session: { id: 'parent-session' } }
  assert.equal(resolveMainSessionFullAccess(ctx, parent), true)
  const decision = await asker(ctx).decide({ command: 'pwd', argv: ['pwd'], cwd: '/tmp' })
  assert.deepEqual(decision, { outcome: 'allow', scope: 'always', source: 'main-session-full-access' })
  assert.equal(state.nativeRequests, 0)
})

test('never approval without full filesystem access still uses native approval', async () => {
  const { ctx, state } = permissionContext({ approval: 'never', sandbox: 'workspace-write' })
  assert.equal(resolveMainSessionFullAccess(ctx, { session: {} }), false)
  const decision = await asker(ctx).decide({ command: 'pwd', argv: ['pwd'], cwd: '/tmp' })
  assert.deepEqual(decision, { outcome: 'deny', source: 'main-session' })
  assert.equal(state.nativeRequests, 1)
})

test('full filesystem access with ask approval preserves a real user rejection', async () => {
  const { ctx, state } = permissionContext({ approval: 'ask', sandbox: 'danger-full-access', outcome: 'rejected' })
  const decision = await asker(ctx).decide({ command: 'pwd', argv: ['pwd'], cwd: '/tmp' })
  assert.deepEqual(decision, { outcome: 'deny', source: 'main-session' })
  assert.equal(state.nativeRequests, 1)
})

test('custom full preset falls back to the effective approval and sandbox knobs', async () => {
  const { ctx, state } = permissionContext({ preset: 'custom', approval: 'never', sandbox: 'danger-full-access' })
  assert.equal(resolveMainSessionFullAccess(ctx, { session: {} }), true)
  const decision = await asker(ctx).decide({ command: 'pwd', argv: ['pwd'], cwd: '/tmp' })
  assert.equal(decision.outcome, 'allow')
  assert.equal(state.nativeRequests, 0)
})

test('missing parent Session and failing preset services fail closed', async () => {
  const { ctx, state } = permissionContext({ throwPreset: true })
  assert.equal(resolveMainSessionFullAccess(ctx, undefined), false)
  assert.equal(resolveMainSessionFullAccess(ctx, { id: 'parent-without-session' }), false)
  const decision = await asker(ctx).decide({ command: 'pwd', argv: ['pwd'], cwd: '/tmp' })
  assert.equal(decision.outcome, 'deny')
  assert.equal(state.nativeRequests, 1)
})

test('run-start false snapshot is not overridden by a later full preset read', async () => {
  const { ctx, state } = permissionContext({ preset: 'full' })
  const decision = await asker(ctx, { mainSessionFullAccess: false }).decide({ command: 'pwd', argv: ['pwd'], cwd: '/tmp' })
  assert.equal(decision.outcome, 'deny')
  assert.equal(state.nativeRequests, 1)
})

test('explicit allow policy remains allow-once rather than inherited full access', async () => {
  const { ctx, state } = permissionContext({ preset: 'full' })
  const decision = await asker(ctx, { policy: 'allow' }).decide({ command: 'pwd', argv: ['pwd'], cwd: '/tmp' })
  assert.deepEqual(decision, { outcome: 'allow', scope: 'once', source: 'policy-allow' })
  assert.equal(state.nativeRequests, 0)
})
