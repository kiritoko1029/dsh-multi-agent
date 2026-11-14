import { execFileSync } from 'node:child_process'

const WINDOWS_INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const SYSTEM_PROXY_TTL_MS = 30000
const LOCAL_HOSTS = 'localhost,127.0.0.1'

/** Accepted values for a Provider's proxyMode setting. */
export const PROXY_MODES = ['system', 'none', 'custom']

function defaultRun(argv) {
  return execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', windowsHide: true, timeout: 5000 })
}

/** Split a WinINET ProxyServer value into per-scheme addresses. */
export function parseWindowsProxyServer(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') return undefined
  if (!text.includes('=')) return text.includes(';') ? undefined : { http: text, https: text }
  const byScheme = {}
  for (const entry of text.split(';')) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    const scheme = entry.slice(0, separator).trim().toLowerCase()
    const address = entry.slice(separator + 1).trim()
    if (scheme !== '' && address !== '') byScheme[scheme] = address
  }
  const http = byScheme.http ?? byScheme.https
  const https = byScheme.https ?? byScheme.http
  return http === undefined && https === undefined ? undefined : { http, https }
}

/** Convert a WinINET ProxyOverride value into a NO_PROXY list. */
export function parseWindowsProxyOverride(raw) {
  const hosts = new Set()
  for (const entry of String(raw ?? '').split(';')) {
    const host = entry.trim()
    if (host === '') continue
    if (host === '<local>') {
      hosts.add('localhost')
      hosts.add('127.0.0.1')
      continue
    }
    hosts.add(host)
  }
  return hosts.size === 0 ? undefined : [...hosts].join(',')
}

function registryValue(output, name) {
  const match = output.match(new RegExp(`^\\s*${name}\\s+REG_[A-Z_]+\\s+(.*)$`, 'mi'))
  return match?.[1]?.trim()
}

/** Read the WinINET proxy from the current user's registry. */
export function readWindowsSystemProxy(run = defaultRun) {
  let output
  try {
    output = String(run(['reg.exe', 'query', WINDOWS_INTERNET_SETTINGS]) ?? '')
  } catch {
    return undefined
  }
  if (registryValue(output, 'ProxyEnable') !== '0x1') return undefined
  const server = parseWindowsProxyServer(registryValue(output, 'ProxyServer'))
  if (server === undefined) return undefined
  const noProxy = parseWindowsProxyOverride(registryValue(output, 'ProxyOverride'))
  return {
    ...server.http === undefined ? {} : { httpProxy: server.http },
    ...server.https === undefined ? {} : { httpsProxy: server.https },
    ...noProxy === undefined ? {} : { noProxy },
  }
}

function scutilField(output, name) {
  return output.match(new RegExp(`\\b${name}\\s*:\\s*(\\S+)`))?.[1]
}

/** Read the macOS system proxy from `scutil --proxy`. */
export function readMacSystemProxy(run = defaultRun) {
  let output
  try {
    output = String(run(['scutil', '--proxy']) ?? '')
  } catch {
    return undefined
  }
  const address = (enable, host, port) => {
    if (scutilField(output, enable) !== '1') return undefined
    const hostname = scutilField(output, host)
    const portNumber = scutilField(output, port)
    return hostname === undefined || portNumber === undefined ? undefined : `${hostname}:${portNumber}`
  }
  const httpProxy = address('HTTPEnable', 'HTTPProxy', 'HTTPPort')
  const httpsProxy = address('HTTPSEnable', 'HTTPSProxy', 'HTTPSPort')
  if (httpProxy === undefined && httpsProxy === undefined) return undefined
  const exceptions = [...output.matchAll(/^\s*\d+\s*:\s*(\S+)\s*$/gm)].map((match) => match[1])
  return {
    ...httpProxy === undefined ? {} : { httpProxy },
    ...httpsProxy === undefined ? {} : { httpsProxy },
    ...exceptions.length === 0 ? {} : { noProxy: exceptions.join(',') },
  }
}

let systemProxyReader
let systemProxyCache

/** Replace the platform reader; hosts and tests use this for a fixed lookup. */
export function setSystemProxyReader(reader) {
  systemProxyReader = reader
  systemProxyCache = undefined
}

/** Read the platform system proxy; platforms without a reader stay unset. */
export function detectSystemProxy(options = {}) {
  const platform = options.platform ?? process.platform
  const run = options.run ?? systemProxyReader ?? defaultRun
  if (platform === 'win32') return readWindowsSystemProxy(run)
  if (platform === 'darwin') return readMacSystemProxy(run)
  return undefined
}

/** Cached system proxy lookup so repeated spawns do not re-read the registry. */
export function systemProxy(options = {}) {
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? SYSTEM_PROXY_TTL_MS
  if (systemProxyCache !== undefined && now() - systemProxyCache.at < ttl) return systemProxyCache.value
  const value = detectSystemProxy(options)
  systemProxyCache = { at: now(), value }
  return value
}

/** Drop the cached system proxy; tests and settings reloads call this. */
export function resetSystemProxyCache() {
  systemProxyCache = undefined
}

/** Normalise a user-entered proxy address, adding the default http scheme. */
export function normalizeProxyUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return undefined
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
  try {
    const parsed = new URL(candidate)
    if (parsed.hostname === '') return undefined
    return candidate.replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

function proxyEnvironmentFrom(httpsProxy, httpProxy, noProxy) {
  const environment = {}
  if (httpsProxy !== undefined) {
    environment.HTTPS_PROXY = httpsProxy
    environment.https_proxy = httpsProxy
  }
  if (httpProxy !== undefined) {
    environment.HTTP_PROXY = httpProxy
    environment.http_proxy = httpProxy
  }
  if (noProxy !== undefined) {
    environment.NO_PROXY = noProxy
    environment.no_proxy = noProxy
  }
  return environment
}

/**
 * Environment variables that make an external CLI honour a proxy. Go and Node
 * read the upper-case names; libcurl prefers the lower-case ones, so both are
 * written. `none` sets NO_PROXY=* so an inherited proxy is bypassed.
 */
export function proxyEnvironment(mode, url, options = {}) {
  const normalized = PROXY_MODES.includes(mode) ? mode : 'system'
  if (normalized === 'none') return { NO_PROXY: '*', no_proxy: '*' }
  if (normalized === 'custom') {
    const address = normalizeProxyUrl(url)
    if (address === undefined) return {}
    return proxyEnvironmentFrom(address, address, options.noProxy ?? LOCAL_HOSTS)
  }
  const system = (options.detect ?? systemProxy)(options)
  if (system === undefined) return {}
  // WinINET stores a bare host:port; add the scheme every HTTP client expects.
  const httpsProxy = normalizeProxyUrl(system.httpsProxy ?? system.httpProxy)
  const httpProxy = normalizeProxyUrl(system.httpProxy ?? system.httpsProxy)
  if (httpsProxy === undefined && httpProxy === undefined) return {}
  return proxyEnvironmentFrom(httpsProxy, httpProxy, system.noProxy ?? LOCAL_HOSTS)
}

/** Merge explicit Provider env over the proxy environment it should inherit. */
export function withProxyEnvironment(environment, mode, url, options = {}) {
  return { ...proxyEnvironment(mode, url, options), ...(environment ?? {}) }
}
