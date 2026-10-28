// Achievements: the catalogue. Which moment earns one is decided where it
// happens (in register.tsx); a hidden badge shows as ??? until it is earned.

export type Badge = { id: string; name: string; hint: string; isHidden?: true }

export const BADGES: readonly Badge[] = [
  { id: 'first-green', name: 'First green', hint: 'your first passing test run' },
  { id: 'marathon', name: 'Marathon', hint: 'a turn that ran for over 10 minutes' },
  { id: 'night-owl', name: 'Night owl', hint: 'a commit between 2 and 5 in the morning' },
  { id: 'early-bird', name: 'Early bird', hint: 'a prompt between 5 and 7 in the morning' },
  { id: 'clean-day', name: 'Zero-error day', hint: 'a session of 20+ tool calls without a single failure' },
  { id: 'comeback', name: 'Comeback', hint: 'five failures in a row, then a success' },
  { id: 'bug-eater', name: 'Bug eater', hint: '10 bugs eaten' },
  { id: 'exterminator', name: 'Exterminator', hint: '100 bugs eaten' },
  { id: 'dunce', name: 'Dunce cap', hint: 'an F on a prompt' },
  { id: 'honor-roll', name: 'Honor roll', hint: 'a prompting GPA of 3.5 or better over 10 judged prompts' },
  { id: 'socialite', name: 'Socialite', hint: 'talked to your pets 25 times' },
  { id: 'big-brain', name: 'Big brain', hint: 'asked for a /buddy review' },
  { id: 'champion', name: 'Champion', hint: 'won 5 battles' },
  { id: 'shiny-hunter', name: 'Shiny hunter', hint: 'caught a wild shiny' },
  { id: 'full-house', name: 'Full house', hint: '10 pets in the collection' },
  { id: 'committed', name: 'Committed', hint: '50 commits' },
  { id: 'insomniac', name: 'Insomniac', hint: 'a session longer than 4 hours' },
  { id: 'evolved', name: 'Evolved', hint: 'a pet reached stage 2' },
  { id: 'pilot', name: 'Pilot', hint: 'scored 10 in Flappy Duck' },
  { id: 'ace', name: 'Ace', hint: 'scored 30 in Flappy Duck' },
  { id: 'whisperer', name: 'Whisperer', hint: 'petted one pet 50 times in a session', isHidden: true },
  { id: 'duck-whisperer', name: 'Duck whisperer', hint: 'quacked at your pet', isHidden: true },
]

export const badgeOf = (id: string): Badge | undefined => BADGES.find(b => b.id === id)
