import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const testDirectory = join(root, 'test')

const VALUE_FLAGS = new Set([
  '--test-name-pattern',
  '--test-skip-pattern',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-concurrency',
  '--test-timeout',
  '--test-shard',
  '--conditions',
  '-C',
  '--import',
  '--require',
  '-r',
])

function discoverTests() {
  const entries = readdirSync(testDirectory, { withFileTypes: true })
  const mjsTests = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => join('test', entry.name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const clientTest = entries.some((entry) => entry.isFile() && entry.name === 'client.test.js')
    ? [join('test', 'client.test.js')]
    : []
  const tests = [...mjsTests, ...clientTest]
  if (tests.length === 0) throw new Error('No test files discovered under test/')
  return tests
}

function hasExplicitTargets(args) {
  let expectValue = false
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (expectValue) {
      expectValue = false
      continue
    }
    if (arg === '--') return i + 1 < args.length
    if (arg.startsWith('-')) {
      if (!arg.includes('=') && VALUE_FLAGS.has(arg)) expectValue = true
      continue
    }
    if (existsSync(resolve(root, arg)) || /\.(?:js|mjs|cjs)$/.test(arg)) return true
  }
  return false
}

const args = process.argv.slice(2)
const testArgs = hasExplicitTargets(args) ? args : [...args, ...discoverTests()]
const result = spawnSync(process.execPath, ['--test', ...testArgs], {
  cwd: root,
  stdio: 'inherit',
})

if (result.error) throw result.error
if (result.signal) {
  console.error(`Test runner terminated by signal ${result.signal}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
