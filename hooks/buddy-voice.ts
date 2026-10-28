// How the pet talks: the bubble, its voice from its stats, model calls for smart
// lines, answering by name, sound effects and speech.

import { QUIPS, STATS } from './art'
import type { Voice } from './grading'
import { award, count, levelOf, moodAt, publish, rankedNow, speciesLabel, statOf } from './buddy-life'
import { MINUTE, MODEL, QUIET_FOR, SECOND, asObject, buddy, clip, escapeRegExp } from './buddy-state'
import type { Engine } from './buddy-state'

type Sound = 'quack' | 'crunch' | 'levelup' | 'fanfare' | 'sad' | 'pop'
const BIG_MODEL = 'opus'
const SPEAK_EVERY = 2 * MINUTE
let lastSoundAt = 0

// Talking

export async function say($: Engine, text: string, options: { isForced?: boolean; ttl?: number } = {}): Promise<void> {
  if (buddy.prefs.isMuted && options.isForced !== true) return
  const now = await $.clock.now()
  if (options.isForced !== true && now - buddy.lastSaidAt < QUIET_FOR) return
  buddy.lastSaidAt = now
  buddy.bubble = text
  const id = ++buddy.bubbleId
  await publish($)
  $.clock.after(options.ttl ?? 9 * SECOND, () => {
    if (buddy.bubbleId !== id) return
    buddy.bubble = null
    void publish($)
  })
}

export const pickLine = (lines: readonly string[]): string => lines[Math.floor(Math.random() * lines.length)] ?? '…'

export function voice(): Voice {
  return { isSnarky: ['SNARK', 'CHAOS'].includes(rankedNow()[0]), isWise: statOf('WISDOM') >= 60 }
}

export function fill(line: string, extra: Record<string, string | number> = {}): string {
  let out = line
    .replaceAll('{name}', buddy.pet?.name ?? '')
    .replaceAll('{species}', buddy.bones?.species ?? 'pet')
    .replaceAll('{level}', String(levelOf(buddy.xp).level))
  for (const [k, v] of Object.entries(extra)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}

export function quip(kind: string, extra: Record<string, string | number> = {}): string {
  const pool = QUIPS[kind]
  if (pool === undefined || buddy.bones === null) return '…'
  const lines = voice().isSnarky ? pool.snark : pool.sweet

  return fill(pickLine(lines), { days: 0, ...extra })
}

// How the stats shape the voice: one directive per stat that stands out.
function voiceOf(): string {
  if (buddy.bones === null) return ''
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

export function persona(): string {
  if (buddy.pet === null || buddy.bones === null) return ''
  return `You are ${buddy.pet.name}, a ${buddy.bones.rarity} ${speciesLabel(buddy.bones.species, levelOf(buddy.xp).level)} living in a developer's terminal, watching them work with Claude, a coding assistant. Personality: ${buddy.pet.personality} ${voiceOf()}`
}

export function firstLine(text: string): string | null {
  const line = text
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0)
  if (line === undefined || buddy.pet === null) return null
  return line.replace(new RegExp(`^${escapeRegExp(buddy.pet.name)}\\s*:\\s*`, 'i'), '').replace(/^["“']|["”']$/g, '')
}

export async function ask($: Engine, system: string, prompt: string, options: { isBig?: boolean; maxTokens?: number; timeoutMs?: number } = {}): Promise<string | null> {
  if (!buddy.prefs.isSmart) return null
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

export function jsonOf(text: string | null): Record<string, unknown> {
  if (text === null) return {}
  try {
    const json = text.match(/\{[\s\S]*\}/)?.[0]
    return asObject(json === undefined ? null : JSON.parse(json))
  } catch {
    return {}
  }
}

export async function smartLine($: Engine, situation: string): Promise<string | null> {
  if (buddy.pet === null || buddy.bones === null) return null
  const system =
    `${persona()} Mood: ${moodAt(await $.clock.now())}. Write ONE line of at most 70 characters in ${buddy.pet.name}'s ` +
    `voice, specific to what just happened; tease the work, never who they are. No hashtags, no quotes around it; ` +
    `*actions* in asterisks are fine. Use the language the developer writes in.`
  const reply = await ask($, system, `${situation}\n\n${buddy.pet.name} says:`)
  const line = reply === null ? null : firstLine(reply)

  return line === null ? null : clip(line, 90)
}

export async function answer($: Engine, text: string): Promise<void> {
  const line = (await smartLine($, `The developer just said to you: "${clip(text, 300)}"`)) ?? quip('addressed')
  await say($, line, { isForced: true, ttl: 12 * SECOND })
  const t = await count($, 'addressed', 1)
  if (t.addressed >= 25) await award($, 'socialite')
}

export async function quackBack($: Engine): Promise<void> {
  if (buddy.bones === null) return
  const isDuckish = buddy.bones.species === 'duck' || buddy.bones.species === 'goose'
  await say($, isDuckish ? 'QUACK!!' : `*${buddy.bones.species} noises* …quack?`, { isForced: true })
  await play($, 'quack')
  await award($, 'duck-whisperer')
}

// Sound: a WAV of the mod's, through Windows when this is WSL, else the platform's player

export async function play($: Engine, name: Sound): Promise<void> {
  if (!buddy.prefs.hasSound) return
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

// Out loud: Windows speech through WSL, or the macOS voice

export async function speak($: Engine, text: string): Promise<void> {
  if (!buddy.prefs.hasVoice || buddy.pet === null) return
  const now = await $.clock.now()
  if (now - buddy.lastSpokeAt < SPEAK_EVERY) return
  buddy.lastSpokeAt = now
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
