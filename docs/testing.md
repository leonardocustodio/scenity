# Testing

The test strategy of Scenity (docs/generic-engine-plan.md SE11-05). The engine tests use generic fixtures only. The
tests of a plugin that lives outside this checkout (the room of CodeBlue) live with that plugin. Each sample has a
gallery.

## The layers

| Layer         | What it proves                                                                        | Where it lives                                                                                                   | How it runs                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Unit          | One module: the documents, the runtime, the rules, the commands, the host tools       | `packages/<p>/tests/*.test.ts`, `plugins/<p>/<face>/tests`, `tools/*.test.ts`                                    | `bun run test` (the `test` task of each package and `test:tools`; see below)                                                |
| Component     | A Vue part of the editor, the workbench page or `ui`, with fake data                  | `apps/editor/tests/{unit,components}/*.vitest.ts`, `apps/workbench/tests/{unit,components}`, `packages/ui/tests` | `bun run test:components` (Vitest in each app and package that has it)                                                      |
| End to end    | The scene page, the pane loop and the workbench in Chromium                           | `apps/editor/tests/e2e/*.spec.ts`, `apps/workbench/tests/e2e/*.spec.ts`                                          | `bunx --bun playwright test <spec> --project chromium --workers=1` (GPU lock)                                               |
| Gallery       | The frames of the samples against their baselines                                     | `apps/editor/tests/gallery/*.spec.ts`, baselines in `__screenshots__/<project>-<platform>/`                      | `cd apps/editor && bun run test:gallery --workers=1` (GPU lock)                                                             |
| Sample checks | Each sample builds, passes its rules, draws its shot and keeps its bench numbers      | `samples/<name>` (documents, rules, `baselines/`)                                                                | `bun run check:samples`, `build:samples`, `check:shots`, `check:assets`, `bench:samples`                                    |
| Plugin parity | A plugin outside the checkout draws the same frames on the engine of today            | The plugin repository (CodeBlue: `bun run parity:resus`, its galleries and its workbench specs)                  | The plugin's own configs, on the bases of this checkout (below)                                                             |
| Repo checks   | The rules of §4 of the plan: boundaries, domain words, fixtures, art, licences, shape | `tools/*.ts`                                                                                                     | `bun run check:boundaries`, `check:domain-words`, `check:fixtures`, `check:restricted-art`, `check:licences`, `check:shape` |

`bun run check:determinism` runs the plugin systems and simulations twice and compares the frames.

## The tasks of Turborepo

The repository is a Turborepo workspace (`turbo.json`). Bun is the package manager and runs every script; `turbo`
runs the tasks of the packages in the order of their dependencies and keeps their results in a cache
(`.turbo/cache`). The root scripts call it:

| Root script               | What runs                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bun run build`           | The `build` task of each package that has one (tokens, player, editor, workbench), dependencies first |
| `bun run typecheck`       | The root program (`typecheck:repo`) and the `typecheck` task of the editor and the workbench          |
| `bun run test`            | The `test` task of each package (`bun test ./tests`) and `test:tools` (`bun test ./tools`)            |
| `bun run test:components` | The Vitest suites of the editor, the workbench page and the ui package                                |
| `bun run generate`        | The `build` task of the tokens package (the other tasks run it first when they need it)               |

- One package: `bunx turbo run test --filter=@scenity/scene`. Every task again, with no cache: add `--force`.
- A task comes from the cache when its inputs are the same: the files of its package, the sources of its workspace
  dependencies (the `transit` task), the samples (for the test tasks), `tsconfig.base.json`, `bunfig.toml` and the
  `SCENITY_*`, `CODEBLUE_*` and `CI` variables. The host tests (`@scenity/workbench-host#test`), the root tasks, the
  GPU suites and the dev servers never come from the cache.
- `bun run test` runs one test task at a time (`--concurrency=1`): the host tests time out under the load of the other
  suites. (The one `bun test` process of before also ran the files in turn.)
- The `test` script of `@scenity/cli` runs from the repo root (`cd ../.. && bun test ./packages/cli`): the marker
  gate of `scenity build` reads module paths that depend on the work folder (a known problem: from
  `samples/showroom` it reports a false module of the folder `samples`).

## The fixture rule

An engine test (apps/, packages/, tools/ and the generic plugins in plugins/) uses one of these fixtures:

- a sample: `showroom`, `characters`, `gltf-samples`, `spin`, `physics`, `walkthrough`, `sim-road`;
- a small fixture scene or project in the `fixtures` folder of the tests (for example the workshop of
  `packages/scene/tests/fixtures`, with the neutral plugin `shop`);
- a fake plugin with neutral names: the lab fixture of the host tests
  (`packages/workbench-host/tests/fixtures/labProject`, `useLabFixture()`), the fake lab port
  (`packages/workbench-host/tests/fakeLab.ts`), the fake lab plugin of the lab core
  (`apps/editor/tests/fixtures/lab-plugin`) and the inspector plugin (`apps/editor/tests/fixtures/inspector-plugin`).

The neutral names: the takes `greet` and `parade`, the members `ada`, `bo` and `cy`, the props `lamp`, `lantern`,
`table` and `cart`. A test does not name the data of a plugin outside the checkout. Two checks keep the rule:

- `bun run check:domain-words` fails on a domain word of the room of CodeBlue in apps/, packages/ or tools/.
- `bun run check:fixtures` (`tools/fixture-check.ts`) fails when a source file (a test or not) names a fixture name of
  that room that is not a domain word (a take, a member ID, a track, a moment, a host tool). The list is in the tool
  and is small; it holds no domain word, so the domain word lint reads the tool with no hit. `--tests` reads only the
  test files. An engine file gets such data from the plugins of the project (`defaultTake`, `memberLabel`,
  `defaultSequence`, `toolNotes`).

A test whose subject is a plugin goes with the plugin. A plugin outside the checkout reuses the bases of this checkout:
`GALLERY_BASE` and `E2E_BASE` of the editor configs, the workbench Playwright config and its global setup, and the
fake lab port of the host tests. The workbench end-to-end setup opens the lab URL of `SCENITY_WORKBENCH_E2E_LAB`
(`apps/workbench/tests/e2e/env.ts`); a plugin with a lab sets the take of its lab there. The host checkout of that setup
is this repository, or the folder of `SCENITY_WORKBENCH_E2E_CHECKOUT` (for example the web workspace of another
repository, a sub-folder of its Git repository). A spec that edits a source file uses `tempEdit`: a file that Git
tracks must be clean, and a new file that Git does not track gets a copy of its bytes outside the checkout until the
restore.

## The path of the editor specs

The e2e specs of the editor run on the path of the studio (docs/ui/plan.md UI1-03, ADR 05): `tests/e2e/specServer.ts`
starts `packages/studio-host` with a temp state folder, opens the project folders of the spec through its API (a project
that runs code gets the trust), and signs each browser context in with a launch link. The key of a project in a page
URL is its project ID (`server.keys`). Each test starts with the default user state of the host (preferences, layouts,
key map), as a new browser context has no storage. The scene server of the host does not watch the files
(`SCENITY_SCENE_NO_WATCH=1`), but a spec of a reload passes `"0"`. `SCENITY_E2E_SERVER=scene` runs the specs on the
scene server alone (`SCENITY_SCENE_PROJECTS`, the path of `scenity dev`), to find out whether a failure comes from the
studio path. `scene-first-load.spec.ts` keeps `scenity dev` on purpose: it measures that path. The gallery draws the
build of the scene page with a static server (the frames of the page that ships).

## The GPU lock and the load

The gallery, the Playwright specs and `scenity shot`, `sheet`, `clip` and `bench` draw with the GPU. Run one at a time
and take the lock of the tools first (the agents use `.scenity/agent/gpu.lock`; `scenity shot` takes its own lock).
Run the Playwright specs with `--workers=1`. A failure at a load over 20 (`uptime`) is not proof: run it again when the
load drops. A timing test (the chat render of the workbench) can fail at a high load; it passes alone.

## The baselines

The gallery baselines are Chromium frames per platform: `scene-darwin` (the Mac), `scene-linux` (the CI runner) and
`scene-webgpu-darwin` (WebGPU on the Mac; the Linux runner has no WebGPU adapter, so that set skips there). A new
frame needs a baseline on both platforms:

```sh
cd apps/editor && bun run test:gallery --workers=1 --update-snapshots=missing   # the macOS baseline of a new frame
apps/editor/scripts/gallery-linux-baselines.sh missing -g "<test name>"          # the Linux baseline, in Docker
apps/editor/scripts/gallery-linux-baselines.sh check                             # compare as CI does
```

The `missing` mode writes only new files and never replaces a baseline. A changed frame needs the owner's approval
(`update` mode). A test that moves keeps its baselines byte for byte.

## Each sample has a gallery

| Sample         | Gallery spec                                                    | Baselines (darwin and linux)                    |
| -------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| `showroom`     | `showroom.spec.ts`, `effects.spec.ts`, `crowd.spec.ts`, players | `showroom--*` (10), WebGPU 9 on macOS           |
| `characters`   | `characters.spec.ts`, `audio.spec.ts`, `player.spec.ts`         | `characters--*`, `-table--*`, `-pickup--*` (12) |
| `gltf-samples` | `gltf-samples.spec.ts`, `materials.spec.ts`                     | `gltf-samples--*` (16), WebGPU 16 on macOS      |
| `spin`         | `plugins.spec.ts`, `input.spec.ts`                              | `spin--*` (2)                                   |
| `physics`      | `physics.spec.ts`                                               | `physics--*` (3)                                |
| `walkthrough`  | `walkthrough.spec.ts`                                           | `walkthrough--*` (7)                            |
| `sim-road`     | `sim-road.spec.ts`                                              | `sim-road--*` (6)                               |

The Hub of Scenity Studio has a gallery too: `hub.spec.ts` opens `hub.html` of the scene page build with a fake of the
studio host API (`page.route`). It keeps a baseline of each state of the Hub (`hub-*`: no projects, the project marks
as cards and as a list, a failed create, the first run) and runs the axe checks (`@axe-core/playwright`, WCAG 2.2 AA)
in the four theme variants (dark, light, navy, dark with more contrast). The journey J1 through a real studio host is
the e2e spec `studio-hub.spec.ts`. `bun tools/studio-pack-smoke.ts` packs the public packages, installs them with Bun
in a temp folder outside the checkout (no links) and starts the studio from them: the Hub draws and the editor page of
a new project draws (UI1-13; the CI job of the end-to-end smoke runs it).
