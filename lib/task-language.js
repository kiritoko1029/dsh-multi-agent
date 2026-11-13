import { z } from 'zod'

// A bounded, host-only language cue from genuine human input. Generated runtime
// messages and child completions must never change the parent's language cue.
export const taskLanguageProjection = {
  key: 'multiAgentConversationLanguage',
  stateVersion: 1,
  stateSchema: z.object({ sample: z.string().max(240) }).strict(),
  init: () => ({ sample: '' }),
  apply(state, event) {
    if (event.type !== 'user/message' || event.data?.source?.kind !== 'user') return state
    const text = (event.data.content || []).filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text).join('\n').trim()
    if (!text || /^(?:<system-reminder>|Current runtime context\.|Time sampled while|This is an automatically generated checkpoint)/.test(text)) return state
    const sample = text.replace(/```[\s\S]*?```/g, '').trim().slice(-240)
    if (!sample || sample === state.sample) return state
    return { sample }
  },
}

export function createTaskLanguageResolver(ctx) {
  let handle
  return async (args, session) => {
    if (args.language !== undefined) {
      if (typeof args.language !== 'string' || !args.language.trim() || args.language.trim().length > 80) {
        throw new Error('language must be a non-empty language name or tag of at most 80 characters')
      }
      return { language: args.language.trim() }
    }
    const projection = await (handle ??= ctx.sessionProjections.register(taskLanguageProjection))
    const sample = projection.stateOf(session)?.sample
    return typeof sample === 'string' && sample ? { parentLanguageSample: sample } : {}
  }
}
