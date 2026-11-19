import {
  createPermissionAsker, normalizePermissionPolicy, normalizeSubagentPermissionMode,
  PERMISSION_POLICIES, resolveMainSessionFullAccess, SUBAGENT_PERMISSION_MODES,
} from './permission-policy.js'

export const TASK_PERMISSION_CHOICES = [
  'default', ...PERMISSION_POLICIES.filter((policy) => policy !== 'subagent'),
  ...SUBAGENT_PERMISSION_MODES.map((mode) => `subagent:${mode}`),
]
export const CODEX_PERMISSION_CHOICES = [...TASK_PERMISSION_CHOICES, 'codex:never', 'codex:approve-for-me']

export function taskPermissionChoices(agent) {
  return agent === 'codex' ? CODEX_PERMISSION_CHOICES : TASK_PERMISSION_CHOICES
}

export const NATIVE_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access']

// Each activation owns its launcher and pending questions. The task record only
// retains the owner's selection across activations; provider settings stay shared.
export function startTaskPermissions({ trace, agent, ctx, parent, signal, agentLabel, policy, subagentMode, launcher }) {
  const defaultPolicy = normalizePermissionPolicy(policy)
  const defaultChoice = defaultPolicy === 'subagent' ? `subagent:${normalizeSubagentPermissionMode(subagentMode)}` : defaultPolicy
  const tracked = trace?.record?.agent === agent
  function resolve(choice) {
    const effective = choice === 'default' ? defaultChoice : choice
    const [policy, subagentMode] = effective.startsWith('codex:') ? ['subagent', 'auto'] : effective.split(':')
    const fullAccess = policy === 'main-session' && resolveMainSessionFullAccess(ctx, parent)
    return { effective, policy, subagentMode, fullAccess, launcher: launcher(policy, subagentMode, fullAccess, choice) }
  }
  let selected = tracked ? trace.record.permissionChoice ?? 'default' : 'default'
  let active = resolve(selected)
  let desired = active
  let revision = new AbortController()
  const run = {
    get launcher() { return active.launcher },
    get policy() { return active.policy },
    select(choice) {
      selected = choice
      desired = resolve(choice)
      if (desired.launcher !== active.launcher) return
      if (desired.effective === active.effective && desired.fullAccess === active.fullAccess) return
      revision.abort()
      revision = new AbortController()
      active = desired
    },
    view() {
      return {
        selected, defaultChoice, effective: active.effective, inheritsFullAccess: active.fullAccess,
        launcher: active.launcher, pending: desired.launcher !== active.launcher,
      }
    },
    async ask(request) {
      const current = revision.signal
      const decision = await createPermissionAsker({
        ctx, parent, signal: signal ? AbortSignal.any([signal, current]) : current,
        policy: active.policy, subagentMode: active.subagentMode, mainSessionFullAccess: active.fullAccess,
        backend: agent === 'codex' ? 'codex' : 'acp', agentLabel, language: trace?.record?.language,
      })(request)
      if (current.aborted || signal?.aborted) return { outcome: 'deny', scope: 'once', source: 'cancelled' }
      return decision
    },
  }
  if (tracked) trace.permissions = run
  return run
}
