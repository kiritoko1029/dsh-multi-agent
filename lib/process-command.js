import { extname } from 'node:path'

const WINDOWS_SCRIPT_EXTENSIONS = new Set(['.bat', '.cmd', '.cjs', '.js', '.mjs', '.ps1'])

/** Reject interpreters/scripts at the native CreateProcess boundary with an actionable error. */
export function assertDirectCommand(command, platform = process.platform) {
  if (typeof command !== 'string' || command.trim().length === 0) throw new Error('CLI command must be a non-empty string')
  if (platform !== 'win32') return command
  const extension = extname(command.trim()).toLowerCase()
  if (WINDOWS_SCRIPT_EXTENSIONS.has(extension)) {
    throw new Error(`Windows cannot start ${extension} directly through DSH's native process boundary. Choose the CLI's native .exe/.com executable instead of a shell or JavaScript shim.`)
  }
  return command
}

export function hasEnvironmentKey(environment, name) {
  return Object.keys(environment ?? {}).some((key) => key.toUpperCase() === name)
}

/** Merge explicit Provider env over the parent without duplicating Windows env keys. */
export function commandEnvironment(overrides = {}, environment = process.env, platform = process.platform) {
  if (platform !== 'win32') return { ...environment, ...overrides }
  const entries = Object.entries(environment)
  for (const [key, value] of Object.entries(overrides)) {
    const normalized = key.toUpperCase()
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index][0].toUpperCase() === normalized) entries.splice(index, 1)
    }
    entries.push([key, value])
  }
  return Object.fromEntries(entries)
}
