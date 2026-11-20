window.__ModuleLoader__.load({
  id: 'dsh-multi-agent/direct-controls-ui',
  factory(require, shared = {}) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React
    const NS = '@kiritoko1029/dsh-multi-agent-controls'
    const DICT = {
      zh: {
        'controls.model': '模型', 'controls.effort': '思考程度', 'controls.permission': '访问权限', 'controls.custom': '自定义（高级设置）',
        'controls.modelDefault': 'Provider 默认', 'controls.inheritMain': '继承主 Agent',
        'controls.effortDefault': '默认', 'controls.search': '搜索模型', 'controls.empty': '没有匹配的模型',
        'controls.loading': '正在读取模型…', 'controls.retry': '重试', 'controls.back': '返回',
        'controls.saveFailed': '配置保存失败，请重试。', 'controls.catalogFailed': '模型列表读取失败，请重试。', 'controls.overrideFailed': 'Provider 已更新，但旧任务权限覆盖未能清除。',
        'controls.defaultPermission': '默认', 'controls.mainSession': '主会话审批', 'controls.human': '人工逐次审批',
        'controls.allow': '允许所有请求', 'controls.reject': '拒绝所有请求', 'controls.subagentAuto': '子 Agent 自动',
        'controls.fullAccess': '完全权限', 'controls.askRequest': '逐次送审', 'controls.codexNever': 'Codex 不请求人工审批',
        'controls.codexReview': 'Codex 自动审查', 'controls.readOnly': '只读', 'controls.workspaceWrite': '工作区写入',
        'controls.inheritPermission': '继承主 Agent', 'controls.riskTitle': '确认提高访问权限？',
        'controls.riskDescription': '这会允许子 Agent 写入文件或执行命令，并影响所有会话及后续派发，请仅在受信任的工作区中使用。',
        'controls.riskAcknowledge': '我了解此权限的风险', 'controls.confirm': '确认启用', 'controls.cancel': '取消',
        'controls.nextRun': '影响所有会话及后续派发；外部续接仅覆盖已明确选择的模型与思考项。',
      },
      en: {
        'controls.model': 'Model', 'controls.effort': 'Reasoning effort', 'controls.permission': 'Access permission', 'controls.custom': 'Custom (advanced settings)',
        'controls.modelDefault': 'Provider default', 'controls.inheritMain': 'Inherit main Agent',
        'controls.effortDefault': 'Default', 'controls.search': 'Search models', 'controls.empty': 'No matching models',
        'controls.loading': 'Loading models…', 'controls.retry': 'Retry', 'controls.back': 'Back',
        'controls.saveFailed': 'Could not save the configuration. Try again.', 'controls.catalogFailed': 'Could not load the model catalog. Retry.', 'controls.overrideFailed': 'Provider updated, but the old task permission override could not be cleared.',
        'controls.defaultPermission': 'Default', 'controls.mainSession': 'Main-session approval', 'controls.human': 'Human approval',
        'controls.allow': 'Allow every request', 'controls.reject': 'Reject every request', 'controls.subagentAuto': 'Subagent automatic',
        'controls.fullAccess': 'Full access', 'controls.askRequest': 'Ask on every escalation', 'controls.codexNever': 'Codex never asks',
        'controls.codexReview': 'Codex auto review', 'controls.readOnly': 'Read only', 'controls.workspaceWrite': 'Workspace write',
        'controls.inheritPermission': 'Inherit main Agent', 'controls.riskTitle': 'Increase access permission?',
        'controls.riskDescription': 'This may let child Agents write files or execute commands, and affects every session and later dispatch. Use it only in a trusted workspace.',
        'controls.riskAcknowledge': 'I understand the access risk', 'controls.confirm': 'Enable', 'controls.cancel': 'Cancel',
        'controls.nextRun': 'Changes apply to the next direct message; external continuations override only explicitly selected model and effort fields.',
      },
    }
    const CSS = `
.ma-control-root{position:relative;display:inline-flex;min-width:0;color:var(--dsw-alias-label-secondary)}
.ma-control-root *{box-sizing:border-box}
.ma-control-trigger{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:290px;height:30px;padding:0 7px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
.ma-control-trigger:hover:not(:disabled),.ma-control-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ma-control-trigger:focus-visible,.ma-control-cell:focus-visible,.ma-control-option:focus-visible,.ma-control-search:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ma-control-trigger:disabled{opacity:.5;cursor:not-allowed}
.ma-control-icon{display:inline-flex;width:15px;height:15px;flex:0 0 auto}
.ma-control-icon svg{width:15px;height:15px}
.ma-control-model-text{display:var(--dsh-composer-model-text-display,block);min-width:0;overflow:hidden;text-overflow:ellipsis}
.ma-control-effort{color:var(--dsw-alias-label-tertiary)}
.ma-control-chevron{width:10px;height:10px;flex:0 0 auto;transition:transform 150ms ease}
.ma-control-chevron[data-open=true]{transform:rotate(180deg)}
.ma-control-menu{position:absolute;bottom:calc(100% + 9px);z-index:1100;display:flex;flex-direction:column;gap:2px;width:min(330px,calc(100vw - 32px));max-height:min(440px,70vh);padding:5px;border:0;border-radius:var(--dsw-radius-lg,16px);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);background:linear-gradient(var(--dsw-menu-surface-fill,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1))),var(--dsw-menu-surface-fill,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1)))),var(--dsw-alias-bg-base);box-shadow:var(--dsw-elevation-prominent,0 12px 36px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent));color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.ma-control-menu[data-align=right]{right:0}.ma-control-menu[data-align=left]{left:0}
.ma-control-cell{display:flex;align-items:center;gap:10px;width:100%;min-height:36px;padding:6px 9px;border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.ma-control-cell:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ma-control-cell-label{color:var(--dsw-alias-label-secondary)}
.ma-control-cell-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.ma-control-options{display:grid;gap:2px;min-height:0;overflow:auto;overscroll-behavior:contain}
.ma-control-option{display:flex;align-items:center;gap:10px;width:100%;min-height:34px;padding:6px 9px;border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.ma-control-option:hover:not(:disabled),.ma-control-option[aria-checked=true]{background:var(--dsw-alias-interactive-bg-hover)}
.ma-control-option[aria-checked=true]{color:var(--dsw-alias-brand-primary)}
.ma-control-option-copy{display:grid;gap:2px;flex:1;min-width:0}
.ma-control-option-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ma-control-option-detail{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4}
.ma-control-group{position:sticky;top:0;padding:6px 9px 3px;background:linear-gradient(var(--dsw-menu-surface-fill,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1))),var(--dsw-menu-surface-fill,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1)))),var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600}
.ma-control-search{width:100%;height:34px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.ma-control-status{padding:8px 9px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.ma-control-error{color:var(--dsw-alias-state-error-primary)}
.ma-control-risk{display:grid;gap:10px;padding:10px}
.ma-control-risk-title{font-size:13px;font-weight:600}
.ma-control-risk-copy{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.ma-control-risk-check{display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer}
.ma-control-risk-actions{display:flex;justify-content:flex-end;gap:7px}
.ma-control-risk-actions button{min-height:30px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}
.ma-control-risk-actions button[data-primary=true]{border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-on-color)}
.ma-control-risk-actions button:disabled{opacity:.45;cursor:not-allowed}
@media(max-width:520px){.ma-control-effort{display:none}.ma-control-trigger{max-width:180px}.ma-control-menu{position:fixed;right:12px!important;bottom:80px;left:12px!important;width:auto}}
@media(prefers-reduced-motion:reduce){.ma-control-root *{transition:none!important}}
`

    function SvgIcon({ paths }) {
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        paths.map((d) => h('path', { key: d, d, strokeLinecap: 'round', strokeLinejoin: 'round' })))
    }
    const ModelIcon = () => h(SvgIcon, { paths: ['M4 5h16v11H4z', 'M8 20h8', 'M12 16v4'] })
    const PermissionIcon = () => h(SvgIcon, { paths: ['M12 3l7 3v5c0 4.8-2.9 8-7 10-4.1-2-7-5.2-7-10V6z', 'M9 12l2 2 4-4'] })
    const Chevron = ({ open }) => h('svg', { className: 'ma-control-chevron', 'data-open': open, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true }, h('path', { d: 'm6 9 6 6 6-6' }))

    const DIRECT_AGENTS = new Set(['dsh', 'codex', 'kimi-code', 'agy'])
    // Shadow built-in priority 0 model/permission seats while yielding to read-only viewer seats (-10).
    const DIRECT_CONTROL_PRIORITY = -5

    function useSelection(store, sessionId) {
      const value = store.get(sessionId)
      const [, setTick] = useState(0)
      useEffect(() => {
        if (store.get(sessionId) !== value) setTick((tick) => tick + 1)
        return store.subscribe(() => setTick((tick) => tick + 1))
      }, [store, sessionId])
      return value
    }
    function useForm(form) {
      const snapshot = form.getSnapshot()
      const [, setTick] = useState(0)
      useEffect(() => {
        if (form.getSnapshot() !== snapshot) setTick((tick) => tick + 1)
        return form.subscribe(() => setTick((tick) => tick + 1))
      }, [form])
      return snapshot
    }
    function formKey(agent) {
      return agent === 'dsh' ? 'router' : agent === 'codex' ? 'codex' : agent === 'kimi-code' ? 'acp' : 'agy'
    }
    function supportsInline(agent, forms) {
      const router = forms.router.getSnapshot().value ?? {}
      const expected = { dsh: 'spawn', codex: 'codex-router', 'kimi-code': 'kimi-code', agy: 'agy' }[agent]
      const section = agent === 'kimi-code' ? router.kimiCode : router[agent]
      return section?.providerName === undefined || section.providerName === expected
    }
    function agentValue(agent, forms) {
      const snapshot = forms[formKey(agent)].getSnapshot()
      return { snapshot, value: agent === 'dsh' ? snapshot.value?.dsh ?? {} : snapshot.value ?? {} }
    }
    function modelSelection(agent, value) {
      return agent === 'dsh'
        ? { provider: value.defaultProvider, model: value.defaultModel, effort: value.defaultReasoningEffort }
        : { model: value.model, effort: value.reasoningEffort }
    }
    function modelOperations(agent, selection) {
      const effort = selection.effort
      if (agent === 'dsh') return [
        ...selection.provider ? [{ op: 'set', path: ['dsh', 'defaultProvider'], value: selection.provider }] : [{ op: 'unset', path: ['dsh', 'defaultProvider'] }],
        ...selection.model ? [{ op: 'set', path: ['dsh', 'defaultModel'], value: selection.model }] : [{ op: 'unset', path: ['dsh', 'defaultModel'] }],
        effort ? { op: 'set', path: ['dsh', 'defaultReasoningEffort'], value: effort } : { op: 'unset', path: ['dsh', 'defaultReasoningEffort'] },
      ]
      return [
        selection.model ? { op: 'set', path: ['model'], value: selection.model } : { op: 'unset', path: ['model'] },
        effort ? { op: 'set', path: ['reasoningEffort'], value: effort } : { op: 'unset', path: ['reasoningEffort'] },
      ]
    }
    function permissionChoice(agent, value) {
      if (agent === 'dsh') return value.directSandboxMode ?? 'default'
      const policy = agent === 'codex' ? value.permissionPolicy : value.permission
      if (policy === 'subagent') return `subagent:${value.subagentPermissionMode ?? 'auto'}`
      return policy ?? 'main-session'
    }
    function permissionOperations(agent, choice) {
      if (agent === 'dsh') return [{ op: 'set', path: ['dsh', 'directSandboxMode'], value: choice }]
      const policyField = agent === 'codex' ? 'permissionPolicy' : 'permission'
      const policy = choice === 'default' ? 'main-session' : choice.startsWith('subagent:') ? 'subagent' : choice
      const mode = choice.startsWith('subagent:') ? choice.slice(9) : 'auto'
      const operations = [
        { op: 'set', path: [policyField], value: policy },
        { op: 'set', path: ['subagentPermissionMode'], value: mode },
      ]
      if (agent === 'codex') operations.push({
        op: 'set', path: ['permissionMode'],
        value: choice === 'subagent:full-access' ? 'dangerously-bypass-approvals-and-sandbox'
          : choice === 'subagent:auto' ? 'approve-for-me' : 'never',
      })
      return operations
    }
    function permissionOptions(agent, t) {
      if (agent === 'dsh') return [
        ['default', t('controls.inheritPermission')], ['read-only', t('controls.readOnly')],
        ['workspace-write', t('controls.workspaceWrite')], ['danger-full-access', t('controls.fullAccess'), true],
      ].map(([value, label, risk]) => ({ value, label, risk: risk === true }))
      return [
        ['main-session', t('controls.mainSession')], ['human', t('controls.human')], ['reject', t('controls.reject')],
        ['subagent:auto', t('controls.subagentAuto'), true], ['subagent:full-access', t('controls.fullAccess'), true],
      ].map(([value, label, risk]) => ({ value, label, risk: risk === true }))
    }
    function findModel(catalog, selection, agent) {
      for (const group of catalog?.groups ?? []) {
        for (const model of group.models ?? []) {
          if (model.id === selection.model && (agent !== 'dsh' || !selection.provider || group.id === selection.provider)) return { group, model }
        }
      }
      return undefined
    }

    function useMenu(open, close, rootRef, menuRef) {
      useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined
        const outside = (event) => {
          if (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
          close(false)
        }
        document.addEventListener('pointerdown', outside)
        return () => document.removeEventListener('pointerdown', outside)
      }, [open])
    }
    function menuKeys(event, menuRef, close) {
      if (event.key === 'Escape') { event.preventDefault(); close(true); return }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const items = [...(menuRef.current?.querySelectorAll?.('button:not([disabled])') ?? [])]
      if (items.length === 0) return
      const active = items.indexOf(document.activeElement)
      const next = active < 0 ? 0 : (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }
    function statusView({ catalog, error, t, retry }) {
      const message = error || catalog?.error
      return h('div', { className: `ma-control-status ${message ? 'ma-control-error' : ''}`, role: message ? 'alert' : 'status' },
        message || t('controls.loading'), message ? h('button', { type: 'button', onClick: retry, style: { marginLeft: 8 } }, t('controls.retry')) : null)
    }

    function ModelControl(props) {
      const { sessionId, store, forms, loadCatalogs, t } = props
      const selectedAgent = useSelection(store, sessionId)
      const active = DIRECT_AGENTS.has(selectedAgent)
      const agent = active ? selectedAgent : 'dsh'
      const form = forms[formKey(agent)]
      const snapshot = useForm(form)
      useForm(forms.router)
      const supported = active && supportsInline(agent, forms)
      const value = agent === 'dsh' ? snapshot.value?.dsh ?? {} : snapshot.value ?? {}
      const selection = modelSelection(agent, value)
      const [open, setOpen] = useState(false)
      const [pane, setPane] = useState('root')
      const [query, setQuery] = useState('')
      const [catalog, setCatalog] = useState(null)
      const [pending, setPending] = useState(false)
      const [error, setError] = useState('')
      const rootRef = useRef(null)
      const menuRef = useRef(null)
      const catalogGeneration = useRef(0)
      const readOnly = props.locked || pending || !supported || snapshot.status !== 'ready' || !snapshot.writable
      const current = findModel(catalog, selection, agent)
      const reasoning = current?.model.reasoning
      const modelLabel = current?.model.name ?? selection.model ?? t(agent === 'dsh' ? 'controls.inheritMain' : 'controls.modelDefault')
      const effortId = selection.effort ?? reasoning?.defaultEffort
      const effortLabel = selection.effort ?? (reasoning ? reasoning.efforts?.find((effort) => effort.id === effortId)?.name ?? effortId ?? t('controls.effortDefault') : undefined)
      const close = (focus = false) => {
        setOpen(false); setPane('root'); setQuery('')
        if (focus) rootRef.current?.querySelector?.('button')?.focus?.()
      }
      useMenu(open, close, rootRef, menuRef)
      const load = async () => {
        if (!active) return
        const currentGeneration = ++catalogGeneration.current
        setCatalog((previous) => previous ? { ...previous, error: '' } : previous)
        try {
          const value = await loadCatalogs[agent]()
          if (catalogGeneration.current === currentGeneration) setCatalog({ groups: value.groups ?? [] })
        } catch {
          if (catalogGeneration.current === currentGeneration) setCatalog({ groups: [], error: t('controls.catalogFailed') })
        }
      }
      useEffect(() => {
        catalogGeneration.current += 1
        setCatalog(null)
        if (active) void load()
      }, [active, agent])
      useEffect(() => { close(false); setError('') }, [active, agent, sessionId])
      useEffect(() => { if (props.locked) close(false) }, [props.locked])
      useEffect(() => { if (open) menuRef.current?.querySelector?.('input,button')?.focus?.() }, [open, pane])
      if (!active) return null
      const save = async (next) => {
        if (readOnly || props.locked || snapshot.status !== 'ready' || !snapshot.writable) return
        setPending(true); setError('')
        try {
          if (!await form.mutate(modelOperations(agent, next), snapshot.revision)) throw new Error('save')
          close(true)
        } catch { setError(t('controls.saveFailed')) }
        finally { setPending(false) }
      }
      const groups = (catalog?.groups ?? []).map((group) => ({
        ...group, models: (group.models ?? []).filter((model) => `${group.name} ${model.name} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase())),
      })).filter((group) => group.models.length > 0)
      return h('span', { className: 'ma-control-root', ref: rootRef, onKeyDown: (event) => {
        if (event.key === 'Escape' && pane !== 'root') { event.preventDefault(); setPane('root'); return }
        menuKeys(event, menuRef, close)
      } },
        h('style', null, CSS),
        h('button', {
          type: 'button', className: 'ma-control-trigger', name: 'direct-model-control', disabled: readOnly,
          title: effortLabel ? `${modelLabel} · ${effortLabel}` : modelLabel, 'aria-label': `${t('controls.model')}: ${modelLabel}${effortLabel ? ` · ${effortLabel}` : ''}`,
          'aria-haspopup': 'menu', 'aria-expanded': open,
          onClick: () => open ? close(true) : setOpen(true),
        }, h('span', { className: 'ma-control-icon' }, h(ModelIcon)), h('span', { className: 'ma-control-model-text' }, modelLabel),
        effortLabel ? h('span', { className: 'ma-control-effort' }, effortLabel) : null, h(Chevron, { open })),
        open ? h('span', { ref: menuRef, className: 'ma-control-menu', 'data-align': 'right', role: 'menu', 'aria-label': t('controls.model') },
          error ? h('div', { className: 'ma-control-status ma-control-error', role: 'alert' }, error) : null,
          pane === 'root' ? [
            h('button', { key: 'model', type: 'button', className: 'ma-control-cell', onClick: () => setPane('model') },
              h('span', { className: 'ma-control-cell-label' }, t('controls.model')), h('span', { className: 'ma-control-cell-value' }, modelLabel), h('span', null, '›')),
            (reasoning || selection.effort) ? h('button', { key: 'effort', type: 'button', className: 'ma-control-cell', onClick: () => setPane('effort') },
              h('span', { className: 'ma-control-cell-label' }, t('controls.effort')), h('span', { className: 'ma-control-cell-value' }, effortLabel), h('span', null, '›')) : null,
            h('div', { key: 'hint', className: 'ma-control-status' }, t('controls.nextRun')),
          ] : null,
          pane === 'model' ? [
            h('button', { key: 'back', type: 'button', className: 'ma-control-cell', onClick: () => setPane('root') }, '‹ ', t('controls.back')),
            h('input', { key: 'search', className: 'ma-control-search', value: query, placeholder: t('controls.search'), 'aria-label': t('controls.search'), onChange: (event) => setQuery(event.currentTarget.value) }),
            !catalog ? h(statusView, { key: 'loading', catalog, error, t, retry: load }) : null,
            catalog?.error ? h(statusView, { key: 'error', catalog, error, t, retry: load }) : null,
            h('div', { key: 'options', className: 'ma-control-options' },
              h('button', { type: 'button', className: 'ma-control-option', 'aria-checked': !selection.model, onClick: () => save({}) },
                h('span', { className: 'ma-control-option-copy' }, t(agent === 'dsh' ? 'controls.inheritMain' : 'controls.modelDefault')), h('span', null, !selection.model ? '✓' : '')),
              groups.map((group) => h('div', { key: group.id },
                h('div', { className: 'ma-control-group' }, group.name ?? group.id),
                group.models.map((model) => h('button', {
                  key: model.id, type: 'button', className: 'ma-control-option', role: 'menuitemradio',
                  'aria-checked': current?.model.id === model.id && current?.group.id === group.id,
                  onClick: () => save({ provider: group.id, model: model.id, effort: model.reasoning?.defaultEffort }),
                }, h('span', { className: 'ma-control-option-copy' }, model.name ?? model.id), h('span', null, current?.model.id === model.id && current?.group.id === group.id ? '✓' : ''))))),
              catalog && groups.length === 0 ? h('div', { className: 'ma-control-status' }, t('controls.empty')) : null),
          ] : null,
          pane === 'effort' ? h('div', { className: 'ma-control-options' },
            h('button', { type: 'button', className: 'ma-control-cell', onClick: () => setPane('root') }, '‹ ', t('controls.back')),
            h('button', { type: 'button', className: 'ma-control-option', 'aria-checked': !selection.effort, onClick: () => save({ ...selection, effort: undefined }) }, t('controls.effortDefault')),
            (reasoning?.efforts ?? []).map((effort) => h('button', {
              key: effort.id, type: 'button', className: 'ma-control-option', role: 'menuitemradio', 'aria-checked': selection.effort === effort.id,
              onClick: () => save({ ...selection, effort: effort.id }),
            }, h('span', { className: 'ma-control-option-copy' }, effort.name ?? effort.id), h('span', null, selection.effort === effort.id ? '✓' : '')))) : null,
        ) : null)
    }

    async function resetTaskPermissionOverride(sessionId, agent) {
      const headers = { accept: 'application/json', 'content-type': 'application/json' }
      if (window.location?.protocol === 'dsh-app:') {
        const proofResponse = await fetch(`/multi-agent/tasks?parentSessionId=${encodeURIComponent(sessionId)}&view=action-proof`, { credentials: 'same-origin', headers: { accept: 'application/json', 'x-dsh-task-panel': '1' } })
        const proof = await proofResponse.json()
        if (!proofResponse.ok || !proof.ok || !proof.value?.proof) throw new Error('proof')
        headers['x-dsh-task-proof'] = proof.value.proof
      }
      const response = await fetch('/multi-agent/tasks', {
        method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ parentSessionId: sessionId, action: 'direct-permission-reset', agent }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error('permission')
    }

    function PermissionControl(props) {
      const { sessionId, store, forms, t } = props
      const selectedAgent = useSelection(store, sessionId)
      const active = DIRECT_AGENTS.has(selectedAgent)
      const agent = active ? selectedAgent : 'dsh'
      const form = forms[formKey(agent)]
      const snapshot = useForm(form)
      useForm(forms.router)
      const supported = active && supportsInline(agent, forms)
      const value = agent === 'dsh' ? snapshot.value?.dsh ?? {} : snapshot.value ?? {}
      const selected = permissionChoice(agent, value)
      const options = permissionOptions(agent, t)
      const current = options.find((option) => option.value === selected) ?? { value: selected, label: t('controls.custom') }
      const [open, setOpen] = useState(false)
      const [confirm, setConfirm] = useState(null)
      const [acknowledged, setAcknowledged] = useState(false)
      const [pending, setPending] = useState(false)
      const [error, setError] = useState('')
      const readOnly = props.locked || pending || !supported || snapshot.status !== 'ready' || !snapshot.writable
      const rootRef = useRef(null)
      const menuRef = useRef(null)
      const close = (focus = false) => {
        setOpen(false); setConfirm(null); setAcknowledged(false)
        if (focus) rootRef.current?.querySelector?.('button')?.focus?.()
      }
      useMenu(open, close, rootRef, menuRef)
      useEffect(() => { close(false); setError('') }, [active, agent, sessionId])
      useEffect(() => { if (props.locked) close(false) }, [props.locked])
      if (!active) return null
      const save = async (choice) => {
        if (readOnly || props.locked || snapshot.status !== 'ready' || !snapshot.writable) return
        setPending(true); setError('')
        try {
          if (agent !== 'dsh') {
            try { await resetTaskPermissionOverride(sessionId, agent) }
            catch { setError(t('controls.overrideFailed')); return }
          }
          if (!await form.mutate(permissionOperations(agent, choice), snapshot.revision)) throw new Error('save')
          close(true)
        } catch { setError(t('controls.saveFailed')) }
        finally { setPending(false) }
      }
      const choose = (option) => {
        if (option.risk) { setConfirm(option); setAcknowledged(false); return }
        void save(option.value)
      }
      return h('span', { className: 'ma-control-root', ref: rootRef, onKeyDown: (event) => menuKeys(event, menuRef, close) },
        h('style', null, CSS),
        h('button', {
          type: 'button', className: 'ma-control-trigger', name: 'direct-permission-control', disabled: readOnly,
          title: current.label, 'aria-label': `${t('controls.permission')}: ${current.label}`, 'aria-haspopup': 'menu', 'aria-expanded': open,
          onClick: () => open ? close(true) : setOpen(true),
        }, h('span', { className: 'ma-control-icon' }, h(PermissionIcon)), h('span', null, current.label), h(Chevron, { open })),
        open ? h('span', { ref: menuRef, className: 'ma-control-menu', 'data-align': 'left', role: 'menu', 'aria-label': t('controls.permission') },
          error ? h('div', { className: 'ma-control-status ma-control-error', role: 'alert' }, error) : null,
          confirm ? h('div', { className: 'ma-control-risk' },
            h('div', { className: 'ma-control-risk-title' }, t('controls.riskTitle')),
            h('div', { className: 'ma-control-risk-copy' }, t('controls.riskDescription')),
            h('label', { className: 'ma-control-risk-check' }, h('input', { type: 'checkbox', checked: acknowledged, onChange: (event) => setAcknowledged(event.currentTarget.checked) }), t('controls.riskAcknowledge')),
            h('div', { className: 'ma-control-risk-actions' },
              h('button', { type: 'button', onClick: () => { setConfirm(null); setAcknowledged(false) } }, t('controls.cancel')),
              h('button', { type: 'button', 'data-primary': true, disabled: !acknowledged || readOnly, onClick: () => save(confirm.value) }, t('controls.confirm'))),
          ) : h('div', { className: 'ma-control-options' },
            options.map((option) => h('button', {
              key: option.value, type: 'button', className: 'ma-control-option', role: 'menuitemradio', 'aria-checked': selected === option.value,
              onClick: () => choose(option),
            }, h('span', { className: 'ma-control-option-copy' }, option.label), h('span', null, selected === option.value ? '✓' : ''))),
            h('div', { className: 'ma-control-status' }, t('controls.nextRun')))) : null)
    }

    function conditionalSlot(ctx, store, name, component) {
      ctx.effect(() => ctx.slots.inject(name, () => {
        let unregister
        const sync = () => {
          const active = store.getActive?.()
          const needed = Boolean(active && DIRECT_AGENTS.has(store.get(active)))
          if (!needed) {
            unregister?.()
            unregister = undefined
            return
          }
          if (!unregister) {
            unregister = ctx.slots.register({ name, priority: DIRECT_CONTROL_PRIORITY, locale: NS }, component)
          }
        }
        sync()
        const unsubscribe = store.subscribe(sync)
        return () => { unsubscribe(); unregister?.() }
      }), `multi-agent direct: ${name}`)
    }

    return {
      inject: ['slots', 'locale', 'configForms', 'remote', 'remote.session'],
      apply(ctx) {
        const store = shared.directAgentStore
        if (!store) return
        ctx.effect(() => ctx.locale.register(NS, DICT), 'multi-agent direct controls: dictionaries')
        const t = ctx.locale.bind(NS)
        const forms = {
          router: ctx.configForms.get('multi-agent-router'), codex: ctx.configForms.get('codex-provider'),
          acp: ctx.configForms.get('kimi-code-acp'), agy: ctx.configForms.get('agy-acp'),
        }
        const loadCatalogs = {
          dsh: async () => {
            const response = await ctx.remote.session.modelCatalog()
            if (!response.ok) throw new Error('catalog')
            return response.value
          },
          codex: async () => loadExternal('codex'),
          'kimi-code': async () => loadExternal('kimi-code'),
          agy: async () => loadExternal('agy'),
        }
        async function loadExternal(kind) {
          const response = await fetch(`/multi-agent/model-catalog/${kind}`, { credentials: 'same-origin' })
          const payload = await response.json()
          if (!response.ok || !payload.ok) throw new Error('catalog')
          return payload.value
        }
        const common = { store, forms, loadCatalogs }
        conditionalSlot(ctx, store, 'conversation.input.model', (props) => h(ModelControl, { ...props, ...common, t: props?.t || t }))
        conditionalSlot(ctx, store, 'conversation.input.permission', (props) => h(PermissionControl, { ...props, ...common, t: props?.t || t }))
      },
    }
  },
})
