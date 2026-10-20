# ADR 01: The package map and the layer rules

- Task: SE1-01 of `docs/generic-engine-plan.md`
- Date: 2026-10-15
- Status: **accepted (provisional)**. The owner said "go ahead with the plan". This record uses the recommended
  answers of §11 (Q1, Q5, Q10). The owner can change it.

## Context

Today the engine and the resus room are one set of packages (`room3d`, `room3d-view`, `room3d-labs`, the editor, the
host). 83 % of the source files of `room3d` use clinical words. A generic engine needs packages that hold no domain
code, and rules that stop domain code from coming back.

## Decision

### The packages

| Package                   | Folder                    | What it holds                                                               | Kind            |
| ------------------------- | ------------------------- | --------------------------------------------------------------------------- | --------------- |
| `@scenity/scene`          | `packages/scene`          | Documents, schemas, ops, overrides, migrations, `evaluate()`, math          | Pure TypeScript |
| `@scenity/platform`       | `packages/platform`       | Frame key, content hash, frame index (was `labs-platform`)                  | Pure TypeScript |
| `@scenity/render`         | `packages/render`         | WebGL and WebGPU backends, glTF loader, KTX2, materials, lights, GPU timer  | three.js        |
| `@scenity/character`      | `packages/character`      | Rig profiles, IK body, rig driver, clip sampler, clip layer, path, animator | three.js        |
| `@scenity/runtime`        | `packages/runtime`        | Host client, worker, protocol, `SceneCore`, systems, plugin host, clock     | three.js        |
| `@scenity/runtime-dev`    | `packages/runtime-dev`    | Inspect, debug layers, pick framework, tune API, capture, overlays          | three.js        |
| `@scenity/view-vue`       | `packages/view-vue`       | `SceneView.vue`: life cycle, fallback ladder, adaptive quality, poster      | Vue             |
| `@scenity/player`         | `packages/player`         | The runtime with documents; JS API, Vue component, `<scenity-player>`       | Browser         |
| `@scenity/editor-core`    | `packages/editor-core`    | Command kit, runner, ops, history, selection, proposals, clipboard          | Pure TypeScript |
| `@scenity/rules`          | `packages/rules`          | The metric library (SE7-01): built-in metrics, plugin metrics, context      | Pure TypeScript |
| `@scenity/bridge`         | `packages/bridge`         | The postMessage contract of the workbench and the editor                    | Pure TypeScript |
| `@scenity/assets`         | `packages/assets`         | Asset database, importers, build, stills, rights                            | Bun, Blender    |
| `@scenity/cli`            | `packages/cli`            | The `scenity` command                                                       | Bun             |
| `@scenity/ui`             | `packages/ui`             | The design system with no domain parts                                      | Vue             |
| `@scenity/tokens`         | `packages/tokens`         | Neutral themes                                                              | Build tool      |
| `@scenity/i18n`           | `packages/i18n`           | Fluent runtime with no registry of contract enums                           | Pure TypeScript |
| `apps/editor`             | `apps/editor`             | The editor page                                                             | Vue             |
| `apps/workbench`          | `apps/workbench`          | The workbench page                                                          | Vue             |
| `@scenity/workbench-host` | `packages/workbench-host` | The Bun host of the workbench                                               | Bun             |
| `@codeblue/resus-*`       | `plugins/resus/<part>`    | All resus code: room, view, dev, editor, host, assets, content, SDK chain   | Plugin          |
| —                         | `samples/<name>`          | Projects with free art; no engine code                                      | Project         |

The Bun workspace globs are `apps/*`, `packages/*`, `plugins/*/*` and `samples/*/plugins/*`. The resus parts are
`plugins/resus/room`, `view`, `dev`, `editor`, `host`, `assets`, `monitor`, `ui` and `tokens` (the domain components
and tokens, SE1-05), `content` (the built assets and their Vite index, SE1-10) and the CodeBlue SDK chain under
`plugins/resus/sdk/*` (decision Q1). The resus sample project is `samples/resus/scenity.project.json` (SE2-08).
SE10-05 moved the resus plugin and its project to the CodeBlue repository (`frontend/web`). There the package name of
each part is `@codeblue/resus-<part>` (for example `@codeblue/resus-room`; 2026-10-17). The scope `@scenity/` is for
the engine packages only: a plugin package can have any scope.

### The layer rules

An arrow means "can import". A package not in the list of a row cannot import it.

| Package          | Can import (workspace packages)                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `scene`          | — (zod only)                                                                                                   |
| `platform`       | `scene`                                                                                                        |
| `render`         | — (three.js only)                                                                                              |
| `character`      | `scene` (math)                                                                                                 |
| `runtime`        | `scene`, `render`, `character`                                                                                 |
| `runtime-dev`    | `scene`, `render`, `character`, `runtime`, `rules`                                                             |
| `rules`          | `scene`, `character` (the pure modules)                                                                        |
| `view-vue`       | `scene`, `runtime`                                                                                             |
| `player`         | `scene`, `runtime`, `view-vue`                                                                                 |
| `editor-core`    | `scene`, `platform`                                                                                            |
| `bridge`         | —                                                                                                              |
| `assets`         | `scene`, `platform`                                                                                            |
| `cli`            | `scene`, `platform`, `assets`, `bridge`, `rules`; the entry `cli/check` also `runtime`, `runtime-dev` (SE7-04) |
| `apps/editor`    | every engine package except `workbench-host`; plugins through the project bundle                               |
| `workbench-host` | `scene`, `platform`, `assets`, `bridge`                                                                        |
| `apps/workbench` | `workbench-host/protocol`, `bridge`, `ui`, `tokens`, `i18n`                                                    |
| plugins          | every engine package                                                                                           |

Four rules stand over the table:

1. **No engine package imports a plugin.** A folder under `plugins/` or `samples/` is never a dependency of a folder
   under `packages/` or `apps/`. The editor gets the plugins of a project through the build (decision Q5), never by a
   static import of a plugin package. Until SE3-08, `apps/editor` imports the resus plugin directly; this is the one
   allowed exception, and the boundaries check lists it by name.
2. **No player code imports dev code.** `runtime`, `render`, `character`, `view-vue` and `player` never import
   `runtime-dev`, `editor-core`, `apps/editor`, the bridge or the host. The marker gate (`tools/lab-markers.ts`)
   checks the built player.
3. **The framework-free packages stay framework free.** `scene`, `platform`, `render`, `character`, `runtime`,
   `runtime-dev`, `editor-core` and `bridge` import no Vue.
4. **No engine package names a domain** (the domain word lint, SE1-02).

SE7-04: `scenity check` measures the rules with no browser, so it needs the dev document core. Only the entry
`@scenity/cli/check` (the folder `packages/cli/src/check`) imports `runtime` and `runtime-dev`. The command loads it on
demand, and the other entries of the CLI (the Vite plugin, the scene files) stay light. ESLint and the boundaries check
name this one edge.

### Where today's packages go

| Today                                                             | After                                                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/room3d`                                                 | `render`, `runtime`, `character`, `plugins/resus/room` (SE1-06, SE1-07)                      |
| `packages/room3d-labs`                                            | `runtime-dev`, `plugins/resus/dev` (SE1-09)                                                  |
| `packages/room3d-view`                                            | `view-vue`, `plugins/resus/view` (SE1-10)                                                    |
| `packages/labs-platform`                                          | `platform` (SE2-09, SE8-08)                                                                  |
| `packages/labs-access`                                            | gone (SE8-06): the page key is `@scenity/labs-platform/labKey`; OIDC is a host auth provider |
| `packages/monitor`                                                | the clock into `runtime`; the rest into `plugins/resus/monitor` (SE1-03)                     |
| `api-client`, `sdk-core`, `voice`, `vue`, `test-kit`, `contracts` | `plugins/resus/sdk/*` (SE1-04)                                                               |
| `apps/editor/src/lab`                                             | `apps/editor/src/core`, `editor-core`, `plugins/resus/editor` (SE1-11, SE5-01)               |
| `apps/editor/scripts`                                             | `cli`, the resus parts of the CLI into the plugin (SE11-02)                                  |
| `tools/room3d`                                                    | `assets` (`tools/assets` first), the resus asset tools (SE1-13)                              |

### Old names

The old import paths (`@scenity/room3d`, `@scenity/room3d/model`, `@scenity/room3d-labs`, `@scenity/room3d-view`)
keep re-exports for one phase (SE1-06 to SE1-13). SE1-14 removes them.

## Consequences

- `eslint.config.js` (`LABS_BOUNDARIES`, `FRAMEWORK_FREE`) and `tools/check-boundaries.ts` (`LABS_PARTS`) get a row
  for each new package. The empty packages exist from SE1-01, so the rules run before the code moves in.
- The size budgets and `tools/room3d/shape-exceptions.json` follow the files when they move.
- A plugin package can depend on every engine package. A cycle (an engine package that needs a plugin type) is a
  design defect: the type goes into the engine as a generic type.
