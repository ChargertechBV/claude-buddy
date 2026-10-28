// The pet reacting to the session: tool calls, turns, tests and commits, the
// periodic tick, the filling context window, and the bugs failing tests leave.

import { SPECIES } from './art'
import { momentsAt } from './calendar'
import { commitMessageOf } from './grading'
import type { Lines } from './grading'
import { judgeClaude, judgeCommit, shouldJudgeClaude } from './buddy-judge'
import { award, count, fullnessAt, gainXp, nudge, publish } from './buddy-life'
import { guestLeaves, pickOther, shouldVisit, shouldWild, visit, wildAppears } from './buddy-social'
import { HUNGRY_BELOW, MINUTE, QUIET_FOR, SECOND, buddy, clip, key } from './buddy-state'
import type { Engine } from './buddy-state'
import { fill, pickLine, play, quip, say, smartLine, voice } from './buddy-voice'
import { completeQuest, gitCheckAndNag, mainBranchNag, shouldYap, yapNews } from './buddy-world'

const NAP_AFTER = 10 * MINUTE
const SMART_EVERY = 4 * MINUTE
const GIT_EVERY_TICKS = 20
const TESTS = /\b(test|tests|pytest|jest|vitest|mocha|rspec|phpunit|cargo test|go test|npm (run )?test|pnpm test|yarn test|bun test)\b/
const COMMIT = /\bgit\s+commit\b/
const REJECTED = /doesn't want to proceed|was rejected|denied/i

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
let anxietySaid = 0
const saidMoments = new Set<string>()
let lastSmartAt = 0
let lastHungerNag = 0
let tickCount = 0

// Reacting to the session

export async function wake($: Engine, shouldGreet: boolean): Promise<void> {
  buddy.lastActivity = await $.clock.now()
  if (!buddy.isAsleep) return
  buddy.isAsleep = false
  if (shouldGreet) await say($, quip('wake'), { isForced: !buddy.prefs.isMuted })
  await publish($)
}

export async function afterTool(
  $: Engine,
  tool: string,
  command: string,
  path: string,
  ran: { deny?: string; isError?: true; text?: string },
): Promise<void> {
  if (buddy.pet === null || buddy.isHatching) return
  await wake($, false)
  await gainXp($, 1)
  buddy.facts.tools += 1

  const isDenied = ran.deny !== undefined || (ran.isError === true && REJECTED.test(ran.text ?? ''))
  const isFailed = !isDenied && ran.isError === true
  const isTestRun = tool === 'Bash' && TESTS.test(command)
  buddy.turnTools.push({ tool, isFailed })

  if (isDenied) {
    if (Math.random() < 0.7) await say($, quip('denied'))
  } else if (isFailed) {
    buddy.failStreak += 1
    buddy.facts.fails += 1
    await nudge($, 'PATIENCE', 0.15)
    if (isTestRun) await bugCrawls($)
    else if (buddy.failStreak === 3) await say($, quip('worried'), { isForced: !buddy.prefs.isMuted })
    else if (Math.random() < 0.4) await say($, quip('fail'))
  } else {
    if (buddy.failStreak >= 5) await award($, 'comeback')
    buddy.failStreak = 0
    if (isTestRun) await testsPassed($)
    else if (tool === 'Bash' && COMMIT.test(command)) await committed($, command)
    else if (!(await react($, tool, command, path)) && (tool === 'Edit' || tool === 'Write') && Math.random() < 0.08) await say($, quip('edit'))
  }
  await publish($)
}

async function testsPassed($: Engine): Promise<void> {
  buddy.facts.greens += 1
  const t = await count($, 'greens', 1)
  await nudge($, 'DEBUGGING', 0.3)
  if (buddy.bugs > 0) await eatBugs($)
  else {
    await celebrate($, 'tests')
    await play($, 'quack')
  }
  if (t.greens === 1) await award($, 'first-green')
  await completeQuest($, 'green')
}

async function committed($: Engine, command: string): Promise<void> {
  buddy.facts.commits += 1
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
  buddy.excitedUntil = now + 15 * SECOND
  await say($, quip(kind), { isForced: !buddy.prefs.isMuted })
  $.clock.after(16 * SECOND, () => void publish($))
}

export async function afterTurn($: Engine, turn: { reason: string; durationMs: number; answer: string }): Promise<void> {
  await gainXp($, 3)
  const now = await $.clock.now()
  buddy.facts.longestTurnMs = Math.max(buddy.facts.longestTurnMs, turn.durationMs)
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
  if (buddy.prefs.isMuted || now - buddy.lastSaidAt < QUIET_FOR) return

  const isLong = turn.durationMs > 3 * MINUTE
  if (buddy.prefs.isSmart && now - lastSmartAt > SMART_EVERY && (isLong || Math.random() < 0.35)) {
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
  for (const { tool, isFailed } of buddy.turnTools) {
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
    `The developer asked Claude: "${clip(buddy.lastPrompt, 240)}"`,
    `Tools Claude ran: ${tools}. The turn took ${Math.round(turn.durationMs / SECOND)}s.`,
    `Claude's answer began: "${clip(turn.answer, 300)}"`,
  ].join('\n')
}

export async function tick($: Engine): Promise<void> {
  if (buddy.pet === null || buddy.isHatching) return
  const now = await $.clock.now()
  tickCount += 1

  if (buddy.visitor !== null && now >= buddy.visitor.until && !buddy.isFighting) await guestLeaves($)
  if (tickCount % 2 === 0) await checkAnxiety($)
  if (tickCount % GIT_EVERY_TICKS === 0) await gitCheckAndNag($)
  await checkMoments($)

  if (!buddy.isAsleep && now - buddy.lastActivity > NAP_AFTER) {
    buddy.isAsleep = true
    buddy.bubble = null
  } else if (!buddy.isAsleep) {
    if (fullnessAt(now) < HUNGRY_BELOW && now - lastHungerNag > 45 * MINUTE) {
      lastHungerNag = now
      await say($, quip('hungry'))
    } else if (shouldWild(now)) {
      await wildAppears($)
    } else if (shouldVisit(now)) {
      await visit($, pickOther())
    } else if (shouldYap(now)) {
      buddy.lastNewsAt = now
      await yapNews($, false)
    } else if (now - buddy.lastSaidAt > 6 * MINUTE && Math.random() < 0.08) {
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
  buddy.anxiety = pct >= 85 ? 2 : pct >= 70 ? 1 : 0
  if (buddy.anxiety === 0) anxietySaid = 0
  if (buddy.anxiety > anxietySaid && !buddy.isAsleep) {
    anxietySaid = buddy.anxiety
    const lines = ANXIOUS[buddy.anxiety]
    if (lines !== undefined) await say($, fill(pickLine(voice().isSnarky ? lines.snark : lines.sweet), { pct }), { isForced: !buddy.prefs.isMuted, ttl: 15 * SECOND })
  }
}

export async function checkMoments($: Engine): Promise<void> {
  if (buddy.pet === null || buddy.bones === null) return
  const now = await $.clock.now()
  buddy.moments = momentsAt(now, buddy.pet, buddy.bones.species, Object.keys(SPECIES))
  for (const m of buddy.moments) {
    if (m.line === undefined || saidMoments.has(m.key)) continue
    saidMoments.add(m.key)
    await say($, m.line, { isForced: true, ttl: 12 * SECOND })
  }
}

// Bugs: a failing test run leaves one; a green run feeds it to the pet

async function bugCrawls($: Engine): Promise<void> {
  buddy.bugs = Math.min(buddy.bugs + 1, 9)
  await say($, pickLine(['a 🐛 crawled out of the test suite', "eww. a 🐛. that one's yours", "🐛 spotted. I'm not touching it. yet"]), { ttl: 8 * SECOND })
  await publish($)
}

async function eatBugs($: Engine): Promise<void> {
  if (buddy.pet === null || buddy.bugs === 0) return
  const eaten = buddy.bugs
  buddy.bugs = 0
  buddy.facts.bugsEaten += eaten
  const mine = (Number(await $.store.get(key('bugs', buddy.pet.id))) || 0) + eaten
  await $.store.set(key('bugs', buddy.pet.id), mine)
  const t = await count($, 'bugsEaten', eaten)
  await nudge($, 'DEBUGGING', 0.1 * eaten)
  await gainXp($, 5 * eaten)
  const now = await $.clock.now()
  buddy.excitedUntil = now + 10 * SECOND
  await play($, 'crunch')
  await say($, `*crunch* ${eaten} bug${eaten === 1 ? '' : 's'} eaten. delicious`, { isForced: !buddy.prefs.isMuted, ttl: 10 * SECOND })
  $.clock.after(11 * SECOND, () => void publish($))
  if (t.bugsEaten >= 10) await award($, 'bug-eater')
  if (t.bugsEaten >= 100) await award($, 'exterminator')
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
