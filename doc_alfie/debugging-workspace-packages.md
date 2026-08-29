# Debugging Workspace Packages

## Short Answer

`packages/coding-agent` depends on versioned packages such as `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-tui`, but inside this repo those packages resolve through npm workspaces.

The root `package.json` declares the package workspaces and selected extension example workspaces. After install, npm creates workspace symlinks at the root:

```text
node_modules/@earendil-works/pi-agent-core    -> ../../packages/agent
node_modules/@earendil-works/pi-ai            -> ../../packages/ai
node_modules/@earendil-works/pi-tui           -> ../../packages/tui
node_modules/@earendil-works/pi-coding-agent  -> ../../packages/coding-agent
```

So `coding-agent` imports local workspace packages, not registry copies, when running from this monorepo install.

## Workspace Meaning

`workspace` is an npm monorepo feature. The root package owns the install and lockfile; package folders declare their own package metadata.

Main effects:

- the repo has one root `package-lock.json`
- dependencies are installed and deduplicated from the root
- local packages can depend on each other by package name
- npm links local workspace packages into root `node_modules`
- local package versions must still satisfy declared dependency ranges

## Root `node_modules`

Dependencies are installed under the workspace root by npm's default workspace hoisting behavior:

```text
pi-mono/node_modules/
```

not under each package directory:

```text
pi-mono/packages/coding-agent/node_modules/
```

Node can still resolve them because module lookup walks upward from the importing file.

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

The workspace symlink chooses the local package directory. The package `exports` field chooses which built file Node loads.

## Version Ranges

Current published packages are `0.80.2`. `packages/coding-agent/package.json` declares internal workspace dependencies with `^0.80.2`.

Local workspace packages satisfy those ranges during development, so dependency specs still look like published npm dependencies while resolving to local packages.

## Source vs Dist

Workspace links point to local package directories, but the packages export `dist` files:

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
| `packages/coding-agent` | Often runs `src/cli.ts` through `tsx` for source debugging. |
| `packages/agent` | Package-name imports load `dist/*.js`. |
| `packages/ai` | Package-name imports load `dist/*.js`. |
| `packages/tui` | Package-name imports load `dist/*.js`. |

For `coding-agent` source edits, a `tsx` launch reads TypeScript source directly.

For `agent`, `ai`, or `tui` source edits, a package-name import usually uses built `dist` output. Rebuild the changed package before debugging behavior that depends on those edits.

## Source Maps

The repo build emits source maps because `tsconfig.base.json` enables:

```json
"sourceMap": true,
"inlineSources": true
```

The package `dist` directories contain `.js.map` files. VS Code uses those maps to bind breakpoints in `packages/*/src` even when Node executes `dist/*.js`.

If breakpoints do not bind, check that `dist` is current and that the matching `.js.map` exists.

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

## Mental Model

There are three separate mechanisms:

| Mechanism | Role |
| --- | --- |
| npm workspace symlink | Maps package name to local monorepo package directory. |
| package `exports` | Chooses runtime entrypoint, usually `dist/*.js`. |
| source maps | Maps executed `dist/*.js` back to `src/*.ts` for debugging. |
