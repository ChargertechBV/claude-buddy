// The Soundtrack pane: what Spotify plays with the equaliser strip and the pet
// beside it, playlists, notes, the cups tracker, the session telemetry and the
// plan usage. The buddy side registers these hooks from its own `register`,
// starts this at its session start and hands its tool calls on.

import { read } from 'claude-code'
import type { On, SessionStartInput } from 'claude-code'

import { PET_COLUMNS, PET_ROWS, petCells } from './sprite'
import type { PetView } from './sprite'
import { mmss } from './strip'
import type { Progress } from './strip'
import { petIt } from './buddy-life'
import { captureNote, musicOf, publishMusic, restartCapture, runCapture } from './capture'
import { addDrink, drinksOf, loadDrinks } from './drinks'
import { eqModeOf, lastPetName, loadEqSettings, readPet, sawPet, stripFrame, wakeFrames } from './eq'
import { addNote, loadNotes, notesOf, notesScopeOf, removeNotes, toggleNotesScope, visibleNotes } from './notes'
import { EQ_KEY, PANE, PET_KEY, clock, ctx, fit, isRecord, parse, positionOf, say, shortCwd, statusOf } from './shared'
import type { $ } from './shared'
import { loadSections, registerShortcuts, runShortcut, sectionsOf, soundtrackCommand } from './soundtrack-commands'
import { clearProgress, control, defaultPlaylistUri, generate, hasApiOf, nowPlayingOf, openUri, playContext, playlistsOf, pollNow, refreshPlaylists, setVolume, showDefaultPlaylists } from './spotify'
import { detectDiff, limitsText, modelsText, refreshTelemetry, tallyTokens, telemetryOf, usageLimits, warnPastLimits } from './telemetry'

const TELEMETRY_MS = 5_000
const MUSIC_MS = 2_000
let draftNote = ''
let draftVibe = ''
let timersStarted = false

// ------------------------------------------------------------------- hooks --

/**
 * Carries the standalone Soundtrack mod's saved notes and settings over, once:
 * its store file still sits beside this mod's, keyed by its old name. Every key
 * lands under the `soundtrack:` prefix, and nothing already set is overwritten.
 */
async function importOldStore($: $) {
  if ((await $.store.get('soundtrack:imported')) === true || !ctx.home) return
  const dir = `${ctx.home}/.claude/plugins/store`
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
 * settings, the first poll and the capture helper. The frames and the timers
 * start with the pane's first drawing.
 */
export async function startSoundtrack($: $, e: SessionStartInput) {
  ctx.cwd = e.cwd
  ctx.home = (await $.env.get('HOME')) ?? ''
  await importOldStore($)
  ctx.startedAt = await $.clock.now()

  await $.command.register({
    name: 'soundtrack',
    description: 'Open the Soundtrack pane. Also: play, pause, skip, volume, vibe, note, notes, drink, drinks, playlist, show|hide <section>, usage, eq, colors, density, slices, beat, shortcuts',
    argumentHint: '[play|pause|skip|volume|vibe|note|notes|drink|drinks|playlist|show|hide|sections|usage|eq|colors|density|slices|beat|shortcuts]',
  })
  await registerShortcuts($)
  await loadNotes($)
  await loadSections($)
  await loadEqSettings($)
  await loadDrinks($)

  void $.ui.open({ id: PANE, title: 'Soundtrack' }).catch(() => undefined)
  await showDefaultPlaylists($)
  void pollNow($)
    .then(() => refreshPlaylists($, false))
    .catch(() => undefined)
  await readPet($)
  await detectDiff($)
  void runCapture($)
}

/** The telemetry and music timers and the frame loop: started by the pane's first drawing, so a session that never shows it never pays for them. */
async function startTimers($: $) {
  if (!timersStarted) {
    timersStarted = true
    $.clock.every(TELEMETRY_MS, () => void refreshTelemetry($))
    $.clock.every(MUSIC_MS, () => void publishMusic($))
  }
  wakeFrames($, await $.clock.now())
}

// -------------------------------------------------------------------- wiring --

/** The Soundtrack commands and the pane, registered from buddy's `register`. */
export const registerSoundtrack = (on: On) => {
  // Every model request of the session, main thread and subagents: its reported usage goes on the model's tally.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (r.usage) {
      tallyTokens(r.usage)
      void refreshTelemetry($)
    }
    return r
  })
  // The engine pushes a measurement after each turn and when a plan window moves a point: redraw then, not on the next tick.
  on('session.measure', async ($, e, next) => {
    warnPastLimits($, usageLimits(e.rateLimits), await $.clock.now())
    await refreshTelemetry($).catch(() => undefined)
    return next(e)
  })
  on('command.run', { command: 'soundtrack' }, async ($, e) => soundtrackCommand($, e.args))
  // The short commands, registered only while they are on.
  on('command.run', { command: 'play' }, async ($, e) => runShortcut($, 'play', e.args))
  on('command.run', { command: 'pause' }, async ($, e) => runShortcut($, 'pause', e.args))
  on('command.run', { command: 'skip' }, async ($, e) => runShortcut($, 'skip', e.args))
  on('command.run', { command: 'volume' }, async ($, e) => runShortcut($, 'volume', e.args))
  on('command.run', { command: 'vibe' }, async ($, e) => runShortcut($, 'vibe', e.args))
  on('command.run', { command: 'note' }, async ($, e) => runShortcut($, 'note', e.args))
  on('command.run', { command: 'notes' }, async ($, e) => runShortcut($, 'notes', e.args))
  on('command.run', { command: 'drink' }, async ($, e) => runShortcut($, 'drink', e.args))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)
    const rows = e.props.scroll.bodyRows
    const now = await $.clock.now()
    const np = await nowPlayingOf($)
    const lists = await playlistsOf($)
    const scope = await notesScopeOf($)
    const all = await notesOf($)
    const line = await statusOf($)
    const signedIn = await hasApiOf($)
    const eq = await eqModeOf($)
    const tel = await telemetryOf($)
    const mus = await musicOf($)
    const show = await sectionsOf($)
    const cups = await drinksOf($)
    const isMobile = e.surface === 'mobile'
    const isTerminal = e.surface === 'terminal'

    clearProgress()

    // -- now playing, with the buddy mod's pet beside it when one is on duty
    const held = await read($, { plugin: 'buddy', key: 'view' } as const).catch(() => undefined)
    const pet: PetView | null = held && typeof held === 'object' ? (held as PetView) : null
    sawPet(pet, now)
    const who = (pet && typeof pet.name === 'string' ? pet.name : lastPetName()) ?? 'Buddy'
    const textWidth = Math.max(10, width - (pet !== null ? PET_COLUMNS + 1 : 0))
    const volWidth = Math.max(6, Math.min(16, textWidth - 14))
    const volFilled = np && np.volume !== null ? Math.round((np.volume / 100) * volWidth) : 0
    const reaction = np === null ? `${who} is waiting for music` : !np.isPlaying ? `${who} is waiting for play` : `${who} is ${np.reaction}`
    const pos = np ? positionOf(np, now) : null
    const progress: Progress | null = np && np.durationMs !== null && pos !== null ? { pos, total: np.durationMs, isPlaying: np.isPlaying } : null
    const strip = stripFrame(width, progress)
    await startTimers($)
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
            return <Raster key={EQ_KEY} columns={strip.columns} rows={strip.rows} cells={strip.cells} />
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
                <Button
                  key="pet-it"
                  hotkey="h"
                  onPress={() => {
                    // Not $.command.run('/buddy pet'): a plugin's own run skips its own command.run hook, so nobody answered.
                    void petIt($).catch(() => undefined)
                  }}
                >
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
              value={np && np.contextUri && lists.some(one => one.uri === np.contextUri) ? np.contextUri : (defaultPlaylistUri() ?? undefined)}
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
    const nowPlayingRows = 2 + strip.rows + bubbleRows + (pet !== null ? PET_ROWS : 2) + 1 // title, artists, strip, bubble, pet or reaction and buttons, volume
    const otherRows = 1 + (show.playlists ? 1 + 3 : 0) + (show.notes ? 2 : 0) + (show.drinks ? (isMobile ? 2 : 3) : 0) + (show.session ? 5 : 0) + (show.usage ? 2 + Math.min(3, tel?.models.length ?? 0) : 0) + (line ? 1 : 0) + (e.props.isFocused ? 1 : 0) // rules, playlists, notes header and input, telemetry, usage, status, key hint
    const room = Math.max(2, rows - nowPlayingRows - otherRows)
    const recent = shown.slice(-room)
    const scopeLabel = scope === 'folder' ? shortCwd(ctx.cwd) : 'every folder'
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
              onPress={() => void toggleNotesScope($)}
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
    const note = captureNote()
    const fpsText = tel && tel.fps > 0 ? ` · ${tel.fps} fps` : ''
    const helperText = tel ? (tel.helper.status === 'running' ? `wasapi ${tel.helper.rate}/s · ${tel.helper.errors} err${fpsText}` : tel.helper.status === 'starting' ? 'wasapi starting…' : `wasapi stopped${note ? ` · ${note}` : ''}${fpsText}`) : 'wasapi …'
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

    // -- cups: coffee, tea and water today, the water goal as a bar
    const today = cups?.today ?? { day: '', coffee: 0, tea: 0, water: 0 }
    const goal = cups?.waterGoal ?? 8
    const waterWidth = Math.max(4, Math.min(12, width - 40))
    const waterFilled = Math.round((Math.min(goal, today.water) / Math.max(1, goal)) * waterWidth)
    const cupsBlock = (
      <Box flexDirection="column">
        <Text dimColor>{'─'.repeat(width)}</Text>
        <Box>
          <Text dimColor>cups </Text>
          <Text>{fit(`coffee ${today.coffee} · tea ${today.tea} · water ${today.water}/${goal} `, Math.max(8, width - 5 - waterWidth))}</Text>
          <Text color={today.water >= goal ? 'success' : 'suggestion'}>{'━'.repeat(waterFilled)}</Text>
          <Text dimColor>{'─'.repeat(Math.max(0, waterWidth - waterFilled))}</Text>
        </Box>
        {!isMobile && (
          <Box>
            <Text dimColor>{'     '}</Text>
            <Button key="cup-coffee" hotkey="c" onPress={() => void addDrink($, 'coffee')}>
              +coffee
            </Button>
            <Button key="cup-tea" hotkey="t" onPress={() => void addDrink($, 'tea')}>
              +tea
            </Button>
            <Button key="cup-water" hotkey="w" onPress={() => void addDrink($, 'water')}>
              +water
            </Button>
          </Box>
        )}
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
        {show.drinks && cupsBlock}
        {show.session && telemetryBlock}
        {show.usage && usageBlock}
        {line && <Text color="warning">{fit(line, width)}</Text>}
        {e.props.isFocused && <Text dimColor>{fit(signedIn ? 'Tab moves · h pet · p play/pause · n next · q/l volume · o open · r refresh · g scope · c/t/w cups · x restart eq · Esc' : 'Tab moves · o open track · r refresh · g scope · c/t/w cups · x restart eq · Esc back', width)}</Text>}
      </Box>
    )
  })
}
