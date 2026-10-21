# scenity

Scenity is a 3D scene editor and engine: the documents, the runtime with the WebGPU and WebGL renderers, Scenity
Studio (the Hub, the editor windows and the agents), the asset pipeline, the player and the `scenity` command. The
repository is a Bun workspace, and the package scope is `@scenity/`. A domain plugin and its art stay in the repository
of that plugin, which links the packages of this checkout (`bun link`).

## What this repository holds

| Path                                                                                                                              | What it is                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/scene`                                                                                                                  | The documents of Scenity (`@scenity/scene`): schemas, the canonical writer, ops, overrides, prefabs                                                                         |
| `packages/runtime`, `render`, `character`, `runtime-dev`, `view-vue`, `player`, `editor-core`, `bridge`, `assets`, `rules`, `cli` | The engine packages and their layers                                                                                                                                        |
| `packages/labs-platform`                                                                                                          | The platform capabilities of the labs: the frame key, the content hash and the index store                                                                                  |
| `packages/studio-host`                                                                                                            | The host of Scenity Studio (`scenity studio`): the Hub, the projects, the jobs, the agent sessions and the doctor                                                           |
| `packages/agent-tools`                                                                                                            | The tools of the agents of the studio: the scene queries, the commands, the frames and the checks                                                                           |
| `packages/workbench-host`                                                                                                         | The Bun host of the workbench page (retires; its `studioTools.ts` gives the agent tools to the studio)                                                                      |
| `packages/i18n`, `tokens`, `ui`                                                                                                   | The design system with no domain parts: the Fluent runtime, the neutral themes `navy`, `light` and `dark`, the primitives and components                                    |
| `apps/editor`                                                                                                                     | The editor (`@scenity/editor`): the scene page, the player pages and the lab page (`src/core`). It names no plugin: it loads the editor faces of the plugins of its project |
| `apps/workbench`                                                                                                                  | The workbench page, which retires: use Scenity Studio                                                                                                                       |
| `plugins/*`                                                                                                                       | Generic plugins (`physics`, `traffic`)                                                                                                                                      |
| `samples/*`                                                                                                                       | Sample projects with free art (CC0 or CC BY, each with its rights records): `showroom`, `characters`, `gltf-samples`, `spin`, `physics`, `walkthrough`, `sim-road`          |
| `tools/*.ts`                                                                                                                      | The size budgets, the lab markers, the module report, the package boundaries, the domain words and the art check                                                            |
| `.claude/skills/scenity`                                                                                                          | The Scenity skill for Claude Code                                                                                                                                           |

Each package has a README with its file map. `bun run check:restricted-art` (tools/restricted-art.ts) fails on a rights
record of a licence that is not free and on a domain plugin folder.

## A project outside the checkout

The editor, the workbench host and the commands open the project of `--project`, else the variable
`SCENITY_PROJECT` (an absolute folder), else the work folder, else the `scenity.project` field of the nearest
package.json. This checkout has no default project: with none, the editor lab page has no editor plugin and the
workbench shows the editor surface only. The editor writes the generated plugin files of a project outside the
checkout into `<project>/.scenity/editor`. A workspace outside the checkout links the packages with
`bun link` in each package folder and `link:@scenity/<name>` dependencies. A project with the published packages
(`@scenity/cli`, `scene`, `runtime` and `editor`) needs no checkout: `scenity create demo`, then `scenity dev`,
`scenity build` and `scenity check` in `demo`.

The API key option of the workbench chat reads `ANTHROPIC_API_KEY` from `.env` at the checkout root (mode 600; Git
ignores the file), else from the environment of the host.

## Build and test

Run the commands from the repo root. You need Bun 1.4.2. The repository is a Turborepo workspace with Bun as the
package manager: the root scripts call `turbo run`, which runs the tasks of the packages in the order of their
dependencies and takes unchanged results from its cache (`.turbo/cache`).

```sh
bun install                 # the workspace packages
bun run generate            # the design tokens (the other tasks build them first when they need them)
bun run typecheck           # vue-tsc: the root program, the editor and the workbench
bun run lint                # ESLint
bun run format:check        # Prettier
bun run build               # the builds of the packages: tokens, player, editor, workbench
bun run build:editor        # the editor only: vue-tsc (with its tests) and the Vite build
bun run build:workbench     # the workbench page only
```

The unit tests:

```sh
bun run test                # the Bun tests of each package (the host with its preload) and of tools/
bun run test:components     # Vitest: the editor, the workbench page and the components of the ui package
bunx turbo run test --filter=@scenity/scene   # the tests of one package; add --force to skip the cache
```

The end-to-end tests of the editor (Playwright) and the gallery of the samples:

```sh
cd apps/editor && bunx --bun playwright test tests/e2e/scene-projects.spec.ts --project chromium
cd apps/editor && bun run test:gallery
```

`bun run check:fixtures` checks the fixture rule of the tests.

## The `scenity` command

`@scenity/cli` has the bin `scenity` (Bun). In the checkout, `bun packages/cli/src/cli.ts <command>` is the
same. `scenity --help` lists the commands, and `scenity <command> --help` gives the arguments of one.

```sh
bun packages/cli/src/cli.ts create ../demo --install   # a new project (--template empty|showroom), linked
cd ../demo
bun run dev                 # scenity dev: the scene page dev server; it prints the URL of the editor page (edit=1)
scenity check               # the rules of the project, with no browser
scenity build [--check]     # the static build in dist/, the size budgets and the marker gate
scenity shot | sheet | clip # a picture, a contact sheet, a WebM video, through the player of the build
scenity bench               # the frame numbers against the project budgets
scenity verify              # check, build --check, and shot --compare against baselines/<platform>/
scenity assets <sub>        # import, build, stills, release-check, export, index, missing, used-by, new-id
```

A project outside the checkout uses the links of Bun until the packages are published: `scenity create
demo --install` runs `bun link` in `packages/cli`, `packages/scene` and `packages/runtime` (once per machine), and
`bun install` in `demo`; the project depends on `link:@scenity/<name>`, so `node_modules/.bin/scenity` and the
packages point into the checkout. `scenity dev` and the `showroom` template use the editor app and the samples of the
checkout. A plugin can add commands (the `scenity.cli` field of its package.json). `scenity pool` runs the scene pool: warm
player pages that `shot`, `sheet` and `clip` use while it runs. The `packages/cli` README has the details.

## Work with the studio

```sh
bun run dev:studio          # Scenity Studio on http://127.0.0.1:5170: the Hub and every project (dev:editor is the same)
bun run dev:lab             # the lab page of a plugin with an editor face, on port 5175; SCENITY_PROJECT=<dir> names it
bun run build:assets        # the asset build of the samples; check:assets checks it
```

`scenity studio --project <dir>` opens a project at once.

The environment variables start with `SCENITY_` (for example `SCENITY_ENGINE_URL`, `SCENITY_LABS_PAGE_SECRET`,
`SCENITY_LABS_POOL`, `SCENITY_WORKBENCH_TOKEN`).

The lab page of the dev server opens with no gate on the loopback. It has no OIDC sign-in; the page
key of the lab servers is in `@scenity/labs-platform/labKey`. The host has auth
providers (`none`, `token` with the role tokens of `SCENITY_WORKBENCH_ROLES`, `oidc` from an embedder) and roles
(`viewer`, `editor`, `admin`). `--project <dir>` starts the host on a project folder with
`scenity.project.json`, with or without Git.

### The workbench page (retires)

The workbench page and its host keep working for a limited time; Scenity Studio has their parts.

```sh
bun run dev:workbench                                       # the workbench page
bun packages/workbench-host/src/main.ts --checkout "$PWD"   # the workbench host (--project <dir>: a project)
```

The host prints `WORKBENCH_READY {"origin":…,"token":…}`. Open the workbench page with `?host=<origin>#token=<token>`.
A host behind the Scenity gateway (`packages/workbench-host/src/gateway`, the remote mode of `remote.ts`) has the
origin `<public origin>/host`: open the page with `?host=<public origin>/host#token=<host token>`. The gateway forwards a
host request only with a token of the host (the host token or a role token). In the remote mode the host refuses a shell terminal and the chat mode "all",
and the lab dev server serves only the folders of the lab page (the "remote mode" section of the host README).

A new worktree of the workbench runs `bun run generate` after `bun install --frozen-lockfile`.

The skill of this repository for Claude Code (`.claude/skills/scenity/SKILL.md`) has the commands, the tools and the
rules of the engine, the editor and the workbench.

## Licence

Copyright 2026 Leonardo Amoroso Custodio. Scenity is licensed under the Apache License, Version 2.0: see `LICENSE`.
The third-party parts keep their own licences: see `NOTICE`.
