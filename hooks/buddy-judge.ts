// The pet's judging: your prompts, your commit messages, Claude's answers, the
// roasts and reviews, the Friday ceremony and the prompt doctor.

import { GRADES, commitMessageOf, gpaOf, localAnswerVerdict, localCommitVerdict, localVerdict, pointsOf, sinOf } from './grading'
import type { Verdict } from './grading'
import { award, count, nudge, statOf } from './buddy-life'
import { DAY, MINUTE, SECOND, asObject, buddy, clip, escapeRegExp, pad2 } from './buddy-state'
import type { Engine } from './buddy-state'
import { ask, jsonOf, persona, say, speak, voice } from './buddy-voice'

type Judged = { grade: string; line: string; at: number; prompt?: string }
const BIG_EVERY = 20 * MINUTE
const JUDGE_EVERY = 3 * MINUTE
const COMMIT_JUDGE_EVERY = 2 * MINUTE
const CLAUDE_JUDGE_EVERY = 4 * MINUTE
let lastJudgedAt = 0
let lastCommitJudgedAt = 0
let lastBigAt = 0
let lastClaudeJudgedAt = 0

// Judging your prompts

export async function shouldJudge($: Engine, text: string): Promise<boolean> {
  if (buddy.prefs.judge === 'off' || buddy.prefs.isMuted || text.trim().startsWith('/')) return false
  if (buddy.prefs.judge === 'always') return true
  const now = await $.clock.now()
  if (now - lastJudgedAt < JUDGE_EVERY) return false
  // A prompt with an obvious sin is far more likely to get called out.
  return Math.random() < (sinOf(text) === null ? 0.25 : 0.7)
}

export async function judge($: Engine, text: string): Promise<void> {
  const now = await $.clock.now()
  lastJudgedAt = now
  // Now and then, more often for a wise pet, it borrows a bigger brain.
  const isBig = buddy.prefs.isSmart && now - lastBigAt > BIG_EVERY && Math.random() < 0.03 + statOf('WISDOM') / 250
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
  buddy.facts.grades.push(verdict.grade)
  await nudge($, 'SNARK', 0.2)
  const brain = verdict.fix === undefined ? '' : '🧠 '
  await say($, `${brain}${verdict.grade} · ${verdict.line}`, { isForced: true, ttl: 15 * SECOND })
  await speak($, verdict.line)
  if (verdict.fix !== undefined && buddy.pet !== null) {
    $.ui.log(`🧠 ${buddy.pet.name} borrowed a bigger brain. Your prompt, rewritten:\n${verdict.fix}`)
  }
  if (verdict.grade.startsWith('F')) await award($, 'dunce')
  const recent = [...history, entry]
  if (recent.length >= 10 && recent.reduce((s, v) => s + pointsOf(v.grade), 0) / recent.length >= 3.5) await award($, 'honor-roll')
}

export async function judgedHistory($: Engine): Promise<Judged[]> {
  const judged = await $.store.get('verdicts')
  return Array.isArray(judged) ? (judged as Judged[]) : []
}

async function smartVerdict($: Engine, text: string, isBig: boolean): Promise<Verdict | null> {
  if (!buddy.prefs.isSmart || buddy.pet === null || buddy.bones === null) return null
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

export async function verdictReport($: Engine): Promise<string> {
  const history = await judgedHistory($)
  const commits = await commitHistory($)
  const claude = await claudeHistory($)
  const mode = `Judging: ${buddy.prefs.judge}${buddy.prefs.isSmart ? ' (Haiku writes the roasts)' : ' (phrasebook roasts)'}.`
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

export async function judgeCommit($: Engine, command: string): Promise<void> {
  const message = commitMessageOf(command)
  if (message === null || buddy.prefs.isMuted) return
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
  if (!buddy.prefs.isSmart || buddy.pet === null) return null
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

export async function sessionPrompts($: Engine): Promise<string[]> {
  const note = buddy.pet === null ? null : new RegExp(`${escapeRegExp(buddy.pet.name)} is the user's terminal pet[\\s\\S]*$`)
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

export async function roastLast($: Engine): Promise<string> {
  if (buddy.pet === null) return 'Still hatching…'
  const last = (await sessionPrompts($)).at(-1) ?? buddy.lastPrompt.trim()
  if (last.length === 0) return `${buddy.pet.name} hasn't seen a prompt from you yet this session.`
  if (!buddy.prefs.isSmart) {
    const verdict = localVerdict(last, voice())
    await deliver($, verdict, last)
    return `**${verdict.grade}** · ${verdict.line}\n\n(Phrasebook roast: /buddy smart on lets ${buddy.pet.name} borrow a bigger brain.)`
  }
  $.ui.toast(`🧠 ${buddy.pet.name} is borrowing a bigger brain…`)
  lastBigAt = await $.clock.now()
  const verdict = (await smartVerdict($, last, true)) ?? localVerdict(last, voice())
  await deliver($, verdict, last)
  await nudge($, 'WISDOM', 0.75)

  return [
    `**${verdict.grade}** · ${verdict.line}`,
    ...(verdict.fix === undefined ? [] : ['', 'What you should have sent:', '', '```', verdict.fix, '```']),
  ].join('\n')
}

export async function review($: Engine): Promise<string> {
  if (buddy.pet === null || buddy.bones === null) return 'Still hatching…'
  const prompts = (await sessionPrompts($)).slice(-15)
  if (prompts.length < 2) return `${buddy.pet.name} needs at least two of your prompts this session to review.`
  if (!buddy.prefs.isSmart) return `The review needs a model: /buddy smart on, then /buddy review.`

  const gpa = gpaOf(await judgedHistory($))
  const system =
    `${persona()} For this review you borrowed a much bigger brain, so whatever your stats say, the advice itself ` +
    `must be genuinely useful; only the voice is yours. Review how the developer prompts Claude across the prompts ` +
    `below, and roast the vibecoder behind the keyboard while coaching them. Mock the habits, never who they are; ` +
    `crude language is fine. Write markdown in the language they write in, under 250 words: an overall grade (A+ ` +
    `to F) with a one-line verdict; their three worst habits, each with a short quote from their prompts and the ` +
    `fix; their worst prompt rewritten the way it should have been sent; one thing they do well, admitted grudgingly.`
  const listed = prompts.map((p, i) => `${i + 1}. """${p.slice(0, 800)}"""`).join('\n')
  $.ui.toast(`🧠 ${buddy.pet.name} is borrowing a bigger brain to review your prompts…`)
  const reply = await ask(
    $,
    system,
    `Their prompts this session, oldest first:\n${listed}${gpa === null ? '' : `\n\nTheir running prompting GPA: ${gpa}.`}`,
    { isBig: true, maxTokens: 8000, timeoutMs: 90 * SECOND },
  )
  if (reply === null) return `${buddy.pet.name} couldn't reach the bigger brain. Try again in a bit.`
  lastBigAt = await $.clock.now()
  await count($, 'reviews', 1)
  await award($, 'big-brain')
  await nudge($, 'WISDOM', 0.75)
  await say($, 'read it and weep', { isForced: true })

  return `**${buddy.pet.name}'s prompting review** (big brain: Opus)\n\n${reply.trim()}`
}

// The Hall of Shame: on Fridays, the week's worst prompt roasted and its best crowned

function weekKey(now: number): string {
  const d = new Date(now)
  const day = (d.getDay() + 6) % 7
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day)
  return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`
}

export async function fridayCeremony($: Engine): Promise<void> {
  if (buddy.pet === null) return
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
  if (buddy.pet === null || buddy.bones === null || !buddy.prefs.isSmart) return null
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
  const text = `🏆 **${buddy.pet.name}'s Hall of Shame** (week of ${weekKey(now)}, by Opus)\n\n${reply.trim()}`
  await $.store.set('shame', { week: weekKey(now), at: now, pet: buddy.pet.name, text })
  await nudge($, 'SNARK', 0.5)

  return text
}

export async function shameReport($: Engine): Promise<string> {
  if (buddy.pet === null) return 'Still hatching…'
  const now = await $.clock.now()
  const stored = asObject(await $.store.get('shame'))
  if (stored.week === weekKey(now) && typeof stored.text === 'string') return stored.text
  if (!buddy.prefs.isSmart) return 'The Hall of Shame needs a model: /buddy smart on first.'
  $.ui.toast(`🧠 ${buddy.pet.name} is convening the Hall of Shame…`)
  const text = await ceremony($, now)
  if (text !== null) return text
  const judged = (await judgedHistory($)).filter(v => v.prompt !== undefined && now - v.at < 7 * DAY).length

  return `The Hall of Shame needs 5 judged prompts from the last 7 days; you have ${judged}. ${buddy.pet.name} opens it every Friday.`
}

// Judging Claude's answers

async function claudeHistory($: Engine): Promise<Judged[]> {
  const stored = await $.store.get('claudeVerdicts')
  return Array.isArray(stored) ? (stored as Judged[]) : []
}

export async function shouldJudgeClaude($: Engine, now: number): Promise<boolean> {
  if (buddy.prefs.judge === 'off' || buddy.prefs.isMuted) return false
  if (buddy.prefs.judge === 'always') return true
  if (now - lastClaudeJudgedAt < CLAUDE_JUDGE_EVERY) return false
  return Math.random() < 0.25
}

export async function judgeClaude($: Engine, answer: string): Promise<void> {
  const now = await $.clock.now()
  lastClaudeJudgedAt = now
  const verdict = (await smartAnswerVerdict($, answer)) ?? localAnswerVerdict(answer, buddy.lastPrompt, voice())
  const history = await claudeHistory($)
  await $.store.set('claudeVerdicts', [...history, { grade: verdict.grade, line: verdict.line, at: now }].slice(-100))
  await say($, `🤖 ${verdict.grade} · ${verdict.line}`, { isForced: true, ttl: 15 * SECOND })
  await speak($, verdict.line)
}

async function smartAnswerVerdict($: Engine, answer: string): Promise<Verdict | null> {
  if (!buddy.prefs.isSmart || buddy.pet === null) return null
  const system =
    `${persona()} Right now you judge CLAUDE's answer to the developer's last prompt and roast the AI for it, in the ` +
    `voice your stats give you: directness, whether the length fits the ask, hedging, apologizing, filler ("great ` +
    `question"), and whether it actually did or answered the thing. Roast Claude, never the developer. A genuinely ` +
    `good answer gets a grudging A. Write in the language of the exchange. Answer with JSON only: ` +
    `{"grade": "<A+ to F>", "roast": "<one line, at most 80 characters>"}`
  const parsed = jsonOf(
    await ask($, system, `The prompt:\n"""\n${clip(buddy.lastPrompt, 600)}\n"""\n\nClaude's answer:\n"""\n${answer.slice(0, 2500)}\n"""`),
  )
  const grade = typeof parsed.grade === 'string' ? parsed.grade.trim().toUpperCase() : ''
  const roast = typeof parsed.roast === 'string' ? clip(parsed.roast, 90) : ''

  return GRADES.test(grade) && roast.length > 0 ? { grade, line: roast } : null
}

// The prompt doctor: your last prompt, rewritten into the box

export async function promptDoctor($: Engine, given: string): Promise<string> {
  if (buddy.pet === null) return 'Still hatching…'
  const text = given.trim().length > 0 ? given.trim() : ((await sessionPrompts($)).at(-1) ?? buddy.lastPrompt.trim())
  if (text.length === 0) return `${buddy.pet.name} needs a prompt to fix: /buddy fix <text>, or send one first.`
  const fixed = (await smartFix($, text)) ?? localFix(text)
  try {
    const filled = await $.prompt.fill({ text: fixed, mode: 'replace' })
    if ((filled as { isFilled?: boolean }).isFilled !== false) {
      await say($, 'there. now THAT is a prompt', { isForced: true })
      return `📝 ${buddy.pet.name} rewrote it into the prompt box. Fill the [brackets], then send.\n\n> ${fixed.replace(/\n/g, '\n> ')}`
    }
  } catch {
    // Nowhere to fill: the text goes below instead.
  }

  return `📝 ${buddy.pet.name}'s rewrite (the prompt box wouldn't take it here):\n\n\`\`\`\n${fixed}\n\`\`\``
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
