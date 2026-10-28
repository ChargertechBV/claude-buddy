// Spotify: your own app's sign-in and Web API, the claude.ai connector as the
// fallback, polling what plays, playback and volume, playlists and vibe playlists.

import { atom, read, update } from 'claude-code'
import type { McpToolResult } from 'claude-code'

import type { NowPlaying, Played, Playlist, Track } from '../types'
import { ctx, fit, isRecord, num, parse, positionOf, say } from './shared'
import type { $ } from './shared'

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

/**
 * The playlists every install offers, first in the picker, whether or not they
 * are in the listener's own library. Public, so any Spotify account plays them.
 */
const DEFAULT_PLAYLISTS: readonly Playlist[] = [
  { uri: 'spotify:playlist:3lqHyrWCYZfwj45VwLElEE', name: 'brain.md', owner: '', url: 'https://open.spotify.com/playlist/3lqHyrWCYZfwj45VwLElEE' },
]

/** The library with the built-in playlists in front, each listed once: the library's own entry wins where it has one. */
function withDefaults(list: readonly Playlist[]): Playlist[] {
  const first = DEFAULT_PLAYLISTS.map(one => list.find(own => own.uri === one.uri) ?? one)
  return [...first, ...list.filter(own => !DEFAULT_PLAYLISTS.some(one => one.uri === own.uri))]
}

/** The playlist the picker offers when nothing plays from a listed one: the first built-in. */
export function defaultPlaylistUri(): string | null {
  return DEFAULT_PLAYLISTS[0]?.uri ?? null
}

/** Puts the built-in playlists in the picker at session start, before the library has loaded. */
export async function showDefaultPlaylists($: $) {
  const held = await read($, playlists)
  if (held.length === 0) await update($, playlists, () => withDefaults([]))
}

// Session values the pane draws from. Change a tag when its fields change: an
// earlier version's value, which outlives a reload, is then read as absent.
const nowPlaying = atom({ plugin: 'buddy', key: 'nowPlaying' } as const, null, { shape: 'np-4' })

/** Reads `nowPlaying` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function nowPlayingOf($: $) {
  return read($, nowPlaying)
}

const playlists = atom({ plugin: 'buddy', key: 'playlists' } as const, [], { shape: 'pl-1' })

/** Reads `playlists` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function playlistsOf($: $) {
  return read($, playlists)
}

const played = atom({ plugin: 'buddy', key: 'played' } as const, [], { shape: 'played-1' })

/** Reads `played` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function playedOf($: $) {
  return read($, played)
}

const hasApi = atom({ plugin: 'buddy', key: 'hasApi' } as const, false)

/** Reads `hasApi` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function hasApiOf($: $) {
  return read($, hasApi)
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

function str(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 ? x : null
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

// -- your own spotify app -----------------------------------------------------

const authPath = () => `${ctx.home}/${AUTH_FILE}`

/** Reads the auth file the sign-in script wrote; null when absent or unreadable. */
export async function loadAuth($: $, now: number, force = false): Promise<Auth | null> {
  if (!force && auth !== null && now - authCheckedAt < AUTH_RECHECK_MS) return auth
  authCheckedAt = now
  if (!ctx.home) return null
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
export async function openUri($: $, uri: string): Promise<boolean> {
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
export async function playContext($: $, uri: string, label: string): Promise<string> {
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

export async function control($: $, action: 'play' | 'pause' | 'next' | 'previous') {
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
export async function setVolume($: $, percent: number) {
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

/** The pane redrew from the polled value, so the strip's fresher position starts over. */
export function clearProgress() {
  latestProgress = null
}

/** The playing track with the freshest polled position, for the strip between redraws. */
export function freshPlaying(np: NowPlaying): NowPlaying {
  return latestProgress && latestProgress.fetchedAt >= np.fetchedAt ? { ...np, ...latestProgress } : np
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
export async function pollNow($: $) {
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
export async function refreshPlaylists($: $, force: boolean) {
  const now = await $.clock.now()
  const cached = await $.store.get('soundtrack:playlists')
  if (!force && isRecord(cached) && typeof cached.at === 'number' && Array.isArray(cached.list) && now - cached.at < PLAYLIST_CACHE_MS) {
    await update($, playlists, () => withDefaults(cached.list as Playlist[]))
    if (cached.list.length > 0) return
  }
  const viaApi = (await loadAuth($, now)) !== null ? await fetchPlaylistsApi($) : null
  const list = viaApi ?? (await fetchPlaylistsConnector($))
  if (list === null || list.length === 0) {
    await update($, playlists, () => withDefaults([]))
    if (force) await say($, 'Spotify listed no playlists of yours; the built-in ones stay.')
    return
  }
  // The cache holds the library alone, so a later version's built-ins replace this one's.
  await $.store.set('soundtrack:playlists', { at: now, list })
  await update($, playlists, () => withDefaults(list))
  if (force) await say($, `${list.length} playlists loaded.`)
}

/** The playlist a typed name means: exact, then prefix, then substring, then every word somewhere. */
export const findPlaylist = (list: Playlist[], query: string): Playlist | null => {
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
export async function generate($: $, prompt: string, tag: string): Promise<string> {
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
export async function cleanGenerated($: $): Promise<string> {
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
