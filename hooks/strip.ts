// The strip under the track: the equaliser in one of three views, a frequency
// axis, and the progress row with the beat. Pure: cells in, a Raster's cells out.

import type { Beat } from './beat'
import { BLOCKS, DEFAULT_BG, DIM, GREEN, blankCells, dim, hsv, lerpRgb, packCells } from './raster'

/** How often the strip is repainted, in ms: 30 frames a second. */
export const TICK_MS = 16
export const EQ_ROWS = 8
/** Bars per terminal cell in the bars view: 2 splits each cell into half-bars with quadrant blocks, 1 keeps eighth-row steps. */
export const DENSITY_DEFAULT = 2
// The 3D and ridge views: this many time slices recede up and to the right, two slices per row, one column each.
export const DEPTH = 16
const DEPTH_ROWS = DEPTH / 2
/** Ticks between depth slices in the 3D and ridge views: at 3 a slice every 48 ms, so the surface holds 0.8 s. `/soundtrack slices N` changes it. */
export const SLICE_EVERY_DEFAULT = 3
export const SLICE_EVERY_MAX = 12
export let sliceEvery = SLICE_EVERY_DEFAULT
export function setSliceEvery(n: number) {
  sliceEvery = Math.max(1, Math.min(SLICE_EVERY_MAX, Math.round(n)))
}
/** How long the depth axis spans at the current slice rate, in seconds. */
export function depthSeconds(): number {
  return (DEPTH * sliceEvery * TICK_MS) / 1000
}
export const VIEWS = ['bars', '3d', 'ridge'] as const
export type EqView = (typeof VIEWS)[number]
export const PALETTES = ['rainbow', 'green', 'fire', 'vu', 'vertical'] as const
export type Palette = (typeof PALETTES)[number]
export type Progress = { pos: number; total: number; isPlaying: boolean }

const AXIS_LOW_HZ = 40
const AXIS_HIGH_HZ = 16000
const AXIS_LABELS: [number, string][] = [[60, '60'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']]
// Two half-bars in one cell: index = left * 3 + right, each 0 empty, 1 lower half, 2 full.
const QUADS = [0x20, 0x2597, 0x2590, 0x2596, 0x2584, 0x259f, 0x258c, 0x2599, 0x2588]
/** How many dot rows under the ridge view's front line the bar takes to fade into its own shade: two cell rows. */
const FADE_DOTS = 8
const SURFACE_BODY_FLOOR = 0x0d3b2e // the darkest a 3D bar's body gets, still green

/** m:ss from milliseconds. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Rows the strip takes in a view: the bar area, the axis, the progress row. */
export function stripRows(view: EqView): number {
  return (view === 'bars' ? EQ_ROWS : EQ_ROWS + DEPTH_ROWS) + 2
}

/** Bars the strip holds in a view for a width: the 3D and ridge views take one per column. */
export function barsFor(columns: number, view: EqView, density: number): number {
  return columns * (view === 'bars' ? density : 1)
}

/** The columns a slice spans in the 3D and ridge views: the rest of the width is the recession. */
export function sliceWidth(columns: number): number {
  return Math.max(8, columns - DEPTH)
}

/** The column a frequency falls on, the bands being log-spaced across the width. */
function columnOf(hz: number, columns: number): number {
  const t = Math.log(hz / AXIS_LOW_HZ) / Math.log(AXIS_HIGH_HZ / AXIS_LOW_HZ)
  return Math.round(t * (columns - 1))
}

/** How much of a row a bar fills, as the quadrant blocks can show it: 0, half or full. */
function halfSteps(inRow: number): number {
  return inRow >= 6 ? 2 : inRow >= 2 ? 1 : 0
}

/**
 * One cell's colour in the bars view. `level` is the height the cell sits at,
 * `x` the bar's place across the spectrum (0 bass .. 1 treble). `green` is
 * Spotify green into white-hot at the peak; `rainbow` sweeps red through violet
 * by frequency, brighter towards the top; `fire` runs dark red, orange, yellow,
 * white by height; `vu` is a meter, green through yellow to red by height;
 * `vertical` is the rainbow laid on its side, violet at the floor to red at the peak.
 */
function barColor(level: number, levels: number, x: number, palette: Palette): number {
  const t = Math.max(0, Math.min(1, level / levels))
  if (palette === 'green') return t < 0.6 ? GREEN : t < 0.85 ? 0x9be15d : 0xf2f7a1
  if (palette === 'fire') return t < 0.35 ? hsv(0 + t * 40, 1, 0.55 + t) : t < 0.7 ? hsv(14 + (t - 0.35) * 70, 1, 1) : t < 0.9 ? hsv(45 + (t - 0.7) * 50, 0.9 - (t - 0.7), 1) : hsv(55, 0.15, 1)
  if (palette === 'vu') return t < 0.6 ? hsv(120 - (t / 0.6) * 60, 0.9, 0.85) : t < 0.85 ? hsv(60 - ((t - 0.6) / 0.25) * 35, 1, 1) : hsv(0 + (1 - t) * 20, 1, 1)
  if (palette === 'vertical') return hsv(270 - t * 270, 0.85, 0.6 + 0.4 * t)
  const hue = (1 - x) * 300 // red at the bass end, violet at the treble end
  return hsv(hue, t > 0.95 ? 0.5 : 0.9, 0.55 + 0.45 * Math.min(1, t * 1.2))
}

/**
 * Colour for a point on the 3D and ridge views. Frequency `x` (0 bass .. 1
 * treble) picks the hue: amber at the bass end, through green and cyan, to
 * violet at the treble end. Depth (0 front .. 1 oldest) drops the brightness,
 * deepens the saturation and drifts the hue a little cooler, so slices stay
 * apart too. Loudness `h` (0..1) lifts a point towards white, most at the front.
 */
function depthColor(h: number, depth: number, x: number): number {
  const hue = 35 + x * 240 + depth * 25
  // Loud is bright, not pale: the hue stays saturated and only the top of a peak goes towards white.
  // A wide range from quiet to loud, since Claude Code draws a Raster in 16 steps per channel.
  // Brightness is loudness alone: an older slice is as bright as it was loud; depth shows in the hue and the layout.
  const value = 0.3 + 0.7 * Math.sqrt(h)
  const peak = Math.max(0, h - 0.85) / 0.15
  const sat = 0.9 * (1 - peak * 0.45 * (1 - depth))
  const color = hsv(hue % 360, Math.max(0.05, Math.min(1, sat)), Math.min(1, value + peak * 0.1))
  // Age shows as colour strength: an older slice fades towards a grey as bright as its own colour looks,
  // so it keeps the brightness it was loud at without turning pale.
  const lum = Math.round(0.2126 * ((color >> 16) & 255) + 0.7152 * ((color >> 8) & 255) + 0.0722 * (color & 255))
  return lerpRgb(color, (lum << 16) | (lum << 8) | lum, depth * 0.75)
}

/** A 3D bar's body: a dark, rich version of its crest, a third of the way up from the floor. */
function bodyOf(crest: number): number {
  return lerpRgb(SURFACE_BODY_FLOOR, crest, 0.3)
}

/**
 * The strip's cells. `heights` holds the bars in eighths of a row: `columns *
 * density` of them in the bars view, one per column otherwise. `slices` holds
 * the recent history for the 3D and ridge views, newest first, each as wide as
 * `sliceWidth(columns)`. Below the view sit the frequency axis and the progress
 * row, with the beat pulse and four-count when `beat` is known.
 */
export function stripCells(
  heights: number[],
  density: number,
  palette: Palette,
  view: EqView,
  slices: number[][],
  progress: Progress | null,
  beat: Beat | null,
): string {
  const columns = view === 'bars' ? Math.max(1, Math.floor(heights.length / density)) : Math.max(1, heights.length)
  const area = view === 'bars' ? EQ_ROWS : EQ_ROWS + DEPTH_ROWS
  const rows = area + 2
  const words = blankCells(columns, rows)
  const levels = EQ_ROWS * 8
  const putAt = (row: number, col: number, ch: string, fg: number, bg: number = DEFAULT_BG) => {
    if (col < 0 || col >= columns || row < 0 || row >= rows) return
    const i = (row * columns + col) * 3
    words[i] = ch.codePointAt(0) ?? 0x20
    words[i + 1] = fg
    words[i + 2] = bg
  }
  const across = view === 'bars' ? columns : sliceWidth(columns)

  if (view === 'ridge') drawRidge(words, columns, area, across, slices, levels)
  else if (view === '3d') drawSurface(words, columns, rows, area, across, slices, levels, putAt)
  else drawBars(words, columns, density, palette, heights, levels)

  // Axis row: the labels under their frequencies; no rule, so the axis stays quiet.
  const axisRow = area
  if (view !== 'bars') {
    const label = `<- ${depthSeconds().toFixed(1)}s`
    for (let k = 0; k < label.length; k++) putAt(axisRow, across + 2 + k, label.charAt(k), 0x6c6c6c)
  }
  let lastEnd = -3
  for (const [hz, label] of AXIS_LABELS) {
    const at = columnOf(hz, across)
    const start = Math.max(0, Math.min(across - label.length, at - Math.floor(label.length / 2)))
    if (start <= lastEnd + 2) continue
    for (let k = 0; k < label.length; k++) putAt(axisRow, start + k, label.charAt(k), 0x8a8a8a)
    lastEnd = start + label.length - 1
  }

  // Progress row: "> 1:23 ━━━━──── 3:12", or "|| 1:23 ..." paused, or a dim rule.
  const put = (col: number, ch: string, fg: number) => putAt(area + 1, col, ch, fg)
  if (progress === null) {
    for (let col = 0; col < columns; col++) put(col, '─', DIM)
  } else {
    const left = `${progress.isPlaying ? '> ' : '||'} ${mmss(progress.pos)} `
    const right = ` ${mmss(progress.total)}`
    // The beat: a pulse that flashes on the kick and fades, then a four-count.
    const beatWidth = beat !== null && columns >= 40 ? 7 : 0
    const barWidth = columns - left.length - right.length - beatWidth
    for (let k = 0; k < left.length; k++) put(k, left.charAt(k), progress.isPlaying ? GREEN : DIM)
    if (barWidth > 0) {
      const filled = progress.total > 0 ? Math.round((progress.pos / progress.total) * barWidth) : 0
      for (let k = 0; k < barWidth; k++) put(left.length + k, k < filled ? '━' : '─', k < filled ? GREEN : DIM)
    }
    const rightAt = left.length + Math.max(0, barWidth)
    for (let k = 0; k < right.length; k++) put(rightAt + k, right.charAt(k), DIM)
    if (beat !== null && beatWidth > 0) {
      const at = rightAt + right.length + 1
      const glow = beat.phase < 0.12 ? ['█', 0xffffff] : beat.phase < 0.35 ? ['▓', 0xf2f7a1] : beat.phase < 0.65 ? ['▒', 0x9be15d] : ['░', 0x4a7a4a]
      put(at, String(glow[0]), Number(glow[1]))
      const four = beat.count % 4
      for (let k = 0; k < 4; k++) put(at + 2 + k, k === four ? '█' : '▁', k === four ? GREEN : DIM)
    }
  }
  return packCells(words)
}

/** The bars view: one bar per column, or two half-bars per cell with quadrant blocks. */
function drawBars(words: Uint32Array, columns: number, density: number, palette: Palette, heights: number[], levels: number) {
  for (let row = 0; row < EQ_ROWS; row++) {
    const rowBase = (EQ_ROWS - 1 - row) * 8
    for (let col = 0; col < columns; col++) {
      const i = (row * columns + col) * 3
      const x = col / Math.max(1, columns - 1)
      if (density >= 2) {
        const hl = Math.max(0, Math.min(levels, Math.round(heights[col * 2] ?? 0)))
        const hr = Math.max(0, Math.min(levels, Math.round(heights[col * 2 + 1] ?? 0)))
        const left = halfSteps(Math.max(0, Math.min(8, hl - rowBase)))
        const right = halfSteps(Math.max(0, Math.min(8, hr - rowBase)))
        words[i] = QUADS[left * 3 + right] ?? 0x20
        const top = Math.max(left, right)
        words[i + 1] = top === 0 ? DEFAULT_BG : barColor(rowBase + top * 4, levels, x, palette)
      } else {
        const h = Math.max(0, Math.min(levels, Math.round(heights[col] ?? 0)))
        const inRow = Math.max(0, Math.min(8, h - rowBase))
        words[i] = BLOCKS[inRow] ?? 0x20
        words[i + 1] = inRow === 0 ? DEFAULT_BG : barColor(rowBase + inRow, levels, x, palette)
      }
    }
  }
}

/**
 * The 3D view: a surface of block bars, the newest slice in front at the bottom
 * left and older ones receding up and to the right, one column and half a row
 * per slice. Painted back to front so the near slices stand in front. Heights
 * in half rows: a body of dark, hued cells with a crisp half-row crest flush on
 * top; a bar's full cells carry their colour as background too, so a crest in
 * the lower half of a cell shows what lies behind it in the upper half.
 */
function drawSurface(
  words: Uint32Array,
  columns: number,
  rows: number,
  area: number,
  across: number,
  slices: number[][],
  levels: number,
  putAt: (row: number, col: number, ch: string, fg: number, bg?: number) => void,
) {
  const surfaceOf = (row: number, col: number): number => {
    if (col < 0 || col >= columns || row < 0 || row >= rows) return DEFAULT_BG
    const i = (row * columns + col) * 3
    return words[i] === 0x2588 ? (words[i + 1] ?? DEFAULT_BG) : (words[i + 2] ?? DEFAULT_BG)
  }
  for (let t = Math.min(DEPTH, slices.length) - 1; t >= 0; t--) {
    const slice = slices[t] ?? []
    const depth = t / Math.max(1, DEPTH - 1)
    const baseRow = area - 1 - Math.floor(t / 2)
    for (let x = 0; x < across; x++) {
      const h = Math.max(0, Math.min(levels, Math.round(slice[x] ?? 0)))
      if (h === 0) continue
      const column = x % 2 === 1 ? 0.86 : 1 // odd columns a shade darker, to tell bands apart
      const tone = depthColor(h / levels, depth, x / Math.max(1, across - 1))
      const crest = dim(tone, column)
      const body = dim(bodyOf(tone), column)
      const col = x + t
      const halves = Math.max(1, Math.round(h / 4))
      const fullRows = Math.floor(halves / 2)
      for (let k = 0; k < fullRows; k++) putAt(baseRow - k, col, '█', body, body)
      if (halves % 2 === 1) putAt(baseRow - fullRows, col, '▄', crest, surfaceOf(baseRow - fullRows, col))
      else if (fullRows > 0) putAt(baseRow - fullRows + 1, col, '▀', crest, body)
    }
  }
}

/**
 * The ridge view: the bar area as a bitmap of 2x4 braille dots per cell. Each
 * slice is one connected dot-thick contour; drawn back to front, a slice first
 * clears every dot beneath its contour, so nearer ridges hide what lies behind
 * them. The front slice is filled from the ground up to its contour, in a
 * darker shade, so the live spectrum reads as bars with a bright edge. A cell
 * takes the colour of the last slice that set a dot in it, the nearest.
 */
function drawRidge(words: Uint32Array, columns: number, area: number, across: number, slices: number[][], levels: number) {
  const dotsW = columns * 2
  const dotsH = area * 4
  const bits = new Uint8Array(columns * area)
  const tint = new Uint32Array(columns * area)
  const BIT = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]] as const
  const cellOf = (x: number, y: number) => (y >> 2) * columns + (x >> 1)
  const bitOf = (x: number, y: number) => BIT[x & 1]?.[y & 3] ?? 0
  const setDot = (x: number, y: number, color: number) => {
    if (x < 0 || x >= dotsW || y < 0 || y >= dotsH) return
    const c = cellOf(x, y)
    bits[c] = (bits[c] ?? 0) | bitOf(x, y)
    tint[c] = color
  }
  const clearDot = (x: number, y: number) => {
    if (x < 0 || x >= dotsW || y < 0 || y >= dotsH) return
    const c = cellOf(x, y)
    bits[c] = (bits[c] ?? 0) & ~bitOf(x, y)
  }
  const line = (x0: number, y0: number, x1: number, y1: number, color: number) => {
    // Bresenham: every dot between the two points.
    let x = x0
    let y = y0
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (let guard = 0; guard < 4096; guard++) {
      setDot(x, y, color)
      if (x === x1 && y === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }
  const heightDots = EQ_ROWS * 4
  for (let t = Math.min(DEPTH, slices.length) - 1; t >= 0; t--) {
    const slice = slices[t] ?? []
    const depth = t / Math.max(1, DEPTH - 1)
    const baseDot = dotsH - 1 - t * 2 // the slice's ground line, in dots from the top
    const xShift = t * 2
    // The contour: one point per dot column across the front width, the odd columns interpolated between neighbouring bands.
    const pts: { x: number; y: number; h: number }[] = []
    for (let x = 0; x < across * 2; x++) {
      const i = Math.min(across - 1, Math.floor(x / 2))
      const a = (slice[i] ?? 0) / levels
      const b = (slice[Math.min(across - 1, i + 1)] ?? 0) / levels
      const h = x % 2 === 0 ? a : (a + b) / 2
      pts.push({ x: x + xShift, y: baseDot - Math.round(h * (heightDots - 1)), h })
    }
    // Occlusion first: the ground under this ridge hides everything behind it.
    for (const pt of pts) for (let y = pt.y + 1; y <= baseDot; y++) clearDot(pt.x, y)
    // The front slice is a bar up to its contour, in the body shade; the contour drawn after takes the cells it touches.
    if (t === 0) {
      for (const pt of pts) {
        // Darker than the line, and darker still where it is quiet, so loudness reads in the body too.
        const top = depthColor(pt.h, 0, (pt.x - xShift) / Math.max(1, across * 2 - 1))
        const body = dim(top, 0.3 + 0.35 * pt.h)
        // Under the line the bar fades from the line's colour into its own over two cell rows, so the edge is soft.
        for (let y = pt.y + 1; y <= baseDot; y++) setDot(pt.x, y, lerpRgb(top, body, Math.min(1, (y - pt.y) / FADE_DOTS)))
      }
    }
    // Then the contour, a continuous line through the points.
    for (let k = 0; k < pts.length; k++) {
      const pt = pts[k]
      if (!pt) continue
      const color = depthColor(pt.h, depth, (pt.x - xShift) / Math.max(1, across * 2 - 1))
      const prev = pts[k - 1]
      if (prev) line(prev.x, prev.y, pt.x, pt.y, color)
      else setDot(pt.x, pt.y, color)
    }
  }
  for (let c = 0; c < bits.length; c++) {
    const b = bits[c] ?? 0
    if (b === 0) continue
    const i = c * 3
    words[i] = 0x2800 + b
    words[i + 1] = tint[c] ?? DIM
    words[i + 2] = DEFAULT_BG
  }
}
