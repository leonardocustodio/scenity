# The `scenity` command

`@scenity/cli` gives the command `scenity` (it runs on Bun). `scenity --help` lists the commands, and
`scenity <command> --help` gives the arguments of one. The exit codes: 0 for success, 1 for a failure, 2 for a usage
error (`bench --check` also uses 3).

## Install

| How                       | Commands                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| From a checkout (today)   | `bun install && bun run generate` in the checkout, then `bun <checkout>/packages/cli/src/cli.ts` |
| From npm (once published) | `bunx @scenity/cli create demo` (or `npx`), then `bun install` in the project                    |
| In a project              | `bunx scenity <command>`, or the scripts `bun run dev`, `build`, `check`, `verify`               |

In the checkout, `bun packages/cli/src/cli.ts <command>` is the same as `scenity <command>`. A useful alias:
`alias scenity="bun $PWD/packages/cli/src/cli.ts"` (run it in the checkout folder).

### Projects from a checkout

`scenity create demo --install` from a checkout links the packages: it runs `bun link` in `packages/cli`,
`packages/scene`, `packages/runtime` and `apps/editor` (once per machine is enough), and `bun install` in the project.
The project depends on `link:@scenity/<name>`, so `node_modules/@scenity/*` and `node_modules/.bin/scenity` point
into the checkout. `scenity dev` then serves the editor of the checkout (`apps/editor`); `SCENITY_CHECKOUT=<dir>`
names another checkout.

### Projects from npm

An installed command (no checkout) writes the range of its own version into the new `package.json`
(`"@scenity/cli": "^0.1.0"` and the same for `scene`, `runtime` and `editor`), so `bun install` or `npm install` gets
the published packages. `scenity dev` then serves the editor of `node_modules/@scenity/editor`. `--version <range>`
writes another range. For `shot`, `sheet`, `clip` and `bench`, add Playwright: `bun add -d @playwright/test`, then
`bunx playwright install chromium`.

### Install from the release packs

Until the first release, you can test the npm path with the tarballs of the checkout. In the checkout:

```sh
bun run release:pack        # 17 tarballs in .scenity/release/packages
```

The packages pin each other at the same version, so a project must take every `@scenity/*` package from the
tarballs: list each one as a `file:` dependency and also in `overrides` (npm) and `resolutions` (Bun). This script
writes that map into a `package.json`:

```sh
PACKS=/path/to/scenity/.scenity/release/packages
bun -e '
const [file, dir] = process.argv.slice(1);
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const map = {};
for (const name of fs.readdirSync(dir)) {
  const m = /^scenity-(.+)-\d+\.\d+\.\d+\.tgz$/.exec(name);
  if (m) map[`@scenity/${m[1]}`] = `file:${dir}/${name}`;
}
data.dependencies = { ...data.dependencies, ...Object.fromEntries(Object.keys(data.dependencies ?? {}).filter((n) => map[n]).map((n) => [n, map[n]])) };
data.overrides = map;
data.resolutions = map;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
' package.json "$PACKS"
```

The steps: make a folder `tool` with `{"name":"tool","private":true,"type":"module","dependencies":{"@scenity/cli":"0.0.0"}}`
as its `package.json`, run the script there, `bun install` (or `npm install`), then
`./tool/node_modules/.bin/scenity create demo`. In `demo`, run the script again on its `package.json`, then
`bun install`. No link points into the checkout.

## Which project

A command works on the project of `--project <dir>` (or the plain project word of `build`, `check`, `bench`, `sheet`,
`clip`, `verify`), else on the work folder when it has `scenity.project.json`, else on the folder that the
`scenity.project` field of the nearest `package.json` names. `scenity create` writes `"scenity": { "project": "." }`
into the project `package.json`, so every command in that folder finds it.

## The commands

### `scenity create`

```text
scenity create <name> [--template empty|showroom|sample:<name> | --from <folder>] [--version <range>] [--install] [--json]
```

Makes the folder `<name>` (it must not exist or must be empty). The project ID is the last part of the name.

- `empty` (default): `scenity.project.json` (one scene, the `assets` folder, `CC0-1.0` as the allowed licence and the
  rule `boxNearCentre`), `scenes/main.scene.json` (a floor, a box, a key light, a fill light and the camera `front`),
  `assets/`, `rights/`, a `.gitignore` and a `package.json` with the scripts `dev`, `build`, `check` and `verify`.
- `showroom`: the documents of `samples/showroom` (scenes, asset records, the rights record, stills, a poster) and its
  31 CC0 source files: a copy from the checkout, else a download from Poly Haven with a size and SHA-256 check. It has
  no asset build; `scenity build` makes it.
- `sample:<name>`: a copy of a sample of the checkout (`characters`, `gltf-samples`, `physics`, `sim-road`, `spin`,
  `walkthrough`) with its own ID; its plugin packages are linked too.
- `--from <folder>`: a copy of a project folder, for example a template of the studio. The copy has no outputs (`dist`,
  `node_modules`, `.git`) and no local state (`.scenity`, but its `recipes`, `skills` and `plugin-settings.json`), and
  its own ID. The new `package.json` takes the dependencies of the `package.json` of the folder.
- `--install`: link the packages (from a checkout) and run `bun install`.

```sh
scenity create demo --install
scenity create room --template showroom --install
scenity create lobby --from ../templates/lobby --install
```

### `scenity studio`

```text
scenity studio [--project <dir>] [--port <n>] [--state <dir>] [--root <dir>]... [--no-open] [--safe] [--no-agent]
               [--public-origin <url>]
```

Starts Scenity Studio (docs/ui/): the studio host on 127.0.0.1 (default port 5170) with the Hub, every open project
and the jobs, and opens the browser on the Hub, or on the editor of `--project`. A second run finds the studio on the
port and opens the browser there. The first output line is `SCENITY_STUDIO_READY {"origin":…,"url":…}`; the URL is a
launch link with a one-use code that signs the browser in. A project with plugins or runs opens in restricted mode (no
plugin code) until you trust it; `--safe` opens each project that way. `--state` names the studio state folder
(default `~/Library/Application Support/org.scenity.editor/studio` on macOS). `--root` names a folder that the folder
dialogs of the Hub show and that the jobs may run in (default: the home folder; the checkout is always a root); the
first root is the default place of a new project. In a checkout the command runs `packages/studio-host`; with no
checkout it runs the installed `@scenity/studio-host`, or that package at the version of the command through `bun x`
(`bunx @scenity/cli studio` works in an empty folder). `--no-agent` runs the studio with no agent sessions
(`GET /api/agent/status` gives `{ available: false }`); every feature works with no agent. `--public-origin <url>` (or
`SCENITY_STUDIO_PUBLIC_ORIGIN`) runs the studio in remote mode behind the gateway of the studio (see
[studio.md](studio.md#roles-review-links-and-remote-mode)).

The editor windows of the studio connect to the host over the socket `/bridge` (no workbench page). A tool with the
host secret (`x-studio-token`, the `secret` of `host.json` in the state folder) calls a window with
`POST /api/bridge/<call>` (`GET /api/bridge` lists the windows). `bun packages/workbench-host/src/studioTools.ts --studio
<origin> --token <secret>` runs the agent tools of the workbench host against them (`POST /tools/<name>`). The windows of a
scene share each change (the ops go through the host), and `POST /api/documents/run` with `{ project, path, command,
args }` runs a scene command on a scene with no open window: the host writes the file and the open windows get the
change.

The agent panel of the editor windows uses the agent sessions of the host: `/api/agent/sessions` lists, makes, changes,
prompts, stops, forks and closes them, and the events `agent.session`, `agent.item` and `agent.closed` go on `/events`. A turn
runs Claude through the Agent SDK with the agent tools of `@scenity/agent-tools` against the newest editor window of the
project. With `SCENITY_AGENT_SCRIPT=<file>` the host runs the steps of that JSON file instead of a model
(`{ "turns": [[{ "say": "…" }, { "tool": "scene_command", "input": {…} }, { "wait": 500 }, { "cost": 0.01 }]] }`;
`{prompt}` and `{context}` in a text give the prompt and its context packet). A prompt takes the chips of the composer
(`{ text, context: [{ kind, label, text, picture? }] }`); they become the `<studio-context>` lines of the turn and its
pictures. The pictures of the tool results are at `GET /api/agent/pictures/<id>`. An agent starts the jobs `check`,
`build`, `shot`, `sheet` and the asset commands with `job_run` (not in Ask mode). `GET /api/agent/sessions/<id>/turns`
gives the turn records (the prompt, the tools, the frames, the jobs, the cost and the written files); `POST
…/turns/<n>/undo` writes the files of the turn back and asks the editor window to revert its steps (`turn.undo`). `POST …/turns/<n>/restore` puts the
files and the scene of the checkpoint of a turn back (`turn.checkpoint` at each turn start, `turn.restore`). A script
step `{ "write": { "path", "text" } }` writes a project file as an agent. The host tools `plan_propose`, `plan_step`
and `plan_done` give the plan cards of a session (`planFirst` on a session refuses an edit before an approved plan);
`POST …/approvals/<id>` takes `steps` for an edited plan. `GET` and `PUT /api/agent/instructions` read the
instructions of a project (`AGENTS.md`, `CLAUDE.md`, `.scenity/skills/*.md`) and write its `AGENTS.md`; each turn gets
them. A script step `{ "when": "<text>", "steps": […], "otherwise": […] }` follows the instructions. `GET /api/agent/usage` gives the cost and the tokens of the day (`<state>/agent-usage.json`); a session takes
`budgetUsd`, `maxTurns` and `maxMinutes`. `GET
/api/agent/recipes?project=<key>` gives the recipes of the studio, of the person (`<state>/recipes.json`) and of the
project (`.scenity/recipes/*.json`).

The Hub (`apps/editor/hub.html`, served at `/`) lists the projects (cards or a list, search, sort, pin, the states
"folder not found", "newer format" and "restricted"), makes a new project from a template or a sample (a `scenity
create` job, then `git init`), opens a folder or makes it a project, shows the samples and the docs (Learn), the agent
defaults (Agents), the preferences and the doctor of the machine (Settings), and a first run on a fresh state.

```sh
scenity studio
scenity studio --project samples/showroom
```

The terminals of the editor windows run on the host: `/api/terminals` opens a PTY (`claude` with the MCP server of
the studio, or the login shell) in the project folder, takes its input and its size and closes it; the output goes as
`terminal.output` events on `/events`.

### `scenity mcp`

```text
scenity mcp [--name <client>] [--project <key>] [--studio <origin>] [--state <dir>]
```

The tools of Scenity Studio over MCP (stdio) for an external agent: Claude Code (`claude mcp add scenity -- scenity mcp
--name 'Claude Code'`), Codex, Cursor or Claude Desktop (`{ "mcpServers": { "scenity": { "command": "scenity", "args":
["mcp"] } } }`). The studio must run. The command reads `host.json` of the studio state folder, sends a connection
request (`POST /api/agent/connect`) and waits until the owner allows it in the studio; then each tool call runs as an
action of the agent session of the connection (`/api/agent/external/tools`, `/api/agent/external/call` with the header
`x-agent-token`), with the gate, the presence and the change sets of a session. Its messages go to stderr.

The studio also serves MCP over HTTP at `/mcp` (Streamable HTTP, JSON answers) for a client that takes a URL: Hub →
Agents → **Connect over HTTP** gives the token of the client (`Authorization: Bearer <token>`), and **Revoke** takes
it back.

### `scenity dev`

```text
scenity dev [--project <dir>] [--scene <path>] [--port <n>] [--view]
```

Starts the dev server of the scene page for the project and prints the address of the editor (`edit=1`) on
`--scene`, else on the first scene, and the address of the start screen. `--view` gives the page without the editor.
`--port`: a fixed port (default 5176 or the next free one). The first output line is
`SCENITY_DEV_READY {"url":…,"start":…,"origin":…,"project":…}` for tools. The server saves files, imports assets,
hot reloads changed sources and keeps its cache in `<project>/.scenity/vite`. Ctrl+C stops it.

```sh
scenity dev
scenity dev --project samples/characters --scene scenes/pickup.scene.json
```

### `scenity check`

```text
scenity check [project] [--scene <path>] [--sequence <path>] [--tier <tier>] [--json]
```

Measures every rule of the project with no browser, through the same code as the editor: the scene and project rules
at the scene time, the sequence rules at the times of their scopes. It prints a table per scene (rule, scope, time,
value, limit, result) or a JSON report. It runs the plugin simulations and systems, and loads plugin metrics from
their dev face.

- A project with `build.assets` loads its build; a missing `manifest.json` stops the check with the build command, and
  a changed source counts as stale. A project with no build loads the sources.
- Exit 1 for a failed `block` rule. A line of `<scene>.rules-log.jsonl` accepts a failure when it names the rule and
  the hash of the scene file now.

```sh
scenity check
scenity check samples/characters --sequence sequences/pickup.sequence.json --json
```

### `scenity build`

```text
scenity build [project] [--out <dir>] [--check] [--json]
```

Writes a static site (default `<project>/dist`): `index.html` with one `<scenity-player>`, `player/` (the player, the
scene worker, `plugins.js` with one chunk per plugin), `project/` (the documents in canonical form and the asset build
with `manifest.json`) and `build-report.json`. It checks:

- the size budgets: `build.budgets` of the project gives a gzip limit (`gzipKB`) for the entries `player`, `element`,
  `worker`, `plugins` and `lazy`; an entry with no budget is in the report with no limit;
- the marker gate: no editor, lab or dev code in the output (plugins add markers, see [plugins.md](plugins.md)).

`--check` needs a current asset build and writes nothing into the project. Serve `dist/` with any static server.

### `scenity shot`

```text
scenity shot [--project <dir>] [--scene <path>] [--sequence <path>] [--camera <a,b>] [--at <ms>] [--size 1280x800]
             [--backend webgl|webgpu] [--tier <tier>] [--worker 0|1] [--out <file.png>] [--compare <baseline.png>]
             [--dist <dir>] [--build] [--lock <file>] [--local] [--json]
```

Draws one PNG per camera in the player of the build (`<project>/dist`; `--build` makes it first) in headless
Chromium: 1280×800, tier high, WebGL in the worker by default, after every asset is in and two screenshots in a row are
equal. `--camera` takes camera entity IDs or names. `--at` is the time in a sequence. `--compare` checks against a
baseline with the tolerance of the gallery (pixelmatch threshold 0.2, at most 0.2 % of the pixels); `{camera}` and
`{platform}` in `--out` and `--compare` are filled in.

```sh
scenity shot --camera front --out shot.png
scenity shot --sequence sequences/walk.sequence.json --at 2500 --camera front --out 'shots/{camera}.png'
```

### `scenity sheet`

```text
scenity sheet [project] [--scene <path>] [--sequence <path>] [--camera <a,b>] [--times <a,b>]
              [--from <ms> --to <ms> [--step <ms>]] [--cell <px>] [--max-width <px>] [--format png|jpeg] …
```

One contact sheet: a row per time, a column per camera (one camera: up to four times per row; at most 64 cells).
Times need a sequence. Default file: `<build>/sheets/<name>.png`.

```sh
scenity sheet --sequence sequences/walk.sequence.json --from 0 --to 2000 --step 250 --camera front
```

### `scenity frames`

```text
scenity frames [project] [--step <ms>] [--size 480x300] [--backend webgl|webgpu] [--dist <dir>] [--build] …
```

The frame index of the project: a picture of each plan (each sequence, and each scene that no sequence uses), each
document camera and each time (0 ms and the markers and key times of a sequence; `--step` adds a time each step ms).
It draws only the frames that have no picture yet into `.scenity/frames/<key>.png` and writes the list
`.scenity/frames/index.json`, which keeps two pictures of each place: the newest one and the one before a change. The
key of a frame changes with its documents, the assets and the plugin code. The Frame index panel of the editor shows
the list and runs this command.

### `scenity clip`

```text
scenity clip [project] --from <ms> --to <ms> [--sequence <path>] [--camera <name>] [--fps 12] [--size 640x400]
             [--key-every <n>] …
```

A WebM video (VP9, else VP8) of a time range: a seek and a screenshot per frame, so the speed of the machine does not
matter. At most 900 frames. Default file: `<build>/clips/<name>--<camera>@<from>-<to>.webm`.

### `scenity bench`

```text
scenity bench [project] [--scene <path>] [--sequence <path>] [--backend webgl|webgpu|both] [--tier <tier>] [--quick]
              [--json] [--check] [--out <dir>] [--dist <dir>] [--build] [--lock <file>] [--max-load <n>]
```

Measures a scene or a sequence in the player: first frame time, frame work p50 and p95, draw calls, triangles,
instances, asset bytes and memory. It writes `bench.json` and `bench.md`. The budgets are `quality.budgets.scene.<tier>`
of the project (`scene.<backend>` overrides values for one backend). Counts are always judged; times only on a GPU at
a load under `--max-load` (default 4). `--quick` measures 5 s instead of 15 s. With `--check`, a value over budget
gives exit 1, and a time that it cannot judge gives exit 3.

### `scenity verify`

```text
scenity verify [project] [--no-shots] [--lock <file>]
```

Runs `check`, `build --check` and, for each baseline `baselines/<platform>/<scene>--<camera>.png` of the project,
`shot --compare`. Make a baseline:

```sh
scenity shot --scene scenes/main.scene.json --camera front --out 'baselines/{platform}/main--{camera}.png'
```

### `scenity publish`

```text
scenity publish [project] [--dist <dir>] [--out <file.zip>] [--json]
```

Runs the release gate of the assets (`scenity assets release-check`) first: an error stops the publish and the output
gives its reasons. Then it writes the build folder (default `<project>/dist`; run `scenity build` first) as a ZIP
archive, default `<project>/test-results/publish/<project id>.zip`. The same folder gives the same bytes.

### `scenity pool`

```text
scenity pool [start|status|stop] [--pages <n>] [--lock <file>] [--json]
```

Keeps one headless Chromium with warm player pages (default 2). While it runs, `shot`, `sheet` and `clip` use it and
start no browser; a picture is byte-equal either way. `--local` or `SCENITY_SCENE_POOL=0` gives a command its own
browser. `bench` always uses a fresh page.

### `scenity assets`

```text
scenity assets <subcommand> [projectDir] [arguments] [--project <dir>] [--json]
```

| Subcommand                                                      | What it does                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `import <file\|id> [--force] [--rights <path>] [--kind <kind>]` | Run the importer of an asset. A file with no record gets one when `--rights` names its rights record |
| `build [--check] [--no-cache] [--no-import]`                    | The asset build of the project into `build.assets.output`                                            |
| `stills [--check]`                                              | The state of the asset stills                                                                        |
| `release-check`                                                 | The release gate: rights records, licences, approvals; exit 1 on a failure                           |
| `export <scene> [--out <file.glb>] [--no-import]`               | One GLB of a scene for other tools (Blender opens it)                                                |
| `index`, `missing`, `used-by <id>`, `new-id`                    | The asset database: the index and its problems, broken references, users, a new ID                   |

```sh
scenity assets import ~/Downloads/chair.glb --rights rights/kenney.yaml
scenity assets build --check
scenity assets release-check
scenity assets export scenes/main.scene.json --out main.glb
```

FBX, OBJ and `.blend` imports need Blender 5.2 on the machine.

## Plugin commands

A plugin can add commands through its CLI face ([plugins.md](plugins.md#the-cli-face)). `scenity <name>` runs the
command of the first plugin of the project that has it, and `scenity --help` lists them. A command of the CLI wins
over a plugin command of the same name.

## Environment variables

| Variable                 | What it does                                               |
| ------------------------ | ---------------------------------------------------------- |
| `SCENITY_PROJECT`        | The project folder (absolute) when no `--project` is given |
| `SCENITY_CHECKOUT`       | The checkout whose editor `scenity dev` serves             |
| `SCENITY_SCENE_POOL=0`   | `shot`, `sheet` and `clip` start their own browser         |
| `SCENITY_SCENE_POOL_DIR` | The folder of the scene pool files                         |
| `SCENITY_GPU_TESTS=1`    | Run the tests of the CLI that need a browser and a GPU     |

The old names with `CODEBLUE_` still work for one phase, with a warning.
