import { realpathSync, statSync } from 'node:fs'

/**
 * Compare directory identity without assuming Windows paths are always
 * case-insensitive. realpath handles ordinary aliases; device/file ids also
 * cover drive-letter case, separators, junctions and extended-length prefixes.
 */
export function sameDirectory(left, right) {
  const realLeft = realpathSync(left)
  const realRight = realpathSync(right)
  if (realLeft === realRight) return true
  const leftStat = statSync(realLeft, { bigint: true })
  const rightStat = statSync(realRight, { bigint: true })
  if (!leftStat.isDirectory() || !rightStat.isDirectory()) return false
  // A zero inode is not a portable identity (some network/filesystem drivers).
  return leftStat.ino !== 0n && rightStat.ino !== 0n && leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino
}
