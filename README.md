# Buddy

Your terminal pet, back for good, and the Soundtrack pane it lives in. One Claude Code mod.

## The pet

A collection of terminal pets, one on duty each session. Each pet's looks follow from its seed, its name and personality from one small model call at hatching. A pet levels up as you work and evolves at 10 and 20, gets hungry over hours, naps when you are away, reacts to the session, judges your prompts and commits, eats the bugs your tests leave, gets visits from the others, fights them, keeps a diary, and answers by name. `/buddy` shows its card; `/buddy help` lists everything else: pets, house, battle, visit, catch, dex, quest, shop, badges, journal, judge, roast, review, news, play.

The pet is drawn in the Soundtrack pane beside the chat. Its band above the prompt is off by default; `/buddy show` turns it on.

## The Soundtrack pane

What it shows

- **Now playing**: track, artists, device, and whether the equaliser is live. Polled every 5 seconds from your own Spotify app, or every 15 seconds through the claude.ai connector when you have not signed in. A progress row with the position advances between polls.
- **Equaliser**: on WSL with Windows Python it is real. A helper captures what Windows is playing through WASAPI loopback and streams 96 log-spaced band levels, stamped with its own clock, about 60 times a second; the artists line says `live eq`. Without the helper the bars animate to Spotify's play state with an intensity guessed from the title, and the line says `eq guessed`. Three views, switched with `/soundtrack eq …` and remembered:
  - `bars`: eight rows of bars under a frequency axis from 60 Hz to 10 kHz. Two half-width bars per cell by default; `/soundtrack density 1` gives one bar per cell with finer height steps. Palettes with `/soundtrack colors rainbow|green|fire|vu|vertical`: rainbow colours by frequency, green is Spotify green into white, and fire, vu and vertical colour by height.
  - `3d`: a surface, frequency across and the last 1.6 seconds receding up and to the right in sixteen slices, loudness as height. Each bar has a bright half-row crest over a darker body; nearer slices stand in front.
  - `ridge`: the same slices as braille contours, 2×4 dots per cell, one connected dot-thick line per slice, nearer ridges hiding what lies behind; the front slice is filled up to its contour, so the live spectrum stands as bars with a bright edge.
  The 3D and ridge views colour by frequency, amber at the bass end to violet at the treble end, dimmer and cooler with depth, and loud points lift towards white.
- **Beat**: the kick band's energy is tracked and a tempo is estimated from its autocorrelation over eight seconds, 65 to 200 bpm, weighted towards a preferred tempo (140 by default, `/soundtrack beat prefer 150`) and held until a rival clearly wins. Once known, the artists line shows it, the progress row ends with a pulse that flashes on each kick and a four-count, and a beat grid nudged by each kick keeps the phase. `/soundtrack beat 120` sets how far ahead of the captured audio the pulse is drawn; `/soundtrack beat` reports the lead, the pipeline delay and the kick count. The count starts from the first kick heard, not the bar line.
- **The pet**: the pet on duty is drawn beside the controls: hat, blink, speech bubble, cape, shiny colours. On the beat it dances by the track's energy: a slow sway on quiet tracks, a bounce and sway on most, and on hard ones a bounce every beat with the head thrown the other way and sparks on the downbeats. `h` pets it. The band above the prompt is off by default now that the pet lives here; `/buddy show` brings it back, `/buddy hide` tucks it away again.
- **Controls**: `p` play or pause, `n` next, `o` opens the track in the Spotify app, `q` and `l` step the volume by five. From the prompt: `/play` resumes, `/pause`, `/skip`, `/skip back`, `/volume 40`, `/volume +10`. Playback and volume control need Spotify Premium; reading works on Free.
- **Playlists**: a picker over every playlist in your library, showing the one playing. Picking one, or `/play <name>`, starts it on your active device; with no active device the Spotify app is opened on it and you press play once. `r` refreshes, `/play list` lists them.
- **Vibe**: type a mood in the vibe field, or `/vibe <mood>`, and Spotify generates a private playlist which the mod starts. `/vibe clean` removes the ones it made. Generating goes through the claude.ai connector and needs Premium.
- **Notes**: a field at the bottom. Enter saves a note with the time and the current track; `/note <text>` does the same from the prompt. Notes are kept per project folder, `g` toggles a view across every folder, each row ends in a `×` that removes it, and `/notes`, `/notes global`, `/notes rm <n>`, `/notes rm last` and `/notes clear yes` work from the prompt. Two sessions can run at once: notes merge rather than overwrite.
- **Session telemetry**: context window fill with the session's cost, tool calls per minute with a six-minute sparkline and the median call duration, the files the agent edited with line deltas, and the capture helper's rate with a restart button (`x`). A `diff` button (`d`) appears when the build has a /diff command.
- **Plan usage**: the five-hour window as a bar with its percentage and the time until it resets, then the weekly window; both come from the engine's rate-limit readings, so an API key shows none. The row updates after every turn and whenever a window moves a point, a toast fires once as a window passes 90 %, and `/soundtrack usage` prints the figures. Under it, one row per model used this session: requests, input tokens (uncached plus cache writes), output tokens and tokens served from the prompt cache, summed from every model request's reported usage, subagents included. The tally survives a reload of the mod; a new session starts it over.
- **Choosing sections**: now playing is always drawn; playlists, notes, session and usage can each be dropped so the pane fits a short screen. `/soundtrack hide notes`, `/soundtrack show usage`, `/soundtrack hide all` and `/soundtrack sections` to see the choice, which is remembered across sessions.
- **Soundtrack log**: the session's tracks are logged. `/soundtrack playlist` asks Spotify for a playlist of what played during your longest stretch without a failing tool call.
- **The pet hears the music**: the strip publishes the playing state, the kick-band energy and the tempo under `buddy.music`; the pet bobs to it, gets excited over heavy bass, and remarks on a new track now and then.

The playlist it was built to, public for anyone who wants the same soundtrack: [brain.md](https://open.spotify.com/playlist/3lqHyrWCYZfwj45VwLElEE).

## Install

At the prompt of a terminal session:

```
/plugin install buddy --marketplace ChargertechBV/claude-buddy
```

Answer `y` to add the marketplace, then pick a scope (user is first). From a shell: `claude plugin install buddy --marketplace ChargertechBV/claude-buddy`. In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `ChargertechBV/claude-buddy`, then Add plugin.

## Setup

1. Connect the claude.ai Spotify connector (`/mcp`, sign in). This alone gives read-only mode.
2. For live position and control, create an app at developer.spotify.com/dashboard with the redirect URI `http://127.0.0.1:8765/callback` and Web API ticked, then run `python3 ~/claude-mods/buddy/tools/spotify-login.py <client id>`. It stores tokens in `~/.config/soundtrack/spotify-auth.json` (owner-only), which the mod reads and refreshes itself. The mod picks the file up within a minute, no restart needed.
3. For the live equaliser (WSL only): `python.exe -m pip install pyaudiowpatch numpy` on the Windows side. The mod starts `tools/eq-capture.py` with Windows Python at session start and restarts it if it stops. Nothing is recorded; the helper prints levels only.

Spotify deprecated its audio-features endpoints for new apps in November 2024, so tempo and energy are not available from Spotify; the live equaliser does not need them.


## Layout

`hooks/register.tsx` is the pet: its hooks, commands, moods, XP, visitors and panes, with `art.ts`, `badges.ts`, `battle.ts`, `calendar.ts`, `grading.ts`, `quests.ts`, `shop.ts`, and the band's and panes' surface modules `pet.tsx`, `house.tsx`, `game.tsx`. `hooks/soundtrack.tsx` is the Soundtrack side: Spotify, polling, notes, telemetry, the capture helper and the pane, registered from the pet's `register`. `hooks/strip.ts` draws the equaliser views, `hooks/sprite.ts` draws the pet in the pane, `hooks/beat.ts` tracks the kicks and the tempo, and `hooks/raster.ts` is what the drawings share.
