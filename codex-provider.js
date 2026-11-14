import { Transform } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import z from '@deepseek-ai/schemastery'
import { currentValue } from './lib/config.js'
import { PERMISSION_POLICIES, SUBAGENT_PERMISSION_MODES } from './lib/permission-policy.js'
import { codexCatalogFromOutput, registerModelCatalogRoute, runCatalogCommand } from './lib/model-catalog-route.js'
import { createCodexObservationStream } from './lib/task-monitor-codex.js'
import { applyCodexProvider, codexAppServerEnv } from './lib/codex-run.js'
import { bundledCodexExecutable, codexWrapperArgv } from './lib/codex-command.js'
import { assertDirectCommand } from './lib/process-command.js'
import { PROXY_MODES, withProxyEnvironment } from './lib/proxy.js'
import { currentTaskTrace } from './task-monitor.js'

const DEFAULT_PROVIDER_NAME = 'codex-router'
const RESERVED_PROVIDER_NAME = 'codex'
const DEFAULT_DISPOSE_GRACE_MS = 3000
const MAX_TIMER_DELAY_MS = 2147483647

export const name = 'codex-provider'
export const inject = ['subagents', 'subprocess', 'webServer', 'connection', 'multiAgentAvailability', 'multiAgentTasks']

export const Config = z.object({
  providerName: z.string().min(1).pattern(/^(?!codex$).*/).default(DEFAULT_PROVIDER_NAME),
  command: z.string().min(1).pattern(/\S/),
  model: z.string().min(1).volatile(),
  reasoningEffort: z.string().min(1).volatile(),
  env: z.dict(z.string()).default({}).volatile(),
  proxyMode: z.union(PROXY_MODES).default('system').volatile(),
  proxyUrl: z.string().volatile(),
  permissionPolicy: z.union(PERMISSION_POLICIES).default('main-session').volatile(),
  subagentPermissionMode: z.union(SUBAGENT_PERMISSION_MODES).default('auto').volatile(),
  permissionMode: z.union([
    'never',
    'approve-for-me',
    'dangerously-bypass-approvals-and-sandbox',
  ]).default('approve-for-me').volatile(),
  disposeGraceMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_DISPOSE_GRACE_MS).volatile(),
})

function refreshConfig(provider, readConfig) {
  if (provider === null || typeof provider !== 'object' || typeof provider.start !== 'function'
    || provider.config === null || typeof provider.config !== 'object') {
    throw new Error('codex-provider: incompatible official Codex provider; expected start() and a config object')
  }
  const officialStart = provider.start
  provider.start = function (request) {
    const { model, reasoningEffort, ...settings } = readConfig()
    this.reasoningEffort = reasoningEffort
    const trace = currentTaskTrace()
    if (trace?.record?.agent === 'codex' && !trace.resume) this.ctx.get('multiAgentTasks')?.setTelemetry?.({
      ...model === undefined ? {} : { model, modelSource: 'configured' },
      ...reasoningEffort === undefined ? {} : { reasoningEffort, reasoningEffortSource: 'configured' },
    }, trace)
    if (model === undefined) delete this.config.model
    else this.config.model = model
    if (reasoningEffort === undefined) delete this.config.reasoningEffort
    else this.config.reasoningEffort = reasoningEffort
    Object.assign(this.config, settings)
    return Reflect.apply(officialStart, this, [request])
  }
  return provider
}

// The pinned official provider does not expose effort, but its public subprocess
// boundary carries newline-delimited app-server requests. A separate writable
// adapter forwards frames unchanged except for the documented turn/start effort.
function refreshEffort(subprocess, readEffort, observe) {
  return Object.create(subprocess, {
    spawn: { value(spec) {
      const effort = readEffort(spec)
      const child = subprocess.spawn(spec)
      if (effort !== undefined && (!child.stdin || typeof child.stdin.write !== 'function')) {
        child.terminate()
        throw new Error('codex-provider: app-server stdin is unavailable')
      }
      let input
      if (effort !== undefined) {
        let buffer = ''
        const decoder = new StringDecoder('utf8')
        const frame = (line) => {
          if (!line.trim()) return line
          const message = JSON.parse(line)
          if (message.method === 'turn/start' && effort !== undefined) message.params = { ...message.params, effort }
          return JSON.stringify(message)
        }
        input = new Transform({
          transform(chunk, encoding, callback) {
            try {
              buffer += decoder.write(chunk)
              let end
              while ((end = buffer.indexOf('\n')) >= 0) {
                this.push(frame(buffer.slice(0, end)) + '\n')
                buffer = buffer.slice(end + 1)
              }
              callback()
            } catch (error) { callback(error) }
          },
          flush(callback) {
            try {
              buffer += decoder.end()
              if (buffer.trim()) this.push(frame(buffer) + '\n')
              callback()
            } catch (error) { callback(error) }
          },
        })
        input.pipe(child.stdin)
        const onError = (error) => input.destroy(error)
        child.stdin.on('error', onError)
        const cleanup = () => { child.stdin.off('error', onError); input.unpipe(child.stdin); input.destroy() }
        child.done.then(cleanup, cleanup)
      }
      let output
      let activeTurnId
      let activeThreadId
      if (child.stdout && typeof child.stdout.pipe === 'function') {
        output = createCodexObservationStream((frame) => {
          if (typeof frame.result?.thread?.id === 'string') {
            activeThreadId = frame.result.thread.id
            try { observe?.(frame) } catch {}
            return
          }
          // Only a new turn/start response selects this execution's telemetry.
          // Resume responses and late notifications from old turns are not work
          // performed in the current continuation.
          if (typeof frame.result?.turn?.id === 'string') activeTurnId = frame.result.turn.id
          const eventTurnId = frame.params?.turnId ?? frame.params?.turn?.id
          if (!activeTurnId || eventTurnId !== activeTurnId) return
          if (frame.method === 'thread/tokenUsage/updated' && frame.params?.threadId !== activeThreadId) return
          try { observe?.(frame) } catch {}
        })
        const onError = (error) => output.destroy(error)
        child.stdout.on('error', onError)
        output.once('close', () => child.stdout.off('error', onError))
        child.stdout.pipe(output)
      }
      return new Proxy(child, { get(target, key) {
        if (key === 'stdin' && input) return input
        if (key === 'stdout' && output) return output
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    } },
  })
}

/**
 * Own persistent Codex thread creation and true cold resume. The optional
 * third argument remains a compatibility seam for official-provider tests.
 */
export function apply(ctx, config, applyOfficial, runtime = {}) {
  // Manual > detected native CLI > the optional native binary shipped with the
  // pinned Codex package. All three choices avoid npm .cmd shims on Windows.
  const manualCommand = currentValue(config.command)?.trim() || undefined
  const availability = ctx.get('multiAgentAvailability')
  const bundledCommand = Object.hasOwn(runtime, 'bundledCodexCommand')
    ? runtime.bundledCodexCommand
    : bundledCodexExecutable()
  const detectedCommand = availability?.codexCommand?.trim() || undefined
  const command = manualCommand ?? detectedCommand ?? bundledCommand
  if (command) assertDirectCommand(command)
  if (!command && !availability?.codex) {
    ctx.logger.warn('codex-provider: Codex executable is unavailable; provider and model catalog route will not be registered')
    return
  }
  const providerName = config.providerName ?? DEFAULT_PROVIDER_NAME
  if (providerName === RESERVED_PROVIDER_NAME) {
    throw new Error('codex-provider: providerName "codex" is reserved for the official provider')
  }

  // The proxy applies to both the app-server child and the catalog command.
  const providerEnvironment = () => withProxyEnvironment(
    currentValue(config.env),
    currentValue(config.proxyMode),
    currentValue(config.proxyUrl),
  )
  const readConfig = () => ({
    // The compatibility seam still accepts only the official provider's settings.
    ...applyOfficial ? {} : { command },
    model: currentValue(config.model),
    env: providerEnvironment(),
    permissionPolicy: currentValue(config.permissionPolicy) ?? 'main-session',
    subagentPermissionMode: currentValue(config.subagentPermissionMode) ?? 'auto',
    permissionMode: currentValue(config.permissionMode) ?? 'approve-for-me',
    disposeGraceMs: currentValue(config.disposeGraceMs) ?? DEFAULT_DISPOSE_GRACE_MS,
    reasoningEffort: currentValue(config.reasoningEffort),
  })
  const initialConfigValues = readConfig()
  const initialConfig = {
    providerName,
    ...initialConfigValues.command === undefined ? {} : { command: initialConfigValues.command },
    ...initialConfigValues.model === undefined ? {} : { model: initialConfigValues.model },
    env: initialConfigValues.env,
    permissionPolicy: initialConfigValues.permissionPolicy,
    subagentPermissionMode: initialConfigValues.subagentPermissionMode,
    permissionMode: initialConfigValues.permissionMode,
    disposeGraceMs: initialConfigValues.disposeGraceMs,
  }
  let registrations = 0
  const tasks = ctx.get('multiAgentTasks')
  let registeredProvider
  const subprocess = refreshEffort(ctx.subprocess, applyOfficial
    ? () => currentValue(config.reasoningEffort)
    : () => undefined, (frame) => tasks?.observeCodex?.(frame))
  const officialCtx = Object.create(ctx, {
      subprocess: {
        value: subprocess,
      },
      subagents: {
        value: {
          registerProvider(provider) {
            registrations += 1
            registeredProvider = refreshConfig(provider, readConfig)
            return ctx.subagents.registerProvider(registeredProvider)
          },
        },
      },
  })

  const result = (applyOfficial ?? applyCodexProvider)(officialCtx, initialConfig)
  if (registrations !== 1) {
    throw new Error('codex-provider: incompatible official apply(); expected exactly one provider registration')
  }
  registerModelCatalogRoute(ctx, 'codex', async () => {
    const environment = providerEnvironment()
    const liveDetectedCommand = availability?.codexCommand?.trim() || undefined
    const catalogCommand = manualCommand ?? liveDetectedCommand ?? command
    const argv = catalogCommand
      ? [catalogCommand, 'debug', 'models']
      : codexWrapperArgv(['debug', 'models'])
    const stdout = await runCatalogCommand(ctx, argv, 15000, codexAppServerEnv(catalogCommand, environment))
    return codexCatalogFromOutput(stdout)
  })
  return result
}
