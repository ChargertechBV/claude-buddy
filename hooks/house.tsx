import type { ClientSurface, RenderElement } from 'claude-code'

import type { HouseView } from '../types'

// The pet house: the whole collection at once, each pet idling in its own
// corner, the one on duty starred.

type Props = { pets: HouseView[]; columns: number }
type Local = { tick: number }

const TICK_MS = 500
const IDLE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0]
const RAINBOW = ['#ff6b6b', '#ffb36b', '#ffe66b', '#7bea8a', '#6bb8ff', '#b48cff']
const CAPE = ['  ', ' \\', ' )', ' )', ' /', '  ']
const SPRITE_COLUMNS = 12
const BLANK = ['            ', '            ', '            ', '            ']

export default function House(props: Props, surface: ClientSurface<Local>): RenderElement {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (now !== undefined) surface.setState({ tick: now.tick + 1 })
    })
    surface.setState({ tick: 0 })
  }
  const tick = surface.state?.tick ?? 0
  if (props.pets.length === 0) return <Text dimColor>Nobody home yet.</Text>

  const perRow = Math.max(1, Math.floor((props.columns + 2) / 17))
  const rows: HouseView[][] = []
  for (let i = 0; i < props.pets.length; i += perRow) rows.push(props.pets.slice(i, i + perRow))

  const card = (p: HouseView, i: number) => {
    const step = IDLE[(tick + i * 3) % IDLE.length] ?? 0
    const frame = p.frames[Math.max(0, step)] ?? p.frames[0] ?? BLANK
    const eye = step === -1 ? '-' : p.eye
    const hasCape = p.stage >= 2
    const width = SPRITE_COLUMNS + (hasCape ? 2 : 0)
    const capeColor = p.stage >= 3 ? 'warning' : 'error'
    const color = (row: number) => (p.isShiny ? (RAINBOW[(row + tick) % RAINBOW.length] ?? p.color) : p.color)
    const label = p.isHere ? `★ ${p.name}` : p.name
    const under = `lvl ${p.level}${p.relation.length > 0 ? ` · ${p.relation}` : ''}`
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row">
          <Text color={p.color}>{p.hat.padEnd(SPRITE_COLUMNS)}</Text>
          {hasCape && <Text color={capeColor}>{CAPE[0]}</Text>}
        </Box>
        {frame.map((row, r) => (
          <Box flexDirection="row">
            <Text color={color(r)} bold={p.stage >= 3}>
              {row.replaceAll('E', eye)}
            </Text>
            {hasCape && <Text color={capeColor}>{CAPE[r + 1]}</Text>}
          </Box>
        ))}
        <Text color={p.color} bold wrap="truncate-end">
          {center(label, width)}
        </Text>
        <Text dimColor wrap="truncate-end">
          {center(under, width)}
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {rows.map((group, r) => (
        <Box flexDirection="row" gap={3}>
          {group.map((p, i) => card(p, r * perRow + i))}
        </Box>
      ))}
    </Box>
  )
}

function center(text: string, width: number): string {
  if (text.length >= width) return text
  const left = Math.floor((width - text.length) / 2)
  return (' '.repeat(left) + text).padEnd(width)
}
