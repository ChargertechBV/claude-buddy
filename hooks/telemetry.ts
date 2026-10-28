// The session as the pane shows it: context, cost, tool calls and their timing,
// edited files, plan usage, tokens per model, and the longest error-free stretch.

import { atom, read, update } from 'claude-code'
import type { ToolCallInput } from 'claude-code'

import type { ModelTokens, Played, Telemetry, UsageLimit } from '../types'
import { helperReport } from './capture'
import { framesPerSecond } from './eq'
import { ctx, isRecord, shortCwd } from './shared'
import type { $ } from './shared'

const telemetry = atom({ plugin: 'buddy', key: 'telemetry' } as const, null, { shape: 'tel-4' })

/** Reads `telemetry` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function telemetryOf($: $) {
  return read($, telemetry)
}

// The session as the agent runs it: failing calls, every call's duration, and the files it edited.
let errorsAt: number[] = []
let callLog: { at: number; ms: number }[] = []
const edits = new Map<string, { plus: number; minus: number; at: number }>()
let hasDiffCommand = false
let telemetryLast = ''

// -- soundtrack log -------------------------------------------------------------

/** The tracks that played during the longest stretch without a tool error. */
export const flowTracks = (list: Played[], now: number): { tracks: Played[]; from: number; to: number } => {
  const bounds = [ctx.startedAt, ...errorsAt, now].sort((a, b) => a - b)
  let best = { from: ctx.startedAt, to: now }
  for (let i = 1; i < bounds.length; i++) {
    const from = bounds[i - 1] ?? ctx.startedAt
    const to = bounds[i] ?? now
    if (to - from > best.to - best.from) best = { from, to }
  }
  const tracks = list.filter(one => one.startedAt <= best.to && (one.endedAt ?? now) >= best.from)
  return { tracks, ...best }
}

// -- session telemetry ------------------------------------------------------------

const lineCount = (text: string): number => (text.length === 0 ? 0 : text.split('\n').length)

const shortPath = (path: string): string => {
  const rel = path.startsWith(ctx.cwd + '/') ? path.slice(ctx.cwd.length + 1) : shortCwd(path)
  return rel.length <= 34 ? rel : '…' + rel.slice(-33)
}

const LIMIT_ORDER: Record<string, number> = { five_hour: 0, seven_day: 1 }

/** The engine's rate-limit windows in the pane's shape, five-hour first, each reset parsed to a clock time. */
export function usageLimits(windows: { kind: string; percentUsed: number; resetsAt?: string }[]): UsageLimit[] {
  return windows
    .map(one => {
      const at = one.resetsAt ? Date.parse(one.resetsAt) : NaN
      return { kind: one.kind, percentUsed: Math.round(one.percentUsed * 10) / 10, resetsAt: Number.isFinite(at) ? at : null }
    })
    .sort((a, b) => (LIMIT_ORDER[a.kind] ?? 9) - (LIMIT_ORDER[b.kind] ?? 9))
}

/** `5h`, `7d`, `spend`, else the engine's own word. */
function limitLabel(kind: string): string {
  return kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind === 'spend_limit' ? 'spend' : kind.replace(/_/g, ' ')
}

/** How long until a reset: `45m`, `2h05m`, `3d 4h`; `now` once it has passed. */
function untilText(at: number, now: number): string {
  const left = at - now
  if (left <= 0) return 'now'
  const minutes = Math.ceil(left / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h${String(mins).padStart(2, '0')}m`
  return `${mins}m`
}

/** One line per window: `5h 42% · resets in 2h10m` for the command, `5h 42% (2h10m)` for the pane's one row. */
export function limitsText(limits: UsageLimit[], now: number, compact = false): string[] {
  return limits.map(one => {
    const left = one.resetsAt !== null ? untilText(one.resetsAt, now) : null
    return `${limitLabel(one.kind)} ${one.percentUsed}%${left === null ? '' : compact ? ` (${left})` : ` · resets in ${left}`}`
  })
}

// -- tokens per model, summed from every model request's reported usage ---------------

const tokensByModel = new Map<string, ModelTokens>()
let tokensAdopted = false

/** Adds one request's usage to its model's tally. */
export function tallyTokens(usage: { model: string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }) {
  const had = tokensByModel.get(usage.model) ?? { model: usage.model, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  tokensByModel.set(usage.model, {
    model: usage.model,
    requests: had.requests + 1,
    input: had.input + (usage.input_tokens || 0),
    output: had.output + (usage.output_tokens || 0),
    cacheRead: had.cacheRead + (usage.cache_read_input_tokens || 0),
    cacheWrite: had.cacheWrite + (usage.cache_creation_input_tokens || 0),
  })
}

/** A hot reload empties the module's tally: the first refresh after one takes the state's figures back. */
async function adoptTokens($: $) {
  if (tokensAdopted) return
  tokensAdopted = true
  if (tokensByModel.size > 0) return
  const old = await read($, telemetry)
  for (const one of old?.models ?? []) tokensByModel.set(one.model, { ...one })
}

/** `claude-fable-5-1` as `fable 5.1`; an id of another shape as itself. */
function shortModel(id: string): string {
  const m = /^(?:[a-z]{2}\.)?(?:anthropic\.)?claude-([a-z]+)-(\d+)-(\d+)/i.exec(id)
  return m ? `${m[1]!.toLowerCase()} ${m[2]}.${m[3]}` : id.replace(/^claude-/, '')
}

/** 950, 9.5k, 95k, 1.2M. */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** One line per model: compact for the pane, spelled out for the command. */
export function modelsText(models: ModelTokens[], compact: boolean): string[] {
  return models.map(one =>
    compact
      ? `${shortModel(one.model)} ×${one.requests} · in ${fmtTokens(one.input + one.cacheWrite)} out ${fmtTokens(one.output)} cached ${fmtTokens(one.cacheRead)}`
      : `${shortModel(one.model)} (${one.model}): ${one.requests} request${one.requests === 1 ? '' : 's'}, ${one.input.toLocaleString('en-US')} input, ${one.output.toLocaleString('en-US')} output, ${one.cacheRead.toLocaleString('en-US')} cache read, ${one.cacheWrite.toLocaleString('en-US')} cache write`,
  )
}

const LIMIT_WARN_AT = 90
const warnedLimits = new Set<string>()

/** Toasts once per window as it crosses 90 %, and forgets the warning once it drops back under. */
export function warnPastLimits($: $, limits: UsageLimit[], now: number) {
  for (const one of limits) {
    if (one.percentUsed >= LIMIT_WARN_AT) {
      if (warnedLimits.has(one.kind)) continue
      warnedLimits.add(one.kind)
      $.ui.toast(`${limitLabel(one.kind) === '5h' ? 'Five-hour' : limitLabel(one.kind) === '7d' ? 'Weekly' : limitLabel(one.kind)} limit at ${Math.round(one.percentUsed)}%${one.resetsAt !== null ? `, resets in ${untilText(one.resetsAt, now)}` : ''}`)
    } else warnedLimits.delete(one.kind)
  }
}

/** Whether this build has /diff, for the pane's diff button. */
export async function detectDiff($: $) {
  try {
    const commands = await $.command.list()
    hasDiffCommand = commands.some(one => one.name === 'diff')
  } catch {
    hasDiffCommand = false
  }
}

/** Reads the engine's figures and the hooks' tallies into one value the pane draws; writes it only when it changed. */
export async function refreshTelemetry($: $) {
  const now = await $.clock.now()
  let contextPct: number | null = null
  let costUsd: number | null = null
  let limits: UsageLimit[] = []
  await adoptTokens($)
  try {
    const usage = await $.session.usage()
    const pct = usage.context.percent
    contextPct = typeof pct === 'number' ? pct : usage.context.window > 0 && typeof usage.context.tokens === 'number' ? (usage.context.tokens / usage.context.window) * 100 : null
    costUsd = usage.cost ? usage.cost.usd : null
    limits = usageLimits(usage.rateLimits)
  } catch {
    // headless or an older engine: the row shows what the hooks saw
  }
  callLog = callLog.filter(one => now - one.at < 10 * 60_000)
  const spark: number[] = []
  for (let m = 5; m >= 0; m--) spark.push(callLog.filter(one => now - one.at >= m * 60_000 && now - one.at < (m + 1) * 60_000).length)
  const recent = callLog.slice(-20).map(one => one.ms).sort((a, b) => a - b)
  const latencyMs = recent.length ? (recent[Math.floor(recent.length / 2)] ?? null) : null
  const files = [...edits.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 4)
    .map(([path, d]) => ({ path: shortPath(path), plus: d.plus, minus: d.minus }))
  const next: Telemetry = {
    contextPct,
    costUsd,
    callsPerMin: spark[spark.length - 1] ?? 0,
    spark,
    latencyMs,
    files,
    filesTotal: edits.size,
    helper: helperReport(now),
    fps: framesPerSecond(now),
    hasDiff: hasDiffCommand,
    limits,
    models: [...tokensByModel.values()].sort((a, b) => b.requests - a.requests),
  }
  const key = JSON.stringify(next)
  if (key === telemetryLast) return
  telemetryLast = key
  await update($, telemetry, () => next)
}

/**
 * Hears one tool call from buddy's hook: times it for the telemetry, notes a
 * failure for the soundtrack log, and tallies an edit's lines.
 */
export function soundtrackToolCall($: $, e: ToolCallInput, ran: unknown, startedAt: number, endedAt: number) {
  callLog.push({ at: endedAt, ms: endedAt - startedAt })
  if (callLog.length > 2000) callLog = callLog.slice(-1000)
  const failed = isRecord(ran) && ran.isError === true
  if (failed) errorsAt.push(endedAt)
  if (!failed && (e.tool === 'Edit' || e.tool === 'Write')) {
    const path = e.file_path
    const plus = e.tool === 'Edit' ? lineCount(e.new_string) : lineCount(e.content)
    const minus = e.tool === 'Edit' ? lineCount(e.old_string) : 0
    const had = edits.get(path)
    edits.set(path, { plus: (had?.plus ?? 0) + plus, minus: (had?.minus ?? 0) + minus, at: endedAt })
    void refreshTelemetry($)
  }
}
