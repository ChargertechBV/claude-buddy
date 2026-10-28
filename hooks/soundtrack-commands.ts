// /soundtrack and its verbs, the pane's sections, and the optional short commands
// (/play, /note, /drink, ...) that run the same verbs.

import { atom, read, update } from 'claude-code'

import type { Sections } from '../types'
import { beatLead, kicksInLast, pipelineDelay, setBeatLead, setTempoPreference, tempoNow, tempoPreference } from './beat'
import { PALETTES, SLICE_EVERY_MAX, TICK_MS, depthSeconds, setSliceEvery, sliceEvery } from './strip'
import type { EqView, Palette } from './strip'
import { drinkCommand, drinksReport } from './drinks'
import { setEqDensity, setEqPalette, setEqView } from './eq'
import { noteCommand, notesCommand } from './notes'
import { PANE, clock, isRecord } from './shared'
import type { $ } from './shared'
import { cleanGenerated, control, findPlaylist, generate, loadAuth, nowPlayingOf, playContext, playedOf, playlistsOf, refreshPlaylists, setVolume } from './spotify'
import { flowTracks, limitsText, modelsText, telemetryOf } from './telemetry'

const SECTIONS = ['playlists', 'notes', 'drinks', 'session', 'usage'] as const
const ALL_SECTIONS: Sections = { playlists: true, notes: true, drinks: true, session: true, usage: true }
const sections = atom({ plugin: 'buddy', key: 'sections' } as const, ALL_SECTIONS, { shape: 'sec-1' })

/** Reads `sections` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function sectionsOf($: $) {
  return read($, sections)
}

/** The stored choice of sections, every key filled in; anything that is not an object is the default. */
function sectionsFrom(stored: unknown): Sections {
  const out = { ...ALL_SECTIONS }
  if (isRecord(stored)) for (const key of SECTIONS) if (typeof stored[key] === 'boolean') out[key] = stored[key]
  return out
}

// -- commands -------------------------------------------------------------------

/** Loads which sections the pane shows, at session start. */
export async function loadSections($: $) {
  const chosen = await $.store.get('soundtrack:sections')
  if (chosen !== undefined) await update($, sections, () => sectionsFrom(chosen))
}

/** The short commands, each the /soundtrack verb of the same name. */
const SHORTCUTS: readonly { name: string; description: string }[] = [
  { name: 'play', description: 'Play one of your Spotify playlists by name; alone it resumes' },
  { name: 'pause', description: 'Pause Spotify' },
  { name: 'skip', description: 'Next track on Spotify; "back" goes back' },
  { name: 'volume', description: 'Spotify volume: 40, +10, -10' },
  { name: 'vibe', description: 'Generate a Spotify playlist for a mood and play it; "clean" removes them' },
  { name: 'note', description: 'Add a note to the Soundtrack pane, stamped with the track playing' },
  { name: 'notes', description: 'List your notes; "global", "rm <n>", "clear yes"' },
  { name: 'drink', description: 'Log a cup: coffee, tea or water; "undo", "goal 8"' },
]

/**
 * Whether the short commands are on. Decided once and stored: an install that
 * already has Soundtrack data keeps them, a new one starts without, so the mod
 * never takes a common command name unasked.
 */
async function shortcutsOn($: $): Promise<boolean> {
  const stored = await $.store.get('soundtrack:shortcuts')
  if (typeof stored === 'boolean') return stored
  const hadData = (await $.store.get('soundtrack:playlists')) !== undefined || (await $.store.get('soundtrack:notes')) !== undefined || (await $.store.get('soundtrack:eqView')) !== undefined
  await $.store.set('soundtrack:shortcuts', hadData)
  return hadData
}

/** Registers the short commands when they are on. */
export async function registerShortcuts($: $) {
  if (!(await shortcutsOn($))) return
  for (const one of SHORTCUTS) await $.command.register({ name: one.name, description: `${one.description} (/soundtrack ${one.name})` })
}

/** A short command: the /soundtrack verb of its name, while short commands are on. */
export async function runShortcut($: $, verb: string, args: string): Promise<{ text: string }> {
  if (!(await shortcutsOn($))) return { text: `Short commands are off: use /soundtrack ${verb}${args.trim() ? ` ${args.trim()}` : ''}. "/soundtrack shortcuts on" brings them back.` }
  return soundtrackCommand($, `${verb} ${args}`)
}

/** `/soundtrack play [name|list]`: a playlist by name, or resume. */
async function playCommand($: $, query: string): Promise<string> {
  if (!query) {
    await control($, 'play')
    const np = await nowPlayingOf($)
    return np ? `Resuming ${np.name}.` : 'Resuming Spotify.'
  }
  let list = await playlistsOf($)
  if (list.length === 0) {
    await refreshPlaylists($, true)
    list = await playlistsOf($)
  }
  if (/^(list|ls)$/i.test(query)) return list.length ? `Your playlists:\n${list.map(one => `- ${one.name}`).join('\n')}` : 'No playlists loaded yet.'
  const hit = findPlaylist(list, query)
  if (!hit) return `No playlist matches "${query}". "/soundtrack play list" shows them.`
  const outcome = await playContext($, hit.uri, hit.name)
  return hit.url ? `${outcome}\n${hit.url}` : outcome
}

/** `/soundtrack volume 40|+10|-10`. */
async function volumeCommand($: $, args: string): Promise<string> {
  const np = await nowPlayingOf($)
  const m = args.trim().match(/^([+-])?(\d{1,3})$/)
  if (!m) return np && np.volume !== null ? `Volume: ${np.volume}%. /soundtrack volume 40, +10 or -10.` : 'No device volume known. "/soundtrack volume 40" sets it once something plays.'
  const base = np && np.volume !== null ? np.volume : 50
  const level = m[1] === '+' ? base + Number(m[2]) : m[1] === '-' ? base - Number(m[2]) : Number(m[2])
  await setVolume($, level)
  return `Volume: ${Math.max(0, Math.min(100, Math.round(level)))}%`
}

/** `/soundtrack vibe <mood> | clean`. */
async function vibeCommand($: $, args: string): Promise<string> {
  if (!args) return 'Describe the vibe: /soundtrack vibe focus deep work. "/soundtrack vibe clean" removes the playlists this made.'
  if (/^clean$/i.test(args)) return cleanGenerated($)
  return generate($, `Create a playlist for this vibe: ${args}`, args)
}

const USAGE =
  'Usage: /soundtrack [play <name> | pause | skip [back] | volume <n> | vibe <mood> | note <text> | notes | drink coffee|tea|water | drinks | playlist | show|hide <section> | sections | usage | eq bars|3d|ridge | colors <palette> | density 1|2 | slices <n> | beat [<ms> | prefer <bpm>] | shortcuts on|off]'

/** `/soundtrack <verb> ...`: every Soundtrack command; alone it opens the pane. */
export async function soundtrackCommand($: $, raw: string): Promise<{ text: string }> {
  const now = await $.clock.now()
  const args = raw.trim()
  const verb = (args.split(/\s+/)[0] ?? '').toLowerCase()
  const rest = args.slice(verb.length).trim()
  if (verb === 'play') return { text: await playCommand($, rest) }
  if (verb === 'pause') {
    await control($, 'pause')
    return { text: 'Paused Spotify.' }
  }
  if (verb === 'skip' || verb === 'next') {
    const back = /^(back|prev|previous)\b/i.test(rest)
    await control($, back ? 'previous' : 'next')
    return { text: back ? 'Back a track.' : 'Skipped.' }
  }
  if (verb === 'volume' || verb === 'vol') return { text: await volumeCommand($, rest) }
  if (verb === 'vibe') return { text: await vibeCommand($, rest) }
  if (verb === 'note') return { text: await noteCommand($, rest) }
  if (verb === 'notes') return { text: await notesCommand($, rest) }
  if (verb === 'drink' || verb === 'cup' || verb === 'cups') return { text: await drinkCommand($, rest) }
  if (verb === 'drinks') return { text: await drinksReport($) }
  if (verb === 'shortcuts') {
    const want = rest.toLowerCase()
    const names = SHORTCUTS.map(one => `/${one.name}`).join(' ')
    if (want !== 'on' && want !== 'off') return { text: `Short commands are ${(await shortcutsOn($)) ? 'on' : 'off'}: ${names}. "/soundtrack shortcuts on" or "off" switches them.` }
    await $.store.set('soundtrack:shortcuts', want === 'on')
    if (want === 'on') {
      await registerShortcuts($)
      return { text: `Short commands on: ${names}.` }
    }
    return { text: 'Short commands off. They leave the command list at the next session; until then each one points to /soundtrack.' }
  }
  const toggle = /^(show|hide)\s+(\w+)$/i.exec(args)
  if (toggle) {
    const want = toggle[1]!.toLowerCase() === 'show'
    const name = toggle[2]!.toLowerCase()
    if (name !== 'all' && !(SECTIONS as readonly string[]).includes(name)) return { text: `No section "${name}". The sections are ${SECTIONS.join(', ')}, or all.` }
    const current = await read($, sections)
    const next: Sections = { ...current }
    for (const key of SECTIONS) if (name === 'all' || name === key) next[key] = want
    await update($, sections, () => next)
    await $.store.set('soundtrack:sections', next)
    const shown = SECTIONS.filter(key => next[key])
    return { text: `Pane sections: ${shown.length ? shown.join(', ') : 'now playing only'}.` }
  }
  if (/^sections?$/i.test(args)) {
    const current = await read($, sections)
    return { text: SECTIONS.map(key => `${current[key] ? '●' : '○'} ${key}`).join('\n') + '\n/soundtrack show|hide <section|all>' }
  }
  if (/^usage\b/i.test(args)) {
    const tel = await telemetryOf($)
    const lines = tel ? [...limitsText(tel.limits, now), ...modelsText(tel.models, false)] : []
    if (!tel || tel.limits.length === 0) lines.unshift('No plan limits reported yet: the engine learns them from the first API response, and an API key has none.')
    if (tel && tel.models.length === 0) lines.push('No model requests counted yet.')
    return { text: lines.join('\n') }
  }
  if (/^playlist\b/i.test(args)) {
    const list = await playedOf($)
    const flow = flowTracks(list, now)
    if (flow.tracks.length === 0) return { text: 'Nothing has played during this session yet, so there is nothing to make a playlist from.' }
    const seen = new Set<string>()
    const unique = flow.tracks.filter(one => !seen.has(one.uri) && seen.add(one.uri)).slice(-25)
    const listing = unique.map(one => `"${one.name}" by ${one.artists.join(', ') || 'unknown'}`).join(', ')
    const stamp = `${clock(flow.from, now)}–${clock(flow.to, now)}`
    const made = await generate($, `Create a playlist named "Coding flow ${stamp}" with exactly these tracks: ${listing}`, `Coding flow ${stamp}`)
    return { text: `Longest error-free stretch: ${stamp}, ${unique.length} tracks.\n${made}` }
  }
  const prefer = args.match(/^beat\s+prefer\s+(\d+)$/i)
  if (prefer) {
    setTempoPreference(Number(prefer[1]))
    await $.store.set('soundtrack:beatPrefer', tempoPreference())
    return { text: `Tempo preference: ${tempoPreference()} bpm. Candidates near it win a beat/half-beat tie; an octave away counts a quarter.` }
  }
  const beat = args.match(/^beat(?:\s+(?:lead\s+)?(-?\d+))?$/i)
  if (beat) {
    if (beat[1] !== undefined) {
      setBeatLead(Number(beat[1]))
      await $.store.set('soundtrack:beatLeadMs', beatLead())
    }
    const delay = pipelineDelay()
    const bpm = tempoNow()
    const lines = [
      `Beat lead: ${beatLead()} ms ahead of the captured audio${beat[1] !== undefined ? ' (saved)' : ''}. Pulse early? lower it; late? raise it: /soundtrack beat 120`,
      `Tempo preference: ${tempoPreference()} bpm (/soundtrack beat prefer 150). Readings run 65..200.`,
      `Pipeline delay seen: ${delay === null ? 'unknown yet' : `${Math.round(delay)} ms`} · tempo: ${bpm ? `~${bpm} bpm` : 'none'} · kicks in the last 12 s: ${kicksInLast(12_000)}`,
    ]
    return { text: lines.join('\n') }
  }
  const eqArg = args.match(/^eq\s+(\w+)$/i)
  if (eqArg) {
    const pick = (eqArg[1] ?? '').toLowerCase()
    const next: EqView | null = pick === 'bars' || pick === 'flat' ? 'bars' : pick === '3d' || pick === 'surface' || pick === 'waterfall' ? '3d' : pick === 'ridge' || pick === 'ridgeline' || pick === 'braille' || pick === 'joy' ? 'ridge' : null
    if (next === null) return { text: 'Views: /soundtrack eq bars, /soundtrack eq 3d, /soundtrack eq ridge' }
    await setEqView($, next)
    return { text: next === '3d' ? 'Equaliser: 3D surface, frequency across, time receding, loudness as height and colour.' : next === 'ridge' ? 'Equaliser: braille ridgeline, one contour per time slice, nearer ridges in front.' : 'Equaliser: bars.' }
  }
  const colors = args.match(/^colou?rs?\s+(\w+)$/i)
  if (colors) {
    const pick = (colors[1] ?? '').toLowerCase()
    if (!(PALETTES as readonly string[]).includes(pick)) return { text: `Palettes: ${PALETTES.join(', ')}. Example: /soundtrack colors fire` }
    await setEqPalette($, pick as Palette)
    return { text: `Equaliser colours: ${pick}.` }
  }
  const density = args.match(/^(?:density|bars)\s+(1|2)$/i)
  if (density) {
    const n = Number(density[1])
    await setEqDensity($, n)
    return { text: n === 2 ? 'Equaliser: two bars per cell (half-row steps).' : 'Equaliser: one bar per cell (eighth-row steps).' }
  }
  const every = args.match(/^slices?(?:\s+(\d+))?$/i)
  if (every) {
    if (every[1] !== undefined) {
      const n = Number(every[1])
      if (n < 1 || n > SLICE_EVERY_MAX) return { text: `Slices: 1 to ${SLICE_EVERY_MAX} ticks between depth slices (a tick is ${TICK_MS} ms). Example: /soundtrack slices 3` }
      setSliceEvery(n)
      await $.store.set('soundtrack:sliceEvery', sliceEvery)
    }
    const perSecond = Math.round(1000 / (sliceEvery * TICK_MS))
    return { text: `Depth slices every ${sliceEvery} tick${sliceEvery === 1 ? '' : 's'} (${sliceEvery * TICK_MS} ms, about ${perSecond}/s); the 3D and ridge views hold ${depthSeconds().toFixed(1)} s.` }
  }
  if (args) return { text: USAGE }
  const opened = await $.ui.open({ id: PANE, title: 'Soundtrack' })
  const np = await nowPlayingOf($)
  const list = await playedOf($)
  const signedIn = (await loadAuth($, now)) !== null
  const bpm = tempoNow()
  const lines = [
    opened.isPlaced ? 'Soundtrack pane opened.' : `Soundtrack pane waits for a wider terminal (${opened.reason}).`,
    signedIn ? 'Your own Spotify app is signed in: live position and playback control.' : `Not signed in to your own Spotify app: reading through the connector only. For control: python3 ${$.plugin.root}/tools/spotify-login.py <client id>`,
    np ? `${np.isPlaying ? 'Playing' : 'Paused'}: ${np.name} · ${np.artists.join(', ')}${np.device ? ` on ${np.device}` : ''}${bpm ? ` · ~${bpm} bpm` : ''}` : 'Spotify reports nothing playing.',
    `${list.length} track${list.length === 1 ? '' : 's'} played this session; "/soundtrack playlist" turns the error-free stretch into one.`,
  ]
  return { text: lines.join('\n') }
}
