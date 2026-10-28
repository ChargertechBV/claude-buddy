// /buddy: the command, the card and collection reports, export and import.

import { EXTRA_HATS, HATS, SPECIES, STATS, silhouette } from './art'
import type { Stat } from './art'
import { BADGES } from './badges'
import { gpaOf } from './grading'
import { judgedHistory, promptDoctor, review, roastLast, shameReport, verdictReport } from './buddy-judge'
import { become, bonesOf, feed, fullnessAt, hatRow, hatchSlots, levelOf, loadCollection, moodAt, petIds, petIt, publish, savePet, setPrefs, speciesLabel, stageOf, startHatching, statOf, unlockedHats, wornHat } from './buddy-life'
import { battle, bondOf, catchWild, leaveNote, pickOther, relationOf, visit } from './buddy-social'
import { DAY, HOUSE, MAX_PETS, asObject, buddy, key, localDate } from './buddy-state'
import type { Engine, Judging, PetRecord } from './buddy-state'
import { play, quip, say, speak } from './buddy-voice'
import { buy, coinsOf, completeQuest, journalReport, newsReport, openGame, openHouse, publishHouse, questReport, shopReport, todayKey, wear, writeJournal } from './buddy-world'

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

// The dex: every species, found and not

function dexReport(): string {
  const owned = new Map<string, PetRecord[]>()
  for (const p of buddy.collection) {
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

// Export and import: the whole store as one file

async function exportAll($: Engine): Promise<string> {
  const now = await $.clock.now()
  const keys = await $.store.keys()
  const data: Record<string, unknown> = {}
  for (const k of keys) data[k] = await $.store.get(k)
  const home = (await $.env.get('HOME')) ?? '/tmp'
  const path = `${home}/claude-mods/buddy-export-${todayKey(now)}.json`
  await $.fs.write(path, JSON.stringify({ exportedAt: now, version: 2, data }, null, 2))

  return `Exported ${buddy.collection.length} pet${buddy.collection.length === 1 ? '' : 's'} and ${keys.length} records to ${path}. /buddy import ${path} brings them back.`
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
  buddy.collection = await loadCollection($)
  await publish($)
  await publishHouse($)

  return `Imported ${written} records; the collection now holds ${buddy.collection.length} pet${buddy.collection.length === 1 ? '' : 's'}.`
}

// /buddy

export async function runCommand($: Engine, args: string): Promise<{ text: string }> {
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
  if (buddy.pet === null || buddy.bones === null) return { text: '🥚 Still hatching… give it a few seconds.' }

  switch (sub) {
    case 'swap':
    case 'switch': {
      const wanted = arg.toLowerCase()
      const target = buddy.collection.find(p => p.name.toLowerCase() === wanted) ?? buddy.collection.find(p => p.name.toLowerCase().startsWith(wanted))
      if (wanted === '' || target === undefined) {
        return { text: `Swap to whom? Your collection: ${buddy.collection.map(p => p.name).join(', ')}.` }
      }
      if (target.id === buddy.pet.id) return { text: `${buddy.pet.name} is already here.` }
      if (buddy.isFighting) return { text: 'Not mid-battle.' }
      const old = buddy.pet.name
      await $.store.set(key('seen', buddy.pet.id), await $.clock.now())
      await $.store.set('lastPick', target.id)
      await leaveNote($, null)
      await become($, target, true)
      return { text: `${old} goes back to the collection. ${target.name} is here now.` }
    }
    case 'hatch': {
      if (hatchSlots() === 0) return { text: `Your collection is full (${MAX_PETS}/${MAX_PETS} hatched). Each session draws one of them; wild shinies still count extra.` }
      const stepping = buddy.pet.name
      await $.store.set(key('seen', buddy.pet.id), await $.clock.now())
      await startHatching($)
      return { text: `🥚 ${stepping} steps aside: an egg appears…` }
    }
    case 'battle':
    case 'fight':
      return { text: await battle($, arg) }
    case 'visit': {
      if (buddy.visitor !== null) return { text: `${buddy.visitor.record.name} is already here.` }
      const wanted = arg.toLowerCase()
      const me = buddy.pet
      const guest =
        wanted === ''
          ? pickOther()
          : (buddy.collection.find(p => p.id !== me.id && p.name.toLowerCase() === wanted) ?? buddy.collection.find(p => p.id !== me.id && p.name.toLowerCase().startsWith(wanted)) ?? null)
      if (guest === null) return { text: buddy.collection.length < 2 ? 'Nobody to invite yet. Hatch another pet first.' : `Invite whom? ${buddy.collection.filter(p => p.id !== me.id).map(p => p.name).join(', ')}.` }
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
      const hasVoice = arg === '' ? !buddy.prefs.hasVoice : !/^(off|false|no|0)$/i.test(arg)
      await setPrefs($, { hasVoice })
      if (hasVoice) {
        buddy.lastSpokeAt = 0
        await speak($, `${buddy.pet.name} here. testing, testing.`)
      }
      return {
        text: hasVoice
          ? `${buddy.pet.name} reads the occasional roast out loud (Windows speech through WSL, or the macOS voice). /buddy voice off to stop.`
          : `${buddy.pet.name} keeps it in writing.`,
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
      return { text: `You pet ${buddy.pet.name}. ♥` }
    case 'feed':
    case 'snack':
      return { text: await feed($) }
    case 'hat':
      return { text: await chooseHat($, arg.toLowerCase()) }
    case 'rename': {
      const name = arg.slice(0, 14)
      if (name.length === 0) return { text: 'Usage: /buddy rename <name>' }
      const old = buddy.pet.name
      await savePet($, { ...buddy.pet, name })
      await say($, `${name}? I love it`, { isForced: true })
      return { text: `${old} is now called ${name}.` }
    }
    case 'mute':
    case 'quiet':
      await setPrefs($, { isMuted: true })
      return { text: `${buddy.pet.name} will keep quiet (it still reacts when you pet, feed or address it). /buddy unmute to undo.` }
    case 'unmute':
    case 'talk':
      await setPrefs($, { isMuted: false })
      await say($, quip('greet'), { isForced: true })
      return { text: `${buddy.pet.name} can talk again.` }
    case 'small':
    case 'compact':
      await setPrefs($, { isCompact: true })
      return { text: `${buddy.pet.name} now fits on one line. /buddy big to undo.` }
    case 'big':
    case 'full':
      await setPrefs($, { isCompact: false })
      return { text: `${buddy.pet.name} is full size again.` }
    case 'hide':
    case 'off':
      await setPrefs($, { isHidden: true })
      return { text: `${buddy.pet.name} is hiding. It still gains XP. /buddy show to bring it back.` }
    case 'show':
    case 'on':
      await setPrefs($, { isHidden: false })
      await say($, quip('greet'), { isForced: true })
      return { text: `${buddy.pet.name} is back.` }
    case 'sound': {
      const hasSound = arg === '' ? !buddy.prefs.hasSound : !/^(off|false|no|0)$/i.test(arg)
      await setPrefs($, { hasSound })
      if (hasSound) await play($, 'quack')
      return { text: hasSound ? 'Sound effects on (Windows audio through WSL, or the macOS player).' : 'Sound effects off.' }
    }
    case 'news': {
      if (/^(off|no)$/i.test(arg)) {
        await setPrefs($, { hasNews: false })
        return { text: `${buddy.pet.name} stops yapping about AI news. /buddy news on to undo.` }
      }
      if (/^(on|yes)$/i.test(arg)) {
        await setPrefs($, { hasNews: true })
        return { text: `${buddy.pet.name} will yap about the day's AI news now and then.` }
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
            ? `${buddy.pet.name} stops judging your prompts. For now.`
            : `${buddy.pet.name} judges ${mode === 'always' ? 'every prompt' : 'your prompts now and then'}. Brace yourself.`,
      }
    }
    case 'smart': {
      const isSmart = arg === '' ? !buddy.prefs.isSmart : !/^(off|false|no|0)$/i.test(arg)
      await setPrefs($, { isSmart })
      return {
        text: isSmart
          ? `${buddy.pet.name} writes its own lines now and then (a short Haiku call, at most every few minutes).`
          : `${buddy.pet.name} sticks to its own phrasebook (no model calls).`,
      }
    }
    default:
      return { text: `I don't know "/buddy ${sub}".\n\n${HELP}` }
  }
}

export async function chooseHat($: Engine, wanted: string): Promise<string> {
  const unlocked = unlockedHats()
  const level = levelOf(buddy.xp).level
  const nextAt = (Math.floor(level / 3) + 1) * 3
  const list = unlocked.length > 0 ? unlocked.join(', ') : 'none yet'
  if (wanted === '') {
    return `Hats unlocked: ${list}. Wearing: ${wornHat() ?? 'nothing'}. Next hat at level ${nextAt}. /buddy hat <name> or /buddy hat none.`
  }
  if (wanted === 'none' || wanted === 'off') {
    if (buddy.pet !== null) await savePet($, { ...buddy.pet, hat: 'none' })
    return `${buddy.pet?.name} took its hat off.`
  }
  if (!unlocked.includes(wanted)) {
    const isKnown = HATS[wanted] !== undefined || EXTRA_HATS[wanted] !== undefined
    return isKnown
      ? `${wanted} isn't unlocked yet. Unlocked: ${list}. Next hat at level ${nextAt}.`
      : `No hat called ${wanted}. Unlocked: ${list}.`
  }
  if (buddy.pet !== null) await savePet($, { ...buddy.pet, hat: wanted })
  await say($, 'how do I look?', { isForced: true })

  return `${buddy.pet?.name} is wearing the ${wanted}.`
}

async function card($: Engine): Promise<string> {
  if (buddy.pet === null || buddy.bones === null) return ''
  const now = await $.clock.now()
  const { level, into, need } = levelOf(buddy.xp)
  const stage = stageOf(level)
  const species = SPECIES[buddy.bones.species] ?? SPECIES.blob!
  const worn = wornHat()
  const sprite = [hatRow(worn), ...(species.frames[0] ?? [])].map(row => row.replaceAll('E', buddy.pet?.eye ?? buddy.bones?.eye ?? '·').padEnd(14))
  const bar = (value: number) => '█'.repeat(Math.round(value / 10)).padEnd(10, '░')
  const arrow = (s: Stat) => (Math.round(buddy.drift[s]) > 0 ? ` ↑${Math.round(buddy.drift[s])}` : Math.round(buddy.drift[s]) < 0 ? ` ↓${-Math.round(buddy.drift[s])}` : '')
  const record = asObject(await $.store.get(key('record', buddy.pet.id)))
  const eaten = Number(await $.store.get(key('bugs', buddy.pet.id))) || 0
  const earned = Object.keys(asObject(await $.store.get('badges'))).length
  const info = [
    `${buddy.pet.name}  ${buddy.bones.stars} ${buddy.bones.rarity} ${speciesLabel(buddy.bones.species, level)}${buddy.bones.isShiny ? ' ✨ shiny' : ''}${buddy.pet.isWild === true ? ' (wild)' : ''}`,
    `level ${level} · stage ${stage} · ${into}/${need} xp to ${level + 1}${level < 10 ? ' · evolves at 10' : level < 20 ? ' · evolves at 20' : ''}`,
    `mood ${moodAt(now)} · fullness ${bar(fullnessAt(now))}`,
    '',
    ...STATS.map(s => `${s.padEnd(10)} ${bar(statOf(s))} ${String(statOf(s)).padStart(3)}${arrow(s)}`),
  ]
  const rows = Math.max(sprite.length, info.length)
  const lines = Array.from({ length: rows }, (_, i) => `${sprite[i] ?? ' '.repeat(14)}${info[i] ?? ''}`.trimEnd())
  const age = Math.max(0, Math.floor((now - buddy.pet.hatchedAt) / DAY))
  const gpa = gpaOf(await judgedHistory($))
  const hasDrift = STATS.some(s => Math.round(buddy.drift[s]) !== 0)

  return [
    '```',
    ...lines,
    '```',
    `*${buddy.pet.personality}*`,
    '',
    `Hatched ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`} · collection ${buddy.collection.length} (${MAX_PETS - hatchSlots()}/${MAX_PETS} hatched) · ` +
      `battles ${Number(record.wins) || 0}W ${Number(record.losses) || 0}L · 🐛 eaten ${eaten} · coins ${await coinsOf($)} · badges ${earned}/${BADGES.length} · ` +
      `hats: ${unlockedHats().join(', ') || 'none yet'} · prompting GPA: ${gpa ?? 'not judged yet'}${hasDrift ? ' · ↑↓ stats that drifted with your habits' : ''} · /buddy help`,
  ].join('\n')
}

async function collectionReport($: Engine): Promise<string> {
  if (buddy.collection.length === 0) return '🥚 Your first pet is still hatching…'
  const rows: string[] = []
  for (const p of buddy.collection) {
    const b = bonesOf(p)
    const face = (SPECIES[b.species] ?? SPECIES.blob!).face.replaceAll('E', p.eye ?? b.eye)
    const level = levelOf(Number((await $.store.get(key('xp', p.id))) ?? 0) || 0).level
    const r = asObject(await $.store.get(key('record', p.id)))
    const rel = buddy.pet !== null && p.id !== buddy.pet.id ? relationOf(await bondOf($, buddy.pet.id, p.id)) : null
    const here = p.id === buddy.pet?.id ? '  ← here now' : ''
    const marks = `${b.isShiny ? ' ✨' : ''}${p.isWild === true ? ' wild' : ''}`
    const fights = Number(r.wins) || Number(r.losses) ? ` ${Number(r.wins) || 0}W${Number(r.losses) || 0}L` : ''
    rows.push(`${face.padEnd(11)} ${p.name.padEnd(14)} ${b.stars.padEnd(5)} ${`${b.rarity} ${speciesLabel(b.species, level)}${marks}`.padEnd(24)} lvl ${String(level).padEnd(2)}${fights}${rel === null ? '' : ` · ${rel}`}${here}`)
  }
  const hatched = MAX_PETS - hatchSlots()
  const next =
    hatchSlots() > 0
      ? `Each new session hatches an egg until you have ${MAX_PETS}; then each session draws one at random.`
      : 'Your collection is full: each session draws one at random, never the last one twice.'

  return [`**Your collection** (${buddy.collection.length} pets, ${hatched}/${MAX_PETS} hatched)`, '', '```', ...rows, '```', next, '', '/buddy swap <name> · /buddy hatch · /buddy battle <name> · /buddy visit [name] · /buddy dex'].join('\n')
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
