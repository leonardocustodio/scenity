# Scenity Studio: the plan

Planning date: **2026-10-17**. Status: **accepted by the owner on 2026-10-17** (the answers are in §9). The checklist to track the
work is [checklist.md](checklist.md).

**The aim.** One application, Scenity Studio (the studio), gives access to everything that Scenity can do. It starts
with no project, like the Unity Hub. It makes or opens a project, and it opens the editor of that project in a window
with docked panels, like the Unity Editor. AI agents are part of the design from the first day: each action of a
person is also a tool for an agent, each edit of an agent waits for review where the person works, and the person
always sees what the agent does. [vision.md](vision.md) gives the reasons and the principles.

**Scope.** The Scenity repository: the host (`packages/workbench-host`), the editor app (`apps/editor`), the design
system (`packages/ui`, `tokens`, `i18n`), the command kit (`packages/editor-core`), the bridge, the CLI and the docs.
The engine packages change only where a task names them (for example the plugin metrics in the editor page).

**Sources.** Three read-only reviews on 2026-10-17: the editor app and its dev servers, the workbench with its host and
tools, and the reference products (Unity, pen.dev, Cursor, Blender, Spline, Godot, PlayCanvas, Figma). The facts are
in [coverage.md](coverage.md) and in §1 of [vision.md](vision.md).

**Task IDs:** `UI<phase>-<nn>`. Three tasks are architecture decisions (UI0-02, UI0-03, UI0-04). Each of them writes a
record `docs/adr/<nn>-<name>.md`.

**The design documents.** The tasks name the design; the documents give it.

| Document                             | What it gives                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| [vision.md](vision.md)               | The problem, the principles, the references, the journeys, the success measures       |
| [coverage.md](coverage.md)           | Each feature of Scenity, where it is today, where it goes in the studio, its task     |
| [shell.md](shell.md)                 | The Hub, the editor window, the panels, menus, toolbar, keys and interaction rules    |
| [agents.md](agents.md)               | The agent model: sessions, context, change sets, review, permissions, presence, tools |
| [design-system.md](design-system.md) | Density, themes, colour roles, icons, the new components, texts, accessibility        |
| [extensibility.md](extensibility.md) | The studio face of a plugin and its contribution points                               |
| [architecture.md](architecture.md)   | The processes, the origin, the state, the protocols, security, tests, migration       |

---

## 1. Summary

**One rule for the whole studio: every feature has three users.** A person uses it with the mouse and the keyboard,
an agent uses it through a tool, and a plugin author can extend it through the same API as the core. A feature is not
done until all three can use it (§3.2).

Five big changes:

1. **Start with nothing.** Today each page needs a project, and `bun run dev:editor` shows "No editor plugin". After
   this plan, `scenity studio` opens the Hub: recent projects, templates, a new project wizard, the samples, the
   doctor and the agent setup.
2. **One shell.** Today the editor is floating panels over a full-page canvas, plain DOM bars and three separate Vue
   apps, and the workbench is a second app in another tab. After this plan, the editor window is one Vue app with a
   menu bar, a toolbar, docked panels, saved workspaces, a status bar and one search box.
3. **Everything in the UI.** Today many features live only in the CLI, in URL parameters or in hand-written files
   (project settings, rules, rights records, builds, shots, benches). After this plan, each row of
   [coverage.md](coverage.md) has a place in the studio.
4. **Agents first.** Today the agent lives in the workbench, its frames move the person's view, proposals are cards
   one command at a time, and sequence edits are not reviewable. After this plan, the agent panel is a dock panel of
   the editor, selection is context, each turn is one change set that the person reviews in place, checkpoints restore
   any turn, and any external agent can connect over MCP.
5. **Easy to extend.** Today the scene page has no extension points for plugins. After this plan, a plugin adds
   panels, inspector widgets, menus, tools, presets, importers, asset sources, recipes and agent tools through one
   studio face, and the core panels use the same API.

| Phase | Name                                   | What it gives                                                                                  | Tasks | Milestone |
| ----- | -------------------------------------- | ---------------------------------------------------------------------------------------------- | ----- | --------- |
| UI0   | Decisions, research and design         | Three ADRs, the usability and agent baselines, specs, design language, mockups                 | 10    | M0        |
| UI1   | The host and a start with no project   | `scenity studio`, one origin, projects, user state, jobs, the doctor, project trust            | 13    | M1        |
| UI2   | The Hub                                | Project list, new project wizard, open, learn, first run, start from a prompt                  | 10    | M1        |
| UI3   | The editor shell                       | One Vue app, docks, workspaces, menus, toolbar, status bar, search, dialogs, themes            | 13    | M2        |
| UI4   | One command layer and agent access     | One registry, actors, tools from commands, UI tools, the shadow view, documents in the host    | 13    | M2        |
| UI5   | The agent workspace                    | Agent panel, context, change sets, turns, checkpoints, permissions, presence, tasks, any agent | 20    | M3        |
| UI6   | The core panels                        | Scene view, Game view, hierarchy, inspector, Project window, console, problems, history        | 14    | M3        |
| UI7   | Authoring                              | Create menu, special widgets, lighting, handles, prefabs, materials, variants, placement       | 15    | M4        |
| UI8   | Time, animation and play               | Timeline, curves, keys, play mode, simulations, animator, characters, walks, clips             | 13    | M4        |
| UI9   | Assets                                 | Import, asset inspector, build, stills, rights, approvals, release check, asset sources        | 13    | M5        |
| UI10  | Rules, checks, quality and performance | Rules editor, plugin metrics, checks, performance, bench, budgets, frame index                 | 11    | M5        |
| UI11  | Build, ship and visual tests           | Build window, player preview and embed, shots and baselines, render queue, publish             | 6     | M6        |
| UI12  | Project, settings and version control  | Project settings, preferences, shortcuts, semantic diffs, Git, jobs, autosave                  | 9     | M6        |
| UI13  | Plugins and extensibility              | The studio face, contribution points, Plugins window, plugin wizard, isolation                 | 10    | M7        |
| UI14  | Learn, help, accessibility and polish  | Tour, tutorials, help, a11y, languages, speed budgets, studies, docs, retire old parts         | 13    | M8        |
| UI15  | Remote and shared review               | The studio in remote mode, review links, note threads                                          | 3     | later     |

**Effort.** 186 tasks: 33 S, 117 M and 36 L; 126 of them are must tasks. With half a day for S, one and a half days
for M and four days for L, the must tasks are about 235 agent-days and all tasks about 335. The owner's review and the usability sessions are
extra. The numbers are a rough scale, not a date.

---

## 2. Where we are (2026-10-17)

The engine plan ([generic-engine-plan.md](../generic-engine-plan.md)) is done except the owner steps and SE8-09 (the
desktop shell). Scenity has a full engine, a scene editor, a workbench with Claude and a CLI. The UI problems are in
§1 of [vision.md](vision.md); in short:

- **No start without a project.** `scenity dev` needs one; the scene page falls back to `showroom` with no word;
  `bun run dev:editor` opens the lab page, which says "No editor plugin" in this checkout.
- **Three pages and two servers.** The scene page (port 5176), the lab page (port 5175) and the workbench page with its
  host, a token in the address and a second terminal.
- **A developer shell.** Floating panels over the canvas, one fixed layout, plain DOM bars with no tokens, a forced
  dark theme, no menu bar, no palette, no undo buttons, one notice bar for every prompt.
- **Hidden features.** 14 URL-only options, 15 CLI-only commands and many hand-written files (project settings, rules,
  rights records, approvals, budgets, runs).
- **Split agent features.** The agent is in the workbench; proposals are cards in the frame; the switch to apply at
  once has no UI; sequence edits get no proposals; `scene_frame` moves the person's camera and clock; lab words leak
  into the generic tools.

[coverage.md](coverage.md) lists each feature with its place today and its target.

---

## 3. Strategy

### 3.1 Change with no break

- **Strangler, not rewrite.** The new shell first hosts the panels of today (the Vue panels mount in dock panels), then
  each panel grows in place. The scene page e2e specs and the gallery stay green after each task; the frames of the
  gallery do not change.
- **One origin early.** UI1-03 puts the Hub and the editor pages behind the host on one origin before the shell work,
  so storage, links and the agent connection have one home.
- **The agent loop early.** The first slice (§5.3) has the agent panel and one change set, so the agent design meets
  real use before the panels grow.
- **Old paths stay for one phase.** `scenity dev`, the scene page URL parameters, the workbench page and the lab page
  keep working until UI14-11, with a note that names the new way.

### 3.2 The definition of done of a UI task

A task is done when each line holds:

1. **Person.** It works with the mouse and with the keyboard only; the focus is visible.
2. **Agent.** Each action is a command of the one registry (UI4-01), so it has keys, a menu or palette entry and an
   agent tool. An agent's use of it shows as a change set or a job, never as a silent change.
3. **Plugin author.** If it is an extension point, a plugin can add to it with the studio face (UI13-02).
4. **Texts.** Every text is in Fluent. The empty, loading and error states exist and say what to do next.
5. **Themes.** It works in dark, light, navy and high contrast, with no raw colours.
6. **Tests.** A component test; the journey e2e test that covers it ([vision.md](vision.md) §6); axe has no serious
   issue.
7. **Speed.** The Scene view keeps its frame rate, and the UI budgets of UI14-07 hold.
8. **Docs.** The user page (`docs/studio.md`, `docs/editor.md`) and, for an extension point, `docs/plugins.md`.

### 3.3 Measure, then build

UI0-05 (people) and UI0-06 (agents) measure today's tools first. UI14-08 and UI14-09 measure again with the same tasks.
Each design choice with a doubt gets a small test with three people (a prototype, a mockup or a build) before the
large work.

---

## 4. Phases and tasks

Size is the agent effort: **S** at most half a day, **M** one or two days, **L** three days or more. Priority: **must**,
**should**, **could**. "Journey Jn" names a journey of [vision.md](vision.md) §6.

### Phase UI0: Decisions, research and design

**Goal.** The owner decides the open questions; the process model, the agent model and the extension model are
records; today's tools have numbers to beat; the screens have a design. **Exit:** the three ADRs are accepted and the
baselines are recorded.

| ID     | Task                                                                                                                                                                                                                                                                                                                                                     | Size | Prio   | Needs          | Done when                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| UI0-01 | The owner answers §9                                                                                                                                                                                                                                                                                                                                     | S    | must   | —              | The answers are in §9                                                                                                                    |
| UI0-02 | ADR 05, the studio process model: one host that needs no project; one origin; the Hub page; one editor page per open project; one scene Vite server behind the host; the open documents and their histories in the host; the user state folder; the future of `scenity dev`, the workbench page and the lab page ([architecture.md](architecture.md) §1) | M    | must   | UI0-01         | `docs/adr/05-studio-process.md` is accepted; a spike serves two projects under one origin with HMR and measures an edit through the host |
| UI0-03 | ADR 06, the agent interaction model: actors, sessions, turns, change sets, checkpoints, permission modes, presence; one undo story for document ops and file edits ([agents.md](agents.md))                                                                                                                                                              | M    | must   | UI0-01         | `docs/adr/06-agent-interaction.md` is accepted, with the change set life cycle and the conflict rules                                    |
| UI0-04 | ADR 07, the UI extension model: the studio face, the contribution points, the life cycle, error isolation, API versions; the core panels use the same API ([extensibility.md](extensibility.md))                                                                                                                                                         | M    | must   | UI0-01         | `docs/adr/07-studio-extensions.md` is accepted, with one example of each contribution kind                                               |
| UI0-05 | The usability baseline: five people (two new to 3D tools, two Unity users, one developer) do the journeys J1 to J8 with today's tools; record the time, the errors and each request for help                                                                                                                                                             | M    | should | —              | `docs/ui/research/baseline.md` holds the numbers and the top 20 problems                                                                 |
| UI0-06 | The agent benchmark v1: 24 prompts over the samples, each with a check (a scene query or a rule) and a scorer; record success, time, cost and review steps with today's workbench                                                                                                                                                                        | M    | must   | —              | `tools/agent-bench/` runs the set; the first numbers are in `docs/ui/research/agent-bench.md`                                            |
| UI0-07 | Interaction specs: the panel catalogue, the menus, the keys, the drop matrix and the dialog policy of [shell.md](shell.md) get spec IDs that tasks and tests name                                                                                                                                                                                        | M    | must   | UI0-02         | Each panel and menu of shell.md has a spec ID                                                                                            |
| UI0-08 | The design language as tokens: editor density, the colour roles (selection, agents, change marks, axes, play mode), the type scale, the icon rules ([design-system.md](design-system.md))                                                                                                                                                                | M    | must   | —              | The new tokens build in all themes; a token page shows them                                                                              |
| UI0-09 | Mockups of the 14 key screens of [shell.md](shell.md) §11 in pen.dev (`docs/ui/designs/studio.pen`), reviewed by the owner                                                                                                                                                                                                                               | L    | should | UI0-07, UI0-08 | The owner approves the screens; each later task links its screen                                                                         |
| UI0-10 | A clickable prototype of the shell and the agent panel with fixed data, tested with three people before UI3                                                                                                                                                                                                                                              | M    | could  | UI0-09         | The notes are in `docs/ui/research/prototype.md`; the layout changes are in shell.md                                                     |

### Phase UI1: The host and a start with no project

**Goal.** One command starts the studio with no project. The host serves every page on one origin, keeps the user
state, runs every `scenity` command as a job and protects the machine. **Exit:** `scenity studio` opens the Hub, and a
project opens from it with no terminal step.

| ID     | Task                                                                                                                                                                                                                                                                                                                                                              | Size | Prio   | Needs          | Done when                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| UI1-01 | The host starts with no project: a project registry (recent, pinned), project sessions that open and close, the API `projects.*`; the checkout and the project become fields of a session, not of the host                                                                                                                                                        | L    | must   | UI0-02         | The host with no project answers `projects.list`; an open of a sample starts its session                           |
| UI1-02 | The command `scenity studio [--project <dir>] [--port <n>] [--no-open]`: the host on a fixed default port, the browser on the Hub (or the project), the line `SCENITY_STUDIO_READY {…}`; the root script `dev:studio`; `bun run dev:editor` opens the studio                                                                                                      | M    | must   | UI1-01         | From a checkout and from an installed CLI, one command opens the Hub                                               |
| UI1-03 | One origin (ADR 05): the host forwards every page path and the HMR WebSocket to one scene Vite server that it runs; the open projects go to `projects.json`, which the scene server watches; `/p/<key>` redirects to the editor page; storage and links stay the same across starts. 2026-10-20 (the owner): the gallery keeps the static build of the scene page | L    | must   | UI0-02         | Two projects open in two tabs of one origin with HMR; the scene page e2e specs and the gallery pass on this path   |
| UI1-04 | Access control for a local web app: a session cookie from the launch link (HttpOnly, SameSite=Strict), `Host` and `Origin` checks against DNS rebinding, a CSRF token on writes, the token for tools; a page that says how to open again                                                                                                                          | M    | must   | UI1-03         | Tests refuse a foreign origin, a rebinding `Host` and a request with no cookie                                     |
| UI1-05 | User state in the host: preferences, recent projects, layouts, the key map and agent defaults in `<user state>/studio/*.json` with zod schemas; one move from the `scenity.*` browser storage keys; browser storage only as a cache                                                                                                                               | M    | must   | UI1-01         | A second browser on the machine shows the same layouts and key map                                                 |
| UI1-06 | The project service: make from a template (a job), open a folder (checks `scenity.project.json`; offers "Make this folder a project"), close, rename, remove from the list, reveal on the disk, the project picture (poster or still)                                                                                                                             | M    | must   | UI1-01, UI1-09 | Each action has an API test; a folder with no project file gets the offer                                          |
| UI1-07 | Folder access: an API that lists folders under allowed roots (home, the checkout, recent places) and makes a folder; a folder dialog component (the desktop shell uses the native one later)                                                                                                                                                                      | M    | must   | UI1-04         | A person picks the place of a new project with no typed path                                                       |
| UI1-08 | No silent defaults: `scene.html` with no `project=` goes to the Hub, never to `showroom`; the lab page with no editor plugin links to the studio; `scenity dev` names `scenity studio` in its output                                                                                                                                                              | S    | must   | UI1-03         | E2e specs check both pages with no project                                                                         |
| UI1-09 | The job service: each `scenity` command (create, check, build, verify, shot, sheet, clip, bench, pool, assets) as a job with typed arguments, progress events, logs, output files and pictures, cancel and the GPU lock queue; it reuses the run code of the host                                                                                                 | L    | must   | UI1-01         | The API runs `scenity check` and `scenity shot`, streams progress and gives the PNG; cancel stops the process tree |
| UI1-10 | The doctor: the Bun version, Blender (FBX, OBJ, `.blend`), the Playwright Chromium (shots, benches), WebGPU in this browser, Git, the Claude login or API key; a fix action or a docs link for each failed check                                                                                                                                                  | M    | must   | UI1-01         | The Hub shows the checks; each fix action has a test with a fake missing tool                                      |
| UI1-11 | Many projects at once: one host keeps many project sessions; an idle project server stops after a time and starts again on the next open; a memory budget per session                                                                                                                                                                                             | M    | should | UI1-03         | Three samples open in three tabs; the idle one stops and comes back with its state                                 |
| UI1-12 | Project trust: a project with plugins, runs or host faces opens in restricted mode (no plugin code, no runs, no agent writes) until the owner trusts it; the trust list is in the user state                                                                                                                                                                      | M    | must   | UI1-01         | A new project with a plugin shows the trust prompt; restricted mode loads its scenes and keeps unknown components  |
| UI1-13 | A host that installs from npm: `bunx @scenity/cli studio` works with no checkout; the agent part loads only when its package is there (decision Q6)                                                                                                                                                                                                               | M    | must   | UI1-02, UI0-01 | The release packs install and start the studio in a temp folder with no checkout                                   |

### Phase UI2: The Hub

**Goal.** A person with no project gets a clear start: recent projects, a new project from a template or a prompt, the
samples, help and a one-time setup. **Exit:** journey J1 passes with no terminal after `scenity studio`.

| ID     | Task                                                                                                                                                                                                                                                | Size | Prio   | Needs                  | Done when                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ---------------------- | -------------------------------------------------------------------- |
| UI2-01 | The Hub page: side navigation (Projects, Learn, Agents, Settings), the top actions (New project, Open), the agent and account state; built with `@scenity/ui` and Fluent ([shell.md](shell.md) §2)                                                  | M    | must   | UI1-03, UI0-08         | The page passes the axe checks in the four themes                    |
| UI2-02 | The project list: cards and a list view; picture, name, path, last open time, format version, Git branch and changed mark; pin, search, sort, remove from the list; the state "folder not found"                                                    | M    | must   | UI2-01, UI1-06         | In J1 a person finds and opens a recent project in under 10 s        |
| UI2-03 | The new project wizard: a template gallery with pictures and descriptions (Empty, Showroom and the samples as templates); name and place (folder dialog); options (Git, linked checkout or npm packages); the progress of the create job; then open | L    | must   | UI2-01, UI1-06, UI1-07 | J1: from the Hub to the editor of a new project in under 2 minutes   |
| UI2-04 | Start from a prompt: "Describe what you want to make"; the agent picks a template, makes the project and builds a first scene as a change set that waits in the editor                                                                              | L    | should | UI2-03, UI5-04         | J2 passes for 4 of 5 benchmark prompts                               |
| UI2-05 | Open a project: the folder dialog, a folder dropped on the Hub (desktop shell), a clone from a Git URL (a job)                                                                                                                                      | M    | should | UI1-06, UI1-07         | Each path opens a copy of a sample in the editor                     |
| UI2-06 | The Learn tab: the samples (open a copy, never the original), the docs, the tutorials of UI14-02, what is new in this version                                                                                                                       | M    | should | UI2-01                 | Each sample opens as a copy in a folder that the person picks        |
| UI2-07 | The first run: welcome, theme and language, connect an agent (Claude login, an API key, an external agent over MCP, or no agent), the doctor results                                                                                                | M    | must   | UI2-01, UI1-10         | With a clean user state, J1 shows the first run once and never again |
| UI2-08 | Empty and error states of the Hub: no projects yet, folder not found, a project of a newer format, a failed create with its log and a retry                                                                                                         | S    | must   | UI2-02                 | Each state has a component test and a picture baseline               |
| UI2-09 | Templates as data: a template registry (built-in, plugin and user templates); "Save this project as a template"                                                                                                                                     | M    | could  | UI2-03, UI13-02        | A user template shows in the wizard of a second project              |
| UI2-10 | The Hub prompt box: ask how to do something; the answer links to the docs and the tutorials                                                                                                                                                         | S    | could  | UI2-04                 | The box answers 10 test questions with a link that resolves          |

### Phase UI3: The editor shell

**Goal.** The editor window is one Vue app with docked panels, saved workspaces, a menu bar, a toolbar, a status bar,
one search box, real dialogs and themes. **Exit:** every scene page e2e spec passes on the new shell, and a person can
arrange, save and restore the layout by mouse and by keyboard.

| ID     | Task                                                                                                                                                                                                                                                                                                                             | Size | Prio   | Needs          | Done when                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | -------------- | ------------------------------------------------------------------------------------------------- |
| UI3-01 | One Vue app for the editor window: one shell replaces the plain DOM bars, the notice bar and the three separate `createApp` panels; the renderer canvas stays outside deep reactivity                                                                                                                                            | L    | must   | UI0-02, UI0-07 | The scene page e2e specs pass on the new shell; the gallery frames stay the same                  |
| UI3-02 | The dock system: dock areas, tab groups, splitters, drag a panel to dock it, float it in the page, maximize (Shift+Space), close and open again from the Window menu, all by keyboard too (dockview, decision Q8; this task runs the keyboard test first (ADR 05), and our own dock on Reka UI is the fallback only if it fails) | L    | must   | UI3-01         | A layout of 12 panels docks, floats and comes back after a restart; the keyboard-only test passes |
| UI3-03 | Layouts and workspaces: the default layout of [shell.md](shell.md) §4; the workspaces Layout, Animate, Assets, Review and Build; save, rename, delete, reset; per user, with an optional project default                                                                                                                         | M    | must   | UI3-02, UI1-05 | Each workspace opens its panels; a saved layout comes back after a restart                        |
| UI3-04 | The menu bar (File, Edit, Assets, Entity, Component, Sequence, Agent, Build, Window, Help) made from command metadata, with keys and enable states                                                                                                                                                                               | M    | must   | UI4-01         | Each menu item runs a command; a disabled item says why                                           |
| UI3-05 | The main toolbar: the transform tools, pivot and space, snaps; Play, Pause, Step and the time in the centre; agent state, search, workspace and layout menus at the right                                                                                                                                                        | M    | must   | UI3-01, UI4-01 | The toolbar works by keyboard and shows the state of each tool                                    |
| UI3-06 | The status bar: save state, selection count, jobs, problem counts, agent activity, backend, tier and frame rate, notifications                                                                                                                                                                                                   | S    | must   | UI3-01         | Each item opens its panel on a click                                                              |
| UI3-07 | Search and ask (⌘K): one box for commands, entities, assets, files, settings and docs; a sentence that matches nothing offers "Ask the agent"; ⌘O opens the same box with the scene filter                                                                                                                                       | M    | must   | UI4-01         | 30 test queries find their target in the first three results                                      |
| UI3-08 | Notifications and dialogs: toasts, one dialog set (confirm, prompt, choice), the unsaved-changes guard (`beforeunload`), the confirm policy of [shell.md](shell.md) §9; the notice bar goes                                                                                                                                      | M    | must   | UI3-01         | No flow uses the notice bar; a close with unsaved changes asks                                    |
| UI3-09 | Focus and keys v2: a visible focus ring per panel, key contexts per panel, held keys and modal keys in the key map, a key sheet on `?`                                                                                                                                                                                           | M    | must   | UI3-02, UI4-01 | Each default key of shell.md works in its context; the key sheet lists it                         |
| UI3-10 | Themes in the editor: dark (default), light, navy and high contrast; a switch in Preferences and in the search box; no forced theme in any panel; no raw colours in the shell                                                                                                                                                    | M    | must   | UI0-08, UI3-01 | `no-raw-design-values` passes on the editor; picture tests in the four themes                     |
| UI3-11 | The panel registry (an internal API first): id, title, icon, component, default area, one or many, state save and restore, `when`; each core panel registers through it                                                                                                                                                          | M    | must   | UI3-02         | The Window menu lists each panel from the registry                                                |
| UI3-12 | Window identity: the title (`* scene · project · Scenity`), a favicon state; two windows of one project share the selection and the dirty state through the host                                                                                                                                                                 | S    | should | UI3-01, UI4-13 | A second window of a project shows the same selection and dirty state                             |
| UI3-13 | Small screens: the minimum size is 1280×720; under it, the side docks fold to tabs; the Hub works at 1024×700                                                                                                                                                                                                                    | S    | should | UI3-02         | Picture tests at three sizes                                                                      |

### Phase UI4: One command layer and agent access

**Goal.** Each action of the editor is one command with metadata, an actor and a schema, so menus, keys, the search
box, the history and the agent tools come from one place. The agent works in a view of its own and never moves the
person's view. **Exit:** a test fails when an action has no command, and every command runs as an agent tool.

| ID     | Task                                                                                                                                                                                                                                                                                                                                                        | Size | Prio   | Needs          | Done when                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| UI4-01 | One command registry for the editor window: merge the scene registry, the sequence registry and the page key commands; each command has an id, a label, a description for agents, an icon, a category, a menu path, an args schema (zod), keys, `when` and an undo kind                                                                                     | L    | must   | UI3-01         | `commands()` lists every action of the editor; a test fails on an action with no command                                 |
| UI4-02 | Inspector edits as commands: `component.set`, `component.add`, `component.remove`, `component.reset`, with field labels in the history                                                                                                                                                                                                                      | M    | must   | UI4-01         | Undo names the field; an agent sets a value through `scene_command`                                                      |
| UI4-03 | Creation, file and project commands: `entity.create.<preset>`, `scene.new`, `scene.open`, `scene.save`, `scene.saveAs`, `scene.close`, `sequence.new`, `prefab.create`, `material.new`, `project.set`                                                                                                                                                       | M    | must   | UI4-01         | Each one runs from the search box and as an agent tool                                                                   |
| UI4-04 | The actor of each run: the person, an agent session, a script or a plugin; history steps keep it; the History panel and the activity log show it                                                                                                                                                                                                            | M    | must   | UI4-01         | An agent step shows its session name and colour in the history                                                           |
| UI4-05 | Tools from commands: `scene_commands` gives the JSON Schema of each command; `scene_command` checks the args; job tools (`job_run`, `job_status`, `job_output`) give the CLI commands to agents; the core tools lose the lab words ("take", "tune", "the 3D lab"); old names stay as aliases for one phase                                                  | M    | must   | UI4-01, UI1-09 | An agent runs each command of the catalogue in a test with checked args; a test finds no lab word in the core tool texts |
| UI4-06 | UI tools: `ui_state` (panels, workspace, selection, open scene, time), `ui_reveal` (select, frame, open a panel, show a field), `ui_highlight` (a callout on a part of the UI), `ui_notify`                                                                                                                                                                 | M    | should | UI3-11         | The agent shows a person the exposure field with one tool call                                                           |
| UI4-07 | The page bridge in the studio: the editor window talks to the host over the studio WebSocket, with no workbench frame; the frame relay stays for embeds and remote mode                                                                                                                                                                                     | M    | must   | UI1-03         | The tool tests of the workbench pass with no workbench page                                                              |
| UI4-08 | The shadow view: `scene_frame` and `scene_sheet` draw in a hidden view with its own camera and clock (a warm page of the scene pool when no window is open); the person's view never moves                                                                                                                                                                  | M    | must   | UI4-07         | A test checks that the camera, the time and the selection stay the same over 20 agent frames                             |
| UI4-09 | One state call: `studio_state` gives the project, the open scene, the selection, the top entities, the prefabs, the sequences, the open problems and the agent mode in one small answer                                                                                                                                                                     | S    | must   | UI4-07         | The answer for the showroom is under 4 KB; the agent prompt names it as the first call                                   |
| UI4-10 | Atomic tool calls: a tool call with many ops applies all or none and makes one named undo step                                                                                                                                                                                                                                                              | M    | must   | UI4-01         | A failed op in a batch of 10 leaves the document as before                                                               |
| UI4-11 | The activity log: each command run (person or agent) as one line with its call text; copy a line as a script call or as a prompt                                                                                                                                                                                                                            | M    | should | UI4-04         | The log of a session replays into an empty copy and gives the same document                                              |
| UI4-12 | Adjust the last action: a small panel changes the args of the last command and runs it again as the same undo step                                                                                                                                                                                                                                          | M    | could  | UI4-01         | Duplicate with an offset, then change the offset in the panel                                                            |
| UI4-13 | Documents in the host: the project session in the host holds the open documents, their histories and the change sets; editor pages are clients that send commands and get ops; a drag stays local until its end; agents edit a project with no open window. 2026-10-20 (the owner): the histories and the change sets stay in the windows (architecture.md) | L    | must   | UI1-01, UI4-01 | An external agent edits a closed project; two windows and the agent edit one scene and stay equal                        |

### Phase UI5: The agent workspace

**Goal.** The agent works in the editor, next to the person, with the selection as context. Each turn is one change set
that the person reviews where they work, each prompt is a checkpoint, the permission mode is always visible, and any
agent (built in or external) uses the same tools. **Exit:** journey J9 passes in the editor window with no workbench
page, and the agent benchmark runs through the new panel.

| ID     | Task                                                                                                                                                                                                                                                                                                                                          | Size | Prio   | Needs                   | Done when                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ----------------------- | -------------------------------------------------------------------------------------- |
| UI5-01 | The agent panel: a dock panel with session tabs (⌘T for a new one), the composer, the transcript, model and effort, the mode switch, the cost and context meter, Stop; it uses the agent sessions of the host ([agents.md](agents.md) §3)                                                                                                     | L    | must   | UI3-02, UI4-07          | J9 runs from the panel with no workbench page                                          |
| UI5-02 | Context chips and mentions: chips that come by themselves (scene, selection, time, camera, panel); `@` for entities, assets, files, rules, sequences and commands; drag items into the composer; attach a picture or a region of the view                                                                                                     | M    | must   | UI5-01                  | The context packet holds each chip; a removed chip leaves the packet                   |
| UI5-03 | Transcript cards: a tool call as a readable card (command label, target, pictures), file diffs, runs with their output, rule results; fold the details; "Show in the scene" on a card                                                                                                                                                         | M    | must   | UI5-01                  | Each core tool has a card; the raw JSON is one click away                              |
| UI5-04 | Change sets: the scene ops of a turn form one change set (an override layer) with a title and a summary; ghosts in the agent colour in the views; marks in the hierarchy, the inspector, the timeline and the Project window; the Review panel lists the ops by entity with the old and new value; accept or reject all, per entity or per op | L    | must   | UI4-04, UI4-10, UI12-05 | In J9 a person accepts 3 of 5 changes of a turn; the history has one step              |
| UI5-05 | One turn record: the change set, the file snapshots, the runs, the frames and the checks of a turn; "Undo the turn" reverts the document ops and the files together                                                                                                                                                                           | L    | must   | UI5-04                  | A turn that edits a scene and a plugin file goes back fully with one action            |
| UI5-06 | Checkpoints: each prompt makes one; the transcript shows them; preview (a frame and a diff) and restore (documents and files); a restore keeps the conversation                                                                                                                                                                               | M    | must   | UI5-05                  | A restore after three turns gives the files and documents of turn one                  |
| UI5-07 | Permission modes: Ask, Review (the default) and Auto per session; Allow, Ask or Deny per kind of action (scene edits, file writes, runs, imports, network, Git); the mode is visible in the composer; roles limit the choice                                                                                                                  | M    | must   | UI5-01                  | A test for each mode and kind; Auto needs a budget                                     |
| UI5-08 | Plan mode: the agent writes a plan card (steps, files, risks) for approval; the plan is saved in `.scenity/plans/`; the steps tick during the run; a summary at the end                                                                                                                                                                       | M    | should | UI5-03                  | A plan of 5 steps runs with ticks; a denied plan changes nothing                       |
| UI5-09 | Presence: the agent colour; "in progress" marks on what the agent works on; its camera as a frustum in the Scene view; "Follow the agent"; its activity in the status bar; it never moves the person's camera and never takes the focus                                                                                                       | M    | must   | UI4-08, UI5-04          | During J9 the person sees what the agent works on with no change of the view           |
| UI5-10 | The inline prompt (⌘I): in the Scene view (on the selection or a point), on an inspector field or component, a hierarchy row, a timeline range, an asset tile, a problem; the result is a change set in place                                                                                                                                 | M    | must   | UI5-04                  | "Make this warmer" on a light gives a change set on its colour                         |
| UI5-11 | Questions and approvals as cards in the panel, with a notification when the agent waits                                                                                                                                                                                                                                                       | S    | must   | UI5-01                  | An agent question with 3 options gets its answer in the panel                          |
| UI5-12 | Project instructions: a panel edits the project's `AGENTS.md` (and shows `CLAUDE.md`); the agent context includes them; a project skills folder                                                                                                                                                                                               | S    | should | UI5-01                  | An instruction ("never move the floor") changes the agent result in a test             |
| UI5-13 | Recipes: saved prompts with parameters as commands (search box, menus, Hub, `/` in the composer); project, user and plugin recipes                                                                                                                                                                                                            | M    | should | UI5-01, UI4-01          | "Light for a product shot" runs from the search box on the showroom                    |
| UI5-14 | Notes as tasks: pin a note on an entity or a point; "Send to the agent"; the agent links its change set to the note and marks it done                                                                                                                                                                                                         | M    | should | UI5-04, UI7-14          | A note on a chair becomes a turn with its change set                                   |
| UI5-15 | External agents: the studio MCP server over stdio (`scenity mcp`) and HTTP; one-click setup for Claude Code, Codex, Cursor and Claude Desktop; a connection request that the owner allows; external sessions are actors with presence and change sets                                                                                         | M    | must   | UI4-05, UI5-04, UI4-13  | Claude Code in a terminal edits the open scene, and the change set waits in the studio |
| UI5-16 | The terminal panel: the Claude Code terminal and a shell as dock panels, with the role rules of the host                                                                                                                                                                                                                                      | M    | must   | UI3-02                  | The workbench terminal tests pass in the studio                                        |
| UI5-17 | Cost and limits: cost and tokens per session and per day; budgets for Auto mode and background tasks                                                                                                                                                                                                                                          | S    | should | UI5-01                  | A budget stops a session and says why                                                  |
| UI5-18 | No agent: every feature works with no agent; each agent entry point says how to connect one                                                                                                                                                                                                                                                   | S    | must   | UI5-01                  | Journeys J1 and J3 to J8 pass with the agent off                                       |
| UI5-19 | Tasks and background agents: the Tasks panel lists agent tasks (prompt, state, actor, change set, budget, branch) and searches old ones; a background task has a budget, a time limit and a gate (the rules by default); a review pack and a notification at the end; its turn waits in Review                                                | L    | must   | UI5-05, UI4-13          | J12 passes; the workbench loop tests pass in the studio                                |
| UI5-20 | Parallel agents and variants: split a task over 2 to 6 agents, or give one task to many (variants); each one works on its own change set (a worktree for files); a grid of frames compares the results; keep one or merge                                                                                                                     | L    | should | UI5-19, UI7-10          | J11 passes                                                                             |

### Phase UI6: The core panels

**Goal.** The panels that a Unity user expects, in the dock: Scene view with overlays, Game view, hierarchy,
inspector, Project window, console, problems, history, search and scene tabs. **Exit:** journeys J3 and J4 pass by
mouse and by keyboard, with no URL parameter and no terminal.

| ID     | Task                                                                                                                                                                                                                                                                                                                                   | Size | Prio   | Needs           | Done when                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | --------------- | ------------------------------------------------------------------------------- |
| UI6-01 | The Scene view panel: the viewport in a dock panel; overlays that dock to its edges and fold (Tools, Tool settings, View options, Cameras, Grid and snap, Orientation, Stats, Agent); the overlay menu on the backtick key                                                                                                             | L    | must   | UI3-02          | Each overlay docks, folds and keeps its place after a restart                   |
| UI6-02 | The orientation gizmo: click an axis to look along it; perspective and orthographic; top, front and side views; the editor camera menu                                                                                                                                                                                                 | M    | must   | UI6-01          | The six views and the projection switch work by mouse and by key                |
| UI6-03 | Split views: 1, 2 or 4 views, each with its own camera and view mode                                                                                                                                                                                                                                                                   | L    | should | UI6-01          | Four views of the showroom keep 60 fps on the reference machine                 |
| UI6-04 | The Game view: the scene through a document camera in the player path; resolution and aspect presets; tier, backend and worker switches (no URL needed); stats; Play brings it to the front                                                                                                                                            | L    | must   | UI6-01          | Each URL-only option of the scene page has a control here or in Preferences     |
| UI6-05 | Hierarchy v2: a virtual tree for 10,000 entities, an icon per main component, prefab colours, agent marks, search words, the create menu (+), drops from the Project window, tree keys, range select                                                                                                                                   | M    | must   | UI3-11, UI4-01  | 10,000 entities scroll at 60 fps; rename, move and delete work by keyboard only |
| UI6-06 | Inspector v2: the header (name, ID with copy, tags, visible), component cards with icons and menus (Reset, Copy and Paste values, Remove, Docs, Ask the agent), lock, more than one inspector, the raw JSON mode, prefab override marks (bold value and margin bar), agent change marks, "Add component" with search and groups        | L    | must   | UI4-02          | J4 by keyboard only; two locked inspectors show two entities                    |
| UI6-07 | The Project window: a folder tree and a grid or list of the project folder; asset tiles with stills; scenes, prefabs, materials, sequences, rules and plugins with their icons; search words and filters; the create menu; rename and move (IDs stay); drag to the views, the hierarchy and the fields; reveal on the disk; favourites | L    | must   | UI3-11, UI1-06  | J3 with the Project window only; a moved model keeps its references             |
| UI6-08 | The Console: the logs of the page, the worker, the dev server, the host, the plugins, the jobs and the agent tools; counters as filters, fold repeats, search, a detail pane; a click selects the entity or opens the file                                                                                                             | M    | must   | UI3-11          | A worker error shows once with its count and its source                         |
| UI6-09 | The Problems panel: failed rules, missing assets, rights issues, unknown components, schema warnings, budget overruns, plugin errors, a stale build; each with "Go to", its fixes and "Ask the agent to fix"                                                                                                                           | M    | must   | UI6-08          | Each kind of problem has a fixture test; J7 starts from this panel              |
| UI6-10 | The History panel: the undo stack with labels, actors and change set groups; a click goes back to a step                                                                                                                                                                                                                               | M    | must   | UI4-04          | A click on step 3 of 10 undoes 7 steps as one action that redo brings back      |
| UI6-11 | The Search window: providers (entities, assets, files, commands, settings, docs), query words (`t:`, `c:`, `tag:`), a table view with editable columns, saved searches                                                                                                                                                                 | M    | should | UI3-07          | `c:light intensity>2` lists the lights with an editable intensity column        |
| UI6-12 | Selection tools: back and forward in the selection history; select by tag, component or kind; select children; invert; copy and paste across scenes and projects                                                                                                                                                                       | S    | should | UI4-01          | Each one is a command with a key or a menu entry                                |
| UI6-13 | Scene tabs: the open scenes as tabs with dirty marks and close guards; the start screen becomes the Scenes panel                                                                                                                                                                                                                       | M    | must   | UI3-01          | The 72 px scene select is gone; two scenes open as tabs                         |
| UI6-14 | Undo and redo buttons, the save state, and the conflict choice (Reload, Overwrite, see the diff) as a dialog                                                                                                                                                                                                                           | S    | must   | UI3-08, UI12-05 | A file changed on the disk shows a dialog with its semantic diff                |

### Phase UI7: Authoring

**Goal.** A person can make any scene that the format allows without a text editor: presets for each built-in kind,
a widget for each special field, handles in the view, prefabs with overrides, materials, variants and placement
helpers. **Exit:** journeys J4 and J5 pass, and the prefab limits listed in `docs/editor.md` are gone.

| ID     | Task                                                                                                                                                                                                                                                                    | Size | Prio   | Needs          | Done when                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | -------------- | ------------------------------------------------------------------------------------------- |
| UI7-01 | The create menu and presets: Empty, shapes (box, plane, cylinder, sphere), lights (five kinds), camera (also "from the view"), audio source, socket, path, stand point, obstacle, note, prefab instance, character (from a model); plugin presets                       | M    | must   | UI4-03         | J4 with the create menu; each preset is one undo step and one agent command                 |
| UI7-02 | Inspector widgets for the environment hints: `fog`, `bloom`, `ambientOcclusion`, `selectionOutline`                                                                                                                                                                     | M    | must   | UI6-06         | Each hint has a widget with a live preview and a component test                             |
| UI7-03 | Inspector widgets for lights and cameras: `shadowCamera`, `safeFrame`, `pointOrEntity`                                                                                                                                                                                  | M    | must   | UI6-06         | Each widget edits by fields and by a handle in the Scene view                               |
| UI7-04 | Inspector widgets for models: `lodChain`, `materialOverride`, `materialOverrides`, `clipSource`, `prefabOverrides`                                                                                                                                                      | M    | must   | UI6-06         | Each widget has a component test; a material override picks its part in the view            |
| UI7-05 | The Lighting window: background, tone mapping, exposure, the environment map with previews, fog, the effects; lighting presets; "Ask the agent to light this"                                                                                                           | M    | must   | UI7-02         | The lighting steps of J4 use this window only                                               |
| UI7-06 | Handles in the Scene view: light range and cone, camera frustum and target, sockets, path points (add, move, delete), obstacle footprints, stand points and facing, audio range                                                                                         | L    | must   | UI6-01         | Each handle edits its component with one undo step per drag                                 |
| UI7-07 | Prefabs v2: make a prefab from the selection (menu, or a drag to the Project window); prefab mode with a breadcrumb and an "in context" view; the overrides list with apply and revert per item; unpack; edits inside an instance (rename, hide, move) become overrides | L    | must   | UI6-06, UI6-07 | J5 passes; the prefab limits in editor.md are gone                                          |
| UI7-08 | Prefab variants and nested prefabs (a format change needs an ADR 02 update)                                                                                                                                                                                             | M    | could  | UI7-07         | A variant of a door prefab overrides one part                                               |
| UI7-09 | Material editor v2: a preview object; texture slots with pictures; drop textures; presets; a type change keeps the values that the new type takes; assign by a drop on a mesh part in the view                                                                          | M    | must   | UI6-07         | The material steps of J4 by drag and drop only                                              |
| UI7-10 | Variants (override layers): list the variants of a scene, show one in the view, make one from the current edits, compare two (wipe), apply to the base                                                                                                                  | M    | should | UI5-04         | A variant made from edits gives the same frame as the edits                                 |
| UI7-11 | Layout tools v2: Measure, Reach, Clearance, Walk paths and Visibility as Scene view tools with readouts in an overlay                                                                                                                                                   | M    | must   | UI6-01         | Each tool works from the Tools overlay and shows its readout                                |
| UI7-12 | Placement helpers: align and spread, drop to the floor, put on, against, facing, near; find an empty space; each one is a command, so agents use it too                                                                                                                 | M    | should | UI4-01         | An agent puts 4 chairs around a table with the relation commands, and no overlap rule fails |
| UI7-13 | Tags and pick layers: a tags list and the pick layers of `pickable`, with a rename across the scene                                                                                                                                                                     | S    | should | UI6-06         | A tag rename changes each entity in one undo step                                           |
| UI7-14 | Notes in the views: pins for the `annotation` component and for note documents, with filters                                                                                                                                                                            | M    | should | UI6-01         | Notes show in the Scene view and in the hierarchy                                           |
| UI7-15 | Presets of the person: "Save as a preset" for a component or an entity; presets in the create menu and in the component menu                                                                                                                                            | S    | could  | UI7-01         | A saved light preset applies to a second light                                              |

### Phase UI8: Time, animation and play

**Goal.** Every part of the time model has a UI: sequences and all track kinds, curves, keys from the inspector, play
mode, recordings, simulations, the animator, characters, walks, clips and audio. **Exit:** journey J6 passes, and an
agent's sequence edits wait for review like scene edits.

| ID     | Task                                                                                                                                                                                                                                                                                | Size | Prio   | Needs          | Done when                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | -------------- | ------------------------------------------------------------------- |
| UI8-01 | The Timeline v2: a sequence picker, New sequence, duration, loop, the `initial` state, markers, tracks by entity, all nine track kinds (also `animation`), a camera cut track, audio waveforms, forms for `event` and `action` keys from the simulation schema, zoom, pan and snaps | L    | must   | UI3-11, UI4-01 | J6 passes; each track kind has an e2e step                          |
| UI8-02 | The curve editor v2: tangents and eases (also bezier), many curves at once, frame all                                                                                                                                                                                               | M    | must   | UI8-01         | Each ease of the format can be made in the editor                   |
| UI8-03 | Keys from the inspector: a key mark beside each field that a track drives; a click adds a key; record mode v2                                                                                                                                                                       | M    | must   | UI8-01, UI6-06 | J6 with inspector keys only                                         |
| UI8-04 | Sequence edits as change sets: an agent's sequence edits wait for review like scene edits                                                                                                                                                                                           | M    | must   | UI5-04, UI8-01 | An agent adds a camera move; the keys show as ghosts until accepted |
| UI8-05 | The clock in the main toolbar: play, pause, step, the time field, the speed, the loop range                                                                                                                                                                                         | S    | must   | UI3-05         | Each clock key of editor.md also works from the toolbar             |
| UI8-06 | Onion skins and ghosts in the Scene view, from `runtime-dev`                                                                                                                                                                                                                        | M    | should | UI6-01         | Onion skins of 5 times show for a moving entity                     |
| UI8-07 | Play mode v2: the Game view in front, input map hints, the Keep dialog, Replay, the list of input recordings (save, load, delete), Play in a window                                                                                                                                 | M    | must   | UI6-04         | The play steps of J6 pass; a recording replays with the same frames |
| UI8-08 | Streams and simulations: attach a recorded stream, see the state of a live source, watch the simulation state at the time now                                                                                                                                                       | M    | should | UI8-01         | The traffic sample shows its car states at a time                   |
| UI8-09 | The Animator window: states, transitions, parameters, layers, blends; a list editor first, then a graph                                                                                                                                                                             | L    | should | UI6-06         | The animator of the characters sample can be edited and previewed   |
| UI8-10 | Character setup: the bone map of the rig profile, a retarget preview, look variants, IK goals with handles, foot lock                                                                                                                                                               | L    | should | UI7-06         | A Mixamo model maps its bones and plays a clip of another rig       |
| UI8-11 | Walks: a route editor over stand points and obstacles, with a preview                                                                                                                                                                                                               | M    | should | UI7-06         | The route of the walkthrough sample changes in the view             |
| UI8-12 | The clip browser: the clips of a model with a preview; drop a clip on the timeline as an animation key                                                                                                                                                                              | M    | should | UI8-01         | A dropped clip plays in the Scene view                              |
| UI8-13 | Audio: a preview in the inspector, the spatial range handle, audio keys on the timeline                                                                                                                                                                                             | S    | could  | UI8-01         | An audio key plays at its time in play mode                         |

### Phase UI9: Assets

**Goal.** The whole asset pipeline has a UI: import with settings and rights, previews, the build, stills, rights
records, approvals, the release gate, the asset database tools and asset sources. **Exit:** journey J3 and the rights
step of the quickstart need no text editor and no terminal.

| ID     | Task                                                                                                                                                                                                         | Size | Prio   | Needs           | Done when                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------ | --------------- | ----------------------------------------------------------------------------------------- |
| UI9-01 | The import dialog: files and folders; the settings form of each importer from its schema (scale, up, origin, decimate, rig, kind); the rights record at import (pick one or make one); many files at once    | M    | must   | UI6-07          | J3 with a choice of rights at import; a picked record replaces the `imports.yaml` default |
| UI9-02 | The import queue: progress per file, Blender jobs, errors with fixes, cancel                                                                                                                                 | M    | must   | UI9-01, UI1-09  | An FBX import with no Blender shows the doctor fix                                        |
| UI9-03 | The asset inspector: a preview (turntable for models, texture channels, HDR, an audio player, a material ball), the facts (triangles, meshes, size, LODs, clips, rig), the record fields and an import again | L    | must   | UI6-06          | Each asset kind of formats.md has a preview test                                          |
| UI9-04 | Stills: make or refresh stills (a job); stale marks on tiles                                                                                                                                                 | S    | must   | UI1-09          | A new import gets its still with no command line                                          |
| UI9-05 | The asset build panel: the state per asset (built, stale, failed), run the build (a job), build settings per asset (codecs, LODs), an LOD preview in the view                                                | M    | must   | UI1-09, UI9-03  | `assets build` runs from the panel; a stale asset has a mark                              |
| UI9-06 | Rights and licences: a rights record form (SPDX picker, source, author, date, allowed use, web delivery); assign to many assets; the project licence policy (`release.licences`); status marks on tiles      | M    | must   | UI9-03          | The rights step of the quickstart needs no text editor                                    |
| UI9-07 | Approvals: a review queue per role; approve or reject with a note (writes the approval file); stale approvals after a source change                                                                          | M    | should | UI9-06          | An approval made in the UI passes `release-check`                                         |
| UI9-08 | The release check panel: the gate result per asset, with fixes                                                                                                                                               | S    | must   | UI9-06, UI1-09  | `assets release-check` runs from the panel and links each failure                         |
| UI9-09 | Asset database tools: fix missing references (relink by ID or name), Used by, broken references in Problems, a new ID                                                                                        | M    | should | UI6-09          | A deleted source shows in Problems with a relink fix                                      |
| UI9-10 | Asset sources: a provider API (search, preview, licence, download, import with a rights record); Poly Haven built in (CC0); plugins add others                                                               | L    | should | UI9-01, UI13-02 | A Poly Haven sky imports with its rights record in 3 clicks                               |
| UI9-11 | Generated assets through providers (text to model, texture or sky) with a rights record of kind "generated" and the cost before the run                                                                      | M    | could  | UI9-10          | A generated model imports with its record and shows its cost first                        |
| UI9-12 | Export a scene as GLB (a job), with options                                                                                                                                                                  | S    | should | UI1-09          | The exported file passes the glTF validator                                               |
| UI9-13 | Hot reload state: a changed source imports again and swaps; a toast says so                                                                                                                                  | S    | must   | UI3-08          | A source change shows one toast and the new model                                         |

### Phase UI10: Rules, checks, quality and performance

**Goal.** Rules are made and read in the UI, plugin metrics work in the editor, the check runs from the UI, and the
quality and speed of a scene are visible and adjustable. **Exit:** journey J7 passes with no text editor, and every
URL-only render option has a control.

| ID      | Task                                                                                                                                                                                      | Size | Prio   | Needs           | Done when                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | --------------- | -------------------------------------------------------------------- |
| UI10-01 | The rules editor: make and edit rules in a scene, a sequence, the project or a rules file; a metric picker with argument forms from the metric schemas; scope, level, provisional, note   | L    | must   | UI6-06          | J7 makes a rule with no text editor                                  |
| UI10-02 | "Save as a rule" from a layout tool readout or a measure                                                                                                                                  | S    | must   | UI10-01, UI7-11 | A measure becomes a distance rule with its value now as the limit    |
| UI10-03 | Plugin metrics in the editor page: load the metric libraries of the dev faces, so plugin rules show their value, not "unknown"                                                            | M    | must   | —               | A sample rule with a plugin metric passes the save gate              |
| UI10-04 | The Rules panel v2: groups, filters, the graph, the rules log (overrides and reasons)                                                                                                     | M    | must   | UI10-01         | Each override of the log shows its reason and its scene hash         |
| UI10-05 | The check job: `scenity check` from the UI, with its results in Problems                                                                                                                  | S    | must   | UI1-09, UI6-09  | The page check and the CLI check give the same table for the samples |
| UI10-06 | The Performance panel: live stats (frame time, draw calls, triangles, memory, the backend and its reason), the cost per entity (inspect report v2), the tier, backend and worker switches | M    | must   | UI6-04          | Each value of `stats()` shows in the panel                           |
| UI10-07 | The bench runner: `scenity bench` as a job; the results against the budgets, with history                                                                                                 | M    | should | UI1-09          | Three runs show as a trend                                           |
| UI10-08 | The budgets editor: `quality.budgets` and `build.budgets` forms beside the current values                                                                                                 | M    | should | UI12-01         | A budget change shows its effect on the next bench and build         |
| UI10-09 | Debug layers in the View options overlay, also the layers of plugins                                                                                                                      | S    | must   | UI6-01          | Each generic layer toggles from the overlay                          |
| UI10-10 | Layout search: "find a place for this that passes the rules" (the search ops of SE7-06)                                                                                                   | M    | could  | UI10-01         | A search places a chair that passes three rules                      |
| UI10-11 | The frame index browser: the Picker as a panel; frames by sequence, camera and time; compare two; stale marks                                                                             | M    | should | UI4-08          | The index of the walkthrough sample shows in the panel               |

### Phase UI11: Build, ship and visual tests

**Goal.** A person builds, previews, embeds, tests and publishes a project from the UI. **Exit:** journey J8 passes
with no terminal.

| ID      | Task                                                                                                                                                                                                                           | Size | Prio   | Needs           | Done when                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------ | --------------- | ------------------------------------------------------------------------------------------------------- |
| UI11-01 | The Build window: build settings (output, budgets); run the build (a job); the report (entry sizes against the budgets, the marker gate); open the built player                                                                | M    | must   | UI1-09          | J8 builds with no terminal                                                                              |
| UI11-02 | Player preview and embed: the built player in a panel or a window; an embed snippet for the web component, Vue and a script tag, with the player options                                                                       | M    | must   | UI11-01         | The snippet runs in a plain HTML file test                                                              |
| UI11-03 | Shots and baselines: a shot dialog (cameras, time, size, backend); the baselines list; add from a shot; compare with a diff overlay; accept a new baseline (the owner confirms); `verify` as a job; a shot as the scene poster | L    | must   | UI1-09          | `scenity verify` results show with the diff of a failed shot; a poster set from a shot shows in the Hub |
| UI11-04 | The render queue: sheet and clip dialogs (ranges, cameras, fps, size); a queue under the GPU lock; an output gallery                                                                                                           | M    | should | UI11-03         | A clip of the walkthrough comes out with no terminal                                                    |
| UI11-05 | Publish: export `dist/` as a zip; publish targets from plugins; the release check runs first                                                                                                                                   | M    | should | UI11-01, UI9-08 | A failed release check stops the publish and gives its reasons                                          |
| UI11-06 | The scene pool controls (start, state, stop) in Preferences → Advanced                                                                                                                                                         | S    | could  | UI1-09          | The pool state shows and changes from the UI                                                            |

### Phase UI12: Project, settings and version control

**Goal.** No project file field needs a text editor; preferences, keys, jobs, autosave and version control have their
windows; document changes read as meaning, not as JSON. **Exit:** every field of `scenity.project.json` has a form,
and the semantic diff is the one diff view of documents in the studio.

| ID      | Task                                                                                                                                                                                                                                      | Size | Prio   | Needs            | Done when                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ---------------- | ---------------------------------------------------------- |
| UI12-01 | The Project settings window: each field of `scenity.project.json` as a form from the project schema (scenes, sequences, asset roots, plugins, rules, units, quality, build, release, workbench), with search and checks; canonical writes | L    | must   | UI4-03           | No field of the project file needs a text editor           |
| UI12-02 | The Preferences window: the user settings (view, camera speeds, theme, language, agent defaults, autosave, recent count), with search                                                                                                     | M    | must   | UI1-05           | Each user setting of editor.md is in the window            |
| UI12-03 | The Shortcuts window: a keyboard picture, contexts, clashes, import and export of the key map                                                                                                                                             | M    | should | UI3-09           | A person changes a key on the keyboard picture             |
| UI12-04 | The version control panel: changes with semantic diffs of documents, file diffs, commit by the owner, branches and worktrees, the branches of agent tasks                                                                                 | L    | must   | UI12-05          | The workbench Changes tests pass in the studio             |
| UI12-05 | The semantic diff view for scenes, prefabs and sequences (by entity and component, with frames), used by Review, change sets, conflicts and Git                                                                                           | M    | must   | UI3-01           | The diff of two showroom versions names each changed value |
| UI12-06 | Runs and the gate: forms for `workbench.runs` and `gate`; run buttons in the Jobs panel                                                                                                                                                   | S    | should | UI12-01, UI12-07 | A run made in the form starts from the Jobs panel          |
| UI12-07 | The Jobs panel: all jobs (commands, runs, builds, imports), their outputs (pictures, files), history, run again                                                                                                                           | M    | must   | UI1-09, UI3-11   | Each job kind of UI1-09 shows here with its output         |
| UI12-08 | Autosave and recovery: drafts kept by the host as well as the browser; a recovery dialog after a crash; autosave per project as an option                                                                                                 | M    | must   | UI1-05           | A closed browser tab gets its unsaved edits back           |
| UI12-09 | Format upgrades: an older document format offers an upgrade with its diff                                                                                                                                                                 | S    | should | UI12-05          | An old fixture upgrades with a shown diff                  |

### Phase UI13: Plugins and extensibility

**Goal.** A plugin extends the studio through one face and the same API as the core panels; a person adds, makes and
fixes plugins in the UI; a broken plugin never breaks the editor. **Exit:** journey J10 passes, and no core panel
uses a hook that a plugin cannot use.

| ID      | Task                                                                                                                                                                                                                                                                                                                         | Size | Prio   | Needs            | Done when                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ---------------- | ---------------------------------------------------------------------------------------- |
| UI13-01 | The studio face of a plugin: the `scenity.studio` field (else `studio.ts` or `src/studio.ts`) names a module whose default export is `defineStudioPlugin(...)`                                                                                                                                                               | M    | must   | UI0-04, UI3-11   | The spin sample plugin adds a panel through its studio face                              |
| UI13-02 | The contribution points of [extensibility.md](extensibility.md) §3: panels, inspector widgets, component icons, menus, toolbar items, create presets, overlays, Scene view tools, importers, previews, asset sources, settings pages, templates, recipes, agent tools and context, status items, problem sources, docs links | L    | must   | UI13-01          | Each point has an example and a test                                                     |
| UI13-03 | The core panels use the same API: the hierarchy, inspector, Project window, Console, Problems, Timeline and agent panel register as contributions                                                                                                                                                                            | M    | must   | UI13-02          | A test fails when a core panel imports a hook that the plugin API does not give          |
| UI13-04 | The Plugins window: the plugins of the project (faces, errors, version); add (a package, a folder, a new one); remove; docs; a notice when a restart is needed                                                                                                                                                               | M    | must   | UI13-01, UI12-01 | A person adds the physics plugin with no text editor                                     |
| UI13-05 | The new plugin wizard: a folder plugin with the parts that the person picks (component, system, simulation, presenter, metric, studio panel); open the files; "Ask the agent to write it"                                                                                                                                    | M    | must   | UI13-04          | J10 passes; the new component shows in the inspector after a reload                      |
| UI13-06 | Hot reload and error isolation: an error boundary per contribution; plugin errors in the Console and in Problems; safe mode (no plugins)                                                                                                                                                                                     | M    | must   | UI13-02          | A panel that throws shows its error card, and the editor works on                        |
| UI13-07 | The lab face in the studio: an `EditorPlugin` of the lab page runs as a workspace of the studio, or a written migration path to the studio face                                                                                                                                                                              | L    | should | UI13-02          | The lab fixture runs in a studio workspace                                               |
| UI13-08 | Extension docs: "The studio face" in `docs/plugins.md`, a guide to each point, the spin sample with a panel and a widget                                                                                                                                                                                                     | M    | must   | UI13-02          | A developer adds a panel with the guide in 15 minutes (a usability test)                 |
| UI13-09 | API versions: an `apiVersion` field, deprecation warnings, tests of the public surface                                                                                                                                                                                                                                       | S    | must   | UI13-02          | A plugin with an old version gets a warning, not a crash                                 |
| UI13-10 | Plugin tools and commands in the UI: the tools of host faces and the commands of CLI faces show in the search box, the Jobs panel and the agent catalogue                                                                                                                                                                    | S    | should | UI4-05, UI1-09   | A host tool and a CLI face command run from the search box with forms from their schemas |

### Phase UI14: Learn, help, accessibility and polish

**Goal.** A new person learns the studio in minutes, help is one key away, everyone can use it by keyboard and screen
reader, it is fast, the docs follow it, and the old pages go. **Exit:** the targets of [vision.md](vision.md) §7 are
met in the second study and the second benchmark.

| ID      | Task                                                                                                                                                                                  | Size | Prio   | Needs           | Done when                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | --------------- | ---------------------------------------------------------------------- |
| UI14-01 | The tour: the first open of the editor shows 6 steps over the main panels; skip and replay from Help                                                                                  | M    | must   | UI3-03          | New people in UI14-08 finish the tour in under 2 minutes               |
| UI14-02 | Tutorials: steps with checks (scene queries) and highlights; the agent can guide a person ("Show me how") with `ui_highlight`                                                         | L    | should | UI4-06          | Three tutorials (first scene, prefab, sequence) pass as e2e tests      |
| UI14-03 | Help in context: F1 on a panel or field opens its docs section; tooltips with keys and a docs link; component docs from schema descriptions                                           | M    | must   | UI3-09          | Each panel and built-in component has a docs link that resolves        |
| UI14-04 | Empty states: each panel says what to do next and offers an agent prompt                                                                                                              | S    | must   | UI5-01          | A test lists each panel with its empty state                           |
| UI14-05 | Accessibility: keyboard-only use of every panel, screen reader names, focus order, AA contrast, reduced motion, high contrast; axe in CI                                              | L    | must   | UI3-10          | axe gives 0 serious issues on the 14 key screens                       |
| UI14-06 | Languages: every studio text in Fluent; pt-BR; a pseudo-locale check in CI                                                                                                            | M    | should | UI3-01          | `tools/editor-texts.ts` covers the studio and gives 0 findings         |
| UI14-07 | UI speed budgets: Hub first paint, editor ready time, a 10,000-entity hierarchy, a 50-component inspector, typing delay; a speed test suite                                           | M    | must   | UI6-05, UI6-06  | The budgets of [vision.md](vision.md) §7 pass on the reference machine |
| UI14-08 | The usability study, round 2, with the journeys of UI0-05                                                                                                                             | M    | must   | UI14-01         | The targets are met, or each gap has a task                            |
| UI14-09 | The agent benchmark v2 with the set of UI0-06                                                                                                                                         | S    | must   | UI5-04          | The targets are met, or each gap has a task                            |
| UI14-10 | Docs: `docs/studio.md`, a new `docs/editor.md`, the quickstart through the studio, pictures                                                                                           | M    | must   | UI14-08         | The quickstart has no terminal step after `scenity studio`             |
| UI14-11 | Retire the old parts: the workbench page, the old scene page shell, `dev:editor` as the lab page; notes for one phase                                                                 | M    | must   | UI5-16, UI12-04 | No doc names the workbench page as the way to work; its tests moved    |
| UI14-12 | The desktop shell (Tauri, SE8-09; decision Q7: after M8, the studio is web first): native menus, file dialogs, a window per project, the host starts with the app, `scenity://` links | L    | could  | UI1-02          | The app opens a project folder from the file manager                   |
| UI14-13 | Usage data: none by default; an opt-in local log for usability studies                                                                                                                | S    | could  | —               | The log is off by default and never leaves the machine                 |

### Phase UI15: Remote and shared review

**Goal.** A team can look at and review agent work from another machine. Real-time editing by many people stays a
non-goal (§8). **Exit:** a viewer opens a review link and leaves a note.

| ID      | Task                                                                                                                         | Size | Prio  | Needs   | Done when                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | ---- | ----- | ------- | ---------------------------------------------- |
| UI15-01 | The studio in remote mode: the host behind the gateway with the studio pages; roles in the UI with reasons, not hidden parts | M    | could | UI14-11 | A viewer sees why a control is off             |
| UI15-02 | Review links: share a change set or a turn with a viewer token (frames, diffs, notes)                                        | M    | could | UI15-01 | A viewer opens a review link and leaves a note |
| UI15-03 | Note threads on entities for a team                                                                                          | M    | could | UI5-14  | Two people reply in one thread                 |

---

## 5. Order of work and milestones

### 5.1 The critical path

UI0-02 → UI1-01 → UI1-03 → UI3-01 → UI3-02 → UI4-01 → UI4-13 → UI4-07 → UI5-01 → UI5-04 → UI5-05 → UI6-06 → UI7-07 →
UI14-08.

### 5.2 The parallel tracks

| Track                 | Phases        | Starts after                                     |
| --------------------- | ------------- | ------------------------------------------------ |
| A. Host and Hub       | UI1, UI2      | UI0-02                                           |
| B. Shell and commands | UI3, UI4      | UI0-02, UI0-07                                   |
| C. Agent              | UI5           | UI4-07 (UI5-04 needs UI12-05)                    |
| D. Editing panels     | UI6, UI7, UI8 | UI3-11                                           |
| E. Assets and quality | UI9, UI10     | UI6-07, UI1-09                                   |
| F. Ship and project   | UI11, UI12    | UI1-09; UI12-05 early for track C                |
| G. Extensibility      | UI13          | UI0-04, UI3-11                                   |
| H. Quality of the UI  | UI14          | a11y, languages and speed checks run from UI3 on |

### 5.3 The first slice

About two weeks of agent work: UI0-02 and UI0-03 (the two ADRs), UI1-01 to UI1-03 at spike level, UI2-01 and UI2-02
with the samples only, UI3-01 and UI3-02 with four panels (Scene view, hierarchy, inspector, agent), the part of
UI4-01 that the inspector and the gizmo need, and UI5-01 with UI5-04 for one change set with Accept and Reject. It
proves the process model, the shell and the agent loop together, before the large work of UI6 to UI8.

### 5.4 Milestones

| Milestone | Name               | Done when                                                                                                |
| --------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| M0        | Design agreed      | The must tasks of UI0: three ADRs accepted, the specs and tokens, the agent baseline                     |
| M1        | Starts empty       | The must tasks of UI1 and UI2: `scenity studio` → Hub → a new project → the editor, with no terminal     |
| M2        | One shell          | The must tasks of UI3 and UI4: the editor in the new shell; one command registry; tools from commands    |
| M3        | Agent-first editor | The must tasks of UI5 and UI6: the agent panel, change sets, checkpoints and the Unity-class core panels |
| M4        | Author anything    | The must tasks of UI7 and UI8: every component and every track kind in the UI                            |
| M5        | Assets and quality | The must tasks of UI9 and UI10: import to release, rules, checks and performance in the UI               |
| M6        | Ship and manage    | The must tasks of UI11 and UI12: build, shots, publish, project settings, jobs, semantic diffs           |
| M7        | Extensible         | The must tasks of UI13: the studio face with each contribution point, the core panels on the same API    |
| M8        | Release            | The must tasks of UI14: the targets of [vision.md](vision.md) §7, the docs, the old pages retired        |

---

## 6. Success measures

The measures and their targets are in [vision.md](vision.md) §7. UI0-05 and UI0-06 record the numbers of today;
UI14-07, UI14-08 and UI14-09 record the numbers at the end.

---

## 7. Risks

| Risk                                                                                             | Likelihood | Impact | Mitigation                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The scope (186 tasks) causes a long time with two half-done UIs                                  | High       | High   | Strangler steps (§3.1); milestones as review points; the old paths stay until UI14-11                                                    |
| The shell rewrite breaks the e2e specs or changes the gallery frames                             | Medium     | High   | The panels of today mount first in the new shell; the canvas compare hides panels; e2e on each task                                      |
| Documents in the host (UI4-13) add delay to edits or break the gizmo feel                        | Medium     | High   | A drag stays local until its end; ops stream in batches; a latency budget of one frame for a field edit; the spike of ADR 05 measures it |
| Vue reactivity over large scenes makes the panels slow                                           | Medium     | High   | Documents stay out of deep reactivity; panels read through selectors on op events; virtual lists; the speed suite of UI14-07             |
| One scene server serves every open project: a bad plugin of one project breaks the others        | Medium     | Medium | Project trust and safe mode; a project can get a scene server of its own later (ADR 05)                                                  |
| Change sets conflict with the person's own edits on the same values                              | Medium     | Medium | The conflict rules of ADR 06 (a newer person edit wins and marks the op); a Review that shows each conflict                              |
| A local web host with file and agent access is a target (DNS rebinding, CSRF, other local pages) | Medium     | High   | UI1-04 and UI1-12 before any public use; security tests in CI                                                                            |
| Opening a project runs its plugin code                                                           | High       | High   | Project trust and restricted mode (UI1-12)                                                                                               |
| Plugin UI code makes the editor slow or unstable                                                 | Medium     | Medium | Error boundaries, safe mode, a render budget per contribution (UI13-06)                                                                  |
| Too many panels make the studio hard to learn                                                    | Medium     | High   | Workspaces per task; a small default layout; the tour; the usability studies; search and ask as the one way in                           |
| The terms of the Agent SDK do not allow an npm host                                              | Medium     | Medium | Decision Q6; the agent part as an optional package; external agents over MCP always work                                                 |
| Agent cost or quality disappoints and people stop using the agent                                | Medium     | Medium | The benchmark (UI0-06, UI14-09); budgets; recipes for frequent tasks; every feature works with no agent (UI5-18)                         |
| The dock library does not fit (keyboard use, Vue 3, theming)                                     | Medium     | Medium | A spike in ADR 05 with the keyboard test; our own dock on Reka UI as the fallback                                                        |
| Two apps (workbench and studio) confuse people during the change                                 | High       | Low    | The workbench page names the studio from UI5 on; UI14-11 retires it                                                                      |

---

## 8. Non-goals

- Real-time editing of one project by many people at the same time (PlayCanvas-style). UI15 gives shared review only.
- A visual scripting editor and a node graph for materials (the non-goals of the engine plan stay). The animator graph
  of UI8-09 is an editor of the existing animator data, not a scripting system.
- A code editor in the studio. The studio opens code files in the person's own editor (VS Code, Cursor and others)
  and shows diffs; plugin code is written there or by the agent.
- An editor for phones. The studio is for desktop browsers and the desktop shell; the player runs on phones.
- A hosted service with accounts and billing. The studio runs on the person's machine (or their own server in remote
  mode).
- A marketplace with payments. Asset sources and plugins come from providers and package registries.
- Usage data sent off the machine (UI14-13).

---

## 9. Questions for the owner

Each question had a recommended answer. The owner answered on 2026-10-17 (UI0-01); the table at the end of this
section gives the answers in use.

1. **The name.** (a) "Scenity Studio" and the command `scenity studio` **(recommended)**; (b) "the Scenity editor"
   and `scenity editor`.
2. **The process model.** (a) One host that holds the open documents; one editor page per open project, which holds
   every panel (also the agent panel); the Hub page; one origin **(recommended)**; (b) the workbench model: the editor
   in a frame and the other panels outside it; (c) one page with the 3D view in a frame and the panels outside (the panels then need the plugin
   code too).
3. **The workbench page.** (a) Its parts move into the studio and the page retires at UI14-11 **(recommended)**;
   (b) it stays as a separate tool.
4. **Agents.** (a) Claude built in through the Agent SDK, and any agent over MCP **(recommended)**; (b) Claude only;
   (c) external agents only.
5. **The default agent mode.** (a) Review: edits wait as change sets **(recommended)**; (b) Auto: edits apply at once,
   undo stays.
6. **The host on npm.** (a) Publish it, with the agent part as an optional package if the Agent SDK terms need it
   **(recommended)**; (b) the studio needs a checkout.
7. **The desktop shell.** (a) Web first, the Tauri shell later (UI14-12) **(recommended)**; (b) desktop first.
8. **The dock system.** (a) dockview after a spike with the keyboard test **(recommended)**; (b) our own dock on Reka UI.
9. **Project instructions for agents.** (a) `AGENTS.md` at the project root, and `CLAUDE.md` read too
   **(recommended)**; (b) a Scenity file such as `scenity.agent.md`.
10. **Notes.** (a) A side file per scene (`<scene>.notes.json`) that the player never reads **(recommended)**;
    (b) `annotation` entities in the scene.
11. **The animator graph.** (a) A list editor first, a graph later (UI8-09) **(recommended)**; (b) a list editor only.
12. **The default theme of the editor.** (a) dark, as in Unity and Blender **(recommended)**; (b) navy; (c) the theme
    of the operating system.
13. **The keys of the agent.** (a) ⌘K search and ask, ⌘L the agent composer, ⌘I the inline prompt
    **(recommended)**; (b) ⌘K the agent composer (as in pen.dev and the workbench), ⌘⇧P the search box.
14. **Asset sources.** (a) Poly Haven built in (CC0), others as plugins **(recommended)**; (b) none built in.
15. **Generated assets.** (a) Through provider plugins only, with a rights record of kind "generated"
    **(recommended)**; (b) out of scope.
16. **Usage data.** (a) None, and an opt-in local log for studies **(recommended)**; (b) opt-in usage data off the
    machine.

**The answers (UI0-01, 2026-10-17).** The owner chose option (a) of each question.

| Question | Answer in use                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Q1       | The name is Scenity Studio; the command is `scenity studio`                                                                     |
| Q2       | One host that holds the open documents; one editor page per open project with every panel; the Hub; one origin                  |
| Q3       | The parts of the workbench page move into the studio; the page retires at UI14-11                                               |
| Q4       | Claude built in through the Agent SDK, and any agent over MCP                                                                   |
| Q5       | Review is the default mode: edits wait as change sets                                                                           |
| Q6       | The host is published on npm, with the agent part as an optional package if the Agent SDK terms need it (UI1-13 is a must task) |
| Q7       | Web first; the desktop shell comes later, after M8 (UI14-12)                                                                    |
| Q8       | dockview, after a spike with the keyboard test; our own dock on Reka UI only if the spike fails                                 |
| Q9       | `AGENTS.md` at the project root, and `CLAUDE.md` read too                                                                       |
| Q10      | Notes in a side file per scene (`<scene>.notes.json`) that the player never reads                                               |
| Q11      | The Animator window starts as a list editor; a graph comes later                                                                |
| Q12      | The editor's default theme is dark                                                                                              |
| Q13      | ⌘K search and ask, ⌘L the agent composer, ⌘I the inline prompt                                                                  |
| Q14      | Poly Haven built in (CC0); other asset sources as plugins                                                                       |
| Q15      | Generated assets only through provider plugins, with a rights record of kind "generated"                                        |
| Q16      | No usage data; an opt-in local log for usability studies                                                                        |
