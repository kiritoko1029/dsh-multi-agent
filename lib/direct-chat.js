import { randomUUID } from 'node:crypto'
import { validateAgentChoice } from './router-core.js'
import { isModernSubagentRuntime, isRootAgent, startManagedActivation } from './runtime-compat.js'
import { runWithTaskTrace, currentTaskTrace } from '../task-monitor.js'

// Mirrored child text travels as synthetic log-only command lifecycle pairs
// (`command/run` + `command/done`). Unlike a surface `assistant/message`, a
// command pair needs no open turn/step, passes stored-log validation after a
// restart, stays out of the parent model's request surface, and is ignored by
// turn/outline/stats projections. The Client's direct Conversation definitions
// claim these pairs by commandId prefix; rows still key by message identity.
const DIRECT_MIRROR_MSG_PREFIX = 'ma-direct-msg-'
const DIRECT_MIRROR_USER_PREFIX = 'ma-direct-user-'
const DIRECT_COMMANDS = [
  ['agent-dsh', 'dsh'],
  ['agent-codex', 'codex'],
  ['agent-kimi', 'kimi-code'],
  ['agent-agy', 'agy'],
]
const DIRECT_COMMAND_NAMES = new Map(DIRECT_COMMANDS.map(([commandName, agentId]) => [agentId, commandName]))

function directError(message) {
  return new Error(`direct agent: ${message}`)
}

function outputText(output) {
  if (typeof output === 'string') return output
  if (!Array.isArray(output)) return ''
  return output.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text).join('\n')
}

function labelFor(message) {
  const singleLine = message.trim().replace(/\s+/g, ' ')
  return singleLine.length <= 80 ? singleLine : `${singleLine.slice(0, 79)}…`
}

function abortError() {
  return new Error('The operation was aborted')
}

/**
 * Browser-authored, direct child conversations. Unlike dispatch_agent this path
 * sends the user's text unchanged, uses caller delivery, and mirrors public
 * child messages into the parent Session instead of waking the parent model.
 */
export function registerDirectChat(ctx, { tasks, getSettings, resolveDshModel }) {
  function sessionFor(record) {
    const agent = ctx.agents.get(record.parentSessionId)
    return agent?.session?.id === record.parentSessionId ? agent.session : undefined
  }

  function noteMirrorFailure(record, error) {
    const message = error instanceof Error ? error.message : String(error)
    if (record.mirror) record.mirror.ready = false
    record.mirrorError = `The child was accepted, but its conversation mirror failed: ${message}`
    tasks.touch(record)
    ctx.logger?.warn?.(`multi-agent direct mirror failed: ${message}`)
  }

  function appendAssistant(record, text) {
    const mirror = record.mirror
    const session = sessionFor(record)
    if (!mirror?.ready || !text) return
    if (!session) {
      noteMirrorFailure(record, directError('the parent Session is no longer live'))
      return
    }
    try {
      // The Client's direct Conversation Definition claims this pair and
      // renders a native assistant row from `command/done.text`. The synthetic
      // commandId prefix is the claim key; the pair never enters the model
      // surface and survives stored-log replay validation.
      const commandId = `${DIRECT_MIRROR_MSG_PREFIX}${record.agent}--${randomUUID()}`
      session.append('command/run', { commandId, name: mirror.commandName, source: { kind: 'user' } })
      session.append('command/done', { commandId, kind: 'success', text })
      mirror.lastText = text
      mirror.messageCount = (mirror.messageCount || 0) + 1
    } catch (error) {
      noteMirrorFailure(record, error)
    }
  }

  // Activities are append-only. Flush a message when the next activity starts
  // or when the run settles, so ACP token chunks become one native Chat message
  // rather than a series of duplicates.
  function flushMessages(record, end = record.activities.length) {
    const mirror = record.mirror
    if (!mirror?.ready) return
    for (let index = mirror.nextActivity ?? 0; index < end; index += 1) {
      const activity = record.activities[index]
      if (activity?.type === 'message' && activity.text) appendAssistant(record, activity.text)
    }
    mirror.nextActivity = Math.max(mirror.nextActivity ?? 0, end)
  }

  const mirror = {
    reset(record) {
      if (record.direct) {
        delete record.mirror
        delete record.mirrorError
      }
    },
    activity(record) {
      if (record.direct) flushMessages(record, Math.max(0, record.activities.length - 1))
    },
    settle(record, result) {
      if (!record.direct) return
      flushMessages(record)
      const finalText = outputText(result?.output ?? record.output)
      if (finalText && !record.mirror?.messageCount) appendAssistant(record, finalText)
      if (!finalText && record.diagnostic) appendAssistant(record, `**${record.label}**\n\n${record.diagnostic}`)
    },
  }

  function beginMirror(record, content, { viaCommand = false } = {}) {
    const session = sessionFor(record)
    if (!session) throw directError('the parent Session is no longer live')
    record.mirror = {
      ready: true,
      commandName: DIRECT_COMMAND_NAMES.get(record.agent) ?? 'agent-dsh',
      nextActivity: 0,
      lastText: '',
      messageCount: 0,
    }
    let userEventSeq
    if (!viaCommand) {
      // Panel-initiated sends (task continue) have no native command/run
      // anchor. Append a legal synthetic user-side pair so the conversation
      // still renders the user's line; composer sends reuse their own run.
      const text = outputText(content).trim()
      try {
        const commandId = `${DIRECT_MIRROR_USER_PREFIX}${record.agent}--${randomUUID()}`
        session.append('command/run', {
          commandId, name: record.mirror.commandName,
          ...(text ? { args: text } : {}), source: { kind: 'user' },
        })
        userEventSeq = session.append('command/done', { commandId, kind: 'success' }).seq
      } catch (error) {
        record.mirror.ready = false
        throw error
      }
    }
    // A fast provider may have published complete messages before activation
    // returned. Replay them after the user's message to preserve chat order.
    flushMessages(record)
    return userEventSeq
  }

  function watch(trace, activation, timeoutMs) {
    let timer
    let cancelNative
    const clear = () => {
      clearTimeout(timer)
      cancelNative?.()
    }
    const off = tasks.onSettlement(trace, clear)
    const cleanup = () => { off(); clear() }
    trace.settledCallbacks.add(cleanup)
    if (activation) {
      timer = setTimeout(() => {
        activation.dispose().catch(() => {})
        tasks.settle(trace, { stopReason: 'aborted', diagnostic: 'Direct agent response timed out.' })
      }, timeoutMs)
      timer.unref?.()
      activation.result.then((result) => tasks.settle(trace, result), () => {
        tasks.settle(trace, { stopReason: 'error', diagnostic: 'The direct Agent activation failed before producing a result.' })
      })
    } else if (isModernSubagentRuntime(ctx)) {
      cancelNative = tasks.armNativeDeadline(trace, timeoutMs, () => {
        const record = trace.record
        ctx.subagents.interrupt(record.activeChildId || record.childId, { kind: 'user' })
      })
    }
  }

  function resolveDirectSandboxMode(agent, settings) {
    const selected = settings.dsh.directSandboxMode ?? 'default'
    if (selected !== 'default') return selected
    return agent.ctx?.get('sandboxPolicy')?.resolve({ session: agent.session })?.mode ?? 'default'
  }

  async function resolveDirectDshModel(agent, settings, signal) {
    const current = agent.model?.current?.() ?? agent.session.requestHeader()?.config ?? agent.options
    const explicit = settings.dsh.defaultProvider !== undefined || settings.dsh.defaultModel !== undefined || settings.dsh.defaultReasoningEffort !== undefined
    if (!explicit) return current?.provider && current?.model ? { ...current } : undefined
    const resolved = await resolveDshModel({}, settings, { agent, signal })
    const effective = {
      ...resolved,
      provider: settings.dsh.defaultProvider ?? current?.provider ?? resolved?.provider,
      model: settings.dsh.defaultModel ?? current?.model ?? resolved?.model,
      reasoningEffort: resolved?.reasoningEffort ?? current?.reasoningEffort,
    }
    if (effective.reasoningEffort === undefined) delete effective.reasoningEffort
    return effective.provider && effective.model ? effective : undefined
  }

  function applyDshOptions(child, record) {
    if (record.directModel) {
      child.model?.select?.(record.directModel)
      const current = child.model?.current?.()
      if (!current || current.provider !== record.directModel.provider || current.model !== record.directModel.model
        || (record.directModel.reasoningEffort !== undefined && current.reasoningEffort !== record.directModel.reasoningEffort)) {
        throw directError('the selected DSH child model could not be verified')
      }
    }
    if (record.directSandboxMode && record.directSandboxMode !== 'default') {
      const sandbox = child.ctx.get('sandboxPolicy')
      const before = sandbox?.resolve({ session: child.session })?.mode
      if (before !== record.directSandboxMode) child.session.append('sandbox/mode', { mode: record.directSandboxMode, source: 'delegation' })
      const current = sandbox?.resolve({ session: child.session })?.mode
      if (current !== record.directSandboxMode) throw directError('the selected DSH child sandbox could not be verified')
    }
  }

  async function waitForDirectIdle(parentSessionId, signal) {
    while (tasks.directStatus(parentSessionId).active) {
      signal?.throwIfAborted()
      await new Promise((resolve, reject) => {
        const finish = (callback, value) => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          callback(value)
        }
        const timer = setTimeout(() => finish(resolve), 200)
        const abort = () => finish(reject, signal?.reason ?? abortError())
        if (signal?.aborted) abort()
        else signal?.addEventListener('abort', abort, { once: true })
      })
    }
  }

  async function send(agent, args) {
    if (!isRootAgent(ctx, agent)) throw directError('only the exact live root Agent can start a direct conversation')
    if (agent.status === 'running') throw directError('wait for the main Agent turn before starting a direct conversation')
    const message = typeof args?.message === 'string' ? args.message.trim() : ''
    const content = Array.isArray(args?.content)
      ? args.content
      : message ? [{ type: 'text', text: message }] : []
    if (content.length === 0) throw directError('message or attachment is required')
    const settings = getSettings()
    const selected = validateAgentChoice(settings, args?.agent)
    if (!selected) throw directError('agent is required')
    const provider = ctx.subagents.getProvider(selected.providerName)
    if (!provider) throw directError(`${selected.label} is unavailable; enable or configure its Provider first`)
    await tasks.ready
    await tasks.pendingWrites
    tasks.assertStorageAvailable()
    if (agent.status === 'running') throw directError('wait for the main Agent turn before starting a direct conversation')
    const parentSessionId = agent.session.id
    if (tasks.directStatus(parentSessionId).active) {
      throw directError('wait for the current direct Agent response before sending another message')
    }
    const directRecords = [...tasks.records].filter((record) => record.direct && record.parentSessionId === parentSessionId)
    const previous = directRecords.filter((record) => record.agent === selected.id && record.childId)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    const canContinue = previous && !previous.nativeAwaitingEnd
      && (selected.id === 'dsh' || Boolean(previous.continuation))
    const cwd = ctx.workingDirectory.get(agent.session)
    const label = labelFor(message || content.find((block) => block?.attachment?.name)?.attachment.name || 'Attachment')
    const prompt = content
    const startup = new AbortController()
    const sourceSignal = args?.signal
    const abortStartup = () => startup.abort(sourceSignal?.reason ?? abortError())
    if (sourceSignal?.aborted) abortStartup()
    else sourceSignal?.addEventListener('abort', abortStartup, { once: true })
    const deadlineAt = Date.now() + settings.timeoutSeconds * 1000
    let trace
    let activation
    let continued = false
    let accepted = false
    let timedOut = false
    const startupTimer = setTimeout(() => {
      timedOut = true
      startup.abort(directError('startup timed out'))
      if (activation) {
        activation.dispose().catch(() => {})
        if (trace) tasks.settle(trace, { stopReason: 'aborted', diagnostic: 'Direct Agent startup timed out.' })
      }
    }, settings.timeoutSeconds * 1000)

    try {
      if (canContinue) {
        continued = true
        const continuation = tasks.beginContinuation(parentSessionId, previous.childId)
        trace = continuation.trace
        try {
          if (selected.id === 'dsh') {
            const targetId = previous.activeChildId || previous.childId
            previous.directModel = await resolveDirectDshModel(agent, settings, startup.signal)
            previous.directSandboxMode = resolveDirectSandboxMode(agent, settings)
            const child = ctx.agents.get(targetId)
            if (child) applyDshOptions(child, previous)
            await runWithTaskTrace(trace, () => ctx.subagents.sendMessage(agent, targetId, prompt, { signal: startup.signal }))
            continuation.accept()
            accepted = true
          } else {
            activation = await runWithTaskTrace(trace, () => startManagedActivation(ctx, {
              provider: previous.providerName,
              label: previous.label,
              prompt,
              parent: agent,
              cwd: previous.cwd,
              signal: startup.signal,
              delivery: 'caller',
            }))
            tasks.bindContinuation(trace, activation.childId)
            accepted = true
          }
        } catch (error) {
          if (!accepted) continuation.rollback()
          throw error
        }
      } else {
        trace = tasks.begin({
          parentSessionId,
          agent: selected.id,
          providerName: selected.providerName,
          label,
          cwd,
          direct: true,
          directSandboxMode: selected.id === 'dsh' ? resolveDirectSandboxMode(agent, settings) : undefined,
        })
        try {
          const agentOptions = selected.id === 'dsh'
            ? await resolveDirectDshModel(agent, settings, startup.signal)
            : undefined
          if (selected.id === 'dsh') trace.record.directModel = agentOptions
          activation = await runWithTaskTrace(trace, () => startManagedActivation(ctx, {
            provider: selected.providerName,
            label,
            prompt,
            parent: agent,
            cwd,
            signal: startup.signal,
            delivery: 'caller',
            ...(agentOptions === undefined ? {} : { agentOptions }),
            ...(selected.id === 'dsh' ? { maxDepth: ctx.subagents.resolveMaxDepth(undefined) } : {}),
          }))
          tasks.bind(trace, activation.childId)
          accepted = true
        } catch (error) {
          tasks.settle(trace, { stopReason: timedOut ? 'aborted' : 'error', diagnostic: timedOut ? 'Direct Agent startup timed out.' : 'The direct Agent could not be started.' })
          throw error
        }
      }
    } catch (error) {
      if (timedOut && !accepted) throw directError('startup timed out; no direct conversation was admitted')
      throw error
    } finally {
      clearTimeout(startupTimer)
      sourceSignal?.removeEventListener('abort', abortStartup)
    }

    // Admission succeeded. Never roll back the child because of a display
    // failure; return an explicit warning and retain the draft in the Client.
    let warning
    let userEventSeq
    try { userEventSeq = beginMirror(trace.record, content, { viaCommand: args?.commandOrigin === true }) } catch (error) {
      noteMirrorFailure(trace.record, error)
      warning = trace.record.mirrorError
    }
    watch(trace, activation, Math.max(1, deadlineAt - Date.now()))
    return {
      accepted: true,
      mirrored: !warning,
      ...(userEventSeq === undefined ? {} : { userEventSeq }),
      ...(warning ? { warning } : {}),
      agent: selected.id,
      childId: trace.record.childId,
      subagentId: trace.record.activeChildId || trace.record.childId,
      continued,
      status: trace.record.status,
    }
  }

  ctx.effect(() => tasks.setDirectMirror(mirror), 'multi-agent: direct chat mirror')
  ctx.effect(() => tasks.registerDirectHandler(send), 'multi-agent: direct chat handler')
  if (ctx.commands?.register) {
    ctx.effect(() => {
      const disposers = []
      try {
        for (const [commandName, agentId] of DIRECT_COMMANDS) {
          disposers.push(ctx.commands.register({
            definitionId: `multi-agent-direct-${agentId}`,
            name: commandName,
            description: `Send the native composer message directly to ${agentId}`,
            input: { hint: `Message and attachments sent directly to ${agentId}`, attachments: true },
            // The durable command/run args are the user-bubble text source.
            recordInput: true,
            async handler(invocation) {
              const message = invocation.rawInput.trim()
              const content = [
                ...message ? [{ type: 'text', text: message }] : [],
                ...invocation.attachments,
              ]
              if (content.length === 0) return { kind: 'error', text: 'Message or attachment is required.' }
              try {
                const receipt = await send(invocation.agent, {
                  agent: agentId, message, content, signal: invocation.signal, commandOrigin: true,
                })
                if (receipt.warning) return { kind: 'error', text: receipt.warning }
                return { kind: 'success' }
              } catch (error) {
                const text = error instanceof Error && error.message.startsWith('direct agent:')
                  ? error.message
                  : 'direct agent: the Agent could not be started; see Agent tasks for details'
                return { kind: 'error', text }
              }
            },
          }))
        }
      } catch (error) {
        for (const dispose of disposers.reverse()) dispose()
        throw error
      }
      return () => { for (const dispose of disposers.reverse()) dispose() }
    }, 'multi-agent direct: native composer commands')
  }
  if (typeof ctx.on === 'function') {
    ctx.effect(() => ctx.on('agent/created', ({ agent: child }) => {
      const contextual = currentTaskTrace()
      const record = contextual?.record?.direct && contextual.record.agent === 'dsh' ? contextual.record
        : [...tasks.records].find((candidate) => candidate.direct && candidate.agent === 'dsh' && (candidate.activeChildId || candidate.childId) === child.id)
      if (!record || child.session.header?.origin !== 'subagent' || child.session.header?.parentSession !== record.parentSessionId) return
      // agent/created is serial: a failed model/sandbox update rejects creation
      // before the first prompt instead of running with stale permissions.
      applyDshOptions(child, record)
    }), 'multi-agent direct: verified DSH child options')
    ctx.effect(() => ctx.on('agent/pre-step', async (payload, next) => {
      if (!isRootAgent(ctx, payload.agent)) return next()
      await waitForDirectIdle(payload.agent.session.id, payload.signal)
      return next()
    }), 'multi-agent direct: root turn serialization')
  }
  return send
}
