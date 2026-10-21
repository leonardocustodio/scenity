# Architecture

Scenity is a 3D scene engine for the web. A scene is a JSON document. The runtime draws it with three.js (WebGPU or
WebGL), in a worker when it can. Plugins add components, systems and simulations. The editor edits the documents, the
player plays them, and the `scenity` command checks and builds them. Scenity Studio puts the projects, the editor
windows, the jobs and the agents behind one host.

This page names the parts and how they fit.

## The packages and their layers

```text
                     apps/workbench (page) ── @scenity/bridge ── apps/editor (scene page, play window, lab page)
                            │                                       │
                   packages/workbench-host (Bun)                    ├── @scenity/editor-core   commands, history, selection
                            │                                       ├── @scenity/view-vue      SceneView.vue
                            │                                       └── @scenity/runtime-dev   inspect, debug layers, pick, metrics
                            │                                                 │
 @scenity/cli ──────────────┤                                     @scenity/runtime   worker, protocol, document core,
  (create, dev, build,      │                                                        scene builder, systems, plugin host
   check, shot …)           │                                        ├── @scenity/render     WebGPU and WebGL, loaders, materials
                            │                                        └── @scenity/character  rigs, clips, animator, IK, walks
                            │
 @scenity/assets ───────────┴──────────── @scenity/scene   documents, schemas, ops, layers, prefabs, evaluate()
 @scenity/rules  (metrics, rules, gate)   @scenity/labs-platform  frame key, content hash, frame index
 @scenity/player (runtime + documents, no editor code)
 @scenity/ui, @scenity/tokens, @scenity/i18n   the design system
```

| Package                   | What it holds                                                                              | Kind            |
| ------------------------- | ------------------------------------------------------------------------------------------ | --------------- |
| `@scenity/scene`          | The documents: zod schemas, JSON Schemas, reader, canonical writer, ops, layers, evaluator | Pure TypeScript |
| `@scenity/render`         | The WebGPU and WebGL backends, the glTF loader, KTX2, Draco, materials, post effects       | three.js        |
| `@scenity/character`      | Rig profiles, retarget, the animator, IK, foot lock, navigation and walks                  | three.js        |
| `@scenity/runtime`        | The worker and its client, protocol 2, the document core, the scene builder, systems       | three.js        |
| `@scenity/runtime-dev`    | The dev document core: inspect, debug layers, pick, layout tools, the rule check           | three.js        |
| `@scenity/rules`          | The metric library, rules, the save gate, the layout search                                | Pure TypeScript |
| `@scenity/view-vue`       | `SceneView.vue`: the renderer life cycle, the fallback ladder, the poster                  | Vue             |
| `@scenity/player`         | `createPlayer`, `<scenity-player>`, the Vue player; no editor and no dev code              | Browser         |
| `@scenity/editor-core`    | Commands, the one undo history, selection, clipboard, inspector model, sequencer model     | Pure TypeScript |
| `@scenity/bridge`         | The postMessage contract between the workbench and the editor page                         | Pure TypeScript |
| `@scenity/assets`         | The asset database, importers, the build, stills, rights and approvals, glTF export        | Bun, Blender    |
| `@scenity/labs-platform`  | The frame key, the content hash, the frame index, warm browser pages, the WebM muxer       | Pure TypeScript |
| `@scenity/cli`            | The `scenity` command and the Vite plugin of the project plugins                           | Bun             |
| `@scenity/ui`, `tokens`   | Vue components and the themes `navy`, `light`, `dark`                                      | Vue, CSS        |
| `@scenity/i18n`           | The Fluent runtime                                                                         | Pure TypeScript |
| `@scenity/editor`         | `apps/editor`: the scene page with the editor, the play window, the lab page of a plugin   | Vue app         |
| `apps/workbench`          | The workbench page                                                                         | Vue app         |
| `packages/workbench-host` | The Bun host of the workbench: servers, terminals, Git, runs, the MCP tools                | Bun             |

`plugins/` holds two generic plugins (`physics`, `traffic`). `samples/` holds seven projects with free art.

The layer rules say what can import what. Three rules matter most:

1. **No engine package imports a plugin or a sample.** The build gives a project its plugins.
2. **No player code imports dev code.** The runtime, render, character, view-vue and player packages never import
   runtime-dev, editor-core, the editor, the bridge or the host. The marker gate of `scenity build` checks the output.
3. **No engine package names a domain.** `bun run check:domain-words` counts domain words in `apps/`, `packages/` and
   `tools/`; the count is 0.

`bun run check:boundaries` and ESLint check the rules. Each package README has its file map: "to change X, edit Y".

## The documents

All project data is JSON with a `format` field such as `scenity.scene/1`. A zod schema in `@scenity/scene` gives the
types, the checks and a JSON Schema file. The canonical writer sorts the keys, rounds numbers to a 1e-6 grid and uses
two spaces, so a change gives a small diff and read then write gives the same bytes. Units are metres, Y is up, the
axes are right-handed (as glTF), angles are radians (except `camera.fov` in degrees), and rotations are quaternions
`[x, y, z, w]`.

A scene is a map of entities by ID. Each entity has a parent, an index under its parent, a name, tags and
components. A JSON Pointer names each value (`/entities/lamp/components/light/intensity`), so an edit, an override and
a diff all name one value. [formats.md](formats.md) describes each document kind.

Every edit is an op (`set`, `add`, `remove`, `move`, `addComponent`, `removeComponent`). `applyOps` gives the new
document and the inverse ops, so each edit can be undone.

## The runtime

```text
documents (project, scene, prefabs) + override layers ─┐
sequence + time t ─────────────────────────────────────┼─► evaluate() ─► frame state ─► systems ─► presenters ─► renderer
plugin input (live or recorded) ───────────────────────┘    pure            pure per step,   three.js     worker or
                                                                            memory saved     objects      main thread
```

1. **`evaluate()`** (`@scenity/scene`) is pure. It applies the override layers, samples the tracks of the sequence at
   the time `t` and reduces the action keys through the simulation plugins. Checkpoints make a seek fast.
2. **Systems** run in fixed steps (60 per second, at whole milliseconds). They read the frame state and write
   transforms, visibility and values. A system can keep memory, but it must save and restore it, so a seek gives the
   same frame as a play.
3. **Presenters** turn components into three.js objects, one presenter per component type. The scene builder keeps
   the object graph and applies each op with no full rebuild.
4. **The renderer** is WebGPU where `chooseBackend()` allows it, else WebGL. A failure steps down: WebGPU to WebGL, the
   worker to the main thread. `backend=webgl` forces the kill switch.

Time is an integer count of milliseconds of simulation time. Nothing in `evaluate()`, a system or a simulation reads
the wall clock or `Math.random` (`bun run check:determinism` checks it). So a frame is a pure function of its documents,
overrides, sequence, time and plugin input, and the frame key names one picture.

### The worker and the main thread

The page sends the documents and the asset manifest once (the `load` message of protocol 2), then one `patch` with
the ops of each edit. The worker never gets the full scene again for a small edit. Each answer comes after the frame
that shows the change. `worker=0` on the scene page draws on the main thread, and the gallery checks that both paths
give the same pixels.

The document core (`@scenity/runtime/documentCore`) is the core of a document scene. The generic scene worker
(`sceneWorker`) runs it with WebGL; the main thread runs it with WebGL or WebGPU. The dev document core of
`@scenity/runtime-dev` adds the inspect report, the debug layers, the pick and the rule check, and only the editor
loads it.

### Assets

Each source file has an asset record beside it (`<file>.meta.json`) with a stable ID. A scene names an asset as
`asset:<id>`, never by path. `scenity assets build` turns the sources into built files (levels of detail, KTX2
textures, meshopt) and writes manifest 2, which maps each ID to its files, sizes and SHA-256. The runtime loads the
built files through the manifest and checks size and hash before a parse. With no build, the dev server serves the
sources. A rights record and the release gate check the licence of each asset.

## Plugins and their faces

A plugin is a package (or a folder of the project) that the project lists in its `plugins` field. It has up to seven
faces, each found by a field of its `package.json` (`scenity.<face>`) or by a file name:

| Face          | API                                                                        | Runs in                     |
| ------------- | -------------------------------------------------------------------------- | --------------------------- |
| Runtime       | `defineRuntimePlugin`: components, presenters, systems, simulation, input  | the worker, the main thread |
| Dev           | `defineDevPlugin`: debug layers and the metric library of the rules        | the editor, `scenity check` |
| Editor        | `EditorPlugin`: tabs, commands, tools and the bridge calls of the lab page | the editor page             |
| Editor config | the Vite parts of the editor: plugins, aliases, proxy, styles              | the editor dev server       |
| Host          | `defineHostPlugin`: MCP tools, runs, surfaces, the stop gate               | the workbench host (Bun)    |
| CLI           | `CliFace`: commands of `scenity`                                           | the `scenity` process (Bun) |
| Markers       | the strings and modules that must never be in a player build               | `scenity build`             |

The build bundles the runtime faces with the Vite plugin `scenityPlugins({ project })` (`@scenity/cli/vite`), which
gives the virtual module `virtual:scenity/plugins`. Each plugin is a chunk of its own. No code loads from a URL at run
time. [plugins.md](plugins.md) is the guide.

## The player

`@scenity/player` plays a project with no editor and no dev code: `createPlayer(canvas, options)`, the web component
`<scenity-player>` and a Vue component. It reads the project, the scene, the sequence and the asset manifest, picks the
backend and the worker, steps the quality tier down and up from the frame times, and shows a poster until the first
frame. The embedding API gives `setInput`, `send`, `setSource`, `watchPoints` and the events `pick`, `points`, `time`,
`ready` and `fallback`. `scenity build` writes a static site with one `<scenity-player>`.

## The editor

`apps/editor` (`@scenity/editor`) is a Vite app. Its scene page (`scene.html`) draws a scene with the dev document
core. With `edit=1` it is the editor: the start screen, the hierarchy, the inspector, gizmos, the viewport camera, the
asset browser, materials, prefabs, layout tools, the rules panel, the sequencer, play mode, settings and keys. Each
action is a command of `@scenity/editor-core` with one step in the one undo history. Every text comes from Fluent
files. [editor.md](editor.md) is the manual.

`scenity dev` starts the dev server of the scene page for one project. The dev server also saves files (atomic,
canonical, gated by the rules), imports assets and hot reloads changed sources.

The lab page (`index.html`) is a second editor for a plugin with an editor face. It has panes, takes, a content
browser and lab tools.

## The studio and its host

Scenity Studio ([studio.md](studio.md)) is one host (`packages/studio-host`, Bun)
on one origin: the Hub page, one scene server behind a proxy for every open project, the jobs, the user state and the
agent sessions. The editor windows connect to the host over the socket `/bridge`; the open documents and their
histories are in the host, so two windows and an agent edit one scene. The agents get tools such as `scene_query`,
`scene_command`, `scene_frame` and `scene_check` (`@scenity/agent-tools`); in the Review mode each edit is a change set
until the person accepts it.

The workbench page (`apps/workbench`) and its host (`packages/workbench-host`) came first. The page retires: its parts
are in the studio ([workbench.md](workbench.md)). The tools server of the workbench host for the studio
(`studioTools.ts`) stays for the agent tools.

## The build and the checks

- `scenity check` measures the rules of a project with no browser, through the same code as the editor.
- `scenity build` writes a static site, checks the size budgets of each entry and runs the marker gate.
- `scenity shot`, `sheet`, `clip` and `bench` draw through the player of the build in headless Chromium.
- `scenity verify` runs check, `build --check` and the shot baselines of a project.

[cli.md](cli.md) lists every command.

## Domain plugins

A domain plugin, with its project and its bought art, lives in its own repository and links the packages of a Scenity
checkout. Scenity holds only the engine, free samples and free art: `bun run check:restricted-art` fails if a
restricted file comes back.
