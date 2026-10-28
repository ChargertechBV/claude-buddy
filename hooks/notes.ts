// Notes in the Soundtrack pane: per folder or across all, stamped with the track
// playing, merged with what another session wrote.

import { atom, read, update } from 'claude-code'

import type { Note, NotesScope } from '../types'
import { clock, ctx, shortCwd } from './shared'
import type { $ } from './shared'
import { nowPlayingOf } from './spotify'

const notes = atom({ plugin: 'buddy', key: 'notes' } as const, [], { shape: 'note-1' })

/** Reads `notes` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function notesOf($: $) {
  return read($, notes)
}

const notesScope = atom({ plugin: 'buddy', key: 'notesScope' } as const, 'folder')

/** Reads `notesScope` for the other files: the engine reads and writes an atom only in the file that declares it. */
export function notesScopeOf($: $) {
  return read($, notesScope)
}

// -- notes ----------------------------------------------------------------------

/**
 * Writes the notes, merged with what another session may have written since:
 * union by id, ordered by time; a note removed here stays removed.
 */
async function saveNotes($: $, list: Note[], removed: readonly string[] = []) {
  const stored = await $.store.get('soundtrack:notes')
  const known = new Map<string, Note>()
  if (Array.isArray(stored)) for (const one of stored as Note[]) if (one && typeof one.id === 'string' && !removed.includes(one.id)) known.set(one.id, one)
  for (const one of list) known.set(one.id, one)
  const merged = [...known.values()].sort((a, b) => a.at - b.at).slice(-2000)
  await $.store.set('soundtrack:notes', merged)
  await update($, notes, () => merged)
}

export async function addNote($: $, text: string): Promise<Note | null> {
  const body = text.trim()
  if (!body) return null
  const now = await $.clock.now()
  const np = await nowPlayingOf($)
  const note: Note = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: now,
    text: body,
    cwd: ctx.cwd,
    track: np && np.isPlaying ? { uri: np.uri, name: np.name, artists: np.artists } : null,
  }
  const list = await read($, notes)
  await saveNotes($, [...list, note].slice(-2000))
  return note
}

export async function removeNotes($: $, ids: readonly string[]): Promise<number> {
  const list = await read($, notes)
  const kept = list.filter(one => !ids.includes(one.id))
  if (kept.length !== list.length) await saveNotes($, kept, ids)
  return list.length - kept.length
}

export const visibleNotes = (list: Note[], scope: NotesScope) => (scope === 'global' ? list : list.filter(one => one.cwd === ctx.cwd))

const notesAsText = (list: Note[], now: number, firstNumber = 1): string =>
  list
    .map((one, i) => {
      const track = one.track ? `  ♪ ${one.track.name}${one.track.artists[0] ? ` · ${one.track.artists[0]}` : ''}` : ''
      return `${String(firstNumber + i).padStart(3)}. ${clock(one.at, now)}  ${one.text}${track}`
    })
    .join('\n')

/** Loads the notes and the scope the pane last showed, at session start. */
export async function loadNotes($: $) {
  const stored = await $.store.get('soundtrack:notes')
  if (Array.isArray(stored)) await update($, notes, () => stored as Note[])
  const scope = await $.store.get('soundtrack:notesScope')
  if (scope === 'folder' || scope === 'global') await update($, notesScope, () => scope)
}

/** The pane's scope button: this folder's notes or every folder's. */
export async function toggleNotesScope($: $) {
  const scope = await read($, notesScope)
  const nextScope: NotesScope = scope === 'folder' ? 'global' : 'folder'
  await $.store.set('soundtrack:notesScope', nextScope)
  await update($, notesScope, () => nextScope)
}

/** `/soundtrack note <text>`: a note stamped with the playing track. */
export async function noteCommand($: $, text: string): Promise<string> {
  const note = await addNote($, text)
  if (!note) return 'Nothing to note. Use /soundtrack note <text>.'
  const track = note.track ? ` (♪ ${note.track.name})` : ''
  return `Noted${track}: ${note.text}`
}

/** `/soundtrack notes [global] [rm <n>|rm last|clear yes]`: lists or removes notes. */
export async function notesCommand($: $, args: string): Promise<string> {
  const now = await $.clock.now()
  const all = await read($, notes)
  const words = args.trim().split(/\s+/).filter(Boolean)
  const verb = words[0]?.toLowerCase()
  // The scope: "global" anywhere in the command, else the pane's own toggle.
  const scopeNow: NotesScope = words.some(w => /^(global|all)$/i.test(w)) ? 'global' : await read($, notesScope)
  const isGlobal = scopeNow === 'global'
  const list = visibleNotes(all, scopeNow)
  const where = isGlobal ? 'every folder' : shortCwd(ctx.cwd)
  if (verb === 'rm' || verb === 'delete' || verb === 'del') {
    const which = words[1]?.toLowerCase()
    if (list.length === 0) return `No notes in ${where} to remove.`
    let target: Note | undefined
    if (!which || which === 'last' || which === 'global' || which === 'all') target = list[list.length - 1]
    else if (/^\d+$/.test(which)) target = list[Number(which) - 1]
    if (!target) return `No note ${which ?? ''} in ${where}. "/soundtrack notes" numbers them; "/soundtrack notes rm last" removes the newest.`
    await removeNotes($, [target.id])
    return `Removed: ${clock(target.at, now)}  ${target.text}`
  }
  if (verb === 'clear') {
    if (!words.some(w => /^(yes|confirm)$/i.test(w))) {
      return `This removes ${list.length} note${list.length === 1 ? '' : 's'} from ${where}. Run "/soundtrack notes clear yes"${isGlobal ? '' : ' (or "/soundtrack notes clear global yes" for every folder)'} to confirm.`
    }
    const removed = await removeNotes($, list.map(one => one.id))
    return `Removed ${removed} note${removed === 1 ? '' : 's'} from ${where}.`
  }
  if (list.length === 0) return isGlobal ? 'No notes yet.' : `No notes for ${shortCwd(ctx.cwd)} yet. "/soundtrack notes global" lists every folder's.`
  const shown = list.slice(-100)
  const head = `${isGlobal ? 'All notes' : `Notes for ${shortCwd(ctx.cwd)}`} (${list.length}) · "/soundtrack notes rm <number>" removes one:`
  return `${head}\n${notesAsText(shown, now, list.length - shown.length + 1)}`
}
