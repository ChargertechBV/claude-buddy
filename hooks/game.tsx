import type { ClientSurface, RenderElement } from 'claude-code'

import type { GameView } from '../types'

// Flappy Duck: the pet flies through pipes on the surface's own frame clock.
// Space, up or return flaps once the region has the keys (a click gives
// them); the band's buttons reach it through `flaps` and `restarts`, which
// the hooks module counts up. A finished run is posted to the hooks once.

type Props = GameView & { columns: number }
type Pipe = { x: number; gap: number; hasBug: boolean; isPassed: boolean }
type Local = {
  tick: number
  y: number
  vy: number
  pipes: Pipe[]
  score: number
  bugs: number
  isRunning: boolean
  isOver: boolean
  isPosted: boolean
  best: number
  flapsSeen: number
  restartsSeen: number
}

const TICK_MS = 120
const H = 12
const DUCK_X = 6
const GRAVITY = 0.28
const FLAP = -1.5
const PIPE_EVERY = 16
const GAP = 4
const RAINBOW = ['#ff6b6b', '#ffb36b', '#ffe66b', '#7bea8a', '#6bb8ff', '#b48cff']

function fresh(props: Props, best: number): Local {
  return {
    tick: 0,
    y: 5,
    vy: 0,
    pipes: [],
    score: 0,
    bugs: 0,
    isRunning: false,
    isOver: false,
    isPosted: false,
    best,
    flapsSeen: props.flaps,
    restartsSeen: props.restarts,
  }
}

function flap(s: Local): Local {
  if (s.isOver) return s
  return { ...s, isRunning: true, vy: FLAP }
}

function step(s: Local, width: number): Local {
  const tick = s.tick + 1
  if (!s.isRunning || s.isOver) return { ...s, tick }
  const vy = s.vy + GRAVITY
  const y = s.y + vy
  const row = Math.round(y)
  const pipes = s.pipes.map(p => ({ ...p, x: p.x - 1 })).filter(p => p.x > -3)
  if (tick % PIPE_EVERY === 0) {
    pipes.push({ x: width - 1, gap: 1 + Math.floor(Math.random() * (H - GAP - 2)), hasBug: Math.random() < 0.4, isPassed: false })
  }
  let score = s.score
  let bugs = s.bugs
  let isOver = row < 0 || row >= H
  for (const p of pipes) {
    const overlaps = p.x <= DUCK_X + 4 && p.x + 1 >= DUCK_X
    if (overlaps) {
      const inGap = row >= p.gap && row < p.gap + GAP
      if (!inGap) isOver = true
      else if (p.hasBug && row === p.gap + 2) {
        p.hasBug = false
        bugs += 1
      }
    }
    if (!p.isPassed && p.x + 1 < DUCK_X) {
      p.isPassed = true
      score += 1
    }
  }

  return { ...s, tick, y, vy, pipes, score, bugs, isOver }
}

export default function Game(props: Props, surface: ClientSurface<Local>): RenderElement {
  const { Box, Text } = surface.elements
  const width = Math.max(30, Math.min(70, props.columns))
  let local = surface.state

  if (local === undefined) {
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (now !== undefined) surface.setState(step(now, width))
    })
    surface.onKey(event => {
      const now = surface.state
      if (now === undefined) return
      if (event.key === ' ' || event.key === 'space' || event.key === 'up' || event.key === 'return') surface.setState(flap(now))
      else if (event.key === 'r') surface.setState(fresh(props, now.best))
    })
    local = fresh(props, props.high)
    surface.setState(local)
  } else if (props.flaps !== local.flapsSeen) {
    local = { ...flap(local), flapsSeen: props.flaps }
    surface.setState(local)
  } else if (props.restarts !== local.restartsSeen) {
    local = { ...fresh(props, local.best), restartsSeen: props.restarts }
    surface.setState(local)
  } else if (local.isOver && !local.isPosted) {
    surface.post({ type: 'over', score: local.score, bugs: local.bugs })
    local = { ...local, isPosted: true, best: Math.max(local.best, local.score) }
    surface.setState(local)
  }

  // The scene as cells, then each row as runs of one kind.
  const cells: string[][] = Array.from({ length: H }, () => Array.from({ length: width }, () => ' '))
  const kinds: string[][] = Array.from({ length: H }, () => Array.from({ length: width }, () => 'sky'))
  for (const p of local.pipes) {
    for (const x of [p.x, p.x + 1]) {
      if (x < 0 || x >= width) continue
      for (let r = 0; r < H; r++) {
        if (r >= p.gap && r < p.gap + GAP) continue
        cells[r]![x] = '█'
        kinds[r]![x] = 'pipe'
      }
    }
    const bugRow = p.gap + 2
    if (p.hasBug && p.x >= 0 && p.x + 1 < width && bugRow < H) {
      cells[bugRow]![p.x] = '🐛'
      cells[bugRow]![p.x + 1] = ''
      kinds[bugRow]![p.x] = 'bug'
      kinds[bugRow]![p.x + 1] = 'bug'
    }
  }
  const duckRow = Math.max(0, Math.min(H - 1, Math.round(local.y)))
  const face = [...props.face].slice(0, 6)
  face.forEach((ch, i) => {
    const x = DUCK_X + i
    if (x < width) {
      cells[duckRow]![x] = ch
      kinds[duckRow]![x] = 'duck'
    }
  })

  const rows = cells.map((row, r) => {
    const runs: { kind: string; text: string }[] = []
    row.forEach((ch, x) => {
      const kind = kinds[r]![x] ?? 'sky'
      const last = runs[runs.length - 1]
      if (last !== undefined && last.kind === kind) last.text += ch
      else runs.push({ kind, text: ch })
    })
    return (
      <Box flexDirection="row">
        {runs.map(run => (
          <Text color={run.kind === 'pipe' ? 'success' : run.kind === 'duck' ? (props.isShiny ? (RAINBOW[(r + local!.tick) % RAINBOW.length] ?? props.color) : props.color) : undefined} bold={run.kind === 'duck'}>
            {run.text}
          </Text>
        ))}
      </Box>
    )
  })

  const status = local.isOver
    ? `GAME OVER · score ${local.score} · 🐛 ${local.bugs} · r or [restart] to go again`
    : local.isRunning
      ? `score ${local.score} · 🐛 ${local.bugs} · best ${local.best}`
      : `f, or click the sky and press space, to start · best ${local.best}`

  return (
    <Box flexDirection="column">
      <Text bold color={props.color}>
        Flappy {props.name}
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" width={width + 2}>
        {rows}
      </Box>
      <Text dimColor wrap="truncate-end">
        {status}
      </Text>
    </Box>
  )
}
