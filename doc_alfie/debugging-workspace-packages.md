# Debugging Workspace Packages

## Short Answer

`packages/coding-agent` depends on versioned packages such as `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core`, but inside this repo those packages resolve through npm workspaces.

The root `package.json` declares:

```json
"workspaces": [
  "packages/*",
  "packages/coding-agent/examples/extensions/with-deps",
  "packages/coding-agent/examples/extensions/custom-provider-anthropic",
  "packages/coding-agent/examples/extensions/custom-provider-gitlab-duo",
  "packages/coding-agent/examples/extensions/sandbox"
]
```

After install, npm creates workspace symlinks at the root:

```text
node_modules/@earendil-works/pi-agent-core -> ../../packages/agent
node_modules/@earendil-works/pi-ai         -> ../../packages/ai
node_modules/@earendil-works/pi-tui        -> ../../packages/tui
node_modules/@earendil-works/pi-coding-agent -> ../../packages/coding-agent
```

So `coding-agent` imports local workspace packages, not separate registry copies, when running from this monorepo install.

## What Workspace Means

`workspace` is an npm monorepo feature. It is not just a generic project-folder term.

A workspace root declares local package folders in its root `package.json`:

```json
{
  "workspaces": ["packages/*"]
}
```

npm then treats those folders as packages that belong to one install unit.

Main effects:

- the repo has one root `package-lock.json`
- dependencies are installed and deduplicated from the root
- local packages can depend on each other by package name
- npm links local workspace packages into root `node_modules`
- package versions still matter, because local workspace packages must satisfy declared dependency ranges

## Root `node_modules`

Dependencies are installed under the workspace root by npm's default workspace hoisting behavior:

```text
pi-mono/node_modules/
```

not under each package directory:

```text
pi-mono/packages/coding-agent/node_modules/
```

`packages/coding-agent/package.json` still declares what `coding-agent` depends on. The workspace root decides where those dependencies are physically installed.

Node can still resolve them because module lookup walks upward from the importing file:

```text
packages/coding-agent/node_modules
packages/node_modules
node_modules
```

So an import from `packages/coding-agent/src` eventually reaches:

```text
pi-mono/node_modules/@earendil-works/pi-agent-core
```

which is the workspace symlink to `packages/agent`.

This layout:

- deduplicates dependencies shared by packages
- keeps one root lockfile
- links workspace packages to each other locally
- avoids separate installs per package

## Resolution Chain

When `packages/coding-agent/src` imports a workspace dependency:

```ts
import { Agent } from "@earendil-works/pi-agent-core";
```

Node resolves it like this:

```text
@earendil-works/pi-agent-core
  -> root node_modules workspace symlink
  -> packages/agent/package.json
  -> package exports
  -> packages/agent/dist/index.js
```

The same applies to `@earendil-works/pi-ai`:

```text
@earendil-works/pi-ai
  -> root node_modules workspace symlink
  -> packages/ai/package.json
  -> package exports
  -> packages/ai/dist/index.js
```

The workspace symlink associates the package name with the local package directory. The package `exports` field then decides which built file Node actually loads.

## Version Ranges

`packages/coding-agent/package.json` declares:

```json
"@earendil-works/pi-agent-core": "^0.75.5",
"@earendil-works/pi-ai": "^0.75.5",
"@earendil-works/pi-tui": "^0.75.5"
```

The local workspace packages currently have matching versions, so the local workspace packages satisfy those ranges.

This is why the dependency looks versioned like a published npm dependency while still resolving to the local monorepo package during development.

## Source vs Dist

The workspace link points to the local package directory, but `packages/agent/package.json` and `packages/ai/package.json` export `dist` files:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
}
```

That means a debug run can execute different forms of code:

| Package | Debug launch behavior |
| --- | --- |
| `packages/coding-agent` | Usually runs `src/cli.ts` through `tsx` in `.vscode/launch.json` |
| `packages/agent` | Loaded through package export, so runtime executes `dist/*.js` |
| `packages/ai` | Loaded through package export, so runtime executes `dist/*.js` |
| `packages/tui` | Loaded through package export, so runtime executes `dist/*.js` |

For `coding-agent` source edits, the `tsx` launch reads TypeScript source directly.

For `agent`, `ai`, or `tui` source edits, the runtime uses their built `dist` output. Rebuild the changed package before debugging behavior that depends on those edits.

## Source Maps

The repo build emits source maps because `tsconfig.base.json` enables:

```json
"sourceMap": true,
"inlineSources": true
```

The package `dist` directories contain `.js.map` files. VS Code uses those maps to bind breakpoints in `packages/agent/src` and `packages/ai/src` even though Node is executing `dist/*.js`.

Debug chain:

```text
Node executes packages/agent/dist/agent-loop.js
  -> source map points back to packages/agent/src/agent-loop.ts
  -> VS Code binds source breakpoint
```

If breakpoints do not bind, check that `dist` is current and that the matching `.js.map` exists.

## VS Code Launch Modes

The common debug launch for coding-agent uses:

```json
"runtimeArgs": ["--import", "tsx"],
"program": "${workspaceFolder}/packages/coding-agent/src/cli.ts",
"cwd": "${workspaceFolder}/packages/coding-agent"
```

This has two effects:

- `coding-agent` itself runs from TypeScript source.
- package-name imports still resolve through Node package resolution and workspace package exports.

The built launch uses:

```json
"program": "${workspaceFolder}/packages/coding-agent/dist/cli.js"
```

That mode runs built `coding-agent` too. Use it when debugging published-package behavior or validating `dist` output.

## Practical Checks

Verify workspace links:

```bash
readlink node_modules/@earendil-works/pi-agent-core
readlink node_modules/@earendil-works/pi-ai
readlink node_modules/@earendil-works/pi-tui
```

Expected shape:

```text
../../packages/agent
../../packages/ai
../../packages/tui
```

Check what package export Node will use by reading the target package's `package.json`.

Check whether debugged dependency source is stale by comparing source edits with the corresponding `dist/*.js` and `dist/*.js.map` files.

## Common Pitfall

Editing `packages/agent/src/agent-loop.ts` while debugging `packages/coding-agent/src/cli.ts` does not automatically make Node run the edited TypeScript file.

Runtime path is still:

```text
coding-agent src import
  -> @earendil-works/pi-agent-core
  -> packages/agent/dist/index.js
  -> packages/agent/dist/agent-loop.js
```

So stale `dist` can make it look like source changes are ignored.

## Mental Model

There are three separate mechanisms:

| Mechanism | Role |
| --- | --- |
| npm workspace symlink | Maps package name to local monorepo package directory |
| package `exports` | Chooses runtime entrypoint, usually `dist/*.js` |
| source maps | Maps executed `dist/*.js` back to `src/*.ts` for debugging |

The symlink answers "which package copy is used." The export answers "which file is executed." The source map answers "which source file the debugger shows."
