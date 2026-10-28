import { expect, test } from 'claude-code/testing'

import { frameDelay } from '../hooks/eq'
import { DEPTH, EQ_ROWS, PALETTES, VIEWS, barsFor, sliceWidth, stripCells, stripRows } from '../hooks/strip'

const COLUMNS = 58
const LEVELS = EQ_ROWS * 8

/** Raster cells are `columns * rows` triplets of u32, base64: the string's byte length tells the shape. */
function cellCount(cells: string): number {
  const padding = cells.endsWith('==') ? 2 : cells.endsWith('=') ? 1 : 0
  return ((cells.length / 4) * 3 - padding) / 12
}

test('every view draws a strip of its own height, with and without progress and a beat', async () => {
  const heights = Array.from({ length: COLUMNS * 2 }, (_, i) => (i % 7) * 9)
  const slices = Array.from({ length: DEPTH }, (_, t) => Array.from({ length: sliceWidth(COLUMNS) }, (_, x) => ((x + t) % 9) * 7))
  for (const view of VIEWS) {
    const bars = barsFor(COLUMNS, view, 2)
    const own = heights.slice(0, bars)
    const quiet = stripCells(own, 2, 'rainbow', view, slices, null, null)
    expect(cellCount(quiet)).toBe(COLUMNS * stripRows(view))
    const playing = stripCells(own, 2, 'rainbow', view, slices, { pos: 61_000, total: 191_000, isPlaying: true }, { phase: 0.05, count: 6 })
    expect(cellCount(playing)).toBe(COLUMNS * stripRows(view))
    expect(playing).not.toBe(quiet)
  }
})

test('every palette colours the bars, at one and two bars per cell', async () => {
  for (const palette of PALETTES) {
    for (const density of [1, 2]) {
      const bars = barsFor(COLUMNS, 'bars', density)
      const heights = Array.from({ length: bars }, (_, i) => (i * 13) % LEVELS)
      const cells = stripCells(heights, density, palette, 'bars', [], null, null)
      expect(cellCount(cells)).toBe(COLUMNS * stripRows('bars'))
    }
  }
})

test('the 3D and ridge views take fewer bars than columns and leave the recession free', async () => {
  expect(barsFor(COLUMNS, '3d', 2)).toBe(COLUMNS)
  expect(barsFor(COLUMNS, 'ridge', 2)).toBe(COLUMNS)
  expect(sliceWidth(COLUMNS)).toBe(COLUMNS - DEPTH)
  expect(stripRows('3d')).toBe(stripRows('bars') + DEPTH / 2)
  expect(stripRows('ridge')).toBe(stripRows('3d'))
})

test('the frame loop runs at full rate with live audio, smoothly while guessing or settling, and slowly at rest', () => {
  expect(frameDelay({ isShown: true, isLive: true, isGuessing: false, isSettling: false })).toBe(16)
  expect(frameDelay({ isShown: true, isLive: false, isGuessing: true, isSettling: false })).toBe(33)
  expect(frameDelay({ isShown: true, isLive: false, isGuessing: false, isSettling: true })).toBe(33)
  expect(frameDelay({ isShown: true, isLive: false, isGuessing: false, isSettling: false })).toBe(250)
  expect(frameDelay({ isShown: false, isLive: true, isGuessing: false, isSettling: false })).toBe(1000)
})
