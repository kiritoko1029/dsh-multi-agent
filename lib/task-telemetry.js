import { z } from 'zod'

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()

export const usageSchema = z.object({
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  totalTokens: tokenCount,
  cacheReadTokens: tokenCount,
  cacheWriteTokens: tokenCount,
  reasoningTokens: tokenCount,
}).strict()

export const telemetrySchema = z.object({
  model: z.string().min(1).max(512).optional(),
  reasoningEffort: z.string().min(1).max(128).optional(),
  modelSource: z.enum(['reported', 'configured']).optional(),
  reasoningEffortSource: z.enum(['reported', 'configured']).optional(),
  usage: usageSchema.optional(),
  usageScope: z.enum(['task', 'session', 'turn']).optional(),
}).strict()

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function addCount(total, addition) {
  if (addition === undefined) return total
  const next = (total ?? 0) + addition
  return Number.isSafeInteger(next) ? next : undefined
}

export function normalizeUsage(value, mapping = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const usage = {}
  for (const field of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    const parsed = count(value[mapping[field] ?? field])
    if (parsed !== undefined) usage[field] = parsed
  }
  return Object.keys(usage).length === 0 ? undefined : usage
}

export function addUsage(total = {}, increment) {
  if (!increment) return Object.keys(total).length === 0 ? undefined : total
  const result = {}
  for (const field of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    const value = addCount(total[field], increment[field])
    if (value !== undefined) result[field] = value
  }
  return Object.keys(result).length === 0 ? undefined : result
}

export function modelTelemetry(model, reasoningEffort, source = 'reported') {
  return {
    ...typeof model === 'string' && model ? { model, modelSource: source } : {},
    ...typeof reasoningEffort === 'string' && reasoningEffort ? { reasoningEffort, reasoningEffortSource: source } : {},
  }
}

export function mergeTelemetry(previous = {}, update = {}) {
  const result = { ...previous }
  if (update.clearModel) {
    delete result.model
    delete result.modelSource
  }
  if (update.clearReasoningEffort) {
    delete result.reasoningEffort
    delete result.reasoningEffortSource
  }
  if (update.model !== undefined && update.model !== previous.model && update.reasoningEffortSource === 'configured' && update.reasoningEffort === undefined) {
    delete result.reasoningEffort
    delete result.reasoningEffortSource
  }
  if (update.model !== undefined && update.model !== previous.model && update.clearReasoningEffortOnModelChange) {
    delete result.reasoningEffort
    delete result.reasoningEffortSource
  }
  for (const field of ['model', 'reasoningEffort', 'modelSource', 'reasoningEffortSource', 'usageScope']) {
    if (update[field] !== undefined) result[field] = update[field]
  }
  if (update.usage !== undefined) result.usage = update.usage
  if (result.model === undefined) delete result.modelSource
  if (result.reasoningEffort === undefined) delete result.reasoningEffortSource
  if (result.usage === undefined) delete result.usageScope
  return Object.keys(result).length === 0 ? undefined : result
}

export function acpUsage(usage) {
  return normalizeUsage(usage, {
    cacheReadTokens: 'cachedReadTokens',
    cacheWriteTokens: 'cachedWriteTokens',
    reasoningTokens: 'thoughtTokens',
  })
}

export function codexUsage(usage) {
  return normalizeUsage(usage, {
    cacheReadTokens: 'cachedInputTokens',
    cacheWriteTokens: 'cacheWriteInputTokens',
    reasoningTokens: 'reasoningOutputTokens',
  })
}

export function acpConfigTelemetry(configOptions, models) {
  if (!Array.isArray(configOptions)) return undefined
  const model = configOptions.find((option) => option?.category === 'model' && option?.id === 'model')
  const effort = configOptions.find((option) => option?.category === 'thought_level')
  const variant = models?.availableModels?.find((candidate) => candidate?.modelId === `${model?.currentValue}-${effort?.currentValue}`)
  const update = {
    ...typeof variant?.modelId === 'string' ? { model: variant.modelId, modelSource: 'reported' } : typeof model?.currentValue === 'string' && model.currentValue ? { model: model.currentValue, modelSource: 'reported' } : {},
    ...typeof effort?.currentValue === 'string' && effort.currentValue ? { reasoningEffort: effort.currentValue, reasoningEffortSource: 'reported' } : {},
  }
  // Preserve this command until merging into the existing task, not an empty
  // object: otherwise a new model with no thought-level retains the old effort.
  if (update.model !== undefined && update.reasoningEffort === undefined) update.clearReasoningEffort = true
  return Object.keys(update).length ? update : undefined
}
