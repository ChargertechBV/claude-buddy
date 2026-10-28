// The equaliser strip and the pet beside it: an adaptive frame loop (full rate
// with live audio, 30 a second when guessed or settling, 4 at rest), the strip's
// stored settings, and the pet's dance on the beat.

import { atom, read, update } from 'claude-code'

import { beatNow, setBeatLead, setTempoPreference } from './beat'
import { PET_COLUMNS, PET_ROWS, petCells } from './sprite'
import type { PetView } from './sprite'
import { DENSITY_DEFAULT, DEPTH, EQ_ROWS, PALETTES, SLICE_EVERY_DEFAULT, TICK_MS, VIEWS, barsFor, setSliceEvery, sliceEvery, sliceWidth, stripCells, stripRows } from './strip'
import type { EqView, Palette, Progress } from './strip'
import { isCapturing, liveLevels } from './capture'
import { EQ_KEY, PANE, PET_KEY, positionOf } from './shared'
import type { $ } from './shared'
import { freshPlaying, nowPlayingOf } from './spotify'

const MAX_COLUMNS = 160
const eqMode = atom({ plugin: 'buddy', key: 'eqMode' } as const, 'guess')

/** Reads `eqMode` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function eqModeOf($: $) {
  return read($, eqMode)
}

// The strip's own frame state, never drawn from a render pass.
let frameTimer: { cancel: () => void } | null = null
let isFrameRunning = false
let frameDue = 0
let lastFrameAt = 0
let lastSliceAt = 0
let framesDrawn = 0
let fpsAt = 0
let fps = 0
let eqColumns = 0
let eqHeights: number[] = []
let eqDensity = DENSITY_DEFAULT
let eqPalette: Palette = 'rainbow'
let eqView: EqView = 'ridge'
let eqModeNow: 'live' | 'guess' = 'guess'
let slices: number[][] = []
// Buddy's pet, as last read; the pane draws it and it dances on the beat.
let petView: PetView | null = null
let petName: string | null = null
let petSeenAt = 0
let petDrawnAt = 0
let petBeatDrawn: number | null = null

// -- the pet --------------------------------------------------------------------

/** Reads the buddy mod's pet on duty; absent, or refused when buddy is not loaded, is no pet. */
export async function readPet($: $) {
  try {
    const held = await $.state.get({ plugin: 'buddy', key: 'view' })
    const view = held.value
    petView = view && typeof view === 'object' ? (view as PetView) : null
    petName = petView && typeof petView.name === 'string' ? petView.name : null
  } catch {
    petView = null
    petName = null
  }
}

/** The pane drew with this pet: the frames use it until buddy's view changes. */
export function sawPet(pet: PetView | null, now: number) {
  petView = pet
  petSeenAt = now
}

/** The pet's name as last read, for the pane's line before buddy's view arrives. */
export function lastPetName(): string | null {
  return petName
}

// -- the strip ------------------------------------------------------------------

/** Frame periods: full rate while live audio moves the bars, 30 a second for the guessed animation or falling bars, 4 at rest. */
const FRAME_LIVE_MS = TICK_MS
const FRAME_SMOOTH_MS = 33
const FRAME_IDLE_MS = 250
const FRAME_HIDDEN_MS = 1000
/** The easing rates below were tuned per 33 ms frame; scaled to the real gap, bars move at one speed at any frame rate. */
const EASE_REF_MS = 33
/** Bars at or under this many eighths of a cell count as at rest. */
const REST_LEVEL = 0.4

/**
 * How long until the next frame. Full rate while the capture helper streams
 * audio; 30 a second while the bars are guessed or still falling back to rest;
 * 4 a second at rest, which still ticks the clock and lets the pet fidget; and
 * once a second while the pane is not showing.
 */
export function frameDelay(s: { isShown: boolean; isLive: boolean; isGuessing: boolean; isSettling: boolean }): number {
  if (!s.isShown) return FRAME_HIDDEN_MS
  if (s.isLive) return FRAME_LIVE_MS
  if (s.isGuessing || s.isSettling) return FRAME_SMOOTH_MS
  return FRAME_IDLE_MS
}

/** Loads the strip's stored settings at session start: view, palette, density, slices, the beat's lead and preferred tempo. */
export async function loadEqSettings($: $) {
  const density = await $.store.get('soundtrack:eqDensity')
  eqDensity = density === 1 || density === 2 ? density : DENSITY_DEFAULT
  const every = await $.store.get('soundtrack:sliceEvery')
  setSliceEvery(typeof every === 'number' && Number.isFinite(every) ? every : SLICE_EVERY_DEFAULT)
  const view = await $.store.get('soundtrack:eqView')
  eqView = typeof view === 'string' && (VIEWS as readonly string[]).includes(view) ? (view as EqView) : 'ridge'
  const palette = await $.store.get('soundtrack:eqPalette')
  eqPalette = typeof palette === 'string' && (PALETTES as readonly string[]).includes(palette) ? (palette as Palette) : 'rainbow'
  const lead = await $.store.get('soundtrack:beatLeadMs')
  if (typeof lead === 'number') setBeatLead(lead)
  const prefer = await $.store.get('soundtrack:beatPrefer')
  if (typeof prefer === 'number') setTempoPreference(prefer)
  eqModeNow = await read($, eqMode)
}

/** Switches the strip's view; the pane draws again, since the strip changes height. */
export async function setEqView($: $, next: EqView) {
  eqView = next
  slices = []
  eqHeights = []
  await $.store.set('soundtrack:eqView', eqView)
  $.ui.invalidate('ui.render')
}

export async function setEqPalette($: $, next: Palette) {
  eqPalette = next
  await $.store.set('soundtrack:eqPalette', eqPalette)
}

export async function setEqDensity($: $, next: number) {
  eqDensity = next
  eqHeights = []
  await $.store.set('soundtrack:eqDensity', eqDensity)
}

/** The strip at the pane's width: its size and its current frame, for the Raster the frames blit into. */
export function stripFrame(width: number, progress: Progress | null): { columns: number; rows: number; cells: string } {
  eqColumns = Math.max(8, Math.min(width, MAX_COLUMNS))
  const bars = barsFor(eqColumns, eqView, eqDensity)
  if (eqHeights.length !== bars) eqHeights = new Array<number>(bars).fill(0)
  return { columns: eqColumns, rows: stripRows(eqView), cells: stripCells(eqHeights, eqDensity, eqPalette, eqView, slices, progress, null) }
}

/** Frames blitted per second, measured over the last second or so. */
export function framesPerSecond(now: number): number {
  if (fpsAt === 0) fpsAt = now
  if (now - fpsAt >= 1000) {
    fps = Math.round((framesDrawn * 1000) / (now - fpsAt))
    framesDrawn = 0
    fpsAt = now
  }
  return fps
}

function scheduleFrame($: $, delay: number, now: number) {
  if (frameTimer !== null) frameTimer.cancel()
  frameDue = now + delay
  frameTimer = $.clock.after(delay, () => void frameLoop($))
}

/** Draws one frame, then schedules the next at the rate the strip needs now. */
async function frameLoop($: $) {
  frameTimer = null
  isFrameRunning = true
  let delay = FRAME_IDLE_MS
  try {
    delay = await drawFrame($)
  } catch {
    // a frame that failed is skipped; the loop goes on
  } finally {
    isFrameRunning = false
  }
  scheduleFrame($, delay, await $.clock.now())
}

/** The pane drew: a resting or hidden loop draws its next frame now. */
export function wakeFrames($: $, now: number) {
  if (isFrameRunning) return
  if (frameTimer === null || frameDue - now > FRAME_SMOOTH_MS) scheduleFrame($, 0, now)
}

/** One frame: eases the bars towards the live spectrum (or the animation), blits the strip and the pet, and answers the delay to the next frame. */
async function drawFrame($: $): Promise<number> {
  if (eqColumns === 0) return FRAME_HIDDEN_MS
  const now = await $.clock.now()
  const gap = lastFrameAt === 0 ? FRAME_LIVE_MS : Math.max(1, Math.min(250, now - lastFrameAt))
  lastFrameAt = now
  const np = await nowPlayingOf($)
  const playing = np !== null && np.isPlaying
  const energy = np?.energy ?? 0.5
  const levels = EQ_ROWS * 8
  const bars = barsFor(eqColumns, eqView, eqDensity)
  if (eqHeights.length !== bars) eqHeights = new Array<number>(bars).fill(0)
  const live = liveLevels()
  // With the helper running a quiet strip is silence; the guessed animation is for a session without it.
  const guessing = live === null && !isCapturing() && playing
  const mode = live !== null || isCapturing() ? 'live' : 'guess'
  if (mode !== eqModeNow) {
    eqModeNow = mode
    await update($, eqMode, () => mode)
  }
  const ease = (rate: number) => 1 - Math.pow(1 - rate, gap / EASE_REF_MS)
  const phase = now / EASE_REF_MS
  let isMoving = false
  for (let i = 0; i < bars; i++) {
    let target = 0
    if (live !== null) {
      // The real spectrum: bands spread across the bars, interpolated.
      const x = (i / Math.max(1, bars - 1)) * (live.length - 1)
      const lo = Math.floor(x)
      const hi = Math.min(live.length - 1, lo + 1)
      const level = (live[lo] ?? 0) * (1 - (x - lo)) + (live[hi] ?? 0) * (x - lo)
      target = level * levels
    } else if (guessing) {
      // No capture: a slow swell across the bars plus jitter; harder music beats faster.
      const swell = Math.sin(phase * (0.12 + energy * 0.2) + i * 0.7)
      const noise = Math.random() * 0.6 + 0.2
      target = levels * Math.max(0, Math.min(1, (0.15 + energy * 0.55) * noise + (swell + 1) * 0.5 * (0.2 + energy * 0.4)))
    }
    const current = eqHeights[i] ?? 0
    const rate = target > current ? (live ? 0.75 : 0.3) : live ? 0.35 : 0.15
    const next = current + (target - current) * ease(rate)
    const settled = target === 0 && next < 0.05 ? 0 : next
    eqHeights[i] = settled
    if (settled > REST_LEVEL) isMoving = true
  }
  let progress: Progress | null = null
  if (np !== null && np.durationMs !== null) {
    const pos = positionOf(freshPlaying(np), now)
    if (pos !== null) progress = { pos, total: np.durationMs, isPlaying: np.isPlaying }
  }
  const beat = playing && live !== null ? beatNow() : null
  if (eqView !== 'bars' && now - lastSliceAt >= sliceEvery * TICK_MS) {
    lastSliceAt = now
    slices.unshift(eqHeights.slice(0, sliceWidth(eqColumns)))
    if (slices.length > DEPTH) slices.length = DEPTH
  }
  const sent = await $.ui.blit({ requestId: PANE, key: EQ_KEY, cells: stripCells(eqHeights, eqDensity, eqPalette, eqView, slices, progress, beat), columns: eqColumns, rows: stripRows(eqView) })
  if (sent.deny) return frameDelay({ isShown: false, isLive: false, isGuessing: false, isSettling: false })
  framesDrawn += 1
  // The pet dances on every beat while one is known; otherwise it fidgets twice a second, as in buddy's own band.
  const petStep = beat !== null ? beat.count : null
  if (petView !== null && (petStep !== petBeatDrawn || (petStep === null && now - petDrawnAt >= 500))) {
    petBeatDrawn = petStep
    petDrawnAt = now
    void $.ui.blit({ requestId: PANE, key: PET_KEY, cells: petCells(petView, Math.floor(now / 480), petStep, energy), columns: PET_COLUMNS, rows: PET_ROWS })
  }
  // Buddy's view changes without drawing this pane again: look at it every two seconds.
  if (now - petSeenAt >= 2000) {
    petSeenAt = now
    void readPet($)
  }
  // A 3D or ridge surface keeps receding while anything on it still stands.
  const surfaceStands = eqView !== 'bars' && slices.some(row => row.some(h => h > REST_LEVEL))
  return frameDelay({ isShown: true, isLive: live !== null, isGuessing: guessing, isSettling: isMoving || surfaceStands })
}
