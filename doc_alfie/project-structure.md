# Project Structure

## Overview

`pi-mono` is a private TypeScript monorepo for the Pi coding agent stack. It publishes four packages:

| Package | Path | Purpose |
| --- | --- | --- |
| `@earendil-works/pi-ai` | `packages/ai` | Unified multi-provider LLM and image API layer. |
| `@earendil-works/pi-agent-core` | `packages/agent` | Stateful agent runtime, agent loop, tool execution, harness APIs. |
| `@earendil-works/pi-coding-agent` | `packages/coding-agent` | End-user `pi` CLI, sessions, tools, extensions, run modes. |
| `@earendil-works/pi-tui` | `packages/tui` | Terminal UI renderer and component library. |

The root workspace also includes selected coding-agent extension examples as npm workspaces.

## Root Layout

| Path | Role |
| --- | --- |
| `package.json` | Root workspace definition, root scripts, shared dev dependencies, release scripts. |
| `package-lock.json` | Dependency lockfile and supply-chain ground truth. |
| `tsconfig.json` | Root type-check config with workspace path aliases. |
| `tsconfig.base.json` | Shared strict TypeScript settings. Uses `erasableSyntaxOnly`. |
| `biome.json` | Formatting and linting configuration. |
| `README.md` | Project overview and development commands. |
| `CONTRIBUTING.md` | Contributor gate and contribution workflow. |
| `AGENTS.md` | Agent and developer rules for this repo. |
| `test.sh` | Non-e2e test runner. |
| `pi-test.sh`, `pi-test.ps1`, `pi-test.bat` | Run the CLI from sources for local manual testing. |
| `.github/` | CI, audit, binary build, issue/PR gate workflows. |
| `.husky/` | Pre-commit hooks, including lockfile protection. |
| `.pi/` | Project-local Pi configuration and resources. |
| `scripts/` | Release, lockfile, shrinkwrap, import, smoke, stats, and profiling utilities. |
| `packages/` | Source packages and examples. |
| `docs/` | Workspace analysis generated for this request. |

## Package Source Size

Approximate source file counts under each package source directory:

| Package | Source files |
| --- | ---: |
| `packages/ai/src` | 53 |
| `packages/agent/src` | 25 |
| `packages/coding-agent/src` | 154 |
| `packages/tui/src` | 26 |

`packages/mom` exists but currently contains only `node_modules` content and no package manifest or source files.

## Workspaces

The root npm workspaces are:

- `packages/*`
- `packages/coding-agent/examples/extensions/with-deps`
- `packages/coding-agent/examples/extensions/custom-provider-anthropic`
- `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo`
- `packages/coding-agent/examples/extensions/sandbox`

## Package Layouts

### `packages/ai`

| Path | Role |
| --- | --- |
| `src/index.ts` | Public exports for model APIs, provider APIs, OAuth types, images, utilities. |
| `src/types.ts` | Core data types: models, contexts, messages, stream events, options, usage. |
| `src/models.ts` | Built-in model registry access and thinking-level utilities. |
| `src/models.generated.ts` | Generated built-in model data. Do not edit directly. |
| `src/api-registry.ts` | Runtime registry for provider stream implementations. |
| `src/stream.ts` | `stream`, `complete`, `streamSimple`, and `completeSimple` dispatch. |
| `src/providers/` | Provider adapters for OpenAI, Anthropic, Google, Mistral, Bedrock, Cloudflare, etc. |
| `src/utils/` | Event streams, OAuth helpers, diagnostics, validation, overflow detection. |
| `src/images*` | Image generation model and provider registry APIs. |
| `scripts/` | Model and image-model generation scripts. |
| `test/` | Provider behavior, stream conversion, OAuth, images, and compatibility tests. |

### `packages/agent`

| Path | Role |
| --- | --- |
| `src/index.ts` | Public exports for agent, loop, harness, session, compaction, proxy, types. |
| `src/types.ts` | Agent state, agent messages, tools, loop config, events, queue modes. |
| `src/agent.ts` | Stateful `Agent` wrapper over the low-level loop. |
| `src/agent-loop.ts` | Low-level async event loop, LLM streaming, tool execution, queues. |
| `src/proxy.ts` | Proxy stream utility for remote or browser-backed stream endpoints. |
| `src/harness/` | Higher-level durable harness, session repos, compaction, skills, prompts. |
| `docs/` | Agent harness design docs. |
| `test/` | Agent loop, agent state, harness, session, compaction tests. |

### `packages/coding-agent`

| Path | Role |
| --- | --- |
| `src/cli.ts` | Node executable entrypoint for the `pi` binary. |
| `src/main.ts` | CLI argument handling, runtime setup, mode selection. |
| `src/index.ts` | SDK-style public exports from the coding-agent package. |
| `src/core/` | Session, settings, auth, models, resources, tools, extensions, compaction. |
| `src/core/tools/` | Built-in read, bash, edit, write, grep, find, ls tool definitions. |
| `src/core/extensions/` | Extension loader, runner, types, tool wrappers, UI/runtime contracts. |
| `src/core/export-html/` | Session HTML export templates and renderers. |
| `src/modes/interactive/` | Interactive TUI application and mode-specific components. |
| `src/modes/print-mode.ts` | Single-shot text and JSON modes. |
| `src/modes/rpc/` | JSONL stdin/stdout RPC protocol mode. |
| `src/cli/` | Argument parsing, file processing, model listing, session picker. |
| `src/utils/` | Paths, git URL parsing, shell helpers, image conversion, clipboard, version checks. |
| `src/bun/` | Bun binary helpers. |
| `docs/` | User documentation shipped with the package. |
| `examples/` | SDK and extension examples. |
| `test/` | Unit tests and faux-provider regression suite. |

### `packages/tui`

| Path | Role |
| --- | --- |
| `src/index.ts` | Public exports for TUI, components, keybindings, terminal image APIs. |
| `src/tui.ts` | Core differential renderer, focus, overlay stack, cursor positioning. |
| `src/components/` | Box, text, input, editor, markdown, select list, settings list, image, loader. |
| `src/keys.ts` | Keyboard protocol parsing and matching. |
| `src/keybindings.ts` | Configurable keybinding registry and conflict detection. |
| `src/terminal.ts` | Terminal abstraction and process-backed terminal. |
| `src/terminal-image.ts` | Kitty/iTerm2 image protocol support and image dimension parsing. |
| `src/utils.ts` | Width, truncation, wrapping, ANSI-aware text utilities. |
| `native/` | Prebuilt native helpers for macOS modifiers and Windows console mode. |
| `test/` | Component, rendering, key, image, and terminal behavior tests. |

## Script Areas

| Script | Role |
| --- | --- |
| `npm run check` | Biome format/lint, pinned dependency check, import check, shrinkwrap check, type check, browser smoke check. |
| `./test.sh` | Repo-approved non-e2e test runner. |
| `scripts/generate-coding-agent-shrinkwrap.mjs` | Generates and checks published coding-agent shrinkwrap. |
| `scripts/check-pinned-deps.mjs` | Ensures direct external dependencies are pinned. |
| `scripts/check-ts-relative-imports.mjs` | Enforces native TypeScript import compatibility. |
| `scripts/local-release.mjs` | Builds isolated local release smoke artifacts. |
| `scripts/release.mjs` | Release version and publish workflow driver. |
| `scripts/build-binaries.sh` | Binary build helper. |
| `scripts/check-browser-smoke.mjs` | Browser smoke validation for packaged docs or UI paths. |

## Test Layout

| Area | Test style |
| --- | --- |
| `packages/ai/test` | Provider adapters, stream normalization, OAuth, model metadata, image APIs. |
| `packages/agent/test` | Agent loop, harness, sessions, compaction, repo/storage behavior. |
| `packages/coding-agent/test` | CLI/core behavior, settings, sessions, tools, extensions, modes. |
| `packages/coding-agent/test/suite` | Faux-provider integration suite and regressions. |
| `packages/tui/test` | Node test and virtual terminal coverage for UI components and rendering. |

