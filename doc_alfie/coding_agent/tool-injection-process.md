# Tool Creation and Injection Process

This document explains how Pi creates tools such as `read`, `bash`, `edit`, and `write`, injects them into the `Agent`, passes them to the LLM, and executes tool calls returned by the model.

## Main Flow

The tool path has two phases:

1. Tool creation and activation: `ToolDefinition` objects are created by `packages/coding-agent`, wrapped into `AgentTool` objects, filtered by runtime options, and assigned to `agent.state.tools`.
2. Request and execution: `packages/agent` snapshots `agent.state.tools`, sends provider-facing fields to `packages/ai` as `Context.tools`, then executes model-emitted tool calls against the same active tool list.

## Tool Shapes

| Type | Layer | Purpose |
| --- | --- | --- |
| `Tool` | `packages/ai` | Provider-facing schema: `name`, `description`, `parameters`. |
| `AgentTool` | `packages/agent` | Runtime executable tool: provider metadata plus local `execute()`. |
| `ToolDefinition` | `packages/coding-agent` | App-level declaration: runtime behavior, extension context, prompt metadata, and TUI renderers. |

The practical distinction:

- `ToolDefinition` is what Pi owns and manages.
- `AgentTool` is what the core agent loop needs.
- `Tool` is what the provider sees.

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

`createAllToolDefinitions(cwd, options?)` collects all built-ins. It passes settings-derived options into tool construction, such as image auto-resize for `read` and shell options for `bash`.

## Initial Active Tools

`packages/coding-agent/src/core/sdk.ts` chooses initial active tool names:

- default: `read`, `bash`, `edit`, `write`
- `--tools read,bash`: allowlists and activates matching tools
- `--exclude-tools <names>`: disables matching names from built-in, extension, and custom tools
- `--no-tools`: starts with no built-in, extension, or custom tools
- `--no-builtin-tools`: starts with extension/custom tools but no built-in tools

The `Agent` itself starts with an empty `tools` array. The actual active tools are installed by `AgentSession` after it builds runtime resources.

## Runtime Registry

`AgentSession` builds tool state in two steps:

1. `_buildRuntime()` creates base tool definitions and stores initial active names.
2. `_refreshToolRegistry()` merges built-in tools, extension-registered tools, and SDK custom tools.

The registry is keyed by tool name. Later entries with the same name replace earlier entries in the registry.

`wrapToolDefinition()` in `core/tools/tool-definition-wrapper.ts` converts a `ToolDefinition` to an executable `AgentTool`.

## Injection into Agent State

`AgentSession.setActiveToolsByName()` is the direct injection point:

- it resolves requested names against the registry
- it assigns the resulting `AgentTool[]` to `agent.state.tools`
- it rebuilds the system prompt for the active tool set
- it updates `agent.state.systemPrompt`

Changes to `agent.state.tools` affect the next run. A run already in progress uses the context snapshot it started with.

## Request Path

When the user submits a prompt:

```text
AgentSession.prompt()
  -> Agent.prompt()
  -> Agent creates context snapshot
  -> agent-loop builds pi-ai Context
  -> provider adapter converts Context.tools to API-specific schema
```

Provider adapters see only provider-facing fields from `Tool`:

- `name`
- `description`
- `parameters`

Execution-only fields stay in memory for local tool execution.

## Execution Path

When the provider emits assistant content with `toolCall` blocks:

1. `agent-loop` locates the active `AgentTool` by name.
2. It prepares legacy/raw arguments if the tool has `prepareArguments`.
3. It validates arguments against the tool schema.
4. It runs `beforeToolCall` hooks.
5. It executes `tool.execute()`.
6. It streams partial updates as `tool_execution_update` events.
7. It runs `afterToolCall` hooks.
8. It emits `tool_execution_end`.
9. It appends a `toolResult` message in assistant source order.

The loop then continues so the model can see the result and decide whether to answer, call another tool, or stop.

## Debugging Checklist

Use this path when a tool is missing or not executing:

1. Check `AgentSession` active tool names.
2. Check `_toolDefinitions` and `_toolRegistry` for the tool name and source.
3. Check `agent.state.tools` before the prompt starts.
4. Check the `Agent` context snapshot for tools.
5. Check provider payload conversion under `packages/ai/src/api/*`.
6. Check `prepareToolCall()` errors for name, argument preparation, validation, or hook blocking.
