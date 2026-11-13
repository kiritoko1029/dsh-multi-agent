/** Recognize the two audited Host contracts without invoking a provider or creating work. */
export function isModernSubagentRuntime(ctx) {
  const agents = ctx?.agents
  const subagents = ctx?.subagents
  // roots() is the rc.1 ownership API. rootOf alone is not a version marker.
  if (typeof agents?.roots === 'function'
    && subagents?.namesOf === undefined && subagents?.resolveName === undefined) return false
  if (agents?.roots === undefined
    && typeof agents?.get === 'function' && typeof agents?.list === 'function'
    && ['rootOf', 'namesOf', 'resolveName', 'startActivation'].every((key) => typeof subagents?.[key] === 'function')) return true
  throw new Error('Unsupported DSH subagent runtime contract; expected rc.1 roots() or the rc.2 agent registry and subagent naming APIs')
}

/** Accept only the exact live main agent; historical ordinary forks remain eligible. */
export function isRootAgent(ctx, agent) {
  const modern = isModernSubagentRuntime(ctx)
  if (!agent || typeof agent.id !== 'string' || !agent.id || agent.session?.id !== agent.id) return false
  // A separately restored delegated Session must not acquire main-agent tools.
  if (agent.session.header?.origin === 'subagent') return false
  if (typeof ctx.agents.get === 'function' && ctx.agents.get(agent.id) !== agent) return false
  if (!modern) return ctx.agents.roots().includes(agent)
  try {
    return ctx.subagents.rootOf(agent) === agent
  } catch {
    // The manager rejects stale instances and delegated Sessions without a live owner.
    return false
  }
}

/** Find the live root for this exact Session, without restoring or waking any Agent. */
export function findRootAgent(ctx, sessionId) {
  const modern = isModernSubagentRuntime(ctx)
  if (typeof sessionId !== 'string' || !sessionId) return undefined
  const agent = modern
    ? ctx.agents.get(sessionId)
    : ctx.agents.roots().find((candidate) => candidate.session?.id === sessionId)
  return agent?.session?.id === sessionId && isRootAgent(ctx, agent) ? agent : undefined
}

/** Start once using a flat caller contract; failures never trigger a second-format retry. */
export function startManagedActivation(ctx, flatSpec) {
  const modern = isModernSubagentRuntime(ctx)
  if (!flatSpec || typeof flatSpec !== 'object' || Object.hasOwn(flatSpec, 'request')) {
    throw new Error('startManagedActivation requires a flat activation specification')
  }
  if (typeof ctx.subagents?.startActivation !== 'function') throw new Error('DSH subagent startActivation is unavailable')
  if (!isRootAgent(ctx, flatSpec.parent)) throw new Error('Managed delegation requires the exact live root/main agent')
  if (!modern && flatSpec.name !== undefined) throw new Error('Named subagent activations require the rc.2 runtime contract')
  flatSpec.signal.throwIfAborted()
  if (modern) return ctx.subagents.startActivation({ ...flatSpec })
  const { provider, label, childId, name: _name, signal, delivery, ...request } = flatSpec
  return ctx.subagents.startActivation({
    provider, label, ...childId === undefined ? {} : { childId }, request, signal, delivery,
  })
}
