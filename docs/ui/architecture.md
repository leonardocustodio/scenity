# Scenity Studio: architecture

This page gives the technical design of the studio: the processes, the pages, where the state lives, the protocols,
security, speed, tests and the steps from today's pages to the studio. ADR 05 (UI0-02) records the decisions.

## 1. The processes and the origin

```text
                       browser (or the desktop shell)
 ┌──────────────────────────┬──────────────────────────────────────────────────────────────┐
 │ Hub page  /              │ editor window  scene.html?project=<key>&edit=1 (or /p/<key>) │
 │ projects, wizard, learn, │ shell, panels, Scene and Game views, agent panel             │
 │ agents, settings         │ renderer: worker or main thread; the hidden shadow view      │
 └─────────────┬────────────┴───────────────────────────┬──────────────────────────────────┘
               │ HTTP + WebSocket (studio protocol)      │ HTTP (Vite modules, HMR) + WebSocket
 ┌─────────────▼─────────────────────────────────────────▼──────────────────────────────────┐
 │ studio host (Bun, 127.0.0.1, one fixed port)                                             │
 │  projects registry · user state · access (cookie, origin checks) · project trust         │
 │  proxy of every page path and the HMR socket ──► one scene Vite server (child process)    │
 │  project sessions ─┬─ the project in projects.json (the scene server watches it)           │
 │                    ├─ documents, histories, change sets, turns (editor-core in Bun)       │
 │                    ├─ file watch, saves (canonical, atomic, rule gate), imports           │
 │                    └─ Git, terminals, frame index                                         │
 │  jobs (every scenity command; GPU lock queue) · scene pool (warm headless pages)          │
 │  agents: Claude Agent SDK sessions · MCP server (stdio via `scenity mcp`, HTTP /mcp)      │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
                ▲                                         ▲
     Claude Code, Codex, Cursor, Claude Desktop (MCP)     `scenity` CLI (finds the running host)
```

**Why one origin.** Browser storage, cookies, links and bookmarks belong to an origin. Today the scene page, the lab
page and the workbench each have their own port, so a layout or a key map saved on one is lost on another. With one
host on one fixed port (the default is 5170, `--port` changes it), every page of the studio shares one origin.

**Why the documents live in the host** (UI4-13). An agent must edit a project with no open window (background tasks,
external agents); two windows of one project must show the same state; drafts must survive a closed tab. So the
project session in the host holds the open documents, their undo histories, the change sets and the turn records.
The editor windows are clients: they send commands and get ops. Today these live in the page
(`packages/editor-core` sessions); the command kit is pure TypeScript, so it runs in Bun as well. A drag in the Scene
view stays local until its end and then becomes one command, as today ("a drag is one step"), so the gizmo keeps its
feel.

The decision of 2026-10-20 (the owner): the host holds the order of the changes of each scene (`documentLog.ts`,
`GET /api/documents/log`), and an agent edits a project with no window through a page of the scene pool. The document
text, the undo histories and the change sets stay in each window: the windows of a scene send the ops of each change
and apply the ops of the others in the order of the host, so they stay equal. A move of the histories into the host
is not planned; it makes the edit path of the page (the history, the proposals, the sequencer channel) a rewrite.

**Why one scene server behind a proxy** (ADR 05). A project's plugins are bundled at build time, and the editor page
needs them (components, presenters, studio faces). The scene Vite server already serves many projects and picks one
with `?project=<key>` (`virtual:scenity/project-plugins` holds the plugins of each project). So the host runs one
scene server as a child process and forwards every page path and the HMR WebSocket to it; the host keeps the API, the
socket and the access paths. The open projects are in `<state>/studio/projects.json`, which the scene server watches.
The spike of ADR 05 served two projects through the proxy with HMR, and a command message went to the host and back in
0.067 ms (p95).

## 2. The packages

| Package or app                  | Change                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/studio-host`          | The studio host (`@scenity/studio-host`, public since UI1-13): projects, user state, jobs, the doctor, access, the proxy of the scene server; later the sessions, the MCP server and the documents in the host |
| `packages/workbench-host`       | Stays private for the workbench page until UI14-11; it imports the shared helpers of the studio host                                                                                                           |
| `apps/editor`                   | Gets the Hub page (`hub.html`, `src/hub`) and the studio shell (`src/studio/`: `shell`, `hub`, `panels/<id>`, `agent`, `api`); the scene page parts move into panels step by step                              |
| `@scenity/editor/studio`        | The public API of the studio face (`defineStudioPlugin`, the context types, the test harness); the core panels use it too                                                                                      |
| `packages/editor-core`          | Runs in the host and in the page; the one command registry with metadata and actors; change sets over override layers                                                                                          |
| `packages/bridge`               | The bridge calls also run over the studio WebSocket (UI4-07); the frame relay stays for embeds                                                                                                                 |
| `packages/ui`, `tokens`, `i18n` | The new components and tokens of [design-system.md](design-system.md)                                                                                                                                          |
| `packages/cli`                  | `scenity studio`, `scenity mcp`; `scenity dev` stays and names the studio                                                                                                                                      |
| `apps/workbench`                | Keeps working against the host until UI14-11, then retires; its parts move into studio panels                                                                                                                  |
| `apps/editor` lab page          | Stays for plugins with a lab face; the adapter of UI13-07 runs it as a studio workspace                                                                                                                        |

The repository is a Turborepo workspace with Bun as the package manager (`turbo.json`, [testing.md](../testing.md)). A
new package of the studio gives the scripts `build` (when it has an output) and `test`, and an app also gives
`typecheck` (the root program checks `packages/*`), so the root tasks and CI run it with no other change.

## 3. The routes of the host

| Route                  | What it serves                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `/`                    | The Hub page                                                                                           |
| `/p/<key>`             | A short link: a redirect to `scene.html?project=<key>&edit=1`                                          |
| any other path         | Forwarded to the scene Vite server (pages, modules, HMR, the project files that the page reads)        |
| `/ws`                  | The studio protocol (§5)                                                                               |
| `/api/files/…`         | Pictures, job outputs, frames of the index, stills, with access checks                                 |
| `/mcp`                 | MCP over HTTP for external agents (a client token per client)                                          |
| `/tools/…`, `/hooks/…` | The tool and hook routes of today for the Claude Code terminal and background runs (launch token only) |
| `/launch?t=…`          | Turns the launch link into the session cookie, then goes to `/` (UI1-04)                               |

## 4. Where state lives

| State                                                                                               | Where                                                                      | Shared by                             |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------- |
| Project documents (scenes, prefabs, sequences, materials, rules, project file)                      | The project folder (Git)                                                   | Everyone with the project             |
| Project editor settings (`scenity.editor.json`), recipes, plans, notes, `AGENTS.md`                 | The project folder (Git)                                                   | Everyone with the project             |
| Project-local caches (`.scenity/vite`, `.scenity/editor`, asset build cache)                        | `<project>/.scenity/` (Git ignores it)                                     | This machine                          |
| Open documents, histories, change sets, turn records, drafts                                        | The project session in the host; drafts also on the disk of the user state | Every window and agent of the project |
| Preferences, layouts, workspaces, key map, recent projects, trust list, agent defaults, MCP clients | The user state of the host (`<user state>/studio/*.json`, zod schemas)     | Every browser on the machine          |
| Agent sessions and transcripts                                                                      | The host state folder (as today)                                           | The person                            |
| The frame index                                                                                     | The host state folder (as today, at most 2 GB)                             | The project                           |
| Browser storage                                                                                     | A cache of the above; never the only copy                                  | One browser                           |

The user state folder is the host state folder of today (`~/Library/Application Support/org.scenity.editor/` on macOS,
the XDG folders on Linux). UI1-05 moves the `scenity.*` browser keys there once.

## 5. The studio protocol

The studio protocol is the host protocol of today (version 3: `protocol.ts`, `agentProtocol.ts`, `changesProtocol.ts`,
`infraProtocol.ts`) with new groups. Each message has a zod schema in a shared module; the version goes to 4.

| Group        | Messages (examples)                                                                                 | Task             |
| ------------ | --------------------------------------------------------------------------------------------------- | ---------------- |
| `projects.*` | `list`, `open`, `close`, `create`, `make`, `rename`, `remove`, `trust`, `state`                     | UI1-01, UI1-06   |
| `docs.*`     | `open`, `command`, `ops` (event), `undo`, `redo`, `save`, `conflict` (event)                        | UI4-13           |
| `changes.*`  | `list`, `accept`, `reject`, `preview`, `state` (event); turns and checkpoints                       | UI5-04 to UI5-06 |
| `jobs.*`     | `start`, `cancel`, `list`, `progress` (event), `output`                                             | UI1-09           |
| `user.*`     | `get`, `set` (preferences, layouts, key map)                                                        | UI1-05           |
| `ui.*`       | The UI tools of agents: `state`, `reveal`, `highlight`, `notify` (sent to the windows of a project) | UI4-06           |
| `notes.*`    | `list`, `add`, `send`, `resolve`                                                                    | UI5-14           |
| `agent.*`    | Today's agent messages, plus `mode`, `budget`, `presence` (event)                                   | UI5-01 to UI5-09 |

**An agent tool call**, for example `scene_command`: the agent (an SDK session in the host, or an external client over
MCP) calls the tool → the host checks the mode and the role → the project session runs the command on its documents
(in Review mode the ops go into the session's change set) → the host sends the ops and the change set state to every
window of the project → the windows draw the ghosts and marks. A frame for the agent comes from the shadow view of a
window, or from a warm page of the scene pool when no window is open (UI4-08).

## 6. Rendering

- Each Scene view and the Game view has its own renderer; the Game view uses the player path (`@scenity/player`) so it
  shows what a build shows.
- The shadow view is a hidden renderer of the window with its own camera and clock; agents and the frame index use it.
- Split views share the GPU. The speed suite checks four views of the showroom (UI6-03).
- Today's ladder stays: WebGPU or WebGL, in the worker or on the main thread, the quality tiers. The switches move from
  the URL to the Game view and the Performance panel (UI6-04, UI10-06).

## 7. Security

| Threat                                               | Defence                                                                                                               | Task           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------- |
| A web page in the same browser calls the host (CSRF) | Session cookie (SameSite=Strict, HttpOnly), a CSRF token on writes, `Origin` checks                                   | UI1-04         |
| DNS rebinding                                        | `Host` header checks against the host's own names                                                                     | UI1-04         |
| Another local user or process                        | Bind to 127.0.0.1; tokens in files of mode 600; client tokens for MCP                                                 | UI1-04, UI5-15 |
| A project runs code (plugins, runs, host faces)      | Project trust and restricted mode                                                                                     | UI1-12         |
| An agent does harm                                   | Modes, Allow/Ask/Deny per kind, the always-ask list, the denylist, the Git guard, budgets ([agents.md](agents.md) §8) | UI5-07         |
| An external agent connects                           | An approval card per client; Revoke in Preferences                                                                    | UI5-15         |
| Secrets leak to an agent or a log                    | The denylist of today (`.env*`, keys, state folders); key redaction                                                   | (today)        |
| A file outside the project                           | Path checks on every file route and command (as the dev server does today)                                            | UI1-06         |
| Remote use                                           | The gateway and roles of today; no Auto mode for file writes                                                          | UI15-01        |

## 8. Speed budgets

| Measure                                         | Budget                            |
| ----------------------------------------------- | --------------------------------- |
| Hub first paint                                 | 1 s                               |
| Editor ready (showroom, warm cache)             | 3 s                               |
| Open a panel, switch a workspace                | 100 ms                            |
| Hierarchy of 10,000 entities: scroll and select | 60 fps; a click in one frame      |
| Inspector with 50 components                    | First render under 50 ms          |
| Typing in a field                               | Under 16 ms per key               |
| A field edit through the host, to the view      | Under 1 frame on the same machine |
| Preview of a change set with 200 ops            | Under 100 ms                      |
| Memory of one project session (host and window) | Under 1.5 GB                      |

The reference machine is in [vision.md](vision.md) §7. UI14-07 holds the speed suite; it runs on each change of the
shell or the panels, on a quiet machine, like the GPU suites of today.

## 9. Tests

| Layer                 | What                                                                                              | Where                                  |
| --------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Unit                  | Stores, the command registry, change sets and conflicts, the protocol schemas, the job service    | `packages/*/tests`, Bun                |
| Component             | Each panel and component with fixed data, in four themes, with axe                                | Vitest in `apps/editor`, `packages/ui` |
| Journeys              | J1 to J12 of [vision.md](vision.md) §6, end to end                                                | Playwright in `apps/editor/tests/e2e`  |
| Agent replays         | Recorded tool calls of the benchmark replay with no model; the change sets and results must match | `tools/agent-bench/`                   |
| Pictures of the shell | The 14 key screens with fixed data, per theme and platform                                        | The gallery of `apps/editor`           |
| Keyboard              | One journey (J4) with the keyboard only                                                           | Playwright                             |
| Speed                 | The budgets of §8                                                                                 | The speed suite (UI14-07)              |
| Security              | The checks of §7                                                                                  | `packages/workbench-host/tests`        |

The scene canvas pictures of the gallery do not change in this plan; the shell pictures are a separate set.

## 10. From today to the studio

Each step leaves the e2e specs and the gallery green, and the old way still works until UI14-11.

1. **The host with no project** (UI1-01 to UI1-04): `scenity studio` opens a Hub with the samples; `scenity dev`,
   the scene page and the workbench work as before.
2. **The shell around today's panels** (UI3-01, UI3-02): the editor window mounts today's hierarchy, inspector and
   dock panels in dock panels; the plain DOM bars become shell parts.
3. **One command layer and documents in the host** (UI4-01, UI4-13): the panels send commands; the page and the host
   share one history.
4. **The agent panel and change sets** (UI5): the workbench page shows a notice that names the studio; its Claude
   column and dock tabs have studio twins.
5. **Feature phases** (UI6 to UI13): each feature moves or grows in place.
6. **Retire** (UI14-11): the workbench page, the old scene page shell and `dev:editor` as the lab page go;
   `scene.html?edit=1` redirects to the studio; the lab page stays for lab faces.

CodeBlue links the Scenity packages and uses the scene page, the lab page and the workbench. Each step keeps their
public names (`@scenity/editor` scene page, `__scenity`, the bridge calls, the host protocol) for one phase, and the
change notes in `.changeset/` say what changed.
