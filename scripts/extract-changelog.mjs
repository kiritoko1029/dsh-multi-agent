import { readFileSync } from 'node:fs'

// Print the CHANGELOG.md section for one version, used as GitHub Release notes.
// Usage: node scripts/extract-changelog.mjs v0.9.0
const requested = (process.argv[2] ?? '').trim().replace(/^v/, '')
if (!requested) {
  console.error('Usage: node scripts/extract-changelog.mjs <version>')
  process.exit(1)
}

const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const lines = text.split(/\r?\n/)
const escaped = requested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const heading = new RegExp(`^##\\s+\\[?v?${escaped}\\]?(?:\\s|$)`)

const start = lines.findIndex((line) => heading.test(line))
if (start === -1) {
  console.error(`No "## [${requested}]" section in CHANGELOG.md`)
  process.exit(1)
}

let end = lines.length
for (let i = start + 1; i < lines.length; i += 1) {
  if (/^##\s/.test(lines[i])) {
    end = i
    break
  }
}

process.stdout.write(`${lines.slice(start, end).join('\n').trimEnd()}\n`)
