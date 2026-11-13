import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_REPORT_DIRECTORY, reportSlug, resolveReportPath } from '../lib/reports.js'

const now = new Date('2026-11-10T01:23:45.678Z')
const id = '12345678-abcd-4def-9000-1234567890ab'
const workspace = resolve(tmpdir(), 'dsh-report-workspace')

test('default reports use a fixed workspace directory and unique readable filename', () => {
  const path = resolveReportPath({ description: 'Fix parser regression!' }, workspace, now, id)
  assert.equal(DEFAULT_REPORT_DIRECTORY, join('.dsh', 'agent-reports'))
  assert.equal(path, join(workspace, DEFAULT_REPORT_DIRECTORY, '20261110T012345Z-fix-parser-regression-12345678.md'))
  assert.equal(reportSlug('修复解析器'), 'task')
  assert.equal(reportSlug(''), 'task')
})

test('default report follows an explicit child cwd', () => {
  const path = resolveReportPath({ description: 'Review API', cwd: 'packages/api' }, workspace, now, id)
  assert.equal(path, resolve(workspace, 'packages', 'api', DEFAULT_REPORT_DIRECTORY, '20261110T012345Z-review-api-12345678.md'))
})

test('explicit report paths override the default relative to the child cwd', () => {
  const customAbsolute = resolve(tmpdir(), 'custom.md')
  assert.equal(
    resolveReportPath({ description: 'Task', cwd: 'child', report_path: 'reports/custom.md' }, workspace, now, id),
    resolve(workspace, 'child', 'reports', 'custom.md'),
  )
  assert.equal(
    resolveReportPath({ description: 'Task', report_path: customAbsolute }, workspace, now, id),
    customAbsolute,
  )
})

test('report generation requires a unique id', () => {
  assert.throws(() => resolveReportPath({ description: 'Task' }, workspace, now, ''), /unique report id/)
})
