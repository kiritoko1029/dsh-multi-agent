window.__ModuleLoader__.load({
  id: '@kiritoko1029/dsh-multi-agent',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React
    const NS = '@kiritoko1029/dsh-multi-agent'
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
        'codex.permissionPolicy.main-session': 'Main session / inherit full access (default)',
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
        'acp.permission.main-session': 'Main session / inherit full access (default)',
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
        'agy.permission.main-session': 'Main session / inherit full access (default)',
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
        'common.modelsErrorReason.auth': 'The CLI is not signed in. Sign in from a terminal first (agy: agy acp --login), then retry.',
        'common.modelsErrorReason.timeout': 'The CLI did not answer in time. Retry, or check that it starts normally in a terminal.',
        'common.modelsErrorReason.missing': 'The CLI executable was not found. Enter its absolute path under Runtime options.',
        'common.modelsErrorReason.forbidden': 'Model list access was refused. Open this page from the local DSH app.',
        'common.modelsErrorReason.unavailable': 'The CLI returned no model catalog. Check its version, or enter a model manually.',
        'common.modelsPartial': 'Some model providers could not be loaded; other suggestions remain available.',
        'common.modelsReady': 'Model suggestions loaded. Manual entries are also allowed.',
        'common.retryModels': 'Retry model list',
        'common.commandPlaceholder': 'Leave blank for auto-detection, or enter an absolute CLI path',
        'common.proxyMode': 'Network proxy',
        'common.proxyMode.system': 'Follow system proxy',
        'common.proxyMode.none': 'No proxy',
        'common.proxyMode.custom': 'Custom address',
        'common.proxyUrl': 'Proxy address',
        'common.proxyUrlPlaceholder': 'http://127.0.0.1:7890',
        'common.proxyHint': 'External CLIs read only environment proxies. "Follow system proxy" injects the OS proxy as HTTP(S)_PROXY; a custom address overrides it.',
        'common.invalidProxyUrl': 'Enter a proxy address such as http://127.0.0.1:7890.',
        'header.tooltip': 'Open multi-agent dispatch settings',
        'modal.close': 'Close',
        'modal.closeAria': 'Close multi-agent dispatch settings',
        'modal.navAria': 'Settings sections',
        'modal.nav.all': 'All settings',
        'modal.nav.models': 'Models & reasoning',
        'modal.nav.policy': 'Dispatch policy & rules',
        'modal.nav.runtime': 'Runtime options',
        'modal.unsavedBadge': 'Unsaved edits',
        'modal.unsavedTitle': 'Unsaved changes',
        'modal.unsavedConfirm': 'You have unsaved changes. Save before closing, discard edits, or continue editing.',
        'modal.continueEditing': 'Continue editing',
        'modal.saveAndClose': 'Save & close',
        'modal.discardAndClose': 'Discard & close',
        'modal.statusHeading': 'Providers',
        'modal.statusAvailable': 'Ready',
        'modal.statusUnavailable': 'Unavailable',
        'modal.statusReadonly': 'Read-only',
        'modal.modelsDescription': 'Default models, reasoning effort, and CLI executable paths for each backend.',
        'modal.policyDescription': 'Choose how the main agent selects backends, fallback behavior, timeout, and prompt rules.',
        'modal.runtimeDescription': 'Configure permission policies, shutdown grace periods, ACP arguments, and environment overrides.',
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
        'codex.permissionPolicy.main-session': '主会话审批 / 继承完全权限（默认）',
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
        'acp.permission.main-session': '主会话审批 / 继承完全权限（默认）',
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
        'agy.permission.main-session': '主会话审批 / 继承完全权限（默认）',
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
        'common.modelsErrorReason.auth': 'CLI 未登录：请先在终端登录（agy 运行 agy acp --login），再点重试。',
        'common.modelsErrorReason.timeout': 'CLI 响应超时：请重试，或确认它能在终端正常启动。',
        'common.modelsErrorReason.missing': '找不到 CLI 可执行文件：请在「运行参数」中填写绝对路径。',
        'common.modelsErrorReason.forbidden': '无权读取模型列表：请从本机 DSH 页面打开设置。',
        'common.modelsErrorReason.unavailable': 'CLI 未返回模型目录：请检查版本，或手动输入模型。',
        'common.modelsPartial': '部分 Provider 读取失败，其他模型建议仍可使用。',
        'common.modelsReady': '模型建议已读取，也可手动输入。',
        'common.retryModels': '重新读取模型列表',
        'common.commandPlaceholder': '留空自动检测，或填写 CLI 的绝对路径',
        'common.proxyMode': '网络代理',
        'common.proxyMode.system': '跟随系统代理',
        'common.proxyMode.none': '不使用代理',
        'common.proxyMode.custom': '自定义地址',
        'common.proxyUrl': '代理地址',
        'common.proxyUrlPlaceholder': 'http://127.0.0.1:7890',
        'common.proxyHint': '外部 CLI 只认环境变量代理：「跟随系统代理」会把系统代理注入 HTTP(S)_PROXY，自定义地址则覆盖它。',
        'common.invalidProxyUrl': '代理地址需形如 http://127.0.0.1:7890。',
        'header.tooltip': '打开多 Agent 派发设置',
        'modal.close': '关闭',
        'modal.closeAria': '关闭多 Agent 派发设置',
        'modal.navAria': '设置分组',
        'modal.nav.all': '全部设置',
        'modal.nav.models': '模型与思考强度',
        'modal.nav.policy': '派发策略与规则',
        'modal.nav.runtime': '运行参数',
        'modal.unsavedBadge': '有未保存更改',
        'modal.unsavedTitle': '存在未保存的更改',
        'modal.unsavedConfirm': '当前有未保存的更改。请在关闭前保存、放弃更改，或继续编辑。',
        'modal.continueEditing': '继续编辑',
        'modal.saveAndClose': '保存并关闭',
        'modal.discardAndClose': '放弃并关闭',
        'modal.statusHeading': 'Agent 状态',
        'modal.statusAvailable': '可用',
        'modal.statusUnavailable': '不可用',
        'modal.statusReadonly': '只读',
        'modal.modelsDescription': '为每个执行后端配置默认模型、思考强度与 CLI 可执行路径。',
        'modal.policyDescription': '配置主 Agent 选择后端的策略、兜底方案、超时时间及路由规则。',
        'modal.runtimeDescription': '配置各外部后端的权限策略、进程退出宽限、启动参数与环境变量。',
      },
    }

    const HEADER_CSS = `
.ma-header-utility{display:inline-flex;align-items:center;flex:0 0 auto;min-width:0}
.ma-header-utility *{box-sizing:border-box}
.ma-header-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;min-width:0;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;-webkit-app-region:no-drag;transition:border-color 150ms ease,background-color 150ms ease,color 150ms ease}
.ma-header-btn:hover{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.ma-header-btn[aria-expanded="true"]{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary)}
.ma-header-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ma-header-icon{width:14px;height:14px;flex:0 0 auto}
.ma-header-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:540px){.ma-header-btn{padding:0 8px;gap:5px;font-size:11px;max-width:148px}}
`

    const MODAL_CSS = `
.ma-overlay-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 72%,transparent);backdrop-filter:blur(4px);color:var(--dsw-alias-label-primary)}
.ma-overlay-backdrop *{box-sizing:border-box}
.ma-modal{display:flex;flex-direction:column;width:min(1180px,calc(100vw - 48px));height:min(85vh,920px);max-height:calc(100vh - 32px);min-width:0;min-height:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);pointer-events:auto;outline:none}
.ma-modal-form{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0;height:100%}
.ma-modal-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex:0 0 auto;padding:18px 22px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.ma-modal-heading{display:grid;gap:4px;min-width:0}
.ma-modal-title-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ma-modal-header h2{margin:0;font-size:18px;font-weight:650;line-height:1.35;color:var(--dsw-alias-label-primary)}
.ma-modal-header p{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.ma-modal-close{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:32px;height:32px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;transition:border-color 150ms ease,background-color 150ms ease}
.ma-modal-close:hover{border-color:var(--dsw-alias-brand-primary)}
.ma-modal-close svg{width:16px;height:16px}
.ma-unsaved-banner{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;flex:0 0 auto;padding:10px 22px;border-bottom:1px solid var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:1.45}
.ma-unsaved-copy{color:var(--dsw-alias-label-primary);font-weight:500}
.ma-unsaved-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ma-modal-body{display:grid;grid-template-columns:224px minmax(0,1fr);flex:1 1 auto;min-width:0;min-height:0;overflow:hidden}
.ma-modal-status-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:24px;display:grid;place-items:center;text-align:center;color:var(--dsw-alias-label-secondary);font-size:14px}
.ma-modal-nav{display:flex;flex-direction:column;gap:14px;min-width:0;min-height:0;padding:16px 14px;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);overflow-y:auto}
.ma-nav-list{display:grid;gap:6px}
.ma-nav-btn{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:9px 11px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;text-align:left;cursor:pointer;transition:border-color 150ms ease,background-color 150ms ease,color 150ms ease}
.ma-nav-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.ma-nav-btn[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.ma-dirty-dot{width:7px;height:7px;flex:0 0 auto;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}
.ma-provider-list{display:grid;gap:6px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.ma-provider-list-title{margin:0;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em;text-transform:uppercase}
.ma-provider-item{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ma-provider-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.ma-badge{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:11px;font-weight:500;line-height:1.4;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ma-badge[data-tone="ready"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-border-l2)}
.ma-badge[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.ma-badge[data-tone="idle"]{color:var(--dsw-alias-state-idle-primary)}
.ma-modal-scroll{min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:20px 24px 24px;display:grid;align-content:start;gap:20px}
.ma-settings{display:grid;gap:20px;min-width:0;color:inherit}
.ma-settings>.ma-outer-fieldset{min-width:0;margin:0;padding:0;border:0;display:grid;gap:20px}
.ma-section{display:grid;gap:16px;padding:18px 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.ma-section-head{display:grid;gap:4px}
.ma-section h2,.ma-section h3{margin:0;color:var(--dsw-alias-label-primary)}
.ma-section h2{font-size:16px;font-weight:650;line-height:1.4}
.ma-section h3{font-size:14px;font-weight:600;line-height:1.4}
.ma-section p{margin:0;font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.ma-model-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.ma-runtime-grid{display:grid;grid-template-columns:1fr;gap:14px}
.ma-card{display:grid;align-content:start;gap:12px;min-width:0;margin:0;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.ma-card-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.ma-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.ma-two-col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.ma-field{display:grid;gap:6px;min-width:0;font-size:13px;line-height:1.4}
.ma-field>span{font-weight:500;color:var(--dsw-alias-label-primary)}
.ma-field input,.ma-field select,.ma-field textarea{width:100%;min-width:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
.ma-field textarea{min-height:84px;resize:vertical;line-height:1.5}
.ma-field textarea.ma-code{font-family:monospace;min-height:74px}
.ma-field input:focus-visible,.ma-field select:focus-visible,.ma-field textarea:focus-visible,.ma-modal button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ma-routes{display:grid;gap:10px}
.ma-route{display:grid;grid-template-columns:minmax(150px,.28fr) minmax(240px,1fr) auto;gap:12px;align-items:end;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.ma-modal button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 13px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;transition:border-color 150ms ease,background-color 150ms ease,color 150ms ease}
.ma-modal button:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.ma-modal .ma-btn-primary{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.ma-modal :disabled{opacity:.55;cursor:not-allowed}
.ma-error{color:var(--dsw-alias-state-error-primary)!important;opacity:1!important}
.ma-success{color:var(--dsw-alias-state-success-primary)!important;opacity:1!important}
.ma-readonly-banner{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:13px}
.ma-catalog{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.ma-modal-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 16px;flex:0 0 auto;padding:12px 22px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.ma-footer-status{flex:1 1 240px;min-width:0;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.ma-footer-status p{margin:0}
.ma-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-left:auto}
@media(max-width:920px){.ma-model-grid,.ma-two-col{grid-template-columns:1fr}.ma-modal-body{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.ma-modal-nav{flex-direction:row;align-items:center;overflow-x:auto;padding:10px 14px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.ma-nav-list{display:flex;flex:1 0 auto;gap:6px}.ma-nav-btn{width:auto;white-space:nowrap;padding:7px 11px}.ma-provider-list{display:none}}
@media(max-width:680px){.ma-overlay-backdrop{padding:8px}.ma-modal{width:calc(100vw - 16px);height:calc(100vh - 16px);max-height:calc(100vh - 16px);border-radius:12px}.ma-modal-header{padding:14px 16px 12px}.ma-modal-scroll{padding:14px 16px 18px}.ma-modal-footer{padding:10px 16px}.ma-route{grid-template-columns:1fr}.ma-route .ma-remove{justify-self:start}}
@media(prefers-reduced-motion:reduce){.ma-overlay-backdrop *,.ma-header-utility *{transition:none!important}}
`

    function validationError(code, field) {
      const error = new Error(code)
      error.code = code
      if (field) error.field = field
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

    function sectionForField(field) {
      if (!field) return 'all'
      if (field.startsWith('dsh.') || field.endsWith('.model') || field.endsWith('.reasoningEffort') || field.endsWith('.command')) return 'models'
      if (['selectionMode', 'defaultAgent', 'timeoutSeconds', 'routes', 'additionalInstructions', 'taskPreamble'].includes(field)) return 'policy'
      return 'runtime'
    }

    /** Convert only edited fields into revision-fenced Host settings operations. */
    function buildOperations(kind, edits) {
      return Object.entries(edits).map(([field, value]) => {
        try {
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
            if (typeof value !== 'string') throw validationError('common.commandRequired', field)
            // Removing a user override reveals the package's auto-detected command.
            return value.trim() === '' ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value: value.trim() }
          }
          if (field === 'args') {
            const args = typeof value === 'string' ? parseJson(value) : value
            if (!Array.isArray(args) || args.some((item) => typeof item !== 'string')) throw validationError('common.invalidArgs', field)
            return { op: 'set', path: [field], value: args }
          }
          if (field === 'env') {
            const env = typeof value === 'string' ? parseJson(value) : value
            if (env === null || typeof env !== 'object' || Array.isArray(env) || Object.values(env).some((item) => typeof item !== 'string')) throw validationError('common.invalidEnv', field)
            return { op: 'set', path: [field], value: env }
          }
          if (field === 'proxyMode') {
            if (!['system', 'none', 'custom'].includes(value)) throw validationError('common.failure', field)
            return { op: 'set', path: [field], value }
          }
          if (field === 'proxyUrl') {
            if (typeof value !== 'string') throw validationError('common.invalidProxyUrl', field)
            const address = value.trim()
            if (address === '') return { op: 'unset', path: [field] }
            // The Client sandbox has no URL constructor; accept an optional
            // scheme plus host[:port] and let the Host normalise it.
            if (!/^(?:[a-z][a-z0-9+.-]*:\/\/)?[a-z0-9.-]+(?::\d{1,5})?\/?$/i.test(address)) throw validationError('common.invalidProxyUrl', field)
            return { op: 'set', path: [field], value: address }
          }
          if (field === 'routes') {
            if (!Array.isArray(value) || value.length === 0) throw validationError('common.routesRequired', field)
            const routes = value.map((route) => ({ agent: route.agent, prompt: typeof route.prompt === 'string' ? route.prompt.trim() : '' }))
            if (routes.some((route) => !['codex', 'kimi-code', 'agy', 'dsh'].includes(route.agent) || route.prompt === '')) throw validationError('common.routesRequired', field)
            return { op: 'set', path: [field], value: routes }
          }
          return { op: 'set', path: [field], value }
        } catch (error) {
          if (error && typeof error === 'object') error.field = field
          throw error
        }
      })
    }

    function HeaderIcon() {
      const paths = ['M4 6h16', 'M4 12h16', 'M4 18h16', 'M9 4v4', 'M15 10v4', 'M11 16v4']
      return h('svg', {
        className: 'ma-header-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, paths.map((d) => h('path', { key: d, d })))
    }

    function CloseIcon() {
      return h('svg', {
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, [
        h('path', { key: 'a', d: 'M6 6l12 12' }),
        h('path', { key: 'b', d: 'M18 6L6 18' }),
      ])
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

    const CATALOG_REASONS = new Set(['auth', 'timeout', 'missing', 'forbidden', 'unavailable'])

    function CatalogStatus({ catalog, onRetry, t }) {
      if (catalog.status === 'loading') return h('p', { className: 'ma-catalog', role: 'status' }, t('common.modelsLoading'))
      if (catalog.status === 'error') return h('p', { className: 'ma-catalog', role: 'status' },
        h('span', null, t('common.modelsError')),
        h('span', { className: 'ma-error' }, t(`common.modelsErrorReason.${CATALOG_REASONS.has(catalog.reason) ? catalog.reason : 'unavailable'}`)),
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
            availability: Object.fromEntries(Object.entries(snapshots).map(([key, s]) => [key, s.status === 'ready'])),
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

    function createDispatchModalStore() {
      let open = false
      let trigger = null
      const listeners = new Set()
      const notify = () => {
        for (const listener of [...listeners]) listener()
      }
      return {
        getSnapshot: () => open,
        getTrigger: () => trigger,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        open(triggerElement) {
          if (triggerElement) trigger = triggerElement
          else if (typeof document !== 'undefined') trigger = document.activeElement
          if (open) return
          open = true
          notify()
        },
        close() {
          if (!open) return
          open = false
          notify()
        },
        clearTrigger() {
          trigger = null
        },
        dispose() {
          open = false
          trigger = null
          listeners.clear()
        },
      }
    }

    function useDispatchModalOpen(store) {
      const [open, setOpen] = useState(() => store.getSnapshot())
      useEffect(() => {
        setOpen(store.getSnapshot())
        return store.subscribe(() => setOpen(store.getSnapshot()))
      }, [store])
      return open
    }

    const FOCUSABLE_SELECTOR = 'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])'
    function isElementVisible(element) {
      if (!element || element.disabled) return false
      if (typeof element.closest === 'function' && element.closest('[hidden]')) return false
      if (typeof getComputedStyle === 'function') {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') return false
      }
      return true
    }

    function getFocusableElements(container) {
      if (!container || typeof container.querySelectorAll !== 'function') return []
      return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(isElementVisible)
    }

    function firstFocusable(container) {
      return getFocusableElements(container)[0] || null
    }

    function trapTabInDialog(dialog, event) {
      if (!dialog) return
      const focusables = getFocusableElements(dialog)
      if (focusables.length === 0) {
        event.preventDefault?.()
        dialog.focus?.()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = typeof document !== 'undefined' ? document.activeElement : null
      const inside = typeof dialog.contains === 'function' ? dialog.contains(active) : true
      if (!inside) {
        event.preventDefault?.()
        ;(event.shiftKey ? last : first).focus?.()
      } else if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault?.()
        last.focus?.()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault?.()
        first.focus?.()
      }
    }

    function HeaderDispatchButton({ store, t }) {
      const open = useDispatchModalOpen(store)
      const buttonRef = useRef(null)
      const label = t('unified.title')
      return h('span', { className: 'ma-header-utility' },
        h('style', null, HEADER_CSS),
        h('button', {
          ref: buttonRef,
          type: 'button',
          name: 'multi-agent-dispatch-trigger',
          className: 'ma-header-btn',
          title: t('header.tooltip'),
          'aria-label': label,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          onClick: () => store.open(buttonRef.current),
        },
        h(HeaderIcon),
        h('span', { className: 'ma-header-label' }, label)))
    }

    const MODAL_TITLE_ID = 'ma-dispatch-modal-title'
    const MODAL_DESC_ID = 'ma-dispatch-modal-desc'

    function ConfigForm({ form, t, loadCatalogs, onClose, dialogRef, closeButtonRef, attemptCloseRef }) {
      const kind = 'unified'
      const [snapshot, setSnapshot] = useState(() => form.getSnapshot())
      const [edits, setEdits] = useState({})
      const [result, setResult] = useState('')
      const [busy, setBusy] = useState(false)
      const [activeSection, setActiveSection] = useState('all')
      const [confirmClose, setConfirmClose] = useState(false)
      const baseline = useRef(null)
      const saving = useRef(false)
      const mounted = useRef(false)
      const continueButtonRef = useRef(null)
      const wasConfirmClose = useRef(false)
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
        } catch (error) {
          update({ status: 'error', groups: [], failures: [], reason: error?.reason ?? 'unavailable' })
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
      useEffect(() => {
        if (confirmClose && !wasConfirmClose.current) {
          continueButtonRef.current?.focus?.()
        } else if (!confirmClose && wasConfirmClose.current) {
          if (typeof document !== 'undefined' && dialogRef?.current && !dialogRef.current.contains(document.activeElement)) {
            ;(closeButtonRef?.current || dialogRef.current).focus?.()
          }
        }
        wasConfirmClose.current = confirmClose
      }, [confirmClose, dialogRef, closeButtonRef])

      const editKeys = Object.keys(edits)
      const hasEdits = snapshot.status === 'ready' && editKeys.length > 0
      const attemptClose = ({ fromEscape = false } = {}) => {
        if (saving.current || busy) return
        if (!hasEdits) {
          onClose?.()
          return
        }
        if (confirmClose) {
          if (fromEscape) setConfirmClose(false)
          else continueButtonRef.current?.focus?.()
          return
        }
        setConfirmClose(true)
      }
      if (attemptCloseRef) attemptCloseRef.current = attemptClose

      const modalHeader = (extraBadge = null) => h('header', { className: 'ma-modal-header' },
        h('div', { className: 'ma-modal-heading' },
          h('div', { className: 'ma-modal-title-row' },
            h('h2', { id: MODAL_TITLE_ID }, t('unified.title')),
            extraBadge),
          h('p', { id: MODAL_DESC_ID }, t('unified.description'))),
        h('button', {
          ref: closeButtonRef,
          type: 'button',
          name: 'modal-close',
          className: 'ma-modal-close',
          'aria-label': t('modal.closeAria'),
          title: t('modal.close'),
          onClick: () => attemptClose(),
        }, h(CloseIcon)))

      if (snapshot.status !== 'ready') {
        return h('div', { className: 'ma-modal-form' },
          modalHeader(null),
          h('div', { className: 'ma-modal-status-body', role: 'status' },
            t(snapshot.status === 'loading' ? 'common.loading' : 'common.unavailable')),
          h('footer', { className: 'ma-modal-footer' },
            h('div', { className: 'ma-actions' },
              h('button', { type: 'button', name: 'modal-footer-close', onClick: () => attemptClose() }, t('modal.close')))))
      }

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
        setConfirmClose(false)
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
        setConfirmClose(false)
        setResult('')
      }
      const conflict = baseline.current !== null && baseline.current.revision !== snapshot.revision
      const disabled = busy || !snapshot.writable || conflict
      const save = async (event) => {
        event?.preventDefault?.()
        setConfirmClose(false)
        const current = form.getSnapshot()
        if (saving.current || Object.keys(edits).length === 0 || current.status !== 'ready' || !current.writable) return false
        if (!baseline.current || baseline.current.revision !== current.revision) {
          setSnapshot(current)
          setResult('common.conflict')
          return false
        }
        let operations
        try { operations = buildOperations(kind, edits) } catch (error) {
          setResult(error.code || 'common.failure')
          if (error.field && activeSection !== 'all') {
            const targetSection = sectionForField(error.field)
            if (targetSection !== activeSection) setActiveSection(targetSection)
          }
          return false
        }
        saving.current = true
        setBusy(true)
        setResult('')
        try {
          const ok = await form.mutate(operations, baseline.current.revision)
          if (!mounted.current) return false
          const currentSnapshot = form.getSnapshot()
          if (ok) {
            baseline.current = null
            setEdits({})
          } else {
            const remaining = Object.fromEntries(Object.entries(edits).filter(([key]) => !form.savedFields.includes(key)))
            setEdits(remaining)
            baseline.current = currentSnapshot
            const remainingKeys = Object.keys(remaining)
            if (activeSection !== 'all' && remainingKeys.length > 0 && !remainingKeys.some((key) => sectionForField(key) === activeSection)) {
              setActiveSection(sectionForField(remainingKeys[0]))
            }
          }
          setSnapshot(currentSnapshot)
          setResult(ok ? 'common.success' : 'unified.partial')
          return ok
        } catch {
          if (mounted.current) setResult('common.failure')
          return false
        } finally {
          saving.current = false
          if (mounted.current) setBusy(false)
        }
      }
      const saveAndClose = async () => {
        const ok = await save()
        if (ok && mounted.current) onClose?.()
      }
      const discardAndClose = () => {
        reset()
        onClose?.()
      }

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
        return h('fieldset', { key: owner, className: 'ma-card', disabled: !available },
          h('h3', null, title),
          !available ? h('p', { role: 'status' }, t('unified.disabled')) : null,
          h('div', { className: 'ma-card-fields' },
            h(ModelField, { name: `${owner}.model`, label: t(`${owner}.model`), value: get(`${owner}.model`, ''), onChange: (next) => changeModel(`${owner}.model`, next), options, t }),
            h(ModelField, { name: `${owner}.reasoningEffort`, label: t('unified.effort'), placeholder: t('unified.effort'), value: get(`${owner}.reasoningEffort`, ''), onChange: (next) => change(`${owner}.reasoningEffort`, next), options: efforts, t }),
            h(Field, { name: `${owner}.command`, label: t(`${owner}.command`), placeholder: t('common.commandPlaceholder'), value: get(`${owner}.command`, ''), onChange: (next) => change(`${owner}.command`, next) })),
          h(CatalogStatus, { catalog: catalogs[owner], onRetry: () => reloadCatalog(owner), t }))
      }
      const proxyFields = (owner) => {
        const mode = get(`${owner}.proxyMode`, 'system')
        const urlField = `${owner}.proxyUrl`
        return [
          h(Select, {
            name: `${owner}.proxyMode`, label: t('common.proxyMode'), value: mode,
            onChange: (next) => {
              change(`${owner}.proxyMode`, next)
              // A custom address only applies to custom mode; drop unsaved leftovers.
              if (next !== 'custom') discardEdit(urlField)
            },
            options: ['system', 'none', 'custom'].map((value) => ({ value, label: t(`common.proxyMode.${value}`) })),
          }),
          ...(mode === 'custom' ? [h(Field, {
            name: urlField, label: t('common.proxyUrl'), placeholder: t('common.proxyUrlPlaceholder'),
            value: get(urlField, ''), onChange: (next) => change(urlField, next),
          })] : []),
        ]
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
      const acpRuntimeCard = (owner, title) => {
        const available = snapshot.sections[owner]
        return h('fieldset', { key: owner, className: 'ma-card', disabled: !available },
          h('h3', null, title),
          !available ? h('p', { role: 'status' }, t('unified.disabled')) : null,
          h('div', { className: 'ma-fields' },
            ...permissionPolicyFields(owner),
            ...proxyFields(owner),
            h(Field, { name: `${owner}.disposeEofGraceMs`, label: t(`${owner}.disposeEofGraceMs`), type: 'number', min: 1, max: 2147483647, step: 1, value: get(`${owner}.disposeEofGraceMs`, 6000), onChange: (next) => change(`${owner}.disposeEofGraceMs`, next) }),
            h(Field, { name: `${owner}.disposeGraceMs`, label: t(`${owner}.disposeGraceMs`), type: 'number', min: 1, max: 2147483647, step: 1, value: get(`${owner}.disposeGraceMs`, 3000), onChange: (next) => change(`${owner}.disposeGraceMs`, next) })),
          h('p', null, t(`${owner}.permissionWarning`)),
          h('p', null, t('common.proxyHint')),
          h('div', { className: 'ma-two-col' },
            h(TextArea, { name: `${owner}.args`, className: 'ma-code', label: t(`${owner}.args`), value: getJson(`${owner}.args`, ['acp']), onChange: (next) => change(`${owner}.args`, next) }),
            h('div', { className: 'ma-field' },
              h(TextArea, { name: `${owner}.env`, className: 'ma-code', label: t(`${owner}.env`), value: getJson(`${owner}.env`, {}), onChange: (next) => change(`${owner}.env`, next) }),
              h('p', null, t(`${owner}.envHint`)))))
      }

      const dirtySections = new Set(editKeys.map(sectionForField))
      const navSections = [
        { id: 'all', label: t('modal.nav.all'), dirty: hasEdits },
        { id: 'models', label: t('modal.nav.models'), dirty: dirtySections.has('models') },
        { id: 'policy', label: t('modal.nav.policy'), dirty: dirtySections.has('policy') },
        { id: 'runtime', label: t('modal.nav.runtime'), dirty: dirtySections.has('runtime') },
      ]
      const providerStatuses = [
        { id: 'router', label: 'DSH' },
        { id: 'codex', label: 'Codex' },
        { id: 'acp', label: 'Kimi Code' },
        { id: 'agy', label: 'Antigravity (agy)' },
      ]
      const statusBadge = hasEdits
        ? h('span', { className: 'ma-badge', 'data-tone': 'warn' }, t('modal.unsavedBadge'))
        : !snapshot.writable
          ? h('span', { className: 'ma-badge', 'data-tone': 'idle' }, t('modal.statusReadonly'))
          : null
      const showModels = activeSection === 'all' || activeSection === 'models'
      const showPolicy = activeSection === 'all' || activeSection === 'policy'
      const showRuntime = activeSection === 'all' || activeSection === 'runtime'
      const isAlertResult = result === 'common.failure' || result === 'common.conflict' || result.startsWith('common.invalid') || result === 'common.commandRequired' || result === 'agy.commandRequired' || result === 'common.routesRequired' || conflict

      return h('form', { className: 'ma-modal-form', onSubmit: save, 'aria-label': t('unified.title') },
        modalHeader(statusBadge),
        confirmClose ? h('div', { className: 'ma-unsaved-banner', role: 'alertdialog', 'aria-label': t('modal.unsavedTitle') },
          h('span', { className: 'ma-unsaved-copy' }, t('modal.unsavedConfirm')),
          h('div', { className: 'ma-unsaved-actions' },
            h('button', {
              ref: continueButtonRef,
              type: 'button',
              name: 'modal-continue-editing',
              onClick: () => setConfirmClose(false),
            }, t('modal.continueEditing')),
            h('button', {
              type: 'button',
              name: 'modal-save-and-close',
              className: 'ma-btn-primary',
              disabled: disabled || !hasEdits,
              onClick: saveAndClose,
            }, t('modal.saveAndClose')),
            h('button', {
              type: 'button',
              name: 'modal-discard-and-close',
              disabled: busy,
              onClick: discardAndClose,
            }, t('modal.discardAndClose')))) : null,
        h('div', { className: 'ma-modal-body' },
          h('nav', { className: 'ma-modal-nav', 'aria-label': t('modal.navAria') },
            h('div', { className: 'ma-nav-list' },
              navSections.map((section) => h('button', {
                key: section.id,
                type: 'button',
                name: `nav-${section.id}`,
                className: 'ma-nav-btn',
                'aria-pressed': activeSection === section.id,
                onClick: () => setActiveSection(section.id),
              },
              h('span', null, section.label),
              section.dirty ? h('span', { className: 'ma-dirty-dot', 'aria-hidden': true }) : null))),
            h('div', { className: 'ma-provider-list' },
              h('p', { className: 'ma-provider-list-title' }, t('modal.statusHeading')),
              providerStatuses.map((item) => {
                const ready = snapshot.availability ? snapshot.availability[item.id] : (item.id === 'router' ? snapshot.status === 'ready' : snapshot.sections[item.id])
                const writable = snapshot.sections[item.id]
                const tone = !ready ? 'idle' : writable ? 'ready' : 'idle'
                const label = !ready ? t('modal.statusUnavailable') : writable ? t('modal.statusAvailable') : t('modal.statusReadonly')
                return h('div', { key: item.id, className: 'ma-provider-item' },
                  h('span', { className: 'ma-provider-item-name' }, item.label),
                  h('span', { className: 'ma-badge', 'data-tone': tone }, label))
              }))),
          h('div', { className: 'ma-modal-scroll' },
            h('div', { className: 'ma-settings' },
              !snapshot.writable ? h('p', { className: 'ma-readonly-banner', role: 'status' }, t('common.readonly')) : null,
              h('fieldset', { className: 'ma-outer-fieldset', disabled },
                showModels ? h('section', { className: 'ma-section', 'aria-label': t('unified.models') },
                  h('div', { className: 'ma-section-head' },
                    h('h2', null, t('unified.models')),
                    h('p', null, t('modal.modelsDescription')),
                    h('p', null, t('unified.effortHint'))),
                  h('div', { className: 'ma-model-grid' },
                    h('div', { className: 'ma-card' },
                      h('h3', null, 'DSH'),
                      h('div', { className: 'ma-card-fields' },
                        h(ModelField, { name: 'dsh.defaultProvider', label: t('router.dsh.defaultProvider'), value: dshProvider, onChange: (next) => { change('dsh.defaultProvider', next); changeModel('dsh.defaultModel', '') }, options: catalog.groups.map((group) => ({ id: group.id, name: group.name })), t }),
                        h(ModelField, { name: 'dsh.defaultModel', label: t('router.dsh.defaultModel'), value: get('dsh.defaultModel', ''), onChange: (next) => changeModel('dsh.defaultModel', next), options: dshModels, t }),
                        h(ModelField, { name: 'dsh.defaultReasoningEffort', label: t('unified.effort'), placeholder: t('unified.effort'), value: get('dsh.defaultReasoningEffort', ''), onChange: (next) => change('dsh.defaultReasoningEffort', next), options: dshEfforts, t })),
                      h(CatalogStatus, { catalog, onRetry: () => reloadCatalog('dsh'), t }),
                      h('p', null, t('router.modelHint'))),
                    externalModelCard('codex', 'Codex'),
                    externalModelCard('acp', 'Kimi Code'),
                    externalModelCard('agy', t('agy.title')))) : null,
                showPolicy ? h('section', { className: 'ma-section', 'aria-label': t('router.policy') },
                  h('div', { className: 'ma-section-head' },
                    h('h2', null, t('router.policy')),
                    h('p', null, t('modal.policyDescription'))),
                  h('div', { className: 'ma-fields' },
                    h(Select, { name: 'selectionMode', label: t('router.selectionMode'), value: get('selectionMode', 'auto'), onChange: (next) => change('selectionMode', next), options: ['auto', 'ask-if-ambiguous', 'always-ask'].map((mode) => ({ value: mode, label: t(`router.selectionMode.${mode}`) })) }),
                    h(Select, { name: 'defaultAgent', label: t('router.defaultAgent'), value: get('defaultAgent', ''), onChange: (next) => change('defaultAgent', next), options: [{ value: '', label: t('router.noDefault') }, ...AGENT_OPTIONS] }),
                    h(Field, { name: 'timeoutSeconds', label: t('router.timeoutSeconds'), type: 'number', min: 1, max: 86400, step: 1, required: true, value: get('timeoutSeconds', 1800), onChange: (next) => change('timeoutSeconds', next) })),
                  h('div', { className: 'ma-section-head' },
                    h('h3', null, t('router.routes')),
                    h('p', null, t('router.routesHint'))),
                  h(RoutesEditor, { routes: get('routes', []), onChange: (next) => change('routes', next), t }),
                  h('div', { className: 'ma-two-col' },
                    h(TextArea, { name: 'additionalInstructions', label: t('router.additionalInstructions'), value: get('additionalInstructions', ''), onChange: (next) => change('additionalInstructions', next) }),
                    h(TextArea, { name: 'taskPreamble', label: t('router.taskPreamble'), value: get('taskPreamble', ''), onChange: (next) => change('taskPreamble', next) }))) : null,
                showRuntime ? h('section', { className: 'ma-section', 'aria-label': t('unified.runtime') },
                  h('div', { className: 'ma-section-head' },
                    h('h2', null, t('unified.runtime')),
                    h('p', null, t('modal.runtimeDescription'))),
                  h('div', { className: 'ma-runtime-grid' },
                    h('fieldset', { className: 'ma-card', disabled: !snapshot.sections.codex },
                      h('h3', null, 'Codex'),
                      !snapshot.sections.codex ? h('p', { role: 'status' }, t('unified.disabled')) : null,
                      h('div', { className: 'ma-fields' },
                        ...permissionPolicyFields('codex', 'permissionPolicy'),
                        h(Select, { name: 'codex.permissionMode', label: t('codex.permissionMode'), value: get('codex.permissionMode', 'approve-for-me'), onChange: (next) => change('codex.permissionMode', next), options: ['never', 'approve-for-me', 'dangerously-bypass-approvals-and-sandbox'].map((mode) => ({ value: mode, label: t(`codex.permissionMode.${mode}`) })) }),
                        ...proxyFields('codex'),
                        h(Field, { name: 'codex.disposeGraceMs', label: t('codex.disposeGraceMs'), type: 'number', min: 1, max: 2147483647, step: 1, value: get('codex.disposeGraceMs', 3000), onChange: (next) => change('codex.disposeGraceMs', next) })),
                      h('p', null, t('codex.permissionWarning')),
                      h('p', null, t('common.proxyHint')),
                      h(TextArea, { name: 'codex.env', className: 'ma-code', label: t('codex.env'), value: getJson('codex.env', {}), onChange: (next) => change('codex.env', next) })),
                    acpRuntimeCard('acp', 'Kimi Code'),
                    acpRuntimeCard('agy', t('agy.title')))) : null)))),
        h('footer', { className: 'ma-modal-footer' },
          h('div', { className: 'ma-footer-status' },
            (conflict || result) && !busy ? h('p', {
              role: isAlertResult ? 'alert' : 'status',
              className: isAlertResult ? 'ma-error' : result === 'common.success' ? 'ma-success' : undefined,
            }, t(conflict ? 'common.conflict' : result))
              : hasEdits ? h('p', { role: 'status' }, t('modal.unsavedBadge')) : null),
          h('div', { className: 'ma-actions' },
            h('button', { type: 'button', name: 'discard-edits', disabled: busy || !hasEdits, onClick: reset }, t('common.reset')),
            h('button', { type: 'submit', name: 'save-changes', className: 'ma-btn-primary', disabled: disabled || !hasEdits }, t(busy ? 'common.saving' : 'common.save')))))
    }

    function DispatchOverlay({ store, form, loadCatalogs, t }) {
      const open = useDispatchModalOpen(store)
      const wasOpen = useRef(false)
      const triggerRef = useRef(null)
      const dialogRef = useRef(null)
      const closeButtonRef = useRef(null)
      const attemptCloseRef = useRef(() => store.close())
      const backdropMouseDown = useRef(null)

      useEffect(() => {
        if (open && !wasOpen.current) {
          triggerRef.current = store.getTrigger() || (typeof document !== 'undefined' ? document.activeElement : null)
        } else if (!open && wasOpen.current) {
          const target = triggerRef.current
          triggerRef.current = null
          store.clearTrigger()
          if (target && typeof target.focus === 'function' && target.isConnected !== false) {
            target.focus()
          }
        }
        wasOpen.current = open
      }, [open, store])

      useEffect(() => {
        if (!open) {
          attemptCloseRef.current = () => store.close()
          return undefined
        }
        const dialog = dialogRef.current
        ;(closeButtonRef.current || firstFocusable(dialog) || dialog)?.focus?.()

        if (typeof document === 'undefined') return undefined
        const onKeyDown = (event) => {
          if (event.defaultPrevented || event.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            attemptCloseRef.current({ fromEscape: true })
            return
          }
          if (event.key === 'Tab') {
            trapTabInDialog(dialogRef.current, event)
          }
        }
        const onFocusIn = (event) => {
          const currentDialog = dialogRef.current
          if (!currentDialog || typeof currentDialog.contains !== 'function') return
          if (!currentDialog.contains(event.target)) {
            ;(firstFocusable(currentDialog) || currentDialog).focus?.()
          }
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('focusin', onFocusIn)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('focusin', onFocusIn)
        }
      }, [open, store])

      if (!open) return null

      return h('div', {
        className: 'ma-overlay-backdrop',
        onMouseDown: (event) => { backdropMouseDown.current = event.target === event.currentTarget },
        onClick: (event) => {
          const allowClose = backdropMouseDown.current !== false
          backdropMouseDown.current = null
          if (allowClose && event.target === event.currentTarget) {
            attemptCloseRef.current()
          }
        },
      },
      h('style', null, MODAL_CSS),
      h('div', {
        ref: dialogRef,
        className: 'ma-modal',
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': MODAL_TITLE_ID,
        'aria-describedby': MODAL_DESC_ID,
        tabIndex: -1,
        onKeyDown: (event) => {
          if (event.defaultPrevented || event.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault?.()
            event.stopPropagation?.()
            attemptCloseRef.current({ fromEscape: true })
          } else if (event.key === 'Tab') {
            trapTabInDialog(dialogRef.current, event)
          }
        },
      },
      h(ConfigForm, {
        form,
        loadCatalogs,
        t,
        onClose: () => store.close(),
        dialogRef,
        closeButtonRef,
        attemptCloseRef,
      })))
    }

    async function loadExternalCatalog(kind) {
      const response = await fetch(`/multi-agent/model-catalog/${kind}`, { credentials: 'same-origin' })
      const payload = await response.json().catch(() => undefined)
      if (!response.ok || !payload?.ok) {
        const error = new Error('catalog-unavailable')
        error.reason = payload?.error?.reason ?? (response.status === 403 ? 'forbidden' : 'unavailable')
        throw error
      }
      return payload.value
    }

    return {
      inject: ['slots', 'locale', 'configForms', 'remote', 'remote.session'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'multi-agent: dictionaries')
        const t = ctx.locale.bind(NS)
        const store = createDispatchModalStore()
        ctx.effect(() => () => store.dispose(), 'multi-agent: dispatch modal store')
        const form = combinedForm({
          router: ctx.configForms.get('multi-agent-router'),
          codex: ctx.configForms.get('codex-provider'),
          acp: ctx.configForms.get('kimi-code-acp'),
          agy: ctx.configForms.get('agy-acp'),
        })
        const loadCatalogs = {
          dsh: async () => {
            const response = await ctx.remote.session.modelCatalog()
            if (!response.ok) {
              const error = new Error('catalog-unavailable')
              error.reason = 'unavailable'
              throw error
            }
            return response.value
          },
          codex: () => loadExternalCatalog('codex'),
          acp: () => loadExternalCatalog('kimi-code'),
          agy: () => loadExternalCatalog('agy'),
        }
        ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'multi-agent-dispatch',
          order: 30,
          locale: NS,
          label: () => t('unified.title'),
        }, (props) => h(HeaderDispatchButton, { ...props, store, t: props?.t || t }))), 'multi-agent: header utility button')
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'multi-agent-dispatch',
          order: 30,
          locale: NS,
        }, (props) => h(DispatchOverlay, { ...props, store, form, loadCatalogs, t: props?.t || t }))), 'multi-agent: settings overlay')
      },
    }
  },
})
