import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const root = fileURLToPath(new URL('..', import.meta.url))
for (const directory of ['', 'lib/', 'scripts/']) {
  for (const name of readdirSync(new URL(`../${directory}`, import.meta.url))) {
    if (!/\.(?:js|mjs)$/.test(name)) continue
    execFileSync(process.execPath, ['--check', `${directory}${name}`], { cwd: root, stdio: 'inherit' })
  }
}
console.log('All plugin JavaScript syntax checks passed')
