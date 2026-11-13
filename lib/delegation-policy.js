import { z } from 'zod'

export const DECLARE_EXCEPTION = 'declare_delegate_exception'
export const DIRECT_TOOLS = new Set(['subagent', 'subagent_codex'])
export const EXCEPTION_TOOLS = new Set(['spawn_teammate', 'subagent_fork'])
const purposes = { spawn_teammate: 'ongoing_collaboration', subagent_fork: 'context_inheritance' }
const declaration = z.object({
  tool: z.enum(['spawn_teammate', 'subagent_fork']),
  purpose: z.enum(['ongoing_collaboration', 'context_inheritance']),
  description: z.string().trim().min(1).max(300),
  reason: z.string().trim().min(1).max(1500),
}).strict().refine((value) => purposes[value.tool] === value.purpose, { message: 'Purpose does not match the native tool' })
const receipt = z.object({
  version: z.literal(1), sessionId: z.string(), ...declaration.shape,
}).strict()

export function validateDeclaration(args, modern = false) {
  const value = declaration.parse(args)
  if (modern && value.tool === 'spawn_teammate') throw new Error('Use dispatch_agent with agent: dsh for ongoing collaboration')
  return value
}
const parse = (value) => { try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return undefined } }

// Replay only committed tool calls/results. One declaration authorizes one
// matching attempt in the same turn; no standalone mutable permission flag.
export const nativeDeclarationProjection = {
  key: 'multiAgentNativeDeclaration', stateVersion: 1,
  stateSchema: z.object({
    sessionId: z.string(),
    pending: z.array(z.string()),
    receipt: receipt.nullable(),
    attempts: z.record(z.string(), receipt),
  }),
  init: (header) => ({ sessionId: header.id, pending: [], receipt: null, attempts: {} }),
  apply(state, event) {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      return { ...state, pending: [], receipt: null, attempts: {} }
    }
    if (event.type === 'tool/call') {
      const { name, callId } = event.data
      if (name === DECLARE_EXCEPTION) return { ...state, pending: [...state.pending.slice(-31), callId] }
      if (!EXCEPTION_TOOLS.has(name) || !state.receipt) return state
      const args = parse(event.data.arguments)
      if (name !== state.receipt.tool || args?.description?.trim() !== state.receipt.description) return state
      return { ...state, receipt: null, attempts: { ...state.attempts, [callId]: state.receipt } }
    }
    if (event.type !== 'tool/result') return state
    const callId = event.data.message.toolCallId
    if (state.pending.includes(callId)) {
      const parsed = receipt.safeParse(event.data.meta?.multiAgentNativeDeclaration)
      const next = { ...state, pending: state.pending.filter((id) => id !== callId) }
      if (!event.data.message.isError && parsed.success && parsed.data.sessionId === state.sessionId
        && purposes[parsed.data.tool] === parsed.data.purpose && state.receipt === null) next.receipt = parsed.data
      return next
    }
    if (Object.hasOwn(state.attempts, callId)) {
      const attempts = { ...state.attempts }
      delete attempts[callId]
      return { ...state, attempts }
    }
    return state
  },
}

export function policyReason(exec, state, modern = false) {
  if (DIRECT_TOOLS.has(exec.name)) return 'Use dispatch_agent for ordinary new tasks (agent: dsh, codex, or kimi-code), with task and expected_output. Direct native delegation bypasses the configured routing and report contract.'
  if (modern && exec.name === 'spawn_teammate') return 'Use dispatch_agent with agent: dsh for ongoing collaboration'
  if (!EXCEPTION_TOOLS.has(exec.name)) return undefined
  const permit = state?.attempts[exec.callId]
  if (permit?.tool === exec.name && permit.description === exec.arguments?.description?.trim()) return undefined
  return `Use dispatch_agent for ordinary independent work. If ${exec.name} is necessary for ${purposes[exec.name]}, first call ${DECLARE_EXCEPTION} with that tool, purpose, the exact same description, and a concrete reason; then call it in the next step. Each declaration covers one attempt only. Existing send_message, wait and task-board operations remain available.`
}
