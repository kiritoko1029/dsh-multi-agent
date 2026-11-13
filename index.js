import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { agentConfigs, answerAgent, composeTaskPrompt, routingGuidance, validateAgentChoice } from './lib/router-core.js'
import { currentRouterConfig } from './lib/config.js'
import { resolveReportPath } from './lib/reports.js'
import { createDshModelResolver } from './lib/dsh-model.js'
import { createTaskLanguageResolver } from './lib/task-language.js'
import { registerTaskContinuation } from './lib/task-continuation.js'
import { isRootAgent, isModernSubagentRuntime, startManagedActivation } from './lib/runtime-compat.js'
import { registerAgentTasksTool, runWithTaskTrace } from './task-monitor.js'

export const name = 'multi-agent-router'
export const inject = ['tools', 'subagents', 'systemPrompt', 'userQuestions', 'agents', 'workingDirectory', 'sessionProjections', 'llm', 'multiAgentTasks']

const AgentId = z.union(['codex', 'kimi-code', 'agy', 'dsh'])
const AgentConfig = (providerName, label, description) => z.object({
  enabled: z.boolean().default(true),
  providerName: z.string().min(1).default(providerName),
  label: z.string().min(1).default(label),
  description: z.string().min(1).default(description),
})

export const Config = z.object({
  selectionMode: z.union(['auto', 'ask-if-ambiguous', 'always-ask']).default('auto').volatile(),
  defaultAgent: AgentId.volatile(),
  codex: AgentConfig('codex-router', 'Codex', 'Native Codex coding and reasoning agent.').default({}),
  kimiCode: AgentConfig('kimi-code', 'Kimi Code', 'Native Kimi Code coding and analysis agent.').default({}),
  agy: AgentConfig('agy', 'Google Antigravity', 'Google Antigravity (agy) coding and analysis agent with selectable ACP models and thinking levels.').default({}),
  dsh: z.object({
    enabled: z.boolean().default(true),
    providerName: z.string().min(1).default('spawn'),
    label: z.string().min(1).default('DSH'),
    description: z.string().min(1).default('In-process DSH subagent with selectable models and native tools.'),
    defaultProvider: z.string().min(1).volatile(),
    defaultModel: z.string().min(1).volatile(),
    defaultReasoningEffort: z.string().min(1).volatile(),
  }).default({}),
  routes: z.array(z.object({
    agent: AgentId,
    prompt: z.string().min(1),
  })).default([
    { agent: 'codex', prompt: '代码实现、调试、重构、测试修复、算法与架构分析，以及需要较强推理的技术任务。' },
    { agent: 'kimi-code', prompt: '前端/UI 实现、代码阅读与资料整理、中文文档，以及主 Agent 判断更适合 Kimi Code 的任务。' },
    { agent: 'agy', prompt: 'Google/Gemini 生态、Android 与跨平台项目，以及主 Agent 判断更适合 Google Antigravity 的编码、调试或分析任务。' },
    { agent: 'dsh', prompt: '需要沿用 DSH 原生工具生态、选择指定模型，或需要子代理后续消息与续接能力的独立任务。' },
  ]).volatile(),
  additionalInstructions: z.string().volatile(),
  taskPreamble: z.string().volatile(),
  timeoutSeconds: z.number().step(1).min(1).max(86400).default(1800).volatile(),
})

const output = {
  schema: {
    oneOf: [
      {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'activation' },
          subagentId: { type: 'string' },
          agent: { type: 'string' },
          route: { type: 'string', enum: ['model', 'user', 'default', 'fallback'] },
          reportPath: { type: 'string' },
          routeReason: { type: 'string' },
          timeoutSeconds: { type: 'integer', description: 'Deadline for this activation; does not promise cancellation of descendants.' },
          provider: { type: 'string' },
          model: { type: 'string' },
          reasoningEffort: { type: 'string' },
        },
        required: ['kind', 'subagentId', 'agent', 'route', 'reportPath'],
      },
      {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'cancelled' },
          reason: { type: 'string' },
        },
        required: ['kind', 'reason'],
      },
    ],
  },
  render: (_args, value) => [{
    type: 'text',
    text: value.kind === 'activation'
      ? `started ${value.agent} subagent ${value.subagentId}\nReport path: ${value.reportPath}`
      : `dispatch cancelled: ${value.reason}`,
  }],
}

async function chooseAgent(ctx, config, args, exec) {
  const recommended = validateAgentChoice(config, args.agent)
  if (config.selectionMode === 'auto') {
    if (recommended) return { agent: recommended, route: 'model' }
    const fallback = validateAgentChoice(config, config.defaultAgent)
    if (fallback) return { agent: fallback, route: 'default' }
    throw new Error('No agent was selected. Choose `agent` using the configured routing rules, configure `defaultAgent`, or use an ask selection mode.')
  }
  if (recommended && config.selectionMode === 'ask-if-ambiguous') return { agent: recommended, route: 'model' }
  const agents = agentConfigs(config)
  if (agents.length === 0) throw new Error('No external agents are enabled')
  const options = agents.map((agent) => ({
    ...agent,
    baseLabel: agent.label,
    label: recommended?.id === agent.id ? `${agent.label} (Recommended)` : agent.label,
    description: recommended?.id === agent.id ? `Recommended by the parent. ${agent.description}` : agent.description,
  }))
  if (new Set(options.map((option) => option.label)).size !== options.length) throw new Error('Agent option labels are ambiguous after adding the recommendation marker; make each configured label unique and avoid the `(Recommended)` suffix')
  const answer = await ctx.userQuestions.ask({
    questions: [{
      id: 'dispatch-agent',
      header: 'Choose agent',
      question: `Which agent should run “${args.description}”?`,
      detail: recommended ? `The parent recommends ${recommended.label}. The task starts after your selection.` : 'The parent could not choose confidently from the routing rules.',
      options: options.map(({ label, description }) => ({ label, description })),
    }],
    agent: exec.agent,
    signal: exec.signal,
    wait: { callId: exec.callId },
  })
  const selected = answerAgent(answer, options)
  if (!selected) return undefined
  return { agent: validateAgentChoice(config, selected), route: 'user' }
}

export function apply(ctx, config) {
  const modernRuntime = isModernSubagentRuntime(ctx)
  const initialConfig = currentRouterConfig(config)
  const agents = agentConfigs(initialConfig)
  if (agents.length === 0) throw new Error('multi-agent-router requires at least one enabled agent')
  if (new Set(agents.map((agent) => agent.label)).size !== agents.length) throw new Error('multi-agent-router requires unique agent labels for user selection')
  validateAgentChoice(initialConfig, initialConfig.defaultAgent)
  const resolveDshModel = createDshModelResolver(ctx)
  const resolveTaskLanguage = createTaskLanguageResolver(ctx)
  const cleanups = new Set()
  // Accepted activations belong to DSH, not to the tool registration. Keep their
  // captured deadlines until settlement across reload. Caller cancellation owns
  // startup only; accepted background work belongs to the Subagent Manager.
  // Disposing this component only withdraws tools; it does not cancel child work.
  const tasks = ctx.multiAgentTasks
  registerAgentTasksTool(ctx, tasks)
  registerTaskContinuation(ctx, { tasks, resolveTaskLanguage, getSettings: () => currentRouterConfig(config) })

  const definition = {
    name: 'dispatch_agent',
    description: 'Delegate one self-contained task to DSH, Codex, Kimi Code, or Google Antigravity (agy) using the configured prompt-based routing rules. The child works independently and does not share this conversation. This tool returns a managed child id and report path immediately; a later completion notice contains the requested final answer or failure. Reports default to .dsh/agent-reports in the child workspace unless report_path overrides the location. DSH children support native model selection and continuation; Codex, Kimi Code, and agy children are external runs with continuation when a session id is saved.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        description: { type: 'string', minLength: 1, description: 'A concise task title in the main conversation\'s language.' },
        language: { type: 'string', minLength: 1, maxLength: 80, description: 'Main conversation language for child progress, final answers and reports, e.g. zh-CN or en. Defaults to a language cue from the parent\'s latest human message.' },
        agent: { type: 'string', enum: agents.map((agent) => agent.id), description: 'Target agent selected using the configured routing rules. Omit when the selection mode allows the user to resolve ambiguity.' },
        route_reason: { type: 'string', description: 'Brief reason this agent matches the task.' },
        task: { type: 'string', minLength: 1, description: 'Complete, self-contained objective and work to perform. Include relevant constraints and file paths; the child does not see this conversation.' },
        context: { type: 'string', description: 'Additional background, prior findings, or dependencies needed to avoid rediscovery.' },
        expected_output: { type: 'string', minLength: 1, description: 'Exactly what the parent needs returned: answer content, summary, changed-file list, verification, report contents, or other deliverable.' },
        report_path: { type: 'string', description: 'Optional report path override. By default the child writes to a unique Markdown file under .dsh/agent-reports in its workspace. The start result returns the absolute reportPath.' },
        cwd: { type: 'string', description: 'Initial child working directory. Relative paths use the current directory; omitted inherits it.' },
        provider: { type: 'string', description: 'DSH child LLM provider id. Supply together with model; only valid when agent is dsh.' },
        model: { type: 'string', description: 'DSH child model id within that provider. Supply together with provider; only valid when agent is dsh.' },
        reasoning_effort: { type: 'string', description: modernRuntime
          ? 'DSH child reasoning effort; requires provider and model. When explicitly selecting a model, omit effort to use that model’s default.'
          : 'Optional DSH child reasoning effort. Uses the configured default or model default when omitted; only valid when agent is dsh.' },
      },
      required: ['description', 'task', 'expected_output'],
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('dispatch_agent requires a calling agent')
      if (!isRootAgent(ctx, exec.agent)) throw new Error('dispatch_agent is available only from a root/main agent; nested agents must return their result to the parent instead of delegating again')
      for (const field of ['description', 'task', 'expected_output']) {
        if (typeof args[field] !== 'string' || args[field].trim().length === 0) throw new Error(`dispatch_agent requires non-empty \`${field}\``)
      }
      if (args.report_path !== undefined && args.report_path.trim().length === 0) throw new Error('`report_path` must be non-empty when supplied')
      await tasks.ready
      tasks.assertStorageAvailable()
      const settings = currentRouterConfig(config)
      let selection = await chooseAgent(ctx, settings, args, exec)
      if (!selection) return { kind: 'cancelled', reason: 'the user skipped agent selection' }
      let provider = ctx.subagents.getProvider(selection.agent.providerName)
      if (!provider && selection.agent.id !== 'dsh') {
        const fallback = validateAgentChoice(settings, 'dsh')
        const fallbackProvider = fallback ? ctx.subagents.getProvider(fallback.providerName) : undefined
        if (fallbackProvider) {
          selection = { agent: fallback, route: 'fallback' }
          provider = fallbackProvider
        }
      }
      if (!provider) throw new Error(`Agent provider "${selection.agent.providerName}" is unavailable. Enable its provider bundle or choose another agent.`)
      if (selection.agent.id !== 'dsh' && (args.provider !== undefined || args.model !== undefined || args.reasoning_effort !== undefined)) throw new Error('provider, model, and reasoning_effort are supported only when agent is dsh')
      const agentOptions = selection.agent.id === 'dsh' ? await resolveDshModel(args, settings, exec) : undefined
      if (agentOptions !== undefined && ctx.subagents.getProvider(selection.agent.providerName) !== provider) throw new Error(`Agent provider "${selection.agent.providerName}" changed while resolving the model; retry the dispatch`)
      const language = await resolveTaskLanguage(args, exec.agent.session)
      exec.signal.throwIfAborted()
      const reportPath = resolveReportPath(args, ctx.workingDirectory.get(exec.agent.session), new Date(), randomUUID())
      const taskArgs = { ...args, ...language, report_path: reportPath }
      const prompt = composeTaskPrompt(taskArgs, selection.agent, settings)
      let activation
      let trace
      let timer
      let cancelNativeDeadline
      let timedOut = false
      let timeoutDisposalRequested = false
      const callerSignal = exec.signal
      const startup = new AbortController()
      const disposeExpired = () => {
        if (timeoutDisposalRequested) return
        timeoutDisposalRequested = true
        activation.dispose().catch((error) => ctx.logger.warn(`multi-agent-router: child ${activation.childId} failed to dispose after timeout: ${error.message}`))
      }
      // The manager determines whether publication has already won against this
      // startup signal. A returned activation is accepted even if the caller
      // aborted in the microtask gap before our await continuation.
      const onAbort = () => startup.abort(callerSignal.reason)
      const cleanup = () => {
        clearTimeout(timer)
        cancelNativeDeadline?.()
        callerSignal.removeEventListener('abort', onAbort)
        cleanups.delete(cleanup)
      }
      cleanups.add(cleanup)
      const deadlineAt = Date.now() + settings.timeoutSeconds * 1000
      timer = setTimeout(() => {
        timedOut = true
        if (activation) disposeExpired()
        else startup.abort(new Error(`dispatch_agent timed out after ${settings.timeoutSeconds} seconds`))
      }, settings.timeoutSeconds * 1000)
      if (callerSignal.aborted) onAbort()
      else callerSignal.addEventListener('abort', onAbort, { once: true })
      try {
        const parentCwd = ctx.workingDirectory.get(exec.agent.session)
        trace = tasks.begin({
          parentSessionId: exec.agent.session.id,
          agent: selection.agent.id,
          providerName: selection.agent.providerName,
          language: language.language,
          label: args.description.trim(),
          cwd: args.cwd === undefined ? parentCwd : resolve(parentCwd, args.cwd),
          reportPath,
        })
        activation = await runWithTaskTrace(trace, () => startManagedActivation(ctx, {
          provider: selection.agent.providerName,
          label: args.description.trim(),
          prompt: [{ type: 'text', text: prompt }],
          parent: exec.agent,
          ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          ...(agentOptions === undefined ? {} : { agentOptions }),
          ...(selection.agent.id === 'dsh' ? { maxDepth: ctx.subagents.resolveMaxDepth(undefined) } : {}),
          signal: startup.signal,
          delivery: 'parent',
        }))
        // PTC/run_code aborts its execution signal when the program finishes,
        // including successful returns. Do not let that cleanup kill an accepted
        // background child. DSH owns parent/child interruption after handoff.
        callerSignal.removeEventListener('abort', onAbort)
        tasks.bind(trace, activation.childId)
        if (modernRuntime && selection.agent.id === 'dsh') {
          // Keep startup cancellation separate: an unpublished task must not be
          // marked as an admitted run whose termination awaits confirmation.
          clearTimeout(timer)
          cancelNativeDeadline = tasks.armNativeDeadline(trace, Math.max(1, deadlineAt - Date.now()), () => {
            timedOut = true
            disposeExpired()
          })
        }
        // This deadline disposes the accepted activation; descendant handling is Host-owned.
        if (timedOut) disposeExpired()
        activation.result.then((result) => {
          tasks.settle(trace, result)
          cleanup()
        }, () => {
          tasks.settle(trace, { status: 'error', diagnostic: 'Subagent activation failed before a result was available.' })
          cleanup()
        })
      } catch (error) {
        if (trace) tasks.settle(trace, {
          status: startup.signal.aborted ? 'aborted' : 'error',
          diagnostic: 'Subagent startup failed; see host diagnostics for details.',
        })
        cleanup()
        if (timedOut) throw new Error(`dispatch_agent timed out during startup after ${settings.timeoutSeconds} seconds`, { cause: error })
        throw error
      }
      return {
        kind: 'activation',
        subagentId: activation.childId,
        agent: selection.agent.id,
        route: selection.route,
        reportPath,
        ...(args.route_reason || selection.route === 'fallback' ? { routeReason: args.route_reason ?? 'External agent unavailable; fell back to local DSH.' } : {}),
        timeoutSeconds: settings.timeoutSeconds,
        ...(agentOptions?.provider === undefined ? {} : { provider: agentOptions.provider }),
        ...(agentOptions?.model === undefined ? {} : { model: agentOptions.model }),
        ...(agentOptions?.reasoningEffort === undefined ? {} : { reasoningEffort: agentOptions.reasoningEffort }),
      }
    },
  }
  ctx.effect(() => ctx.tools.register(definition, {
    when: ({ agent }) => isRootAgent(ctx, agent),
  }))
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'multi-agent-router',
    order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT'),
    interpolate: false,
    text: (context) => {
      if (!isRootAgent(ctx, context.agent ?? context.scope)) return ''
      if (ctx.tools.get(definition.name, context.scope) !== definition) return ''
      const settings = currentRouterConfig(config)
      const unavailable = agentConfigs(settings)
        .filter((agent) => agent.id !== 'dsh' && !ctx.subagents.getProvider(agent.providerName))
        .map((agent) => agent.id)
      const notice = unavailable.length > 0 ? `\nCurrently unavailable external agents: ${unavailable.join(', ')}. Dispatch to them falls back to local DSH automatically.` : ''
      return routingGuidance(settings) + notice
    },
  }))
}
