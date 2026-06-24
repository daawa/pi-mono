# Agent Loop Queues and Hooks

## Overview

`packages/agent/src/agent-loop.ts` owns the low-level turn loop. It accepts an `AgentLoopConfig` with callback hooks for context conversion, provider requests, tool interception, queue draining, stop checks, and next-turn state replacement.

`packages/agent/src/agent.ts` is a stateful wrapper around that loop. It stores hook fields, owns steering and follow-up queues, builds `AgentLoopConfig`, and tracks active run settlement.

`packages/coding-agent/src/core/agent-session.ts` wires some of those hooks to extension events. Normal coding-agent extension-backed hooks include input handling, before-agent-start, tool-call interception, tool-result interception, context transforms, and provider request/response hooks.

## Loop Shape

The loop has two nested levels:

```text
outer loop
  continues only when follow-up messages exist after the agent would stop

inner loop
  continues while there are tool calls or steering messages
```

Each assistant turn follows this order:

1. Inject pending messages, if any.
2. Call the provider and stream the assistant response.
3. Execute requested tools.
4. Append tool-result messages to context.
5. Emit `turn_end`.
6. Call `prepareNextTurn`, if configured.
7. Call `shouldStopAfterTurn`, if configured.
8. Drain steering messages.
9. If the inner loop would stop, drain follow-up messages.
10. If neither queue has messages, emit `agent_end`.

Errors or aborts emit `turn_end`, then `agent_end`, without tool execution.

## Steering vs Follow-Up Queues

There are two queue layers:

- `Agent` owns `steeringQueue` and `followUpQueue`.
- `AgentSession` mirrors pending text for UI/RPC queue state and clearing behavior.

`AgentSession.prompt()` routes messages while the agent is streaming:

- `streamingBehavior: "steer"` queues a steering message.
- `streamingBehavior: "followUp"` queues a follow-up message.
- no `streamingBehavior` throws because a running agent needs explicit queue semantics.

Timing difference:

| Queue | Drained when | Effect |
| --- | --- | --- |
| Steering | After a completed assistant turn and tool execution, before the next provider call | Changes direction during the current run. |
| Follow-up | Only when the agent has no more tool calls and no steering messages | Runs as the next user turn after the current task would stop. |

`QueueMode` controls how many queued messages are injected at each drain point:

- `"one-at-a-time"` drains only the oldest message.
- `"all"` drains every queued message.

## `prepareNextTurn`

`prepareNextTurn` is called after `turn_end` and before stop/queue checks.

It receives:

- completed assistant message
- tool result messages
- current context
- messages produced by the current loop invocation

It may return replacement context, model, or thinking level for the next provider request.

Current wiring:

- `AgentOptions.prepareNextTurn` stores the hook on `Agent`.
- `Agent.createLoopConfig()` passes it into `AgentLoopConfig`.
- The `Agent` wrapper currently passes only the active abort signal to the stored hook.
- Direct `agentLoop()` callers receive the full `PrepareNextTurnContext`.
- `packages/agent/src/harness/agent-harness.ts` uses it to flush pending writes and rebuild context/model/thinking state.

Use this hook when each new provider call must see refreshed runtime state.

## Tool Hooks

### `beforeToolCall`

Called after tool arguments are prepared and validated, before the tool executes.

It receives:

- assistant message
- raw tool call block
- validated args
- current agent context
- abort signal

It may return `{ block: true, reason?: string }`. When blocked, the tool is not executed and the loop emits an error tool result.

In coding-agent, `AgentSession` forwards this to extension `tool_call` handlers.

### `afterToolCall`

Called after a tool finishes executing, before `tool_execution_end` and before tool-result message events are emitted.

It receives:

- assistant message
- raw tool call block
- validated args
- executed result
- current error flag
- current agent context
- abort signal

It may return partial overrides:

- `content` replaces the full result content
- `details` replaces the full details payload
- `isError` replaces the error flag
- `terminate` replaces the early-termination hint

Omitted fields keep the original values. There is no deep merge.

In coding-agent, `AgentSession` forwards this to extension `tool_result` handlers.

## Tool Execution Order

`toolExecution` controls batch execution:

- `"parallel"` is the default.
- `"sequential"` executes each tool call fully before the next starts.
- a tool definition can force sequential execution for its call.

Even in parallel mode, tool calls are prepared sequentially. Parallel execution starts after preparation. `tool_execution_end` follows completion order, while tool-result messages are emitted later in assistant source order.

## Context and Provider Hooks

### `transformContext`

Runs before `convertToLlm`.

Input and output are `AgentMessage[]`, so this is the right level for app-specific messages, context pruning, or injecting extra context. It must return a safe fallback rather than throw.

In coding-agent, this maps to extension context hooks.

### `convertToLlm`

Required hook that converts internal `AgentMessage[]` into provider-facing `Message[]`.

Default behavior in `Agent` keeps only `user`, `assistant`, and `toolResult` messages. Coding-agent provides a custom converter for app-specific behavior such as image blocking.

### `getApiKey`

Runs before each provider call and resolves an API key dynamically by provider name. This supports expiring credentials, such as OAuth tokens that may change during long tool runs.

If this returns no value, the loop falls back to request options.

### `onPayload` and `onResponse`

These are inherited from `SimpleStreamOptions` and run inside provider adapters:

- `onPayload` runs before sending a provider request payload and may return a replacement payload.
- `onResponse` runs after provider response headers are available and before the body stream is consumed.

In coding-agent, they map to extension `before_provider_request` and `after_provider_response` handlers.

## Turn Control Hooks

| Hook or option | Layer | Extension-backed in normal coding-agent | Purpose |
| --- | --- | --- | --- |
| `transformContext` | Agent loop | Yes | Rewrite internal context before provider conversion. |
| `convertToLlm` | Agent loop | No | Convert internal messages to provider messages. |
| `getApiKey` | Agent loop | No | Resolve credentials for each provider call. |
| `onPayload` | Provider stream | Yes | Inspect or replace provider payload. |
| `onResponse` | Provider stream | Yes | Observe provider response metadata. |
| `beforeToolCall` | Agent loop | Yes | Block a validated tool call before execution. |
| `afterToolCall` | Agent loop | Yes | Override a tool result after execution. |
| `prepareNextTurn` | Agent loop | No | Replace context/model/thinking before next turn. |
| `shouldStopAfterTurn` | Agent loop | No | Gracefully stop before queue polling. |
| `getSteeringMessages` | Agent loop | No | Drain steering queue during an active run. |
| `getFollowUpMessages` | Agent loop | No | Drain follow-up queue after the run would stop. |
| `toolExecution` | Agent loop | No | Choose parallel or sequential tool execution. |

## Active Run Settlement

`Agent` tracks one active run at a time. `agent_end` is the last loop event, but the agent is not considered idle until the active run promise resolves after the executor completes and awaited listeners settle.

This is why callers that need a stable post-run state should use `agent.waitForIdle()`.
