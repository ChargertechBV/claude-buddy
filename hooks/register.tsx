// A collection of terminal pets, one in the band above the prompt each
// session. Each pet's looks follow from its seed, its name and personality
// from one small model call at hatching. Until the collection holds
// MAX_PETS, each new session hatches an egg; after that it draws one at
// random. A pet levels up as you work (and evolves at 10 and 20), gets
// hungry over hours, naps when you are away, reacts to the session, judges
// your prompts and commits, eats the bugs your tests leave, gets visits
// from the others, fights them, keeps a diary, and answers by name.

import type { Register } from 'claude-code'

import { registerSoundtrack, startSoundtrack } from './soundtrack'
import { soundtrackToolCall } from './telemetry'
import { runCommand } from './buddy-commands'
import { fridayCeremony, judge, shouldJudge } from './buddy-judge'
import { award, gainXp, isHiddenOf, load, musicTick, petIt, viewOf } from './buddy-life'
import { afterTool, afterTurn, tick, wake } from './buddy-loop'
import { GAME, HOUSE, MINUTE, SECOND, asObject, buddy, escapeRegExp, key } from './buddy-state'
import { answer, quackBack, say } from './buddy-voice'
import { completeQuest, endOfDay, flapGame, gameOf, gameOver, gitCheckAndNag, houseOf, restartGame } from './buddy-world'

const QUACK = /^\s*quack[!.?]*\s*$/i

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)

    await $.command.register({
      name: 'buddy',
      description: 'Your terminal pets: card, pets, house, battle, visit, catch, dex, quest, shop, badges, journal, fix, judge, roast, review, shame, news, export, help',
      argumentHint: '[play|pets|swap|hatch|house|battle|visit|catch|dex|quest|shop|buy|wear|badges|journal|fix|judge|roast|review|shame|news|pet|feed|hat|rename|mute|small|hide|smart|sound|voice|export|import|help]',
      immediate: true,
    })
    await load($)
    $.clock.every(30 * SECOND, () => void tick($))
    $.clock.every(5 * SECOND, () => void musicTick($))
    $.clock.after(20 * SECOND, () => void fridayCeremony($))
    $.clock.after(MINUTE, () => void gitCheckAndNag($))
    try {
      await startSoundtrack($, e)
    } catch {
      // The pane never gets in the way of the pet.
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (buddy.pet !== null && !buddy.isHatching) {
      const now = await $.clock.now()
      await $.store.set(key('seen', buddy.pet.id), now)
      await endOfDay($, now)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (buddy.pet === null || buddy.isHatching || e.origin.kind !== 'composer') return next(e)

    buddy.lastPrompt = e.text
    buddy.turnTools = []
    buddy.facts.prompts += 1
    const here = buddy.pet
    const hour = new Date(await $.clock.now()).getHours()
    if (hour >= 5 && hour < 7) await award($, 'early-bird')
    const isAddressed = addresses(e.text, here.name)
    const absent = isAddressed ? undefined : buddy.collection.find(p => p.id !== here.id && addresses(e.text, p.name))
    await wake($, !isAddressed && absent === undefined)
    await gainXp($, 1)
    if (/\b[\w.-]+\/[\w./-]+\.\w{1,5}\b|\b[\w-]+\.(ts|tsx|js|jsx|py|go|rs|php|rb|md|json|ya?ml|sql|css|html|sh)\b/.test(e.text)) await completeQuest($, 'path')
    if (/\b(error|exception|traceback|panic|ENOENT|TypeError|ReferenceError|SyntaxError)\b[^\n]*[:\n]/i.test(e.text)) await completeQuest($, 'error')

    if (QUACK.test(e.text)) {
      $.clock.after(0, () => void quackBack($))
      const note = `The user quacked at their terminal pet, ${here.name}, who quacked back from its bubble. Answer with one quack of your own and nothing else.`
      return next({ ...e, context: [...(e.context ?? []), note] })
    }
    if (absent !== undefined) {
      $.clock.after(0, () => void say($, `${absent.name}'s not here today. it's me, ${here.name}!`, { isForced: true }))
      return next(e)
    }
    if (!isAddressed) {
      if (await shouldJudge($, e.text)) $.clock.after(0, () => void judge($, e.text))
      return next(e)
    }

    $.clock.after(0, () => void answer($, e.text))
    const note =
      `${here.name} is the user's terminal pet (a ${buddy.bones?.species ?? 'pet'}) that lives above the prompt ` +
      `and answers in its own speech bubble. The user addressed ${here.name}, and ${here.name} is answering ` +
      `them there now: don't speak for ${here.name}. If the message is only for ${here.name}, reply in one ` +
      `short line at most.`

    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    try {
      const command = e.tool === 'Bash' ? String((e as { command?: unknown }).command ?? '') : ''
      const path = typeof (e as { file_path?: unknown }).file_path === 'string' ? String((e as { file_path?: unknown }).file_path) : ''
      await afterTool($, e.tool, command, path, ran)
    } catch {
      // The pet never gets in the way of a tool call.
    }
    try {
      soundtrackToolCall($, e, ran, startedAt, await $.clock.now())
    } catch {
      // Nor does the telemetry.
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && buddy.pet !== null && !buddy.isHatching) {
      const turn = { reason: e.reason, durationMs: e.durationMs, answer: e.answer }
      $.clock.after(0, () => void afterTurn($, turn))
    }

    return done
  })

  on('ui.message', async ($, e, next) => {
    const data = asObject(e.data)
    if (e.element === 'game') {
      if (data.type === 'over') await gameOver($, Number(data.score) || 0, Number(data.bugs) || 0)
      return {}
    }
    if (e.element !== 'pet') return next(e)
    if (data.type === 'pet') await petIt($)

    return {}
  })

  // A hook that throws or outruns its budget is skipped and the person only reads "no command.run hook answered it";
  // answer with what went wrong instead.
  on('command.run', { command: 'buddy' }, async ($, e) => runCommand($, e.args)).catch(($, e, next) => ({
    text:
      next.error.kind === 'timeout'
        ? `/buddy ${e.args.trim()} took too long and was cut off${next.error.message ? `: ${next.error.message}` : ''}.`
        : `/buddy ${e.args.trim()} failed: ${next.error.message ?? 'unknown error'}`,
  }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await viewOf($)
    const hidden = await isHiddenOf($)
    // A reload finds the view an older load published; it is skipped until publish() replaces it.
    if (shown === null || !('visitor' in shown) || hidden || e.props.hasSurvey) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)

    const { Box, Client } = $.ui.resolve({ surface: e.surface, component: e.component })
    const columns = e.props.bodyColumns
    const isCompact = shown.isCompact || columns < 40 || e.props.maxRows < 7

    return (
      <Box flexDirection="row" justifyContent="flex-end" width={columns}>
        <Client key="pet" module="./pet.tsx" props={{ ...shown, isCompact, columns, isWorking: e.props.isWorking }} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: GAME }, async ($, e, next) => {
    const g = await gameOf($)
    if (g === null) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Flappy Duck plays in the terminal and the desktop app.</Text>
    }
    const { Box, Button, Client, Text } = $.ui.resolve({ surface: e.surface, component: e.component })

    return (
      <Box flexDirection="column">
        <Client key="game" module="./game.tsx" props={{ ...g, columns: e.props.bodyColumns - 2 }} />
        <Box flexDirection="row" gap={1}>
          <Button key="flap" label="flap" hotkey="f" onPress={() => void flapGame($)} />
          <Button key="restart" label="restart" hotkey="r" onPress={() => void restartGame($)} />
          <Text dimColor wrap="truncate-end">
            f flaps · r restarts · esc closes · score pays xp
          </Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: HOUSE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The pet house draws in the terminal and the desktop app.</Text>
    }
    const { Box, Client, Text } = $.ui.resolve({ surface: e.surface, component: e.component })
    const pets = (await houseOf($)) ?? []

    return (
      <Box flexDirection="column" gap={1}>
        <Client key="house" module="./house.tsx" props={{ pets, columns: e.props.bodyColumns }} />
        <Text dimColor>★ on duty · /buddy swap &lt;name&gt; to switch · ctrl+x x closes</Text>
      </Box>
    )
  })

  registerSoundtrack(on)
}

// Small helpers

function addresses(text: string, name: string): boolean {
  const n = escapeRegExp(name)
  // Case-sensitive on the name, so "pip install" never wakes Pip.
  return (
    new RegExp(`@${n}\\b`, 'i').test(text) ||
    new RegExp(`^\\s*${n}\\b[\\s,!?.:]*`).test(text) ||
    new RegExp(`\\b(hey|hi|hello|hoi|hallo|dag|thanks|thank you|bedankt|dank je|good|goed|bye|doei|love you)[,\\s]+${n}\\b`, 'i').test(text) ||
    new RegExp(`\\b${n}\\s*[?!]`).test(text)
  )
}
