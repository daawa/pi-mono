# Components Design

## `@earendil-works/pi-ai`

### Core Types

`packages/ai/src/types.ts` defines the shared provider data model:

- `Model<TApi>` and `ImagesModel<TApi>`
- `Context` and `ImagesContext`
- `UserMessage`, `AssistantMessage`, `ToolResultMessage`
- text, image, thinking, and tool-call content blocks
- `AssistantMessageEvent` streaming protocol
- stream options, provider options, usage, costs, and compatibility metadata

This package treats provider behavior as an adapter problem. All providers normalize into the same message, usage, event, and stop-reason model.

### Model Registry

`packages/ai/src/models.ts` wraps generated model metadata:

- returns known providers and models
- calculates usage cost
- resolves supported thinking levels
- clamps requested thinking levels to model support
- compares models by provider and id

The generated model files are data inputs. Provider adapters are registered separately.

### Provider Registry

`packages/ai/src/api-registry.ts` stores provider implementations by API name. It validates that a model's `api` matches the registered API before dispatching.

`packages/ai/src/stream.ts` uses that registry to implement:

- `stream`
- `complete`
- `streamSimple`
- `completeSimple`

The `simple` variants accept unified reasoning options and are the primary entrypoint used by the agent runtime.

### Provider Adapters

`packages/ai/src/providers/` contains concrete adapters. Each adapter converts unified `Context`, tools, and options into provider-specific payloads, then converts provider responses back into `AssistantMessageEventStream`.

## `@earendil-works/pi-agent-core`

### Agent

`packages/agent/src/agent.ts` is a stateful wrapper around the low-level loop.

Responsibilities:

- stores system prompt, model, thinking level, tools, and messages
- exposes `prompt()` and `continue()`
- manages steering and follow-up queues
- owns abort lifecycle
- tracks streaming message, pending tool calls, and error state
- awaits subscribed event listeners before settling the run

### Agent Loop

`packages/agent/src/agent-loop.ts` executes turns.

Responsibilities:

- emits a stable lifecycle event sequence
- transforms `AgentMessage[]` to provider-compatible `Message[]`
- streams assistant responses
- appends partial and final assistant messages to context
- validates tool arguments
- runs tool preflight and postprocessing hooks
- executes tools sequentially or in parallel
- injects steering and follow-up messages
- stops after errors, aborts, terminate-only tool batches, or explicit stop hooks

### Harness

`packages/agent/src/harness/` contains a higher-level runtime layer for embedding agent sessions outside the coding-agent CLI. It includes session repositories, durable storage, compaction helpers, prompt templates, skill loading, and environment abstractions.

## `@earendil-works/pi-coding-agent`

### CLI and Modes

`packages/coding-agent/src/main.ts` is the application coordinator. It parses flags, resolves sessions, creates runtime services, and launches one mode:

- `InteractiveMode`: terminal chat UI
- `runPrintMode`: one-shot text output
- JSON mode: print-mode event JSON
- `runRpcMode`: JSONL command protocol

`packages/coding-agent/src/cli.ts` is intentionally small. It sets process-level defaults and calls `main()`.

### Agent Session

`packages/coding-agent/src/core/agent-session.ts` is the main application runtime abstraction.

Responsibilities:

- wraps a generic `Agent`
- persists messages to `SessionManager`
- expands skills and prompt templates
- runs extension command and input hooks
- builds the system prompt from resources and active tools
- validates selected model and auth
- manages model switching and thinking levels
- manages active tools and extension tools
- handles compaction, overflow recovery, retries, and branch summaries
- executes user bash commands and records them as context
- exposes session stats, HTML export, JSONL export, and tree navigation

### Runtime Host

`packages/coding-agent/src/core/agent-session-runtime.ts` owns the current `AgentSession` plus cwd-bound services. It handles:

- switching sessions
- creating new sessions
- forking sessions
- importing JSONL sessions
- disposing current extension/session state
- rebinding mode-specific UI to a replacement session

This isolates session replacement from the interactive, print, and RPC modes.

### Services

`packages/coding-agent/src/core/agent-session-services.ts` and `sdk.ts` create the services needed by a session:

- `AuthStorage`
- `ModelRegistry`
- `SettingsManager`
- `DefaultResourceLoader`
- `SessionManager`
- built-in and custom tools

These services are cwd-bound because project config, extensions, context files, prompts, and sessions can differ per workspace.

### Settings and Auth

`SettingsManager` merges global settings and project settings. It provides typed accessors for:

- model defaults
- transport
- steering and follow-up mode
- themes
- compaction
- retry
- terminal behavior
- images
- packages, extensions, skills, prompts, themes
- session directory
- HTTP idle timeout

`AuthStorage` stores API keys and OAuth credentials. `ModelRegistry` combines auth with built-in/custom model definitions and provider overrides.

### Resource Loader

`DefaultResourceLoader` discovers and loads:

- extensions
- skills
- prompt templates
- themes
- context files
- system prompt overrides

It also resolves resources provided by packages and extensions.

### Tools

`packages/coding-agent/src/core/tools/` provides built-in tools as both `ToolDefinition` and `AgentTool` forms:

- `read`: read text and image files with truncation and optional image resize.
- `bash`: execute shell commands with streaming updates.
- `edit`: replace text in files with diff support.
- `write`: write files and render output summaries.
- `grep`: search file content.
- `find`: find files by path pattern.
- `ls`: list directory contents.

`file-mutation-queue.ts` serializes file mutations so concurrent tools do not corrupt files.

### Extensions

The extension subsystem is split into:

- types and contracts in `types.ts`
- module discovery/loading in `loader.ts`
- event dispatch in `runner.ts`
- tool wrapping in `wrapper.ts`

Extensions operate through explicit contexts instead of directly owning the main runtime. Stale contexts are invalidated after reloads and session replacements.

### Interactive Components

`packages/coding-agent/src/modes/interactive/components/` contains application-specific TUI components:

- assistant/user/custom message renderers
- tool and bash execution renderers
- session, model, settings, OAuth, extension, theme, thinking selectors
- tree selector and branch/compaction summary components
- footer, header, dynamic border, loaders
- custom editor and extension editor/input components

These components consume `AgentSessionEvent` state and delegate terminal rendering to `pi-tui`.

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

### Text Components

Core components include:

- `Text`
- `TruncatedText`
- `Markdown`
- `Spacer`
- `Box`

They provide line rendering with ANSI-aware width handling and truncation.

### Interactive Components

Interactive components include:

- `Input`
- `Editor`
- `SelectList`
- `SettingsList`
- `Loader`
- `CancellableLoader`
- `Image`

`Editor` supports multiline input, undo/kill ring behavior, paste markers, autocomplete, file completion, word wrapping, and IME cursor placement.

### Terminal Images

`terminal-image.ts` detects terminal capabilities and renders images through Kitty or iTerm2 protocols, with text fallback when unsupported.

