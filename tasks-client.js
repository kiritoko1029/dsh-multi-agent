window.__ModuleLoader__.load({
  id: 'dsh-multi-agent/tasks-ui',
  factory(require, shared = {}) {
    const React = require('react')
    const MarkdownIt = require('markdown-it')
    const uiTheme = require('dsh-multi-agent/ui-theme')
    const createTaskIndicatorStore = require('dsh-multi-agent/task-indicator-store')
    const h = React.createElement
    const { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } = React
    const { THEME_CSS, createUseTheme } = uiTheme
    const useTheme = createUseTheme(React)
    const markdownParser = new MarkdownIt({ html: false, linkify: false })
    const defaultLinkValidation = markdownParser.validateLink
    markdownParser.validateLink = (url) => /^file:\/\/\//i.test(url) || defaultLinkValidation(url)
    const NS = 'dsh-multi-agent-tasks-ui'
    const TAB_ID = 'multi-agent:tasks'
    const TAB_IMPLEMENTATION_ID = 'dsh-multi-agent/tasks'
    const NODE_KIND = 'multi-agent-dispatch-settled'
    const ACTIVE_STATUSES = ['starting', 'running']
    const taskStoreListeners = new Set()
    shared.subscribeTaskStore = (listener) => {
      taskStoreListeners.add(listener)
      return () => taskStoreListeners.delete(listener)
    }
    const publishTaskStore = (taskStore) => {
      shared.taskStore = taskStore || undefined
      for (const listener of [...taskStoreListeners]) listener(shared.taskStore)
    }
    const STATUS_VALUES = ['starting', 'running', 'completed', 'aborted', 'error', 'max-tokens', 'refusal', 'interrupted']
    const DICT = {
      en: {
        'tasks.title': 'Agent tasks',
        'tasks.description': 'A live console for delegated work in this main session.',
        'tasks.overview': '{count} child tasks',
        'tasks.childTabs': 'Child tasks',
        'tasks.mainSession': 'Main session',
        'tasks.childSession': 'Child task',
        'tasks.sessionMetadata': 'Session metadata',
        'tasks.runDetails': 'Run details',
        'perm.offline': 'Offline',
        'tasks.refresh': 'Refresh tasks',
        'tasks.loading': 'Loading task history…',
        'tasks.empty': 'No monitored tasks have been recorded for this main session.',
        'tasks.historyUnavailable': 'Task history unavailable. Existing entries are retained when possible; retry with Refresh tasks.',
        'tasks.detailLoading': 'Waiting for task details from the Host…',
        'tasks.detailUnavailable': 'Live task details are temporarily unavailable. The last known summary is retained.',
        'tasks.activities': 'Messages and tool activity',
        'tasks.jumpToLatest': 'Back to latest',
        'activities.empty': 'No message or tool activity has been recorded.',
        'activities.showEarlier': 'Show earlier activity ({count})',
        'activities.toolActivity': 'Tool activity ({count})',
        'activityStatus.pending': 'Pending',
        'activityStatus.inProgress': 'In progress',
        'activityStatus.failed': 'Failed',
        'activityStatus.declined': 'Declined',
        'tasks.output': 'Final output',
        'tasks.fullOutput': 'Full final output',
        'tasks.truncated': 'Some task content was truncated by the Host. Retained entries are shown below.',
        'tasks.report': 'View report',
        'tasks.reportFromNotice': 'View report from notification',
        'tasks.created': 'Created {time}',
        'tasks.createdUnknown': 'Creation time unknown',
        'tasks.durationUnknown': 'Duration unavailable',
        'telemetry.model': 'Model',
        'telemetry.reasoningEffort': 'Reasoning effort',
        'telemetry.notProvided': 'Not provided',
        'telemetry.source.reported': 'reported',
        'telemetry.source.configured': 'configured',
        'telemetry.usage.task': 'Task tokens',
        'telemetry.usage.session': 'Session tokens',
        'telemetry.usage.turn': 'Turn tokens',
        'telemetry.usage.unknown': 'Token',
        'telemetry.usage.inputTokens': 'Input',
        'telemetry.usage.outputTokens': 'Output',
        'telemetry.usage.totalTokens': 'Total',
        'telemetry.usage.cacheReadTokens': 'Cache read',
        'telemetry.usage.cacheWriteTokens': 'Cache write',
        'telemetry.usage.reasoningTokens': 'Reasoning',
        'tasks.activeEmpty': 'No active tasks. Open History to view or restore a settled task.',
        'tasks.backToCurrent': 'Back to current tasks',
        'tasks.historyEmpty': 'No archived tasks.',
        'tasks.history': 'History tasks ({count})',
        'tasks.historyDescription': 'Settled tasks are archived here by default, newest first.',
        'tasks.clearDescription': 'Clear only removes this panel record; reports and sessions are retained.',
        'tasks.viewHistory': 'View task history',
        'tasks.archive': 'Archive task',
        'tasks.restore': 'Restore to active tasks',
        'tasks.restoreDescription': 'Restores only the panel tab; it does not start model work.',
        'tasks.clear': 'Clear panel record',
        'tasks.clearHistory': 'Clear archived history',
        'tasks.actionFailed': 'The task action failed. Try again.',
        'tasks.continue': 'Continue task',
        'tasks.continueMessage': 'Follow-up message',
        'tasks.continuePlaceholder': 'Describe the next instruction for this settled task…',
        'tasks.continueSubmit': 'Send continuation',
        'perm.title': 'Task permissions',
        'perm.selection': 'Permission for this task',
        'perm.save': 'Apply',
        'perm.default': 'Use provider default',
        'perm.nativeDefault': 'Restore initial sandbox',
        'perm.effective': 'Currently effective: {value}',
        'perm.pending': 'Applies on next continuation',
        'perm.next': 'Applies when this task resumes.',
        'perm.nativeOffline': 'The native sandbox can be changed while the DSH child session is live.',
        'perm.nativeHint': 'Changes apply to the next file or command operation. DSH manages approval separately.',
        'perm.externalHint': 'Changes apply to new approval requests. A different process or thread mode takes effect on continuation. Earlier grants and running operations keep their scope.',
        'perm.main-session': 'Main session approval',
        'perm.inheritedFull': 'Inherited full access',
        'perm.human': 'Ask me',
        'perm.allow': 'Allow all requests',
        'perm.reject': 'Deny all requests',
        'perm.subagent:auto': 'Follow native Codex mode',
        'perm.acpAuto': 'Agent-managed · allow ACP requests once',
        'perm.codex:never': 'Codex · never ask',
        'perm.codex:approve-for-me': 'Codex · automatic review',
        'perm.subagent:ask-request': 'Agent-managed · ask',
        'perm.subagent:full-access': 'Agent-managed · full access',
        'perm.read-only': 'Read only',
        'perm.workspace-write': 'Workspace write',
        'perm.danger-full-access': 'Full filesystem access',
        'perm.launcher.ask-request': 'Workspace write · ask on escalation',
        'perm.launcher.approve-for-me': 'Workspace write · automatic review',
        'perm.launcher.never': 'No approval prompts',
        'perm.launcher.dangerously-bypass-approvals-and-sandbox': 'Full access · approvals bypassed',
        'perm.launcher.acp-bypass': 'Native permission checks bypassed',
        'tasks.continueUnavailable': 'This settled task cannot be continued.',
        'tasks.continueAccepted': 'Continuation accepted by the Host; model work is not finished.',
        'tasks.continuationCount': '{count} continuations',
        'status.starting': 'Starting',
        'status.running': 'Running',
        'status.completed': 'Completed',
        'status.aborted': 'Aborted',
        'status.error': 'Error',
        'status.max-tokens': 'Token limit',
        'status.refusal': 'Declined',
        'status.interrupted': 'Interrupted',
        'status.unknown': 'Unknown',
        'completion.title': 'Delegated task update',
        'completion.loading': 'Loading task details…',
        'completion.unavailable': 'Task monitoring unavailable. The original notification is preserved below.',
        'completion.untracked': 'No local task details are available for this notification. The original notification is preserved below.',
        'completion.original': 'View full original notification',
        'completion.openTasks': 'Open task panel',
      },
      zh: {
        'tasks.title': 'Agent 任务',
        'tasks.description': '集中查看此主会话中派发任务的实时进展。',
        'tasks.overview': '{count} 个子任务',
        'tasks.childTabs': '子任务',
        'tasks.mainSession': '主会话',
        'tasks.childSession': '子任务',
        'tasks.sessionMetadata': '会话元数据',
        'tasks.runDetails': '运行详情',
        'perm.offline': '离线',
        'tasks.refresh': '刷新任务',
        'tasks.loading': '正在读取任务历史…',
        'tasks.empty': '此主会话尚无已监控的任务记录。',
        'tasks.historyUnavailable': '任务历史不可用。已有条目会尽量保留；请点击“刷新任务”重试。',
        'tasks.detailLoading': '正在等待 Host 提供任务详情…',
        'tasks.detailUnavailable': '实时任务详情暂不可用，已保留最近已知摘要。',
        'tasks.activities': '消息与工具活动',
        'tasks.jumpToLatest': '回到最新',
        'activities.empty': '尚未记录消息或工具活动。',
        'activities.showEarlier': '显示更早的活动（还有 {count} 项）',
        'activities.toolActivity': '工具活动（{count}）',
        'activityStatus.pending': '等待中',
        'activityStatus.inProgress': '进行中',
        'activityStatus.failed': '失败',
        'activityStatus.declined': '已拒绝',
        'tasks.output': '最终输出',
        'tasks.fullOutput': '最终输出全文',
        'tasks.truncated': 'Host 已截断部分任务内容，下方展示保留的条目。',
        'tasks.report': '查看报告',
        'tasks.reportFromNotice': '查看报告（来自原通知）',
        'tasks.created': '创建时间 {time}',
        'tasks.createdUnknown': '创建时间未知',
        'tasks.durationUnknown': '耗时不可用',
        'telemetry.model': '模型',
        'telemetry.reasoningEffort': '思考强度',
        'telemetry.notProvided': '未提供',
        'telemetry.source.reported': '实际',
        'telemetry.source.configured': '配置',
        'telemetry.usage.task': '累计 Token',
        'telemetry.usage.session': '会话 Token',
        'telemetry.usage.turn': '本轮 Token',
        'telemetry.usage.unknown': 'Token',
        'telemetry.usage.inputTokens': '输入',
        'telemetry.usage.outputTokens': '输出',
        'telemetry.usage.totalTokens': '总计',
        'telemetry.usage.cacheReadTokens': '缓存读取',
        'telemetry.usage.cacheWriteTokens': '缓存写入',
        'telemetry.usage.reasoningTokens': '思考',
        'tasks.activeEmpty': '当前没有活动任务。可通过“历史任务”查看详情或恢复任务。',
        'tasks.backToCurrent': '返回当前任务',
        'tasks.historyEmpty': '暂无已归档任务。',
        'tasks.history': '历史任务（{count}）',
        'tasks.historyDescription': '终态任务默认归档到这里，并按真实创建时间倒序排列。',
        'tasks.clearDescription': '清理只移除面板记录，底层报告与会话仍会保留，不会删除会话。',
        'tasks.viewHistory': '查看历史任务详情',
        'tasks.archive': '归档任务',
        'tasks.restore': '恢复到活动任务',
        'tasks.restoreDescription': '只恢复到活动 tab，不会启动模型工作。',
        'tasks.clear': '清理面板记录',
        'tasks.clearHistory': '清理已归档历史',
        'tasks.actionFailed': '任务操作失败，请重试。',
        'tasks.continue': '继续任务',
        'tasks.continueMessage': '后续指令',
        'tasks.continuePlaceholder': '输入要让此终态任务继续完成的指令…',
        'tasks.continueSubmit': '发送继续指令',
        'perm.title': '任务权限',
        'perm.selection': '本任务权限',
        'perm.save': '应用',
        'perm.default': '使用设置中的默认值',
        'perm.nativeDefault': '恢复初始沙箱',
        'perm.effective': '当前生效：{value}',
        'perm.pending': '下次续接生效',
        'perm.next': '下次续接此任务时生效。',
        'perm.nativeOffline': 'DSH 子会话在线时可调整文件沙箱。',
        'perm.nativeHint': '从下一次文件或命令操作起生效，审批仍由 DSH 管理。',
        'perm.externalHint': '审批策略作用于后续请求。需要切换进程或线程模式时，在续接后生效。已有授权和正在执行的操作保留原权限。',
        'perm.main-session': '主会话审批',
        'perm.inheritedFull': '继承主会话完全权限',
        'perm.human': '人工审批',
        'perm.allow': '允许所有请求',
        'perm.reject': '拒绝所有请求',
        'perm.subagent:auto': '沿用 Codex 原生线程模式',
        'perm.acpAuto': '子代理控制 · ACP 请求单次放行',
        'perm.codex:never': 'Codex · 不请求审批',
        'perm.codex:approve-for-me': 'Codex · 自动审查',
        'perm.subagent:ask-request': '子代理控制 · 逐项审批',
        'perm.subagent:full-access': '子代理控制 · 完全权限',
        'perm.read-only': '只读',
        'perm.workspace-write': '工作区可写',
        'perm.danger-full-access': '完整文件访问',
        'perm.launcher.ask-request': '工作区可写 · 升级时送审',
        'perm.launcher.approve-for-me': '工作区可写 · 自动审查',
        'perm.launcher.never': '不请求审批',
        'perm.launcher.dangerously-bypass-approvals-and-sandbox': '完全权限 · 跳过审批',
        'perm.launcher.acp-bypass': '已跳过 CLI 原生审批',
        'tasks.continueUnavailable': '此终态任务不支持继续指挥。',
        'tasks.continueAccepted': 'Host 已接受继续指令；模型工作尚未完成。',
        'tasks.continuationCount': '已继续 {count} 次',
        'status.starting': '启动中',
        'status.running': '运行中',
        'status.completed': '已完成',
        'status.aborted': '已中止',
        'status.error': '错误',
        'status.max-tokens': '达到 Token 上限',
        'status.refusal': '已拒绝',
        'status.interrupted': '已中断',
        'status.unknown': '未知',
        'completion.title': '派发任务更新',
        'completion.loading': '正在读取任务详情…',
        'completion.unavailable': '任务监控不可用，下方完整保留原始通知。',
        'completion.untracked': '此通知没有可用的本地任务详情，下方完整保留原始通知。',
        'completion.original': '查看原始通知全文',
        'completion.openTasks': '打开任务面板',
      },
    }

    const CSS = `
.matasks{box-sizing:border-box;display:grid;gap:14px;min-width:0;padding:14px;color:var(--ma-text);font-size:13px;line-height:1.55}
.matasks *{box-sizing:border-box}
.matasks-panel{display:flex;flex-direction:column;flex:1 1 auto;align-items:stretch;justify-content:flex-start;gap:5px;width:100%;height:100%;min-height:0;padding:6px;overflow:hidden;background:var(--ma-bg);container-type:inline-size}
.matasks-panel>*{flex:0 0 auto}
.matasks-panel>.matasks-workspace,.matasks-panel>.matasks-task-history{flex:1 1 auto;min-height:0}
.matasks h2,.matasks h3,.matasks p{margin:0}
.matasks h2{font-size:15px;font-weight:650;line-height:1.35;letter-spacing:-.01em;color:var(--ma-text)}
.matasks h3{font-size:11.5px;font-weight:650;letter-spacing:.025em;text-transform:uppercase;color:var(--ma-muted)}
.matasks-overview{display:flex;align-items:center;justify-content:space-between;position:relative;gap:6px;min-width:0;min-height:30px;padding:0 2px}
.matasks-heading[hidden]{display:none}
.matasks-heading{display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;white-space:nowrap}
.matasks-heading h2{flex:0 0 auto;font-size:13.5px}
.matasks-overview-count{display:inline-flex;align-items:center;min-width:0;padding:1px 8px;border:1px solid var(--ma-line);border-radius:999px;background:var(--ma-surface-sunken);overflow:hidden;text-overflow:ellipsis;color:var(--ma-muted);font-size:11px;font-weight:550;font-variant-numeric:tabular-nums}
.matasks-overview .matasks-view-actions{flex:0 0 auto;flex-wrap:nowrap;align-items:center;gap:4px}
.matasks-overview button{min-width:28px;min-height:28px;padding:4px 7px;font-size:11px;border-color:transparent;border-radius:7px;background:transparent}
.matasks-overview button:hover:not(:disabled){background:var(--ma-hover);border-color:var(--ma-line)}
.matasks-muted{color:var(--ma-muted)}
.matasks code{overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px}
.matasks button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 11px;border:1px solid var(--ma-line-strong);border-radius:8px;background:var(--ma-surface);color:var(--ma-text);font:inherit;font-size:12.5px;font-weight:530;cursor:pointer;touch-action:manipulation;transition:border-color 180ms ease,background-color 180ms ease,color 180ms ease,transform 180ms ease,box-shadow 180ms ease}
.matasks button:hover:not(:disabled){background:var(--ma-hover);border-color:var(--ma-accent)}
.matasks button:active:not(:disabled){transform:translateY(1px)}
.matasks button:disabled{opacity:.52;cursor:not-allowed}
.matasks :is(button,summary,select,input,textarea,a):focus-visible,.matasks-activity-viewport:focus-visible,.matasks-empty:focus-visible,.matasks-empty:focus{outline:2px solid var(--ma-accent);outline-offset:2px}
.matasks :is(input,select,textarea){border:1px solid var(--ma-control-border);border-radius:8px;background:var(--ma-surface-sunken);color:var(--ma-text);font:inherit;transition:border-color 180ms ease,background-color 180ms ease,box-shadow 180ms ease}
.matasks :is(input,select,textarea):hover:not(:disabled){border-color:var(--ma-accent)}
.matasks :is(input,select,textarea):focus{background:var(--ma-surface);border-color:var(--ma-accent);box-shadow:0 0 0 3px var(--ma-focus-ring)}
.matasks-icon{width:15px;height:15px;flex:0 0 auto}
.matasks-error{margin:0;padding:10px 12px;border:1px solid color-mix(in srgb,var(--ma-error) 36%,var(--ma-line));border-radius:9px;background:var(--ma-error-soft);color:var(--ma-error);font-weight:500}
.matasks-receipt{padding:9px 12px;border:1px solid color-mix(in srgb,var(--ma-accent) 28%,var(--ma-line));border-radius:9px;background:var(--ma-accent-soft);color:var(--ma-text)}
.matasks-session-meta{color:var(--ma-muted);font-size:12px}
.matasks-session-meta summary{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid transparent;border-radius:7px;cursor:pointer;list-style:none;transition:background-color 180ms ease,border-color 180ms ease}
.matasks-session-meta summary::-webkit-details-marker{display:none}
.matasks-session-meta summary:hover,.matasks-session-meta[open] summary{background:var(--ma-hover);border-color:var(--ma-line)}
.matasks-session-meta dl{position:absolute;z-index:5;top:calc(100% + 6px);right:0;display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 12px;width:min(368px,100%,calc(100vw - 24px));max-width:100%;max-height:200px;overflow:auto;margin:0;padding:12px 14px;border:1px solid var(--ma-line-strong);border-radius:11px;background:var(--ma-overlay);box-shadow:var(--ma-shadow)}
.matasks-session-meta dt{font-weight:600;color:var(--ma-muted)}
.matasks-session-meta dd{min-width:0;margin:0;overflow-wrap:anywhere;color:var(--ma-text)}
.matasks-session-meta dd code{display:inline-block;padding:1px 6px;border-radius:5px;background:var(--ma-surface-sunken);border:1px solid var(--ma-line)}
.matasks-tabs{display:flex;align-items:center;flex:1 1 0;min-width:0;gap:3px;padding:3px;overflow-x:auto;scrollbar-width:thin}
.matasks-tabs .matasks-tab{flex:0 0 auto;max-width:min(190px,90%);min-height:28px;gap:5px;padding:3px 8px;border-color:transparent;border-radius:6px;background:transparent;box-shadow:none}
.matasks-tabs .matasks-tab[aria-selected=true]{background:var(--ma-accent-soft);border-color:var(--ma-accent);color:var(--ma-accent)}
.matasks-tab-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.matasks-tab .matasks-status{width:7px;height:7px;display:inline-flex;flex:none;overflow:hidden;gap:0;padding:0;border:0;background:transparent}
.matasks-tab .matasks-status::before{width:7px;height:7px}
.matasks-badges{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.matasks-badge{display:inline-flex;align-items:center;padding:2px 8px;border:1px solid var(--ma-line-strong);border-radius:999px;background:var(--ma-surface-raised);color:var(--ma-muted);font-size:11px;font-weight:540;line-height:1.35;white-space:nowrap}
.matasks-status{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:999px;background:color-mix(in srgb,currentColor 10%,transparent);color:var(--ma-idle);font-size:11px;font-weight:560;line-height:1.35;white-space:nowrap}
.matasks-status::before{width:6px;height:6px;flex:0 0 auto;border-radius:50%;background:currentColor;content:''}
.matasks-status[data-tone=active]{color:var(--ma-success)}
.matasks-status[data-tone=neutral]{color:var(--ma-muted)}
.matasks-status[data-tone=error]{color:var(--ma-error)}
.matasks-status[data-tone=warn]{color:var(--ma-warn)}
.matasks-workspace{display:flex;flex-direction:column;align-items:stretch;width:100%;min-width:0;overflow:hidden;border:1px solid var(--ma-line);border-radius:12px;background:var(--ma-surface);box-shadow:var(--ma-shadow-sm)}
.matasks-task-head{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:8px;row-gap:1px;padding:5px 10px;border-bottom:1px solid var(--ma-line);background:var(--ma-surface)}
.matasks-task-title{display:flex;flex-wrap:wrap;align-items:center;gap:5px 8px;min-width:0}
.matasks-task-title .matasks-badge{padding:0;border:0;background:transparent;color:var(--ma-text);font-size:12px;font-weight:620}
.matasks-run-details{grid-column:1/-1;min-width:0;color:var(--ma-muted);font-size:12px}
.matasks-run-details>summary,.matasks-continue>summary{cursor:pointer;list-style:none}
.matasks-run-details>summary::-webkit-details-marker,.matasks-continue>summary::-webkit-details-marker{display:none}
.matasks-run-details>summary::before,.matasks-continue>summary::before{content:'';display:inline-block;width:5px;height:5px;margin:0 7px 2px 1px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg)}
.matasks-run-details[open]>summary::before,.matasks-continue[open]>summary::before{transform:rotate(45deg)}
.matasks-run-details>summary{width:fit-content;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:24px}
.matasks-run-details[open]{padding-bottom:4px}
.matasks-label{font-size:13.5px;font-weight:650;color:var(--ma-text);overflow-wrap:anywhere}
.matasks-duration{color:var(--ma-muted);font-size:11.5px;font-weight:550;font-variant-numeric:tabular-nums}
.matasks-created{color:var(--ma-muted);font-size:11px;font-weight:450;font-variant-numeric:tabular-nums}
.matasks-task-timing{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin:2px 0}
.matasks-telemetry{display:flex;flex-wrap:wrap;gap:3px 10px;min-width:0;margin:2px 0;color:var(--ma-muted);font-size:11px;line-height:1.4}
.matasks-telemetry>span{display:inline-flex;align-items:center;min-width:0;overflow-wrap:anywhere}
.matasks-token-usage{font-variant-numeric:tabular-nums}
.matasks-actions{display:flex;flex-wrap:wrap;gap:8px;padding-top:11px}
.matasks-task-head .matasks-actions,.matasks-history-actions{display:flex;align-items:center;gap:2px;padding:0}
.matasks-task-head .matasks-actions button,.matasks-history-actions button{width:28px;height:28px;min-height:28px;padding:4px;border-color:transparent;background:transparent;box-shadow:none}
.matasks-task-head button:hover:not(:disabled),.matasks-history-actions button:hover:not(:disabled){background:var(--ma-hover);border-color:var(--ma-line)}
.matasks-activity-frame{position:relative;display:flex;flex:1 1 auto;min-width:0;min-height:0}
.matasks-activity-viewport{flex:1 1 auto;width:100%;min-width:0;min-height:0;padding:8px 10px 12px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;overflow-anchor:none;scroll-behavior:auto;background:var(--ma-bg)}
.matasks-activity-content{display:grid;align-content:start;gap:8px;min-width:0}
.matasks-activity-content>section{display:grid;gap:8px;min-width:0}
.matasks-timeline{display:grid;gap:6px;min-width:0}
.matasks-message,.matasks-final-output-text{min-width:0;overflow-wrap:anywhere}
.matasks-message{padding:3px 1px;background:transparent}
.matasks-message+.matasks-message{padding-top:8px;border-top:1px solid var(--ma-line)}
.matasks-markdown{line-height:1.65}
.matasks-markdown h1,.matasks-markdown h2,.matasks-markdown h3,.matasks-markdown h4,.matasks-markdown h5,.matasks-markdown h6{margin:12px 0 6px;font-weight:650;line-height:1.4;letter-spacing:normal;text-transform:none;color:var(--ma-text)}
.matasks-markdown h1{font-size:1.45em}.matasks-markdown h2{font-size:1.25em}.matasks-markdown h3{font-size:1.12em}.matasks-markdown h4,.matasks-markdown h5,.matasks-markdown h6{font-size:1em}
.matasks-markdown>:first-child{margin-top:0}
.matasks-markdown>p+p{margin-top:8px}
.matasks-markdown strong{font-weight:680}.matasks-markdown em{font-style:italic}
.matasks-markdown ul,.matasks-markdown ol{margin:6px 0;padding-left:22px;list-style-position:outside}
.matasks-markdown ul{list-style-type:disc}.matasks-markdown ol{list-style-type:decimal}.matasks-markdown li{display:list-item;margin:2px 0}
.matasks-markdown a{color:var(--ma-accent);text-decoration:underline;text-underline-offset:2px}
.matasks-markdown hr{border:0;border-top:1px solid var(--ma-line-strong);margin:12px 0}
.matasks-markdown blockquote{margin:8px 0;padding:6px 11px;border-left:3px solid var(--ma-accent);border-radius:0 6px 6px 0;background:var(--ma-surface-sunken);color:var(--ma-muted)}
.matasks-inline-code{padding:1px 5px;border:1px solid var(--ma-line);border-radius:5px;background:var(--ma-surface-sunken)}
.matasks-markdown table{max-width:100%;margin:8px 0;border-collapse:collapse}
.matasks-markdown th,.matasks-markdown td{padding:5px 9px;border:1px solid var(--ma-line-strong);text-align:left}
.matasks-markdown th{background:var(--ma-surface-sunken);font-weight:620}
.matasks-file-link{color:var(--ma-accent);cursor:pointer}
.matasks-final-output{display:grid;gap:8px;padding:12px 14px;border:1px solid color-mix(in srgb,var(--ma-accent) 30%,var(--ma-line));border-radius:11px;background:var(--ma-surface);box-shadow:var(--ma-shadow-sm)}
.matasks-final-output>h3{color:var(--ma-accent)}
.matasks pre{max-width:100%;margin:6px 0 0;padding:10px 12px;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--ma-line);border-radius:8px;background:var(--ma-surface-sunken);color:var(--ma-text);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.5}
.matasks-output{max-height:none;overflow:visible}
.matasks-tool-activity{min-width:0;padding:5px 8px;border:1px solid var(--ma-line);border-radius:10px;background:var(--ma-surface-sunken);color:var(--ma-muted);transition:border-color 180ms ease,background-color 180ms ease}
.matasks-tool-activity[open]{border-color:var(--ma-line-strong);background:var(--ma-surface)}
.matasks-tool-activity>summary{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:560;color:var(--ma-text);cursor:pointer;list-style:none}
.matasks-tool-activity>summary::-webkit-details-marker,.matasks-tool-detail>summary::-webkit-details-marker{display:none}
.matasks-tool-activity>summary::before,.matasks-tool-detail>summary::before{content:'›';display:inline-block;flex:0 0 auto;width:10px;text-align:center;color:var(--ma-muted);transition:transform 180ms ease}
.matasks-tool-activity[open]>summary::before,.matasks-tool-detail[open]>summary::before{transform:rotate(90deg)}
.matasks-tool-activities{display:grid;gap:4px;list-style:none;margin:8px 0 0;padding:0 0 0 10px;border-left:2px solid var(--ma-line)}
.matasks-tool-item{min-width:0}
.matasks-tool-detail>summary{display:flex;align-items:center;gap:6px;min-width:0;padding:4px 6px;border-radius:6px;cursor:pointer;list-style:none;transition:background-color 180ms ease}
.matasks-tool-detail>summary:hover{background:var(--ma-hover)}
.matasks-command-preview{display:block;min-width:0;flex:1;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ma-text)}
.matasks-tool-status{padding:1px 6px;border-radius:999px;background:var(--ma-surface-raised);border:1px solid var(--ma-line);font-size:10.5px;font-weight:550;white-space:nowrap}
.matasks-activity-toggle{justify-self:start}
.matasks-jump-latest{position:absolute;right:14px;bottom:14px;z-index:3;width:34px;min-height:34px!important;padding:7px!important;border-radius:50%!important;border-color:var(--ma-line-strong)!important;background:var(--ma-overlay)!important;box-shadow:var(--ma-shadow)}
.matasks-history{margin-bottom:2px}
.matasks-task-history{display:flex;flex-direction:column;min-width:0;overflow:hidden;border:1px solid var(--ma-line);border-radius:12px;background:var(--ma-surface);box-shadow:var(--ma-shadow-sm)}
.matasks-history-heading{position:relative;display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;gap:8px;padding:5px 9px;border-bottom:1px solid var(--ma-line);background:var(--ma-surface-raised)}
.matasks-history-body{display:grid;flex:1 1 auto;min-height:0;align-content:start;gap:5px;padding:5px 8px;overflow-y:auto}
.matasks-view-actions{display:flex;flex-wrap:wrap;gap:6px}
.matasks-history-list{display:grid;list-style:none;margin:0;padding:0}
.matasks-history-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px;min-width:0;padding:5px 2px;border-bottom:1px solid var(--ma-line)}
.matasks-history-row:last-child{border-bottom:0}
.matasks-history-row[data-selected=true]{background:var(--ma-accent-soft)}
.matasks-history-main{display:grid;justify-items:start;min-width:0}
.matasks-history-main .matasks-history-link{display:block;width:100%;min-height:24px;padding:0;border:0;background:transparent;color:var(--ma-text);font-weight:600;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.matasks-history-meta{font-size:11px;color:var(--ma-muted);overflow-wrap:anywhere}
.matasks-continue{padding:3px 10px;border-top:1px solid var(--ma-line);background:var(--ma-surface)}
.matasks-continue>summary{padding:3px 0;line-height:20px;font-weight:600;color:var(--ma-text)}
.matasks-permissions{border-top:0;border-bottom:1px solid var(--ma-line)}
.matasks-permission-current,.matasks-permission-pending{margin-inline-start:8px;font-size:12px;font-weight:450;overflow-wrap:anywhere}
.matasks-permission-current,.matasks-permission-offline{color:var(--ma-muted)}
.matasks-permission-pending{color:var(--ma-warn);font-weight:600}
.matasks-permission-offline{display:inline-grid;place-items:center;width:24px;height:28px;cursor:help}
.matasks-permissions form{display:flex;align-items:center;flex-wrap:wrap;gap:5px;padding:2px 0 5px}
.matasks-permissions select{max-width:100%;min-width:0;min-height:28px;padding:2px 6px}
.matasks-permissions button{min-height:28px;padding:2px 8px}
.matasks-continue-form{display:grid;gap:8px;padding-top:10px}
.matasks-continue-form label{font-size:12px;font-weight:560;color:var(--ma-muted)}
.matasks-continue-form textarea{width:100%;min-height:52px;resize:vertical;padding:8px 10px;line-height:1.5}
.matasks-continue-form button{justify-self:start;border-color:var(--ma-accent-fill);background:var(--ma-accent-fill);color:var(--ma-on-accent);font-weight:600}
.matasks-continue-form button:hover:not(:disabled){background:color-mix(in srgb,var(--ma-accent-fill) 90%,var(--ma-text));border-color:var(--ma-accent-fill);color:var(--ma-on-accent)}
.matasks-continue-unavailable{padding:10px 14px;border-top:1px solid var(--ma-line);background:var(--ma-surface-sunken);font-size:12px}
.matasks-empty{margin:0;padding:22px 16px;border:1px dashed var(--ma-line-strong);border-radius:11px;background:var(--ma-surface);color:var(--ma-muted);text-align:center}
.matasks-completion{max-width:760px;padding:0;border:1px solid var(--ma-line-strong);border-radius:13px;background:var(--ma-surface);box-shadow:var(--ma-shadow-sm);overflow:hidden}
.matasks-completion-body{display:grid;gap:10px;padding:14px 16px}
.matasks-completion-title{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid var(--ma-line)}
.matasks-completion-title strong{font-size:13.5px;font-weight:650;color:var(--ma-text)}
.matasks-completion button[name=completion-open-tasks]{border-color:var(--ma-accent-fill);background:var(--ma-accent-fill);color:var(--ma-on-accent);font-weight:600}
.matasks-completion button[name=completion-open-tasks]:hover:not(:disabled){background:color-mix(in srgb,var(--ma-accent-fill) 90%,var(--ma-text));border-color:var(--ma-accent-fill);color:var(--ma-on-accent)}
.matasks-original{padding-top:6px;border-top:1px dashed var(--ma-line);color:var(--ma-muted);font-size:12px}
.matasks-original summary{cursor:pointer;font-weight:550}
@container(max-width:360px){.matasks-overview{gap:2px}.matasks-overview .matasks-view-actions{gap:0}.matasks-task-head{padding-inline:7px;column-gap:4px}.matasks-history-actions{gap:0}.matasks-activity-viewport{padding-inline:7px}}
@media(max-width:560px){.matasks-completion-body{padding:12px}}
@media(prefers-reduced-motion:reduce){.matasks,.matasks *{scroll-behavior:auto!important;transition:none!important;animation:none!important;transform:none!important}}
`

    function normalizeText(value) {
      if (typeof value === 'string') return value
      if (!Array.isArray(value)) return ''
      return value.flatMap((block) => {
        if (typeof block === 'string') return [block]
        return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []
      }).join('\n')
    }

    function stringValue(value, fallback = '') {
      return typeof value === 'string' && value.length > 0 ? value : fallback
    }

    function agentLabel(agent) {
      return { codex: 'Codex', 'kimi-code': 'Kimi Code', agy: 'Antigravity (agy)', dsh: 'DSH' }[agent] || agent
    }

    function timeValue(value) {
      const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
      return Number.isFinite(parsed) && Number.isFinite(new Date(parsed).getTime()) ? parsed : undefined
    }

    function normalizeActivity(activity, index) {
      if (!activity || typeof activity !== 'object' || !['message', 'tool', 'status'].includes(activity.type)) return undefined
      return {
        id: stringValue(activity.id, `${activity.type}-${index}`),
        type: activity.type,
        time: timeValue(activity.time),
        ...(typeof activity.title === 'string' ? { title: activity.title } : {}),
        ...(typeof activity.text === 'string' ? { text: activity.text } : {}),
        ...(typeof activity.status === 'string' ? { status: activity.status } : {}),
      }
    }

    const TERMINAL_STATUSES = ['completed', 'aborted', 'error', 'max-tokens', 'refusal', 'interrupted']
    const TOKEN_USAGE_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']

    function isTerminalTask(task) {
      return TERMINAL_STATUSES.includes(task.status)
    }

    function normalizeTelemetry(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
      const telemetry = {}
      for (const field of ['model', 'reasoningEffort']) {
        if (typeof value[field] === 'string' && value[field].trim()) telemetry[field] = value[field].trim()
      }
      for (const field of ['modelSource', 'reasoningEffortSource']) {
        if (['reported', 'configured'].includes(value[field])) telemetry[field] = value[field]
      }
      if (['task', 'session', 'turn'].includes(value.usageScope)) telemetry.usageScope = value.usageScope
      if (value.usage && typeof value.usage === 'object' && !Array.isArray(value.usage)) {
        const usage = {}
        for (const field of TOKEN_USAGE_FIELDS) {
          if (Number.isSafeInteger(value.usage[field]) && value.usage[field] >= 0) usage[field] = value.usage[field]
        }
        if (Object.keys(usage).length > 0) telemetry.usage = usage
      }
      return Object.keys(telemetry).length > 0 ? telemetry : undefined
    }

    function normalizeTask(value, parentSessionId) {
      if (!value || typeof value !== 'object' || typeof value.childId !== 'string' || value.childId.length === 0) return undefined
      const status = STATUS_VALUES.includes(value.status) ? value.status : 'unknown'
      const telemetry = normalizeTelemetry(value.telemetry)
      return {
        childId: value.childId,
        parentSessionId: stringValue(value.parentSessionId, parentSessionId),
        agent: stringValue(value.agent, 'agent'),
        label: stringValue(value.label, value.childId),
        ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
        ...(typeof value.reportPath === 'string' && value.reportPath.length > 0 ? { reportPath: value.reportPath } : {}),
        status,
        archived: typeof value.archived === 'boolean' ? value.archived : TERMINAL_STATUSES.includes(status),
        canContinue: value.canContinue === true,
        ...(typeof value.continueReason === 'string' && value.continueReason.length > 0 ? { continueReason: value.continueReason } : {}),
        ...(Number.isFinite(value.continuationCount) ? { continuationCount: value.continuationCount } : {}),
        startedAt: timeValue(value.startedAt),
        updatedAt: timeValue(value.updatedAt),
        ...(timeValue(value.finishedAt) === undefined ? {} : { finishedAt: timeValue(value.finishedAt) }),
        ...(value.output === undefined ? {} : { output: normalizeText(value.output) }),
        ...(value.diagnostic === undefined ? {} : { diagnostic: normalizeText(value.diagnostic) }),
        ...(Array.isArray(value.activities) ? { activities: value.activities.map(normalizeActivity).filter(Boolean) } : {}),
        ...(value.telemetry !== undefined ? { telemetry } : {}),
        ...(value.permission ? { permission: value.permission } : {}),
        truncated: value.truncated === true,
      }
    }

    async function requestTasks(parentSessionId, childId, signal) {
      const params = new URLSearchParams({ parentSessionId })
      if (childId !== undefined) params.set('childId', childId)
      const response = await fetch(`/multi-agent/tasks?${params}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      })
      const payload = await response.json()
      if (!response.ok || payload?.ok !== true || !payload.value || typeof payload.value !== 'object') throw new Error('tasks-unavailable')
      return payload.value
    }

    async function requestTaskAction(parentSessionId, action, options, signal) {
      const headers = { accept: 'application/json', 'content-type': 'application/json' }
      if (window.location?.protocol === 'dsh-app:') {
        const params = new URLSearchParams({ parentSessionId, view: 'action-proof' })
        const response = await fetch(`/multi-agent/tasks?${params}`, {
          credentials: 'same-origin', headers: { accept: 'application/json', 'x-dsh-task-panel': '1' }, signal,
        })
        const payload = await response.json()
        if (!response.ok || payload?.ok !== true || typeof payload.value?.proof !== 'string') throw new Error('Task panel authorization unavailable')
        headers['x-dsh-task-proof'] = payload.value.proof
      }
      const response = await fetch('/multi-agent/tasks', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({
          parentSessionId,
          action,
          ...(options.childId !== undefined ? { childId: options.childId } : {}),
          ...(action === 'set-permission' ? { choice: options.choice } : {}),
          ...(options.message !== undefined ? { message: options.message } : {}),
        }),
        signal,
      })
      const payload = await response.json()
      if (!response.ok || payload?.ok !== true) throw new Error(stringValue(payload?.error?.message))
      if (!payload.value || typeof payload.value !== 'object') throw new Error('')
      return payload.value
    }

    function useTaskManager(parentSessionId, visible, onSettled, t) {
      const generation = useRef(0)
      const controllers = useRef(new Set())
      const onSettledRef = useRef(onSettled)
      onSettledRef.current = onSettled
      const [state, setState] = useState(() => ({ parentSessionId, pending: false, error: '', receipt: undefined }))
      useEffect(() => {
        const current = ++generation.current
        setState({ parentSessionId, pending: false, error: '', receipt: undefined })
        return () => {
          if (generation.current === current) generation.current += 1
          for (const controller of controllers.current) controller.abort()
          controllers.current.clear()
        }
      }, [parentSessionId, visible])
      const manage = useCallback(async (action, options = {}) => {
        if (!visible || !parentSessionId) return undefined
        const current = generation.current
        const controller = new AbortController()
        controllers.current.add(controller)
        setState({ parentSessionId, pending: true, error: '', receipt: undefined })
        try {
          const value = await requestTaskAction(parentSessionId, action, options, controller.signal)
          if (current !== generation.current || controller.signal.aborted) return undefined
          setState({
            parentSessionId, pending: false, error: '',
            receipt: action === 'continue' ? { childId: options.childId, value } : undefined,
          })
          return value
        } catch (error) {
          if (current !== generation.current || controller.signal.aborted) return undefined
          setState({ parentSessionId, pending: false, error: error.message || t('tasks.actionFailed'), receipt: undefined })
          return undefined
        } finally {
          controllers.current.delete(controller)
          if (current === generation.current && visible) onSettledRef.current()
        }
      }, [parentSessionId, visible, t])
      const known = state.parentSessionId === parentSessionId
        ? state : { parentSessionId, pending: false, error: '', receipt: undefined }
      return { ...known, manage }
    }

    function normalizeTaskList(value, parentSessionId) {
      if (!Array.isArray(value.tasks)) throw new Error('invalid-task-list')
      return value.tasks.map((task) => normalizeTask(task, parentSessionId)).filter(Boolean)
        .sort((left, right) => {
          if (left.startedAt === undefined) return right.startedAt === undefined ? 0 : 1
          if (right.startedAt === undefined) return -1
          return right.startedAt - left.startedAt
        })
    }

    function pageVisibilitySnapshot() {
      return typeof document === 'undefined' || document.visibilityState !== 'hidden'
    }

    function usePageVisibility() {
      const [visible, setVisible] = useState(pageVisibilitySnapshot)
      useEffect(() => {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const update = () => setVisible(pageVisibilitySnapshot())
        document.addEventListener('visibilitychange', update)
        update()
        return () => document.removeEventListener('visibilitychange', update)
      }, [])
      return visible
    }

    function useTaskList(parentSessionId, visible, refresh, taskStore) {
      const pageVisible = usePageVisibility()
      const [state, setState] = useState(() => taskStore.getSnapshot(parentSessionId))
      useEffect(() => {
        const update = () => setState(taskStore.getSnapshot(parentSessionId))
        const unsubscribe = taskStore.subscribe(parentSessionId, update)
        update()
        return unsubscribe
      }, [parentSessionId, taskStore])
      useEffect(() => {
        if (!visible || !parentSessionId) return undefined
        return taskStore.watch(parentSessionId, { panelVisible: true })
      }, [parentSessionId, visible, taskStore])
      useEffect(() => {
        if (refresh > 0 && visible && parentSessionId) taskStore.refresh(parentSessionId)
      }, [parentSessionId, visible, refresh, taskStore])
      const snapshot = state.parentSessionId === parentSessionId ? state : taskStore.getSnapshot(parentSessionId)
      useEffect(() => {
        if (visible && pageVisible && pageVisibilitySnapshot() && parentSessionId && snapshot.unreadErrorCount > 0) {
          taskStore.markErrorsRead(parentSessionId)
        }
      }, [parentSessionId, visible, pageVisible, snapshot.unreadErrorCount, taskStore])
      return snapshot
    }

    function useTaskDetail(summary, parentSessionId, visible, expanded, refresh) {
      const childId = summary.childId
      const generation = useRef(0)
      const [state, setState] = useState(() => ({ childId, task: undefined, loading: false, error: false }))
      useEffect(() => {
        const current = ++generation.current
        if (!visible || !expanded || !parentSessionId || !childId) return undefined
        const controller = new AbortController()
        let active = true
        let timer
        const load = async () => {
          setState((previous) => ({ childId, task: previous.childId === childId ? previous.task : undefined, loading: previous.childId !== childId || previous.task === undefined, error: false }))
          try {
            const value = await requestTasks(parentSessionId, childId, controller.signal)
            if (!active || current !== generation.current) return
            const task = value.task === null ? undefined : normalizeTask(value.task, parentSessionId)
            setState({ childId, task, loading: task === undefined, error: false })
            if (task && !ACTIVE_STATUSES.includes(task.status)) return
          } catch {
            if (!active || current !== generation.current || controller.signal.aborted) return
            setState((previous) => ({ childId, task: previous.childId === childId ? previous.task : undefined, loading: false, error: true }))
          }
          if (active && current === generation.current) timer = setTimeout(load, 1500)
        }
        void load()
        return () => {
          active = false
          generation.current += 1
          clearTimeout(timer)
          controller.abort()
        }
      }, [parentSessionId, childId, visible, expanded, refresh])
      const known = state.childId === childId ? state : { loading: false, error: false, task: undefined }
      return {
        ...known,
        loaded: known.task !== undefined,
        task: known.task ? { ...summary, ...known.task, startedAt: known.task.startedAt ?? summary.startedAt } : summary,
      }
    }

    function useCompletionTask(parentSessionId, childId) {
      const generation = useRef(0)
      const [state, setState] = useState(() => ({ childId, status: 'loading', task: undefined }))
      useEffect(() => {
        const current = ++generation.current
        if (!parentSessionId || !childId) {
          setState({ childId, status: 'unavailable', task: undefined })
          return undefined
        }
        const controller = new AbortController()
        let active = true
        let timer
        let attempts = 0
        let missing = false
        const load = async () => {
          attempts += 1
          try {
            const value = await requestTasks(parentSessionId, childId, controller.signal)
            if (!active || current !== generation.current) return
            const task = value.task === null ? undefined : normalizeTask(value.task, parentSessionId)
            missing = value.task === null
            if (task) {
              setState({ childId, status: 'ready', task })
              return
            }
          } catch {
            missing = false
            if (!active || current !== generation.current || controller.signal.aborted) return
          }
          if (attempts >= 4) setState({ childId, status: missing ? 'untracked' : 'unavailable', task: undefined })
          else if (active && current === generation.current) timer = setTimeout(load, 1000)
        }
        void load()
        return () => {
          active = false
          generation.current += 1
          clearTimeout(timer)
          controller.abort()
        }
      }, [parentSessionId, childId])
      return state.childId === childId ? state : { childId, status: 'loading', task: undefined }
    }

    function statusLabel(status, t) {
      return t(`status.${STATUS_VALUES.includes(status) ? status : 'unknown'}`)
    }

    function formatDuration(task, t) {
      if (typeof task.startedAt !== 'number') return t('tasks.durationUnknown')
      const end = typeof task.finishedAt === 'number' ? task.finishedAt : Date.now()
      const seconds = Math.max(0, Math.floor((end - task.startedAt) / 1000))
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return `${minutes}m ${seconds % 60}s`
      return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    }

    function formatStartedAt(startedAt, includeTimeZone = false) {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        ...(includeTimeZone ? { timeZoneName: 'long' } : {}),
      }).format(new Date(startedAt))
    }

    function CreationTime({ startedAt, t }) {
      if (startedAt === undefined) return h('span', { className: 'matasks-created' }, t('tasks.createdUnknown'))
      const full = formatStartedAt(startedAt, true)
      const accessible = t('tasks.created', { time: full })
      return h('time', {
        className: 'matasks-created', dateTime: new Date(startedAt).toISOString(),
        title: accessible, 'aria-label': accessible,
      }, formatStartedAt(startedAt))
    }

    function tokenTotal(usage) {
      if (Number.isSafeInteger(usage?.totalTokens)) return usage.totalTokens
      if (Number.isSafeInteger(usage?.inputTokens) && Number.isSafeInteger(usage?.outputTokens)) {
        const total = usage.inputTokens + usage.outputTokens
        if (Number.isSafeInteger(total)) return total
      }
      return undefined
    }

    function TelemetryLine({ telemetry, t }) {
      const valueText = (value, source) => value
        ? `${value}${source ? ` · ${t(`telemetry.source.${source}`)}` : ''}`
        : t('telemetry.notProvided')
      const total = tokenTotal(telemetry?.usage)
      const scope = ['task', 'session', 'turn'].includes(telemetry?.usageScope) ? telemetry.usageScope : 'unknown'
      const details = TOKEN_USAGE_FIELDS.flatMap((field) => {
        const value = telemetry?.usage?.[field]
        return Number.isSafeInteger(value) ? [`${t(`telemetry.usage.${field}`)}: ${new Intl.NumberFormat().format(value)}`] : []
      })
      return h('div', { className: 'matasks-telemetry' },
        h('span', null, `${t('telemetry.model')}: ${valueText(telemetry?.model, telemetry?.modelSource)}`),
        h('span', null, `${t('telemetry.reasoningEffort')}: ${valueText(telemetry?.reasoningEffort, telemetry?.reasoningEffortSource)}`),
        h('span', { className: 'matasks-token-usage', title: details.length > 0 ? details.join('\n') : undefined },
          `${t(`telemetry.usage.${scope}`)}: ${total === undefined ? '—' : new Intl.NumberFormat().format(total)}`))
    }

    function concise(value, limit = 280) {
      const text = typeof value === 'string' ? value.trim() : ''
      return text.length > limit ? `${text.slice(0, limit - 3)}…` : text
    }

    function previewText(value, limit = 280) {
      return concise(typeof value === 'string' ? value.replace(/\s+/g, ' ') : '', limit)
    }

    function activityStatusLabel(status, t) {
      if (status === 'pending') return t('activityStatus.pending')
      if (status === 'in_progress' || status === 'inProgress') return t('activityStatus.inProgress')
      if (status === 'failed') return t('activityStatus.failed')
      if (status === 'declined') return t('activityStatus.declined')
      return statusLabel(status, t)
    }

    const BOTTOM_TOLERANCE = 6
    const HISTORY_PAGE_SIZE = 8

    const ICON_PATHS = {
      info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 11v6M12 7h.01'],
      history: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 7v5l3 2'],
      back: ['M19 12H5M11 6l-6 6 6 6'],
      refresh: ['M19 8a7 7 0 1 0 1 5', 'M19 3v5h-5'],
      report: ['M6 3h8l4 4v14H6z', 'M14 3v5h5', 'M9 12h6M9 16h6'],
      shield: ['M12 3l8 3v5c0 5-3 8-8 11-5-3-8-6-8-11V6z'],
      archive: ['M3 4h18v4H3zM5 8v12h14V8M9 12h6'],
      restore: ['M4 10h10a5 5 0 0 1 0 10h-2M9 5l-5 5 5 5'],
      clear: ['M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7'],
      tool: ['M14 6a4 4 0 0 0-5 5L4 16l4 4 5-5a4 4 0 0 0 5-5l-3 3-3-3z'],
      down: ['M12 4v15', 'M6 13l6 6 6-6'],
    }

    function Icon({ name }) {
      const paths = ICON_PATHS[name]
      return h('svg', {
        className: 'matasks-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      }, paths.map((d) => h('path', { key: d, d })))
    }

    function statusTone(status) {
      if (status === 'completed') return 'neutral'
      if (status === 'running') return 'active'
      if (['aborted', 'error', 'refusal'].includes(status)) return 'error'
      if (['max-tokens', 'interrupted'].includes(status)) return 'warn'
      return 'idle'
    }

    function StatusBadge({ status, t }) {
      return h('span', { className: 'matasks-status', 'data-tone': statusTone(status) }, statusLabel(status, t))
    }

    function activityText(activity) {
      return activity?.text || activity?.title || ''
    }

    const MARKDOWN_CONTAINER_TAGS = new Set([
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'strong', 'em', 's', 'del',
    ])

    function decodedFilePath(value) {
      try { return decodeURIComponent(value) } catch { return value }
    }

    function isWindowsDriveAbsolutePath(value) {
      return /^[a-z]:[\\/]/i.test(value)
    }

    function markdownLink(href) {
      const value = href.trim()
      if (!value || value.startsWith('//')) return { kind: 'invalid' }
      if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return { kind: 'external', href: value }
      if (/^file:/i.test(value)) {
        if (!/^file:\/\/\//i.test(value)) return { kind: 'invalid' }
        const path = decodedFilePath(value.slice(7)).replace(/^\/(?=[a-z]:[\\/])/i, '')
        return { kind: 'file', href: value, path }
      }
      const path = decodedFilePath(value)
      if (!isWindowsDriveAbsolutePath(path) && /^[a-z][a-z\d+.-]*:/i.test(value)) return { kind: 'invalid' }
      return { kind: 'file', href: value, path }
    }

    function renderMarkdownLink(token, children, key, context) {
      const link = markdownLink(token.attrGet('href') || '')
      if (link.kind === 'external') return h('a', {
        key, href: link.href, target: '_blank', rel: 'noopener noreferrer',
      }, children)
      if (link.kind === 'file' && context.openFile) return h('a', {
        key, href: link.href, className: 'matasks-file-link',
        onClick: (event) => { event.preventDefault(); context.openFile(context.scope, link.path) },
      }, children)
      return h('span', { key, className: 'matasks-invalid-link' }, children)
    }

    function renderMarkdownTokens(tokens, context) {
      const rendered = []
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]
        const key = `${index}-${token.type}`
        if (token.nesting === 1) {
          let closing = index + 1
          let depth = 1
          while (closing < tokens.length && depth > 0) {
            if (tokens[closing].nesting === 1) depth += 1
            else if (tokens[closing].nesting === -1) depth -= 1
            if (depth > 0) closing += 1
          }
          const children = renderMarkdownTokens(tokens.slice(index + 1, closing), context)
          if (token.type === 'link_open') rendered.push(renderMarkdownLink(token, children, key, context))
          else {
            const tag = MARKDOWN_CONTAINER_TAGS.has(token.tag) ? token.tag : 'span'
            const props = { key }
            if (tag === 'ol') {
              const start = Number(token.attrGet('start'))
              if (Number.isSafeInteger(start) && start > 0) props.start = start
            }
            if (tag === 'th' || tag === 'td') {
              const alignment = token.attrGet('style')?.match(/^text-align:(left|center|right)$/)?.[1]
              if (alignment) props.style = { textAlign: alignment }
            }
            if (token.hidden) rendered.push(...children)
            else rendered.push(h(tag, props, children))
          }
          index = closing
        } else if (token.type === 'inline') {
          rendered.push(...renderMarkdownTokens(token.children || [], context))
        } else if (token.type === 'text' || token.type === 'html_inline' || token.type === 'html_block') {
          rendered.push(token.content)
        } else if (token.type === 'code_inline') {
          rendered.push(h('code', { key, className: 'matasks-inline-code' }, token.content))
        } else if (token.type === 'fence' || token.type === 'code_block') {
          rendered.push(h('pre', { key, className: 'matasks-markdown-code' }, h('code', null, token.content)))
        } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
          rendered.push(h('br', { key }))
        } else if (token.type === 'image') {
          rendered.push(h('span', { key, className: 'matasks-image-alt' }, token.content))
        } else if (token.type === 'hr') {
          rendered.push(h('hr', { key }))
        } else if (token.content) {
          rendered.push(token.content)
        }
      }
      return rendered
    }

    function MarkdownContent({ text, className = '', scope, openFile, ...props }) {
      const tokens = useMemo(() => markdownParser.parse(typeof text === 'string' ? text : '', {}), [text])
      return h('div', {
        ...props, className: `matasks-markdown${className ? ` ${className}` : ''}`,
      }, renderMarkdownTokens(tokens, { scope, openFile }))
    }

    function MessageActivity({ activity, scope, openFile }) {
      return h(MarkdownContent, {
        text: activityText(activity), className: 'matasks-message', scope, openFile,
        'data-activity-id': activity.id, 'data-activity-type': activity.type,
      })
    }

    function ToolActivityItem({ activity, t, onDisclosure }) {
      const summary = previewText(activity.title || activity.text, 180)
      return h('li', {
        className: 'matasks-tool-item', 'data-activity-id': activity.id, 'data-activity-type': activity.type,
      }, h('details', { className: 'matasks-tool-detail', onToggle: onDisclosure },
        h('summary', { className: 'matasks-tool-summary' },
          h(Icon, { name: 'tool' }),
          summary ? h('code', { className: 'matasks-command-preview' }, summary) : null,
          activity.status ? h('span', { className: 'matasks-tool-status' }, activityStatusLabel(activity.status, t)) : null),
        activity.title ? h('pre', { className: 'matasks-command' }, activity.title) : null,
        activity.text ? h('pre', { className: 'matasks-output' }, activity.text) : null))
    }

    function timelineGroups(activities) {
      const groups = []
      for (const activity of activities) {
        if (activity.type === 'tool' && groups.at(-1)?.type === 'tools') groups.at(-1).activities.push(activity)
        else if (activity.type === 'tool') groups.push({ type: 'tools', id: `tools-${activity.id}`, activities: [activity] })
        else groups.push({ type: 'message', id: activity.id, activity })
      }
      return groups
    }

    function ActivityList({ activities, hiddenCount, t, onShowEarlier, onToolDisclosure, scope, openFile }) {
      const groups = timelineGroups(activities)
      return h('section', null,

        hiddenCount > 0 ? h('div', { className: 'matasks-history' }, h('button', {
          type: 'button', name: 'earlier-activities', className: 'matasks-activity-toggle', onClick: onShowEarlier,
        }, t('activities.showEarlier', { count: hiddenCount }))) : null,
        groups.length === 0 ? h('p', { className: 'matasks-muted' }, t('activities.empty')) : null,
        groups.length > 0 ? h('div', { className: 'matasks-timeline' }, groups.map((group) => group.type === 'message'
          ? h(MessageActivity, { key: group.id, activity: group.activity, scope, openFile })
          : h('details', { key: group.id, className: 'matasks-tool-activity', onToggle: onToolDisclosure },
            h('summary', null, h(Icon, { name: 'tool' }), h('span', null, t('activities.toolActivity', { count: group.activities.length }))),
            h('ol', { className: 'matasks-tool-activities' }, group.activities.map((activity) => h(ToolActivityItem, {
              key: activity.id, activity, t, onDisclosure: onToolDisclosure,
            })))))) : null)
    }

    function requestFrame(callback) {
      return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 0)
    }

    function cancelFrame(frame) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      else clearTimeout(frame)
    }

    function useActivityViewport({ state, activities, contentSignature, visible, ready }) {
      const [viewport, setViewport] = useState(null)
      const [following, setFollowing] = useState(state.follow)
      const [, setHistoryVersion] = useState(0)
      const viewportRef = useCallback((node) => setViewport(node), [])
      const contentRef = useRef(null)
      const frameRef = useRef(null)
      const toolFrameRef = useRef(null)
      const programmaticRef = useRef(null)
      const previousRef = useRef({ viewport: null })
      const visibleRef = useRef(visible)
      visibleRef.current = visible && ready
      // Hidden/loading containers can have zero geometry. Defer restoration until
      // the selected child's actual content has been laid out again.
      if (!visible || !ready) previousRef.current.viewport = null

      const cancelScheduledFrame = useCallback(() => {
        if (frameRef.current !== null) cancelFrame(frameRef.current)
        if (toolFrameRef.current !== null) cancelFrame(toolFrameRef.current)
        frameRef.current = null
        toolFrameRef.current = null
        state.preserveScrollTop = null
      }, [state])

      const writeScrollTop = useCallback((top) => {
        if (!viewport || !visibleRef.current || viewport.clientHeight <= 0) return
        const target = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight))
        programmaticRef.current = { target }
        viewport.scrollTop = target
        state.scrollTop = viewport.scrollTop
        programmaticRef.current.target = viewport.scrollTop
      }, [state, viewport])

      const scrollToBottom = useCallback(() => {
        if (!viewport) return
        writeScrollTop(Math.max(0, viewport.scrollHeight - viewport.clientHeight))
      }, [viewport, writeScrollTop])

      const scheduleBottom = useCallback(() => {
        if (!viewport || !visibleRef.current || !state.follow) return
        cancelScheduledFrame()
        frameRef.current = requestFrame(() => {
          frameRef.current = null
          if (visibleRef.current && state.follow) scrollToBottom()
        })
      }, [cancelScheduledFrame, scrollToBottom, state, viewport])

      const updateFollowing = useCallback((next) => {
        if (state.follow === next) return
        state.follow = next
        if (next) {
          state.pinnedActivityId = null
          state.preserveAnchor = null
        } else {
          state.pinnedActivityId = state.pinnedActivityId || state.firstVisibleActivityId || null
        }
        setFollowing(next)
      }, [state])

      const onScroll = useCallback((event) => {
        const node = event.currentTarget
        if (!visibleRef.current || node.clientHeight <= 0) return
        const top = node.scrollTop
        const previous = state.scrollTop
        state.scrollTop = top
        const programmatic = programmaticRef.current
        if (programmatic) {
          if (Math.abs(top - programmatic.target) <= 1) {
            programmaticRef.current = null
            return
          }
          programmaticRef.current = null
        }
        if (typeof state.preserveScrollTop === 'number') cancelScheduledFrame()
        if (top < previous - 1) {
          updateFollowing(false)
          cancelScheduledFrame()
        } else if (node.scrollHeight - node.clientHeight - top <= BOTTOM_TOLERANCE) {
          updateFollowing(true)
        }
      }, [cancelScheduledFrame, state, updateFollowing])

      const jumpToLatest = useCallback(() => {
        cancelScheduledFrame()
        updateFollowing(true)
        state.pinnedActivityId = null
        scrollToBottom()
      }, [cancelScheduledFrame, scrollToBottom, state, updateFollowing])

      const showEarlier = useCallback(() => {
        cancelScheduledFrame()
        const retained = activities.filter((activity) => activity.type === 'message')
        const anchorId = state.pinnedActivityId || state.firstVisibleActivityId
        const anchorIndex = retained.findIndex((activity) => activity.id === anchorId)
        const start = Math.max(0, (anchorIndex >= 0 ? anchorIndex : retained.length - state.historyLimit) - HISTORY_PAGE_SIZE)
        state.historyLimit = Math.max(state.historyLimit, retained.length - start)
        state.pinnedActivityId = retained[start]?.id || anchorId || null
        if (viewport) state.preserveAnchor = { scrollHeight: viewport.scrollHeight, scrollTop: viewport.scrollTop }
        updateFollowing(false)
        setHistoryVersion((value) => value + 1)
      }, [activities, cancelScheduledFrame, state, updateFollowing, viewport])

      const onToolDisclosure = useCallback(() => {
        if (!viewport || !visibleRef.current || viewport.clientHeight <= 0) return
        cancelScheduledFrame()
        const top = viewport.scrollTop
        state.preserveScrollTop = top
        toolFrameRef.current = requestFrame(() => {
          toolFrameRef.current = null
          if (state.preserveScrollTop !== top) return
          if (visibleRef.current) writeScrollTop(top)
          state.preserveScrollTop = null
        })
      }, [cancelScheduledFrame, state, viewport, writeScrollTop])

      const syncViewport = useCallback(() => {
        if (!viewport || !visibleRef.current || viewport.clientHeight <= 0) return
        const first = previousRef.current.viewport !== viewport
        previousRef.current.viewport = viewport
        const anchor = state.preserveAnchor
        if (typeof state.preserveScrollTop === 'number') {
          writeScrollTop(state.preserveScrollTop)
        } else if (anchor) {
          state.preserveAnchor = null
          writeScrollTop(anchor.scrollTop + viewport.scrollHeight - anchor.scrollHeight)
        } else if (first && !state.follow) {
          writeScrollTop(state.scrollTop)
        } else if (state.follow) {
          scheduleBottom()
        }
      }, [scheduleBottom, state, viewport, writeScrollTop])

      useLayoutEffect(() => {
        syncViewport()
        return cancelScheduledFrame
      }, [cancelScheduledFrame, contentSignature, following, ready, state.historyLimit, syncViewport, visible])

      useLayoutEffect(() => {
        if (!viewport || !visible || !ready) return undefined
        const content = contentRef.current
        const update = () => syncViewport()
        const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
        resizeObserver?.observe(viewport)
        if (content) resizeObserver?.observe(content)
        const mutationObserver = typeof MutationObserver === 'function' && content
          ? new MutationObserver(update) : null
        mutationObserver?.observe(content, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['open'] })
        return () => {
          cancelScheduledFrame()
          resizeObserver?.disconnect()
          mutationObserver?.disconnect()
          programmaticRef.current = null
          // onScroll/writeScrollTop already capture valid geometry. Cleanup may
          // run after display:none or detach and must not overwrite it with zero.
        }
      }, [cancelScheduledFrame, ready, syncViewport, viewport, visible])

      return { following, viewportRef, contentRef, onScroll, jumpToLatest, showEarlier, onToolDisclosure }
    }

    function taskContentSignature(task, loaded) {
      return JSON.stringify({
        loaded,
        output: task.output,
        diagnostic: task.diagnostic,
        truncated: task.truncated,
        activities: (task.activities || []).map((activity) => [activity.id, activity.type, activity.title, activity.text, activity.status]),
      })
    }

    function ContinueTaskForm({ task, manager, t }) {
      const [message, setMessage] = useState('')
      const submit = async (event) => {
        event.preventDefault()
        const text = message.trim()
        if (!text || manager.pending) return
        const receipt = await manager.manage('continue', { childId: task.childId, message: text })
        if (receipt) setMessage('')
      }
      return h('details', { className: 'matasks-continue' },
        h('summary', null, t('tasks.continue')),
        h('form', { className: 'matasks-continue-form', onSubmit: submit },
          h('textarea', {
            value: message, rows: 2, required: true, disabled: manager.pending,
            'aria-label': t('tasks.continueMessage'), placeholder: t('tasks.continuePlaceholder'),
            onChange: (event) => setMessage(event.currentTarget.value),
          }),
          h('button', { type: 'submit', name: `continue-${task.childId}`, disabled: manager.pending || !message.trim() },
            t('tasks.continueSubmit'))))
    }

    function TaskPermissions({ task, manager, t }) {
      const permission = task.permission
      const [draft, setDraft] = useState(null)
      const native = permission.kind === 'native'
      const selected = draft ?? permission.selected
      const choiceLabel = (choice) => t(choice === 'subagent:auto' && task.agent !== 'codex' ? 'perm.acpAuto' : `perm.${choice}`)
      const label = (choice) => {
        if (choice === 'default') {
          const base = t(native ? 'perm.nativeDefault' : 'perm.default')
          return permission.defaultChoice ? `${base} (${choiceLabel(permission.defaultChoice)})` : base
        }
        return choiceLabel(choice)
      }
      const submit = async (event) => {
        event.preventDefault()
        if (manager.pending || selected === permission.selected) return
        if (await manager.manage('set-permission', { childId: task.childId, choice: selected })) setDraft(null)
      }
      const effective = permission.inheritsFullAccess ? t('perm.inheritedFull') : permission.effective && label(permission.effective)
      const launch = permission.launcher && permission.launcher !== 'acp' ? t(`perm.launcher.${permission.launcher}`) : ''
      const current = [effective, launch].filter(Boolean).join(' · ')
      const hint = t(native ? 'perm.nativeHint'
        : permission.effective ? 'perm.externalHint' : 'perm.next')
      return h('details', { className: 'matasks-continue matasks-permissions' },
        h('summary', { title: hint, 'aria-description': hint },
          t('perm.title'),
          current ? h('span', { className: 'matasks-permission-current', role: 'status' },
            t('perm.effective', { value: current })) : null,
          permission.pending ? h('span', { role: 'status', className: 'matasks-permission-pending' }, t('perm.pending')) : null),
        h('form', { onSubmit: submit },
          h('select', { value: selected, disabled: manager.pending,
            'aria-label': t('perm.selection'), title: hint, onChange: (event) => setDraft(event.currentTarget.value),
          }, permission.choices.map((choice) => h('option', { key: choice, value: choice }, label(choice)))),
          h('button', { type: 'submit', disabled: manager.pending || selected === permission.selected }, t('perm.save')),
          !permission.effective ? h('span', { className: 'matasks-muted' }, t('perm.next')) : null))
    }

    function TaskWorkspace({ summary, parentSessionId, cwd, visible, refresh, t, openFile, stateStore, tabId, panelId, manager, onClear }) {
      const key = JSON.stringify([parentSessionId, summary.childId])
      const state = useMemo(() => {
        if (stateStore.has(key)) return stateStore.get(key)
        const created = {
          scrollTop: 0, follow: true, historyLimit: HISTORY_PAGE_SIZE, pinnedActivityId: null,
          firstVisibleActivityId: null, preserveAnchor: null, preserveScrollTop: null,
        }
        stateStore.set(key, created)
        return created
      }, [key, stateStore])
      const detail = useTaskDetail(summary, parentSessionId, visible, true, refresh)
      const task = detail.task
      const activities = task.activities || []
      const viewport = useActivityViewport({ state, activities, contentSignature: taskContentSignature(task, detail.loaded), visible, ready: detail.loaded })
      const messages = activities.filter((activity) => activity.type === 'message')
      let start = Math.max(0, messages.length - state.historyLimit)
      if (!viewport.following && state.pinnedActivityId) {
        const pinned = messages.findIndex((activity) => activity.id === state.pinnedActivityId)
        if (pinned >= 0) start = pinned
      }
      const visibleActivities = messages.slice(start)
      const visibleActivitySet = new Set(visibleActivities)
      const timelineActivities = activities.filter((activity) => activity.type === 'tool' || visibleActivitySet.has(activity))
      const finalOutput = task.output?.trim() && activityText(messages.at(-1)).trim() !== task.output.trim() ? task.output : ''
      const fileScope = { sessionId: parentSessionId, ...(task.cwd ? { cwd: task.cwd } : {}) }
      state.firstVisibleActivityId = visibleActivities[0]?.id || null
      return h('section', {
        className: 'matasks-workspace', role: 'tabpanel', id: panelId, 'aria-labelledby': tabId || historyViewId(parentSessionId, task.childId),
        'data-task-id': task.childId,
      },
      h('header', { className: 'matasks-task-head' },
        h('div', { className: 'matasks-task-title' },
          !tabId ? h('span', { className: 'matasks-label', id: historyViewId(parentSessionId, task.childId) }, task.label) : null,
          h('span', { className: 'matasks-badge' }, agentLabel(task.agent)),
          h(StatusBadge, { status: task.status, t }),
          task.startedAt !== undefined ? h('span', { className: 'matasks-duration', title: t('tasks.created', { time: formatStartedAt(task.startedAt, true) }) }, formatDuration(task, t)) : null),
        h('div', { className: 'matasks-actions' },
          task.permission?.kind === 'native' && !task.permission.editable ? h('span', {
            className: 'matasks-permission-offline', role: 'img', tabIndex: 0,
            'aria-label': `${t('perm.title')} · ${t('perm.offline')}`, title: t('perm.nativeOffline'), 'aria-description': t('perm.nativeOffline'),
          }, h(Icon, { name: 'shield' })) : null,
          task.reportPath ? h('button', {
            type: 'button', name: `report-${task.childId}`, title: t('tasks.report'), 'aria-label': t('tasks.report'),
            onClick: () => openFile({ sessionId: parentSessionId, ...(cwd ? { cwd } : {}) }, task.reportPath),
          }, h(Icon, { name: 'report' })) : null,
          isTerminalTask(task) && !task.archived ? h('button', {
            type: 'button', name: `archive-${task.childId}`, disabled: manager.pending, title: t('tasks.archive'), 'aria-label': t('tasks.archive'),
            onClick: () => manager.manage('archive', { childId: task.childId }),
          }, h(Icon, { name: 'archive' })) : null,
          isTerminalTask(task) ? h('button', {
            type: 'button', name: `clear-${task.childId}`, disabled: manager.pending,
            title: `${t('tasks.clear')} · ${t('tasks.clearDescription')}`, 'aria-label': `${t('tasks.clear')}: ${task.label}`,
            onClick: () => onClear(task.childId),
          }, h(Icon, { name: 'clear' })) : null),
        h('details', { className: 'matasks-run-details' },
          h('summary', { title: t('tasks.runDetails') },
            task.telemetry?.model || t('tasks.runDetails')),
          h('div', { className: 'matasks-task-timing' },
            h(CreationTime, { startedAt: task.startedAt, t }),
            task.continuationCount > 0 ? h('span', null, t('tasks.continuationCount', { count: task.continuationCount })) : null),
          h(TelemetryLine, { telemetry: task.telemetry, t }))),
      task.permission?.editable
        ? h(TaskPermissions, { key, task, manager, t }) : null,
      h('div', { className: 'matasks-activity-frame' },
        h('div', {
          className: 'matasks-activity-viewport', ref: viewport.viewportRef, tabIndex: 0,
          role: 'log', 'aria-label': t('tasks.activities'), 'aria-live': 'polite', 'aria-relevant': 'additions text',
          onScroll: viewport.onScroll,
        }, h('div', { className: 'matasks-activity-content', ref: viewport.contentRef },
          detail.loading ? h('p', { role: 'status', className: 'matasks-muted' }, t('tasks.detailLoading')) : null,
          detail.error ? h('p', { role: 'alert', className: 'matasks-error' }, t('tasks.detailUnavailable')) : null,
          task.diagnostic ? h('p', { role: 'alert', className: 'matasks-error' }, task.diagnostic) : null,
          task.truncated ? h('p', { className: 'matasks-muted' }, t('tasks.truncated')) : null,
          detail.loaded && (timelineActivities.length > 0 || (!finalOutput && !task.diagnostic)) ? h(ActivityList, {
            activities: timelineActivities, hiddenCount: Math.max(0, messages.length - visibleActivities.length), t,
            onShowEarlier: viewport.showEarlier, onToolDisclosure: viewport.onToolDisclosure, scope: fileScope, openFile,
          }) : null,
          finalOutput ? h('section', { className: 'matasks-final-output' },
            h('h3', null, t('tasks.output')),
            h(MarkdownContent, { text: finalOutput, className: 'matasks-final-output-text', scope: fileScope, openFile })) : null)),
        !viewport.following ? h('button', {
          type: 'button', name: 'jump-latest', className: 'matasks-jump-latest',
          title: t('tasks.jumpToLatest'), 'aria-label': t('tasks.jumpToLatest'), onClick: viewport.jumpToLatest,
        }, h(Icon, { name: 'down' })) : null),
      isTerminalTask(task) && task.canContinue ? h(ContinueTaskForm, { task, manager, t }) : null,
      isTerminalTask(task) && !task.canContinue ? h('p', { className: 'matasks-muted matasks-continue-unavailable' },
        task.continueReason || t('tasks.continueUnavailable')) : null)
    }

    function safeDomId(value) {
      return encodeURIComponent(value || 'task')
    }

    function historyViewId(parentSessionId, childId) {
      return `${NS}-${safeDomId(parentSessionId)}-history-view-${safeDomId(childId)}`
    }

    function TaskHistory({ tasks, parentSessionId, selectedChildId, onClose, onView, onClear, backRef, viewRefs, manager, toolbarActions, t }) {
      const clearNoteId = `${NS}-${safeDomId(parentSessionId)}-clear-note`
      useEffect(() => { backRef.current?.focus?.() }, [backRef])
      return h('section', { className: 'matasks-task-history', 'aria-label': t('tasks.history', { count: tasks.length }),
        onKeyDown: (event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } },
      },
        h('header', { className: 'matasks-history-heading' },
          h('h2', null, t('tasks.history', { count: tasks.length })),
          h('div', { className: 'matasks-history-actions' },
            toolbarActions,
            tasks.some(isTerminalTask) ? h('button', {
              type: 'button', name: 'clear-history', disabled: manager.pending,
              title: `${t('tasks.clearHistory')} · ${t('tasks.clearDescription')}`, 'aria-label': t('tasks.clearHistory'), 'aria-describedby': clearNoteId,
              onClick: () => onClear(),
            }, h(Icon, { name: 'clear' })) : null,
            h('button', { type: 'button', name: 'history-back', ref: backRef, onClick: onClose,
              title: t('tasks.backToCurrent'), 'aria-label': t('tasks.backToCurrent') }, h(Icon, { name: 'back' })))),
        h('div', { className: 'matasks-history-body' },
          tasks.length === 0 ? h('p', { className: 'matasks-muted' }, t('tasks.historyEmpty')) : null,
          h('p', { id: clearNoteId, hidden: true }, t('tasks.clearDescription')),
          h('ul', { className: 'matasks-history-list' }, tasks.map((task) => h('li', {
            key: task.childId, className: 'matasks-history-row',
            'data-history-task-id': task.childId, 'data-selected': task.childId === selectedChildId,
          },
          h('div', { className: 'matasks-history-main' },
            h('button', {
              type: 'button', name: `history-view-${task.childId}`, id: historyViewId(parentSessionId, task.childId),
              className: 'matasks-history-link', title: `${t('tasks.viewHistory')} · ${task.label}`,
              ref: (node) => { if (node) viewRefs.current.set(task.childId, node); else viewRefs.current.delete(task.childId) },
              onClick: () => onView(task.childId),
            }, task.label),
            h('span', { className: 'matasks-history-meta' }, agentLabel(task.agent), ' · ', h(CreationTime, { startedAt: task.startedAt, t }))),
          h('div', { className: 'matasks-history-actions' },
            h(StatusBadge, { status: task.status, t }),
            h('button', {
              type: 'button', name: `restore-${task.childId}`, disabled: manager.pending,
              title: `${t('tasks.restore')} · ${t('tasks.restoreDescription')}`, 'aria-label': `${t('tasks.restore')}: ${task.label}`,
              onClick: () => manager.manage('restore', { childId: task.childId }),
            }, h(Icon, { name: 'restore' })),
            isTerminalTask(task) ? h('button', {
              type: 'button', name: `clear-${task.childId}`, disabled: manager.pending,
              title: `${t('tasks.clear')} · ${t('tasks.clearDescription')}`, 'aria-label': `${t('tasks.clear')}: ${task.label}`, 'aria-describedby': clearNoteId,
              onClick: () => onClear(task.childId),
            }, h(Icon, { name: 'clear' })) : null))))))
    }

    function TasksPanel({ scope, tab, visible, t, openFile, taskStore }) {
      const parentSessionId = tab?.meta?.parentSessionId || scope?.sessionId
      const focusChildId = tab?.meta?.childId
      const cwd = scope?.cwd
      const [refresh, setRefresh] = useState(0)
      const [selections, setSelections] = useState(() => new Map())
      const [historyStates, setHistoryStates] = useState(() => new Map())
      const selection = selections.get(parentSessionId)
      const historyOpen = historyStates.get(parentSessionId) === true
      const setSelection = (next) => setSelections((previous) => {
        const updated = new Map(previous)
        updated.set(next.parentSessionId, next)
        return updated
      })
      const setHistoryOpen = (open) => setHistoryStates((previous) => {
        if ((previous.get(parentSessionId) === true) === open) return previous
        const updated = new Map(previous)
        updated.set(parentSessionId, open)
        return updated
      })
      const handledFocus = useRef(new Map())
      const tabRefs = useRef(new Map())
      const historyButtonRef = useRef(null)
      const historyBackRef = useRef(null)
      const historyViewRefs = useRef(new Map())
      const emptyStatusRef = useRef(null)
      const pendingClearFocus = useRef(null)
      const listLoadSeqRef = useRef(0)
      const historyWasOpen = useRef(false)
      useEffect(() => {
        if (historyWasOpen.current && !historyOpen) historyButtonRef.current?.focus?.()
        historyWasOpen.current = historyOpen
      }, [parentSessionId, historyOpen])
      const lastActiveSelection = useRef(new Map())
      const viewportStates = useRef(new Map())
      const list = useTaskList(parentSessionId, visible === true, refresh, taskStore)
      listLoadSeqRef.current = list.loadSeq
      const manager = useTaskManager(parentSessionId, visible === true, () => setRefresh((value) => value + 1), t)
      const tasks = list.tasks
      const activeTasks = tasks.filter((task) => !task.archived)
      const historyTasks = tasks.filter((task) => task.archived)
      const focusSignature = focusChildId
        ? JSON.stringify([parentSessionId, focusChildId, tab?.navigationRevision ?? 0])
        : null
      const focusedTask = tasks.find((task) => task.childId === focusChildId)
      const focusPending = focusSignature && handledFocus.current.get(parentSessionId) !== focusSignature && focusedTask
      const storedSelectionValid = selection && tasks.some((task) => task.childId === selection.childId)
      const selectedChildId = focusPending ? focusChildId : storedSelectionValid ? selection.childId : activeTasks[0]?.childId
      const selectedSummary = tasks.find((task) => task.childId === selectedChildId)
      const selectedIsActive = selectedSummary && !selectedSummary.archived
      const tabId = (task) => `${NS}-${safeDomId(parentSessionId)}-tab-${safeDomId(task.childId)}`
      const panelId = (task) => `${NS}-${safeDomId(parentSessionId)}-panel-${safeDomId(task.childId)}`
      const keyboardChildId = selectedIsActive ? selectedChildId : activeTasks[0]?.childId

      useEffect(() => {
        if (!focusSignature) {
          handledFocus.current.delete(parentSessionId)
          return
        }
        if (handledFocus.current.get(parentSessionId) === focusSignature || !focusedTask) return
        handledFocus.current.set(parentSessionId, focusSignature)
        setSelection({ parentSessionId, childId: focusChildId })
        setHistoryOpen(false)
      }, [focusChildId, focusSignature, focusedTask, parentSessionId, tasks])

      useEffect(() => {
        if (selectedChildId && selection?.childId !== selectedChildId) {
          setSelection({ parentSessionId, childId: selectedChildId })
        }
      }, [parentSessionId, selectedChildId, selection])

      useEffect(() => {
        if (selectedSummary && !selectedSummary.archived) lastActiveSelection.current.set(parentSessionId, selectedSummary.childId)
      }, [parentSessionId, selectedSummary?.childId, selectedSummary?.archived])

      useEffect(() => {
        if (!visible || !parentSessionId) {
          pendingClearFocus.current = null
          return
        }
        const intent = pendingClearFocus.current
        if (!intent) return
        if (intent.parentSessionId !== parentSessionId) {
          pendingClearFocus.current = null
          return
        }
        if (list.loadSeq <= intent.baselineLoadSeq) return
        pendingClearFocus.current = null
        if (intent.view === 'history') {
          if (!historyOpen) return
          const targetHistoryId = intent.candidateIds.find((id) => historyTasks.some((item) => item.childId === id))
          if (targetHistoryId && historyViewRefs.current.get(targetHistoryId)) {
            historyViewRefs.current.get(targetHistoryId).focus()
          } else {
            historyBackRef.current?.focus?.()
          }
          return
        }
        if (historyOpen) return
        const targetTabId = selectedIsActive ? selectedChildId : activeTasks[0]?.childId
        if (targetTabId && tabRefs.current.get(targetTabId)) {
          tabRefs.current.get(targetTabId).focus({ preventScroll: true })
        } else {
          emptyStatusRef.current?.focus?.()
        }
      }, [activeTasks, historyOpen, historyTasks, list.loadSeq, parentSessionId, selectedChildId, selectedIsActive, visible])

      const clearFromHistory = async (childId) => {
        const beforeIds = historyTasks.map((item) => item.childId)
        const index = childId ? beforeIds.indexOf(childId) : -1
        const candidateIds = index >= 0
          ? [...beforeIds.slice(index + 1), ...beforeIds.slice(0, index).reverse()]
          : []
        const accepted = await manager.manage('clear', childId ? { childId } : {})
        if (!accepted) return
        pendingClearFocus.current = {
          parentSessionId,
          view: 'history',
          candidateIds,
          baselineLoadSeq: listLoadSeqRef.current,
        }
      }
      const clearFromWorkspace = async (childId) => {
        const beforeActiveIds = activeTasks.map((item) => item.childId)
        const index = beforeActiveIds.indexOf(childId)
        const nextSelectedId = index >= 0
          ? (beforeActiveIds[index + 1] ?? beforeActiveIds[index - 1])
          : activeTasks[0]?.childId
        const accepted = await manager.manage('clear', { childId })
        if (!accepted) return
        if (nextSelectedId) setSelection({ parentSessionId, childId: nextSelectedId })
        pendingClearFocus.current = {
          parentSessionId,
          view: 'workspace',
          baselineLoadSeq: listLoadSeqRef.current,
        }
      }

      const selectTask = (childId) => { setSelection({ parentSessionId, childId }); setHistoryOpen(false) }
      const viewHistory = (childId) => {
        setSelection({ parentSessionId, childId })
        setHistoryOpen(false)
      }
      const returnToCurrent = () => {
        const previousId = lastActiveSelection.current.get(parentSessionId)
        const childId = activeTasks.some((task) => task.childId === previousId) ? previousId : activeTasks[0]?.childId || ''
        setSelection({ parentSessionId, childId })
        setHistoryOpen(false)
        historyButtonRef.current?.focus?.()
      }
      const onTabKeyDown = (event, index) => {
        let next
        if (event.key === 'ArrowLeft') next = (index - 1 + activeTasks.length) % activeTasks.length
        else if (event.key === 'ArrowRight') next = (index + 1) % activeTasks.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = activeTasks.length - 1
        else return
        event.preventDefault()
        const childId = activeTasks[next].childId
        selectTask(childId)
        tabRefs.current.get(childId)?.focus({ preventScroll: true })
      }

      useEffect(() => {
        if (visible && !historyOpen) tabRefs.current.get(selectedChildId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      }, [selectedChildId, visible, historyOpen])

      const toolbarActions = h('div', { className: 'matasks-view-actions' },
        !historyOpen ? h('button', { type: 'button', name: 'open-history', ref: historyButtonRef,
          title: t('tasks.history', { count: historyTasks.length }), 'aria-label': t('tasks.history', { count: historyTasks.length }),
          onClick: () => setHistoryOpen(true) }, h(Icon, { name: 'history' }), h('span', null, historyTasks.length)) : null,
        !historyOpen && selectedSummary?.archived ? h('button', { type: 'button', name: 'back-current', onClick: returnToCurrent,
          title: t('tasks.backToCurrent'), 'aria-label': t('tasks.backToCurrent') }, h(Icon, { name: 'back' })) : null,
        h('details', { className: 'matasks-session-meta', onKeyDown: (event) => {
          if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector?.('summary')?.focus() }
        } },
          h('summary', { title: t('tasks.sessionMetadata'), 'aria-label': t('tasks.sessionMetadata') }, h(Icon, { name: 'info' })),
          h('dl', null,
            h('dt', null, t('tasks.mainSession')), h('dd', null, h('code', null, parentSessionId || '—')),
            selectedSummary ? h('dt', null, t('tasks.childSession')) : null,
            selectedSummary ? h('dd', null, h('code', null, selectedSummary.childId)) : null)),
        h('button', { type: 'button', name: 'refresh-tasks', title: t('tasks.refresh'), 'aria-label': t('tasks.refresh'),
          onClick: () => setRefresh((value) => value + 1) }, h(Icon, { name: 'refresh' })))
      const theme = useTheme()
      return h('div', { className: 'matasks matasks-panel', 'data-ma-theme': theme },
        h('style', null, `${THEME_CSS}\n${CSS}`),
        !historyOpen ? h('header', { className: 'matasks-overview' },
          h('div', { className: 'matasks-heading', hidden: !historyOpen && activeTasks.length > 0 },
            h('h2', null, t('tasks.title')),
            h('span', { className: 'matasks-overview-count', title: t('tasks.overview', { count: activeTasks.length }) },
              t('tasks.overview', { count: activeTasks.length }))),
          !historyOpen && activeTasks.length > 0 ? h('div', { className: 'matasks-tabs', role: 'tablist', 'aria-label': t('tasks.childTabs') },
            activeTasks.map((task, index) => h('button', {
              key: task.childId, type: 'button', name: `task-tab-${task.childId}`, role: 'tab',
              title: [task.label, agentLabel(task.agent), statusLabel(task.status, t),
                task.startedAt === undefined ? t('tasks.createdUnknown') : t('tasks.created', { time: formatStartedAt(task.startedAt, true) })].join(' · '),
              id: tabId(task), 'aria-controls': panelId(task), 'aria-selected': task.childId === selectedChildId,
              'aria-label': [task.label, agentLabel(task.agent), statusLabel(task.status, t)].join(' · '),
              tabIndex: task.childId === keyboardChildId ? 0 : -1, className: 'matasks-tab',
              ref: (node) => { if (node) tabRefs.current.set(task.childId, node); else tabRefs.current.delete(task.childId) },
              onClick: () => selectTask(task.childId), onKeyDown: (event) => onTabKeyDown(event, index),
            },
            h(StatusBadge, { status: task.status, t }),
            h('span', { className: 'matasks-tab-label' }, task.label)))) : null,
          toolbarActions) : null,
        list.error ? h('p', { role: 'alert', className: 'matasks-error' }, t('tasks.historyUnavailable')) : null,
        manager.error ? h('p', { role: 'alert', className: 'matasks-error' }, manager.error) : null,
        manager.receipt && selectedSummary?.childId === manager.receipt.childId ? h('p', { role: 'status', className: 'matasks-muted matasks-receipt' },
          t('tasks.continueAccepted'), ' ',
          manager.receipt.value.subagentId ? h('code', null, manager.receipt.value.subagentId) : null) : null,
        list.status === 'loading' ? h('p', { role: 'status', className: 'matasks-empty' }, t('tasks.loading')) : null,
        list.status === 'ready' && tasks.length === 0 ? h('p', { role: 'status', className: 'matasks-empty', tabIndex: -1, ref: emptyStatusRef }, t('tasks.empty')) : null,
        !historyOpen && !selectedSummary && list.status === 'ready' && tasks.length > 0 && activeTasks.length === 0
          ? h('p', { role: 'status', className: 'matasks-empty', tabIndex: -1, ref: emptyStatusRef }, t('tasks.activeEmpty')) : null,
        historyOpen ? h(TaskHistory, {
          tasks: historyTasks, parentSessionId, selectedChildId, manager, toolbarActions, t,
          backRef: historyBackRef, viewRefs: historyViewRefs, onClear: clearFromHistory,
          onClose: returnToCurrent, onView: viewHistory,
        }) : null,
        !historyOpen && selectedSummary ? h(TaskWorkspace, {
          key: JSON.stringify([parentSessionId, selectedSummary.childId]), summary: selectedSummary,
          parentSessionId, cwd, visible: visible === true, refresh, t, openFile, stateStore: viewportStates.current, manager,
          onClear: clearFromWorkspace,
          tabId: selectedIsActive ? tabId(selectedSummary) : undefined,
          panelId: panelId(selectedSummary),
        }) : null)
    }

    function TasksSidebarBody(props) {
      const tab = props.useTabInfo().tab
      const params = tab.navigation?.params || {}
      const parentSessionId = params.parentSessionId || props.sessionId
      const childId = params.childId
      return h(TasksPanel, {
        scope: { sessionId: parentSessionId, ...(params.cwd ? { cwd: params.cwd } : {}) },
        tab: {
          meta: { parentSessionId, ...(childId ? { childId } : {}) },
          navigationRevision: tab.navigation?.revision ?? 0,
        },
        visible: tab.visible,
        t: props.t,
        openFile: props.openFile,
        taskStore: props.taskStore,
      })
    }

    // Legacy notices predate monitoring. Offer only explicit absolute report
    // paths under the report directory as user-clicked links, never as verified state.
    function isNoticeReportPath(path) {
      const normalized = path.replace(/\\/g, '/')
      return (path.startsWith('/') || isWindowsDriveAbsolutePath(path)) && normalized.includes('/.dsh/agent-reports/') && path.endsWith('.md') && !/[\x00-\x1f]/.test(path)
    }

    function noticeReportPaths(text) {
      const candidates = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1])
      candidates.push(...(text.match(/[a-z]:[\\/][^\s`<>"']*[\\/]\.dsh[\\/]agent-reports[\\/][^\s`<>"']+\.md|\/[^\s`<>"']*\/\.dsh\/agent-reports\/[^\s`<>"']+\.md/gi) ?? []))
      return [...new Set(candidates.filter(isNoticeReportPath))].slice(0, 4)
    }

    function CompletionCard({ node, sessionId, cwd, t, openFile, openTab }) {
      const source = node.data.source || {}
      const childId = source.senderSessionId
      const host = useCompletionTask(sessionId, childId)
      const task = host.task
      const original = typeof node.data.text === 'string' ? node.data.text : ''
      const summaryText = concise(task?.output || source.summary || original)
      const historicReports = task?.reportPath ? [] : noticeReportPaths(original)
      const noticeStatus = typeof source.stopReason === 'string' ? source.stopReason : undefined
      const theme = useTheme()
      return h('article', { className: 'matasks matasks-completion', 'data-ma-theme': theme, 'aria-label': t('completion.title') },
        h('style', null, `${THEME_CSS}\n${CSS}`),
        h('div', { className: 'matasks-completion-body' },
          h('div', { className: 'matasks-completion-title' },
            h('strong', null, task?.label || t('completion.title')),
            task ? h('span', { className: 'matasks-badges' },
              h('span', { className: 'matasks-badge' }, agentLabel(task.agent)),
              h('span', { className: 'matasks-badge' }, statusLabel(task.status, t)))
              : noticeStatus ? h('span', { className: 'matasks-badge' }, statusLabel(noticeStatus, t)) : null),
          summaryText ? h('p', null, summaryText) : null,
          host.status === 'loading' ? h('p', { role: 'status', className: 'matasks-muted' }, t('completion.loading')) : null,
          host.status === 'unavailable' ? h('p', { role: 'status', className: 'matasks-muted' }, t('completion.unavailable')) : null,
          host.status === 'untracked' ? h('p', { role: 'status', className: 'matasks-muted' }, t('completion.untracked')) : null,
          task?.diagnostic ? h('p', { role: 'alert', className: 'matasks-error' }, task.diagnostic) : null,
          h('div', { className: 'matasks-actions' },
            task?.reportPath ? h('button', { type: 'button', name: 'completion-report', onClick: () => openFile({ sessionId, ...(cwd ? { cwd } : {}) }, task.reportPath) }, t('tasks.report')) : null,
            historicReports.map((path) => h('button', { key: path, type: 'button', name: 'notification-report', title: path, onClick: () => openFile({ sessionId, ...(cwd ? { cwd } : {}) }, path) }, t('tasks.reportFromNotice'))),
            task ? h('button', { type: 'button', name: 'completion-open-tasks', onClick: () => openTab(sessionId, cwd, childId) }, t('completion.openTasks')) : null),
          h('details', { className: 'matasks-original' },
            h('summary', null, t('completion.original')),
            h('pre', null, original))))
    }

    function externalEntries(snapshot, parentSessionId) {
      const entries = snapshot?.projectionsBySession?.[parentSessionId]?.values?.subagentCatalog
      return Array.isArray(entries) ? entries.filter((entry) => entry?.mode === 'external' && typeof entry.id === 'string') : []
    }

    function settlementDefinition() {
      return {
        kind: NODE_KIND,
        target: 'chat',
        match(event) {
          if (event.type !== 'user/message' || event.data?.source?.kind !== 'subagent-settled') return null
          return { id: String(event.data.id ?? event.seq), role: 'start', exclusive: true }
        },
        start(_context, match) {
          const event = match.event
          const source = event.data.source
          return {
            seq: event.seq,
            time: event.time,
            source: {
              kind: source.kind,
              form: source.form,
              summary: typeof source.summary === 'string' ? source.summary : '',
              senderSessionId: source.senderSessionId,
              ...(typeof source.stopReason === 'string' ? { stopReason: source.stopReason } : {}),
            },
            text: normalizeText(event.data.content),
          }
        },
        update: (context) => context.state,
        buildViewNode(context) {
          if (!context.state) return null
          const event = context.start?.event
          return {
            key: context.key,
            kind: NODE_KIND,
            id: context.id,
            target: 'chat',
            anchorSeq: event?.seq ?? context.matches[0]?.event.seq ?? context.state.seq ?? 0,
            location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
            visibility: 'visible',
            data: context.state,
          }
        },
      }
    }

    function encodeResourceSegment(value) {
      return encodeURIComponent(value).replace(/%3A/gi, ':')
    }

    function fileResourceAddress(sessionId, cwd, path) {
      const normalizedPath = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      const hasCwd = typeof cwd === 'string' && cwd.length > 0
      const normalizedCwd = hasCwd ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : ''
      const absolute = normalizedPath.startsWith('/') || isWindowsDriveAbsolutePath(normalizedPath)
      const resolvedPath = hasCwd && !absolute ? `${normalizedCwd}/${normalizedPath}` : normalizedPath
      const encodedPath = resolvedPath.split('/').map(encodeResourceSegment).join('/')
      return `dsh-resource://file/session/${encodeResourceSegment(sessionId)}/${encodedPath}`
    }

    return {
      inject: ['sidebarRightTabs', 'sidebarRight', 'sessions', 'uiConversation', 'slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'multi-agent tasks: dictionaries')
        const t = ctx.locale.bind(NS)
        const openFile = (scope, path) => ctx.sidebarRight.openResource(fileResourceAddress(scope.sessionId, scope.cwd, path))
        const openTasks = (parentSessionId, cwd, childId) => {
          if (!parentSessionId || ctx.sidebarRight.mounted.getSnapshot() !== parentSessionId) return
          ctx.sidebarRight.openTab(TAB_ID, {
            params: { parentSessionId, ...(childId ? { childId } : {}), ...(cwd ? { cwd } : {}) },
          })
        }
        const taskStore = createTaskIndicatorStore({
          fetchTasks: async (parentSessionId, signal) => {
            const value = await requestTasks(parentSessionId, undefined, signal)
            return {
              revision: Number.isFinite(value.revision) ? value.revision : 0,
              tasks: normalizeTaskList(value, parentSessionId),
            }
          },
          isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
          setTimer: (callback, delay) => setTimeout(callback, delay),
          clearTimer: (timer) => clearTimeout(timer),
        })
        publishTaskStore(taskStore)
        shared.openTasks = (parentSessionId, childId) => openTasks(
          parentSessionId,
          ctx.sessions.list.getSnapshot()?.byId?.[parentSessionId]?.cwd,
          childId,
        )
        ctx.effect(() => () => {
          taskStore.dispose()
          if (shared.taskStore === taskStore) {
            publishTaskStore(undefined)
            delete shared.openTasks
          }
        }, 'multi-agent tasks: shared indicator store')
        ctx.effect(() => {
          if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
          const onVisibility = () => {
            if (document.visibilityState === 'hidden') return
            taskStore.wake(ctx.sidebarRight.mounted.getSnapshot())
          }
          document.addEventListener('visibilitychange', onVisibility)
          return () => document.removeEventListener('visibilitychange', onVisibility)
        }, 'multi-agent tasks: indicator visibility')
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_IMPLEMENTATION_ID,
          kind: TAB_ID,
          title: () => t('tasks.title'),
          keepMounted: true,
          guide: [{
            id: 'tasks', order: 35,
            title: () => t('tasks.title'),
            description: () => t('tasks.description'),
          }],
        }), 'multi-agent tasks: sidebar tab')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: TAB_IMPLEMENTATION_ID, locale: NS,
        }, (props) => h(TasksSidebarBody, { ...props, t, openFile, taskStore }))), 'multi-agent tasks: sidebar body')
        ctx.effect(() => ctx.uiConversation.events.register(settlementDefinition()), 'multi-agent tasks: settlement definition')
        ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
          name: 'conversation.chat.node', key: NODE_KIND, locale: NS,
        }, (props) => h(CompletionCard, {
          ...props, t, openFile,
          openTab: openTasks,
        }))), 'multi-agent tasks: settlement renderer')
        ctx.effect(() => {
          let baseline = ctx.sessions.list.getSnapshot()
          return ctx.sessions.list.subscribe(() => {
            const next = ctx.sessions.list.getSnapshot()
            const previous = baseline
            baseline = next
            const parents = new Set(Object.keys(next?.projectionsBySession || {}))
            for (const parentSessionId of parents) {
              const knownParent = Object.hasOwn(previous?.projectionsBySession || {}, parentSessionId)
              if (!knownParent || next?.projectionsBySession?.[parentSessionId] !== previous?.projectionsBySession?.[parentSessionId]) {
                taskStore.wake(parentSessionId)
              }
              if (!knownParent) continue
              const known = new Set(externalEntries(previous, parentSessionId).map((entry) => entry.id))
              const added = externalEntries(next, parentSessionId).filter((entry) => !known.has(entry.id))
              if (added.length > 0) openTasks(parentSessionId, next?.byId?.[parentSessionId]?.cwd, added[0].id)
            }
          })
        }, 'multi-agent tasks: external catalog observer')
      },
    }
  },
})
