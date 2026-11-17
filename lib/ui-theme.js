export function createUiTheme(targetWindow) {
  const THEME_STORAGE_KEY = 'dsh-multi-agent:theme'
  const THEME_CHANGE_EVENT = 'dsh-multi-agent:theme-change'
  const DEFAULT_THEME = 'system'
  const THEME_IDS = Object.freeze(['system', 'studio', 'paper', 'midnight', 'graphite'])

  const THEME_PRESETS = Object.freeze({
    studio: Object.freeze({
      id: 'studio',
      scheme: 'light',
      bg: '#f4f6fb',
      surface: '#ffffff',
      raised: '#eef2f9',
      sunken: '#eff2f8',
      overlay: '#f9fafd',
      line: '#e2e7f1',
      strong: '#c6cfdf',
      controlBorder: '#6b7892',
      text: '#141925',
      muted: '#4a5568',
      accent: '#254edb',
      accentFill: '#254edb',
      onAccent: '#ffffff',
      accentSoft: 'rgba(37,78,219,0.10)',
      focusRing: 'rgba(37,78,219,0.22)',
      hover: 'rgba(20,25,37,0.05)',
      success: '#0b6e3f',
      successSoft: 'rgba(11,110,63,0.10)',
      warn: '#8a4b00',
      warnSoft: 'rgba(138,75,0,0.10)',
      error: '#b42318',
      errorSoft: 'rgba(180,35,24,0.10)',
      idle: '#525d70',
      idleSoft: 'rgba(82,93,112,0.10)',
      shadow: '0 22px 56px rgba(20,25,37,0.16)',
      shadowSm: '0 2px 8px rgba(20,25,37,0.06)',
    }),
    paper: Object.freeze({
      id: 'paper',
      scheme: 'light',
      bg: '#f6f3ec',
      surface: '#fffdf9',
      raised: '#efeae0',
      sunken: '#f1ece2',
      overlay: '#fbf9f4',
      line: '#e4ddd0',
      strong: '#cbc2b2',
      controlBorder: '#7a7163',
      text: '#1f1c18',
      muted: '#575046',
      accent: '#8c3d19',
      accentFill: '#8c3d19',
      onAccent: '#fffdf9',
      accentSoft: 'rgba(140,61,25,0.10)',
      focusRing: 'rgba(140,61,25,0.22)',
      hover: 'rgba(31,28,24,0.05)',
      success: '#166534',
      successSoft: 'rgba(22,101,52,0.10)',
      warn: '#854d0e',
      warnSoft: 'rgba(133,77,14,0.10)',
      error: '#a61b1b',
      errorSoft: 'rgba(166,27,27,0.10)',
      idle: '#5c554b',
      idleSoft: 'rgba(92,85,75,0.10)',
      shadow: '0 22px 56px rgba(31,28,24,0.15)',
      shadowSm: '0 2px 8px rgba(31,28,24,0.06)',
    }),
    midnight: Object.freeze({
      id: 'midnight',
      scheme: 'dark',
      bg: '#0b1020',
      surface: '#131a2e',
      raised: '#1a233d',
      sunken: '#080c18',
      overlay: '#101729',
      line: '#222c49',
      strong: '#344269',
      controlBorder: '#687aa8',
      text: '#eef2ff',
      muted: '#9aa8cc',
      accent: '#8da4ff',
      accentFill: '#7c96ff',
      onAccent: '#090e1c',
      accentSoft: 'rgba(141,164,255,0.13)',
      focusRing: 'rgba(141,164,255,0.28)',
      hover: 'rgba(238,242,255,0.06)',
      success: '#4ade80',
      successSoft: 'rgba(74,222,128,0.13)',
      warn: '#f5b841',
      warnSoft: 'rgba(245,184,65,0.13)',
      error: '#ff8b82',
      errorSoft: 'rgba(255,139,130,0.13)',
      idle: '#94a2c4',
      idleSoft: 'rgba(148,162,196,0.13)',
      shadow: '0 24px 64px rgba(2,6,18,0.62)',
      shadowSm: '0 2px 10px rgba(2,6,18,0.34)',
    }),
    graphite: Object.freeze({
      id: 'graphite',
      scheme: 'dark',
      bg: '#131417',
      surface: '#1b1d22',
      raised: '#23262d',
      sunken: '#0e1013',
      overlay: '#17191e',
      line: '#292d35',
      strong: '#3b404b',
      controlBorder: '#707786',
      text: '#f1f2f4',
      muted: '#a0a6b2',
      accent: '#6ee7cf',
      accentFill: '#5cd6be',
      onAccent: '#0c1f1b',
      accentSoft: 'rgba(110,231,207,0.12)',
      focusRing: 'rgba(110,231,207,0.26)',
      hover: 'rgba(241,242,244,0.06)',
      success: '#68d89b',
      successSoft: 'rgba(104,216,155,0.12)',
      warn: '#eeb852',
      warnSoft: 'rgba(238,184,82,0.12)',
      error: '#ff8f87',
      errorSoft: 'rgba(255,143,135,0.12)',
      idle: '#9aa0ac',
      idleSoft: 'rgba(154,160,172,0.12)',
      shadow: '0 24px 64px rgba(0,0,0,0.64)',
      shadowSm: '0 2px 10px rgba(0,0,0,0.36)',
    }),
  })

  function presetCssDeclarations(p) {
    return [
      `--ma-bg:${p.bg}`,
      `--ma-surface:${p.surface}`,
      `--ma-surface-raised:${p.raised}`,
      `--ma-surface-sunken:${p.sunken}`,
      `--ma-overlay:${p.overlay}`,
      `--ma-line:${p.line}`,
      `--ma-line-strong:${p.strong}`,
      `--ma-control-border:${p.controlBorder}`,
      `--ma-text:${p.text}`,
      `--ma-muted:${p.muted}`,
      `--ma-accent:${p.accent}`,
      `--ma-accent-fill:${p.accentFill}`,
      `--ma-on-accent:${p.onAccent}`,
      `--ma-accent-soft:${p.accentSoft}`,
      `--ma-focus-ring:${p.focusRing}`,
      `--ma-hover:${p.hover}`,
      `--ma-success:${p.success}`,
      `--ma-success-soft:${p.successSoft}`,
      `--ma-warn:${p.warn}`,
      `--ma-warn-soft:${p.warnSoft}`,
      `--ma-error:${p.error}`,
      `--ma-error-soft:${p.errorSoft}`,
      `--ma-idle:${p.idle}`,
      `--ma-idle-soft:${p.idleSoft}`,
      `--ma-shadow:${p.shadow}`,
      `--ma-shadow-sm:${p.shadowSm}`,
      `color-scheme:${p.scheme}`,
    ].join(';')
  }

  const SYSTEM_DECLARATIONS = [
    '--ma-bg:var(--dsw-alias-bg-layer-1)',
    '--ma-surface:var(--dsw-alias-bg-layer-2)',
    '--ma-surface-raised:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 86%,var(--dsw-alias-label-primary) 6%)',
    '--ma-surface-sunken:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,var(--dsw-alias-bg-layer-2) 12%)',
    '--ma-overlay:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1))',
    '--ma-line:var(--dsw-alias-border-l1)',
    '--ma-line-strong:var(--dsw-alias-border-l2)',
    '--ma-control-border:var(--dsw-alias-border-l3,color-mix(in srgb,var(--dsw-alias-border-l2) 72%,var(--dsw-alias-label-secondary)))',
    '--ma-text:var(--dsw-alias-label-primary)',
    '--ma-muted:var(--dsw-alias-label-secondary)',
    '--ma-accent:var(--dsw-alias-brand-primary)',
    '--ma-accent-fill:var(--dsw-alias-brand-primary)',
    '--ma-on-accent:var(--dsw-alias-bg-layer-1)',
    '--ma-accent-soft:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)',
    '--ma-focus-ring:color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,transparent)',
    '--ma-hover:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent))',
    '--ma-success:var(--dsw-alias-state-success-primary)',
    '--ma-success-soft:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)',
    '--ma-warn:var(--dsw-alias-state-warn-primary)',
    '--ma-warn-soft:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 13%,transparent)',
    '--ma-error:var(--dsw-alias-state-error-primary)',
    '--ma-error-soft:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)',
    '--ma-idle:var(--dsw-alias-state-idle-primary,var(--dsw-alias-label-secondary))',
    '--ma-idle-soft:color-mix(in srgb,var(--dsw-alias-state-idle-primary,var(--dsw-alias-label-secondary)) 12%,transparent)',
    '--ma-shadow:0 20px 52px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)',
    '--ma-shadow-sm:0 2px 8px color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)',
  ].join(';')

  const THEME_CSS = [
    `:where([data-ma-theme]),[data-ma-theme="system"]{${SYSTEM_DECLARATIONS}}`,
    ...Object.values(THEME_PRESETS).map((preset) => `[data-ma-theme="${preset.id}"]{${presetCssDeclarations(preset)}}`),
  ].join('\n')

  function isValidTheme(value) {
    return typeof value === 'string' && THEME_IDS.includes(value)
  }

  function normalizeTheme(value) {
    return isValidTheme(value) ? value : DEFAULT_THEME
  }

  const win = targetWindow ?? (typeof window !== 'undefined' ? window : undefined)
  const instanceToken = {}
  let memoryFallback = undefined
  const localListeners = new Set()

  function readStorageRaw() {
    try {
      const storage = win?.localStorage
      if (!storage || typeof storage.getItem !== 'function') return { ok: false, value: null }
      return { ok: true, value: storage.getItem(THEME_STORAGE_KEY) }
    } catch {
      return { ok: false, value: null }
    }
  }

  function readTheme() {
    const stored = readStorageRaw()
    if (stored.ok) {
      if (isValidTheme(stored.value)) {
        memoryFallback = stored.value
        return stored.value
      }
      return DEFAULT_THEME
    }
    return isValidTheme(memoryFallback) ? memoryFallback : DEFAULT_THEME
  }

  function dispatchThemeChange(next) {
    if (!win || typeof win.dispatchEvent !== 'function') return
    try {
      const detail = { theme: next, source: instanceToken }
      const CustomEventCtor = win.CustomEvent || globalThis.CustomEvent
      let event
      if (typeof CustomEventCtor === 'function') {
        event = new CustomEventCtor(THEME_CHANGE_EVENT, { detail })
      } else {
        const EventCtor = win.Event || globalThis.Event
        if (typeof EventCtor === 'function') {
          event = new EventCtor(THEME_CHANGE_EVENT)
          event.detail = detail
        } else {
          event = { type: THEME_CHANGE_EVENT, detail }
        }
      }
      win.dispatchEvent(event)
    } catch {}
  }

  function writeTheme(next) {
    if (!isValidTheme(next)) return false
    memoryFallback = next
    try {
      win?.localStorage?.setItem?.(THEME_STORAGE_KEY, next)
    } catch {}
    for (const listener of [...localListeners]) listener(next)
    dispatchThemeChange(next)
    return true
  }

  function subscribeTheme(listener) {
    localListeners.add(listener)
    if (!win || typeof win.addEventListener !== 'function') {
      return () => {
        localListeners.delete(listener)
      }
    }
    const onStorage = (event) => {
      if (event && typeof event.key === 'string' && event.key.length > 0 && event.key !== THEME_STORAGE_KEY) return
      let storageAreaMismatch = false
      try {
        if (event?.storageArea && win.localStorage && event.storageArea !== win.localStorage) storageAreaMismatch = true
      } catch {}
      if (storageAreaMismatch) return
      const next = event && typeof event === 'object' && Object.hasOwn(event, 'newValue')
        ? normalizeTheme(event.newValue)
        : readTheme()
      memoryFallback = next
      listener(next)
    }
    const onCustomEvent = (event) => {
      if (event?.detail && typeof event.detail === 'object' && event.detail.source === instanceToken) return
      const detail = typeof event?.detail === 'string'
        ? event.detail
        : typeof event?.detail?.theme === 'string'
          ? event.detail.theme
          : undefined
      const next = isValidTheme(detail) ? detail : readTheme()
      memoryFallback = next
      listener(next)
    }
    win.addEventListener('storage', onStorage)
    win.addEventListener(THEME_CHANGE_EVENT, onCustomEvent)
    return () => {
      localListeners.delete(listener)
      win.removeEventListener?.('storage', onStorage)
      win.removeEventListener?.(THEME_CHANGE_EVENT, onCustomEvent)
    }
  }

  function createUseTheme(React) {
    const { useState, useEffect } = React
    return function useTheme() {
      const [theme, setTheme] = useState(readTheme)
      useEffect(() => {
        setTheme(readTheme())
        return subscribeTheme((next) => setTheme(next))
      }, [])
      return theme
    }
  }

  return {
    THEME_STORAGE_KEY,
    THEME_CHANGE_EVENT,
    DEFAULT_THEME,
    THEME_IDS,
    THEME_PRESETS,
    THEME_CSS,
    isValidTheme,
    normalizeTheme,
    readTheme,
    writeTheme,
    subscribeTheme,
    createUseTheme,
  }
}

const staticTheme = createUiTheme(undefined)
export const {
  THEME_STORAGE_KEY,
  THEME_CHANGE_EVENT,
  DEFAULT_THEME,
  THEME_IDS,
  THEME_PRESETS,
  THEME_CSS,
  isValidTheme,
  normalizeTheme,
} = staticTheme
