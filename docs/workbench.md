# The workbench

> **The workbench page retires**. Use Scenity Studio: run `scenity studio` and open the
> project in the Hub ([studio.md](studio.md)). The agent panel, the Review panel, the Jobs panel, the Version control
> panel and the Terminal panel of the editor window have the parts of this page. The page keeps working for one more
> phase for the projects that use it; this guide stays until then.

The workbench is a developer tool: one page with the editor of your project in a frame, Claude next to it, and a dock
with the changes, runs, review and sessions. A Bun program, the host, runs everything behind it: the dev servers, the
terminals, Git, the runs of the project and the Claude sessions. The host gives Claude tools to look at the scene, edit
it through proposals and check it.

The workbench runs from a checkout of Scenity. Its host uses the Claude Agent SDK, so `@scenity/workbench-host` is
not a published package.

## Start it

From the checkout:

```sh
bun packages/workbench-host/src/main.ts --project /abs/path/to/my-project
# prints: WORKBENCH_READY {"origin":"http://127.0.0.1:<port>","token":"<64 hex>"}
bun run dev:workbench
# then open http://127.0.0.1:<page port>/?host=<origin>#token=<token>
```

| Option             | What it does                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `--project <dir>`  | A project folder with `scenity.project.json`. With no `--checkout`, the project folder is the checkout               |
| `--checkout <dir>` | A Git checkout or a workspace folder in it (`frontend/web`); with `--project`, the project is a folder inside it     |
| `--port <n>`       | A fixed port (default: a free one)                                                                                   |
| `--state <dir>`    | The state folder (default under `~/Library/Application Support/org.scenity.editor/host/`); never inside the checkout |

The host binds `127.0.0.1` and makes a new token at each start (`SCENITY_WORKBENCH_TOKEN` sets it). The page reads
the token once and removes it from the address. Ctrl+C stops the host and every process that it started. A project
folder needs no Git: then the page has no Changes tab and the Git requests refuse.

A project can sit in a sub-folder of a Git repository, for example in the Bun workspace `frontend/web`. The host then
uses the top folder of the repository for Git (the Changes tab, the turns, a new worktree) and the workspace folder for
the rest: the editor server, the terminals, the file maps and the paths that Claude sees. With `--project`, the
workspace is the nearest folder above the project with a `package.json` workspace. A new worktree gets the same
sub-folder. The runs start in the project folder.

The chat can use your claude.ai login (the default) or an API key: the line `ANTHROPIC_API_KEY=…` of `.env` in the
checkout (mode 600, which Git ignores), else the variable of the host.

## The page

```text
┌ top bar: checkout · branch · changed files · host and server state · Restart host ─────────────────────────┐
├ surface (the editor in a frame) ─────────────────────────────┬ Claude: terminal or chat, before and after ┤
├ bottom bar: Changes · Runs · Review · Sessions · Picker · the run in progress ─────────────────────────────┤
└ the open dock tab ─────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Surfaces** are the tabs of the page. Each one is a frame: ⌘1 to ⌘9 switch them, ⌘\ hides the Claude column, ⌘K
  puts the focus in the Claude prompt.
- **Claude**: the Claude Code terminal of the checkout, or the chat (modes "ask", "edits" and "all"). After each
  turn, **before and after** shows the frame at the start and at the end of the turn.
- **Changes**: the changed files with their diff; a scene save shows the diff of the scene file. **Runs**: the runs of
  the project as buttons and in free form. **Review**: the review pack. **Sessions**: the chat sessions and the
  background runs. **Picker**: frames of the frame index to compare.

## Surfaces

The project file lists the surfaces in `workbench.surfaces`:

```json
"workbench": {
  "surfaces": [{ "id": "editor", "kind": "scene", "label": "Editor" }]
}
```

A surface of kind `scene` with no `page` runs the scene page of the editor
(`/scene.html?project=<id>&edit=1`) on a dev server of the project. Each surface can have `capabilities` (`scene`,
`index`), `page` (a start path), `hidden` and `order`. The first surface with `scene` is the one that the tools use;
the first with `index` fills the frame index. Each surface also has a hidden twin, the shadow frame, where tools draw
frames without moving your view.

## Tools for Claude

Only a session that the workbench starts (its terminal, its chat, a background run) gets the MCP server `workbench`.
The core tools:

| Tool                                                 | What it does                                                                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene_query`                                        | The entities of the open scene by name, tag or component, with transforms, bounds and values                                                                               |
| `studio_state`                                       | The first call of a session: the project, the open scene, the selection, the root entities, the prefabs, the sequence, the problems and the agent mode in one small answer |
| `scene_commands`, `scene_command`                    | The editor commands with the JSON Schema of their arguments, and a run of one; the host checks the arguments first; a run is a proposal by default                         |
| `scene_batch`                                        | Many editor commands as one named undo step (or one proposal): all apply, or none                                                                                          |
| `scene_frame`                                        | One picture of the open scene at a time and a document camera                                                                                                              |
| `scene_measure`                                      | The distance of two entities or points and the gap of their boxes                                                                                                          |
| `scene_pick`                                         | The entity under a point, with the nearest socket, bone or path point; or the selection                                                                                    |
| `scene_sheet`                                        | A contact sheet of times and document cameras                                                                                                                              |
| `scene_check`                                        | `scenity check` of the project: each rule with its worst time, value, limit and result                                                                                     |
| `asset_search`, `asset_import`                       | Search the asset database; import a file of the checkout                                                                                                                   |
| `workbench_run`                                      | A run of the project that the project allows for agents                                                                                                                    |
| `job_run`, `job_status`, `job_output`                | The same runs as jobs: start one and get its ID at once, then read its state and its output                                                                                |
| `ui_state`, `ui_reveal`, `ui_highlight`, `ui_notify` | The editor window: its state; select, frame, open a panel and show a field with a callout in one call; a callout on a part; a toast                                        |
| `workbench_after`                                    | After an edit: the frame at the state of the turn start                                                                                                                    |
| `lab_state`, `lab_frame`, `lab_console` …            | The tools of a lab page (a plugin editor), when the project has one                                                                                                        |

A host plugin adds tools ([plugins.md](plugins.md#the-host-face)), and the editor page can add page tools. The
context packet that Claude gets at each turn lists the surface, the frame, the selection and the scene entities.

**Proposals.** A command that Claude runs waits as a proposal card on the editor page: **Accept** applies it as one
undo step, **Reject** drops it. Only the owner's switch on the page lets Claude apply at once. Claude's saves go
through the same rule gate as yours.

## Runs and loops

A run is a command line of the project, run in the project folder with no shell. The project lists them in
`workbench.runs`:

```json
"workbench": {
  "runs": {
    "check": "scenity check",
    "shots": { "command": "scenity verify", "label": "Verify", "gpu": true, "agent": true },
    "bench": { "command": "scenity bench --quick", "presets": [{ "label": "WebGPU", "args": ["--backend", "webgpu"] }] }
  },
  "gate": "check"
}
```

- `scenity` in a command line is the CLI of the checkout; `bun` is the Bun of the host.
- A run object has `label`, `kind`, `out` (the host adds `--out <out>/<id>-<run>`), `gpu` (one GPU run at a time per
  checkout), `confirm` (the host adds `--dry` until you confirm), `ref`, `sequence`, `agent` (Claude may start it
  with `workbench_run`), `aliases` and `presets` (buttons of the Runs tab).
- **The stop gate.** `gate` names a run (or a command line) that a Claude turn must pass before it ends. With no gate,
  a project gets `scenity check`. The switch of the Claude column turns the gate on or off for a session.
- **Background runs (loops).** The Sessions tab starts Claude in the background on a task with a turn, budget or time
  limit; the gate run decides when it is done. A background run always has full permissions, so it needs the admin
  role.

## The frame index

The host keeps pictures of the project at fixed times and cameras: one plan per sequence (its markers and key times,
with the document cameras as views) and one per scene that no sequence uses. The shadow frame draws the jobs when the
page is idle, only for a scene file that is saved. The key of each frame is a hash of the documents, the time, the
view and the content, so a change of the project makes new frames and old ones stay valid for old content. The Picker
tab and the tools read the index. It lives in the state folder (at most 2 GB).

## Roles and remote mode

The host gives each token a role. The launch token is admin. `SCENITY_WORKBENCH_ROLES` adds role tokens:
`viewer:<64 hex>,editor:<64 hex>`.

| Role     | Can                                                                                  | Cannot                                                                               |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `viewer` | See the surfaces, frames, changes, runs, sessions and the index                      | Any write: terminals, agents, runs, Git, saves, settings                             |
| `editor` | The Claude terminal, the chat (ask, edits), runs, commits, the undo of a turn, edits | A shell terminal, the chat mode "all", background runs, Restart host, a new worktree |
| `admin`  | Everything in local mode                                                             | In remote mode: a shell terminal and the chat mode "all"                             |

**Remote mode** runs the host in a container behind the Scenity gateway (`bun packages/workbench-host/src/gateway/main.ts`)
with `SCENITY_WORKBENCH_PUBLIC_ORIGIN`, `SCENITY_WORKBENCH_LAB_PORT` and `SCENITY_WORKBENCH_LAB_BASE`. The gateway
passes `/host/…` only with a host or role token, keeps the hook paths private, and puts the editor server behind a
signed ticket. Open the page with `?host=<public origin>/host#token=<token>`. `SCENITY_WORKBENCH_PAGE_ORIGIN` sets
`frame-ancestors` for the editor frames. The host README (`packages/workbench-host/README.md`) has every detail.

## The project file and the workbench

The other fields of `workbench`: `setup` (the command that prepares a new worktree), `contentRoots` (the folders of
the content hash of the index), `denylist` (paths that no tool and no view may read; secrets are always denied),
`credentialFile` (default `.env`) and `theme` (`navy`, `light` or `dark`).
