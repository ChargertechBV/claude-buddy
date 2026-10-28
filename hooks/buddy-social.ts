// The other pets: visitors, wild shinies, battles, rivals and friends, and the
// notes they leave each other.

import type { VisitorKind } from '../types'
import { BANTER, BATTLE_LINES, FRIEND_BANTER, RIVAL_BANTER, STATS, mulberry32, roll } from './art'
import type { Stat } from './art'
import { fight } from './battle'
import type { Bout, Fighter } from './battle'
import { adopt, armed, award, bonesOf, clampStat, count, driftOf, gainXp, levelOf, nameFor, publish, statOf } from './buddy-life'
import { HOUR, MINUTE, SECOND, asObject, buddy, clip, key, randomSeed, zeroDrift } from './buddy-state'
import type { Engine, PetRecord } from './buddy-state'
import { ask, fill, jsonOf, persona, pickLine, play, say, speak, voice } from './buddy-voice'
import { completeQuest } from './buddy-world'

type Narration = { rounds: string[]; closing: string }
type Bond = { fights: number; visits: number }
type Relation = 'rival' | 'friend' | null
type Note = { from: string; text: string; at: number }
const VISIT_EVERY = 50 * MINUTE
const VISIT_FOR = 3 * MINUTE
const WILD_EVERY = 2 * HOUR
const WILD_WINDOW = 30 * SECOND
const WILD_ODDS = 1 / 120
let battleId = 0
let lastVisitAt = 0
let lastWildAt = 0

// Visitors: another pet from the collection drops by for a chat

export function pickOther(): PetRecord | null {
  const others = buddy.collection.filter(p => p.id !== buddy.pet?.id)
  return others[Math.floor(Math.random() * others.length)] ?? null
}

export function shouldVisit(now: number): boolean {
  if (buddy.visitor !== null || buddy.isFighting || buddy.prefs.isMuted || buddy.collection.length < 2) return false
  if (now - buddy.lastActivity > 5 * MINUTE || now - buddy.sessionStartedAt < 10 * MINUTE) return false
  if (now - lastVisitAt < VISIT_EVERY || now - buddy.lastSaidAt < 2 * MINUTE) return false
  return Math.random() < 0.12
}

async function startVisit($: Engine, record: PetRecord, kind: VisitorKind, lasts: number): Promise<void> {
  const now = await $.clock.now()
  buddy.visitor = { record, kind, until: now + lasts }
  lastVisitAt = now
  await publish($)
}

export async function visit($: Engine, record: PetRecord | null): Promise<void> {
  if (record === null || buddy.pet === null) return
  await startVisit($, record, 'visit', VISIT_FOR)
  buddy.facts.visits += 1
  const relation = relationOf(await bumpBond($, buddy.pet.id, record.id, 'visits'))
  const lines = (await smartBanter($, record, relation)) ?? localBanter(record, relation)
  await say($, lines[0], { isForced: true, ttl: 7 * SECOND })
  $.clock.after(7 * SECOND, () => void say($, lines[1], { isForced: true, ttl: 8 * SECOND }))
  await completeQuest($, 'visit')
}

function localBanter(guest: PetRecord, relation: Relation): [string, string] {
  const pool = relation === 'rival' ? RIVAL_BANTER : relation === 'friend' ? FRIEND_BANTER : voice().isSnarky ? BANTER.snark : BANTER.sweet
  const [v, h] = pool[Math.floor(Math.random() * pool.length)] ?? ['{v}: hi', '{h}: hi']
  const names = { v: guest.name, h: buddy.pet?.name ?? '', vspecies: bonesOf(guest).species }
  return [fill(v, names), fill(h, names)]
}

async function smartBanter($: Engine, guest: PetRecord, relation: Relation): Promise<[string, string] | null> {
  if (buddy.pet === null || buddy.bones === null) return null
  const gb = bonesOf(guest)
  const bond = relation === 'rival' ? 'You two are rivals: you fight often, so trash talk. ' : relation === 'friend' ? 'You two are old friends: warm, in on the same jokes. ' : ''
  const system =
    `${persona()} ${guest.name}, another of the developer's pets (a ${gb.rarity} ${gb.species}; personality: ` +
    `${guest.personality || 'unknown'}), just dropped by your terminal. ${bond}Write their opening line and your reply: ` +
    `playful, in character for both, about the developer's habits or each other, at most 70 characters each, no ` +
    `hashtags. Answer with JSON only: {"visitor": "...", "host": "..."}`
  const parsed = jsonOf(await ask($, system, `Write the exchange.`))
  const v = typeof parsed.visitor === 'string' ? clip(parsed.visitor, 80) : ''
  const h = typeof parsed.host === 'string' ? clip(parsed.host, 80) : ''

  return v.length > 0 && h.length > 0 ? [`${guest.name}: ${v}`, `${buddy.pet.name}: ${h}`] : null
}

export async function guestLeaves($: Engine): Promise<void> {
  if (buddy.visitor === null) return
  const leaving = buddy.visitor
  buddy.visitor = null
  if (leaving.kind === 'wild') await say($, "it's gone. you blinked.", { isForced: !buddy.prefs.isMuted })
  else if (leaving.kind === 'visit') await say($, `${leaving.record.name} wandered off`, { ttl: 5 * SECOND })
  await publish($)
}

// Wild shinies: rarely, one wanders across the band; /buddy catch within 30 seconds keeps it

export function shouldWild(now: number): boolean {
  if (buddy.visitor !== null || buddy.isFighting || now - buddy.lastActivity > 5 * MINUTE) return false
  if (now - buddy.sessionStartedAt < 10 * MINUTE || now - lastWildAt < WILD_EVERY) return false
  // Drawn from the clock, so every tick has its own fixed luck.
  return mulberry32(Math.floor(now / (30 * SECOND)))() < WILD_ODDS
}

export async function wildAppears($: Engine): Promise<void> {
  const now = await $.clock.now()
  const seed = randomSeed()
  const wild: PetRecord = { id: `w${seed.toString(36)}`, seed, name: '???', personality: '', hatchedAt: now, isShiny: true, isWild: true }
  lastWildAt = now
  buddy.visitor = { record: wild, kind: 'wild', until: now + WILD_WINDOW }
  await publish($)
  await play($, 'pop')
  $.ui.toast(`✨ A wild shiny ${roll(seed).species} wanders by! /buddy catch (30 seconds)`)
  await say($, "ooh. shiny. don't just sit there", { isForced: true, ttl: 10 * SECOND })
}

export async function catchWild($: Engine): Promise<string> {
  if (buddy.pet === null) return 'Still hatching…'
  if (buddy.visitor === null || buddy.visitor.kind !== 'wild') return 'Nothing to catch right now. Keep your eyes peeled: shinies wander by now and then.'
  const wild = buddy.visitor.record
  buddy.visitor = null
  const rolled = bonesOf(wild)
  const soul = await nameFor($, rolled, wild.seed, buddy.collection.map(p => p.name))
  const caught: PetRecord = { ...wild, ...soul }
  await adopt($, caught)
  await count($, 'shinies', 1)
  await award($, 'shiny-hunter')
  await play($, 'fanfare')
  $.ui.toast(`✨ You caught ${caught.name}, a shiny ${rolled.species}! It joins the collection.`)
  await say($, `${caught.name}! welcome to the chaos`, { isForced: true })

  return `✨ **Caught!** ${caught.name}, a shiny ${rolled.rarity} ${rolled.species}, joins your collection (${buddy.collection.length} pets). *${caught.personality}*`
}

// Battles: three rounds on random stats, narrated in the bubble

async function statsFor($: Engine, record: PetRecord): Promise<Record<Stat, number>> {
  if (buddy.pet !== null && record.id === buddy.pet.id) return Object.fromEntries(STATS.map(s => [s, statOf(s)])) as Record<Stat, number>
  const b = bonesOf(record)
  const level = levelOf(Number((await $.store.get(key('xp', record.id))) ?? 0) || 0).level
  const d = { ...zeroDrift(), ...driftOf(await $.store.get(key('drift', record.id))) }

  return Object.fromEntries(STATS.map(s => [s, clampStat(b.stats[s] + Math.floor((level - 1) / 2) + Math.round(d[s]))])) as Record<Stat, number>
}

export async function battle($: Engine, wanted: string): Promise<string> {
  if (buddy.pet === null) return 'Still hatching…'
  if (buddy.isFighting) return 'A battle is already on. Watch the bubble.'
  const here = buddy.pet
  const others = buddy.collection.filter(p => p.id !== here.id)
  if (others.length === 0) return `${buddy.pet.name} has nobody to fight yet. Hatch another pet first.`
  const name = wanted.toLowerCase()
  const foe = others.find(p => p.name.toLowerCase() === name) ?? others.find(p => p.name.toLowerCase().startsWith(name))
  if (name === '' || foe === undefined) return `Battle whom? ${others.map(p => p.name).join(', ')}.`

  const me: Fighter = { name: buddy.pet.name, stats: armed(await statsFor($, buddy.pet), buddy.pet) }
  const them: Fighter = { name: foe.name, stats: armed(await statsFor($, foe), foe) }
  const bout = fight(me, them, Math.random)
  const id = ++battleId
  buddy.isFighting = true
  const relation = relationOf(await bumpBond($, buddy.pet.id, foe.id, 'fights'))
  await startVisit($, foe, 'battle', 60 * SECOND)
  const story = (await smartBattle($, bout, foe, relation)) ?? localBattle(bout, me.name, them.name)
  await say($, `⚔️ ${story.rounds[0] ?? ''}`, { isForced: true, ttl: 5 * SECOND })
  story.rounds.slice(1).forEach((line, i) => $.clock.after((i + 1) * 4 * SECOND, () => void say($, `⚔️ ${line}`, { isForced: true, ttl: 5 * SECOND })))
  $.clock.after(12 * SECOND, () => void settleBattle($, id, bout, foe, story.closing))

  return `⚔️ **${buddy.pet.name} challenges ${foe.name}!**${relation === 'rival' ? ' A grudge match.' : ''} Three rounds, best of stats. Watch the bubble; the result comes in a moment.`
}

function localBattle(bout: Bout, me: string, them: string): Narration {
  const rounds = bout.rounds.map((r, i) => `R${i + 1} ${r.stat}: ${me} ${r.a} vs ${them} ${r.b} · ${r.winner === 'a' ? me : them} ${pickLine(BATTLE_LINES.land)}`)
  const closing =
    bout.winner === 'a'
      ? `${me} wins ${bout.score[0]}–${bout.score[1]}! ${pickLine(BATTLE_LINES.win)}`
      : `${them} wins ${bout.score[1]}–${bout.score[0]}. ${pickLine(BATTLE_LINES.lose)}`

  return { rounds, closing }
}

async function smartBattle($: Engine, bout: Bout, foe: PetRecord, relation: Relation): Promise<Narration | null> {
  if (buddy.pet === null || buddy.bones === null) return null
  const fb = bonesOf(foe)
  const grudge = relation === 'rival' ? 'This is a grudge match between old rivals. ' : ''
  const rounds = bout.rounds
    .map((r, i) => `Round ${i + 1}, ${r.stat}: ${buddy.pet?.name} ${r.a} vs ${foe.name} ${r.b}, ${r.winner === 'a' ? buddy.pet?.name : foe.name} wins`)
    .join('; ')
  const system =
    `${persona()} You are fighting ${foe.name}, another of the developer's pets (a ${fb.rarity} ${fb.species}; ` +
    `personality: ${foe.personality || 'unknown'}). ${grudge}You narrate it yourself like an over-the-top sports ` +
    `commentator, in your own voice. One line per round naming the stat and who took it, and one closing line ` +
    `for the result (gracious or sore, as your stats dictate); each at most 80 characters, no hashtags. ` +
    `Answer with JSON only: {"rounds": ["...", "...", "..."], "closing": "..."}`
  const result = bout.winner === 'a' ? `${buddy.pet.name} wins ${bout.score[0]}-${bout.score[1]}` : `${foe.name} wins ${bout.score[1]}-${bout.score[0]}`
  const parsed = jsonOf(await ask($, system, `${rounds}. Result: ${result}.`, { maxTokens: 700 }))
  const lines = Array.isArray(parsed.rounds) ? parsed.rounds.filter((l): l is string => typeof l === 'string').map(l => clip(l, 90)) : []
  const closing = typeof parsed.closing === 'string' ? clip(parsed.closing, 90) : ''

  return lines.length === 3 && closing.length > 0 ? { rounds: lines, closing } : null
}

async function settleBattle($: Engine, id: number, bout: Bout, foe: PetRecord, closing: string): Promise<void> {
  if (id !== battleId || buddy.pet === null) return
  const iWon = bout.winner === 'a'
  buddy.facts.battles += 1
  await gainXp($, iWon ? 10 : 3)
  const foeXp = Number((await $.store.get(key('xp', foe.id))) ?? 0) || 0
  await $.store.set(key('xp', foe.id), foeXp + (iWon ? 3 : 10))
  await bumpRecord($, buddy.pet.id, iWon)
  await bumpRecord($, foe.id, !iWon)
  if (iWon) {
    const t = await count($, 'battlesWon', 1)
    if (t.battlesWon >= 5) await award($, 'champion')
    await completeQuest($, 'battle')
  }
  await play($, iWon ? 'fanfare' : 'sad')
  $.ui.toast(
    `⚔️ ${iWon ? buddy.pet.name : foe.name} wins ${iWon ? bout.score[0] : bout.score[1]}–${iWon ? bout.score[1] : bout.score[0]}! ` +
      `${buddy.pet.name} +${iWon ? 10 : 3} xp, ${foe.name} +${iWon ? 3 : 10} xp.`,
  )
  await say($, `⚔️ ${closing}`, { isForced: true, ttl: 10 * SECOND })
  await speak($, closing)
  buddy.isFighting = false
  $.clock.after(4 * SECOND, () => {
    if (buddy.visitor?.kind === 'battle') buddy.visitor = null
    void publish($)
  })
}

async function bumpRecord($: Engine, id: string, isWin: boolean): Promise<void> {
  const r = asObject(await $.store.get(key('record', id)))
  const wins = (Number(r.wins) || 0) + (isWin ? 1 : 0)
  const losses = (Number(r.losses) || 0) + (isWin ? 0 : 1)
  await $.store.set(key('record', id), { wins, losses })
}

// Rivals and friends

export async function bondOf($: Engine, a: string, b: string): Promise<Bond> {
  const r = asObject(await $.store.get(`bond:${[a, b].sort().join(':')}`))
  return { fights: Number(r.fights) || 0, visits: Number(r.visits) || 0 }
}

async function bumpBond($: Engine, a: string, b: string, field: keyof Bond): Promise<Bond> {
  const bond = await bondOf($, a, b)
  bond[field] += 1
  await $.store.set(`bond:${[a, b].sort().join(':')}`, bond)
  return bond
}

export function relationOf(bond: Bond): Relation {
  if (bond.fights >= 3 && bond.fights > bond.visits) return 'rival'
  if (bond.visits >= 3 && bond.visits >= bond.fights) return 'friend'
  return null
}

// Notes between pets

export async function leaveNote($: Engine, text: string | null): Promise<void> {
  if (buddy.pet === null) return
  const me = buddy.pet
  const now = await $.clock.now()
  const stored = await $.store.get('notes')
  const notes = (Array.isArray(stored) ? stored : []).map(asObject).filter(n => typeof n.from === 'string' && typeof n.text === 'string') as Note[]
  await $.store.set('notes', [...notes.filter(n => n.from !== me.name), { from: me.name, text: text ?? localNote(), at: now }].slice(-10))
}

function localNote(): string {
  const lines = voice().isSnarky
    ? [
        `${buddy.facts.fails} things broke today. not my fault.`,
        `the human prompted ${buddy.facts.prompts} times. judge accordingly.`,
        'they say "fix it" a lot. brace yourself.',
        `tests went green ${buddy.facts.greens} times. suspicious.`,
      ]
    : [
        `${buddy.facts.prompts} prompts today. they tried.`,
        'be nice to the human, they had a day.',
        `${buddy.facts.bugsEaten} bugs eaten. leftovers in the fridge.`,
        "the tests were flaky. not the human's fault. probably.",
      ]

  return pickLine(lines)
}

export async function readNote($: Engine): Promise<void> {
  if (buddy.pet === null) return
  const me = buddy.pet
  const stored = await $.store.get('notes')
  const notes = (Array.isArray(stored) ? stored : []).map(asObject).filter(n => typeof n.from === 'string' && typeof n.text === 'string') as Note[]
  const note = notes.find(n => n.from !== me.name)
  if (note === undefined) return
  await $.store.set('notes', notes.filter(n => n !== note))
  await say($, `📝 note from ${note.from}: "${note.text}"`, { isForced: true, ttl: 15 * SECOND })
}
