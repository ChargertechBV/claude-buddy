import type { ClientSurface, RenderElement } from 'claude-code'

import type { BuddyView, Visitor } from '../types'

// The band's sprites, drawn on the surface's own frame clock: the pet blinks
// and fidgets between redraws of the hooks module, floats hearts when it is
// petted, sweats when the context window fills, and a click on it is a pet.
// Beside it may stand a visitor, a battle opponent, or a wild shiny walking
// in from the left; bugs wait on the ground for a green test run.

type Props = BuddyView & { columns: number; isWorking: boolean }
type Local = { tick: number; heartsSeen: number; heartsUntil: number; wildSince: number | null }

const TICK_MS = 500
// Frame per tick while idle; -1 is a blink on frame 0.
const IDLE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0]
const BUSY = [0, 1, 0, 2, 0, 1, -1, 2]
const HEARTS = ['   ♥    ♥   ', '  ♥  ♥   ♥  ', ' ♥    ♥    ♥', '    ♥   ♥   ']
const ZZZ = ['        z   ', '         Z  ', '          z ']
const SWEAT = ["  '    '    ", "   '  '     ", " '      '   "]
const RAINBOW = ['#ff6b6b', '#ffb36b', '#ffe66b', '#7bea8a', '#6bb8ff', '#b48cff']
const CAPE = ['  ', ' \\', ' )', ' )', ' /', '  ']
const SPRITE_COLUMNS = 12
const BLANK = ['            ', '            ', '            ', '            ']

type Look = { name: string; frames: string[][]; color: string; eye: string; hat: string; isShiny: boolean; stage: number }

// The sprite's clock: every TICK_MS idle, or every beat while the soundtrack mod hears one.
let stopTicking: (() => void) | null = null
let tickingEvery = 0

export default function Pet(given: Props, surface: ClientSurface<Local>): RenderElement {
  const { Box, Text } = surface.elements
  // A view published by an older load of the mod may lack the newer fields.
  const props: Props = {
    ...given,
    visitor: given.visitor ?? null,
    bugs: given.bugs ?? 0,
    anxiety: given.anxiety ?? 0,
    stage: given.stage ?? 1,
    isVoid: given.isVoid === true,
    bubble: given.bubble ?? null,
    flair: given.flair ?? '',
  }
  const local = surface.state
  const wild = props.visitor?.kind === 'wild'

  const beatMs = typeof props.beatMs === 'number' && props.beatMs >= 250 && props.mood !== 'asleep' ? props.beatMs : null
  const wantEvery = beatMs ?? TICK_MS
  if (local === undefined || wantEvery !== tickingEvery) {
    if (stopTicking !== null) stopTicking()
    tickingEvery = wantEvery
    stopTicking = surface.every(wantEvery, () => {
      const now = surface.state
      if (now !== undefined) surface.setState({ ...now, tick: now.tick + 1 })
    })
  }
  if (local === undefined) {
    surface.onPointer(event => {
      if (event.type === 'down') surface.post({ type: 'pet' })
    })
    surface.setState({ tick: 0, heartsSeen: props.hearts, heartsUntil: 0, wildSince: wild ? 0 : null })
  } else if (props.hearts !== local.heartsSeen) {
    surface.setState({ ...local, heartsSeen: props.hearts, heartsUntil: local.tick + 6 })
  } else if (wild && local.wildSince === null) {
    surface.setState({ ...local, wildSince: local.tick })
  } else if (!wild && local.wildSince !== null) {
    surface.setState({ ...local, wildSince: null })
  }

  const tick = local?.tick ?? 0
  const isAsleep = props.mood === 'asleep'
  const isLively = props.isWorking || props.mood === 'excited' || props.mood === 'happy' || props.mood === 'fighting' || beatMs !== null
  const step = isAsleep ? 0 : ((isLively ? BUSY : IDLE)[tick % (isLively ? BUSY : IDLE).length] ?? 0)
  const eye = isAsleep || step === -1 ? '-' : props.anxiety > 0 ? '@' : props.mood === 'worried' ? '°' : props.eye
  const showHearts = local !== undefined && tick < local.heartsUntil
  const topRow = showHearts
    ? (HEARTS[tick % HEARTS.length] ?? '')
    : isAsleep
      ? (ZZZ[Math.floor(tick / 2) % ZZZ.length] ?? '')
      : props.anxiety > 0
        ? (SWEAT[tick % SWEAT.length] ?? '')
        : props.hat
  const topColor = showHearts ? 'error' : isAsleep ? 'subtle' : props.anxiety > 0 ? 'suggestion' : props.color
  const me: Look = { ...props, frames: props.isVoid ? [BLANK] : props.frames }
  const nameRow = props.isVoid ? '404 not found' : `${props.flair}${props.stage >= 3 ? `✦ ${props.name} ✦` : props.name}`

  if (props.isCompact) {
    const face = (props.isVoid ? '(   )' : props.face).replaceAll('E', eye)
    const tail = showHearts ? ' ♥' : isAsleep ? ' zZz' : props.anxiety > 0 ? " '" : ''
    const bugs = props.bugs > 0 ? `🐛×${props.bugs}` : ''
    const guest = props.visitor === null ? '' : `+ ${props.visitor.face.replaceAll('E', props.visitor.eye)} ${props.visitor.name}`
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={lineColor(me, 0, tick)} bold>
          {face}
          {tail}
        </Text>
        <Text color={props.color}>{nameRow}</Text>
        {bugs.length > 0 && <Text>{bugs}</Text>}
        {guest.length > 0 && <Text color={props.visitor?.color}>{guest}</Text>}
        {props.bubble !== null && (
          <Text italic wrap="truncate-end">
            {props.bubble}
          </Text>
        )}
      </Box>
    )
  }

  const sprite = (look: Look, frameStep: number, eyeOf: string, top: string, color: string, label: string, isBold: boolean) => {
    const frame = look.frames[Math.max(0, frameStep)] ?? look.frames[0] ?? BLANK
    const hasCape = look.stage >= 2
    const width = SPRITE_COLUMNS + (hasCape ? 2 : 0)
    const capeColor = look.stage >= 3 ? 'warning' : 'error'
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row">
          <Text color={color}>{top.padEnd(SPRITE_COLUMNS)}</Text>
          {hasCape && <Text color={capeColor}>{CAPE[0]}</Text>}
        </Box>
        {frame.map((row, i) => (
          <Box flexDirection="row">
            <Text color={lineColor(look, i, tick)} bold={isBold}>
              {row.replaceAll('E', eyeOf)}
            </Text>
            {hasCape && <Text color={capeColor}>{CAPE[i + 1]}</Text>}
          </Box>
        ))}
        <Text color={look.color} bold wrap="truncate-end">
          {center(label, width)}
        </Text>
      </Box>
    )
  }

  const main = sprite(me, step, eye, topRow, topColor, nameRow, props.stage >= 3)
  const mainWidth = SPRITE_COLUMNS + (props.stage >= 2 ? 2 : 0)

  // A guest beside the pet: a visitor or a battle opponent stands, a wild
  // shiny walks in from the left edge over the first seconds.
  const guest = props.visitor
  const guestStep = guest === null ? 0 : guest.kind === 'battle' ? (BUSY[(tick + 3) % BUSY.length] ?? 0) : (IDLE[(tick + 5) % IDLE.length] ?? 0)
  const guestEye = guest === null ? '' : guestStep === -1 ? '-' : guest.kind === 'battle' ? '×' : guest.eye
  const guestLook: Look | null = guest === null ? null : { ...guest }
  const guestSprite =
    guest === null || guestLook === null
      ? null
      : sprite(guestLook, guestStep, guestEye, guest.hat, guest.color, guest.kind === 'wild' ? '✨ wild ✨' : guest.name, false)
  const guestWidth = guest === null ? 0 : SPRITE_COLUMNS + (guest.stage >= 2 ? 2 : 0) + 1
  const standingGuest = guest !== null && guest.kind !== 'wild' ? guestSprite : null

  const bugsText = props.bugs > 5 ? `🐛×${props.bugs}` : '🐛'.repeat(props.bugs)
  const bugsWidth = props.bugs > 0 ? (props.bugs > 5 ? 5 : props.bugs * 2) + 1 : 0

  const rightWidth = mainWidth + (standingGuest === null ? 0 : guestWidth) + bugsWidth
  const leftWidth = Math.max(0, props.columns - rightWidth - 1)

  let left: RenderElement | null = null
  if (wild && guestSprite !== null) {
    const walkerWidth = SPRITE_COLUMNS + 1
    const travelled = (tick - (local?.wildSince ?? tick)) * 2
    const x = Math.max(0, Math.min(leftWidth - walkerWidth, travelled))
    left = (
      <Box width={leftWidth} flexDirection="row">
        <Box marginLeft={x}>{guestSprite}</Box>
      </Box>
    )
  } else if (props.bubble !== null && leftWidth >= 16) {
    const bubbleWidth = Math.min(44, leftWidth - 2)
    const text = clip(props.bubble, (bubbleWidth - 4) * 3)
    left = (
      <Box width={leftWidth} flexDirection="row" justifyContent="flex-end" alignItems="center">
        <Box borderStyle="round" borderColor={props.color} paddingX={1} width={bubbleWidth}>
          <Text wrap="wrap">{text}</Text>
        </Box>
        <Text color={props.color}>─</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row" alignItems="flex-end">
      {left}
      {props.bugs > 0 && (
        <Box width={bugsWidth} alignItems="flex-end" flexDirection="column" justifyContent="flex-end">
          <Text>{bugsText}</Text>
          <Text> </Text>
        </Box>
      )}
      {standingGuest !== null && <Box marginRight={1}>{standingGuest}</Box>}
      {main}
    </Box>
  )
}

function lineColor(look: Look, row: number, tick: number): string {
  return look.isShiny ? (RAINBOW[(row + tick) % RAINBOW.length] ?? look.color) : look.color
}

function center(text: string, width: number): string {
  if (text.length >= width) return text
  const leftPad = Math.floor((width - text.length) / 2)
  return (' '.repeat(leftPad) + text).padEnd(width)
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + '…'
}

export type { Visitor }
