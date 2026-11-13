import test from 'node:test'
import assert from 'node:assert/strict'
import { agentConfigs, answerAgent, composeTaskPrompt, routingGuidance, validateAgentChoice } from '../lib/router-core.js'

const config = {
  selectionMode: 'auto',
  codex: { enabled: true, providerName: 'codex', label: 'Codex', description: 'Coding agent' },
  kimiCode: { enabled: true, providerName: 'kimi-code', label: 'Kimi Code', description: 'Kimi agent' },
  agy: { enabled: true, providerName: 'agy', label: 'Antigravity', description: 'Antigravity agent' },
  dsh: { enabled: true, providerName: 'spawn', label: 'DSH', description: 'Native DSH agent' },
  routes: [
    { agent: 'codex', prompt: 'Debug and refactor code.' },
    { agent: 'codex', prompt: 'Review technical architecture.' },
    { agent: 'kimi-code', prompt: 'Build UI and write Chinese documents.' },
    { agent: 'agy', prompt: 'Build an Android integration.' },
  ],
}

test('routing guidance includes prompt rules and task contract', () => {
  const text = routingGuidance(config)
  assert.match(text, /Debug and refactor code/)
  assert.match(text, /Review technical architecture/)
  assert.match(text, /Build UI and write Chinese documents/)
  assert.match(text, /Build an Android integration/)
  assert.match(text, /Proactively use `dispatch_agent`/)
  assert.match(text, /do not wait for the user to ask for subagents/)
  assert.match(text, /delegate those portions by default/)
  assert.match(text, /disjoint file scopes/)
  assert.match(text, /trivial, single-step/)
  assert.match(text, /completion notices/)
})

test('disabled agents cannot be selected', () => {
  const changed = { ...config, codex: { ...config.codex, enabled: false } }
  assert.deepEqual(agentConfigs(changed).map((agent) => agent.id), ['kimi-code', 'agy', 'dsh'])
  assert.throws(() => validateAgentChoice(changed, 'codex'), /not enabled/)
  assert.equal(validateAgentChoice(changed, undefined), undefined)
  assert.deepEqual(agentConfigs({ ...config, agy: { ...config.agy, enabled: false } }).map((agent) => agent.id), ['codex', 'kimi-code', 'dsh'])
})

test('task prompt is self-contained and includes report contract', () => {
  const text = composeTaskPrompt({
    task: 'Fix the failing parser tests.',
    context: 'The regression began after the tokenizer change.',
    expected_output: 'Return the root cause, changed files, and test result.',
    report_path: '.dsh/reports/parser-fix.md',
  }, config.codex, config)
  assert.match(text, /Fix the failing parser tests/)
  assert.match(text, /tokenizer change/)
  assert.match(text, /root cause, changed files, and test result/)
  assert.match(text, /\.dsh\/reports\/parser-fix\.md/)
  assert.match(text, /never claim the file exists/)
})

test('user answers map labels, recommendations, custom ids, and skips', () => {
  const options = [
    { id: 'codex', label: 'Codex (Recommended)', baseLabel: 'Codex' },
    { id: 'kimi-code', label: 'Kimi Code', baseLabel: 'Kimi Code' },
  ]
  assert.equal(answerAgent({ answers: [{ id: 'dispatch-agent', selected: ['Codex (Recommended)'] }] }, options), 'codex')
  assert.equal(answerAgent({ answers: [{ id: 'dispatch-agent', selected: [], custom: 'kimi-code' }] }, options), 'kimi-code')
  assert.equal(answerAgent({ answers: [{ id: 'dispatch-agent', selected: [] }] }, options), undefined)
  assert.throws(() => answerAgent({ answers: [{ id: 'dispatch-agent', selected: [], custom: 'other' }] }, options), /not available/)
})
