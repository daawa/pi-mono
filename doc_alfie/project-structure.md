# Project Structure

## Overview

`pi-mono` is a TypeScript monorepo for the Pi agent harness. It publishes four packages:

| Package | Path | Purpose |
| --- | --- | --- |
| `@earendil-works/pi-ai` | `packages/ai` | Unified multi-provider LLM and image model layer. |
| `@earendil-works/pi-agent-core` | `packages/agent` | Generic agent runtime, event loop, tool execution, queues, and harness APIs. |
| `@earendil-works/pi-coding-agent` | `packages/coding-agent` | User-facing `pi` CLI, sessions, settings, tools, extensions, modes, and docs. |
| `@earendil-works/pi-tui` | `packages/tui` | Terminal UI renderer and component library. |

## Root Layout

| Path | Role |
| --- | --- |
| `package.json` | Root workspace definition, root scripts, shared dev dependencies, release scripts. |
| `package-lock.json` | Dependency lockfile and supply-chain ground truth. |
| `tsconfig.json` | Root type-check config with workspace path aliases. |
| `tsconfig.base.json` | Shared strict TypeScript settings with erasable syntax enabled. |
| `biome.json` | Formatting and linting configuration. |
| `README.md` | Project overview, package list, development commands, and security posture. |
| `CONTRIBUTING.md` | Contributor gate and contribution workflow. |
| `SECURITY.md` | Vulnerability and supported-version policy. |
| `AGENTS.md` | Repo-local rules for agents and developers. |
| `test.sh` | Repo-approved non-e2e test runner. |
| `pi-test.sh`, `pi-test.ps1`, `pi-test.bat` | Run the CLI from sources for local manual testing. |
| `.github/` | CI, binary build, issue/PR gate, audit, and release workflows. |
| `.husky/` | Pre-commit hooks, including lockfile protection. |
| `.pi/` | Project-local Pi configuration, prompts, and extensions. |
| `scripts/` | Release, publish, shrinkwrap, lockfile, smoke, stats, profiling, and maintenance utilities. |
| `packages/` | Source packages, package docs, tests, and examples. |
| `doc_alfie/` | Workspace analysis notes maintained outside shipped package docs. |

## Workspaces

The root npm workspaces are:

- `packages/*`
- `packages/coding-agent/examples/extensions/with-deps`
- `packages/coding-agent/examples/extensions/custom-provider-anthropic`
- `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo`
- `packages/coding-agent/examples/extensions/sandbox`
- `packages/coding-agent/examples/extensions/gondolin`

## Source Size

Approximate current source file counts:

| Area | Source files |
| --- | ---: |
| `packages/ai/src` | 145 |
| `packages/agent/src` | 25 |
| `packages/coding-agent/src` | 167 |
| `packages/tui/src` | 28 |

## Package Layouts

### `packages/ai`

| Path | Role |
| --- | --- |
| `src/index.ts` | Side-effect-free public core exports. It intentionally excludes the old global API registry and generated catalog reads. |
| `src/models.ts` | `Provider`, `Models`, `MutableModels`, `createModels()`, `createProvider()`, auth application, stream convenience, cost and thinking helpers. |
| `src/providers/all.ts` | Built-in provider factories and `builtinModels()` / `builtinImagesModels()`. |
| `src/providers/*.ts` | Provider factories with static or dynamic model catalogs. |
| `src/providers/*.models.ts` | Generated or static provider model data. |
| `src/api/*.ts` | Concrete API implementations such as OpenAI Responses, Anthropic Messages, Google, Mistral, Bedrock, and OpenAI-compatible completions. |
| `src/api/*.lazy.ts` | Lazy wrappers around API implementation modules. |
| `src/compat.ts` | Temporary compatibility entrypoint for the old global registry and `stream()` / `streamSimple()` API. |
| `src/auth/` | Provider auth resolution, credential stores, and auth context types. |
| `src/images-models.ts`, `src/images.ts`, `src/images-api-registry.ts` | Image model collection and legacy image generation registry. |
| `scripts/` | Model and image-model generation scripts. |
| `test/` | Provider behavior, stream conversion, OAuth, model metadata, image APIs, and compatibility tests. |

### `packages/agent`

| Path | Role |
| --- | --- |
| `src/index.ts` | Public exports for agent, loop, harness, sessions, compaction, proxy, and types. |
| `src/types.ts` | Agent state, agent messages, tools, loop config, events, queue modes, and hook contracts. |
| `src/agent.ts` | Stateful `Agent` wrapper over the low-level loop. |
| `src/agent-loop.ts` | Low-level async event loop, provider streaming, tool execution, queues, turn updates, and event sequencing. |
| `src/proxy.ts` | Proxy stream utility for remote or browser-backed stream endpoints. |
| `src/harness/` | Higher-level embeddable harness with session repos, durable storage, compaction helpers, skills, prompts, and environment abstractions. |
| `docs/` | Agent harness, hooks, durable harness, observability, and model docs. |
| `test/` | Agent loop, agent state, harness, session, storage, compaction, and resource tests. |

### `packages/coding-agent`

| Path | Role |
| --- | --- |
| `src/cli.ts` | Node executable entrypoint for the `pi` binary. |
| `src/main.ts` | CLI argument handling, runtime setup, mode selection, session selection, startup checks. |
| `src/index.ts` | SDK-style public exports from the coding-agent package. |
| `src/core/` | Session, settings, auth, models, resources, tools, extensions, compaction, exports, trust, and telemetry. |
| `src/core/tools/` | Built-in `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls` tool definitions. |
| `src/core/extensions/` | Extension loader, runner, types, wrappers, UI/runtime contracts. |
| `src/modes/interactive/` | Interactive TUI application, theme controller, assets, and mode-specific components. |
| `src/modes/print-mode.ts` | One-shot text and JSON event stream modes. |
| `src/modes/rpc/` | JSONL stdin/stdout RPC protocol mode and client helper. |
| `src/cli/` | Argument parsing, initial message processing, startup UI, session picker, model listing, project trust. |
| `src/bun/` | Bun binary helpers. |
| `docs/` | Shipped user and integration documentation. |
| `examples/` | SDK and extension examples. |
| `test/` | Unit tests and faux-provider integration suite. |

### `packages/tui`

| Path | Role |
| --- | --- |
| `src/index.ts` | Public exports for TUI, components, keybindings, terminal colors, and terminal images. |
| `src/tui.ts` | Core differential renderer, focus, overlay stack, cursor positioning, and terminal resize handling. |
| `src/components/` | Box, text, input, editor, markdown, select list, settings list, image, loader, and spacer components. |
| `src/keys.ts` | Keyboard protocol parsing and matching. |
| `src/keybindings.ts` | Configurable keybinding registry and conflict detection. |
| `src/terminal.ts` | Terminal abstraction and process-backed terminal. |
| `src/terminal-image.ts` | Kitty/iTerm2 image protocol support and image dimension parsing. |
| `src/word-navigation.ts`, `src/kill-ring.ts`, `src/undo-stack.ts` | Editor behavior support. |
| `native/` | Prebuilt native helpers for macOS modifiers and Windows console mode. |
| `test/` | Component, rendering, key, terminal, image, and text-width behavior tests. |

## Main Scripts

| Script | Role |
| --- | --- |
| `npm run check` | Biome format/lint with writes, pinned dependency check, TypeScript import check, shrinkwrap check, type check, browser smoke check. |
| `./test.sh` | Repo-approved non-e2e test runner. |
| `npm run release:local` | Build isolated local release smoke artifacts. |
| `npm run release:patch`, `npm run release:minor`, `npm run release:major` | Lockstep package release scripts. |
| `node scripts/generate-coding-agent-shrinkwrap.mjs` | Generate or check the published coding-agent shrinkwrap. |
| `node scripts/publish.mjs` | Idempotent npm publish helper used by CI/release flow. |

## Test Layout

| Area | Test style |
| --- | --- |
| `packages/ai/test` | Provider adapters, stream normalization, OAuth, model metadata, images, and compat behavior. |
| `packages/agent/test` | Agent loop, harness, sessions, storage, compaction, environment behavior. |
| `packages/coding-agent/test` | CLI/core behavior, settings, sessions, tools, extensions, modes, and regressions. |
| `packages/coding-agent/test/suite` | Faux-provider integration suite and issue-specific regressions. |
| `packages/tui/test` | Node test and virtual terminal coverage for UI components and rendering. |
