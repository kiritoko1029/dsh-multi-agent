import { z } from 'zod'
import { isModernSubagentRuntime } from './runtime-compat.js'

// Local copy of dsh-subagent 0.2.2-rc.1's pure parent-option inheritance (MIT).
// Importing the Host service package here would install/shadow it in a profile.
function parentAgentOptionsForDelegation(parent) {
  const requestConfig = parent.session.requestHeader()?.config
  if (requestConfig === undefined) return { ...parent.options }
  const { provider: _createdProvider, model: _createdModel, reasoningEffort: _createdReasoningEffort, ...createdOptions } = parent.options
  return {
    ...createdOptions,
    provider: requestConfig.provider,
    model: requestConfig.model,
    ...requestConfig.reasoningEffort === undefined ? {} : { reasoningEffort: requestConfig.reasoningEffort },
  }
}

// Keep the same key/version/fold as dsh-tool-subagent so registration is shared
// and the Session's authorized model routes remain authoritative.
const modelPolicyProjection = {
  key: 'subagentModelSelectionPolicy',
  stateVersion: 1,
  stateSchema: z.array(z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
  }).strict()).min(1).nullable(),
  init: () => null,
  apply: (policy, event) => {
    if (policy !== null || event.type !== 'subagent/model-selection-policy') return policy
    const routes = event.data.allowedModels
    if (!Array.isArray(routes) || routes.length === 0) throw new Error('subagent/model-selection-policy requires at least one route')
    const seen = new Set()
    for (const route of routes) {
      if (typeof route?.provider !== 'string' || typeof route?.model !== 'string' || !route.provider || !route.model) throw new Error('subagent model selection requires non-empty provider and model ids')
      const key = `${route.provider}\0${route.model}`
      if (seen.has(key)) throw new Error(`subagent model selection repeats route "${route.provider}/${route.model}"`)
      seen.add(key)
    }
    return routes.map((route) => ({ provider: route.provider, model: route.model }))
  },
}

function hasExplicitSelection(args) {
  return args.provider !== undefined || args.model !== undefined || args.reasoning_effort !== undefined
}

/** Resolve the DSH child's route and enforce the same Session policy as the native tool. */
export function createDshModelResolver(ctx) {
  let policyHandle
  const getPolicyHandle = () => policyHandle ??= ctx.sessionProjections.register(modelPolicyProjection)
  return async (args, settings, exec) => {
    const modern = isModernSubagentRuntime(ctx)
    const parent = parentAgentOptionsForDelegation(exec.agent)
    const explicit = hasExplicitSelection(args)
    if (!explicit && settings.dsh.defaultProvider === undefined && settings.dsh.defaultModel === undefined && settings.dsh.defaultReasoningEffort === undefined) return undefined
    if (modern && explicit && (args.provider === undefined || args.model === undefined)) {
      throw new Error('DSH child explicit selection requires both `provider` and `model`; reasoning_effort cannot be supplied alone')
    }
    if ((args.provider !== undefined) !== (args.model !== undefined)) throw new Error('DSH child `provider` and `model` must be supplied together')
    for (const field of ['provider', 'model', 'reasoning_effort']) {
      if (args[field] !== undefined && (typeof args[field] !== 'string' || !args[field].trim())) throw new Error(`DSH child \`${field}\` must be a non-empty string`)
    }
    const provider = args.provider ?? settings.dsh.defaultProvider ?? parent.provider
    const model = args.model ?? settings.dsh.defaultModel ?? parent.model
    const baselineProvider = settings.dsh.defaultProvider ?? parent.provider
    const baselineModel = settings.dsh.defaultModel ?? parent.model
    const routeChanged = args.provider !== undefined && (args.provider !== baselineProvider || args.model !== baselineModel)
    const reasoningEffort = modern && explicit ? args.reasoning_effort
      : args.reasoning_effort ?? (routeChanged ? undefined : settings.dsh.defaultReasoningEffort)
    if (!provider || !model) throw new Error('DSH child model selection requires an effective provider and model')
    if (explicit) {
      const allowed = (await getPolicyHandle()).stateOf(exec.agent.session)
      const permitted = allowed === undefined || allowed === null
        ? provider === parent.provider && model === parent.model
        : allowed.some((route) => route.provider === provider && route.model === model)
      if (!permitted) throw new Error(`DSH child model route "${provider}/${model}" is not allowed for this Session`)
    }
    const callConfig = {
      provider,
      model,
      // An own undefined clears compatible parent effort on rc.2 explicit selection.
      ...(modern && explicit || reasoningEffort !== undefined ? { reasoningEffort } : {}),
    }
    const preflight = modern && !explicit && reasoningEffort === undefined
      && provider === parent.provider && model === parent.model && parent.reasoningEffort !== undefined
      ? { ...callConfig, reasoningEffort: parent.reasoningEffort }
      : callConfig
    await ctx.llm.resolveCallConfig(preflight, exec.signal)
    return callConfig
  }
}
