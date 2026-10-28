// What the kick band says about the music: its energy, the tempo, and where
// we are in the beat. Fed with the helper's band lines on the helper's own
// clock; asked by the strip for the pulse and by the music state for buddy.

export type Beat = { phase: number; count: number }

// Of 96 log-spaced bands from 40 Hz, bands 4..14 sit at roughly 60 to 100 Hz: the kick.
const KICK_FROM = 4
const KICK_TO = 14
const ACF_STEP_MS = 10
const ACF_SPAN_MS = 8000
const BPM_MIN = 65
const BPM_MAX = 200

let bassShort = 0 // seconds-scale energy
let bassLong = 0 // ten-minute-scale energy
let bassLastAt = 0
let bassPrev = 0
let fluxAvg = 0
let onsets: number[] = []
// Kick-band onset strength over the last ten seconds, for the tempo autocorrelation.
let fluxLog: { at: number; flux: number }[] = []
let bpm: number | null = null
// The helper's clock against ours: the smallest lag seen is the pipeline's delay.
let clockOffset: number | null = null
let clockOffsetAt = 0
// The beat grid: one beat at `gridAnchor` (helper time), `gridPeriod` apart; each kick nudges it.
let gridAnchor: number | null = null
let gridPeriod: number | null = null
let gridLastKick = 0
let gridBeats = 0 // beats counted up to the anchor, so moving the anchor keeps the count
let leadMs = 80 // how far ahead of the captured audio the pulse is drawn, to land on what you hear
let prefer = 140 // the tempo candidates are weighted towards: settles the beat/half-beat tie

/** Learns the helper's clock from a stamped line: the lag that never shrinks is the pipeline's delay. */
export const syncClock = (stamp: number, now: number) => {
  const lag = now - stamp
  if (clockOffset === null || lag < clockOffset) {
    clockOffset = lag
    clockOffsetAt = now
  } else if (now - clockOffsetAt > 30_000) {
    clockOffset += (lag - clockOffset) * 0.5
    clockOffsetAt = now
  }
}

/** Now, on the helper's clock: our clock less the pipeline's delay. */
export const helperNow = (): number => Date.now() - (clockOffset ?? 0)

/** The pipeline's delay as measured, in ms; null before the first stamped line. */
export const pipelineDelay = (): number | null => clockOffset

/** Hears one band line at helper time `at`: tracks the kick energy and the kicks in it. */
export const hearBass = (bands: number[], at: number) => {
  if (bands.length <= KICK_TO) return
  let sum = 0
  for (let b = KICK_FROM; b <= KICK_TO; b++) sum += bands[b] ?? 0
  const bass = sum / (KICK_TO - KICK_FROM + 1)
  const dt = bassLastAt ? Math.max(1, Math.min(1000, at - bassLastAt)) : 16
  bassLastAt = at
  bassShort += (bass - bassShort) * Math.min(1, dt / 3000)
  bassLong += (bass - bassLong) * Math.min(1, dt / 600_000)
  // Onset: a rise in bass energy well above the recent average rise, at most four a second.
  const flux = Math.max(0, bass - bassPrev)
  bassPrev = bass
  fluxLog.push({ at, flux })
  if (fluxLog.length > 1200) fluxLog = fluxLog.filter(one => at - one.at < 10_000)
  const last = onsets[onsets.length - 1] ?? 0
  if (flux > Math.max(0.04, fluxAvg * 2.2) && at - last >= 240) {
    onsets.push(at)
    nudgeGrid(at)
  }
  fluxAvg += (flux - fluxAvg) * 0.08
  if (onsets.length > 80) onsets = onsets.slice(-60)
}

/**
 * A kick at `at` pulls the beat grid a third of the way towards itself when it
 * lands near a grid beat; a kick far off the grid (a bass note, a snare) is ignored.
 */
const nudgeGrid = (at: number) => {
  if (gridPeriod === null) return
  if (gridAnchor === null) {
    gridAnchor = at
    gridLastKick = at
    return
  }
  const since = at - gridAnchor
  const err = since - Math.round(since / gridPeriod) * gridPeriod
  if (Math.abs(err) < gridPeriod * 0.3) {
    gridAnchor += err * 0.35
    gridLastKick = at
    // Move the anchor forward by whole beats so the arithmetic stays small; the count carries them.
    const skipped = Math.floor((at - gridAnchor) / gridPeriod)
    if (skipped > 0) {
      gridAnchor += skipped * gridPeriod
      gridBeats += skipped
    }
  } else if (at - gridLastKick > 2000) {
    gridAnchor = at // lost it: start over on this kick
    gridLastKick = at
  }
}

/**
 * The tempo, from the autocorrelation of the kick-band onset strength over the
 * last eight seconds: the beat length is the lag the signal best repeats at,
 * which holds whether or not every kick was caught. Candidates run BPM_MIN to
 * BPM_MAX; a beat and its double score alike for a steady kick, so candidates
 * are weighted towards the preferred tempo, and the current reading holds
 * while a candidate near it still scores close to the best. Null while the
 * signal is too weak or too short.
 */
const estimateBpm = (): number | null => {
  const at = helperNow()
  const from = at - ACF_SPAN_MS
  const recent = fluxLog.filter(one => one.at >= from)
  if (recent.length < 120) return null
  const n = Math.floor(ACF_SPAN_MS / ACF_STEP_MS)
  const x = new Float64Array(n)
  let k = 0
  for (let i = 0; i < n; i++) {
    const t = from + i * ACF_STEP_MS
    while (k + 1 < recent.length && (recent[k + 1]?.at ?? Infinity) <= t) k++
    x[i] = recent[k]?.flux ?? 0
  }
  let mean = 0
  for (let i = 0; i < n; i++) mean += x[i] ?? 0
  mean /= n
  for (let i = 0; i < n; i++) x[i] = (x[i] ?? 0) - mean
  let energy = 0
  for (let i = 0; i < n; i++) energy += (x[i] ?? 0) ** 2
  if (energy <= 1e-9) return null
  const acf = (lag: number) => {
    let sum = 0
    for (let i = 0; i + lag < n; i++) sum += (x[i] ?? 0) * (x[i + lag] ?? 0)
    return sum / energy
  }
  const minLag = Math.round(60_000 / BPM_MAX / ACF_STEP_MS)
  const maxLag = Math.round(60_000 / BPM_MIN / ACF_STEP_MS)
  const scores: number[] = []
  let best = -Infinity
  let pick = -1
  for (let lag = minLag; lag <= maxLag; lag++) {
    const a1 = acf(lag)
    const a2 = 2 * lag < n / 2 ? acf(2 * lag) : 0
    const a3 = 3 * lag < n / 2 ? acf(3 * lag) : 0
    // The preferred tempo settles beat against half-beat: an octave away weighs about a quarter.
    const bpmHere = 60_000 / (lag * ACF_STEP_MS)
    const prior = Math.exp(-0.5 * (Math.log2(bpmHere / prefer) / 0.6) ** 2)
    const score = (a1 + 0.5 * a2 + 0.25 * a3) * prior
    scores.push(score)
    if (score > best) {
      best = score
      pick = lag - minLag
    }
  }
  if (pick < 0 || best < 0.08) return null
  if (bpm !== null) {
    const nearLag = Math.round(60_000 / bpm / ACF_STEP_MS) - minLag
    let held = 0
    for (let i = Math.max(0, nearLag - 2); i <= Math.min(scores.length - 1, nearLag + 2); i++) held = Math.max(held, scores[i] ?? 0)
    if (held >= best * 0.8) return bpm
  }
  // Refine the lag between samples with a parabola through the neighbours.
  const y0 = scores[pick - 1] ?? scores[pick] ?? 0
  const y1 = scores[pick] ?? 0
  const y2 = scores[pick + 1] ?? scores[pick] ?? 0
  const denom = y0 - 2 * y1 + y2
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0
  const lagMs = (minLag + pick + Math.max(-0.5, Math.min(0.5, shift))) * ACF_STEP_MS
  let found = 60_000 / lagMs
  while (found < BPM_MIN) found *= 2
  while (found > BPM_MAX) found /= 2
  // A new estimate within two percent keeps the old number.
  if (bpm !== null && Math.abs(found - bpm) / bpm < 0.02) return bpm
  return Math.round(found)
}

/**
 * Re-estimates the tempo and keeps the beat grid's spacing in step with it;
 * without live audio there is no tempo and no grid. Answers the tempo.
 */
export const updateTempo = (live: boolean): number | null => {
  bpm = live ? estimateBpm() : null
  if (bpm === null) {
    gridPeriod = null
    gridAnchor = null
  } else {
    const period = 60_000 / bpm
    if (gridPeriod === null || Math.abs(period - gridPeriod) / period > 0.01) gridPeriod = period
  }
  return bpm
}

/** The tempo as last estimated, 65..200 bpm, or null. */
export const tempoNow = (): number | null => bpm

/**
 * Where we are in the beat, read off the grid at now plus the lead: the phase
 * within the beat and a running count. Null without a tempo, or once the kicks
 * have stopped for four seconds.
 */
export const beatNow = (): Beat | null => {
  if (bpm === null || gridAnchor === null || gridPeriod === null) return null
  const at = helperNow() + leadMs
  if (at - gridLastKick > 4000) return null
  const beats = (at - gridAnchor) / gridPeriod
  const whole = Math.floor(beats)
  return { phase: beats - whole, count: Math.max(0, gridBeats + whole) }
}

/** Kick-band energy, 0..1: over the last seconds, and over the last ten minutes. */
export const bassLevels = () => ({ short: bassShort, long: bassLong })

/** How many kicks were heard in the last `ms`. */
export const kicksInLast = (ms: number): number => {
  const at = helperNow()
  return onsets.filter(t => at - t < ms).length
}

export const beatLead = (): number => leadMs
export const setBeatLead = (ms: number) => {
  leadMs = Math.max(-500, Math.min(1000, Math.round(ms)))
}

export const tempoPreference = (): number => prefer
/** Sets the preferred tempo and forgets the current reading, so the next one is judged fresh. */
export const setTempoPreference = (value: number) => {
  prefer = Math.max(60, Math.min(220, Math.round(value)))
  bpm = null
}
