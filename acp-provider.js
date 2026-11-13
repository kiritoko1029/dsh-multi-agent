import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { PROTOCOL_VERSION, client, methods, ndJsonStream } from '@agentclientprotocol/sdk'
import z from '@deepseek-ai/schemastery'
import { currentTaskTrace } from './task-monitor.js'
import { currentValue, dynamicAcpConfig } from './lib/config.js'
import { createPermissionAsker, normalizePermissionPolicy, normalizeSubagentPermissionMode, PERMISSION_POLICIES, SUBAGENT_PERMISSION_MODES } from './lib/permission-policy.js'
import { kimiCatalogFromOutput, registerModelCatalogRoute, runCatalogCommand } from './lib/model-catalog-route.js'
import { sameDirectory } from './lib/path-compat.js'
import { assertDirectCommand, commandEnvironment, hasEnvironmentKey } from './lib/process-command.js'
import { resolveExecutable } from './availability.js'
import { acpConfigTelemetry, acpUsage, modelTelemetry } from './lib/task-telemetry.js'

import { AssistantOutputFold, assertUsableCwd, settleRunResult, subprocessRunHandle } from './lib/provider-process-contract.js'

/*
 * Adapted from @deepseek-ai/dsh-subagent-acp 0.2.2-rc.1 (MIT). Pure process
 * helpers are local, and only the generic ACP SDK is installed, so a fresh
 * profile cannot shadow DSH's own Host service packages.
 */
const MAX_TIMER_DELAY_MS = 2147483647

/** Unique-per-process ids for synthetic permission-ask activities. */
let permissionTraceCounter = 0
function permissionCounter() {
  permissionTraceCounter += 1
  return `req-${permissionTraceCounter}`
}

export const name = 'kimi-code-acp'
export const inject = ['subagents', 'subprocess', 'webServer', 'connection', 'multiAgentAvailability', 'multiAgentTasks']

const DEFAULT_DISPOSE_EOF_GRACE_MS = 6000
const DEFAULT_DISPOSE_GRACE_MS = 3000

const KIMI_ACP_DIALECT = {
  agent: 'kimi-code',
  label: 'Kimi',
  availability: 'kimiCode',
  commandFallback: (config) => config.command,
  defaultProviderName: 'kimi-code',
  thinkingConfigId: 'thinking',
  validateModel: false,
}

export const Config = z.object({
  providerName: z.string().min(1).default('kimi-code'),
  command: z.string().min(1).volatile(),
  args: z.array(z.string()).default([]).volatile(),
  permission: z.union(PERMISSION_POLICIES).default('main-session').volatile(),
  subagentPermissionMode: z.union(SUBAGENT_PERMISSION_MODES).default('auto').volatile(),
  env: z.dict(z.string()).default({}).volatile(),
  model: z.string().min(1).volatile(),
  reasoningEffort: z.string().min(1).volatile(),
  disposeEofGraceMs: z.number().min(1).max(2147483647).default(DEFAULT_DISPOSE_EOF_GRACE_MS).volatile(),
  disposeGraceMs: z.number().min(1).max(2147483647).default(DEFAULT_DISPOSE_GRACE_MS).volatile(),
})

const ACP_TOOL_KINDS = new Set([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
])

function failureDiagnostic(facts) {
  const fields = [
    'provider: ACP',
    `stage: ${facts.stage}`,
    `category: ${facts.category}`,
  ]
  if (facts.stopReason !== undefined) fields.push(`stop reason: ${facts.stopReason}`)
  if (facts.outcome?.exitCode !== null && facts.outcome?.exitCode !== undefined) fields.push(`exit code: ${facts.outcome.exitCode}`)
  /* v8 ignore next -- Windows does not report POSIX child signals in SubprocessOutcome. */
  if (facts.outcome?.signal !== null && facts.outcome?.signal !== undefined) fields.push(`signal: ${facts.outcome.signal}`)
  return `Subagent failure (${fields.join('; ')})`
}

function permissionDiagnostic(permission) {
  const source = permission.source === undefined ? '' : `; decided by: ${permission.source}`
  return `ACP permission decision (policy: ${permission.policy}; request: ${permission.request}; decision: ${permission.decision}${source})`
}

function diagnosticText(facts, permission) {
  const failure = failureDiagnostic(facts)
  return permission === undefined ? failure : `${failure}\n${permissionDiagnostic(permission)}`
}

class AcpRunFailure extends Error {
  constructor(facts, cause) {
    super(`subagent-acp: ${failureDiagnostic(facts)}`, { cause })
    this.name = 'AcpRunFailure'
  }
}

function acpConfigurationFailure(cause) {
  return new AcpRunFailure({
    stage: 'initialize',
    category: 'configuration',
  }, cause)
}

function permissionRequestKind(kind) {
  const candidate = kind ?? 'unknown'
  return ACP_TOOL_KINDS.has(candidate) ? candidate : 'unknown'
}

/**
 * Human-facing kind for the approval heading. ACP agents are free to omit
 * `kind` (kimi-code does) and publish only a tool title, so fall back to the
 * programmatic name and title instead of showing "unknown".
 */
function permissionKindLabel(call) {
  const known = permissionRequestKind(call?.kind)
  if (known !== 'unknown') return known
  const hint = `${call?.name ?? ''} ${call?.title ?? ''}`.toLowerCase()
  if (/(^|\W)(bash|shell|command|exec|run|terminal)(\W|$)/.test(hint)) return 'command'
  if (/(^|\W)(write|edit|create|patch|apply|save)(\W|$)/.test(hint)) return 'write'
  if (/(^|\W)(read|view|open|cat|head|tail|list)(\W|$)/.test(hint)) return 'read'
  if (/(^|\W)(delete|remove|rm|unlink)(\W|$)/.test(hint)) return 'delete'
  if (/(^|\W)(search|grep|glob|find)(\W|$)/.test(hint)) return 'search'
  if (/(^|\W)(fetch|http|web|url)(\W|$)/.test(hint)) return 'fetch'
  return 'unknown'
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

function clipText(text, limit) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
}

/**
 * ACP agents announce the concrete action in different fields: kimi-code puts
 * it in a content text block, agy in `locations`/`rawInput`/`diff` blocks.
 * Collect every carrier so one summary works for both.
 */
function acpPermissionFacts(call) {
  const raw = call?.rawInput
  const rawObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : undefined
  const texts = []
  let diffPath
  let diffText
  let terminal
  for (const block of Array.isArray(call?.content) ? call.content : []) {
    if (block?.type === 'content' && block.content?.type === 'text') texts.push(block.content.text)
    else if (block?.type === 'diff') {
      diffPath ??= block.path
      diffText ??= block.newText
    } else if (block?.type === 'terminal') terminal ??= block.terminalId
  }
  const locations = (Array.isArray(call?.locations) ? call.locations : [])
    .map((location) => location?.path)
    .filter((path) => typeof path === 'string' && path !== '')
  return {
    command: firstText(rawObject?.CommandLine, rawObject?.commandLine, rawObject?.command, rawObject?.cmd),
    path: firstText(locations[0], diffPath, rawObject?.Path, rawObject?.path, rawObject?.file_path, rawObject?.filePath),
    content: firstText(diffText, rawObject?.Content, rawObject?.content, rawObject?.new_string, rawObject?.newText),
    texts,
    terminal,
  }
}

/** Strip the ACP notice wrapper so the card shows the action, not the preamble. */
function stripApprovalNotice(text) {
  return typeof text === 'string' ? text.replace(/^\s*requesting approval to\s+/i, '').trim() : ''
}

/**
 * Concrete detail for one ACP request_permission payload. The title is
 * rendered separately by the approval card, so this carries only what the
 * agent actually intends to touch: command, path, and a bounded content
 * preview (content blocks, diff, or rawInput fallback).
 */
function acpPermissionSummary(params) {
  const call = params.toolCall
  const facts = acpPermissionFacts(call)
  const parts = []
  if (facts.command !== undefined) parts.push(`command: ${clipText(facts.command, 300)}`)
  if (facts.path !== undefined) parts.push(`path: ${clipText(facts.path, 300)}`)
  if (facts.content !== undefined) parts.push(`content: ${clipText(facts.content, 240)}`)
  for (const text of facts.texts) {
    const notice = stripApprovalNotice(text)
    if (notice !== '') parts.push(clipText(notice, 300))
  }
  if (facts.terminal !== undefined) parts.push(`terminal: ${facts.terminal}`)
  if (parts.length === 0) {
    const raw = call?.rawInput
    if (raw !== undefined && raw !== null) {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      if (typeof text === 'string' && text.trim() !== '') parts.push(clipText(text, 300))
    }
  }
  if (parts.length === 0) parts.push(`tool kind: ${permissionRequestKind(call?.kind)}`)
  return parts.join(' — ')
}

function acpAllowOptions(params) {
  const options = Array.isArray(params.options) ? params.options : []
  return options.filter((option) => option?.kind === 'allow_once' || option?.kind === 'allow_always')
}

async function rangeExitsWithin(child, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, ms)
  try {
    return await child.waitForExit(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** Dispose through stdin EOF, then terminate and await whole-range quiescence. */
async function disposeAcpChild(child, eofGraceMs) {
  const failures = []
  child.stdin?.end()
  let exited = false
  try {
    exited = await rangeExitsWithin(child, eofGraceMs)
  } catch (error) {
    failures.push(toError(error))
  }
  if (exited) return
  child.terminate()
  try {
    await child.waitForExit()
  } catch (error) {
    failures.push(toError(error))
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'ACP subprocess teardown failed')
}

function acpStopReason(reason) {
  switch (reason) {
    case 'end_turn': return 'completed'
    case 'max_tokens': return 'max-tokens'
    case 'refusal': return 'refusal'
    case 'cancelled': return 'aborted'
    case 'max_turn_requests': return 'error'
    default: return 'error'
  }
}

function acpContentText(content) {
  return content.type === 'text' ? content.text : ''
}

function toAcpPrompt(prompt) {
  const blocks = []
  for (const block of prompt) if (block.type === 'text') blocks.push({
    type: 'text',
    text: block.text,
  })
  return blocks
}

function toError(value) {
  /* v8 ignore next */
  return value instanceof Error ? value : new Error(String(value))
}

function reportFailure(spec, error) {
  try {
    spec.onError?.(toError(error), 'error')
  } catch {}
}

function thinkingOption(session, configId) {
  const options = session?.configOptions
  if (!Array.isArray(options)) throw new Error('ACP child did not advertise configOptions for reasoningEffort')
  const option = options.find((option) => option?.id === configId && option?.category === 'thought_level')
  if (option === undefined) throw new Error(`ACP child does not advertise the ${configId} config option`)
  return option
}

async function setSessionConfig(agent, sessionId, session, configId, value, thinkingConfigId, validateModel = false) {
  if ((configId === 'model' && validateModel) || configId === thinkingConfigId) {
    const option = configId === 'model'
      ? session?.configOptions?.find?.((option) => option?.id === 'model' && option?.category === 'model')
      : thinkingOption(session, thinkingConfigId)
    if (option === undefined) throw new Error('ACP child does not advertise the model config option')
    if (!Array.isArray(option.options) || !option.options.some((candidate) => candidate?.value === value)) {
      throw new Error(`ACP child does not support ${configId === 'model' ? 'model' : 'reasoningEffort'} ${JSON.stringify(value)} for the ${configId} config option`)
    }
  }
  return agent.request(methods.agent.session.setConfigOption, {
    sessionId,
    configId,
    value,
  })
}

function startupFailure(error, stage, outcome) {
  return new AcpRunFailure(
    /* v8 ignore next -- Windows anonymous pipes cannot expose a live-child protocol close during startup. */
    outcome === undefined ? {
      stage,
      category: 'transport',
    } : {
      stage,
      category: 'process-exit',
      outcome,
    },
    error,
  )
}

function terminalFailure(reason, permission) {
  switch (reason) {
    case 'end_turn': return
    case 'max_turn_requests': return diagnosticText({
      stage: 'prompt',
      category: 'remote-limit',
      stopReason: 'max_turn_requests',
    }, permission)
    case 'max_tokens':
    case 'refusal':
    case 'cancelled': return permission === undefined ? undefined : permissionDiagnostic(permission)
    default: return diagnosticText({
      stage: 'prompt',
      category: 'unknown',
      stopReason: 'unknown',
    }, permission)
  }
}

/** Start one child and own its cancellation, result, and quiescent disposal. */
async function startAcpRun(request, spec) {
  if (request.signal.aborted) throw new Error('subagent request was aborted before the ACP child started')
  assertDirectCommand(spec.command)
  const id = randomUUID()
  let child
  try {
    child = spec.spawn({
      argv: [spec.command, ...spec.args],
      cwd: spec.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'inherit',
      },
      graceMs: spec.disposeGraceMs,
      env: spec.env,
    })
  } catch (error) {
    reportFailure(spec, error)
    throw new AcpRunFailure({
      stage: 'process',
      category: 'process-start',
    }, error)
  }
  /* v8 ignore start -- 'pipe' dispositions expose both streams by the seam contract; defensive. */
  if (child.stdin === undefined || child.stdout === undefined) throw new Error('subagent-acp: subprocess implementation dropped a piped protocol stream')
  /* v8 ignore stop */
  let processOutcome
  let processFailure
  const processDone = child.done.then((outcome) => {
    processOutcome = outcome
    return outcome
  }, (error) => {
    processFailure = toError(error)
    throw processFailure
  })
  const processRejected = processDone.then(
    /* v8 ignore next -- the success arm's never-settling executor is intentionally empty. */
    () => new Promise(() => {}),
    (error) => Promise.reject(toError(error)),
  )
  processRejected.catch(() => {})
  const observeProcessOutcome = async (signal) => {
    if (processOutcome !== undefined) return processOutcome
    const timeout = AbortSignal.timeout(Math.ceil(spec.disposeGraceMs))
    const bound = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const aborted = Promise.withResolvers()
    /* v8 ignore next -- Windows cannot expose the live-child protocol close needed to await this abort. */
    const onObservationAbort = () => {
      aborted.resolve(undefined)
    }
    bound.addEventListener('abort', onObservationAbort, { once: true })
    /* v8 ignore next -- closes the event-loop race between listener registration and the preceding derived-signal check. */
    if (bound.aborted) onObservationAbort()
    try {
      return await Promise.race([processDone, aborted.promise])
    } catch {
      return processOutcome
    } finally {
      bound.removeEventListener('abort', onObservationAbort)
    }
  }
  let processDisposal
  const disposeProcess = () => processDisposal ??= disposeAcpChild(child, spec.disposeEofGraceMs)
  const fold = new AssistantOutputFold()
  const flags = { cancelled: false }
  const tasks = spec.tasks
  let latestPermission
  let collecting = false
  let loadingSessionId
  let replayedHistoryChunks = 0
  const agent = client({ name: 'deepseek-harness-subagent-acp' }).onNotification(methods.client.session.update, ({ params }) => {
    const update = params.update
    if (params.sessionId === loadingSessionId && (update.sessionUpdate === 'user_message_chunk' || update.sessionUpdate === 'agent_message_chunk')) replayedHistoryChunks += 1
    // session/load may replay old history. Only this run's prompt belongs in
    // the current result and activity stream.
    if (!collecting || params.sessionId !== sessionId) return Promise.resolve()
    try { spec.observe?.(update) } catch {}
    if (update.sessionUpdate === 'config_option_update') tasks?.setTelemetry?.(acpConfigTelemetry(update.configOptions))
    if (update.sessionUpdate === 'agent_message_chunk') fold.pushText(acpContentText(update.content))
    return Promise.resolve()
  }).onRequest(methods.client.session.requestPermission, async ({ params }) => {
    const request = permissionKindLabel(params.toolCall)
    const permissionTitle = typeof params.toolCall?.title === 'string' && params.toolCall.title ? params.toolCall.title : undefined
    const permissionDetail = acpPermissionSummary(params)
    const allowOptions = acpAllowOptions(params)
    const rejectOptions = (Array.isArray(params.options) ? params.options : [])
      .filter((option) => option?.kind === 'reject_once' || option?.kind === 'reject_always')
    const permissionTraceId = `permission-${permissionCounter()}`
    const observeStatus = (status, text) => {
      try {
        spec.observe?.({ sessionUpdate: 'tool_call', toolCallId: permissionTraceId, title: `Permission request: ${[permissionTitle, permissionDetail].filter(Boolean).join(' — ')}`, status, ...text === undefined ? {} : { content: [{ type: 'content', content: { type: 'text', text } }] } })
      } catch {}
    }
    observeStatus('pending')
    let decision
    try {
      decision = await spec.askPermission?.({
        kindLabel: request,
        title: permissionTitle,
        detail: permissionDetail,
        canAlways: allowOptions.some((option) => option.kind === 'allow_always'),
      }) ?? { outcome: 'deny', scope: 'once', source: 'policy-reject' }
    } catch {
      // The asker itself failed; fail closed with a completed activity.
      decision = { outcome: 'deny', scope: 'once', source: 'asker-error' }
    }
    if (decision.outcome === 'allow') {
      // A one-shot approval must never widen into a persistent grant: only
      // allow_always (when the child offers it AND the decision asked for a
      // persistent grant) carries allow_always; everything else picks
      // allow_once and denies when the child did not offer one.
      const selected = decision.scope === 'always'
        ? allowOptions.find((option) => option.kind === 'allow_always')
          ?? allowOptions.find((option) => option.kind === 'allow_once')
        : allowOptions.find((option) => option.kind === 'allow_once')
      if (selected !== undefined) {
        latestPermission = {
          policy: spec.permission,
          request,
          decision: 'allowed',
          source: decision.source,
        }
        observeStatus('completed', `allowed (${decision.source})`)
        return { outcome: {
          outcome: 'selected',
          optionId: selected.optionId,
        } }
      }
    }
    latestPermission = {
      policy: spec.permission,
      request,
      decision: 'denied',
      source: decision.source,
    }
    observeStatus('completed', `denied (${decision.source})`)
    // Prefer the child's explicit reject option so a denial is not mistaken
    // for a cancellation of the whole request.
    const rejected = rejectOptions.find((option) => option.kind === 'reject_once') ?? rejectOptions[0]
    if (rejected !== undefined) {
      return { outcome: {
        outcome: 'selected',
        optionId: rejected.optionId,
      } }
    }
    return { outcome: { outcome: 'cancelled' } }
  }).connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))).agent
  let sessionId
  let startupStage = 'initialize'
  let signalCancelSettled
  const cancelSettled = new Promise((resolve) => {
    signalCancelSettled = resolve
  })
  const requestCancel = () => {
    if (flags.cancelled) return
    flags.cancelled = true
    signalCancelSettled()
    /* v8 ignore next */
    if (sessionId !== undefined) agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => {})
  }
  const onAbort = () => {
    requestCancel()
  }
  request.signal.addEventListener('abort', onAbort, { once: true })
  const collectOutput = () => fold.collect() ?? []
  try {
    await Promise.race([
      (async () => {
        const initialized = await agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        })
        const capabilities = initialized.agentCapabilities || {}
        const canResume = capabilities.sessionCapabilities?.resume !== undefined
        const canLoad = capabilities.loadSession === true
        let session
        if (spec.resume) {
          startupStage = 'resume-session'
          if (spec.preferLoad && !canLoad) throw new Error(`${spec.label} continuation requires ACP session/load support to verify persisted conversation history`)
          if (!canResume && !canLoad) throw new Error('ACP agent does not support resuming this session')
          const method = spec.preferLoad || !canResume ? methods.agent.session.load : methods.agent.session.resume
          if (spec.requireHistory) loadingSessionId = spec.resume.sessionId
          try {
            session = await agent.request(method, {
              sessionId: spec.resume.sessionId, cwd: spec.cwd, mcpServers: [],
            })
          } finally {
            loadingSessionId = undefined
          }
          if (session.sessionId !== undefined && session.sessionId !== spec.resume.sessionId) throw new Error('ACP agent resumed a different session')
          sessionId = spec.resume.sessionId
          tasks?.setTelemetry?.(acpConfigTelemetry(session.configOptions, session.models))
          if (spec.requireHistory && replayedHistoryChunks === 0) throw new Error(`${spec.label} continuation loaded no user or assistant history. Native session history may not have been persisted; refusing to prompt without the original context`)
        } else {
          startupStage = 'new-session'
          session = await agent.request(methods.agent.session.new, { cwd: spec.cwd, mcpServers: [] })
          if (typeof session.sessionId !== 'string' || !session.sessionId) throw new Error('ACP child published without a session id')
          sessionId = session.sessionId
          tasks?.setTelemetry?.(acpConfigTelemetry(session.configOptions, session.models))
        }
        /* v8 ignore next -- cancelSettled wins the startup race before this post-response guard can settle it. */
        if (flags.cancelled) throw new Error('subagent cancelled before the ACP session started')
        if (!spec.resume && spec.model !== undefined) {
          startupStage = 'set-model'
          const configured = await setSessionConfig(agent, sessionId, session, 'model', spec.model, spec.thinkingConfigId, spec.validateModel)
          if (Array.isArray(configured.configOptions)) session.configOptions = configured.configOptions
          tasks?.setTelemetry?.(modelTelemetry(spec.model, undefined, 'configured'))
          tasks?.setTelemetry?.(acpConfigTelemetry(configured.configOptions))
        }
        if (!spec.resume && spec.reasoningEffort !== undefined) {
          startupStage = 'set-reasoning-effort'
          const configured = await setSessionConfig(agent, sessionId, session, spec.thinkingConfigId, spec.reasoningEffort, spec.thinkingConfigId, spec.validateModel)
          if (Array.isArray(configured.configOptions)) session.configOptions = configured.configOptions
          tasks?.setTelemetry?.(modelTelemetry(undefined, spec.reasoningEffort, 'configured'))
          tasks?.setTelemetry?.(acpConfigTelemetry(configured.configOptions))
        }
        if (canResume || canLoad) spec.onSession?.(sessionId)
        collecting = true
      })(),
      processRejected,
      cancelSettled.then(() => {
        throw new Error('subagent cancelled before the ACP session started')
      }),
    ])
  } catch (error) {
    request.signal.removeEventListener('abort', onAbort)
    const cancelledBeforeCleanup = flags.cancelled
    const observedOutcome = !cancelledBeforeCleanup && !(error instanceof AcpRunFailure) ? await observeProcessOutcome() : undefined
    const startup = cancelledBeforeCleanup ? { kind: 'cancelled' } : {
      kind: 'failed',
      failure: error instanceof AcpRunFailure ? error : startupFailure(error, startupStage, observedOutcome),
    }
    if (startup.kind === 'cancelled') {} else reportFailure(spec, error instanceof AcpRunFailure ? error.cause : processFailure ?? error)
    try {
      await disposeProcess()
    } catch (cleanupError) {
      reportFailure(spec, cleanupError)
      const cleanupFailure = new AcpRunFailure({
        stage: 'teardown',
        category: processOutcome === undefined ? 'unknown' : 'process-exit',
        ...processOutcome === undefined ? {} : { outcome: processOutcome },
      }, cleanupError)
      if (startup.kind === 'cancelled') throw new AggregateError([cleanupFailure], cleanupFailure.message)
      throw new AggregateError([startup.failure, cleanupFailure], `${startup.failure.message}; ${cleanupFailure.message}`)
    }
    if (startup.kind === 'cancelled') throw new Error('subagent request was aborted before the ACP child started')
    throw startup.failure
  }
  /* v8 ignore next */
  if (sessionId === undefined) throw new Error('unreachable: ACP startup fulfilled without a session id')
  const remoteSessionId = sessionId
  let diagnostic
  return subprocessRunHandle({
    id,
    result: settleRunResult({
      attempt: async () => {
        try {
          const promptResult = await Promise.race([agent.request(methods.agent.session.prompt, {
            sessionId: remoteSessionId,
            prompt: toAcpPrompt(request.prompt),
          }), cancelSettled.then(() => {
            throw new Error('subagent cancelled while the ACP prompt was running')
          })])
          const stopReason = acpStopReason(promptResult.stopReason)
          const usage = acpUsage(promptResult.usage)
          if (usage) tasks?.setTelemetry?.({ usage, usageScope: 'session' })
          diagnostic = terminalFailure(promptResult.stopReason, latestPermission)
          return {
            output: collectOutput(),
            ...diagnostic === undefined ? {} : { diagnostic },
            stopReason,
          }
        } catch (error) {
          if (!flags.cancelled) {
            const outcome = await observeProcessOutcome(request.signal)
            diagnostic = diagnosticText(outcome === undefined ? {
              stage: 'prompt',
              category: 'transport',
            } : {
              stage: 'process',
              category: 'process-exit',
              outcome,
            }, latestPermission)
          }
          throw processFailure ?? error
        }
      },
      collectOutput,
      collectDiagnostic: () => diagnostic,
      cancelled: () => flags.cancelled,
      onError: spec.onError,
      signal: request.signal,
      onAbort,
    }),
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: async () => {
      try {
        await disposeProcess()
      } catch (error) {
        reportFailure(spec, error)
        throw new AcpRunFailure({
          stage: 'teardown',
          category: processOutcome === undefined ? 'unknown' : 'process-exit',
          ...processOutcome === undefined ? {} : { outcome: processOutcome },
        }, error)
      }
    },
  })
}

function assertPositiveFinite(name, value) {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) throw new Error(`subagent-acp: ${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
}

export class AcpProvider {
  name
  ctx
  config
  capabilities = {
    agentOptions: false,
    agentPreset: false,
    outputSchema: false,
    depthLimit: false,
  }
  inheritsParentContext = false

  constructor(name, ctx, config, dialect = KIMI_ACP_DIALECT) {
    if (dialect.agent === 'agy' && name !== dialect.defaultProviderName) throw new Error(`ACP providerName must be ${JSON.stringify(dialect.defaultProviderName)} for ${dialect.agent} continuation isolation`)
    this.name = name
    this.ctx = ctx
    this.config = config
    this.dialect = dialect
  }

  start(request) {
    if (request.signal.aborted) throw new Error('subagent request was aborted before the ACP child started')
    const trace = currentTaskTrace()
    const resume = trace?.resume
    if (resume && (resume.agent !== this.dialect.agent || typeof resume.sessionId !== 'string' || !resume.sessionId)) throw new Error(`Invalid saved ${this.dialect.label} session`)
    if (resume && (typeof trace.record?.cwd !== 'string' || !sameDirectory(trace.record.cwd, request.cwd))) throw new Error(`${this.dialect.label} continuation must use the saved workspace`)
    let cwd
    try {
      cwd = assertUsableCwd('subagent-acp', 'child cwd', request.cwd)
    } catch (error) {
      const failure = acpConfigurationFailure(error)
      this.ctx.logger.warn(`subagent-acp "${this.name}": child start failed: %o`, error)
      throw failure
    }
    const permissionPolicy = normalizePermissionPolicy(currentValue(this.config.permission))
    const subagentPermissionMode = normalizeSubagentPermissionMode(currentValue(this.config.subagentPermissionMode))
    const askPermission = createPermissionAsker({
      ctx: this.ctx,
      parent: request.parent,
      policy: permissionPolicy,
      subagentMode: subagentPermissionMode,
      backend: 'acp',
      agentLabel: this.dialect.label,
      language: trace?.record?.language,
      signal: request.signal,
    })
    // The agy CLI exposes a native full-access bypass; kimi acp documents no
    // startup flag, so its full-access level is realized by granting every
    // ask instead.
    const bypassArgs = this.dialect.bypassFlag !== undefined
      && permissionPolicy === 'subagent'
      && subagentPermissionMode === 'full-access'
      && !(this.config.args ?? []).includes(this.dialect.bypassFlag)
      ? [this.dialect.bypassFlag]
      : []
    return startAcpRun(request, {
      command: this.config.command,
      args: [...(this.config.args ?? []), ...bypassArgs],
      cwd,
      permission: permissionPolicy,
      askPermission,
      env: this.config.env,
      model: this.config.model,
      reasoningEffort: this.config.reasoningEffort,
      thinkingConfigId: this.dialect.thinkingConfigId,
      validateModel: this.dialect.validateModel,
      preferLoad: this.dialect.preferLoad,
      requireHistory: this.dialect.requireHistory,
      label: this.dialect.label,
      disposeEofGraceMs: this.config.disposeEofGraceMs,
      disposeGraceMs: this.config.disposeGraceMs,
      spawn: (spec) => this.ctx.subprocess.spawn(spec),
      tasks: this.ctx.get('multiAgentTasks'),
      resume,
      onSession: (sessionId) => this.ctx.get('multiAgentTasks')?.setExternalSession?.(this.dialect.agent, sessionId),
      observe: (update) => this.ctx.get('multiAgentTasks')?.observeACP?.(update),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(`subagent-acp "${this.name}": child run failed (${stopReason}): ${error.message}`)
      }
    })
  }
}

/** Open a real ACP session for bounded, non-interactive capability discovery. */
export async function probeAcpSession(ctx, spec, inspect = ({ session }) => session, timeoutMs = 15000) {
  assertDirectCommand(spec.command)
  const child = ctx.subprocess.spawn({
    argv: [spec.command, ...spec.args],
    cwd: spec.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    graceMs: 3000,
    env: spec.env,
  })
  // Observe launch/provider failures immediately; a rejected done promise must
  // never become an unhandled rejection while the protocol handshake waits.
  const processResult = child.done.then((outcome) => {
    throw new Error(`ACP catalog child exited before completing the probe (exit code: ${outcome.exitCode ?? 'unknown'})`)
  }, (error) => {
    throw toError(error)
  })
  let rejectTimeout
  const timeout = new Promise((_, reject) => { rejectTimeout = reject })
  const timer = setTimeout(() => {
    child.terminate()
    rejectTimeout(new Error('ACP catalog probe timed out'))
  }, timeoutMs)
  timer.unref?.()
  let failure
  try {
    if (child.stdin === undefined || child.stdout === undefined) throw new Error('ACP catalog subprocess requires piped protocol streams')
    return await Promise.race([
      (async () => {
        const agent = client({ name: 'deepseek-harness-subagent-acp-catalog' })
          .connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))).agent
        await agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        })
        const session = await agent.request(methods.agent.session.new, { cwd: spec.cwd, mcpServers: [] })
        if (typeof session.sessionId !== 'string' || !session.sessionId) throw new Error('ACP catalog child did not publish a session id')
        return await inspect({ agent, session })
      })(),
      processResult,
      timeout,
    ])
  } catch (error) {
    failure = toError(error)
    throw failure
  } finally {
    clearTimeout(timer)
    try {
      await disposeAcpChild(child, 3000)
    } catch (cleanupError) {
      if (failure) throw new AggregateError([failure, toError(cleanupError)], 'ACP catalog probe and cleanup failed')
      throw cleanupError
    } finally {
      await child.done.catch(() => {})
    }
  }
}

export function selectAcpCommand(config, availability, bareCommand) {
  const configured = currentValue(config.command)?.trim() || undefined
  if (configured) return configured
  const detected = availability?.kimiCommand?.trim() || undefined
  if (detected) return detected
  const overrides = currentValue(config.env) ?? {}
  if (!hasEnvironmentKey(overrides, 'PATH')) return undefined
  return resolveExecutable(bareCommand, commandEnvironment(overrides))
}

export function apply(ctx, config) {
  const availability = ctx.get('multiAgentAvailability')
  const command = selectAcpCommand(config, availability, 'kimi')
  if (!command) {
    ctx.logger.warn('kimi-code-acp: Kimi Code is unavailable; skipping ACP provider and model route registration')
    return
  }
  assertDirectCommand(command)
  const resolved = dynamicAcpConfig(config)
  Object.defineProperty(resolved, 'command', {
    enumerable: true,
    get: () => selectAcpCommand(config, availability, 'kimi'),
  })
  assertPositiveFinite('disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertPositiveFinite('disposeGraceMs', resolved.disposeGraceMs)
  ctx.subagents.registerProvider(new AcpProvider(resolved.providerName, ctx, resolved, KIMI_ACP_DIALECT))
  registerModelCatalogRoute(ctx, 'kimi-code', async () => {
    const stdout = await runCatalogCommand(ctx, [resolved.command, 'provider', 'list', '--json'], 15000, currentValue(config.env) ?? {})
    return kimiCatalogFromOutput(stdout)
  })
}
