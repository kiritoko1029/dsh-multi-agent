window.__ModuleLoader__.load({
  id: 'dsh-multi-agent/direct-chat-ui',
  factory(require, shared = {}) {
    const React = require('react')
    const AGENT_ICONS = require('dsh-multi-agent/agent-icons')
    const h = React.createElement
    const { useState, useEffect, useRef } = React
    const NS = '@kiritoko1029/dsh-multi-agent-direct'
    const STORAGE_PREFIX = 'dsh-multi-agent:direct-agent:'
    const OPTIONS = [
      { id: 'main', label: 'DSH 主 Agent', icon: 'deepseek' },
      { id: 'dsh', label: 'DSH 子 Agent', icon: 'deepseek' },
      { id: 'codex', label: 'Codex', icon: 'openai' },
      { id: 'kimi-code', label: 'Kimi Code', icon: 'kimi' },
      { id: 'agy', label: 'Antigravity (agy)', icon: 'google' },
    ]
    const OPTION_IDS = new Set(OPTIONS.map((option) => option.id))
    const COMMAND_PREFIX = {
      dsh: '/agent-dsh ',
      codex: '/agent-codex ',
      'kimi-code': '/agent-kimi ',
      agy: '/agent-agy ',
    }
    const COMMAND_NAMES = new Set(['agent-dsh', 'agent-codex', 'agent-kimi', 'agent-agy'])
    const DIRECT_PREFIX = /^\/agent-(?:dsh|codex|kimi|agy)(?:\s|$)/
    const DICT = {
      zh: {
        'direct.pick': '选择消息发送到的 Agent',
        'direct.option.main': 'DSH 主 Agent',
        'direct.option.dsh': 'DSH 子 Agent',
      },
      en: {
        'direct.pick': 'Choose the Agent that receives messages',
        'direct.option.main': 'DSH main Agent',
        'direct.option.dsh': 'DSH child Agent',
      },
    }

    const CSS = `
.ma-direct-entry{position:relative;display:inline-flex;align-items:center;min-width:0;color:var(--dsw-alias-label-secondary)}
.ma-direct-entry *{box-sizing:border-box}
.ma-direct-picker{display:inline-flex;align-items:center;justify-content:center;gap:3px;min-width:30px;height:30px;padding:0 5px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer;transition:background-color 160ms ease,color 160ms ease}
.ma-direct-picker:hover,.ma-direct-picker[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ma-direct-picker:focus-visible,.ma-direct-option:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ma-direct-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 auto;color:currentColor}
.ma-direct-icon svg{display:block;width:20px;height:20px}
.ma-direct-chevron{width:10px;height:10px;flex:0 0 auto}
.ma-direct-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:30;display:grid;gap:3px;width:max-content;min-width:196px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);color:var(--dsw-alias-label-primary)}
.ma-direct-option{display:flex;align-items:center;gap:9px;width:100%;min-height:36px;padding:6px 9px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.ma-direct-option:hover,.ma-direct-option[aria-checked=true]{background:var(--dsw-alias-interactive-bg-hover)}
.ma-direct-option[aria-checked=true]{color:var(--dsw-alias-brand-primary);font-weight:600}
.ma-direct-option-label{flex:1 1 auto;white-space:nowrap}
.ma-direct-check{width:12px;text-align:center}
@media(prefers-reduced-motion:reduce){.ma-direct-entry *{transition:none!important;transform:none!important}}
`

    function optionFor(id) {
      return OPTIONS.find((option) => option.id === id) || OPTIONS[0]
    }

    function optionLabel(option, t) {
      return option.id === 'main' || option.id === 'dsh' ? t(`direct.option.${option.id}`) : option.label
    }

    function createSelectionStore() {
      const listeners = new Set()
      const values = new Map()
      const read = (sessionId) => {
        if (!sessionId) return 'main'
        if (values.has(sessionId)) return values.get(sessionId)
        let value = 'main'
        try {
          const saved = window.localStorage?.getItem(`${STORAGE_PREFIX}${sessionId}`)
          if (OPTION_IDS.has(saved)) value = saved
        } catch {}
        values.set(sessionId, value)
        return value
      }
      return {
        get: read,
        set(sessionId, value) {
          if (!sessionId || !OPTION_IDS.has(value) || read(sessionId) === value) return
          values.set(sessionId, value)
          try { window.localStorage?.setItem(`${STORAGE_PREFIX}${sessionId}`, value) } catch {}
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        dispose() { listeners.clear(); values.clear() },
      }
    }

    function useSelection(store, sessionId) {
      const [selected, setSelected] = useState(() => store.get(sessionId))
      useEffect(() => {
        setSelected(store.get(sessionId))
        return store.subscribe(() => setSelected(store.get(sessionId)))
      }, [store, sessionId])
      return selected
    }

    function AgentIcon({ agent }) {
      const option = optionFor(agent)
      return h('span', {
        className: 'ma-direct-icon', 'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: AGENT_ICONS[option.icon] },
      })
    }

    function ChevronIcon() {
      return h('svg', { className: 'ma-direct-chevron', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true },
        h('path', { d: 'm6 9 6 6 6-6', strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function AgentPicker({ store, sessionId, selected, t, name = 'direct-agent-picker' }) {
      const [open, setOpen] = useState(false)
      const [focusIndex, setFocusIndex] = useState(0)
      const root = useRef(null)
      const trigger = useRef(null)
      const items = useRef([])
      const close = (restoreFocus = false) => {
        setOpen(false)
        if (restoreFocus && trigger.current?.isConnected !== false) trigger.current?.focus?.()
      }
      useEffect(() => {
        if (!open) return undefined
        const index = Math.max(0, OPTIONS.findIndex((option) => option.id === selected))
        setFocusIndex(index)
        items.current[index]?.focus?.()
        if (typeof document === 'undefined') return undefined
        const outside = (event) => {
          if (root.current && !root.current.contains(event.target)) close(false)
        }
        const escape = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
        }
        document.addEventListener('pointerdown', outside)
        document.addEventListener('keydown', escape)
        return () => {
          document.removeEventListener('pointerdown', outside)
          document.removeEventListener('keydown', escape)
        }
      }, [open, selected])
      useEffect(() => setOpen(false), [sessionId])
      const moveFocus = (event) => {
        let next
        if (event.key === 'ArrowDown') next = (focusIndex + 1) % OPTIONS.length
        else if (event.key === 'ArrowUp') next = (focusIndex - 1 + OPTIONS.length) % OPTIONS.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = OPTIONS.length - 1
        else if (event.key === 'Tab') { close(false); return }
        else return
        event.preventDefault()
        setFocusIndex(next)
        items.current[next]?.focus?.()
      }
      const currentLabel = optionLabel(optionFor(selected), t)
      return h('span', { className: 'ma-direct-entry', ref: root },
        h('style', null, CSS),
        h('button', {
          ref: trigger, type: 'button', name, className: 'ma-direct-picker',
          title: `${t('direct.pick')}: ${currentLabel}`,
          'aria-label': `${t('direct.pick')}: ${currentLabel}`, 'aria-haspopup': 'menu', 'aria-expanded': open,
          onClick: () => open ? close(true) : setOpen(true),
          onKeyDown: (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            setOpen(true)
          },
        }, h(AgentIcon, { agent: selected }), h(ChevronIcon)),
        open ? h('span', { className: 'ma-direct-menu', role: 'menu', 'aria-label': t('direct.pick'), onKeyDown: moveFocus },
          OPTIONS.map((option, index) => h('button', {
            key: option.id, ref: (node) => { items.current[index] = node },
            type: 'button', name: `direct-agent-${option.id}`, className: 'ma-direct-option',
            role: 'menuitemradio', 'aria-checked': selected === option.id, tabIndex: focusIndex === index ? 0 : -1,
            onFocus: () => setFocusIndex(index),
            onClick: () => { store.set(sessionId, option.id); close(true) },
          },
          h(AgentIcon, { agent: option.id }),
          h('span', { className: 'ma-direct-option-label' }, optionLabel(option, t)),
          h('span', { className: 'ma-direct-check', 'aria-hidden': true }, selected === option.id ? '✓' : '')))) : null)
    }

    function directAssistantBlocks(content) {
      return (Array.isArray(content) ? content : []).map((block) => {
        if (block?.type === 'text') return { kind: 'text', text: block.text }
        if (block?.type === 'reasoning') return { kind: 'reasoning', text: block.text }
        if (block?.type === 'image') return { kind: 'image', attachment: block.attachment }
        return { kind: 'other', block }
      })
    }

    function directAssistantDefinition() {
      return {
        kind: 'multi-agent-direct-assistant',
        target: 'chat',
        match(event) {
          if (event.type !== 'assistant/message' || event.surfaceOp !== 'append') return null
          const message = event.data?.message
          if (message?.source?.kind !== 'model' || !String(message.source.provider || '').startsWith('multi-agent-')) return null
          return { id: message.id || `direct-${event.seq}`, role: 'start', exclusive: true }
        },
        start(_context, match) { return match.event },
        update(_context, match) { return match.event },
        buildViewNode(context) {
          const event = context.state
          if (!event) return null
          const message = event.data.message
          const blocks = directAssistantBlocks(message.content)
          const finalNode = {
            kind: 'assistant', seq: event.seq, messageId: message.id, time: event.time,
            turn: event.data.turn, step: event.data.step, blocks,
            providerMetadata: { provider: message.source.provider, model: message.source.model },
            timing: { stepStartTime: null, firstTokenTime: null, completedTime: event.time },
          }
          return {
            key: context.key, kind: 'assistant-step', id: context.id, target: 'chat',
            anchorSeq: event.seq,
            location: context.start?.location ?? { kind: 'unresolved' },
            visibility: 'visible',
            data: { status: 'settled', turn: event.data.turn, step: event.data.step, blocks, time: event.time, finalNode },
          }
        },
      }
    }

    function DirectActivity(props) {
      const { sessionId, store, t } = props
      const selected = useSelection(store, sessionId)
      const input = props.useInput((state) => state)
      const previous = useRef(selected)
      const draft = input?.draft || ''
      const phase = input?.phase
      useEffect(() => {
        const ownClaim = phase === 'claimed' && COMMAND_NAMES.has(input?.claim?.name)
        if (!input || (phase !== 'plain' && !ownClaim)) return
        const wasDirect = previous.current !== 'main'
        previous.current = selected
        const hasPrefix = DIRECT_PREFIX.test(draft)
        if (selected === 'main') {
          if (wasDirect && hasPrefix) {
            props.inputActions.setDraft(draft.replace(DIRECT_PREFIX, ''))
            props.inputActions.persistDraft()
          }
          return
        }
        const body = hasPrefix ? draft.replace(DIRECT_PREFIX, '') : draft
        const next = `${COMMAND_PREFIX[selected]}${body}`
        if (next !== draft) {
          props.inputActions.setDraft(next)
          props.inputActions.persistDraft()
        }
      }, [sessionId, selected, draft, phase, input?.claim?.name])
      return h(AgentPicker, { store, sessionId, selected, t })
    }

    return {
      inject: ['slots', 'locale', 'uiConversation'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'multi-agent direct: dictionaries')
        ctx.effect(() => ctx.uiConversation.events.register(directAssistantDefinition()), 'multi-agent direct: assistant Conversation nodes')
        const t = ctx.locale.bind(NS)
        const store = createSelectionStore()
        shared.directAgentStore = store
        ctx.effect(() => () => {
          store.dispose()
          if (shared.directAgentStore === store) delete shared.directAgentStore
        }, 'multi-agent direct: selection store')
        ctx.effect(() => ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
          name: 'conversation.input.activity', locale: NS,
        }, (props) => h(DirectActivity, { ...props, store, t: props?.t || t }))), 'multi-agent direct: native composer picker')
        ctx.effect(() => ctx.slots.inject('conversation.chat.commandview', () => {
          const disposers = [...COMMAND_NAMES].map((key) => ctx.slots.register({
            name: 'conversation.chat.commandview', key, locale: NS,
          }, () => null))
          return () => { for (const dispose of disposers.reverse()) dispose() }
        }), 'multi-agent direct: hide internal command cards')
      },
    }
  },
})
