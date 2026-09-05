# `transport` Analysis

Analysis of the `transport` option: its type, semantics, how it flows from the
coding-agent down to the provider request, and which providers actually honor it.

## Type definition

`packages/ai/src/types.ts:110`

```ts
export type Transport = "sse" | "websocket" | "websocket-cached" | "auto";
```

It is exposed on `StreamOptions` (`packages/ai/src/types.ts:199`):

```ts
/**
 * Preferred transport for providers that support multiple transports.
 * Providers that do not support this option ignore it.
 */
transport?: Transport;
```

`SimpleStreamOptions extends StreamOptions` (`packages/ai/src/types.ts:314`), so
the field is available to both the low-level `stream` and the `streamSimple`
entry points.

## Semantics of each value

Only `openai-codex-responses.ts` interprets `transport`. The dispatch logic is at
`packages/ai/src/api/openai-codex-responses.ts:286-293`:

```ts
const transport = options?.transport || "auto";
const websocketDisabledForSession = transport !== "sse" && isWebSocketSseFallbackActive(cacheSessionId);
if (transport !== "sse" && !websocketDisabledForSession) {
  // WebSocket path
}
```

And the caching decision at `packages/ai/src/api/openai-codex-responses.ts:1481`:

```ts
const useCachedContext = options?.transport === "websocket-cached" || options?.transport === "auto";
```

| Value | Transport | Connection reuse | Context caching | SSE fallback |
|---|---|---|---|---|
| `"sse"` | HTTP SSE | — | — | — |
| `"websocket"` | WebSocket | no | no | yes (on pre-stream failure) |
| `"websocket-cached"` | WebSocket | yes | yes (`previous_response_id` deltas) | yes (on pre-stream failure) |
| `"auto"` | WebSocket | yes | yes | yes |

- `"sse"` forces the HTTP SSE path.
- `"websocket"` uses WebSocket but opens a fresh connection per request and always
  sends the full request body (no `previous_response_id` continuation).
- `"websocket-cached"` reuses the WebSocket connection within a session and sends
  delta requests via `previous_response_id`, avoiding resending the full context.
- `"auto"` (the default) behaves like `"websocket-cached"` but falls back to SSE
  on a pre-stream transport failure.

## WebSocket connection caching details

`packages/ai/src/api/openai-codex-responses.ts:829-830`

```ts
const SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1000;   // idle timeout
const SESSION_WEBSOCKET_MAX_AGE_MS = 55 * 60 * 1000;    // max connection age
```

- `acquireWebSocket` (`openai-codex-responses.ts:1139`) returns a cached socket
  keyed by `sessionId` + `accountId`.
- `buildCachedWebSocketRequestBody` (`openai-codex-responses.ts:1423`) sets
  `previous_response_id` and sends only the new input items when the request body
  (minus input) matches the previous request.
- The cache is keyed by `sessionId`; without a `sessionId` (i.e.
  `cacheRetention === "none"`), no caching occurs.

## Fallback logic

`packages/ai/src/api/openai-codex-responses.ts:335-365`

- If the WebSocket fails **before** streaming starts, the failure is recorded
  (`recordWebSocketSseFallback`), the session is marked for SSE fallback, and the
  request is retried over SSE.
- If the WebSocket fails **after** streaming started, the error is thrown.
- Once a session is marked for SSE fallback, subsequent requests in that session
  skip the WebSocket path entirely (`isWebSocketSseFallbackActive`).

## Parameter flow: coding-agent → pi-ai

`transport` is not special-cased anywhere in the chain; it is a plain field on
`StreamOptions`/`SimpleStreamOptions` that is spread through until the provider's
`stream` function reads it.

1. **Storage and accessor** — `packages/coding-agent/src/core/settings-manager.ts`

   ```ts
   export type TransportSetting = Transport;              // line 75
   transport?: TransportSetting; // default: "auto"       // line 100

   getTransport(): TransportSetting {
     return this.settings.transport ?? "auto";            // line 819
   }
   setTransport(transport: TransportSetting): void {     // line 823
     this.globalSettings.transport = transport;
     this.markModified("transport");
     this.save();
   }
   ```

2. **Injected into the Agent** — `packages/coding-agent/src/core/sdk.ts:369`

   ```ts
   agent = new Agent({
     ...
     transport: settingsManager.getTransport(),
     ...
   });
   ```

3. **Stored on the Agent and put into the loop config** — `packages/agent/src/agent.ts`

   ```ts
   this.transport = runtimeOptions.transport ?? "auto";   // line 235

   // createLoopConfig(), line 454
   return {
     ...
     transport: this.transport,
     ...
   };
   ```

4. **Spread into the stream function call** — `packages/agent/src/agent-loop.ts:306`

   `AgentLoopConfig extends SimpleStreamOptions`, so `transport` rides along:

   ```ts
   const response = await streamFunction(config.model, llmContext, {
     ...config,          // includes transport
     apiKey: resolvedApiKey,
     signal,
   });
   ```

5. **The streamFn forwards it to the model runtime** — `packages/coding-agent/src/core/sdk.ts`

   ```ts
   streamFn: async (model, context, options) => {
     ...
     return modelRuntime.streamSimple(model, context, {
       ...options,       // transport spread through here
       timeoutMs,
       websocketConnectTimeoutMs,
       ...
     });
   }
   ```

6. **ModelRuntime dispatches to the provider** — `packages/coding-agent/src/core/model-runtime.ts:636`

   ```ts
   streamSimple(model, context, options) {
     return lazyStream(model, async () => {
       const prepared = await this.prepareRequest(model, options);
       return prepared.provider.streamSimple(prepared.model, context, prepared.options);
     });
   }
   ```

   `prepareRequest` (`model-runtime.ts:575`) spreads `...providerOptions` (which
   includes `transport`) into the returned `options`, so it survives the
   auth/header resolution step.

7. **Provider `streamSimple` → `stream`** — `packages/ai/src/api/openai-codex-responses.ts:492`

   ```ts
   export const streamSimple = (model, context, options) => {
     ...
     const base = { ...buildBaseOptions(model, context, options, apiKey), ... };
     return stream(model, context, { ...base, reasoningEffort });
   };
   ```

   `buildBaseOptions` (`packages/ai/src/api/simple-options.ts:42`) explicitly
   copies it:

   ```ts
   transport: options?.transport,
   ```

8. **Provider `stream` reads it** — `packages/ai/src/api/openai-codex-responses.ts:286`

   ```ts
   const transport = options?.transport || "auto";
   ```

### Interactive-mode runtime path

The settings selector also mutates the live agent directly, so a change applies
to the current session without recreating the agent —
`packages/coding-agent/src/modes/interactive/interactive-mode.ts:4624`:

```ts
onTransportChange: (transport) => {
  this.settingsManager.setTransport(transport);   // persist
  this.session.agent.transport = transport;       // live agent for this session
},
```

### Flow summary

```
settings.json (transport)
  → SettingsManager.getTransport()
  → new Agent({ transport })                    [sdk.ts]
  → Agent.transport                             [agent.ts]
  → AgentLoopConfig.transport                   [agent.ts createLoopConfig]
  → streamFunction(model, ctx, { ...config })   [agent-loop.ts]
  → streamFn → modelRuntime.streamSimple(...)   [sdk.ts]
  → prepareRequest (spread ...providerOptions)  [model-runtime.ts]
  → provider.streamSimple → buildBaseOptions    [openai-codex-responses.ts / simple-options.ts]
  → provider.stream: options?.transport || "auto"
```

## Which providers honor `transport`

Only `openai-codex-responses.ts` reads `options.transport` to make a decision.
The other API runtimes have zero references to `transport`:

- `openai-responses.ts`
- `openai-completions.ts`
- `azure-openai-responses.ts`
- `openai-responses-shared.ts`
- `anthropic-messages.ts`
- `bedrock-converse-stream.ts`
- `google-generative-ai.ts`
- `google-vertex.ts`
- `mistral-conversations.ts`

The only other reference in the ai package is `simple-options.ts:39`, which is a
pass-through in `buildBaseOptions` (shared by all `streamSimple` implementations).
It copies the field into the returned `StreamOptions`, but only
`openai-codex-responses.ts` reads it back out.

Therefore the `transport` setting is effectively a no-op for every provider except
the Codex Responses API (the only one that supports WebSocket).
