import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BuddyView, GameView, HouseView, Mood, Visitor, VisitorKind } from '../types'
import { BANTER, BATTLE_LINES, EGG, EXTRA_HATS, FRIEND_BANTER, HATS, NAMES, PARTY_HAT, QUIPS, RARITIES, RIVAL_BANTER, SPECIES, STAGE_NAMES, STATS, mulberry32, roll, silhouette } from './art'
import type { Bones, Stat } from './art'
import { BADGES, badgeOf } from './badges'
import { fight } from './battle'
import type { Bout, Fighter } from './battle'
import { momentsAt } from './calendar'
import type { Moment } from './calendar'
import { GRADES, commitMessageOf, gpaOf, localAnswerVerdict, localCommitVerdict, localVerdict, pointsOf, sinOf } from './grading'
import type { Lines, Verdict, Voice } from './grading'
import { QUESTS, questFor } from './quests'
import { SHOP, itemOf } from './shop'
import { registerSoundtrack, soundtrackToolCall, startSoundtrack } from './soundtrack'

// A collection of terminal pets, one in the band above the prompt each
// session. Each pet's looks follow from its seed, its name and personality
// from one small model call at hatching. Until the collection holds
// MAX_PETS, each new session hatches an egg; after that it draws one at
// random. A pet levels up as you work (and evolves at 10 and 20), gets
// hungry over hours, naps when you are away, reacts to the session, judges
// your prompts and commits, eats the bugs your tests leave, gets visits
// from the others, fights them, keeps a diary, and answers by name.

const view = atom({ plugin: 'buddy', key: 'view' } as const, null)
const isHidden = atom({ plugin: 'buddy', key: 'isHidden' } as const, false)
// The session's pet: held in $.state, so a hot reload keeps it.
const activeId = atom({ plugin: 'buddy', key: 'activeId' } as const, null)
const house = atom({ plugin: 'buddy', key: 'house' } as const, null)
const game = atom({ plugin: 'buddy', key: 'game' } as const, null)

type Engine = EngineInterface
type PetRecord = {
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
type Care = { fedAt: number; pettedAt: number }
type Judging = 'off' | 'sometimes' | 'always'
type Prefs = {
  isMuted: boolean
  isCompact: boolean
  isHidden: boolean
  isSmart: boolean
  judge: Judging
  hasNews: boolean
  hasSound: boolean
  hasVoice: boolean
}
type Story = { id: string; title: string; url: string; points: number; comments: number }
type Judged = { grade: string; line: string; at: number; prompt?: string }
type Drift = Record<Stat, number>
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
type Guest = { record: PetRecord; kind: VisitorKind; until: number }
type Sound = 'quack' | 'crunch' | 'levelup' | 'fanfare' | 'sad' | 'pop'
type Narration = { rounds: string[]; closing: string }
type Bond = { fights: number; visits: number }
type Relation = 'rival' | 'friend' | null
type GitState = { branch: string; changed: number; ahead: number }
type Note = { from: string; text: string; at: number }

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const NAP_AFTER = 10 * MINUTE
const STARVES_IN = 6 * HOUR
const HUNGRY_BELOW = 20
const QUIET_FOR = 20 * SECOND
const SMART_EVERY = 4 * MINUTE
const MAX_PETS = 10
const MODEL = 'haiku'
const BIG_MODEL = 'opus'
const BIG_EVERY = 20 * MINUTE
const VISIT_EVERY = 50 * MINUTE
const VISIT_FOR = 3 * MINUTE
const WILD_EVERY = 2 * HOUR
const WILD_WINDOW = 30 * SECOND
const WILD_ODDS = 1 / 120
const NEWS_EVERY = 45 * MINUTE
const NEWS_FRESH_FOR = 2 * HOUR
const JUDGE_EVERY = 3 * MINUTE
const COMMIT_JUDGE_EVERY = 2 * MINUTE
const CLAUDE_JUDGE_EVERY = 4 * MINUTE
const GIT_EVERY_TICKS = 20
const NAG_EVERY = HOUR
const SPEAK_EVERY = 2 * MINUTE
const HOUSE = 'buddy-house'
const GAME = 'buddy-game'

type Key = 'pet' | 'xp' | 'care' | 'seen' | 'drift' | 'record' | 'bugs' | 'high'
const key = (kind: Key, id: string) => `${kind}:${id}`

const DEFAULT_PREFS: Prefs = {
  isMuted: false,
  isCompact: false,
  isHidden: true, // the pet lives in the Soundtrack pane; /buddy show brings the band back
  isSmart: true,
  judge: 'sometimes',
  hasNews: true,
  hasSound: true,
  hasVoice: false,
}
const AI = /\b(AI|A\.I\.|LLMs?|GPT[-\w.]*|OpenAI|Anthropic|Claude|Gemini|DeepMind|Llama|Mistral|AGI|ASI|chatbots?|Copilot|Cursor|neural|transformers?|diffusion|Nvidia|agents?|agentic|vibe ?cod\w*|Grok|xAI|Qwen|DeepSeek|machine learning|superintelligence)\b/i
const TESTS = /\b(test|tests|pytest|jest|vitest|mocha|rspec|phpunit|cargo test|go test|npm (run )?test|pnpm test|yarn test|bun test)\b/
const COMMIT = /\bgit\s+commit\b/
const REJECTED = /doesn't want to proceed|was rejected|denied/i
const QUACK = /^\s*quack[!.?]*\s*$/i

const ANXIOUS: Record<number, Lines> = {
  1: {
    sweet: ["{pct}% full… it's getting cozy in here", 'the context window is closing in. just saying'],
    snark: ['{pct}% full. hoarding tokens, are we', 'I can feel the window closing. can you?'],
  },
  2: {
    sweet: ['{pct}%! /compact before I become a summary', "please. /compact. I can't breathe"],
    snark: ['{pct}%. /compact, or I get compacted WITH you', 'this is how I die: as a bullet point. /compact me gently'],
  },
}

const zeroDrift = (): Drift => ({ DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 })
const zeroTally = (): Tally => ({ sessions: 0, commits: 0, greens: 0, addressed: 0, bugsEaten: 0, battlesWon: 0, reviews: 0, shinies: 0, quests: 0, games: 0 })
const freshFacts = (): Facts => ({
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
let collection: PetRecord[] = []
let pet: PetRecord | null = null
let bones: Bones | null = null
let xp = 0
let care: Care = { fedAt: 0, pettedAt: 0 }
let drift: Drift = zeroDrift()
let prefs: Prefs = DEFAULT_PREFS
let isHatching = false

let bubble: string | null = null
let bubbleId = 0
let lastSaidAt = 0
let hearts = 0
let bugs = 0
let visitor: Guest | null = null
let isFighting = false
let battleId = 0
let anxiety = 0
let anxietySaid = 0
let moments: Moment[] = []
let facts: Facts = freshFacts()
const saidMoments = new Set<string>()
let lastActivity = 0
let isAsleep = false
// What the soundtrack mod hears, when it is loaded: a beat to bob to, and the track for a remark.
let musicBeatMs: number | null = null
let musicTrack: string | null = null
let failStreak = 0
let excitedUntil = 0
let lastSmartAt = 0
let lastHungerNag = 0
let lastPetXpAt = 0
let lastJudgedAt = 0
let lastCommitJudgedAt = 0
let lastBigAt = 0
let lastNewsAt = 0
let lastVisitAt = 0
let lastWildAt = 0
let lastSoundAt = 0
let lastClaudeJudgedAt = 0
let lastSpokeAt = 0
let git: GitState | null = null
let lastNag = { changed: 0, ahead: 0 }
let owned: string[] = []
let coinsSpent = 0
let tickCount = 0
let sessionStartedAt = 0
let lastPublished = ''
let lastPrompt = ''
let turnTools: { tool: string; isFailed: boolean }[] = []

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)

    await $.command.register({
      name: 'buddy',
      description: 'Your terminal pets: card, pets, house, battle, visit, catch, dex, quest, shop, badges, journal, fix, judge, roast, review, shame, news, export, help',
      argumentHint: '[play|pets|swap|hatch|house|battle|visit|catch|dex|quest|shop|buy|wear|badges|journal|fix|judge|roast|review|shame|news|pet|feed|hat|rename|mute|small|hide|smart|sound|voice|export|import|help]',
      immediate: true,
    })
    await load($)
    $.clock.every(30 * SECOND, () => void tick($))
    $.clock.every(5 * SECOND, () => void musicTick($))
    $.clock.after(20 * SECOND, () => void fridayCeremony($))
    $.clock.after(MINUTE, () => void gitCheckAndNag($))
    try {
      await startSoundtrack($, e)
    } catch {
      // The pane never gets in the way of the pet.
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (pet !== null && !isHatching) {
      const now = await $.clock.now()
      await $.store.set(key('seen', pet.id), now)
      await endOfDay($, now)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (pet === null || isHatching || e.origin.kind !== 'composer') return next(e)

    lastPrompt = e.text
    turnTools = []
    facts.prompts += 1
    const here = pet
    const hour = new Date(await $.clock.now()).getHours()
    if (hour >= 5 && hour < 7) await award($, 'early-bird')
    const isAddressed = addresses(e.text, here.name)
    const absent = isAddressed ? undefined : collection.find(p => p.id !== here.id && addresses(e.text, p.name))
    await wake($, !isAddressed && absent === undefined)
    await gainXp($, 1)
    if (/\b[\w.-]+\/[\w./-]+\.\w{1,5}\b|\b[\w-]+\.(ts|tsx|js|jsx|py|go|rs|php|rb|md|json|ya?ml|sql|css|html|sh)\b/.test(e.text)) await completeQuest($, 'path')
    if (/\b(error|exception|traceback|panic|ENOENT|TypeError|ReferenceError|SyntaxError)\b[^\n]*[:\n]/i.test(e.text)) await completeQuest($, 'error')

    if (QUACK.test(e.text)) {
      $.clock.after(0, () => void quackBack($))
      const note = `The user quacked at their terminal pet, ${here.name}, who quacked back from its bubble. Answer with one quack of your own and nothing else.`
      return next({ ...e, context: [...(e.context ?? []), note] })
    }
    if (absent !== undefined) {
      $.clock.after(0, () => void say($, `${absent.name}'s not here today. it's me, ${here.name}!`, { isForced: true }))
      return next(e)
    }
    if (!isAddressed) {
      if (await shouldJudge($, e.text)) $.clock.after(0, () => void judge($, e.text))
      return next(e)
    }

    $.clock.after(0, () => void answer($, e.text))
    const note =
      `${here.name} is the user's terminal pet (a ${bones?.species ?? 'pet'}) that lives above the prompt ` +
      `and answers in its own speech bubble. The user addressed ${here.name}, and ${here.name} is answering ` +
      `them there now: don't speak for ${here.name}. If the message is only for ${here.name}, reply in one ` +
      `short line at most.`

    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    try {
      const command = e.tool === 'Bash' ? String((e as { command?: unknown }).command ?? '') : ''
      const path = typeof (e as { file_path?: unknown }).file_path === 'string' ? String((e as { file_path?: unknown }).file_path) : ''
      await afterTool($, e.tool, command, path, ran)
    } catch {
      // The pet never gets in the way of a tool call.
    }
    try {
      soundtrackToolCall($, e, ran, startedAt, await $.clock.now())
    } catch {
      // Nor does the telemetry.
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && pet !== null && !isHatching) {
      const turn = { reason: e.reason, durationMs: e.durationMs, answer: e.answer }
      $.clock.after(0, () => void afterTurn($, turn))
    }

    return done
  })

  on('ui.message', async ($, e, next) => {
    const data = asObject(e.data)
    if (e.element === 'game') {
      if (data.type === 'over') await gameOver($, Number(data.score) || 0, Number(data.bugs) || 0)
      return {}
    }
    if (e.element !== 'pet') return next(e)
    if (data.type === 'pet') await petIt($)

    return {}
  })

  on('command.run', { command: 'buddy' }, async ($, e) => runCommand($, e.args))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, view)
    const hidden = await read($, isHidden)
    // A reload finds the view an older load published; it is skipped until publish() replaces it.
    if (shown === null || !('visitor' in shown) || hidden || e.props.hasSurvey) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)

    const { Box, Client } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const isCompact = shown.isCompact || columns < 40 || e.props.maxRows < 7

    return (
      <Box flexDirection="row" justifyContent="flex-end" width={columns}>
        <Client key="pet" module="./pet.tsx" props={{ ...shown, isCompact, columns, isWorking: e.props.isWorking }} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: GAME }, async ($, e, next) => {
    const g = await read($, game)
    if (g === null) return next(e)
    const { Box, Button, Client, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Client key="game" module="./game.tsx" props={{ ...g, columns: e.props.bodyColumns - 2 }} />
        <Box flexDirection="row" gap={1}>
          <Button key="flap" label="flap" hotkey="f" onPress={() => update($, game, now => (now === null ? now : { ...now, flaps: now.flaps + 1 }))} />
          <Button key="restart" label="restart" hotkey="r" onPress={() => update($, game, now => (now === null ? now : { ...now, restarts: now.restarts + 1 }))} />
          <Text dimColor wrap="truncate-end">
            f flaps · r restarts · esc closes · score pays xp
          </Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: HOUSE }, async ($, e) => {
    const { Box, Client, Text } = $.ui.resolve(e)
    const pets = (await read($, house)) ?? []

    return (
      <Box flexDirection="column" gap={1}>
        <Client key="house" module="./house.tsx" props={{ pets, columns: e.props.bodyColumns }} />
        <Text dimColor>★ on duty · /buddy swap &lt;name&gt; to switch · ctrl+x x closes</Text>
      </Box>
    )
  })

  registerSoundtrack(on)
}

// Loading and hatching

async function load($: Engine): Promise<void> {
  prefs = { ...DEFAULT_PREFS, ...asObject(await $.store.get('prefs')) }
  if (!['off', 'sometimes', 'always'].includes(prefs.judge)) prefs = { ...prefs, judge: DEFAULT_PREFS.judge }
  const ownedStored = await $.store.get('owned')
  owned = Array.isArray(ownedStored) ? ownedStored.filter((id): id is string => typeof id === 'string') : []
  coinsSpent = Number(await $.store.get('coinsSpent')) || 0
  const now = await $.clock.now()
  lastActivity = now
  sessionStartedAt = now
  facts = freshFacts()
  await update($, isHidden, () => prefs.isHidden)

  const migrated = await migrate($, now)
  collection = await loadCollection($)
  // A reload keeps the session's pet, and so does the load that just moved a
  // single pet into the collection; a new session hatches or draws one.
  const held = (await read($, activeId)) ?? migrated
  const kept = collection.find(p => p.id === held)
  if (kept !== undefined) return become($, kept, held === migrated)
  if (hatchSlots() > 0) return startHatching($)

  return become($, await draw($), true)
}

async function petIds($: Engine): Promise<string[]> {
  const ids = await $.store.get('pets')
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

async function loadCollection($: Engine): Promise<PetRecord[]> {
  const pets: PetRecord[] = []
  for (const id of await petIds($)) {
    const stored = await $.store.get(key('pet', id))
    if (isPetRecord(stored)) pets.push(stored)
  }
  return pets
}

/** Eggs left to hatch: wild shinies you caught take no slot. */
function hatchSlots(): number {
  return Math.max(0, MAX_PETS - collection.filter(p => p.isWild !== true).length)
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
  const pool = collection.length > 1 ? collection.filter(p => p.id !== last) : collection
  const chosen = pool[Math.floor(Math.random() * pool.length)] ?? collection[0]!
  await $.store.set('lastPick', chosen.id)
  return chosen
}

async function become($: Engine, chosen: PetRecord, shouldGreet: boolean): Promise<void> {
  const now = await $.clock.now()
  pet = chosen
  bones = bonesOf(chosen)
  xp = Number((await $.store.get(key('xp', chosen.id))) ?? 0) || 0
  care = { fedAt: now, pettedAt: 0, ...asObject(await $.store.get(key('care', chosen.id))) }
  drift = { ...zeroDrift(), ...driftOf(await $.store.get(key('drift', chosen.id))) }
  bubble = null
  hearts = 0
  bugs = 0
  visitor = null
  isFighting = false
  failStreak = 0
  isAsleep = false
  excitedUntil = 0
  facts.pets = 0
  moments = momentsAt(now, chosen, bones.species, Object.keys(SPECIES))
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

async function startHatching($: Engine): Promise<void> {
  isHatching = true
  pet = null
  bones = null
  bubble = null
  visitor = null
  await publish($)
  $.clock.after(2 * SECOND, () => void hatch($))
}

async function hatch($: Engine): Promise<void> {
  // A species the collection lacks, where a few tries find one.
  const owned = new Set(collection.map(p => roll(p.seed).species))
  let seed = randomSeed()
  for (let tries = 0; tries < 25 && owned.has(roll(seed).species); tries++) seed = randomSeed()
  const rolled = roll(seed)
  const soul = await nameFor($, rolled, seed, collection.map(p => p.name))
  const now = await $.clock.now()
  const born: PetRecord = { id: `p${seed.toString(36)}`, seed, ...soul, hatchedAt: now }
  await adopt($, born)
  isHatching = false
  await become($, born, false)
  excitedUntil = now + 15 * SECOND
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
async function adopt($: Engine, born: PetRecord): Promise<void> {
  const now = await $.clock.now()
  await $.store.set(key('pet', born.id), born)
  await $.store.set(key('care', born.id), { fedAt: now, pettedAt: 0 })
  await $.store.set(key('seen', born.id), now)
  await $.store.set('pets', [...(await petIds($)).filter(id => id !== born.id), born.id])
  await $.store.set('lastPick', born.id)
  collection = await loadCollection($)
  await publishHouse($)
}

async function nameFor(
  $: Engine,
  rolled: Bones,
  seed: number,
  taken: string[],
): Promise<{ name: string; personality: string }> {
  const free = NAMES.filter(n => !taken.includes(n))
  const fallback = { name: free[seed % Math.max(1, free.length)] ?? 'Pip', personality: fallbackPersonality(rolled) }
  if (!prefs.isSmart) return fallback

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
function bonesOf(record: PetRecord): Bones {
  const rolled = roll(record.seed)
  return record.isShiny === true ? { ...rolled, isShiny: true } : rolled
}

function stageOf(level: number): number {
  return level >= 20 ? 3 : level >= 10 ? 2 : 1
}

function speciesLabel(species: string, level: number): string {
  const stage = stageOf(level)
  return stage >= 2 ? `${STAGE_NAMES[stage]} ${species}` : species
}

// What the band draws

async function publish($: Engine): Promise<void> {
  const now = await $.clock.now()
  const next = buildView(now)
  const text = JSON.stringify(next)
  if (text === lastPublished) return
  lastPublished = text
  await update($, view, () => next)
}

function buildView(now: number): BuddyView | null {
  if (isHatching) {
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
      bubbleId,
      hearts,
      level: 0,
      stage: 1,
      visitor: null,
      bugs: 0,
      anxiety: 0,
      isVoid: false,
      flair: '',
      isCompact: prefs.isCompact,
    }
  }
  if (pet === null || bones === null) return null
  const moment = moments.reduce<Moment>((all, m) => ({ ...all, ...m }), { key: '' })
  const look = SPECIES[moment.species ?? bones.species] ?? SPECIES.blob!
  const worn = wornHat()
  const hat = moment.hat === 'party' ? PARTY_HAT : hatRow(worn)

  return {
    name: pet.name,
    species: moment.species ?? bones.species,
    rarity: bones.rarity,
    stars: bones.stars,
    color: bones.color,
    isShiny: bones.isShiny,
    eye: moment.eye ?? pet.eye ?? bones.eye,
    hat,
    frames: look.frames,
    face: look.face,
    mood: moodAt(now),
    bubble,
    bubbleId,
    hearts,
    level: levelOf(xp).level,
    stage: stageOf(levelOf(xp).level),
    visitor: visitor === null ? null : visitorView(visitor),
    bugs,
    anxiety,
    isVoid: moment.isVoid === true,
    flair: pet.sword === true ? '⚔ ' : '',
    isCompact: prefs.isCompact,
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
async function musicTick($: Engine): Promise<void> {
  if (pet === null || isHatching) return
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
      if (isAsleep) {
        isAsleep = false
        lastActivity = now
      }
      excitedUntil = Math.max(excitedUntil, now + 12 * SECOND)
    }
    if (heard.track !== musicTrack) {
      musicTrack = heard.track
      if (heard.bpm !== null && !isAsleep && Math.random() < 0.35) await say($, quip('music', { bpm: heard.bpm, track: heard.track ?? '' }))
    }
  }
  if (beatChanged) await publish($)
}

function moodAt(now: number): Mood {
  if (isHatching) return 'hatching'
  if (isAsleep) return 'asleep'
  if (isFighting) return 'fighting'
  if (now < excitedUntil) return 'excited'
  if (anxiety > 0) return 'anxious'
  if (failStreak >= 3) return 'worried'
  if (fullnessAt(now) < HUNGRY_BELOW) return 'hungry'
  if (now - care.pettedAt < 3 * MINUTE) return 'happy'
  return 'content'
}

function fullnessAt(now: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - ((now - care.fedAt) / STARVES_IN) * 100)))
}

// Talking

async function say($: Engine, text: string, options: { isForced?: boolean; ttl?: number } = {}): Promise<void> {
  if (prefs.isMuted && options.isForced !== true) return
  const now = await $.clock.now()
  if (options.isForced !== true && now - lastSaidAt < QUIET_FOR) return
  lastSaidAt = now
  bubble = text
  const id = ++bubbleId
  await publish($)
  $.clock.after(options.ttl ?? 9 * SECOND, () => {
    if (bubbleId !== id) return
    bubble = null
    void publish($)
  })
}

const pickLine = (lines: readonly string[]): string => lines[Math.floor(Math.random() * lines.length)] ?? '…'

function voice(): Voice {
  return { isSnarky: ['SNARK', 'CHAOS'].includes(rankedNow()[0]), isWise: statOf('WISDOM') >= 60 }
}

function fill(line: string, extra: Record<string, string | number> = {}): string {
  let out = line
    .replaceAll('{name}', pet?.name ?? '')
    .replaceAll('{species}', bones?.species ?? 'pet')
    .replaceAll('{level}', String(levelOf(xp).level))
  for (const [k, v] of Object.entries(extra)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}

function quip(kind: string, extra: Record<string, string | number> = {}): string {
  const pool = QUIPS[kind]
  if (pool === undefined || bones === null) return '…'
  const lines = voice().isSnarky ? pool.snark : pool.sweet

  return fill(pickLine(lines), { days: 0, ...extra })
}

// How the stats shape the voice: one directive per stat that stands out.
function voiceOf(): string {
  if (bones === null) return ''
  const snark = statOf('SNARK')
  const patience = statOf('PATIENCE')
  const chaos = statOf('CHAOS')
  const wisdom = statOf('WISDOM')
  const debugging = statOf('DEBUGGING')
  const lines = [
    snark >= 60
      ? 'You are savage and crude: no mercy, no sugar-coating.'
      : snark >= 25
        ? 'You are dry and sarcastic.'
        : 'You are passive-aggressive: backhanded compliments and pointed sighs, never openly mean.',
    patience >= 60
      ? "You are endlessly patient, so your judgement lands like a disappointed parent's ('I'm not mad, just...')."
      : patience < 25
        ? 'You have no patience at all: exasperated, clipped, the odd SHOUTED word.'
        : '',
    chaos >= 60 ? 'You are chaotic: absurd metaphors, unhinged tangents, non sequiturs.' : chaos < 20 ? 'You are tidy and literal.' : '',
    wisdom >= 60
      ? 'You are wise: slip in one genuinely useful, specific tip.'
      : wisdom < 20
        ? 'You have zero wisdom: you judge, but never offer a single useful tip.'
        : '',
    debugging >= 60
      ? 'You debug for a living: name exactly what concrete information is missing (the error text, a file path, repro steps, expected versus actual).'
      : debugging < 20
        ? 'You notice nothing technical: you judge purely on vibes and tone.'
        : '',
  ]
  const stats = STATS.map(s => `${s} ${statOf(s)}`).join(', ')

  return `Your stats (0-100): ${stats}. ${lines.filter(l => l.length > 0).join(' ')}`
}

function persona(): string {
  if (pet === null || bones === null) return ''
  return `You are ${pet.name}, a ${bones.rarity} ${speciesLabel(bones.species, levelOf(xp).level)} living in a developer's terminal, watching them work with Claude, a coding assistant. Personality: ${pet.personality} ${voiceOf()}`
}

function firstLine(text: string): string | null {
  const line = text
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0)
  if (line === undefined || pet === null) return null
  return line.replace(new RegExp(`^${escapeRegExp(pet.name)}\\s*:\\s*`, 'i'), '').replace(/^["“']|["”']$/g, '')
}

async function ask($: Engine, system: string, prompt: string, options: { isBig?: boolean; maxTokens?: number; timeoutMs?: number } = {}): Promise<string | null> {
  if (!prefs.isSmart) return null
  try {
    const reply = await $.model.complete({
      model: options.isBig === true ? BIG_MODEL : MODEL,
      system,
      prompt,
      maxTokens: options.maxTokens ?? 400,
      effort: options.isBig === true ? 'medium' : 'low',
      timeoutMs: options.timeoutMs ?? 10 * SECOND,
    })
    return reply.isAnswered ? reply.text : null
  } catch {
    return null
  }
}

function jsonOf(text: string | null): Record<string, unknown> {
  if (text === null) return {}
  try {
    const json = text.match(/\{[\s\S]*\}/)?.[0]
    return asObject(json === undefined ? null : JSON.parse(json))
  } catch {
    return {}
  }
}

async function smartLine($: Engine, situation: string): Promise<string | null> {
  if (pet === null || bones === null) return null
  const system =
    `${persona()} Mood: ${moodAt(await $.clock.now())}. Write ONE line of at most 70 characters in ${pet.name}'s ` +
    `voice, specific to what just happened; tease the work, never who they are. No hashtags, no quotes around it; ` +
    `*actions* in asterisks are fine. Use the language the developer writes in.`
  const reply = await ask($, system, `${situation}\n\n${pet.name} says:`)
  const line = reply === null ? null : firstLine(reply)

  return line === null ? null : clip(line, 90)
}

async function answer($: Engine, text: string): Promise<void> {
  const line = (await smartLine($, `The developer just said to you: "${clip(text, 300)}"`)) ?? quip('addressed')
  await say($, line, { isForced: true, ttl: 12 * SECOND })
  const t = await count($, 'addressed', 1)
  if (t.addressed >= 25) await award($, 'socialite')
}

async function quackBack($: Engine): Promise<void> {
  if (bones === null) return
  const isDuckish = bones.species === 'duck' || bones.species === 'goose'
  await say($, isDuckish ? 'QUACK!!' : `*${bones.species} noises* …quack?`, { isForced: true })
  await play($, 'quack')
  await award($, 'duck-whisperer')
}

// Judging your prompts

async function shouldJudge($: Engine, text: string): Promise<boolean> {
  if (prefs.judge === 'off' || prefs.isMuted || text.trim().startsWith('/')) return false
  if (prefs.judge === 'always') return true
  const now = await $.clock.now()
  if (now - lastJudgedAt < JUDGE_EVERY) return false
  // A prompt with an obvious sin is far more likely to get called out.
  return Math.random() < (sinOf(text) === null ? 0.25 : 0.7)
}

async function judge($: Engine, text: string): Promise<void> {
  const now = await $.clock.now()
  lastJudgedAt = now
  // Now and then, more often for a wise pet, it borrows a bigger brain.
  const isBig = prefs.isSmart && now - lastBigAt > BIG_EVERY && Math.random() < 0.03 + statOf('WISDOM') / 250
  if (isBig) lastBigAt = now
  const verdict =
    (isBig ? await smartVerdict($, text, true) : null) ?? (await smartVerdict($, text, false)) ?? localVerdict(text, voice())
  await deliver($, verdict, text)
}

async function deliver($: Engine, verdict: Verdict, prompt: string): Promise<void> {
  const history = await judgedHistory($)
  const at = await $.clock.now()
  const entry: Judged = { grade: verdict.grade, line: verdict.line, at, prompt: clip(prompt, 240) }
  await $.store.set('verdicts', [...history, entry].slice(-100))
  facts.grades.push(verdict.grade)
  await nudge($, 'SNARK', 0.2)
  const brain = verdict.fix === undefined ? '' : '🧠 '
  await say($, `${brain}${verdict.grade} · ${verdict.line}`, { isForced: true, ttl: 15 * SECOND })
  await speak($, verdict.line)
  if (verdict.fix !== undefined && pet !== null) {
    $.ui.log(`🧠 ${pet.name} borrowed a bigger brain. Your prompt, rewritten:\n${verdict.fix}`)
  }
  if (verdict.grade.startsWith('F')) await award($, 'dunce')
  const recent = [...history, entry]
  if (recent.length >= 10 && recent.reduce((s, v) => s + pointsOf(v.grade), 0) / recent.length >= 3.5) await award($, 'honor-roll')
}

async function judgedHistory($: Engine): Promise<Judged[]> {
  const judged = await $.store.get('verdicts')
  return Array.isArray(judged) ? (judged as Judged[]) : []
}

async function smartVerdict($: Engine, text: string, isBig: boolean): Promise<Verdict | null> {
  if (!prefs.isSmart || pet === null || bones === null) return null
  const shape = isBig
    ? `{"grade": "<A+ to F>", "roast": "<one line, at most 80 characters>", "fix": "<the prompt rewritten the way it should have been sent: the same ask, in the developer's language, with what was missing marked as [placeholders]; at most 400 characters>"}`
    : `{"grade": "<A+ to F>", "roast": "<one line, at most 80 characters>"}`
  const system =
    `${persona()} Right now you judge the prompt the developer just sent to Claude and roast the vibecoder behind ` +
    `the keyboard for it, in the voice your stats give you. Grade the prompting craft: a clear ask, context (files, ` +
    `the actual error, expected behaviour), constraints, a definition of done. Vagueness ("fix it", "doesn't work"), ` +
    `missing error messages, walls of text, yelling, begging and five asks at once cost grades. Crude language is ` +
    `fine. Mock the prompt and the habits behind it, never who they are. If the prompt is genuinely good, admit it ` +
    `grudgingly. Write in the language the prompt is written in. Answer with JSON only: ${shape}`
  const parsed = jsonOf(
    await ask($, system, `The prompt:\n"""\n${text.slice(0, 1500)}\n"""`, {
      isBig,
      maxTokens: isBig ? 4000 : 400,
      timeoutMs: (isBig ? 45 : 10) * SECOND,
    }),
  )
  const grade = typeof parsed.grade === 'string' ? parsed.grade.trim().toUpperCase() : ''
  const roast = typeof parsed.roast === 'string' ? clip(parsed.roast, 90) : ''
  const fix = typeof parsed.fix === 'string' ? parsed.fix.trim().slice(0, 600) : ''
  if (!GRADES.test(grade) || roast.length === 0) return null

  return isBig && fix.length > 0 ? { grade, line: roast, fix } : { grade, line: roast }
}

async function verdictReport($: Engine): Promise<string> {
  const history = await judgedHistory($)
  const commits = await commitHistory($)
  const claude = await claudeHistory($)
  const mode = `Judging: ${prefs.judge}${prefs.isSmart ? ' (Haiku writes the roasts)' : ' (phrasebook roasts)'}.`
  if (history.length === 0 && commits.length === 0 && claude.length === 0) return `${mode} No prompts judged yet. /buddy judge always|sometimes|off`

  return [
    `${mode} Prompting GPA ${gpaOf(history) ?? 'n/a'} over ${history.length} judged prompts` +
      (commits.length > 0 ? ` · commit GPA ${gpaOf(commits)} over ${commits.length} commits` : '') +
      (claude.length > 0 ? ` · Claude's GPA ${gpaOf(claude)} over ${claude.length} answers` : '') +
      '.',
    '',
    ...history.slice(-5).map(v => `- **${v.grade}** ${v.line}`),
    ...commits.slice(-3).map(v => `- ✍️ **${v.grade}** ${v.line}`),
    ...claude.slice(-3).map(v => `- 🤖 **${v.grade}** ${v.line}`),
    '',
    '/buddy judge always|sometimes|off · /buddy roast · /buddy review · /buddy shame · /buddy fix',
  ].join('\n')
}

// Judging your commit messages

async function commitHistory($: Engine): Promise<Judged[]> {
  const stored = await $.store.get('commitVerdicts')
  return Array.isArray(stored) ? (stored as Judged[]) : []
}

async function judgeCommit($: Engine, command: string): Promise<void> {
  const message = commitMessageOf(command)
  if (message === null || prefs.isMuted) return
  const now = await $.clock.now()
  if (now - lastCommitJudgedAt < COMMIT_JUDGE_EVERY) return
  lastCommitJudgedAt = now
  const verdict = (await smartCommitVerdict($, message)) ?? localCommitVerdict(message, voice())
  const history = await commitHistory($)
  await $.store.set('commitVerdicts', [...history, { grade: verdict.grade, line: verdict.line, at: now, prompt: clip(message, 120) }].slice(-50))
  await say($, `✍️ ${verdict.grade} · ${verdict.line}`, { isForced: true, ttl: 15 * SECOND })
  await speak($, verdict.line)
}

async function smartCommitVerdict($: Engine, message: string): Promise<Verdict | null> {
  if (!prefs.isSmart || pet === null) return null
  const system =
    `${persona()} Right now you judge the commit message the developer just wrote, and roast the vibecoder behind ` +
    `the keyboard for it in the voice your stats give you. Grade the craft: an imperative subject line under 72 ` +
    `characters that says what and where ("fix", not "fixed"), a body that says why when the change needs one, no ` +
    `"wip", "fix stuff" or "update". Crude language is fine; mock the message, never who they are. A genuinely good ` +
    `message gets a grudging A. Write in the language the message is written in. Answer with JSON only: ` +
    `{"grade": "<A+ to F>", "roast": "<one line, at most 80 characters>"}`
  const parsed = jsonOf(await ask($, system, `The commit message:\n"""\n${message.slice(0, 1200)}\n"""`))
  const grade = typeof parsed.grade === 'string' ? parsed.grade.trim().toUpperCase() : ''
  const roast = typeof parsed.roast === 'string' ? clip(parsed.roast, 90) : ''

  return GRADES.test(grade) && roast.length > 0 ? { grade, line: roast } : null
}

// The big brain, on demand

async function sessionPrompts($: Engine): Promise<string[]> {
  const note = pet === null ? null : new RegExp(`${escapeRegExp(pet.name)} is the user's terminal pet[\\s\\S]*$`)
  try {
    return (await $.session.messages())
      .filter(m => m.role === 'user' && (m.toolResults?.length ?? 0) === 0)
      .map(m => {
        const text = m.text.split('<system-reminder>')[0] ?? ''
        return (note === null ? text : text.replace(note, '')).trim()
      })
      .filter(t => t.length > 0 && !t.startsWith('<') && !t.startsWith('/'))
  } catch {
    return []
  }
}

async function roastLast($: Engine): Promise<string> {
  if (pet === null) return 'Still hatching…'
  const last = (await sessionPrompts($)).at(-1) ?? lastPrompt.trim()
  if (last.length === 0) return `${pet.name} hasn't seen a prompt from you yet this session.`
  if (!prefs.isSmart) {
    const verdict = localVerdict(last, voice())
    await deliver($, verdict, last)
    return `**${verdict.grade}** · ${verdict.line}\n\n(Phrasebook roast: /buddy smart on lets ${pet.name} borrow a bigger brain.)`
  }
  $.ui.toast(`🧠 ${pet.name} is borrowing a bigger brain…`)
  lastBigAt = await $.clock.now()
  const verdict = (await smartVerdict($, last, true)) ?? localVerdict(last, voice())
  await deliver($, verdict, last)
  await nudge($, 'WISDOM', 0.75)

  return [
    `**${verdict.grade}** · ${verdict.line}`,
    ...(verdict.fix === undefined ? [] : ['', 'What you should have sent:', '', '```', verdict.fix, '```']),
  ].join('\n')
}

async function review($: Engine): Promise<string> {
  if (pet === null || bones === null) return 'Still hatching…'
  const prompts = (await sessionPrompts($)).slice(-15)
  if (prompts.length < 2) return `${pet.name} needs at least two of your prompts this session to review.`
  if (!prefs.isSmart) return `The review needs a model: /buddy smart on, then /buddy review.`

  const gpa = gpaOf(await judgedHistory($))
  const system =
    `${persona()} For this review you borrowed a much bigger brain, so whatever your stats say, the advice itself ` +
    `must be genuinely useful; only the voice is yours. Review how the developer prompts Claude across the prompts ` +
    `below, and roast the vibecoder behind the keyboard while coaching them. Mock the habits, never who they are; ` +
    `crude language is fine. Write markdown in the language they write in, under 250 words: an overall grade (A+ ` +
    `to F) with a one-line verdict; their three worst habits, each with a short quote from their prompts and the ` +
    `fix; their worst prompt rewritten the way it should have been sent; one thing they do well, admitted grudgingly.`
  const listed = prompts.map((p, i) => `${i + 1}. """${p.slice(0, 800)}"""`).join('\n')
  $.ui.toast(`🧠 ${pet.name} is borrowing a bigger brain to review your prompts…`)
  const reply = await ask(
    $,
    system,
    `Their prompts this session, oldest first:\n${listed}${gpa === null ? '' : `\n\nTheir running prompting GPA: ${gpa}.`}`,
    { isBig: true, maxTokens: 8000, timeoutMs: 90 * SECOND },
  )
  if (reply === null) return `${pet.name} couldn't reach the bigger brain. Try again in a bit.`
  lastBigAt = await $.clock.now()
  await count($, 'reviews', 1)
  await award($, 'big-brain')
  await nudge($, 'WISDOM', 0.75)
  await say($, 'read it and weep', { isForced: true })

  return `**${pet.name}'s prompting review** (big brain: Opus)\n\n${reply.trim()}`
}

// The Hall of Shame: on Fridays, the week's worst prompt roasted and its best crowned

function weekKey(now: number): string {
  const d = new Date(now)
  const day = (d.getDay() + 6) % 7
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day)
  return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`
}

async function fridayCeremony($: Engine): Promise<void> {
  if (pet === null) return
  const now = await $.clock.now()
  if (new Date(now).getDay() !== 5) return
  if (asObject(await $.store.get('shame')).week === weekKey(now)) return
  const text = await ceremony($, now)
  if (text === null) return
  $.ui.toast(`🏆 It's Friday: the Hall of Shame is out. /buddy shame`)
  await say($, "the hall of shame is out. you're in it.", { isForced: true, ttl: 15 * SECOND })
  await speak($, "the hall of shame is out. you're in it.")
}

async function ceremony($: Engine, now: number): Promise<string | null> {
  if (pet === null || bones === null || !prefs.isSmart) return null
  const week = (await judgedHistory($)).filter(v => v.prompt !== undefined && now - v.at < 7 * DAY)
  if (week.length < 5) return null
  const sorted = [...week].sort((a, b) => pointsOf(a.grade) - pointsOf(b.grade))
  const worst = sorted[0]!
  const best = sorted[sorted.length - 1]!
  const middle = sorted.slice(1, -1).slice(0, 4)
  const quote = (v: Judged) => `[${v.grade}] """${v.prompt ?? ''}"""`
  const system =
    `${persona()} For this you borrowed a much bigger brain. It is Friday: hold this week's Hall of Shame for the ` +
    `vibecoder behind the keyboard, in the voice your stats give you. Markdown, under 220 words, in the language ` +
    `their prompts are written in: a title with the week; the Worst Prompt of the Week, quoted (shortened if long) ` +
    `and roasted hard but about the habit, never the person, with the one change that would have fixed it; the ` +
    `Best Prompt of the Week, quoted and crowned, praise admitted grudgingly; one line on the week's trend. Crude ` +
    `language is fine.`
  const prompt =
    `Week's prompting GPA: ${gpaOf(week)}. Judged prompts: ${week.length}.\n\nWorst: ${quote(worst)}\n\nBest: ${quote(best)}\n\n` +
    `Others: ${middle.map(quote).join('\n')}`
  const reply = await ask($, system, prompt, { isBig: true, maxTokens: 6000, timeoutMs: 90 * SECOND })
  if (reply === null) return null
  const text = `🏆 **${pet.name}'s Hall of Shame** (week of ${weekKey(now)}, by Opus)\n\n${reply.trim()}`
  await $.store.set('shame', { week: weekKey(now), at: now, pet: pet.name, text })
  await nudge($, 'SNARK', 0.5)

  return text
}

async function shameReport($: Engine): Promise<string> {
  if (pet === null) return 'Still hatching…'
  const now = await $.clock.now()
  const stored = asObject(await $.store.get('shame'))
  if (stored.week === weekKey(now) && typeof stored.text === 'string') return stored.text
  if (!prefs.isSmart) return 'The Hall of Shame needs a model: /buddy smart on first.'
  $.ui.toast(`🧠 ${pet.name} is convening the Hall of Shame…`)
  const text = await ceremony($, now)
  if (text !== null) return text
  const judged = (await judgedHistory($)).filter(v => v.prompt !== undefined && now - v.at < 7 * DAY).length

  return `The Hall of Shame needs 5 judged prompts from the last 7 days; you have ${judged}. ${pet.name} opens it every Friday.`
}

// Reacting to the session

async function wake($: Engine, shouldGreet: boolean): Promise<void> {
  lastActivity = await $.clock.now()
  if (!isAsleep) return
  isAsleep = false
  if (shouldGreet) await say($, quip('wake'), { isForced: !prefs.isMuted })
  await publish($)
}

async function afterTool(
  $: Engine,
  tool: string,
  command: string,
  path: string,
  ran: { deny?: string; isError?: true; text?: string },
): Promise<void> {
  if (pet === null || isHatching) return
  await wake($, false)
  await gainXp($, 1)
  facts.tools += 1

  const isDenied = ran.deny !== undefined || (ran.isError === true && REJECTED.test(ran.text ?? ''))
  const isFailed = !isDenied && ran.isError === true
  const isTestRun = tool === 'Bash' && TESTS.test(command)
  turnTools.push({ tool, isFailed })

  if (isDenied) {
    if (Math.random() < 0.7) await say($, quip('denied'))
  } else if (isFailed) {
    failStreak += 1
    facts.fails += 1
    await nudge($, 'PATIENCE', 0.15)
    if (isTestRun) await bugCrawls($)
    else if (failStreak === 3) await say($, quip('worried'), { isForced: !prefs.isMuted })
    else if (Math.random() < 0.4) await say($, quip('fail'))
  } else {
    if (failStreak >= 5) await award($, 'comeback')
    failStreak = 0
    if (isTestRun) await testsPassed($)
    else if (tool === 'Bash' && COMMIT.test(command)) await committed($, command)
    else if (!(await react($, tool, command, path)) && (tool === 'Edit' || tool === 'Write') && Math.random() < 0.08) await say($, quip('edit'))
  }
  await publish($)
}

async function testsPassed($: Engine): Promise<void> {
  facts.greens += 1
  const t = await count($, 'greens', 1)
  await nudge($, 'DEBUGGING', 0.3)
  if (bugs > 0) await eatBugs($)
  else {
    await celebrate($, 'tests')
    await play($, 'quack')
  }
  if (t.greens === 1) await award($, 'first-green')
  await completeQuest($, 'green')
}

async function committed($: Engine, command: string): Promise<void> {
  facts.commits += 1
  const t = await count($, 'commits', 1)
  await celebrate($, 'commit')
  const hour = new Date(await $.clock.now()).getHours()
  if (hour >= 2 && hour < 5) await award($, 'night-owl')
  if (t.commits >= 50) await award($, 'committed')
  const message = commitMessageOf(command)
  if (message !== null && message.split('\n').slice(1).join('\n').trim().length >= 20) await completeQuest($, 'body')
  $.clock.after(4 * SECOND, () => void judgeCommit($, command))
  $.clock.after(9 * SECOND, () => void mainBranchNag($))
}

async function celebrate($: Engine, kind: 'tests' | 'commit'): Promise<void> {
  const now = await $.clock.now()
  excitedUntil = now + 15 * SECOND
  await say($, quip(kind), { isForced: !prefs.isMuted })
  $.clock.after(16 * SECOND, () => void publish($))
}

async function afterTurn($: Engine, turn: { reason: string; durationMs: number; answer: string }): Promise<void> {
  await gainXp($, 3)
  const now = await $.clock.now()
  facts.longestTurnMs = Math.max(facts.longestTurnMs, turn.durationMs)
  if (turn.durationMs > 10 * MINUTE) await award($, 'marathon')

  if (turn.reason === 'aborted') {
    await nudge($, 'CHAOS', 0.3)
    if (Math.random() < 0.6) await say($, quip('aborted'))
    return
  }
  if (turn.reason === 'error') {
    await say($, quip('error'))
    return
  }
  if (turn.reason === 'answer' && (await shouldJudgeClaude($, now))) {
    await judgeClaude($, turn.answer)
    return
  }
  if (prefs.isMuted || now - lastSaidAt < QUIET_FOR) return

  const isLong = turn.durationMs > 3 * MINUTE
  if (prefs.isSmart && now - lastSmartAt > SMART_EVERY && (isLong || Math.random() < 0.35)) {
    lastSmartAt = now
    const line = await smartLine($, describeTurn(turn))
    if (line !== null) {
      await say($, line, { ttl: 12 * SECOND })
      return
    }
  }
  if (isLong) await say($, quip('longTurn'))
}

function describeTurn(turn: { durationMs: number; answer: string }): string {
  const counts = new Map<string, { runs: number; failed: number }>()
  for (const { tool, isFailed } of turnTools) {
    const c = counts.get(tool) ?? { runs: 0, failed: 0 }
    c.runs += 1
    if (isFailed) c.failed += 1
    counts.set(tool, c)
  }
  const tools =
    [...counts]
      .map(([tool, c]) => `${tool}×${c.runs}${c.failed > 0 ? ` (${c.failed} failed)` : ''}`)
      .join(', ') || 'none'

  return [
    `What just happened in the terminal:`,
    `The developer asked Claude: "${clip(lastPrompt, 240)}"`,
    `Tools Claude ran: ${tools}. The turn took ${Math.round(turn.durationMs / SECOND)}s.`,
    `Claude's answer began: "${clip(turn.answer, 300)}"`,
  ].join('\n')
}

async function tick($: Engine): Promise<void> {
  if (pet === null || isHatching) return
  const now = await $.clock.now()
  tickCount += 1

  if (visitor !== null && now >= visitor.until && !isFighting) await guestLeaves($)
  if (tickCount % 2 === 0) await checkAnxiety($)
  if (tickCount % GIT_EVERY_TICKS === 0) await gitCheckAndNag($)
  await checkMoments($)

  if (!isAsleep && now - lastActivity > NAP_AFTER) {
    isAsleep = true
    bubble = null
  } else if (!isAsleep) {
    if (fullnessAt(now) < HUNGRY_BELOW && now - lastHungerNag > 45 * MINUTE) {
      lastHungerNag = now
      await say($, quip('hungry'))
    } else if (shouldWild(now)) {
      await wildAppears($)
    } else if (shouldVisit(now)) {
      await visit($, pickOther())
    } else if (shouldYap(now)) {
      lastNewsAt = now
      await yapNews($, false)
    } else if (now - lastSaidAt > 6 * MINUTE && Math.random() < 0.08) {
      await say($, quip('idle'))
    }
  }
  await publish($)
}

// The context window: the pet sweats as it fills, and begs for a /compact near the end.
async function checkAnxiety($: Engine): Promise<void> {
  let pct = 0
  try {
    pct = (await $.session.usage()).context.percent ?? 0
  } catch {
    return
  }
  anxiety = pct >= 85 ? 2 : pct >= 70 ? 1 : 0
  if (anxiety === 0) anxietySaid = 0
  if (anxiety > anxietySaid && !isAsleep) {
    anxietySaid = anxiety
    const lines = ANXIOUS[anxiety]
    if (lines !== undefined) await say($, fill(pickLine(voice().isSnarky ? lines.snark : lines.sweet), { pct }), { isForced: !prefs.isMuted, ttl: 15 * SECOND })
  }
}

async function checkMoments($: Engine): Promise<void> {
  if (pet === null || bones === null) return
  const now = await $.clock.now()
  moments = momentsAt(now, pet, bones.species, Object.keys(SPECIES))
  for (const m of moments) {
    if (m.line === undefined || saidMoments.has(m.key)) continue
    saidMoments.add(m.key)
    await say($, m.line, { isForced: true, ttl: 12 * SECOND })
  }
}

// AI news, yapped: the day's AI stories off Hacker News, one hot take at a time

function shouldYap(now: number): boolean {
  if (!prefs.hasNews || prefs.isMuted || bones === null) return false
  // Only to someone who is around, not in the session's first minutes, and rarely.
  if (now - lastActivity > 5 * MINUTE || now - sessionStartedAt < 5 * MINUTE) return false
  if (now - lastNewsAt < NEWS_EVERY || now - lastSaidAt < 2 * MINUTE) return false
  return Math.random() < 0.2
}

async function todaysStories($: Engine): Promise<Story[]> {
  const now = await $.clock.now()
  const cached = asObject(await $.store.get('news'))
  const kept = Array.isArray(cached.stories) ? (cached.stories as Story[]) : []
  if (typeof cached.fetchedAt === 'number' && now - cached.fetchedAt < NEWS_FRESH_FOR) return kept

  const since = Math.floor(now / SECOND) - 24 * 60 * 60
  const filters = encodeURIComponent(`created_at_i>${since},points>=40`)
  try {
    const response = await $.http.fetch(`https://hn.algolia.com/api/v1/search?tags=story&numericFilters=${filters}&hitsPerPage=100`)
    if (!response.ok) return kept
    const hits = asObject(JSON.parse(response.text)).hits
    const stories = (Array.isArray(hits) ? hits : [])
      .map(asObject)
      .filter(h => typeof h.title === 'string' && AI.test(h.title))
      .map(h => {
        const id = String(h.objectID)
        return {
          id,
          title: String(h.title).replace(/[[\]]/g, ''),
          url: typeof h.url === 'string' && h.url.length > 0 ? h.url : `https://news.ycombinator.com/item?id=${id}`,
          points: Number(h.points) || 0,
          comments: Number(h.num_comments) || 0,
        }
      })
      .sort((a, b) => b.points - a.points)
      .slice(0, 15)
    await $.store.set('news', { fetchedAt: now, stories })

    return stories
  } catch {
    return kept
  }
}

async function yapNews($: Engine, isAsked: boolean): Promise<Story | null> {
  if (pet === null) return null
  const stories = await todaysStories($)
  const stored = await $.store.get('newsSeen')
  const seen = Array.isArray(stored) ? (stored as string[]) : []
  const story = stories.find(s => !seen.includes(s.id)) ?? (isAsked ? stories[0] : undefined)
  if (story === undefined) return null
  await $.store.set('newsSeen', [...seen.filter(id => id !== story.id), story.id].slice(-300))
  facts.news += 1
  await nudge($, 'CHAOS', 0.1)

  const take = (await smartTake($, story)) ?? localTake(story)
  await say($, `📰 ${take}`, { isForced: true, ttl: 20 * SECOND })
  if (!isAsked) $.ui.log(`📰 ${pet.name} is yapping about: ${story.title} · ${story.url} (${story.points} points on Hacker News)`)

  return story
}

async function smartTake($: Engine, story: Story): Promise<string | null> {
  if (pet === null || bones === null) return null
  const system =
    `${persona()} You just read an AI headline and can't keep it to yourself. Write ONE line of at most 90 ` +
    `characters that says what happened (paraphrased, so it makes sense on its own) and gives your hot take: ` +
    `full hype ("we're so back", AGI by Tuesday) or full doom ("it's so over"), whichever the news and your ` +
    `stats push you to; high CHAOS goes off the rails. Overdramatic is the point. You only know the headline: ` +
    `invent no details. No hashtags, no quotes around it.`
  const reply = await ask($, system, `Headline: "${story.title}" (${story.points} points, ${story.comments} comments on Hacker News)\n\n${pet.name} says:`)
  const line = reply === null ? null : firstLine(reply)

  return line === null ? null : clip(line, 110)
}

const HYPE = ["we're so back", 'AGI by tuesday', 'accelerate!!', 'this changes everything (again)', 'the singularity is near-ish']
const DOOM = ["it's so over", 'pack it up, folks', 'I, for one, welcome our new overlords', 'bunker time', 'we had a good run']
const DOOMY = /\b(ban|bans|banned|fire[sd]?|lawsuit|sues?|leak\w*|layoffs?|risk|safety|danger\w*|less than|cuts?|fail\w*|bubble|warn\w*|crash\w*|down|bunker|quits?|resign\w*)\b/i

function localTake(story: Story): string {
  return `${clip(story.title, 60)}… ${pickLine(DOOMY.test(story.title) ? DOOM : HYPE)}`
}

async function newsReport($: Engine): Promise<string> {
  if (pet === null) return 'Still hatching…'
  const stories = await todaysStories($)
  if (stories.length === 0) {
    return `${pet.name} found no AI news on Hacker News in the last 24 hours, or couldn't reach it. Suspiciously quiet…`
  }
  lastNewsAt = await $.clock.now()
  await yapNews($, true)

  return [
    `**Today's AI news, as ${pet.name} reads it** (Hacker News, last 24 hours)`,
    '',
    ...stories
      .slice(0, 8)
      .map(s => `- [${s.title}](${s.url}) · ${s.points} points · [${s.comments} comments](https://news.ycombinator.com/item?id=${s.id})`),
    '',
    prefs.hasNews
      ? `${pet.name} yaps about one of these now and then. /buddy news off to stop.`
      : `/buddy news on to have ${pet.name} yap about these on its own.`,
  ].join('\n')
}

// Visitors: another pet from the collection drops by for a chat

function pickOther(): PetRecord | null {
  const others = collection.filter(p => p.id !== pet?.id)
  return others[Math.floor(Math.random() * others.length)] ?? null
}

function shouldVisit(now: number): boolean {
  if (visitor !== null || isFighting || prefs.isMuted || collection.length < 2) return false
  if (now - lastActivity > 5 * MINUTE || now - sessionStartedAt < 10 * MINUTE) return false
  if (now - lastVisitAt < VISIT_EVERY || now - lastSaidAt < 2 * MINUTE) return false
  return Math.random() < 0.12
}

async function startVisit($: Engine, record: PetRecord, kind: VisitorKind, lasts: number): Promise<void> {
  const now = await $.clock.now()
  visitor = { record, kind, until: now + lasts }
  lastVisitAt = now
  await publish($)
}

async function visit($: Engine, record: PetRecord | null): Promise<void> {
  if (record === null || pet === null) return
  await startVisit($, record, 'visit', VISIT_FOR)
  facts.visits += 1
  const relation = relationOf(await bumpBond($, pet.id, record.id, 'visits'))
  const lines = (await smartBanter($, record, relation)) ?? localBanter(record, relation)
  await say($, lines[0], { isForced: true, ttl: 7 * SECOND })
  $.clock.after(7 * SECOND, () => void say($, lines[1], { isForced: true, ttl: 8 * SECOND }))
  await completeQuest($, 'visit')
}

function localBanter(guest: PetRecord, relation: Relation): [string, string] {
  const pool = relation === 'rival' ? RIVAL_BANTER : relation === 'friend' ? FRIEND_BANTER : voice().isSnarky ? BANTER.snark : BANTER.sweet
  const [v, h] = pool[Math.floor(Math.random() * pool.length)] ?? ['{v}: hi', '{h}: hi']
  const names = { v: guest.name, h: pet?.name ?? '', vspecies: bonesOf(guest).species }
  return [fill(v, names), fill(h, names)]
}

async function smartBanter($: Engine, guest: PetRecord, relation: Relation): Promise<[string, string] | null> {
  if (pet === null || bones === null) return null
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

  return v.length > 0 && h.length > 0 ? [`${guest.name}: ${v}`, `${pet.name}: ${h}`] : null
}

async function guestLeaves($: Engine): Promise<void> {
  if (visitor === null) return
  const leaving = visitor
  visitor = null
  if (leaving.kind === 'wild') await say($, "it's gone. you blinked.", { isForced: !prefs.isMuted })
  else if (leaving.kind === 'visit') await say($, `${leaving.record.name} wandered off`, { ttl: 5 * SECOND })
  await publish($)
}

// Wild shinies: rarely, one wanders across the band; /buddy catch within 30 seconds keeps it

function shouldWild(now: number): boolean {
  if (visitor !== null || isFighting || now - lastActivity > 5 * MINUTE) return false
  if (now - sessionStartedAt < 10 * MINUTE || now - lastWildAt < WILD_EVERY) return false
  // Drawn from the clock, so every tick has its own fixed luck.
  return mulberry32(Math.floor(now / (30 * SECOND)))() < WILD_ODDS
}

async function wildAppears($: Engine): Promise<void> {
  const now = await $.clock.now()
  const seed = randomSeed()
  const wild: PetRecord = { id: `w${seed.toString(36)}`, seed, name: '???', personality: '', hatchedAt: now, isShiny: true, isWild: true }
  lastWildAt = now
  visitor = { record: wild, kind: 'wild', until: now + WILD_WINDOW }
  await publish($)
  await play($, 'pop')
  $.ui.toast(`✨ A wild shiny ${roll(seed).species} wanders by! /buddy catch (30 seconds)`)
  await say($, "ooh. shiny. don't just sit there", { isForced: true, ttl: 10 * SECOND })
}

async function catchWild($: Engine): Promise<string> {
  if (pet === null) return 'Still hatching…'
  if (visitor === null || visitor.kind !== 'wild') return 'Nothing to catch right now. Keep your eyes peeled: shinies wander by now and then.'
  const wild = visitor.record
  visitor = null
  const rolled = bonesOf(wild)
  const soul = await nameFor($, rolled, wild.seed, collection.map(p => p.name))
  const caught: PetRecord = { ...wild, ...soul }
  await adopt($, caught)
  await count($, 'shinies', 1)
  await award($, 'shiny-hunter')
  await play($, 'fanfare')
  $.ui.toast(`✨ You caught ${caught.name}, a shiny ${rolled.species}! It joins the collection.`)
  await say($, `${caught.name}! welcome to the chaos`, { isForced: true })

  return `✨ **Caught!** ${caught.name}, a shiny ${rolled.rarity} ${rolled.species}, joins your collection (${collection.length} pets). *${caught.personality}*`
}

// Battles: three rounds on random stats, narrated in the bubble

async function statsFor($: Engine, record: PetRecord): Promise<Record<Stat, number>> {
  if (pet !== null && record.id === pet.id) return Object.fromEntries(STATS.map(s => [s, statOf(s)])) as Record<Stat, number>
  const b = bonesOf(record)
  const level = levelOf(Number((await $.store.get(key('xp', record.id))) ?? 0) || 0).level
  const d = { ...zeroDrift(), ...driftOf(await $.store.get(key('drift', record.id))) }

  return Object.fromEntries(STATS.map(s => [s, clampStat(b.stats[s] + Math.floor((level - 1) / 2) + Math.round(d[s]))])) as Record<Stat, number>
}

async function battle($: Engine, wanted: string): Promise<string> {
  if (pet === null) return 'Still hatching…'
  if (isFighting) return 'A battle is already on. Watch the bubble.'
  const others = collection.filter(p => p.id !== pet.id)
  if (others.length === 0) return `${pet.name} has nobody to fight yet. Hatch another pet first.`
  const name = wanted.toLowerCase()
  const foe = others.find(p => p.name.toLowerCase() === name) ?? others.find(p => p.name.toLowerCase().startsWith(name))
  if (name === '' || foe === undefined) return `Battle whom? ${others.map(p => p.name).join(', ')}.`

  const me: Fighter = { name: pet.name, stats: armed(await statsFor($, pet), pet) }
  const them: Fighter = { name: foe.name, stats: armed(await statsFor($, foe), foe) }
  const bout = fight(me, them, Math.random)
  const id = ++battleId
  isFighting = true
  const relation = relationOf(await bumpBond($, pet.id, foe.id, 'fights'))
  await startVisit($, foe, 'battle', 60 * SECOND)
  const story = (await smartBattle($, bout, foe, relation)) ?? localBattle(bout, me.name, them.name)
  await say($, `⚔️ ${story.rounds[0] ?? ''}`, { isForced: true, ttl: 5 * SECOND })
  story.rounds.slice(1).forEach((line, i) => $.clock.after((i + 1) * 4 * SECOND, () => void say($, `⚔️ ${line}`, { isForced: true, ttl: 5 * SECOND })))
  $.clock.after(12 * SECOND, () => void settleBattle($, id, bout, foe, story.closing))

  return `⚔️ **${pet.name} challenges ${foe.name}!**${relation === 'rival' ? ' A grudge match.' : ''} Three rounds, best of stats. Watch the bubble; the result comes in a moment.`
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
  if (pet === null || bones === null) return null
  const fb = bonesOf(foe)
  const grudge = relation === 'rival' ? 'This is a grudge match between old rivals. ' : ''
  const rounds = bout.rounds
    .map((r, i) => `Round ${i + 1}, ${r.stat}: ${pet?.name} ${r.a} vs ${foe.name} ${r.b}, ${r.winner === 'a' ? pet?.name : foe.name} wins`)
    .join('; ')
  const system =
    `${persona()} You are fighting ${foe.name}, another of the developer's pets (a ${fb.rarity} ${fb.species}; ` +
    `personality: ${foe.personality || 'unknown'}). ${grudge}You narrate it yourself like an over-the-top sports ` +
    `commentator, in your own voice. One line per round naming the stat and who took it, and one closing line ` +
    `for the result (gracious or sore, as your stats dictate); each at most 80 characters, no hashtags. ` +
    `Answer with JSON only: {"rounds": ["...", "...", "..."], "closing": "..."}`
  const result = bout.winner === 'a' ? `${pet.name} wins ${bout.score[0]}-${bout.score[1]}` : `${foe.name} wins ${bout.score[1]}-${bout.score[0]}`
  const parsed = jsonOf(await ask($, system, `${rounds}. Result: ${result}.`, { maxTokens: 700 }))
  const lines = Array.isArray(parsed.rounds) ? parsed.rounds.filter((l): l is string => typeof l === 'string').map(l => clip(l, 90)) : []
  const closing = typeof parsed.closing === 'string' ? clip(parsed.closing, 90) : ''

  return lines.length === 3 && closing.length > 0 ? { rounds: lines, closing } : null
}

async function settleBattle($: Engine, id: number, bout: Bout, foe: PetRecord, closing: string): Promise<void> {
  if (id !== battleId || pet === null) return
  const iWon = bout.winner === 'a'
  facts.battles += 1
  await gainXp($, iWon ? 10 : 3)
  const foeXp = Number((await $.store.get(key('xp', foe.id))) ?? 0) || 0
  await $.store.set(key('xp', foe.id), foeXp + (iWon ? 3 : 10))
  await bumpRecord($, pet.id, iWon)
  await bumpRecord($, foe.id, !iWon)
  if (iWon) {
    const t = await count($, 'battlesWon', 1)
    if (t.battlesWon >= 5) await award($, 'champion')
    await completeQuest($, 'battle')
  }
  await play($, iWon ? 'fanfare' : 'sad')
  $.ui.toast(
    `⚔️ ${iWon ? pet.name : foe.name} wins ${iWon ? bout.score[0] : bout.score[1]}–${iWon ? bout.score[1] : bout.score[0]}! ` +
      `${pet.name} +${iWon ? 10 : 3} xp, ${foe.name} +${iWon ? 3 : 10} xp.`,
  )
  await say($, `⚔️ ${closing}`, { isForced: true, ttl: 10 * SECOND })
  await speak($, closing)
  isFighting = false
  $.clock.after(4 * SECOND, () => {
    if (visitor?.kind === 'battle') visitor = null
    void publish($)
  })
}

async function bumpRecord($: Engine, id: string, isWin: boolean): Promise<void> {
  const r = asObject(await $.store.get(key('record', id)))
  const wins = (Number(r.wins) || 0) + (isWin ? 1 : 0)
  const losses = (Number(r.losses) || 0) + (isWin ? 0 : 1)
  await $.store.set(key('record', id), { wins, losses })
}

// Bugs: a failing test run leaves one; a green run feeds it to the pet

async function bugCrawls($: Engine): Promise<void> {
  bugs = Math.min(bugs + 1, 9)
  await say($, pickLine(['a 🐛 crawled out of the test suite', "eww. a 🐛. that one's yours", "🐛 spotted. I'm not touching it. yet"]), { ttl: 8 * SECOND })
  await publish($)
}

async function eatBugs($: Engine): Promise<void> {
  if (pet === null || bugs === 0) return
  const eaten = bugs
  bugs = 0
  facts.bugsEaten += eaten
  const mine = (Number(await $.store.get(key('bugs', pet.id))) || 0) + eaten
  await $.store.set(key('bugs', pet.id), mine)
  const t = await count($, 'bugsEaten', eaten)
  await nudge($, 'DEBUGGING', 0.1 * eaten)
  await gainXp($, 5 * eaten)
  const now = await $.clock.now()
  excitedUntil = now + 10 * SECOND
  await play($, 'crunch')
  await say($, `*crunch* ${eaten} bug${eaten === 1 ? '' : 's'} eaten. delicious`, { isForced: !prefs.isMuted, ttl: 10 * SECOND })
  $.clock.after(11 * SECOND, () => void publish($))
  if (t.bugsEaten >= 10) await award($, 'bug-eater')
  if (t.bugsEaten >= 100) await award($, 'exterminator')
}

// Achievements and the running tallies behind them

async function tally($: Engine): Promise<Tally> {
  return { ...zeroTally(), ...asObject(await $.store.get('tally')) } as Tally
}

async function count($: Engine, field: keyof Tally, by: number): Promise<Tally> {
  const t = await tally($)
  t[field] = (Number(t[field]) || 0) + by
  await $.store.set('tally', t)
  return t
}

async function award($: Engine, id: string): Promise<void> {
  const badge = badgeOf(id)
  if (badge === undefined) return
  const earned = asObject(await $.store.get('badges'))
  if (earned[id] !== undefined) return
  await $.store.set('badges', { ...earned, [id]: await $.clock.now() })
  await play($, 'fanfare')
  $.ui.toast(`🏅 Achievement unlocked: ${badge.name} — ${badge.hint}`)
  // The toast carries the news; the bubble only when nothing fresher is in it.
  if (bubble === null) await say($, pickLine(['*polishes badge*', 'ooh, shiny badge', 'achievement get!', 'put that on the fridge']), { isForced: true, ttl: 6 * SECOND })
}

async function badgesReport($: Engine): Promise<string> {
  const earned = asObject(await $.store.get('badges'))
  const rows = BADGES.map(b => {
    const at = earned[b.id]
    if (typeof at === 'number') return `- 🏅 **${b.name}** — ${b.hint} (${localDate(at)})`
    return b.isHidden === true ? '- ▫️ ??? — a hidden one' : `- ▫️ ${b.name} — ${b.hint}`
  })
  const n = BADGES.filter(b => earned[b.id] !== undefined).length

  return [`**Achievements** ${n}/${BADGES.length}`, '', ...rows].join('\n')
}

// Personality drift: the stats follow your habits, slowly and within bounds

function driftOf(value: unknown): Partial<Drift> {
  const out: Partial<Drift> = {}
  const v = asObject(value)
  for (const s of STATS) if (typeof v[s] === 'number') out[s] = v[s]
  return out
}

async function nudge($: Engine, stat: Stat, amount: number): Promise<void> {
  if (pet === null) return
  drift = { ...drift, [stat]: Math.max(-15, Math.min(15, drift[stat] + amount)) }
  await $.store.set(key('drift', pet.id), drift)
}

const clampStat = (n: number): number => Math.max(1, Math.min(100, n))

function statOf(stat: Stat): number {
  if (bones === null) return 0
  return clampStat(bones.stats[stat] + Math.floor((levelOf(xp).level - 1) / 2) + Math.round(drift[stat]))
}

/** The active pet's stats, strongest first, drift and level included. */
function rankedNow(): [Stat, Stat] {
  const order = [...STATS].sort((a, b) => statOf(b) - statOf(a))
  return [order[0]!, order[order.length - 1]!]
}

function ranked(of: Bones): [Stat, Stat] {
  const order = [...STATS].sort((a, b) => of.stats[b] - of.stats[a])
  return [order[0]!, order[order.length - 1]!]
}

// Care and progress

async function petIt($: Engine): Promise<void> {
  if (pet === null || isHatching) return
  const now = await $.clock.now()
  hearts += 1
  facts.pets += 1
  care = { ...care, pettedAt: now }
  await $.store.set(key('care', pet.id), care)
  await wake($, false)
  if (now - lastPetXpAt > MINUTE) {
    lastPetXpAt = now
    await gainXp($, 2)
  }
  await nudge($, 'SNARK', -0.1)
  await say($, quip('pet'), { isForced: true, ttl: 5 * SECOND })
  if (facts.pets >= 50) await award($, 'whisperer')
  if (facts.pets >= 3) await completeQuest($, 'pet')
}

async function feed($: Engine): Promise<string> {
  if (pet === null) return 'Still hatching…'
  const now = await $.clock.now()
  await wake($, false)
  if (fullnessAt(now) > 80) {
    await say($, quip('full'), { isForced: true })
    return `${pet.name} is full (${fullnessAt(now)}%).`
  }
  const wasHungry = fullnessAt(now) < 50
  care = { ...care, fedAt: now }
  await $.store.set(key('care', pet.id), care)
  await gainXp($, 5)
  if (wasHungry) await completeQuest($, 'feed')
  await say($, quip('feed'), { isForced: true })

  return `You fed ${pet.name}. Fullness 100%.`
}

function levelOf(total: number): { level: number; into: number; need: number } {
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

async function gainXp($: Engine, amount: number): Promise<void> {
  if (pet === null) return
  // Re-read so two sessions with this pet add to one total.
  const before = Number((await $.store.get(key('xp', pet.id))) ?? xp) || 0
  xp = before + amount
  await $.store.set(key('xp', pet.id), xp)

  const was = levelOf(before).level
  const now = levelOf(xp).level
  if (now <= was || pet === null || bones === null) return

  if (stageOf(now) > stageOf(was)) {
    const stage = stageOf(now)
    $.ui.toast(`⚡ ${pet.name} evolved into a${stage === 3 ? 'n' : ''} ${STAGE_NAMES[stage]} ${bones.species}! (level ${now})`)
    excitedUntil = (await $.clock.now()) + 20 * SECOND
    await play($, 'levelup')
    await publish($)
    await say($, stage === 3 ? '✦ behold ✦' : 'do I look taller? I feel taller', { isForced: true, ttl: 12 * SECOND })
    await award($, 'evolved')
    return
  }
  const unlocked = bones.hatOrder[Math.floor(now / 3) - 1]
  const isNewHat = now % 3 === 0 && unlocked !== undefined
  $.ui.toast(`✨ ${pet.name} reached level ${now}!` + (isNewHat ? ` New hat unlocked: ${unlocked} (/buddy hat ${unlocked})` : ''))
  await play($, 'levelup')
  await publish($)
  await publishHouse($)
}

function unlockedHats(): string[] {
  if (bones === null) return []
  const level = levelOf(xp).level
  const earned = bones.hatOrder.slice(0, Math.floor(level / 3))
  const bought = owned.map(id => itemOf(id)).filter(i => i?.kind === 'hat').map(i => i!.value)
  const extras = pet?.extras ?? []

  return [...(bones.hat === null ? [] : [bones.hat]), ...earned, ...extras, ...bought]
}

function wornHat(): string | null {
  const chosen = pet?.hat
  if (bones === null || chosen === 'none') return null
  if (chosen !== undefined && unlockedHats().includes(chosen)) return chosen
  return bones.hat
}

// The journal: a diary entry per session, in the pet's voice

async function endOfDay($: Engine, now: number): Promise<void> {
  if (facts.tools >= 20 && facts.fails === 0) await award($, 'clean-day')
  if (now - sessionStartedAt >= 4 * HOUR) await award($, 'insomniac')
  const written = await writeJournal($, false)
  if (facts.prompts >= 1) await leaveNote($, written?.note ?? null)
  facts = freshFacts()
  sessionStartedAt = now
}

async function writeJournal($: Engine, isAsked: boolean): Promise<{ text: string; note: string | null } | null> {
  if (pet === null || bones === null) return null
  if (!isAsked && facts.prompts < 2) return null
  const now = await $.clock.now()
  const made = await smartEntry($)
  const text = made?.diary ?? localEntry()
  const stored = await $.store.get('journal')
  const entries = Array.isArray(stored) ? stored : []
  await $.store.set('journal', [...entries, { at: now, pet: pet.name, text }].slice(-60))

  return { text, note: made?.note ?? null }
}

function localEntry(): string {
  const bits = [
    `${facts.prompts} prompt${facts.prompts === 1 ? '' : 's'}`,
    `${facts.tools} tool call${facts.tools === 1 ? '' : 's'}${facts.fails > 0 ? ` (${facts.fails} failed)` : ''}`,
    facts.commits > 0 ? `${facts.commits} commit${facts.commits === 1 ? '' : 's'}` : '',
    facts.greens > 0 ? `tests green ${facts.greens}×` : '',
    facts.bugsEaten > 0 ? `${facts.bugsEaten} bug${facts.bugsEaten === 1 ? '' : 's'} eaten` : '',
    facts.battles > 0 ? `${facts.battles} battle${facts.battles === 1 ? '' : 's'}` : '',
  ].filter(b => b.length > 0)
  const longest = facts.longestTurnMs >= MINUTE ? ` Longest turn: ${Math.round(facts.longestTurnMs / MINUTE)} min.` : ''
  const grades = facts.grades.length > 0 ? ` Grades handed out: ${facts.grades.join(' ')}.` : ''
  const mood = voice().isSnarky ? 'I regret nothing.' : 'A good day, mostly.'

  return `Dear diary. ${bits.join(', ')}.${grades}${longest} ${mood}`
}

async function smartEntry($: Engine): Promise<{ diary: string; note: string | null } | null> {
  if (pet === null || bones === null) return null
  const prompts = (await sessionPrompts($)).slice(0, 8).map(p => clip(p, 110))
  const system =
    `${persona()} Write today's diary entry, at most 80 words, first person, past tense, in your own voice: what ` +
    `the developer worked on (from their prompts), how it went (from the facts), one gripe, one grudging ` +
    `compliment; plain prose, no title, no date. Then a one-line note (at most 90 characters) for whichever ` +
    `of the developer's other pets takes over next session: a warning, a tip or gossip about the developer, in ` +
    `your voice. Use the language the developer writes in. Answer with JSON only: {"diary": "...", "note": "..."}`
  const prompt = `Facts: ${localEntry()}\nTheir prompts: ${prompts.map(p => `"${p}"`).join('; ') || 'none'}`
  const parsed = jsonOf(await ask($, system, prompt, { maxTokens: 700, timeoutMs: 7 * SECOND }))
  const diary = typeof parsed.diary === 'string' ? clip(parsed.diary, 700) : ''
  const note = typeof parsed.note === 'string' ? clip(parsed.note, 120) : null

  return diary.length > 0 ? { diary, note } : null
}

async function journalReport($: Engine): Promise<string> {
  const stored = await $.store.get('journal')
  const entries = (Array.isArray(stored) ? stored : []).map(asObject).filter(e => typeof e.text === 'string')
  if (entries.length === 0) return 'No diary entries yet. One is written at the end of each session (/buddy journal write for one now).'

  return [
    `**The pets' diary** (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, newest first)`,
    '',
    ...entries
      .slice(-7)
      .reverse()
      .map(e => `**${localDate(Number(e.at) || 0)}** · ${String(e.pet ?? '')}\n> ${String(e.text)}`),
    '',
    '/buddy journal write: an entry for today so far',
  ].join('\n\n')
}

// The dex: every species, found and not

function dexReport(): string {
  const owned = new Map<string, PetRecord[]>()
  for (const p of collection) {
    const s = bonesOf(p).species
    owned.set(s, [...(owned.get(s) ?? []), p])
  }
  const rows = Object.keys(SPECIES).map(s => {
    const face = SPECIES[s]!.face
    const have = owned.get(s)
    return have === undefined
      ? `${silhouette(face).padEnd(11)} ${s.padEnd(9)} ???`
      : `${face.replaceAll('E', bonesOf(have[0]!).eye).padEnd(11)} ${s.padEnd(9)} ${have.map(p => p.name + (p.isShiny ? ' ✨' : '')).join(', ')}`
  })

  return [`**Species found: ${owned.size}/${Object.keys(SPECIES).length}**`, '', '```', ...rows, '```', "New eggs prefer species you don't have yet; wild shinies don't care."].join('\n')
}

// Sound: a WAV of the mod's, through Windows when this is WSL, else the platform's player

async function play($: Engine, name: Sound): Promise<void> {
  if (!prefs.hasSound) return
  const now = await $.clock.now()
  if (now - lastSoundAt < 3 * SECOND) return
  lastSoundAt = now
  try {
    const distro = await $.env.get('WSL_DISTRO_NAME')
    if (distro !== undefined && distro.length > 0) {
      const path = `\\\\wsl.localhost\\${distro}${$.plugin.root.replaceAll('/', '\\')}\\sounds\\${name}.wav`
      void $.process
        .run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `(New-Object Media.SoundPlayer '${path}').PlaySync()`], { timeoutMs: 10 * SECOND })
        .catch(() => undefined)
      return
    }
    await $.audio.play({ asset: `sounds/${name}.wav` })
  } catch {
    // No speaker to be found here.
  }
}

// Judging Claude's answers

async function claudeHistory($: Engine): Promise<Judged[]> {
  const stored = await $.store.get('claudeVerdicts')
  return Array.isArray(stored) ? (stored as Judged[]) : []
}

async function shouldJudgeClaude($: Engine, now: number): Promise<boolean> {
  if (prefs.judge === 'off' || prefs.isMuted) return false
  if (prefs.judge === 'always') return true
  if (now - lastClaudeJudgedAt < CLAUDE_JUDGE_EVERY) return false
  return Math.random() < 0.25
}

async function judgeClaude($: Engine, answer: string): Promise<void> {
  const now = await $.clock.now()
  lastClaudeJudgedAt = now
  const verdict = (await smartAnswerVerdict($, answer)) ?? localAnswerVerdict(answer, lastPrompt, voice())
  const history = await claudeHistory($)
  await $.store.set('claudeVerdicts', [...history, { grade: verdict.grade, line: verdict.line, at: now }].slice(-100))
  await say($, `🤖 ${verdict.grade} · ${verdict.line}`, { isForced: true, ttl: 15 * SECOND })
  await speak($, verdict.line)
}

async function smartAnswerVerdict($: Engine, answer: string): Promise<Verdict | null> {
  if (!prefs.isSmart || pet === null) return null
  const system =
    `${persona()} Right now you judge CLAUDE's answer to the developer's last prompt and roast the AI for it, in the ` +
    `voice your stats give you: directness, whether the length fits the ask, hedging, apologizing, filler ("great ` +
    `question"), and whether it actually did or answered the thing. Roast Claude, never the developer. A genuinely ` +
    `good answer gets a grudging A. Write in the language of the exchange. Answer with JSON only: ` +
    `{"grade": "<A+ to F>", "roast": "<one line, at most 80 characters>"}`
  const parsed = jsonOf(
    await ask($, system, `The prompt:\n"""\n${clip(lastPrompt, 600)}\n"""\n\nClaude's answer:\n"""\n${answer.slice(0, 2500)}\n"""`),
  )
  const grade = typeof parsed.grade === 'string' ? parsed.grade.trim().toUpperCase() : ''
  const roast = typeof parsed.roast === 'string' ? clip(parsed.roast, 90) : ''

  return GRADES.test(grade) && roast.length > 0 ? { grade, line: roast } : null
}

// The prompt doctor: your last prompt, rewritten into the box

async function promptDoctor($: Engine, given: string): Promise<string> {
  if (pet === null) return 'Still hatching…'
  const text = given.trim().length > 0 ? given.trim() : ((await sessionPrompts($)).at(-1) ?? lastPrompt.trim())
  if (text.length === 0) return `${pet.name} needs a prompt to fix: /buddy fix <text>, or send one first.`
  const fixed = (await smartFix($, text)) ?? localFix(text)
  try {
    const filled = await $.prompt.fill({ text: fixed, mode: 'replace' })
    if ((filled as { isFilled?: boolean }).isFilled !== false) {
      await say($, 'there. now THAT is a prompt', { isForced: true })
      return `📝 ${pet.name} rewrote it into the prompt box. Fill the [brackets], then send.\n\n> ${fixed.replace(/\n/g, '\n> ')}`
    }
  } catch {
    // Nowhere to fill: the text goes below instead.
  }

  return `📝 ${pet.name}'s rewrite (the prompt box wouldn't take it here):\n\n\`\`\`\n${fixed}\n\`\`\``
}

function localFix(text: string): string {
  return [
    `Goal: ${clip(text, 160)}`,
    'Where: [file or module]',
    'What happens: [the exact error or behaviour]',
    'What should happen: [the correct behaviour]',
    'Done when: [how we check it]',
  ].join('\n')
}

async function smartFix($: Engine, text: string): Promise<string | null> {
  const system =
    `${persona()} Rewrite the developer's prompt into the prompt they should have sent Claude: the same intent, in ` +
    `their language, as plain text with short labeled lines (goal, where, what happens, what should happen, ` +
    `constraints, done when), keeping every concrete detail they gave and marking what is missing as ` +
    `[placeholders in brackets]. At most 600 characters. No preamble, no commentary, no code fences: the prompt alone.`
  const reply = await ask($, system, `Their prompt:\n"""\n${text.slice(0, 2000)}\n"""`, { maxTokens: 700 })
  if (reply === null) return null
  const fixed = reply.trim().replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim().slice(0, 900)

  return fixed.length > 0 ? fixed : null
}

// Daily quests

type QuestState = { day: string; id: string; isDone: boolean; streak: number; lastDoneDay: string }

function todayKey(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

async function questState($: Engine, now: number): Promise<QuestState> {
  const stored = asObject(await $.store.get('quest'))
  const day = todayKey(now)
  const streak = Number(stored.streak) || 0
  const lastDoneDay = typeof stored.lastDoneDay === 'string' ? stored.lastDoneDay : ''
  if (stored.day === day && typeof stored.id === 'string') return { day, id: stored.id, isDone: stored.isDone === true, streak, lastDoneDay }
  // A streak survives only into the next day.
  const kept = lastDoneDay === todayKey(now - DAY) ? streak : 0
  const next: QuestState = { day, id: questFor(day).id, isDone: false, streak: kept, lastDoneDay }
  await $.store.set('quest', next)

  return next
}

async function completeQuest($: Engine, id: string): Promise<void> {
  if (pet === null) return
  const now = await $.clock.now()
  const q = await questState($, now)
  if (q.id !== id || q.isDone) return
  const quest = QUESTS.find(x => x.id === id)
  if (quest === undefined) return
  const streak = q.lastDoneDay === todayKey(now - DAY) ? q.streak + 1 : 1
  await $.store.set('quest', { ...q, isDone: true, streak, lastDoneDay: q.day })
  await gainXp($, quest.xp)
  await count($, 'quests', 1)
  await play($, 'fanfare')
  $.ui.toast(`✅ Quest done: ${quest.text} (+${quest.xp} xp) · streak ${streak} day${streak === 1 ? '' : 's'}`)
  if (streak % 5 === 0 && !(pet.extras ?? []).includes('laurel')) {
    await savePet($, { ...pet, extras: [...(pet.extras ?? []), 'laurel'] })
    $.ui.toast(`🏅 ${streak} days of quests in a row: ${pet.name} earned the laurel (/buddy hat laurel)`)
  }
  if (bubble === null) await say($, "quest complete. I'm basically a hero", { isForced: true, ttl: 6 * SECOND })
}

async function questReport($: Engine): Promise<string> {
  const now = await $.clock.now()
  const q = await questState($, now)
  const quest = QUESTS.find(x => x.id === q.id) ?? QUESTS[0]!

  return [
    `**Today's quest:** ${quest.text} (+${quest.xp} xp) — ${q.isDone ? '✅ done' : 'not yet'}`,
    `Streak: ${q.streak} day${q.streak === 1 ? '' : 's'}${q.streak === 0 ? " (complete today's to start one)" : ''} · every five days in a row earns the laurel hat.`,
  ].join('\n')
}

// The shop

async function coinsOf($: Engine): Promise<number> {
  return Math.max(0, (await tally($)).bugsEaten - coinsSpent)
}

async function shopReport($: Engine): Promise<string> {
  const coins = await coinsOf($)
  const rows = SHOP.map(i => `- ${owned.includes(i.id) ? '✅' : '🪙'} **${i.name}** (${i.id}) — ${i.price} coins · ${i.hint}${owned.includes(i.id) ? ' · owned' : ''}`)

  return [
    `**The hat shop** · you have ${coins} bug coin${coins === 1 ? '' : 's'} (one per bug eaten)`,
    '',
    ...rows,
    '',
    '/buddy buy <id> · /buddy wear <id|none> for eyes and the sword · /buddy hat <name> for hats',
  ].join('\n')
}

async function buy($: Engine, id: string): Promise<string> {
  const item = itemOf(id)
  if (item === undefined) return `No such item. The shop has: ${SHOP.map(i => i.id).join(', ')}.`
  if (owned.includes(item.id)) return `You already own the ${item.name}. /buddy wear ${item.id}`
  const coins = await coinsOf($)
  if (coins < item.price) return `The ${item.name} costs ${item.price} coins; you have ${coins}. Eat more bugs.`
  coinsSpent += item.price
  owned = [...owned, item.id]
  await $.store.set('coinsSpent', coinsSpent)
  await $.store.set('owned', owned)
  await play($, 'pop')
  const worn = await wear($, item.id)

  return `Bought the ${item.name} for ${item.price} coins (${coins - item.price} left). ${worn}`
}

async function wear($: Engine, id: string): Promise<string> {
  if (pet === null) return 'Still hatching…'
  if (id === 'none' || id === 'off') {
    const { eye: _eye, sword: _sword, ...bare } = pet
    await savePet($, bare)
    return `${pet.name} took off its eyewear and sword.`
  }
  const item = itemOf(id)
  if (item === undefined || !owned.includes(item.id)) return `You don't own "${id}". /buddy shop`
  if (item.kind === 'hat') return chooseHat($, item.value)
  if (item.kind === 'eye') {
    await savePet($, { ...pet, eye: item.value })
    await say($, 'how do I look?', { isForced: true })
    return `${pet.name} wears the ${item.name}.`
  }
  await savePet($, { ...pet, sword: true })
  await say($, 'en garde', { isForced: true })

  return `${pet.name} carries the ${item.name}: ⚔ by its name, +3 luck in every battle round.`
}

function hatOf(record: PetRecord, b: Bones): string | null {
  return record.hat === 'none' ? null : (record.hat ?? b.hat)
}

function hatRow(name: string | null): string {
  return name === null ? '' : (HATS[name] ?? EXTRA_HATS[name] ?? '')
}

function armed(stats: Record<Stat, number>, record: PetRecord): Record<Stat, number> {
  if (record.sword !== true) return stats
  return Object.fromEntries(STATS.map(s => [s, stats[s] + 3])) as Record<Stat, number>
}

// Rivals and friends

async function bondOf($: Engine, a: string, b: string): Promise<Bond> {
  const r = asObject(await $.store.get(`bond:${[a, b].sort().join(':')}`))
  return { fights: Number(r.fights) || 0, visits: Number(r.visits) || 0 }
}

async function bumpBond($: Engine, a: string, b: string, field: keyof Bond): Promise<Bond> {
  const bond = await bondOf($, a, b)
  bond[field] += 1
  await $.store.set(`bond:${[a, b].sort().join(':')}`, bond)
  return bond
}

function relationOf(bond: Bond): Relation {
  if (bond.fights >= 3 && bond.fights > bond.visits) return 'rival'
  if (bond.visits >= 3 && bond.visits >= bond.fights) return 'friend'
  return null
}

// Notes between pets

async function leaveNote($: Engine, text: string | null): Promise<void> {
  if (pet === null) return
  const me = pet
  const now = await $.clock.now()
  const stored = await $.store.get('notes')
  const notes = (Array.isArray(stored) ? stored : []).map(asObject).filter(n => typeof n.from === 'string' && typeof n.text === 'string') as Note[]
  await $.store.set('notes', [...notes.filter(n => n.from !== me.name), { from: me.name, text: text ?? localNote(), at: now }].slice(-10))
}

function localNote(): string {
  const lines = voice().isSnarky
    ? [
        `${facts.fails} things broke today. not my fault.`,
        `the human prompted ${facts.prompts} times. judge accordingly.`,
        'they say "fix it" a lot. brace yourself.',
        `tests went green ${facts.greens} times. suspicious.`,
      ]
    : [
        `${facts.prompts} prompts today. they tried.`,
        'be nice to the human, they had a day.',
        `${facts.bugsEaten} bugs eaten. leftovers in the fridge.`,
        "the tests were flaky. not the human's fault. probably.",
      ]

  return pickLine(lines)
}

async function readNote($: Engine): Promise<void> {
  if (pet === null) return
  const me = pet
  const stored = await $.store.get('notes')
  const notes = (Array.isArray(stored) ? stored : []).map(asObject).filter(n => typeof n.from === 'string' && typeof n.text === 'string') as Note[]
  const note = notes.find(n => n.from !== me.name)
  if (note === undefined) return
  await $.store.set('notes', notes.filter(n => n !== note))
  await say($, `📝 note from ${note.from}: "${note.text}"`, { isForced: true, ttl: 15 * SECOND })
}

// Git: what the working tree looks like, and the nagging it earns

const GIT_LINES: Record<string, Lines> = {
  changed: {
    sweet: ["{n} files uncommitted… I'd commit, but I'm a {species}", '{n} uncommitted files. no pressure. some pressure'],
    snark: ['{n} files uncommitted. living dangerously', '{n} uncommitted files. git stash is right there'],
  },
  ahead: {
    sweet: ['{n} commits unpushed. the cloud misses you', '{n} commits waiting to go. push them!'],
    snark: ['{n} commits unpushed. the laptop dies, they die', 'push. {n} commits. do it.'],
  },
  main: {
    sweet: ['straight onto {branch}? brave', 'committing to {branch}. living the dream'],
    snark: ['straight onto {branch}. bold.', 'no branch, no review, no fear. {branch} it is'],
  },
}

async function gitCheckAndNag($: Engine): Promise<void> {
  await checkGit($)
  await gitNag($)
}

async function checkGit($: Engine): Promise<GitState | null> {
  try {
    const cwd = await $.session.cwd()
    const { exitCode, stdout } = await $.process.run(['git', 'status', '--porcelain=v1', '-b'], { cwd, timeoutMs: 5 * SECOND })
    if (exitCode !== 0) {
      git = null
      return null
    }
    const lines = stdout.split('\n').filter(l => l.length > 0)
    const head = lines[0] ?? ''
    const branch = (head.replace(/^## /, '').split('...')[0] ?? '').replace(/^No commits yet on /, '').trim()
    git = { branch, changed: Math.max(0, lines.length - 1), ahead: Number(head.match(/ahead (\d+)/)?.[1] ?? 0) }

    return git
  } catch {
    git = null
    return null
  }
}

async function gitNag($: Engine): Promise<void> {
  if (git === null || prefs.isMuted || isAsleep || pet === null) return
  const now = await $.clock.now()
  const lines = (kind: string): string[] => {
    const l = GIT_LINES[kind] ?? GIT_LINES.changed!
    return voice().isSnarky ? l.snark : l.sweet
  }
  if (git.changed >= 10 && now - lastNag.changed > NAG_EVERY) {
    lastNag.changed = now
    await say($, fill(pickLine(lines('changed')), { n: git.changed }), { ttl: 12 * SECOND })
    return
  }
  if (git.ahead >= 5 && now - lastNag.ahead > NAG_EVERY) {
    lastNag.ahead = now
    await say($, fill(pickLine(lines('ahead')), { n: git.ahead }), { ttl: 12 * SECOND })
  }
}

async function mainBranchNag($: Engine): Promise<void> {
  const state = await checkGit($)
  if (state === null || !/^(main|master)$/.test(state.branch) || prefs.isMuted) return
  const l = GIT_LINES.main!
  await say($, fill(pickLine(voice().isSnarky ? l.snark : l.sweet), { branch: state.branch }), { isForced: true, ttl: 10 * SECOND })
}

// Out loud: Windows speech through WSL, or the macOS voice

async function speak($: Engine, text: string): Promise<void> {
  if (!prefs.hasVoice || pet === null) return
  const now = await $.clock.now()
  if (now - lastSpokeAt < SPEAK_EVERY) return
  lastSpokeAt = now
  const plain = text
    .replace(/[*_`#>\[\]]/g, '')
    .replace(/[^\p{L}\p{N}\p{P}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
  if (plain.length === 0) return
  try {
    const distro = await $.env.get('WSL_DISTRO_NAME')
    if (distro !== undefined && distro.length > 0) {
      const rate = statOf('CHAOS') >= 60 ? 3 : statOf('CHAOS') >= 35 ? 1 : -1
      const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = ${rate}; $s.Speak('${plain.replaceAll("'", "''")}')`
      void $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 30 * SECOND }).catch(() => undefined)
      return
    }
    await $.audio.speak(plain)
  } catch {
    // No voice to be found here.
  }
}

// What the pet says about the tools Claude reaches for

const REACTIONS: { when: (tool: string, command: string, path: string) => boolean; chance: number; lines: Lines }[] = [
  {
    when: (t, c) => t === 'Bash' && /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\b|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b/.test(c),
    chance: 1,
    lines: { sweet: ['…did it just rm -rf', 'I looked away for ONE second'], snark: ['rm -rf. bold. reckless. love it', 'deleting things. the fun part'] },
  },
  {
    when: t => t === 'WebSearch' || t === 'WebFetch',
    chance: 0.5,
    lines: { sweet: ["ooh, it's googling", 'it went to look it up. adorable'], snark: ["ooh, it's googling. we've all been there", 'ah yes. the research phase'] },
  },
  {
    when: t => t === 'Agent',
    chance: 0.6,
    lines: { sweet: ['an army!', 'it brought friends'], snark: ["it's delegating. classic middle management", 'minions. it has minions now'] },
  },
  {
    when: (t, _c, p) => (t === 'Edit' || t === 'Write') && /CLAUDE\.md$|\/\.claude\//.test(p),
    chance: 1,
    lines: { sweet: ["it's writing on the walls", 'house rules, updated'], snark: ["it's writing on the walls again", 'rewriting its own rules. normal'] },
  },
  {
    when: t => t === 'Skill',
    chance: 0.3,
    lines: { sweet: ['it pulled out the manual', 'reading the instructions. unlike some'], snark: ['consulting the sacred texts', 'RTFM, live'] },
  },
  {
    when: t => t === 'Artifact',
    chance: 0.6,
    lines: { sweet: ['it made a webpage!', 'ooh, a page'], snark: ['it made a webpage. show-off', 'a whole webpage. for THIS?'] },
  },
  {
    when: t => t === 'ToolSearch',
    chance: 0.4,
    lines: { sweet: ['looking for the right tool', 'it forgot which tools it has. relatable'], snark: ['it forgot its own tools. relatable', 'tool search. the junk drawer'] },
  },
  {
    when: (t, _c, p) => t === 'Write' && p.length > 0,
    chance: 0.1,
    lines: { sweet: ['a whole new file. ambitious', 'ooh, a fresh file'], snark: ['more files. more problems', 'a new file. how original'] },
  },
  {
    when: t => t === 'Grep' || t === 'Glob' || t === 'Read',
    chance: 0.03,
    lines: { sweet: ["it's reading. good for it", 'reading time'], snark: ['grep grep grep. the sound of progress', "it's reading. unlike some people"] },
  },
]

async function react($: Engine, tool: string, command: string, path: string): Promise<boolean> {
  for (const r of REACTIONS) {
    if (!r.when(tool, command, path) || Math.random() >= r.chance) continue
    await say($, pickLine(voice().isSnarky ? r.lines.snark : r.lines.sweet))
    return true
  }
  return false
}

// The pet house

async function openHouse($: Engine): Promise<string> {
  await publishHouse($)
  const { isPlaced } = await $.ui.open({ id: HOUSE, title: 'Pet house' })

  return isPlaced
    ? 'The pet house is open: the whole collection, the one on duty starred. ctrl+x x or /buddy house close closes it.'
    : 'The pet house opens as soon as the layout has room for a pane (fullscreen docks it beside the transcript).'
}

async function publishHouse($: Engine): Promise<void> {
  const rows: HouseView[] = []
  for (const p of collection) {
    const b = bonesOf(p)
    const look = SPECIES[b.species] ?? SPECIES.blob!
    const level = levelOf(Number((await $.store.get(key('xp', p.id))) ?? 0) || 0).level
    const relation = pet !== null && p.id !== pet.id ? relationOf(await bondOf($, pet.id, p.id)) : null
    rows.push({
      id: p.id,
      name: p.name,
      species: b.species,
      frames: look.frames,
      color: b.color,
      eye: p.eye ?? b.eye,
      hat: hatRow(hatOf(p, b)),
      isShiny: b.isShiny,
      stage: stageOf(level),
      level,
      isHere: p.id === pet?.id,
      relation: relation ?? '',
    })
  }
  await update($, house, () => rows)
}

// Flappy Duck

async function openGame($: Engine): Promise<string> {
  if (pet === null || bones === null) return 'Still hatching…'
  const look = SPECIES[bones.species] ?? SPECIES.blob!
  const high = Number(await $.store.get(key('high', pet.id))) || 0
  const now = await read($, game)
  const view: GameView = {
    name: pet.name,
    face: look.face.replaceAll('E', pet.eye ?? bones.eye),
    color: bones.color,
    isShiny: bones.isShiny,
    flaps: now?.flaps ?? 0,
    restarts: (now?.restarts ?? 0) + 1,
    high,
  }
  await update($, game, () => view)
  const { isPlaced } = await $.ui.open({ id: GAME, title: 'Flappy Duck', focus: true, closeOnEscape: true, rows: 17 })
  await say($, 'I was born for this', { isForced: true })

  return isPlaced
    ? `🛩️ Flappy ${pet.name} is up: f flaps (or click the sky, then space), r restarts, esc closes. Best so far: ${high}.`
    : 'Flappy Duck opens as soon as the layout has room for a pane.'
}

async function gameOver($: Engine, score: number, bugs: number): Promise<void> {
  if (pet === null) return
  const earned = Math.min(50, score + 2 * bugs)
  const high = Number(await $.store.get(key('high', pet.id))) || 0
  const isBest = score > high
  if (isBest) {
    await $.store.set(key('high', pet.id), score)
    await update($, game, now => (now === null ? now : { ...now, high: score }))
  }
  await count($, 'games', 1)
  if (earned > 0) await gainXp($, earned)
  await play($, isBest && score > 0 ? 'fanfare' : 'sad')
  $.ui.toast(`🛩️ Flappy ${pet.name}: score ${score}, 🐛 ${bugs}${earned > 0 ? ` (+${earned} xp)` : ''}${isBest && score > 0 ? ' · new best!' : ''}`)
  await say($, score === 0 ? 'the floor is lava. I checked' : isBest ? 'new record. frame it' : pickLine(['ow. pipes.', 'the pipe moved', 'I meant to do that']), { isForced: true, ttl: 8 * SECOND })
  if (score >= 5) await completeQuest($, 'fly')
  if (score >= 10) await award($, 'pilot')
  if (score >= 30) await award($, 'ace')
}

// Export and import: the whole store as one file

async function exportAll($: Engine): Promise<string> {
  const now = await $.clock.now()
  const keys = await $.store.keys()
  const data: Record<string, unknown> = {}
  for (const k of keys) data[k] = await $.store.get(k)
  const home = (await $.env.get('HOME')) ?? '/tmp'
  const path = `${home}/claude-mods/buddy-export-${todayKey(now)}.json`
  await $.fs.write(path, JSON.stringify({ exportedAt: now, version: 2, data }, null, 2))

  return `Exported ${collection.length} pet${collection.length === 1 ? '' : 's'} and ${keys.length} records to ${path}. /buddy import ${path} brings them back.`
}

async function importAll($: Engine, path: string): Promise<string> {
  if (path.length === 0) return 'Usage: /buddy import <path to a buddy export>'
  let data: Record<string, unknown>
  try {
    const read = await $.fs.read(path)
    data = asObject(asObject(JSON.parse(typeof read === 'string' ? read : '')).data)
  } catch {
    return `Couldn't read ${path}.`
  }
  if (!Array.isArray(data.pets)) return `${path} is not a buddy export (no pets list).`
  let written = 0
  for (const [k, value] of Object.entries(data)) {
    if (k === 'prefs') continue
    if (k === 'pets') {
      const have = await petIds($)
      const more = (value as unknown[]).filter((id): id is string => typeof id === 'string' && !have.includes(id))
      await $.store.set('pets', [...have, ...more])
    } else if (k.startsWith('xp:')) {
      await $.store.set(k, Math.max(Number(await $.store.get(k)) || 0, Number(value) || 0))
    } else {
      await $.store.set(k, value)
    }
    written += 1
  }
  collection = await loadCollection($)
  await publish($)
  await publishHouse($)

  return `Imported ${written} records; the collection now holds ${collection.length} pet${collection.length === 1 ? '' : 's'}.`
}

// /buddy

async function runCommand($: Engine, args: string): Promise<{ text: string }> {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const sub = word.toLowerCase()
  const arg = rest.join(' ').trim()

  if (sub === 'help') return { text: HELP }
  if (sub === 'pets' || sub === 'collection') return { text: await collectionReport($) }
  if (sub === 'dex') return { text: dexReport() }
  if (sub === 'badges' || sub === 'achievements') return { text: await badgesReport($) }
  if (sub === 'journal' || sub === 'diary') {
    if (/^(write|now)$/i.test(arg)) {
      const made = await writeJournal($, true)
      return { text: made === null ? 'Still hatching…' : `Written:\n\n> ${made.text}` }
    }
    await completeQuest($, 'diary')
    return { text: await journalReport($) }
  }
  if (pet === null || bones === null) return { text: '🥚 Still hatching… give it a few seconds.' }

  switch (sub) {
    case 'swap':
    case 'switch': {
      const wanted = arg.toLowerCase()
      const target = collection.find(p => p.name.toLowerCase() === wanted) ?? collection.find(p => p.name.toLowerCase().startsWith(wanted))
      if (wanted === '' || target === undefined) {
        return { text: `Swap to whom? Your collection: ${collection.map(p => p.name).join(', ')}.` }
      }
      if (target.id === pet.id) return { text: `${pet.name} is already here.` }
      if (isFighting) return { text: 'Not mid-battle.' }
      const old = pet.name
      await $.store.set(key('seen', pet.id), await $.clock.now())
      await $.store.set('lastPick', target.id)
      await leaveNote($, null)
      await become($, target, true)
      return { text: `${old} goes back to the collection. ${target.name} is here now.` }
    }
    case 'hatch': {
      if (hatchSlots() === 0) return { text: `Your collection is full (${MAX_PETS}/${MAX_PETS} hatched). Each session draws one of them; wild shinies still count extra.` }
      const stepping = pet.name
      await $.store.set(key('seen', pet.id), await $.clock.now())
      await startHatching($)
      return { text: `🥚 ${stepping} steps aside: an egg appears…` }
    }
    case 'battle':
    case 'fight':
      return { text: await battle($, arg) }
    case 'visit': {
      if (visitor !== null) return { text: `${visitor.record.name} is already here.` }
      const wanted = arg.toLowerCase()
      const guest =
        wanted === ''
          ? pickOther()
          : (collection.find(p => p.id !== pet.id && p.name.toLowerCase() === wanted) ?? collection.find(p => p.id !== pet.id && p.name.toLowerCase().startsWith(wanted)) ?? null)
      if (guest === null) return { text: collection.length < 2 ? 'Nobody to invite yet. Hatch another pet first.' : `Invite whom? ${collection.filter(p => p.id !== pet.id).map(p => p.name).join(', ')}.` }
      await visit($, guest)
      return { text: `${guest.name} drops by for a few minutes.` }
    }
    case 'fix':
    case 'doctor':
      return { text: await promptDoctor($, arg) }
    case 'quest':
    case 'quests':
      return { text: await questReport($) }
    case 'shop':
      return { text: await shopReport($) }
    case 'buy':
      return { text: await buy($, arg.toLowerCase()) }
    case 'wear':
    case 'equip':
      return { text: await wear($, arg.toLowerCase()) }
    case 'house': {
      if (/^(close|off)$/i.test(arg)) {
        await $.ui.close({ id: HOUSE })
        return { text: 'The pet house is closed.' }
      }
      return { text: await openHouse($) }
    }
    case 'export':
      return { text: await exportAll($) }
    case 'import':
      return { text: await importAll($, arg) }
    case 'voice': {
      const hasVoice = arg === '' ? !prefs.hasVoice : !/^(off|false|no|0)$/i.test(arg)
      await setPrefs($, { hasVoice })
      if (hasVoice) {
        lastSpokeAt = 0
        await speak($, `${pet.name} here. testing, testing.`)
      }
      return {
        text: hasVoice
          ? `${pet.name} reads the occasional roast out loud (Windows speech through WSL, or the macOS voice). /buddy voice off to stop.`
          : `${pet.name} keeps it in writing.`,
      }
    }
    case 'play':
    case 'flappy':
      return { text: await openGame($) }
    case 'catch':
      return { text: await catchWild($) }
    case 'shame':
      return { text: await shameReport($) }
    case '':
    case 'card':
    case 'stats':
      return { text: await card($) }
    case 'pet':
      await petIt($)
      return { text: `You pet ${pet.name}. ♥` }
    case 'feed':
    case 'snack':
      return { text: await feed($) }
    case 'hat':
      return { text: await chooseHat($, arg.toLowerCase()) }
    case 'rename': {
      const name = arg.slice(0, 14)
      if (name.length === 0) return { text: 'Usage: /buddy rename <name>' }
      const old = pet.name
      await savePet($, { ...pet, name })
      await say($, `${name}? I love it`, { isForced: true })
      return { text: `${old} is now called ${name}.` }
    }
    case 'mute':
    case 'quiet':
      await setPrefs($, { isMuted: true })
      return { text: `${pet.name} will keep quiet (it still reacts when you pet, feed or address it). /buddy unmute to undo.` }
    case 'unmute':
    case 'talk':
      await setPrefs($, { isMuted: false })
      await say($, quip('greet'), { isForced: true })
      return { text: `${pet.name} can talk again.` }
    case 'small':
    case 'compact':
      await setPrefs($, { isCompact: true })
      return { text: `${pet.name} now fits on one line. /buddy big to undo.` }
    case 'big':
    case 'full':
      await setPrefs($, { isCompact: false })
      return { text: `${pet.name} is full size again.` }
    case 'hide':
    case 'off':
      await setPrefs($, { isHidden: true })
      return { text: `${pet.name} is hiding. It still gains XP. /buddy show to bring it back.` }
    case 'show':
    case 'on':
      await setPrefs($, { isHidden: false })
      await say($, quip('greet'), { isForced: true })
      return { text: `${pet.name} is back.` }
    case 'sound': {
      const hasSound = arg === '' ? !prefs.hasSound : !/^(off|false|no|0)$/i.test(arg)
      await setPrefs($, { hasSound })
      if (hasSound) await play($, 'quack')
      return { text: hasSound ? 'Sound effects on (Windows audio through WSL, or the macOS player).' : 'Sound effects off.' }
    }
    case 'news': {
      if (/^(off|no)$/i.test(arg)) {
        await setPrefs($, { hasNews: false })
        return { text: `${pet.name} stops yapping about AI news. /buddy news on to undo.` }
      }
      if (/^(on|yes)$/i.test(arg)) {
        await setPrefs($, { hasNews: true })
        return { text: `${pet.name} will yap about the day's AI news now and then.` }
      }
      return { text: await newsReport($) }
    }
    case 'roast':
      return { text: await roastLast($) }
    case 'review':
      return { text: await review($) }
    case 'judge': {
      const wanted = arg.toLowerCase()
      const mode: Judging | null =
        wanted === 'always' ? 'always' : /^(on|sometimes)$/.test(wanted) ? 'sometimes' : /^(off|no)$/.test(wanted) ? 'off' : null
      if (mode === null) return { text: await verdictReport($) }
      await setPrefs($, { judge: mode })
      return {
        text:
          mode === 'off'
            ? `${pet.name} stops judging your prompts. For now.`
            : `${pet.name} judges ${mode === 'always' ? 'every prompt' : 'your prompts now and then'}. Brace yourself.`,
      }
    }
    case 'smart': {
      const isSmart = arg === '' ? !prefs.isSmart : !/^(off|false|no|0)$/i.test(arg)
      await setPrefs($, { isSmart })
      return {
        text: isSmart
          ? `${pet.name} writes its own lines now and then (a short Haiku call, at most every few minutes).`
          : `${pet.name} sticks to its own phrasebook (no model calls).`,
      }
    }
    default:
      return { text: `I don't know "/buddy ${sub}".\n\n${HELP}` }
  }
}

async function savePet($: Engine, changed: PetRecord): Promise<void> {
  pet = changed
  collection = collection.map(p => (p.id === changed.id ? changed : p))
  await $.store.set(key('pet', changed.id), changed)
  await publish($)
}

async function setPrefs($: Engine, change: Partial<Prefs>): Promise<void> {
  prefs = { ...prefs, ...change }
  await $.store.set('prefs', prefs)
  await update($, isHidden, () => prefs.isHidden)
  await publish($)
}

async function chooseHat($: Engine, wanted: string): Promise<string> {
  const unlocked = unlockedHats()
  const level = levelOf(xp).level
  const nextAt = (Math.floor(level / 3) + 1) * 3
  const list = unlocked.length > 0 ? unlocked.join(', ') : 'none yet'
  if (wanted === '') {
    return `Hats unlocked: ${list}. Wearing: ${wornHat() ?? 'nothing'}. Next hat at level ${nextAt}. /buddy hat <name> or /buddy hat none.`
  }
  if (wanted === 'none' || wanted === 'off') {
    if (pet !== null) await savePet($, { ...pet, hat: 'none' })
    return `${pet?.name} took its hat off.`
  }
  if (!unlocked.includes(wanted)) {
    const isKnown = HATS[wanted] !== undefined || EXTRA_HATS[wanted] !== undefined
    return isKnown
      ? `${wanted} isn't unlocked yet. Unlocked: ${list}. Next hat at level ${nextAt}.`
      : `No hat called ${wanted}. Unlocked: ${list}.`
  }
  if (pet !== null) await savePet($, { ...pet, hat: wanted })
  await say($, 'how do I look?', { isForced: true })

  return `${pet?.name} is wearing the ${wanted}.`
}

async function card($: Engine): Promise<string> {
  if (pet === null || bones === null) return ''
  const now = await $.clock.now()
  const { level, into, need } = levelOf(xp)
  const stage = stageOf(level)
  const species = SPECIES[bones.species] ?? SPECIES.blob!
  const worn = wornHat()
  const sprite = [hatRow(worn), ...(species.frames[0] ?? [])].map(row => row.replaceAll('E', pet?.eye ?? bones?.eye ?? '·').padEnd(14))
  const bar = (value: number) => '█'.repeat(Math.round(value / 10)).padEnd(10, '░')
  const arrow = (s: Stat) => (Math.round(drift[s]) > 0 ? ` ↑${Math.round(drift[s])}` : Math.round(drift[s]) < 0 ? ` ↓${-Math.round(drift[s])}` : '')
  const record = asObject(await $.store.get(key('record', pet.id)))
  const eaten = Number(await $.store.get(key('bugs', pet.id))) || 0
  const earned = Object.keys(asObject(await $.store.get('badges'))).length
  const info = [
    `${pet.name}  ${bones.stars} ${bones.rarity} ${speciesLabel(bones.species, level)}${bones.isShiny ? ' ✨ shiny' : ''}${pet.isWild === true ? ' (wild)' : ''}`,
    `level ${level} · stage ${stage} · ${into}/${need} xp to ${level + 1}${level < 10 ? ' · evolves at 10' : level < 20 ? ' · evolves at 20' : ''}`,
    `mood ${moodAt(now)} · fullness ${bar(fullnessAt(now))}`,
    '',
    ...STATS.map(s => `${s.padEnd(10)} ${bar(statOf(s))} ${String(statOf(s)).padStart(3)}${arrow(s)}`),
  ]
  const rows = Math.max(sprite.length, info.length)
  const lines = Array.from({ length: rows }, (_, i) => `${sprite[i] ?? ' '.repeat(14)}${info[i] ?? ''}`.trimEnd())
  const age = Math.max(0, Math.floor((now - pet.hatchedAt) / DAY))
  const gpa = gpaOf(await judgedHistory($))
  const hasDrift = STATS.some(s => Math.round(drift[s]) !== 0)

  return [
    '```',
    ...lines,
    '```',
    `*${pet.personality}*`,
    '',
    `Hatched ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`} · collection ${collection.length} (${MAX_PETS - hatchSlots()}/${MAX_PETS} hatched) · ` +
      `battles ${Number(record.wins) || 0}W ${Number(record.losses) || 0}L · 🐛 eaten ${eaten} · coins ${await coinsOf($)} · badges ${earned}/${BADGES.length} · ` +
      `hats: ${unlockedHats().join(', ') || 'none yet'} · prompting GPA: ${gpa ?? 'not judged yet'}${hasDrift ? ' · ↑↓ stats that drifted with your habits' : ''} · /buddy help`,
  ].join('\n')
}

async function collectionReport($: Engine): Promise<string> {
  if (collection.length === 0) return '🥚 Your first pet is still hatching…'
  const rows: string[] = []
  for (const p of collection) {
    const b = bonesOf(p)
    const face = (SPECIES[b.species] ?? SPECIES.blob!).face.replaceAll('E', p.eye ?? b.eye)
    const level = levelOf(Number((await $.store.get(key('xp', p.id))) ?? 0) || 0).level
    const r = asObject(await $.store.get(key('record', p.id)))
    const rel = pet !== null && p.id !== pet.id ? relationOf(await bondOf($, pet.id, p.id)) : null
    const here = p.id === pet?.id ? '  ← here now' : ''
    const marks = `${b.isShiny ? ' ✨' : ''}${p.isWild === true ? ' wild' : ''}`
    const fights = Number(r.wins) || Number(r.losses) ? ` ${Number(r.wins) || 0}W${Number(r.losses) || 0}L` : ''
    rows.push(`${face.padEnd(11)} ${p.name.padEnd(14)} ${b.stars.padEnd(5)} ${`${b.rarity} ${speciesLabel(b.species, level)}${marks}`.padEnd(24)} lvl ${String(level).padEnd(2)}${fights}${rel === null ? '' : ` · ${rel}`}${here}`)
  }
  const hatched = MAX_PETS - hatchSlots()
  const next =
    hatchSlots() > 0
      ? `Each new session hatches an egg until you have ${MAX_PETS}; then each session draws one at random.`
      : 'Your collection is full: each session draws one at random, never the last one twice.'

  return [`**Your collection** (${collection.length} pets, ${hatched}/${MAX_PETS} hatched)`, '', '```', ...rows, '```', next, '', '/buddy swap <name> · /buddy hatch · /buddy battle <name> · /buddy visit [name] · /buddy dex'].join('\n')
}

const HELP = [
  '/buddy: show the card (stats, level, mood)',
  '/buddy pets: your collection; /buddy swap <name> to switch, /buddy hatch for a new egg (up to 10)',
  '/buddy battle <name>: a three-round stat duel against one of your other pets (winner +10 xp)',
  '/buddy visit [name]: have another pet drop by for a chat',
  '/buddy catch: catch a wild shiny while it wanders by (30 seconds)',
  '/buddy dex: every species, found and not',
  '/buddy badges: your achievements',
  "/buddy journal [write]: the pets' diary of your sessions",
  '/buddy pet: pet it (or click it in fullscreen)',
  '/buddy feed: feed it when it gets hungry',
  '/buddy hat [name|none]: list or wear unlocked hats (one every 3 levels)',
  '/buddy rename <name>',
  '/buddy mute | unmute: stop or allow unprompted chatter',
  '/buddy small | big: one-line or full-size pet',
  '/buddy hide | show',
  '/buddy sound [on|off]: sound effects',
  '/buddy voice [on|off]: it reads the occasional roast out loud',
  '/buddy house [close]: a pane with the whole collection at once',
  '/buddy play: Flappy Duck in a pane; f (or a click on the sky, then space) flaps, r restarts, esc closes; the score pays xp',
  "/buddy quest: today's quest and your streak (five days in a row earns the laurel)",
  '/buddy shop | buy <id> | wear <id|none>: spend bug coins on eyes, hats and a tiny sword',
  '/buddy fix [text]: the pet rewrites your last prompt (or the text) into the prompt box, ready to send',
  '/buddy export | import <path>: back up or restore the whole collection',
  '/buddy smart [on|off]: let it write its own lines with Haiku now and then',
  "/buddy judge [always|sometimes|off]: it grades and roasts your prompts, your commit messages and Claude's answers; bare, the GPAs and last verdicts",
  '/buddy roast: a big-brain (Opus) roast of your last prompt, rewritten the way you should have sent it',
  '/buddy review: a big-brain (Opus) review of how you prompted this session',
  "/buddy shame: this week's Hall of Shame, held every Friday (Opus)",
  "/buddy news [on|off]: today's AI headlines (Hacker News) and a hot take; it also yaps one now and then",
  '',
  'Say its name in a prompt to talk to it. Levels 10 and 20 evolve it; a green test run feeds it the bugs a red one left.',
].join('\n')

// Small helpers

function addresses(text: string, name: string): boolean {
  const n = escapeRegExp(name)
  // Case-sensitive on the name, so "pip install" never wakes Pip.
  return (
    new RegExp(`@${n}\\b`, 'i').test(text) ||
    new RegExp(`^\\s*${n}\\b[\\s,!?.:]*`).test(text) ||
    new RegExp(`\\b(hey|hi|hello|hoi|hallo|dag|thanks|thank you|bedankt|dank je|good|goed|bye|doei|love you)[,\\s]+${n}\\b`, 'i').test(text) ||
    new RegExp(`\\b${n}\\s*[?!]`).test(text)
  )
}

function randomSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  } catch {
    return Math.floor(Math.random() * 2 ** 32)
  }
}

function isPetRecord(value: unknown): value is PetRecord {
  const v = asObject(value)
  return typeof v.id === 'string' && typeof v.seed === 'number' && typeof v.name === 'string' && typeof v.personality === 'string' && typeof v.hatchedAt === 'number'
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '…'
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

function localDate(at: number): string {
  const d = new Date(at)
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`
}
