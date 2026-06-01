# Agent Loop Queues and Hooks

## Short Answer

`packages/agent/src/agent-loop.ts` owns the low-level turn loop. It accepts an `AgentLoopConfig` with callback hooks for context conversion, provider requests, tool interception, queue draining, and next-turn state replacement.

`packages/agent/src/agent.ts` is a stateful wrapper around that loop. It stores public hook fields, owns steering and follow-up queues, builds `AgentLoopConfig`, and tracks active run settlement.

`packages/coding-agent/src/core/agent-session.ts` wires some of those hooks to extension events. In normal coding-agent runtime, extension-backed hooks include input handling, before-agent-start, tool-call interception, tool-result interception, context transforms, and provider request/response hooks. `prepareNextTurn` exists as a generic agent hook, but it is not wired to normal coding-agent extensions.

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
4. Emit `turn_end`.
5. Call `prepareNextTurn`, if configured.
6. Call `shouldStopAfterTurn`, if configured.
7. Drain steering messages.
8. If the inner loop would stop, drain follow-up messages.
9. If neither queue has messages, emit `agent_end`.

## Steering vs Follow-Up Queues

There are two queue layers:

- `Agent` owns `steeringQueue` and `followUpQueue`.
- `AgentSession` mirrors pending text in `_steeringMessages` and `_followUpMessages` for UI/RPC state and queue-clearing behavior.

`AgentSession.prompt()` routes messages differently while the agent is streaming:

- `streamingBehavior: "steer"` calls `_queueSteer()`.
- `streamingBehavior: "followUp"` calls `_queueFollowUp()`.
- no `streamingBehavior` throws, because a running agent needs explicit queue semantics.

`_queueSteer()`:

- records text in `_steeringMessages`
- emits a queue update
- converts text and images to a user message
- calls `agent.steer(message)`

`_queueFollowUp()`:

- records text in `_followUpMessages`
- emits a queue update
- converts text and images to a user message
- calls `agent.followUp(message)`

Timing difference:

| Queue | Drained when | Effect |
| --- | --- | --- |
| Steering | After a completed assistant turn and tool execution, before the next provider call | Changes direction during the current run |
| Follow-up | Only when the agent has no more tool calls and no steering messages | Runs as the next user turn after the current task would stop |

`QueueMode` controls how many queued messages are injected at each drain point:

- `"one-at-a-time"` drains only the oldest message.
- `"all"` drains every queued message.

The settings-backed values are exposed through `AgentSession.steeringMode` and `AgentSession.followUpMode`, then assigned to `agent.steeringMode` and `agent.followUpMode`.

## `prepareNextTurn`

`prepareNextTurn` is a hook called after `turn_end` and before the loop decides whether to continue.

The low-level loop passes this context:

```ts
{
  message,
  toolResults,
  context: currentContext,
  newMessages,
}
```

It may return an `AgentLoopTurnUpdate`:

```ts
{
  context?: AgentContext;
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
}
```

If returned, the loop applies the snapshot before any later stop or queue checks:

- `context` replaces `currentContext`
- `model` replaces `config.model`
- `thinkingLevel` replaces `config.reasoning`
- `thinkingLevel: "off"` clears reasoning

Current wiring:

- `AgentOptions.prepareNextTurn` stores the hook on `Agent`.
- `Agent.createLoopConfig()` passes it into `AgentLoopConfig`.
- The `Agent` wrapper passes only the active abort signal to the stored hook.
- Direct `agentLoop()` callers receive the full `PrepareNextTurnContext`.
- Normal coding-agent runtime does not set `agent.prepareNextTurn`.
- `packages/agent/src/harness/agent-harness.ts` uses it to flush pending writes and rebuild `{ context, model, thinkingLevel }`.

Use this hook when each new provider call must see refreshed runtime state, such as an updated model, thinking level, system prompt, or tool/context set.

## Tool Hooks

Tool hooks are loop-level interception points around tool execution.

### `beforeToolCall`

Called after tool arguments are prepared and validated, before the tool executes.

It receives:

- assistant message
- raw tool call block
- validated args
- current agent context
- abort signal

It may return `{ block: true, reason?: string }`. When blocked, the tool is not executed and the loop emits an error tool result.

In coding-agent, `AgentSession._installAgentToolHooks()` sets `agent.beforeToolCall` and forwards it to extension `tool_call` handlers.

### `afterToolCall`

Called after a tool finishes executing, before `tool_execution_end` and the tool-result message are emitted.

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

In coding-agent, `AgentSession._installAgentToolHooks()` sets `agent.afterToolCall` and forwards it to extension `tool_result` handlers. The coding-agent bridge currently returns `content`, `details`, and `isError`; it does not forward `terminate` from extension tool-result hooks.

### Tool Execution Order

`toolExecution` controls batch execution:

- `"parallel"` is the default.
- `"sequential"` executes each tool call fully before the next one.
- A tool definition can force sequential execution for its call.

Even in parallel mode, tool calls are prepared sequentially. Parallel execution starts after preparation. `tool_execution_end` follows completion order, while tool-result messages are emitted later in assistant source order.

## Context and Provider Hooks

These hooks run around provider calls.

### `transformContext`

Runs before `convertToLlm`.

Input and output are `AgentMessage[]`, so this is the right level for app-specific messages, context pruning, or injecting extra context. It must return a safe fallback instead of throwing.

In coding-agent, this maps to extension context hooks via `extensionRunner.emitContext(messages)`.

### `convertToLlm`

Required hook that converts internal `AgentMessage[]` into provider-facing `Message[]`.

Default behavior in `Agent` keeps only `user`, `assistant`, and `toolResult` messages. Coding-agent provides a custom converter so app-specific behavior such as image blocking can be applied before provider calls.

### `getApiKey`

Runs before each provider call and resolves an API key dynamically by provider name. This supports expiring credentials, such as OAuth tokens that may change during long tool runs.

If this returns no value, the loop falls back to `config.apiKey`.

### `onPayload`

Inherited from `SimpleStreamOptions`.

Runs inside provider adapters before sending the provider request payload. Return `undefined` to keep the payload unchanged, or return a replacement payload.

In coding-agent, this maps to extension `before_provider_request` handlers.

### `onResponse`

Inherited from `SimpleStreamOptions`.

Runs after provider response headers are available and before the body stream is consumed.

In coding-agent, this maps to extension `after_provider_response` handlers.

## Turn Control Hooks

### `shouldStopAfterTurn`

Called after `turn_end` and after `prepareNextTurn`.

If it returns `true`, the loop emits `agent_end` and exits before polling steering or follow-up queues. Current assistant output and tool execution have already completed.

Use this for graceful stop conditions, such as stopping before context grows too large.

### `getSteeringMessages`

Called at the start of the loop and after each completed turn unless `shouldStopAfterTurn` exits first.

Returned messages are emitted, appended to context, and sent before the next provider call.

`Agent.createLoopConfig()` connects this to `steeringQueue.drain()`.

### `getFollowUpMessages`

Called only when the inner loop has no more tool calls and no steering messages.

Returned messages become pending messages and continue the outer loop.

`Agent.createLoopConfig()` connects this to `followUpQueue.drain()`.

## Hook Inventory

| Hook or option | Layer | Extension-backed in normal coding-agent | Purpose |
| --- | --- | --- | --- |
| `transformContext` | Agent loop | Yes | Rewrite internal context before provider conversion |
| `convertToLlm` | Agent loop | No | Convert internal messages to provider messages |
| `getApiKey` | Agent loop | No | Resolve credentials for each provider call |
| `onPayload` | Provider stream | Yes | Inspect or replace provider payload |
| `onResponse` | Provider stream | Yes | Observe provider response metadata |
| `beforeToolCall` | Agent loop | Yes | Block a validated tool call before execution |
| `afterToolCall` | Agent loop | Yes | Override a tool result after execution |
| `prepareNextTurn` | Agent loop | No | Replace context/model/thinking before next turn |
| `shouldStopAfterTurn` | Agent loop | No | Gracefully stop before queue polling |
| `getSteeringMessages` | Agent loop | No | Drain steering queue during active run |
| `getFollowUpMessages` | Agent loop | No | Drain follow-up queue after the run would stop |
| `toolExecution` | Agent loop | No | Choose parallel or sequential tool execution |

## Active Run Settlement

`Agent` tracks one active run at a time. `runWithLifecycle()` creates an `activeRun` with:

- a promise used by `waitForIdle()`
- a stored resolver used by `finishRun()`
- an abort controller used by `abort()` and hook signals

The resolver is stored because `waitForIdle()` must return a promise immediately, while the run finishes later. `finishRun()` resolves that promise only after the executor has completed, failures have been converted to events if needed, awaited listeners have settled, and runtime state has been cleared.

This means `agent_end` is the last loop event, but the agent is not considered idle until the active run promise resolves.

## Coding-Agent Prompt Path

`AgentSession.prompt()` adds higher-level application behavior before calling the generic agent:

1. Execute extension slash commands immediately.
2. Emit extension input hooks.
3. Expand skills and prompt templates.
4. If streaming, queue as steering or follow-up.
5. Validate model and credentials when not streaming.
6. Run pre-prompt compaction if needed.
7. Build the user message and pending next-turn custom messages.
8. Emit `before_agent_start` extension hooks.
9. Apply extension-modified system prompt for the run.
10. Call the agent prompt path.

This is separate from `AgentLoopConfig.prepareNextTurn`. Prompt-time extension hooks run before a new agent run starts. `prepareNextTurn` runs inside an already active low-level loop between provider turns.
