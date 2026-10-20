# @scenity/cli

The `scenity` command. It runs on Bun. [docs/cli.md](../../docs/cli.md) is the manual of the commands, and
[docs/architecture.md](../../docs/architecture.md) gives the layers of the packages.

## The `scenity` bin

The `bin` field gives `scenity` (`src/cli.ts`, `#!/usr/bin/env bun`). In the checkout,
`bun packages/cli/src/cli.ts <command>` is the same. `scenity --help` lists the commands (`src/commands.ts`); each
command loads its module on demand and has `--help`. The exit codes: 0, 1 for a failure, 2 for a usage error.

| Command  | What it does                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `create` | `create <name> [--template empty\|showroom] [--version <range>] [--install] [--json]`: a new project folder       |
| `dev`    | `dev [--project <dir>] [--scene <path>] [--port <n>] [--view]`: the scene page dev server, the editor page URL    |
| `build`  | the static build (below)                                                                                          |
| `check`  | the rules with no browser (below)                                                                                 |
| `shot`   | one picture in the player (below)                                                                                 |
| `sheet`  | a contact sheet of times and cameras in the player                                                                |
| `clip`   | a WebM video of a time range of a sequence in the player                                                          |
| `bench`  | the frame numbers against the budgets (below)                                                                     |
| `verify` | `check`, `build --check` and `shot --compare` for each baseline of the project                                    |
| `pool`   | `pool [start\|status\|stop] [--pages <n>] [--lock <file>]`: the scene pool of warm player pages                   |
| `assets` | the asset CLI of `@scenity/assets`: import, build, stills, release-check, export, index, missing, used-by, new-id |

The project of a command is `--project` (or the plain project word of the older commands), else the work folder when
it has `scenity.project.json`, else the `scenity.project` field of the nearest package.json (`src/workspace.ts`).

### `scenity create`

`create <name>` makes the folder `<name>` (it must not exist or be empty); the project ID is the last part of the
name (`src/create/`). The `empty` template has `scenity.project.json` (one scene, the `assets` folder, CC0 as the
allowed licence and one rule, `boxNearCentre`), `scenes/main.scene.json` (a floor, a box, a key light, a fill light
and the camera `front`), `assets/` and `rights/`. The `showroom` template (`src/create/showroom.ts`) has
the documents of `samples/showroom` from `templates/showroom` of this package (the project with the new ID, the
scenes, the asset records, the Poly Haven rights record, the stills and the poster; 0.3 MB) and the CC0 source files
of its models and its HDRI: a copy from the sample of the checkout, else a download from Poly Haven (the URLs, sizes
and SHA-256 hashes are in `templates/showroom/sources.json`; other bytes stop the create). The template has no asset
build: `scenity build` writes `build/` again (the same bytes as the sample). `bun tools/showroom-template.ts` writes
the template from the sample; `--check` (a test and a step of the release workflow) fails when it is not current.
Both templates get a `.gitignore` (`node_modules/`, `dist/`, `test-results/`, `.scenity/`) and a `package.json` with
the scripts `dev`, `build`, `check`, `verify`, `scenity.project: "."` and the packages `@scenity/cli`,
`@scenity/scene`, `@scenity/runtime` and `@scenity/editor`.

An installed command (no checkout) writes the range of its own version (`^<version>`), so `bun install` or
`npm install` gets the published packages. In a checkout a `file:` dependency on a workspace package does not install
(its package.json has `workspace:` and `catalog:` versions), so the project depends on `link:@scenity/<name>`:
`bun link` in `packages/cli`, `packages/scene`, `packages/runtime` and `apps/editor` records each package in the link
folder of Bun (once per machine; `BUN_INSTALL_GLOBAL_DIR` names another folder), and `bun install` in the project makes
`node_modules/@scenity/<name>` and `node_modules/.bin/scenity` links into the checkout. Bun resolves a linked module
from its real path, so the imports of the CLI come from the checkout. `--install` runs these steps; `--version
<range>` writes a published version in place of the links.

### `scenity dev`

`dev` starts the dev server of the scene page with the Vite API and the Vite of the editor folder: the config is
`vite.scene.config.ts` of `apps/editor` when the CLI runs from a checkout (the Bun workspace above the real path of
the CLI; `SCENITY_CHECKOUT` names another one), else of the package `@scenity/editor` of the project (the
editor serves only the projects of its environment, and it leaves the Scenity packages out of the dependency step of
Vite). The project goes to the server in `SCENITY_SCENE_PROJECTS`, so a folder outside the checkout works: the asset
hot reload, the save of the edit mode, the scene list and the asset browser. The dependency cache of the
server is `<project>/.scenity/vite`, so it does not disturb another scene page server. The first stdout line is
`SCENITY_DEV_READY {"url":…,"start":…,"origin":…,"project":…}`. `url` is
`/scene.html?project=<id>&scene=<path>&edit=1` (the scene of `--scene`, else the first scene of the project; `--view`:
no `edit`); `start` is the editor page with no scene, the start screen of the project. The server runs until
SIGINT or SIGTERM.

### `scenity sheet` and `scenity clip`

Both use the page code of `scenity shot` (`src/page/`: the build folder, the player page server, headless Chromium,
the GPU lock of the labs tools and the screenshots that stay the same):

- `sheet [project] [--camera a,b] [--times a,b | --from <ms> --to <ms> [--step <ms>]] [--cell 400] [--max-width 1600]
[--format png|jpeg] [--out <file>]` takes a picture per time and camera (one page per camera, a seek per time) and
  puts them in the layout of the lab sheet and of `scene_sheet` (a row per time, a column per camera; one camera: at
  most four times per row; at most 64 cells) with the sheet raster of `@scenity/labs-platform/rasterBun`. Times need
  a sequence. Default file: `<build>/sheets/<name>.png`.
- `clip [project] --from <ms> --to <ms> [--sequence <path>] [--camera <name>] [--fps 12] [--size 640x400]
[--key-every <n>] [--out <file.webm>]` seeks the player to each frame time, takes the screenshot, encodes it with
  WebCodecs in the page (VP9, else VP8; `src/clip/encode.ts`) and writes the WebM file with the muxer of the lab clip
  (`@scenity/labs-platform/webm`). A clip does not depend on the speed of the
  machine. Default file: `<build>/clips/<name>--<camera>@<from>-<to>.webm`.

### `scenity pool`: the scene pool

`scenity pool [start] [--pages 2] [--lock <file>]` runs one headless Chromium with warm player pages in this process
until Ctrl+C or `scenity pool stop` (`scenity pool status [--json]` shows the pages and the leases). The first stdout
line is `SCENITY_POOL_READY {"origin":…,"pages":…,"dir":…}`. `shot`, `sheet` and `clip` take their pages from the
pool while it runs (`src/page/tabs.ts`), so a command starts no browser, and a page with the same spec loads no
second time; `--local` or `SCENITY_SCENE_POOL=0` gives them their own browser. A picture is the same both ways (a
test compares the bytes). `scenity bench` keeps its own page: the first frame time, the asset bytes and the memory
need a new page.

- The parts: the slots, the queue of the leases, the shared GPU lock and the frozen free pages are the warm pages of
  the lab pool in `@scenity/labs-platform/warmPages` (the lab `PagePool` of `apps/editor/scripts/lab/pool`
  uses them too); the picture form is `@scenity/labs-platform/poolWire`; `pool.json` and the token are
  `src/pool/files.ts` (`@scenity/cli/poolFiles`, also for the lab pool). The player target (`src/pool/target.ts`): a
  spec is a build folder, its project, the player options and the page size; a content stamp of the build files and
  of the project, scene and sequence documents is its version, so an edit loads the page again.
- The API on 127.0.0.1 (`src/pool/server.ts`; the token in `authorization: Bearer`): `health`, `status`, `lease`,
  `lease/<id>/seek|shot|drawn|evaluate`, `DELETE lease/<id>`, `stop`. A lease that ran `evaluate` (the encoder of a
  clip) leaves its page cold, and the pool loads it again. A lease with no call for two minutes ends.
- The pool folder is `SCENITY_SCENE_POOL_DIR`, else `scenity-scene-pool` in the temp folder of the user; a second pool
  of the folder does not start. The pool takes the GPU lock of the labs tools while a lease runs.

### `scenity verify` and `scenity assets`

- `verify [project] [--no-shots] [--lock <file>]` runs `check`, `build --check --out <project>/dist` and, for each
  `baselines/<platform>/<scene>--<camera>.png` of the project (`<camera>` `scene` is the camera of the scene),
  `shot --compare` with the tolerance of the gallery. It runs every step and prints a line per step. Make a baseline
  with `scenity shot --scene scenes/main.scene.json --camera front --out 'baselines/{platform}/main--{camera}.png'`.
  It runs no typecheck: a project has no code of its own to check.
- `assets <sub> [projectDir] [arguments]` runs the asset CLI (`@scenity/assets/cli`); with one plain word less than the
  subcommand needs, it puts the project of the command first (`scenity assets build --check` in a project folder).

### Plugin commands

A plugin gives commands in its CLI face: the `scenity.cli` field of its package.json names a module whose default
export is a `CliFace` (`import type { CliFace } from "@scenity/cli"`): `{ commands: [{ name, summary, help?,
run(argv, { project }) }] }`; `run` gives the exit code (`src/plugins/commands.ts`). `scenity <name>` for a name that
is not a command of the CLI runs the command of the first plugin of the project that has it (`--project` goes into the
context, not into `argv`), and `scenity --help` lists the plugin commands. The face runs in the CLI process: a face
that needs more starts its own process. The editor face of the room plugin of CodeBlue gives `scenity labs` (its
`scripts/cliFace.ts`): the lab CLI of that plugin.

## The Vite plugin of the project plugins

`@scenity/cli/vite` gives `scenityPlugins({ project })`. The build bundles the plugins of the
project, so no code loads from a URL at run time.

```ts
// vite.config.ts
import { scenityPlugins } from "@scenity/cli/vite";
export default { plugins: [scenityPlugins({ project: "samples/showroom" })], worker: { format: "es" } };

// the render worker or the main-thread core
import { loadPlugins } from "virtual:scenity/plugins";
const host = new PluginHost(await loadPlugins());
```

- The plugin reads the `plugins` field of `scenity.project.json` with `loadProject` of `@scenity/scene`. An entry is
  a path relative to the project folder (a folder or a file) or a package name of any npm scope (for example
  `@acme/demo-runtime`). The runtime face of a folder or a package is the `scenity.runtime` field of its
  `package.json`, else the first of `runtime.ts`, `src/runtime.ts`, `runtime.js` and `src/runtime.js`. A plugin with
  no runtime face is not in the bundle.
- `virtual:scenity/plugins` exports `pluginKeys` and `loadPlugins()`. It imports each plugin with a dynamic import
  of `virtual:scenity/plugins/<key>` (the folder name, or the package name without its scope), so each plugin is a
  chunk of its own. An empty project gives `[]` and no plugin code.
- In dev, a change of a file in a plugin folder, or of the project document, reloads the page. The render worker
  starts again with the page.
- `vite` is a peer dependency.

## The editor faces of the project plugins

`@scenity/cli/editor` lets the editor app (`apps/editor`) load the plugins of a project with no plugin name in the app:

- The resolver (`@scenity/cli/plugins`) finds two more faces of a plugin: the editor face (the `scenity.editor` field
  of its `package.json`, else `editor.ts` or `src/editor.ts`: the default export is the `EditorPlugin` of the page) and
  the editor config face (`scenity.editorConfig`, else `editorConfig.ts` or `src/editorConfig.ts`: the Vite parts).
  `defaultProjectDir(from)` gives the project of the `scenity.project` field of the nearest `package.json`.
- `loadEditorProject(project, { env, root })` loads the editor config faces and merges them in the order of the project
  document (`EditorConfigFace`: `plugins`, `workerPlugins`, `alias`, `proxy`, `fsAllow`, `styles`, `content`,
  `stills`, `defaultTake`). `defaultTake` is the take of the lab tools (the warm pages of the render pool, a
  job with no take); without it, the name of the first sequence of the project document, else none.
- `writeEditorFiles(project, outDir)` writes `editorPlugins.ts` (an import of each editor face, the list
  `editorPlugins`, and the types of the first face) and `editorStyles.css` (an `@import` of each style file, so
  Tailwind compiles the plugin styles with the styles of the app). A file changes only when the project changes; the
  editor keeps them in `apps/editor/src/generated/`, so `vue-tsc` reads them with no Vite.

## The scene files of a project

`@scenity/cli/sceneFile` reads and saves the `*.scene.json` files of a project for the studio host and the workbench host (`scene.read`,
`scene.save`) and for the dev server of the scene page (a POST to the URL of the file, `apps/editor/scripts/sceneSave.ts`):

- a save checks the path (in the project folder, no link out of it, a `*.scene.json` name, the denylist of the caller),
  reads the document with the reader of `@scenity/scene` and writes its canonical form;
- the write is atomic: a temp file in the same folder, then a rename;
- a save with another base hash than the file on the disk is a conflict (`force` writes the file in all cases).

The contract (`SceneSaveParams`, `SceneSaveResult`, `SCENE_SAVE`) is in `@scenity/bridge`; `@scenity/cli/sceneFileContract`
gives the same names.

## `scenity check`

`bun packages/cli/src/cli.ts check [project] [--scene <path>] [--sequence <path>] [--tier <tier>] [--json]` runs each
rule of a project with no browser: the scene rules and the project rules at the scene time, and the rules of each
sequence at the times of their scopes, through `evaluateRules` in the rule check of the dev document core (as the scene
page). It prints a table per scene (rule, scope, time, value, limit, result) or the JSON report. `bun run check:samples`
runs it for the samples, and CI runs that script.

- The assets: a project with `build.assets` loads its build (`<output>/manifest.json`, the LOD of the tier). No
  manifest stops the check; a used asset with no record or a file that is not the file of the manifest is stale (the
  error names the build command). A project with no build loads the sources of the asset database (the dev fallback).
- `assetRights` reads the release check of `@scenity/assets/release`.
- The exit code is 1 for a failed `block` rule. A line of `<scene>.rules-log.jsonl` (the override log)
  accepts the failure when it names the rule and its hash is the SHA-256 of the current scene file.
- A project with no rule passes with "no rules" and loads nothing.
- `@scenity/cli/check` also gives `saveMeasured`: the writer gate measures by itself when a save carries no results for
  its text (the workbench host uses it for `scene.save`). Only this entry depends on `@scenity/runtime` and
  `@scenity/runtime-dev`.

## Tests

`bun test ./packages/cli` from the repo root (the `test` script of the package does the same, because the marker gate
of `scenity build` reads module paths that depend on the work folder). The tests make temp projects, check the plugin list and the code of
the virtual modules, run a real `vite build` (an empty project bundles no plugin code; a project with one plugin
bundles it in a second chunk) and check the full reload with a fake dev server.

## `scenity build`

`bun packages/cli/src/cli.ts build [project] [--out <dir>] [--check] [--json]` writes a static build of a project
(default `<project>/dist`) that a plain server can serve, and runs its release checks. `bun run build:samples` builds
the samples `showroom`, `characters`, `spin`, `physics`, `walkthrough` and `sim-road`, and CI runs that script.

- `index.html`: one `<scenity-player>` of the project. `player/`: the entries of `@scenity/player` (`index.js`,
  `element.js`), the generic scene worker and `plugins.js` (`virtual:scenity/plugins`: one chunk per runtime plugin).
- `project/`: the project, its scenes, sequences and rules files in canonical form; a path out of the project folder
  goes to `project/external/`. `project/build/`: the asset build with its manifest (version 2). A project with
  `build.assets` writes its build into its output folder (`--check`: the written files must be current); a project with
  no `build.assets` gets the default build in the output only.
- The size budgets: `build.budgets` of the project gives a gzip limit in KB (`gzipKB`) for the entries `player`,
  `element`, `worker`, `plugins` and `lazy` (`src/build/sizes.ts`; `tools/size-budget.ts` uses the same module for
  the entry budgets of a plugin build). An entry with no budget is in the report with no limit.
- The marker gate (`src/build/markers.ts`): no lab or dev marker in the scripts (the lab messages and globals, the
  messages of the dev scene worker) and no dev module in the source maps (the dev packages of the engine, the apps
  and the installed editor `node_modules/@scenity/editor/`, plugin code that the project does not list). A plugin adds markers in its markers face: the `scenity.markers` field
  of its `package.json`, else `markers.ts` or `src/markers.ts` (`src/build/plugins.ts`). The build removes the
  source maps after the gate.
- `build-report.json`: the entries with their files, gzip sizes and limits, the gate, the asset step, the documents
  and each file of the build. The exit code is 1 for a failed check and 2 for a usage error.

## `scenity bench`

`bun packages/cli/src/cli.ts bench [project] [--scene <path>] [--sequence <path>] [--backend webgl|webgpu|both]
[--tier <tier>] [--quick] [--json] [--check] [--out <dir>] [--dist <dir>] [--build] [--lock <file>] [--max-load <n>]`
measures a scene or a sequence of a project in the player, in headless Chromium (the new headless mode on macOS, so
WebGPU draws there). `bun run bench:samples` (`tools/bench-samples.ts`) runs it on the showroom (main and crowd at the
medium tier) and on the characters sample (walk-wave), and writes the reports and `summary.md` into
`test-results/bench-samples`; CI runs it with `--quick` after `build:samples`.

- The build: the `scenity build` folder of the project (default `<project>/dist`; `--build` or a folder with no player
  makes it first, with `--check`). The scene and sequence documents come from the project folder in canonical form, so
  a scene that the project does not list plays too. `--scene` alone plays no sequence; `--sequence` alone plays on the
  project scene with the ID of the sequence.
- The run: the GPU lock of the labs tools (`src/page/lock.ts`; `--lock` names another file), one
  run per backend, the first frame time (the `ready` event), then a warm-up and a measure window (`--quick`: 1 s and
  5 s; else 3 s and 15 s). The core draws a frame only on a change, so the bench drives the frames: a `seek` per frame
  with a sequence, a call of the camera with no sequence. The numbers: frame work p50 and p95, frame interval, GPU p95
  (n/a: the player asks for no GPU timer), draw calls, triangles, instances, the asset bytes that the page loaded, the
  memory and the load of the machine (`uptime`) before and after each run. The work statistics are the last 600
  frames of the core: in a short run they also hold the warm-up (`windowFrames`, `statsFrames`).
- The budgets: `quality.budgets.scene.<tier>` of the project, and the group `scene.<backend>` replaces values for one
  backend. The counts (`drawCalls`, `triangles`, `bytes`) are always judged. The times (`workP95Ms`, `gpuP95Ms`,
  `firstFrameMs`) are judged only on a GPU renderer at a load under the limit (default 4): else they are "not judged".
- The report: `bench.json` and `bench.md` in the report folder (default `<build>/bench/<name>-<tier>`); the command
  prints the Markdown table, or the JSON with `--json`. The exit code: 0, 1 for a failed run (with `--check`: or a
  value over its budget), 2 for a usage error, and 3 with `--check` when a time is not judged (the output says why).
- The rule of CI: the runners draw WebGL on the CPU (SwiftShader), so CI publishes the numbers (the artifact
  `bench-samples` and the job summary) and judges no budget.

## `scenity shot`

`bun packages/cli/src/cli.ts shot [--project <dir>] [--scene <path>] [--sequence <path>] [--camera <a,b>] [--at <ms>]
[--size 1280x800] [--backend webgl|webgpu] [--tier <tier>] [--worker 0|1] [--out <file.png>] [--compare <baseline.png>]
[--dist <dir>] [--build] [--lock <file>] [--json]` writes one PNG of a scene (or of a sequence at `--at`) per camera.

- The page code is the code of `scenity bench` (`src/page/`): the build folder, the player page server, headless
  Chromium and the GPU lock of the labs tools. The page has a stopped clock (`start` is `--at`), no adaptive ladder
  and no poster.
- The defaults follow the gallery of the editor (`apps/editor/tests/gallery/showroom.spec.ts`, `player.spec.ts`): a
  viewport of 1280 × 800 at the device scale 1, the tier "high", WebGL in the render worker, a wait for the first frame
  with every asset (`data-state="ready"`), then screenshots of the player until two in sequence are equal. A player
  that draws with another backend or path fails.
- `--compare` uses the rule of `toHaveScreenshot` of the gallery (`src/shot/compare.ts`): the pixelmatch count of
  Playwright with the threshold 0.2, at most 0.2 % of the pixels. `{camera}` and `{platform}` in `--out` and
  `--compare` are the camera name and the platform (darwin, linux). The exit code: 0, 1 for a failure or a picture out
  of the tolerance, 2 for a usage error.
- `bun run check:shots` builds the showroom, the walkthrough and the sim-road samples. It compares their pictures with
  the baselines of the platform (`__screenshots__/scene-{darwin,linux}`); CI runs it in the `assets` job. The test of `tests/shot.test.ts` that
  draws runs only with `SCENITY_GPU_TESTS=1` and a Chromium of Playwright.
