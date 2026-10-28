import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.UTC(2026, 9, 9, 12)
const BAND = {
  plugin: 'buddy',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('a pet with nothing to say still draws, on both surfaces', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const entries: Record<string, unknown> = { pets: [] as string[], prefs: { isSmart: false, judge: 'off', hasNews: false, hasSound: false, isMuted: true } }
  for (let i = 0; i < 10; i++) {
    ;(entries.pets as string[]).push(`t${i}`)
    entries[`pet:t${i}`] = { id: `t${i}`, seed: 1000 + i, name: `Pet${i}`, personality: 'Calm.', hatchedAt: NOW }
  }
  mock.store(on, { ...(entries), prefs: { isHidden: false } })
  mock.env(on, {})
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000, tokens: 1, percent: 1 }, rateLimits: [] } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine' })
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.advance(30_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    const texts = (await band.findAll({ type: 'Text', in: 'pet' })).map(t => t.text)
    expect(texts.some(t => /^Pet\d$/.test(t.trim()))).toBe(true)
    expect(texts.some(t => t.includes('─'))).toBe(false)
    await band.unmount()
  }
})
