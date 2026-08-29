# Components Design

## `@earendil-works/pi-ai`

### Core Types

`packages/ai/src/types.ts` defines the shared provider data model:

- text and image model types
- contexts and messages
- assistant streaming event protocol
- tool and tool-call schemas
- stream options, provider options, usage, cost, and compatibility metadata

Provider behavior normalizes into shared message, usage, event, and stop-reason shapes.

### Model and Provider Runtime

`packages/ai/src/models.ts` is the modern runtime API:

- `Provider` combines provider metadata, auth semantics, model listing, refresh, and streaming.
- `Models` is a provider collection with lookup, refresh, auth application, and stream helpers.
- `createModels()` creates an empty mutable collection.
- `createProvider()` builds a provider from model lists, auth, and API stream implementations.
- `hasApi()`, `calculateCost()`, `getSupportedThinkingLevels()`, `clampThinkingLevel()`, and `modelsAreEqual()` provide runtime helpers.

`packages/ai/src/providers/all.ts` builds the built-in model collection from provider factories.

### API Implementations

Concrete API adapters live under `packages/ai/src/api`. Each adapter converts unified `Context`, tools, and options into provider-specific payloads, then converts provider responses back into an `AssistantMessageEventStream`.

Lazy wrappers under `api/*.lazy.ts` defer implementation module loading until first stream use.

### Compatibility Layer

`packages/ai/src/compat.ts` preserves the old global API surface:

- generated catalog reads: `getModel()`, `getModels()`, `getProviders()`
- global API provider registry
- `stream()`, `complete()`, `streamSimple()`, `completeSimple()`
- legacy per-provider stream aliases

This remains important because `packages/coding-agent/src/core/model-registry.ts` still imports the compat entrypoint.

## `@earendil-works/pi-agent-core`

### Agent

`packages/agent/src/agent.ts` is a stateful wrapper around the low-level loop.

Responsibilities:

- store system prompt, model, thinking level, tools, and messages
- expose `prompt()` and `continue()`
- manage steering and follow-up queues
- own abort lifecycle
- track streaming message, pending tool calls, and error state
- await subscribed event listeners before the active run settles

### Agent Loop

`packages/agent/src/agent-loop.ts` executes turns.

Responsibilities:

- emit a stable lifecycle event sequence
- transform `AgentMessage[]` to provider-compatible `Message[]`
- stream assistant responses
- append assistant messages and tool results to context
- validate tool arguments
- run pre-tool and post-tool hooks
- execute tool calls sequentially or in parallel
- inject steering and follow-up messages
- stop after errors, aborts, terminate-only tool batches, or stop hooks

### Harness

`packages/agent/src/harness/` provides an embeddable agent-session layer outside the coding-agent CLI. It includes durable session repositories, storage, compaction helpers, prompt templates, skill loading, environment abstractions, and event types.

## `@earendil-works/pi-coding-agent`

### CLI and Modes

`packages/coding-agent/src/main.ts` is the application coordinator. It parses flags, resolves sessions, creates runtime services, and launches one mode:

- `InteractiveMode`
- `runPrintMode`
- JSON event stream through print mode
- `runRpcMode`

`packages/coding-agent/src/cli.ts` is intentionally small. It sets process-level defaults and calls `main()`.

### Agent Session

`packages/coding-agent/src/core/agent-session.ts` is the main application runtime abstraction.

Responsibilities:

- wrap a generic `Agent`
- persist messages to `SessionManager`
- expand skills and prompt templates
- run extension command and input hooks
- build the system prompt from tools, resources, and context files
- validate selected model and auth
- manage model switching and thinking levels
- manage active tools, extension tools, and SDK custom tools
- handle compaction, overflow recovery, retries, and branch summaries
- execute user bash commands and record them as context
- expose session stats, HTML export, JSONL export, reload, and tree navigation

### Runtime Host

`packages/coding-agent/src/core/agent-session-runtime.ts` owns the current `AgentSession` plus cwd-bound services. It handles:

- switching sessions
- creating new sessions
- forking sessions
- importing JSONL sessions
- disposing current extension/session state
- rebinding mode-specific UI to a replacement session

This isolates session replacement from interactive, print, and RPC mode code.

### Services

`packages/coding-agent/src/core/agent-session-services.ts` creates cwd-bound services:

- `AuthStorage`
- `ModelRegistry`
- `SettingsManager`
- `DefaultResourceLoader`

`packages/coding-agent/src/core/sdk.ts` combines those services with `SessionManager`, initial model/thinking/tool options, and custom tools to create an `AgentSession`.

### Settings and Auth

`SettingsManager` merges global settings and project settings. It provides typed accessors for model defaults, transports, queues, themes, compaction, retry, terminal behavior, images, packages, resources, session directory, and extension behavior.

`AuthStorage` stores API keys and OAuth credentials. `ModelRegistry` combines auth with built-in/custom model definitions, provider overrides, extension provider registrations, and compatibility provider registrations.

### Tools

`packages/coding-agent/src/core/tools/` provides built-in tools as `ToolDefinition` and `AgentTool` forms:

- `read`: read text and image files with truncation and optional image resize
- `bash`: execute shell commands with streaming updates
- `edit`: apply exact text edits
- `write`: write file content
- `grep`: search file content
- `find`: find files by path pattern
- `ls`: list directory contents

`file-mutation-queue.ts` serializes mutating tools so concurrent tool calls do not corrupt files.

### Extensions

The extension subsystem is split into:

- contracts in `types.ts`
- module discovery and loading in `loader.ts`
- event dispatch in `runner.ts`
- tool wrapping in `wrapper.ts`

Extensions operate through explicit contexts rather than directly owning the main runtime. Stale contexts are invalidated after reloads and session replacements.

### Interactive Components

`packages/coding-agent/src/modes/interactive/components/` contains application-specific TUI components:

- assistant, user, custom, skill, branch summary, and compaction summary renderers
- tool and bash execution renderers
- session, model, settings, OAuth, extension, theme, thinking, and tree selectors
- footer, dynamic border, loaders, editors, and extension input components

These consume `AgentSessionEvent` state and delegate terminal rendering to `pi-tui`.

## `@earendil-works/pi-tui`

### Renderer

`packages/tui/src/tui.ts` defines:

- `Component`
- `Focusable`
- `Container`
- `TUI`
- overlay options and handles
- `CURSOR_MARKER`

`TUI` batches render requests, compares previous and current output, and writes synchronized ANSI updates to the terminal.

### Input and Keybindings

`keys.ts` parses terminal keyboard sequences, including Kitty keyboard protocol. `keybindings.ts` defines configurable keybinding IDs and default keys. Components consume keybindings instead of hardcoding key checks.

### Text and Interactive Components

Core components include `Text`, `TruncatedText`, `Markdown`, `Spacer`, and `Box`.

Interactive components include `Input`, `Editor`, `SelectList`, `SettingsList`, `Loader`, `CancellableLoader`, and `Image`.

`Editor` supports multiline input, undo and kill ring behavior, paste markers, autocomplete, file completion, word wrapping, and cursor placement.

### Terminal Images

`terminal-image.ts` detects terminal capabilities and renders images through Kitty or iTerm2 protocols, with text fallback when unsupported.
