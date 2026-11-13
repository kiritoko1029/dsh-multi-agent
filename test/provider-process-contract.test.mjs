import test from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  NO_START_CAPABILITIES,
  assertPositiveFinite,
  assertUsableCwd,
  settleRunResult,
  subprocessRunHandle,
} from '../lib/provider-process-contract.js'

function settlement(overrides = {}) {
  const controller = new AbortController()
  let notifications = 0
  const onAbort = () => { notifications++ }
  controller.signal.addEventListener('abort', onAbort)
  return {
    controller,
    notifications: () => notifications,
    parts: {
      attempt: async () => ({ output: 'done', stopReason: 'completed' }),
      cancelled: () => controller.signal.aborted,
      collectOutput: () => 'partial',
      signal: controller.signal,
      onAbort,
      ...overrides,
    },
  }
}

test('provider capabilities remain frozen and grant no parent-controlled start features', () => {
  assert.deepEqual(NO_START_CAPABILITIES, {
    agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false,
  })
  assert.ok(Object.isFrozen(NO_START_CAPABILITIES))
  assert.throws(() => { NO_START_CAPABILITIES.depthLimit = true }, TypeError)
})

test('timing and cwd validation preserve the process admission checks', () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(() => assertPositiveFinite('codex', 'grace', value), /positive finite/)
  }
  assert.doesNotThrow(() => assertPositiveFinite('codex', 'grace', 0.5))
  const directory = fileURLToPath(new URL('../', import.meta.url))
  assert.equal(assertUsableCwd('codex', 'cwd', directory), directory)
  assert.throws(() => assertUsableCwd('codex', 'cwd', '.'), /absolute path/)
  assert.throws(() => assertUsableCwd('codex', 'cwd', fileURLToPath(import.meta.url)), /accessible directory/)
  assert.throws(() => assertUsableCwd('codex', 'cwd', fileURLToPath(new URL('./missing-cwd-fixture', import.meta.url))), /accessible directory/)
})

test('successful settlement retains the result and removes its abort listener', async () => {
  const result = { output: 'answer', stopReason: 'completed', diagnostic: 'ok' }
  const { parts, controller, notifications } = settlement({ attempt: async () => result })
  assert.deepEqual(await settleRunResult(parts), result)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  controller.abort()
  assert.equal(notifications(), 0)
})

for (const rejects of [false, true]) {
  test(`cancellation wins over an already queued ${rejects ? 'rejection' : 'success'} and cleans up`, async () => {
    const pending = Promise.withResolvers()
    let errorReports = 0
    const { parts, controller } = settlement({
      attempt: () => pending.promise,
      onError: () => { errorReports++ },
    })
    const finished = settleRunResult(parts)
    controller.abort()
    if (rejects) pending.reject(new Error('late transport failure'))
    else pending.resolve({ output: 'late answer', stopReason: 'completed' })
    assert.deepEqual(await finished, { output: 'partial', stopReason: 'aborted' })
    assert.equal(errorReports, 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  })
}

test('transport failures settle even when the diagnostic sink throws', async () => {
  let reported
  const { parts, controller } = settlement({
    attempt: async () => { throw 'transport failed' },
    onError: (error, level) => { reported = { error, level }; throw new Error('sink failed') },
    collectDiagnostic: () => 'safe detail',
  })
  assert.deepEqual(await settleRunResult(parts), {
    output: 'partial', diagnostic: 'safe detail', stopReason: 'error',
  })
  assert.ok(reported.error instanceof Error)
  assert.equal(reported.error.message, 'transport failed')
  assert.equal(reported.level, 'error')
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})

for (const failure of [false, true]) {
  test(`${failure ? 'failure' : 'success'} diagnostics obey the UTF-8 byte limit without splitting characters`, async () => {
    for (const diagnostic of ['x'.repeat(4096), 'x'.repeat(4097), '中🙂'.repeat(1000)]) {
      const { parts, controller } = settlement({
        attempt: async () => {
          if (failure) throw new Error('wire failed')
          return { output: 'done', stopReason: 'completed', diagnostic }
        },
        collectDiagnostic: () => diagnostic,
      })
      const result = await settleRunResult(parts)
      assert.ok(Buffer.byteLength(result.diagnostic, 'utf8') <= 4096)
      assert.ok(!result.diagnostic.includes('\uFFFD'))
      if (Buffer.byteLength(diagnostic, 'utf8') <= 4096) assert.equal(result.diagnostic, diagnostic)
      else {
        const suffix = '\n[diagnostic truncated]'
        assert.ok(result.diagnostic.endsWith(suffix))
        assert.ok(diagnostic.startsWith(result.diagnostic.slice(0, -suffix.length)))
      }
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    }
  })
}

test('dispose cancels before teardown, waits for exit and shares one cleanup promise', async () => {
  const { parts, controller, notifications } = settlement()
  const exit = Promise.withResolvers()
  const events = []
  const result = Promise.resolve({ output: 'partial', stopReason: 'aborted' })
  const handle = subprocessRunHandle({
    id: 'run-id', result, signal: parts.signal, onAbort: parts.onAbort,
    requestCancel: () => { events.push('cancel'); controller.abort() },
    teardown: () => { events.push('teardown'); return exit.promise },
  })
  assert.equal(handle.id, 'run-id')
  assert.equal(handle.result, result)
  const first = handle.dispose()
  assert.equal(handle.dispose(), first)
  assert.deepEqual(events, ['cancel', 'teardown'])
  assert.equal(notifications(), 0)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  let finished = false
  first.then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false)
  exit.resolve()
  await first
  assert.equal(finished, true)
})

test('dispose preserves teardown failures without retrying cleanup', async () => {
  const { parts } = settlement()
  let cleanups = 0
  const failure = new Error('child did not exit')
  const handle = subprocessRunHandle({
    id: 'run-id', result: Promise.resolve(), signal: parts.signal, onAbort: parts.onAbort,
    requestCancel: () => {},
    teardown: () => { cleanups++; return Promise.reject(failure) },
  })
  const disposal = handle.dispose()
  await assert.rejects(disposal, (error) => error === failure)
  assert.equal(handle.dispose(), disposal)
  assert.equal(cleanups, 1)
})

test('Codex and ACP entries import without installing Host provider/helper packages', () => {
  const entries = ['../codex-provider.js', '../acp-provider.js']
    .map((path) => new URL(path, import.meta.url).href)
  const script = `
    import { registerHooks } from 'node:module';
    import assert from 'node:assert/strict';
    const blocked = [
      '@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-subagent-acp', '@deepseek-ai/dsh-subagent-codex',
      '@deepseek-ai/dsh-timeout', '@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-sdk-protocol',
    ];
    const forbidden = (value) => blocked.some((name) => value === name || value.startsWith(name + '/')
      || decodeURIComponent(value).replaceAll('\\\\', '/').includes('/node_modules/' + name + '/'));
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (forbidden(specifier)) throw new Error('Forbidden Host package import: ' + specifier);
      const result = nextResolve(specifier, context);
      if (forbidden(result.url)) throw new Error('Forbidden resolved Host package: ' + result.url);
      return result;
    } });
    for (const [entry, expected] of ${JSON.stringify(entries.map((entry, index) => [entry, index === 0 ? 'codex-provider' : 'kimi-code-acp']))}) {
      const provider = await import(entry);
      assert.equal(typeof provider.apply, 'function');
      assert.equal(provider.name, expected);
    }
    console.log('provider-imports-without-host-packages');
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 15000,
  })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /provider-imports-without-host-packages/)
})
