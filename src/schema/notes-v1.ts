/**
 * Loupe notes file — notes version 1 (`loupe.notes.json`, docs/schema/notes-v1.md). Written by people, versioned
 * in the consumer repo, read at the start of each run: exclusions and notes added after the fact to recorded
 * runs, keyed by their history run id (`HistoryRun.id`). Run files are never rewritten from it.
 *
 * Adding an optional key to an entry, or a new top-level key, keeps `notesVersion`: older readers warn about
 * the key and use the rest. Any other change of shape or meaning needs a new version.
 * Kept free of Node imports so the renderer can import it too.
 */

export const NOTES_VERSION = 1;

/** The default file name, next to the Playwright config (`history.notes`). */
export const NOTES_FILE_NAME = 'loupe.notes.json';

export interface NotesFile {
  notesVersion: 1;
  /** Absent: no entry. */
  runs?: NotesEntry[];
}

/** One run: `run` and at least one of `exclude` and `note`. */
export interface NotesEntry {
  /** The history run id, as in the run file's name and `run.id`. */
  run: string;
  /** Excludes the run, as `LOUPE_EXCLUDE` at launch, with this reason: non-empty once trimmed. */
  exclude?: string;
  /** Free text attached to the run: non-empty once trimmed. */
  note?: string;
}

/**
 * What the run knew of the notes file, embedded as `EmbeddedHistory.notesFile`: `absent` (no file, the normal
 * case), `read`, `invalid` (its entries are ignored, with one warning), `off` (`history.notes: false`).
 */
export const NOTES_FILE_STATUSES = ['absent', 'read', 'invalid', 'off'] as const;
export type NotesFileStatus = (typeof NOTES_FILE_STATUSES)[number];
