# @scenity/workbench-host

The host of the Scenity workbench: a Bun program on the developer machine. It serves the workbench page
(`apps/workbench`) over a loopback WebSocket, runs the dev servers, the terminals, Git, the runs of the project and the Claude
Code sessions of a checkout, and gives Claude the MCP tools and the hooks of the workbench. It is a developer tool. The
learner release never builds it. The workbench retires: use Scenity Studio.

The package is framework-free and may import `node:` and `bun:`. Only `apps/workbench` and the tests of this package
import it, and the page imports only `@scenity/workbench-host/protocol` (no `node:` there). `bun run check:boundaries` and
ESLint enforce this.

## The studio host

The host of Scenity Studio (`scenity studio`) is a separate public package: `packages/studio-host`
(`@scenity/studio-host`). This host uses its `LogRing`, `freePort` and `APP_ID`.

## The command line

Run from the repo root:

```sh
bun packages/workbench-host/src/main.ts --checkout <abs path> [--port <n>] [--state <dir>]
bun packages/workbench-host/src/main.ts --project <abs path> [--port <n>] [--state <dir>]
bun packages/workbench-host/src/main.ts --checkout <abs path> --project <abs path of a folder of it>
```

- `--project` names a project folder with `scenity.project.json` (for example `samples/showroom`). Without
  `--checkout` the project folder is the checkout. A folder without the file gets the built-in manifest of the lab
  (below). The folder needs no Git.
- The host keeps three folders apart (`workspace.ts`). The Git top folder holds the Git calls, the
  worktrees, the diffs, the turns and the Changes tab (paths from the top). The workspace folder is the checkout of
  the other parts: the dev servers, the terminals, the file watcher, the file maps of the plugins, the promote, the
  scene saves and the paths of the context packet (a file outside it starts with `../`). The runs start in the
  project folder. `--checkout` alone names the workspace (the Git top folder, or a sub-folder such as `frontend/web`
  of another repository). With `--project`, the workspace is the nearest folder above the project with a
  package.json workspace, up to the Git top folder. A new worktree is a worktree of the repository, and its checkout
  is the same sub-folder in it. A workspace with no labs app (`apps/editor`) runs the labs app of the host source,
  with `SCENITY_PROJECT` set to the project of the workspace when the variable is not set.

- The host binds `127.0.0.1`. `--port 0` (the default) takes a free port.
- The first stdout line is `WORKBENCH_READY {"origin":"http://127.0.0.1:<port>","token":"<64 hex>"}`. Other text goes
  to stderr.
- The token is 32 random bytes per start. `SCENITY_WORKBENCH_TOKEN` sets it (the shell, the tests). The launch
  token is an admin token. `SCENITY_WORKBENCH_ROLES` adds role tokens (below).
- SIGTERM and SIGINT stop the host and every child process.
- With `SCENITY_WORKBENCH_SIGNALS=1` (the desktop shell sets it) the host also writes
  `WORKBENCH_SIGNAL {"busy":true|false}` lines to stdout after the READY line (`busy.ts`). The value is busy while a
  run, a background run, a chat session or the Claude terminal works, and idle 10 s after the last work. The shell
  continues to draw a busy window behind other windows. A browser gets no signal and no change.
- A shell can start a compiled host (`bun build --compile --bytecode` of `main.ts`, not in Git). Its children
  (the Vite servers, the MCP proxy, the runs, a second host) still run from the source files with `bun`
  (`hostRuntime.ts`: `SCENITY_WORKBENCH_BUN`, and `SCENITY_WORKBENCH_HOST_SRC`, which a compiled host needs).
  `bun main.ts` stays the browser path.

To use the workbench in a browser, start the host, then `bun run dev:workbench` and open the page URL with
`?host=<origin>#token=<token>`. The page reads the token once and removes the fragment.

## The project manifest

The host reads `scenity.project.json` of the project folder (`project.ts`, with `loadProject` and `projectSchema` of
`@scenity/scene`) at the start and at each `checkouts.open`. A manifest that does not read stops the start
with the file and the first problems. `host.hello` gives the project (`project`, `projectProtocol.ts`). The fields of
`workbench`:

| Field            | What the host does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surfaces`       | `host.hello` lists them with `capabilities`, `page`, `hidden` and `order` (`project.ts` `surfaceInfo`; a surface without a list gets the defaults of its kind, `scene`: `scene` and `index`). Each surface of the kind `scene` runs on the editor server (the lab Vite of apps/editor; for a project folder without apps/editor, the apps/editor of the host source, `labRoot` of `servers.ts`) under its manifest ID. A surface of the manifest with no page (or with the page `/scene.html`) runs the scene page of the editor (`/scene.html?project=<id>&edit=1`, with the workbench bridge) on the scene server of the project (`scenePage.ts`: the Vite of apps/editor with `vite.scene.config.ts` and `SCENITY_SCENE_PROJECTS`; no built lab, no render pool; its shadow frame draws the index jobs of the plans of the project). The first surface with the capability `scene` is the scene surface: the tools, the packet, the shadow frame and the built lab use it (`SurfaceRegistry.idWith`, `scene()`); the first with `index` fills the frame index. The code names no surface (`tests/surfaceLiterals.test.ts`) |
| `runs`, `gate`   | The run catalog of the project (`runCatalog.ts`): the runs of the host plugins, then the manifest runs (a command line, or a run with `label`, `kind`, `out`, `gpu`, `gpuOff`, `confirm`, `ref`, `sequence`, `agent`, `aliases`, `presets`; `runSpecSchema` of `@scenity/scene`). `gate` names a run or a command line; without it a project with a manifest gets `scenity check`. `host.hello` lists the command lines, `runs.commands` the whole runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `setup`          | The setup of a new worktree (`checkoutSetup.ts` `setupSteps`: the commands between `&&`, without a shell; `bun` is the Bun of the host)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `contentRoots`   | The content hash of the frame index (`projectContent` of `@scenity/labs-platform`; without the field, the folders of the scenes, sequences, rules, plugins and assets), relative to the checkout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `denylist`       | More patterns for the denylist (`denylist.ts` `denyPatterns`: a glob without a slash matches a file or folder name, a glob with a slash the end of a path)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `credentialFile` | The file of `ANTHROPIC_API_KEY` of the chat mode (default `.env`, mode 600), relative to the project folder                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `theme`          | The page sets `data-theme` (`navy`, `light`, `dark`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

The built-in manifest (`DEFAULT_WORKBENCH`) is the lab of the host plugin: the surfaces of the host plugin (the
surface `lab` of the kind `scene`, label "Lab", ⌘1), the runs and the gate of the host plugin (for example a `labs` run as the gate), the setup
`bun install --frozen-lockfile && bun run generate`, the content of the lab (`indexSource` of the host plugin: the frame
index source of the editor plugin of the lab, the same hash as the lab page) and `.env`.

**Runs.** A run is the command line of a run of the project with the arguments of the owner or the agent, in
the project folder of the checkout, with no shell (`runArgs.ts` `planRun`, `runs.ts`). `bun` is the Bun of the host
and `scenity` is the CLI of `@scenity/cli`. The host adds `--dry` to a `confirm` run until the owner confirms it,
`--ref <session start>` to a `ref` run, and `--out <out>/<id>-<run>` to a run with `out`; one `gpu` run at a time per
checkout. The Runs tab shows the `presets` of the runs as buttons and every run in its free form; `workbench_run` takes
the runs with `agent` (an enum of their IDs; a project with none has no such tool); the `PreToolUse` note names the run
of a `Bash` command (`runHint.ts`: the command line or an alias). The stop gate of a background run is the gate run for
the sequence of the run (`sequence` of `loops.start`, or its old name `take`): its exit code decides,
and a gate run that needs a sequence does not run without one. The review pack is the first run of the kind `review`.
The `Stop` gate of a session uses the fast check of a host plugin (`gateCheck`; the lab: the take at its moments),
else the gate run for the sequence of the URL. The experiment log keeps the command line and the sequence of each
run.

## The host plugins

The host core names no domain. A plugin gives its host face (`HostPlugin` of `src/plugin.ts`, the entry point
`@scenity/workbench-host/plugin` with the tool kit): `tools` (MCP tools; a tool with the name of a core tool replaces
it), `contextLines` (the rows of the members, the lines of the lab state and the short state of `lab_state`), `runs`
(the run commands and the gate of the built-in project), `paths` (the files of a picked item, the tune paths of "Save
placement", the layout pairs of "Save layout as", the files of the promote) and `indexSource`. Two optional
fields give project data that the core does not name: `toolNotes` (a tool name → a sentence of examples that the host
adds to the description of that core tool) and `defaultSequence` (the start value of the sequence fields of the dock:
the review pack, the picker and a background run; without it, the first sequence of the project document; `host.hello`
gives it as `project.defaultSequence`). The host tests use the lab fixture `tests/fixtures/labProject`.

The host imports no plugin (ESLint and `tools/check-boundaries.ts`). `src/plugins.ts` loads the host face of each
entry of the `plugins` field of the project (`resolvePluginEntries` of `@scenity/cli/plugins`: the `scenity.host` field
of the package.json of the plugin, else `host.ts` or `src/host.ts`). A folder with no project document gets the
built-in plugins: the plugins of the project that the `scenity.project` field of the root package.json names. A
manifest with no `workbench` part gets the surfaces, the runs and the gate of its plugins. The host lists its tools at
`GET /tools/` (the stdio MCP server reads that list): the core tools, the plugin tools, then the tools of the page (the
bridge calls `tools` and `tools.call` of `@scenity/bridge`; the editor plugin gives them). The context packet shows the
rows of a plugin (`contextLines.members`), else the entities of the inspect report (`contextRows.ts`), and the lines of
the page (`contextLines`). A project with no promote files starts; its promote fails with a clear error.

The frame index of a project reads its source (`FrameIndexSource` of `@scenity/labs-platform/indexSource`):
the content config, and the plans that the host fills with no page. A project with a manifest gives one plan per
sequence and per still scene, with the document cameras as the views and the scene frame key (`index/projectSource.ts`,
`projectPlans`); the queue makes their jobs before the plans of the page. The built-in project gives no plans: the lab
page plans its open take.

## Git is optional

A project folder with no Git is its one checkout (`checkouts.ts` `gitRoot`): `host.hello` gives `git: false`, the
requests `git.*` and `checkouts.create` refuse with `NO_GIT`, the turn store keeps no turns (the hooks still get a
turn number for the before and after pictures), and the page has no Changes tab. In this case, the state folder is the folder of
the project.

## The auth providers and the roles

`authProvider.ts` gives the caller of each token (the header `x-workbench-token`, or the `token` parameter of the
WebSocket). The launch token is always an admin token, so the processes of the host keep their access.

- `none` (the default): the launch token only.
- `token`: also the role tokens of `SCENITY_WORKBENCH_ROLES`, a comma list of `<viewer|editor|admin>:<64 hex>`
  (`main.ts` `authFromEnv`). A bad entry stops the start. The gateway reads the same variable.
- `oidc`: a verifier that an embedder gives in code (`HostOptions.auth`), for example the check of an ID token that a
  sign-in proxy adds. The host has no OIDC code of its own. The page key of the lab servers is in
  `@scenity/labs-platform/labKey`.

A page keeps the role of its WebSocket token. The router refuses each request above the role (`roleProtocol.ts`
`requestRefusal`, `REQUEST_ROLES`); the page hides those controls too. An HTTP request of a viewer can only read
(GET, HEAD), and only the launch token reaches `/hooks/`, `/loops/<id>/hooks/`, `/context` and `/tools/`.

| Role     | Can                                                                                                                          | Cannot                                                                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewer` | See the surfaces, the frames, the changes, the diff, the runs, the sessions, the turns, the index; the window layout         | Open a terminal, start or drive an agent, start or cancel a run, Tune to code, a Git write, relay an acting frame event (`ask`, `placement`, `camera`, `layout`, `variants`, `import`, `scratch`, `promote`), change the settings, open a checkout or a window, POST |
| `editor` | All of the viewer, the Claude terminal, the chat (modes ask and edits), the runs, Git commits, the undo of a turn, the edits | A shell terminal, the mode "all" (`bypassPermissions`, also kept by a resume), a background run (it always has `bypassPermissions`), Restart host, a new worktree                                                                                                    |
| `admin`  | All that the local mode can do                                                                                               | In the remote mode: a shell terminal and the mode "all" (for every role)                                                                                                                                                                                             |

## The remote mode (Scenity)

`remote.ts`: with `SCENITY_WORKBENCH_PUBLIC_ORIGIN`, `SCENITY_WORKBENCH_LAB_PORT` and `SCENITY_WORKBENCH_LAB_BASE`
the host runs behind the Scenity gateway (`gateway/`, `bun src/gateway/main.ts`) in a container. The lab dev server
has the fixed port and the base path, the frames load from `<public origin><base path>`, and the render pool does not
start. The gateway gives the page `/host/…` (only with a token of the host), the lab server under its base path and
`/health`. The remote mode has these limits:

- The host refuses `terminal.open` of the kind `shell` and a chat session in the mode "all" (`bypassPermissions`: a
  start, a resume and `agent.setMode`); the SDK never gets `allowDangerouslySkipPermissions`. The Claude terminal and
  the other chat modes stay. The local mode allows both.
- The gateway never sends on the paths of the processes in the container: `/hooks/`, `/loops/<id>/hooks/`, `/context`,
  `/tools/`, `/auth/` (`PRIVATE_HOST_PATHS` of `gateway/gateway.ts`).
- The gateway and the host server have one body limit: `HOST_BODY_MAX_BYTES` of `importProtocol.ts` (the largest
  import, 200 MB, and 1 MB).
- The lab dev server serves only the editor app, the workspace packages that it imports, the generated contracts, the
  review records and `node_modules`, and never a secret file (`apps/editor/scripts/labsFs.ts`).

The access through the gateway (the roles are above):

- **The lab behind the token** (`labTicket.ts`). A frame of another site keeps no first-party cookie, and the frame
  cannot send a header, so the host puts a lab ticket into each frame URL: `labTicket=<expiry>.<HMAC>`, valid 12 to
  13 hours (one text per hour, so the URL does not change at each state event). The key is an HMAC of the host token,
  so the gateway checks a ticket with no call to the host. The gateway takes the ticket of the URL parameter (the first
  load of a frame) or of the cookie `scenity_lab`; a valid parameter gives the cookie (`Path=<lab base>`, `HttpOnly`,
  `Secure`, `SameSite=None`, `Partitioned`), so the modules, the assets and the HMR socket of the frame carry it. A
  partitioned cookie (CHIPS) works in a frame of another site; a browser that blocks it gets 401 on the modules, so
  serve the workbench page from the same site as the gateway for it. The gateway sends the request on without the
  ticket parameter and the cookie, with the header `x-scenity-lab-gate: <gate key>` (an HMAC of the host token). The
  host gives the gate key to the lab server (`SCENITY_WORKBENCH_LAB_GATE`), and the lab server of the remote mode
  refuses each HTTP request and each WebSocket upgrade without it (`apps/editor/scripts/labsGate.ts`): a process that
  reaches its port directly gets 401. The Vite HMR socket also needs the Vite token of `/@vite/client`, which is
  behind the gate. The host removes the ticket from every URL that it keeps or shows (`withoutLabKey`).
- **The role tokens through the gateway.** The gateway sends a `/host/…` request on with the host token or a role
  token of `SCENITY_WORKBENCH_ROLES`; the host gives the role.
- **Background runs.** A background run always runs `claude -p --permission-mode bypassPermissions`, so `loops.start`
  needs the role admin; a viewer or an editor cannot start one.
- **`frame-ancestors`.** With `SCENITY_WORKBENCH_PAGE_ORIGIN` (the public origin of the workbench page) the lab
  server sends `frame-ancestors <that origin>` (`apps/editor/scripts/labsCsp.ts`).

## The supervisor and the restart

`main.ts` is a small supervisor (`supervisor.ts`). It runs the host itself as a worker process: the same `main.ts`
with `SCENITY_WORKBENCH_WORKER=1`. The READY line of the first worker is the READY line of the supervisor.

- `host.restart` (the `Restart host` button of the page) writes `restart.json`, stops every child and ends the worker
  with exit code 75 (`RESTART_EXIT_CODE`). The supervisor starts a new worker (new code) on the same port with the same
  token, so the page connects again without a reload.
- The new host reads `restart.json` when it is at most 10 minutes old: it opens the checkout at the saved surface URLs,
  starts the app servers again, shows the old terminals and runs as ended, and resumes the chat sessions by ID.
- After each worker, the supervisor ends the process groups that the worker left (`children.json`), so a crash or a
  SIGKILL leaves no Vite, terminal or run. A worker that ends with another code ends the supervisor.
- The shell (⇧⌘R) restarts the whole supervisor process; the old host writes `restart.json` there too.
- A `WORKBENCH_SIGNAL` line of the worker goes to the stdout of the supervisor; its other stdout goes to stderr.
- A compiled supervisor starts its worker from the binary while no input file of the binary is newer (the input
  list of the build); after an edit of the host code it starts `bun main.ts`, so a restart always runs the new code.

## The credential of the chat mode

A chat session runs on the credential that the owner picks in the start form or the Sessions tab
(`src/agent/credential.ts`):

- **Subscription** (the default): the SDK gets the environment of the host without `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`, so its bundled Claude Code uses the claude.ai login of the
  machine. The status shows "subscription (claude.ai login)".
- **API key (.env)**: at the start of the session the host reads the line `ANTHROPIC_API_KEY=…` of `<checkout>/.env`
  (the `.env` file of the checkout root, which Git ignores; quotes removed). The file must have the mode 600, else the host refuses with the reason.
  Without the file or the line, the host takes the variable of its own environment, else it refuses. The key goes only
  into the `env` option of that session; an init with `apiKeySource: "none"` stops the session. The host replaces a
  copy of the key in an event or an error text with `[ANTHROPIC_API_KEY]`, and never writes the key to a file.

`chat.json` of the state folder keeps the last choice per checkout (never the key); `agent.live` gives it, so the
start form begins on it. The terminal mode and the background runs stay on the subscription.
`scripts/chat-check.ts [--credential subscription|api-key]` does a real check of the chat mode (two model calls).

A crashed dev server shows `failed` and starts again once by itself after 1.5 s. A second crash stays `failed` until
the owner presses Restart.

## The lab servers and the page key

Each lab server gets a new per-process secret (`SCENITY_LABS_PAGE_SECRET`, `@scenity/labs-platform/labKey`). The
frame URL carries it (`labsKey=`), and the built lab of the render pool asks a page request for it (`pageKeyGate`);
the host keeps, saves and shows every URL without it (`surfaces.ts`, `tools/kit.ts` `shownUrl`). The lab page of a dev
server that a person starts opens with no gate on the loopback.

## The MCP tools

The MCP server `workbench` has the core tools in a project with no host plugin (`TOOLS` in `src/tools/index.ts`: the core tools of `CORE_TOOLS`, then the
tools of the host plugin; "the host plugin" in the column "File" is the host face of the project plugin). Only a session that the
workbench starts gets them: its Claude terminal, the chat and a background run.

| Tool                                   | What it gives                                                                                                                                                                                                                | File                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `lab_state`                            | The context packet again and the lab state                                                                                                                                                                                   | `tools/state.ts`                                            |
| `lab_frame`                            | One picture of one moment (time, camera, item, take, tunes) with its metrics; `pane`, `grid`, `onion` (the onion skin), `hidden` (the solo and hide of its pane), `where: "shadow"`                                          | `tools/frame.ts`                                            |
| `lab_check`                            | The motion checks of the take at the times                                                                                                                                                                                   | the host plugin                                             |
| `lab_inspect`                          | The inspect report of a frame (poses, hand goals, joints, touch points)                                                                                                                                                      | the host plugin                                             |
| `lab_tune`, `lab_tunes`                | Set one tuned number live; list the tuned numbers                                                                                                                                                                            | `tools/tune.ts`                                             |
| `lab_open`, `lab_browse`, `lab_search` | The content browser: open an item, list a folder, search the catalog                                                                                                                                                         | `tools/browser.ts`; `lab_search`: the host plugin           |
| `lab_where`                            | The files behind the frame                                                                                                                                                                                                   | the host plugin                                             |
| `lab_pick`, `lab_marks`                | The item under a point or the selected item; the marks of the owner                                                                                                                                                          | `tools/pick.ts`                                             |
| `scene_query`                          | The entities of the open scene by name, tag or component (`where`: the search words of the hierarchy) with transforms, bounds and component values                                                                           | `tools/query.ts` (the call `scene.query`)                   |
| `scene_commands`, `scene_command`      | The commands of the page (scene page or lab) and a run as Claude: a proposal by default; only the owner's switch (`setProposalMode("apply")`) applies at once                                                                | `tools/edit.ts`                                             |
| `lab_commands`, `lab_edit`             | The old names of `scene_commands` and `scene_command` in the lab (aliases of the host plugin of the lab, same texts and schemas)                                                                                             | the host plugin of the lab                                  |
| `scene_frame`, `scene_measure`         | One picture of the open scene (time, document camera); the distance of two entities or points and the gap of their boxes (from `scene.query`)                                                                                | `tools/sceneView.ts`                                        |
| `scene_pick`, `scene_sheet`            | The entity under a point of the scene page with the nearest sub-target (`entity:<id>#<sub>`), or the selection; one contact sheet of times and document cameras of the scene page (the lab keeps `lab_pick` and `lab_sheet`) | `tools/scenePick.ts` (the calls `scene.pick`, `sheet`)      |
| `asset_search`, `asset_import`         | The asset database of the project: assets by words and kind with their users; the import of a file of the checkout (`importProjectFile` of `@scenity/assets`, loaded on demand; a viewer cannot import)                      | `tools/assets.ts`                                           |
| `lab_measure`                          | A distance in cm between two ends, the owner's measurements, or with `reach` the reach of a member and the test of a prop                                                                                                    | `tools/measure.ts` (the distance); `reach`: the host plugin |
| `lab_layout_check`                     | The layout checks, for given tune values or a proposal; with `search` the layout variants, with `propose` the variants as proposals                                                                                          | the host plugin                                             |
| `lab_place`                            | Describe and place: the readings of a sentence, ranked by the layout checks; the best one as a proposal                                                                                                                      | the host plugin                                             |
| `lab_console`                          | The console errors and warnings of the lab page                                                                                                                                                                              | `tools/state.ts`                                            |
| `lab_sheet`                            | A contact sheet of a time window from the shadow frame; `panes`, `onion`                                                                                                                                                     | `tools/sheet.ts`                                            |
| `workbench_after`                      | After an edit: the frame at the URL state of the turn start                                                                                                                                                                  | `tools/loop.ts`                                             |
| `workbench_run`                        | A run of the project as a run of the Runs tab (the runs with `agent`; a `confirm` run gets `--dry`)                                                                                                                          | `tools/loop.ts`                                             |
| `scene_check`                          | `scenity check` for the open project with no browser: each rule with its scope, worst time, value, limit and result, as a table and the JSON report                                                                          | `tools/check.ts` (`@scenity/cli/check`, loaded on demand)   |

The packet line `Tools:` (`context.ts`) and the appended prompts of the terminal and the chat (`settings.ts`
`EDITOR_LINE`, `agent/options.ts`) name the editor tools and the rule of the proposals. `camera-save` and
`layout-save` are not `workbench_run` commands (runs of the kind `write`): the lab sends them as the bridge events `camera` and `layout`, and
the host runs them as runs of the Runs tab.

## The file map: to change X, edit Y

All paths are under `src/`.

| To change                                                      | Edit                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The CLI, the READY line, the signals                           | `main.ts`, `supervisor.ts`, `supervisorEnv.ts`                                                                                                                                                                                                                                                                                                                      |
| The project manifest and the built-in manifest                 | `project.ts`; the `host.hello` shape: `projectProtocol.ts`                                                                                                                                                                                                                                                                                                          |
| The auth providers and the role tokens                         | `authProvider.ts`; the role table and the refusals: `roleProtocol.ts`; the HTTP rule: `server.ts` `httpRefusal`                                                                                                                                                                                                                                                     |
| The lab ticket, the cookie and the gate key                    | `labTicket.ts`; the gateway: `gateway/gateway.ts`; the lab server: apps/editor `scripts/labsGate.ts`                                                                                                                                                                                                                                                                |
| The busy signal of the desktop shell                           | `busy.ts`                                                                                                                                                                                                                                                                                                                                                           |
| The paths of a compiled host                                   | `hostRuntime.ts`                                                                                                                                                                                                                                                                                                                                                    |
| How the parts of the host connect                              | `host.ts`, `hostParts.ts`                                                                                                                                                                                                                                                                                                                                           |
| The HTTP server, the token check, CORS                         | `server.ts`, `token.ts`                                                                                                                                                                                                                                                                                                                                             |
| The remote mode and the Scenity gateway                        | `remote.ts`; the gateway: `gateway/gateway.ts` (the routes, `PRIVATE_HOST_PATHS`), `gateway/proxy.ts`, `gateway/main.ts` (the environment, the body limit)                                                                                                                                                                                                          |
| The dispatch of a page request                                 | `router.ts`, and the routes in `host.ts`, `changes.ts`, `infra.ts`, `agent/routes.ts`                                                                                                                                                                                                                                                                               |
| A message of the page protocol                                 | `protocol.ts` or its split module (below), then the handler                                                                                                                                                                                                                                                                                                         |
| The worktrees and the start screen                             | `checkouts.ts` (the Git top, workspace and project folders: `workspace.ts`); the setup of a new worktree (`bun install`, `bun run generate`, the run `setup`, the state `preparing`): `checkoutSetup.ts`                                                                                                                                                            |
| The lab dev server per checkout; the scene server per project  | `servers.ts`; `scenePage.ts`                                                                                                                                                                                                                                                                                                                                        |
| The surface registry and the RPC through the page              | `surfaces.ts`, `surfaceCalls.ts` (a call that a page reload stops waits for the new page and starts again)                                                                                                                                                                                                                                                          |
| The hidden shadow frame                                        | `shadow.ts`                                                                                                                                                                                                                                                                                                                                                         |
| The render pool and the built lab                              | `labPool.ts` (the pool process of apps/editor, its token, `fresh()`); the shadow loads the built lab (`surfaces.ts` `state`, `shadow.ts` `labsBuild`); the setting `builtLab` moves the visible lab frame to it (`blender.ts`)                                                                                                                                      |
| When an edit reached the frame                                 | `hmr.ts`, `edits.ts` (the file watcher)                                                                                                                                                                                                                                                                                                                             |
| The context packet                                             | `context.ts` (lab), `frontPacket.ts` (the tab in front)                                                                                                                                                                                                                                                                                                             |
| The hook answers                                               | `hooks.ts`; the Git refusal of `PreToolUse`: `gitGuard.ts`; the note for a run of the project in `Bash`: `runHint.ts`; the prompts of the owner (no turn for a message of another session): `ownerPrompt.ts`                                                                                                                                                        |
| The `/tools/`, `/hooks/`, `/context` routes                    | `agentHttp.ts`                                                                                                                                                                                                                                                                                                                                                      |
| The tool context, the packet cache, the before and after       | `agentLoop.ts`, `turnCapture.ts`; the sheets of a turn: `turnSheets.ts`; the saved turns: `turnPictures.ts`                                                                                                                                                                                                                                                         |
| The pictures by ID: the store and `GET /pictures/<id>`         | `pictures.ts`; the binary frame of a picture and the references: `pictureProtocol.ts`; the join of a frame with its answer: `surfaceCalls.ts`                                                                                                                                                                                                                       |
| The frame index: the store, the queue, the routes              | `index/hostIndex.ts`; the job queue and its ranks: `index/queue.ts`; the files: `index/files.ts`; the source of the project: `index/projectSource.ts`, the source of the built-in project `builtInIndexSource` of `plugins.ts`; the messages and the binary index frame: `indexProtocol.ts`; the key, the content hash and the store core: `@scenity/labs-platform` |
| The desktop fast path                                          | `surfaces.ts` (`indexerUrl`); WebP of a saved JPEG: `shellWebp.ts`; MP4: `desktopClips.ts`; native snapshot: `tools/nativeShot.ts`; names: `desktopProtocol.ts`                                                                                                                                                                                                     |
| The batches of the run output                                  | `runOutput.ts`                                                                                                                                                                                                                                                                                                                                                      |
| The `Stop` gate                                                | `stopGate.ts`                                                                                                                                                                                                                                                                                                                                                       |
| An MCP tool                                                    | `tools/` (`workbenchTools()` in `tools/index.ts`; one file per tool family); the tools of a plugin: its host face (`plugins.ts`); the tools of the page: `tools/pageTools.ts`                                                                                                                                                                                       |
| Point and ask, Save placement                                  | `tools/pick.ts` (`lab_pick`, `lab_marks`), `tools/picked.ts` (the picked block of the packet; the files come from `paths.picked` of the host plugin), `sceneEdit.ts` (the bridge events `ask` and `placement`)                                                                                                                                                      |
| Import by drop                                                 | `imports.ts` (`POST /imports`: the bytes of a browser drop, or a desktop `path` in the home folder, not on the denylist; the job run; `GET /imports/<id>/<file>`); `importProtocol.ts` (the fields, 200 MB)                                                                                                                                                         |
| Scratch props, "Promote to the room"                           | `@scenity/bridge` (the bridge events `scratch` and `promote`), `scratchProtocol.ts` (`PromoteResult`); `promote.ts` (the checks, the slot, the change list, the Claude prompt; it copies only the model files); `sceneEdit.ts` (`promoteResult`)                                                                                                                    |
| The scene files of a project                                   | `sceneFiles.ts` (`scene.read`, `scene.save`: the writer of `@scenity/cli/sceneFile`, the denylist, the `scene.saved` event of the Changes tab), `sceneFileProtocol.ts`; the role of a save: `roleProtocol.ts`                                                                                                                                                       |
| The stdio MCP server of the CLI                                | `mcp.ts`                                                                                                                                                                                                                                                                                                                                                            |
| The generated `--settings` and `--mcp-config` files            | `settings.ts`                                                                                                                                                                                                                                                                                                                                                       |
| The terminals (PTY)                                            | `terminal.ts`; the session IDs (Resume): `terminalSessions.ts`; the export of a transcript: `transcript.ts`                                                                                                                                                                                                                                                         |
| The chat mode (Agent SDK)                                      | `agent/` (`session.ts`, `manager.ts`, `options.ts`, `asks.ts`, `mcpServer.ts`, `sdkHooks.ts`, …)                                                                                                                                                                                                                                                                    |
| Git, the Changes tab, the undo of a turn                       | `git.ts`, `changes.ts`, `turns.ts`                                                                                                                                                                                                                                                                                                                                  |
| The runs of the project                                        | `runCatalog.ts` (the catalog, the gate, the review run), `runs.ts`, `runArgs.ts`                                                                                                                                                                                                                                                                                    |
| Background runs                                                | `loops.ts`, `loopRun.ts` (the gate check of the host after a turn-limit, budget, time-limit or error end: `endCheck`), `loopStream.ts`, `loopGuard.ts`                                                                                                                                                                                                              |
| The picker, the experiment log, the checkout settings, Blender | `picker.ts`, `experiments.ts`, `blender.ts`                                                                                                                                                                                                                                                                                                                         |
| A second window (a second host)                                | `windows.ts`                                                                                                                                                                                                                                                                                                                                                        |
| The state folder and the restart                               | `state.ts`, `restartState.ts`, `hostRestart.ts`, `children.ts`                                                                                                                                                                                                                                                                                                      |
| The files that the workbench never shows                       | `denylist.ts`                                                                                                                                                                                                                                                                                                                                                       |
| A program call without a shell                                 | `exec.ts`                                                                                                                                                                                                                                                                                                                                                           |

## The protocol modules

`src/protocol.ts` is the one source of the message types for the host, the page and the tests. It is pure (no `node:`
or `bun:` import) and re-exports the split modules:

| Module                | Messages                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `protocol.ts`         | The endpoint helpers, `host.hello`, `checkouts.*`, `surface.call`, `surface.report`, `surface.state`, `surface.request`, `terminal.*`, `agent.turn`, `runs.output`, `runs.done`, `context.packet`; it re-exports the bridge contract of `@scenity/bridge`          |
| `terminalProtocol.ts` | The parameters and the result of `terminal.open`                                                                                                                                                                                                                   |
| `agentProtocol.ts`    | The chat mode: `agent.start`, `agent.prompt`, `agent.answer`, `agent.ask`, `agent.message`, …                                                                                                                                                                      |
| `loopProtocol.ts`     | `agent.notify`, `agent.stopGate`, `agent.setStopGate`; the saved turns `agent.turnList`, `agent.turnPictures`, `agent.turnSaved`; `terminal.sessions`, `terminal.export`                                                                                           |
| `changesProtocol.ts`  | `git.*`, `runs.start`, `runs.cancel`, `runs.list`, `tunes.apply`                                                                                                                                                                                                   |
| `infraProtocol.ts`    | `loops.*`, `picker.*`, `experiments.search`, `checkout.settings`, `windows.open`                                                                                                                                                                                   |
| `windowProtocol.ts`   | The clock relay `link.post`, `link.kept` (the last state of a channel, for a new window); the window layout `layout.get`, `layout.set`, `layout.detach`, `layout.dock`, `layout.join`, `layout.rect` (`windowLayout.ts` keeps it per checkout in the state folder) |
| `roleProtocol.ts`     | `Role`, `REQUEST_ROLES`, `requestRefusal`, `roleCan` (merged through `hostProtocol.ts`)                                                                                                                                                                            |
| `projectProtocol.ts`  | `ProjectInfo`, `HelloAccess` (the parts of `host.hello`), `NO_GIT` (merged through `hostProtocol.ts`)                                                                                                                                                              |
| `hostProtocol.ts`     | `surface.front`, `host.restart`, `host.restarting`, `captureArgs`                                                                                                                                                                                                  |
| `pictureProtocol.ts`  | The capture MIME types, `Capture` (the bytes, host only), `PictureRef` (an ID for the page), the binary picture frame (`encodePictureHeader`, `readPictureFrame`), `PICTURE_PATH`                                                                                  |
| `desktopProtocol.ts`  | The calls that the page answers itself (`snapshot`, `clipMp4`), their `NO_NATIVE_…` errors, `CLIP_MP4_PATH`                                                                                                                                                        |
| `indexProtocol.ts`    | `index.plan`, `index.next`, `index.done`, `index.fail`, `index.status`, `index.progress`, the binary index frame (`WBI\x01`: `encodeIndexFrame`, `readIndexFrame`), `INDEX_PATH`                                                                                   |

A request is `{ id, type, ...params }`; the answer is `{ id, ok: true, result }` or `{ id, ok: false, error }`. An event
is `{ type, ...payload }` without an `id`. A change that breaks a client increments `PROTOCOL_VERSION` (the value
is 3).

**Pictures.** A picture never goes as base64 between the frames, the page
and the host. The lab bridge moves the encoded bytes to the page (an `ArrayBuffer` in the transfer list); the page
sends one binary WebSocket frame (the magic `WBP\x01`, the `surface.request` number as a little-endian u32, the length
and the text of the MIME type, then the bytes) and then the JSON `surface.call` with `bytes: <byte count>`; the host
joins the two. The host keeps bytes (`Capture`), stores the pictures that a page shows in the picture store, and makes
base64 only for the image block of a tool result (the MCP boundary). The page gets `PictureRef`s (an ID) in
`agent.turn`, `agent.turnPictures`, `picker.sheet` and the chat messages, and reads the bytes at `GET /pictures/<id>`.

**The desktop fast path.** In the labs app the shell does some tasks for the host. In a browser, each task keeps its
browser path.

- With `SCENITY_WORKBENCH_SIGNALS=1` and `SCENITY_WORKBENCH_WEBP=1` (the shell sets both), the picture store
  writes `WORKBENCH_SIGNAL {"webp":"<path of a new JPEG>"}` on stdout (`shellWebp.ts`); the shell writes `<id>.webp`
  and removes the JPEG, and the store serves the WebP under the same ID. Nothing waits for it.
- `lab_frame` with `source: "window"` sends the surface call `snapshot`; the workbench page
  answers it with the native snapshot of the shell, or with `NO_NATIVE_SNAPSHOT` (a browser, a tab behind another tab),
  and the tool keeps the canvas capture (`tools/nativeShot.ts`).
- `POST /clips/mp4` sends the surface call `clipMp4` to the visible lab frame; the page draws the frames as JPEG
  and the shell writes the MP4; the store keeps it (`video/mp4`, served by `GET /pictures/<id>`; `read` gives pictures
  only). `labs clip --format mp4` uses it when it runs in the workbench.
- A lab surface has `indexerUrl` (the built lab without the panel and the dock, a stopped clock); the indexer
  window of the app shows it as the place `indexer` of the surface and takes the jobs of the frame index.

## The routes

| Route                              | Token  | What it does                                                                                                       |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `GET /health`                      | No     | `{"ok":true}`                                                                                                      |
| `GET /ws?token=<token>`            | Query  | The WebSocket of a workbench page                                                                                  |
| `POST /tools/<name>`               | Header | Runs an MCP tool (the stdio server `mcp.ts` calls it)                                                              |
| `POST /hooks/<event>`              | Header | A Claude Code hook payload in, the hook JSON out (the `http` hooks of the generated settings)                      |
| `GET /context?surface=<id>`        | Header | The context packet as text (without `surface`: the tab in front)                                                   |
| `GET /runs/<run>/file?path=<path>` | Header | A file of the output folder of a run                                                                               |
| `GET /pictures/<id>`               | Header | A picture of the picture store (32 hex characters; the page makes an object URL)                                   |
| `GET /index/<key>?size=<px>`       | Header | A frame of the frame index (absent size: the smallest); `GET /index/manifest/<hash>/<take>` the manifest of a take |
| `POST /clips/mp4`                  | Header | The MP4 of a clip of the visible lab frame by the labs app; `{ id, … }`; 501 in a browser                          |
| `POST /loops/<id>/hooks/<event>`   | Header | The hooks of a background run                                                                                      |

The header is `x-workbench-token`. A request without a token of the auth provider gets 401; a request above the role of
its token gets 403. The CORS headers go only to the app origin (`tauri://localhost`) and to the origin of a page that
sent `host.hello`.

## The state folder

On macOS `~/Library/Application Support/org.scenity.editor/host/<first 16 hex of the SHA-256 of the checkout path>/`
(elsewhere under `$XDG_STATE_HOME`), or `--state <dir>`. The host writes JSON atomically (a temporary file, then a
rename).

| File                                                                                    | Content                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkouts.json`, `surfaces.json`, `sessions.json`                                      | The checkouts, the surface URLs, the chat session IDs per checkout                                                                                                                    |
| `chat.json`                                                                             | The credential choice of the chat per checkout (`subscription` or `api-key`; never a key)                                                                                             |
| `restart.json`                                                                          | The state for the next host (10 minutes)                                                                                                                                              |
| `children.json`                                                                         | The process groups of the children, for the reap after a crash                                                                                                                        |
| `claude/mcp.json`, `claude/settings.json`                                               | The generated MCP config and settings of the terminal (mode 600; they name the token variable)                                                                                        |
| `claude/loops/<id>/`, `loops/<id>.json`                                                 | The generated files and the record of a background run                                                                                                                                |
| `turns/<checkout hash>/`                                                                | The turns of Claude and the file snapshots for the undo; `pictures/<session>/<turn>/` the facts and the picture IDs of the before and after and the sheets of each turn (at most 100) |
| `pictures/<id>.<ext>`                                                                   | The picture store: the pictures that a page shows (turns, sheets, the picker, the chat), one file per content, at most 4,000                                                          |
| `index/<content hash>/<take key>/`                                                      | The frame index: `<step>/<time>-<view>-<size>.<ext>` and `manifest.json` (the frames, their metrics and the clip lanes); at most 2 GB, the content hashes used longest ago go first   |
| `terminal-sessions.json`                                                                | The session IDs of the Claude terminals (Resume, Export transcript)                                                                                                                   |
| `experiments.jsonl`, `agent-costs.json`, `agent-options.json`, `checkout-settings.json` | The experiment log, the chat costs, the last options of each chat session (never a key), the checkout settings                                                                        |

The denylist covers every state folder, so no view and no tool shows these files.

## Security

- Loopback only, a token per start, the token on every path except `/health`. A surface frame never gets the token:
  the page relays the surface calls. The role of each token limits its requests (above).
- The denylist (`denylist.ts`): `.env*` at any depth, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`,
  `id_ecdsa*`, `id_dsa*`, and the state folders. The diff, the run file route, the packet, `lab_where` and the turn
  snapshots ask it first.
- The Git allowlist (`git.ts` `GIT_ALLOWLIST`): `status`, `diff`, `add`, `commit`, `rev-parse`, `show`, `cat-file`,
  `check-ignore`, `log`, `worktree` (`list` and `add` only), `check-ref-format`, `show-ref`. A call that the hook guard
  (`gitGuard.ts`) refuses is refused for the host too. No push, reset, checkout or stash. A commit has one subject line
  and no attribution.
- The runs: only the runs of the project (the manifest and the host plugins), as an argument list without a
  shell.
  Shell characters are refused, a path must be in the checkout, and `asset` and `promote` get `--dry` until the owner
  confirms in the page.
- The terminal of `claude` gets no `ANTHROPIC_API_KEY` unless the owner asks. A chat session with the credential "API
  key (.env)" refuses to start without `ANTHROPIC_API_KEY`.
- The page gives each lab frame a `sandbox` attribute with `allow-scripts allow-same-origin allow-forms` only
  (apps/workbench `surfaces/frameSandbox.ts`, with the reason of each token), and the lab dev server sends a
  Content-Security-Policy header (apps/editor `scripts/labsCsp.ts`). The remote mode refuses more (above).

## Tests

From the repo root:

```sh
bun test ./packages/workbench-host                    # the unit and host tests (no model call, no browser)
WORKBENCH_IT=1 bun test ./packages/workbench-host     # adds labServer.it.test.ts: the real lab Vite of this checkout
```

- `tests/*.test.ts` use fakes: `fakeLab.ts` (a lab page), `fakeSdk.ts` (the Agent SDK), `helpers.ts`.
- `tests/e2e-host/main.ts` is the host in test mode for the page e2e and perf runs (`apps/workbench`): the real host,
  a scripted chat SDK (`scriptedSdk.ts`), a plain shell in place of `claude`, and `--lab-url` for the saved lab URL.
- `tests/hostProgram.ts`: the CLI tests (`main.test.ts`, `lifecycle.test.ts`) run `bun src/main.ts`, or the compiled
  host when `SCENITY_WORKBENCH_HOST_BIN` names it:
  `SCENITY_WORKBENCH_HOST_BIN=<binary> bun test ./packages/workbench-host/tests/main.test.ts ./packages/workbench-host/tests/lifecycle.test.ts`.
- The test hygiene (`tests/hygiene.ts`): `tempDir` records each temporary folder, and a test that starts a host
  process records it with `trackProcess` and stops it with `stopTracked` in its `afterAll`. After the last test file,
  `tests/hygiene.preload.ts` (the `[test]` preload of the root `bunfig.toml`; the `test` script of the package passes
  `--preload`) removes the folders that a test left and fails the run when a process of the run is still alive (a child
  of the test process, or a process whose command line names a temporary folder of the run).
- `scripts/chat-check.ts` is the real check of the chat mode. It spends money on `ANTHROPIC_API_KEY`; run it only on
  request.

In a project with a host plugin, its verify run (for example `bun run labs verify`) runs these tests (for a change under the
workbench paths) with the page checks, ESLint with the code shape (500 lines in a file, 80 in a function), Prettier and the
boundaries.
