// Opt-in live check: uses the installed, logged-in agy CLI and consumes two turns.
// Run: node scripts/smoke-agy.mjs [absolute-agy-path]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { apply, Config } from '../agy-provider.js'
import MultiAgentAvailability, { resolveExecutable } from '../availability.js'
import { runWithTaskTrace } from '../task-monitor.js'

function defaultAgyFallback() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    return localAppData
      ? join(localAppData, 'agy', 'bin', 'agy.exe')
      : join(homedir(), '.local', 'bin', 'agy.exe')
  }
  return join(homedir(), '.local', 'bin', 'agy')
}

function resolveAgyCommand(explicitCommand) {
  if (explicitCommand) return resolveExecutable(explicitCommand) ?? explicitCommand
  const availability = new MultiAgentAvailability({ reflect: { provide() {} } })
  return availability.agyCommand ?? process.env.AGY_COMMAND ?? defaultAgyFallback()
}

const root = await realpath(tmpdir())
const cwd = await mkdtemp(join(root, 'dsh-agy-smoke-'))
const command = resolveAgyCommand(process.argv[2])
const marker = `AGY_${randomUUID().replaceAll('-', '')}`
let provider
let externalSession
const observed = []
const telemetryUpdates = []
const tasks = {
  setTelemetry(update) { if (update) telemetryUpdates.push(update) },
  observeACP(update) { observed.push(update.sessionUpdate) },
  setExternalSession(agent, sessionId) { externalSession = { agent, sessionId } },
}
function spawnChild(spec) {
  const child = spawn(spec.argv[0], spec.argv.slice(1), {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  // Consume diagnostics without printing account or application data.
  child.stderr.resume()
  let killTimer
  let settled = false
  const done = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      settled = true
      clearTimeout(killTimer)
      reject(error)
    })
    child.once('close', (exitCode, signal) => {
      settled = true
      clearTimeout(killTimer)
      resolve({ exitCode, signal })
    })
  })
  const terminate = () => {
    if (settled) return
    if (process.platform === 'win32') {
      if (child.pid !== undefined) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
        killer.once('error', () => {
          if (!settled) try { child.kill() } catch {}
        })
        killer.once('exit', (code) => {
          if (code !== 0 && !settled) try { child.kill() } catch {}
        })
        killer.unref()
      } else {
        try { child.kill() } catch {}
      }
      killTimer ??= setTimeout(() => {
        if (!settled) try { child.kill() } catch {}
      }, 3000)
      killTimer.unref()
      return
    }
    try { child.kill('SIGTERM') } catch {}
    killTimer ??= setTimeout(() => {
      if (!settled) try { child.kill('SIGKILL') } catch {}
    }, 3000)
    killTimer.unref()
  }
  spec.signal?.addEventListener('abort', terminate, { once: true })
  done.finally(() => spec.signal?.removeEventListener('abort', terminate)).catch(() => {})
  return {
    stdin: child.stdin, stdout: child.stdout, done, terminate,
    async waitForExit(signal) {
      if (!signal) return done
      if (signal.aborted) return undefined
      let onAbort
      try {
        return await Promise.race([done, new Promise((resolve) => {
          onAbort = () => resolve(undefined)
          signal.addEventListener('abort', onAbort, { once: true })
        })])
      } finally { signal.removeEventListener('abort', onAbort) }
    },
  }
}
apply({
  get(name) { return name === 'multiAgentTasks' ? tasks : name === 'multiAgentAvailability' ? { agy: true, agyCommand: command } : undefined },
  subprocess: { spawn: spawnChild },
  subagents: { registerProvider(value) { provider = value } },
  webServer: { register: () => () => {} },
  effect: (callback) => callback(),
  logger: { warn(message) { console.warn(message) } },
}, Config({ providerName: 'agy', command, args: ['acp'], permission: 'reject',
  ...(process.env.AGY_SMOKE_MODEL ? { model: process.env.AGY_SMOKE_MODEL } : {}),
  ...(process.env.AGY_SMOKE_EFFORT ? { reasoningEffort: process.env.AGY_SMOKE_EFFORT } : {}),
  disposeEofGraceMs: 1000, disposeGraceMs: 3000,
}))
assert.ok(provider, 'agy provider should register')
async function turn(prompt, resume) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Live agy smoke test timed out')), 90000)
  let run
  try {
    run = await runWithTaskTrace({ record: { cwd }, ...(resume ? { resume } : {}) }, () => provider.start({
      cwd, prompt: [{ type: 'text', text: prompt }], signal: controller.signal,
    }))
    const result = await run.result
    assert.equal(result.stopReason, 'completed', result.diagnostic)
    return result.output.filter(block => block.type === 'text').map(block => block.text).join('\n')
  } finally {
    clearTimeout(timer)
    await run?.dispose()
  }
}
try {
  const first = await turn(`Do not use any tools or read files. Remember this exact test marker: ${marker}. Reply only with this marker.`)
  assert.ok(first.includes(marker), 'first turn should return the marker')
  assert.equal(externalSession?.agent, 'agy')
  assert.ok(externalSession?.sessionId, 'save the actual ACP session id')
  const original = { ...externalSession }
  const second = await turn('Do not use any tools or read files. What exact test marker did I give you in the previous turn? Reply only with that marker.', original)
  assert.ok(second.includes(marker), 'resumed turn should remember the prior marker')
  assert.deepEqual(externalSession, original, 'continuation must keep the original ACP session id')
  assert.ok(observed.includes('agent_message_chunk'), 'streaming updates should reach task monitoring')
  const telemetry = Object.assign({}, ...telemetryUpdates)
  assert.ok(telemetryUpdates.some(update => typeof update.model === 'string' && update.modelSource === 'reported'), 'actual ACP model should reach task telemetry')
  if (process.env.AGY_SMOKE_EFFORT) assert.ok(telemetryUpdates.some(update => update.reasoningEffort === process.env.AGY_SMOKE_EFFORT && update.reasoningEffortSource === 'reported'), 'selected effort should be confirmed by ACP')
  if (telemetry.usage) {
    assert.ok(Object.values(telemetry.usage).every(value => Number.isSafeInteger(value) && value >= 0), 'reported usage must contain valid token counters')
  }
  console.log(JSON.stringify({ ok: true, provider: provider.name, firstTurn: 'completed', continuation: 'same-session-memory-verified', updates: [...new Set(observed)], telemetry, usageAvailable: Boolean(telemetry.usage) }))
} finally {
  // Resolve and verify the exact owned directory before removing it.
  const target = await realpath(cwd)
  assert.equal(target, cwd)
  assert.equal(join(target, '..'), root)
  assert.ok(target.startsWith(join(root, 'dsh-agy-smoke-')))
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
