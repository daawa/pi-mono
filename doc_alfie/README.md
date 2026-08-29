# Workspace Analysis

This directory documents the current `pi-mono` workspace at a high level.

Last verified against `main2` at `d6ad4b88` on 2026-06-24.

- [Project Structure](./project-structure.md): repository layout, packages, scripts, tests, and generated or support areas.
- [Architecture Design](./architecture-design.md): package layering, startup flow, provider/model architecture, sessions, resources, tools, extensions, and TUI state.
- [Components Design](./components-design.md): major components by package and how they collaborate.
- [Session Lifecycle](./session-lifecycle.md): session creation, persistence, resume, tree navigation, fork, export, and migration.
- [Runtime Modes](./runtime-modes.md): interactive, print, JSON, and RPC mode selection and responsibilities.
- [Agent Loop Queues and Hooks](./agent-loop-hooks.md): low-level turn order, steering and follow-up queues, tool hooks, provider hooks, and next-turn hooks.
- [Harness Workflow](./harness-workflow.md): current CLI flow to `AgentSession`/`Agent`/`runAgentLoop()`, and the separate direct `AgentHarness` path.
- [Communication and Transports](./communication-transports.md): in-process package boundaries and external transport boundaries.
- [Functions Reference](./functions-reference.md): central public APIs and important orchestration functions.
- [Debugging Workspace Packages](./debugging-workspace-packages.md): npm workspace links, package exports, `dist`, and source map behavior.
- [Provider Model Resolution](./providers_models_resovle.md): bundled model data, runtime catalog caching, merge precedence, refreshes, and upgrades.
- [Tool Injection Process](./coding_agent/tool-injection-process.md): how `ToolDefinition` values become active `AgentTool` values and provider-facing schemas.
- [Skill Injection Process](./coding_agent/skill-injection-process.md): how `SKILL.md` files are discovered, listed in prompts, and explicitly expanded.

This analysis is based on the current workspace source, package manifests, README files, shipped docs, and implementation paths under `packages/*/src`.
