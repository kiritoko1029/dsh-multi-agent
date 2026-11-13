import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const TARGETS = {
  'linux:x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl'],
  'linux:arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl'],
  'android:x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl'],
  'android:arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl'],
  'darwin:x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin'],
  'darwin:arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin'],
  'win32:x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc'],
  'win32:arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc'],
}

let cachedOpenAiPackage
function openAiCodexPackage() {
  if (cachedOpenAiPackage) return cachedOpenAiPackage
  const manifestPath = createRequire(import.meta.url).resolve('@openai/codex/package.json')
  // Resolve optional platform packages from @openai/codex's own dependency
  // scope, without installing or importing DSH's Host Provider package.
  cachedOpenAiPackage = { manifestPath, require: createRequire(manifestPath) }
  return cachedOpenAiPackage
}

function executableFile(path) {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile() ? path : undefined
  } catch {
    return undefined
  }
}

/** Locate the optional native Codex binary without running a JavaScript or npm shim. */
export function bundledCodexExecutable(platform = process.platform, arch = process.arch) {
  const target = TARGETS[`${platform}:${arch}`]
  if (!target) return undefined
  const [packageName, triple] = target
  try {
    const manifestPath = openAiCodexPackage().require.resolve(`${packageName}/package.json`)
    const executable = resolve(dirname(manifestPath), 'vendor', triple, 'bin', platform === 'win32' ? 'codex.exe' : 'codex')
    return executableFile(executable)
  } catch {
    return undefined
  }
}

/** Resolve the official JS wrapper only when the compatibility fallback needs it. */
export function bundledCodexWrapper() {
  const { manifestPath } = openAiCodexPackage()
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.bin?.codex !== 'string' || manifest.bin.codex.length === 0) {
    throw new Error('Codex package manifest has no bin.codex entry')
  }
  return resolve(dirname(manifestPath), manifest.bin.codex)
}

export function codexWrapperArgv(args) {
  return [process.execPath, bundledCodexWrapper(), ...args]
}
