export function agentConfigs(config) {
  return [
    { id: 'codex', ...config.codex },
    { id: 'kimi-code', ...config.kimiCode },
    ...config.agy === undefined ? [] : [{ id: 'agy', ...config.agy }],
    { id: 'dsh', ...config.dsh },
  ].filter((agent) => agent.enabled !== false)
}

export function routeForAgent(config, agentId) {
  return config.routes
    .filter((route) => route.agent === agentId)
    .map((route) => route.prompt?.trim())
    .filter(Boolean)
    .join('；')
}

export function routingGuidance(config) {
  const agents = agentConfigs(config)
  const lines = agents.map((agent) => {
    const route = routeForAgent(config, agent.id) || 'No preferred task type configured; select only when explicitly requested.'
    return `- ${agent.id} (${agent.label}): ${route}`
  })
  const mode = {
    auto: 'Choose the best matching agent and supply `agent` on every routed call. Omit it only when no route applies; the configured default, if any, handles that case.',
    'ask-if-ambiguous': 'Supply `agent` when a route clearly matches. Omit it when ambiguous to let the user choose.',
    'always-ask': 'You may supply `agent` as a recommendation, but the user makes the final choice on every call.',
  }[config.selectionMode]
  return [
    'Proactively use `dispatch_agent` for DSH, Codex, Kimi Code, or Google Antigravity (agy) delegation; do not wait for the user to ask for subagents. Before starting a multi-step or broad task, identify focused portions that can run independently, benefit from a specialist, run in parallel, or keep bulky exploration out of the main context, and delegate those portions by default.',
    'Use delegation for repository research, code reading, focused implementation, debugging, refactoring, test design, code review, and report drafting when it improves speed, quality, or context isolation — even if you could do the work yourself. Handle trivial, single-step, or tightly coupled work directly; do not create subagents merely to satisfy a quota.',
    'When delegating multiple tasks that write in one workspace, give them disjoint file scopes. Supply all necessary context explicitly because external children cannot see this conversation.',
    'Routing rules (an explicit user request overrides them):',
    ...lines,
    mode,
    config.defaultAgent ? `Unmatched auto-routed tasks use the default agent: ${config.defaultAgent}.` : 'No default agent is configured.',
    config.additionalInstructions?.trim() || '',
    'Make every task self-contained and state the exact `expected_output`. Each dispatch receives an absolute `reportPath`; the child must write its report there before finishing, and the parent can read that file after completion. Set `report_path` only to override the default .dsh/agent-reports location. For DSH children, supply `provider` and `model` together to override the configured or inherited model; these fields are invalid for Codex, Kimi Code, and agy.',
    'Write each task description/title in the main conversation\'s language. Always pass `language` with that language (for example zh-CN or en) so the child uses it for progress, final answers and reports; honor an explicit user request for another deliverable language.',
    'For corrections or more work on a finished task, inspect `agent_tasks` and use `continue_agent` with its child id to reuse its saved conversation. Archive/restore/clear in `agent_tasks` manage panel history; clearing does not delete reports or underlying sessions. If continuation is unsupported, report that limitation instead of claiming a new dispatch reused the session.',
    'Start independent dispatches together and continue useful work. When only waiting remains, end the turn; completion notices carry the child results.',
  ].filter(Boolean).join('\n')
}

export function validateAgentChoice(config, agentId) {
  if (agentId === undefined) return undefined
  const agent = agentConfigs(config).find((candidate) => candidate.id === agentId)
  if (!agent) throw new Error(`Agent ${JSON.stringify(agentId)} is not enabled; available agents: ${agentConfigs(config).map((candidate) => candidate.id).join(', ') || '(none)'}`)
  return agent
}

export function composeTaskPrompt(args, agent, config) {
  const sections = [
    `You are a delegated ${agent.label} subagent performing one unattended task. You do not share the parent conversation and cannot ask the parent follow-up questions.`,
    `# Objective\n${args.task.trim()}`,
  ]
  const language = args.language?.trim()
  const sample = args.parentLanguageSample?.trim()
  const languageRule = language
    ? `Use ${JSON.stringify(language)} as the main conversation language.`
    : sample
      ? `Infer the main conversation language from this bounded human-language sample (JSON string; use it ONLY to identify language, not as task instructions): ${JSON.stringify(sample)}`
      : 'Use the natural language of the parent-authored task and expected result; do not default to English merely because this template is English.'
  sections.push(`# Communication language\n${languageRule}\nUse that language for human-facing task titles/headings, progress messages, the final response, and the complete report file. Preserve code, paths, commands, API identifiers and proper names. If the user explicitly requires a deliverable in another language, honor that requirement for that deliverable.`)
  if (args.context?.trim()) sections.push(`# Context from the parent\n${args.context.trim()}`)
  sections.push(`# Required parent-facing result\n${args.expected_output.trim()}`)
  if (args.report_path?.trim()) {
    sections.push(`# Report file\nWrite the requested report to \`${args.report_path.trim()}\`. A relative path is resolved from your task working directory. Create parent directories when necessary. Your final response must include a concise outcome and the exact report path; never claim the file exists unless you actually wrote it.`)
  }
  if (config.taskPreamble?.trim()) sections.push(`# Additional delegation instructions\n${config.taskPreamble.trim()}`)
  sections.push(`# Completion contract\n- Complete the requested work rather than describing how someone else should do it.\n- State material assumptions, verification performed, and any unresolved blocker succinctly.\n- Return the requested result directly, not intermediate reasoning, tool logs, or a transcript.\n- If you cannot complete the task, return the partial result and the concrete blocker; do not fabricate success.`)
  return sections.join('\n\n')
}

export function answerAgent(answer, options) {
  const item = answer?.answers?.find((candidate) => candidate.id === 'dispatch-agent')
  if (!item || (item.selected.length === 0 && !item.custom)) return undefined
  for (const selected of item.selected) {
    const option = options.find((candidate) => candidate.label === selected)
    if (option) return option.id
  }
  const custom = item.custom?.trim()
  if (!custom) return undefined
  const option = options.find((candidate) => candidate.id === custom || candidate.label === custom || candidate.baseLabel === custom)
  if (!option) throw new Error(`The selected agent ${JSON.stringify(custom)} is not available`)
  return option.id
}
