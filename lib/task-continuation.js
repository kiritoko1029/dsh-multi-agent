import { composeTaskPrompt } from './router-core.js'
import { runWithTaskTrace } from '../task-monitor.js'
import { isRootAgent, isModernSubagentRuntime, startManagedActivation } from './runtime-compat.js'

const DEFAULT_EXPECTED_OUTPUT = 'Complete the requested improvements and update the existing task report.'

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function continuationError(message) {
  return new Error(`continue_agent: ${message}`)
}

function safeError(error, fallback) {
  if (error instanceof Error && error.message.startsWith('continue_agent:')) return error
  return continuationError(fallback)
}

async function continuationPrompt(resolveTaskLanguage, getSettings, agent, args, trace) {
  const record = trace.record
  const settings = getSettings()
  const language = args.language !== undefined
    ? await resolveTaskLanguage(args, agent.session)
    : nonEmpty(record.language)
      ? { language: record.language.trim() }
      : await resolveTaskLanguage(args, agent.session)
  const taskArgs = {
    task: args.message.trim(),
    expected_output: nonEmpty(args.expected_output) ? args.expected_output.trim() : DEFAULT_EXPECTED_OUTPUT,
    ...language,
    report_path: record.reportPath,
  }
  const prompt = composeTaskPrompt(taskArgs, { label: record.label }, settings)
  return {
    settings,
    taskArgs,
    blocks: [{ type: 'text', text: prompt }],
  }
}

export function registerTaskContinuation(ctx, { tasks, resolveTaskLanguage, getSettings }) {
  const cleanups = new Set()
  async function continueTask(agent, args, signal = new AbortController().signal) {
    if (!isRootAgent(ctx, agent)) throw continuationError('is available only from the exact root/main agent')
    for (const field of ['childId', 'message']) {
      if (!nonEmpty(args?.[field])) throw continuationError(`requires non-empty \`${field}\``)
    }
    if (args.expected_output !== undefined && !nonEmpty(args.expected_output)) {
      throw continuationError('`expected_output` must be non-empty when supplied')
    }

    await tasks.ready
    const continuation = tasks.beginContinuation(agent.session.id, args.childId.trim())
    const { trace, record, accept, rollback: restore } = continuation
    let startup
    let timer
    let cancelNativeDeadline
    let timeoutStopRequested = false
    let stopSettlement
    let started = false
    let activation
    let nativeTarget
    let timedOut = false
    let rolledBack = false
    let removeCallerAbort = () => {}
    const cleanup = () => {
      removeCallerAbort()
      clearTimeout(timer)
      cancelNativeDeadline?.()
      stopSettlement?.()
      stopSettlement = undefined
      cleanups.delete(cleanup)
    }
    const settle = (result) => {
      tasks.settle(trace, result)
      cleanup()
    }
    const rollback = (error, fallback) => {
      if (started) return
      if (rolledBack) throw error
      rolledBack = true
      try {
        restore()
      } finally {
        cleanup()
      }
      throw safeError(error, fallback)
    }
    const disposeExpired = () => {
      if (!started) {
        startup?.abort(continuationError('continuation startup timed out'))
        return
      }
      if (timeoutStopRequested) return
      timeoutStopRequested = true
      if (record.agent === 'dsh') {
        try {
          ctx.subagents.interrupt(nativeTarget, { kind: 'ancestor', agent })
        } catch (error) {
          ctx.logger?.warn?.(`multi-agent-router: continuation interrupt failed: ${error instanceof Error ? error.message : 'unknown error'}`)
        }
      } else if (activation) {
        activation.dispose().catch((error) => {
          ctx.logger?.warn?.(`multi-agent-router: continuation disposal failed: ${error instanceof Error ? error.message : 'unknown error'}`)
        })
      } else {
        startup.abort(continuationError('continuation startup timed out'))
      }
    }

    try {
      const prepared = await continuationPrompt(resolveTaskLanguage, getSettings, agent, args, trace)
      signal.throwIfAborted()
      startup = new AbortController()
      cleanups.add(cleanup)
      const onAbort = () => startup.abort(signal.reason)
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
      removeCallerAbort = () => signal.removeEventListener('abort', onAbort)
      const deadlineAt = Date.now() + prepared.settings.timeoutSeconds * 1000
      timer = setTimeout(() => {
        timedOut = true
        disposeExpired()
      }, prepared.settings.timeoutSeconds * 1000)
      timer.unref?.()
      stopSettlement = tasks.onSettlement(trace, () => {
        // A residency may end before input admission rejects. Keep its startup
        // deadline until the send/start call has actually returned a receipt.
        if (started) cleanup()
      })

      if (record.agent === 'dsh') {
        nativeTarget = record.activeChildId || record.childId
        const messageId = await ctx.subagents.sendMessage(agent, nativeTarget, prepared.blocks, { signal: startup.signal })
        started = true
        accept()
        removeCallerAbort()
        stopSettlement?.()
        stopSettlement = tasks.onSettlement(trace, cleanup)
        if (isModernSubagentRuntime(ctx)) {
          // Only admitted work awaits an epoch end. Startup rejection must still
          // roll back to the previous terminal task, without a synthetic timeout.
          clearTimeout(timer)
          cancelNativeDeadline = tasks.armNativeDeadline(trace, Math.max(1, deadlineAt - Date.now()), () => {
            timedOut = true
            disposeExpired()
          })
        }
        if (timedOut) disposeExpired()
        return {
          kind: 'continuation',
          childId: record.childId,
          subagentId: nativeTarget,
          messageId,
          reusedSession: true,
          agent: record.agent,
          reportPath: record.reportPath,
        }
      }

      if (!trace.resume?.sessionId) {
        rollback(undefined, 'the original external session cannot be resumed')
      }
      if (!ctx.subagents.getProvider(record.providerName)) {
        rollback(undefined, 'the original agent provider is unavailable')
      }
      activation = await runWithTaskTrace(trace, () => startManagedActivation(ctx, {
        provider: record.providerName,
        label: record.label,
        prompt: prepared.blocks,
        parent: agent,
        cwd: record.cwd,
        signal: startup.signal,
        delivery: 'parent',
      }))
      started = true
      accept()
      removeCallerAbort()
      tasks.bindContinuation(trace, activation.childId)
      if (timedOut) disposeExpired()
      activation.result.then((result) => {
        settle(result)
      }, () => {
        settle({ status: 'error', diagnostic: 'Subagent continuation failed before a result was available.' })
      })
      return {
        kind: 'continuation',
        childId: record.childId,
        subagentId: activation.childId,
        ...(activation.messageId === undefined ? {} : { messageId: activation.messageId }),
        reusedSession: true,
        agent: record.agent,
        reportPath: record.reportPath,
      }
    } catch (error) {
      if (started) {
        // Once admitted, the task service/native monitor owns settlement. An
        // attachment or cleanup failure must not roll back live native work.
        throw safeError(error, 'continuation was accepted but its result could not be attached')
      }
      if (timedOut) return rollback(error, 'continuation timed out; the previous terminal task was restored')
      return rollback(error, 'failed to resume the existing session; no new session was dispatched')
    }
  }

  const definition = {
    name: 'continue_agent',
    description: 'Continue an existing completed or stopped direct child session with a follow-up message. Reuses the original session and task identity; never dispatches a replacement session. Only continuable DSH children and external children with saved resume data are supported.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        childId: { type: 'string', minLength: 1, description: 'Logical child id returned by the original dispatch or an earlier continuation.' },
        message: { type: 'string', minLength: 1, description: 'Follow-up objective for the existing child session.' },
        expected_output: { type: 'string', minLength: 1, description: 'Optional required result. Defaults to completing improvements and updating the existing report.' },
        language: { type: 'string', minLength: 1, maxLength: 80, description: 'Optional continuation language; otherwise inherits the saved task language, then the parent language cue.' },
      },
      required: ['childId', 'message'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'continuation' },
          childId: { type: 'string' },
          subagentId: { type: 'string' },
          messageId: { type: 'string' },
          reusedSession: { type: 'boolean', const: true },
          agent: { type: 'string', enum: ['dsh', 'codex', 'kimi-code', 'agy'] },
          reportPath: { type: 'string' },
        },
        required: ['kind', 'childId', 'subagentId', 'reusedSession', 'agent', 'reportPath'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已续接 ${value.agent} 会话 ${value.childId}（实际子代理 ${value.subagentId}）\n报告路径：${value.reportPath}`,
      }],
    },
    isConcurrencySafe: () => true,
    execute(args, exec) {
      if (!exec.agent) throw continuationError('requires a calling agent')
      return continueTask(exec.agent, args, exec.signal)
    },
  }

  ctx.effect(() => tasks.registerContinuationHandler(continueTask), 'multi-agent: continuation handler')
  ctx.effect(() => ctx.tools.register(definition, {
    when: ({ agent }) => isRootAgent(ctx, agent),
  }), 'multi-agent: continuation tool')
  return continueTask
}
