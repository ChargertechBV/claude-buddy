// The live spectrum: the Windows capture helper's band levels, the beat tracking
// they feed, and the music value published for the pet and other mods.

import { atom, read, update } from 'claude-code'

import type { Music, Telemetry } from '../types'
import { bassLevels, hearBass, resetBeat, syncClock, updateTempo } from './beat'
import type { $ } from './shared'
import { nowPlayingOf } from './spotify'

/** Bands the capture helper is asked for; its lines carry this many two-digit values. */
const EQ_BANDS = 96
// What the strip hears, published for other mods (buddy reacts to it): bass energy and an estimated tempo.
const music = atom({ plugin: 'buddy', key: 'music' } as const, null, { shape: 'music-1' })

/** Reads `music` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function musicOf($: $) {
  return read($, music)
}
 // newest first, each `sliceWidth(eqColumns)` heights, for the 3D and ridge views
// The live spectrum from tools/eq-capture.py on the Windows side: the last
// line's band levels (0..1), when it came, and why it is absent.
let liveBands: number[] | null = null
let liveAt = 0
let liveNote: string | null = null
let captureStarts = 0
let captureStop = false
let helperStatus: 'starting' | 'running' | 'stopped' = 'stopped'
let helperLines = 0
let helperErrors = 0
let helperRate = 0
let helperRateAt = 0
let musicLast = ''

// -- live spectrum --------------------------------------------------------------

/** Parses one helper line: an eight-digit hex stamp then two hex digits per band, or a `#` note. */
const takeLine = (line: string) => {
  const text = line.trim()
  if (!text) return
  if (text.startsWith('#')) {
    liveNote = text.slice(1).trim()
    return
  }
  if (text.length !== 8 + EQ_BANDS * 2 || !/^[0-9a-f]+$/.test(text)) return
  helperLines += 1
  const stamp = parseInt(text.slice(0, 8), 16)
  syncClock(stamp, Date.now())
  const bands: number[] = []
  for (let i = 8; i < text.length; i += 2) bands.push(parseInt(text.slice(i, i + 2), 16) / 255)
  liveBands = bands
  liveAt = Date.now()
  hearBass(bands, stamp)
}

/** Publishes what the strip hears, for buddy and anyone else; written only when it changed. */
export async function publishMusic($: $) {
  const np = await nowPlayingOf($)
  const live = liveLevels() !== null
  const bpm = updateTempo(live)
  const bass = bassLevels()
  const next: Music = {
    isPlaying: np !== null && np.isPlaying,
    track: np ? np.name : null,
    artists: np ? np.artists : [],
    energy: np ? np.energy : 0,
    reaction: np ? np.reaction : null,
    isLive: live,
    bassNow: live ? Math.round(bass.short * 100) / 100 : 0,
    bass10m: live ? Math.round(bass.long * 100) / 100 : 0,
    bpm: np && np.isPlaying ? bpm : null,
    beatMs: np && np.isPlaying && bpm ? Math.round(60_000 / bpm) : null,
  }
  const key = JSON.stringify(next)
  if (key === musicLast) return
  musicLast = key
  await update($, music, () => next)
}

/**
 * Runs the Windows-side capture helper for the session's life and feeds its
 * lines to the strip. Without Windows Python, or off WSL, the strip keeps the
 * animation and says so.
 */
export async function runCapture($: $) {
  if (captureStarts >= 3) return
  captureStarts += 1
  captureStop = false
  helperStatus = 'starting'
  // A new helper's stamps start from zero: the beat tracker learns its clock again.
  resetBeat()
  let script = `${$.plugin.root}/tools/eq-capture.py`
  try {
    const converted = await $.process.run(['wslpath', '-w', script], { timeoutMs: 10_000 })
    if (converted.exitCode === 0 && converted.stdout.trim()) script = converted.stdout.trim()
  } catch {
    // not WSL: python.exe will not be there either, and the spawn below says so
  }
  let buffer = ''
  try {
    const child = $.process.spawn({ argv: ['python.exe', script, String(EQ_BANDS)], cwd: '/mnt/c' })
    for await (const piece of child) {
      if (captureStop) break // leaving the loop ends the child
      if (piece.stream === 'stderr') {
        for (const line of piece.text.split(/\r?\n/)) {
          if (!line.trim()) continue
          if (/^# capturing/.test(line)) helperStatus = 'running'
          else helperErrors += 1
          takeLine(line.startsWith('#') ? line : `# ${line}`)
        }
        continue
      }
      helperStatus = 'running'
      buffer += piece.text
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const one of lines) takeLine(one) // every line: the kicks live in the timing
    }
    liveNote = captureStop ? 'capture helper restarting' : 'capture helper exited'
  } catch (err) {
    helperErrors += 1
    liveNote = `capture unavailable: ${err instanceof Error ? err.message : String(err)}`
  }
  helperStatus = 'stopped'
  liveBands = null
  liveAt = 0
  if (captureStop) {
    // Asked for from the pane: start again at once, with a fresh allowance.
    captureStarts = 0
    void runCapture($)
    return
  }
  // A helper that died (device change, sleep) is started again after a while.
  $.clock.after(10_000, () => void runCapture($))
}

/** The restart button: ends the running helper, whose loop then starts a new one; or starts one when none runs. */
export function restartCapture($: $) {
  helperErrors = 0
  if (helperStatus === 'stopped') {
    captureStarts = 0
    void runCapture($)
  } else {
    captureStop = true
  }
}

/** How long the last helper line counts as live: a second, so a short gap between lines never drops the strip to rest. */
const LIVE_STALE_MS = 1000

/** The live band levels while lines keep coming; null when the helper is silent or gone. */
export function liveLevels(): number[] | null {
  return liveBands !== null && Date.now() - liveAt < LIVE_STALE_MS ? liveBands : null
}

/** Whether the helper runs: then a quiet strip is silence, not a reason to guess. */
export function isCapturing(): boolean {
  return helperStatus === 'running'
}

/** Why the strip has no live spectrum, for the pane's process row; null when nothing is wrong. */
export function captureNote(): string | null {
  return liveNote
}

/** The helper's lines per second since the last report, its errors and its status. */
export function helperReport(now: number): Telemetry['helper'] {
  if (helperRateAt === 0) helperRateAt = now
  if (now - helperRateAt >= 1000) {
    helperRate = Math.round((helperLines * 1000) / Math.max(1, now - helperRateAt))
    helperLines = 0
    helperRateAt = now
  }
  return { rate: helperStatus === 'running' ? helperRate : 0, errors: helperErrors, status: helperStatus }
}
