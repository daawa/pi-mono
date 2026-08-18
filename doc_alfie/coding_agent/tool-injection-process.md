# Tool Creation and Injection Process

This document explains how Pi creates tools such as `read`, `bash`, `edit`, and `write`, injects them into the `Agent`, passes them to the LLM, and executes tool calls returned by the model.

## Table of Contents

- [Main Flow](#main-flow)
- [Tool Shapes](#tool-shapes)
- [Built-In Tool Definitions](#built-in-tool-definitions)
- [Initial Active Tools](#initial-active-tools)
- [Runtime Registry](#runtime-registry)
- [System Prompt Contributions](#system-prompt-contributions)
- [Injection into Agent State](#injection-into-agent-state)
- [Request Path](#request-path)
- [Execution Path](#execution-path)
- [Dynamic Tool Loading](#dynamic-tool-loading)
- [Rendering](#rendering)
- [Debugging Checklist](#debugging-checklist)

## Main Flow

The tool path has three phases:

1. Registration and activation: built-in, extension, and SDK `ToolDefinition` objects enter the runtime registry, are filtered, wrapped as executable `AgentTool` objects, and selected into `agent.state.tools`.
2. Prompt and request injection: active tools contribute optional system-prompt text. `packages/agent` snapshots the active tools and passes them to `packages/ai` as `Context.tools`; provider adapters convert them to API-specific schemas.
3. Execution and continuation: `packages/agent` validates and executes model-emitted tool calls, appends tool-result messages, refreshes runtime state, and makes another provider request when the loop should continue.

## Tool Shapes

| Type | Layer | Purpose |
| --- | --- | --- |
| `Tool` | `packages/ai` | Provider-facing schema: `name`, `description`, `parameters`, and optional `constrainedSampling`. |
| `AgentTool` | `packages/agent` | `Tool` plus `label`, optional argument preparation and execution mode, and local `execute()`. |
| `ToolDefinition` | `packages/coding-agent` | App-level declaration with execution, prompt contributions, extension context, and optional TUI renderers. |

The practical distinction:

- `ToolDefinition` is what Pi owns and manages.
- `AgentTool` is what the core agent loop needs.
- `Tool` is what the provider sees.

At runtime, `Context.tools` can contain `AgentTool` objects because they structurally extend `Tool`. Provider adapters serialize only provider-facing fields; local execution and rendering fields remain in memory.

## Built-In Tool Definitions

Each built-in tool exports a `create*ToolDefinition()` function under `packages/coding-agent/src/core/tools`.

Built-in tool names are:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

`createAllToolDefinitions(cwd, options?)` collects all built-ins. `AgentSession` passes settings-derived options into construction, including image auto-resize for `read` and the command prefix and shell path for `bash`.

## Initial Active Tools

`createAgentSession()` in `packages/coding-agent/src/core/sdk.ts` chooses the initial active set. Without explicit options, `defaultTools` from settings is used when configured; otherwise the built-in default is `read`, `bash`, `edit`, and `write`. Extension and SDK custom tools are active by default.

CLI flags map to the same SDK options:

| CLI | SDK | Behavior |
| --- | --- | --- |
| `--tools read,bash` | `tools: ["read", "bash"]` | Allowlist and activate only matching built-in, extension, or SDK tools. |
| `--exclude-tools <names>` | `excludeTools` | Remove matching names after the allowlist is applied. |
| `--no-tools` | `noTools: "all"` | Remove all tools from both the registry and active set. |
| `--no-builtin-tools` | `noTools: "builtin"` | Keep built-ins registered but initially inactive; extension and SDK tools stay active. |

An explicit `tools` allowlist takes precedence over `noTools`. `excludeTools` is applied after either choice.

The `Agent` itself starts with an empty `tools` array. The actual active tools are installed by `AgentSession` after it builds runtime resources.

## Runtime Registry

`AgentSession` builds tool state in two steps:

1. `_buildRuntime()` creates base definitions, creates the extension runner, and initiates registry construction.
2. `_refreshToolRegistry()` merges built-in tools, extension-registered tools, and SDK `customTools`, then derives prompt metadata and the executable registry.

The registry is keyed by tool name. Collision behavior is:

1. built-ins seed the registry
2. extension tools replace built-ins with the same name; among extensions, the first registration for a name wins
3. SDK `customTools` are applied last and replace built-in or extension tools with the same name

`pi.registerTool()` can also run after startup. It refreshes the registry immediately. A newly registered tool becomes active automatically unless an allowlist or denylist filters it out.

`wrapToolDefinition()` in `core/tools/tool-definition-wrapper.ts` converts a `ToolDefinition` to an executable `AgentTool`.

## System Prompt Contributions

Tool API schemas and system-prompt descriptions are separate:

- every active `AgentTool` is exposed through `Context.tools`
- an active tool appears in the default system prompt's `Available tools` list only if its definition has `promptSnippet`
- active `promptGuidelines` are added to the default system prompt's `Guidelines` list
- changing the active set rebuilds the system prompt so these contributions stay aligned

A custom tool without `promptSnippet` remains callable by the model through its provider schema; it is only absent from the textual `Available tools` section.

## Injection into Agent State

`AgentSession.setActiveToolsByName()` is the direct injection point:

- it resolves requested names against the registry
- it ignores unknown or filtered names
- it assigns the resulting `AgentTool[]` to `agent.state.tools`
- it rebuilds the system prompt for the active tool set
- it updates `agent.state.systemPrompt`

At the start of a run, `Agent` snapshots the system prompt, transcript, and tools. After each tool turn, `AgentSession` refreshes the next-turn context from current session state. Therefore, a change made during tool execution affects the next provider request in the same run, but it cannot alter a provider request already in progress.

## Request Path

When the user submits a prompt:

```text
AgentSession.prompt()
  -> Agent.prompt()
  -> Agent snapshots system prompt, messages, and active AgentTools
  -> agent-loop builds pi-ai Context for each provider request
  -> provider adapter converts Context.tools to API-specific schema
```

Provider adapters see only provider-facing fields from `Tool`:

- `name`
- `description`
- `parameters`
- `constrainedSampling`, when configured and supported by the adapter

Execution-only fields such as `label`, `prepareArguments`, `executionMode`, and `execute` stay local.

## Execution Path

When the provider emits assistant content with `toolCall` blocks:

1. If the assistant response ended with `stopReason: "length"`, every tool call is failed without execution because its arguments may be truncated.
2. Otherwise, `agent-loop` emits `tool_execution_start` and locates each active `AgentTool` by name.
3. It applies `prepareArguments`, then validates against the TypeBox schema.
4. It runs `beforeToolCall`. Pi's extension `tool_call` handlers can mutate the validated argument object without a second validation, block execution, and optionally mark the result for termination.
5. It executes `tool.execute()`. Thrown errors become error tool results.
6. Partial results produce `tool_execution_update`; updates after `execute()` settles are ignored.
7. It runs `afterToolCall`. Pi's extension `tool_result` handlers can replace content, details, error state, and usage; image results are normalized afterward.
8. It emits `tool_execution_end` and creates a `toolResult` message.

Tool calls are parallel by default. Preparation happens in source order, allowed calls execute concurrently, and `tool_execution_end` events can arrive in completion order. Tool-result messages are still appended in the assistant's original source order. Setting the agent to sequential execution, or including any tool with `executionMode: "sequential"`, makes the entire batch sequential.

The loop normally continues so the model can observe results. It stops after the batch only when every finalized result in that batch has `terminate: true`.

## Dynamic Tool Loading

An extension tool can call `pi.setActiveTools()` while it executes. `AgentSession` installs a next-turn refresh so the new active set and rebuilt system prompt are used by the immediately following provider request in the same run.

For a purely additive change, the extension wrapper records the added names in `toolResult.addedToolNames`:

```text
loader tool executes
  -> pi.setActiveTools([...current, "new_tool"])
  -> toolResult.addedToolNames = ["new_tool"]
  -> next provider request sees new_tool
```

Provider adapters with native deferred-tool support can anchor the new definitions at that tool result and preserve a stable schema prefix. Other providers receive the complete current active list on the next request. Replacements and removals use this full-list fallback rather than deferred loading.

Activating a tool with `promptSnippet` or `promptGuidelines` also changes the system prompt, which can invalidate a provider's cached prefix even when native deferred schemas are supported.

## Rendering

`renderCall`, `renderResult`, and `renderShell` are local TUI concerns and never enter `Context.tools`.

When an extension or SDK tool overrides a built-in tool, execution uses the winning registry definition. Rendering is resolved separately for each slot: an override-provided renderer wins, while an omitted `renderCall` or `renderResult` falls back to the built-in renderer. `renderShell: "self"` makes the tool responsible for its own framing.

## Debugging Checklist

Use this path when a tool is missing or not executing:

1. Check `AgentSession` active tool names.
2. Check `_toolDefinitions` and `_toolRegistry` for allowlist, denylist, collision, and source behavior.
3. Check `agent.state.tools` and whether `setActiveToolsByName()` ignored an unknown name.
4. If only the textual system-prompt entry is missing, check `promptSnippet`; provider exposure does not depend on it.
5. Check the initial or refreshed `AgentContext.tools` for the affected provider request.
6. Check provider payload conversion under `packages/ai/src/api/*`, including constrained or deferred-tool compatibility.
7. Check `prepareToolCall()` failures for lookup, argument preparation, schema validation, aborts, or hook blocking.
8. For multiple calls, distinguish completion-ordered events from source-ordered persisted tool results.
9. For mid-run activation, check `toolResult.addedToolNames` and the next-turn active set.
