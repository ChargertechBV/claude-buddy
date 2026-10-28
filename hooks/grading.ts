// The phrasebook judges: pure rules for grading a prompt or a commit
// message when Haiku is off or did not answer. `sweet` lines are for a
// gentle pet (disappointed rather than mean), `snark` for a SNARK or CHAOS
// one; a wise pet (WISDOM 60+) adds the tip.

export type Lines = { sweet: string[]; snark: string[] }
export type Verdict = { grade: string; line: string; fix?: string }
export type Voice = { isSnarky: boolean; isWise: boolean }

export const GRADES = /^[A-F][+-]?$/

const SINS: { grade: string; test: (t: string) => boolean; lines: Lines; tip: string }[] = [
  {
    grade: 'F',
    test: t => t.split(/\s+/).length <= 3,
    lines: {
      sweet: ["oh. that's… the whole prompt? okay", "I'm sure Claude will figure out what you meant. somehow", 'short and sweet. mostly short'],
      snark: ["that's not a spec, it's a prayer", "three words. Claude isn't psychic", 'bold of you to call that a prompt'],
    },
    tip: 'say what, where and what done looks like',
  },
  {
    grade: 'D',
    test: t => /\b(doesn'?t|does not|still not|niet|werkt niet)\b.*\bwork|\bbroken\b|\bkapot\b/i.test(t) && !/error|exception|traceback|stack|fout|```/i.test(t),
    lines: {
      sweet: ["broken how, sweetie? I'm not mad", 'no error message? brave', "I'm sure the error was very interesting"],
      snark: ['broken HOW? paste the error, vibecoder', '"doesn\'t work" is a vibe, not a bug report', 'no error message, just feelings'],
    },
    tip: 'paste the exact error',
  },
  {
    grade: 'D-',
    test: t => /[A-Z]{4}/.test(t) && t === t.toUpperCase(),
    lines: {
      sweet: ['inside voice, please', 'we can all hear you, dear', '*covers ears politely*'],
      snark: ["YELLING DOESN'T COMPILE FASTER", 'caps lock is not a debugger', 'Claude can hear you. we all can'],
    },
    tip: 'calm specifics beat caps',
  },
  {
    grade: 'C',
    test: t => t.length > 2500,
    lines: {
      sweet: ['what a lovely essay. what was the question?', 'I read it all. I think. maybe a summary?', 'so many words, so few requirements'],
      snark: ['a whole novel and still no acceptance criteria', "TL;DR: you don't know what you want either", 'Claude wanted a spec, you sent a memoir'],
    },
    tip: 'lead with the ask, then the context',
  },
  {
    grade: 'C-',
    test: t => /\b(pls|plz|please please|just make it|make it work)\b/i.test(t),
    lines: {
      sweet: ['asking nicely is sweet. asking clearly is better', 'manners: A. requirements: hmm', "it's okay, Claude can't read minds either"],
      snark: ['begging is not a requirement', '"just make it work" — said every vibecoder ever', 'manifesting code now, are we'],
    },
    tip: 'describe what "working" means',
  },
]
const GOOD: Lines = {
  sweet: ["oh! that's actually a nice prompt. proud of you", 'look at you, giving context', 'a real spec? I might cry'],
  snark: ['context AND a goal? who are you', "ugh. that's actually decent", 'fine. Claude can work with that'],
}
const MEH: Lines = {
  sweet: ["it's a start! a vague, vague start", 'Claude will do its best. bless it', 'I believe in you. Claude might not'],
  snark: ["mid prompt. Claude will guess and you'll blame it", 'a C. like your commit messages', 'vibes: present. requirements: absent'],
}

const pick = (lines: Lines, voice: Voice, rng: () => number): string => {
  const pool = voice.isSnarky ? lines.snark : lines.sweet
  return pool[Math.floor(rng() * pool.length)] ?? '…'
}

export function sinOf(text: string): { grade: string; tip: string } | null {
  return SINS.find(s => s.test(text.trim())) ?? null
}

export function localVerdict(text: string, voice: Voice, rng: () => number = Math.random): Verdict {
  const sin = SINS.find(s => s.test(text.trim()))
  if (sin !== undefined) return { grade: sin.grade, line: pick(sin.lines, voice, rng) + (voice.isWise ? ` (tip: ${sin.tip})` : '') }

  const hasContext = /```|\b[\w/-]+\.(ts|tsx|js|py|go|rs|php|rb|md|json|ya?ml|sql)\b|error|expected|should|moet/i.test(text)
  if (hasContext && text.split(/\s+/).length > 12) return { grade: 'B+', line: pick(GOOD, voice, rng) }

  return { grade: 'C', line: pick(MEH, voice, rng) + (voice.isWise ? ' (tip: name the file and the goal)' : '') }
}

export function pointsOf(grade: string): number {
  const base = { A: 4, B: 3, C: 2, D: 1, F: 0 }[grade[0] as 'A'] ?? 2
  return base + (grade.endsWith('+') ? 0.3 : grade.endsWith('-') ? -0.3 : 0)
}

export function gpaOf(history: readonly { grade: string }[]): string | null {
  if (history.length === 0) return null
  const mean = history.reduce((sum, { grade }) => sum + pointsOf(grade), 0) / history.length
  const letter = 'FDCBA'[Math.max(0, Math.min(4, Math.round(mean)))] ?? 'C'
  const sign = mean - Math.round(mean) > 0.15 ? '+' : mean - Math.round(mean) < -0.15 ? '-' : ''

  return `${letter}${sign} (${mean.toFixed(1)})`
}

// Commit messages

/** The message a `git commit` command carries, or null when it opens an editor or reads a file. */
export function commitMessageOf(command: string): string | null {
  const heredoc = command.match(/<<-?\s*'?(\w+)'?\r?\n([\s\S]*?)\r?\n\s*\1\b/)
  if (heredoc?.[2] !== undefined) return heredoc[2].trim()
  const parts: string[] = []
  for (const m of command.matchAll(/(?:^|\s)(?:-m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/g)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\"/g, '"').trim()
    if (text.length > 0) parts.push(text)
  }
  return parts.length > 0 ? parts.join('\n\n') : null
}

const LAZY = /^(wip|fix(es|ed)?( stuff| things| bugs?| it| typo)?|update(s|d)?( stuff| things)?|changes|stuff|misc|tests?|asdf|\.+|more( stuff)?|things|final\d*|done|tmp|temp|commit|save|work|it works|minor (fix|fixes|changes))\.?$/i
const PAST = /^(added|fixed|updated|removed|changed|deleted|moved|refactored|improved|cleaned|implemented|created)\b/i

const COMMIT_LINES: Record<string, Lines> = {
  lazy: {
    sweet: ['"{s}". future you is going to wonder what that was', 'what did it fix, sweetie? the message is shy', 'a commit message is a love letter to future you. this is a post-it'],
    snark: ['"{s}". fix WHAT, vibecoder', 'git blame will find you and it will say "{s}"', 'a message so lazy it\'s practically a yawn'],
  },
  long: {
    sweet: ['the subject line is a title, not the whole story', 'a bit long for a first line, dear', 'subject lines like short; the body is for the rest'],
    snark: ['that subject line needs a subject line', '72 characters. it\'s not a suggestion', 'a paragraph in the subject. bold'],
  },
  past: {
    sweet: ['imperative mood, like it\'s a tiny order: "add", not "added"', 'close! git likes "fix", not "fixed"', 'past tense is for diaries. commits are orders'],
    snark: ['"{s}" — commits are orders, not memoirs', 'imperative mood or the kernel devs come for you', 'past tense. the Linux people are already typing'],
  },
  period: {
    sweet: ['no period on the subject; it\'s a title, not a sentence', 'the subject line doesn\'t need a full stop, dear', 'tiny nit: subject lines don\'t end in a period'],
    snark: ['a period in the subject. the audacity', 'subject line. with a period. criminal', 'it\'s a title, not a tweet'],
  },
  good: {
    sweet: ['a clear subject AND a body? look at you', 'that\'s a lovely commit message', 'future you says thank you'],
    snark: ['a real commit message. who are you and what did you do with the vibecoder', 'fine. that\'s a good message. don\'t get used to it', 'subject, body, imperative. suspicious competence'],
  },
  ok: {
    sweet: ['nice and clear! a body would make it perfect', 'good subject. tell me why next time', 'solid. the why can go in the body'],
    snark: ['decent subject. the "why" is apparently a secret', 'ok. passable. git log won\'t cry', 'it\'ll do. barely'],
  },
}

export function localCommitVerdict(message: string, voice: Voice, rng: () => number = Math.random): Verdict {
  const [subject = '', ...rest] = message.split('\n')
  const s = subject.trim()
  const body = rest.join('\n').trim()
  const line = (kind: string, grade: string): Verdict => ({
    grade,
    line: pick(COMMIT_LINES[kind] ?? COMMIT_LINES.ok!, voice, rng).replaceAll('{s}', s.slice(0, 30)),
  })
  if (s.length === 0 || LAZY.test(s) || s.split(/\s+/).length < 2) return line('lazy', 'F')
  if (s.length > 72) return line('long', 'C-')
  if (PAST.test(s)) return line('past', 'C')
  if (/\.$/.test(s)) return line('period', 'B-')
  if (body.length > 20) return line('good', 'A')

  return line('ok', 'B')
}

// Claude's answers

const ANSWER_LINES: Record<string, Lines> = {
  empty: {
    sweet: ['Claude said nothing. it happens to everyone', 'a quiet one. we all have days'],
    snark: ['Claude said nothing. iconic', 'the silent treatment. from an AI'],
  },
  grovel: {
    sweet: ['it apologized again, bless it', '"great question"… it was fine, Claude'],
    snark: ['it apologized AGAIN', '"great question". it was not'],
  },
  bloat: {
    sweet: ['{n} words for a yes/no. thorough!', "that's a lot of words, Claude"],
    snark: ['{n} words to say "yes"', 'you asked a question, it wrote a thesis'],
  },
  novel: {
    sweet: ['a long one. make tea', 'Claude had a LOT to say'],
    snark: ['a novel. did you ask for a novel', '{n} words. nobody reads that'],
  },
  hedge: {
    sweet: ['it hedged a bit. a lot. {n} times', 'so many maybes'],
    snark: ['it hedged {n} times. commit to something', '"it depends". on WHAT, Claude'],
  },
  good: {
    sweet: ['short, and it shipped code. nice', "that's a good answer, actually"],
    snark: ['short and it shipped code. who taught it that', "fine. good answer. don't get used to it"],
  },
  ok: {
    sweet: ['it answered! good job, both of you', 'solid. not flashy'],
    snark: ['fine. it answered. the bar is low', 'adequate. the word is adequate'],
  },
}

export function localAnswerVerdict(answer: string, prompt: string, voice: Voice, rng: () => number = Math.random): Verdict {
  const words = answer.trim().split(/\s+/).filter(w => w.length > 0).length
  const line = (kind: string, grade: string, n = 0): Verdict => ({
    grade,
    line: pick(ANSWER_LINES[kind] ?? ANSWER_LINES.ok!, voice, rng).replaceAll('{n}', String(n)),
  })
  if (words === 0) return line('empty', 'F')
  if (/^\s*((great|good|excellent|what a) question|certainly!|i apologize|i'm sorry|sorry)/i.test(answer)) return line('grovel', 'C-')
  const promptWords = prompt.trim().split(/\s+/).filter(w => w.length > 0).length
  if (promptWords > 0 && promptWords < 15 && /\?\s*$/.test(prompt.trim()) && words > 250) return line('bloat', 'D', words)
  if (words > 800) return line('novel', 'C', words)
  const hedges = (answer.match(/\b(might|perhaps|possibly|it depends|generally|typically|may or may not|arguably)\b/gi) ?? []).length
  if (hedges >= 4) return line('hedge', 'C', hedges)
  if (words <= 150 && answer.includes('```')) return line('good', 'A-')

  return line('ok', 'B')
}
