import z from '@deepseek-ai/schemastery'
import { AcpProvider, probeAcpSession } from './acp-provider.js'
import { currentValue, dynamicAcpConfig } from './lib/config.js'
import { PERMISSION_POLICIES, SUBAGENT_PERMISSION_MODES } from './lib/permission-policy.js'
import { agyCatalogFromSession, registerModelCatalogRoute } from './lib/model-catalog-route.js'
import { assertDirectCommand, commandEnvironment, hasEnvironmentKey } from './lib/process-command.js'
import { resolveExecutable } from './availability.js'

export const name = 'agy-provider'
export { inject } from './acp-provider.js'

export const Config = z.object({
  providerName: z.string().min(1).pattern(/^agy$/).default('agy'),
  command: z.string().min(1).volatile(),
  args: z.array(z.string()).default(['acp', '--stdio']).volatile(),
  permission: z.union(PERMISSION_POLICIES).default('main-session').volatile(),
  subagentPermissionMode: z.union(SUBAGENT_PERMISSION_MODES).default('auto').volatile(),
  env: z.dict(z.string()).default({}).volatile(),
  model: z.string().min(1).volatile(),
  reasoningEffort: z.string().min(1).volatile(),
  disposeEofGraceMs: z.number().min(1).max(2147483647).default(6000).volatile(),
  disposeGraceMs: z.number().min(1).max(2147483647).default(3000).volatile(),
})

const AGY_ACP_DIALECT = {
  agent: 'agy',
  label: 'Antigravity',
  availability: 'agy',
  defaultProviderName: 'agy',
  thinkingConfigId: 'thought_level',
  validateModel: true,
  preferLoad: true,
  requireHistory: true,
  // Native full-access bypass documented for `agy acp`; only appended when
  // the user selects the sub-agent full-access level.
  bypassFlag: '--dangerously-skip-permissions',
}

function defaultCommand(config, ctx) {
  return currentValue(config.command)?.trim() || ctx.get('multiAgentAvailability')?.agyCommand
}

export async function agyModelCatalog(ctx, config) {
  return probeAcpSession(ctx, {
    command: defaultCommand(config, ctx),
    args: config.args ?? ['acp', '--stdio'],
    env: config.env ?? {},
    cwd: process.cwd(),
  }, async ({ agent, session }) => {
    const models = session.configOptions?.find((option) => option?.id === 'model' && option?.category === 'model')
    if (!Array.isArray(models?.options)) throw new Error('Antigravity ACP did not advertise model configOptions')
    const sessions = []
    for (const model of models.options) {
      if (typeof model?.value !== 'string') continue
      const configured = await agent.request('session/set_config_option', {
        sessionId: session.sessionId,
        configId: 'model',
        value: model.value,
      })
      sessions.push({ ...session, configOptions: configured.configOptions })
    }
    return agyCatalogFromSession(sessions)
  })
}

export function selectAgyCommand(config, availability) {
  const manualCommand = currentValue(config.command)?.trim() || undefined
  const detectedCommand = availability?.agyCommand?.trim() || undefined
  const overrides = currentValue(config.env) ?? {}
  const environmentCommand = hasEnvironmentKey(overrides, 'PATH')
    ? resolveExecutable('agy', commandEnvironment(overrides))
    : undefined
  return manualCommand ?? detectedCommand ?? environmentCommand
}

export function apply(ctx, config) {
  const availability = ctx.get('multiAgentAvailability')
  const command = selectAgyCommand(config, availability)
  if (!command) {
    ctx.logger.warn('agy-provider: Google Antigravity is unavailable; skipping ACP provider and model route registration')
    return
  }
  assertDirectCommand(command)
  const resolved = dynamicAcpConfig(config)
  Object.defineProperty(resolved, 'command', {
    enumerable: true,
    get: () => selectAgyCommand(config, availability),
  })
  ctx.subagents.registerProvider(new AcpProvider(resolved.providerName, ctx, resolved, AGY_ACP_DIALECT))
  registerModelCatalogRoute(ctx, 'agy', () => agyModelCatalog(ctx, resolved))
}
