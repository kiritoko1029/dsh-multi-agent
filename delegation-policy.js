import { DECLARE_EXCEPTION, nativeDeclarationProjection, policyReason, validateDeclaration } from './lib/delegation-policy.js'
import { isRootAgent, isModernSubagentRuntime } from './lib/runtime-compat.js'

export const name = 'multi-agent-delegation-policy'
export const inject = ['tools', 'agents', 'subagents', 'systemPrompt', 'sessionProjections']

export async function apply(ctx) {
  const modern = isModernSubagentRuntime(ctx)
  // A separate component allows policy updates without withdrawing the dispatcher
  // or disposing its accepted activations.
  const projection = await ctx.sessionProjections.register(nativeDeclarationProjection)
  const dispatcherFor = (agent, toolSet) => {
    if (!isRootAgent(ctx, agent)) return undefined
    const global = ctx.tools.get('dispatch_agent')
    const visible = ctx.tools.get('dispatch_agent', agent, toolSet)
    return global && visible === global ? visible : undefined
  }
  ctx.effect(() => ctx.tools.guard((exec) => {
    if (!dispatcherFor(exec.agent, exec.toolSet)) return undefined
    return policyReason(exec, projection.stateOf(exec.agent.session), modern)
  }))
  ctx.effect(() => ctx.tools.register({
    name: DECLARE_EXCEPTION,
    description: modern
      ? 'Record why one native Fork call needs inherited conversation context. Call the matching tool in the next step; one declaration covers one attempt in this turn and grants no additional permissions.'
      : 'Record why one native Team or Fork call is needed instead of dispatch_agent. This is a workflow declaration, not a permission grant. Call the matching native tool in the next step; one declaration covers one attempt in this turn.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        tool: { type: 'string', enum: modern ? ['subagent_fork'] : ['spawn_teammate', 'subagent_fork'], description: modern ? 'Native Fork tool for inherited conversation context.' : 'Native tool needed for persistent collaboration or inherited conversation context.' },
        purpose: { type: 'string', enum: modern ? ['context_inheritance'] : ['ongoing_collaboration', 'context_inheritance'], description: modern ? 'Use context_inheritance for subagent_fork.' : 'Use ongoing_collaboration for spawn_teammate; context_inheritance for subagent_fork.' },
        description: { type: 'string', minLength: 1, maxLength: 300, description: 'Exact description to use in the next native call.' },
        reason: { type: 'string', minLength: 1, maxLength: 1500, description: modern ? 'Concrete need for inherited completed turns that a self-contained dispatch cannot satisfy.' : 'Concrete need for ongoing member interaction or inherited completed turns that a self-contained dispatch cannot satisfy.' },
      },
      required: ['tool', 'purpose', 'description', 'reason'],
    },
    isConcurrencySafe: () => false,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          version: { type: 'integer', const: 1 }, sessionId: { type: 'string' },
          tool: { type: 'string' }, purpose: { type: 'string' }, description: { type: 'string' }, reason: { type: 'string' },
        },
        required: ['version', 'sessionId', 'tool', 'purpose', 'description', 'reason'],
      },
      render: (_args, value) => [{ type: 'text', text: `Native delegation declaration recorded for ${value.tool}: ${value.description}. Make one matching call in the next step. Reason: ${value.reason}` }],
      presentationMeta: (_args, value) => ({ multiAgentNativeDeclaration: value }),
    },
    async execute(args, exec) {
      if (!dispatcherFor(exec.agent, exec.toolSet)) throw new Error('Native delegation declarations require a root agent with dispatch_agent available')
      const declaration = validateDeclaration(args, modern)
      if (!ctx.tools.get(declaration.tool, exec.agent, exec.toolSet)) throw new Error(`Native tool ${declaration.tool} is not available to this agent`)
      const state = projection.stateOf(exec.agent.session)
      if (state.receipt || Object.keys(state.attempts).length > 0) throw new Error('Finish the previously declared native attempt before declaring another one')
      exec.signal.throwIfAborted()
      return { version: 1, sessionId: exec.agent.id, ...declaration }
    },
  }, { when: ({ agent }) => Boolean(dispatcherFor(agent)) }))
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'multi-agent-delegation-policy', order: 10000, interpolate: false,
    text: ({ scope, agent }) => {
      const caller = agent ?? scope
      if (!dispatcherFor(caller)) return ''
      return [
        'Delegation policy: all ordinary NEW independent tasks must use dispatch_agent, including tasks assigned to DSH itself. Direct subagent and subagent_codex calls are blocked while the dispatcher is available.',
        modern
          ? 'For ongoing collaboration, use dispatch_agent with agent: dsh and continue the same child through send_message or continue_agent. Before subagent_fork for necessary inherited completed context, call declare_delegate_exception with purpose context_inheritance, the exact description, and a concrete reason. Declare and execute sequentially; one declaration covers one native attempt in this turn, including a failed attempt.'
          : 'Do not create a Team merely to run independent tasks in parallel: call dispatch_agent concurrently instead. Before a new spawn_teammate call for necessary ongoing collaboration, or subagent_fork for necessary inherited completed context, call declare_delegate_exception with the matching purpose, exact description, and concrete reason. Declare and execute sequentially; one declaration covers one native attempt in this turn, including a failed attempt.',
        modern
          ? 'Use the current runtime tool schemas to message, list, wait for, or interrupt existing children. Shared task-board tools require Team mode in the root session. Do not replace existing children merely to follow this policy.'
          : 'Existing members and children remain reachable through send_message; list, wait, interrupt, and shared task-board operations are unchanged. Do not replace or restart an existing team merely to follow this policy.',
        'When dispatch_agent is absent from the current tool set, native delegation remains usable. Declarations do not change sandbox, approval, depth, or model permissions.',
      ].join('\n')
    },
  }))
}
