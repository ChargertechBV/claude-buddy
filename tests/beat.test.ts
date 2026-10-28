import { expect, test } from 'claude-code/testing'

import { beatNow, hearBass, kicksInLast, resetBeat, setTempoPreference, syncClock, updateTempo } from '../hooks/beat'
import { HARDCORE_CLIP } from './fixtures/hardcore-clip'

const BANDS = 96
const KICK_FROM = 4
const KICK_TO = 14
type Line = { stamp: number; bands: number[] }

/** A small seeded random, so a clip is the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A synthetic clip of helper lines, 60 a second: a four-on-the-floor kick at
 * `bpm`, each kick up to 6 ms off the beat and about one in twelve missing, the
 * kick band decaying between kicks over a floor of noise. Stamps count from the
 * clip's start, as a helper's do from its own.
 */
function kickClip(bpm: number, seconds: number, seed: number): Line[] {
  const rand = seeded(seed)
  const period = 60_000 / bpm
  const kicks: number[] = []
  for (let t = 200; t < seconds * 1000; t += period) if (rand() > 0.08) kicks.push(t + (rand() - 0.5) * 12)
  const lines: Line[] = []
  let k = -1
  for (let stamp = 0; stamp <= seconds * 1000; stamp += 1000 / 60) {
    while (k + 1 < kicks.length && (kicks[k + 1] ?? Infinity) <= stamp) k++
    const since = k >= 0 ? stamp - (kicks[k] ?? 0) : Infinity
    const kick = 0.25 + 0.65 * Math.exp(-since / 70) + rand() * 0.04
    lines.push({ stamp, bands: Array.from({ length: BANDS }, (_, b) => (b >= KICK_FROM && b <= KICK_TO ? kick : 0.2 + rand() * 0.2)) })
  }
  return lines
}

/** The recorded clip's lines, its 24 bands padded out to the helper's 96. */
function recorded(): Line[] {
  return HARDCORE_CLIP.trim()
    .split('\n')
    .map(line => ({
      stamp: parseInt(line.slice(0, 8), 16),
      bands: Array.from({ length: BANDS }, (_, b) => (b < 24 ? parseInt(line.slice(8 + 2 * b, 10 + 2 * b), 16) / 255 : 0)),
    }))
}

/**
 * Feeds lines as the capture helper's would arrive: the clip's last line lands
 * now, 30 ms after the helper stamped it, so the tempo is read over its end.
 */
function play(lines: Line[], from = 0, to = lines.length) {
  const last = lines[lines.length - 1]?.stamp ?? 0
  const startedAt = Date.now() - last - 30
  for (const line of lines.slice(from, to)) {
    syncClock(line.stamp, startedAt + line.stamp + 30)
    hearBass(line.bands, line.stamp)
  }
}

test('a steady kick reads as its tempo, from hip-hop to drum and bass', () => {
  for (const bpm of [90, 128, 150, 174]) {
    resetBeat()
    setTempoPreference(140)
    play(kickClip(bpm, 12, bpm))
    const read = updateTempo(true)
    expect(read).not.toBeNull()
    expect(Math.abs((read ?? 0) - bpm)).toBeLessThanOrEqual(2)
  }
})

test('the preferred tempo settles a beat against its half', () => {
  resetBeat()
  setTempoPreference(75)
  play(kickClip(150, 12, 7))
  expect(Math.abs((updateTempo(true) ?? 0) - 75)).toBeLessThanOrEqual(2)
  resetBeat()
  setTempoPreference(150)
  play(kickClip(150, 12, 7))
  expect(Math.abs((updateTempo(true) ?? 0) - 150)).toBeLessThanOrEqual(2)
  setTempoPreference(140)
})

test('silence has no tempo, and neither does a strip without live audio', () => {
  resetBeat()
  setTempoPreference(140)
  play(kickClip(150, 12, 9).map(line => ({ stamp: line.stamp, bands: line.bands.map(() => 0.3) })))
  expect(updateTempo(true)).toBeNull()
  resetBeat()
  play(kickClip(150, 12, 9))
  expect(updateTempo(true)).not.toBeNull()
  expect(updateTempo(false)).toBeNull()
  expect(beatNow()).toBeNull()
})

test('once it has a tempo, the beat grid counts on with the kicks', () => {
  resetBeat()
  setTempoPreference(140)
  const clip = kickClip(150, 12, 3)
  const cut = Math.floor(clip.length * 0.75)
  play(clip, 0, cut)
  expect(updateTempo(true)).not.toBeNull()
  // The kicks after the tempo is known anchor the grid and nudge it.
  play(clip, cut)
  const beat = beatNow()
  expect(beat).not.toBeNull()
  expect(beat?.count ?? 0).toBeGreaterThanOrEqual(3)
  expect(kicksInLast(12_000)).toBeGreaterThanOrEqual(20)
})

test('a helper that starts again counts from zero, and a reset hears it at once', () => {
  resetBeat()
  setTempoPreference(140)
  play(kickClip(128, 12, 11))
  expect(Math.abs((updateTempo(true) ?? 0) - 128)).toBeLessThanOrEqual(2)
  // The restarted helper's stamps begin at zero again; the capture resets the tracker when it starts one.
  resetBeat()
  play(kickClip(150, 12, 12))
  expect(Math.abs((updateTempo(true) ?? 0) - 150)).toBeLessThanOrEqual(2)
})

test('a recorded hardcore clip reads at the tempo its kick spacing gives, about 170 bpm', () => {
  resetBeat()
  setTempoPreference(140)
  play(recorded())
  const read = updateTempo(true)
  expect(read).not.toBeNull()
  expect(Math.abs((read ?? 0) - 171)).toBeLessThanOrEqual(2)
  expect(kicksInLast(12_000)).toBeGreaterThanOrEqual(20)
})
