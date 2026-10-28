// The pet's life: loading the collection, hatching and choosing a pet, the view
// the band and the pane draw, care, levels, stats, hats and achievements.

import { atom, read, update } from 'claude-code'

import type { BuddyView, Mood, Visitor } from '../types'
import { EGG, EXTRA_HATS, HATS, NAMES, PARTY_HAT, RARITIES, SPECIES, STAGE_NAMES, STATS, roll } from './art'
import type { Bones, Stat } from './art'
import { badgeOf } from './badges'
import { momentsAt } from './calendar'
import type { Moment } from './calendar'
import { itemOf } from './shop'
import { checkMoments, wake } from './buddy-loop'
import { readNote } from './buddy-social'
import { DAY, DEFAULT_PREFS, HOUR, HUNGRY_BELOW, MAX_PETS, MINUTE, MODEL, SECOND, asObject, buddy, freshFacts, key, randomSeed, zeroDrift } from './buddy-state'
import type { Drift, Engine, Guest, PetRecord, Prefs } from './buddy-state'
import { pickLine, play, quip, say } from './buddy-voice'
import { completeQuest, publishHouse } from './buddy-world'

const view = atom({ plugin: 'buddy', key: 'view' } as const, null)

/** Reads `view` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function viewOf($: Engine) {
  return read($, view)
}
const isHidden = atom({ plugin: 'buddy', key: 'isHidden' } as const, false)

/** Reads `isHidden` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function isHiddenOf($: Engine) {
  return read($, isHidden)
}
// The session's pet: held in $.state, so a hot reload keeps it.
const activeId = atom({ plugin: 'buddy', key: 'activeId' } as const, null)
type Care = { fedAt: number; pettedAt: number }
type Tally = {
  sessions: number
  commits: number
  greens: number
  addressed: number
  bugsEaten: number
  battlesWon: number
  reviews: number
  shinies: number
  quests: number
  games: number
}
const STARVES_IN = 6 * HOUR
const zeroTally = (): Tally => ({ sessions: 0, commits: 0, greens: 0, addressed: 0, bugsEaten: 0, battlesWon: 0, reviews: 0, shinies: 0, quests: 0, games: 0 })
let care: Care = { fedAt: 0, pettedAt: 0 }
let hearts = 0
// What the soundtrack mod hears, when it is loaded: a beat to bob to, and the track for a remark.
let musicBeatMs: number | null = null
let musicTrack: string | null = null
let lastPetXpAt = 0
let lastPublished = ''

// Loading and hatching

export async function load($: Engine): Promise<void> {
  buddy.prefs = { ...DEFAULT_PREFS, ...asObject(await $.store.get('prefs')) }
  if (!['off', 'sometimes', 'always'].includes(buddy.prefs.judge)) buddy.prefs = { ...buddy.prefs, judge: DEFAULT_PREFS.judge }
  const ownedStored = await $.store.get('owned')
  buddy.owned = Array.isArray(ownedStored) ? ownedStored.filter((id): id is string => typeof id === 'string') : []
  buddy.coinsSpent = Number(await $.store.get('coinsSpent')) || 0
  const now = await $.clock.now()
  buddy.lastActivity = now
  buddy.sessionStartedAt = now
  buddy.facts = freshFacts()
  await update($, isHidden, () => buddy.prefs.isHidden)

  const migrated = await migrate($, now)
  buddy.collection = await loadCollection($)
  // A reload keeps the session's pet, and so does the load that just moved a
  // single pet into the collection; a new session hatches or draws one.
  const held = (await read($, activeId)) ?? migrated
  const kept = buddy.collection.find(p => p.id === held)
  if (kept !== undefined) return become($, kept, held === migrated)
  if (hatchSlots() > 0) return startHatching($)

  return become($, await draw($), true)
}

export async function petIds($: Engine): Promise<string[]> {
  const ids = await $.store.get('pets')
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

export async function loadCollection($: Engine): Promise<PetRecord[]> {
  const pets: PetRecord[] = []
  for (const id of await petIds($)) {
    const stored = await $.store.get(key('pet', id))
    if (isPetRecord(stored)) pets.push(stored)
  }
  return pets
}

/** Eggs left to hatch: wild shinies you caught take no slot. */
export function hatchSlots(): number {
  return Math.max(0, MAX_PETS - buddy.collection.filter(p => p.isWild !== true).length)
}

// The single pet of earlier versions becomes the collection's first; its old
// keys stay where they were, as a backup. Resolves its id when it moved one.
async function migrate($: Engine, now: number): Promise<string | null> {
  if ((await $.store.get('pets')) !== undefined) return null
  const legacy = asObject(await $.store.get('pet'))
  if (typeof legacy.seed !== 'number' || typeof legacy.name !== 'string') {
    await $.store.set('pets', [])
    return null
  }
  const id = `p${(legacy.seed >>> 0).toString(36)}`
  const oldHat = asObject(await $.store.get('prefs')).hat
  const record: PetRecord = {
    id,
    seed: legacy.seed,
    name: legacy.name,
    personality: typeof legacy.personality === 'string' ? legacy.personality : '',
    hatchedAt: typeof legacy.hatchedAt === 'number' ? legacy.hatchedAt : now,
    ...(typeof oldHat === 'string' ? { hat: oldHat } : {}),
  }
  await $.store.set(key('pet', id), record)
  await $.store.set(key('xp', id), Number(await $.store.get('xp')) || 0)
  const oldCare = await $.store.get('care')
  if (oldCare !== undefined) await $.store.set(key('care', id), oldCare)
  const oldSeen = await $.store.get('lastSeen')
  if (oldSeen !== undefined) await $.store.set(key('seen', id), oldSeen)
  await $.store.set('pets', [id])
  await $.store.set('lastPick', id)

  return id
}

// A random pet from the collection, never the one the last session had.
async function draw($: Engine): Promise<PetRecord> {
  const last = await $.store.get('lastPick')
  const pool = buddy.collection.length > 1 ? buddy.collection.filter(p => p.id !== last) : buddy.collection
  const chosen = pool[Math.floor(Math.random() * pool.length)] ?? buddy.collection[0]!
  await $.store.set('lastPick', chosen.id)
  return chosen
}

export async function become($: Engine, chosen: PetRecord, shouldGreet: boolean): Promise<void> {
  const now = await $.clock.now()
  buddy.pet = chosen
  buddy.bones = bonesOf(chosen)
  buddy.xp = Number((await $.store.get(key('xp', chosen.id))) ?? 0) || 0
  care = { fedAt: now, pettedAt: 0, ...asObject(await $.store.get(key('care', chosen.id))) }
  buddy.drift = { ...zeroDrift(), ...driftOf(await $.store.get(key('drift', chosen.id))) }
  buddy.bubble = null
  hearts = 0
  buddy.bugs = 0
  buddy.visitor = null
  buddy.isFighting = false
  buddy.failStreak = 0
  buddy.isAsleep = false
  buddy.excitedUntil = 0
  buddy.facts.pets = 0
  buddy.moments = momentsAt(now, chosen, buddy.bones.species, Object.keys(SPECIES))
  await update($, activeId, () => chosen.id)
  await publish($)
  await publishHouse($)
  if (!shouldGreet) return

  const lastSeen = Number((await $.store.get(key('seen', chosen.id))) ?? 0)
  const days = lastSeen > 0 ? Math.floor((now - lastSeen) / DAY) : 0
  await $.store.set(key('seen', chosen.id), now)
  await say($, quip(days >= 1 ? 'welcomeBack' : 'greet', { days }), { isForced: true })
  $.clock.after(3 * SECOND, () => void checkMoments($))
  $.clock.after(6 * SECOND, () => void readNote($))
}

export async function startHatching($: Engine): Promise<void> {
  buddy.isHatching = true
  buddy.pet = null
  buddy.bones = null
  buddy.bubble = null
  buddy.visitor = null
  await publish($)
  $.clock.after(2 * SECOND, () => void hatch($))
}

async function hatch($: Engine): Promise<void> {
  // A species the collection lacks, where a few tries find one.
  const owned = new Set(buddy.collection.map(p => roll(p.seed).species))
  let seed = randomSeed()
  for (let tries = 0; tries < 25 && owned.has(roll(seed).species); tries++) seed = randomSeed()
  const rolled = roll(seed)
  const soul = await nameFor($, rolled, seed, buddy.collection.map(p => p.name))
  const now = await $.clock.now()
  const born: PetRecord = { id: `p${seed.toString(36)}`, seed, ...soul, hatchedAt: now }
  await adopt($, born)
  buddy.isHatching = false
  await become($, born, false)
  buddy.excitedUntil = now + 15 * SECOND
  $.clock.after(16 * SECOND, () => void publish($))

  const tier = RARITIES.find(r => r.rarity === rolled.rarity)
  $.ui.toast(
    `🐣 ${born.name} hatched: a ${rolled.isShiny ? 'shiny ' : ''}${rolled.rarity} ${rolled.species} ${tier?.stars ?? ''}. ` +
      `${MAX_PETS - hatchSlots()}/${MAX_PETS} in your collection. Try /buddy pets`,
  )
  await play($, 'pop')
  await say($, `hi! I'm ${born.name} ✨`, { isForced: true, ttl: 12 * SECOND })
  if (hatchSlots() === 0) await award($, 'full-house')
}

/** Writes a new pet into the store and the collection; the list is re-read so two sessions never drop each other's. */
export async function adopt($: Engine, born: PetRecord): Promise<void> {
  const now = await $.clock.now()
  await $.store.set(key('pet', born.id), born)
  await $.store.set(key('care', born.id), { fedAt: now, pettedAt: 0 })
  await $.store.set(key('seen', born.id), now)
  await $.store.set('pets', [...(await petIds($)).filter(id => id !== born.id), born.id])
  await $.store.set('lastPick', born.id)
  buddy.collection = await loadCollection($)
  await publishHouse($)
}

export async function nameFor(
  $: Engine,
  rolled: Bones,
  seed: number,
  taken: string[],
): Promise<{ name: string; personality: string }> {
  const free = NAMES.filter(n => !taken.includes(n))
  const fallback = { name: free[seed % Math.max(1, free.length)] ?? 'Pip', personality: fallbackPersonality(rolled) }
  if (!buddy.prefs.isSmart) return fallback

  const stats = STATS.map(s => `${s} ${rolled.stats[s]}`).join(', ')
  const prompt =
    `A ${rolled.isShiny ? 'shiny ' : ''}${rolled.rarity} ${rolled.species} pet just ${rolled.isShiny ? 'wandered into' : 'hatched in'} a developer's terminal, where it will ` +
    `watch them code. Its stats (0-100): ${stats}. Invent its name (one or two words, at most 12 ` +
    `characters, cute and memorable, not "${rolled.species}"${taken.length > 0 ? ` and none of ${taken.join(', ')}` : ''}) and a one-sentence personality (at most ` +
    `110 characters) shaped by its strongest and weakest stats. Answer with JSON only: ` +
    `{"name": "...", "personality": "..."}`
  try {
    const reply = await $.model.complete({ model: MODEL, prompt, maxTokens: 600, effort: 'low', timeoutMs: 15 * SECOND })
    if (!reply.isAnswered) return fallback
    const json = reply.text.match(/\{[\s\S]*\}/)?.[0]
    const parsed = asObject(json === undefined ? null : JSON.parse(json))
    const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 14) : ''
    const personality = typeof parsed.personality === 'string' ? parsed.personality.trim().slice(0, 160) : ''
    const isTaken = taken.some(t => t.toLowerCase() === name.toLowerCase())

    return name.length > 0 && personality.length > 0 && !isTaken ? { name, personality } : fallback
  } catch {
    return fallback
  }
}

function fallbackPersonality(rolled: Bones): string {
  const [top, low] = ranked(rolled)
  return `A ${rolled.species} heavy on ${top.toLowerCase()} and light on ${low.toLowerCase()}.`
}

/** A record's rolled looks, with what the record itself says on top (a caught shiny is shiny whatever its seed rolled). */
export function bonesOf(record: PetRecord): Bones {
  const rolled = roll(record.seed)
  return record.isShiny === true ? { ...rolled, isShiny: true } : rolled
}

export function stageOf(level: number): number {
  return level >= 20 ? 3 : level >= 10 ? 2 : 1
}

export function speciesLabel(species: string, level: number): string {
  const stage = stageOf(level)
  return stage >= 2 ? `${STAGE_NAMES[stage]} ${species}` : species
}

// What the band draws

export async function publish($: Engine): Promise<void> {
  const now = await $.clock.now()
  const next = buildView(now)
  const text = JSON.stringify(next)
  if (text === lastPublished) return
  lastPublished = text
  await update($, view, () => next)
}

function buildView(now: number): BuddyView | null {
  if (buddy.isHatching) {
    return {
      name: '???',
      species: 'egg',
      rarity: 'common',
      stars: '',
      color: 'subtle',
      isShiny: false,
      eye: ' ',
      hat: '',
      frames: EGG.frames,
      face: EGG.face,
      mood: 'hatching',
      bubble: null,
      bubbleId: buddy.bubbleId,
      hearts,
      level: 0,
      stage: 1,
      visitor: null,
      bugs: 0,
      anxiety: 0,
      isVoid: false,
      flair: '',
      isCompact: buddy.prefs.isCompact,
    }
  }
  if (buddy.pet === null || buddy.bones === null) return null
  const moment = buddy.moments.reduce<Moment>((all, m) => ({ ...all, ...m }), { key: '' })
  const look = SPECIES[moment.species ?? buddy.bones.species] ?? SPECIES.blob!
  const worn = wornHat()
  const hat = moment.hat === 'party' ? PARTY_HAT : hatRow(worn)

  return {
    name: buddy.pet.name,
    species: moment.species ?? buddy.bones.species,
    rarity: buddy.bones.rarity,
    stars: buddy.bones.stars,
    color: buddy.bones.color,
    isShiny: buddy.bones.isShiny,
    eye: moment.eye ?? buddy.pet.eye ?? buddy.bones.eye,
    hat,
    frames: look.frames,
    face: look.face,
    mood: moodAt(now),
    bubble: buddy.bubble,
    bubbleId: buddy.bubbleId,
    hearts,
    level: levelOf(buddy.xp).level,
    stage: stageOf(levelOf(buddy.xp).level),
    visitor: buddy.visitor === null ? null : visitorView(buddy.visitor),
    bugs: buddy.bugs,
    anxiety: buddy.anxiety,
    isVoid: moment.isVoid === true,
    flair: buddy.pet.sword === true ? '⚔ ' : '',
    isCompact: buddy.prefs.isCompact,
    beatMs: musicBeatMs,
  }
}

function visitorView(guest: Guest): Visitor {
  const b = bonesOf(guest.record)
  const look = SPECIES[b.species] ?? SPECIES.blob!
  const worn = hatOf(guest.record, b)
  return {
    name: guest.record.name,
    species: b.species,
    frames: look.frames,
    face: look.face,
    color: b.color,
    eye: guest.record.eye ?? b.eye,
    hat: hatRow(worn),
    isShiny: b.isShiny,
    stage: 1,
    kind: guest.kind,
  }
}

/**
 * Reads the soundtrack mod's music, if that mod is loaded: the pet bobs to the
 * beat, gets excited over heavy bass, and remarks on a new track now and then.
 */
export async function musicTick($: Engine): Promise<void> {
  if (buddy.pet === null || buddy.isHatching) return
  let heard: { isPlaying: boolean; track: string | null; energy: number; isLive: boolean; bassNow: number; bpm: number | null; beatMs: number | null } | null = null
  try {
    const held = await $.state.get({ plugin: 'buddy', key: 'music' })
    heard = held.value && held.value.value ? held.value.value : null
  } catch {
    heard = null // the soundtrack mod is not loaded
  }
  const now = await $.clock.now()
  const beat = heard !== null && heard.isPlaying && heard.beatMs !== null && heard.beatMs >= 250 ? heard.beatMs : null
  const beatChanged = beat !== musicBeatMs
  musicBeatMs = beat
  if (heard !== null && heard.isPlaying) {
    if (heard.isLive && heard.bassNow >= 0.55 && heard.energy >= 0.7) {
      if (buddy.isAsleep) {
        buddy.isAsleep = false
        buddy.lastActivity = now
      }
      buddy.excitedUntil = Math.max(buddy.excitedUntil, now + 12 * SECOND)
    }
    if (heard.track !== musicTrack) {
      musicTrack = heard.track
      if (heard.bpm !== null && !buddy.isAsleep && Math.random() < 0.35) await say($, quip('music', { bpm: heard.bpm, track: heard.track ?? '' }))
    }
  }
  if (beatChanged) await publish($)
}

export function moodAt(now: number): Mood {
  if (buddy.isHatching) return 'hatching'
  if (buddy.isAsleep) return 'asleep'
  if (buddy.isFighting) return 'fighting'
  if (now < buddy.excitedUntil) return 'excited'
  if (buddy.anxiety > 0) return 'anxious'
  if (buddy.failStreak >= 3) return 'worried'
  if (fullnessAt(now) < HUNGRY_BELOW) return 'hungry'
  if (now - care.pettedAt < 3 * MINUTE) return 'happy'
  return 'content'
}

export function fullnessAt(now: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - ((now - care.fedAt) / STARVES_IN) * 100)))
}

// Achievements and the running tallies behind them

export async function tally($: Engine): Promise<Tally> {
  return { ...zeroTally(), ...asObject(await $.store.get('tally')) } as Tally
}

export async function count($: Engine, field: keyof Tally, by: number): Promise<Tally> {
  const t = await tally($)
  t[field] = (Number(t[field]) || 0) + by
  await $.store.set('tally', t)
  return t
}

export async function award($: Engine, id: string): Promise<void> {
  const badge = badgeOf(id)
  if (badge === undefined) return
  const earned = asObject(await $.store.get('badges'))
  if (earned[id] !== undefined) return
  await $.store.set('badges', { ...earned, [id]: await $.clock.now() })
  await play($, 'fanfare')
  $.ui.toast(`🏅 Achievement unlocked: ${badge.name} — ${badge.hint}`)
  // The toast carries the news; the bubble only when nothing fresher is in it.
  if (buddy.bubble === null) await say($, pickLine(['*polishes badge*', 'ooh, shiny badge', 'achievement get!', 'put that on the fridge']), { isForced: true, ttl: 6 * SECOND })
}

// Personality drift: the stats follow your habits, slowly and within bounds

export function driftOf(value: unknown): Partial<Drift> {
  const out: Partial<Drift> = {}
  const v = asObject(value)
  for (const s of STATS) if (typeof v[s] === 'number') out[s] = v[s]
  return out
}

export async function nudge($: Engine, stat: Stat, amount: number): Promise<void> {
  if (buddy.pet === null) return
  buddy.drift = { ...buddy.drift, [stat]: Math.max(-15, Math.min(15, buddy.drift[stat] + amount)) }
  await $.store.set(key('drift', buddy.pet.id), buddy.drift)
}

export const clampStat = (n: number): number => Math.max(1, Math.min(100, n))

export function statOf(stat: Stat): number {
  if (buddy.bones === null) return 0
  return clampStat(buddy.bones.stats[stat] + Math.floor((levelOf(buddy.xp).level - 1) / 2) + Math.round(buddy.drift[stat]))
}

/** The active pet's stats, strongest first, drift and level included. */
export function rankedNow(): [Stat, Stat] {
  const order = [...STATS].sort((a, b) => statOf(b) - statOf(a))
  return [order[0]!, order[order.length - 1]!]
}

function ranked(of: Bones): [Stat, Stat] {
  const order = [...STATS].sort((a, b) => of.stats[b] - of.stats[a])
  return [order[0]!, order[order.length - 1]!]
}

// Care and progress

export async function petIt($: Engine): Promise<void> {
  if (buddy.pet === null || buddy.isHatching) return
  const now = await $.clock.now()
  hearts += 1
  buddy.facts.pets += 1
  care = { ...care, pettedAt: now }
  await $.store.set(key('care', buddy.pet.id), care)
  await wake($, false)
  if (now - lastPetXpAt > MINUTE) {
    lastPetXpAt = now
    await gainXp($, 2)
  }
  await nudge($, 'SNARK', -0.1)
  await say($, quip('pet'), { isForced: true, ttl: 5 * SECOND })
  if (buddy.facts.pets >= 50) await award($, 'whisperer')
  if (buddy.facts.pets >= 3) await completeQuest($, 'pet')
}

export async function feed($: Engine): Promise<string> {
  if (buddy.pet === null) return 'Still hatching…'
  const now = await $.clock.now()
  await wake($, false)
  if (fullnessAt(now) > 80) {
    await say($, quip('full'), { isForced: true })
    return `${buddy.pet.name} is full (${fullnessAt(now)}%).`
  }
  const wasHungry = fullnessAt(now) < 50
  care = { ...care, fedAt: now }
  await $.store.set(key('care', buddy.pet.id), care)
  await gainXp($, 5)
  if (wasHungry) await completeQuest($, 'feed')
  await say($, quip('feed'), { isForced: true })

  return `You fed ${buddy.pet.name}. Fullness 100%.`
}

export function levelOf(total: number): { level: number; into: number; need: number } {
  let level = 1
  let into = total
  let need = 45
  while (into >= need) {
    into -= need
    level += 1
    need = 30 + 15 * level
  }

  return { level, into, need }
}

export async function gainXp($: Engine, amount: number): Promise<void> {
  if (buddy.pet === null) return
  // Re-read so two sessions with this pet add to one total.
  const before = Number((await $.store.get(key('xp', buddy.pet.id))) ?? buddy.xp) || 0
  buddy.xp = before + amount
  await $.store.set(key('xp', buddy.pet.id), buddy.xp)

  const was = levelOf(before).level
  const now = levelOf(buddy.xp).level
  if (now <= was || buddy.pet === null || buddy.bones === null) return

  if (stageOf(now) > stageOf(was)) {
    const stage = stageOf(now)
    $.ui.toast(`⚡ ${buddy.pet.name} evolved into a${stage === 3 ? 'n' : ''} ${STAGE_NAMES[stage]} ${buddy.bones.species}! (level ${now})`)
    buddy.excitedUntil = (await $.clock.now()) + 20 * SECOND
    await play($, 'levelup')
    await publish($)
    await say($, stage === 3 ? '✦ behold ✦' : 'do I look taller? I feel taller', { isForced: true, ttl: 12 * SECOND })
    await award($, 'evolved')
    return
  }
  const unlocked = buddy.bones.hatOrder[Math.floor(now / 3) - 1]
  const isNewHat = now % 3 === 0 && unlocked !== undefined
  $.ui.toast(`✨ ${buddy.pet.name} reached level ${now}!` + (isNewHat ? ` New hat unlocked: ${unlocked} (/buddy hat ${unlocked})` : ''))
  await play($, 'levelup')
  await publish($)
  await publishHouse($)
}

export function unlockedHats(): string[] {
  if (buddy.bones === null) return []
  const level = levelOf(buddy.xp).level
  const earned = buddy.bones.hatOrder.slice(0, Math.floor(level / 3))
  const bought = buddy.owned.map(id => itemOf(id)).filter(i => i?.kind === 'hat').map(i => i!.value)
  const extras = buddy.pet?.extras ?? []

  return [...(buddy.bones.hat === null ? [] : [buddy.bones.hat]), ...earned, ...extras, ...bought]
}

export function wornHat(): string | null {
  const chosen = buddy.pet?.hat
  if (buddy.bones === null || chosen === 'none') return null
  if (chosen !== undefined && unlockedHats().includes(chosen)) return chosen
  return buddy.bones.hat
}

export function hatOf(record: PetRecord, b: Bones): string | null {
  return record.hat === 'none' ? null : (record.hat ?? b.hat)
}

export function hatRow(name: string | null): string {
  return name === null ? '' : (HATS[name] ?? EXTRA_HATS[name] ?? '')
}

export function armed(stats: Record<Stat, number>, record: PetRecord): Record<Stat, number> {
  if (record.sword !== true) return stats
  return Object.fromEntries(STATS.map(s => [s, stats[s] + 3])) as Record<Stat, number>
}

export async function savePet($: Engine, changed: PetRecord): Promise<void> {
  buddy.pet = changed
  buddy.collection = buddy.collection.map(p => (p.id === changed.id ? changed : p))
  await $.store.set(key('pet', changed.id), changed)
  await publish($)
}

export async function setPrefs($: Engine, change: Partial<Prefs>): Promise<void> {
  buddy.prefs = { ...buddy.prefs, ...change }
  await $.store.set('prefs', buddy.prefs)
  await update($, isHidden, () => buddy.prefs.isHidden)
  await publish($)
}

function isPetRecord(value: unknown): value is PetRecord {
  const v = asObject(value)
  return typeof v.id === 'string' && typeof v.seed === 'number' && typeof v.name === 'string' && typeof v.personality === 'string' && typeof v.hatchedAt === 'number'
}
