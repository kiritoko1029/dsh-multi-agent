import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import MultiAgentAvailability from '../availability.js'
import { bundledCodexExecutable } from '../lib/codex-command.js'
import * as acpPlugin from '../acp-provider.js'
import * as agyPlugin from '../agy-provider.js'
import * as codexPlugin from '../codex-provider.js'

const STAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

function createTempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function withEnvironment(values, run) {
  const keys = [
    'CODEX_COMMAND',
    'KIMI_COMMAND',
    'AGY_COMMAND',
    'PATH',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'CODEX_INSTALL_DIR',
  ]
  const resolved = { ...values }
  if (Object.hasOwn(values, 'HOME')) {
    if (!Object.hasOwn(values, 'USERPROFILE')) resolved.USERPROFILE = values.HOME
    if (!Object.hasOwn(values, 'HOMEDRIVE')) resolved.HOMEDRIVE = undefined
    if (!Object.hasOwn(values, 'HOMEPATH')) resolved.HOMEPATH = undefined
  }
  if (!Object.hasOwn(values, 'LOCALAPPDATA')) resolved.LOCALAPPDATA = undefined
  if (!Object.hasOwn(values, 'CODEX_INSTALL_DIR')) resolved.CODEX_INSTALL_DIR = undefined

  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  const restore = () => {
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  try {
    for (const key of keys) {
      if (resolved[key] === undefined) delete process.env[key]
      else process.env[key] = resolved[key]
    }
    const result = run()
    if (result && typeof result.then === 'function') return result.finally(restore)
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

/** Parse scalar values including Cordis Loader `!!js` tags. */
function parseYamlScalar(raw) {
  const trimmed = raw.trim()
  if (trimmed.startsWith('!!js ')) {
    return { __jsExpr: parseYamlScalar(trimmed.slice(5)) }
  }
  if (trimmed === '{}') return {}
  if (trimmed === '[]') return []
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((part) => parseYamlScalar(part))
  }
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    const quote = trimmed[0]
    const body = trimmed.slice(1, -1)
    return quote === "'" ? body.replaceAll("''", "'") : JSON.parse(trimmed)
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  return trimmed
}

/** Strict parser for the Cordis entry-patch YAML subset used in cordis.patch.yml. */
function parseEntryPatchYaml(source) {
  const lines = source
    .split(/\r?\n/)
    .map((text, index) => ({ text, lineNumber: index + 1 }))
    .filter(({ text }) => text.trim().length > 0 && !text.trim().startsWith('#'))

  let cursor = 0
  const indentOf = (text) => text.match(/^ */)[0].length

  function parseBlock(baseIndent) {
    const first = lines[cursor]
    if (!first || indentOf(first.text) < baseIndent) return undefined
    return first.text.trimStart().startsWith('- ') || first.text.trim() === '-'
      ? parseSequence(indentOf(first.text))
      : parseMapping(indentOf(first.text))
  }

  function parseSequence(seqIndent) {
    const items = []
    while (cursor < lines.length) {
      const { text, lineNumber } = lines[cursor]
      const indent = indentOf(text)
      if (indent < seqIndent) break
      if (indent !== seqIndent || !(text.trimStart().startsWith('- ') || text.trim() === '-')) {
        throw new Error(`Unexpected sequence indentation at line ${lineNumber}: ${text}`)
      }
      const rest = text.slice(indent + 1).trim()
      cursor += 1
      if (!rest) {
        items.push(parseBlock(seqIndent + 1))
        continue
      }
      const colonIndex = findKeyColon(rest)
      if (colonIndex < 0) {
        items.push(parseYamlScalar(rest))
        continue
      }
      const item = {}
      const key = rest.slice(0, colonIndex).trim()
      const valueText = rest.slice(colonIndex + 1).trim()
      const itemIndent = indent + 2
      item[key] = valueText ? parseYamlScalar(valueText) : parseBlock(itemIndent + 1)
      while (cursor < lines.length && indentOf(lines[cursor].text) >= itemIndent) {
        const nextIndent = indentOf(lines[cursor].text)
        if (nextIndent !== itemIndent || lines[cursor].text.trimStart().startsWith('-')) break
        const propLine = lines[cursor].text.trim()
        const propColon = findKeyColon(propLine)
        if (propColon < 0) throw new Error(`Invalid mapping entry at line ${lines[cursor].lineNumber}`)
        const propKey = propLine.slice(0, propColon).trim()
        const propVal = propLine.slice(propColon + 1).trim()
        cursor += 1
        item[propKey] = propVal ? parseYamlScalar(propVal) : parseBlock(itemIndent + 1)
      }
      items.push(item)
    }
    return items
  }

  function parseMapping(mapIndent) {
    const obj = {}
    while (cursor < lines.length) {
      const { text, lineNumber } = lines[cursor]
      const indent = indentOf(text)
      if (indent < mapIndent) break
      if (indent !== mapIndent || text.trimStart().startsWith('-')) {
        throw new Error(`Unexpected mapping indentation at line ${lineNumber}: ${text}`)
      }
      const trimmed = text.trim()
      const colonIndex = findKeyColon(trimmed)
      if (colonIndex < 0) throw new Error(`Expected key: value at line ${lineNumber}: ${text}`)
      const key = trimmed.slice(0, colonIndex).trim()
      const valueText = trimmed.slice(colonIndex + 1).trim()
      cursor += 1
      obj[key] = valueText ? parseYamlScalar(valueText) : parseBlock(mapIndent + 1)
    }
    return obj
  }

  function findKeyColon(segment) {
    let inSingle = false
    let inDouble = false
    for (let i = 0; i < segment.length; i += 1) {
      const ch = segment[i]
      if (ch === "'" && !inDouble) inSingle = !inSingle
      else if (ch === '"' && !inSingle && segment[i - 1] !== '\\') inDouble = !inDouble
      else if (ch === ':' && !inSingle && !inDouble && (i + 1 === segment.length || segment[i + 1] === ' ')) return i
    }
    return -1
  }

  const parsed = parseBlock(0)
  assert.equal(cursor, lines.length, 'Entire YAML patch should be consumed')
  return parsed
}

/** Matches @deepseek-ai/cordis-plugin-loader `!!js` expression semantics. */
const evaluateJsExpr = new Function('ctx', 'expr', `
  with (ctx) {
    return eval(expr)
  }
`)

function isJsExpr(value) {
  return value instanceof Object && Object.hasOwn(value, '__jsExpr')
}

function interpolateConfig(ctx, value) {
  if (isJsExpr(value)) return evaluateJsExpr(ctx, value.__jsExpr)
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => interpolateConfig(ctx, item))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolateConfig(ctx, item)]))
}

function isEntryDisabled(ctx, entry) {
  return isJsExpr(entry.disabled) ? Boolean(evaluateJsExpr(ctx, entry.disabled.__jsExpr)) : Boolean(entry.disabled)
}

/** Matches @deepseek-ai/cordis-plugin-include `applyEntryPatches`. */
function applyEntryPatches(baseEntries, patches) {
  const data = structuredClone(baseEntries)
  const entryMap = new Map()
  const indexEntries = (entries) => {
    for (const entry of entries) {
      if (entry.id) entryMap.set(entry.id, entry)
    }
  }
  indexEntries(data)
  for (const patch of patches) {
    const { id, insert, name, ...overrides } = patch
    if (insert) {
      data.push(...insert)
      indexEntries(insert)
      continue
    }
    const target = entryMap.get(id)
    assert.ok(target, `Patch target entry "${id}" must exist`)
    if (name) assert.equal(target.name, name)
    for (const [key, value] of Object.entries(overrides)) target[key] = value
  }
  return data
}

/** Matches @deepseek-ai/dsh-settings `mergeLayers` for partial UI settings saves. */
function isPlainDataObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isJsExpr(value)
}

function mergeSettingsLayers(under, over) {
  if (!isPlainDataObject(under) || !isPlainDataObject(over)) return structuredClone(over)
  const merged = structuredClone(under)
  for (const [key, value] of Object.entries(over)) {
    merged[key] = Object.hasOwn(merged, key) ? mergeSettingsLayers(merged[key], value) : structuredClone(value)
  }
  return merged
}

/** Expand package.json `files` globs within STAGE_ROOT without touching node_modules or test fixtures. */
function collectPublishedFiles() {
  const manifestPath = join(STAGE_ROOT, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const collected = new Set(['package.json'])
  for (const pattern of manifest.files ?? []) {
    if (!pattern.includes('*')) {
      if (existsSync(join(STAGE_ROOT, pattern))) collected.add(pattern)
      continue
    }
    const dirPart = dirname(pattern)
    const filePattern = pattern.slice(dirPart === '.' ? 0 : dirPart.length + 1)
    const regex = new RegExp(`^${filePattern.replaceAll('.', '\\.').replaceAll('*', '[^/]+')}$`)
    const absDir = resolve(STAGE_ROOT, dirPart)
    if (!existsSync(absDir)) continue
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (!entry.isFile() || !regex.test(entry.name)) continue
      collected.add(dirPart === '.' ? entry.name : `${dirPart}/${entry.name}`)
    }
  }
  return [...collected].sort()
}

/** Shared ACP JSON-RPC stub body that requests tool permission and echoes its script path, argv, and permission outcome. */
function acpStubScriptBody(scriptPath, label) {
  return `let buffer = ''
let nextRequestId = 100
const pending = new Map()
const scriptPath = ${JSON.stringify(scriptPath)}
const agentLabel = ${JSON.stringify(label)}

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + '\\n')
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  while (true) {
    const newline = buffer.indexOf('\\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.method === undefined && msg.id !== undefined) {
      const resolver = pending.get(msg.id)
      if (resolver) {
        pending.delete(msg.id)
        resolver(msg.result)
      }
      continue
    }
    const { id, method, params } = msg
    if (method === 'initialize') {
      send({ jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion, agentCapabilities: { loadSession: true } } })
    } else if (method === 'session/new') {
      send({ jsonrpc: '2.0', id, result: { sessionId: agentLabel + '-session', configOptions: [] } })
    } else if (method === 'session/prompt') {
      const permId = nextRequestId++
      pending.set(permId, (permResult) => {
        const report = {
          executable: scriptPath,
          args: process.argv.slice(2),
          permissionOutcome: permResult?.outcome ?? null,
        }
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: params.sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(report) } },
          },
        })
        send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } })
      })
      send({
        jsonrpc: '2.0',
        id: permId,
        method: 'session/request_permission',
        params: {
          sessionId: params.sessionId,
          toolCall: { toolCallId: 'perm-check', title: 'Write report', kind: 'edit' },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
          ],
        },
      })
    }
  }
})
process.stdin.on('end', () => process.exit(0))
`
}

/** Executable ACP stub script for POSIX hosts using shebang + chmod. */
function writeAcpExecutable(path, label) {
  mkdirSync(dirname(path), { recursive: true })
  const script = `#!/usr/bin/env ${process.execPath}\n${acpStubScriptBody(path, label)}`
  writeFileSync(path, script, { mode: 0o755 })
  chmodSync(path, 0o755)
  return path
}

/** Plain JS ACP stub script launched via process.execPath on Windows without shebang/chmod. */
function writeAcpScript(path, label) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, acpStubScriptBody(path, label))
  return path
}

function writeStubExecutable(path) {
  mkdirSync(dirname(path), { recursive: true })
  if (process.platform === 'win32') {
    writeFileSync(path, '')
    return path
  }
  writeFileSync(path, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  chmodSync(path, 0o755)
  return path
}

function spawnRealSubprocess(spec, spawnedCommands) {
  spawnedCommands.push({ argv: [...spec.argv], cwd: spec.cwd })
  const child = spawn(spec.argv[0], spec.argv.slice(1), {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stderr.resume()
  let exited = false
  const done = new Promise((resolveDone, rejectDone) => {
    child.once('error', (error) => {
      exited = true
      rejectDone(error)
    })
    child.once('exit', (exitCode, signal) => {
      exited = true
      resolveDone({ exitCode, signal })
    })
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    done,
    async waitForExit(signal) {
      if (!signal) return done
      if (signal.aborted) return undefined
      let onAbort
      try {
        return await Promise.race([
          done,
          new Promise((resolveAbort) => {
            onAbort = () => resolveAbort(undefined)
            signal.addEventListener('abort', onAbort, { once: true })
          }),
        ])
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
    },
    terminate() {
      if (exited) return
      if (process.platform === 'win32') {
        try { child.kill() } catch {}
      } else {
        try { child.kill('SIGTERM') } catch {}
      }
    },
  }
}

/** Boot a real Cordis Context with Loader `!!js` interpolation and mount patch entries. */
async function mountPortablePatch(entries, { applyCodexOfficial } = {}) {
  const ctx = new Context()
  const providers = new Map()
  const routes = new Map()
  const warnings = []
  const spawnedCommands = []
  const disabledIds = []

  ctx.on('internal/config', function (fiber, next) {
    const config = next()
    return interpolateConfig((fiber ?? this).ctx, config)
  }, { global: true })

  ctx.logger.warn = (...args) => {
    warnings.push(args.map(String).join(' '))
  }

  class HostStubs extends Service {
    constructor(hostCtx) {
      super(hostCtx, 'subagents')
      hostCtx.reflect.provide('subprocess', {
        spawn: (spec) => spawnRealSubprocess(spec, spawnedCommands),
      })
      hostCtx.reflect.provide('webServer', {
        register: (route) => {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      })
      hostCtx.reflect.provide('connection', {
        admit: () => ({ peer: { principal: { kind: 'owner' } } }),
      })
      hostCtx.reflect.provide('multiAgentTasks', {
        observeACP() {},
        observeCodex() {},
        setExternalSession() {},
        setTelemetry() {},
      })
    }

    registerProvider(provider) {
      providers.set(provider.name, provider)
      return () => providers.delete(provider.name)
    }
  }

  const mountedFibers = []
  const mountPlugin = async (plugin, config) => {
    const scope = ctx.plugin(plugin, config)
    const fiber = scope.ctx?.fiber ?? scope
    mountedFibers.push(fiber)
    await fiber.await()
  }

  await mountPlugin(HostStubs)

  const pluginModules = {
    '@kiritoko1029/dsh-multi-agent/availability': MultiAgentAvailability,
    '@kiritoko1029/dsh-multi-agent/acp-provider': acpPlugin,
    '@kiritoko1029/dsh-multi-agent/agy-provider': agyPlugin,
    '@kiritoko1029/dsh-multi-agent/codex-provider': applyCodexOfficial
      ? {
          name: codexPlugin.name,
          inject: codexPlugin.inject,
          Config: codexPlugin.Config,
          apply: (pluginCtx, config) => codexPlugin.apply(pluginCtx, config, applyCodexOfficial),
        }
      : codexPlugin,
  }

  for (const entry of entries) {
    const plugin = pluginModules[entry.name]
    if (!plugin) continue
    if (isEntryDisabled(ctx, entry)) {
      disabledIds.push(entry.id)
      continue
    }
    await mountPlugin(plugin, entry.config)
  }

  return {
    ctx,
    providers,
    routes,
    warnings,
    spawnedCommands,
    disabledIds,
    async close() {
      for (const fiber of mountedFibers.reverse()) {
        await fiber.dispose()
      }
    },
  }
}

async function runAcpProviderOnce(provider) {
  const run = await provider.start({
    cwd: STAGE_ROOT,
    prompt: [{ type: 'text', text: 'Verify portable command and permission policy.' }],
    signal: new AbortController().signal,
  })
  try {
    const settled = await run.result
    assert.equal(settled.stopReason, 'completed')
    return JSON.parse(settled.output[0].text)
  } finally {
    await run.dispose()
  }
}

function loadStagePatchEntries(extraPatches = []) {
  const rawYaml = readFileSync(join(STAGE_ROOT, 'cordis.patch.yml'), 'utf8')
  const stagePatches = parseEntryPatchYaml(rawYaml)
  return applyEntryPatches([], [...stagePatches, ...extraPatches])
}

test('published files contain no personal home paths or packager username', () => {
  const publishedFiles = collectPublishedFiles()
  for (const required of ['cordis.patch.yml', 'availability.js', 'acp-provider.js', 'agy-provider.js', 'codex-provider.js', 'index.js', 'README.md']) {
    assert.ok(publishedFiles.includes(required), `Expected ${required} in published files list`)
  }
  assert.equal(publishedFiles.some((file) => file.startsWith('node_modules/') || file.startsWith('test/') || file.startsWith('.dsh/')), false)

  const homePathPatterns = [
    { label: 'macOS home path', regex: /(?:^|[^a-zA-Z0-9_])\/Users\/[^/\s'"`]+/ },
    { label: 'Linux home path', regex: /(?:^|[^a-zA-Z0-9_])\/home\/[^/\s'"`]+/ },
    { label: 'Windows home path', regex: /[A-Za-z]:\\Users\\[^\\\s'"`]+/ },
  ]
  const currentUsername = (() => {
    try { return userInfo().username } catch { return '' }
  })()
  const genericNames = new Set(['root', 'runner', 'ubuntu', 'admin', 'user', 'node', 'test', 'ci'])
  if (currentUsername.length >= 3 && !genericNames.has(currentUsername.toLowerCase())) {
    const escaped = currentUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    homePathPatterns.push({ label: 'host username', regex: new RegExp(escaped, 'i') })
  }

  const violations = []
  for (const relativePath of publishedFiles) {
    const content = readFileSync(join(STAGE_ROOT, relativePath), 'utf8')
    for (const { label, regex } of homePathPatterns) {
      const match = content.match(regex)
      if (match) violations.push(`${relativePath} matched ${label}: ${match[0]}`)
    }
  }
  assert.deepEqual(violations, [])
})

test('cordis.patch.yml declares dynamic availability commands and conservative ACP defaults', () => {
  const entries = loadStagePatchEntries()
  assert.deepEqual(entries.map((entry) => entry.id), [
    'multi-agent-availability',
    'multi-agent-task-monitor',
    'multi-agent-delegation-policy',
    'multi-agent-router',
    'kimi-code-acp',
    'agy-acp',
    'codex-provider',
  ])

  const kimi = entries.find((entry) => entry.id === 'kimi-code-acp')
  assert.equal(kimi.config.providerName, 'kimi-code')
  assert.deepEqual(kimi.config.args, ['acp'])
  assert.equal(kimi.config.permission, 'main-session')
  assert.equal(kimi.config.subagentPermissionMode, 'auto')
  assert.equal(isJsExpr(kimi.config.command), true)
  assert.match(kimi.config.command.__jsExpr, /multiAgentAvailability/)
  assert.match(kimi.config.command.__jsExpr, /kimiCommand/)
  assert.equal(kimi.disabled, undefined)
  assert.deepEqual(kimi.inject, ['multiAgentAvailability'])

  const agy = entries.find((entry) => entry.id === 'agy-acp')
  assert.equal(agy.config.providerName, 'agy')
  assert.deepEqual(agy.config.args, ['acp'])
  assert.equal(agy.config.permission, 'main-session')
  assert.equal(agy.config.subagentPermissionMode, 'auto')
  assert.equal(isJsExpr(agy.config.command), true)
  assert.match(agy.config.command.__jsExpr, /multiAgentAvailability/)
  assert.match(agy.config.command.__jsExpr, /agyCommand/)
  assert.equal(agy.disabled, undefined)
  assert.deepEqual(agy.inject, ['multiAgentAvailability'])

  const codex = entries.find((entry) => entry.id === 'codex-provider')
  assert.equal(codex.config.providerName, 'codex-router')
  assert.equal(codex.config.permissionPolicy, 'main-session')
  assert.equal(codex.config.subagentPermissionMode, 'auto')
  assert.equal(codex.config.permissionMode, 'approve-for-me')
  assert.notEqual(codex.config.permissionMode, 'dangerously-bypass-approvals-and-sandbox')
  assert.equal(codex.disabled, undefined)
  assert.deepEqual(codex.inject, ['multiAgentAvailability'])
})

test('detected executables under different user homes and PATH drive runtime ACP commands and main-session permissions by default', async (t) => {
  if (process.platform === 'win32') {
    const aliceHome = createTempDir(t, 'portable-alice-home-')
    const aliceLocalAppData = join(aliceHome, 'AppData', 'Local')
    const aliceKimi = writeStubExecutable(join(aliceHome, '.kimi-code', 'bin', 'kimi.exe'))
    const aliceAgy = writeStubExecutable(join(aliceLocalAppData, 'agy', 'bin', 'agy.exe'))
    // Production availability only accepts native .exe/.com on Windows, never .cmd shims.
    writeStubExecutable(join(aliceHome, '.local', 'bin', 'codex.cmd'))

    await withEnvironment({
      HOME: aliceHome,
      LOCALAPPDATA: aliceLocalAppData,
      PATH: join(aliceHome, 'empty-path'),
      CODEX_COMMAND: undefined,
      KIMI_COMMAND: undefined,
      AGY_COMMAND: undefined,
    }, async () => {
      const runtime = await mountPortablePatch(loadStagePatchEntries())
      try {
        assert.deepEqual(runtime.disabledIds, [])
        assert.equal(runtime.providers.has('codex-router'), false, 'missing/non-native Codex skips registration in apply')
        assert.ok(runtime.providers.has('kimi-code'))
        assert.ok(runtime.providers.has('agy'))
        assert.equal(runtime.providers.get('kimi-code').config.command, aliceKimi)
        assert.equal(runtime.providers.get('kimi-code').config.permission, 'main-session')
        assert.equal(runtime.providers.get('agy').config.command, aliceAgy)
        assert.equal(runtime.providers.get('agy').config.permission, 'main-session')
      } finally {
        await runtime.close()
      }
    })

    const bobHome = createTempDir(t, 'portable-bob-home-')
    const bobLocalAppData = join(bobHome, 'AppData', 'Local')
    const bobPathBin = join(bobHome, 'custom-path-bin')
    const bobKimi = writeStubExecutable(join(bobHome, '.kimi-code', 'bin', 'kimi.exe'))
    const bobAgy = writeStubExecutable(join(bobPathBin, 'agy.exe'))
    writeStubExecutable(join(bobLocalAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'))

    const capturedCodexConfigs = []
    await withEnvironment({
      HOME: bobHome,
      LOCALAPPDATA: bobLocalAppData,
      PATH: bobPathBin,
      CODEX_COMMAND: undefined,
      KIMI_COMMAND: undefined,
      AGY_COMMAND: undefined,
    }, async () => {
      const runtime = await mountPortablePatch(loadStagePatchEntries(), {
        applyCodexOfficial(officialCtx, initialConfig) {
          capturedCodexConfigs.push(initialConfig)
          officialCtx.subagents.registerProvider({
            name: initialConfig.providerName,
            config: { ...initialConfig },
            async start() { throw new Error('unused') },
          })
        },
      })
      try {
        assert.deepEqual(runtime.disabledIds, [])
        assert.equal(runtime.providers.get('kimi-code').config.command, bobKimi)
        assert.equal(runtime.providers.get('agy').config.command, bobAgy)
        assert.equal(capturedCodexConfigs.length, 1)
        assert.equal(capturedCodexConfigs[0].permissionMode, 'approve-for-me')
      } finally {
        await runtime.close()
      }
    })

    const stubKimiJs = writeAcpScript(join(aliceHome, 'stubs', 'kimi-acp.js'), 'win-kimi')
    const stubAgyJs = writeAcpScript(join(aliceHome, 'stubs', 'agy-acp.js'), 'win-agy')
    await withEnvironment({
      HOME: aliceHome,
      LOCALAPPDATA: aliceLocalAppData,
      PATH: join(aliceHome, 'empty-path'),
      CODEX_COMMAND: undefined,
      KIMI_COMMAND: undefined,
      AGY_COMMAND: undefined,
    }, async () => {
      const entries = loadStagePatchEntries().map((entry) => {
        if (entry.id === 'kimi-code-acp') {
          return { ...entry, config: mergeSettingsLayers(entry.config, { command: process.execPath, args: [stubKimiJs, 'acp'] }) }
        }
        if (entry.id === 'agy-acp') {
          return { ...entry, config: mergeSettingsLayers(entry.config, { command: process.execPath, args: [stubAgyJs, 'acp'] }) }
        }
        return entry
      })
      const runtime = await mountPortablePatch(entries)
      try {
        const kimiRun = await runAcpProviderOnce(runtime.providers.get('kimi-code'))
        assert.equal(kimiRun.executable, stubKimiJs)
        assert.deepEqual(kimiRun.args, ['acp'])
        assert.deepEqual(kimiRun.permissionOutcome, { outcome: 'selected', optionId: 'reject-once' })

        const agyRun = await runAcpProviderOnce(runtime.providers.get('agy'))
        assert.equal(agyRun.executable, stubAgyJs)
        assert.deepEqual(agyRun.args, ['acp'])
        assert.deepEqual(agyRun.permissionOutcome, { outcome: 'selected', optionId: 'reject-once' })
      } finally {
        await runtime.close()
      }
    })

    await t.test('auto-discovered native .exe ACP binaries launch directly on Windows', {
      skip: 'Windows cannot execute empty .exe placeholders and production availability intentionally rejects .cmd shims; spawning auto-discovered default commands requires real native kimi.exe / agy.exe binaries.',
    }, () => {})
    return
  }

  const aliceHome = createTempDir(t, 'portable-alice-home-')
  const aliceKimi = writeAcpExecutable(join(aliceHome, '.kimi-code', 'bin', 'kimi'), 'alice-kimi')
  const aliceAgy = writeAcpExecutable(join(aliceHome, '.local', 'bin', 'agy'), 'alice-agy')

  await withEnvironment({
    HOME: aliceHome,
    PATH: join(aliceHome, 'empty-path'),
    CODEX_COMMAND: join(aliceHome, 'missing-codex'),
    KIMI_COMMAND: undefined,
    AGY_COMMAND: undefined,
  }, async () => {
    const runtime = await mountPortablePatch(loadStagePatchEntries())
    try {
      assert.deepEqual(runtime.disabledIds, [])
      assert.equal(runtime.providers.has('codex-router'), Boolean(bundledCodexExecutable()), 'Codex uses its package native binary when available')
      assert.ok(runtime.providers.has('kimi-code'))
      assert.ok(runtime.providers.has('agy'))

      const kimiRun = await runAcpProviderOnce(runtime.providers.get('kimi-code'))
      assert.equal(kimiRun.executable, aliceKimi)
      assert.deepEqual(kimiRun.args, ['acp'])
      assert.deepEqual(kimiRun.permissionOutcome, { outcome: 'selected', optionId: 'reject-once' })

      const agyRun = await runAcpProviderOnce(runtime.providers.get('agy'))
      assert.equal(agyRun.executable, aliceAgy)
      assert.deepEqual(agyRun.args, ['acp'])
      assert.deepEqual(agyRun.permissionOutcome, { outcome: 'selected', optionId: 'reject-once' })
    } finally {
      await runtime.close()
    }
  })

  const bobHome = createTempDir(t, 'portable-bob-home-')
  const bobPathBin = join(bobHome, 'custom-path-bin')
  const bobKimi = writeAcpExecutable(join(bobHome, '.kimi-code', 'bin', 'kimi'), 'bob-kimi')
  const bobAgy = writeAcpExecutable(join(bobPathBin, 'agy'), 'bob-agy')
  writeStubExecutable(join(bobHome, '.vite-plus', 'bin', 'codex'))

  const capturedCodexConfigs = []
  await withEnvironment({
    HOME: bobHome,
    PATH: bobPathBin,
    CODEX_COMMAND: undefined,
    KIMI_COMMAND: undefined,
    AGY_COMMAND: undefined,
  }, async () => {
    const runtime = await mountPortablePatch(loadStagePatchEntries(), {
      applyCodexOfficial(officialCtx, initialConfig) {
        capturedCodexConfigs.push(initialConfig)
        officialCtx.subagents.registerProvider({
          name: initialConfig.providerName,
          config: { ...initialConfig },
          async start() { throw new Error('unused') },
        })
      },
    })
    try {
      assert.deepEqual(runtime.disabledIds, [])
      const kimiRun = await runAcpProviderOnce(runtime.providers.get('kimi-code'))
      assert.equal(kimiRun.executable, bobKimi)

      const agyRun = await runAcpProviderOnce(runtime.providers.get('agy'))
      assert.equal(agyRun.executable, bobAgy)

      assert.equal(capturedCodexConfigs.length, 1)
      assert.equal(capturedCodexConfigs[0].permissionMode, 'approve-for-me')
    } finally {
      await runtime.close()
    }
  })
})

test('missing external CLIs disable ACP while Codex can use its bundled native binary', async (t) => {
  const emptyHome = createTempDir(t, 'portable-empty-home-')

  await withEnvironment({
    HOME: emptyHome,
    PATH: join(emptyHome, 'empty-bin'),
    CODEX_COMMAND: join(emptyHome, 'no-codex'),
    KIMI_COMMAND: join(emptyHome, 'no-kimi'),
    AGY_COMMAND: join(emptyHome, 'no-agy'),
  }, async () => {
    const entries = loadStagePatchEntries()
    const codexCount = bundledCodexExecutable() ? 1 : 0
    const runtime = await mountPortablePatch(entries)
    try {
      const availability = runtime.ctx.get('multiAgentAvailability')
      assert.equal(availability.codex, false)
      assert.equal(availability.kimiCode, false)
      assert.equal(availability.agy, false)

      assert.deepEqual(runtime.disabledIds, [], 'CLI detection must not disable entries before availability is ready')
      assert.equal(runtime.providers.size, codexCount)
      assert.equal(runtime.routes.size, codexCount)

      for (const coreId of ['multi-agent-availability', 'multi-agent-task-monitor', 'multi-agent-delegation-policy', 'multi-agent-router']) {
        const coreEntry = entries.find((entry) => entry.id === coreId)
        assert.equal(isEntryDisabled(runtime.ctx, coreEntry), false, `${coreId} must stay enabled without external CLIs`)
      }
    } finally {
      await runtime.close()
    }

    // Defensive check: missing ACP commands skip registration cleanly; Codex
    // remains independent when its package native binary is present.
    const forcedEntries = loadStagePatchEntries([
      { id: 'kimi-code-acp', disabled: false },
      { id: 'agy-acp', disabled: false },
    ])
    const forcedRuntime = await mountPortablePatch(forcedEntries)
    try {
      assert.equal(forcedRuntime.providers.size, codexCount)
      assert.equal(forcedRuntime.warnings.some((msg) => msg.includes('Kimi Code is unavailable')), true)
      assert.equal(forcedRuntime.warnings.some((msg) => msg.includes('Antigravity is unavailable')), true)
    } finally {
      await forcedRuntime.close()
    }
  })
})

test('explicit user profile config overrides take precedence and permissions are never auto-reverted', async (t) => {
  if (process.platform === 'win32') {
    const userHome = createTempDir(t, 'portable-override-home-')
    const userLocalAppData = join(userHome, 'AppData', 'Local')
    const defaultKimi = writeStubExecutable(join(userHome, '.kimi-code', 'bin', 'kimi.exe'))
    const defaultAgy = writeStubExecutable(join(userLocalAppData, 'agy', 'bin', 'agy.exe'))
    const customKimiJs = writeAcpScript(join(userHome, 'opt', 'custom-kimi.js'), 'custom-kimi')
    const customAgyJs = writeAcpScript(join(userHome, 'opt', 'custom-agy.js'), 'custom-agy')
    const defaultKimiJs = writeAcpScript(join(userHome, 'opt', 'default-kimi.js'), 'default-kimi')
    const defaultAgyJs = writeAcpScript(join(userHome, 'opt', 'default-agy.js'), 'default-agy')
    writeStubExecutable(join(userLocalAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'))

    await withEnvironment({
      HOME: userHome,
      LOCALAPPDATA: userLocalAppData,
      PATH: join(userHome, 'empty-bin'),
      CODEX_COMMAND: undefined,
      KIMI_COMMAND: undefined,
      AGY_COMMAND: undefined,
    }, async () => {
      // Case 1: Full user profile patch overriding command, args, and permission via native process.execPath + JS stub.
      const userProfilePatches = parseEntryPatchYaml(`
- id: kimi-code-acp
  config:
    providerName: kimi-code
    command: ${JSON.stringify(process.execPath)}
    args:
      - ${JSON.stringify(customKimiJs)}
      - 'acp'
      - '--profile-override'
    permission: allow
- id: agy-acp
  config:
    providerName: agy
    command: ${JSON.stringify(process.execPath)}
    args:
      - ${JSON.stringify(customAgyJs)}
      - 'acp'
      - '--agy-override'
    permission: allow
- id: codex-provider
  config:
    providerName: codex-router
    permissionMode: never
`)
      const capturedCodexConfigs = []
      const fullOverrideRuntime = await mountPortablePatch(loadStagePatchEntries(userProfilePatches), {
        applyCodexOfficial(officialCtx, initialConfig) {
          capturedCodexConfigs.push(initialConfig)
          officialCtx.subagents.registerProvider({
            name: initialConfig.providerName,
            config: { ...initialConfig },
            async start() { throw new Error('unused') },
          })
        },
      })
      try {
        const kimiRun = await runAcpProviderOnce(fullOverrideRuntime.providers.get('kimi-code'))
        assert.equal(kimiRun.executable, customKimiJs)
        assert.notEqual(kimiRun.executable, defaultKimi)
        assert.deepEqual(kimiRun.args, ['acp', '--profile-override'])
        assert.deepEqual(kimiRun.permissionOutcome, { outcome: 'selected', optionId: 'allow-once' })

        const agyRun = await runAcpProviderOnce(fullOverrideRuntime.providers.get('agy'))
        assert.equal(agyRun.executable, customAgyJs)
        assert.notEqual(agyRun.executable, defaultAgy)
        assert.deepEqual(agyRun.args, ['acp', '--agy-override'])
        assert.deepEqual(agyRun.permissionOutcome, { outcome: 'selected', optionId: 'allow-once' })

        assert.equal(capturedCodexConfigs[0].permissionMode, 'never')
      } finally {
        await fullOverrideRuntime.close()
      }

      // Case 2: Partial settings form override preserves inherited `!!js` command and permission: allow.
      const partialEntries = loadStagePatchEntries().map((entry) => {
        if (entry.id === 'kimi-code-acp' || entry.id === 'agy-acp') {
          return { ...entry, config: mergeSettingsLayers(entry.config, { permission: 'allow' }) }
        }
        return entry
      })
      const partialRuntime = await mountPortablePatch(partialEntries, {
        applyCodexOfficial(officialCtx, initialConfig) {
          officialCtx.subagents.registerProvider({
            name: initialConfig.providerName,
            config: { ...initialConfig },
            async start() { throw new Error('unused') },
          })
        },
      })
      try {
        assert.equal(partialRuntime.providers.get('kimi-code').config.command, defaultKimi)
        assert.equal(partialRuntime.providers.get('kimi-code').config.permission, 'allow')
        assert.equal(partialRuntime.providers.get('agy').config.command, defaultAgy)
        assert.equal(partialRuntime.providers.get('agy').config.permission, 'allow')
      } finally {
        await partialRuntime.close()
      }

      // Verify runtime ACP `allow` permission flow on Windows using process.execPath + JS stub.
      const allowEntries = loadStagePatchEntries([
        { id: 'kimi-code-acp', config: { providerName: 'kimi-code', command: process.execPath, args: [defaultKimiJs, 'acp'] } },
        { id: 'agy-acp', config: { providerName: 'agy', command: process.execPath, args: [defaultAgyJs, 'acp'] } },
      ]).map((entry) => {
        if (entry.id === 'kimi-code-acp' || entry.id === 'agy-acp') {
          return { ...entry, config: mergeSettingsLayers(entry.config, { permission: 'allow' }) }
        }
        return entry
      })
      const allowRuntime = await mountPortablePatch(allowEntries)
      try {
        const kimiRun = await runAcpProviderOnce(allowRuntime.providers.get('kimi-code'))
        assert.equal(kimiRun.executable, defaultKimiJs)
        assert.deepEqual(kimiRun.permissionOutcome, { outcome: 'selected', optionId: 'allow-once' })

        const agyRun = await runAcpProviderOnce(allowRuntime.providers.get('agy'))
        assert.equal(agyRun.executable, defaultAgyJs)
        assert.deepEqual(agyRun.permissionOutcome, { outcome: 'selected', optionId: 'allow-once' })
      } finally {
        await allowRuntime.close()
      }

      await t.test('partial permission override spawns auto-discovered native .exe binaries on Windows', {
        skip: 'Spawning auto-discovered default .exe paths directly after partial merge requires real native Windows kimi.exe / agy.exe binaries.',
      }, () => {})
    })
    return
  }

  const userHome = createTempDir(t, 'portable-override-home-')
  const defaultKimi = writeAcpExecutable(join(userHome, '.kimi-code', 'bin', 'kimi'), 'default-kimi')
  const defaultAgy = writeAcpExecutable(join(userHome, '.local', 'bin', 'agy'), 'default-agy')
  const customKimi = writeAcpExecutable(join(userHome, 'opt', 'custom-kimi'), 'custom-kimi')
  const customAgy = writeAcpExecutable(join(userHome, 'opt', 'custom-agy'), 'custom-agy')
  writeStubExecutable(join(userHome, '.vite-plus', 'bin', 'codex'))

  await withEnvironment({
    HOME: userHome,
    PATH: join(userHome, 'empty-bin'),
    CODEX_COMMAND: undefined,
    KIMI_COMMAND: undefined,
    AGY_COMMAND: undefined,
  }, async () => {
    // Case 1: Full user profile patch overriding command, args, and permission.
    const userProfilePatches = parseEntryPatchYaml(`
- id: kimi-code-acp
  config:
    providerName: kimi-code
    command: '${customKimi}'
    args: ['acp', '--profile-override']
    permission: allow
- id: agy-acp
  config:
    providerName: agy
    command: '${customAgy}'
    args: ['acp', '--agy-override']
    permission: allow
- id: codex-provider
  config:
    providerName: codex-router
    permissionMode: never
`)
    const capturedCodexConfigs = []
    const fullOverrideRuntime = await mountPortablePatch(loadStagePatchEntries(userProfilePatches), {
      applyCodexOfficial(officialCtx, initialConfig) {
        capturedCodexConfigs.push(initialConfig)
        officialCtx.subagents.registerProvider({
          name: initialConfig.providerName,
          config: { ...initialConfig },
          async start() { throw new Error('unused') },
        })
      },
    })
    try {
      const kimiRun = await runAcpProviderOnce(fullOverrideRuntime.providers.get('kimi-code'))
      assert.equal(kimiRun.executable, customKimi)
      assert.notEqual(kimiRun.executable, defaultKimi)
      assert.deepEqual(kimiRun.args, ['acp', '--profile-override'])
      assert.deepEqual(kimiRun.permissionOutcome, { outcome: 'selected', optionId: 'allow-once' })

      const agyRun = await runAcpProviderOnce(fullOverrideRuntime.providers.get('agy'))
      assert.equal(agyRun.executable, customAgy)
      assert.notEqual(agyRun.executable, defaultAgy)
      assert.deepEqual(agyRun.args, ['acp', '--agy-override'])
      assert.deepEqual(agyRun.permissionOutcome, { outcome: 'selected', optionId: 'allow-once' })

      assert.equal(capturedCodexConfigs[0].permissionMode, 'never')
    } finally {
      await fullOverrideRuntime.close()
    }

    // Case 2: Partial settings form override (only permission changed to allow; inherited `!!js` command preserved).
    const partialEntries = loadStagePatchEntries().map((entry) => {
      if (entry.id === 'kimi-code-acp' || entry.id === 'agy-acp') {
        return { ...entry, config: mergeSettingsLayers(entry.config, { permission: 'allow' }) }
      }
      return entry
    })
    const partialRuntime = await mountPortablePatch(partialEntries, {
      applyCodexOfficial(officialCtx, initialConfig) {
        officialCtx.subagents.registerProvider({
          name: initialConfig.providerName,
          config: { ...initialConfig },
          async start() { throw new Error('unused') },
        })
      },
    })
    try {
      const kimiRun = await runAcpProviderOnce(partialRuntime.providers.get('kimi-code'))
      assert.equal(kimiRun.executable, defaultKimi)
      assert.deepEqual(kimiRun.permissionOutcome, { outcome: 'selected', optionId: 'allow-once' })

      const agyRun = await runAcpProviderOnce(partialRuntime.providers.get('agy'))
      assert.equal(agyRun.executable, defaultAgy)
      assert.deepEqual(agyRun.permissionOutcome, { outcome: 'selected', optionId: 'allow-once' })
    } finally {
      await partialRuntime.close()
    }
  })
})
