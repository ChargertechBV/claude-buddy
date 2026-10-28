// What every Soundtrack file shares: the engine's type, the pane's ids, the
// session's folder and home, small helpers, and the status line under the pane.

import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface } from 'claude-code'

import type { NowPlaying } from '../types'

export type $ = CoreEngineInterface

export const PANE = 'soundtrack'
export const EQ_KEY = 'eq'
export const PET_KEY = 'pet'
const status = atom({ plugin: 'buddy', key: 'status' } as const, null)

/** Reads `status` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function statusOf($: $) {
  return read($, status)
}

// ---------------------------------------------------------------- helpers --

export function parse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

export function num(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

/** hh:mm, with the date in front when it is not today. */
export function clock(at: number, now: number): string {
  const d = new Date(at)
  const n = new Date(now)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return sameDay ? hhmm : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hhmm}`
}

export function fit(text: string, width: number): string {
  if (width <= 1) return ''
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…'
}

export function shortCwd(cwd: string): string {
  return cwd.replace(/^\/home\/[^/]+/, '~')
}

/** Where the needle is now: the polled position plus the time since, while playing. */
export function positionOf(np: NowPlaying, now: number): number | null {
  if (np.progressMs === null) return null
  const pos = np.isPlaying ? np.progressMs + (now - np.fetchedAt) : np.progressMs
  return np.durationMs !== null ? Math.min(np.durationMs, Math.max(0, pos)) : Math.max(0, pos)
}

// ------------------------------------------------------------- module state --

/**
 * The session's folder, home and start time, set at session start and read by
 * every Soundtrack file. Module values start over on a reload; everything the
 * pane draws lives in atoms.
 */
export const ctx: {
  cwd: string
  home: string
  startedAt: number
} = {
  cwd: '/',
  home: '',
  startedAt: 0,
}

/** Puts a line under the pane for eight seconds; null clears it. */
export async function say($: $, text: string | null) {
  await update($, status, () => text)
  if (text !== null) {
    $.clock.after(8000, () => {
      void read($, status).then(current => {
        if (current === text) void update($, status, () => null)
      })
    })
  }
}
