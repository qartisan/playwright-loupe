# Loupe notes file — notes v1

`loupe.notes.json` excludes recorded runs, or attaches a note to them, after the fact. People write it, and it is versioned in the project's repository, unlike `loupe-history/`, which Loupe keeps out of git. It holds data, not behaviour: it is never merged into `loupe.config.ts`. It has its own version, `notesVersion`, independent from [`historyVersion`](history-v1.md#versioning-policy) and the report's `schemaVersion`.

The TypeScript types are the source of truth: [`src/schema/notes-v1.ts`](../../src/schema/notes-v1.ts) (`NotesFile`).

## Format

```json
{
  "notesVersion": 1,
  "runs": [
    { "run": "github-actions-1234567890-3f9a2c1d", "exclude": "Staging was down (VPN)" },
    { "run": "6f1c2b9e-8d3a-4c5b-9e7f-1a2b3c4d5e6f", "note": "First run after the auth refactor" }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `notesVersion` | `1` | Required. |
| `runs` | `NotesEntry[]`, optional | One entry per run to exclude or annotate. Absent: no entry. |

### NotesEntry

| Field | Type | Notes |
| --- | --- | --- |
| `run` | `string` | Required. The [run id](history-v1.md#historyrun), as in the run file's name and `run.id`: never a date, a commit or a position. Trimmed. |
| `exclude` | `string`, optional | Excludes the run with this reason, with the same effect as `LOUPE_EXCLUDE` at launch: left out at both levels of the history, brought back by `history.include: 'all'`. Non-empty once trimmed. |
| `note` | `string`, optional | Free text attached to the run. Non-empty once trimmed. A note excludes nothing. |

An entry has `run` and at least one of `exclude` and `note`. The layout is free: one entry per line pastes well, but a formatter may expand it (Prettier does above 80 columns, VS Code's formatter always), and that changes nothing.

Several entries may name the same run (two branches each adding one): their reasons are joined with `; `, and their notes too, the same text once. An entry whose run is not in the window (removed by the retention, another stream, another machine, a typo) is ignored without a word: entries for other streams are normal.

## Where it is read

- **The file**: `loupe.notes.json` next to the Playwright config, or `history.notes`, a path relative to the Playwright config. It never depends on `history.dir` or `LOUPE_HISTORY_DIR`: the history may live in a CI cache, the notes file is versioned. `history.notes: false` turns it off. There is no environment variable. Several Playwright configs in one repository each read their own by default, or share one through `history.notes`. Under `merge-reports`, the file is the merge config's, so the merge job needs the repository checked out.
- **When**: once, when the run starts, with the window of the history. An entry added during a run applies from the next one; the report is static.
- **What it changes**: the history embedded in the report ([`notesExcluded` and `note`](history-v1.md#embeddedrun), the file's status in [`notesFile`](history-v1.md#embeddedhistory)). Run files are never rewritten: the notes file is the only source of these facts, so removing an entry undoes it from the next run.

## Leniency

The file is JSON, read leniently where people and their tools are:

- a UTF-8 byte order mark is accepted (Notepad on Windows writes one), and so are CRLF line ends;
- a trailing comma before `]` or `}` is accepted, without a warning: it is what pasting an entry last leaves. A comma anywhere else (`[,]`, two in a row) is an error.

Everything else follows JSON: comments, single quotes or any other syntax error make the file invalid.

## Problems

A notes file never stops a run and never fails the report. Every problem joins the run's single `Loupe: history: …` warning, on stderr:

- **No file**: the normal case, no warning (`notesFile: 'absent'`).
- **An invalid file**: a syntax error, a file larger than 1 MB, a wrong shape (not an object, a `notesVersion` that is not a positive integer, `runs` not an array), a newer `notesVersion`, or a file that cannot be read. All its entries are ignored (`notesFile: 'invalid'`). A syntax error is given by line and column, located by Loupe: the warning never repeats the file's text, which may hold a path or a secret (the JSON parser's own message quotes it).
- **An invalid entry** (no `run`, an empty `exclude` or `note`, neither, a wrong type): ignored, the others used. The warning counts them and names the first three by position (`runs[3]`).
- **An unknown key**, in an entry or at the top level: warned about, with a suggestion for a typo (`"exlude"`), the rest used. Key names are masked (`redact.env`, home directory) and cut to 40 characters before they are printed.

## Privacy

The file is written by people and may hold a path or a secret. Before they reach the report, its reasons and notes are masked like the report (`redact.env` values, the home directory of this machine and the homes of other machines), then cut: reasons to 200 characters, notes to 300, ending with `…` when cut. Masking always runs on the whole text before the cut, so no part of a value running across the cut stays. The file is read whole on every run, with the redaction of that run: a value added to `redact.env` later is masked from the next run on.

## Versioning

- Adding an optional key to an entry, or a new top-level key, keeps `notesVersion` 1: a reader that does not know it warns about the key and uses the rest. Two extensions are planned this way:
  - excluding one test's result in one run: an optional key on an entry. An entry holding only that key is ignored by an older reader, with the unknown key warning;
  - the rename table for test identity: a new top-level array.
- Any other change of shape or meaning bumps `notesVersion`. A reader ignores a file with a newer version, with one warning.
