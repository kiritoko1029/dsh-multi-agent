import { agentConfigs, askAgent, composeTaskPrompt, validateAgentChoice } from './router-core.js'
import { runWithTaskTrace } from '../task-monitor.js'
import { isRootAgent, isModernSubagentRuntime, startManagedActivation } from './runtime-compat.js'

const DEFAULT_EXPECTED_OUTPUT = 'Complete the requested improvements and update the existing task report.'
const REUSE_SESSION = '复用旧会话（推荐）'
const NEW_SESSION = '新建会话'

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

function reuseProblem(ctx, record, agent) {
  if (agent?.id !== record.agent) return '仅原任务的 Agent 可以复用旧会话。'
  if (!nonEmpty(record.providerName) || agent.providerName !== record.providerName || !ctx.subagents.getProvider(record.providerName)) return '原任务的 Provider 不可用或与当前配置不匹配。'
  if (record.agent !== 'dsh' && (record.continuation?.agent !== record.agent || !nonEmpty(record.continuation.sessionId))) return '原任务没有可兼容的外部会话标识。'
}

function terminalSource(tasks, parentId, childId) {
  tasks.assertStorageAvailable()
  const record = tasks.getRecord(parentId, childId)
  if (!record) throw continuationError('task does not belong to this parent or its retained history is unavailable')
  if (record.nativeAwaitingEnd || record.trace.admissionPending || !['completed', 'aborted', 'error', 'max-tokens', 'refusal', 'interrupted'].includes(record.status)) {
    throw continuationError('wait for the original task to settle before continuing')
  }
  return record
}

async function continuationPrompt(resolveTaskLanguage, settings, agent, args, trace) {
  const record = trace.record
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
  return [{ type: 'text', text: prompt }]
}

export function registerTaskContinuation(ctx, { tasks, resolveTaskLanguage, getSettings, dispatchSelected, dispatchOutput }) {
  const cleanups = new Set()
  async function continueTask(agent, args, signal = new AbortController().signal, callId) {
    if (!isRootAgent(ctx, agent)) throw continuationError('is available only from the exact root/main agent')
    for (const field of ['childId', 'message']) {
      if (!nonEmpty(args?.[field])) throw continuationError(`requires non-empty \`${field}\``)
    }
    if (args.expected_output !== undefined && !nonEmpty(args.expected_output)) {
      throw continuationError('`expected_output` must be non-empty when supplied')
    }

    await tasks.ready
    const childId = args.childId.trim()
    const settings = getSettings()
    let confirmedProvider
    if (settings.selectionMode === 'always-ask') {
      signal.throwIfAborted()
      const source = terminalSource(tasks, agent.session.id, childId)
      const generation = source.generation
      const original = agentConfigs(settings).find((candidate) => candidate.id === source.agent)
      const unavailable = reuseProblem(ctx, source, original)
      const exec = { agent, signal, callId }
      const choice = await askAgent(ctx, settings, original, source.label, exec, [{
        id: 'continue-session', header: '会话', question: '本次继续指挥要使用哪个会话？',
        options: [
          ...(unavailable ? [] : [{ label: REUSE_SESSION, description: '仅限原 Agent 和 Provider；沿用原任务的对话和报告。' }]),
          { label: NEW_SESSION, description: '以所选 Agent 独立派发任务，生成新报告，不继承原会话。' },
        ],
        detail: unavailable ? `${unavailable} 请选择新建会话。` : '如需更换 Agent，请选择新建会话。',
      }], `原任务 Agent：${original?.label ?? source.agent}。本次指令：${args.message.trim()}`)
      signal.throwIfAborted()
      const session = choice?.answer?.answers?.find((item) => item.id === 'continue-session')?.selected?.[0]
      if (!choice || !session) return { kind: 'cancelled', reason: '未完成 Agent 和会话选择，未启动任务。' }
      if (!isRootAgent(ctx, agent)) throw continuationError('the original root agent is no longer active; reopen the parent conversation')
      if (terminalSource(tasks, agent.session.id, childId) !== source || source.generation !== generation) throw continuationError('the original task changed while awaiting your selection; retry')
      const selected = validateAgentChoice(getSettings(), choice.agent.id)
      if (session === NEW_SESSION) {
        return dispatchSelected({
          description: source.label, task: args.message.trim(), cwd: source.cwd,
          language: args.language ?? source.language,
          expected_output: args.expected_output ?? 'Complete the follow-up objective and write the result to the new task report.',
          context: source.reportPath ? `Prior task report (for reference): ${source.reportPath}` : undefined,
        }, exec, { agent: selected, route: 'user' })
      }
      if (session !== REUSE_SESSION) throw continuationError('请选择复用旧会话或新建会话后重试。')
      const problem = unavailable || reuseProblem(ctx, source, selected)
      if (problem) throw continuationError(`${problem} 请选择新建会话后重试。`)
      confirmedProvider = ctx.subagents.getProvider(source.providerName)
    }
    const continuation = tasks.beginContinuation(agent.session.id, childId)
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
      const blocks = await continuationPrompt(resolveTaskLanguage, settings, agent, args, trace)
      signal.throwIfAborted()
      if (confirmedProvider && ctx.subagents.getProvider(record.providerName) !== confirmedProvider) {
        throw continuationError('原任务的 Provider 已变更，请重新选择 Agent 和会话。')
      }
      startup = new AbortController()
      cleanups.add(cleanup)
      const onAbort = () => startup.abort(signal.reason)
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
      removeCallerAbort = () => signal.removeEventListener('abort', onAbort)
      const deadlineAt = Date.now() + settings.timeoutSeconds * 1000
      timer = setTimeout(() => {
        timedOut = true
        disposeExpired()
      }, settings.timeoutSeconds * 1000)
      timer.unref?.()
      stopSettlement = tasks.onSettlement(trace, () => {
        // A residency may end before input admission rejects. Keep its startup
        // deadline until the send/start call has actually returned a receipt.
        if (started) cleanup()
      })

      if (record.agent === 'dsh') {
        nativeTarget = record.activeChildId || record.childId
        const messageId = await ctx.subagents.sendMessage(agent, nativeTarget, blocks, { signal: startup.signal })
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
        prompt: blocks,
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
      return rollback(error, 'failed to resume the existing session; no new session was dispatched. Choose a new session or use dispatch_agent to start independently.')
    }
  }

  const definition = {
    name: 'continue_agent',
    description: 'Follow up on a completed or stopped direct child. Reusing a session keeps the original task identity and requires a compatible DSH child or saved external session. In always-ask mode the user chooses the agent and may explicitly dispatch a new independent task instead.',
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
        oneOf: [{
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
        }, ...dispatchOutput.schema.oneOf],
      },
      render: (args, value) => value.kind !== 'continuation' ? dispatchOutput.render(args, value) : [{
        type: 'text',
        text: `已续接 ${value.agent} 会话 ${value.childId}（实际子代理 ${value.subagentId}）\n报告路径：${value.reportPath}`,
      }],
    },
    isConcurrencySafe: () => true,
    execute(args, exec) {
      if (!exec.agent) throw continuationError('requires a calling agent')
      return continueTask(exec.agent, args, exec.signal, exec.callId)
    },
  }

  ctx.effect(() => tasks.registerContinuationHandler(async (agent, args, signal) => {
    const result = await continueTask(agent, args, signal)
    if (result.kind === 'cancelled') throw continuationError(result.reason)
    return result
  }), 'multi-agent: continuation handler')
  ctx.effect(() => ctx.tools.register(definition, {
    when: ({ agent }) => isRootAgent(ctx, agent),
  }), 'multi-agent: continuation tool')
  return continueTask
}
