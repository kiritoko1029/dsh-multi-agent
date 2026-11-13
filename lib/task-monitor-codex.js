import { Transform } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

/** Forward every stdout byte while independently parsing complete NDJSON frames. */
export function createCodexObservationStream(observe) {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let skipping = false
  const maxFrameCharacters = 1024 * 1024
  const inspect = (line) => {
    if (!line.trim()) return
    try {
      const frame = JSON.parse(line)
      if (frame !== null && typeof frame === 'object') observe(frame)
    } catch {}
  }
  const consume = (chunk) => {
    pending += decoder.write(chunk)
    let end
    while ((end = pending.indexOf('\n')) >= 0) {
      if (!skipping && end <= maxFrameCharacters) inspect(pending.slice(0, end))
      pending = pending.slice(end + 1)
      skipping = false
    }
    if (pending.length > maxFrameCharacters) { pending = ''; skipping = true }
  }
  return new Transform({
    transform(chunk, _encoding, callback) {
      this.push(chunk)
      consume(chunk)
      callback()
    },
    flush(callback) {
      pending += decoder.end()
      if (pending && !skipping) inspect(pending)
      callback()
    },
  })
}
