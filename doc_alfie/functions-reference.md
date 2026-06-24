# Functions Reference

This is a focused reference for central public APIs and important orchestration functions. It is not exhaustive.

## `packages/ai`

### Modern Model APIs

| API | File | Purpose |
| --- | --- | --- |
| `createModels(options?)` | `src/models.ts` | Create an empty mutable provider collection. |
| `createProvider(input)` | `src/models.ts` | Build a provider from metadata, auth, model list, optional refresh, and API streams. |
| `Models.getProviders()` | `src/models.ts` | Return registered provider objects. |
| `Models.getProvider(id)` | `src/models.ts` | Return one provider. |
| `Models.getModels(provider?)` | `src/models.ts` | Return last-known models from one provider or all providers. |
| `Models.getModel(provider, id)` | `src/models.ts` | Resolve one model from last-known provider lists. |
| `Models.refresh(provider?)` | `src/models.ts` | Refresh dynamic model lists. |
| `Models.getAuth(model)` | `src/models.ts` | Resolve provider auth for a model. |
| `Models.stream()` / `complete()` | `src/models.ts` | Stream or complete with provider-specific options. |
| `Models.streamSimple()` / `completeSimple()` | `src/models.ts` | Stream or complete with unified simple options. |
| `hasApi(model, api)` | `src/models.ts` | Runtime-checked model API type narrowing. |
| `calculateCost(model, usage)` | `src/models.ts` | Fill usage cost fields from model pricing metadata. |
| `getSupportedThinkingLevels(model)` | `src/models.ts` | Return thinking levels supported by a model. |
| `clampThinkingLevel(model, level)` | `src/models.ts` | Choose a supported thinking level near the requested value. |
| `modelsAreEqual(a, b)` | `src/models.ts` | Compare models by provider and id. |

### Built-In Provider APIs

| API | File | Purpose |
| --- | --- | --- |
| `getBuiltinModel(provider, modelId)` | `src/providers/all.ts` | Typed read of generated built-in model metadata. |
| `getBuiltinProviders()` | `src/providers/all.ts` | Return built-in provider ids. |
| `getBuiltinModels(provider)` | `src/providers/all.ts` | Return built-in models for one provider. |
| `builtinProviders()` | `src/providers/all.ts` | Construct all built-in text providers. |
| `builtinModels(options?)` | `src/providers/all.ts` | Create a `Models` collection with built-in providers registered. |
| `builtinImagesProviders()` | `src/providers/all.ts` | Construct built-in image providers. |
| `builtinImagesModels(options?)` | `src/providers/all.ts` | Create an image model collection with built-in image providers. |

### Compatibility APIs

| API | File | Purpose |
| --- | --- | --- |
| `registerApiProvider(provider, sourceId?)` | `src/compat.ts` | Register a legacy global provider stream implementation for an API id. |
| `getApiProvider(api)` | `src/compat.ts` | Return a legacy registered provider implementation. |
| `getApiProviders()` | `src/compat.ts` | Return all legacy registered provider implementations. |
| `unregisterApiProviders(sourceId)` | `src/compat.ts` | Remove legacy providers registered by a source. |
| `resetApiProviders()` | `src/compat.ts` | Reset compat providers to built-ins. |
| `stream()` / `complete()` | `src/compat.ts` | Legacy dispatch with provider-specific options and env API key injection. |
| `streamSimple()` / `completeSimple()` | `src/compat.ts` | Legacy dispatch with unified simple options and env API key injection. |
| `registerFauxProvider()` | `src/compat.ts` | Register a faux provider for tests and harness flows. |

### Image APIs

| API | File | Purpose |
| --- | --- | --- |
| `createImagesModels()` | `src/images-models.ts` | Create mutable image-provider collection. |
| `getImageModel()` / `getImageModels()` | `src/image-models.ts` | Legacy generated image-model catalog reads. |
| `registerImagesApiProvider()` | `src/images-api-registry.ts` | Register legacy image generation implementation. |
| `generateImage()` | `src/images.ts` | Legacy image generation dispatch. |

## `packages/agent`

### `Agent`

| API | Purpose |
| --- | --- |
| `new Agent(options)` | Create a stateful agent with initial state, stream function, hooks, queues, and provider options. |
| `agent.prompt(input, images?)` | Start a prompt from text, one message, or a message batch. |
| `agent.continue()` | Continue from current context when the last message is user or tool result. |
| `agent.abort()` | Abort the active run. |
| `agent.waitForIdle()` | Resolve after the active run and awaited listeners settle. |
| `agent.subscribe(listener)` | Observe agent lifecycle events. |
| `agent.steer(message)` | Queue a message after the current assistant turn and tools finish. |
| `agent.followUp(message)` | Queue a message after the agent would otherwise stop. |
| `agent.clearSteeringQueue()` | Drop pending steering messages. |
| `agent.clearFollowUpQueue()` | Drop pending follow-up messages. |
| `agent.clearAllQueues()` | Drop both queues. |
| `agent.reset()` | Clear transcript, streaming state, pending tools, errors, and queues. |

### Agent Loop

| Function | File | Purpose |
| --- | --- | --- |
| `agentLoop()` | `src/agent-loop.ts` | Return an event stream for a new prompt run. |
| `agentLoopContinue()` | `src/agent-loop.ts` | Return an event stream for continuation. |
| `runAgentLoop()` | `src/agent-loop.ts` | Execute a new prompt run with an event sink. |
| `runAgentLoopContinue()` | `src/agent-loop.ts` | Execute continuation with an event sink. |
| `streamAssistantResponse()` | `src/agent-loop.ts` | Transform context, call provider stream, emit assistant events. |
| `executeToolCalls()` | `src/agent-loop.ts` | Select sequential or parallel execution for tool calls. |
| `prepareToolCall()` | `src/agent-loop.ts` | Resolve tool, prepare arguments, validate schema, run preflight. |
| `executePreparedToolCall()` | `src/agent-loop.ts` | Invoke the tool and stream partial tool updates. |
| `finalizeExecutedToolCall()` | `src/agent-loop.ts` | Run postprocessing hook and produce final tool result. |

## `packages/coding-agent`

### CLI and Runtime Creation

| Function | File | Purpose |
| --- | --- | --- |
| `main(args, options?)` | `src/main.ts` | Main application entrypoint. Parses CLI state, creates runtime, launches mode. |
| `resolveAppMode(parsed, stdinIsTTY, stdoutIsTTY)` | `src/main.ts` | Resolve interactive, print, JSON, or RPC mode. |
| `createSessionManager(parsed, cwd, sessionDir, settingsManager)` | `src/main.ts` | Create, resume, fork, continue, or open the requested session. |
| `buildSessionOptions(...)` | `src/main.ts` | Convert CLI model, thinking, scoped model, and tool flags into session options. |
| `createAgentSessionServices(options)` | `src/core/agent-session-services.ts` | Create cwd-bound settings, auth, model, and resource services. |
| `createAgentSessionFromServices(options)` | `src/core/agent-session-services.ts` | Create `AgentSession` from existing services and a session manager. |
| `createAgentSession(options?)` | `src/core/sdk.ts` | Create an `AgentSession` from defaults and explicit options. |
| `createAgentSessionRuntime(createRuntime, options)` | `src/core/agent-session-runtime.ts` | Create the runtime host used for replacement-capable sessions. |

### `AgentSession`

| API | Purpose |
| --- | --- |
| `session.prompt(text, options?)` | Expand commands/templates, run extension hooks, validate auth, and prompt the agent. |
| `session.steer(text, images?)` | Queue a steering user message while streaming. |
| `session.followUp(text, images?)` | Queue a follow-up user message. |
| `session.sendCustomMessage(message, options?)` | Let extensions inject custom messages into state or future turns. |
| `session.sendUserMessage(content, options?)` | Let extensions send a user message without prompt/template expansion. |
| `session.abort()` | Abort current agent work and wait for idle. |
| `session.setModel(model)` | Switch model, persist it, update default settings, emit extension event. |
| `session.cycleModel(direction?)` | Cycle through scoped models or authenticated models. |
| `session.setThinkingLevel(level)` | Clamp, persist, and emit thinking-level selection. |
| `session.cycleThinkingLevel()` | Cycle through thinking levels supported by the current model. |
| `session.setActiveToolsByName(names)` | Change active tools and rebuild system prompt. |
| `session.compact(customInstructions?)` | Manually compact context and persist a compaction entry. |
| `session.navigateTree(targetId, options?)` | Move to another session-tree node, optionally summarize abandoned context. |
| `session.executeBash(command, onChunk?, options?)` | Execute a user bash command and record it in session context. |
| `session.exportToHtml(outputPath?)` | Export the current session to HTML. |
| `session.exportToJsonl(outputPath?)` | Export the current branch to JSONL. |
| `session.reload()` | Reload settings, providers, resources, and extensions. |
| `session.bindExtensions(bindings)` | Bind mode-specific UI and command actions to extensions. |

### Session Manager

| API | Purpose |
| --- | --- |
| `SessionManager.create(cwd, sessionDir?, options?)` | Create a persistent session manager. |
| `SessionManager.open(path, sessionDir?, cwdOverride?)` | Open an existing JSONL session file. |
| `SessionManager.continueRecent(cwd, sessionDir?)` | Continue the most recent session for a cwd. |
| `SessionManager.inMemory(cwd?)` | Create a non-persistent session manager. |
| `SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?, options?)` | Copy a session into another project context. |
| `SessionManager.list(cwd, sessionDir?, onProgress?)` | List sessions for a project. |
| `SessionManager.listAll(sessionDir?, onProgress?)` | List sessions across projects. |
| `sessionManager.appendMessage(message)` | Append a message entry to the current leaf. |
| `sessionManager.appendModelChange(provider, modelId)` | Persist model selection. |
| `sessionManager.appendThinkingLevelChange(level)` | Persist thinking level. |
| `sessionManager.appendCompaction(...)` | Persist context compaction. |
| `sessionManager.appendCustomEntry(type, data?)` | Persist extension state outside LLM context. |
| `sessionManager.appendCustomMessageEntry(...)` | Persist extension message content for LLM context. |
| `sessionManager.appendLabelChange(targetId, label)` | Add or clear a label for an entry. |
| `sessionManager.buildSessionContext()` | Build model, thinking level, and message context for current branch. |
| `sessionManager.getTree()` | Return the session entry tree with labels. |
| `sessionManager.branch(id)` | Move current leaf to an existing entry. |
| `sessionManager.branchWithSummary(id, summary, details?, fromHook?)` | Move leaf and append branch summary. |
| `sessionManager.createBranchedSession(leafId)` | Create a new session file from one branch path. |

### Tools and Modes

| API | File | Purpose |
| --- | --- | --- |
| `createAllToolDefinitions(cwd, options?)` | `core/tools/index.ts` | Create all built-in tool definitions. |
| `createCodingToolDefinitions(cwd, options?)` | `core/tools/index.ts` | Create default mutating coding tool definitions. |
| `createReadOnlyToolDefinitions(cwd, options?)` | `core/tools/index.ts` | Create read-only tool definitions. |
| `wrapToolDefinition()` | `core/tools/tool-definition-wrapper.ts` | Convert a `ToolDefinition` to an `AgentTool`. |
| `InteractiveMode` | `modes/interactive/interactive-mode.ts` | Full terminal chat UI. |
| `runPrintMode(runtime, options)` | `modes/print-mode.ts` | Single-shot CLI mode for text or JSON event output. |
| `runRpcMode(runtime)` | `modes/rpc/rpc-mode.ts` | JSONL stdin/stdout command and event protocol. |
| `RpcClient` | `modes/rpc/rpc-client.ts` | Client helper for embedding RPC mode. |

## `packages/tui`

| API | File | Purpose |
| --- | --- | --- |
| `new TUI(terminal, showHardwareCursor?)` | `src/tui.ts` | Create the renderer. |
| `tui.start()` / `tui.stop()` | `src/tui.ts` | Start/stop terminal control. |
| `tui.requestRender(force?)` | `src/tui.ts` | Schedule a differential or full render. |
| `tui.setFocus(component)` | `src/tui.ts` | Route input to a component and update focus state. |
| `tui.addInputListener(listener)` | `src/tui.ts` | Intercept or transform raw terminal input. |
| `tui.showOverlay(component, options?)` | `src/tui.ts` | Render a focusable or non-capturing overlay. |
| `matchesKey(data, key)` / `parseKey(data)` | `src/keys.ts` | Match and parse terminal input. |
| `KeybindingsManager` | `src/keybindings.ts` | Resolve default/user keybindings and conflicts. |
| `visibleWidth()`, `truncateToWidth()`, `wrapTextWithAnsi()` | `src/utils.ts` | ANSI-aware terminal text utilities. |
| `renderImage()` / `getImageDimensions()` | `src/terminal-image.ts` | Terminal image rendering and dimension parsing. |
