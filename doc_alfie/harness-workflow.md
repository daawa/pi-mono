# AgentHarness and AgentSession: Execution, Lanes, and Recovery

## Table of Contents

- [Scope](#scope)
- [Current CLI Startup Path](#current-cli-startup-path)
  - [`main.ts`](#maints)
  - [Runtime Creation](#runtime-creation)
  - [Session Creation](#session-creation)
  - [Mode Dispatch To `session.prompt()`](#mode-dispatch-to-sessionprompt)
  - [`AgentSession.prompt()`](#agentsessionprompt)
  - [`Agent` To `runAgentLoop()`](#agent-to-runagentloop)
  - [`runAgentLoop()`](#runagentloop)
  - [Event Return Path](#event-return-path)
- [Why `agent-harness.ts` Is Not In The CLI Chain](#why-agent-harnessts-is-not-in-the-cli-chain)
- [AgentSession Resume Versus AgentHarness Recovery](#agentsession-resume-versus-agentharness-recovery)
  - [Is AgentSession resume enough?](#is-agentsession-resume-enough)
  - [Concrete crash: parallel tools A and B](#concrete-crash-parallel-tools-a-and-b)
- [Durable Execution and Its Limits](#durable-execution-and-its-limits)
  - [Intent, effect, settlement](#intent-effect-settlement)
  - [Attachment does not execute work](#attachment-does-not-execute-work)
  - [What it does not guarantee](#what-it-does-not-guarantee)
- [What an AgentLane Is](#what-an-agentlane-is)
  - [Are lanes created automatically?](#are-lanes-created-automatically)
  - [Who connects lane results?](#who-connects-lane-results)
- [The Lane/Operation State Machine](#the-laneoperation-state-machine)
  - [Two nested machines](#two-nested-machines)
  - [The 13 operation leaves](#the-13-operation-leaves)
  - [Recovery is the same dispatch as execution](#recovery-is-the-same-dispatch-as-execution)
  - [The atomic transition rule](#the-atomic-transition-rule)
  - [Orthogonal axes: cancellation, tool children, retries, inbox](#orthogonal-axes-cancellation-tool-children-retries-inbox)
  - [Terminal transaction](#terminal-transaction)
  - [`runGeneration` is the assistant-turn LLM entrypoint](#rungeneration-is-the-assistant-turn-llm-entrypoint)
  - [How `assistant.ready` is triggered](#how-assistantready-is-triggered)
  - [How `assistant.retry_wait` is triggered](#how-assistantretrywait-is-triggered)
- [Live Events, Lane Tags, and Completed Results](#live-events-lane-tags-and-completed-results)
  - [The lane tag is runtime metadata](#the-lane-tag-is-runtime-metadata)
  - [Observation is not settlement](#observation-is-not-settlement)
- [Complete Example: Fix, Review, and Revise](#complete-example-fix-review-and-revise)
  - [Scenario and assumptions](#scenario-and-assumptions)
  - [Expected timeline and ownership](#expected-timeline-and-ownership)
  - [Suspension, restart, and the host workflow boundary](#suspension-restart-and-the-host-workflow-boundary)
  - [Concurrent lanes](#concurrent-lanes)
- [Documentation and Implementation Status](#documentation-and-implementation-status)
- [Source Map](#source-map)

## Scope

This document explains the normal coding-agent CLI path and the separate durable AgentHarness path, including conversation resume versus execution recovery, lane creation, event routing, and a complete fix/review host example.

The harness analysis was verified against local source `317284159` on 2026-09-10. The normative reference is [AgentHarness specification](../packages/agent/docs/harness.md), especially §§0.2–0.9 and Parts 3–5. Implementation and selected test source were cross-checked; tests and live provider calls were not run for this documentation update.

**Conclusion:** AgentSession is sufficient to reopen a saved conversation and continue work. AgentHarness additionally records execution state and recovers unfinished operations under explicit rules. It is not required merely because a product needs a resume button.

Important: `packages/agent/src/harness/agent-harness.ts` is not called by
`packages/coding-agent/src/cli.ts` or `packages/coding-agent/src/main.ts` in
the current CLI implementation.

There are two related paths in the workspace:

- Current `pi` CLI path: `packages/coding-agent/src/cli.ts` uses `AgentSession`, which wraps `@earendil-works/pi-agent-core` `Agent`.
- Durable harness path: `AgentHarness.create()` attaches to a Session; named AgentLanes execute through `driveOperation()` and durable procedures.

The current paths do **not** converge at `agent-loop.ts`. They share lower-level model/tool concepts, but have distinct orchestration. Earlier versions of this document incorrectly described the current harness as `new AgentHarness() -> runAgentLoop()`; that was an older implementation.

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

The durable harness chain is used when host code explicitly attaches `AgentHarness`:

```text
open persistent Session
  -> AgentHarness.create(options, context)
  -> harness.lane(name, context)
  -> lane.prompt(...)                    convenience
       -> lane.accept(...)              durable operation admission
       -> lane.drive(...)               host-driven execution
            -> driveOperation(...)
            -> durable model/tool/recovery procedures
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

### `main.ts`

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

### Runtime Creation

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

### Session Creation

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

### Mode Dispatch To `session.prompt()`

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

### `AgentSession.prompt()`

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

### `Agent` To `runAgentLoop()`

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

### `runAgentLoop()`

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

1. on subsequent turns, call `prepareNextTurn()`, then emit `turn_start`
2. inject pending steering/follow-up messages, if present
3. call `streamAssistantResponse()`
4. transform internal context
5. convert internal messages to provider-facing messages
6. call the configured stream function
7. emit streaming message events until assistant `done` or `error`
8. execute tool calls, sequentially or in parallel
9. emit tool execution and tool-result message events
10. emit `turn_end`
11. call `shouldStopAfterTurn()`, if configured; an explicit stop ends the run
12. drain steering messages
13. repeat the inner loop if a non-terminating tool batch requires continuation or steering is pending
14. only after the inner loop exits, drain follow-up messages; queued follow-up restarts the inner loop
15. emit `agent_end` when no more work remains

`agent_start` occurs once per `runAgentLoop()` invocation, not once per model turn. Both inner-loop continuation and queued follow-up stay inside the same run. `runAgentLoopContinue()` starts a separate invocation and emits its own `agent_start`. Step 1's `prepareNextTurn()` hook precedes the subsequent `turn_start`; the provider-context transformation occurs later inside `streamAssistantResponse()`.

Errors and aborts produce an assistant error/aborted message, then `turn_end`, then `agent_end`.

### Event Return Path

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

`AgentHarness` lives in `pi-agent-core`, not `pi-coding-agent`. The normal CLI still constructs AgentSession plus Agent. Experimental worker code already attaches the newer harness; it is not limited to tests or scratch examples. See [service worker](../packages/coding-agent/src/experimental/session-worker.ts) and [mini worker](../packages/coding-agent/src/experimental/mini/worker/run.ts).

The two paths overlap in features, but AgentHarness is neither a wrapper around AgentSession nor a drop-in replacement for its application API. A migration would need adapters for resource loading, extension integration, session switching and presentation commands. The existence of overlapping functionality is not evidence that the normal CLI already uses the harness.

## AgentSession Resume Versus AgentHarness Recovery

### Is AgentSession resume enough?

Yes, if the requirement is “reopen my conversation and continue unfinished work.” The [session guide](../packages/coding-agent/docs/sessions.md) documents `pi -c`, `pi -r` and `/resume`. The [SDK](../packages/coding-agent/src/core/sdk.ts) reconstructs context from SessionManager and restores messages into Agent state.

AgentSession persists user, assistant and tool-result messages on `message_end`, plus other session metadata through dedicated paths. It also coordinates live retries, compaction and branching. It is not merely a transcript viewer.

The missing guarantee is more specific: conversation restoration alone does not restore the execution position of an interrupted external effect. If a tool changed a file but its result was never saved, the transcript may not say whether the change occurred. Reopening the session cannot infer that reliably.

| Dimension | AgentSession path | AgentHarness path |
| --- | --- | --- |
| Main abstraction | Coding-assistant application session | Durable operation on a named execution lane |
| Execution | Agent → runAgentLoop | AgentLane → driveOperation |
| Resume data | Saved conversation, tree position, settings | Those plus operation phase, pending effects, lane inbox and captured configuration |
| Tool results | Persisted as conversation messages | Finalized outcomes can be durable before source-ordered transcript placement |
| Interrupted tools | No equivalent durable harness replay-policy state machine | Persisted arguments and explicit safe/never replay policy |
| Waiting | Live queues and application retry logic | Durable retry deadlines, deferred handles and queued inputs |
| Host control | Session/application methods | accept, drive, requestAbort, getResult and inspectExecution |

The distinction is **persisted semantics**, not “JSONL versus SQLite.” Harness storage can use persistent JSONL or SQLite; a memory backend cannot survive process loss.

### Concrete crash: parallel tools A and B

```text
Model requests A and B
A keeps running
B finishes
Process crashes before A finishes
```

In the normal [parallel executor](../packages/agent/src/agent-loop.ts), `Promise.all` finishes before source-ordered tool-result message emission. B's result may therefore exist only in memory at this crash point. Session resume cannot recover a result that was not persisted. This does not mean every resumed conversation reruns tools.

The harness records B's finalized result immediately as `outcome_ready`, even while A prevents its placement in transcript order. After restart, B's durable outcome is reused and B is not executed again. A is replayed only if both its stored and current declarations allow `safe`; otherwise an interrupted result is synthesized. Source order is preserved when results are placed in the conversation.

This behavior is specified in [tool durability](../packages/agent/docs/tool-durability.md), implemented in [drive/tools.ts](../packages/agent/src/harness/runtime/drive/tools.ts), and covered by the parallel completion-order and safe/unsafe recovery cases in [drive-tools.test.ts](../packages/agent/test/harness/runtime/drive-tools.test.ts).

## Durable Execution and Its Limits

### Intent, effect, settlement

An operation is one accepted run, compaction or navigation. Its complete current phase and control state are persisted; recovery does not infer position from missing transcript messages.

```text
commit intent + reserved identities
  → perform provider/tool effect
  → commit outcome + next state
```

Intent means “about to do this,” not proof that the effect happened. A crash after intent but before settlement is deliberately treated as uncertain—even if it occurred just before actual invocation.

| Durable restart point | Recovery behavior |
| --- | --- |
| Before effect intent | Continue the ordinary procedure |
| Settled output and next state | Continue without repeating the settled effect |
| Orphaned tool; stored and current replay declarations both safe | Re-execute persisted arguments with the same invocation identity and memos |
| Orphaned tool; replay not allowed | Record interruption; retain available durable progress; do not automatically repeat it |
| Orphaned ordinary model request | Reconstruct committed partial output, settle an interruption error; retry policy may start a new request |
| Retry wait | Keep the recorded deadline; host can wait locally or drive later |
| Deferred response | Keep the provider handle; a permitted drive/resume can poll it |

`outcome_ready` is completion authority for a tool result waiting for placement. A progress checkpoint is not. Assistant frames similarly preserve a durable partial, not proof of provider completion.

### Attachment does not execute work

`AgentHarness.create()` attaches to an already open Session and returns `{ harness, open }`. `open` inventories lanes with accepted unfinished operations. Creation starts no model request, tool, hook or scheduler. The host explicitly chooses whether and when to call `drive()` or `resume()`.

- `accept(request, ctx)`: durably admits an operation; returns its ID without executing it.
- `drive({ operationId, ... }, ctx)`: advances that operation until settlement or a durable wait.

- `prompt(...)`: convenience that composes acceptance and driving, waiting through retries.

- `resume(ctx)`: inspects and drives the current operation; grants one deferred poll permit.
- `getResult(operationId, ctx)`: retrieves a terminal record if one exists; absence does not mean failure.
- `requestAbort(operationId, ctx)`: records durable cancellation for that expected operation.

### What it does not guarantee

- Exactly-once arbitrary external effects. Safe replay and idempotency remain application/tool responsibilities.
- Reconnection to an interrupted ordinary provider stream. Recovery may start a new request, not resume the old stream.
- Automatic work scheduling, result aggregation, distributed locks or failover.
- Filesystem isolation between lanes.
- Completion simply because a lifecycle message was observed.

The host assigns one writable Session owner. The [SQLite backend](../packages/session-backends/sqlite-node/README.md) does not implement cross-process ownership leases or takeover. Close leaves unfinished operations recoverable; it is not durable abort. Cancelling a caller's Context stops that observation and is not the same as cancelling the operation.

Sources: [harness specification §§0.6 and 4.4–4.7](../packages/agent/docs/harness.md), [assistant recovery](../packages/agent/src/harness/runtime/drive/recovery.ts), [assistant durability](../packages/agent/docs/assistant-durability.md).

## What an AgentLane Is

An AgentLane is a **named execution track inside one Session**:

```text
Session: shared entry tree and durable storage
  AgentHarness: shared tool/resource registries, hooks and policies
    main lane:   branch tip + model/tool selection + inbox + operation
    review lane: branch tip + model/tool selection + inbox + operation
```

A Branch is a named data path with a movable tip. An AgentLane adds model configuration, queues and at most one current operation. The tip selects the ancestry used as that lane's conversation context; it does not expose every other lane's subsequent messages automatically.

Harness-wide configuration includes tool implementations, prompt resources, hooks, stream/retry/compaction policies. Each lane retains its model identity, thinking level and active-tool names. Different lanes can execute work concurrently under one host, while Session mutations remain coordinated through the Session mutation line. A second operation on a busy lane is rejected; queued input uses the lane's inbox APIs.

A lane is not a process, OS thread, worker, isolated filesystem or automatically generated agent persona. Naming a lane `review` does not create reviewer behavior. The host supplies the prompt and selects tools; tool selection is not a substitute for a filesystem security sandbox.

### Are lanes created automatically?

Not by interpreting the user's task. Host code explicitly acquires a named lane:

```ts
const main = await harness.lane("main", ctx);
const review = await harness.lane("review", { createAt: sharedTipId }, ctx);
```

`harness.lane()` is get-or-create: it returns/restores an existing lane or creates one when needed. For a new absent branch, `createAt` chooses the initial history entry; without it the initial tip is null. An existing data-only Branch can acquire lane execution state at its existing tip. `createAt` does not reposition an existing lane. New lanes seed model/thinking/active tools from harness defaults.

Restoring persisted lanes on harness attachment is automatic restoration, not automatic task decomposition. Even `main` is an ordinary explicit name, not a required built-in lane.

### Who connects lane results?

The application does. For example:

```text
host → main: implement fix
     ← main: completion record + answer read from entries
host → review: review the completed fix
     ← review: completion record + findings read from entries
host → main: assess and address those findings
```

The host may instead run independent tasks concurrently and wait for each outcome. No automatic “all lanes finished” barrier, cross-lane message transfer or merge exists. The host must establish dependencies, aggregate results and decide what to show the user.

## The Lane/Operation State Machine

This section describes the durable machine that `driveOperation()` advances. The normative reference is [harness.md Part 3–4](../packages/agent/docs/harness.md); the type declarations are in [session/types.ts](../packages/agent/src/harness/session/types.ts).

### Two nested machines

A lane is the container; an operation is the unit of work. They have separate durable representations:

- **Lane** — `LaneState { currentOperationId, lastOperationId, inbox }`, plus `branchTip` and `laneConfig`. A lane has **at most one current operation** and a **separate ordered inbox** that survives across operations.
- **Operation** — `{ meta, state }`. `OperationMeta` is immutable acceptance data (id, lane, `sourceTipId`, `startedAt`, `intent`); `state` is one member of a **flat 13-leaf union** replaced in full on every transition. The spec is explicit that the process-local `{ meta, state }` object is never stored as one value (harness.md §3.1), and the durable restart point is the complete, total `operationState`; recovery never replays a journal or infers position from what is missing (§3.2).

The lane lifecycle is:

```text
idle ──accept──▶ operation open ──drive──▶ settle / wait ──▶ … ──terminal──▶ idle
                                      ▲                                   (lastOperationId = O)
                                      └── inbox enqueue only (never starts work)
```

- `accept()` is hook-free and side-effect-free: it checks idle, validates durable inputs, and commits meta + initial leaf + `currentOperationId` in one transaction (§3.6).
- One `Drive` is the sole top-level state-advance writer. Callers of the same `drive(id)` are observation peers sharing one `Drive.completion`; the first caller is not an owner.
- The terminal transaction clears `currentOperationId`, sets `lastOperationId`, and **preserves the inbox**, which is lane-owned rather than operation-owned (§3.13).
- `drive(id)` is total: current id installs/joins the pass, an existing record returns `{ kind: "settled" }`, otherwise `OperationMismatch`. So an operation may be advanced, already settled, or reopened after a crash.

### The 13 operation leaves

All leaves carry `OperationScope { control, settings, latestAssistantEntryId }`:

| Family | Leaves | Role |
| --- | --- | --- |
| Entry / turn boundary | `starting`, `checkpoint` | `before_run`, queue drain, threshold decision |
| Assistant generation | `assistant.ready`, `assistant.effect_pending`, `assistant.retry_wait` | provider request intent → stream → classification, with backoff |
| Tools | `tools` | one `ToolBatch` (nested child machine) |
| Deferred | `deferred.suspended`, `deferred.effect_pending` | long-poll handle, one permit per poll |
| Summary (compaction + navigation summary) | `summary.deciding`, `summary.ready`, `summary.effect_pending`, `summary.retry_wait` | shared quadruple; semantics chosen by `SummaryTask.boundary` |
| Navigation | `navigation.ready_to_commit` | unsummarized move/label |

`terminal` and `boundary` are explanatory nodes only, **not durable leaves** (§3.5). The summary family’s meaning comes from the closed `ResultBoundary` union (`resume_checkpoint` | `finish` | `commit_navigation`) rather than being duplicated across leaves.

### Recovery is the same dispatch as execution

`driveOperation()` in [runtime/drive.ts](../packages/agent/src/harness/runtime/drive.ts) is a straight-line procedure loop, not a graph interpreter or action scheduler:

```text
for (;;) {
  if control == cancel_requested → reconcileOperation()      // runs before ordinary dispatch
  switch (state.at) {
    starting                                   → startRun
    checkpoint                                 → runCheckpoint
    assistant.ready | assistant.retry_wait     → runGeneration
    assistant.effect_pending                   → recoverAssistantGeneration   // orphan
    tools                                      → runTools
    deferred.*                                 → runDeferred
    summary.deciding | ready | retry_wait | effect_pending → runStructural* / recover*
    navigation.ready_to_commit                 → commitNavigation
  }
  settled → return outcome; waiting → return wait
  if no progress → SessionInvariantError("Drive procedure made no progress")
}
```

The important property is that the **same leaf dispatches both live execution and crash recovery**. After `assistant.effect_pending` commits, a live process awaits the provider; after process loss, the same leaf means “unknown outcome → reconcile.” There is no separate recovery driver (§4.5).

### The atomic transition rule

> Compute one complete next state in memory, then atomically commit every entry, usage row, value/list write, and projection change that makes it true. (§3.4)

Two lane mutation primitives implement this distinction in [runtime/lane.ts](../packages/agent/src/harness/runtime/lane.ts):

- `continueOperation()` — publishes an **intent**; returns explicit `cancel_requested` without invoking the planner when control is cancelled.
- `settleOperation()` — settles **already-admitted** effects and tool-child transitions despite cancellation, and owns the universal terminal suffix.

The owned `Lane.state` projection is the control authority; procedures never re-read `laneState`/`operationState`/`branchTip`/`operationResult` to choose work. After awaiting external work they re-enter the mutation line and receive the latest authoritative state, so concurrent inbox/control changes are preserved. Providers, tools, hooks, timers and event delivery run outside the mutation line; admission happens at a synchronous `Gate.admit` boundary (§4.2).

### Orthogonal axes: cancellation, tool children, retries, inbox

These are not additional leaves:

- **Cancellation** — `Control = { running } | { cancel_requested, requestedAt }` is carried by every leaf, and reconciliation routes every one of the 13 leaves to `reconcileOperation` before ordinary dispatch. A terminal commit under cancellation always records `aborted`.
- **Tool children** — `ToolBatch.calls[i]` is the one genuinely nested child machine, because parallel children settle concurrently: `planned → effect_pending{replay: safe|never} → outcome_ready{terminate} → completed{terminate}`. Materialization places the contiguous `outcome_ready` prefix in **source order**, even though outcomes stage in completion order (§3.8).
- **Retry waits** — `assistant.retry_wait` / `summary.retry_wait` carry `{ nextAttempt, notBefore, errorMessage }`. A timer runs off the mutation line and re-enters `ready` only after `notBefore`. Caller policy: `waitForRetry:false` returns `{ waiting, notBefore }` and the host reschedules; `true` starts the timer.
- **Inbox / queues** — `steer | followUp | nextRun | write` tags are drained at idle acceptance, run boundary, idle direct append, and abort, with `QueueMode` selecting all-or-oldest per tag (§3.11). `nextRun` is never consumed mid-run.
- **Checkpoint / boundary** — one decision, at most one commit; it never commits back to `checkpoint` merely to remember a drain. `before_run_end` runs off-line and stale output is discarded if inbox/control changed (§3.12).

### Terminal transaction

Every terminal path shares one universal suffix in the final transaction (source and trace agree; §3.13 records that the earlier prose ordering was wrong):

```text
business writes (entries / usage / tip)
  → delete all pi.op.* and pending progress/frame/outcome addresses   (operationCleanupWrites in drive/terminal.ts)
  → set pi.result/{operationId} exactly once (OperationResultRecord)
  → laneState{ currentOperationId: null, lastOperationId: O, inbox: preserved }
```

`OperationResultRecord` is an immutable public disposition and is **never read by recovery** — recovery uses only `operationMeta`/`operationState`. `getResult(id)` is one value read.

### `runGeneration` is the assistant-turn LLM entrypoint

`runGeneration()` in [runtime/drive/generation.ts](../packages/agent/src/harness/runtime/drive/generation.ts) handles the `assistant.ready` and `assistant.retry_wait` leaves:

```text
runGeneration()
 ├─ at "assistant.retry_wait" → runRetryWait()           // no LLM; timer only
 └─ at "assistant.ready":
      prepareGeneration()      // resolve model/tools/context, before_request hook
      publishGenerationIntent() → commit at "assistant.effect_pending"  (reserves responseEntryId + usageId)
      performGeneration()
        └─ streamHarnessAssistant(… { request: (…) => drive.gate.admit(() => lane.models.streamSimple(…)) })
      publishResponse()        // classify and commit successor leaf
```

So the network call is `lane.models.streamSimple` inside the admitted `request` closure in `performGeneration`; `runGeneration` is the durable wrapper that owns intent → effect → settlement. This is the LLM entrypoint for the **assistant turn** only: structural summaries (compaction and branch summary) also call the model, but through [runtime/drive/structural.ts](../packages/agent/src/harness/runtime/drive/structural.ts) → `runStructuralGeneration`, not `runGeneration`.

### How `assistant.ready` is triggered

`assistant.ready` is **never written by `accept()`**; a run’s initial durable leaf is always `starting`. It is produced by six commits, five via `assistantReadyAtBoundary()` in [drive/boundary.ts](../packages/agent/src/harness/runtime/drive/boundary.ts):

| # | Writer | Trigger |
| --- | --- | --- |
| 1 | [drive/checkpoint.ts](../packages/agent/src/harness/runtime/drive/checkpoint.ts) | `checkpoint` with `continuation.kind === "need_assistant"` — the ordinary “make the next model turn” |
| 2 | `drive/checkpoint.ts` | `checkpoint` where `planBoundaryInbox` selected queued input (`write`/`steer`) |
| 3 | [drive/boundary.ts](../packages/agent/src/harness/runtime/drive/boundary.ts) | `finishRunBoundary` on a `may_finish` checkpoint whose re-plan found selected input |
| 4 | `drive/boundary.ts` | same, via a `before_run_end` hook `followUp` |
| 5 | [drive/structural.ts](../packages/agent/src/harness/runtime/drive/structural.ts) | summary result with `boundary.kind === "resume_checkpoint"` (overflow/threshold compaction, or declined compaction with selected input) |
| 6 | [drive/generation.ts](../packages/agent/src/harness/runtime/drive/generation.ts) | `runRetryWait` advances `assistant.retry_wait → assistant.ready` |

`startRun` commits `checkpoint{need_assistant}`, not `assistant.ready`, so the normal opening sequence is:

```text
starting → checkpoint → assistant.ready
```

After a tool batch, [drive/tool-placement.ts](../packages/agent/src/harness/runtime/drive/tool-placement.ts) commits `checkpoint{need_assistant}` (or `{ may_finish }` when every call set `terminate: true`), which loops back through trigger #1. That is the coding loop: assistant → tools → checkpoint → assistant. `assistantReadyAtBoundary` builds the `GenerationContext` (`stepId`, `triggerEntryId`, captured lane `configuration`, `streamOptions`, `retryPolicy`, `overflowRecoveryUsed`) with `nextAttempt: 1`.

### How `assistant.retry_wait` is triggered

Exactly one writer: `publishResponse` classification in [drive/response.ts](../packages/agent/src/harness/runtime/drive/response.ts). Three conditions must all hold:

1. the settled response is an `error` (including a crash-recovered `effect_pending`, since `options.recovery === true` forces retryability),
2. attempts remain (`attempt < maxAttempts`, where `maxAttempts = retry.maxRetries + 1` via `normalizedRetryPolicy`),
3. otherwise the operation terminalizes `failed`.

The same transaction writes the response entry, usage row, branch tip, deletes the pending frame list, and emits `retry_scheduled`. `runRetryWait` then applies the caller’s policy: `waitForRetry:false` returns `{ kind:"waiting", reason:"retry", notBefore }` with no timer; `true` admits `waitUntil(notBefore, gate.signal)` through the gate, then commits `assistant.retry_wait → assistant.ready`, preserving `nextAttempt`, and emits `retry_start`. The summary family has the analogous `summary.retry_wait` writer in `structural.ts`.

**Full trigger graph:**

```text
accept(run) ─────────────────────────────▶ starting
startRun (before_run) ───────────────────▶ checkpoint{need_assistant}
                                              │  (or may_finish)
                                              ▼
checkpoint ── selected queued input ───────▶ assistant.ready
           ── need_assistant ──────────────▶ assistant.ready
           ── threshold ───────────────────▶ summary.deciding ─┐
           ── may_finish + input/hook ─────▶ assistant.ready    │
                                                                │
assistant.ready ── intent ────────────────▶ assistant.effect_pending
                                                │
   ┌────────────────────────────────────────────┤ publishResponse classification
   │                                            │
   ├─ retryable error & attempts left ────────▶ assistant.retry_wait
   │                                                │ notBefore elapsed
   │                                                └──▶ assistant.ready
   ├─ accepted tool calls ────────────────────▶ tools ──▶ tool-placement
   │                                                └──▶ checkpoint{need_assistant|may_finish}
   ├─ overflow / threshold ◀────────────────── summary.deciding ──┐
   │                                                     resume_checkpoint
   │                                                     └────────┴──▶ assistant.ready | checkpoint
   ├─ deferred handle ───────────────────────▶ deferred.suspended ⇄ deferred.effect_pending
   │                                                └──▶ tools | checkpoint
   └─ stop / genuine length ─────────────────▶ checkpoint{may_finish}
                                                    └──▶ finishRunBoundary → terminal (or assistant.ready if new input)
```

In short: `runGeneration` is the assistant-turn LLM entrypoint (the network call being `models.streamSimple` inside its admitted `request` closure). `assistant.ready` is entered from checkpoint/boundary/structural-summary/retry-wait, and `assistant.retry_wait` is entered only from `publishResponse`’s retryable-error classification during `assistant.effect_pending` settlement; the retry wait loops back to `ready` once `notBefore` passes.

## Live Events, Lane Tags, and Completed Results

“Live messages” means events observed while execution is running, not a special message type or a second conversation store.

| Observation | Meaning |
| --- | --- |
| message_start | One message begins |
| message_update | Partial assistant text/tool-call data changes |
| message_end | One message finishes; the operation may still have more turns/tools |
| tool_start / tool_update / tool_end | Tool execution lifecycle/progress |
| prompt() result | Terminal operation record or a suspended deferred run; expected admission errors use Result.err |
| drive() result | Settled outcome or durable retry/deferred wait |
| getResult(operationId) | Previously persisted terminal record |
| lane.watch() | Lane snapshot plus subsequent observation; useful on reconnect |

### The lane tag is runtime metadata

A simplified event envelope is:

```ts
{
  type: "message_update",
  lane: "review",
  runId: "operation-id",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "I found a missing timeout..." }],
    // Other assistant fields omitted here.
  },
  event: /* underlying AssistantMessageEvent */,
  // Optional compact frame and recovery metadata.
}
```

The model does not generate `review` or prepend `[review]` to its answer. [response.ts](../packages/agent/src/harness/runtime/drive/response.ts) constructs the envelope using `lane: lane.name` and `runId: drive.operationId`, then emits it through the harness event system. Message content and lane identity are separate fields. Lane-scoped events have a lane tag; harness-global events need not.

The host subscribes before starting operations:

```ts
const stopUpdates = harness.events.on("message_update", (event) => {
  console.log(`[${event.lane}] streaming`, event.message);
});
const stopMessages = harness.events.on("message_end", (event) => {
  console.log(`[${event.lane}] message finished`, event.message);
});
// Call stopUpdates() and stopMessages() when the subscriber is removed.
```

`[main]` in this log is application formatting; `event.lane` is the actual tag. A listener for `message_end` receives finished messages during the operation, not token-by-token updates. A UI may replace its current partial-message view from `event.message` or process the underlying stream event; it should not blindly append the entire partial each time.

### Observation is not settlement

An assistant `message_end` event is not proof that the whole operation has completed or that its terminal record is committed. In the current assistant path, message lifecycle observation and response settlement are distinct steps. Use the completed operation result or `getResult()` for terminal status. Tool `tool_end` has its own durable staging boundary; do not assume every event type has identical persistence timing.

`OperationResultRecord` contains operation ID, kind, terminal status, start/end tips and timestamps. It is not the answer text. Read the relevant conversation entries separately. For an operation-specific answer, start from that record's `tipId`, rather than the lane's later mutable tip, and stop before its prior history (`fromTipId`). Some completed operations have no textual final answer.

Normal events are not a replayable durable event log. After reconnect, use snapshots/stored entries and terminal records; recovery can emit new events marked `recovery: true`.

## Complete Example: Fix, Review, and Revise

### Scenario and assumptions

The user requests: “Fix the login bug, review the fix, then address the findings.” The host creates a fresh persistent Session and two explicit lanes. The review begins after the implementation and inherits its completed history. Both use the same project workspace through host-provided tool context.

The following is a complete orchestration function, not a standalone credentials/bootstrap program. Its caller supplies an authenticated Models registry, a selected model, harness-native tool implementations named `read`, `edit`, `write`, `bash`, and their toolContext through `runtime`. See the existing [mini worker setup](../packages/coding-agent/src/experimental/mini/worker/run.ts) for model/runtime and NodeExecutionEnv wiring. The Node runtime must support `node:sqlite`.

The example owns and closes its newly created Session/harness/repository. It preserves a suspended operation by returning its identity instead of pretending the task completed. It does not launch real providers merely by being included in this document.

```ts
import {
  AgentHarness,
  BACKGROUND_CONTEXT,
  type AgentHarnessOptions,
  type AgentLane,
  type Context,
  type OperationResultRecord,
} from "@earendil-works/pi-agent-core";
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
} from "@earendil-works/pi-session-backend-sqlite-node";

type TextTaskResult =
  | { kind: "completed"; record: OperationResultRecord; text: string }
  | { kind: "suspended"; lane: string; operationId: string };

async function runTextTask(
  lane: AgentLane,
  prompt: string,
  ctx: Context,
): Promise<TextTaskResult> {
  const result = await lane.prompt(prompt, undefined, ctx);
  if (!result.ok) throw new Error(result.error.message);

  const outcome = result.value;
  if (outcome.status === "suspended") {
    return {
      kind: "suspended",
      lane: lane.name,
      operationId: outcome.operationId,
    };
  }
  if (outcome.status !== "completed") {
    throw new Error(`Operation ${outcome.operationId}: ${outcome.status}`);
  }
  if (outcome.tipId === null) throw new Error("No conversation output");

  // Anchor to THIS operation's terminal tip, not a later lane position.
  const entries = await lane.findEntries(
    {
      start: outcome.tipId,
      type: "message",
      order: "newestFirst",
      ...(outcome.fromTipId === null ? {} : { stopAtId: outcome.fromTipId }),
    },
    ctx,
  );
  for (const entry of entries) {
    // Explicitly exclude inherited history, regardless of boundary inclusion.
    if (entry.id === outcome.fromTipId) break;
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const text = entry.message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (text.trim()) return { kind: "completed", record: outcome, text };
  }
  // Application policy: this workflow expects a textual handoff.
  throw new Error("Completed operation produced no textual answer");
}

export async function fixReviewRevise<TContext extends object | undefined>(
  sessionsDirectory: string,
  runtime: Omit<AgentHarnessOptions<TContext>, "session">,
  ctx: Context = BACKGROUND_CONTEXT,
) {
  const repository = new SqliteSessionRepo({
    directory: sessionsDirectory,
    databaseFactory: createNodeSqliteFactory(),
  });

  try {
    const session = await repository.create({}, ctx);
    const { harness } = await AgentHarness.create({ ...runtime, session }, ctx);
    const stopUpdates = harness.events.on("message_update", (event) => {
      // A real UI would route to its panel keyed by event.lane.
      console.log(`[${event.lane}] streaming`, event.message);
    });
    const stopMessages = harness.events.on("message_end", (event) => {
      console.log(`[${event.lane}] message finished`, event.message);
    });

    try {
      // 1. The HOST creates main, then starts implementation.
      const main = await harness.lane("main", ctx);
      await main.setActiveTools(["read", "edit", "write", "bash"], ctx);
      const fix = await runTextTask(
        main,
        "Fix the login bug. Run relevant tests and summarize changed files.",
        ctx,
      );
      if (fix.kind === "suspended") {
        return { status: "suspended", stage: "fix", session: session.metadata, waiting: fix };
      }
      console.log("HOST received implementation answer:", fix.text);

      // 2. The HOST creates review at the completed fix's history position.
      // This Session is new, so review does not already exist.
      const review = await harness.lane("review", { createAt: fix.record.tipId }, ctx);
      await review.setActiveTools(["read"], ctx);
      const assessment = await runTextTask(
        review,
        "Review the fix in the preceding history. Read the changed files, " +
          "identify regressions, and do not modify files.",
        ctx,
      );
      if (assessment.kind === "suspended") {
        return {
          status: "suspended", stage: "review", session: session.metadata,
          waiting: assessment, fix,
        };
      }
      console.log("HOST received review answer:", assessment.text);

      // 3. The HOST transfers the findings; lanes do not auto-merge.
      // main is reused: this is a new operation, not a new lane.
      const revision = await runTextTask(
        main,
        "Assess these review findings. Address valid issues, rerun relevant " +
          "tests, and explain findings you reject:\n\n" + assessment.text,
        ctx,
      );
      if (revision.kind === "suspended") {
        return {
          status: "suspended", stage: "revise", session: session.metadata,
          waiting: revision, fix, assessment,
        };
      }

      return {
        status: "completed",
        session: session.metadata,
        implementation: fix.text,
        review: assessment.text,
        finalAnswer: revision.text,
        operationIds: [
          fix.record.operationId,
          assessment.record.operationId,
          revision.record.operationId,
        ],
      };
    } finally {
      stopUpdates();
      stopMessages();
      // Closing does not abort a durably suspended operation.
      await harness.close(ctx);
    }
  } finally {
    // Also covers failures during Session or harness construction.
    await repository.close(ctx);
  }
}
```

### Expected timeline and ownership

Illustrative outputs, not results of running this example:

| Time | Host action | Observation/result |
| --- | --- | --- |
| T0 | Create main; submit fix | main message_start/update/end events |
| T1 | Await implementation | Operation completes; answer: “Added timeout handling in login.ts; tests pass” |
| T2 | Create review at fix's terminal tip; submit review | review events; history includes the fix |
| T3 | Await review | Answer: “The expired-token branch still bypasses the timeout” |
| T4 | Explicitly submit findings to main | New operation on main; review branch does not merge into main |
| T5 | Await revision | Final answer read from entries and returned to the user |

The review tool set contains only `read`; it cannot execute a shell to obtain a diff in this example. It reads changed files named in inherited history. A product that needs a diff can supply the diff text or a deliberately read-only diff tool. Shared tools/context can access the same files; separate lanes provide no filesystem isolation.

### Suspension, restart, and the host workflow boundary

The example returns `status: "suspended"` with session metadata, workflow stage, lane name and operation ID. The host must preserve that envelope and decide when to reopen and poll. Calling `fixReviewRevise()` again creates a new Session; it is **not** a restart procedure.

For recovery, the host opens the existing Session through the repository, recreates the harness with the same required model/tool services, then inspects `open`. It acquires the indicated lane and calls `resume(ctx)` or `drive({ operationId, pollDeferred: true }, ctx)`. A completed result's answer is read from its terminal tip; a suspended result remains waiting. Before interpreting results, check the returned Result and terminal status.

**Harness durability does not make the JavaScript fix → review → revise function durable.** It recovers accepted lane operations. The host must separately persist workflow stage, operation IDs and handoff decisions if it needs the whole multi-lane workflow to survive a crash. Otherwise a crash after fix completion but before review admission could leave an idle main lane with no instruction to create review. The host can use durable workflow state and terminal records to reconcile that gap; automatic resubmission of a completed prompt is not a substitute.

For a production scheduler, separate `accept()` from `drive()` so the host can record the operation ID before driving, and reconcile admission/receipt failures explicitly. Do not assume a caller-supplied ID alone establishes an undocumented idempotent-submit protocol.

### Concurrent lanes

The fix/review example is deliberately sequential because review depends on the completed fix. Independent lanes may be driven concurrently and observed through the same lane-tagged event subscription. The host chooses whether to await each individually or aggregate their outcomes. Concurrent file writes require separate coordination or isolated workspaces; lane naming does not solve that race.

## Documentation and Implementation Status

This document explains the current source, not a future migration promise. [harness.md §0.9](../packages/agent/docs/harness.md) explicitly separates implemented behavior from remaining work. The durable operation graph/public lane runtime are implemented; `watchSession()` is currently a stub, and some telemetry, search, migration and fork work remains incomplete or future-facing. Use `lane.watch()` for the implemented lane observation surface; do not confuse it with `watchSession()`.

The complete orchestration example was statically type-checked against the workspace source with no diagnostics, and all 29 linked local sources were verified to exist. Its model calls, tool effects and workflow were not executed as part of this documentation change. Selected recovery tests were read as evidence, not run or claimed as exhaustive conformance. Application-suitability recommendations are architectural interpretation.

Earlier statements that the harness directly calls `runAgentLoop()`, returns the last assistant message from `AgentHarness.prompt()`, or is used only by tests are superseded by this revision. The current entry is `AgentHarness.create()`; work is submitted to a named lane; terminal records and answer payloads are retrieved separately.

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
| Harness public API, lane events and result contracts | [agent-harness.ts](../packages/agent/src/harness/agent-harness.ts) |
| Lane acquisition/restoration | [runtime/harness.ts](../packages/agent/src/harness/runtime/harness.ts) |
| Lane admission, drive and convenience methods | [runtime/lane.ts](../packages/agent/src/harness/runtime/lane.ts) |
| Durable operation driver | [runtime/drive.ts](../packages/agent/src/harness/runtime/drive.ts) |
| Assistant generation / LLM entrypoint | [drive/generation.ts](../packages/agent/src/harness/runtime/drive/generation.ts) |
| Turn boundary, queue drain, `finishRunBoundary` | [drive/checkpoint.ts](../packages/agent/src/harness/runtime/drive/checkpoint.ts), [drive/boundary.ts](../packages/agent/src/harness/runtime/drive/boundary.ts) |
| Summary generation (compaction / branch summary) | [drive/structural.ts](../packages/agent/src/harness/runtime/drive/structural.ts) |
| Tool materialization / `checkpoint` successor | [drive/tool-placement.ts](../packages/agent/src/harness/runtime/drive/tool-placement.ts) |
| Cancellation reconciliation | [drive/reconcile.ts](../packages/agent/src/harness/runtime/drive/reconcile.ts) |
| Terminal cleanup and result records | [drive/terminal.ts](../packages/agent/src/harness/runtime/drive/terminal.ts) |
| Assistant event lane/run tagging | [drive/response.ts](../packages/agent/src/harness/runtime/drive/response.ts) |
| Assistant orphan recovery | [drive/recovery.ts](../packages/agent/src/harness/runtime/drive/recovery.ts) |
| Tool outcome staging and safe/never replay | [drive/tools.ts](../packages/agent/src/harness/runtime/drive/tools.ts) |
| Lane state, branch queries and terminal records | [session/types.ts](../packages/agent/src/harness/session/types.ts) |
| Normative durable runtime specification | [harness.md](../packages/agent/docs/harness.md) |
| Tool durability design | [tool-durability.md](../packages/agent/docs/tool-durability.md) |
| Assistant partial durability design | [assistant-durability.md](../packages/agent/docs/assistant-durability.md) |
| Recovery and parallel-order test evidence | [drive-tools.test.ts](../packages/agent/test/harness/runtime/drive-tools.test.ts) |
| Persistent backend and ownership boundary | [SQLite backend README](../packages/session-backends/sqlite-node/README.md) |
