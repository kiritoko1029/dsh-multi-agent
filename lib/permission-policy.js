/**
 * Shared sub-agent permission decision engine.
 *
 * One policy vocabulary governs how permission requests raised by external
 * sub-agents (ACP `session/request_permission`, Codex app-server approval
 * requests) are decided:
 *
 * - `main-session` (default): ask the delegating session's native approval
 *   chain (`ctx.approval`); when that chain cannot take the question (for
 *   example the parent turn already ended), fall back to the interactive
 *   human card so the task is never silently blocked. An effective native
 *   `never` + `danger-full-access` preset is inherited as full access instead
 *   of turning the chain's automatic rejection into a child denial.
 * - `human`: always show the interactive approval card (`ctx.userQuestions`).
 * - `allow`: grant every request.
 * - `reject`: deny every request (the 0.8.x share-release default for ACP).
 * - `subagent`: defer to the sub-agent's own permission control. The chosen
 *   level adapts per backend:
 *   - `auto`: the sub-agent's internal automation decides. Codex auto-review
 *     escalations stay unattended (denied); ACP asks were already gated by
 *     the agent's own rules, so its offered allow option is accepted.
 *   - `full-access`: lift restrictions through the backend's native bypass
 *     (Codex bypass thread mode, agy `--dangerously-skip-permissions`) and
 *     grant anything that still asks.
 *   - `ask-request`: run the backend in strict ask mode and surface each ask
 *     through the main-session approval chain.
 *
 * Every undecided path fails closed (`deny`), and decisions carry a machine
 * readable `source` for diagnostics.
 */

/** Canonical permission policies, in settings order. */
export const PERMISSION_POLICIES = ['main-session', 'human', 'allow', 'reject', 'subagent']

/** Sub-agent-native control levels available under the `subagent` policy. */
export const SUBAGENT_PERMISSION_MODES = ['auto', 'full-access', 'ask-request']

/** Coerce a stored policy into the vocabulary, defaulting to `main-session`. */
export function normalizePermissionPolicy(value) {
  return PERMISSION_POLICIES.includes(value) ? value : 'main-session'
}

/** Coerce a stored sub-agent level into the vocabulary, defaulting to `auto`. */
export function normalizeSubagentPermissionMode(value) {
  return SUBAGENT_PERMISSION_MODES.includes(value) ? value : 'auto'
}

function serviceOf(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the delegating Session's effective permission preset without
 * inferring user intent from an ApprovalOutcome. Only the exact native
 * `never` + `danger-full-access` combination inherits full access. Explicit
 * human rejections under every other combination remain rejections.
 *
 * The preset service is the authoritative effective-knob view. Older hosts
 * without it fall back to the approval and sandbox services; missing or
 * failing services fail closed and preserve the normal approval chain.
 */
export function resolveMainSessionFullAccess(ctx, parent) {
  const session = parent?.session
  if (session === undefined || session === null) return false
  const presets = serviceOf(ctx, 'permissionPresets')
  if (presets !== undefined && presets !== null) {
    try {
      const current = presets.current(session)
      if (current !== 'custom') {
        const preset = presets.resolve(current)
        return preset?.approval === 'never' && preset?.sandbox === 'danger-full-access'
      }
    } catch {
      // Fall through to the individual effective-knob services.
    }
  }
  const approval = serviceOf(ctx, 'approval')
  const sandboxPolicy = serviceOf(ctx, 'sandboxPolicy')
  if (approval === undefined || approval === null || sandboxPolicy === undefined || sandboxPolicy === null) return false
  try {
    const approvalPolicy = approval.overrideOf(session) ?? approval.defaultPolicy
    const sandbox = sandboxPolicy.resolve({ session })?.mode
    return approvalPolicy === 'never' && sandbox === 'danger-full-access'
  } catch {
    return false
  }
}

const ALLOW = 'allow'
const DENY = 'deny'

function truncate(text, limit) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
}

/**
 * Chinese labels for the approval heading. Backends label requests
 * differently (ACP kinds, Codex phrases); map the known vocabulary and keep
 * any unknown label verbatim so nothing is hidden.
 */
const KIND_LABELS_ZH = {
  command: '执行命令',
  'command execution': '执行命令',
  execute: '执行命令',
  write: '写入文件',
  edit: '修改文件',
  'file change': '修改文件',
  read: '读取文件',
  delete: '删除文件',
  move: '移动文件',
  search: '搜索',
  fetch: '联网获取',
  think: '思考',
  switch_mode: '切换模式',
  other: '其他',
  'permission grant': '权限授予',
  unknown: '未知',
}

/**
 * Build one bilingual decision summary. The task language, when known,
 * selects the primary sentence; the other language stays as a suffix so an
 * unread locale never hides what is being approved.
 */
function describeRequest(request, language) {
  const title = truncate(request.title, 300)
  const detail = truncate(request.detail, 500)
  const zhFirst = typeof language === 'string' && language.toLowerCase().startsWith('zh')
  const kindLabel = request.kindLabel ?? 'unknown'
  const label = zhFirst ? KIND_LABELS_ZH[kindLabel] ?? kindLabel : kindLabel
  const heading = zhFirst
    ? `子代理权限请求（${label}）`
    : `Sub-agent permission request (${label})`
  const parts = [heading]
  if (title) parts.push(title)
  if (detail) parts.push(detail)
  return parts.join('\n')
}

function approvalQuestionText(language, agentLabel) {
  const zh = typeof language === 'string' && language.toLowerCase().startsWith('zh')
  return zh
    ? `是否允许 ${agentLabel} 子代理执行此操作？`
    : `Allow the ${agentLabel} sub-agent to perform this action?`
}

const DECISION_LABELS = {
  zh: {
    allowOnce: '本次允许',
    allowAlways: '始终允许',
    reject: '拒绝',
    allowOnceDescription: '仅批准本次请求',
    allowAlwaysDescription: '本次及后续同类请求都自动允许',
    rejectDescription: '拒绝本次请求',
  },
  en: {
    allowOnce: 'Allow once',
    allowAlways: 'Always allow',
    reject: 'Reject',
    allowOnceDescription: 'Approve this request only',
    allowAlwaysDescription: 'Auto-approve this and later similar requests',
    rejectDescription: 'Refuse this request',
  },
}

function decisionLabels(language) {
  return typeof language === 'string' && language.toLowerCase().startsWith('zh')
    ? DECISION_LABELS.zh
    : DECISION_LABELS.en
}

/**
 * Create the per-run permission decider.
 *
 * @param {object} options
 * @param {object} options.ctx Plugin context used to reach `approval` and
 *   `userQuestions` services. Both lookups are optional so older DSH hosts
 *   and test harnesses keep working; undecided requests fail closed.
 * @param {object} [options.parent] The delegating Agent from the subagent
 *   start request; approval questions are scoped to its session.
 * @param {string} options.policy Normalized permission policy.
 * @param {string} options.subagentMode Normalized sub-agent level.
 * @param {'acp'|'codex'} options.backend Backend family, for the
 *   `subagent/auto` adaptation and diagnostics.
 * @param {string} options.agentLabel Human-readable agent label.
 * @param {string} [options.language] Task language tag.
 * @param {AbortSignal} [options.signal] Run cancellation; aborting withdraws
 *   pending questions and denies.
 * @param {boolean} [options.mainSessionFullAccess] Run-start snapshot shared
 *   with the backend launcher; when omitted it is resolved from Host services.
 * @param {(note: string) => void} [options.onDecision] Optional observer for
 *   activity/diagnostic recording.
 * @returns {(request: {kindLabel: string, title?: string, detail?: string, canAlways?: boolean}) => Promise<{outcome: 'allow'|'deny', scope: 'once'|'always', source: string}>}
 */
export function createPermissionAsker({
  ctx, parent, policy, subagentMode, backend, agentLabel, language, signal, onDecision,
  mainSessionFullAccess,
}) {
  const normalizedPolicy = normalizePermissionPolicy(policy)
  const normalizedMode = normalizeSubagentPermissionMode(subagentMode)
  const inheritFullAccess = normalizedPolicy === 'main-session'
    && (mainSessionFullAccess ?? resolveMainSessionFullAccess(ctx, parent))
  const note = (message) => {
    try { onDecision?.(message) } catch { /* observer failures never block a decision */ }
  }

  function askMainSessionError(error) {
    // The native chain refuses out-of-turn asks and service hiccups; keep the
    // task moving by degrading to the interactive question.
    return { fallback: true, note: `main-session approval unavailable (${truncate(error?.message, 160)}); falling back to an interactive question` }
  }

  async function askMainSession(request) {
    const approval = serviceOf(ctx, 'approval')
    if (approval === undefined || approval === null || parent === undefined) return { fallback: true }
    try {
      const outcome = await approval.request({
        agent: parent,
        toolName: `multi-agent:${agentLabel}`,
        reason: describeRequest(request, language),
        ...signal === undefined ? {} : { signal },
      })
      if (signal?.aborted) return { outcome: DENY, scope: 'once', source: 'cancelled' }
      if (outcome === 'allowed-once') return { outcome: ALLOW, scope: 'once', source: 'main-session' }
      if (outcome === 'rejected') return { outcome: DENY, source: 'main-session' }
      if (outcome === 'cancelled') return { outcome: DENY, source: 'cancelled' }
      // 'unavailable' (no answerer / session policy fail-closed): try the
      // interactive card once before denying; it fails closed by itself.
      return { fallback: true }
    } catch (error) {
      return askMainSessionError(error)
    }
  }

  async function askHuman(request) {
    const userQuestions = serviceOf(ctx, 'userQuestions')
    if (userQuestions === undefined || userQuestions === null || parent === undefined) return { outcome: DENY, source: 'human-unavailable' }
    const labels = decisionLabels(language)
    const options = [{
      label: labels.allowOnce,
      description: labels.allowOnceDescription,
    }]
    if (request.canAlways === true) options.push({ label: labels.allowAlways, description: labels.allowAlwaysDescription })
    options.push({ label: labels.reject, description: labels.rejectDescription })
    try {
      const answer = await userQuestions.ask({
        agent: parent,
        ...signal === undefined ? {} : { signal },
        questions: [{
          id: 'subagent-permission',
          question: approvalQuestionText(language, agentLabel),
          detail: describeRequest(request, language),
          options,
          intent: {
            kind: 'approval',
            approve: labels.allowOnce,
            reject: labels.reject,
            ...request.canAlways === true ? { always: labels.allowAlways } : {},
            subject: { name: agentLabel },
          },
        }],
      })
      if (signal?.aborted) return { outcome: DENY, scope: 'once', source: 'cancelled' }
      const selected = answer?.answers?.[0]?.selected?.[0]
      if (selected === labels.allowAlways) return { outcome: ALLOW, scope: 'always', source: 'human' }
      if (selected === labels.allowOnce) return { outcome: ALLOW, scope: 'once', source: 'human' }
      return { outcome: DENY, source: 'human' }
    } catch (error) {
      if (signal?.aborted) return { outcome: DENY, source: 'cancelled' }
      note(`interactive approval failed (${truncate(error?.message, 160)}); denying`)
      return { outcome: DENY, source: 'human-unavailable' }
    }
  }

  return async function decide(request) {
    if (signal?.aborted) return { outcome: DENY, scope: 'once', source: 'cancelled' }
    if (normalizedPolicy === 'allow') return { outcome: ALLOW, scope: 'once', source: 'policy-allow' }
    if (normalizedPolicy === 'reject') return { outcome: DENY, scope: 'once', source: 'policy-reject' }
    if (inheritFullAccess) return { outcome: ALLOW, scope: 'always', source: 'main-session-full-access' }
    if (normalizedPolicy === 'subagent') {
      if (normalizedMode === 'full-access') return { outcome: ALLOW, scope: 'always', source: 'subagent-full-access' }
      if (normalizedMode === 'auto') {
        // Codex's auto reviewer already decided internally; an escalated ask
        // stays unattended. ACP asks passed the agent's own gating rules, so
        // its offered allow option is accepted.
        return backend === 'codex'
          ? { outcome: DENY, scope: 'once', source: 'subagent-auto' }
          : { outcome: ALLOW, scope: 'once', source: 'subagent-auto' }
      }
      // ask-request: surface every ask through the main-session chain.
    }
    if (normalizedPolicy === 'human') return askHuman(request)
    const mainSession = await askMainSession(request)
    if (!mainSession.fallback) {
      note(`permission decision via main session: ${mainSession.outcome} (${mainSession.source})`)
      return mainSession
    }
    if (mainSession.note !== undefined) note(mainSession.note)
    return askHuman(request)
  }
}
