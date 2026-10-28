export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export type Mood =
  | 'hatching'
  | 'content'
  | 'happy'
  | 'excited'
  | 'worried'
  | 'hungry'
  | 'asleep'
  | 'anxious'
  | 'fighting'

export type VisitorKind = 'visit' | 'battle' | 'wild'

/** A second pet drawn beside the first: a visitor, a battle opponent or a wild shiny passing by. */
export type Visitor = {
  name: string
  species: string
  frames: string[][]
  face: string
  color: string
  eye: string
  hat: string
  isShiny: boolean
  stage: number
  kind: VisitorKind
}

/** What the band draws: everything the sprite module needs, as plain data. */
export type BuddyView = {
  name: string
  species: string
  rarity: Rarity
  stars: string
  color: string
  isShiny: boolean
  eye: string
  /** The hat row (12 cells), blank for none. */
  hat: string
  /** Idle frames, four rows each, `E` marking the eyes. */
  frames: string[][]
  /** The one-row face for the compact band, `E` marking the eyes. */
  face: string
  mood: Mood
  bubble: string | null
  bubbleId: number
  /** Counts pets; the sprite floats hearts when it goes up. */
  hearts: number
  level: number
  /** 1 plain, 2 caped (level 10), 3 golden (level 20). */
  stage: number
  visitor: Visitor | null
  /** Bugs crawling beside the pet, waiting for a green test run. */
  bugs: number
  /** 0 calm, 1 the context window is filling, 2 nearly full. */
  anxiety: number
  isVoid: boolean
  /** Drawn before the name: a ⚔ for a pet with the tiny sword. */
  flair: string
  isCompact: boolean
  /** One beat of the music the soundtrack mod hears, in ms; null (or absent on an older view) when none. The sprite bobs to it. */
  beatMs?: number | null
}


/** One pet in the pet house pane. */
export type HouseView = {
  id: string
  name: string
  species: string
  frames: string[][]
  color: string
  eye: string
  hat: string
  isShiny: boolean
  stage: number
  level: number
  isHere: boolean
  /** `rival`, `friend` or empty, relative to the pet on duty. */
  relation: string
}

/** What the Flappy Duck pane draws: the pilot, and the presses that reach the game through the band's buttons. */
export type GameView = {
  name: string
  face: string
  color: string
  isShiny: boolean
  flaps: number
  restarts: number
  high: number
}

// ---- the Soundtrack side

export type Track = { uri: string; name: string; artists: string[] }

/** The track Spotify reports, with what the mod worked out about it. */
export type NowPlaying = Track & {
  album: string | null
  url: string | null
  durationMs: number | null
  /** When this track was first seen playing. */
  since: number
  /** Spotify's own word (Web API) or a guess (connector: the track outlived its length). */
  isPlaying: boolean
  /** Position in the track when polled, Web API only. */
  progressMs: number | null
  /** When the poll that gave `progressMs` answered. */
  fetchedAt: number
  /** The device playing, Web API only. */
  device: string | null
  /** The device's volume, 0..100, Web API only; null when the device does not say. */
  volume: number | null
  /** What the track plays from (a playlist, album or artist URI), Web API only. */
  contextUri: string | null
  /** `api` once your own Spotify app answers; `connector` via the claude.ai connector. */
  source: 'api' | 'connector'
  /** 0 (asleep) to 1 (hardstyle), guessed from the title text. */
  energy: number
  /** What the pet is doing to it: headbanging, napping, ... */
  reaction: string
}

export type Playlist = { uri: string; name: string; owner: string; url: string | null }

export type Note = { id: string; at: number; text: string; cwd: string; track: Track | null }

export type Played = Track & { startedAt: number; endedAt: number | null }

export type NotesScope = 'folder' | 'global'

/** What the strip hears, published under `buddy.music`: the pet reads it to dance. */
export type Music = {
  isPlaying: boolean
  track: string | null
  artists: string[]
  /** 0 (asleep) to 1 (hardstyle), guessed from the title text. */
  energy: number
  reaction: string | null
  /** True while the Windows capture feeds real levels; the bass and tempo fields mean nothing otherwise. */
  isLive: boolean
  /** Kick-band (60 to 100 Hz) energy, 0..1, over the last seconds and the last ten minutes. */
  bassNow: number
  bass10m: number
  /** Tempo the kicks suggest, 65..200, or null when unsure or paused. */
  bpm: number | null
  /** One beat of that tempo in ms, or null. */
  beatMs: number | null
}

/** The session as the pane shows it: the engine's figures and what the hooks tallied. */
export type Telemetry = {
  /** Context window fill, 0..100, or null when the engine does not say. */
  contextPct: number | null
  costUsd: number | null
  callsPerMin: number
  /** Tool calls per minute over the last six minutes, oldest first. */
  spark: number[]
  /** Median duration of the last twenty tool calls. */
  latencyMs: number | null
  /** The most recently edited files with their added and removed line counts. */
  files: { path: string; plus: number; minus: number }[]
  filesTotal: number
  helper: { rate: number; errors: number; status: 'starting' | 'running' | 'stopped' }
  /** Strip frames drawn per second: up to 60 with live audio, 30 for the guessed animation or falling bars, 4 at rest. */
  fps: number
  /** Whether this build has a /diff command to open from the pane. */
  hasDiff: boolean
  /** The account's rate-limit windows as the last response reported them: five-hour first, then seven-day; empty off a subscription. */
  limits: UsageLimit[]
  /** Token counts per model over this session's requests, main thread and subagents, most requests first. */
  models: ModelTokens[]
}

/** What one model was asked and answered this session, summed from every request's reported usage. */
export type ModelTokens = {
  /** The id the API reports, e.g. `claude-fable-5-1`. */
  model: string
  requests: number
  /** Uncached input tokens. */
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** One plan window: `five_hour`, `seven_day` or a gateway's `spend_limit`, how much of it is used and when it resets. */
export type UsageLimit = {
  kind: string
  /** 0..100, past 100 on an exceeded spend limit. */
  percentUsed: number
  /** Reset time in epoch milliseconds, or null when the engine gave none. */
  resetsAt: number | null
}

/** Which optional parts of the pane are drawn; now playing is always there. */
export type Sections = {
  playlists: boolean
  notes: boolean
  /** The cups tracker: coffee, tea and water today. */
  drinks: boolean
  /** Context, cost, call rate, edited files and the capture helper. */
  session: boolean
  /** The plan's five-hour and weekly windows. */
  usage: boolean
}

export type DrinkKind = 'coffee' | 'tea' | 'water'

/** Cups of each kind on one local day, `2026-10-28`. */
export type DrinkDay = { day: string; coffee: number; tea: number; water: number }

/** The cups tracker as the pane shows it: today, the last seven days ending today, and the daily water goal. */
export type Drinks = { today: DrinkDay; week: DrinkDay[]; waterGoal: number }

declare module 'claude-code' {
  interface PluginState {
    buddy: {
      // the pet
      view: BuddyView | null
      isHidden: boolean
      activeId: string | null
      house: HouseView[] | null
      game: GameView | null
      // the Soundtrack side
      nowPlaying: Shaped<NowPlaying | null>
      playlists: Shaped<Playlist[]>
      notes: Shaped<Note[]>
      played: Shaped<Played[]>
      notesScope: NotesScope
      status: string | null
      /** Whether your own Spotify app is signed in (the auth file was read). */
      hasApi: boolean
      /** `live` while the Windows capture helper feeds the strip real levels; else `guess`. */
      eqMode: 'live' | 'guess'
      telemetry: Shaped<Telemetry | null>
      music: Shaped<Music | null>
      sections: Shaped<Sections>
      drinks: Shaped<Drinks | null>
    }
  }
}
