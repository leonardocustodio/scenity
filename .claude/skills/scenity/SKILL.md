---
name: scenity
description: Work on the Scenity repository - the generic 3D scene engine (packages/scene, runtime, render, character, runtime-dev, rules, assets, cli, player, editor-core, bridge, view-vue, labs-platform, ui, tokens, i18n), the editor (apps/editor - the scene page, the player pages and the lab page of a plugin), the workbench (apps/workbench, packages/workbench-host), the generic plugins and the samples, and the `scenity` command. Use before a change in packages/, apps/, plugins/ or tools/, and to look at, measure or check a scene.
---

# Scenity: the engine, the studio and the editor

| Part                                              | What it is                                                                                                                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/scene`                                  | The documents (`scenity.project/1`, scenes, sequences, prefabs, rules) with their zod schemas and the canonical writer                                                                                                                    |
| `packages/runtime`, `render`, `character`         | The runtime: the scene core and the worker client, the WebGPU and WebGL backends, the characters (rigs, clips, IK, walks)                                                                                                                 |
| `packages/runtime-dev`, `rules`                   | The dev tools of a core (panes, layers, metrics, onion, ghosts, tune) and the rules and metrics of `scenity check`                                                                                                                        |
| `packages/player`, `view-vue`                     | The player (`createPlayer`, `<scenity-player>`, the Vue component) and the generic scene view of Vue                                                                                                                                      |
| `packages/assets`, `cli`                          | The asset pipeline with its rights checks, and the `scenity` command                                                                                                                                                                      |
| `packages/editor-core`, `bridge`, `labs-platform` | The command kit of the editor, the bridge calls of the workbench, the frame key, the content hash and the index store                                                                                                                     |
| `packages/studio-host`, `agent-tools`             | Scenity Studio: the host (`scenity studio`: the Hub, the projects, the jobs, the agent sessions) and the tools of the agents                                                                                                              |
| `packages/workbench-host`, `apps/workbench`       | The workbench host and page, which retire; `studioTools.ts` gives the agent tools to the studio                                                                                                                                           |
| `apps/editor`                                     | The editor: the scene page (`scene.html`, `src/scene`), the player pages and the lab page (`src/core`). It names no plugin: it loads the editor faces of the plugins of its project. Published as `@scenity/editor` (the scene page only) |
| `packages/ui`, `tokens`, `i18n`                   | The design system with no domain parts                                                                                                                                                                                                    |
| `plugins/physics`, `plugins/traffic`              | Generic plugins (runtime faces)                                                                                                                                                                                                           |
| `samples/*`                                       | Sample projects with free art and rights records: `showroom`, `characters`, `gltf-samples`, `spin`, `physics`, `walkthrough`, `sim-road`                                                                                                  |

Each package has a README with its file map. The user docs are in `docs/` (`docs/README.md` is the map:
`quickstart.md`, `studio.md`, `architecture.md`, `formats.md`, `plugins.md`, `editor.md`, `cli.md`, `testing.md`);
read the page of a topic before a change there, and update it when a change makes it wrong.

This checkout holds only free art: `bun run check:restricted-art` fails on a rights record of a licence that is not
free (CC0 and CC BY are free).

## Projects and plugins

The project of the editor, the workbench host and the commands is `--project`, else `SCENITY_PROJECT` (an absolute
folder), else the work folder with `scenity.project.json`, else the `scenity.project` field of the nearest
package.json. This checkout has no default project.

A plugin is a package with faces in the `scenity` field of its package.json: `runtime` (components and systems for the
page and the workers, `virtual:scenity/plugins`), `editor` and `editorConfig` (the editor face of the lab page and its
Vite parts), `host` (the tools, runs, surfaces and gate of the workbench), `cli` (commands of `scenity`) and `dev`
(metric libraries of `scenity check`), plus `markers` (strings that a player build must not hold). A folder plugin of a
project needs no package.json: `runtime.ts` (or `src/runtime.ts`) is its runtime face (`docs/plugins.md`). The scene
page shows plugin components in the inspector from their schemas, with no editor face. The editor Vite config writes the generated plugin list and styles of the project:
`apps/editor/src/generated` for a project in the checkout, `<project>/.scenity/editor` for a project outside it. The
core of the lab page reads its plugin types from `virtual:scenity/editor-types` (`src/core/pluginTypes.ts` here; a
plugin outside the checkout points the name at its editor face in its tsconfig.json).

The lab page (`apps/editor` `index.html`) needs a plugin with an editor face; with none it says so. The scene page
needs no plugin: `scenity dev` in a project, or `bunx --bun vite --config vite.scene.config.ts` in `apps/editor`.

## The `scenity` command (any project)

`@scenity/cli` has the bin `scenity`; in the checkout `bun packages/cli/src/cli.ts <command>` is the same
(`packages/cli/README.md`). `scenity <command> --help` gives the arguments.

```sh
bun packages/cli/src/cli.ts create ../demo --install   # a new project (--template empty|showroom), linked to this checkout
scenity dev                                     # the scene page dev server; prints SCENITY_DEV_READY and the edit=1 URL
scenity check | build [--check] | verify        # the rules; the static build; check + build --check + shot --compare
scenity shot --camera front                     # one picture in the player of the build (baselines: baselines/<platform>/)
scenity sheet --sequence s.sequence.json --from 0 --to 2000 --step 250 --camera front   # one contact sheet
scenity clip --sequence s.sequence.json --from 0 --to 2000 --fps 12 --camera front     # a WebM video
scenity bench | assets <import|build|stills|release-check|export|index|…>
```

`shot`, `sheet`, `clip` and `bench` take the GPU lock of the lab tools and draw in headless Chromium through the
player of `<project>/dist` (`--build` makes it first). `scenity pool` (start, status, stop) keeps warm player pages.
A project outside the checkout depends on `link:@scenity/<name>` (`bun link` in the package folders, then `bun
install`; `create --install` runs both). With an installed CLI (no checkout) it depends on the published packages
`@scenity/cli`, `scene`, `runtime` and `editor`: `scenity dev` then runs the scene page of
`node_modules/@scenity/editor`, and the `showroom` template downloads its CC0 sources from Poly Haven (hash checked;
`bun tools/showroom-template.ts` keeps `packages/cli/templates/showroom` in step with `samples/showroom`). The release:
`bun run release:check`, `release:pack` (19 tarballs, an import check per module), `release:dry`; `.changeset/`.

To look at a scene: `scenity dev` (or `bunx --bun vite --config vite.scene.config.ts` in `apps/editor` for the
samples: `/scene.html?project=<sample>&edit=1`), then the script API `globalThis.__scenity` of the page (`document()`,
`select(ids)`, `command(id, args)`, `inspect()`, `stats()`, `save()`); with no browser, `scenity check` and
`scenity shot`. The URL parameters and the keys of the editor are in `docs/editor.md`.

## Renderer backends

The renderer draws with WebGPU on each device that passes the checks of `chooseBackend()`, else with WebGL;
`backend=webgl` or `backend=webgpu` in a URL forces one, and the frame statistics give `backend` and `backendReason`.
The Chromium of the tools uses the new headless mode on macOS (the Metal adapter); Linux runners have no adapter and
draw WebGL, so the WebGPU sets skip there.

## The studio

`bun run dev:studio` (or `scenity studio --project <dir>`) starts Scenity Studio on port 5170 (`docs/studio.md`). The
studio e2e specs are `apps/editor/tests/e2e/studio-*.spec.ts`.

## The workbench (retires)

The workbench page keeps working for a limited time (`docs/workbench.md`). `bun packages/workbench-host/src/main.ts --checkout <abs path>` (or `--project <abs path>`) prints
`WORKBENCH_READY {"origin":…,"token":…}`; `bun run dev:workbench`, then the page URL with `?host=<origin>#token=<token>`.
The host refuses a state folder inside the checkout (`--state <dir>` outside it). A project with no host plugin gets
the editor surface and the core tools; a host plugin adds its tools, runs, surfaces and stop gate (the host tests use
the lab fixture `packages/workbench-host/tests/fixtures/labProject`, `useLabFixture()`). The auth providers (`none`,
`token`, `oidc` from an embedder), the roles (`viewer`, `editor`, `admin`) and the remote mode are in the host README.

## Checks before a report or a commit

```sh
bun run typecheck              # the root program, the editor (with its plugin check) and the workbench
bun run lint
bun run format:check
bun run check:boundaries
bun run check:restricted-art   # only free art
bun run check:licences         # the licences of the dependencies
bun run check:shape            # 500 lines per file, 80 per function
bun run test                   # the Bun tests of each package (the host with its preload) and of tools/
bun run test:components        # Vitest: the editor, the workbench page, the ui package
```

The repository is a Turborepo workspace with Bun as the package manager: the root scripts call `turbo run`, which runs
the tasks of the packages in dependency order and takes unchanged results from its cache (`.turbo/cache`). One
package: `bunx turbo run test --filter=@scenity/scene`; no cache: `--force`. `docs/testing.md` has the details.

The GPU suites (the gallery `bun run test:gallery` in `apps/editor`, the Playwright e2e specs, `scenity shot`,
`sheet` and `bench`) need a quiet machine; run them one at a time. The gallery of the samples: `cd apps/editor && bun
run test:gallery` (update the macOS baselines with `--update-snapshots`; a frame change needs the owner's approval).

## Rules

- No engine package names the domain of a plugin, and no engine package imports a plugin
  or a sample (ESLint and `bun run check:boundaries`). The runtime packages never import the dev tools.
- A frame is a function of its inputs and its time: no `Math.random`, `Date.now` or wall-clock time in a pose model,
  a system or a simulation (`bun run check:determinism`).
- Text that the editor shows comes from Fluent (`t()` or `$t()` of `apps/editor/src/texts.ts` over
  `apps/editor/src/i18n/en-US/<part>.ftl`; `bun tools/editor-texts.ts` finds text outside Fluent).
- Each new source file starts with the licence header `SPDX-License-Identifier: Apache-2.0` (no copyright line:
  `NOTICE` names the holder). Code comments use ASD-STE100 Simplified Technical English.
- **Names.** The environment variables start with `SCENITY_`. The browser storage keys start with `scenity.`. The themes are `navy`, `light` and `dark`; the
  token variables start with `--sc-` and the CSS classes of `ui` with `.sc-`.
- Never stop processes that another run started; check the working folder of a dev server before you use it.
