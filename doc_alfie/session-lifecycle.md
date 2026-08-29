# Session Lifecycle

A session is Pi's durable record of one coding-agent conversation. It combines the transcript, selected model state, thinking-level state, compaction checkpoints, tree branches, labels, session name, and extension-owned entries into one append-oriented JSONL file.

The low-level `Agent` keeps live in-memory state for the current run. `SessionManager` is the durable source of truth for the saved session tree. `AgentSession` connects them by restoring state from `SessionManager` at startup and appending entries as agent events complete.

For exact JSON shapes, see [Session Format](../packages/coding-agent/docs/session-format.md).

## Main Components

| Component | Role |
| --- | --- |
| `SessionManager` | Owns session files, entries, indexes, tree traversal, branch extraction, listing, export, fork, and migration. |
| `AgentSession` | Wraps `Agent`, persists completed messages, records model/thinking changes, compaction, branch summaries, bash results, labels, and session names. |
| `AgentSessionRuntime` | Owns the active `AgentSession` and cwd-bound services. It switches, imports, forks, and replaces sessions safely. |
| `main.ts` | Parses CLI flags, selects or creates the initial `SessionManager`, then creates runtime services for the effective session cwd. |

## What a Session Contains

Every persisted session file starts with a header line and then zero or more tree entries:

```text
SessionHeader
SessionEntry
SessionEntry
...
```

The header stores:

- `type: "session"`
- `version`
- `id`
- `timestamp`
- `cwd`
- `parentSession`, when the session was forked or cloned from another session

Every non-header entry has:

- `type`
- `id`
- `parentId`
- `timestamp`

The `id` and `parentId` fields make the session a tree. Multiple children of one entry represent alternate branches.

## Entry Types

| Entry type | Purpose | Sent to model context |
| --- | --- | --- |
| `message` | User, assistant, tool-result, and bash-execution messages. | Yes, if on the active branch and not hidden by compaction rules. |
| `model_change` | Records model/provider selection. | No. Used to restore the active model. |
| `thinking_level_change` | Records reasoning/thinking level. | No. Used to restore thinking level. |
| `compaction` | Stores a summary plus the first kept entry after compaction. | As a synthetic compaction-summary message. |
| `branch_summary` | Stores a summary of an abandoned branch when navigating with `/tree`. | Yes, as a synthetic branch-summary message. |
| `custom` | Extension state. | No. |
| `custom_message` | Extension-provided context. | Yes, as a custom message. |
| `label` | User bookmark for an entry. | No. |
| `session_info` | Session display metadata such as the name. | No. |

Settings, auth tokens, loaded resources, active UI state, and the current system prompt are not stored in the session. They are rebuilt from current settings, auth storage, resources, extensions, tools, and the selected branch when the runtime starts.

## Storage Location

By default, sessions live under:

```text
~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<session-id>.jsonl
```

The agent directory defaults to `~/.pi/agent`, or `PI_CODING_AGENT_DIR` when set. The session directory can be overridden by:

1. `--session-dir <dir>`
2. `PI_CODING_AGENT_SESSION_DIR`
3. `sessionDir` in settings
4. the default directory under the agent directory

The default directory encodes the resolved cwd by removing the leading slash, replacing path separators and colons with `-`, and wrapping the result in `--`.

## Creation and Startup Selection

Startup creates the initial `SessionManager` from CLI flags:

| Startup input | Behavior |
| --- | --- |
| `--no-session` | Creates an in-memory `SessionManager`; no file is written. |
| `--fork <path|id>` | Resolves the source session and creates a new session file in the current cwd's session directory. |
| `--session <path|id>` | Opens a specific session file or partial session id. A session id from another project can be forked into the current project after confirmation. |
| `--session-id <id>` | Opens an exact project session id if present, otherwise creates a new session with that id. |
| `--resume` / `-r` | Opens the session picker and then opens the selected file. |
| `--continue` / `-c` | Opens the most recent valid session in the current cwd's session directory, or creates a new one if none exists. |
| no session flag | Creates a new persisted session for the current cwd. |

For a brand-new persisted session, `SessionManager.newSession()` creates the header in memory immediately, but the file is not written right away.

Persistence is intentionally delayed until an assistant message exists. This avoids durable session files for startup-only runs or prompts that never received a model response.

## How Entries Are Added

`AgentSession` subscribes to low-level `Agent` events. When it receives `message_end`, it appends finished messages:

- `user`, `assistant`, and `toolResult` messages become `message` entries.
- extension `custom` messages become `custom_message` entries.
- bash executions are recorded as `message` entries with role `bashExecution`.

Other state-changing actions append their own entries:

- model selection appends `model_change`
- thinking-level changes append `thinking_level_change`
- `/compact` and automatic compaction append `compaction`
- `/tree` branch summarization appends `branch_summary`
- extension state appends `custom`
- `/name` appends `session_info`
- tree labels append `label`

Normal writes are append-only. Pi rewrites a file when it migrates an older session version or creates a derived branch file.

## Active Leaf and Context

The active leaf is the current position in the session tree. New entries are appended as children of that leaf, and then become the new leaf.

The leaf is in memory, not a separate persisted pointer. When a file is loaded, `SessionManager` rebuilds indexes and sets the leaf to the last non-header entry in the file. If the user navigates to an older node and exits before adding anything, that navigation alone is not durable.

`SessionManager.buildSessionContext()`:

1. Builds an entry index by id.
2. Finds the active leaf.
3. Walks from the leaf back to the root via `parentId`.
4. Reverses that path into chronological order.
5. Restores the latest model and thinking-level state on that path.
6. Converts eligible entries on that path into `AgentMessage[]`.

If the path contains a `compaction` entry, context starts with a synthetic compaction-summary message, then includes kept entries from `firstKeptEntryId`, then includes entries after the compaction.

## Resume, Fork, and Tree Navigation

Resume starts by opening a session file with `SessionManager.open()`, loading JSONL entries, migrating old versions when needed, rebuilding indexes, reconstructing labels, and setting the active leaf.

If the session header's `cwd` no longer exists, interactive mode can prompt to continue in the current cwd. Non-interactive modes fail instead of silently running in the wrong project.

`/tree` stays in the same session file. It moves the active leaf to an earlier point and can append a branch summary for the path being left. The next submitted message becomes a child of the chosen point.

`/fork` and `/clone` create new session files:

- `createBranchedSession(leafId)` writes a new session containing one branch path plus labels for entries on that path.
- `forkFrom(sourcePath, targetCwd)` creates a new header for the target cwd and copies all non-header source entries.
- derived sessions set `parentSession` to the source file path when available.

Exporting to JSONL writes only the active branch and re-chains parent ids into a linear sequence.

## Versioning and Migration

The current session version is `3`.

- v1 sessions were linear and did not have `id` / `parentId`.
- v2 sessions added tree structure.
- v3 renamed the legacy `hookMessage` role to `custom`.

When a session is loaded, `SessionManager` migrates in memory and rewrites the file if the stored version is older than the current version.

## Important Boundary

A session is not a full runtime snapshot. It does not store API keys, OAuth tokens, settings files, extension code, loaded skills, prompt templates, terminal layout, unsent editor text, queued messages that have not been delivered, or the generated system prompt.
