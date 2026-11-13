import { isAbsolute, join, resolve } from 'node:path'

export const DEFAULT_REPORT_DIRECTORY = join('.dsh', 'agent-reports')

/** Stable, portable task label for a report filename. */
export function reportSlug(description) {
  return description
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'task'
}

/**
 * Resolve the report against the actual child workspace and return an absolute
 * path so the parent never has to guess which cwd the child inherited.
 */
export function resolveReportPath(args, parentCwd, now = new Date(), uniqueId) {
  if (typeof uniqueId !== 'string' || uniqueId.length === 0) throw new Error('A unique report id is required')
  const childCwd = args.cwd === undefined ? parentCwd : resolve(parentCwd, args.cwd)
  if (args.report_path !== undefined) return isAbsolute(args.report_path) ? resolve(args.report_path) : resolve(childCwd, args.report_path)
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const filename = `${timestamp}-${reportSlug(args.description)}-${uniqueId.slice(0, 8)}.md`
  return resolve(childCwd, DEFAULT_REPORT_DIRECTORY, filename)
}
