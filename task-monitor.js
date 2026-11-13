import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { addUsage, codexUsage, mergeTelemetry, normalizeUsage, telemetrySchema } from './lib/task-telemetry.js'
import { findRootAgent, isModernSubagentRuntime, isRootAgent } from './lib/runtime-compat.js'

export const TASK_TEXT_LIMIT = 16 * 1024
export const TASK_ACTIVITY_LIMIT = 500
export const TASK_TOTAL_TEXT_LIMIT = 256 * 1024
export const TASK_RECORD_LIMIT = 200

const TERMINAL_STATUSES = new Set(['completed', 'aborted', 'error', 'max-tokens', 'refusal', 'interrupted'])
const TOOL_STATUSES = new Set(['pending', 'in_progress', 'inProgress', 'completed', 'failed', 'declined'])
const CODEX_TOOL_TYPES = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'collabAgentToolCall'])
const traceStorage = new AsyncLocalStorage()
const NATIVE_TELEMETRY_TYPES = new Set(['request/header', 'request/context', 'assistant/message'])

function text(value) {
  return typeof value === 'string' ? value : ''
}

function clipped(value, limit = TASK_TEXT_LIMIT) {
  const source = text(value)
  if (source.length <= limit) return { value: source, truncated: false }
  let result = source.slice(0, limit)
  if (/[\uD800-\uDBFF]/.test(result.slice(-1))) result = result.slice(0, -1)
  return { value: result, truncated: true }
}

function activityId(record, prefix, id) {
  return `${prefix}:${typeof id === 'string' && id.length > 0 ? id : ++record.activitySequence}`
}

function copyActivity(activity) {
  return {
    id: activity.id,
    type: activity.type,
    time: activity.time,
    ...activity.title === undefined ? {} : { title: activity.title },
    ...activity.text === undefined ? {} : { text: activity.text },
    ...activity.status === undefined ? {} : { status: activity.status },
  }
}

function outputText(output) {
  if (typeof output === 'string') return output
  if (!Array.isArray(output)) return ''
  return output.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text).join('\n')
}

function acpToolText(content) {
  if (!Array.isArray(content)) return undefined
  const parts = content.flatMap((entry) => entry?.type === 'content' && entry.content?.type === 'text' && typeof entry.content.text === 'string'
    ? [entry.content.text]
    : [])
  return parts.length === 0 ? undefined : parts.join('\n')
}

function codexToolTitle(item) {
  if (item.type === 'commandExecution' && typeof item.command === 'string') return item.command
  if (item.type === 'mcpToolCall') {
    const name = [item.server, item.tool].filter((part) => typeof part === 'string' && part.length > 0).join('.')
    if (name) return name
  }
  if (typeof item.name === 'string' && item.name) return item.name
  if (typeof item.tool === 'string' && item.tool) return item.tool
  return item.type
}

function codexToolText(item) {
  if (typeof item.aggregatedOutput === 'string') return item.aggregatedOutput
  return undefined
}

export function runWithTaskTrace(trace, callback) {
  return traceStorage.run(trace, callback)
}

export function currentTaskTrace() {
  return traceStorage.getStore()
}

const storedTaskSchema = z.object({
  childId: z.string(), parentSessionId: z.string(), agent: z.string(), label: z.string(),
  cwd: z.string(), reportPath: z.string().optional(), providerName: z.string().optional(),
  language: z.string().optional(), activeChildId: z.string().optional(), aliases: z.array(z.string()).default([]),
  status: z.string(), startedAt: z.number(), updatedAt: z.number(), finishedAt: z.number().optional(),
  archived: z.boolean(), hidden: z.boolean(), continuationCount: z.number().default(0),
  continuation: z.object({ agent: z.enum(['codex', 'kimi-code', 'agy']), sessionId: z.string().min(1) }).optional(),
  output: z.string().optional(), diagnostic: z.string().optional(), truncated: z.boolean().default(false),
  telemetry: telemetrySchema.optional(),
  telemetryTurn: z.string().max(1024).optional(),
  nativeSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict()

function taskKey(record) {
  // The per-record backend requires /^[a-zA-Z0-9_-]+$/ keys.
  return createHash('sha256').update(JSON.stringify([record.parentSessionId, record.childId])).digest('hex')
}

export class MultiAgentTasks extends Service {
  static inject = ['webServer', 'connection', 'agents', 'subagents', 'storageDomain']
  constructor(ctx, options = {}) {
    super(ctx, 'multiAgentTasks')
    this.records = new Set()
    this.revision = 0
    this.pendingWrites = Promise.resolve()
    this.pendingNativeTelemetry = new Map()
    this.nativeRuns = new Map()
    this.nativeDeadlines = new Set()
    this.now = options.now ?? (() => new Date())
    // Observe initialization rejection immediately. Waiting for the first tool
    // or HTTP caller leaves a rejected promise that can terminate the Host.
    this.ready = this.restoreStorage().catch(async (error) => {
      this.initializationError = error
      this.storageError = 'Task history storage is unavailable. Task operations are disabled until it is repaired.'
      this.table = undefined
      try { this.ctx.logger?.warn?.('multi-agent: task history initialization failed', error) } catch {}
      try { await this.domain?.close() } catch {}
      this.domain = undefined
    })
    ctx.effect(() => async () => {
      for (const cancel of this.nativeDeadlines) cancel()
      this.nativeRuns.clear()
      await this.ready
      await this.pendingWrites
      try { await this.domain?.close() } catch (error) {
        try { this.ctx.logger?.warn?.('multi-agent: task history close failed', error) } catch {}
      }
    }, 'multi-agent: task history storage')
    if (typeof ctx.on === 'function') ctx.on('session/event', (session, event) => this.observeNative(session, event), { global: true })
    if (isModernSubagentRuntime(ctx) && typeof ctx.on === 'function') {
      ctx.on('subagent/start', (info) => this.observeNativeStart(info), { global: true })
      ctx.on('subagent/end', (info) => this.observeNativeEnd(info), { global: true })
    }
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/multi-agent/tasks',
      handler: (req, res) => this.handleHttp(req, res),
    }), 'multi-agent: task monitor')
  }

  async restoreStorage() {
    if (!this.ctx.storageDomain) return
    this.domain = await this.ctx.storageDomain.open({
      name: 'multi_agent_task_history', version: 1, layout: 'per-record',
      tables: { tasks: { valueSchema: storedTaskSchema } },
    })
    this.table = this.domain.table('tasks')
    for (const [, saved] of this.table.entries()) {
      const record = { ...saved, generation: 1, activities: [], activitySequence: 0, totalText: 0, tools: new Map(), messages: new Map(), aliases: new Set(saved.aliases), historyRestored: true }
      record.trace = { record, generation: 1, settledCallbacks: new Set() }
      if (!TERMINAL_STATUSES.has(record.status)) {
        record.status = 'interrupted'
        record.archived = true
        record.finishedAt = this.timestamp()
        record.diagnostic = 'Host restarted; this run is no longer active. Continue the task explicitly to resume its saved session.'
      }
      this.records.add(record)
    }
    this.prune()
  }

  assertStorageAvailable() {
    if (this.initializationError) throw new Error(this.storageError)
  }

  stored(record) {
    const value = {
      childId: record.childId, parentSessionId: record.parentSessionId, agent: record.agent,
      label: record.label, cwd: record.cwd, reportPath: record.reportPath, providerName: record.providerName,
      language: record.language, activeChildId: record.activeChildId, aliases: [...record.aliases],
      status: record.status, startedAt: record.startedAt, updatedAt: record.updatedAt, finishedAt: record.finishedAt,
      archived: Boolean(record.archived), hidden: Boolean(record.hidden), continuationCount: record.continuationCount || 0,
      continuation: record.continuation, output: record.output, diagnostic: record.diagnostic, truncated: record.truncated,
      telemetry: record.telemetry,
      nativeSeq: record.nativeSeq,
    }
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined))
  }

  persist(record) {
    if (!this.table || !record.childId) return
    const value = this.stored(record)
    this.pendingWrites = this.pendingWrites.then(() => {
      if (record.childId) return this.table.put(taskKey(record), this.stored(record))
    }).catch((error) => {
      this.storageError = 'Task history could not be saved.'
      this.ctx.logger?.warn?.('multi-agent: task history persistence failed', error)
    })
  }

  getRecord(parentSessionId, childId) {
    return [...this.records].find((record) => record.parentSessionId === parentSessionId && (record.childId === childId || record.aliases.has(childId)))
  }

  registerContinuationHandler(handler) {
    this.continuationHandler = handler
    return () => { if (this.continuationHandler === handler) this.continuationHandler = undefined }
  }

  async continueTask(agent, args, signal) {
    await this.ready
    this.assertStorageAvailable()
    if (!isRootAgent(this.ctx, agent)) throw new Error('Only the exact parent root agent may continue its tasks')
    if (!this.continuationHandler) throw new Error('Task continuation is temporarily unavailable')
    return this.continuationHandler(agent, args, signal)
  }

  beginContinuation(parentSessionId, childId) {
    this.assertStorageAvailable()
    const record = this.getRecord(parentSessionId, childId)
    if (!record) throw new Error('Task does not belong to this parent or its retained history is unavailable')
    if (record.nativeAwaitingEnd) throw new Error('Native task cancellation has not been confirmed; wait for its final outcome before continuing')
    if (record.trace.admissionPending) throw new Error('Task continuation admission is still pending')
    if (!TERMINAL_STATUSES.has(record.status)) throw new Error('Task is still running; wait for it to settle before continuing')
    if (record.agent !== 'dsh' && !record.continuation) throw new Error('This task has no saved external session identifier; its original session cannot be resumed')
    const previous = { ...record, trace: undefined }
    const pendingTelemetry = this.pendingNativeTelemetry.get(record.activeChildId || record.childId)
    record.generation += 1
    const trace = { record, generation: record.generation, resume: record.continuation, settledCallbacks: new Set(), admissionPending: true, accepted: false }
    record.trace = trace
    record.status = 'starting'
    record.archived = false
    record.hidden = false
    record.continuationCount += 1
    delete record.finishedAt
    delete record.output
    delete record.diagnostic
    delete record.lastNativeOutput
    record.tools = new Map()
    record.messages = new Map()
    this.replayNativeTelemetry(record)
    this.append(trace, { type: 'status', title: 'Task continuation requested', status: 'starting' })
    this.persist(record)
    return { record, trace, accept: () => this.acceptContinuation(trace), rollback: () => {
      // rc.2 can publish start/end before sendMessage accepts the input. Those
      // observations are not an admission receipt and cannot disable rollback.
      if (record.trace !== trace || trace.accepted) return
      for (const callback of trace.settledCallbacks) callback()
      const generation = record.generation
      Object.assign(record, previous, { generation })
      if (pendingTelemetry) this.pendingNativeTelemetry.set(record.activeChildId || record.childId, pendingTelemetry)
      record.trace = { record, generation, settledCallbacks: new Set() }
      trace.record = record
      this.touch(record)
      this.persist(record)
    } }
  }

  acceptContinuation(trace) {
    if (trace.record.trace !== trace || trace.generation !== trace.record.generation || trace.accepted) return
    trace.accepted = true
    trace.admissionPending = false
    this.touch(trace.record)
  }

  bindContinuation(trace, childId) {
    if (trace.record.trace !== trace || trace.generation !== trace.record.generation) return
    this.acceptContinuation(trace)
    trace.record.activeChildId = childId
    trace.record.aliases.add(childId)
    this.replayNativeTelemetry(trace.record)
    if (!TERMINAL_STATUSES.has(trace.record.status)) trace.record.status = 'running'
    this.touch(trace.record)
    this.persist(trace.record)
  }

  onSettlement(trace, callback) {
    if (trace.record.trace !== trace || trace.generation !== trace.record.generation) return () => {}
    if (TERMINAL_STATUSES.has(trace.record.status)) { callback(); return () => {} }
    trace.settledCallbacks.add(callback)
    return () => trace.settledCallbacks.delete(callback)
  }

  // After admission, callers supply the remaining configured task deadline and
  // the interruption action they own. Settlement must not await a stuck disposer.
  // This also bounds native sendMessage continuations, which have no result promise.
  armNativeDeadline(trace, timeoutMs, interrupt) {
    if (!isModernSubagentRuntime(this.ctx) || trace?.record.agent !== 'dsh') return () => {}
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 86400000) throw new Error('Invalid native task deadline')
    if (typeof interrupt !== 'function') throw new Error('Native task deadline requires a cancellation action')
    if (trace.record.trace !== trace || trace.generation !== trace.record.generation || TERMINAL_STATUSES.has(trace.record.status)) return () => {}
    let timer
    const cancel = () => {
      clearTimeout(timer)
      trace.settledCallbacks.delete(cancel)
      this.nativeDeadlines.delete(cancel)
    }
    timer = setTimeout(() => {
      cancel()
      if (trace.record.trace !== trace || trace.generation !== trace.record.generation || TERMINAL_STATUSES.has(trace.record.status)) return
      // Invoke cancellation first; a synchronous authoritative end may win.
      try { void Promise.resolve(interrupt?.()).catch(() => {}) } catch {}
      // A failed/hung interrupt is not evidence that the child stopped. Expose
      // the timeout, block continuation, and let the paired end confirm it later.
      this.settle(trace, { status: 'error', diagnostic: 'Task deadline exceeded; cancellation was requested but its final outcome is not confirmed.' }, true)
    }, timeoutMs)
    timer.unref?.()
    trace.settledCallbacks.add(cancel)
    this.nativeDeadlines.add(cancel)
    return cancel
  }

  observeNativeStart(info) {
    if (!info?.local || typeof info.runId !== 'string' || typeof info.id !== 'string' || typeof info.parentSessionId !== 'string' || this.nativeRuns.has(info.runId)) return
    const run = { id: info.id, parentSessionId: info.parentSessionId }
    this.nativeRuns.set(info.runId, run)
    // Keep only a bounded admission-race cache. Live traces retain their run id.
    while (this.nativeRuns.size > TASK_RECORD_LIMIT) this.nativeRuns.delete(this.nativeRuns.keys().next().value)
    const contextual = currentTaskTrace()
    const record = [...this.records].find((item) => item.agent === 'dsh' && item.parentSessionId === info.parentSessionId && (item.activeChildId || item.childId) === info.id)
      ?? (contextual?.record.agent === 'dsh' && contextual.record.parentSessionId === info.parentSessionId && !contextual.record.childId ? contextual.record : undefined)
    if (!record) return
    if (TERMINAL_STATUSES.has(record.status) && !record.nativeAwaitingEnd && !record.trace.admissionPending) {
      record.generation += 1
      record.trace = { record, generation: record.generation, settledCallbacks: new Set() }
      record.continuationCount += 1
      record.status = 'running'
      record.archived = false
      record.hidden = false
      delete record.finishedAt
      delete record.output
      delete record.diagnostic
      delete record.lastNativeOutput
      delete record.nativeAwaitingEnd
    }
    run.trace = record.trace
    record.trace.nativeRunId = info.runId
    if (!record.nativeAwaitingEnd) record.status = 'running'
    this.touch(record)
    this.persist(record)
  }

  observeNativeEnd(info) {
    if (!info?.local || typeof info.runId !== 'string') return
    const run = this.nativeRuns.get(info.runId)
    // An active trace remains authoritative even if unrelated admissions evicted
    // its cache entry. Unknown/unpaired or mismatched end events are ignored.
    const trace = run?.trace ?? [...this.records].find((item) => item.trace.nativeRunId === info.runId)?.trace
    if (run && (run.id !== info.id || run.parentSessionId !== info.parentSessionId || run.ended)) return
    if (!run && !trace) return
    if (trace && trace.nativeRunId !== info.runId) return
    if (trace && (trace.record.parentSessionId !== info.parentSessionId || ((trace.record.activeChildId || trace.record.childId) && (trace.record.activeChildId || trace.record.childId) !== info.id))) return
    const output = clipped(outputText(info.lastAssistantMessage))
    const result = { stopReason: info.stopReason, output: output.value, truncated: output.truncated }
    if (run) { run.ended = true; run.result = result }
    if (trace) this.settle(trace, result)
  }

  bindNativeRun(trace, childId) {
    if (!isModernSubagentRuntime(this.ctx) || trace.record.agent !== 'dsh') return
    const entry = [...this.nativeRuns].reverse().find(([, run]) => run.id === childId && run.parentSessionId === trace.record.parentSessionId && (!run.trace || run.trace === trace))
    if (!entry) return
    const [runId, run] = entry
    trace.nativeRunId = runId
    run.trace = trace
    if (run.ended) this.settle(trace, run.result)
  }

  setExternalSession(agent, sessionId) {
    const trace = currentTaskTrace()
    if (!trace || trace.record.agent !== agent || typeof sessionId !== 'string' || !sessionId || trace.generation !== trace.record.generation) return
    trace.record.continuation = { agent, sessionId }
    this.touch(trace.record)
    this.persist(trace.record)
  }

  setTelemetry(update, trace = currentTaskTrace()) {
    const record = trace?.record
    if (!record || trace.generation !== record.generation) return
    const changed = this.applyTelemetry(record, update)
    if (changed) {
      this.touch(record)
      this.persist(record)
    }
    return changed
  }

  applyTelemetry(record, update) {
    try {
      const telemetry = telemetrySchema.parse(mergeTelemetry(record.telemetry, update) ?? {})
      const next = Object.keys(telemetry).length === 0 ? undefined : telemetry
      if (JSON.stringify(next) === JSON.stringify(record.telemetry)) return false
      record.telemetry = next
      return true
    } catch {
      return false
    }
  }

  manage(parentSessionId, args) {
    this.assertStorageAvailable()
    if (!['archive', 'restore', 'clear'].includes(args.action)) throw new Error('Unknown task management action')
    if (args.action !== 'clear' && !args.childId) throw new Error('This action requires childId')
    const records = args.childId ? [this.getRecord(parentSessionId, args.childId)] : [...this.records].filter((record) => record.parentSessionId === parentSessionId && record.archived && !record.hidden)
    if (records.some((record) => !record)) throw new Error('Task does not belong to this parent or is unavailable')
    if (records.some((record) => record.nativeAwaitingEnd || record.trace.admissionPending || !TERMINAL_STATUSES.has(record.status))) throw new Error('Running tasks cannot be archived or cleared')
    const changed = []
    for (const record of records) {
      if (args.action === 'restore') { record.archived = false; record.hidden = false }
      else if (args.action === 'archive') record.archived = true
      else {
        record.archived = true
        record.hidden = true
        record.activities = []
        record.tools.clear()
        record.messages.clear()
        record.totalText = 0
      }
      this.touch(record)
      this.persist(record)
      changed.push(record.childId)
    }
    return { action: args.action, changed, revision: this.revision }
  }

  observeNative(session, event) {
    const record = [...this.records].find((item) => item.agent === 'dsh' && (item.childId === session.id || item.activeChildId === session.id))
    if ((!record || ((record.status === 'starting' || TERMINAL_STATUSES.has(record.status)) && !record.nativeTelemetryReplaying)) && NATIVE_TELEMETRY_TYPES.has(event.type) && Number.isSafeInteger(event.seq)) {
      const pending = this.pendingNativeTelemetry.get(session.id) ?? []
      if (!pending.some((candidate) => candidate.seq === event.seq) && event.seq > (pending.at(-1)?.seq ?? -1)) {
        pending.push(event)
        if (pending.length > 64) pending.shift()
      }
      this.pendingNativeTelemetry.set(session.id, pending)
      if (this.pendingNativeTelemetry.size > 64) this.pendingNativeTelemetry.delete(this.pendingNativeTelemetry.keys().next().value)
      return
    }
    if (!record || (record.nativeSeq !== undefined && event.seq <= record.nativeSeq)) return
    const trace = record.trace
    let telemetryChanged = false
    if (event.type === 'request/header') {
      const config = event.data?.header?.config
      telemetryChanged = this.applyTelemetry(record, {
        ...typeof config?.model === 'string' && config.model ? { model: config.model, modelSource: 'reported', clearReasoningEffortOnModelChange: true } : {},
        ...config && Object.hasOwn(config, 'reasoningEffort') ? typeof config.reasoningEffort === 'string' && config.reasoningEffort ? { reasoningEffort: config.reasoningEffort, reasoningEffortSource: 'reported' } : { clearReasoningEffort: true } : {},
      }) || telemetryChanged
    } else if (event.type === 'request/context') {
      if (typeof event.data?.model === 'string' && event.data.model) telemetryChanged = this.applyTelemetry(record, { model: event.data.model, modelSource: 'reported' }) || telemetryChanged
    } else if (event.type === 'assistant/message') {
      const model = event.data?.message?.source?.model
      if (typeof model === 'string' && model) telemetryChanged = this.applyTelemetry(record, { model, modelSource: 'reported' }) || telemetryChanged
      const usage = normalizeUsage(event.data?.usage)
      if (usage) telemetryChanged = this.applyTelemetry(record, { usage: addUsage(record.telemetry?.usage, usage), usageScope: 'task' }) || telemetryChanged
    }
    record.nativeSeq = event.seq
    if (telemetryChanged) {
      this.touch(record)
      this.persist(record)
    }
    const modern = isModernSubagentRuntime(this.ctx)
    if (event.type === 'turn/start') {
      // Modern epochs are reopened by subagent/start, not a late turn event.
      if (modern && TERMINAL_STATUSES.has(record.status)) return
      if (TERMINAL_STATUSES.has(record.status)) {
        record.generation += 1
        record.trace = { record, generation: record.generation, settledCallbacks: new Set() }
        record.continuationCount += 1
      }
      record.status = 'running'
      record.archived = false
      record.hidden = false
      delete record.finishedAt
      delete record.output
      delete record.lastNativeOutput
      this.touch(record)
      this.persist(record)
    } else if (event.type === 'assistant/message' && !TERMINAL_STATUSES.has(record.status)) {
      const message = outputText(event.data.message.content)
      if (!message) return
      const activity = this.append(trace, { id: `native:${event.seq}`, type: 'message', title: 'Assistant', text: '' })
      if (activity) this.updateText(trace, activity, message, false)
      record.lastNativeOutput = clipped(message).value
    } else if (event.type === 'turn/end' && !modern && !TERMINAL_STATUSES.has(record.status)) {
      const reason = event.data.reason
      this.settle(record.trace, { stopReason: TERMINAL_STATUSES.has(reason.kind) ? reason.kind : 'error', output: record.lastNativeOutput || '', diagnostic: reason.kind === 'error' ? reason.error?.message : undefined })
    }
  }

  timestamp() {
    return this.now().getTime()
  }

  touch(record) {
    record.updatedAt = this.timestamp()
    this.revision += 1
  }

  prune() {
    while (this.records.size > TASK_RECORD_LIMIT) {
      const oldest = [...this.records].find((record) => !record.nativeAwaitingEnd && !record.trace.admissionPending && TERMINAL_STATUSES.has(record.status))
      if (!oldest) break
      this.records.delete(oldest)
      if (this.table && oldest.childId) this.pendingWrites = this.pendingWrites.then(() => this.table.delete(taskKey(oldest))).catch(() => { this.storageError = 'Task history cleanup could not be saved.' })
    }
  }

  begin({ parentSessionId, agent, label, cwd, reportPath, providerName, language }) {
    this.assertStorageAvailable()
    const time = this.timestamp()
    const record = {
      parentSessionId,
      agent,
      label,
      cwd,
      reportPath,
      providerName,
      language,
      generation: 1,
      aliases: new Set(),
      continuationCount: 0,
      archived: false,
      hidden: false,
      status: 'starting',
      startedAt: time,
      updatedAt: time,
      activities: [],
      activitySequence: 0,
      totalText: 0,
      tools: new Map(),
      messages: new Map(),
      truncated: false,
    }
    const trace = { record, generation: 1, settledCallbacks: new Set() }
    record.trace = trace
    this.records.add(record)
    this.append(trace, { id: 'start', type: 'status', title: 'Task dispatch started', status: 'starting' })
    this.prune()
    return trace
  }

  bind(trace, childId) {
    if (!trace || typeof childId !== 'string' || childId.length === 0) return
    const record = trace.record
    if (record.trace !== trace || trace.generation !== record.generation) return
    if (record.childId === childId) return
    if (record.childId !== undefined || [...this.records].some((candidate) => candidate !== record && candidate.childId === childId)) return
    record.childId = childId
    record.activeChildId = childId
    record.aliases.add(childId)
    this.bindNativeRun(trace, childId)
    this.replayNativeTelemetry(record)
    if (!TERMINAL_STATUSES.has(record.status)) record.status = 'running'
    this.touch(record)
    this.persist(record)
    if (record.activities.length < TASK_ACTIVITY_LIMIT) this.append(trace, { id: 'running', type: 'status', title: 'Task running', status: record.status })
    else this.touch(record)
  }

  replayNativeTelemetry(record) {
    if (record.agent !== 'dsh') return
    const childId = record.activeChildId || record.childId
    const pending = this.pendingNativeTelemetry.get(childId) ?? []
    this.pendingNativeTelemetry.delete(childId)
    const previousSeq = record.nativeSeq
    let lastSeq = previousSeq
    for (const event of pending) {
      if (lastSeq !== undefined && event.seq <= lastSeq) continue
      record.nativeSeq = previousSeq
      record.nativeTelemetryReplaying = true
      this.observeNative({ id: childId }, event)
      record.nativeTelemetryReplaying = false
      lastSeq = event.seq
    }
    if (lastSeq !== undefined) record.nativeSeq = lastSeq
  }

  settle(trace, result = {}, awaitingNativeEnd = false) {
    const record = trace?.record
    if (!record || record.trace !== trace || trace.generation !== record.generation) return
    const confirmingDeadline = record.nativeAwaitingEnd === true
    if (TERMINAL_STATUSES.has(record.status) && (!confirmingDeadline || awaitingNativeEnd)) return
    record.nativeAwaitingEnd = awaitingNativeEnd
    if (confirmingDeadline) delete record.diagnostic
    const status = TERMINAL_STATUSES.has(result.status) ? result.status
      : TERMINAL_STATUSES.has(result.stopReason) ? result.stopReason
        : 'error'
    record.status = status
    const finishedAt = this.timestamp()
    const output = clipped(outputText(result.output))
    if (output.value) record.output = output.value
    if (typeof result.diagnostic === 'string' && result.diagnostic) {
      const diagnostic = clipped(result.diagnostic)
      record.diagnostic = diagnostic.value
      if (diagnostic.truncated) record.truncated = true
    }
    if (output.truncated || result.truncated === true) record.truncated = true
    const previousEnd = confirmingDeadline && record.activities.find((activity) => activity.id === `${trace.generation > 1 ? `${trace.generation}:` : ''}end`)
    if (previousEnd) { previousEnd.title = `Task ${status}`; previousEnd.status = status; this.touch(record) }
    else if (record.activities.length < TASK_ACTIVITY_LIMIT) this.append(trace, { id: 'end', type: 'status', title: `Task ${status}`, status })
    else this.touch(record)
    record.finishedAt = finishedAt
    record.archived = true
    this.persist(record)
    for (const callback of trace.settledCallbacks) {
      try { callback() } catch {}
    }
    trace.settledCallbacks.clear()
    this.prune()
  }

  append(trace, activity) {
    const record = trace?.record
    if (!record || trace.generation !== record.generation) return undefined
    if (record.activities.length >= TASK_ACTIVITY_LIMIT) {
      if (!record.truncated) {
        record.truncated = true
        this.touch(record)
      }
      return undefined
    }
    const title = activity.title === undefined ? undefined : clipped(activity.title, 512)
    if (title?.truncated) record.truncated = true
    const stored = {
      id: `${trace.generation > 1 ? `${trace.generation}:` : ''}${activity.id ?? `activity:${++record.activitySequence}`}`,
      type: activity.type,
      time: this.timestamp(),
      ...title === undefined ? {} : { title: title.value },
      ...activity.text === undefined ? {} : { text: activity.text },
      ...activity.status === undefined ? {} : { status: activity.status },
    }
    record.activities.push(stored)
    this.touch(record)
    return stored
  }

  updateText(trace, activity, addition, append) {
    const combined = append ? `${activity.text ?? ''}${addition}` : addition
    const previousLength = activity.text?.length ?? 0
    const remaining = Math.max(0, TASK_TOTAL_TEXT_LIMIT - trace.record.totalText + previousLength)
    const result = clipped(combined, Math.min(TASK_TEXT_LIMIT, remaining))
    trace.record.totalText += result.value.length - previousLength
    activity.text = result.value
    if (result.truncated) trace.record.truncated = true
  }

  observeACP(update) {
    const trace = traceStorage.getStore()
    const record = trace?.record
    if (!record || trace.generation !== record.generation || TERMINAL_STATUSES.has(record.status) || update === null || typeof update !== 'object') return
    try {
      if (update.sessionUpdate === 'agent_message_chunk') {
        if (update.content?.type !== 'text' || typeof update.content.text !== 'string' || update.content.text.length === 0) return
        const id = activityId(record, 'message', typeof update.messageId === 'string' ? update.messageId : trace.acpMessageId)
        trace.acpMessageId = id.slice('message:'.length)
        let activity = record.messages.get(id)
        if (!activity) {
          activity = this.append(trace, { id, type: 'message', title: 'Assistant', text: '' })
          if (!activity) return
          record.messages.set(id, activity)
        }
        this.updateText(trace, activity, update.content.text, true)
        this.touch(record)
        return
      }
      if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return
      if (typeof update.toolCallId !== 'string' || update.toolCallId.length === 0) return
      if (update.sessionUpdate === 'tool_call') trace.acpMessageId = undefined
      const id = `tool:${update.toolCallId}`
      let activity = record.tools.get(id)
      if (!activity) {
        activity = this.append(trace, { id, type: 'tool', title: 'Tool call' })
        if (!activity) return
        record.tools.set(id, activity)
      }
      const title = typeof update.title === 'string' && update.title ? update.title
        : typeof update.name === 'string' && update.name ? update.name
          : undefined
      if (title !== undefined) {
        const clippedTitle = clipped(title, 512)
        activity.title = clippedTitle.value
        if (clippedTitle.truncated) record.truncated = true
      }
      if (TOOL_STATUSES.has(update.status)) activity.status = update.status
      const result = acpToolText(update.content)
      if (result !== undefined) this.updateText(trace, activity, result, false)
      this.touch(record)
    } catch {}
  }

  observeCodex(frame) {
    const trace = traceStorage.getStore()
    const record = trace?.record
    if (!record || trace.generation !== record.generation || TERMINAL_STATUSES.has(record.status) || frame === null || typeof frame !== 'object') return
    try {
      const params = frame.params
      const thread = frame.result?.thread
      if (thread !== null && typeof thread === 'object') {
        this.setTelemetry({
          ...typeof thread.model === 'string' && thread.model ? { model: thread.model, modelSource: 'reported' } : {},
          ...typeof thread.reasoningEffort === 'string' && thread.reasoningEffort ? { reasoningEffort: thread.reasoningEffort, reasoningEffortSource: 'reported' } : {},
        }, trace)
        return
      }
      if (params === null || typeof params !== 'object') return
      if (frame.method === 'thread/tokenUsage/updated') {
        const usage = codexUsage(params.tokenUsage?.total)
        if (usage) this.setTelemetry({ usage, usageScope: 'session' }, trace)
        return
      }
      if (frame.method === 'turn/started' || frame.method === 'turn/completed') {
        const turn = params.turn
        if (turn === null || typeof turn !== 'object') return
        const completed = frame.method === 'turn/completed'
        const id = activityId(record, completed ? 'turn-end' : 'turn-start', turn.id)
        if (record.activities.some((activity) => activity.id === `${trace.generation > 1 ? `${trace.generation}:` : ''}${id}`)) return
        this.append(trace, {
          id,
          type: 'status',
          title: completed ? 'Turn completed' : 'Turn started',
          status: completed && typeof turn.status === 'string' ? turn.status : 'running',
        })
        return
      }
      if (frame.method !== 'item/started' && frame.method !== 'item/updated' && frame.method !== 'item/completed') return
      const item = params.item
      if (item === null || typeof item !== 'object') return
      if (item.type === 'agentMessage') {
        if (frame.method !== 'item/completed' || typeof item.text !== 'string' || item.text.length === 0) return
        const phase = typeof item.phase === 'string' ? item.phase : 'answer'
        const id = activityId(record, 'message', typeof item.id === 'string' ? item.id : `${phase}:${++record.activitySequence}`)
        if (record.messages.has(id)) return
        const activity = this.append(trace, { id, type: 'message', title: 'Assistant', text: '' })
        if (!activity) return
        record.messages.set(id, activity)
        this.updateText(trace, activity, item.text, false)
        this.touch(record)
        return
      }
      if (!CODEX_TOOL_TYPES.has(item.type)) return
      const id = activityId(record, 'tool', typeof item.id === 'string' ? item.id : `${item.type}:${++record.activitySequence}`)
      let activity = record.tools.get(id)
      if (!activity) {
        activity = this.append(trace, { id, type: 'tool', title: 'Tool call' })
        if (!activity) return
        record.tools.set(id, activity)
      }
      const title = clipped(codexToolTitle(item), 512)
      activity.title = title.value
      if (title.truncated) record.truncated = true
      if (TOOL_STATUSES.has(item.status)) activity.status = item.status
      const result = codexToolText(item)
      if (result !== undefined) this.updateText(trace, activity, result, false)
      this.touch(record)
    } catch {}
  }

  summary(record) {
    return {
      childId: record.childId,
      parentSessionId: record.parentSessionId,
      agent: record.agent,
      label: record.label,
      cwd: record.cwd,
      reportPath: record.reportPath,
      status: record.status,
      archived: Boolean(record.archived),
      canContinue: !record.nativeAwaitingEnd && !record.trace.admissionPending && (record.agent === 'dsh' || Boolean(record.continuation)),
      ...record.nativeAwaitingEnd ? { continueReason: 'Native task cancellation has not been confirmed; wait for its final outcome before continuing.' }
        : record.trace.admissionPending ? { continueReason: 'Task continuation admission is still pending.' }
        : record.agent !== 'dsh' && !record.continuation ? { continueReason: 'This older task has no saved external session. Its original conversation cannot be resumed.' } : {},
      continuationCount: record.continuationCount || 0,
      activeChildId: record.activeChildId || record.childId,
      ...record.historyRestored ? { historyRestored: true } : {},
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      ...record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt },
      ...record.output === undefined ? {} : { output: clipped(record.output, 600).value },
      ...record.diagnostic === undefined ? {} : { diagnostic: clipped(record.diagnostic, 600).value },
      ...record.truncated ? { truncated: true } : {},
      ...record.telemetry === undefined ? {} : { telemetry: record.telemetry },
    }
  }

  list(parentSessionId) {
    const tasks = [...this.records].filter((record) => typeof record.childId === 'string' && record.parentSessionId === parentSessionId && !record.hidden)
      .map((record) => this.summary(record))
  return { revision: this.revision, tasks, ...(this.storageError ? { storageWarning: this.storageError } : {}) }
}

  detail(parentSessionId, childId) {
    const record = this.getRecord(parentSessionId, childId)
    return record ? {
      ...this.summary(record),
      ...record.output === undefined ? {} : { output: record.output },
      ...record.diagnostic === undefined ? {} : { diagnostic: record.diagnostic },
      activities: record.activities.map(copyActivity),
    } : null
  }

  sendJson(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  async handleHttp(req, res) {
    let admission
    try {
      admission = this.ctx.connection.admit(req)
    } catch {
      admission = undefined
    }
    const refusal = admission && 'rejection' in admission && admission.rejection !== undefined ? admission.rejection
      : admission?.peer?.principal?.kind === 'owner' ? undefined
        : 403
    if (refusal !== undefined) {
      this.sendJson(res, refusal, { ok: false, error: { code: 'forbidden', message: 'Owner access required' } })
      return
    }
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('allow', 'GET, POST')
      this.sendJson(res, 405, { ok: false, error: { code: 'method', message: 'Method not allowed' } })
      return
    }
    try { await this.ready; this.assertStorageAvailable() } catch {
      this.sendJson(res, 503, { ok: false, error: { code: 'storage', message: 'Task history storage is unavailable' } })
      return
    }
    if (req.method === 'POST') {
      // Cookie-bearing mutations require a same-origin JSON fetch; GET remains read-only.
      const origin = req.headers?.origin
      const trustedOrigin = origin === this.ctx.webServer.getOrigin() || origin === 'dsh-app://app'
      if (!trustedOrigin || !String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json') || req.headers?.['sec-fetch-site'] === 'cross-site') {
        this.sendJson(res, 403, { ok: false, error: { code: 'origin', message: 'Same-origin JSON request required' } })
        return
      }
      try {
        let body = ''
        for await (const chunk of req) {
          body += chunk.toString()
          if (body.length > 65536) throw new Error('Request is too large')
        }
        const args = JSON.parse(body)
        if (!args || typeof args.parentSessionId !== 'string' || !args.parentSessionId) throw new Error('parentSessionId is required')
        let value
        if (args.action === 'continue') {
          const agent = findRootAgent(this.ctx, args.parentSessionId)
          if (!agent) throw new Error('Open the parent conversation before continuing this task')
          value = await this.continueTask(agent, { childId: args.childId, message: args.message }, new AbortController().signal)
        } else value = this.manage(args.parentSessionId, args)
        await this.pendingWrites
        this.sendJson(res, 200, { ok: true, value })
      } catch (error) {
        this.sendJson(res, 400, { ok: false, error: { code: 'task-action', message: error instanceof SyntaxError ? 'Invalid JSON request' : error.message } })
      }
      return
    }
    const url = new URL(req.url ?? '/multi-agent/tasks', 'http://localhost')
    const parentSessionId = url.searchParams.get('parentSessionId')
    if (!parentSessionId) {
      this.sendJson(res, 400, { ok: false, error: { code: 'request', message: 'parentSessionId is required' } })
      return
    }
    if (url.searchParams.has('childId')) {
      this.sendJson(res, 200, { ok: true, value: { task: this.detail(parentSessionId, url.searchParams.get('childId')) } })
      return
    }
    this.sendJson(res, 200, { ok: true, value: this.list(parentSessionId) })
  }
}

export default MultiAgentTasks

export function registerAgentTasksTool(ctx, tasks) {
  const definition = {
    name: 'agent_tasks',
    description: 'List or inspect this parent\'s child tasks, archive or restore finished tasks, or clear their panel history. Clearing keeps reports and underlying sessions; running tasks cannot be cleared. Use continue_agent to give a historical task more work.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'detail', 'archive', 'restore', 'clear'] },
        childId: { type: 'string', description: 'Child id required for detail, archive and restore. Omit for clear to clear all archived finished tasks in this parent.' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: (args) => args.action === 'list' || args.action === 'detail',
    async execute(args, exec) {
      if (!isRootAgent(ctx, exec.agent)) throw new Error('agent_tasks is available only from the exact root/main agent')
      await tasks.ready
      tasks.assertStorageAvailable()
      const parentSessionId = exec.agent.session.id
      if (['archive', 'restore', 'clear'].includes(args.action)) {
        const value = tasks.manage(parentSessionId, args)
        await tasks.pendingWrites
        return value
      }
      if (args.action === 'list') return tasks.list(parentSessionId)
      if (args.action === 'detail' && typeof args.childId === 'string' && args.childId) return { task: tasks.detail(parentSessionId, args.childId) }
      throw new Error('agent_tasks detail requires a childId')
    },
  }
  return ctx.effect(() => ctx.tools.register(definition, {
    when: ({ agent }) => isRootAgent(ctx, agent),
  }), 'multi-agent: task query tool')
}
