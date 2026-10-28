# Buddy

Your terminal pet, back for good, and the Soundtrack pane it lives in. One Claude Code mod.

**A playlist comes along.** The pane offers one public Spotify playlist of its own, [brain.md](https://open.spotify.com/playlist/3lqHyrWCYZfwj45VwLElEE), the one the mod was built to. It sits first in the playlist picker, next to your own playlists. Nothing plays unless you pick it, and it is never added to your Spotify library.

## Works best on

- **WSL on Windows, with Python on the Windows side**: everything, including the live equaliser, which captures what Windows plays, and the beat tracking built on it. Sound effects and speech go through Windows.
- **macOS and plain Linux**: the pet, Spotify control, playlists, notes, cups, telemetry and plan usage all work. The equaliser animates to a guess from the track instead, since the capture helper needs Windows. Sound effects and speech go through Claude Code's own audio.
- **Spotify**: reading what plays needs the claude.ai Spotify connector or your own free Spotify developer app; playback and volume control need Spotify Premium.
- **Plan usage** comes from a Claude subscription's rate limits; with an API key that row stays empty.

## The pet

A collection of terminal pets, one on duty each session. Each pet's looks follow from its seed, its name and personality from one small model call at hatching. A pet levels up as you work and evolves at 10 and 20, gets hungry over hours, naps when you are away, reacts to the session, judges your prompts and commits, eats the bugs your tests leave, gets visits from the others, fights them, keeps a diary, and answers by name. `/buddy` shows its card; `/buddy help` lists everything else: pets, house, battle, visit, catch, dex, quest, shop, badges, journal, judge, roast, review, news, play.

The pet is drawn in the Soundtrack pane beside the chat. Its band above the prompt is off by default; `/buddy show` turns it on.

## The Soundtrack pane

What it shows

- **Now playing**: track, artists, device, and whether the equaliser is live. Polled every 5 seconds from your own Spotify app, or every 15 seconds through the claude.ai connector when you have not signed in. A progress row with the position advances between polls.
- **Equaliser**: on WSL with Windows Python it is real. A helper captures what Windows is playing through WASAPI loopback and streams 96 log-spaced band levels, stamped with its own clock, about 60 times a second; the artists line says `live eq`. Without the helper the bars animate to Spotify's play state with an intensity guessed from the title, and the line says `eq guessed`; with the helper running, a quiet passage is drawn as quiet. The strip draws up to 60 frames a second while live audio plays, 30 while the bars are guessed or settling, and 4 at rest, so a paused pane costs little; the session rows show the rate. Three views, switched with `/soundtrack eq …` and remembered:
  - `bars`: eight rows of bars under a frequency axis from 60 Hz to 10 kHz. Two half-width bars per cell by default; `/soundtrack density 1` gives one bar per cell with finer height steps. Palettes with `/soundtrack colors rainbow|green|fire|vu|vertical`: rainbow colours by frequency, green is Spotify green into white, and fire, vu and vertical colour by height.
  - `3d`: a surface, frequency across and the last 1.6 seconds receding up and to the right in sixteen slices, loudness as height. Each bar has a bright half-row crest over a darker body; nearer slices stand in front.
  - `ridge`: the same slices as braille contours, 2×4 dots per cell, one connected dot-thick line per slice, nearer ridges hiding what lies behind; the front slice is filled up to its contour, so the live spectrum stands as bars with a bright edge.
  The 3D and ridge views colour by frequency, amber at the bass end to violet at the treble end, dimmer and cooler with depth, and loud points lift towards white.
- **Depth slices**: the 3D and ridge views take a new slice every three ticks (48 ms, about 20 a second), so the surface shows the last 0.8 s. `/soundtrack slices 1` pushes one every frame for a fast, short 0.3 s surface; `/soundtrack slices 6` slows it to 100 ms and 1.6 s; `/soundtrack slices` reports the setting, which is remembered.
- **Beat**: the kick band's energy is tracked and a tempo is estimated from its autocorrelation over eight seconds, 65 to 200 bpm, weighted towards a preferred tempo (140 by default, `/soundtrack beat prefer 150`) and held until a rival clearly wins. Once known, the artists line shows it, the progress row ends with a pulse that flashes on each kick and a four-count, and a beat grid nudged by each kick keeps the phase. `/soundtrack beat 120` sets how far ahead of the captured audio the pulse is drawn; `/soundtrack beat` reports the lead, the pipeline delay and the kick count. The count starts from the first kick heard, not the bar line.
- **The pet**: the pet on duty is drawn beside the controls: hat, blink, speech bubble, cape, shiny colours. On the beat it dances by the track's energy: a slow sway on quiet tracks, a bounce and sway on most, and on hard ones a bounce every beat with the head thrown the other way and sparks on the downbeats. `h` pets it. The band above the prompt is off by default now that the pet lives here; `/buddy show` brings it back, `/buddy hide` tucks it away again.
- **Controls**: `p` play or pause, `n` next, `o` opens the track in the Spotify app, `q` and `l` step the volume by five. From the prompt: `/soundtrack play` resumes, `/soundtrack pause`, `/soundtrack skip`, `/soundtrack skip back`, `/soundtrack volume 40`, `/soundtrack volume +10`. Playback and volume control need Spotify Premium; reading works on Free.
- **Playlists**: a picker over the built-in brain.md and every playlist in your library, showing the one playing, or brain.md when nothing plays from a listed one. Picking one, or `/soundtrack play <name>`, starts it on your active device; with no active device the Spotify app is opened on it and you press play once. `r` refreshes, `/soundtrack play list` lists them.
- **Vibe**: type a mood in the vibe field, or `/soundtrack vibe <mood>`, and Spotify generates a private playlist which the mod starts. `/soundtrack vibe clean` removes the ones it made. Generating goes through the claude.ai connector and needs Premium.
- **Notes**: a field at the bottom. Enter saves a note with the time and the current track; `/soundtrack note <text>` does the same from the prompt. Notes are kept per project folder, `g` toggles a view across every folder, each row ends in a `×` that removes it, and `/soundtrack notes`, `notes global`, `notes rm <n>`, `notes rm last` and `notes clear yes` work from the prompt. Two sessions can run at once: notes merge rather than overwrite.
- **Cups**: coffee, tea and water today, with the water goal as a bar. `c`, `t` and `w` add a cup, as do `/soundtrack drink coffee`, `drink tea 2` and `drink water`; `drink water -1` or `drink undo` takes one back, `drink goal 10` sets the daily water goal (8 by default), and `/soundtrack drinks` shows the last seven days and their averages. A toast marks the water goal once a day. Counts live in the store per local day, so every session adds to the same tally.
- **Short commands**: `/play`, `/pause`, `/skip`, `/volume`, `/vibe`, `/note`, `/notes` and `/drink` run the same verbs without the `/soundtrack` in front. A new install starts without them, so the mod takes no common command names unasked; `/soundtrack shortcuts on` turns them on, and an install that already had Soundtrack data keeps them.
- **Session telemetry**: context window fill with the session's cost, tool calls per minute with a six-minute sparkline and the median call duration, the files the agent edited with line deltas, and the capture helper's rate and the strip's frame rate with a restart button (`x`). A `diff` button (`d`) appears when the build has a /diff command.
- **Plan usage**: the five-hour window as a bar with its percentage and the time until it resets, then the weekly window; both come from the engine's rate-limit readings, so an API key shows none. The row updates after every turn and whenever a window moves a point, a toast fires once as a window passes 90 %, and `/soundtrack usage` prints the figures. Under it, one row per model used this session: requests, input tokens (uncached plus cache writes), output tokens and tokens served from the prompt cache, summed from every model request's reported usage, subagents included. The tally survives a reload of the mod; a new session starts it over.
- **Choosing sections**: now playing is always drawn; playlists, notes, drinks, session and usage can each be dropped so the pane fits a short screen. `/soundtrack hide notes`, `/soundtrack show usage`, `/soundtrack hide all` and `/soundtrack sections` to see the choice, which is remembered across sessions.
- **Soundtrack log**: the session's tracks are logged. `/soundtrack playlist` asks Spotify for a playlist of what played during your longest stretch without a failing tool call.
- **The pet hears the music**: the strip publishes the playing state, the kick-band energy and the tempo under `buddy.music`; the pet bobs to it, gets excited over heavy bass, and remarks on a new track now and then.

## Install

At the prompt of a terminal session:

```
/plugin install buddy --marketplace ChargertechBV/claude-buddy
```

Answer `y` to add the marketplace, then pick a scope (user is first). From a shell: `claude plugin install buddy --marketplace ChargertechBV/claude-buddy`. In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `ChargertechBV/claude-buddy`, then Add plugin.

## Setup

1. Connect the claude.ai Spotify connector (`/mcp`, sign in). This alone gives read-only mode.
2. For live position and control, create an app at developer.spotify.com/dashboard with the redirect URI `http://127.0.0.1:8765/callback` and Web API ticked, then run the sign-in script with its client id: `python3 <mod folder>/tools/spotify-login.py <client id>`. `/soundtrack` prints the command with the folder filled in. It stores tokens in `~/.config/soundtrack/spotify-auth.json` (owner-only), which the mod reads and refreshes itself. The mod picks the file up within a minute, no restart needed.
3. For the live equaliser (WSL only): `python.exe -m pip install pyaudiowpatch numpy` on the Windows side. The mod starts `tools/eq-capture.py` with Windows Python at session start and restarts it if it stops; `x` in the pane restarts it by hand. Nothing is recorded; the helper prints levels only.

Spotify deprecated its audio-features endpoints for new apps in November 2024, so tempo and energy are not available from Spotify; the live equaliser does not need them.

## Layout

The entry is `hooks/register.tsx`: the hook wiring for both halves and the pet's renders.

The pet:

- `buddy-state.ts`: the pet's types, timings, defaults, the session's picture of the pet, small helpers.
- `buddy-life.ts`: loading the collection, hatching and choosing a pet, the band's view, care, levels, stats, hats.
- `buddy-voice.ts`: the bubble, the voice its stats give it, model calls, answering by name, sound and speech.
- `buddy-judge.ts`: judging prompts, commit messages and Claude's answers, roasts, reviews, the Friday ceremony, the prompt doctor.
- `buddy-loop.ts`: reactions to tool calls and turns, the periodic tick, the context window, bugs.
- `buddy-social.ts`: visitors, wild shinies, battles, rivals and friends, notes between pets.
- `buddy-world.ts`: AI news, git, the journal, quests, the shop, the pet house and Flappy Duck.
- `buddy-commands.ts`: `/buddy`, the card, export and import.
- Data and pictures: `art.ts`, `badges.ts`, `battle.ts`, `calendar.ts`, `grading.ts`, `quests.ts`, `shop.ts`, and the surface modules `pet.tsx`, `house.tsx`, `game.tsx`.

The Soundtrack pane:

- `soundtrack.tsx`: its session start, the hook wiring and the pane.
- `soundtrack-commands.ts`: `/soundtrack` and its verbs, the sections, the short commands.
- `spotify.ts`: sign-in, the Web API and the connector, polling, playback, playlists, vibes.
- `notes.ts`, `drinks.ts`, `telemetry.ts`: notes, cups, and the session and plan figures.
- `capture.ts`: the Windows capture helper and the music value published for the pet.
- `eq.ts`: the strip's adaptive frame loop, its settings, the pet's dance in the pane.
- `strip.ts` draws the equaliser views, `sprite.ts` the pet in the pane, `beat.ts` tracks the kicks and the tempo, `raster.ts` is what the drawings share, `shared.ts` what the pane's files share.

Each atom is declared in the one file that writes it; other files read it through that file's `…Of($)` function, since the engine reads and writes an atom only where it is declared.

Tests: `claude plugin test .` runs them. `tests/beat.test.ts` checks the tempo on synthetic kicks and on a recorded clip in `tests/fixtures/`.

## License

MIT, in [LICENSE](LICENSE): anyone may use, copy, change and share the mod, as long as the license text goes with it. It comes as is, without any warranty, and its authors are not liable for anything that comes from using it.
