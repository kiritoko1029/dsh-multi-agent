import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { Service } from '@deepseek-ai/cordis'
import * as nodePath from 'node:path'
import { homedir } from 'node:os'

// DSH's Windows runner launches native programs. Do not advertise a .cmd/.bat
// shim as usable when the managed process boundary cannot launch it directly.
const WINDOWS_NATIVE_EXTENSIONS = ['.exe', '.com']

function environmentValue(environment, name, platform) {
  if (typeof environment === 'string') return name === 'PATH' ? environment : undefined
  if (!environment || typeof environment !== 'object') return undefined
  if (platform !== 'win32') return environment[name]
  if (environment[name] !== undefined) return environment[name]
  const key = Object.keys(environment)
    .filter((key) => key.toUpperCase() === name && environment[key] !== undefined)
    .sort()[0]
  return key === undefined ? undefined : environment[key]
}

function pathApi(platform) {
  return platform === 'win32' ? nodePath.win32 : nodePath
}

function pathDirectories(searchPath, platform) {
  if (platform !== 'win32') return searchPath.split(nodePath.delimiter)
  const directories = []
  let start = 0
  while (start < searchPath.length) {
    const quote = searchPath[start]
    const quoted = quote === '"' || quote === "'"
    const quoteEnd = quoted ? searchPath.indexOf(quote, start + 1) : -1
    const separator = searchPath.indexOf(';', quoted ? quoteEnd < 0 ? searchPath.length : quoteEnd : start)
    const end = separator < 0 ? searchPath.length : separator
    let directory = searchPath.slice(start, end).trim()
    if (directory.startsWith('"') || directory.startsWith("'")) directory = directory.slice(1)
    if (directory.endsWith('"') || directory.endsWith("'")) directory = directory.slice(0, -1)
    if (directory) directories.push(directory)
    start = end + 1
  }
  return directories
}

/** Pure command search order, kept separate from filesystem checks for tests. */
export function executableCandidates(command, environment = process.env, platform = process.platform) {
  if (typeof command !== 'string' || command.trim().length === 0) return []
  const executable = command.trim()
  const paths = pathApi(platform)
  const extension = platform === 'win32' ? paths.extname(executable).toLowerCase() : ''
  if (platform === 'win32' && extension && !WINDOWS_NATIVE_EXTENSIONS.includes(extension)) return []
  const extensions = platform === 'win32' && extension === '' ? WINDOWS_NATIVE_EXTENSIONS : ['']
  if (paths.isAbsolute(executable)) return extensions.map((extension) => executable + extension)

  const searchPath = environmentValue(environment, 'PATH', platform)
  if (!searchPath) return []
  return pathDirectories(searchPath, platform).flatMap((directory) => extensions.map((extension) =>
    paths.resolve(directory || '.', executable + extension)))
}

/** Native/default Codex locations; PATH remains the final fallback. */
export function defaultCodexCommands(platform = process.platform, environment = process.env, home = homedir()) {
  const paths = pathApi(platform)
  if (platform === 'win32') {
    const installDir = environmentValue(environment, 'CODEX_INSTALL_DIR', platform)
    const localAppData = environmentValue(environment, 'LOCALAPPDATA', platform)
    return [
      'codex',
      ...installDir ? [paths.join(installDir, 'codex')] : [],
      ...localAppData ? [paths.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex')] : [],
      paths.join(home, '.local', 'bin', 'codex'),
    ]
  }
  return [
    'codex',
    paths.join(home, '.vite-plus', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
  ]
}

function isExecutableFile(path) {
  try {
    if (!existsSync(path)) return false
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Resolve a native absolute executable or the first matching PATH entry. */
export function resolveExecutable(command, environment = process.env, platform = process.platform) {
  return executableCandidates(command, environment, platform).find((candidate) => isExecutableFile(candidate))
}

/** Check an absolute executable or search PATH without spawning a process. */
export function detectExecutable(command, environment = process.env, platform = process.platform) {
  return resolveExecutable(command, environment, platform) !== undefined
}

/** Synchronously detected local CLI availability for the multi-agent router. */
export default class MultiAgentAvailability extends Service {
  constructor(ctx, options = {}) {
    super(ctx, 'multiAgentAvailability')
    const platform = options.platform ?? process.platform
    const environment = options.environment ?? process.env
    const home = options.home ?? homedir()
    const paths = pathApi(platform)
    const find = (command) => resolveExecutable(command, environment, platform)

    this.codexCommand = environmentValue(environment, 'CODEX_COMMAND', platform)
      ? find(environmentValue(environment, 'CODEX_COMMAND', platform))
      : defaultCodexCommands(platform, environment, home).map(find).find((command) => command !== undefined)
    this.codex = this.codexCommand !== undefined

    const kimiCommand = environmentValue(environment, 'KIMI_COMMAND', platform)
      || paths.join(home, '.kimi-code', 'bin', 'kimi')
    this.kimiCommand = find(kimiCommand) ?? find('kimi')
    this.kimi = this.kimiCommand !== undefined
    this.kimiCode = this.kimi

    const localAppData = environmentValue(environment, 'LOCALAPPDATA', platform)
    const agyCommand = environmentValue(environment, 'AGY_COMMAND', platform)
      || (platform === 'win32' && localAppData
        ? paths.join(localAppData, 'agy', 'bin', 'agy')
        : paths.join(home, '.local', 'bin', 'agy'))
    this.agyCommand = find(agyCommand) ?? find('agy')
    this.agy = this.agyCommand !== undefined
  }
}
