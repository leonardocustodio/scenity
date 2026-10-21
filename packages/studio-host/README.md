# @scenity/studio-host

The host of Scenity Studio: a Bun program on 127.0.0.1 that
needs no project. It keeps the registry of projects, the user state, the jobs (`scenity` commands) and the doctor,
signs the browser in, and runs one scene server of the editor behind a proxy, so the Hub and every open project share
one origin.

```sh
scenity studio [--project <dir>] [--port <n>] [--state <dir>] [--root <dir>]... [--no-open] [--safe]
bunx @scenity/cli studio            # with no checkout: the CLI runs this package (installed, or through `bun x`)
bun packages/studio-host/src/main.ts --no-open   # in a checkout
```

The first stdout line is `SCENITY_STUDIO_READY {"origin":…,"url":…}`; the url is a launch link with a one-use code.

## Where the parts come from

| Part                          | In a checkout                          | Installed from npm                                   |
| ----------------------------- | -------------------------------------- | ---------------------------------------------------- |
| The scene server (Hub, pages) | `apps/editor` (`vite.scene.config.ts`) | the package `@scenity/editor` (a dependency)         |
| The jobs                      | `packages/cli/src/cli.ts`              | the bin of the package `@scenity/cli` (a dependency) |
| The Vite dependency cache     | `apps/editor/node_modules/.vite-scene` | `<state>/vite-scene`                                 |

`src/runtime.ts` decides it: the package is in a checkout when `../../apps/editor` and `../../packages/cli` are there.
The `sample:` templates of the new project wizard need a checkout; an installed studio shows them as not usable.

## Where to change what

| To change                                                           | Edit                                   |
| ------------------------------------------------------------------- | -------------------------------------- |
| The command line, the reuse of a running studio, the browser        | `src/main.ts`                          |
| The routes (`/health`, `/launch`, `/p/<key>`, `/api`, `/events`)    | `src/server.ts`                        |
| The API (projects, folders, user state, jobs, doctor)               | `src/api.ts`                           |
| Access: Host and Origin checks, session cookies, CSRF, launch codes | `src/access.ts`                        |
| The proxy of pages and of the HMR WebSocket                         | `src/proxy.ts`                         |
| The scene server and the parts of a checkout or an install          | `src/sceneServer.ts`, `src/runtime.ts` |
| The child processes (the server child, the log, a free port)        | `src/process.ts`                       |
| The open projects and `projects.json` of the scene server           | `src/openProjects.ts`                  |
| The registry, project facts, trust, "make this folder a project"    | `src/registry.ts`                      |
| The user state files and the move of the browser keys               | `src/userState.ts`, `src/store.ts`     |
| The page bridge of the editor windows (`/bridge`, `/api/bridge`)    | `src/bridgeHub.ts`                     |
| A scene command on a scene with no window (`/api/documents/run`)    | `src/documents.ts`                     |
| The agent sessions (`/api/agent/sessions`, the `agent.*` events)    | `src/agents/sessions.ts`, `routes.ts`  |
| The drivers of a turn: Claude (Agent SDK) and the script of a test  | `src/agents/claude.ts`, `driver.ts`    |
| The external agents: the connections and `scenity mcp` (stdio)      | `src/agents/external.ts`, `src/mcp.ts` |
| The background tasks: the gate, the review pack and the record      | `src/agents/tasks.ts`, `taskPack.ts`   |
| The jobs (`scenity` commands, the GPU queue, cancel)                | `src/jobs.ts`                          |
| The folder dialog (folders under the allowed roots)                 | `src/folders.ts`                       |
| The doctor (Bun, Git, Blender, Chromium, Claude)                    | `src/doctor.ts`                        |

The state folder of the studio is `<app>/studio` (`store.ts`): `preferences.json`, `layouts.json`, `keymap.json`,
`registry.json`, `trust.json`, `projects.json` (the open projects, for the scene server), `agent-usage.json` (the
cost and the tokens of each day), `agent-tasks.json` (the record of the background tasks) and `host.json` (mode 600:
the secret of the tools and the hashes of the sessions). The folder dialogs list the folders under the roots
(`--root`, default the home folder, then the checkout), and a job runs only in a folder under a root. The Hub page is
`apps/editor/hub.html` (`src/hub`); the host serves it at `/`.

## Tests

`bun test ./tests` (in this folder) runs the unit tests with a fake scene server. The e2e specs
`apps/editor/tests/e2e/studio-origin.spec.ts` (two projects in two tabs) and `studio-hub.spec.ts` (a new project, Learn, a template and a
clone) run the studio with a real scene server. `bun tools/studio-pack-smoke.ts` installs the release packs in a temp
folder with no checkout and starts the studio from them.

The agent sessions run their turns with the Claude Agent SDK (`src/agents/claude.ts`); `--no-agent` starts the studio
with no agent sessions, and the editor windows say so.
