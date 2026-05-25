# Functions Reference

This is a focused reference for the central public APIs and important orchestration functions. It is not an exhaustive list of every helper.

## `packages/ai`

### Model APIs

| Function | File | Purpose |
| --- | --- | --- |
| `getModel(provider, modelId)` | `src/models.ts` | Return a built-in model definition from generated metadata. |
| `getProviders()` | `src/models.ts` | Return known provider ids registered in generated metadata. |
| `getModels(provider)` | `src/models.ts` | Return known models for a provider. |
| `calculateCost(model, usage)` | `src/models.ts` | Fill usage cost fields from model pricing metadata. |
| `getSupportedThinkingLevels(model)` | `src/models.ts` | Return thinking levels supported by a model. |
| `clampThinkingLevel(model, level)` | `src/models.ts` | Choose the nearest supported thinking level. |
| `modelsAreEqual(a, b)` | `src/models.ts` | Compare models by provider and id. |

### Stream APIs

| Function | File | Purpose |
| --- | --- | --- |
| `registerApiProvider(provider, sourceId?)` | `src/api-registry.ts` | Register a provider stream implementation for an API id. |
| `getApiProvider(api)` | `src/api-registry.ts` | Return the provider implementation for an API id. |
| `getApiProviders()` | `src/api-registry.ts` | Return all registered provider implementations. |
| `unregisterApiProviders(sourceId)` | `src/api-registry.ts` | Remove providers registered by a source. |
| `clearApiProviders()` | `src/api-registry.ts` | Clear the provider registry. |
| `stream(model, context, options?)` | `src/stream.ts` | Dispatch a provider-specific stream call. |
| `complete(model, context, options?)` | `src/stream.ts` | Stream and await the final assistant message. |
| `streamSimple(model, context, options?)` | `src/stream.ts` | Stream with unified reasoning options. |
| `completeSimple(model, context, options?)` | `src/stream.ts` | Complete with unified reasoning options. |

### Image APIs

| Function | File | Purpose |
| --- | --- | --- |
| `getImageModel(provider, modelId)` | `src/image-models.ts` | Return an image model definition. |
| `getImageProviders()` | `src/image-models.ts` | Return known image providers. |
| `getImageModels(provider)` | `src/image-models.ts` | Return image models for a provider. |
| `registerImagesApiProvider(provider, sourceId?)` | `src/images-api-registry.ts` | Register image generation implementation. |
| `getImagesApiProvider(api)` | `src/images-api-registry.ts` | Resolve an image API implementation. |

## `packages/agent`

### `Agent`

| API | Purpose |
| --- | --- |
| `new Agent(options)` | Create a stateful agent with initial state, stream function, hooks, queues, and provider options. |
| `agent.prompt(input, images?)` | Start a prompt from text, one message, or a message batch. |
| `agent.continue()` | Continue from the current context when the last message is user or tool result. |
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
| `agentLoop(prompts, context, config, signal?, streamFn?)` | `src/agent-loop.ts` | Return an event stream for a new prompt run. |
| `agentLoopContinue(context, config, signal?, streamFn?)` | `src/agent-loop.ts` | Return an event stream for continuation. |
| `runAgentLoop(prompts, context, config, emit, signal?, streamFn?)` | `src/agent-loop.ts` | Execute a new prompt run with an event sink. |
| `runAgentLoopContinue(context, config, emit, signal?, streamFn?)` | `src/agent-loop.ts` | Execute continuation with an event sink. |
| `streamAssistantResponse(...)` | `src/agent-loop.ts` | Transform context, call provider stream, emit assistant events. |
| `executeToolCalls(...)` | `src/agent-loop.ts` | Select sequential or parallel execution for tool calls. |
| `prepareToolCall(...)` | `src/agent-loop.ts` | Resolve tool, prepare arguments, validate schema, run preflight. |
| `executePreparedToolCall(...)` | `src/agent-loop.ts` | Invoke the tool and stream partial tool updates. |
| `finalizeExecutedToolCall(...)` | `src/agent-loop.ts` | Run postprocessing hook and produce final tool result. |

## `packages/coding-agent`

### CLI and Runtime Creation

| Function | File | Purpose |
| --- | --- | --- |
| `main(args, options?)` | `src/main.ts` | Main application entrypoint. Parses CLI state, creates runtime, launches mode. |
| `resolveAppMode(parsed, stdinIsTTY)` | `src/main.ts` | Resolve interactive, print, JSON, or RPC mode. |
| `createSessionManager(parsed, cwd, sessionDir, settingsManager)` | `src/main.ts` | Create, resume, fork, or open the requested session. |
| `buildSessionOptions(...)` | `src/main.ts` | Convert CLI model, thinking, scoped model, and tool flags into session options. |
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
| `session.cycleModel(direction?)` | Cycle through scoped models or all available authenticated models. |
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

### `AgentSessionRuntime`

| API | Purpose |
| --- | --- |
| `runtime.switchSession(path, options?)` | Tear down current session and resume another session file. |
| `runtime.newSession(options?)` | Replace current session with a new session. |
| `runtime.fork(entryId, options?)` | Fork at or before a session-tree entry. |
| `runtime.importFromJsonl(path, cwdOverride?)` | Copy and open an external JSONL session. |
| `runtime.dispose()` | Emit session shutdown and dispose active session state. |
| `runtime.setRebindSession(fn)` | Register mode-level rebinding after replacement. |
| `runtime.setBeforeSessionInvalidate(fn)` | Register synchronous UI teardown before old context invalidation. |

### Session Manager

| API | Purpose |
| --- | --- |
| `SessionManager.create(cwd, sessionDir?)` | Create a persistent session manager. |
| `SessionManager.open(path, sessionDir?, cwdOverride?)` | Open an existing JSONL session file. |
| `SessionManager.continueRecent(cwd, sessionDir?)` | Continue most recent session for a cwd. |
| `SessionManager.inMemory(cwd?)` | Create a non-persistent session manager. |
| `SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?)` | Copy a session into another project context. |
| `SessionManager.list(cwd, sessionDir?, onProgress?)` | List sessions for a project. |
| `SessionManager.listAll(onProgress?)` | List sessions across all projects. |
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

### Tools

| Function | File | Purpose |
| --- | --- | --- |
| `createReadToolDefinition`, `createReadTool` | `core/tools/read.ts` | Read files for the model. |
| `createBashToolDefinition`, `createBashTool` | `core/tools/bash.ts` | Execute shell commands. |
| `createEditToolDefinition`, `createEditTool` | `core/tools/edit.ts` | Apply exact text edits. |
| `createWriteToolDefinition`, `createWriteTool` | `core/tools/write.ts` | Write file content. |
| `createGrepToolDefinition`, `createGrepTool` | `core/tools/grep.ts` | Search file content. |
| `createFindToolDefinition`, `createFindTool` | `core/tools/find.ts` | Search file paths. |
| `createLsToolDefinition`, `createLsTool` | `core/tools/ls.ts` | List directory contents. |
| `createCodingTools(cwd, options?)` | `core/tools/index.ts` | Create default mutating coding tools. |
| `createReadOnlyTools(cwd, options?)` | `core/tools/index.ts` | Create read-only tools. |
| `createAllTools(cwd, options?)` | `core/tools/index.ts` | Create all built-in tools. |
| `withFileMutationQueue(tool)` | `core/tools/file-mutation-queue.ts` | Serialize file mutation tool execution. |

### Modes

| Function/Class | File | Purpose |
| --- | --- | --- |
| `InteractiveMode` | `modes/interactive/interactive-mode.ts` | Full-screen terminal chat UI. |
| `runPrintMode(runtime, options)` | `modes/print-mode.ts` | Single-shot CLI mode for text or JSON event output. |
| `runRpcMode(runtime)` | `modes/rpc/rpc-mode.ts` | JSONL stdin/stdout command and event protocol. |
| `RpcClient` | `modes/rpc/rpc-client.ts` | Client helper for embedding RPC mode. |

## `packages/tui`

### Renderer APIs

| API | File | Purpose |
| --- | --- | --- |
| `new TUI(terminal, showHardwareCursor?)` | `src/tui.ts` | Create the renderer. |
| `tui.start()` | `src/tui.ts` | Start terminal input and rendering. |
| `tui.stop()` | `src/tui.ts` | Stop terminal control and restore cursor. |
| `tui.requestRender(force?)` | `src/tui.ts` | Schedule a differential render or full render. |
| `tui.setFocus(component)` | `src/tui.ts` | Route input to a component and update focus state. |
| `tui.addInputListener(listener)` | `src/tui.ts` | Intercept or transform raw terminal input. |
| `tui.showOverlay(component, options?)` | `src/tui.ts` | Render a focusable or non-capturing overlay. |
| `tui.hideOverlay()` | `src/tui.ts` | Hide the topmost overlay. |

### Component APIs

| Component | Purpose |
| --- | --- |
| `Container` | Owns child components and concatenates their rendered lines. |
| `Text` | Wrapped multiline text. |
| `TruncatedText` | Single-line truncating text. |
| `Markdown` | Markdown renderer with theming and optional syntax highlighting. |
| `Input` | Single-line input. |
| `Editor` | Multiline editor with autocomplete and paste handling. |
| `SelectList` | Keyboard-driven selector. |
| `SettingsList` | Keyboard-driven settings list with values and submenus. |
| `Loader` | Animated loader text. |
| `CancellableLoader` | Loader with abort signal. |
| `Image` | Inline terminal image renderer with fallback. |
| `Spacer` | Vertical spacing. |
| `Box` | Container with padding and optional background styling. |

### Utility APIs

| Function/Class | File | Purpose |
| --- | --- | --- |
| `matchesKey(data, key)` | `src/keys.ts` | Match raw input against a normalized key id. |
| `parseKey(data)` | `src/keys.ts` | Parse raw terminal input into key information. |
| `KeybindingsManager` | `src/keybindings.ts` | Resolve default/user keybindings and conflicts. |
| `setKeybindings(manager)` | `src/keybindings.ts` | Set the global keybinding manager. |
| `visibleWidth(text)` | `src/utils.ts` | Measure terminal visible width ignoring ANSI codes. |
| `truncateToWidth(text, width, ellipsis?)` | `src/utils.ts` | Truncate ANSI-aware text to terminal width. |
| `wrapTextWithAnsi(text, width)` | `src/utils.ts` | Wrap text while preserving ANSI styles. |
| `renderImage(...)` | `src/terminal-image.ts` | Render image data for supported terminal protocols. |
| `getImageDimensions(...)` | `src/terminal-image.ts` | Parse image dimensions from encoded image bytes. |
| `CombinedAutocompleteProvider` | `src/autocomplete.ts` | Combines slash command and file path autocomplete. |

