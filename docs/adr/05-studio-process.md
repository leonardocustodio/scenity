# ADR 05: The studio process model

- Task: UI0-02 of `docs/ui/plan.md`
- Date: 2026-10-17
- Status: **accepted**. The owner chose option (a) of question Q2 of the plan; this record gives the details.

## Context

Today a person meets three pages and two servers, and each needs a project:

- The scene page (`apps/editor/scene.html`) runs on the scene Vite server (`vite.scene.config.ts`, port 5176). One
  server already serves many projects: the samples of the checkout and the projects of `SCENITY_SCENE_PROJECTS`; the
  page picks one with `?project=<id>`.
- The lab page (`index.html`) runs on the lab Vite server (port 5175) for one project.
- The workbench page runs on its own Vite server and talks to the host (`packages/workbench-host`, `Bun.serve`) on a
  third port with a 64-character token in the address. The host runs one checkout or project per process.

Browser storage, cookies and links belong to an origin, so a layout or a key map that one page saves is lost on
another. The open documents and their undo history live in the page, so an agent cannot edit a project with no open
page, and two pages of one project do not agree.

## The spike (2026-10-17)

A Bun server in front of one scene Vite server (a child process), with a proxy for HTTP and for the HMR WebSocket:

| Check                                                                     | Result                                   |
| ------------------------------------------------------------------------- | ---------------------------------------- |
| `scene.html?project=showroom&edit=1` and `?project=spin` through the host | 200, the Vite client is in each page     |
| `/projects/<id>/scenes.list.json` of both projects through the host       | 200                                      |
| The Vite HMR WebSocket (`vite-hmr`, its token) through the host           | `{"type":"connected"}`                   |
| A command message of 939 bytes (10 ops) to the host and back, 2,000 times | p50 0.024 ms, p95 0.067 ms, p99 0.075 ms |

## Decision

1. **One host, no project needed.** The workbench host grows into the studio host. It starts with no project, keeps a
   registry of projects and opens a project session on demand. It listens on 127.0.0.1 on one fixed port (default
   5170; `--port` changes it), so the origin stays the same across starts. `scenity studio` starts it (UI1-02). The
   package keeps its folder and name (`packages/workbench-host`) until it is published (UI1-13), when it becomes
   `@scenity/studio-host`.
2. **One origin by a proxy.** The host owns these paths: `/api/…`, `/ws`, `/mcp`, `/tools/…`, `/hooks/…`, `/launch`,
   `/health`. It forwards every other path, and the HMR WebSocket, to **one scene Vite server** that it runs as a child
   process. That server serves the Hub page (`hub.html`), the editor pages and the player pages. The plan had one Vite
   server per project in middleware mode under `/p/<key>/`; the spike shows that one server and a proxy are enough,
   and middleware mode would need a Node HTTP server inside the `Bun.serve` host.
3. **Project addresses.** The editor page of a project is `scene.html?project=<key>&edit=1`, as today. `/p/<key>` is a
   short link that redirects to it. The key is the project ID; a second project with the same ID gets `-2`, `-3`.
4. **Projects at run time.** The host writes the open projects to `<state>/studio/projects.json`. The scene server
   reads the file at start and watches it: a new project joins its project record, and the server makes the module
   `virtual:scenity/project-plugins` again. `SCENITY_SCENE_PROJECTS` still works for `scenity dev` and the tests.
5. **The documents live in the host** (UI4-13). The project session in the host holds the open documents, their undo
   histories, the change sets and the turn records; `@scenity/editor-core` is pure TypeScript and runs in Bun. An
   editor page is a client: it sends commands and gets ops over `/ws`. A drag stays local until its end and then sends
   one command. The spike measured 0.067 ms (p95) for a command message on the same machine.
6. **User state.** Preferences, layouts, workspaces, the key map, recent projects, the trust list, agent defaults and
   MCP clients live in `<state>/studio/*.json` (zod schemas; UI1-05). `<state>` is the host state folder of today
   (`~/Library/Application Support/org.scenity.editor/` on macOS, the XDG data folder on Linux). Browser storage is a
   cache only.
7. **The pages.** The editor window is the scene page in edit mode (`scene.html?edit=1`), grown into the studio shell
   (UI3-01), so its URL, its script API and its e2e specs stay. The Hub is a new page of the same app (`hub.html`).
8. **What stays.** `scenity dev` stays: one project, no host and no agent; it names `scenity studio` in its output.
   The workbench page keeps working against the host until UI14-11, then retires (question Q3). The lab page stays for
   plugins with a lab face; UI13-07 runs it as a studio workspace.
9. **The dock.** dockview (question Q8), pinned with its `dockview` dependency to a release at least two weeks old.
   UI3-02 runs the keyboard test first; our own dock on Reka UI is the fallback only if that test fails.

## Consequences

- The plan changes: UI1-03 builds the proxy and the project file, not one Vite server per project; the shell pages
  keep the `?project=` address; the risk of Vite in middleware mode goes.
- The host restarts the scene server only when its config changes; a new project needs no restart.
- One scene server serves every open project, so a bad plugin of one project can break the module graph of the others.
  Project trust (UI1-12) and safe mode (UI13-06) limit this; a project can get a server of its own later if needed.
- The HMR WebSocket and the page requests pass through the host: the host must forward the `Sec-WebSocket-Protocol`
  and the Vite token, as the spike does.

## Changes after the decision

- 2026-10-17 (UI1-13): the studio host is its own public package, `packages/studio-host` (`@scenity/studio-host`),
  and not a part of the workbench host. It depends on `@scenity/editor` (it runs its scene server) and `@scenity/cli`
  (the jobs); `scenity studio` runs it from a checkout, from an install, or through `bun x`. The workbench host stays
  private and imports `LogRing`, `freePort` and `APP_ID` from it.
