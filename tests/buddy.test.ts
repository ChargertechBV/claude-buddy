import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { EGG, HATS, QUIPS, SPECIES, roll } from '../hooks/art'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const SOUL = '{"name": "Zork", "personality": "A test pet who loves green checkmarks."}'
const PRESENTATION = { isFullscreen: true, columns: 120 }
const BAND = {
  plugin: 'buddy',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// The engine beneath the plugin: a clock, a store, a model that names pets,
// and quiet answers for registration and toasts.
type Asked = { model: string; system?: string; prompt: string }

type Row = { role: 'user' | 'assistant'; text: string; toolUses: never[] }
const HITS = {
  hits: [
    { objectID: '1', title: 'OpenAI fires three safety researchers', url: 'https://example.com/fired', points: 64, num_comments: 31 },
    { objectID: '2', title: 'A new open-weights LLM tops the leaderboard', url: 'https://example.com/llm', points: 300, num_comments: 120 },
    { objectID: '3', title: 'My sourdough starter turned five', url: 'https://example.com/bread', points: 900, num_comments: 400 },
  ],
}

type Extra = { env?: Record<string, string>; percent?: number; now?: number; git?: string }

function engine(on: On, entries: Record<string, unknown> = {}, reply = SOUL, messages: Row[] = [], extra: Extra = {}) {
  const clock = mock.clock(on, { now: extra.now ?? Date.UTC(2026, 9, 9, 12) })
  // The merged mod hides the band by default (the pet lives in the Soundtrack pane); these tests look at the band.
  mock.store(on, { ...entries, prefs: { isHidden: false, ...(typeof entries.prefs === 'object' && entries.prefs !== null ? (entries.prefs as Record<string, unknown>) : {}) } })
  mock.env(on, extra.env ?? {})
  const ran: string[][] = []
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[0] === 'git' ? (extra.git ?? '') : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const filled: string[] = []
  on('prompt.fill', (_$, e) => {
    const text = String((e as { text?: unknown }).text ?? '')
    filled.push(text)
    return { isFilled: true }
  })
  const files: Record<string, string> = {}
  on('fs.write', (_$, e) => {
    const x = e as { path?: unknown; text?: unknown }
    files[String(x.path)] = String(x.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const text = files[String((e as { path?: unknown }).path)]
    return text === undefined ? { deny: 'no such file' } : { value: text }
  })
  on('session.cwd', () => ({ value: '/repo' }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(String((e as { id?: unknown }).id))
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('audio.speak', () => ({ value: { synthesizer: 'none' } }))
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => {
    const percent = extra.percent ?? 10
    return { value: { startedAt: extra.now ?? Date.UTC(2026, 9, 9, 12), context: { window: 200_000, tokens: percent * 2000, percent }, rateLimits: [] } }
  })
  on('audio.play', () => ({ value: undefined }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  const toasts: string[] = []
  const asked: Asked[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('model.complete', (_$, e) => {
    asked.push({ model: e.model, system: e.system, prompt: e.prompt })
    return { value: { isAnswered: true as const, text: reply, usage: USAGE } }
  })
  const logs: string[] = []
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.messages', () => ({ value: messages }))
  const fetched: string[] = []
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(HITS) } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // What the engine draws in the band when the pet passes.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine' })
  })

  return { clock, toasts, asked, logs, fetched, ran, filled, files, opened }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

test('every sprite row is twelve cells', () => {
  const rows = [...Object.values(SPECIES), EGG].flatMap(s => s.frames.flat())
  for (const row of [...rows, ...Object.values(HATS)]) expect([...row].length).toBe(12)
  for (const species of Object.values(SPECIES)) expect(species.frames).toHaveLength(3)
})

test('a seed always rolls the same pet', () => {
  expect(roll(42)).toEqual(roll(42))
  const rarities = new Set(Array.from({ length: 2000 }, (_, i) => roll(i).rarity))
  expect(rarities.has('common')).toBe(true)
  expect(rarities.has('legendary')).toBe(true)
})

test('it hatches from an egg and draws in the band', async ($, on) => {
  const { clock, toasts } = engine(on)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const egg = await $.ui.mount({ ...BAND, surface })
    expect(await egg.find({ type: 'Text', text: /\?\?\?/, in: 'pet' })).toBeDefined()
    await egg.unmount()
  }

  await clock.advance(3000)
  expect(toasts.some(t => t.includes('Zork hatched'))).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /Zork/, in: 'pet' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /I'm Zork/, in: 'pet' })).toBeDefined()
    await band.unmount()
  }
})

test('/buddy shows the card, pets and feeds', async ($, on) => {
  const { clock } = engine(on)
  await start($)
  await clock.advance(3000)

  const run = (args: string) =>
    $.command.run({ command: 'buddy', args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  const card = await run('')
  expect(card.text).toContain('Zork')
  expect(card.text).toContain('DEBUGGING')
  expect(card.text).toContain('A test pet who loves green checkmarks.')

  expect((await run('pet')).text).toBe('You pet Zork. ♥')
  expect((await run('feed')).text).toContain('is full')
  expect((await run('rename Blip')).text).toBe('Zork is now called Blip.')
  expect((await run('hat tophat')).text).toMatch(/isn't unlocked yet|wearing the tophat/)
  expect((await run('dance')).text).toContain("I don't know")

  await run('hide')
  const hidden = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await hidden.find({ type: 'Text', text: /Blip/, in: 'pet' }).catch(() => undefined)).toBeUndefined()
  await hidden.unmount()
})

test('a pet loaded from the store greets you and frets over failing tools', async ($, on) => {
  const now = Date.UTC(2026, 9, 9, 12)
  const { clock } = engine(on, {
    pet: { seed: 7, name: 'Mochi', personality: 'Calm.', hatchedAt: now - 3 * 86_400_000 },
    lastSeen: now - 2 * 86_400_000,
    prefs: { isSmart: false },
  })
  on('tool.call', () => ({ isError: true as const, result: 'boom', text: 'exit 1' }))
  await start($)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /2 days|back|remember/, in: 'pet' })).toBeDefined()

  for (const id of ['a', 'b', 'c']) {
    const ran = await $.tool.call({ tool: 'Bash', tool_use_id: id, command: 'false' } as never)
    expect(ran.isError).toBe(true)
  }
  await clock.advance(1000)
  const worried = [...QUIPS.worried!.sweet, ...QUIPS.worried!.snark]
  const texts = (await band.findAll({ type: 'Text', in: 'pet' })).map(t => t.text)
  expect(texts.some(t => worried.includes(t))).toBe(true)
  await band.unmount()
})

test('saying its name tells Claude the pet will answer, and "pip install" stays plain', async ($, on) => {
  const now = Date.UTC(2026, 9, 9, 12)
  engine(on, { pet: { seed: 3, name: 'Pip', personality: 'Chirpy.', hatchedAt: now }, prefs: { isSmart: false } })
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => {
    seen.push(e.context)
    return { text: e.text }
  })
  await start($)

  const submit = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await submit('hey Pip, how are you?')
  await submit('pip install requests please')

  expect(seen[0]?.some(c => c.includes('Pip is the user\'s terminal pet'))).toBe(true)
  expect(seen[1]).toBeUndefined()
})

const NOW = Date.UTC(2026, 9, 9, 12)
const MALLOW = { seed: 11, name: 'Mallow', personality: 'Endlessly patient.', hatchedAt: NOW }

async function promptAndLook($: Engine, on: On, clock: { settle: () => Promise<void> }, text: string) {
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await start($)
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = (await band.findAll({ type: 'Text', in: 'pet' })).map(t => t.text)
  await band.unmount()
  return texts
}

test('the phrasebook judge flunks "fix it" and keeps a GPA', async ($, on) => {
  const { clock } = engine(on, { pet: MALLOW, prefs: { isSmart: false, judge: 'always' } })
  const texts = await promptAndLook($, on, clock, 'fix it')
  expect(texts.some(t => t.startsWith('F · '))).toBe(true)

  const report = await $.command.run({ command: 'buddy', args: 'judge', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(report.text).toContain('Prompting GPA F')
  const card = await $.command.run({ command: 'buddy', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(card.text).toContain('prompting GPA: F')
})

test('Haiku writes the roast when smart lines are on', async ($, on) => {
  const roast = '{"grade": "d+", "roast": "you prompt like a raccoon on a keyboard"}'
  const { clock } = engine(on, { pet: MALLOW, prefs: { judge: 'always' } }, roast)
  const texts = await promptAndLook($, on, clock, 'make the thing do the other thing but better')
  expect(texts).toContain('D+ · you prompt like a raccoon on a keyboard')
})

test('judging off stays quiet', async ($, on) => {
  const { clock } = engine(on, { pet: MALLOW, prefs: { isSmart: false, judge: 'off' } })
  const texts = await promptAndLook($, on, clock, 'fix it')
  expect(texts.some(t => / · /.test(t))).toBe(false)
})


// Seeds whose rolled stats stand out, found the way the pet is rolled.
type Stats = Record<string, number>
const seedWhere = (fits: (stats: Stats) => boolean) =>
  Array.from({ length: 20000 }, (_, i) => i).find(i => fits(roll(i).stats as Stats))!
const petWith = (fits: (stats: Stats) => boolean) => ({ ...MALLOW, seed: seedWhere(fits) })
const VERDICT = '{"grade": "C-", "roast": "you prompt like a raccoon", "fix": "Fix the failing test in [file]; the error is [error]."}'

test('a high-SNARK pet is told to be savage', async ($, on) => {
  const { clock, asked } = engine(on, { pet: petWith(s => s.SNARK! >= 60), prefs: { judge: 'always' } }, VERDICT)
  await promptAndLook($, on, clock, 'fix it')
  expect(asked.at(-1)?.system).toContain('savage and crude')
})

test('a low-SNARK, low-WISDOM pet is told to be passive-aggressive and useless', async ($, on) => {
  const { clock, asked } = engine(on, { pet: petWith(s => s.SNARK! < 25 && s.WISDOM! < 20), prefs: { judge: 'always' } }, VERDICT)
  await promptAndLook($, on, clock, 'fix it')
  const system = asked.at(-1)?.system ?? ''
  expect(system).toContain('passive-aggressive')
  expect(system).toContain('zero wisdom')
})

test('a wise pet adds a tip even from the phrasebook', async ($, on) => {
  const { clock } = engine(on, { pet: petWith(s => s.WISDOM! >= 60), prefs: { isSmart: false, judge: 'always' } })
  const texts = await promptAndLook($, on, clock, 'fix it')
  expect(texts.some(t => t.startsWith('F · ') && t.includes('(tip: '))).toBe(true)
})

test('/buddy roast asks Opus and hands back the rewritten prompt', async ($, on) => {
  const { clock, asked } = engine(on, { pet: MALLOW, prefs: { judge: 'off' } }, VERDICT)
  await promptAndLook($, on, clock, 'fix it')
  const roast = await $.command.run({ command: 'buddy', args: 'roast', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(asked.at(-1)?.model).toBe('opus')
  expect(roast.text).toContain('**C-** · you prompt like a raccoon')
  expect(roast.text).toContain('Fix the failing test in [file]')
})

test('/buddy review reads the session prompts and asks Opus', async ($, on) => {
  const { asked } = engine(on, { pet: MALLOW }, '**Grade: D** you prompt like a raccoon', [
    { role: 'user', text: 'fix it', toolUses: [] },
    { role: 'assistant', text: 'Which file?', toolUses: [] },
    { role: 'user', text: '<system-reminder>not a prompt</system-reminder>', toolUses: [] },
    { role: 'user', text: 'the login one, it doesnt work', toolUses: [] },
  ])
  await start($)
  const review = await $.command.run({ command: 'buddy', args: 'review', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(asked.at(-1)?.model).toBe('opus')
  expect(asked.at(-1)?.prompt).toContain('the login one')
  expect(asked.at(-1)?.prompt).not.toContain('system-reminder')
  expect(review.text).toContain("Mallow's prompting review")
})

test('/buddy roast finds your last prompt in the transcript after a reload', async ($, on) => {
  const { asked } = engine(on, { pet: MALLOW, prefs: { judge: 'off' } }, VERDICT, [
    { role: 'user', text: 'hi Mallow\nMallow is the user\'s terminal pet (a duck) that lives above the prompt.', toolUses: [] },
    { role: 'user', text: 'make the login work pls', toolUses: [] },
  ])
  await start($)
  const roast = await $.command.run({ command: 'buddy', args: 'roast', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(asked.at(-1)?.prompt).toContain('make the login work pls')
  expect(roast.text).toContain('**C-**')
})

test('/buddy news lists the AI stories, yaps one, and caches the feed', async ($, on) => {
  const { fetched } = engine(on, { pet: MALLOW }, 'An open LLM tops the charts. we are SO back')
  await start($)
  const run = (args: string) =>
    $.command.run({ command: 'buddy', args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  const news = await run('news')
  expect(fetched[0]).toContain('hn.algolia.com')
  expect(news.text).toContain('[A new open-weights LLM tops the leaderboard](https://example.com/llm)')
  expect(news.text).toContain('OpenAI fires three safety researchers')
  expect(news.text).not.toContain('sourdough')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^📰 An open LLM tops the charts/, in: 'pet' })).toBeDefined()
  await band.unmount()

  await run('news')
  expect(fetched).toHaveLength(1)
  const seen = await run('news off')
  expect(seen.text).toContain('stops yapping')
})

test('a seen story is skipped, and with smart lines off a doomy headline gets a doom take', async ($, on) => {
  engine(on, { pet: MALLOW, prefs: { isSmart: false }, newsSeen: ['2'] })
  await start($)
  await $.command.run({ command: 'buddy', args: 'news', origin: { kind: 'composer' }, presentation: PRESENTATION })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = (await band.findAll({ type: 'Text', in: 'pet' })).map(t => t.text)
  expect(texts.some(t => t.startsWith('📰 OpenAI fires three safety researchers…') && /over|pack it up|overlords|bunker|good run/.test(t))).toBe(true)
  await band.unmount()
})

// The collection
const CREW = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet']
function stable(size: number, extra: Record<string, unknown> = {}) {
  const entries: Record<string, unknown> = { prefs: { isSmart: false, judge: 'off', hasNews: false }, ...extra }
  const ids: string[] = []
  for (let i = 0; i < size; i++) {
    entries[`pet:t${i}`] = { id: `t${i}`, seed: 1000 + i, name: CREW[i], personality: 'Test.', hatchedAt: NOW }
    ids.push(`t${i}`)
  }
  return { ...entries, pets: ids }
}
const buddy = ($: Engine, args: string) =>
  $.command.run({ command: 'buddy', args, origin: { kind: 'composer' }, presentation: PRESENTATION })
const activeName = async ($: Engine) => {
  const shown = (await buddy($, '')).text ?? ''
  return CREW.find(n => shown.includes(`${n}  `))
}

test('the single pet of before becomes the first of the collection, its level kept', async ($, on) => {
  engine(on, {
    pet: { seed: 146192237, name: 'Mallow', personality: 'Endlessly patient.', hatchedAt: NOW },
    xp: 66,
    care: { fedAt: NOW, pettedAt: 0 },
    prefs: { judge: 'off', hasNews: false },
  })
  await start($)
  const shown = (await buddy($, '')).text ?? ''
  expect(shown).toContain('Mallow')
  expect(shown).toContain('level 2')
  expect(shown).toContain('(1/10 hatched)')
  const pets = (await buddy($, 'pets')).text ?? ''
  expect(pets).toContain('1/10 hatched')
  expect(pets).toMatch(/Mallow.*← here now/)
})

test('below ten pets a new session hatches an egg and keeps the others', async ($, on) => {
  const { clock, toasts } = engine(on, stable(2))
  await start($)
  await clock.advance(3000)
  expect(toasts.some(t => t.includes('hatched') && t.includes('3/10'))).toBe(true)
  const pets = (await buddy($, 'pets')).text ?? ''
  expect(pets).toContain('3/10 hatched')
  expect(pets).toContain('Alpha')
  expect(pets).toContain('Bravo')
  expect(pets.match(/← here now/g)).toHaveLength(1)
})

test('a full collection draws a pet at random, never the last one', async ($, on) => {
  engine(on, stable(10, { lastPick: 't0' }))
  await start($)
  const name = await activeName($)
  expect(name).toBeDefined()
  expect(name).not.toBe('Alpha')
  expect((await buddy($, 'hatch')).text).toContain('full')
})

test('/buddy swap switches pets, and a pet who is away says so', async ($, on) => {
  const { clock } = engine(on, stable(10, { lastPick: 't0' }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await start($)
  const first = await activeName($)
  const other = CREW.find(n => n !== first)!
  expect((await buddy($, `swap ${other.toLowerCase()}`)).text).toContain(`${other} is here now`)
  expect(await activeName($)).toBe(other)
  expect((await buddy($, 'swap nobody')).text).toContain('Swap to whom?')

  const away = CREW.find(n => n !== other)!
  await $.prompt.submit({ text: `hey ${away}, you there?`, wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = (await band.findAll({ type: 'Text', in: 'pet' })).map(t => t.text)
  expect(texts).toContain(`${away}'s not here today. it's me, ${other}!`)
  await band.unmount()
})

test('/buddy hatch adds an egg on demand', async ($, on) => {
  const { clock } = engine(on, stable(2, { lastPick: 't0' }))
  await start($)
  await clock.advance(3000)
  expect((await buddy($, 'hatch')).text).toContain('an egg appears')
  await clock.advance(3000)
  expect((await buddy($, 'pets')).text).toContain('4/10 hatched')
})

// Battles, visitors, evolution, wild shinies, the dex, bugs, badges, the context window, the diary, commits, the Hall of Shame, drift and sound

const full = (extra: Record<string, unknown> = {}) => stable(10, { lastPick: 't0', ...extra })
const okTool = { result: { stdout: 'ok', stderr: '' }, text: 'ok' }
const redTool = { isError: true as const, result: 'FAIL', text: '1 failed' }
const composer = { wait: false, origin: { kind: 'composer' as const } }
async function bandTexts($: Engine) {
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const texts = (await band.findAll({ type: 'Text', in: 'pet' })).map(t => t.text)
  await band.unmount()
  return texts
}

test('a battle plays out in the bubble and pays the winner', async ($, on) => {
  const { clock, toasts } = engine(on, full())
  await start($)
  const me = (await activeName($))!
  const foe = CREW.find(n => n !== me)!
  expect((await buddy($, `battle ${foe.toLowerCase()}`)).text).toContain(`${me} challenges ${foe}`)
  const texts = await bandTexts($)
  expect(texts.some(t => t.startsWith('⚔️ R1 '))).toBe(true)
  expect(texts.some(t => t.trim() === foe)).toBe(true)
  expect((await buddy($, 'battle alpha')).text).toContain('already on')
  await clock.advance(13_000)
  expect(toasts.some(t => new RegExp(`^⚔️ (${me}|${foe}) wins [0-3]–[0-3]!`).test(t))).toBe(true)
  expect((await buddy($, '')).text).toMatch(/battles (1W 0L|0W 1L)/)
})

test('/buddy visit brings another pet over, who wanders off after three minutes', async ($, on) => {
  const { clock } = engine(on, full())
  await start($)
  const host = (await activeName($))!
  const guest = CREW.find(n => n !== host)!
  expect((await buddy($, `visit ${guest.toLowerCase()}`)).text).toContain(`${guest} drops by`)
  let texts = await bandTexts($)
  expect(texts.some(t => t.startsWith(`${guest}: `))).toBe(true)
  expect(texts.some(t => t.trim() === guest)).toBe(true)
  await clock.advance(7_500)
  texts = await bandTexts($)
  expect(texts.some(t => t.startsWith(`${host}: `))).toBe(true)
  await clock.advance(173_500)
  texts = await bandTexts($)
  expect(texts).toContain(`${guest} wandered off`)
  expect(texts.some(t => t.trim() === guest)).toBe(false)
})

test('at level 10 a pet evolves and wears a cape', async ($, on) => {
  const entries = full()
  for (let i = 0; i < 10; i++) entries[`xp:t${i}`] = 944
  const { toasts } = engine(on, entries)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await start($)
  await $.prompt.submit({ text: 'add a test for the login flow in auth.test.ts', ...composer })
  expect(toasts.some(t => t.includes('evolved into a mega'))).toBe(true)
  const card = (await buddy($, '')).text ?? ''
  expect(card).toContain('stage 2')
  expect(card).toMatch(/mega \w+/)
  expect(await bandTexts($)).toContain(' )')
})

test('a wild shiny wanders by on its own tick, and /buddy catch keeps it', async ($, on) => {
  const { clock, toasts } = engine(on, full())
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await start($)
  expect((await buddy($, 'catch')).text).toContain('Nothing to catch')
  // Its luck is drawn from the clock: from this test's start, it falls on the 48th tick.
  await clock.advance(47 * 30_000)
  await $.prompt.submit({ text: 'still here', ...composer })
  await clock.advance(30_000)
  expect(toasts.some(t => t.startsWith('✨ A wild shiny'))).toBe(true)
  expect((await bandTexts($)).some(t => t.trim() === '✨ wild ✨')).toBe(true)
  expect((await buddy($, 'catch')).text).toContain('Caught!')
  expect((await buddy($, 'pets')).text).toContain('✨ wild')
  expect((await buddy($, 'dex')).text).toContain('✨')
  expect(toasts.some(t => t.includes('Shiny hunter'))).toBe(true)
})

test('a red test run leaves a bug; a green one feeds it to the pet, with a crunch through Windows', async ($, on) => {
  const { ran } = engine(on, full(), SOUL, [], { env: { WSL_DISTRO_NAME: 'Ubuntu-test' } })
  let isRed = true
  on('tool.call', () => (isRed ? redTool : okTool))
  await start($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'a', command: 'npm test' } as never)
  expect(await bandTexts($)).toContain('🐛')
  isRed = false
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b', command: 'npm test' } as never)
  const texts = await bandTexts($)
  expect(texts.some(t => t.includes('*crunch* 1 bug eaten'))).toBe(true)
  expect(texts).not.toContain('🐛')
  expect(ran.some(argv => argv[0] === 'powershell.exe' && argv.join(' ').includes('crunch.wav'))).toBe(true)
  expect((await buddy($, '')).text).toContain('🐛 eaten 1')
})

test('the first green run earns a badge, and quacking at the pet earns a hidden one', async ($, on) => {
  const { toasts, clock } = engine(on, full())
  on('tool.call', () => okTool)
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_$, e) => {
    seen.push(e.context)
    return { text: e.text }
  })
  await start($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'a', command: 'pytest -q' } as never)
  expect(toasts.some(t => t.includes('Achievement unlocked: First green'))).toBe(true)
  await $.prompt.submit({ text: 'quack', ...composer })
  await clock.settle()
  expect(seen.at(-1)?.some(c => c.includes('quacked'))).toBe(true)
  expect((await bandTexts($)).some(t => /quack/i.test(t))).toBe(true)
  expect(toasts.some(t => t.includes('Duck whisperer'))).toBe(true)
  const badges = (await buddy($, 'badges')).text ?? ''
  expect(badges).toContain('🏅 **First green**')
  expect(badges).toContain('🏅 **Duck whisperer**')
  expect(badges).toContain('??? — a hidden one')
})

test('a filling context window makes the pet sweat and beg for /compact', async ($, on) => {
  const { clock } = engine(on, full(), SOUL, [], { percent: 88 })
  await start($)
  await clock.advance(60_000)
  const texts = await bandTexts($)
  expect(texts.some(t => t.includes('/compact'))).toBe(true)
  expect(texts.some(t => t.includes('@'))).toBe(true)
  expect((await buddy($, '')).text).toContain('mood anxious')
})

test('the diary gets an entry when the session ends', async ($, on) => {
  engine(on, full(), SOUL, [{ role: 'user', text: 'build the login page', toolUses: [] }])
  on('tool.call', () => okTool)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await start($)
  for (const text of ['build the login page', 'now add tests']) await $.prompt.submit({ text, ...composer })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'a', command: 'npm test' } as never)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  const diary = (await buddy($, 'journal')).text ?? ''
  expect(diary).toContain('Dear diary. 2 prompts, 1 tool call, tests green 1×')
  expect(diary).toContain('newest first')
})

test('a lazy commit message gets an F in the bubble and its own GPA', async ($, on) => {
  const { clock } = engine(on, full())
  on('tool.call', () => okTool)
  await start($)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'c', command: 'git commit -m "fix stuff"' } as never)
  await clock.advance(4_500)
  expect((await bandTexts($)).some(t => t.startsWith('✍️ F · '))).toBe(true)
  expect((await buddy($, 'judge')).text).toContain('commit GPA F')
})

test('on a Friday the Hall of Shame convenes, with Opus', async ($, on) => {
  const friday = Date.UTC(2026, 9, 16, 12)
  const verdicts = ['F', 'D', 'C', 'B', 'A-'].map((grade, i) => ({ grade, line: 'meh', at: friday - (i + 1) * 3_600_000, prompt: `prompt ${grade}` }))
  const entries = { ...full({ verdicts }), prefs: { isSmart: true, judge: 'off', hasNews: false } }
  const { clock, toasts, asked } = engine(on, entries, '**Worst**: "prompt F". Shameful.', [], { now: friday })
  await start($)
  await clock.advance(21_000)
  expect(toasts.some(t => t.includes('Hall of Shame is out'))).toBe(true)
  expect(asked.at(-1)?.model).toBe('opus')
  expect(asked.at(-1)?.prompt).toContain('Worst: [F] """prompt F"""')
  expect(asked.at(-1)?.prompt).toContain('Best: [A-] """prompt A-"""')
  const shame = (await buddy($, 'shame')).text ?? ''
  expect(shame).toContain('Hall of Shame')
  expect(shame).toContain('Shameful.')
  expect(asked).toHaveLength(1)
})

test('failures make a pet more patient over time', async ($, on) => {
  engine(on, full())
  on('tool.call', () => redTool)
  await start($)
  for (let i = 0; i < 7; i++) await $.tool.call({ tool: 'Bash', tool_use_id: `f${i}`, command: 'false' } as never)
  const card = (await buddy($, '')).text ?? ''
  expect(card).toMatch(/PATIENCE +[█░]+ +\d+ ↑1/)
  expect(card).toContain('drifted')
})

test('/buddy dex lists every species, found and not', async ($, on) => {
  engine(on, full())
  await start($)
  const dex = (await buddy($, 'dex')).text ?? ''
  expect(dex).toMatch(/Species found: \d+\/18/)
  expect(dex).toContain('???')
  expect(dex).toContain('░')
  expect(dex).toContain('Alpha')
})

// Round two: Claude on trial, the prompt doctor, quests, the shop, rivals, notes, git, voice, reactions, the house, export

import { RIVAL_BANTER } from '../hooks/art'

const todayKey = (at: number) => {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const HOUSE_PANE = {
  plugin: 'buddy',
  component: 'Pane',
  requestId: 'buddy-house',
  props: { title: 'Pet house', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the pet grades Claude too: a thesis for a yes/no question gets a D', async ($, on) => {
  const { clock } = engine(on, { ...full(), prefs: { isSmart: false, judge: 'always', hasNews: false } })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await start($)
  await $.prompt.submit({ text: 'is the login flow done?', ...composer })
  const thesis = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ')
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: thesis, durationMs: 1000, isAborted: false })
  await clock.settle()
  expect((await bandTexts($)).some(t => t.startsWith('🤖 D · '))).toBe(true)
  expect((await buddy($, 'judge')).text).toContain("Claude's GPA D")
})

test('/buddy fix rewrites the last prompt into the prompt box', async ($, on) => {
  const { filled } = engine(on, full())
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await start($)
  await $.prompt.submit({ text: 'make the login work', ...composer })
  const out = (await buddy($, 'fix')).text ?? ''
  expect(out).toContain('rewrote it into the prompt box')
  expect(filled[0]).toContain('Goal: make the login work')
  expect(filled[0]).toContain('Done when: [')
})

test("today's quest completes, pays XP and starts a streak", async ($, on) => {
  const day = todayKey(Date.UTC(2026, 9, 9, 12))
  const { toasts } = engine(on, full({ quest: { day, id: 'pet', isDone: false, streak: 0, lastDoneDay: '' } }))
  await start($)
  expect((await buddy($, 'quest')).text).toContain('pet your pet three times (+10 xp) — not yet')
  for (let i = 0; i < 3; i++) await buddy($, 'pet')
  expect(toasts.some(t => t.startsWith('✅ Quest done: pet your pet three times (+10 xp) · streak 1 day'))).toBe(true)
  const report = (await buddy($, 'quest')).text ?? ''
  expect(report).toContain('✅ done')
  expect(report).toContain('Streak: 1 day')
})

test('bug coins buy a sword and a monocle at the shop', async ($, on) => {
  engine(on, full({ tally: { bugsEaten: 50 } }))
  await start($)
  expect((await buddy($, 'shop')).text).toContain('you have 50 bug coins')
  expect((await buddy($, 'buy sword')).text).toContain('Bought the Tiny sword for 30 coins (20 left)')
  expect((await buddy($, 'buy sparkle')).text).toContain('Eat more bugs')
  expect((await buddy($, 'buy monocle')).text).toContain('Bought the Monocle')
  const texts = await bandTexts($)
  expect(texts.some(t => t.includes('⚔ '))).toBe(true)
  expect(texts.some(t => t.includes('◎'))).toBe(true)
  expect((await buddy($, '')).text).toContain('coins 5 ')
  expect((await buddy($, 'wear none')).text).toContain('took off')
})

test('pets that fight a lot become rivals, and visit with trash talk', async ($, on) => {
  engine(on, full({ 'bond:t0:t1': { fights: 3, visits: 0 } }))
  await start($)
  await buddy($, 'swap bravo')
  expect((await buddy($, 'pets')).text).toMatch(/Alpha .*· rival/)
  expect((await buddy($, 'visit alpha')).text).toContain('Alpha drops by')
  const hostSpecies = roll(1001).species
  const openers = RIVAL_BANTER.map(([v]) => v.replaceAll('{v}', 'Alpha').replaceAll('{species}', hostSpecies))
  const texts = await bandTexts($)
  expect(texts.some(t => openers.includes(t))).toBe(true)
})

test('a swapped-out pet leaves a note that the next one reads', async ($, on) => {
  const { clock } = engine(on, full())
  await start($)
  const first = (await activeName($))!
  const next = CREW.find(n => n !== first)!
  await buddy($, `swap ${next.toLowerCase()}`)
  await clock.advance(6_500)
  expect((await bandTexts($)).some(t => t.startsWith(`📝 note from ${first}: `))).toBe(true)
})

test('a dirty tree gets nagged, and a commit straight onto main gets noticed', async ($, on) => {
  const status = ['## main...origin/main [ahead 6]', ...Array.from({ length: 12 }, (_, i) => ` M file${i}.ts`)].join('\n') + '\n'
  const { clock } = engine(on, full(), SOUL, [], { git: status })
  on('tool.call', () => okTool)
  await start($)
  await clock.advance(61_000)
  const nag = (await bandTexts($)).find(t => t.includes('12'))
  expect(nag).toBeDefined()
  expect(nag).toMatch(/uncommitted/)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'c', command: 'git commit -m "add the login flow"' } as never)
  await clock.advance(9_500)
  expect((await bandTexts($)).some(t => t.includes('main'))).toBe(true)
})

test('/buddy voice on speaks through Windows', async ($, on) => {
  const { ran } = engine(on, full(), SOUL, [], { env: { WSL_DISTRO_NAME: 'Ubuntu-test' } })
  await start($)
  expect((await buddy($, 'voice on')).text).toContain('out loud')
  const spoken = ran.find(argv => argv.join(' ').includes('SpeechSynthesizer'))
  expect(spoken).toBeDefined()
  expect(spoken?.join(' ')).toContain('testing, testing')
})

test('the pet notices Claude writing on the walls', async ($, on) => {
  const { clock } = engine(on, full())
  on('tool.call', () => okTool)
  await start($)
  await clock.advance(25_000)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e', file_path: '/repo/CLAUDE.md', old_string: 'a', new_string: 'b' } as never)
  expect((await bandTexts($)).some(t => /writing on the walls|house rules|rewriting its own rules/.test(t))).toBe(true)
})

test('/buddy house opens a pane with the whole collection', async ($, on) => {
  const { opened } = engine(on, full())
  await start($)
  expect((await buddy($, 'house')).text).toContain('The pet house is open')
  expect(opened).toContain('buddy-house')
  const here = (await activeName($))!
  const pane = await $.ui.mount({ ...HOUSE_PANE, surface: 'terminal' })
  const texts = (await pane.findAll({ type: 'Text', in: 'house' })).map(t => t.text.trim())
  expect(texts).toContain(`★ ${here}`)
  for (const name of CREW.filter(n => n !== here)) expect(texts).toContain(name)
  await pane.unmount()
  expect((await buddy($, 'house close')).text).toContain('closed')
})

test('/buddy export writes the store to a file that /buddy import reads back', async ($, on) => {
  const { files } = engine(on, full(), SOUL, [], { env: { HOME: '/home/test' } })
  await start($)
  const out = (await buddy($, 'export')).text ?? ''
  expect(out).toContain('Exported 10 pets')
  const path = Object.keys(files).find(f => f.endsWith('buddy-export-2026-10-09.json'))!
  expect(path).toBe('/home/test/claude-mods/buddy-export-2026-10-09.json')
  expect(JSON.parse(files[path]!).data.pets).toHaveLength(10)
  expect((await buddy($, `import ${path}`)).text).toContain('the collection now holds 10 pets')
  expect((await buddy($, 'import /nowhere.json')).text).toContain("Couldn't read")
})

const GAME_PANE = {
  plugin: 'buddy',
  component: 'Pane',
  requestId: 'buddy-game',
  props: { title: 'Flappy Duck', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('/buddy play opens Flappy Duck; a crash pays out, and the restart button resets it', async ($, on) => {
  const { opened, toasts } = engine(on, full())
  await start($)
  const name = (await activeName($))!
  expect((await buddy($, 'play')).text).toContain(`Flappy ${name} is up`)
  expect(opened).toContain('buddy-game')
  const pane = await $.ui.mount({ ...GAME_PANE, surface: 'terminal' })
  const shown = async () => (await pane.findAll({ type: 'Text', in: 'game' })).map(t => t.text)
  expect((await shown()).some(t => t.includes('to start'))).toBe(true)
  await pane.key({ key: ' ', in: 'game' })
  await pane.advance(3_000)
  expect((await shown()).some(t => t.startsWith('GAME OVER'))).toBe(true)
  expect(toasts.some(t => t.startsWith(`🛩️ Flappy ${name}: score`))).toBe(true)
  await pane.press({ key: 'restart' })
  expect((await shown()).some(t => t.includes('to start'))).toBe(true)
  await pane.unmount()
})
