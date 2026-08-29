# Communication and Transports

## Overview

The main packages communicate mostly through in-process TypeScript function calls, class methods, and event callbacks. They do not use HTTP, stdio, or pipes to talk to each other inside the normal CLI process.

External boundaries use transports:

- terminal UI uses TTY stdio and ANSI escape sequences
- model providers use HTTP, SSE, WebSocket, or provider SDK transports
- RPC mode uses JSONL over stdin/stdout
- shell commands use child-process stdio pipes
- persistence uses the filesystem

## Component Communication Map

| Components | Communication style | Transport |
| --- | --- | --- |
| `coding-agent` -> `agent-core` | Direct imports, method calls, subscriptions | In-process |
| `agent-core` -> `pi-ai` | Direct stream function calls | In-process |
| `coding-agent` -> `tui` | Direct imports, component instances, render requests | In-process |
| `tui` -> terminal | Raw keyboard input and ANSI output | TTY stdio |
| `pi-ai` -> LLM providers | Provider adapter network calls | HTTP, SSE, WebSocket, or SDK |
| `coding-agent` RPC mode -> external client | JSON command/event lines | stdin/stdout JSONL |
| `bash` tool -> shell | Spawned process | child-process stdio pipes |
| extensions -> `coding-agent` | Loaded modules and callback APIs | In-process |
| session persistence -> disk | JSONL reads/appends/rewrites | filesystem |
| settings/auth/resources -> disk | JSON, Markdown, TypeScript, JavaScript, and theme files | filesystem |

## Normal Interactive Flow

```text
User terminal
  <-> TTY stdio and ANSI
pi-tui TUI
  <-> in-process render/input APIs
coding-agent InteractiveMode
  <-> in-process AgentSessionEvent subscriptions
coding-agent AgentSession
  <-> in-process Agent calls and listener callbacks
agent-core Agent / agent-loop
  <-> in-process stream function
pi-ai provider adapter
  <-> HTTP, SSE, WebSocket, or SDK transport
LLM provider
```

## In-Process Boundaries

### `coding-agent` to `agent-core`

`AgentSession` owns an `Agent` instance from `@earendil-works/pi-agent-core`.

Main mechanisms:

- `AgentSession.prompt()` calls `agent.prompt()`.
- `AgentSession.abort()` calls `agent.abort()` and `agent.waitForIdle()`.
- `AgentSession` subscribes to `AgentEvent`s with `agent.subscribe()`.
- `AgentSession` updates `agent.state` for model, thinking level, tools, messages, and system prompt.
- `AgentSession` installs tool hooks on the `Agent`.

No HTTP, stdio, pipe, or IPC is used at this boundary.

### `agent-core` to `pi-ai`

The loop calls the configured stream function directly. In coding-agent this stream function resolves auth through `ModelRegistry` and delegates to `pi-ai`.

Main mechanisms:

- `streamAssistantResponse()` builds a `pi-ai` `Context`.
- It calls the configured stream function with model, context, and options.
- The returned `AssistantMessageEventStream` is consumed with `for await`.
- Stream events are translated into `AgentEvent`s.

Network transport starts inside the selected provider adapter.

### `coding-agent` to `tui`

Interactive mode creates `pi-tui` components directly and updates them from session events.

Main mechanisms:

- component constructors and method calls
- `TUI.addChild()`, `TUI.setFocus()`, `TUI.showOverlay()`
- `TUI.requestRender()`
- component `render(width)` and `handleInput(data)` methods

No IPC exists between `coding-agent` and `tui`; `tui` is a library used in the same Node process.

### Extensions to `coding-agent`

Extensions are loaded as TypeScript or JavaScript modules and called through typed contexts and events.

Main mechanisms:

- extension lifecycle callbacks
- registered commands, flags, tools, and keybindings
- input, tool, provider, compaction, resource, and tree-navigation hooks
- UI context methods for selectors, dialogs, widgets, footer/header, and editor control

Extension tools are wrapped into `AgentTool`s and participate in the same agent-loop execution path as built-in tools.

## External Boundaries

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

The rest of the stack sees normalized `AssistantMessageEvent` values.

### RPC Mode

RPC mode is designed for embedding the coding agent in another application.

Transport details:

- commands are JSON objects read from stdin, one line at a time
- responses and events are JSON objects written to stdout, one line at a time
- extension UI requests are emitted as RPC events and answered by RPC commands

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
