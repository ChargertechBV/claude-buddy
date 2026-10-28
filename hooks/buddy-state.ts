// The pet's shared ground: the types, timings and defaults every pet file uses,
// the session's picture of the pet, and small helpers.

import type { EngineInterface } from 'claude-code'

import type { VisitorKind } from '../types'
import type { Bones, Stat } from './art'
import type { Moment } from './calendar'

export type Engine = EngineInterface
export type PetRecord = {
  id: string
  seed: number
  name: string
  personality: string
  hatchedAt: number
  hat?: string
  eye?: string
  sword?: true
  extras?: string[]
  isShiny?: true
  isWild?: true
}
export type Judging = 'off' | 'sometimes' | 'always'
export type Prefs = {
  isMuted: boolean
  isCompact: boolean
  isHidden: boolean
  isSmart: boolean
  judge: Judging
  hasNews: boolean
  hasSound: boolean
  hasVoice: boolean
}
export type Drift = Record<Stat, number>
type Facts = {
  prompts: number
  tools: number
  fails: number
  commits: number
  greens: number
  bugsEaten: number
  battles: number
  visits: number
  news: number
  pets: number
  longestTurnMs: number
  grades: string[]
}
export type Guest = { record: PetRecord; kind: VisitorKind; until: number }

export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
export const HUNGRY_BELOW = 20
export const QUIET_FOR = 20 * SECOND
export const MAX_PETS = 10
export const MODEL = 'haiku'
export const HOUSE = 'buddy-house'
export const GAME = 'buddy-game'

type Key = 'pet' | 'xp' | 'care' | 'seen' | 'drift' | 'record' | 'bugs' | 'high'
export const key = (kind: Key, id: string) => `${kind}:${id}`

export const DEFAULT_PREFS: Prefs = {
  isMuted: false,
  isCompact: false,
  isHidden: true, // the pet lives in the Soundtrack pane; /buddy show brings the band back
  isSmart: true,
  judge: 'sometimes',
  hasNews: true,
  hasSound: true,
  hasVoice: false,
}

export const zeroDrift = (): Drift => ({ DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 })
export const freshFacts = (): Facts => ({
  prompts: 0,
  tools: 0,
  fails: 0,
  commits: 0,
  greens: 0,
  bugsEaten: 0,
  battles: 0,
  visits: 0,
  news: 0,
  pets: 0,
  longestTurnMs: 0,
  grades: [],
})

// The session's own picture of the pet: rebuilt from $.store at every load.
// Each pet's values live under their own keys (`xp:<id>`, `care:<id>`, ...),
// so two sessions with two pets never write over each other.
/** The session's picture of the pet, shared by the pet's files. Module values start over on a reload; what must survive one lives in $.state and $.store. */
export const buddy: {
  collection: PetRecord[]
  pet: PetRecord | null
  bones: Bones | null
  xp: number
  drift: Drift
  prefs: Prefs
  isHatching: boolean
  bubble: string | null
  bubbleId: number
  lastSaidAt: number
  bugs: number
  visitor: Guest | null
  isFighting: boolean
  anxiety: number
  moments: Moment[]
  facts: Facts
  lastActivity: number
  isAsleep: boolean
  failStreak: number
  excitedUntil: number
  lastNewsAt: number
  lastSpokeAt: number
  owned: string[]
  coinsSpent: number
  sessionStartedAt: number
  lastPrompt: string
  turnTools: { tool: string; isFailed: boolean }[]
} = {
  collection: [],
  pet: null,
  bones: null,
  xp: 0,
  drift: zeroDrift(),
  prefs: DEFAULT_PREFS,
  isHatching: false,
  bubble: null,
  bubbleId: 0,
  lastSaidAt: 0,
  bugs: 0,
  visitor: null,
  isFighting: false,
  anxiety: 0,
  moments: [],
  facts: freshFacts(),
  lastActivity: 0,
  isAsleep: false,
  failStreak: 0,
  excitedUntil: 0,
  lastNewsAt: 0,
  lastSpokeAt: 0,
  owned: [],
  coinsSpent: 0,
  sessionStartedAt: 0,
  lastPrompt: '',
  turnTools: [],
}

export function randomSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  } catch {
    return Math.floor(Math.random() * 2 ** 32)
  }
}

export function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '…'
}

export const pad2 = (n: number): string => String(n).padStart(2, '0')

export function localDate(at: number): string {
  const d = new Date(at)
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`
}
