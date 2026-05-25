# Architecture Design

## Package Layers

The system is layered from provider APIs up to the user-facing CLI:

```text
packages/coding-agent
  depends on: packages/agent, packages/ai, packages/tui

packages/agent
  depends on: packages/ai

packages/ai
  owns provider adapters and model registries

packages/tui
  independent terminal UI foundation
```

The dependency direction is intentionally one-way. `pi-ai` knows nothing about agents. `pi-agent-core` knows nothing about the coding-agent CLI or TUI. `pi-tui` is a reusable rendering layer. `pi-coding-agent` composes all of them into the `pi` application.

## Runtime Startup Flow

```text
pi binary
  -> src/cli.ts
  -> main(args)
  -> parse args and mode
  -> run migrations
  -> choose or create SessionManager
  -> create cwd-bound services
  -> load settings, auth, models, resources, extensions
  -> create AgentSessionRuntime
  -> run interactive, print, json, or rpc mode
```

Key files:

- `packages/coding-agent/src/cli.ts`
- `packages/coding-agent/src/main.ts`
- `packages/coding-agent/src/core/agent-session-services.ts`
- `packages/coding-agent/src/core/sdk.ts`
- `packages/coding-agent/src/core/agent-session-runtime.ts`

## Core Agent Flow

The central runtime path for a prompt is:

```text
mode layer
  -> AgentSession.prompt()
  -> Agent.prompt()
  -> runAgentLoop()
  -> streamAssistantResponse()
  -> pi-ai streamSimple()
  -> provider adapter
  -> assistant message events
  -> tool calls, if any
  -> tool result messages
  -> next turn or agent_end
```

`AgentSession` adds application behavior around the generic `Agent`:

- prompt template and skill expansion
- extension input hooks
- auth preflight
- dynamic system prompt construction
- session persistence
- model and thinking-level state
- tool registry and active tool selection
- compaction and retry
- bash command recording
- tree navigation and branch summaries

`Agent` and `agent-loop` remain generic:

- `Agent` owns mutable state, queues, abort handling, and listener settlement.
- `agent-loop` owns turn execution, provider streaming, tool validation, tool execution order, and event sequencing.

## Event Model

`pi-agent-core` emits low-level `AgentEvent` values:

```text
agent_start
turn_start
message_start
message_update
message_end
tool_execution_start
tool_execution_update
tool_execution_end
turn_end
agent_end
```

`AgentSession` subscribes to these events and adds:

- persistence to `SessionManager`
- extension event translation
- queue display events
- compaction lifecycle events
- retry lifecycle events
- session metadata change events
- thinking-level change events

The mode layer consumes `AgentSessionEvent` values and renders or serializes them:

- interactive mode renders TUI components
- print mode outputs final assistant text or JSON events
- RPC mode sends JSONL events and command responses

## Provider Architecture

`pi-ai` separates model metadata from API execution:

- `models.generated.ts` contains built-in model definitions.
- `models.ts` exposes `getModel`, `getProviders`, `getModels`, and thinking-level helpers.
- `api-registry.ts` registers runtime provider implementations by API name.
- `stream.ts` dispatches `stream`, `complete`, `streamSimple`, and `completeSimple` to the registered provider.
- `providers/register-builtins.ts` registers built-in text providers.
- `providers/images/register-builtins.ts` registers image providers.

The coding agent uses `ModelRegistry` to combine:

- built-in models from `pi-ai`
- local provider overrides from `models.json`
- custom provider registrations from extensions
- API key, OAuth, and header resolution from auth storage and config values

## Tool Architecture

Tool layers:

```text
ToolDefinition
  -> wrapped as AgentTool
  -> registered on AgentSession
  -> exposed to Agent
  -> converted to pi-ai Tool schema
  -> selected by provider
  -> executed by agent-loop
```

Built-in tools:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

Default active tools are `read`, `bash`, `edit`, and `write`. Read-only helper tools exist for SDK use and extension workflows.

Tool execution defaults to parallel batches in `pi-agent-core`, with sequential fallback when the global mode or any specific tool requires sequential execution. `beforeToolCall` and `afterToolCall` hooks let the coding-agent extension runner block, inspect, or rewrite tool execution results.

## Session Architecture

Sessions are JSONL files managed by `SessionManager`.

The first line is a `SessionHeader`; following lines are entries with `id`, `parentId`, and `timestamp`. The parent link makes a session a tree instead of a flat transcript.

Entry types include:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `session_info`

`SessionManager.buildSessionContext()` converts the selected branch into:

- model restore data
- thinking-level restore data
- `AgentMessage[]` context for the runtime

Tree navigation changes the current leaf. Forking creates a new session file with a selected branch. Branch summaries can preserve abandoned path context when navigating to another branch.

## Resource Architecture

`DefaultResourceLoader` resolves runtime resources from several sources:

- global config under the agent dir
- project config under `.pi`
- package-provided resources
- command-line paths
- extension-discovered resources
- in-process extension factories

Resource types:

- extensions
- skills
- prompt templates
- themes
- project context files such as `AGENTS.md` and `CLAUDE.md`
- custom system prompt and append-system-prompt content

Resources are loaded before `AgentSession` builds its runtime. Extensions can later contribute additional skill, prompt, and theme paths via `resources_discover`, after which `AgentSession` rebuilds the system prompt.

## Extension Architecture

Extensions are TypeScript modules loaded by the coding-agent package. They can:

- handle lifecycle events
- register commands
- register tools
- register keybindings and flags
- inspect or transform inputs
- alter provider payloads
- add UI widgets or dialogs
- add resources
- manage provider registrations
- participate in compaction and tree navigation

Important files:

- `packages/coding-agent/src/core/extensions/types.ts`
- `packages/coding-agent/src/core/extensions/loader.ts`
- `packages/coding-agent/src/core/extensions/runner.ts`
- `packages/coding-agent/src/core/extensions/wrapper.ts`

`AgentSession` binds extension core APIs, command APIs, UI APIs, and provider APIs. When sessions are replaced, the previous extension context is invalidated and a fresh context is bound to the new session.

## TUI Architecture

`pi-tui` uses a simple component interface:

```ts
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
}
```

`TUI` extends `Container` and manages:

- child components
- focused component
- input listeners
- overlay stack
- terminal resize handling
- IME cursor placement through `CURSOR_MARKER`
- Kitty/iTerm2 image cleanup
- differential rendering

Rendering strategy:

1. first render writes all lines
2. width or height changes trigger full redraws
3. normal updates compare old and new lines and rewrite only changed lines

The interactive coding-agent mode builds on this with chat message components, editor components, selectors, footer/header components, tool renderers, and extension UI primitives.

## State Boundaries

| State | Owner |
| --- | --- |
| Provider model metadata | `pi-ai` model registry and generated model files |
| Provider stream implementation registry | `pi-ai` API registries |
| Generic prompt state and tool queues | `pi-agent-core` `Agent` |
| Turn execution state | `pi-agent-core` `agent-loop` |
| Session transcript tree | `pi-coding-agent` `SessionManager` |
| Runtime config, auth, resources | `pi-coding-agent` settings/auth/resource/model services |
| User interface state | mode-specific code, especially `InteractiveMode` and TUI components |
| Terminal rendering state | `pi-tui` `TUI` |

