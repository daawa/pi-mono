# Runtime Modes

## Short Answer

The CLI runtime mode is selected in `packages/coding-agent/src/main.ts` by `resolveAppMode(parsed, process.stdin.isTTY)`.

Selection order:

1. `--mode rpc` runs RPC mode.
2. `--mode json` runs JSON event output mode.
3. `--print`, `-p`, or non-TTY stdin runs print mode.
4. Otherwise the process runs interactive mode.

`--mode text` is accepted by the argument parser, but it does not force print mode by itself. With TTY stdin it still resolves to interactive mode unless `--print` is also set.

## User-Facing Modes

| Mode | How to run | Primary output | Main implementation |
| --- | --- | --- | --- |
| Interactive | `pi` or `pi "prompt"` from a TTY | Terminal TUI | `modes/interactive/interactive-mode.ts` |
| Print | `pi -p "prompt"` or piped stdin | Final assistant text | `modes/print-mode.ts` |
| JSON | `pi --mode json "prompt"` | JSON lines of session header and events | `modes/print-mode.ts` |
| RPC | `pi --mode rpc` | JSONL events and command responses | `modes/rpc/rpc-mode.ts` |

The exported `RpcClient` helper starts the CLI with `--mode rpc` and speaks the RPC protocol over the child process stdin/stdout streams.

## Startup Flow

All CLI modes share the same startup path:

```text
cli.ts
  -> main(args)
  -> package/config command fast paths
  -> parseArgs(args)
  -> resolveAppMode(parsed, process.stdin.isTTY)
  -> choose or create SessionManager
  -> create AgentSessionRuntime
  -> prepare initial message
  -> dispatch to the selected mode
```

Mode dispatch happens near the end of `main.ts`:

- `runRpcMode(runtime)` for RPC.
- `new InteractiveMode(runtime, options).run()` for interactive.
- `runPrintMode(runtime, options)` for print and JSON.

Mode selection happens early, before runtime creation, because it affects stdout ownership and missing-session behavior. Piped stdin is read later; if stdin content is discovered while the mode is still interactive, `main.ts` switches to print mode before dispatch.

## Shared Runtime

The modes do not create separate agent implementations. They all operate on an `AgentSessionRuntime`.

Shared responsibilities before mode dispatch:

- settings, auth, model registry, resources, extensions, skills, prompt templates, and themes are loaded
- the session is created, resumed, forked, or opened
- model and thinking options are resolved
- `AgentSession` is created and bound to the runtime host
- diagnostics are reported

Mode-specific code owns only the process edge:

- interactive owns terminal rendering and keyboard input
- print owns one-shot prompt execution and stdout text or JSON output
- RPC owns stdin command parsing and stdout JSONL responses/events

## Interactive Mode

Interactive mode is the default when stdin is a TTY and no non-interactive mode was requested.

Usage:

```bash
pi
pi "initial prompt"
pi @prompt.md "use this"
```

Implementation:

- `InteractiveMode` constructs a `pi-tui` `TUI` with a `ProcessTerminal`.
- It creates header, chat, pending message, status, editor, widget, and footer components.
- `init()` starts the TUI, loads tools needed for autocomplete/search, binds extensions with a TUI-backed `uiContext`, renders initial session messages, and installs watchers.
- `run()` processes startup notices, sends any initial CLI messages, then loops on editor input and calls `session.prompt()`.
- It subscribes to `AgentSessionEvent` values and renders them as message, tool, status, compaction, retry, and metadata UI updates.
- Runtime session replacement calls back through `runtimeHost.setRebindSession()`, which rebinds extension context and redraws current session state.

Interactive mode is also the only mode that can prompt the user when a restored session points at a missing cwd. Non-interactive modes fail instead.

## Print Mode

Print mode is single-shot execution.

Usage:

```bash
pi -p "summarize this repository"
cat prompt.md | pi
pi -p @prompt.md "summarize"
```

Implementation:

- `runPrintMode(runtime, { mode: "text" })` binds extensions without an interactive UI context.
- It sends `initialMessage` first, then any remaining CLI messages in order.
- After prompts finish, text mode inspects the final assistant message and writes text content to raw stdout.
- Assistant `error` or `aborted` stop reasons are printed to stderr and return exit code `1`.
- Signal handlers clean up detached child processes and dispose the runtime.

`main.ts` runs `takeOverStdout()` for non-interactive modes before most startup work. This redirects accidental `console.log()` output to stderr while `writeRawStdout()` preserves stdout for machine-readable or final response output.

## JSON Mode

JSON mode is implemented by print mode with `mode: "json"`.

Usage:

```bash
pi --mode json "summarize this repository"
```

Implementation:

- `main.ts` resolves `--mode json` to app mode `json`.
- Dispatch still calls `runPrintMode()`, with `toPrintOutputMode(appMode)` mapping `json` to print option `"json"`.
- Before prompting, print mode writes the session header to raw stdout when available.
- It subscribes to `session.subscribe()` and writes every `AgentSessionEvent` as one JSON line.
- It does not emit only the final answer; consumers should read the JSON event stream.

JSON mode and text print mode share session creation, extension binding, prompts, cleanup, and stdout takeover behavior.

## RPC Mode

RPC mode is long-lived, headless operation for embedding.

Usage:

```bash
pi --mode rpc
```

Implementation:

- `runRpcMode(runtime)` takes over stdout again defensively, then attaches a strict JSONL line reader to stdin.
- Each input line is parsed as an RPC command from `modes/rpc/rpc-types.ts`.
- Responses are written as JSON lines with `type: "response"`, the command name, `success`, and optional `data` or `error`.
- Session events are also written as JSON lines as they occur.
- `prompt` starts asynchronously. The success response is emitted after prompt preflight succeeds; later agent progress arrives as events.
- Commands such as `steer`, `follow_up`, `abort`, `get_state`, `set_model`, `compact`, `bash`, `switch_session`, `fork`, and `get_messages` call corresponding `AgentSession` or `AgentSessionRuntime` methods.
- Extension UI methods are translated into `extension_ui_request` JSON lines. The embedding client answers with `extension_ui_response`.
- Session replacement rebinds extension context and event subscriptions through `runtimeHost.setRebindSession()`.

RPC mode reserves stdin for JSONL commands, so `main.ts` skips piped prompt reading in this mode. It also rejects `@file` arguments because those are CLI prompt inputs, not RPC protocol data.

## Stdout Handling

`packages/coding-agent/src/core/output-guard.ts` protects stdout for non-interactive modes.

Behavior:

- `takeOverStdout()` saves bound raw stdout and stderr writers.
- It replaces `process.stdout.write` so accidental stdout writes go to stderr.
- `writeRawStdout()` uses the saved raw stdout writer for intentional protocol or final-output writes.
- Raw stdout writes are serialized through a promise tail and retried for transient backpressure errors.
- `restoreStdout()` restores the original stdout writer when print mode finishes.

This is important because print, JSON, and RPC modes expose stdout as an API surface. Human-readable diagnostics should go to stderr.

## Extension Binding by Mode

Each mode binds extensions to the same `AgentSession`, but with different UI capabilities.

| Capability | Interactive | Print / JSON | RPC |
| --- | --- | --- | --- |
| Terminal UI | Full TUI context | None | None |
| Extension dialogs | TUI selectors/inputs/editors | Not provided | JSONL `extension_ui_request` |
| Session commands | Supported | Supported | Supported |
| Event consumption | Render components | Optional JSON event output | JSONL event stream |
| Session replacement | Re-render and rebind | Rebind subscription | Rebind subscription and RPC UI context |

Unsupported UI features in RPC mode are intentionally no-ops or explicit failures when they require direct TUI access, such as theme switching or custom component factories.

## Related Docs

- `doc_alfie/communication-transports.md` describes the process and transport boundaries.
- `packages/coding-agent/docs/rpc.md` describes the RPC protocol.
- `packages/coding-agent/docs/json.md` describes JSON event output.
- `doc_alfie/session-lifecycle.md` describes session creation, resume, fork, and missing-cwd behavior.
