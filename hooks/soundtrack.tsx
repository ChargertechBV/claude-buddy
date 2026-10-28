// The Soundtrack side of the mod: Spotify, the equaliser strip, notes and the
// session telemetry, drawn in a pane beside the chat with the pet. The buddy
// side registers these hooks from its own `register`, starts this at its
// session start and hands its tool calls on.

import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, McpToolResult, On, SessionStartInput, ToolCallInput } from 'claude-code'

import type { ModelTokens, Music, Note, NotesScope, NowPlaying, Played, Playlist, Sections, Telemetry, Track, UsageLimit } from '../types'
import { bassLevels, beatLead, beatNow, hearBass, kicksInLast, pipelineDelay, setBeatLead, setTempoPreference, syncClock, tempoNow, tempoPreference, updateTempo } from './beat'
import { PET_COLUMNS, PET_ROWS, petCells } from './sprite'
import type { PetView } from './sprite'
import { DENSITY_DEFAULT, DEPTH, EQ_ROWS, PALETTES, SLICE_EVERY, TICK_MS, VIEWS, barsFor, mmss, sliceWidth, stripCells, stripRows } from './strip'
import type { EqView, Palette, Progress } from './strip'

type $ = CoreEngineInterface

const PANE = 'soundtrack'
const EQ_KEY = 'eq'
const PET_KEY = 'pet'
const SERVER = 'claude.ai Spotify'
const LANGUAGE = 'en-US'
const API = 'https://api.spotify.com/v1'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const AUTH_FILE = '.config/soundtrack/spotify-auth.json'
const SPOTIFY_URI = /^spotify:(track|playlist|album|artist|episode|show):[A-Za-z0-9]+$/
const POLL_API_MS = 5_000
const POLL_CONNECTOR_MS = 15_000
const AUTH_RECHECK_MS = 60_000
const PLAYLIST_CACHE_MS = 6 * 60 * 60 * 1000
const TELEMETRY_MS = 5_000
const MUSIC_MS = 2_000
/** Bands the capture helper is asked for; its lines carry this many two-digit values. */
const EQ_BANDS = 96
/** Ticks without a helper line before the strip falls back to the animation: about a second. */
const LIVE_STALE_TICKS = 30
const MAX_COLUMNS = 160

// Session values the pane draws from. Change a tag when its fields change: an
// earlier version's value, which outlives a reload, is then read as absent.
const nowPlaying = atom({ plugin: 'buddy', key: 'nowPlaying' } as const, null, { shape: 'np-4' })
const playlists = atom({ plugin: 'buddy', key: 'playlists' } as const, [], { shape: 'pl-1' })
const notes = atom({ plugin: 'buddy', key: 'notes' } as const, [], { shape: 'note-1' })
const played = atom({ plugin: 'buddy', key: 'played' } as const, [], { shape: 'played-1' })
const notesScope = atom({ plugin: 'buddy', key: 'notesScope' } as const, 'folder')
const status = atom({ plugin: 'buddy', key: 'status' } as const, null)
const hasApi = atom({ plugin: 'buddy', key: 'hasApi' } as const, false)
const eqMode = atom({ plugin: 'buddy', key: 'eqMode' } as const, 'guess')
const telemetry = atom({ plugin: 'buddy', key: 'telemetry' } as const, null, { shape: 'tel-3' })
// What the strip hears, published for other mods (buddy reacts to it): bass energy and an estimated tempo.
const music = atom({ plugin: 'buddy', key: 'music' } as const, null, { shape: 'music-1' })
const SECTIONS = ['playlists', 'notes', 'session', 'usage'] as const
const ALL_SECTIONS: Sections = { playlists: true, notes: true, session: true, usage: true }
const sections = atom({ plugin: 'buddy', key: 'sections' } as const, ALL_SECTIONS, { shape: 'sec-1' })

/** The stored choice of sections, every key filled in; anything that is not an object is the default. */
function sectionsFrom(stored: unknown): Sections {
  const out = { ...ALL_SECTIONS }
  if (isRecord(stored)) for (const key of SECTIONS) if (typeof stored[key] === 'boolean') out[key] = stored[key]
  return out
}

// What the pet does to a track, guessed from its title, artists and album.
const REACTIONS: [RegExp, number, string][] = [
  [/hardstyle|hardcore|rawstyle|frenchcore|uptempo|gunz for hire|kick/i, 1, 'headbanging'],
  [/dubstep|drum ?(and|&|n) ?bass|dnb|neurofunk|riddim|bass/i, 0.9, 'skanking'],
  [/techno|trance|house|edm|rave|festival|hardwell|tiësto|tiesto/i, 0.75, 'bouncing'],
  [/remix|radio edit|extended mix|club mix|bootleg|mashup/i, 0.7, 'dancing'],
  [/rap|hip ?hop|trap|drill|freestyle/i, 0.6, 'nodding along'],
  [/chill|lo-?fi|acoustic|piano|ambient|sleep|ballad|unplugged|slow|nocturne|lullaby/i, 0.2, 'napping'],
]

// ---------------------------------------------------------------- helpers --

function textOf(res: McpToolResult): string {
  return res.content
    .map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
}

function jsonOf(res: McpToolResult): unknown {
  if (res.structuredContent !== undefined) return res.structuredContent
  for (const block of res.content) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    try {
      return JSON.parse(block.text)
    } catch {
      // not JSON: fall through to the next block
    }
  }
  return null
}

function parse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function str(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 ? x : null
}

function num(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

function names(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  return x.map(one => (isRecord(one) ? str(one.name) : null)).filter((n): n is string => n !== null)
}

function react(track: Track & { album: string | null }): { energy: number; reaction: string } {
  const text = `${track.name} ${track.artists.join(' ')} ${track.album ?? ''}`
  for (const [pattern, energy, reaction] of REACTIONS) {
    if (pattern.test(text)) return { energy, reaction }
  }
  return { energy: 0.5, reaction: 'vibing' }
}

/** hh:mm, with the date in front when it is not today. */
function clock(at: number, now: number): string {
  const d = new Date(at)
  const n = new Date(now)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return sameDay ? hhmm : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hhmm}`
}

function fit(text: string, width: number): string {
  if (width <= 1) return ''
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…'
}

function shortCwd(cwd: string): string {
  return cwd.replace(/^\/home\/[^/]+/, '~')
}

/** Where the needle is now: the polled position plus the time since, while playing. */
function positionOf(np: NowPlaying, now: number): number | null {
  if (np.progressMs === null) return null
  const pos = np.isPlaying ? np.progressMs + (now - np.fetchedAt) : np.progressMs
  return np.durationMs !== null ? Math.min(np.durationMs, Math.max(0, pos)) : Math.max(0, pos)
}

// ------------------------------------------------------------- module state --

// Module variables start over on a reload; everything drawn lives in atoms.
let cwd = '/'
let home = ''
let sessionStartedAt = 0
let draftNote = ''
let draftVibe = ''
// Your own Spotify app's tokens, read from the auth file; null without one.
type Auth = { clientId: string; accessToken: string; refreshToken: string | null; expiresAt: number }
let auth: Auth | null = null
let authCheckedAt = 0
let backoffUntil = 0
let pollTimer: { cancel: () => void } | null = null
let polling = false
/** A poll's position that did not redraw the pane: the strip reads it between redraws. */
let latestProgress: { progressMs: number | null; fetchedAt: number } | null = null
/** A volume press not yet confirmed by a poll, so a poll in flight does not undo it. */
let volumePending: number | null = null
// The strip's own frame state, never drawn from a render pass.
let frame = 0
let eqSkip = 0
let eqColumns = 0
let eqHeights: number[] = []
let eqDensity = DENSITY_DEFAULT
let eqPalette: Palette = 'rainbow'
let eqView: EqView = 'bars'
let eqModeNow: 'live' | 'guess' = 'guess'
let slices: number[][] = [] // newest first, each `sliceWidth(eqColumns)` heights, for the 3D and ridge views
// The live spectrum from tools/eq-capture.py on the Windows side: the last
// line's band levels (0..1), how many ticks ago it came, and why it is absent.
let liveBands: number[] | null = null
let liveAge = LIVE_STALE_TICKS
let liveNote: string | null = null
let captureStarts = 0
let captureStop = false
let helperStatus: 'starting' | 'running' | 'stopped' = 'stopped'
let helperLines = 0
let helperErrors = 0
let helperRate = 0
let helperRateAt = 0
let musicLast = ''
// Buddy's pet, as last read; the pane draws it and it dances on the beat.
let petView: PetView | null = null
let petName: string | null = null
let petSeen = 0
let petBeatDrawn: number | null = null
// The session as the agent runs it: failing calls, every call's duration, and the files it edited.
let errorsAt: number[] = []
let callLog: { at: number; ms: number }[] = []
const edits = new Map<string, { plus: number; minus: number; at: number }>()
let hasDiffCommand = false
let telemetryLast = ''
let timersStarted = false

/** Puts a line under the pane for eight seconds; null clears it. */
async function say($: $, text: string | null) {
  await update($, status, () => text)
  if (text !== null) {
    $.clock.after(8000, () => {
      void read($, status).then(current => {
        if (current === text) void update($, status, () => null)
      })
    })
  }
}

// -- your own spotify app -----------------------------------------------------

const authPath = () => `${home}/${AUTH_FILE}`

/** Reads the auth file the sign-in script wrote; null when absent or unreadable. */
async function loadAuth($: $, now: number, force = false): Promise<Auth | null> {
  if (!force && auth !== null && now - authCheckedAt < AUTH_RECHECK_MS) return auth
  authCheckedAt = now
  if (!home) return null
  let text: string
  try {
    text = await $.fs.read(authPath())
  } catch {
    if (auth !== null) {
      auth = null
      await update($, hasApi, () => false)
    }
    return null
  }
  const data = parse(text)
  if (!isRecord(data)) return null
  const clientId = str(data.client_id)
  const accessToken = str(data.access_token)
  if (!clientId || !accessToken) return null
  const next: Auth = { clientId, accessToken, refreshToken: str(data.refresh_token), expiresAt: num(data.expires_at) ?? 0 }
  if (auth === null || auth.accessToken !== next.accessToken) {
    auth = next
    await update($, hasApi, () => true)
  }
  return auth
}

/** Trades the refresh token for a new access token and writes the file back. */
async function refreshAuth($: $, now: number): Promise<Auth | null> {
  if (auth === null || auth.refreshToken === null) return null
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    client_id: auth.clientId,
  }).toString()
  let res
  try {
    res = await $.http.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  } catch {
    return null
  }
  const data = parse(res.text)
  if (!res.ok || !isRecord(data) || !str(data.access_token)) {
    const why = isRecord(data) ? str(data.error_description) ?? str(data.error) : null
    await say($, `Spotify sign-in expired${why ? ` (${why})` : ''}: run tools/spotify-login.py again.`)
    return null
  }
  const next: Auth = {
    clientId: auth.clientId,
    accessToken: String(data.access_token),
    refreshToken: str(data.refresh_token) ?? auth.refreshToken,
    expiresAt: now + (num(data.expires_in) ?? 3600) * 1000,
  }
  auth = next
  try {
    await $.fs.write(
      authPath(),
      JSON.stringify({ client_id: next.clientId, access_token: next.accessToken, refresh_token: next.refreshToken, expires_at: next.expiresAt }, null, 2),
    )
  } catch {
    // keeps working in memory until the next reload
  }
  return next
}

/**
 * A token about to expire: another session may have refreshed it already (the
 * refresh token rotates, so a second refresh would fail), so the file is read
 * again first and refreshed only when it is still stale.
 */
async function freshAuth($: $, now: number): Promise<Auth | null> {
  const onDisk = await loadAuth($, now, true)
  if (onDisk !== null && onDisk.expiresAt - 60_000 >= now) return onDisk
  return refreshAuth($, now)
}

type ApiResult = { status: number; ok: boolean; data: unknown; text: string }

/** One Web API call with the current token, refreshed once when it is stale or refused. */
async function api($: $, method: string, path: string, body?: unknown): Promise<ApiResult | null> {
  const now = await $.clock.now()
  if (now < backoffUntil) return null
  let current = await loadAuth($, now)
  if (current === null) return null
  if (current.expiresAt - 60_000 < now) current = (await freshAuth($, now)) ?? current
  const call = async (token: string) => {
    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method,
      headers: { Authorization: `Bearer ${token}` },
    }
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    return $.http.fetch(`${API}${path}`, init)
  }
  let res
  try {
    res = await call(current.accessToken)
    if (res.status === 401) {
      const fresh = await freshAuth($, now)
      if (fresh !== null) res = await call(fresh.accessToken)
    }
  } catch (err) {
    await say($, `Spotify unreachable: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
  if (res.status === 429) {
    const wait = (num(res.headers['retry-after']) ?? 5) * 1000
    backoffUntil = now + wait
  }
  return { status: res.status, ok: res.ok, data: parse(res.text), text: res.text }
}

const apiReason = (res: ApiResult | null): string => {
  if (res === null) return 'no answer'
  const error = isRecord(res.data) && isRecord(res.data.error) ? res.data.error : null
  return (error && (str(error.reason) ?? str(error.message))) ?? `HTTP ${res.status}`
}

// -- opening and playing ------------------------------------------------------

/** Opens a Spotify URI in the Spotify app: PowerShell on WSL, else the desktop's opener. */
async function openUri($: $, uri: string): Promise<boolean> {
  if (!SPOTIFY_URI.test(uri)) return false
  const attempts: string[][] = [
    ['powershell.exe', '-NoProfile', '-Command', `Start-Process '${uri}'`],
    ['xdg-open', uri],
    ['open', uri],
  ]
  for (const argv of attempts) {
    try {
      const ran = await $.process.run(argv, { timeoutMs: 15_000 })
      if (ran.exitCode === 0) return true
    } catch {
      // the opener is not on this machine: try the next
    }
  }
  return false
}

/** The device to play on: the active one, else the first listed; null without any. */
async function pickDevice($: $): Promise<string | null> {
  const res = await api($, 'GET', '/me/player/devices')
  const list = res && isRecord(res.data) && Array.isArray(res.data.devices) ? res.data.devices : []
  const devices = list.filter(isRecord)
  const active = devices.find(one => one.is_active === true) ?? devices[0]
  return active ? str(active.id) : null
}

/**
 * Starts a playlist (or album, or track) playing. Through your own app where
 * signed in and allowed; else the Spotify app is opened on it for you to press play.
 */
async function playContext($: $, uri: string, label: string): Promise<string> {
  if (!SPOTIFY_URI.test(uri)) return `Not a Spotify link: ${label}`
  await say($, `Starting ${label}…`)
  if (auth !== null || (await loadAuth($, await $.clock.now())) !== null) {
    const body = uri.startsWith('spotify:track:') || uri.startsWith('spotify:episode:') ? { uris: [uri] } : { context_uri: uri }
    let res = await api($, 'PUT', '/me/player/play', body)
    if (res && res.status === 404) {
      // No active device: aim at one.
      const device = await pickDevice($)
      if (device) res = await api($, 'PUT', `/me/player/play?device_id=${encodeURIComponent(device)}`, body)
    }
    if (res && res.ok) {
      await say($, `Playing ${label}.`)
      $.clock.after(1200, () => void pollNow($))
      return `Playing ${label} on Spotify.`
    }
    const reason = apiReason(res)
    if (reason === 'PREMIUM_REQUIRED') {
      const opened = await openUri($, uri)
      await say($, opened ? `${label} is open in Spotify (starting it needs Premium). Hit play.` : `Could not open ${label}.`)
      return opened ? `Opened ${label} in Spotify; starting playback needs Spotify Premium, so hit play.` : `Could not open Spotify for ${label}.`
    }
    if (reason === 'NO_ACTIVE_DEVICE' || (res && res.status === 404)) {
      const opened = await openUri($, uri)
      await say($, opened ? `No Spotify device was active; opened ${label}. Hit play.` : `No active Spotify device.`)
      return opened ? `No Spotify device was active, so ${label} is opened in the app. Hit play once and the pane can control it from then on.` : 'No active Spotify device, and the app could not be opened.'
    }
    await say($, `Spotify refused: ${reason}`)
    return `Spotify refused to play ${label}: ${reason}`
  }
  const opened = await openUri($, uri)
  await say($, opened ? `${label} is open in Spotify. Hit play.` : `Could not open Spotify for ${label}.`)
  return opened ? `Opened ${label} in Spotify. Hit play.` : `Could not open Spotify for ${label}.`
}

async function control($: $, action: 'play' | 'pause' | 'next' | 'previous') {
  const method = action === 'next' || action === 'previous' ? 'POST' : 'PUT'
  const res = await api($, method, `/me/player/${action}`)
  if (res && res.ok) {
    $.clock.after(700, () => void pollNow($))
    return
  }
  const reason = apiReason(res)
  await say($, reason === 'PREMIUM_REQUIRED' ? 'Controlling playback needs Spotify Premium.' : reason === 'no answer' ? 'Not signed in: run tools/spotify-login.py.' : `Spotify refused: ${reason}`)
}

/** Sets the active device's volume (Premium); the pane shows the new level at once and the next poll confirms it. */
async function setVolume($: $, percent: number) {
  const level = Math.max(0, Math.min(100, Math.round(percent)))
  volumePending = level
  const np = await read($, nowPlaying)
  if (np !== null && np.volume !== level) await update($, nowPlaying, () => ({ ...np, volume: level }))
  const res = await api($, 'PUT', `/me/player/volume?volume_percent=${level}`)
  if (volumePending !== level) return // a newer press is on its way
  volumePending = null
  if (res && res.ok) return
  const reason = apiReason(res)
  await say($, reason === 'PREMIUM_REQUIRED' ? 'Changing volume needs Spotify Premium.' : reason === 'no answer' ? 'Not signed in: run tools/spotify-login.py.' : `Spotify refused the volume: ${reason}`)
}

// -- now playing ----------------------------------------------------------------

async function closePlayed($: $, at: number) {
  await update($, played, list =>
    list.map((one, i) => (i === list.length - 1 && one.endedAt === null ? { ...one, endedAt: at } : one)),
  )
}

/** Takes a poll's answer: logs track changes, redraws the pane when something it shows changed. */
async function publish($: $, next: NowPlaying | null, now: number) {
  const prev = await read($, nowPlaying)
  if (next === null) {
    if (prev !== null) {
      await closePlayed($, now)
      await update($, nowPlaying, () => null)
    }
    return
  }
  if (prev === null || prev.uri !== next.uri) {
    await closePlayed($, now)
    const row: Played = { uri: next.uri, name: next.name, artists: next.artists, startedAt: now, endedAt: null }
    await update($, played, list => [...list, row].slice(-300))
    await update($, nowPlaying, () => next)
    return
  }
  // Same track: redraw for a play/pause flip, a device, context or volume change,
  // or a seek; a plain position tick goes to the strip alone, which interpolates.
  const changed = prev.isPlaying !== next.isPlaying || prev.device !== next.device || prev.source !== next.source || prev.contextUri !== next.contextUri || prev.volume !== next.volume
  const prevPos = positionOf(prev, now)
  const drifted = prevPos !== null && next.progressMs !== null && Math.abs(prevPos - next.progressMs) > 3000
  if (changed || drifted || !prev.isPlaying) await update($, nowPlaying, () => ({ ...next, since: prev.since }))
  else latestProgress = { progressMs: next.progressMs, fetchedAt: next.fetchedAt }
}

async function pollApi($: $, now: number): Promise<boolean> {
  const res = await api($, 'GET', '/me/player?additional_types=track,episode')
  if (res === null) return false
  if (res.status === 204 || (res.ok && !isRecord(res.data))) {
    await publish($, null, now)
    return true
  }
  if (!res.ok) {
    if (res.status !== 429) await say($, `Spotify player: ${apiReason(res)}`)
    return true
  }
  const data = res.data as Record<string, unknown>
  const item = isRecord(data.item) ? data.item : null
  const uri = item ? str(item.uri) : null
  const name = item ? str(item.name) : null
  if (item === null || !uri || !name) {
    await publish($, null, now)
    return true
  }
  const isEpisode = item.type === 'episode'
  const album = isEpisode ? (isRecord(item.show) ? str(item.show.name) : null) : isRecord(item.album) ? str(item.album.name) : null
  const track = { uri, name, artists: isEpisode ? [album ?? 'podcast'] : names(item.artists), album }
  const device = isRecord(data.device) ? data.device : null
  const prev = await read($, nowPlaying)
  const next: NowPlaying = {
    ...track,
    url: isRecord(item.external_urls) ? str(item.external_urls.spotify) : null,
    durationMs: num(item.duration_ms),
    since: prev && prev.uri === uri ? prev.since : now,
    isPlaying: data.is_playing === true,
    progressMs: num(data.progress_ms),
    fetchedAt: now,
    device: device ? str(device.name) : null,
    volume: volumePending ?? (device ? num(device.volume_percent) : null),
    contextUri: isRecord(data.context) ? str(data.context.uri) : null,
    source: 'api',
    ...react(track),
  }
  await publish($, next, now)
  return true
}

async function pollConnector($: $, now: number) {
  let res: McpToolResult
  try {
    res = await $.mcp.call(SERVER, 'get_currently_playing', {})
  } catch (err) {
    await say($, `Spotify unreachable: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  const data = jsonOf(res)
  const entity = isRecord(data) && isRecord(data.currently_playing_entity) ? data.currently_playing_entity : null
  const uri = entity ? str(entity.uri) : null
  const name = entity ? str(entity.name) : null
  if (res.isError || !entity || !uri || !name) {
    await publish($, null, now)
    if (res.isError) await say($, fit(textOf(res) || 'Spotify returned an error', 70))
    return
  }
  const prev = await read($, nowPlaying)
  const playback = isRecord(entity.playback) ? entity.playback : null
  const durationMs = playback ? num(playback.duration_ms) : null
  const since = prev && prev.uri === uri ? prev.since : now
  // The connector says nothing about pausing: past the track's length and still on it, assume paused.
  const isStale = durationMs !== null && now - since > durationMs + 45_000
  const track = { uri, name, artists: names(entity.creators), album: isRecord(entity.parent) ? str(entity.parent.name) : null }
  const next: NowPlaying = {
    ...track,
    url: str(entity.url),
    durationMs,
    since,
    isPlaying: !isStale,
    progressMs: null,
    fetchedAt: now,
    device: null,
    volume: null,
    contextUri: null,
    source: 'connector',
    ...react(track),
  }
  await publish($, next, now)
}

/** One poll: your own app when signed in, else the connector; then the next is scheduled. */
async function pollNow($: $) {
  if (polling) return
  polling = true
  try {
    const now = await $.clock.now()
    const viaApi = (await loadAuth($, now)) !== null && (await pollApi($, now))
    if (!viaApi) await pollConnector($, now)
    schedulePoll($)
  } finally {
    polling = false
  }
}

/** Polls fast with your own app, slowly through the connector. */
function schedulePoll($: $) {
  const ms = auth !== null ? POLL_API_MS : POLL_CONNECTOR_MS
  if (pollTimer !== null) pollTimer.cancel()
  pollTimer = $.clock.after(ms, () => void pollNow($))
}

// -- playlists ------------------------------------------------------------------

async function fetchPlaylistsApi($: $): Promise<Playlist[] | null> {
  const list: Playlist[] = []
  let path: string | null = '/me/playlists?limit=50'
  for (let page = 0; page < 6 && path !== null; page++) {
    const res: ApiResult | null = await api($, 'GET', path)
    if (res === null || !res.ok || !isRecord(res.data)) return list.length ? list : null
    const items = Array.isArray(res.data.items) ? res.data.items : []
    for (const one of items) {
      if (!isRecord(one)) continue
      const uri = str(one.uri)
      const name = str(one.name)
      if (!uri || !name) continue
      list.push({
        uri,
        name,
        owner: isRecord(one.owner) ? str(one.owner.display_name) ?? '' : '',
        url: isRecord(one.external_urls) ? str(one.external_urls.spotify) : null,
      })
    }
    const next = str(res.data.next)
    path = next && next.startsWith(API) ? next.slice(API.length) : null
  }
  return list
}

async function fetchPlaylistsConnector($: $): Promise<Playlist[] | null> {
  let res: McpToolResult
  try {
    res = await $.mcp.call(SERVER, 'search', { prompt: 'my playlists', language: LANGUAGE, limit: 20 })
  } catch (err) {
    await say($, `Could not load playlists: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
  const data = jsonOf(res)
  const entities = isRecord(data) && Array.isArray(data.entities) ? data.entities : []
  const list: Playlist[] = []
  for (const one of entities) {
    if (!isRecord(one)) continue
    const uri = str(one.uri)
    const name = str(one.name)
    if (!uri || !name || !uri.startsWith('spotify:playlist:')) continue
    list.push({ uri, name, owner: names(one.creators)[0] ?? '', url: str(one.url) })
  }
  if (list.length === 0 && res.isError) await say($, fit(textOf(res) || 'Spotify returned an error', 70))
  return list
}

/** Loads the playlists: from the six-hour cache unless forced, else your own app, else the connector. */
async function refreshPlaylists($: $, force: boolean) {
  const now = await $.clock.now()
  const cached = await $.store.get('soundtrack:playlists')
  if (!force && isRecord(cached) && typeof cached.at === 'number' && Array.isArray(cached.list) && now - cached.at < PLAYLIST_CACHE_MS) {
    await update($, playlists, () => cached.list as Playlist[])
    if (cached.list.length > 0) return
  }
  const viaApi = (await loadAuth($, now)) !== null ? await fetchPlaylistsApi($) : null
  const list = viaApi ?? (await fetchPlaylistsConnector($))
  if (list === null || list.length === 0) {
    if (force) await say($, 'Spotify listed no playlists.')
    return
  }
  await $.store.set('soundtrack:playlists', { at: now, list })
  await update($, playlists, () => list)
  if (force) await say($, `${list.length} playlists loaded.`)
}

/** The playlist a typed name means: exact, then prefix, then substring, then every word somewhere. */
const findPlaylist = (list: Playlist[], query: string): Playlist | null => {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const exact = list.find(one => one.name.toLowerCase() === q)
  if (exact) return exact
  const starts = list.find(one => one.name.toLowerCase().startsWith(q))
  if (starts) return starts
  const includes = list.find(one => one.name.toLowerCase().includes(q))
  if (includes) return includes
  const words = q.split(/\s+/)
  return list.find(one => words.every(w => one.name.toLowerCase().includes(w))) ?? null
}

/** Asks the connector for a playlist (the Web API cannot generate), then plays it. */
async function generate($: $, prompt: string, tag: string): Promise<string> {
  await say($, `Asking Spotify: ${prompt.slice(0, 48)}…`)
  let res: McpToolResult
  try {
    res = await $.mcp.call(SERVER, 'generate_playlist', { prompt, language: LANGUAGE })
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    await say($, `Spotify unreachable: ${why}`)
    return `Spotify could not be reached: ${why}`
  }
  const text = textOf(res)
  if (res.isError || /NOT_SUBSCRIBED|PREMIUM_REQUIRED/.test(text)) {
    const why = /NOT_SUBSCRIBED|PREMIUM_REQUIRED/.test(text) ? 'generating playlists needs Spotify Premium' : fit(text, 200)
    await say($, `No playlist: ${why}`)
    return `Spotify made no playlist: ${why}`
  }
  const uri = text.match(/spotify:playlist:[A-Za-z0-9]+/)?.[0] ?? null
  const url = text.match(/https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]+[^\s"'<>]*/)?.[0] ?? null
  const data = jsonOf(res)
  const name = (isRecord(data) && (str(data.name) ?? (isRecord(data.playlist) ? str(data.playlist.name) : null))) || tag
  if (!uri) {
    await say($, 'Spotify answered without a playlist link.')
    return `Spotify answered, but without a playlist link:\n${fit(text, 600)}`
  }
  const made = await $.store.get('soundtrack:generated')
  const generated = Array.isArray(made) ? made.filter((x): x is string => typeof x === 'string') : []
  await $.store.set('soundtrack:generated', [...generated.filter(x => x !== uri), uri].slice(-50))
  const outcome = await playContext($, uri, name)
  void refreshPlaylists($, true)
  return url ? `${outcome}\n${url}` : outcome
}

/** Removes every playlist `generate` made from the library. */
async function cleanGenerated($: $): Promise<string> {
  const made = await $.store.get('soundtrack:generated')
  const generated = Array.isArray(made) ? made.filter((x): x is string => typeof x === 'string') : []
  if (generated.length === 0) return 'No vibe-generated playlists to remove.'
  let removed = 0
  const kept: string[] = []
  for (const uri of generated) {
    try {
      const res = await $.mcp.call(SERVER, 'remove_from_library', { uri })
      if (res.isError) kept.push(uri)
      else removed += 1
    } catch {
      kept.push(uri)
    }
  }
  await $.store.set('soundtrack:generated', kept)
  await say($, `Removed ${removed} generated playlist${removed === 1 ? '' : 's'}.`)
  void refreshPlaylists($, true)
  return kept.length === 0
    ? `Removed ${removed} vibe-generated playlist${removed === 1 ? '' : 's'} from your library.`
    : `Removed ${removed}; ${kept.length} could not be removed and stay listed.`
}

// -- notes ----------------------------------------------------------------------

/**
 * Writes the notes, merged with what another session may have written since:
 * union by id, ordered by time; a note removed here stays removed.
 */
async function saveNotes($: $, list: Note[], removed: readonly string[] = []) {
  const stored = await $.store.get('soundtrack:notes')
  const known = new Map<string, Note>()
  if (Array.isArray(stored)) for (const one of stored as Note[]) if (one && typeof one.id === 'string' && !removed.includes(one.id)) known.set(one.id, one)
  for (const one of list) known.set(one.id, one)
  const merged = [...known.values()].sort((a, b) => a.at - b.at).slice(-2000)
  await $.store.set('soundtrack:notes', merged)
  await update($, notes, () => merged)
}

async function addNote($: $, text: string): Promise<Note | null> {
  const body = text.trim()
  if (!body) return null
  const now = await $.clock.now()
  const np = await read($, nowPlaying)
  const note: Note = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: now,
    text: body,
    cwd,
    track: np && np.isPlaying ? { uri: np.uri, name: np.name, artists: np.artists } : null,
  }
  const list = await read($, notes)
  await saveNotes($, [...list, note].slice(-2000))
  return note
}

async function removeNotes($: $, ids: readonly string[]): Promise<number> {
  const list = await read($, notes)
  const kept = list.filter(one => !ids.includes(one.id))
  if (kept.length !== list.length) await saveNotes($, kept, ids)
  return list.length - kept.length
}

const visibleNotes = (list: Note[], scope: NotesScope) => (scope === 'global' ? list : list.filter(one => one.cwd === cwd))

const notesAsText = (list: Note[], now: number, firstNumber = 1): string =>
  list
    .map((one, i) => {
      const track = one.track ? `  ♪ ${one.track.name}${one.track.artists[0] ? ` · ${one.track.artists[0]}` : ''}` : ''
      return `${String(firstNumber + i).padStart(3)}. ${clock(one.at, now)}  ${one.text}${track}`
    })
    .join('\n')

// -- soundtrack log -------------------------------------------------------------

/** The tracks that played during the longest stretch without a tool error. */
const flowTracks = (list: Played[], now: number): { tracks: Played[]; from: number; to: number } => {
  const bounds = [sessionStartedAt, ...errorsAt, now].sort((a, b) => a - b)
  let best = { from: sessionStartedAt, to: now }
  for (let i = 1; i < bounds.length; i++) {
    const from = bounds[i - 1] ?? sessionStartedAt
    const to = bounds[i] ?? now
    if (to - from > best.to - best.from) best = { from, to }
  }
  const tracks = list.filter(one => one.startedAt <= best.to && (one.endedAt ?? now) >= best.from)
  return { tracks, ...best }
}

// -- live spectrum --------------------------------------------------------------

/** Parses one helper line: an eight-digit hex stamp then two hex digits per band, or a `#` note. */
const takeLine = (line: string) => {
  const text = line.trim()
  if (!text) return
  if (text.startsWith('#')) {
    liveNote = text.slice(1).trim()
    return
  }
  if (text.length !== 8 + EQ_BANDS * 2 || !/^[0-9a-f]+$/.test(text)) return
  helperLines += 1
  const stamp = parseInt(text.slice(0, 8), 16)
  syncClock(stamp, Date.now())
  const bands: number[] = []
  for (let i = 8; i < text.length; i += 2) bands.push(parseInt(text.slice(i, i + 2), 16) / 255)
  liveBands = bands
  liveAge = 0
  hearBass(bands, stamp)
}

/** Publishes what the strip hears, for buddy and anyone else; written only when it changed. */
async function publishMusic($: $) {
  const np = await read($, nowPlaying)
  const live = liveBands !== null && liveAge < LIVE_STALE_TICKS
  const bpm = updateTempo(live)
  const bass = bassLevels()
  const next: Music = {
    isPlaying: np !== null && np.isPlaying,
    track: np ? np.name : null,
    artists: np ? np.artists : [],
    energy: np ? np.energy : 0,
    reaction: np ? np.reaction : null,
    isLive: live,
    bassNow: live ? Math.round(bass.short * 100) / 100 : 0,
    bass10m: live ? Math.round(bass.long * 100) / 100 : 0,
    bpm: np && np.isPlaying ? bpm : null,
    beatMs: np && np.isPlaying && bpm ? Math.round(60_000 / bpm) : null,
  }
  const key = JSON.stringify(next)
  if (key === musicLast) return
  musicLast = key
  await update($, music, () => next)
}

/**
 * Runs the Windows-side capture helper for the session's life and feeds its
 * lines to the strip. Without Windows Python, or off WSL, the strip keeps the
 * animation and says so.
 */
async function runCapture($: $) {
  if (captureStarts >= 3) return
  captureStarts += 1
  captureStop = false
  helperStatus = 'starting'
  let script = `${$.plugin.root}/tools/eq-capture.py`
  try {
    const converted = await $.process.run(['wslpath', '-w', script], { timeoutMs: 10_000 })
    if (converted.exitCode === 0 && converted.stdout.trim()) script = converted.stdout.trim()
  } catch {
    // not WSL: python.exe will not be there either, and the spawn below says so
  }
  let buffer = ''
  try {
    const child = $.process.spawn({ argv: ['python.exe', script, String(EQ_BANDS)], cwd: '/mnt/c' })
    for await (const piece of child) {
      if (captureStop) break // leaving the loop ends the child
      if (piece.stream === 'stderr') {
        for (const line of piece.text.split(/\r?\n/)) {
          if (!line.trim()) continue
          if (/^# capturing/.test(line)) helperStatus = 'running'
          else helperErrors += 1
          takeLine(line.startsWith('#') ? line : `# ${line}`)
        }
        continue
      }
      helperStatus = 'running'
      buffer += piece.text
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const one of lines) takeLine(one) // every line: the kicks live in the timing
    }
    liveNote = captureStop ? 'capture helper restarting' : 'capture helper exited'
  } catch (err) {
    helperErrors += 1
    liveNote = `capture unavailable: ${err instanceof Error ? err.message : String(err)}`
  }
  helperStatus = 'stopped'
  liveBands = null
  liveAge = LIVE_STALE_TICKS
  if (captureStop) {
    // Asked for from the pane: start again at once, with a fresh allowance.
    captureStarts = 0
    void runCapture($)
    return
  }
  // A helper that died (device change, sleep) is started again after a while.
  $.clock.after(10_000, () => void runCapture($))
}

/** The restart button: ends the running helper, whose loop then starts a new one; or starts one when none runs. */
function restartCapture($: $) {
  helperErrors = 0
  if (helperStatus === 'stopped') {
    captureStarts = 0
    void runCapture($)
  } else {
    captureStop = true
  }
}

// -- session telemetry ------------------------------------------------------------

const lineCount = (text: string): number => (text.length === 0 ? 0 : text.split('\n').length)

const shortPath = (path: string): string => {
  const rel = path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : shortCwd(path)
  return rel.length <= 34 ? rel : '…' + rel.slice(-33)
}

const LIMIT_ORDER: Record<string, number> = { five_hour: 0, seven_day: 1 }

/** The engine's rate-limit windows in the pane's shape, five-hour first, each reset parsed to a clock time. */
function usageLimits(windows: { kind: string; percentUsed: number; resetsAt?: string }[]): UsageLimit[] {
  return windows
    .map(one => {
      const at = one.resetsAt ? Date.parse(one.resetsAt) : NaN
      return { kind: one.kind, percentUsed: Math.round(one.percentUsed * 10) / 10, resetsAt: Number.isFinite(at) ? at : null }
    })
    .sort((a, b) => (LIMIT_ORDER[a.kind] ?? 9) - (LIMIT_ORDER[b.kind] ?? 9))
}

/** `5h`, `7d`, `spend`, else the engine's own word. */
function limitLabel(kind: string): string {
  return kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind === 'spend_limit' ? 'spend' : kind.replace(/_/g, ' ')
}

/** How long until a reset: `45m`, `2h05m`, `3d 4h`; `now` once it has passed. */
function untilText(at: number, now: number): string {
  const left = at - now
  if (left <= 0) return 'now'
  const minutes = Math.ceil(left / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h${String(mins).padStart(2, '0')}m`
  return `${mins}m`
}

/** One line per window: `5h 42% · resets in 2h10m` for the command, `5h 42% (2h10m)` for the pane's one row. */
function limitsText(limits: UsageLimit[], now: number, compact = false): string[] {
  return limits.map(one => {
    const left = one.resetsAt !== null ? untilText(one.resetsAt, now) : null
    return `${limitLabel(one.kind)} ${one.percentUsed}%${left === null ? '' : compact ? ` (${left})` : ` · resets in ${left}`}`
  })
}

// -- tokens per model, summed from every model request's reported usage ---------------

const tokensByModel = new Map<string, ModelTokens>()
let tokensAdopted = false

/** Adds one request's usage to its model's tally. */
function tallyTokens(usage: { model: string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }) {
  const had = tokensByModel.get(usage.model) ?? { model: usage.model, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  tokensByModel.set(usage.model, {
    model: usage.model,
    requests: had.requests + 1,
    input: had.input + (usage.input_tokens || 0),
    output: had.output + (usage.output_tokens || 0),
    cacheRead: had.cacheRead + (usage.cache_read_input_tokens || 0),
    cacheWrite: had.cacheWrite + (usage.cache_creation_input_tokens || 0),
  })
}

/** A hot reload empties the module's tally: the first refresh after one takes the state's figures back. */
async function adoptTokens($: $) {
  if (tokensAdopted) return
  tokensAdopted = true
  if (tokensByModel.size > 0) return
  const old = await read($, telemetry)
  for (const one of old?.models ?? []) tokensByModel.set(one.model, { ...one })
}

/** `claude-fable-5-1` as `fable 5.1`; an id of another shape as itself. */
function shortModel(id: string): string {
  const m = /^(?:[a-z]{2}\.)?(?:anthropic\.)?claude-([a-z]+)-(\d+)-(\d+)/i.exec(id)
  return m ? `${m[1]!.toLowerCase()} ${m[2]}.${m[3]}` : id.replace(/^claude-/, '')
}

/** 950, 9.5k, 95k, 1.2M. */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** One line per model: compact for the pane, spelled out for the command. */
function modelsText(models: ModelTokens[], compact: boolean): string[] {
  return models.map(one =>
    compact
      ? `${shortModel(one.model)} ×${one.requests} · in ${fmtTokens(one.input + one.cacheWrite)} out ${fmtTokens(one.output)} cached ${fmtTokens(one.cacheRead)}`
      : `${shortModel(one.model)} (${one.model}): ${one.requests} request${one.requests === 1 ? '' : 's'}, ${one.input.toLocaleString('en-US')} input, ${one.output.toLocaleString('en-US')} output, ${one.cacheRead.toLocaleString('en-US')} cache read, ${one.cacheWrite.toLocaleString('en-US')} cache write`,
  )
}

const LIMIT_WARN_AT = 90
const warnedLimits = new Set<string>()

/** Toasts once per window as it crosses 90 %, and forgets the warning once it drops back under. */
function warnPastLimits($: $, limits: UsageLimit[], now: number) {
  for (const one of limits) {
    if (one.percentUsed >= LIMIT_WARN_AT) {
      if (warnedLimits.has(one.kind)) continue
      warnedLimits.add(one.kind)
      $.ui.toast(`${limitLabel(one.kind) === '5h' ? 'Five-hour' : limitLabel(one.kind) === '7d' ? 'Weekly' : limitLabel(one.kind)} limit at ${Math.round(one.percentUsed)}%${one.resetsAt !== null ? `, resets in ${untilText(one.resetsAt, now)}` : ''}`)
    } else warnedLimits.delete(one.kind)
  }
}

/** Reads the engine's figures and the hooks' tallies into one value the pane draws; writes it only when it changed. */
async function refreshTelemetry($: $) {
  const now = await $.clock.now()
  let contextPct: number | null = null
  let costUsd: number | null = null
  let limits: UsageLimit[] = []
  await adoptTokens($)
  try {
    const usage = await $.session.usage()
    const pct = usage.context.percent
    contextPct = typeof pct === 'number' ? pct : usage.context.window > 0 && typeof usage.context.tokens === 'number' ? (usage.context.tokens / usage.context.window) * 100 : null
    costUsd = usage.cost ? usage.cost.usd : null
    limits = usageLimits(usage.rateLimits)
  } catch {
    // headless or an older engine: the row shows what the hooks saw
  }
  callLog = callLog.filter(one => now - one.at < 10 * 60_000)
  const spark: number[] = []
  for (let m = 5; m >= 0; m--) spark.push(callLog.filter(one => now - one.at >= m * 60_000 && now - one.at < (m + 1) * 60_000).length)
  const recent = callLog.slice(-20).map(one => one.ms).sort((a, b) => a - b)
  const latencyMs = recent.length ? (recent[Math.floor(recent.length / 2)] ?? null) : null
  const files = [...edits.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 4)
    .map(([path, d]) => ({ path: shortPath(path), plus: d.plus, minus: d.minus }))
  if (now - helperRateAt >= 1000) {
    helperRate = Math.round((helperLines * 1000) / Math.max(1, now - helperRateAt))
    helperLines = 0
    helperRateAt = now
  }
  const next: Telemetry = {
    contextPct,
    costUsd,
    callsPerMin: spark[spark.length - 1] ?? 0,
    spark,
    latencyMs,
    files,
    filesTotal: edits.size,
    helper: { rate: helperStatus === 'running' ? helperRate : 0, errors: helperErrors, status: helperStatus },
    hasDiff: hasDiffCommand,
    limits,
    models: [...tokensByModel.values()].sort((a, b) => b.requests - a.requests),
  }
  const key = JSON.stringify(next)
  if (key === telemetryLast) return
  telemetryLast = key
  await update($, telemetry, () => next)
}

// -- the pet --------------------------------------------------------------------

/** Reads the buddy mod's pet on duty; absent, or refused when buddy is not loaded, is no pet. */
async function readPet($: $) {
  try {
    const held = await $.state.get({ plugin: 'buddy', key: 'view' })
    const view = held.value
    petView = view && typeof view === 'object' ? (view as PetView) : null
    petName = petView && typeof petView.name === 'string' ? petView.name : null
  } catch {
    petView = null
    petName = null
  }
}

// -- the strip ------------------------------------------------------------------

/** One frame: moves the bars towards the live spectrum (or the animation), blits the strip and the pet. */
async function tickEq($: $) {
  if (eqColumns === 0) return
  if (eqSkip > 0) {
    eqSkip -= 1
    return
  }
  frame += 1
  const now = await $.clock.now()
  const np = await read($, nowPlaying)
  const playing = np !== null && np.isPlaying
  const energy = np?.energy ?? 0.5
  const levels = EQ_ROWS * 8
  const bars = barsFor(eqColumns, eqView, eqDensity)
  if (eqHeights.length !== bars) eqHeights = new Array<number>(bars).fill(0)
  liveAge += 1
  const live = liveBands !== null && liveAge < LIVE_STALE_TICKS ? liveBands : null
  const mode = live !== null ? 'live' : 'guess'
  if (mode !== eqModeNow) {
    eqModeNow = mode
    await update($, eqMode, () => mode)
  }
  for (let i = 0; i < bars; i++) {
    let target = 0
    if (live !== null) {
      // The real spectrum: bands spread across the bars, interpolated.
      const x = (i / Math.max(1, bars - 1)) * (live.length - 1)
      const lo = Math.floor(x)
      const hi = Math.min(live.length - 1, lo + 1)
      const level = (live[lo] ?? 0) * (1 - (x - lo)) + (live[hi] ?? 0) * (x - lo)
      target = level * levels
    } else if (playing) {
      // No capture: a slow swell across the bars plus jitter; harder music beats faster.
      const swell = Math.sin(frame * (0.12 + energy * 0.2) + i * 0.7)
      const noise = Math.random() * 0.6 + 0.2
      target = levels * Math.max(0, Math.min(1, (0.15 + energy * 0.55) * noise + (swell + 1) * 0.5 * (0.2 + energy * 0.4)))
    }
    const current = eqHeights[i] ?? 0
    eqHeights[i] = current + (target - current) * (target > current ? (live ? 0.75 : 0.3) : live ? 0.35 : 0.15)
  }
  let progress: Progress | null = null
  if (np !== null && np.durationMs !== null) {
    const fresh = latestProgress && latestProgress.fetchedAt >= np.fetchedAt ? { ...np, ...latestProgress } : np
    const pos = positionOf(fresh, now)
    if (pos !== null) progress = { pos, total: np.durationMs, isPlaying: np.isPlaying }
  }
  const beat = playing && live !== null ? beatNow() : null
  if (eqView !== 'bars' && frame % SLICE_EVERY === 0) {
    slices.unshift(eqHeights.slice(0, sliceWidth(eqColumns)))
    if (slices.length > DEPTH) slices.length = DEPTH
  }
  const sent = await $.ui.blit({ requestId: PANE, key: EQ_KEY, cells: stripCells(eqHeights, eqDensity, eqPalette, eqView, slices, progress, beat), columns: eqColumns, rows: stripRows(eqView) })
  if (sent.deny) {
    eqSkip = 20 // the pane is not showing: look again in about two seconds
    return
  }
  // The pet dances on every beat while one is known; otherwise it fidgets twice a second, as in buddy's own band.
  const petStep = beat !== null ? beat.count : null
  if (petView !== null && (petStep !== petBeatDrawn || (petStep === null && frame % 15 === 0))) {
    petBeatDrawn = petStep
    void $.ui.blit({ requestId: PANE, key: PET_KEY, cells: petCells(petView, Math.floor(frame / 15), petStep, energy), columns: PET_COLUMNS, rows: PET_ROWS })
  }
  // Buddy's view changes without redrawing this pane: look at it every two seconds.
  if (frame - petSeen >= 60) {
    petSeen = frame
    void readPet($)
  }
}

// ------------------------------------------------------------------- hooks --

/**
 * Carries the standalone Soundtrack mod's saved notes and settings over, once:
 * its store file still sits beside this mod's, keyed by its old name. Every key
 * lands under the `soundtrack:` prefix, and nothing already set is overwritten.
 */
async function importOldStore($: $) {
  if ((await $.store.get('soundtrack:imported')) === true || !home) return
  const dir = `${home}/.claude/plugins/store`
  let imported = 0
  try {
    const entries = await $.fs.list(dir)
    for (const entry of entries) {
      if (entry.kind !== 'file' || !/^soundtrack_.*\.json$/.test(entry.name)) continue
      const data = parse(await $.fs.read(`${dir}/${entry.name}`))
      if (!isRecord(data)) continue
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined || (await $.store.get(`soundtrack:${key}`)) !== undefined) continue
        await $.store.set(`soundtrack:${key}`, value)
        imported += 1
      }
    }
  } catch {
    // no old store, or no leave to read it: start fresh
  }
  await $.store.set('soundtrack:imported', true)
  if (imported > 0) await say($, `Carried ${imported} setting${imported === 1 ? '' : 's'} over from the old Soundtrack mod.`)
}

/**
 * Starts the Soundtrack side, from buddy's session start: commands, stored
 * settings, the first poll, the capture helper and the timers.
 */
export async function startSoundtrack($: $, e: SessionStartInput) {
  cwd = e.cwd
  home = (await $.env.get('HOME')) ?? ''
  await importOldStore($)
  sessionStartedAt = await $.clock.now()
  errorsAt = []

  await $.command.register({ name: 'soundtrack', description: 'Open the Soundtrack pane. Also: show|hide playlists|notes|session|usage|all, usage, playlist (from your error-free stretch), eq bars|3d|ridge, colors <palette>, density 1|2, beat [<ms>|prefer <bpm>]' })
  await $.command.register({ name: 'play', description: 'Play one of your Spotify playlists by name, e.g. /play dubstep; alone it resumes' })
  await $.command.register({ name: 'pause', description: 'Pause Spotify' })
  await $.command.register({ name: 'skip', description: 'Skip to the next track on Spotify ("/skip back" goes back)' })
  await $.command.register({ name: 'volume', description: 'Set Spotify volume, e.g. /volume 40, /volume +10, /volume -10' })
  await $.command.register({ name: 'vibe', description: 'Generate a Spotify playlist for a vibe and play it; "/vibe clean" removes generated ones' })
  await $.command.register({ name: 'note', description: 'Add a note to the Soundtrack pane, stamped with the track playing' })
  await $.command.register({ name: 'notes', description: 'List your notes; "/notes global", "/notes rm <n>", "/notes clear yes"' })

  const stored = await $.store.get('soundtrack:notes')
  if (Array.isArray(stored)) await update($, notes, () => stored as Note[])
  const scope = await $.store.get('soundtrack:notesScope')
  if (scope === 'folder' || scope === 'global') await update($, notesScope, () => scope)
  const chosen = await $.store.get('soundtrack:sections')
  if (chosen !== undefined) await update($, sections, () => sectionsFrom(chosen))
  const density = await $.store.get('soundtrack:eqDensity')
  eqDensity = density === 1 || density === 2 ? density : DENSITY_DEFAULT
  const view = await $.store.get('soundtrack:eqView')
  eqView = typeof view === 'string' && (VIEWS as readonly string[]).includes(view) ? (view as EqView) : 'bars'
  const palette = await $.store.get('soundtrack:eqPalette')
  eqPalette = typeof palette === 'string' && (PALETTES as readonly string[]).includes(palette) ? (palette as Palette) : 'rainbow'
  const lead = await $.store.get('soundtrack:beatLeadMs')
  if (typeof lead === 'number') setBeatLead(lead)
  const prefer = await $.store.get('soundtrack:beatPrefer')
  if (typeof prefer === 'number') setTempoPreference(prefer)
  eqModeNow = await read($, eqMode)

  void $.ui.open({ id: PANE, title: 'Soundtrack' }).catch(() => undefined)
  void pollNow($)
    .then(() => refreshPlaylists($, false))
    .catch(() => undefined)
  await readPet($)
  try {
    const commands = await $.command.list()
    hasDiffCommand = commands.some(one => one.name === 'diff')
  } catch {
    hasDiffCommand = false
  }
  helperRateAt = sessionStartedAt
  void runCapture($)
}

/** The strip, telemetry and music timers: started by the pane's first drawing, so a session that never shows it never pays for them. */
function startTimers($: $) {
  if (timersStarted) return
  timersStarted = true
  $.clock.every(TICK_MS, () => void tickEq($))
  $.clock.every(TELEMETRY_MS, () => void refreshTelemetry($))
  $.clock.every(MUSIC_MS, () => void publishMusic($))
}

/**
 * Hears one tool call from buddy's hook: times it for the telemetry, notes a
 * failure for the soundtrack log, and tallies an edit's lines.
 */
export function soundtrackToolCall($: $, e: ToolCallInput, ran: unknown, startedAt: number, endedAt: number) {
  callLog.push({ at: endedAt, ms: endedAt - startedAt })
  if (callLog.length > 2000) callLog = callLog.slice(-1000)
  const failed = isRecord(ran) && ran.isError === true
  if (failed) errorsAt.push(endedAt)
  if (!failed && (e.tool === 'Edit' || e.tool === 'Write')) {
    const path = e.file_path
    const plus = e.tool === 'Edit' ? lineCount(e.new_string) : lineCount(e.content)
    const minus = e.tool === 'Edit' ? lineCount(e.old_string) : 0
    const had = edits.get(path)
    edits.set(path, { plus: (had?.plus ?? 0) + plus, minus: (had?.minus ?? 0) + minus, at: endedAt })
    void refreshTelemetry($)
  }
}

/** The Soundtrack commands and the pane, registered from buddy's `register`. */
export const registerSoundtrack = (on: On) => {
  // The engine pushes a measurement after each turn and when a plan window moves a point: redraw then, not on the next tick.
  // Every model request of the session, main thread and subagents: its reported usage goes on the model's tally.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (r.usage) {
      tallyTokens(r.usage)
      void refreshTelemetry($)
    }
    return r
  })
  on('session.measure', async ($, e, next) => {
    warnPastLimits($, usageLimits(e.rateLimits), await $.clock.now())
    await refreshTelemetry($).catch(() => undefined)
    return next(e)
  })
  on('command.run', { command: 'soundtrack' }, async ($, e) => {
    const now = await $.clock.now()
    const args = e.args.trim()
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
      const tel = await read($, telemetry)
      const lines = tel ? [...limitsText(tel.limits, now), ...modelsText(tel.models, false)] : []
      if (!tel || tel.limits.length === 0) lines.unshift('No plan limits reported yet: the engine learns them from the first API response, and an API key has none.')
      if (tel && tel.models.length === 0) lines.push('No model requests counted yet.')
      return { text: lines.join('\n') }
    }
    if (/^playlist\b/i.test(args)) {
      const list = await read($, played)
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
      eqView = next
      slices = []
      eqHeights = []
      await $.store.set('soundtrack:eqView', eqView)
      $.ui.invalidate('ui.render') // the strip changes height
      return { text: eqView === '3d' ? 'Equaliser: 3D surface, frequency across, time receding, loudness as height and colour.' : eqView === 'ridge' ? 'Equaliser: braille ridgeline, one contour per time slice, nearer ridges in front.' : 'Equaliser: bars.' }
    }
    const colors = args.match(/^colou?rs?\s+(\w+)$/i)
    if (colors) {
      const pick = (colors[1] ?? '').toLowerCase()
      if (!(PALETTES as readonly string[]).includes(pick)) return { text: `Palettes: ${PALETTES.join(', ')}. Example: /soundtrack colors fire` }
      eqPalette = pick as Palette
      await $.store.set('soundtrack:eqPalette', eqPalette)
      return { text: `Equaliser colours: ${eqPalette}.` }
    }
    const density = args.match(/^(?:density|bars)\s+(1|2)$/i)
    if (density) {
      eqDensity = Number(density[1])
      eqHeights = []
      await $.store.set('soundtrack:eqDensity', eqDensity)
      return { text: eqDensity === 2 ? 'Equaliser: two bars per cell (half-row steps).' : 'Equaliser: one bar per cell (eighth-row steps).' }
    }
    if (args) return { text: 'Usage: /soundtrack [playlist | eq bars|3d|ridge | colors <palette> | density 1|2 | beat [<ms> | prefer <bpm>]]' }
    const opened = await $.ui.open({ id: PANE, title: 'Soundtrack' })
    const np = await read($, nowPlaying)
    const list = await read($, played)
    const signedIn = (await loadAuth($, now)) !== null
    const bpm = tempoNow()
    const lines = [
      opened.isPlaced ? 'Soundtrack pane opened.' : `Soundtrack pane waits for a wider terminal (${opened.reason}).`,
      signedIn ? 'Your own Spotify app is signed in: live position and playback control.' : 'Not signed in to your own Spotify app: reading through the connector only. Run tools/spotify-login.py for control.',
      np ? `${np.isPlaying ? 'Playing' : 'Paused'}: ${np.name} · ${np.artists.join(', ')}${np.device ? ` on ${np.device}` : ''}${bpm ? ` · ~${bpm} bpm` : ''}` : 'Spotify reports nothing playing.',
      `${list.length} track${list.length === 1 ? '' : 's'} played this session; "/soundtrack playlist" turns the error-free stretch into one.`,
    ]
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'play' }, async ($, e) => {
    const query = e.args.trim()
    if (!query) {
      await control($, 'play')
      const np = await read($, nowPlaying)
      return { text: np ? `Resuming ${np.name}.` : 'Resuming Spotify.' }
    }
    let list = await read($, playlists)
    if (list.length === 0) {
      await refreshPlaylists($, true)
      list = await read($, playlists)
    }
    if (/^(list|ls)$/i.test(query)) {
      return { text: list.length ? `Your playlists:\n${list.map(one => `- ${one.name}`).join('\n')}` : 'No playlists loaded yet.' }
    }
    const hit = findPlaylist(list, query)
    if (!hit) return { text: `No playlist matches "${query}". "/play list" shows them.` }
    const outcome = await playContext($, hit.uri, hit.name)
    return { text: hit.url ? `${outcome}\n${hit.url}` : outcome }
  })

  on('command.run', { command: 'pause' }, async $ => {
    await control($, 'pause')
    return { text: 'Paused Spotify.' }
  })

  on('command.run', { command: 'skip' }, async ($, e) => {
    const back = /^\s*(back|prev|previous)\b/i.test(e.args)
    await control($, back ? 'previous' : 'next')
    return { text: back ? 'Back a track.' : 'Skipped.' }
  })

  on('command.run', { command: 'volume' }, async ($, e) => {
    const np = await read($, nowPlaying)
    const m = e.args.trim().match(/^([+-])?(\d{1,3})$/)
    if (!m) return { text: np && np.volume !== null ? `Volume: ${np.volume}%. /volume 40, /volume +10, /volume -10` : 'No device volume known. /volume 40 sets it once something plays.' }
    const base = np && np.volume !== null ? np.volume : 50
    const level = m[1] === '+' ? base + Number(m[2]) : m[1] === '-' ? base - Number(m[2]) : Number(m[2])
    await setVolume($, level)
    return { text: `Volume: ${Math.max(0, Math.min(100, Math.round(level)))}%` }
  })

  on('command.run', { command: 'vibe' }, async ($, e) => {
    const args = e.args.trim()
    if (!args) return { text: 'Describe the vibe: /vibe focus deep work, /vibe upbeat friday afternoon. "/vibe clean" removes the playlists this made.' }
    if (/^clean$/i.test(args)) return { text: await cleanGenerated($) }
    return { text: await generate($, `Create a playlist for this vibe: ${args}`, args) }
  })

  on('command.run', { command: 'note' }, async ($, e) => {
    const note = await addNote($, e.args)
    if (!note) return { text: 'Nothing to note. Use /note <text>.' }
    const track = note.track ? ` (♪ ${note.track.name})` : ''
    return { text: `Noted${track}: ${note.text}` }
  })

  on('command.run', { command: 'notes' }, async ($, e) => {
    const now = await $.clock.now()
    const all = await read($, notes)
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    const verb = words[0]?.toLowerCase()
    // The scope: "global" anywhere in the command, else the pane's own toggle.
    const scopeNow: NotesScope = words.some(w => /^(global|all)$/i.test(w)) ? 'global' : await read($, notesScope)
    const isGlobal = scopeNow === 'global'
    const list = visibleNotes(all, scopeNow)
    const where = isGlobal ? 'every folder' : shortCwd(cwd)
    if (verb === 'rm' || verb === 'delete' || verb === 'del') {
      const which = words[1]?.toLowerCase()
      if (list.length === 0) return { text: `No notes in ${where} to remove.` }
      let target: Note | undefined
      if (!which || which === 'last' || which === 'global' || which === 'all') target = list[list.length - 1]
      else if (/^\d+$/.test(which)) target = list[Number(which) - 1]
      if (!target) return { text: `No note ${which ?? ''} in ${where}. "/notes" numbers them; "/notes rm last" removes the newest.` }
      await removeNotes($, [target.id])
      return { text: `Removed: ${clock(target.at, now)}  ${target.text}` }
    }
    if (verb === 'clear') {
      if (!words.some(w => /^(yes|confirm)$/i.test(w))) {
        return { text: `This removes ${list.length} note${list.length === 1 ? '' : 's'} from ${where}. Run "/notes clear yes"${isGlobal ? '' : ' (or "/notes clear global yes" for every folder)'} to confirm.` }
      }
      const removed = await removeNotes($, list.map(one => one.id))
      return { text: `Removed ${removed} note${removed === 1 ? '' : 's'} from ${where}.` }
    }
    if (list.length === 0) return { text: isGlobal ? 'No notes yet.' : `No notes for ${shortCwd(cwd)} yet. "/notes global" lists every folder's.` }
    const shown = list.slice(-100)
    const head = `${isGlobal ? 'All notes' : `Notes for ${shortCwd(cwd)}`} (${list.length}) · "/notes rm <number>" removes one:`
    return { text: `${head}\n${notesAsText(shown, now, list.length - shown.length + 1)}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)
    const rows = e.props.scroll.bodyRows
    const now = await $.clock.now()
    const np = await read($, nowPlaying)
    const lists = await read($, playlists)
    const scope = await read($, notesScope)
    const all = await read($, notes)
    const line = await read($, status)
    const signedIn = await read($, hasApi)
    const eq = await read($, eqMode)
    const tel = await read($, telemetry)
    const mus = await read($, music)
    const show = await read($, sections)
    const isMobile = e.surface === 'mobile'
    const isTerminal = e.surface === 'terminal'

    eqColumns = Math.max(8, Math.min(width, MAX_COLUMNS))
    startTimers($)
    const bars = barsFor(eqColumns, eqView, eqDensity)
    if (eqHeights.length !== bars) eqHeights = new Array<number>(bars).fill(0)
    latestProgress = null

    // -- now playing, with the buddy mod's pet beside it when one is on duty
    const held = await read($, { plugin: 'buddy', key: 'view' } as const).catch(() => undefined)
    const pet: PetView | null = held && typeof held === 'object' ? (held as PetView) : null
    petView = pet
    petSeen = frame
    const who = (pet && typeof pet.name === 'string' ? pet.name : petName) ?? 'Buddy'
    const textWidth = Math.max(10, width - (pet !== null ? PET_COLUMNS + 1 : 0))
    const volWidth = Math.max(6, Math.min(16, textWidth - 14))
    const volFilled = np && np.volume !== null ? Math.round((np.volume / 100) * volWidth) : 0
    const reaction = np === null ? `${who} is waiting for music` : !np.isPlaying ? `${who} is waiting for play` : `${who} is ${np.reaction}`
    const pos = np ? positionOf(np, now) : null
    const progress: Progress | null = np && np.durationMs !== null && pos !== null ? { pos, total: np.durationMs, isPlaying: np.isPlaying } : null
    const nowPlayingBlock = (
      <Box flexDirection="column">
        {np === null ? (
          <Text dimColor>♫ Nothing playing on Spotify{signedIn ? '' : ' (connector)'}</Text>
        ) : (
          <Box flexDirection="column">
            <Text bold>{fit(`♫ ${np.name}`, width)}</Text>
            <Text dimColor>
              {fit(`  ${np.artists.join(', ')}${np.durationMs && np.progressMs === null ? ` · ${mmss(np.durationMs)}` : ''}${np.device ? ` · ${np.device}` : ''}${!np.isPlaying ? ' · paused' : ''} · ${eq === 'live' ? 'live eq' : 'eq guessed'}${mus && mus.bpm ? ` · ~${mus.bpm} bpm` : ''}`, width)}
            </Text>
          </Box>
        )}
        {isTerminal ? (
          (() => {
            const { Raster } = $.ui.resolve(e)
            return <Raster key={EQ_KEY} columns={eqColumns} rows={stripRows(eqView)} cells={stripCells(eqHeights, eqDensity, eqPalette, eqView, slices, progress, null)} />
          })()
        ) : (
          <Box flexDirection="column">
            <Text color="success">{np && np.isPlaying ? '▂▄▆█▆▄▂▄▆▇▅▃▂▄▆█▇▅▃▂' : '▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁'}</Text>
            {progress && (
              <Text dimColor>
                {progress.isPlaying ? '> ' : '||'} {mmss(progress.pos)} / {mmss(progress.total)}
              </Text>
            )}
          </Box>
        )}
        {pet?.bubble ? (
          <Box borderStyle="round" borderColor={pet.color ?? 'inactive'} paddingX={1} width={width}>
            <Text wrap="wrap">{pet.bubble}</Text>
          </Box>
        ) : null}
        <Box flexDirection="row">
          {pet !== null && isTerminal && (
            (() => {
              const { Raster } = $.ui.resolve(e)
              return <Raster key={PET_KEY} columns={PET_COLUMNS} rows={PET_ROWS} cells={petCells(pet, 0)} />
            })()
          )}
          <Box flexDirection="column" justifyContent="flex-end" flexGrow={1}>
            {pet !== null && <Text color={pet.color ?? 'inactive'} bold>{fit(`${pet.flair ?? ''}${(pet.stage ?? 1) >= 3 ? `✦ ${who} ✦` : who}`, textWidth)}</Text>}
            <Text dimColor>{fit(reaction, textWidth)}</Text>
            {signedIn && np && np.volume !== null && (
              <Box>
                <Text dimColor>vol </Text>
                {!isMobile && (
                  <Button key="vol-down" hotkey="q" plain dimColor onPress={() => void setVolume($, (np.volume ?? 50) - 5)}>
                    -
                  </Button>
                )}
                <Text color="success">{'━'.repeat(volFilled)}</Text>
                <Text dimColor>{'─'.repeat(Math.max(0, volWidth - volFilled))}</Text>
                {!isMobile && (
                  <Button key="vol-up" hotkey="l" plain dimColor onPress={() => void setVolume($, (np.volume ?? 50) + 5)}>
                    +
                  </Button>
                )}
                <Text dimColor> {np.volume}%</Text>
              </Box>
            )}
            <Box>
              {pet !== null && !isMobile && (
                <Button key="pet-it" hotkey="h" onPress={() => void $.command.run({ command: 'buddy', args: 'pet' }).catch(() => undefined)}>
                  pet
                </Button>
              )}
              {np && !isMobile && (
                <Button key="open-track" hotkey="o" onPress={() => void openUri($, np.uri)}>
                  open
                </Button>
              )}
              {signedIn && !isMobile && (
                <Button key="toggle" hotkey="p" onPress={() => void control($, np && np.isPlaying ? 'pause' : 'play')}>
                  {np && np.isPlaying ? 'pause' : 'play'}
                </Button>
              )}
              {signedIn && !isMobile && (
                <Button key="next" hotkey="n" onPress={() => void control($, 'next')}>
                  next
                </Button>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    )

    // -- playlists
    let playlistsBlock
    if (isMobile) {
      playlistsBlock = (
        <Box flexDirection="column">
          <Text bold>Playlists</Text>
          {lists.slice(0, 6).map(one => (
            <Link key={one.uri} href={one.url ?? one.uri}>
              {fit(one.name, width - 2)}
            </Link>
          ))}
        </Box>
      )
    } else {
      const { Select, Input } = $.ui.resolve(e)
      playlistsBlock = (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text bold>Playlists{lists.length ? ` · ${lists.length}` : ''}</Text>
            <Button key="refresh" hotkey="r" onPress={() => void refreshPlaylists($, true)}>
              refresh
            </Button>
          </Box>
          {lists.length === 0 ? (
            <Text dimColor>Loading your playlists…</Text>
          ) : (
            <Select
              key="playlist"
              label={signedIn ? 'play' : 'open'}
              value={np && np.contextUri && lists.some(one => one.uri === np.contextUri) ? np.contextUri : undefined}
              options={lists.map(one => ({ value: one.uri, label: one.name }))}
              onSelect={value => {
                const hit = lists.find(one => one.uri === value)
                if (hit) void playContext($, hit.uri, hit.name)
              }}
            />
          )}
          <Input
            key="vibe"
            label="vibe"
            placeholder="describe a mood, Enter makes a playlist"
            value={draftVibe}
            onInput={value => {
              draftVibe = value
            }}
            onSubmit={value => {
              draftVibe = ''
              const text = value.trim()
              if (text) void generate($, `Create a playlist for this vibe: ${text}`, text)
              else void say($, null)
            }}
          />
        </Box>
      )
    }

    // -- notes, given whatever rows the rest of the pane leaves
    const shown = visibleNotes(all, scope)
    const bubbleRows = pet?.bubble ? 2 + Math.ceil(pet.bubble.length / Math.max(1, width - 4)) : 0
    const nowPlayingRows = 2 + stripRows(eqView) + bubbleRows + (pet !== null ? PET_ROWS : 2) + 1 // title, artists, strip, bubble, pet or reaction and buttons, volume
    const otherRows = 1 + (show.playlists ? 1 + 3 : 0) + (show.notes ? 2 : 0) + (show.session ? 5 : 0) + (show.usage ? 2 + Math.min(3, tel?.models.length ?? 0) : 0) + (line ? 1 : 0) + (e.props.isFocused ? 1 : 0) // rules, playlists, notes header and input, telemetry, usage, status, key hint
    const room = Math.max(2, rows - nowPlayingRows - otherRows)
    const recent = shown.slice(-room)
    const scopeLabel = scope === 'folder' ? shortCwd(cwd) : 'every folder'
    const noteRows = recent.map(one => {
      const stamp = clock(one.at, now)
      const track = one.track ? ` ♪ ${one.track.name}` : ''
      const glyph = isMobile ? 0 : 2
      const bodyWidth = Math.max(6, width - stamp.length - 1 - track.length - glyph)
      const body = fit(one.text, bodyWidth)
      return (
        <Box key={one.id} justifyContent="space-between">
          <Box>
            <Text dimColor>{stamp} </Text>
            <Text>{body}</Text>
            {track && <Text dimColor>{fit(track, Math.max(0, width - stamp.length - 1 - body.length - glyph))}</Text>}
          </Box>
          {!isMobile && (
            <Button key={`del-${one.id}`} plain dimColor onPress={() => void removeNotes($, [one.id])}>
              ×
            </Button>
          )}
        </Box>
      )
    })
    const notesBlock = (
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text bold>{fit(`Notes · ${scopeLabel}`, width - 12)}</Text>
          {!isMobile && (
            <Button
              key="scope"
              hotkey="g"
              onPress={() => {
                const nextScope: NotesScope = scope === 'folder' ? 'global' : 'folder'
                void $.store.set('soundtrack:notesScope', nextScope)
                void update($, notesScope, () => nextScope)
              }}
            >
              {scope === 'folder' ? 'global' : 'folder'}
            </Button>
          )}
        </Box>
        {recent.length === 0 ? <Text dimColor>{scope === 'folder' ? 'No notes here yet.' : 'No notes yet.'}</Text> : noteRows}
        {!isMobile &&
          (() => {
            const { Input } = $.ui.resolve(e)
            return (
              <Input
                key="note"
                label="note"
                placeholder="type, Enter saves · stamped with the track"
                value={draftNote}
                autoFocus
                onInput={value => {
                  draftNote = value
                }}
                onSubmit={value => {
                  draftNote = ''
                  void addNote($, value)
                }}
              />
            )
          })()}
      </Box>
    )

    // -- session telemetry: context, cost, call rate, files, the capture helper
    const SPARK = '▁▂▃▄▅▆▇█'
    const sparkOf = (counts: number[]) => {
      const top = Math.max(1, ...counts)
      return counts.map(c => (c === 0 ? ' ' : SPARK.charAt(Math.min(7, Math.floor((c / top) * 7.999))))).join('')
    }
    const barWidth = Math.max(6, Math.min(16, width - 44))
    const ctxFilled = tel && tel.contextPct !== null ? Math.round((Math.min(100, tel.contextPct) / 100) * barWidth) : 0
    const ctxText = tel && tel.contextPct !== null ? `${Math.round(tel.contextPct)}%` : '--'
    const ctxColor = tel && tel.contextPct !== null && tel.contextPct >= 80 ? 'error' : tel && tel.contextPct !== null && tel.contextPct >= 60 ? 'warning' : 'success'
    const lead = tel?.limits[0] ?? null
    const leadFilled = lead ? Math.round((Math.min(100, Math.max(0, lead.percentUsed)) / 100) * barWidth) : 0
    const leadColor = lead && lead.percentUsed >= 90 ? 'error' : lead && lead.percentUsed >= 70 ? 'warning' : 'success'
    const costText = tel && tel.costUsd !== null ? ` · $${tel.costUsd.toFixed(2)}` : ''
    const latencyText = tel && tel.latencyMs !== null ? ` · ${tel.latencyMs >= 1000 ? `${(tel.latencyMs / 1000).toFixed(1)}s` : `${Math.round(tel.latencyMs)}ms`}` : ''
    const filesText = tel && tel.files.length ? tel.files.map(one => `${one.path} +${one.plus} -${one.minus}`).join(' · ') + (tel.filesTotal > tel.files.length ? ` · +${tel.filesTotal - tel.files.length} more` : '') : 'no files edited yet'
    const helperText = tel ? (tel.helper.status === 'running' ? `wasapi ${tel.helper.rate}/s · ${tel.helper.errors} err` : tel.helper.status === 'starting' ? 'wasapi starting…' : `wasapi stopped${liveNote ? ` · ${liveNote}` : ''}`) : 'wasapi …'
    const telemetryBlock = (
      <Box flexDirection="column">
        <Text dimColor>{'─'.repeat(width)}</Text>
        <Box justifyContent="space-between">
          <Text bold>Session · live</Text>
          {tel?.hasDiff && !isMobile && (
            <Button key="diff" hotkey="d" onPress={() => void $.command.run({ command: 'diff' }).catch(() => undefined)}>
              diff
            </Button>
          )}
        </Box>
        <Box>
          <Text dimColor>ctx </Text>
          <Text color={ctxColor}>{'━'.repeat(ctxFilled)}</Text>
          <Text dimColor>{'─'.repeat(Math.max(0, barWidth - ctxFilled))}</Text>
          <Text>{fit(` ${ctxText}${costText} · ${tel?.callsPerMin ?? 0} calls/m `, Math.max(8, width - barWidth - 4 - 7 - latencyText.length))}</Text>
          <Text color="success">{sparkOf(tel?.spark ?? [0, 0, 0, 0, 0, 0])}</Text>
          <Text dimColor>{latencyText}</Text>
        </Box>
        <Box>
          <Text dimColor>edit </Text>
          <Text>{fit(filesText, width - 5)}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Box>
            <Text dimColor>proc </Text>
            <Text color={tel?.helper.status === 'running' ? undefined : 'warning'}>{fit(helperText, width - 5 - (isMobile ? 0 : 12))}</Text>
          </Box>
          {!isMobile && (
            <Button key="restart" hotkey="x" onPress={() => restartCapture($)}>
              restart
            </Button>
          )}
        </Box>
      </Box>
    )

    // -- plan usage: the five-hour window as a bar, every window as text
    const usageBlock = (
      <Box flexDirection="column">
        <Text dimColor>{'─'.repeat(width)}</Text>
        <Box>
          <Text dimColor>plan </Text>
          {lead ? (
            <Box>
              <Text color={leadColor}>{'━'.repeat(leadFilled)}</Text>
              <Text dimColor>{'─'.repeat(Math.max(0, barWidth - leadFilled))}</Text>
              <Text>{fit(` ${limitsText(tel?.limits ?? [], now, true).join(' · ')}`, Math.max(8, width - barWidth - 5))}</Text>
            </Box>
          ) : (
            <Text dimColor>{fit('no plan limits reported yet', width - 5)}</Text>
          )}
        </Box>
        {(tel?.models ?? []).slice(0, 3).map((one, i) => (
          <Box key={one.model}>
            <Text dimColor>{i === 0 ? 'tok  ' : '     '}</Text>
            <Text>{fit(modelsText([one], true)[0] ?? '', width - 5)}</Text>
          </Box>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {nowPlayingBlock}
        {show.playlists && <Text dimColor>{'─'.repeat(width)}</Text>}
        {show.playlists && playlistsBlock}
        {show.notes && <Text dimColor>{'─'.repeat(width)}</Text>}
        {show.notes && notesBlock}
        {show.session && telemetryBlock}
        {show.usage && usageBlock}
        {line && <Text color="warning">{fit(line, width)}</Text>}
        {e.props.isFocused && <Text dimColor>{fit(signedIn ? 'Tab moves · h pet · p play/pause · n next · q/l volume · o open · r refresh · g scope · x restart eq · Esc' : 'Tab moves · o open track · r refresh · g scope · x restart eq · Esc back', width)}</Text>}
      </Box>
    )
  })
}
