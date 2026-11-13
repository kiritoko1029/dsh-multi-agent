const ROUTER_FIELDS = [
  'selectionMode',
  'defaultAgent',
  'codex',
  'kimiCode',
  'agy',
  'dsh',
  'routes',
  'additionalInstructions',
  'taskPreamble',
  'timeoutSeconds',
]

const ACP_FIELDS = [
  'providerName',
  'command',
  'args',
  'permission',
  'subagentPermissionMode',
  'env',
  'disposeEofGraceMs',
  'disposeGraceMs',
  'model',
  'reasoningEffort',
]

/** Read an ordinary Config value or the current value of a volatile reference. */
export function currentValue(field) {
  return field !== null && field !== undefined && typeof field.get === 'function' ? field.get() : field
}

/** Take one consistent router snapshot for a tool call or prompt assembly. */
export function currentRouterConfig(config) {
  const snapshot = Object.fromEntries(ROUTER_FIELDS.map((field) => [field, currentValue(config[field])]))
  if (snapshot.agy === undefined) delete snapshot.agy
  if (snapshot.dsh) snapshot.dsh = Object.fromEntries(Object.entries(snapshot.dsh).map(([key, value]) => [key, currentValue(value)]))
  return snapshot
}

/**
 * The official ACP provider reads these fields on every start. Getters preserve
 * that behavior for volatile settings while providerName remains fixed at mount.
 */
export function dynamicAcpConfig(config) {
  const runtime = {}
  for (const field of ACP_FIELDS) {
    Object.defineProperty(runtime, field, {
      enumerable: true,
      configurable: true,
      get: () => currentValue(config[field]),
    })
  }
  return runtime
}
