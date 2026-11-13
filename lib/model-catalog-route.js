import { assertDirectCommand } from './process-command.js'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

function sendJson(res, status, value) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(value))
}

function ownerRefusal(ctx, req) {
  const admission = ctx.connection.admit(req)
  if ('rejection' in admission && admission.rejection !== undefined) return admission.rejection
  return admission.peer?.principal?.kind === 'owner' ? undefined : 403
}

/** Register one owner-only model-catalog endpoint for a provider plugin. */
export function registerModelCatalogRoute(ctx, agent, load) {
  return ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `/multi-agent/model-catalog/${agent}`,
    handler: async (req, res) => {
      const refusal = ownerRefusal(ctx, req)
      if (refusal !== undefined) {
        sendJson(res, refusal, { ok: false, error: { code: 'forbidden', message: 'Owner access required' } })
        return
      }
      if (req.method !== 'GET') {
        res.setHeader('allow', 'GET')
        sendJson(res, 405, { ok: false, error: { code: 'method', message: 'Method not allowed' } })
        return
      }
      try {
        const result = await load()
        sendJson(res, 200, { ok: true, value: result })
      } catch (error) {
        ctx.logger.warn(`multi-agent model catalog "${agent}" failed: ${error instanceof Error ? error.message : String(error)}`)
        sendJson(res, 200, { ok: false, error: { code: 'catalog', message: 'Model catalog is unavailable', detail: error instanceof Error ? error.message : String(error) } })
      }
    },
  }), `multi-agent: model catalog ${agent}`)
}

/** Run a bounded, non-interactive CLI catalog query without a shell. */
export async function runCatalogCommand(ctx, argv, timeoutMs = 15000, env = {}) {
  assertDirectCommand(argv[0])
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Model catalog command timed out')), timeoutMs)
  let handle
  try {
    handle = ctx.subprocess.spawn({
      argv,
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 4 * 1024 * 1024 },
        stderr: { maxBytes: 16 * 1024 },
      },
      graceMs: 3000,
      signal: controller.signal,
      env: { ...env, KIMI_CODE_NO_AUTO_UPDATE: '1', KIMI_DISABLE_TELEMETRY: '1' },
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0 || outcome.signal !== null) throw new Error('Model catalog command failed')
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    if (stdout.trim().length === 0) throw new Error('Model catalog command returned no data')
    return stdout
  } finally {
    clearTimeout(timer)
    if (handle && !controller.signal.aborted) controller.abort()
  }
}

/** Read DSH's live provider/model directory, retaining per-provider failures. */
export async function dshModelCatalog(ctx) {
  const failures = []
  const groups = []
  for (const provider of ctx.llm.listProviders()) {
    try {
      const models = await ctx.llm.listModels(provider.id)
      groups.push({
        id: provider.id,
        name: provider.name,
        models: models.map((model) => ({ id: model.id, name: model.name || model.id })),
      })
    } catch {
      failures.push({ provider: provider.id })
    }
  }
  return { groups, failures }
}

/** Parse the native `codex debug models` catalog, including model-specific efforts. */
export function codexCatalogFromOutput(stdout) {
  const payload = JSON.parse(stdout)
  const models = (Array.isArray(payload.models) ? payload.models : [])
    .filter((model) => model?.visibility === 'list' && typeof model?.slug === 'string')
    .map((model) => ({
      id: model.slug, name: model.display_name || model.slug,
      ...(Array.isArray(model.supported_reasoning_levels) ? { reasoning: {
        efforts: model.supported_reasoning_levels.filter((level) => typeof level.effort === 'string').map((level) => ({
          id: level.effort, name: level.effort, description: level.description,
        })),
        defaultEffort: model.default_reasoning_level,
      } } : {}),
    }))
  return { groups: [{ id: 'codex', name: 'Codex', models }], failures: [] }
}

/** Parse `kimi provider list --json`, preserving configured aliases as values. */
export function kimiCatalogFromOutput(stdout) {
  const payload = JSON.parse(stdout)
  const byProvider = new Map()
  for (const [alias, model] of Object.entries(payload.models ?? {})) {
    const provider = typeof model?.provider === 'string' ? model.provider : 'kimi'
    const item = {
      id: alias,
      name: typeof model?.displayName === 'string' ? model.displayName : typeof model?.model === 'string' ? model.model : alias,
      actualId: typeof model?.model === 'string' ? model.model : undefined,
      ...(Array.isArray(model?.supportEfforts) ? { reasoning: {
        efforts: model.supportEfforts.filter((effort) => typeof effort === 'string').map((effort) => ({ id: effort, name: effort })),
        defaultEffort: model.defaultEffort,
      } } : {}),
    }
    if (!byProvider.has(provider)) byProvider.set(provider, [])
    byProvider.get(provider).push(item)
  }
  return {
    groups: [...byProvider].map(([id, models]) => ({ id, name: id, models })),
    failures: [],
  }
}

/** Preserve ACP model families and the efforts each one actually advertises. */
export function agyCatalogFromSession(sessions) {
  const models = []
  for (const session of Array.isArray(sessions) ? sessions : [sessions]) {
    const options = session?.configOptions
    const model = options?.find((option) => option?.id === 'model' && option?.category === 'model')
    const effort = options?.find((option) => option?.id === 'thought_level' && option?.category === 'thought_level')
    if (!model || typeof model.currentValue !== 'string') throw new Error('Antigravity ACP model config is unavailable')
    const selected = model.options?.find((option) => option?.value === model.currentValue)
    models.push({
      id: model.currentValue,
      name: selected?.name || model.currentValue,
      ...Array.isArray(effort?.options) ? { reasoning: {
        efforts: effort.options.filter((option) => typeof option?.value === 'string').map((option) => ({
          id: option.value, name: option.name || option.value, ...option.description === undefined ? {} : { description: option.description },
        })),
        ...effort.currentValue === undefined ? {} : { defaultEffort: effort.currentValue },
      } } : {},
    })
  }
  return { groups: [{ id: 'agy', name: 'Google Antigravity', models }], failures: [] }
}

/** Extract model ids from common CLI JSON/JSONL catalog shapes. */
export function parseModelOutput(stdout) {
  let value
  try {
    value = JSON.parse(stdout)
  } catch {
    const rows = stdout.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
    value = rows
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.models !== null && typeof value.models === 'object' && !Array.isArray(value.models)) {
    return Object.entries(value.models).map(([id, model]) => ({
      id,
      name: typeof model?.name === 'string' ? model.name : typeof model?.id === 'string' ? model.id : id,
    }))
  }
  const candidates = Array.isArray(value) ? value : value?.models ?? value?.data ?? value?.catalog ?? value?.results ?? []
  if (!Array.isArray(candidates)) return []
  return candidates.flatMap((model) => {
    if (typeof model === 'string') return [{ id: model, name: model }]
    const id = model?.id ?? model?.model ?? model?.slug ?? model?.alias
    return typeof id === 'string' && id.length > 0 ? [{ id, name: typeof model?.name === 'string' ? model.name : id }] : []
  })
}
