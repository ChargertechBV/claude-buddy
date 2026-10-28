// Daily quests: one per day, picked from the date, so every session that day
// agrees on it. Completing one pays XP; five days in a row earns the laurel.

export type Quest = { id: string; text: string; xp: number }

export const QUESTS: readonly Quest[] = [
  { id: 'green', text: 'get a green test run', xp: 15 },
  { id: 'body', text: 'write a commit message with a body (a second paragraph saying why)', xp: 20 },
  { id: 'path', text: 'send a prompt that names a file path', xp: 10 },
  { id: 'error', text: 'paste an actual error message into a prompt', xp: 15 },
  { id: 'pet', text: 'pet your pet three times', xp: 10 },
  { id: 'visit', text: 'have another pet over for a visit', xp: 10 },
  { id: 'battle', text: 'win a battle', xp: 20 },
  { id: 'diary', text: 'read the diary (/buddy journal)', xp: 5 },
  { id: 'feed', text: 'feed your pet when it is actually hungry (under half full)', xp: 10 },
  { id: 'fly', text: 'score 5 in Flappy Duck (/buddy play)', xp: 20 },
]

export function questFor(dayKey: string): Quest {
  let h = 7
  for (const ch of dayKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return QUESTS[h % QUESTS.length]!
}
