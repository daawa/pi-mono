# Session Lifecycle

A session is pi's durable record of one coding-agent conversation. It combines the transcript, selected model state, thinking-level state, compaction checkpoints, tree branches, labels, session name, and extension-owned entries into one append-oriented JSONL file.

The low-level `Agent` keeps the live in-memory state for the current run. `SessionManager` is the durable source of truth for the saved session tree. `AgentSession` connects them: it restores state from `SessionManager` at startup and appends new entries as agent events complete.

For the exact JSON shapes of each entry, see [Session Format](../packages/coding-agent/docs/session-format.md).

## Main Components

| Component | Role |
|-----------|------|
| `SessionManager` | Owns session files, entries, indexes, tree traversal, branch extraction, listing, and migration. |
| `AgentSession` | Wraps `Agent`, persists completed messages, records model/thinking changes, compaction, branch summaries, bash results, labels, and session names. |
| `AgentSessionRuntime` | Owns the active `AgentSession` and cwd-bound services. It switches, imports, forks, and replaces sessions safely. |
| `main.ts` | Parses CLI flags, selects or creates the initial `SessionManager`, then creates runtime services for the effective session cwd. |

## What a Session Contains

Every persisted session file starts with a header line and then zero or more tree entries.

```text
SessionHeader
SessionEntry
SessionEntry
...
```

The header stores file-level metadata:

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

The `id` and `parentId` fields make the session a tree. The first meaningful entry has `parentId: null`; later entries point at the entry they continue from. Multiple children of one entry represent alternate branches.

## Entry Types

| Entry type | Purpose | Sent to model context |
|------------|---------|-----------------------|
| `message` | User, assistant, tool-result, and bash-execution messages. | Yes, if the entry is on the active branch and not hidden by compaction rules. |
| `model_change` | Records model/provider selection. | No; used to restore the active model. |
| `thinking_level_change` | Records reasoning/thinking level. | No; used to restore thinking level. |
| `compaction` | Stores a summary plus the first kept entry after compaction. | As a synthetic compaction-summary message. |
| `branch_summary` | Stores a summary of an abandoned branch when navigating with `/tree`. | Yes, as a synthetic branch-summary message. |
| `custom` | Extension state. | No. |
| `custom_message` | Extension-provided context. | Yes, as a custom message. |
| `label` | User bookmark for an entry. | No. |
| `session_info` | Session display metadata, currently the name. | No. |

Settings, auth tokens, loaded resources, active UI state, and the current system prompt are not stored in the session. They are rebuilt from settings, auth storage, resource files, extensions, tools, and the selected branch when the runtime starts.

Queued steering and follow-up messages are not durable until the agent loop actually emits and finishes them. A pending editor buffer is also not part of the session until submitted.

## Storage Location

By default, sessions live under:

```text
~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<session-id>.jsonl
```

The agent directory defaults to `~/.pi/agent`, or `PI_CODING_AGENT_DIR` when set. The session directory can be overridden, in order of precedence, by:

1. `--session-dir <dir>`
2. `PI_CODING_AGENT_SESSION_DIR`
3. `sessionDir` in settings
4. the default directory under the agent directory

For the default directory, pi resolves the cwd and encodes it into a safe directory name by removing the leading slash and replacing path separators and colons with `-`, then wrapping the result in `--`.

The file name uses the session creation timestamp with `:` and `.` replaced by `-`, followed by the session id:

```text
2026-05-27T08-12-30-123Z_01972b58-....jsonl
```

## How a New Session Is Created

Startup creates the initial `SessionManager` from CLI flags:

| Startup input | Behavior |
|---------------|----------|
| `--no-session` | Creates an in-memory `SessionManager`; no file is written. |
| `--fork <path|id>` | Resolves the source session and creates a new session file in the current cwd's session directory. |
| `--session <path|id>` | Opens a specific session file or partial session id. A session id from another project prompts to fork into the current project. |
| `--resume` / `-r` | Opens the session picker and then opens the selected file. |
| `--continue` / `-c` | Opens the most recently modified valid session in the current cwd's session directory, or creates a new one if none exists. |
| no session flag | Creates a new persisted session for the current cwd. |

For a brand-new persisted session, `SessionManager.newSession()` creates the in-memory header immediately, but the file is not written right away. During `createAgentSession()`, pi appends initial `model_change` and `thinking_level_change` entries so resume can restore the starting state later.

Persistence is intentionally delayed until an assistant message exists. This avoids leaving durable session files for startup-only runs or prompts that never received a model response. When the first assistant message is appended, `SessionManager` writes the header and every buffered entry to disk, then appends later entries one line at a time.

## How Entries Are Added

`AgentSession` subscribes to low-level `Agent` events. When it receives `message_end`, it appends finished messages:

- `user`, `assistant`, and `toolResult` messages become `message` entries.
- extension `custom` messages become `custom_message` entries.
- bash executions are recorded separately by `recordBashResult()` as `message` entries with role `bashExecution`.

Other state-changing actions append their own entries:

- model selection appends `model_change`
- thinking-level changes append `thinking_level_change`
- `/compact` and automatic compaction append `compaction`
- `/tree` branch summarization appends `branch_summary`
- extension state appends `custom`
- `/name` appends `session_info`
- tree labels append `label`

Normal writes are append-only. Pi rewrites a file when it migrates an older session version or creates a derived branch file.

## The Active Leaf

The active leaf is the current position in the session tree. New entries are appended as children of that leaf, and then become the new leaf.

The leaf is in memory, not a separate persisted pointer. When a file is loaded, `SessionManager` rebuilds indexes and sets the leaf to the last non-header entry in the file. If the user navigates to an older node and exits before adding anything, that navigation alone is not durable. Once the user appends a message, branch summary, label, or other entry from that position, the new path is durable.

## How Context Is Built

Before a model request, pi uses the selected branch, not the whole file.

`SessionManager.buildSessionContext()`:

1. Builds an entry index by id.
2. Finds the active leaf.
3. Walks from the leaf back to the root via `parentId`.
4. Reverses that path into chronological order.
5. Restores the latest model and thinking-level state on that path.
6. Converts eligible entries on that path into `AgentMessage[]`.

If the path contains a `compaction` entry, context starts with a synthetic compaction-summary message, then includes kept entries from `firstKeptEntryId`, then includes entries after the compaction. The original pre-compaction entries remain in the JSONL file, but they are not all replayed to the model.

`branch_summary` and `custom_message` entries are converted to synthetic messages. `custom`, `label`, `model_change`, `thinking_level_change`, and `session_info` entries affect metadata or extension state but are not sent as messages.

## How Sessions Are Resumed

Resume starts by opening a session file with `SessionManager.open()`.

Opening a file:

1. Resolves the path.
2. Reads JSONL lines.
3. Validates the first line is a session header.
4. Migrates older versions to the current format when needed.
5. Builds indexes by entry id.
6. Reconstructs labels.
7. Sets the leaf to the last entry in the file.

After that, `createAgentSession()` calls `buildSessionContext()`.

If the selected branch has messages:

- the restored messages become `agent.state.messages`
- the latest model on the branch is restored when that model exists and auth is configured
- if the saved model cannot be restored, pi selects the normal initial model and reports a fallback message
- the thinking level is restored from the branch when a thinking entry exists; otherwise pi uses the default thinking level and records it

The restored session id is passed into the low-level `Agent`. Providers can use it for session-affinity or prompt-cache behavior when supported.

If the session header's `cwd` does not exist anymore, interactive mode prompts to continue in the current cwd. Non-interactive modes fail with a clear error instead of silently running in the wrong project.

## Resume Paths

| Flow | Selection behavior |
|------|--------------------|
| `pi --continue` | Uses the most recent valid `.jsonl` file in the current project session directory. |
| `pi --resume` | Shows a picker. The picker can browse current-project sessions and all sessions. |
| `pi --session <id>` | Matches a session id prefix in the current project first, then all projects. |
| `pi --session <path>` | Opens that file directly. |
| `/resume` | Switches the active runtime to the selected session file. |
| `/import <path>` | Copies an external JSONL file into the current session directory when needed, then resumes it. |

Switching sessions at runtime is handled by `AgentSessionRuntime.switchSession()`. It emits extension lifecycle events, disposes the old `AgentSession`, creates cwd-bound services for the target session, creates a new `AgentSession`, and asks the UI or RPC host to rebind to the replacement session.

## Forking, Cloning, and Tree Navigation

`/tree` stays in the same session file. It moves the active leaf to an earlier point and optionally appends a branch summary for the path being left. The next submitted message becomes a child of the chosen point, creating an alternate branch in the same file.

`/fork` and `/clone` create new session files.

- `createBranchedSession(leafId)` writes a new session containing the path from root to the selected leaf, plus labels that target entries on that path.
- `forkFrom(sourcePath, targetCwd)` creates a new header for the target cwd and copies all non-header source entries.
- new derived sessions set `parentSession` to the source file path when available.

Exporting to JSONL writes only the active branch and re-chains parent ids into a linear sequence.

## Listing Sessions

Session listing scans `.jsonl` files, reads headers and entries, and builds `SessionInfo`.

The session selector uses:

- header id and cwd
- latest `session_info` name
- parent session path
- creation time from the header
- modified time from the latest user or assistant message timestamp, falling back to the header timestamp or file mtime
- first user message
- aggregate message text for search
- message count

Invalid files or malformed lines are skipped where possible so one bad file does not break the picker.

## Versioning and Migration

The current coding-agent session version is `3`.

- v1 sessions were linear and did not have `id`/`parentId`.
- v2 sessions added tree structure.
- v3 renamed the legacy `hookMessage` role to `custom`.

When a session is loaded, `SessionManager` migrates in memory and rewrites the file if the stored version is older than the current version.

## Important Boundaries

A session is not a full runtime snapshot. It does not store:

- API keys or OAuth tokens
- settings files
- extension code or package resources
- loaded skills or prompt templates
- current terminal layout
- unsent editor text
- queued messages that have not been delivered
- the generated system prompt

This is deliberate. Resume rebuilds the runtime from current configuration and uses the session only for durable conversation state.
