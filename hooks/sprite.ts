// The buddy mod's pet, drawn in this pane's own raster from the view buddy
// publishes, with dance moves of its own on the strip's beat.

import { DIM, blankCells, packCells } from './raster'

/** What the buddy mod publishes about the pet on duty; every field may be missing on an older buddy. */
export type PetView = {
  name?: string
  frames?: string[][]
  face?: string
  color?: string
  eye?: string
  hat?: string
  isShiny?: boolean
  stage?: number
  mood?: string
  bubble?: string | null
  anxiety?: number
  flair?: string
}

export const PET_COLUMNS = 16 // sprite 12, cape 2, one cell of sway each side
export const PET_ROWS = 6 // one row of air above the hat for the bounce and the sparkle

// Buddy's theme keys and hex colours, as raster RGB.
const THEME_RGB: Record<string, number> = {
  inactive: 0x8a8a8a,
  subtle: 0x6c6c6c,
  success: 0x1db954,
  suggestion: 0x5fafff,
  autoAccept: 0xaf87ff,
  warning: 0xffd75f,
  error: 0xff5f5f,
  remember: 0xffafd7,
  claude: 0xd7875f,
  text: 0xd0d0d0,
}
const RAINBOW_RGB = [0xff6b6b, 0xffb36b, 0xffe66b, 0x7bea8a, 0x6bb8ff, 0xb48cff]
// Buddy's own frame patterns: a frame per tick, -1 a blink on frame 0.
const PET_IDLE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0]
const PET_BUSY = [0, 1, 0, 2, 0, 1, -1, 2]
const PET_ZZZ = ['        z   ', '         Z  ', '          z ']
const PET_SWEAT = ["  '    '    ", "   '  '     ", " '      '   "]
const BLANK_FRAME = ['            ', '            ', '            ', '            ']

function rgbOf(color: string | undefined): number {
  if (!color) return THEME_RGB.inactive ?? 0x8a8a8a
  const hex = color.match(/^#([0-9a-f]{6})$/i)
  if (hex) return parseInt(hex[1] ?? '0', 16)
  return THEME_RGB[color] ?? 0xd0d0d0
}

/** A character the raster takes (printable, one cell wide); anything doubtful becomes a near ASCII twin. */
function rasterChar(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0x20
  if (cp >= 0x20 && cp < 0x7f) return ch
  if (cp === 0xb7 || cp === 0xb0 || cp === 0xd7) return ch // · ° ×
  if (cp >= 0x2500 && cp <= 0x259f) return ch // box drawing and blocks
  if (cp === 0x2726 || cp === 0x2727 || cp === 0x2728) return '*' // ✦ ✧ ✨
  if (cp === 0x25c9) return '@' // ◉
  if (cp === 0x2665) return 'v' // ♥
  return cp > 0x7f && cp < 0x100 ? ch : '?'
}

/**
 * The pet as raster cells in buddy's colours: a row of air, its hat row, then
 * the frame for this tick. With `beatStep` (the beat count from the strip's
 * grid) it dances: how, depends on `energy` (0..1, from the track's title).
 *   quiet  (< 0.35): a slow sway, one cell left or right every other beat
 *   normal           : a bounce on beats 1 and 3, a sway on 2 and 4
 *   hard   (>= 0.75): a bounce on every beat, the head thrown the other way,
 *                     and a sparkle in the air on the downbeats
 */
export function petCells(view: PetView, tick: number, beatStep: number | null = null, energy = 0.5): string {
  const words = blankCells(PET_COLUMNS, PET_ROWS)
  const frames = view.frames && view.frames.length ? view.frames : [BLANK_FRAME]
  const isAsleep = view.mood === 'asleep'
  const dancing = beatStep !== null && !isAsleep
  const beatIndex = beatStep ?? 0
  const isLively = view.mood === 'excited' || view.mood === 'happy' || view.mood === 'fighting'
  const pattern = isLively || dancing ? PET_BUSY : PET_IDLE
  const step = isAsleep ? 0 : (pattern[(dancing ? beatIndex : tick) % pattern.length] ?? 0)
  const anxious = (view.anxiety ?? 0) > 0
  const eye = isAsleep || step === -1 ? '-' : anxious ? '@' : view.mood === 'worried' ? '°' : (view.eye ?? '·')
  const top = isAsleep ? (PET_ZZZ[Math.floor(tick / 2) % PET_ZZZ.length] ?? '') : anxious ? (PET_SWEAT[tick % PET_SWEAT.length] ?? '') : (view.hat ?? '')
  const topColor = isAsleep ? (THEME_RGB.subtle ?? DIM) : anxious ? (THEME_RGB.suggestion ?? DIM) : rgbOf(view.color)
  const frame = frames[Math.max(0, step)] ?? frames[0] ?? BLANK_FRAME
  const stage = view.stage ?? 1
  const cape = stage >= 2 ? ['  ', ' \\', ' )', ' )', ' /'] : null
  const capeColor = stage >= 3 ? (THEME_RGB.warning ?? DIM) : (THEME_RGB.error ?? DIM)

  // The moves: a whole-sprite shift (dx, dy), a head shift on the top two frame rows, sparkle or not.
  let dx = 0
  let dy = 0
  let headDx = 0
  let sparkle = false
  if (dancing) {
    const b = beatIndex % 4
    if (energy < 0.35) {
      dx = b < 2 ? -1 : 1
    } else if (energy < 0.75) {
      dy = b % 2 === 0 ? -1 : 0
      dx = b === 1 ? -1 : b === 3 ? 1 : 0
    } else {
      dy = -1
      dx = b % 2 === 0 ? 0 : b === 1 ? -1 : 1
      headDx = b % 2 === 0 ? 1 : -1
      sparkle = b === 0 || b === 2
    }
  }
  const base = 1 + dy // row of the hat; row 0 is the air
  const left = 1 + dx // column of the sprite's first cell

  const putRow = (row: number, text: string, color: number, shift = 0) => {
    if (row < 0 || row >= PET_ROWS) return
    for (let col = 0; col < Math.min(12, text.length); col++) {
      const ch = text.charAt(col)
      if (ch === ' ') continue
      const x = left + shift + col
      if (x < 0 || x >= PET_COLUMNS) continue
      const i = (row * PET_COLUMNS + x) * 3
      words[i] = rasterChar(ch).codePointAt(0) ?? 0x20
      words[i + 1] = color
    }
    if (cape) {
      const tail = cape[row - base] ?? '  '
      for (let k = 0; k < 2; k++) {
        const ch = tail.charAt(k)
        if (!ch || ch === ' ') continue
        const x = left + shift + 12 + k
        if (x < 0 || x >= PET_COLUMNS) continue
        const i = (row * PET_COLUMNS + x) * 3
        words[i] = ch.codePointAt(0) ?? 0x20
        words[i + 1] = capeColor
      }
    }
  }
  putRow(base, top, topColor, headDx)
  for (let r = 0; r < 4; r++) {
    const line = (frame[r] ?? '').replaceAll('E', eye)
    const rowColor = view.isShiny ? (RAINBOW_RGB[(r + tick) % RAINBOW_RGB.length] ?? rgbOf(view.color)) : rgbOf(view.color)
    putRow(base + 1 + r, line, rowColor, r < 2 ? headDx : 0)
  }
  if (sparkle) {
    // Two sparks in the air row, swapping sides each downbeat.
    const flip = Math.floor(beatIndex / 2) % 2 === 0
    for (const [x, ch] of [[flip ? 2 : 13, '*'], [flip ? 12 : 3, '.']] as const) {
      const i = x * 3
      words[i] = ch.codePointAt(0) ?? 0x20
      words[i + 1] = 0xf2f7a1
    }
  }
  return packCells(words)
}
