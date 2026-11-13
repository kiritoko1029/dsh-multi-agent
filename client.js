window.__ModuleLoader__.load({
  id: 'dsh-multi-agent',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React
    const NS = 'dsh-multi-agent'
    const AGENT_OPTIONS = [
      { value: 'codex', label: 'Codex' },
      { value: 'kimi-code', label: 'Kimi Code' },
      { value: 'agy', label: 'Antigravity (agy)' },
      { value: 'dsh', label: 'DSH' },
    ]

    const DICT = {
      en: {
        'unified.title': 'Multi-agent dispatch',
        'unified.description': 'Models, reasoning effort, routing, and runtime options for all agents. Existing settings are preserved.',
        'unified.models': 'Models and reasoning effort',
        'unified.runtime': 'Runtime options',
        'unified.effort': 'Reasoning effort (blank uses native default)',
        'unified.effortHint': 'Suggestions follow the selected model. Manual input is allowed; unsupported values fail explicitly when starting a task.',
        'unified.partial': 'Some sections could not be saved. Saved fields were cleared; unsaved edits are kept for retry.',
        'unified.disabled': 'This provider is unavailable or disabled. Its saved settings remain in the profile.',
        'router.summary': 'Routing mode, prompt rules, task instructions, and delegation timeout.',
        'router.title': 'Multi-agent dispatch',
        'router.description': 'Choose how the main agent routes work to DSH, Codex, Kimi Code, or Antigravity (agy). Changes apply to later dispatches.',
        'router.policy': 'Dispatch policy',
        'router.selectionMode': 'Agent selection mode',
        'router.selectionMode.auto': 'Automatic routing',
        'router.selectionMode.ask-if-ambiguous': 'Ask when ambiguous',
        'router.selectionMode.always-ask': 'Always ask',
        'router.defaultAgent': 'Fallback agent (optional)',
        'router.noDefault': 'No fallback — reject an ambiguous automatic dispatch',
        'router.timeoutSeconds': 'Task timeout (seconds)',
        'router.routes': 'Prompt-based routing rules',
        'router.routesHint': 'The main agent uses these descriptions to choose a backend. An explicit user request takes precedence.',
        'router.routeAgent': 'Agent',
        'router.routePrompt': 'Tasks suited to this agent',
        'router.addRoute': 'Add routing rule',
        'router.removeRoute': 'Remove rule',
        'router.instructions': 'Additional task contract',
        'router.additionalInstructions': 'Additional routing instructions (optional)',
        'router.taskPreamble': 'Instructions prepended to every child task (optional)',
        'router.dshModels': 'DSH model defaults',
        'router.dsh.defaultProvider': 'Default LLM provider (blank inherits parent)',
        'router.dsh.defaultModel': 'Default model (blank inherits parent)',
        'router.dsh.defaultReasoningEffort': 'Default reasoning effort (optional)',
        'router.modelHint': 'Per-call provider + model overrides are available only for DSH children and must pass the Session model policy.',
        'codex.summary': 'Default Codex model, permission mode, environment, and shutdown grace.',
        'codex.title': 'Codex provider',
        'codex.description': 'Configure the native Codex app-server used for later dispatches. Existing child runs are not changed.',
        'codex.model': 'Default Codex model (blank uses native configuration)',
        'codex.command': 'Codex CLI path (blank uses auto-detection)',
        'codex.permissionPolicy': 'Sub-agent permission requests',
        'codex.permissionPolicy.main-session': 'Ask the main session (default)',
        'codex.permissionPolicy.human': 'Ask me interactively',
        'codex.permissionPolicy.allow': 'Allow all requests',
        'codex.permissionPolicy.reject': 'Deny all requests',
        'codex.permissionPolicy.subagent': 'Sub-agent-managed',
        'codex.subagentMode': 'Sub-agent control level',
        'codex.subagentMode.auto': 'auto — follow the Codex permission mode below',
        'codex.subagentMode.full-access': 'full access — bypass approvals and sandbox',
        'codex.subagentMode.ask-request': 'ask request — every escalation is surfaced',
        'codex.permissionMode': 'Codex thread permission mode (used by deny and sub-agent auto)',
        'codex.permissionMode.never': 'Never ask for approval',
        'codex.permissionMode.approve-for-me': 'Automatic review with workspace writes',
        'codex.permissionMode.dangerously-bypass-approvals-and-sandbox': 'Bypass approvals and sandbox (dangerous)',
        'codex.permissionWarning': 'Approval choices can grant file writes and shell commands. They are not an operating-system sandbox; use them only in a trusted workspace.',
        'codex.env': 'Environment overrides (JSON object)',
        'codex.disposeGraceMs': 'Shutdown grace (ms)',
        'acp.summary': 'Kimi executable, ACP arguments, permission policy, environment, and shutdown grace.',
        'acp.title': 'Kimi Code ACP',
        'acp.description': 'Configure the Kimi Code process used for later ACP delegations. Existing child runs are not changed.',
        'acp.command': 'Kimi CLI path (blank uses auto-detection)',
        'acp.model': 'Default Kimi model alias (blank uses native configuration)',
        'acp.args': 'ACP arguments (JSON string array)',
        'acp.permission': 'Sub-agent permission requests',
        'acp.permission.main-session': 'Ask the main session (default)',
        'acp.permission.human': 'Ask me interactively',
        'acp.permission.allow': 'Allow all requests',
        'acp.permission.reject': 'Deny all requests',
        'acp.permission.subagent': 'Sub-agent-managed',
        'acp.subagentMode': 'Sub-agent control level',
        'acp.subagentMode.auto': 'auto — accept the agent-gated asks',
        'acp.subagentMode.full-access': 'full access — lift native restrictions',
        'acp.subagentMode.ask-request': 'ask request — surface every ask',
        'acp.permissionWarning': 'Approval choices can grant file writes and shell commands. They are not an operating-system sandbox; use them only in a trusted workspace.',
        'acp.env': 'Environment overrides (JSON object)',
        'acp.envHint': 'Prefer native Kimi authentication. Do not add secrets unless this child explicitly needs them.',
        'acp.disposeEofGraceMs': 'stdin EOF exit grace (ms)',
        'acp.disposeGraceMs': 'SIGTERM to SIGKILL grace (ms)',
        'agy.summary': 'Antigravity executable, ACP arguments, permission policy, environment, and shutdown grace.',
        'agy.title': 'Antigravity (agy)',
        'agy.description': 'Configure the Antigravity process used for later ACP delegations. Existing child runs are not changed.',
        'agy.command': 'Antigravity CLI path (blank uses auto-detection)',
        'agy.commandRequired': 'The Antigravity executable path cannot be empty.',
        'agy.model': 'Default Antigravity model (blank uses native configuration)',
        'agy.args': 'ACP arguments (JSON string array)',
        'agy.permission': 'Sub-agent permission requests',
        'agy.permission.main-session': 'Ask the main session (default)',
        'agy.permission.human': 'Ask me interactively',
        'agy.permission.allow': 'Allow all requests',
        'agy.permission.reject': 'Deny all requests',
        'agy.permission.subagent': 'Sub-agent-managed',
        'agy.subagentMode': 'Sub-agent control level',
        'agy.subagentMode.auto': 'auto — accept the agent-gated asks',
        'agy.subagentMode.full-access': 'full access — lift native restrictions',
        'agy.subagentMode.ask-request': 'ask request — surface every ask',
        'agy.permissionWarning': 'Approval choices can grant file writes and shell commands. They are not an operating-system sandbox; use them only in a trusted workspace.',
        'agy.env': 'Environment overrides (JSON object)',
        'agy.envHint': 'Prefer native Antigravity authentication. Do not add secrets unless this child explicitly needs them.',
        'agy.disposeEofGraceMs': 'stdin EOF exit grace (ms)',
        'agy.disposeGraceMs': 'SIGTERM to SIGKILL grace (ms)',
        'common.save': 'Save changes',
        'common.reset': 'Discard edits',
        'common.loading': 'Loading configuration…',
        'common.unavailable': 'Configuration is unavailable. Check that the Host plugin is enabled.',
        'common.readonly': 'Configuration is read-only for this connection.',
        'common.saving': 'Saving…',
        'common.success': 'Changes saved.',
        'common.failure': 'Could not save. Check the values and connection, then retry.',
        'common.conflict': 'Configuration changed elsewhere. Discard edits to load the latest values.',
        'common.invalidJson': 'Use valid JSON in the arguments and environment fields.',
        'common.invalidArgs': 'ACP arguments must be a JSON array containing only strings.',
        'common.invalidEnv': 'Environment overrides must be a JSON object whose values are strings.',
        'common.invalidNumber': 'Enter a whole number inside the allowed range.',
        'common.commandRequired': 'The Kimi executable path cannot be empty.',
        'common.routesRequired': 'Keep at least one routing rule and fill every prompt.',
        'common.modelPlaceholder': 'Select or enter a model',
        'common.modelsLoading': 'Loading models…',
        'common.modelsError': 'Models could not be loaded. You can still enter a model manually.',
        'common.modelsPartial': 'Some model providers could not be loaded; other suggestions remain available.',
        'common.modelsReady': 'Model suggestions loaded. Manual entries are also allowed.',
        'common.retryModels': 'Retry model list',
        'common.commandPlaceholder': 'Leave blank for auto-detection, or enter an absolute CLI path',
      },
      zh: {
        'unified.title': '多 Agent 派发',
        'unified.description': '统一配置所有 Agent 的模型、思考强度、路由与运行参数。原有设置自动保留。',
        'unified.models': '模型与思考强度',
        'unified.runtime': '运行参数',
        'unified.effort': '思考强度（留空使用原生默认值）',
        'unified.effortHint': '建议选项随所选模型变化，也可手动输入；不支持的值会在启动任务时明确报错。',
        'unified.partial': '部分配置保存失败。已保存字段已清除，未保存的编辑已保留，可重试。',
        'unified.disabled': '此 Provider 未启用或不可用；原有设置仍保留在 profile 中。',
        'router.summary': '配置选择模式、提示词路由规则、任务要求和派发超时。',
        'router.title': '多 Agent 派发',
        'router.description': '配置主 Agent 如何把任务分派给 DSH、Codex、Kimi Code 或 Antigravity (agy)，保存后应用于后续派发。',
        'router.policy': '派发策略',
        'router.selectionMode': 'Agent 选择模式',
        'router.selectionMode.auto': '自动路由',
        'router.selectionMode.ask-if-ambiguous': '歧义时询问',
        'router.selectionMode.always-ask': '每次询问',
        'router.defaultAgent': '默认 Agent（可选）',
        'router.noDefault': '不设置默认值，自动派发不明确时拒绝执行',
        'router.timeoutSeconds': '任务超时（秒）',
        'router.routes': '自然语言路由规则',
        'router.routesHint': '主 Agent 根据这些任务描述选择后端；用户明确指定 Agent 时优先。',
        'router.routeAgent': '执行 Agent',
        'router.routePrompt': '适合派给该 Agent 的任务',
        'router.addRoute': '添加路由规则',
        'router.removeRoute': '删除规则',
        'router.instructions': '附加任务契约',
        'router.additionalInstructions': '附加路由说明（可选）',
        'router.taskPreamble': '添加到每个子任务开头的通用要求（可选）',
        'router.dshModels': 'DSH 默认模型',
        'router.dsh.defaultProvider': '默认模型 Provider（留空继承主会话）',
        'router.dsh.defaultModel': '默认模型（留空继承主会话）',
        'router.dsh.defaultReasoningEffort': '默认推理强度（可选）',
        'router.modelHint': '每次调用可为 DSH 子代理覆盖 provider + model，但必须通过当前会话的模型授权校验。',
        'codex.summary': '配置 Codex 默认模型、权限模式、环境变量和退出宽限时间。',
        'codex.title': 'Codex Provider',
        'codex.description': '配置后续派发使用的 Codex app-server，已运行的子任务不受影响。',
        'codex.model': '默认 Codex 模型（留空使用原生配置）',
        'codex.command': 'Codex CLI 路径（留空自动检测）',
        'codex.permissionPolicy': '子代理权限请求策略',
        'codex.permissionPolicy.main-session': '主会话审批（默认）',
        'codex.permissionPolicy.human': '人工审批',
        'codex.permissionPolicy.allow': '允许所有请求',
        'codex.permissionPolicy.reject': '拒绝所有请求',
        'codex.permissionPolicy.subagent': '子代理控制',
        'codex.subagentMode': '子代理控制等级',
        'codex.subagentMode.auto': 'auto —— 沿用下方 Codex 权限模式',
        'codex.subagentMode.full-access': 'full access —— 绕过审批与沙箱',
        'codex.subagentMode.ask-request': 'ask request —— 每次升级都送审',
        'codex.permissionMode': 'Codex 线程权限模式（拒绝所有与子代理 auto 时使用）',
        'codex.permissionMode.never': '不请求人工审批',
        'codex.permissionMode.approve-for-me': '自动审查并允许工作区写入',
        'codex.permissionMode.dangerously-bypass-approvals-and-sandbox': '绕过审批和沙箱（危险）',
        'codex.permissionWarning': '审批选择可能批准文件写入和 Shell 命令，但不是操作系统沙箱；请只在受信任工作区使用。',
        'codex.env': '环境变量覆盖（JSON 对象）',
        'codex.disposeGraceMs': '进程退出宽限（毫秒）',
        'acp.summary': '配置 Kimi 命令、ACP 参数、权限策略、环境变量和退出宽限时间。',
        'acp.title': 'Kimi Code ACP',
        'acp.description': '配置后续 ACP 派发使用的 Kimi Code 进程，已运行的子任务不受影响。',
        'acp.command': 'Kimi CLI 路径（留空自动检测）',
        'acp.model': '默认 Kimi 模型别名（留空使用原生配置）',
        'acp.args': 'ACP 启动参数（JSON 字符串数组）',
        'acp.permission': '子代理权限请求策略',
        'acp.permission.main-session': '主会话审批（默认）',
        'acp.permission.human': '人工审批',
        'acp.permission.allow': '允许所有请求',
        'acp.permission.reject': '拒绝所有请求',
        'acp.permission.subagent': '子代理控制',
        'acp.subagentMode': '子代理控制等级',
        'acp.subagentMode.auto': 'auto —— 子代理自动处理',
        'acp.subagentMode.full-access': 'full access —— 完全访问',
        'acp.subagentMode.ask-request': 'ask request —— 逐次询问送审',
        'acp.permissionWarning': '审批选择可能批准文件写入和 Shell 命令，但它不是操作系统沙箱；请只在受信任工作区使用。',
        'acp.env': '环境变量覆盖（JSON 对象）',
        'acp.envHint': '优先使用 Kimi 原生认证，仅在子任务明确需要时填写额外变量，避免写入密钥。',
        'acp.disposeEofGraceMs': 'stdin EOF 退出宽限（毫秒）',
        'acp.disposeGraceMs': 'SIGTERM 到 SIGKILL 宽限（毫秒）',
        'agy.summary': '配置 Antigravity 命令、ACP 参数、权限策略、环境变量和退出宽限时间。',
        'agy.title': 'Antigravity (agy)',
        'agy.description': '配置后续 ACP 派发使用的 Antigravity 进程，已运行的子任务不受影响。',
        'agy.command': 'Antigravity CLI 路径（留空自动检测）',
        'agy.commandRequired': 'Antigravity 可执行文件路径不能为空。',
        'agy.model': '默认 Antigravity 模型（留空使用原生配置）',
        'agy.args': 'ACP 启动参数（JSON 字符串数组）',
        'agy.permission': '子代理权限请求策略',
        'agy.permission.main-session': '主会话审批（默认）',
        'agy.permission.human': '人工审批',
        'agy.permission.allow': '允许所有请求',
        'agy.permission.reject': '拒绝所有请求',
        'agy.permission.subagent': '子代理控制',
        'agy.subagentMode': '子代理控制等级',
        'agy.subagentMode.auto': 'auto —— 子代理自动处理',
        'agy.subagentMode.full-access': 'full access —— 完全访问',
        'agy.subagentMode.ask-request': 'ask request —— 逐次询问送审',
        'agy.permissionWarning': '审批选择可能批准文件写入和 Shell 命令，但它不是操作系统沙箱；请只在受信任工作区使用。',
        'agy.env': '环境变量覆盖（JSON 对象）',
        'agy.envHint': '优先使用 Antigravity 原生认证，仅在子任务明确需要时填写额外变量，避免写入密钥。',
        'agy.disposeEofGraceMs': 'stdin EOF 退出宽限（毫秒）',
        'agy.disposeGraceMs': 'SIGTERM 到 SIGKILL 宽限（毫秒）',
        'common.save': '保存更改',
        'common.reset': '放弃编辑',
        'common.loading': '正在加载配置…',
        'common.unavailable': '配置暂不可用，请确认 Host 插件已启用。',
        'common.readonly': '当前连接只能读取配置。',
        'common.saving': '正在保存…',
        'common.success': '更改已保存。',
        'common.failure': '保存失败，请检查字段值和连接后重试。',
        'common.conflict': '配置已在其他位置更改，请放弃编辑以载入最新值。',
        'common.invalidJson': '启动参数和环境变量必须使用有效 JSON。',
        'common.invalidArgs': 'ACP 启动参数必须是只包含字符串的 JSON 数组。',
        'common.invalidEnv': '环境变量覆盖必须是值均为字符串的 JSON 对象。',
        'common.invalidNumber': '请输入允许范围内的整数。',
        'common.commandRequired': 'Kimi 可执行文件路径不能为空。',
        'common.routesRequired': '至少保留一条路由规则，并填写每条规则的提示词。',
        'common.modelPlaceholder': '选择或手动输入模型',
        'common.modelsLoading': '正在读取模型列表…',
        'common.modelsError': '模型列表读取失败，仍可手动输入模型。',
        'common.modelsPartial': '部分 Provider 读取失败，其他模型建议仍可使用。',
        'common.modelsReady': '模型建议已读取，也可手动输入。',
        'common.retryModels': '重新读取模型列表',
        'common.commandPlaceholder': '留空自动检测，或填写 CLI 的绝对路径',
      },
    }

    const CSS = `
.ma-settings{display:grid;gap:18px;max-width:1040px;color:inherit}
.ma-settings *{box-sizing:border-box}
.ma-section{display:grid;gap:14px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.ma-section h2{margin:0;font-size:17px;line-height:1.4}
.ma-section h3{margin:0;font-size:14px;line-height:1.4}
.ma-section p{margin:0;font-size:13px;line-height:1.55;opacity:.76}
.ma-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
.ma-field{display:grid;gap:6px;min-width:0;font-size:13px;line-height:1.4}
.ma-field>span{font-weight:500}
.ma-field input,.ma-field select,.ma-field textarea{width:100%;min-width:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit}
.ma-field textarea{min-height:84px;resize:vertical;line-height:1.5}
.ma-field textarea.ma-code{font-family:monospace;min-height:70px}
.ma-field input:focus-visible,.ma-field select:focus-visible,.ma-field textarea:focus-visible,.ma-settings button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ma-routes{display:grid;gap:12px}
.ma-route{display:grid;grid-template-columns:minmax(140px,.3fr) minmax(260px,1fr) auto;gap:12px;align-items:end;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.ma-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.ma-settings button{padding:8px 13px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;cursor:pointer}
.ma-settings button:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.ma-settings :disabled{opacity:.55;cursor:not-allowed}
.ma-error{color:var(--dsw-alias-state-error-primary)!important;opacity:1!important}
.ma-catalog{display:flex;align-items:center;gap:10px;font-size:12px;line-height:1.5;opacity:.76}
.ma-model-fields{padding-top:2px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:18px}
.ma-settings fieldset{min-width:0;margin:0;padding:0;border:0;display:grid;gap:18px}
@media(max-width:720px){.ma-route{grid-template-columns:1fr}.ma-route .ma-remove{justify-self:start}}
`

    function validationError(code) {
      const error = new Error(code)
      error.code = code
      return error
    }

    function parseJson(value) {
      try { return JSON.parse(value) } catch { throw validationError('common.invalidJson') }
    }

    function numberValue(value, min, max) {
      const number = Number(value)
      if (!Number.isInteger(number) || number < min || number > max) throw validationError('common.invalidNumber')
      return number
    }

    /** Convert only edited fields into revision-fenced Host settings operations. */
    function buildOperations(kind, edits) {
      return Object.entries(edits).map(([field, value]) => {
        if (field.startsWith('codex.') || field.startsWith('acp.') || field.startsWith('agy.')) {
          const [owner, ...parts] = field.split('.')
          const operation = buildOperations(owner, { [parts.join('.')]: value })[0]
          return { ...operation, path: [owner, ...operation.path] }
        }
        if (field === 'defaultAgent' || field === 'additionalInstructions' || field === 'taskPreamble') {
          return typeof value === 'string' && value.trim() === '' ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value }
        }
        if (field === 'model' || field === 'reasoningEffort' || field.startsWith('dsh.')) {
          const path = field.split('.')
          return typeof value === 'string' && value.trim() === '' ? { op: 'unset', path } : { op: 'set', path, value: typeof value === 'string' ? value.trim() : value }
        }
        if (field === 'timeoutSeconds') return { op: 'set', path: [field], value: numberValue(value, 1, 86400) }
        if (field === 'disposeEofGraceMs' || field === 'disposeGraceMs') return { op: 'set', path: [field], value: numberValue(value, 1, 2147483647) }
        if (field === 'command') {
          if (typeof value !== 'string') throw validationError('common.commandRequired')
          // Removing a user override reveals the package's auto-detected command.
          return value.trim() === '' ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value: value.trim() }
        }
        if (field === 'args') {
          const args = typeof value === 'string' ? parseJson(value) : value
          if (!Array.isArray(args) || args.some((item) => typeof item !== 'string')) throw validationError('common.invalidArgs')
          return { op: 'set', path: [field], value: args }
        }
        if (field === 'env') {
          const env = typeof value === 'string' ? parseJson(value) : value
          if (env === null || typeof env !== 'object' || Array.isArray(env) || Object.values(env).some((item) => typeof item !== 'string')) throw validationError('common.invalidEnv')
          return { op: 'set', path: [field], value: env }
        }
        if (field === 'routes') {
          if (!Array.isArray(value) || value.length === 0) throw validationError('common.routesRequired')
          const routes = value.map((route) => ({ agent: route.agent, prompt: typeof route.prompt === 'string' ? route.prompt.trim() : '' }))
          if (routes.some((route) => !['codex', 'kimi-code', 'agy', 'dsh'].includes(route.agent) || route.prompt === '')) throw validationError('common.routesRequired')
          return { op: 'set', path: [field], value: routes }
        }
        return { op: 'set', path: [field], value }
      })
    }

    function Field({ name, label, value, onChange, type = 'text', ...props }) {
      return h('label', { className: 'ma-field' },
        h('span', null, label),
        h('input', { name, type, value: value ?? '', onChange: (event) => onChange(event.target.value), ...props }))
    }

    function TextArea({ name, label, value, onChange, className = '', ...props }) {
      return h('label', { className: 'ma-field' },
        h('span', null, label),
        h('textarea', { name, className, value: value ?? '', onChange: (event) => onChange(event.target.value), ...props }))
    }

    function Select({ name, label, value, onChange, options }) {
      return h('label', { className: 'ma-field' },
        h('span', null, label),
        h('select', { name, value, onChange: (event) => onChange(event.target.value) },
          options.map((option) => h('option', { key: option.value, value: option.value }, option.label))))
    }

    function ModelField({ name, label, value, onChange, options, t, placeholder }) {
      const listId = `ma-models-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`
      return h('label', { className: 'ma-field' },
        h('span', null, label),
        h('input', {
          name, type: 'text', list: listId, value: value ?? '',
          placeholder: placeholder ?? t('common.modelPlaceholder'),
          onChange: (event) => onChange(event.target.value),
        }),
        h('datalist', { id: listId }, options.map((option) => h('option', {
          key: `${option.provider ?? ''}/${option.id}`,
          value: option.id,
          label: option.actualId && option.actualId !== option.name ? `${option.name} · ${option.actualId}` : option.name,
        }))))
    }

    function CatalogStatus({ catalog, onRetry, t }) {
      if (catalog.status === 'loading') return h('p', { className: 'ma-catalog', role: 'status' }, t('common.modelsLoading'))
      if (catalog.status === 'error') return h('p', { className: 'ma-catalog', role: 'status' },
        h('span', null, t('common.modelsError')),
        catalog.message ? h('span', { className: 'ma-error' }, catalog.message) : null,
        h('button', { name: 'retry-models', type: 'button', onClick: onRetry }, t('common.retryModels')))
      return h('p', { className: 'ma-catalog', role: 'status' },
        t(catalog.failures.length > 0 ? 'common.modelsPartial' : 'common.modelsReady'))
    }

    function RoutesEditor({ routes, onChange, t }) {
      const update = (index, field, next) => onChange(routes.map((route, position) => position === index ? { ...route, [field]: next } : route))
      return h('div', { className: 'ma-routes' },
        routes.map((route, index) => h('div', { className: 'ma-route', key: index },
          h(Select, {
            name: `route.${index}.agent`, label: `${t('router.routeAgent')} ${index + 1}`, value: route.agent,
            onChange: (value) => update(index, 'agent', value),
            options: AGENT_OPTIONS,
          }),
          h(TextArea, {
            name: `route.${index}.prompt`, label: t('router.routePrompt'), value: route.prompt,
            onChange: (value) => update(index, 'prompt', value), required: true,
          }),
          h('button', {
            name: `route.${index}.remove`, className: 'ma-remove', type: 'button', disabled: routes.length <= 1,
            onClick: () => onChange(routes.filter((_route, position) => position !== index)),
          }, t('router.removeRoute')))),
        h('div', null, h('button', {
          name: 'add-route', type: 'button',
          onClick: () => {
            const lastAgent = routes.at(-1)?.agent
            const nextAgent = AGENT_OPTIONS[(AGENT_OPTIONS.findIndex((option) => option.value === lastAgent) + 1) % AGENT_OPTIONS.length].value
            onChange([...routes, { agent: nextAgent, prompt: '' }])
          },
        }, t('router.addRoute'))))
    }

    // One editor over the existing namespaces: never rewrite or discard stored settings.
    // Each owner remains responsible for its schema and compare-and-set revision.
    function combinedForm(forms) {
      let lastKey, cached
      const read = () => Object.fromEntries(Object.entries(forms).map(([key, form]) => [key, form.getSnapshot()]))
      const revisionOf = (snapshots) => JSON.stringify(Object.fromEntries(Object.entries(snapshots).map(([key, s]) => [key, [s.revision, s.status, s.writable]])))
      const face = {
        savedFields: [],
        getSnapshot() {
          const snapshots = read()
          const revision = revisionOf(snapshots)
          if (revision === lastKey) return cached
          lastKey = revision
          cached = {
            revision, status: snapshots.router.status, writable: snapshots.router.writable,
            value: { ...snapshots.router.value, codex: snapshots.codex.value ?? {}, acp: snapshots.acp.value ?? {}, agy: snapshots.agy.value ?? {} },
            sections: Object.fromEntries(Object.entries(snapshots).map(([key, s]) => [key, s.status === 'ready' && s.writable])),
          }
          return cached
        },
        subscribe(listener) {
          const offs = Object.values(forms).map((form) => form.subscribe(() => { lastKey = undefined; listener() }))
          return () => offs.forEach((off) => off())
        },
        async mutate(operations, revision) {
          face.savedFields = []
          const snapshots = read()
          if (revisionOf(snapshots) !== revision) return false
          const groups = new Map()
          for (const op of operations) {
            const owner = ['codex', 'acp', 'agy'].includes(op.path[0]) ? op.path[0] : 'router'
            if (!groups.has(owner)) groups.set(owner, [])
            groups.get(owner).push({ original: op, local: { ...op, path: owner === 'router' ? op.path : op.path.slice(1) } })
          }
          let ok = true
          for (const [owner, entries] of groups) {
            const snapshot = snapshots[owner]
            if (snapshot.status !== 'ready' || !snapshot.writable) { ok = false; continue }
            try {
              const accepted = await forms[owner].mutate(entries.map((entry) => entry.local), snapshot.revision)
              if (accepted) face.savedFields.push(...entries.map((entry) => entry.original.path.join('.')))
              else ok = false
            } catch { ok = false }
          }
          lastKey = undefined
          return ok
        },
      }
      return face
    }

    function ConfigForm({ form, t, loadCatalogs }) {
      const kind = 'unified'
      const [snapshot, setSnapshot] = useState(() => form.getSnapshot())
      const [edits, setEdits] = useState({})
      const [result, setResult] = useState('')
      const [busy, setBusy] = useState(false)
      const baseline = useRef(null)
      const saving = useRef(false)
      const mounted = useRef(false)
      const catalogGeneration = useRef({ dsh: 0, codex: 0, acp: 0, agy: 0 })
      const [catalogs, setCatalogs] = useState(() => Object.fromEntries(['dsh', 'codex', 'acp', 'agy'].map((key) => [key, { status: 'loading', groups: [], failures: [] }])))
      const reloadCatalog = async (key) => {
        const generation = ++catalogGeneration.current[key]
        const update = (next) => {
          if (generation === catalogGeneration.current[key]) setCatalogs((current) => ({ ...current, [key]: next }))
        }
        update({ status: 'loading', groups: [], failures: [] })
        try {
          const value = await loadCatalogs[key]()
          update({ status: 'ready', groups: value.groups ?? [], failures: value.failures ?? [] })
        } catch {
          update({ status: 'error', groups: [], failures: [] })
        }
      }
      useEffect(() => {
        mounted.current = true
        const update = () => setSnapshot(form.getSnapshot())
        const off = form.subscribe(update)
        update()
        return () => { mounted.current = false; off() }
      }, [form])
      useEffect(() => {
        for (const key of ['dsh', 'codex', 'acp', 'agy']) reloadCatalog(key)
        return () => { for (const key of ['dsh', 'codex', 'acp', 'agy']) catalogGeneration.current[key] += 1 }
      }, [loadCatalogs])
      const value = baseline.current?.value || snapshot.value || {}
      const get = (field, fallback = '') => {
        if (Object.hasOwn(edits, field)) return edits[field]
        return field.split('.').reduce((current, part) => current?.[part], value) ?? fallback
      }
      const getJson = (field, fallback) => Object.hasOwn(edits, field) ? edits[field] : JSON.stringify(get(field, fallback), null, 2)
      const change = (field, next) => {
        if (saving.current || snapshot.status !== 'ready' || !snapshot.writable) return
        if (!baseline.current) baseline.current = snapshot
        setEdits((current) => ({ ...current, [field]: next }))
        setResult('')
      }
      const discardEdit = (field) => {
        if (saving.current || snapshot.status !== 'ready' || !snapshot.writable) return
        setEdits((current) => {
          if (!Object.hasOwn(current, field)) return current
          const next = { ...current }
          delete next[field]
          return next
        })
      }
      const reset = () => {
        baseline.current = null
        setSnapshot(form.getSnapshot())
        setEdits({})
        setResult('')
      }
      const conflict = baseline.current !== null && baseline.current.revision !== snapshot.revision
      const disabled = busy || !snapshot.writable || conflict
      const save = async (event) => {
        event.preventDefault()
        const current = form.getSnapshot()
        if (saving.current || Object.keys(edits).length === 0 || current.status !== 'ready' || !current.writable) return
        if (!baseline.current || baseline.current.revision !== current.revision) {
          setSnapshot(current)
          setResult('common.conflict')
          return
        }
        let operations
        try { operations = buildOperations(kind, edits) } catch (error) {
          setResult(error.code || 'common.failure')
          return
        }
        saving.current = true
        setBusy(true)
        setResult('')
        try {
          const ok = await form.mutate(operations, baseline.current.revision)
          if (!mounted.current) return
          const currentSnapshot = form.getSnapshot()
          if (ok) {
            baseline.current = null
            setEdits({})
          } else {
            const remaining = Object.fromEntries(Object.entries(edits).filter(([key]) => !form.savedFields.includes(key)))
            setEdits(remaining)
            baseline.current = currentSnapshot
          }
          setSnapshot(currentSnapshot)
          setResult(ok ? 'common.success' : 'unified.partial')
        } catch {
          if (mounted.current) setResult('common.failure')
        } finally {
          saving.current = false
          if (mounted.current) setBusy(false)
        }
      }
      if (snapshot.status !== 'ready') return h('div', { className: 'ma-settings', role: 'status' }, h('style', null, CSS), t(snapshot.status === 'loading' ? 'common.loading' : 'common.unavailable'))

      const catalog = catalogs.dsh
      const dshProvider = get('dsh.defaultProvider', '')
      const dshModels = catalog.groups.filter((group) => !dshProvider || group.id === dshProvider)
        .flatMap((group) => group.models.map((model) => ({ ...model, provider: group.id })))
      const dshEfforts = dshModels.find((model) => model.id === get('dsh.defaultModel', ''))?.reasoning?.efforts ?? []
      const changeModel = (key, next) => {
        change(key, next)
        change(key === 'dsh.defaultModel' ? 'dsh.defaultReasoningEffort' : key.replace(/model$/, 'reasoningEffort'), '')
      }
      const externalModelCard = (owner, title) => {
        const options = catalogs[owner].groups.flatMap((group) => group.models.map((model) => ({ ...model, provider: group.id })))
        const efforts = options.find((model) => model.id === get(`${owner}.model`, ''))?.reasoning?.efforts ?? []
        const available = snapshot.sections[owner]
        return h('fieldset', { key: owner, className: 'ma-model-fields', disabled: !available },
          h('h3', null, title),
          !available ? h('p', { role: 'status' }, t('unified.disabled')) : null,
          h('div', { className: 'ma-fields' },
            h(ModelField, { name: `${owner}.model`, label: t(`${owner}.model`), value: get(`${owner}.model`, ''), onChange: (next) => changeModel(`${owner}.model`, next), options, t }),
            h(ModelField, { name: `${owner}.reasoningEffort`, label: t('unified.effort'), placeholder: t('unified.effort'), value: get(`${owner}.reasoningEffort`, ''), onChange: (next) => change(`${owner}.reasoningEffort`, next), options: efforts, t }),
            h(Field, { name: `${owner}.command`, label: t(`${owner}.command`), placeholder: t('common.commandPlaceholder'), value: get(`${owner}.command`, ''), onChange: (next) => change(`${owner}.command`, next) })),
          h(CatalogStatus, { catalog: catalogs[owner], onRetry: () => reloadCatalog(owner), t }))
      }
      const permissionPolicyFields = (owner, field = 'permission') => {
        const policy = get(`${owner}.${field}`, 'main-session')
        const modeField = `${owner}.subagentPermissionMode`
        return [
          h(Select, { name: `${owner}.${field}`, label: t(`${owner}.${field}`), value: policy, onChange: (next) => {
            change(`${owner}.${field}`, next)
            // A level edit only makes sense under the sub-agent policy; drop
            // unsaved leftovers when switching away so a hidden field never
            // commits (especially a saved full-access surprise).
            if (next !== 'subagent') discardEdit(modeField)
          }, options: ['main-session', 'human', 'allow', 'reject', 'subagent'].map((value) => ({ value, label: t(`${owner}.${field}.${value}`) })) }),
          ...(policy === 'subagent' ? [h(Select, { name: modeField, label: t(`${owner}.subagentMode`), value: get(modeField, 'auto'), onChange: (next) => change(modeField, next), options: ['auto', 'full-access', 'ask-request'].map((value) => ({ value, label: t(`${owner}.subagentMode.${value}`) })) })] : []),
        ]
      }
      const acpRuntimeCard = (owner, title) => h('fieldset', { disabled: !snapshot.sections[owner] },
        h('h3', null, title),
        h('div', { className: 'ma-fields' },
          ...permissionPolicyFields(owner),
          h(Field, { name: `${owner}.disposeEofGraceMs`, label: t(`${owner}.disposeEofGraceMs`), type: 'number', min: 1, max: 2147483647, step: 1, value: get(`${owner}.disposeEofGraceMs`, 6000), onChange: (next) => change(`${owner}.disposeEofGraceMs`, next) }),
          h(Field, { name: `${owner}.disposeGraceMs`, label: t(`${owner}.disposeGraceMs`), type: 'number', min: 1, max: 2147483647, step: 1, value: get(`${owner}.disposeGraceMs`, 3000), onChange: (next) => change(`${owner}.disposeGraceMs`, next) })),
        h(TextArea, { name: `${owner}.args`, className: 'ma-code', label: t(`${owner}.args`), value: getJson(`${owner}.args`, ['acp']), onChange: (next) => change(`${owner}.args`, next) }),
        h('p', null, t(`${owner}.permissionWarning`)),
        h(TextArea, { name: `${owner}.env`, className: 'ma-code', label: t(`${owner}.env`), value: getJson(`${owner}.env`, {}), onChange: (next) => change(`${owner}.env`, next) }),
        h('p', null, t(`${owner}.envHint`)))
      return h('form', { className: 'ma-settings', onSubmit: save, 'aria-label': t('unified.title') },
        h('style', null, CSS),
        h('header', null, h('h2', null, t('unified.title')), h('p', null, t('unified.description'))),
        !snapshot.writable ? h('p', { role: 'status' }, t('common.readonly')) : null,
        h('fieldset', { disabled },
          h('section', { className: 'ma-section' },
            h('h2', null, t('unified.models')),
            h('p', null, t('unified.effortHint')),
            h('div', { className: 'ma-model-fields' },
              h('h3', null, 'DSH'),
              h('div', { className: 'ma-fields' },
                h(ModelField, { name: 'dsh.defaultProvider', label: t('router.dsh.defaultProvider'), value: dshProvider, onChange: (next) => { change('dsh.defaultProvider', next); changeModel('dsh.defaultModel', '') }, options: catalog.groups.map((group) => ({ id: group.id, name: group.name })), t }),
                h(ModelField, { name: 'dsh.defaultModel', label: t('router.dsh.defaultModel'), value: get('dsh.defaultModel', ''), onChange: (next) => changeModel('dsh.defaultModel', next), options: dshModels, t }),
                h(ModelField, { name: 'dsh.defaultReasoningEffort', label: t('unified.effort'), placeholder: t('unified.effort'), value: get('dsh.defaultReasoningEffort', ''), onChange: (next) => change('dsh.defaultReasoningEffort', next), options: dshEfforts, t })),
              h(CatalogStatus, { catalog, onRetry: () => reloadCatalog('dsh'), t }),
              h('p', null, t('router.modelHint'))),
            externalModelCard('codex', 'Codex'), externalModelCard('acp', 'Kimi Code'), externalModelCard('agy', t('agy.title'))),
          h('section', { className: 'ma-section' },
            h('h2', null, t('router.policy')),
            h('div', { className: 'ma-fields' },
              h(Select, { name: 'selectionMode', label: t('router.selectionMode'), value: get('selectionMode', 'auto'), onChange: (next) => change('selectionMode', next), options: ['auto', 'ask-if-ambiguous', 'always-ask'].map((mode) => ({ value: mode, label: t(`router.selectionMode.${mode}`) })) }),
              h(Select, { name: 'defaultAgent', label: t('router.defaultAgent'), value: get('defaultAgent', ''), onChange: (next) => change('defaultAgent', next), options: [{ value: '', label: t('router.noDefault') }, ...AGENT_OPTIONS] }),
              h(Field, { name: 'timeoutSeconds', label: t('router.timeoutSeconds'), type: 'number', min: 1, max: 86400, step: 1, required: true, value: get('timeoutSeconds', 1800), onChange: (next) => change('timeoutSeconds', next) })),
            h('h3', null, t('router.routes')), h('p', null, t('router.routesHint')),
            h(RoutesEditor, { routes: get('routes', []), onChange: (next) => change('routes', next), t }),
            h(TextArea, { name: 'additionalInstructions', label: t('router.additionalInstructions'), value: get('additionalInstructions', ''), onChange: (next) => change('additionalInstructions', next) }),
            h(TextArea, { name: 'taskPreamble', label: t('router.taskPreamble'), value: get('taskPreamble', ''), onChange: (next) => change('taskPreamble', next) })),
          h('section', { className: 'ma-section' },
            h('h2', null, t('unified.runtime')),
            h('fieldset', { disabled: !snapshot.sections.codex },
              h('h3', null, 'Codex'),
              h('div', { className: 'ma-fields' },
                ...permissionPolicyFields('codex', 'permissionPolicy'),
                h(Select, { name: 'codex.permissionMode', label: t('codex.permissionMode'), value: get('codex.permissionMode', 'approve-for-me'), onChange: (next) => change('codex.permissionMode', next), options: ['never', 'approve-for-me', 'dangerously-bypass-approvals-and-sandbox'].map((mode) => ({ value: mode, label: t(`codex.permissionMode.${mode}`) })) }),
                h(Field, { name: 'codex.disposeGraceMs', label: t('codex.disposeGraceMs'), type: 'number', min: 1, max: 2147483647, step: 1, value: get('codex.disposeGraceMs', 3000), onChange: (next) => change('codex.disposeGraceMs', next) })),
              h('p', null, t('codex.permissionWarning')),
              h(TextArea, { name: 'codex.env', className: 'ma-code', label: t('codex.env'), value: getJson('codex.env', {}), onChange: (next) => change('codex.env', next) })),
            acpRuntimeCard('acp', 'Kimi Code'), acpRuntimeCard('agy', t('agy.title')))),
        h('div', { className: 'ma-actions' },
          h('button', { type: 'submit', disabled: disabled || Object.keys(edits).length === 0 }, t(busy ? 'common.saving' : 'common.save')),
          h('button', { type: 'button', disabled: busy || Object.keys(edits).length === 0, onClick: reset }, t('common.reset'))),
        (conflict || result) && !busy ? h('p', {
          role: result === 'common.failure' || result === 'common.conflict' || result.startsWith('common.invalid') || result === 'common.commandRequired' || result === 'agy.commandRequired' || result === 'common.routesRequired' || conflict ? 'alert' : 'status',
          className: result === 'common.failure' || result === 'common.conflict' || result.startsWith('common.invalid') || result === 'common.commandRequired' || result === 'agy.commandRequired' || result === 'common.routesRequired' || conflict ? 'ma-error' : undefined,
        }, t(conflict ? 'common.conflict' : result)) : null)
    }

    async function loadExternalCatalog(kind) {
      const response = await fetch(`/multi-agent/model-catalog/${kind}`, { credentials: 'same-origin' })
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error(payload.error?.detail || payload.error?.message || 'catalog-unavailable')
      return payload.value
    }

    return {
      inject: ['slots', 'locale', 'configForms', 'remote', 'remote.session'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'multi-agent: dictionaries')
        const t = ctx.locale.bind(NS)
        const form = combinedForm({
          router: ctx.configForms.get('multi-agent-router'),
          codex: ctx.configForms.get('codex-provider'),
          acp: ctx.configForms.get('kimi-code-acp'),
          agy: ctx.configForms.get('agy-acp'),
        })
        const loadCatalogs = {
          dsh: async () => {
            const response = await ctx.remote.session.modelCatalog()
            if (!response.ok) throw new Error('catalog-unavailable')
            return response.value
          },
          codex: () => loadExternalCatalog('codex'),
          acp: () => loadExternalCatalog('kimi-code'),
          agy: () => loadExternalCatalog('agy'),
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'multi-agent-dispatch', order: 12,
          locale: NS, label: () => t('unified.title'),
          inject: () => ({ form, loadCatalogs }),
        }, ConfigForm))
      },
    }
  },
})
