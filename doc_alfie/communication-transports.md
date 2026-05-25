# Communication and Transports

## Short Answer

The main packages communicate mostly through in-process TypeScript function calls, class methods, and event callbacks. They do not use HTTP, stdio, or pipes to talk to each other inside the normal CLI process.

External boundaries use transports:

- terminal UI uses TTY stdio and ANSI escape sequences
- model providers use HTTP, SSE, WebSocket, or provider SDK transports
- RPC mode uses JSONL over stdin/stdout
- shell commands use child-process stdio pipes

## Component Communication Map

| Components | Communication style | Transport |
| --- | --- | --- |
| `coding-agent` -> `agent-core` | Direct imports, method calls, subscriptions | In-process |
| `agent-core` -> `pi-ai` | Direct calls such as `streamSimple(model, context, options)` | In-process |
| `coding-agent` -> `tui` | Direct imports, component instances, render requests | In-process |
| `tui` -> terminal | Raw keyboard input and ANSI output | TTY stdio |
| `pi-ai` -> LLM providers | Provider adapter network calls | HTTP/SSE/WebSocket/SDK |
| `coding-agent` RPC mode -> external client | JSON command/event lines | stdin/stdout JSONL |
| `bash` tool -> shell | Spawned shell process | child-process stdio pipes |
| extensions -> `coding-agent` | Loaded modules and callback APIs | In-process |
| session persistence -> disk | JSONL file reads and appends | filesystem |
| settings/auth/resources -> disk | JSON/Markdown/TypeScript file reads and writes | filesystem |

## Normal Interactive Flow

```text
User terminal
  <-> TTY stdio and ANSI
pi-tui TUI
  <-> in-process render/input APIs
coding-agent InteractiveMode
  <-> in-process AgentSessionEvent subscriptions
coding-agent AgentSession
  <-> in-process Agent calls and event listener callbacks
agent-core Agent / agent-loop
  <-> in-process streamSimple call
pi-ai provider adapter
  <-> HTTP, SSE, WebSocket, or SDK transport
LLM provider
```

## In-Process Boundaries

### `coding-agent` to `agent-core`

`AgentSession` owns an `Agent` instance from `@earendil-works/pi-agent-core`.

Main communication mechanisms:

- `AgentSession.prompt()` calls `agent.prompt()`.
- `AgentSession.abort()` calls `agent.abort()` and `agent.waitForIdle()`.
- `AgentSession` subscribes to `AgentEvent`s with `agent.subscribe()`.
- `AgentSession` updates `agent.state` for model, thinking level, tools, messages, and system prompt.
- `AgentSession` installs `beforeToolCall` and `afterToolCall` hooks on the `Agent`.

No HTTP, stdio, pipe, or IPC is used at this boundary.

### `agent-core` to `pi-ai`

`agent-loop` calls the stream function directly. By default this is `streamSimple()` from `pi-ai`.

Main communication mechanisms:

- `streamAssistantResponse()` builds a `pi-ai` `Context`.
- It calls `streamSimple(model, context, options)`.
- The returned `AssistantMessageEventStream` is consumed with `for await`.
- Stream events are translated into `AgentEvent`s.

This boundary is also in-process. Network transport starts inside the selected `pi-ai` provider adapter.

### `coding-agent` to `tui`

Interactive mode creates `pi-tui` components directly and updates them from session events.

Main communication mechanisms:

- component constructors and method calls
- `TUI.addChild()`, `TUI.setFocus()`, `TUI.showOverlay()`
- `TUI.requestRender()`
- component `render(width)` and `handleInput(data)` methods

No IPC exists between `coding-agent` and `tui`; `tui` is a library used in the same Node process.

### Extensions to `coding-agent`

Extensions are loaded as TypeScript or JavaScript modules and called through typed contexts and events.

Main communication mechanisms:

- extension lifecycle callbacks
- registered commands and tools
- input, tool, provider, compaction, and tree-navigation hooks
- UI context methods for selectors, dialogs, widgets, footer/header, and editor control

They are in-process modules. Extension tools are wrapped into `AgentTool`s and participate in the same agent-loop tool execution path as built-in tools.

## External Transport Boundaries

### TUI to Terminal

`pi-tui` uses a `Terminal` abstraction. The default `ProcessTerminal` reads from `process.stdin` and writes to `process.stdout`.

Transport details:

- raw keyboard bytes from stdin
- ANSI escape sequences to stdout
- synchronized output escape sequences for atomic renders
- Kitty and iTerm2 graphics protocols for inline images when supported
- terminal resize callbacks

### `pi-ai` to Providers

`pi-ai` provider adapters are where network transport happens.

Depending on provider and options, this can be:

- HTTP requests
- Server-Sent Events streams
- WebSocket streams
- provider SDK clients such as OpenAI, Anthropic, Google, Mistral, or Bedrock SDKs

The rest of the stack sees only normalized `AssistantMessageEvent` values.

### RPC Mode

RPC mode is designed for embedding the coding agent in another application.

Transport details:

- commands are JSON objects read from stdin, one line at a time
- responses and events are JSON objects written to stdout, one line at a time
- extension UI requests are emitted as RPC events and answered by RPC commands

This is the main mode where `coding-agent` intentionally exposes a stdio protocol.

### Bash Tool

The `bash` tool executes shell commands through child processes.

Transport details:

- command execution uses child process spawning
- stdout and stderr are captured through process pipes
- output chunks can be streamed back as tool execution updates
- final output is recorded in the session as a `bashExecution` message

### Session and Config Files

Persistence is filesystem-based:

- sessions are JSONL files
- settings are JSON files
- auth is stored in auth files
- resources include Markdown, TypeScript, JavaScript, JSON theme files, and package paths

There is no database in the core local runtime.

## Mode-Specific Communication

| Mode | User-facing transport | Internal communication |
| --- | --- | --- |
| Interactive | TTY stdin/stdout | In-process events and TUI components |
| Print | stdout text or JSON | In-process session and agent calls |
| JSON | stdout JSON events | Same as print mode |
| RPC | stdin/stdout JSONL | In-process session calls plus RPC command dispatch |

## Key Takeaway

Inside one running `pi` process, `tui`, `coding-agent`, `agent-core`, and `pi-ai` behave like library layers. They communicate through direct calls and event streams. Transports appear only at the process edges: terminal stdio, RPC stdio, child-process pipes, filesystem persistence, and provider network calls.
