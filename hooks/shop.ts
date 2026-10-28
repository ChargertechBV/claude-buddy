// The hat shop: bug coins (one per bug eaten) buy cosmetics for the whole
// collection; each pet wears what it likes.

export type Item = { id: string; name: string; price: number; kind: 'hat' | 'eye' | 'sword'; value: string; hint: string }

export const SHOP: readonly Item[] = [
  { id: 'monocle', name: 'Monocle', price: 15, kind: 'eye', value: '◎', hint: 'a distinguished eye' },
  { id: 'sparkle', name: 'Sparkle eyes', price: 25, kind: 'eye', value: '✧', hint: 'starry-eyed' },
  { id: 'bowler', name: 'Bowler hat', price: 20, kind: 'hat', value: 'bowler', hint: 'understated' },
  { id: 'viking', name: 'Viking helmet', price: 40, kind: 'hat', value: 'viking', hint: 'horns, for battles' },
  { id: 'sword', name: 'Tiny sword', price: 30, kind: 'sword', value: 'sword', hint: '+3 luck on every battle round, and a ⚔ by the name' },
]

export const itemOf = (id: string): Item | undefined => SHOP.find(i => i.id === id)
