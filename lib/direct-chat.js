import { randomUUID } from 'node:crypto'
import { validateAgentChoice } from './router-core.js'
import { isModernSubagentRuntime, isRootAgent, startManagedActivation } from './runtime-compat.js'
import { runWithTaskTrace } from '../task-monitor.js'

// Far outside ordinary Session turn numbering, with no turn/start or step/start.
// This prevents the native assistant Definition from merging mirror events into
// an existing root-agent Step; the direct Definition keys rows by message id.
const DIRECT_MIRROR_TURN = 1_000_000_000
const DIRECT_COMMANDS = [
  ['agent-dsh', 'dsh'],
  ['agent-codex', 'codex'],
  ['agent-kimi', 'kimi-code'],
  ['agent-agy', 'agy'],
]

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
      // The Client's direct Conversation Definition claims this source and
      // renders a native assistant row without inventing root-agent Turn/Step
      // boundaries. Message ids, not turn:step, provide row identity.
      session.append('assistant/message', {
        turn: mirror.turn,
        step: 0,
        message: {
          id: randomUUID(), role: 'assistant',
          content: [{ type: 'text', text }],
          source: { kind: 'model', provider: `multi-agent-${record.agent}`, model: record.agent },
        },
        stream: [],
      }, { surfaceOp: 'append' })
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

  function beginMirror(record, content) {
    const session = sessionFor(record)
    if (!session) throw directError('the parent Session is no longer live')
    record.mirror = {
      ready: true,
      turn: DIRECT_MIRROR_TURN,
      nextActivity: 0,
      lastText: '',
      messageCount: 0,
    }
    let userEvent
    try {
      userEvent = session.append('user/message', {
        id: randomUUID(), role: 'user',
        content,
        source: { kind: 'user' },
      }, { surfaceOp: 'append' })
    } catch (error) {
      record.mirror.ready = false
      throw error
    }
    // A fast provider may have published complete messages before activation
    // returned. Replay them after the user's message to preserve chat order.
    flushMessages(record)
    return userEvent.seq
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
            await ctx.subagents.sendMessage(agent, previous.activeChildId || previous.childId, prompt, { signal: startup.signal })
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
        })
        try {
          const agentOptions = selected.id === 'dsh'
            ? await resolveDshModel({}, settings, { agent, signal: startup.signal })
            : undefined
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
    try { userEventSeq = beginMirror(trace.record, content) } catch (error) {
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
            recordInput: false,
            async handler(invocation) {
              const message = invocation.rawInput.trim()
              const content = [
                ...message ? [{ type: 'text', text: message }] : [],
                ...invocation.attachments,
              ]
              if (content.length === 0) return { kind: 'error', text: 'Message or attachment is required.' }
              try {
                const receipt = await send(invocation.agent, {
                  agent: agentId, message, content, signal: invocation.signal,
                })
                if (receipt.warning) return { kind: 'error', text: receipt.warning }
                return {
                  kind: 'success',
                  ...(receipt.userEventSeq === undefined ? {} : { sourceEventSeq: receipt.userEventSeq }),
                }
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
    ctx.effect(() => ctx.on('agent/pre-step', async (payload, next) => {
      if (!isRootAgent(ctx, payload.agent)) return next()
      await waitForDirectIdle(payload.agent.session.id, payload.signal)
      return next()
    }), 'multi-agent direct: root turn serialization')
  }
  return send
}
