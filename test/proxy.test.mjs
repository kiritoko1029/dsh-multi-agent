import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectSystemProxy,
  normalizeProxyUrl,
  parseWindowsProxyOverride,
  parseWindowsProxyServer,
  proxyEnvironment,
  readMacSystemProxy,
  readWindowsSystemProxy,
  resetSystemProxyCache,
  systemProxy,
  withProxyEnvironment,
} from '../lib/proxy.js'

const REGISTRY_OUTPUT = [
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
  '    ProxyEnable    REG_DWORD    0x1',
  '    ProxyServer    REG_SZ    127.0.0.1:7890',
  '    ProxyOverride    REG_SZ    <local>;127.*;10.*',
  '',
].join('\r\n')

const SCUTIL_OUTPUT = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
}`

test('WinINET ProxyServer values map to per-scheme proxies', () => {
  assert.deepEqual(parseWindowsProxyServer('127.0.0.1:7890'), { http: '127.0.0.1:7890', https: '127.0.0.1:7890' })
  assert.deepEqual(parseWindowsProxyServer('http=a:1;https=b:2'), { http: 'a:1', https: 'b:2' })
  assert.deepEqual(parseWindowsProxyServer('https=b:2'), { http: 'b:2', https: 'b:2' })
  assert.deepEqual(parseWindowsProxyServer('http=a:1'), { http: 'a:1', https: 'a:1' })
  assert.equal(parseWindowsProxyServer(''), undefined)
  assert.equal(parseWindowsProxyServer(undefined), undefined)
  assert.equal(parseWindowsProxyServer(';'), undefined)
})

test('WinINET ProxyOverride becomes a NO_PROXY list', () => {
  assert.equal(parseWindowsProxyOverride('<local>;127.*;10.*'), 'localhost,127.0.0.1,127.*,10.*')
  assert.equal(parseWindowsProxyOverride(''), undefined)
  assert.equal(parseWindowsProxyOverride(undefined), undefined)
})

test('system proxy detection honours ProxyEnable and the registry values', () => {
  const run = (argv) => {
    assert.deepEqual(argv, ['reg.exe', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'])
    return REGISTRY_OUTPUT
  }
  assert.deepEqual(readWindowsSystemProxy(run), {
    httpProxy: '127.0.0.1:7890',
    httpsProxy: '127.0.0.1:7890',
    noProxy: 'localhost,127.0.0.1,127.*,10.*',
  })
  assert.equal(readWindowsSystemProxy(() => REGISTRY_OUTPUT.replace('0x1', '0x0')), undefined)
  assert.equal(readWindowsSystemProxy(() => {
    throw new Error('registry unavailable')
  }), undefined)
})

test('macOS scutil output is parsed into a system proxy', () => {
  assert.deepEqual(readMacSystemProxy(() => SCUTIL_OUTPUT), {
    httpProxy: '127.0.0.1:7890',
    httpsProxy: '127.0.0.1:7890',
    noProxy: '*.local,169.254/16',
  })
  assert.equal(readMacSystemProxy(() => SCUTIL_OUTPUT.replace(/Enable : 1/g, 'Enable : 0')), undefined)
  assert.equal(readMacSystemProxy(() => {
    throw new Error('scutil unavailable')
  }), undefined)
})

test('detectSystemProxy only reads platforms with a native reader', () => {
  assert.equal(detectSystemProxy({ platform: 'linux' }), undefined)
  assert.deepEqual(detectSystemProxy({ platform: 'win32', run: () => REGISTRY_OUTPUT }), {
    httpProxy: '127.0.0.1:7890',
    httpsProxy: '127.0.0.1:7890',
    noProxy: 'localhost,127.0.0.1,127.*,10.*',
  })
  assert.deepEqual(detectSystemProxy({ platform: 'darwin', run: () => SCUTIL_OUTPUT }), {
    httpProxy: '127.0.0.1:7890',
    httpsProxy: '127.0.0.1:7890',
    noProxy: '*.local,169.254/16',
  })
})

test('system proxy lookups are cached until the TTL expires', () => {
  resetSystemProxyCache()
  let calls = 0
  const run = () => {
    calls += 1
    return REGISTRY_OUTPUT
  }
  const first = systemProxy({ platform: 'win32', run, now: () => 1000, ttlMs: 30000 })
  const second = systemProxy({ platform: 'win32', run, now: () => 2000, ttlMs: 30000 })
  assert.deepEqual(first, second)
  assert.equal(calls, 1)
  systemProxy({ platform: 'win32', run, now: () => 40000, ttlMs: 30000 })
  assert.equal(calls, 2)
  resetSystemProxyCache()
})

test('proxy modes produce HTTP(S)_PROXY and NO_PROXY environment entries', () => {
  const detect = () => ({ httpProxy: '127.0.0.1:7890', httpsProxy: '127.0.0.1:7890', noProxy: 'localhost' })
  assert.deepEqual(proxyEnvironment('system', undefined, { detect }), {
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    https_proxy: 'http://127.0.0.1:7890',
    HTTP_PROXY: 'http://127.0.0.1:7890',
    http_proxy: 'http://127.0.0.1:7890',
    NO_PROXY: 'localhost',
    no_proxy: 'localhost',
  })
  assert.deepEqual(proxyEnvironment('none', undefined, { detect }), { NO_PROXY: '*', no_proxy: '*' })
  assert.deepEqual(proxyEnvironment('custom', 'http://10.0.0.2:8080', { detect }), {
    HTTPS_PROXY: 'http://10.0.0.2:8080',
    https_proxy: 'http://10.0.0.2:8080',
    HTTP_PROXY: 'http://10.0.0.2:8080',
    http_proxy: 'http://10.0.0.2:8080',
    NO_PROXY: 'localhost,127.0.0.1',
    no_proxy: 'localhost,127.0.0.1',
  })
  assert.deepEqual(proxyEnvironment('custom', '', { detect }), {})
  assert.deepEqual(proxyEnvironment('system', undefined, { detect: () => undefined }), {})
  assert.deepEqual(proxyEnvironment('unknown', undefined, { detect: () => undefined }), {})
})

test('custom proxy addresses are normalised and invalid values are ignored', () => {
  assert.equal(normalizeProxyUrl('127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(normalizeProxyUrl('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080')
  assert.equal(normalizeProxyUrl('  http://127.0.0.1:7890/  '), 'http://127.0.0.1:7890')
  assert.equal(normalizeProxyUrl(''), undefined)
  assert.equal(normalizeProxyUrl('http://'), undefined)
})

test('explicit Provider env wins over the proxy environment', () => {
  const detect = () => ({ httpsProxy: '127.0.0.1:7890', httpProxy: '127.0.0.1:7890' })
  assert.deepEqual(withProxyEnvironment({ HTTPS_PROXY: 'http://own:1', REGION: 'cn' }, 'system', undefined, { detect }), {
    HTTPS_PROXY: 'http://own:1',
    https_proxy: 'http://127.0.0.1:7890',
    HTTP_PROXY: 'http://127.0.0.1:7890',
    http_proxy: 'http://127.0.0.1:7890',
    NO_PROXY: 'localhost,127.0.0.1',
    no_proxy: 'localhost,127.0.0.1',
    REGION: 'cn',
  })
})
