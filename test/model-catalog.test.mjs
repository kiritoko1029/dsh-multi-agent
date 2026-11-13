import test from 'node:test'
import assert from 'node:assert/strict'
import { agyCatalogFromSession, codexCatalogFromOutput, kimiCatalogFromOutput, registerModelCatalogRoute, runCatalogCommand } from '../lib/model-catalog-route.js'

test('Codex catalog uses public slugs and display names', () => {
  const result = codexCatalogFromOutput(JSON.stringify({ models: [
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list' },
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list' },
    { slug: 'gpt-6.1-terra', display_name: 'GPT-6.1 Terra', visibility: 'list' },
    { slug: 'auto/glm-5.3', display_name: 'GLM-5.3 · routing group', visibility: 'list' },
    { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hide' },
  ] }))
  assert.deepEqual(result.groups[0].models, [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
    { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
    { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' },
    { id: 'auto/glm-5.3', name: 'GLM-5.3 · routing group' },
  ])
})

test('Kimi catalog preserves configured aliases and actual model metadata', () => {
  const result = kimiCatalogFromOutput(JSON.stringify({
    providers: { 'managed:kimi-code': {} },
    models: {
      'kimi-code/k3.1-pro': { provider: 'managed:kimi-code', model: 'k3.1-pro', displayName: 'K3.1 Pro' },
      'kimi-code/k3': { provider: 'managed:kimi-code', model: 'k3', displayName: 'K3' },
    },
  }))
  assert.deepEqual(result.groups, [{
    id: 'managed:kimi-code',
    name: 'managed:kimi-code',
    models: [
      { id: 'kimi-code/k3.1-pro', name: 'K3.1 Pro', actualId: 'k3.1-pro' },
      { id: 'kimi-code/k3', name: 'K3', actualId: 'k3' },
    ],
  }])
})

test('catalogs expose only the reasoning efforts advertised by each model', () => {
  const codex = codexCatalogFromOutput(JSON.stringify({ models: [{ slug: 'm', visibility: 'list', supported_reasoning_levels: [{ effort: 'high', description: 'Deep reasoning' }], default_reasoning_level: 'high' }] }))
  assert.deepEqual(codex.groups[0].models[0].reasoning, { efforts: [{ id: 'high', name: 'high', description: 'Deep reasoning' }], defaultEffort: 'high' })
  const kimi = kimiCatalogFromOutput(JSON.stringify({ models: { 'kimi/m': { provider: 'kimi', model: 'm', supportEfforts: ['low', 'max'], defaultEffort: 'max' } } }))
  assert.deepEqual(kimi.groups[0].models[0].reasoning, { efforts: [{ id: 'low', name: 'low' }, { id: 'max', name: 'max' }], defaultEffort: 'max' })
})

test('agy catalog rejects missing model metadata rather than guessing', () => {
  assert.throws(() => agyCatalogFromSession({ configOptions: [] }), /model config is unavailable/)
})

test('catalog route returns JSON headers and owner-only model data', async () => {
  let route
  const ctx = {
    effect: (callback) => callback(),
    webServer: { register: (value) => { route = value; return () => {} } },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    logger: { warn() {} },
  }
  registerModelCatalogRoute(ctx, 'codex', async () => ({ groups: [], failures: [] }))
  assert.equal(route.kind, 'exact')
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  }
  await route.handler({ method: 'GET' }, response)
  assert.equal(response.status, 200)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.deepEqual(JSON.parse(response.body), { ok: true, value: { groups: [], failures: [] } })
})

test('catalog commands use argv without a shell and collect bounded stdout', async () => {
  const state = {}
  const ctx = {
    subprocess: {
      spawn(spec) {
        state.spec = spec
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: { readFrom: () => ({ text: '{"models":[]}' }) } },
        }
      },
    },
  }
  const output = await runCatalogCommand(ctx, ['kimi', 'provider', 'list', '--json'])
  assert.equal(output, '{"models":[]}')
  assert.deepEqual(state.spec.argv, ['kimi', 'provider', 'list', '--json'])
  assert.equal(state.spec.stdio.stdin, 'ignore')
  assert.equal(state.spec.stdio.stdout.maxBytes, 4 * 1024 * 1024)
  assert.equal(state.spec.stdio.stderr.maxBytes, 16 * 1024)
})
