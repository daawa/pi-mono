# Harness Workflow

## Scope

This document traces how a coding-agent CLI invocation reaches the low-level agent loop.

Important: `packages/agent/src/harness/agent-harness.ts` is not called by
`packages/coding-agent/src/cli.ts` or `packages/coding-agent/src/main.ts` in
the current CLI implementation.

There are two related paths in the workspace:

- Current `pi` CLI path: `packages/coding-agent/src/cli.ts` uses `AgentSession`, which wraps `@earendil-works/pi-agent-core` `Agent`.
- New package harness path: `packages/agent/src/harness/agent-harness.ts` exports `AgentHarness`, which calls `runAgentLoop()` directly.

Both paths converge at `packages/agent/src/agent-loop.ts`.

So there is no current step-by-step chain like:

```text
cli.ts -> main.ts -> agent-harness.ts
```

The current shipped CLI chain is:

```text
cli.ts
  -> main.ts
  -> createAgentSessionRuntime()
  -> createAgentSessionFromServices()
  -> createAgentSession()
  -> new Agent(...)
  -> new AgentSession(...)
  -> selected mode
  -> AgentSession.prompt()
  -> Agent.prompt()
  -> runAgentLoop()
```

The direct harness chain is used when code explicitly constructs `AgentHarness`:

```text
new AgentHarness(...)
  -> AgentHarness.prompt()
  -> AgentHarness.createTurnState()
  -> AgentHarness.executeTurn()
  -> runAgentLoop()
```

## Current CLI Startup Path

The normal Node CLI entrypoint is:

```text
packages/coding-agent/src/cli.ts
  -> main(process.argv.slice(2))
```

`cli.ts` only prepares process-level state:

- sets `process.title`
- marks `PI_CODING_AGENT=true`
- suppresses process warnings
- configures the HTTP dispatcher
- delegates to `main()`

The Bun entrypoint `packages/coding-agent/src/bun/cli.ts` restores Bun sandbox environment, registers Bedrock support, then imports the same `../cli.ts` entrypoint.

## `main.ts`

`packages/coding-agent/src/main.ts` owns process startup and mode dispatch.

High-level flow:

```text
main(args)
  -> parseArgs(args)
  -> resolveAppMode(parsed, stdinIsTTY, stdoutIsTTY)
  -> create or open SessionManager
  -> build createRuntime closure
  -> createAgentSessionRuntime(createRuntime, ...)
  -> prepare initial prompt content
  -> dispatch to rpc, interactive, print, or json mode
```

Important responsibilities:

- handles package and config fast paths before normal runtime creation
- resolves mode early so stdout ownership is correct
- runs migrations and first-time setup
- selects, forks, resumes, or creates a session
- resolves project trust and cwd-bound resource paths
- creates shared `AuthStorage`
- builds a `createRuntime` factory for cwd-bound runtime recreation
- reports diagnostics after runtime creation
- dispatches to `runRpcMode()`, `InteractiveMode.run()`, or `runPrintMode()`

The `createRuntime` closure exists because a session operation can change the effective cwd. Each runtime creation rebuilds cwd-bound services before creating the session.

`main.ts` does not import or instantiate `AgentHarness`. Its runtime factory
creates an `AgentSessionRuntime`, and that runtime owns an `AgentSession`.

## Runtime Creation

`main.ts` calls:

```text
createAgentSessionRuntime(createRuntime, {
  cwd,
  agentDir,
  sessionManager,
})
```

`createAgentSessionRuntime()` stores the active `AgentSession` and services in an `AgentSessionRuntime`. That runtime is the long-lived host object passed to interactive, print, JSON, and RPC modes.

Inside the `createRuntime` closure:

```text
createAgentSessionServices(...)
  -> DefaultResourceLoader.reload(...)
  -> register extension-provided providers
  -> return settings, auth, model registry, resources, diagnostics

buildSessionOptions(...)
  -> resolve CLI model, thinking level, scoped models, tool filters

createAgentSessionFromServices(...)
  -> createAgentSession(...)
```

`createAgentSessionServices()` does infrastructure setup only. `createAgentSessionFromServices()` creates the actual `AgentSession` after model, thinking, and tool options are known.

## Session Creation

`createAgentSession()` in `packages/coding-agent/src/core/sdk.ts` builds the current CLI runtime stack:

```text
createAgentSession()
  -> resolve cwd, agentDir, auth, model registry, settings, session manager
  -> load resources if needed
  -> restore or select model and thinking level
  -> compute initial active tools
  -> new Agent(...)
  -> restore existing transcript into Agent state, or persist initial model/thinking entries
  -> new AgentSession(...)
```

The `Agent` is configured with coding-agent behavior:

- `convertToLlm` filters internal message types and optionally blocks images
- `streamFn` resolves auth, retry settings, timeout settings, attribution headers, and calls `streamSimple()`
- `onPayload` forwards to extension `before_provider_request`
- `onResponse` forwards to extension `after_provider_response`
- `transformContext` forwards to extension context handlers
- queue modes, transport, thinking budgets, and session id come from settings/session state

The `AgentSession` wraps that lower-level `Agent` with coding-agent responsibilities:

- system prompt/resource/tool construction
- extension commands and extension event dispatch
- prompt template and skill expansion
- model/auth preflight
- session persistence
- retry and compaction decisions
- tree navigation and branch summaries
- UI/RPC-facing event subscription

This is the point where the current CLI path makes the architectural choice:
it constructs `Agent` plus `AgentSession`, not `AgentHarness`.

## Mode Dispatch To `session.prompt()`

All user-facing modes eventually call `AgentSession.prompt()`.

```text
print/json:
  runPrintMode(runtime)
    -> session.bindExtensions(...)
    -> session.prompt(initialMessage)
    -> session.prompt(each extra message)

interactive:
  new InteractiveMode(runtime).run()
    -> session.bindExtensions(...)
    -> session.prompt(initial CLI message)
    -> session.prompt(editor input)
    -> session.prompt(..., { streamingBehavior: "steer" | "followUp" }) while streaming

rpc:
  runRpcMode(runtime)
    -> parse JSONL prompt command
    -> session.prompt(command.message, ...)
```

Modes own process edges: TUI input, stdout text/JSON, or RPC command parsing. They do not create separate agent implementations.

## `AgentSession.prompt()`

`AgentSession.prompt()` is the coding-agent prompt gate.

Before the low-level agent sees a message, it:

1. handles extension slash commands
2. emits extension `input` handlers
3. expands explicit skill commands and prompt templates
4. routes messages to steer/follow-up queues if the agent is already streaming
5. flushes pending bash execution messages
6. validates selected model and configured auth
7. runs pre-prompt compaction checks when needed
8. builds the user `AgentMessage`
9. injects pending next-turn messages
10. emits `before_agent_start`
11. applies any extension-provided system prompt override
12. calls `_runAgentPrompt(messages)`

`_runAgentPrompt()` calls:

```text
agent.prompt(messages)
while (_handlePostAgentRun()) {
  agent.continue()
}
```

The post-run loop handles retry, auto-compaction, and queued messages that were added by `agent_end` extension handlers.

## `Agent` To `runAgentLoop()`

`packages/agent/src/agent.ts` is the stateful wrapper around the low-level loop.

`Agent.prompt()`:

```text
Agent.prompt(input)
  -> normalizePromptInput(input)
  -> runPromptMessages(messages)
  -> runWithLifecycle(...)
  -> runAgentLoop(
       messages,
       createContextSnapshot(),
       createLoopConfig(),
       processEvents,
       abortSignal,
       streamFn,
     )
```

The context snapshot includes the current system prompt, transcript messages, and tools. The loop config includes:

- current model and reasoning level
- session id
- payload and response hooks
- transport and retry settings
- tool hooks
- `prepareNextTurn`
- message conversion
- context transform
- dynamic API-key lookup
- steering and follow-up queue drain callbacks

`Agent` reduces loop events into local state in `processEvents()`, then awaits subscribed listeners. `AgentSession` is one of those listeners.

## `runAgentLoop()`

`packages/agent/src/agent-loop.ts` is the low-level turn engine.

Initial flow:

```text
runAgentLoop(prompts, context, config, emit, signal, streamFn)
  -> append prompts to current context
  -> emit agent_start
  -> emit turn_start
  -> emit message_start/message_end for each prompt
  -> runLoop(...)
```

`runLoop()` has two nested loops:

```text
outer loop:
  keeps running only when follow-up messages exist after the agent would stop

inner loop:
  keeps running while there are tool calls or steering messages
```

One assistant turn:

1. emit `turn_start` after the first turn
2. inject pending steering/follow-up messages, if present
3. call `streamAssistantResponse()`
4. transform internal context
5. convert internal messages to provider-facing messages
6. call the configured stream function
7. emit streaming message events until assistant `done` or `error`
8. execute tool calls, sequentially or in parallel
9. emit tool execution and tool-result message events
10. emit `turn_end`
11. call `prepareNextTurn()`
12. call `shouldStopAfterTurn()`, if configured
13. drain steering messages
14. if the inner loop is done, drain follow-up messages
15. emit `agent_end` when no more work remains

Errors and aborts produce an assistant error/aborted message, then `turn_end`, then `agent_end`.

## Event Return Path

Events flow back up in the reverse direction:

```text
runAgentLoop()
  -> Agent.processEvents()
  -> AgentSession._handleAgentEvent()
  -> mode subscribers / extension handlers / session persistence
```

`Agent.processEvents()` updates low-level state:

- streaming message
- finalized transcript messages
- pending tool calls
- error state

`AgentSession._handleAgentEvent()` then:

- clears UI/RPC queue mirrors when queued user messages start
- emits corresponding extension events
- emits `AgentSessionEvent` to mode subscribers
- persists `user`, `assistant`, `toolResult`, and `custom` messages on `message_end`
- tracks the last assistant message for retry and compaction decisions

In JSON mode, the print-mode subscriber serializes these `AgentSessionEvent` values to stdout. In interactive mode, the TUI subscriber renders them. In RPC mode, they become protocol events.

## Why `agent-harness.ts` Is Not In The CLI Chain

`AgentHarness` lives in `packages/agent`, not `packages/coding-agent`.
It is exported from `packages/agent/src/index.ts`, and current direct callers
are tests and scratch examples under `packages/agent/test`.

The current coding-agent CLI does not call it because `packages/coding-agent`
still uses the older stack:

```text
AgentSession
  -> Agent
  -> runAgentLoop()
```

`AgentHarness` is a newer orchestration layer in the lower-level package. It
absorbs responsibilities that `AgentSession` and `Agent` split today:

- session persistence
- turn snapshots
- queue draining
- provider hooks
- tool hooks
- compaction
- tree navigation
- pending session writes

If coding-agent migrates to `AgentHarness`, the likely replacement point is
`createAgentSession()` in `packages/coding-agent/src/core/sdk.ts`. Instead of:

```text
new Agent(...)
new AgentSession({ agent, ... })
```

that factory would need to construct and adapt:

```text
new AgentHarness(...)
```

Then the mode layer would need a compatibility surface with the APIs it uses
today from `AgentSession`, such as `prompt()`, `bindExtensions()`, `subscribe()`,
`state`, session replacement hooks, and UI/RPC command actions.

## Direct `AgentHarness` Path

The newer `packages/agent/src/harness/agent-harness.ts` path bypasses `AgentSession` and calls `runAgentLoop()` directly:

```text
new AgentHarness(...)
  -> prompt(text)
  -> createTurnState()
  -> executeTurn(...)
  -> runAgentLoop(...)
```

`AgentHarness` owns session persistence, turn snapshots, queues, provider hooks, compaction, tree navigation, and pending session writes itself.

Step-by-step inside `AgentHarness.prompt()`:

1. Reject if the harness phase is not idle.
2. Set phase to `turn`.
3. Create a run-settlement promise.
4. Call `createTurnState()`.
5. Resolve persisted session context via `session.buildContext()`.
6. Snapshot resources, stream options, session id, model, thinking level, tools, and active tools.
7. Resolve the system prompt string or system prompt provider.
8. Call `executeTurn(turnState, text, options)`.
9. Build the user message and prepend queued `nextTurn` messages.
10. Emit `before_agent_start`.
11. Create an abort controller.
12. Call `runAgentLoop(...)`.
13. Persist agent messages in `handleAgentEvent()` on `message_end`.
14. On `turn_end`, flush pending session writes and emit `save_point`.
15. On `agent_end`, flush pending writes, set phase back to idle, and emit `settled`.
16. Return the last assistant message.

Current path comparison:

- CLI path: `AgentSession -> Agent -> runAgentLoop()`
- `AgentHarness` path: `AgentHarness -> runAgentLoop()`

The direct harness path is exported from `packages/agent/src/index.ts` and covered by `packages/agent/test/harness/*`, but the current coding-agent CLI startup path does not instantiate `AgentHarness`.

## Source Map

| Area | File |
| --- | --- |
| Node CLI entrypoint | `packages/coding-agent/src/cli.ts` |
| Bun CLI entrypoint | `packages/coding-agent/src/bun/cli.ts` |
| CLI startup and mode dispatch | `packages/coding-agent/src/main.ts` |
| Runtime host | `packages/coding-agent/src/core/agent-session-runtime.ts` |
| Runtime services | `packages/coding-agent/src/core/agent-session-services.ts` |
| Session factory | `packages/coding-agent/src/core/sdk.ts` |
| Coding-agent session wrapper | `packages/coding-agent/src/core/agent-session.ts` |
| Print and JSON mode | `packages/coding-agent/src/modes/print-mode.ts` |
| Interactive mode | `packages/coding-agent/src/modes/interactive/interactive-mode.ts` |
| RPC mode | `packages/coding-agent/src/modes/rpc/rpc-mode.ts` |
| Stateful low-level agent wrapper | `packages/agent/src/agent.ts` |
| Low-level loop | `packages/agent/src/agent-loop.ts` |
| New direct harness | `packages/agent/src/harness/agent-harness.ts` |
