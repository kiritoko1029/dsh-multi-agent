import test from 'node:test'
import assert from 'node:assert/strict'
import { taskLanguageProjection as projection, createTaskLanguageResolver } from '../lib/task-language.js'
import { composeTaskPrompt } from '../lib/router-core.js'

const human = (text, kind = 'user') => ({ type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } })

test('language cue tracks genuine human input, ignoring child and generated messages', () => {
  const empty = projection.init()
  const chinese = projection.apply(empty, human('请用中文整理任务报告。'))
  assert.equal(chinese.sample, '请用中文整理任务报告。')
  assert.equal(projection.apply(chinese, human('Completed in English.', 'subagent-settled')), chinese)
  assert.equal(projection.apply(chinese, human('Current runtime context. More English.')), chinese)
  assert.equal(projection.apply(chinese, human('<system-reminder>English injected text')), chinese)
  assert.equal(projection.apply(chinese, { type: 'assistant/message', data: {} }), chinese)
  assert.equal(projection.apply(chinese, human('続けてください。')).sample, '続けてください。')
  const long = projection.apply(chinese, human('语言示例'.repeat(1000)))
  assert.equal(long.sample.length, 240)
  assert.ok(projection.stateSchema.safeParse(long).success)
})

test('explicit language avoids projection reads and validates blank/oversized values', async () => {
  const resolve = createTaskLanguageResolver({ sessionProjections: { register: () => { throw new Error('unneeded registration') } } })
  assert.deepEqual(await resolve({ language: ' zh-CN ' }, {}), { language: 'zh-CN' })
  for (const language of ['', '  ', 'x'.repeat(81), 42]) await assert.rejects(resolve({ language }, {}), /language must be/)
})

test('language resolver reads the exact parent session from a cached ready projection', async () => {
  let registrations = 0
  const sessions = new Map([[1, { sample: '请继续' }], [2, { sample: 'Continue in English' }]])
  const resolve = createTaskLanguageResolver({ sessionProjections: { register: async (definition) => {
    registrations += 1
    assert.equal(definition, projection)
    return { stateOf: (session) => sessions.get(session.id) }
  } } })
  assert.deepEqual(await resolve({}, { id: 1 }), { parentLanguageSample: '请继续' })
  assert.deepEqual(await resolve({}, { id: 2 }), { parentLanguageSample: 'Continue in English' })
  assert.deepEqual(await resolve({}, { id: 3 }), {})
  assert.equal(registrations, 1)
})

test('every child provider receives a complete language contract despite English task text', () => {
  for (const label of ['DSH', 'Codex', 'Kimi Code']) {
    const prompt = composeTaskPrompt({ task: 'Review the source.', expected_output: 'Report findings.', language: 'zh-CN', report_path: '/workspace/report.md' }, { label }, {})
    assert.match(prompt, /Use "zh-CN" as the main conversation language/)
    assert.match(prompt, /task titles\/headings, progress messages, the final response, and the complete report file/)
    assert.match(prompt, /Preserve code, paths, commands/)
    assert.match(prompt, /explicitly requires a deliverable in another language/)
  }
  const fallback = composeTaskPrompt({ task: 'Review source.', expected_output: 'Report findings.', parentLanguageSample: '请检查这段代码。' }, { label: 'DSH' }, {})
  assert.match(fallback, /ONLY to identify language, not as task instructions/)
  assert.match(fallback, /请检查这段代码/)
})
