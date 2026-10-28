import { STATS } from './art'
import type { Stat } from './art'

// A battle: three rounds, each on a different stat, each side's stat plus a
// little luck (0-39). Ties go to the higher bare stat, then to the home pet.

export type Fighter = { name: string; stats: Record<Stat, number> }
export type Round = { stat: Stat; a: number; b: number; winner: 'a' | 'b' }
export type Bout = { rounds: Round[]; winner: 'a' | 'b'; score: [number, number] }

export function fight(a: Fighter, b: Fighter, rng: () => number): Bout {
  const deck = [...STATS]
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
  }
  const rounds = deck.slice(0, 3).map((stat): Round => {
    const sa = a.stats[stat] + Math.floor(rng() * 40)
    const sb = b.stats[stat] + Math.floor(rng() * 40)
    const winner = sa > sb ? 'a' : sb > sa ? 'b' : a.stats[stat] >= b.stats[stat] ? 'a' : 'b'
    return { stat, a: sa, b: sb, winner }
  })
  const score: [number, number] = [rounds.filter(r => r.winner === 'a').length, rounds.filter(r => r.winner === 'b').length]

  return { rounds, winner: score[0] >= score[1] ? 'a' : 'b', score }
}
