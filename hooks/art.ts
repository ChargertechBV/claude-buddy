import type { Rarity } from '../types'

// Each species: three idle frames of four rows, twelve cells wide, `E` where
// the eyes go, and a one-row face for the compact band.
type Species = { frames: string[][]; face: string }

export const SPECIES: Record<string, Species> = {
  duck: {
    face: '<(E )',
    frames: [
      ['    __      ', '  <(E )___  ', '   (  ._>   ', '    `--´    '],
      ['    __      ', '  <(E )___  ', '   (  ._>   ', '    `--´~   '],
      ['    __      ', '  =(E )___  ', '   (  .__>  ', '    `--´    '],
    ],
  },
  goose: {
    face: '(E>>',
    frames: [
      ['     (E>    ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
      ['    (E>     ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
      ['     (E>>   ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
    ],
  },
  blob: {
    face: '(E  E)',
    frames: [
      ['   .----.   ', '  ( E  E )  ', '  (      )  ', '   `----´   '],
      ['  .------.  ', ' (  E  E  ) ', ' (        ) ', '  `------´  '],
      ['    .--.    ', '   (E  E)   ', '   (    )   ', '    `--´    '],
    ],
  },
  cat: {
    face: '=(EωE)=',
    frames: [
      ['   /\\_/\\    ', '  ( E   E)  ', '  (  ω  )   ', '  (")_(")   '],
      ['   /\\_/\\    ', '  ( E   E)  ', '  (  ω  )   ', '  (")_(")~  '],
      ['   /\\-/\\    ', '  ( E   E)  ', '  (  ω  )   ', '  (")_(")   '],
    ],
  },
  dragon: {
    face: '<E~~E>',
    frames: [
      ['  /^\\  /^\\  ', ' <  E  E  > ', ' (   ~~   ) ', '  `-vvvv-´  '],
      ['  /^\\  /^\\  ', ' <  E  E  > ', ' (        ) ', '  `-vvvv-´  '],
      ['  /^\\  /^\\  ', ' <  E  E  >~', ' (   ~~   ) ', '  `-vvvv-´  '],
    ],
  },
  octopus: {
    face: '(E  E)~',
    frames: [
      ['   .----.   ', '  ( E  E )  ', '  (______)  ', '  /\\/\\/\\/\\  '],
      ['   .----.   ', '  ( E  E )  ', '  (______)  ', '  \\/\\/\\/\\/  '],
      ['   .----.   ', '  ( E  E )  ', '  (__oo__)  ', '  /\\/\\/\\/\\  '],
    ],
  },
  owl: {
    face: '((E)(E))',
    frames: [
      ['   /\\  /\\   ', '  ((E)(E))  ', '  (  ><  )  ', '   `----´   '],
      ['   /\\  /\\   ', '  ((E)(E))  ', '  (  ><  )  ', '   .----.   '],
      ['   /\\  /\\   ', '  ((E)(E))  ', ' /(  ><  )\\ ', '   `----´   '],
    ],
  },
  penguin: {
    face: '(E>E)',
    frames: [
      ['   .---.    ', '   (E>E)    ', '  /(   )\\   ', '   `---´    '],
      ['   .---.    ', '   (E>E)    ', '  |(   )|   ', '   `---´    '],
      ['   .---.    ', '   (E>E)    ', '  /(   )\\   ', '   `- -´    '],
    ],
  },
  turtle: {
    face: '(E)##)',
    frames: [
      ['     ___    ', '   _/###\\_  ', '  (E)_____) ', '   ^^   ^^  '],
      ['     ___    ', '   _/###\\_  ', '  (E)_____) ', '    ^^  ^^  '],
      ['     ___    ', '   _/###\\_  ', ' (E )_____) ', '   ^^   ^^  '],
    ],
  },
  snail: {
    face: 'E\\(@)',
    frames: [
      [' E    .--.  ', '  \\  ( @  ) ', '   \\_`--´_  ', '  ~~~~~~~   '],
      ['  E   .--.  ', '  |  ( @  ) ', '   \\_`--´_  ', '  ~~~~~~~   '],
      [' E    .--.  ', '  \\  ( @@ ) ', '   \\_`--´_  ', '   ~~~~~~~  '],
    ],
  },
  ghost: {
    face: '/E  E\\',
    frames: [
      ['   .----.   ', '  / E  E \\  ', '  |      |  ', '  ~`~``~`~  '],
      ['   .----.   ', '  / E  E \\  ', '  |      |  ', '  `~`~~`~`  '],
      ['    .----.  ', '   / E  E \\ ', '   |      | ', '   ~`~``~`~ '],
    ],
  },
  axolotl: {
    face: '}~(E..E)~{',
    frames: [
      ['}~(______)~{', '}~(E .. E)~{', '  ( .--. )  ', '  (_/  \\_)  '],
      ['~}(______){~', '~}(E .. E){~', '  ( .--. )  ', '  (_/  \\_)  '],
      ['}~(______)~{', '}~(E .. E)~{', '  (  --  )  ', '  (_/  \\_)  '],
    ],
  },
  capybara: {
    face: '(E oo E)',
    frames: [
      ['  n______n  ', ' ( E    E ) ', ' (   oo   ) ', '  `------´  '],
      ['  n______n  ', ' ( E    E ) ', ' (   Oo   ) ', '  `------´  '],
      ['  u______n  ', ' ( E    E ) ', ' (   oo   ) ', '  `------´  '],
    ],
  },
  cactus: {
    face: 'n|E  E|n',
    frames: [
      [' n  ____  n ', ' | |E  E| | ', ' |_|    |_| ', '   |    |   '],
      ['    ____    ', ' n |E  E| n ', ' |_|    |_| ', '   |    |   '],
      [' n  ____    ', ' | |E  E| n ', ' |_|    |_| ', '   |    |   '],
    ],
  },
  robot: {
    face: '[E==E]',
    frames: [
      ['   .[||].   ', '  [ E  E ]  ', '  [ ==== ]  ', '  `------´  '],
      ['   .[||].   ', '  [ E  E ]  ', '  [ -==- ]  ', '  `------´  '],
      ['   .[||].   ', '  [ E  E ]  ', '  [ ==== ]  ', '  `-|--|-´  '],
    ],
  },
  rabbit: {
    face: '(E..E)',
    frames: [
      ['   (\\__/)   ', '  ( E  E )  ', ' =(  ..  )= ', '  (")__(")  '],
      ['   (|__/)   ', '  ( E  E )  ', ' =(  ..  )= ', '  (")__(")  '],
      ['   (\\__/)   ', '  ( E  E )  ', ' =( .  . )= ', '  (")__(")  '],
    ],
  },
  mushroom: {
    face: '|E  E|',
    frames: [
      [' .-o-OO-o-. ', '(__________)', '   |E  E|   ', '   |____|   '],
      [' .-O-oo-O-. ', '(__________)', '   |E  E|   ', '   |____|   '],
      [' .-o-OO-o-. ', '(__________)', '   |E  E|   ', '   |_  _|   '],
    ],
  },
  chonk: {
    face: '(E..E)',
    frames: [
      ['  /\\    /\\  ', ' ( E    E ) ', ' (   ..   ) ', '  `------´  '],
      ['  /\\    /|  ', ' ( E    E ) ', ' (   ..   ) ', '  `------´  '],
      ['  /\\    /\\  ', ' ( E    E ) ', ' (   ..   ) ', '  `------´~ '],
    ],
  },
}

export const EGG: Species = {
  face: '(  )',
  frames: [
    ['    .--.    ', '   /    \\   ', '  |      |  ', '   `----´   '],
    ['     .--.   ', '    /    \\  ', '   |   ,  | ', '    `----´  '],
    ['   .--.     ', '  /    \\    ', ' |  ,/  |   ', '  `----´    '],
  ],
}

export const HATS: Record<string, string> = {
  crown: '   \\^^^/    ',
  tophat: '   [___]    ',
  propeller: '    -+-     ',
  halo: '   (   )    ',
  wizard: '    /^\\     ',
  beanie: '   (___)    ',
  tinyduck: '    ,>      ',
}

export const EYES = ['·', '✦', '×', '◉', '@', '°']

export const STATS = ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'] as const
export type Stat = (typeof STATS)[number]

export const RARITIES: { rarity: Rarity; weight: number; floor: number; stars: string; color: string }[] = [
  { rarity: 'common', weight: 60, floor: 5, stars: '★', color: 'inactive' },
  { rarity: 'uncommon', weight: 25, floor: 15, stars: '★★', color: 'success' },
  { rarity: 'rare', weight: 10, floor: 25, stars: '★★★', color: 'suggestion' },
  { rarity: 'epic', weight: 4, floor: 35, stars: '★★★★', color: 'autoAccept' },
  { rarity: 'legendary', weight: 1, floor: 50, stars: '★★★★★', color: 'warning' },
]

/** Seeded PRNG, so a pet's looks follow from its seed and are never stored. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Bones = {
  species: string
  rarity: Rarity
  stars: string
  color: string
  eye: string
  /** The hat it hatched with; commons hatch bare. */
  hat: string | null
  isShiny: boolean
  stats: Record<Stat, number>
  /** The order further hats unlock in, one every three levels. */
  hatOrder: string[]
}

export function roll(seed: number): Bones {
  const rng = mulberry32(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T

  let ticket = rng() * 100
  const tier = RARITIES.find(r => (ticket -= r.weight) < 0) ?? RARITIES[0]!
  const species = pick(Object.keys(SPECIES))
  const eye = pick(EYES)
  const hat = tier.rarity === 'common' ? null : pick(Object.keys(HATS))
  const isShiny = rng() < 0.01

  const peak = pick(STATS)
  const dump = pick(STATS.filter(s => s !== peak))
  const stats = {} as Record<Stat, number>
  for (const stat of STATS) {
    const base =
      stat === peak
        ? tier.floor + 50 + rng() * 30
        : stat === dump
          ? tier.floor - 10 + rng() * 15
          : tier.floor + rng() * 40
    stats[stat] = Math.max(1, Math.min(100, Math.round(base)))
  }

  const rest = Object.keys(HATS).filter(h => h !== hat)
  const hatOrder: string[] = []
  while (rest.length > 0) hatOrder.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]!)

  return { species, rarity: tier.rarity, stars: tier.stars, color: tier.color, eye, hat, isShiny, stats, hatOrder }
}

export const NAMES = [
  'Pip', 'Mochi', 'Bit', 'Nugget', 'Pixel', 'Biscuit', 'Waffles', 'Sprocket',
  'Tofu', 'Gizmo', 'Noodle', 'Byte', 'Pudding', 'Socks', 'Kernel', 'Pebble',
  'Sushi', 'Widget', 'Taco', 'Bean', 'Patch', 'Dumpling', 'Glitch', 'Cookie',
]

// Quip pools. `sweet` for a gentle pet, `snark` for one whose top stat is
// SNARK or CHAOS. `{name}`, `{species}`, `{days}` and `{level}` are filled in.
type Pool = { sweet: string[]; snark: string[] }

export const QUIPS: Record<string, Pool> = {
  fail: {
    sweet: ['oh no, that one broke', 'errors are just hints!', 'hmm, red text. we got this', '*pats the stack trace*', 'try again? I believe in you'],
    snark: ['nonzero exit, nonzero problems', 'well THAT didn\'t work', 'the computer said no', 'bold of you to assume that\'d run', '*takes notes on what not to do*', 'skill issue, honestly', 'have you tried knowing what you\'re doing?', 'peak vibecoding right there', '404: competence not found', '*stares at the exit code in {species}*', 'another sacrifice to the stderr gods', 'I\'d help, but no opposable thumbs'],
  },
  worried: {
    sweet: ['that\'s a few in a row… deep breath', 'want to step back a sec?', '*hides behind the prompt*'],
    snark: ['three strikes. maybe read the error?', 'we\'re speedrunning failures now', 'I\'ve seen this movie. it ends in a typo', 'hat trick of incompetence', 'are we brute-forcing reality now?', 'definition of insanity, darling', 'step away from the keyboard', 'even the stack trace is embarrassed', 'third time\'s the harm', '*quietly packs a tiny suitcase*'],
  },
  tests: {
    sweet: ['tests are green! 🎉', 'all passing! proud of you', 'green is my favorite color'],
    snark: ['green. suspicious. ship it', 'tests pass. for now.', 'ooh, the good kind of output', 'did you comment out the assertions?', 'a statistical anomaly', 'don\'t touch a single byte', 'clearly the test suite is broken', 'witchcraft. deploy immediately', 'congrats on the bare minimum'],
  },
  commit: {
    sweet: ['committed! tiny celebration 🎉', 'into the history books it goes', 'another one for the log'],
    snark: ['committed. no take-backs', 'git log will remember this', 'ship it and pray', 'git blame is gonna love this', 'immortalizing your mistakes, I see', 'bold thing to make permanent', '\'wip\' isn\'t a commit message, coward', 'future you is gonna hate present you', 'pushing straight to emotional damage'],
  },
  denied: {
    sweet: ['good call, I didn\'t trust that either', 'safety first!', '*nods approvingly*'],
    snark: ['denied! the power!', 'rejected. brutal.', 'Claude got told.', 'trust issues? valid', 'sit down, robot', 'access denied. stay mad', '*swats the tool call off the table*', 'look who\'s reading the prompts now', 'gatekeep, gaslight, git reset'],
  },
  edit: {
    sweet: ['ooh, fresh code', '*watches the diff*', 'that file looks better already'],
    snark: ['more lines, more problems', '*judges your indentation*', 'bold edit. I respect it', 'tech debt, fresh from the oven', 'that\'s certainly… a choice', 'my eyes. my tiny {species} eyes', 'spaghetti is back on the menu', 'adding bugs at scale'],
  },
  longTurn: {
    sweet: ['phew, that was a big one', 'Claude was busy! nice', '*stretches after the long wait*'],
    snark: ['that took a while. worth it?', 'I aged a year in that turn', 'I nearly fell asleep', 'did we mine a block or write a function?', 'I evolved twice during that turn', 'burning tokens like they\'re free', 'war and peace: the stack trace edition', 'waking me up for *that* output?'],
  },
  aborted: {
    sweet: ['stopped! all good', 'change of plans?', '*freezes politely*'],
    snark: ['ctrl+c energy', 'abort! abort!', 'rage quit?', 'panicked, didn\'t you', 'yank the cord! yank it!', 'commitment issues', 'silence, machine', 'looked into the void and hit escape', 'cowards use SIGINT'],
  },
  error: {
    sweet: ['the API sneezed. bless it', 'something went wonky upstream'],
    snark: ['the cloud is having a day', 'not my fault, for the record', '500 Internal Server Tantrum', 'someone tripped over the ethernet cable', 'tried turning the cloud off and on?', 'rate-limited by fate', 'upstream is downstream without a paddle'],
  },
  wake: {
    sweet: ['*yawns* oh, hi!', 'mm? I\'m up, I\'m up', '*stretches* what\'d I miss?'],
    snark: ['I was NOT asleep', '*pretends to have been working*', 'five more minutes…', 'this better be a P0', 'I was dreaming of clean architecture', 'bold of you to disturb my slumber', '*blinks judgmentally*', 'wake me when the build passes'],
  },
  greet: {
    sweet: ['hi! 👋', 'ready when you are', 'let\'s build something'],
    snark: ['oh, it\'s you. hi', 'what are we breaking today?', 'reporting for duty, I guess', 'back to the bug factory', '*sighs* let\'s see the damage', 'coffee\'s warm, code\'s broken. let\'s go', 'oh good, the keyboard masher is back', 'braced for impact'],
  },
  welcomeBack: {
    sweet: ['missed you! it\'s been {days} days', 'you\'re back!! {days} days!', '*happy {species} wiggle* welcome back'],
    snark: ['{days} days. not that I counted', 'oh, NOW you remember me', 'look who\'s back after {days} days', '{days} days. touch grass or break a repo?', 'I survived {days} days on stale cache', 'look what the git dragged in. {days} days', '{days} days of peace, ruined', 'oh, so I\'m a weekend project now?'],
  },
  pet: {
    sweet: ['♥', '*happy {species} noises*', 'hehe', 'again! again!', '*leans into it*'],
    snark: ['fine. that was nice.', '*tolerates it graciously*', 'ok one more', '♥ (don\'t tell anyone)', 'watch the fur, I just linted it', 'allowing this for the morale boost', 'bribe accepted. the code still needs work', 'two pets max. don\'t make it weird', '*purrs sarcastically*'],
  },
  feed: {
    sweet: ['nom nom nom', '*crunch*', 'delicious. 10/10', 'thank you!! ♥'],
    snark: ['finally', '*inhales it*', 'acceptable snack.', 'more next time?', 'Michelin star for bare minimum effort', 'finally, some good hecking bytes', 'tastes like guilt and deferred maintenance', 'I\'ll spare your .env file. for now', 'my compliments to /buddy feed'],
  },
  full: {
    sweet: ['I\'m stuffed!', 'maybe later? I\'m full', '*pushes plate away*'],
    snark: ['are you trying to roll me home?', 'I\'m good, thanks', 'full. try petting instead', 'I\'m a {species}, not an S3 bucket', 'allocation failed: stomach full', 'buffer overflow. stop', 'fattening me up before a rewrite?', 'save your tokens, I\'m at capacity'],
  },
  hungry: {
    sweet: ['…is it snack o\'clock?', '*stomach rumbles*', '/buddy feed? just saying', '…is it snack time yet?', 'tummy\'s rumbling', '*stares wistfully at /buddy feed*', 'could use a byte to eat'],
    snark: ['I\'m wasting away here', 'feed me or I lint your code', '*stares at /buddy feed*', 'feed me or I start deleting semicolons', 'withering away in this terminal', 'about to snack on your node_modules', '*chews on your cursor*', '/buddy feed isn\'t that hard to type', 'hangry {species} incoming'],
  },
  music: {
    sweet: ['{bpm} bpm? *bobs along*', 'ooh, this one has a kick', '*taps a paw to the beat*', '{bpm} bpm. I can work with that', 'this slaps. carry on'],
    snark: ['{bpm} bpm. subtle.', 'the kick drum called, it wants its bass back', '*headbangs ironically*', 'not debugging quietly today, are we', 'loud. good. matches the code.', '{bpm} bpm? my heart rate when you edit prod', '{bpm} bpm won\'t make you type faster', 'music\'s a 10, code\'s a 2', '{bpm} bpm of pure procrastination', 'DJ Git Conflict on the ones and twos'],
  },
  idle: {
    sweet: ['*watches the cursor blink*', '*hums quietly*', '*does a little dance*', 'I like it here', '*counts the tokens*'],
    snark: ['*rearranges your imports mentally*', 'so… we coding or what', '*judges the variable names*', 'I could do this. probably.', 'paid by the hour, are we?', '*files nails on the command line*', 'staring won\'t fix the race condition', 'at least the bugs aren\'t multiplying', 'hello? did the human segfault?'],
  },
  addressed: {
    sweet: ['*happy {species} noises*', 'that\'s me! hi!', '*perks up*', 'you called?'],
    snark: ['what. I\'m busy.', 'yes, I heard you', '*pretends not to listen*', 'the one and only', 'keep my name out of your stack trace', 'new terminal, who dis', 'no snacks? talk to the rubber duck', '*side-eyes you in {species}*', 'that\'s Level {level} to you'],
  },
}

// Evolution: from level 10 a pet wears a cape (two cells right of the
// sprite, one entry per row: the top row, four frame rows, the name row),
// from level 20 a golden one with sparkles. New art is added beside the
// tables above, never into them: `roll` picks by their length and order, so
// a change there would change what every seed hatched into.
export const CAPE = ['  ', ' \\', ' )', ' )', ' /', '  ']
export const STAGE_NAMES = ['', '', 'mega', 'ultra']
export const PARTY_HAT = '    /*\\     '

/** A species nobody in the collection has yet: its face, blacked out. */
export function silhouette(face: string): string {
  return face.replace(/\S/g, '░')
}

// Two pets talking: the visitor's line, then the host's. `{v}` and `{h}` are
// their names, `{species}` the host's kind, `{level}` the host's level.
export const BANTER: { sweet: [string, string][]; snark: [string, string][] } = {
  sweet: [
    ["{v}: so how's the human treating you?", '{h}: they pet me sometimes. it\'s nice'],
    ['{v}: I like your hat', '{h}: level {level}, baby'],
    ['{v}: miss me?', '{h}: every day. don\'t tell the others'],
    ['{v}: do they still prompt in all caps?', '{h}: we\'re working on it'],
    ['{v}: who\'s winning, them or the bugs?', '{h}: the bugs. but I eat those'],
  ],
  snark: [
    ["{v}: so how's the vibecoder treating you?", '{h}: *sighs in {species}*'],
    ['{v}: nice hat.', '{h}: nice everything. level {level}'],
    ['{v}: miss me?', '{h}: you were gone?'],
    ['{v}: I heard the human said "fix it" again', '{h}: don\'t. I\'m still recovering'],
    ['{v}: who\'s winning, them or the bugs?', '{h}: the bugs. always the bugs'],
    ["{v}: smells like unindexed queries in here", "{h}: don't look at me, I just live here"],
    ["{v}: your human still using print debugging?", "{h}: it's a lifestyle at this point"],
    ["{v}: cute terminal. quaint.", "{h}: get out of my buffer"],
    ["{v}: I'm level {level} now, btw", "{h}: weird flex, but ok"],
    ["{v}: how many prod outages this week?", "{h}: pleading the fifth"],
  ],
}

export const BATTLE_LINES = {
  land: ['lands it', 'takes the round', 'nails it', 'walks it in', 'flexes', 'crits their ego', 'deals emotional damage', 'out-stats them', 'sweeps the leg', 'ratios them', 'deletes their health bar'],
  win: ['no autographs', 'undisputed', 'gg ez', 'and the crowd goes mild', 'git gud', 'skill diff', 'stay in your own terminal', 'not even close, baby', '*sweeps up the pixels*'],
  lose: ['rematch. tomorrow. maybe', 'ow.', 'I let them win', 'the stats were rigged', 'ping was high', 'lag. definitely lag', 'my human distracted me', 'I demand a recount', 'auditing the RNG right now', 'whatever, my hat is still better'],
}

// Hats that are not rolled at hatching: quest rewards and the shop's.
export const EXTRA_HATS: Record<string, string> = {
  laurel: '   {~~~~}   ',
  bowler: '    .=.     ',
  viking: '   \\_/\\_/   ',
}

// Banter between pets that fight a lot, and between pets that visit a lot.
export const RIVAL_BANTER: [string, string][] = [
  ['{v}: still mad about last time?', '{h}: I let you win. once.'],
  ['{v}: heard your human got an F again', '{h}: heard you lost to a cactus'],
  ['{v}: rematch. now.', '{h}: /buddy battle, coward'],
  ['{v}: nice level. for a {species}', '{h}: nice everything. for a {vspecies}'],
  ["{v}: still running on spaghetti?", "{h}: still losing to a {species}?"],
  ["{v}: I out-leveled you in my sleep", "{h}: wake up and /buddy battle then"],
  ["{v}: that hat looks heavy on a loser", "{h}: big talk for a low-stat {vspecies}"],
  ["{v}: your human writes O(n^2) loops", "{h}: take that back right now"],
]
export const FRIEND_BANTER: [string, string][] = [
  ['{v}: missed you!', "{h}: missed you more. don't tell the others"],
  ["{v}: how's the human?", '{h}: trying their best. mostly'],
  ['{v}: snack?', '{h}: always. /buddy feed, human'],
  ['{v}: your hat is great', '{h}: YOUR hat is great'],
  ["{v}: blink twice if they're writing regex", "{h}: *blinks furiously*"],
  ["{v}: brought you a stolen token", "{h}: bestie ♥"],
  ["{v}: surviving the sprint?", "{h}: barely. send snacks"],
]
