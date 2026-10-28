import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'buddy',
  component: 'Pane',
  requestId: 'soundtrack',
  props: {
    title: 'Soundtrack',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const NOW = Date.UTC(2026, 9, 28, 10, 42)

const SORROW = {
  uri: 'spotify:track:3ICfxLYdJkVpwFfUHwbCAp',
  name: 'Sorrow - Radio Edit',
  artists: ['Gunz For Hire', 'Ellie'],
  album: 'Sorrow',
  url: 'https://open.spotify.com/track/3ICfxLYdJkVpwFfUHwbCAp',
  durationMs: 191920,
  since: NOW - 60_000,
  isPlaying: true,
  progressMs: 60_000,
  fetchedAt: NOW - 2_000,
  device: 'DESKTOP',
  volume: 62,
  contextUri: 'spotify:playlist:3lqHyrWCYZfwj45VwLElEE',
  source: 'api',
  energy: 1,
  reaction: 'headbanging',
}

const AUTH = JSON.stringify({ client_id: 'cid', access_token: 'tok', refresh_token: 'ref', expires_at: NOW + 3_600_000 })

const PLAYER = JSON.stringify({
  is_playing: true,
  progress_ms: 60_000,
  device: { name: 'DESKTOP', volume_percent: 62 },
  context: { type: 'playlist', uri: 'spotify:playlist:3lqHyrWCYZfwj45VwLElEE' },
  item: {
    type: 'track',
    uri: SORROW.uri,
    name: SORROW.name,
    duration_ms: 191920,
    artists: [{ name: 'Gunz For Hire' }, { name: 'Ellie' }],
    album: { name: 'Sorrow' },
    external_urls: { spotify: SORROW.url },
  },
})

const PLAYLISTS = JSON.stringify({
  items: [
    { uri: 'spotify:playlist:3lqHyrWCYZfwj45VwLElEE', name: 'brain.md', owner: { display_name: 'Listener' }, external_urls: { spotify: 'https://open.spotify.com/playlist/3lqHyrWCYZfwj45VwLElEE' } },
  ],
  next: null,
})

type On = Parameters<TestBody>[1]

/** The engine's clock, which nothing beneath the plugin answers in a test: mocked, parked at NOW. */
function clock(on: On) {
  return mock.clock(on, { now: NOW })
}

/** Answers `state.get` per key: what an earlier poll or version stored. */
function seeded(values: Record<string, unknown>) {
  return (_: unknown, e: { key?: string; plugin?: string }) => {
    const key = String(e.key)
    return key in values
      ? { value: { value: values[key], version: 1 } }
      : { value: { value: undefined, version: 0 } }
  }
}

/** A Spotify Web API that answers the player and the playlists; records every call. */
function spotify(on: On, calls: { method: string; url: string; body?: string }[]) {
  mock.env(on, { HOME: '/home/test' })
  mock.store(on)
  on('fs.read', () => ({ value: AUTH }))
  on('command.register', (_, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('http.fetch', (_, e: { url: string; init?: { method?: string; body?: string } }) => {
    calls.push({ method: e.init?.method ?? 'GET', url: e.url, body: e.init?.body })
    const headers = { 'content-type': 'application/json' }
    if (e.url.includes('/me/player/devices')) return { value: { status: 200, ok: true, headers, text: JSON.stringify({ devices: [{ id: 'dev1', name: 'DESKTOP', is_active: true }] }) } }
    if (e.url.includes('/me/player/play')) return { value: { status: 204, ok: true, headers: {}, text: '' } }
    if (e.url.includes('/me/player')) return { value: { status: 200, ok: true, headers, text: PLAYER } }
    if (e.url.includes('/me/playlists')) return { value: { status: 200, ok: true, headers, text: PLAYLISTS } }
    return { value: { status: 404, ok: false, headers, text: '{"error":{"status":404,"message":"nope"}}' } }
  })
}

test('an empty pane says nothing is playing and waits for notes', async ($, on) => {
  clock(on)
  on('state.get', seeded({}))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Nothing playing/ }))?.text).toBe('♫ Nothing playing on Spotify (connector)')
  expect((await ui.find({ type: 'Text', text: /No notes here yet/ }))?.text).toBe('No notes here yet.')
  const strip = await ui.find({ type: 'Raster', key: 'eq' })
  expect(strip?.props.rows).toBe(10)
  expect(await ui.find({ type: 'Input', key: 'note' })).toBeTruthy()
  await ui.unmount()
})

test('a polled track is drawn with its artists, device, position and the pet reaction', async ($, on) => {
  clock(on)
  on('state.get', seeded({ nowPlaying: { shape: 'np-4', value: SORROW }, hasApi: true }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Sorrow/ }))?.text).toBe('♫ Sorrow - Radio Edit')
    expect((await ui.find({ type: 'Text', text: /Gunz For Hire/ }))?.text).toBe('  Gunz For Hire, Ellie · DESKTOP · eq guessed')
    expect((await ui.find({ type: 'Text', text: /headbanging/ }))?.text).toBe('Buddy is headbanging')
    expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('pause')
    if (surface === 'desktop') {
      // 60 s polled two seconds ago, still playing: 1:02 of 3:11.
      expect((await ui.find({ type: 'Text', text: /\/ 3:11/ }))?.text).toContain('1:02 / 3:11')
    }
    await ui.unmount()
  }
})

test('a value an earlier version stored is read as absent', async ($, on) => {
  clock(on)
  on('state.get', seeded({ nowPlaying: { shape: 'np-3', value: SORROW } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Nothing playing/ }))?.text).toBe('♫ Nothing playing on Spotify (connector)')
  await ui.unmount()
})

test('a typed note is stored, stamped with the playing track', async ($, on) => {
  clock(on)
  const saved: unknown[] = []
  on('state.get', seeded({ nowPlaying: { shape: 'np-4', value: SORROW } }))
  on('state.set', () => ({ value: { isSet: true, version: 2 } }))
  on('store.get', () => ({ value: undefined })) // nothing on disk yet: the merge adds the new note alone
  on('store.set', (_, e: { key?: string; value?: unknown }) => {
    if (e.key === 'soundtrack:notes') saved.push(e.value)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.input({ plugin: 'buddy', key: 'note', text: 'fixed the picqer sync' })
  expect(saved.length).toBe(1)
  const notes = saved[0] as { text: string; track: { name: string } | null }[]
  expect(notes.length).toBe(1)
  expect(notes[0]?.text).toBe('fixed the picqer sync')
  expect(notes[0]?.track?.name).toBe('Sorrow - Radio Edit')
  await ui.unmount()
})

test('the delete glyph on a note removes it from the store', async ($, on) => {
  clock(on)
  const saved: unknown[] = []
  const TWO = [
    { id: 'a1', at: NOW - 60_000, text: 'first', cwd: '/', track: null },
    { id: 'b2', at: NOW - 30_000, text: 'second', cwd: '/', track: null },
  ]
  on('state.get', seeded({ notes: { shape: 'note-1', value: TWO }, notesScope: 'global' }))
  on('state.set', () => ({ value: { isSet: true, version: 2 } }))
  // The store holds the same two notes; a removal here must beat the merge with them.
  on('store.get', (_, e: { key?: string }) => ({ value: e.key === 'soundtrack:notes' ? TWO : undefined }))
  on('store.set', (_, e: { key?: string; value?: unknown }) => {
    if (e.key === 'soundtrack:notes') saved.push(e.value)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'del-a1' })).toBeTruthy()
  await $.ui.press({ plugin: 'buddy', key: 'del-a1' })
  const kept = saved[0] as { id: string }[]
  expect(kept.map(one => one.id)).toEqual(['b2'])
  await ui.unmount()
})

test('an edit shows up in the session telemetry with its line delta', async ($, on) => {
  const time = clock(on)
  const written: Record<string, unknown> = {}
  // Reads answer with what the hooks wrote, so the mounted pane sees the telemetry.
  on('state.get', (_, e: { key?: string }) => {
    const key = String(e.key)
    return key in written ? { value: { value: written[key], version: 2 } } : { value: { value: undefined, version: 0 } }
  })
  on('state.set', (_, e: { key?: string; value?: unknown }) => {
    written[String(e.key)] = e.value
    return { value: { isSet: true, version: 2 } }
  })
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Edit', file_path: '/work/src/a.ts', old_string: 'x', new_string: 'y\nz' })
  await time.settle()

  const tel = written.telemetry as { shape: string; value: { files: { path: string; plus: number; minus: number }[]; filesTotal: number; callsPerMin: number } }
  expect(tel.shape).toBe('tel-3')
  expect(tel.value.files).toEqual([{ path: '/work/src/a.ts', plus: 2, minus: 1 }])
  expect(tel.value.filesTotal).toBe(1)
  expect(tel.value.callsPerMin).toBe(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /a\.ts/ }))?.text).toBe('/work/src/a.ts +2 -1')
  expect(await ui.find({ type: 'Button', key: 'restart' })).toBeTruthy()
  await ui.unmount()
})

test('signed in, the session start polls the player and lists playlists through the Web API', async ($, on) => {
  const time = clock(on)
  const calls: { method: string; url: string; body?: string }[] = []
  const written: Record<string, unknown> = {}
  spotify(on, calls)
  on('state.get', seeded({}))
  on('state.set', (_, e: { key?: string; value?: unknown }) => {
    written[String(e.key)] = e.value
    return { value: { isSet: true, version: 2 } }
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await time.settle()

  expect(calls.some(one => one.method === 'GET' && one.url.includes('/me/player?'))).toBe(true)
  expect(calls.some(one => one.method === 'GET' && one.url.includes('/me/playlists'))).toBe(true)
  const np = written.nowPlaying as { shape: string; value: { name: string; isPlaying: boolean; source: string; device: string } }
  expect(np.shape).toBe('np-4')
  expect(np.value.name).toBe('Sorrow - Radio Edit')
  expect(np.value.isPlaying).toBe(true)
  expect(np.value.source).toBe('api')
  expect(np.value.device).toBe('DESKTOP')
  const lists = written.playlists as { value: { name: string }[] }
  expect(lists.value.map(one => one.name)).toEqual(['brain.md'])
  expect(written.hasApi).toBe(true)
})

test('picking a playlist starts it through the Web API', async ($, on) => {
  const time = clock(on)
  const calls: { method: string; url: string; body?: string }[] = []
  spotify(on, calls)
  on('state.get', seeded({
    hasApi: true,
    nowPlaying: { shape: 'np-4', value: SORROW },
    playlists: { shape: 'pl-1', value: [{ uri: 'spotify:playlist:3lqHyrWCYZfwj45VwLElEE', name: 'brain.md', owner: 'Listener', url: null }] },
  }))
  on('state.set', () => ({ value: { isSet: true, version: 2 } }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await time.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const select = await ui.find({ type: 'Select', key: 'playlist' })
  expect(select?.props.label).toBe('play')
  // The picker shows the playlist the track plays from.
  expect(select?.props.value).toBe('spotify:playlist:3lqHyrWCYZfwj45VwLElEE')
  await $.ui.select({ plugin: 'buddy', key: 'playlist', value: 'spotify:playlist:3lqHyrWCYZfwj45VwLElEE' })
  await time.settle()

  const play = calls.find(one => one.method === 'PUT' && one.url.endsWith('/me/player/play'))
  expect(play?.body).toBe(JSON.stringify({ context_uri: 'spotify:playlist:3lqHyrWCYZfwj45VwLElEE' }))
  await ui.unmount()
})

const PRESENTATION = { isFullscreen: true, columns: 120 }

test('the plan windows the engine reports are drawn as a usage row, five-hour first, and answer /soundtrack usage', async ($, on) => {
  const time = clock(on)
  const written: Record<string, unknown> = {}
  on('state.get', (_, e: { key?: string }) => {
    const key = String(e.key)
    return key in written ? { value: { value: written[key], version: 2 } } : { value: { value: undefined, version: 0 } }
  })
  on('state.set', (_, e: { key?: string; value?: unknown }) => {
    written[String(e.key)] = e.value
    return { value: { isSet: true, version: 2 } }
  })
  on('tool.call', () => ({ result: {} }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW - 3_600_000,
      context: { window: 200_000, tokens: 50_000, percent: 25 },
      rateLimits: [
        { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(NOW + (3 * 24 + 4) * 3_600_000).toISOString() },
        { kind: 'five_hour', percentUsed: 42.04, resetsAt: new Date(NOW + 130 * 60_000).toISOString() },
      ],
      cost: { usd: 1.5 },
    },
  }))

  // The telemetry refreshes on an edit; the engine's figures ride along.
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/a.ts', old_string: 'x', new_string: 'y' })
  await time.settle()

  const tel = written.telemetry as { shape: string; value: { contextPct: number; limits: { kind: string; percentUsed: number; resetsAt: number | null }[] } }
  expect(tel.shape).toBe('tel-3')
  expect(tel.value.contextPct).toBe(25)
  expect(tel.value.limits.map(one => one.kind)).toEqual(['five_hour', 'seven_day'])
  expect(tel.value.limits[0]?.percentUsed).toBe(42)
  expect(tel.value.limits[0]?.resetsAt).toBe(NOW + 130 * 60_000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /5h 42%/ }))?.text).toBe(' 5h 42% (2h10m) · 7d 18% (3d 4h)')
  await ui.unmount()

  const answer = await $.command.run({ command: 'soundtrack', args: 'usage', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(answer.text).toBe('5h 42% · resets in 2h10m\n7d 18% · resets in 3d 4h\nNo model requests counted yet.')
})

test('each model request adds its reported usage to a per-model tally the pane and /soundtrack usage show', async ($, on) => {
  const time = clock(on)
  const written: Record<string, unknown> = {}
  on('state.get', (_, e: { key?: string }) => {
    const key = String(e.key)
    return key in written ? { value: { value: written[key], version: 2 } } : { value: { value: undefined, version: 0 } }
  })
  on('state.set', (_, e: { key?: string; value?: unknown }) => {
    written[String(e.key)] = e.value
    return { value: { isSet: true, version: 2 } }
  })
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] } }))
  const usages = [
    { model: 'claude-fable-5-1', input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 3000 },
    { model: 'claude-fable-5-1', input_tokens: 300, output_tokens: 1700, cache_read_input_tokens: 160_000, cache_creation_input_tokens: 0 },
    { model: 'claude-haiku-5-5', input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  ]
  let i = 0
  on('turn.step', async function* (_, e: { turnId: string; index: number }) {
    const usage = usages[i++]!
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage }
  })
  for (let n = 0; n < usages.length; n++) {
    const stream = $.turn.step({ turnId: 't1', index: n, model: 'claude-fable-5-1', messageCount: 2 })
    for await (const _chunk of stream) {
      // drained
    }
    await stream.result
  }
  await time.settle()

  const tel = written.telemetry as { value: { models: { model: string; requests: number; input: number; output: number; cacheRead: number; cacheWrite: number }[] } }
  expect(tel.value.models).toEqual([
    { model: 'claude-fable-5-1', requests: 2, input: 1500, output: 2500, cacheRead: 310_000, cacheWrite: 3000 },
    { model: 'claude-haiku-5-5', requests: 1, input: 50, output: 20, cacheRead: 0, cacheWrite: 0 },
  ])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^fable/ }))?.text).toBe('fable 5.1 ×2 · in 4.5k out 2.5k cached 310k')
  expect((await ui.find({ type: 'Text', text: /^haiku/ }))?.text).toBe('haiku 5.5 ×1 · in 50 out 20 cached 0')
  await ui.unmount()

  const answer = await $.command.run({ command: 'soundtrack', args: 'usage', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(answer.text).toBe(
    'No plan limits reported yet: the engine learns them from the first API response, and an API key has none.\n' +
      'fable 5.1 (claude-fable-5-1): 2 requests, 1,500 input, 2,500 output, 310,000 cache read, 3,000 cache write\n' +
      'haiku 5.5 (claude-haiku-5-5): 1 request, 50 input, 20 output, 0 cache read, 0 cache write',
  )
})

test('a window past 90 % toasts once when the engine measures it, and again only after it drops back', async ($, on) => {
  clock(on)
  const toasts: string[] = []
  on('ui.toast', (_, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.measure', (_, e: { changed: ('context' | 'rateLimits' | 'cost')[] }) => ({ changed: e.changed }))
  const high = [{ kind: 'five_hour', percentUsed: 91, resetsAt: new Date(NOW + 45 * 60_000).toISOString() }]
  const measure = (rateLimits: typeof high) => $.session.measure({ context: { window: 200_000 }, rateLimits, changed: ['rateLimits'] })
  await measure(high)
  await measure(high)
  expect(toasts).toEqual(['Five-hour limit at 91%, resets in 45m'])
  await measure([{ ...high[0]!, percentUsed: 40 }])
  await measure(high)
  expect(toasts).toHaveLength(2)
})

test('/soundtrack hide drops a section from the pane and the choice is stored', async ($, on) => {
  clock(on)
  const stored: Record<string, unknown> = {}
  on('store.set', (_, e: { key: string; value: unknown }) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('store.get', (_, e: { key: string }) => ({ value: stored[e.key] }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] } }))

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Notes · / })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'no plan limits reported yet' })).toBeTruthy()
  await ui.unmount()

  const answer = await $.command.run({ command: 'soundtrack', args: 'hide notes', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(answer.text).toBe('Pane sections: playlists, session, usage.')
  expect(stored['soundtrack:sections']).toEqual({ playlists: true, notes: false, session: true, usage: true })

  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Notes · / })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: 'no plan limits reported yet' })).toBeTruthy()
  await ui.unmount()

  const bad = await $.command.run({ command: 'soundtrack', args: 'hide pets', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(bad.text).toBe('No section "pets". The sections are playlists, notes, session, usage, or all.')
})
