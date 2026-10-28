// The cups tracker: coffee, tea and water per local day, a daily water goal, and
// the last seven days, kept in the store so every session counts into one tally.

import { atom, read, update } from 'claude-code'

import type { DrinkDay, DrinkKind, Drinks } from '../types'
import { isRecord, num } from './shared'
import type { $ } from './shared'

const drinks = atom({ plugin: 'buddy', key: 'drinks' } as const, null, { shape: 'drk-1' })

/** Reads `drinks` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function drinksOf($: $) {
  return read($, drinks)
}

// The cups logged in this session, newest last, so the last one can be taken back.
let drinkLog: { kind: DrinkKind; day: string }[] = []

// -- cups -----------------------------------------------------------------------

const DRINK_KINDS: readonly DrinkKind[] = ['coffee', 'tea', 'water']
const WATER_GOAL_DEFAULT = 8
const DRINK_DAYS_KEPT = 120
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
type DrinkStore = Record<string, { coffee?: number; tea?: number; water?: number }>

const pad2 = (n: number) => String(n).padStart(2, '0')

/** A local day's key: `2026-10-28`. */
function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Noon of the local day `back` days before the one `at` falls on, so a clock change never skips a day. */
function dayBefore(at: number, back: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12).getTime()
}

async function readDrinkStore($: $): Promise<DrinkStore> {
  const stored = await $.store.get('soundtrack:drinks')
  return isRecord(stored) ? (stored as DrinkStore) : {}
}

function dayOf(store: DrinkStore, day: string): DrinkDay {
  const one = store[day] ?? {}
  return { day, coffee: num(one.coffee) ?? 0, tea: num(one.tea) ?? 0, water: num(one.water) ?? 0 }
}

async function waterGoal($: $): Promise<number> {
  const stored = await $.store.get('soundtrack:waterGoal')
  return typeof stored === 'number' && stored >= 1 && stored <= 40 ? Math.round(stored) : WATER_GOAL_DEFAULT
}

/** Publishes today and the six days before it from the store, for the pane. */
async function publishDrinks($: $, now: number) {
  const store = await readDrinkStore($)
  const week: DrinkDay[] = []
  for (let back = 6; back >= 0; back--) week.push(dayOf(store, dayKey(dayBefore(now, back))))
  const today = week[week.length - 1] ?? dayOf(store, dayKey(now))
  const next: Drinks = { today, week, waterGoal: await waterGoal($) }
  await update($, drinks, () => next)
}

/** Loads the cups tracker at session start. */
export async function loadDrinks($: $) {
  await publishDrinks($, await $.clock.now())
}

/**
 * Adds `n` cups of one kind to today (a negative `n` takes some back). The
 * store is read again just before the write, so two sessions both count.
 */
export async function addDrink($: $, kind: DrinkKind, n = 1): Promise<DrinkDay> {
  const now = await $.clock.now()
  const day = dayKey(now)
  const store = await readDrinkStore($)
  const had = dayOf(store, day)
  const next: DrinkDay = { ...had, [kind]: Math.max(0, had[kind] + n) }
  const oldest = dayKey(dayBefore(now, DRINK_DAYS_KEPT))
  const kept: DrinkStore = {}
  for (const [key, value] of Object.entries(store)) if (key >= oldest && key !== day) kept[key] = value
  kept[day] = { coffee: next.coffee, tea: next.tea, water: next.water }
  await $.store.set('soundtrack:drinks', kept)
  for (let i = 0; i < n; i++) drinkLog.push({ kind, day })
  await publishDrinks($, now)
  const goal = await waterGoal($)
  if (kind === 'water' && had.water < goal && next.water >= goal) $.ui.toast(`Water goal reached: ${next.water} glasses today.`)
  return next
}

/** Takes back the last cup logged in this session, while it is still today. */
async function undoDrink($: $): Promise<string> {
  const day = dayKey(await $.clock.now())
  const last = drinkLog[drinkLog.length - 1]
  if (!last || last.day !== day) return 'Nothing logged in this session today to take back. "/soundtrack drink water -1" takes one off by hand.'
  drinkLog.pop()
  const left = await addDrink($, last.kind, -1)
  return `Took back one ${last.kind}: ${cupsLine(left, await waterGoal($))}.`
}

function cupsLine(d: DrinkDay, goal: number): string {
  return `coffee ${d.coffee} · tea ${d.tea} · water ${d.water}/${goal}`
}

/** The last seven days, one line each, and the daily averages over them. */
export async function drinksReport($: $): Promise<string> {
  const now = await $.clock.now()
  await publishDrinks($, now)
  const held = await read($, drinks)
  if (held === null) return 'No cups logged yet.'
  const lines = held.week
    .slice()
    .reverse()
    .map(one => {
      const at = new Date(`${one.day}T12:00:00`)
      return `${WEEKDAYS[at.getDay()] ?? ''} ${one.day.slice(8)}/${one.day.slice(5, 7)}  coffee ${one.coffee}  tea ${one.tea}  water ${one.water}`
    })
  const avg = (kind: DrinkKind) => (held.week.reduce((sum, one) => sum + one[kind], 0) / held.week.length).toFixed(1)
  return [
    `Today: ${cupsLine(held.today, held.waterGoal)}.`,
    `Seven-day average: coffee ${avg('coffee')} · tea ${avg('tea')} · water ${avg('water')} a day.`,
    ...lines,
    '"/soundtrack drink coffee|tea|water [n]" logs, "/soundtrack drink undo" takes the last back, "/soundtrack drink goal 8" sets the water goal.',
  ].join('\n')
}

/** `/soundtrack drink <kind> [n] | undo | goal <n>`, and `/soundtrack drinks` for the week. */
export async function drinkCommand($: $, args: string): Promise<string> {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const verb = words[0] ?? ''
  if (verb === '' || verb === 'week' || verb === 'report') return drinksReport($)
  if (verb === 'undo') return undoDrink($)
  if (verb === 'goal') {
    const n = Number(words[1])
    if (!Number.isInteger(n) || n < 1 || n > 40) return `Water goal: ${await waterGoal($)} glasses a day. "/soundtrack drink goal 8" changes it.`
    await $.store.set('soundtrack:waterGoal', n)
    await publishDrinks($, await $.clock.now())
    return `Water goal: ${n} glasses a day.`
  }
  const kind = DRINK_KINDS.find(one => one === verb || (one === 'coffee' && /^(koffie|espresso|cappuccino|latte)$/.test(verb)) || (one === 'tea' && verb === 'thee') || (one === 'water' && /^(glass|h2o)$/.test(verb)))
  if (!kind) return `Log a cup: /soundtrack drink coffee, /soundtrack drink tea, /soundtrack drink water. Also: "drink water 2", "drink coffee -1", "drink undo", "drink goal 8", "drinks".`
  const n = words[1] === undefined ? 1 : Number(words[1])
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 20) return `How many? "/soundtrack drink ${kind} 2" logs two, "/soundtrack drink ${kind} -1" takes one back.`
  const day = await addDrink($, kind, n)
  return `${n > 0 ? 'Logged' : 'Took back'} ${Math.abs(n)} ${kind}${Math.abs(n) === 1 ? '' : 's'}. Today: ${cupsLine(day, await waterGoal($))}.`
}
