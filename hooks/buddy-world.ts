// The world around the pet: AI news, git, the journal, quests, the shop, the pet
// house and Flappy Duck.

import { atom, read, update } from 'claude-code'

import type { GameView, HouseView } from '../types'
import { SPECIES } from './art'
import type { Lines } from './grading'
import { QUESTS, questFor } from './quests'
import { SHOP, itemOf } from './shop'
import { chooseHat } from './buddy-commands'
import { sessionPrompts } from './buddy-judge'
import { award, bonesOf, count, gainXp, hatOf, hatRow, levelOf, nudge, savePet, stageOf, tally } from './buddy-life'
import { bondOf, leaveNote, relationOf } from './buddy-social'
import { DAY, GAME, HOUR, HOUSE, MINUTE, SECOND, asObject, buddy, clip, freshFacts, key, localDate, pad2 } from './buddy-state'
import type { Engine } from './buddy-state'
import { ask, fill, firstLine, jsonOf, persona, pickLine, play, say, voice } from './buddy-voice'

const house = atom({ plugin: 'buddy', key: 'house' } as const, null)

/** Reads `house` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function houseOf($: Engine) {
  return read($, house)
}
const game = atom({ plugin: 'buddy', key: 'game' } as const, null)

/** Reads `game` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function gameOf($: Engine) {
  return read($, game)
}
type Story = { id: string; title: string; url: string; points: number; comments: number }
type GitState = { branch: string; changed: number; ahead: number }
const NEWS_EVERY = 45 * MINUTE
const NEWS_FRESH_FOR = 2 * HOUR
const NAG_EVERY = HOUR
const AI = /\b(AI|A\.I\.|LLMs?|GPT[-\w.]*|OpenAI|Anthropic|Claude|Gemini|DeepMind|Llama|Mistral|AGI|ASI|chatbots?|Copilot|Cursor|neural|transformers?|diffusion|Nvidia|agents?|agentic|vibe ?cod\w*|Grok|xAI|Qwen|DeepSeek|machine learning|superintelligence)\b/i
let git: GitState | null = null
let lastNag = { changed: 0, ahead: 0 }

// AI news, yapped: the day's AI stories off Hacker News, one hot take at a time

export function shouldYap(now: number): boolean {
  if (!buddy.prefs.hasNews || buddy.prefs.isMuted || buddy.bones === null) return false
  // Only to someone who is around, not in the session's first minutes, and rarely.
  if (now - buddy.lastActivity > 5 * MINUTE || now - buddy.sessionStartedAt < 5 * MINUTE) return false
  if (now - buddy.lastNewsAt < NEWS_EVERY || now - buddy.lastSaidAt < 2 * MINUTE) return false
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

export async function yapNews($: Engine, isAsked: boolean): Promise<Story | null> {
  if (buddy.pet === null) return null
  const stories = await todaysStories($)
  const stored = await $.store.get('newsSeen')
  const seen = Array.isArray(stored) ? (stored as string[]) : []
  const story = stories.find(s => !seen.includes(s.id)) ?? (isAsked ? stories[0] : undefined)
  if (story === undefined) return null
  await $.store.set('newsSeen', [...seen.filter(id => id !== story.id), story.id].slice(-300))
  buddy.facts.news += 1
  await nudge($, 'CHAOS', 0.1)

  const take = (await smartTake($, story)) ?? localTake(story)
  await say($, `📰 ${take}`, { isForced: true, ttl: 20 * SECOND })
  if (!isAsked) $.ui.log(`📰 ${buddy.pet.name} is yapping about: ${story.title} · ${story.url} (${story.points} points on Hacker News)`)

  return story
}

async function smartTake($: Engine, story: Story): Promise<string | null> {
  if (buddy.pet === null || buddy.bones === null) return null
  const system =
    `${persona()} You just read an AI headline and can't keep it to yourself. Write ONE line of at most 90 ` +
    `characters that says what happened (paraphrased, so it makes sense on its own) and gives your hot take: ` +
    `full hype ("we're so back", AGI by Tuesday) or full doom ("it's so over"), whichever the news and your ` +
    `stats push you to; high CHAOS goes off the rails. Overdramatic is the point. You only know the headline: ` +
    `invent no details. No hashtags, no quotes around it.`
  const reply = await ask($, system, `Headline: "${story.title}" (${story.points} points, ${story.comments} comments on Hacker News)\n\n${buddy.pet.name} says:`)
  const line = reply === null ? null : firstLine(reply)

  return line === null ? null : clip(line, 110)
}

const HYPE = ["we're so back", 'AGI by tuesday', 'accelerate!!', 'this changes everything (again)', 'the singularity is near-ish']
const DOOM = ["it's so over", 'pack it up, folks', 'I, for one, welcome our new overlords', 'bunker time', 'we had a good run']
const DOOMY = /\b(ban|bans|banned|fire[sd]?|lawsuit|sues?|leak\w*|layoffs?|risk|safety|danger\w*|less than|cuts?|fail\w*|bubble|warn\w*|crash\w*|down|bunker|quits?|resign\w*)\b/i

function localTake(story: Story): string {
  return `${clip(story.title, 60)}… ${pickLine(DOOMY.test(story.title) ? DOOM : HYPE)}`
}

export async function newsReport($: Engine): Promise<string> {
  if (buddy.pet === null) return 'Still hatching…'
  const stories = await todaysStories($)
  if (stories.length === 0) {
    return `${buddy.pet.name} found no AI news on Hacker News in the last 24 hours, or couldn't reach it. Suspiciously quiet…`
  }
  buddy.lastNewsAt = await $.clock.now()
  await yapNews($, true)

  return [
    `**Today's AI news, as ${buddy.pet.name} reads it** (Hacker News, last 24 hours)`,
    '',
    ...stories
      .slice(0, 8)
      .map(s => `- [${s.title}](${s.url}) · ${s.points} points · [${s.comments} comments](https://news.ycombinator.com/item?id=${s.id})`),
    '',
    buddy.prefs.hasNews
      ? `${buddy.pet.name} yaps about one of these now and then. /buddy news off to stop.`
      : `/buddy news on to have ${buddy.pet.name} yap about these on its own.`,
  ].join('\n')
}

// The journal: a diary entry per session, in the pet's voice

export async function endOfDay($: Engine, now: number): Promise<void> {
  if (buddy.facts.tools >= 20 && buddy.facts.fails === 0) await award($, 'clean-day')
  if (now - buddy.sessionStartedAt >= 4 * HOUR) await award($, 'insomniac')
  const written = await writeJournal($, false)
  if (buddy.facts.prompts >= 1) await leaveNote($, written?.note ?? null)
  buddy.facts = freshFacts()
  buddy.sessionStartedAt = now
}

export async function writeJournal($: Engine, isAsked: boolean): Promise<{ text: string; note: string | null } | null> {
  if (buddy.pet === null || buddy.bones === null) return null
  if (!isAsked && buddy.facts.prompts < 2) return null
  const now = await $.clock.now()
  const made = await smartEntry($)
  const text = made?.diary ?? localEntry()
  const stored = await $.store.get('journal')
  const entries = Array.isArray(stored) ? stored : []
  await $.store.set('journal', [...entries, { at: now, pet: buddy.pet.name, text }].slice(-60))

  return { text, note: made?.note ?? null }
}

function localEntry(): string {
  const bits = [
    `${buddy.facts.prompts} prompt${buddy.facts.prompts === 1 ? '' : 's'}`,
    `${buddy.facts.tools} tool call${buddy.facts.tools === 1 ? '' : 's'}${buddy.facts.fails > 0 ? ` (${buddy.facts.fails} failed)` : ''}`,
    buddy.facts.commits > 0 ? `${buddy.facts.commits} commit${buddy.facts.commits === 1 ? '' : 's'}` : '',
    buddy.facts.greens > 0 ? `tests green ${buddy.facts.greens}×` : '',
    buddy.facts.bugsEaten > 0 ? `${buddy.facts.bugsEaten} bug${buddy.facts.bugsEaten === 1 ? '' : 's'} eaten` : '',
    buddy.facts.battles > 0 ? `${buddy.facts.battles} battle${buddy.facts.battles === 1 ? '' : 's'}` : '',
  ].filter(b => b.length > 0)
  const longest = buddy.facts.longestTurnMs >= MINUTE ? ` Longest turn: ${Math.round(buddy.facts.longestTurnMs / MINUTE)} min.` : ''
  const grades = buddy.facts.grades.length > 0 ? ` Grades handed out: ${buddy.facts.grades.join(' ')}.` : ''
  const mood = voice().isSnarky ? 'I regret nothing.' : 'A good day, mostly.'

  return `Dear diary. ${bits.join(', ')}.${grades}${longest} ${mood}`
}

async function smartEntry($: Engine): Promise<{ diary: string; note: string | null } | null> {
  if (buddy.pet === null || buddy.bones === null) return null
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

export async function journalReport($: Engine): Promise<string> {
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

// Daily quests

type QuestState = { day: string; id: string; isDone: boolean; streak: number; lastDoneDay: string }

export function todayKey(now: number): string {
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

export async function completeQuest($: Engine, id: string): Promise<void> {
  if (buddy.pet === null) return
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
  if (streak % 5 === 0 && !(buddy.pet.extras ?? []).includes('laurel')) {
    await savePet($, { ...buddy.pet, extras: [...(buddy.pet.extras ?? []), 'laurel'] })
    $.ui.toast(`🏅 ${streak} days of quests in a row: ${buddy.pet.name} earned the laurel (/buddy hat laurel)`)
  }
  if (buddy.bubble === null) await say($, "quest complete. I'm basically a hero", { isForced: true, ttl: 6 * SECOND })
}

export async function questReport($: Engine): Promise<string> {
  const now = await $.clock.now()
  const q = await questState($, now)
  const quest = QUESTS.find(x => x.id === q.id) ?? QUESTS[0]!

  return [
    `**Today's quest:** ${quest.text} (+${quest.xp} xp) — ${q.isDone ? '✅ done' : 'not yet'}`,
    `Streak: ${q.streak} day${q.streak === 1 ? '' : 's'}${q.streak === 0 ? " (complete today's to start one)" : ''} · every five days in a row earns the laurel hat.`,
  ].join('\n')
}

// The shop

export async function coinsOf($: Engine): Promise<number> {
  return Math.max(0, (await tally($)).bugsEaten - buddy.coinsSpent)
}

export async function shopReport($: Engine): Promise<string> {
  const coins = await coinsOf($)
  const rows = SHOP.map(i => `- ${buddy.owned.includes(i.id) ? '✅' : '🪙'} **${i.name}** (${i.id}) — ${i.price} coins · ${i.hint}${buddy.owned.includes(i.id) ? ' · owned' : ''}`)

  return [
    `**The hat shop** · you have ${coins} bug coin${coins === 1 ? '' : 's'} (one per bug eaten)`,
    '',
    ...rows,
    '',
    '/buddy buy <id> · /buddy wear <id|none> for eyes and the sword · /buddy hat <name> for hats',
  ].join('\n')
}

export async function buy($: Engine, id: string): Promise<string> {
  const item = itemOf(id)
  if (item === undefined) return `No such item. The shop has: ${SHOP.map(i => i.id).join(', ')}.`
  if (buddy.owned.includes(item.id)) return `You already own the ${item.name}. /buddy wear ${item.id}`
  const coins = await coinsOf($)
  if (coins < item.price) return `The ${item.name} costs ${item.price} coins; you have ${coins}. Eat more bugs.`
  buddy.coinsSpent += item.price
  buddy.owned = [...buddy.owned, item.id]
  await $.store.set('coinsSpent', buddy.coinsSpent)
  await $.store.set('owned', buddy.owned)
  await play($, 'pop')
  const worn = await wear($, item.id)

  return `Bought the ${item.name} for ${item.price} coins (${coins - item.price} left). ${worn}`
}

export async function wear($: Engine, id: string): Promise<string> {
  if (buddy.pet === null) return 'Still hatching…'
  if (id === 'none' || id === 'off') {
    const { eye: _eye, sword: _sword, ...bare } = buddy.pet
    await savePet($, bare)
    return `${buddy.pet.name} took off its eyewear and sword.`
  }
  const item = itemOf(id)
  if (item === undefined || !buddy.owned.includes(item.id)) return `You don't own "${id}". /buddy shop`
  if (item.kind === 'hat') return chooseHat($, item.value)
  if (item.kind === 'eye') {
    await savePet($, { ...buddy.pet, eye: item.value })
    await say($, 'how do I look?', { isForced: true })
    return `${buddy.pet.name} wears the ${item.name}.`
  }
  await savePet($, { ...buddy.pet, sword: true })
  await say($, 'en garde', { isForced: true })

  return `${buddy.pet.name} carries the ${item.name}: ⚔ by its name, +3 luck in every battle round.`
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

export async function gitCheckAndNag($: Engine): Promise<void> {
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
  if (git === null || buddy.prefs.isMuted || buddy.isAsleep || buddy.pet === null) return
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

export async function mainBranchNag($: Engine): Promise<void> {
  const state = await checkGit($)
  if (state === null || !/^(main|master)$/.test(state.branch) || buddy.prefs.isMuted) return
  const l = GIT_LINES.main!
  await say($, fill(pickLine(voice().isSnarky ? l.snark : l.sweet), { branch: state.branch }), { isForced: true, ttl: 10 * SECOND })
}

// The pet house

export async function openHouse($: Engine): Promise<string> {
  await publishHouse($)
  const { isPlaced } = await $.ui.open({ id: HOUSE, title: 'Pet house' })

  return isPlaced
    ? 'The pet house is open: the whole collection, the one on duty starred. ctrl+x x or /buddy house close closes it.'
    : 'The pet house opens as soon as the layout has room for a pane (fullscreen docks it beside the transcript).'
}

export async function publishHouse($: Engine): Promise<void> {
  const rows: HouseView[] = []
  for (const p of buddy.collection) {
    const b = bonesOf(p)
    const look = SPECIES[b.species] ?? SPECIES.blob!
    const level = levelOf(Number((await $.store.get(key('xp', p.id))) ?? 0) || 0).level
    const relation = buddy.pet !== null && p.id !== buddy.pet.id ? relationOf(await bondOf($, buddy.pet.id, p.id)) : null
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
      isHere: p.id === buddy.pet?.id,
      relation: relation ?? '',
    })
  }
  await update($, house, () => rows)
}

// Flappy Duck

export async function openGame($: Engine): Promise<string> {
  if (buddy.pet === null || buddy.bones === null) return 'Still hatching…'
  const look = SPECIES[buddy.bones.species] ?? SPECIES.blob!
  const high = Number(await $.store.get(key('high', buddy.pet.id))) || 0
  const now = await read($, game)
  const view: GameView = {
    name: buddy.pet.name,
    face: look.face.replaceAll('E', buddy.pet.eye ?? buddy.bones.eye),
    color: buddy.bones.color,
    isShiny: buddy.bones.isShiny,
    flaps: now?.flaps ?? 0,
    restarts: (now?.restarts ?? 0) + 1,
    high,
  }
  await update($, game, () => view)
  const { isPlaced } = await $.ui.open({ id: GAME, title: 'Flappy Duck', focus: true, closeOnEscape: true, rows: 17 })
  await say($, 'I was born for this', { isForced: true })

  return isPlaced
    ? `🛩️ Flappy ${buddy.pet.name} is up: f flaps (or click the sky, then space), r restarts, esc closes. Best so far: ${high}.`
    : 'Flappy Duck opens as soon as the layout has room for a pane.'
}

export async function gameOver($: Engine, score: number, bugs: number): Promise<void> {
  if (buddy.pet === null) return
  const earned = Math.min(50, score + 2 * bugs)
  const high = Number(await $.store.get(key('high', buddy.pet.id))) || 0
  const isBest = score > high
  if (isBest) {
    await $.store.set(key('high', buddy.pet.id), score)
    await update($, game, now => (now === null ? now : { ...now, high: score }))
  }
  await count($, 'games', 1)
  if (earned > 0) await gainXp($, earned)
  await play($, isBest && score > 0 ? 'fanfare' : 'sad')
  $.ui.toast(`🛩️ Flappy ${buddy.pet.name}: score ${score}, 🐛 ${bugs}${earned > 0 ? ` (+${earned} xp)` : ''}${isBest && score > 0 ? ' · new best!' : ''}`)
  await say($, score === 0 ? 'the floor is lava. I checked' : isBest ? 'new record. frame it' : pickLine(['ow. pipes.', 'the pipe moved', 'I meant to do that']), { isForced: true, ttl: 8 * SECOND })
  if (score >= 5) await completeQuest($, 'fly')
  if (score >= 10) await award($, 'pilot')
  if (score >= 30) await award($, 'ace')
}

/** The game pane's flap button: one more flap for the duck. */
export async function flapGame($: Engine): Promise<void> {
  await update($, game, now => (now === null ? now : { ...now, flaps: now.flaps + 1 }))
}

/** The game pane's restart button. */
export async function restartGame($: Engine): Promise<void> {
  await update($, game, now => (now === null ? now : { ...now, restarts: now.restarts + 1 }))
}
