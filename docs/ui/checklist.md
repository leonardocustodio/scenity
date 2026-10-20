# Scenity Studio: the checklist

The tracking list of [plan.md](plan.md). One line per task; the plan has the full text, the size, the needs and the
"done when" of each one.

`[x]` done, `[~]` started or done in part (add a note after the line: what is left), `[-]` superseded (a note after
the line gives the reason), `[ ]` not started. The marks
after each title give the priority and the size. "Owner" marks a step that only the owner can do (a decision, an
approval, a study with people).

When a task is done, tick it here, add a line to the progress log at the end, and keep [plan.md](plan.md) as the
record of what the task is.

## Milestones

- [x] M0 Design agreed
- [ ] M1 Starts empty
- [ ] M2 One shell
- [ ] M3 Agent-first editor
- [ ] M4 Author anything
- [ ] M5 Assets and quality
- [ ] M6 Ship and manage
- [ ] M7 Extensible
- [ ] M8 Release

## UI0: Decisions, research and design

- [x] UI0-01 The owner answers §9 (must, S, owner)
- [x] UI0-02 ADR 05, the studio process model (must, M)
- [x] UI0-03 ADR 06, the agent interaction model (must, M)
- [x] UI0-04 ADR 07, the UI extension model (must, M)
- [~] UI0-05 The usability baseline (should, M, owner)
  Ready: the study kit (`docs/ui/research/baseline.md`: the people, the setup, the journeys as read, the measures, the sheet). Owner: run the five sessions and fill the results.
- [x] UI0-06 The agent benchmark v1 (must, M)
- [x] UI0-07 Interaction specs (must, M)
- [x] UI0-08 The design language as tokens (must, M)
- [ ] UI0-09 Mockups of the 14 key screens in pen.dev (should, L, owner)
      Blocked on 2026-10-17: the Pencil desktop app was not running (the MCP tools need it). Owner: open Pencil; the screens are specified in shell.md §11.
- [-] UI0-10 A clickable prototype of the shell and the agent panel (could, M)
  Superseded on 2026-10-20 (the owner agreed): the real shell and agent panel exist now, so a prototype with fixed
  data comes too late to change the layout before UI3. The usability baseline (UI0-05) and the 15-minute test of
  UI13-08 test the real editor.

## UI1: The host and a start with no project

- [x] UI1-01 The host starts with no project (must, L)
- [x] UI1-02 The command `scenity studio [--project <dir>] [--port <n>] [--no-open]` (must, M)
- [x] UI1-03 One origin (must, L)
      Closed (2026-10-20, the decision of the owner): the gallery keeps the static build of the scene page (the page that ships, with its Linux baselines); the e2e specs run on the studio path.
      Done (2026-10-20): the e2e specs of the editor run through the studio host (`tests/e2e/specServer.ts`: the host, the API opens the projects of the spec, a launch link signs each context in); the whole suite passes on this path (the run of 2026-10-20). Left, for the owner: the gallery draws the build of the scene page with a static server (the frames of the page that ships, and the Linux baselines in Docker); a move to the studio path means a dev server and new runs of the baselines. The recommendation is to keep it: the studio path has the e2e specs.
- [x] UI1-04 Access control for a local web app (must, M)
- [x] UI1-05 User state in the host (must, M)
      Done (2026-10-19): the key map of the person goes to the host too (`settings/hostKeymap.ts`, `/api/user/keymap`): at the start a key map of the host wins, a browser with keys gives them to a host with none, and each change goes to the host. With the layouts (UI3-03), a second browser on the machine has the same layouts and key map: `studio-tools.spec.ts` "a second browser on the machine has the same key map" and the UI3-02 test.
      Left: the key map (UI3-09) and the preferences (UI12-02/03) of the pages through the API; the layouts are done (UI3-03).
- [x] UI1-06 The project service (must, M)
- [x] UI1-07 Folder access (must, M)
- [x] UI1-08 No silent defaults (must, S)
- [x] UI1-09 The job service (must, L)
- [x] UI1-10 The doctor (must, M)
- [x] UI1-11 Many projects at once (should, M)
      A project with an open window never stops; a project with no window and no request for the idle time (30 minutes, `SCENITY_STUDIO_IDLE_MS`) closes, and `/p/<key>` opens it again. Its state comes back from the host: the unsaved scene from the drafts of the host (UI12-08), the layouts and the preferences from the user state (UI1-05). The documents in the host (UI4-13) are not needed for it.
- [x] UI1-12 Project trust (must, M)
- [x] UI1-13 A host that installs from npm (must, M)
      The agent part (the Agent SDK) joins as an optional package with UI5; today the studio host has none.

## UI2: The Hub

- [x] UI2-01 The Hub page (must, M)
- [x] UI2-02 The project list (must, M)
- [x] UI2-03 The new project wizard (must, L)
- [~] UI2-04 Start from a prompt (should, L)
  Done (2026-10-20): "Describe what you want to make" in the new project wizard (with agents): the agent chooses the template and the name with one tool (`agents/chooseTemplate.ts`, `POST /api/agent/choose-template`), the steps of the wizard make the project, and the editor window sends the words to a new session in review mode (`agent/startFromPrompt.ts`), so the first scene waits as a change set. Left, with a model: the done-when (J2 passes for 4 of 5 benchmark prompts) needs runs of the Claude driver with the prompts of UI0-06.
- [~] UI2-05 Open a project (should, M)
  Done: the folder dialog and "Clone from Git" (a `git.clone` job). Left: a folder dropped on the Hub needs the desktop shell (UI14-12, after M8); a web page gets no folder path.
- [x] UI2-06 The Learn tab (should, M)
      The tutorials join the Learn tab with UI14-02.
- [x] UI2-07 The first run (must, M)
      The first run records the choice; the connection itself comes with UI5-01 (the built-in agent) and UI5-15 (external agents).
- [x] UI2-08 Empty and error states of the Hub (must, S)
- [x] UI2-09 Templates as data (could, M)
      The templates are data: the built-in templates of the Hub (empty, showroom, the samples), the templates of the person (folders `templates/<id>/` of the studio state with `template.json`) and the templates of the plugins of the checkout (`scenity.templates` of a plugin package.json: a project folder in the package). "Save as a template…" of a project card keeps a copy of the project folder (no outputs, no local state but the recipes, the skills and the plugin settings). The wizard lists the templates of the person and of the plugins after the built-in ones; a project from one is a `create` job with the template ID, which the host maps to `scenity create --from <folder>` (a folder from the page is refused). A user template shows in the wizard and makes a second project.
- [x] UI2-10 The Hub prompt box (could, S)
      Learn has the box "Ask how to do something": it answers a question with the sections of the user docs that match its words (a section per heading, a link to its anchor on GitHub, an excerpt) and with a tutorial when one matches; "Start in <project>" opens the last project with `tutorial=<id>`, and the window starts that tutorial once. The search needs no agent: the docs load at the first question, and the score counts the words of the question in the headings and in the text (BM25, common verbs at half weight). 10 test questions each get their section in the first three answers, and each link resolves to a heading of its doc.

## UI3: The editor shell

- [x] UI3-01 One Vue app for the editor window (must, L)
      The plain DOM bars sit in regions of the shell; UI3-05 (toolbar) and UI3-06 (status bar) make them Vue parts.
- [x] UI3-02 The dock system (must, L)
      Done (2026-10-19): the default layout has 17 panels, and the keyboard test docks, floats, moves, closes and opens them again (`scene-layout.spec.ts`). A restart: `studio-tools.spec.ts` floats the Bench panel in one browser, closes it, and a new browser with no storage gets the same layout with each panel from the host.
      Left: 8 panels today; the done-when names 12 (the panels of UI5, UI6 and UI12 join the registry). The keyboard-only test and the restart pass.
- [x] UI3-03 Layouts and workspaces (must, M)
      The workspaces list the panels of later tasks; each joins its workspace when its task adds it.
- [x] UI3-04 The menu bar from command metadata (must, M)
      The Assets, Component, Agent, Build and Help menus show when their commands come (UI4-03, UI5, UI12, UI3-09).
- [x] UI3-05 The main toolbar (must, M)
      The history group comes with UI6-14, the agent group with UI5-07, the search box with UI3-07, the speed and the loop of the clock with UI8-05.
- [x] UI3-06 The status bar (must, S)
      Done (2026-10-19): the jobs item counts the jobs of the dev server and of the studio host that run or wait (a read every 3 s, `jobs/startJobs.ts`), and a press opens the Jobs panel; the agent item comes from the agent panel (`agent/followView.ts`). `scene-layout.spec.ts` presses each item.
      Done: save (saves), selection (frames), problems (Rules panel), renderer and fps (UI10-06: the Performance panel), the bell. Left: jobs (UI12-07), agent (UI5-01).
- [x] UI3-07 Search and ask (⌘K) (must, M)
      "Ask the agent" runs when the Agent panel gives the window an agent (UI5); the recipes (`/`) come with UI5; ⌥↩ opens the text in the Search window (UI6-11).
- [x] UI3-08 Notifications and dialogs (must, M)
- [x] UI3-09 Focus and keys v2 (must, M)
      The keys of commands that do not exist yet come with their tasks: the agent and change-set keys (UI5), ⌘N ⌘⇧S ⌥⌘S ⌘W (UI4-03), ⇧F follow, ` overlay menu, ⌘G group, ⌘⇧K Search window (UI6-11), the panel keys ⌘⇧C ⌘⇧M ⌘⇧H ⌘⇧J ⌘⇧G ⌘⇧B with their panels.
- [x] UI3-10 Themes in the editor (must, M)
      Linux baselines of the four theme frames: at the end of the phase (with the other gallery runs).
- [x] UI3-11 The panel registry (an internal API first) (must, M)
- [x] UI3-12 Window identity (should, S)
- [x] UI3-13 Small screens (should, S)
      Baselines of `editor-sizes.spec.ts` (darwin, Linux): at the end of the phase.
      2026-10-20 (the request of the owner): the whole toolbar fits at 1280x720. The path of the file bar gets an ellipsis first (its tooltip gives the whole path), the scene tabs keep their width (up to 320 px), and the gizmo bar has a gap of 4 px and number fields of 44 px. Under 1280 the path goes, then the gizmo bar scrolls as before.

## UI4: One command layer and agent access

- [x] UI4-01 One command registry for the editor window (must, L)
      The check covers the window chrome (title bar, toolbar, status row, menus, rails); the view overlays and the panel contents come with UI3-05, UI4-02 and UI4-03.
- [x] UI4-02 Inspector edits as commands (must, M)
      The panel applies the same ops with the same op functions (its titles are Fluent texts); a live drag stays a channel gesture.
- [x] UI4-03 Creation, file and project commands (must, M)
      `prefab.create` writes the prefab file; UI7-07 makes the selection an instance of it, and the prefab set loads the prefabs of new instances.
- [x] UI4-04 The actor of each run (must, M)
      The actor of each step (model, runner, bridge, script API); the activity log shows it (UI4-11); the agent sessions give their session with each tool call (UI5-01); the History panel shows it (UI6-10).
- [x] UI4-05 Tools from commands (must, M)
      Done (2026-10-19): the texts of the core tools (`@scenity/agent-tools`) name no part of the lab: the descriptions of `scene_query`, `scene_commands`, `scene_frame`, `scene_pick` and `scene_sheet`, the default place of the result lines ("the editor"), and the tune lines (no `lab_tunes`, no `labs tune-apply`). A tool spec gives its own tune lines (`tunes`); the lab tools of the workbench host keep theirs (`labTuneLines`). `labWords.test.ts` checks each studio tool and its inputs, and the result lines of a command, an edit and the tune values; the arguments of each command are checked on the host before a run (earlier).
      Done: the JSON Schema in `scene_commands`, the argument check of `scene_command`, the catalogue test, the job tools. Left: the lab words of the core tools (`lab_*` and their texts: take, tune, the 3D lab). Plan: a host plugin of the lab (in apps/editor) takes the `lab_*` tools, the core tools keep generic names and texts, the old names stay as aliases of that plugin for one phase, and a test reads the texts of the core tools for the lab words.
- [x] UI4-06 UI tools (should, M)
- [x] UI4-07 The page bridge in the studio (must, M)
      The agent loop of the studio runs in the studio host since UI5-01; the workbench host keeps its own loop for the lab.
- [x] UI4-08 The shadow view (must, M)
      Done: `scene_frame` uses the shadow frame of the page; the acceptance test passes. 2026-10-19: with no window of the project, the call `shadow.frame` goes to a warm page of the scene pool: the host starts `scenity pool start --pages 1` at the first picture, `scenity shot` draws the picture (the first scene, or the first sequence at the time of the agent), and the answer has the form of the answer of a window (`poolFrames.ts`, `BridgeHub.noWindow`). 2026-10-20: a clock of its own: the camera preview of the dev core takes a time (`previewCamera(name, width, at)`): the core poses the scene at that time for the picture and at the time of the page again before the frame of the page, so the clock of the person never moves and the canvas never shows that time (`shadow.frame` and the contact sheet of `scene_sheet` use it). A picture of a document camera draws with no effect: the effects are built for the camera of the page, so the pictures stay the same and the effects of the view of the person are not built again.
- [x] UI4-09 One state call (must, S)
      It runs through the bridge of today; with UI4-07 it runs over the studio socket too.
- [x] UI4-10 Atomic tool calls (must, M)
- [x] UI4-11 The activity log (should, M)
      The edits of the panels and the drags join the log when they become commands (the inspector already has its commands, UI4-02).
- [x] UI4-12 Adjust the last action (could, M)
- [x] UI4-13 Documents in the host (must, L)
      Closed (2026-10-20, the decision of the owner): the host gives the changes of each scene one order and agents edit a project with no window (the done-when passes); the document text, the undo histories and the change sets stay in the windows (docs/ui/architecture.md).
      Done: an agent edits a scene with no window; the windows of a scene send the ops of each change (a drag at its end) and apply the ops of the others and of the agent; the acceptance test passes. 2026-10-20: the host gives the changes of each scene one order and keeps the last 200 steps (`documentLog.ts`, `GET /api/documents/log`: the version, the title, the actor and the ops of each change); each window puts its changes with no answer of the host again after a change of another window, so two windows that change the same value at once end with the same value (the value of the host order). Left, for the owner to plan: the document text, the undo histories and the change sets still live in each window; to move them into the host makes the editor pages clients that send commands (a rewrite of the edit path of the page: the history, the proposals, the sequencer channel).

## UI5: The agent workspace

- [x] UI5-01 The agent panel (must, L)
      The tab dot of a session that waits shows for approval cards (UI5-07) and questions (UI5-11). The Claude driver has no end-to-end test (the spec uses the script driver; a test with a model needs a credential).
- [x] UI5-02 Context chips and mentions (must, M)
- [x] UI5-03 Transcript cards (must, M)
      The file diff card comes with the file edits of a session (UI5-05: the studio sessions run no file edit tool yet); the rule results show as the output of a `check` job.
- [x] UI5-04 Change sets (must, L)
      Done: a change set per agent turn, the Review panel (by entity, old and new values, all, per entity, per op, checked ops as one step), the marks in the hierarchy, the inspector, the Scene view (pins) and the status bar, the bar of the agent panel, Preview, conflict and stale marks, the review result as a chip for the agent; the acceptance test passes. 2026-10-20: the ghosts of the views (a faint copy of each entity that a waiting change set moves, at its new place, in the colour of the session; a Preview shows none) and the marks of the Project window (an asset whose record or source a turn wrote has a dot in the colour of the session, with the turn); the rules line and the Before and After pictures of the Review panel came before. The marks of the timeline: a key that a proposal of an agent adds is a ghost key (UI8-04) with the colour of the session and its name in the tooltip ("proposed by …"); the sequence proposals wait in the bar of the Timeline with Accept and Reject.
      2026-10-19: each change set of the Review panel has Check (`ReviewCheck.vue`): the rules line (the rules on the scene after the change sets of the session) and the Before and After pictures of the view camera (the task gate of the page), and a disclosure with the semantic diff view of the set (UI12-05). `studio-agent.spec.ts` (J9) presses Check and reads the line, the two pictures and the diff. Still left: the ghosts in the views, and the marks of the Project window (the timeline marks wait for sequence proposals).
- [x] UI5-05 One turn record (must, L)
      The checks of a turn are its `check` jobs; a semantic diff of the files comes with UI12-05.
- [x] UI5-06 Checkpoints (must, M)
      A checkpoint keeps the scene of the newest window of the project; another open window keeps no copy.
- [x] UI5-07 Permission modes (must, M)
      The local studio person is an admin; the other roles come with the remote mode (UI15). The kinds "imports" and "network" have no studio tool yet beyond the network tools of Claude; their gate is in place.
- [x] UI5-08 Plan mode (should, M)
- [x] UI5-09 Presence (must, M)
      The marks in the view are pins and rings over the canvas (not an outline of the core); "Follow the agent" shows the last frame of the agent (not a live second view); the title bar has no agent dot (the session tab, the status bar and the bell show the state).
- [x] UI5-10 The inline prompt (⌘I) (must, M)
      A timeline range comes with the range selection of the timeline (UI8); "Ask the agent to fix" on a problem is UI6-09.
- [x] UI5-11 Questions and approvals as cards (must, S)
- [x] UI5-12 Project instructions (should, S)
      The test agent is the script driver with a step that follows the instructions; a model run needs a credential.
- [x] UI5-13 Recipes (should, M)
      Done (2026-10-19): the recipes of plugins come from the `recipes` point (UI13-02). The Hub edits the recipes of the person (`RecipesSection.vue`: New recipe, Change, Remove; `PUT /api/agent/recipes` checks each recipe and writes `recipes.json`), and Run in the project opens the chosen project with `recipe=<id>`: the window asks for the fields and sends the prompt. Tests: `agentRecipes.test.ts` (the write and its refusals), `studio-agent.spec.ts` "a recipe of the person: made in the Hub, run in a project from the Hub".
      Done: the recipes of the studio, of the person and of the project; a command per recipe (the search box, Agent ▸ Recipes, `/` in the composer); the parameter dialogs; the list in Hub → Agents; the acceptance test passes. Left: the recipes of plugins (with the plugin manifest of UI13), an editor of the recipes of the person, and a run from the Hub with no open project.
- [x] UI5-14 Notes as tasks (should, M)
      A note is a Note entity (the `annotation` component): on an entity as its child, or at a point with no parent. The link to the turn is the key of the turn (`<session>#<turn>`) in the `task` field of the note.
- [x] UI5-15 External agents (must, M)
      `scenity mcp` (stdio) and the MCP server over HTTP at `/mcp` of the host (Streamable HTTP, JSON answers, the header `Authorization: Bearer <token>`); a connection request that the owner allows in the agent panel or in Hub → Agents (a request with no project gets its project there); Hub → Agents → Connect over HTTP makes an allowed connection and shows its token once (the line of Claude Code and the JSON of the other apps), and Revoke takes a token back; an agent session per connection (Review, presence, change sets, a turn from the first call after a pause); the setup lines of Claude Code, Codex, Cursor and Claude Desktop with a copy button. An MCP client over stdio and a client over HTTP edit the open scene, and their change sets wait in the studio.
- [x] UI5-16 The terminal panel (must, M)
      The PTY cases of the workbench terminal tests run on the studio terminals (`terminals.test.ts`); the cases of the workbench CLI flags (hooks, session IDs) belong to the workbench only.
- [x] UI5-17 Cost and limits (should, S)
      The budgets of background tasks come with the tasks (UI5-19).
- [x] UI5-18 No agent (must, S)
      The journeys J1 and J3 to J8 have no test of their own yet; the editor e2e specs run with no agent (the scene server of `scenity dev`), and `studio-no-agent.spec.ts` covers an edit, an undo and a save in a studio with no agent.
- [x] UI5-19 Tasks and background agents (must, L)
      Done: the background tasks of the studio host (a session in Review mode with a budget, a count of turns, a time limit and the rules as the gate; a failed check goes back to the agent, at most five times in a row; the end check at a limit; the stop of the owner; the review pack with the pictures before and after; the record with a search), the gate of the editor window on the document after the change sets of the task, the Tasks panel, the command "New background task", the notice at the end (toast, bell, system notification); J12 passes; the cases of the workbench loop tests pass on the studio tasks (`agentTasks.test.ts`). 2026-10-20: a task in a Git worktree of the project on a branch of its own (`scenity/task-<id>`): the files of its session go there with no approval card (they never change the folder of the person), and the gate "The rules and scenity check" writes the scene after the change sets of the task into the worktree and runs `scenity check` there (a failed check goes back to the agent).
- [x] UI5-20 Parallel agents and variants (should, L)
      Each variant (or part) is a background task with its own session; its change sets are its layer until Keep. A split starts from the host API (`parts`); the Tasks panel form starts variants. The files of a task still go to the branch of the project folder (no worktree, as UI5-19). "Keep parts of two" is the Review panel on the two sets.

## UI6: The core panels

- [x] UI6-01 The Scene view panel (must, L)
      The Tools and Tool settings of the toolbar stay (shell.md §7.1); the overlays are a second place for them in the view.
- [x] UI6-02 The orientation gizmo (must, M)
      The core draws with a perspective camera, so the orthographic projection is a long lens (1° from far away, the same height of the view at the target); a true orthographic camera of the core can come later.
- [x] UI6-03 Split views (should, L)
      The other views draw with no effect (no selection outline) and with the shadow maps of the main view; the picks, the gizmos and the drags stay in the main view (Main swaps a view into it). The e2e checks that the frame work of four views fits in a frame of 60 fps; the frame rate of four views is a measure of the reference machine (UI14-07).
- [x] UI6-04 The Game view (must, L)
      The Game view embeds the play page of SE6-10 (the player path) with a handoff of the documents; a change of the scene shows after Refresh or Play (no live link to each edit). The locale of `locale=pseudo` is a test value; the language of the person comes with Preferences ▸ General.
- [x] UI6-05 Hierarchy v2 (must, M)
      The e2e checks the scroll of 10,000 entities in a headless browser (a median frame under 34 ms and fewer than 150 rows in the page); 60 fps is a measure of the reference machine (UI14-08). The drops come from the asset tiles; the Project window of UI6-07 uses the same drag type.
- [x] UI6-06 Inspector v2 (must, L)
      Done (2026-10-19): J4 runs by the keyboard only in `scene-inspector.spec.ts`: a point light and a camera from the search box, the exposure (Tab, a value, Enter), the environment map (the Reset button of the field, then the type-ahead of its select), the fog (the type-ahead of its form), a material on a part (the ottoman from the search box, the key of a part of its model, Enter), and a save. The key field of the material overrides offers the parts of the model (`mesh:<node>` and the material names, from the inspect report) as a list, and Enter adds the override. Two locked inspectors show two entities in the same test.
      Done: the header (the name, the ID with copy, the tags, the visible switch), the cards with icons and the ⋯ menu (Reset, Copy and Paste values, Remove, Docs, Ask the agent), the lock and a second inspector below the first (two locked inspectors show two entities), the raw JSON mode, the override mark (bold value and margin bar), the agent change marks (UI5-10), "Add component" with a search and groups. Left: the J4 e2e drives the create, the exposure and the save by keys; the environment map, the fog and a material on a part by keys come with the asset picker keys and the material tasks of UI7.
- [x] UI6-07 The Project window (must, L)
      J3 goes through the Assets view of the window (the import, the stills, the drag to the view; scene-assets.spec.ts). A move of a file is a drag onto a folder of the tree, a rename is F2; a "Move to" with a typed path can come later.
- [x] UI6-08 The Console (must, M)
      The studio host has no log stream for the windows yet: the source "host" comes with one. A click opens a scene file; another file shows its path in the detail pane.
- [x] UI6-09 The Problems panel (must, M)
      J7 starts from the panel with a rule of the project ("Save as a rule" from a measure is UI10-02). A plugin that does not load stops the page today, so the plugin problems are the errors of plugin code at run time; the build problem is an asset with no build output (a build older than its sources needs a source stamp in the build).
- [x] UI6-10 The History panel (must, M)
- [x] UI6-11 The Search window (should, M)
      The entities show as a table; the other kinds show as lists. The saved searches are in the storage of the browser (a convenience of one person); saved searches in the project files can come with the team tasks.
- [x] UI6-12 Selection tools (should, S)
- [x] UI6-13 Scene tabs (must, M)
      The tabs are in the file bar of the toolbar, above the dock. The start screen stays for a window with no open scene (the editor starts with a scene); the Scenes panel is the same list in the dock.
- [x] UI6-14 Undo and redo buttons, the save state, the conflict dialog (must, S)
      The save state is the item of the status bar and of the file bar (UI3-06). The semantic diff of the dialog is a list of lines (`sceneDiff.ts`); the diff view of UI12-05 can show it later.

## UI7: Authoring

- [x] UI7-01 The create menu and presets (must, M)
      The plugin presets come with the studio plugin API (UI13-01: `createPresets`). A prefab instance and a character ask for a typed path or asset ID; a picker of the prefabs and the models of the project can come with UI7-07.
- [x] UI7-02 Inspector widgets for the environment hints (must, M)
      The widgets are the schema fields with a preview over them (a picture of the meaning of the values, not a render of the scene); the view shows the real effect at once. The field model of `@scenity/editor-core` names the custom widget of a hint (`FieldModel.custom`), for the widgets of UI7-03 and UI7-04.
- [x] UI7-03 Inspector widgets for lights and cameras (must, M)
      The fields are the schema widgets (`pointOrEntity` is the choice of a point or an entity); the handles are a layer of the Scene view (`scene/handles/`) with one provider for each kind of value, which UI7-06 extends. The shadow box shows when the light has a `shadowCamera` value (the fit of the runtime to the scene has no box on the page); a safe frame of entities has no handle (its box comes from the bounds).
- [x] UI7-04 Inspector widgets for models (must, M)
      `materialOverride` keeps the fields of its schema (a material, the colour, roughness, metalness, opacity) and adds the pick of its part in the view to the map of the overrides; the overrides list of a prefab instance has Revert for each item here, and the apply and the edits in an instance come with UI7-07.
- [x] UI7-05 The Lighting window (must, M)
      The presets change the environment only (the lights of the scene stay); a preset that also places lights can come with the placement helpers (UI7-12). A number field of the schema that must be above its minimum now starts at 1 (a new linear fog gets a far plane of 1 m).
- [x] UI7-06 Handles in the Scene view (must, L)
      The handles show for the primary selected entity. A footprint of the bounds of the model has no handle (the page has no bounds of the model in the frame of the entity). The camera target is the target handle of UI7-03.
- [x] UI7-07 Prefabs v2 (must, L)
      The "in context" view of the prefab mode (the scene around the prefab, dimmed) needs a second document in the core; the breadcrumb goes back to the scene, and the scene shows each instance with the change after the save. A make of a prefab writes its file at once, so an undo takes the instance away and keeps the file. The edits of an entity of a nested instance stay refused (edit that prefab).
- [x] UI7-08 Prefab variants and nested prefabs (could, M)
      No format change (ADR 02 notes): a variant is a prefab whose root is an instance of the base. An edit of an entity two instances deep in the scene stays refused (open the variant and edit it there).
- [x] UI7-09 Material editor v2 (must, M)
      The preview object is the swatch ball with the colour map; the Scene view stays the true preview. The type change already kept the values of the new type (SE5-12); the presets set the values that the type takes.
- [x] UI7-10 Variants (override layers) (should, M)
      A variant shows through core patches only, so the play mode and the build use the base scene. The compare takes its pictures from the main view camera. A variant of a variant (a stack of layers) waits for UI7-08.
- [x] UI7-11 Layout tools v2 (must, M)
      The tools keep their page commands and their script API; a page with no editor window shows them as the bar of before.
- [x] UI7-12 Placement helpers (should, M)
      The helpers work over the world boxes of the inspect report, so a turned entity uses its world box; the facing turns about the up axis only. An agent run applies at once (the page commands have no proposal mode yet).
- [x] UI7-13 Tags and pick layers (should, S)
- [x] UI7-14 Notes in the views (should, M)
      The note file is `scenity.notes/1` beside the scene (decision Q10); the note entities of UI5-14 stay. A note in the file has no undo step and no review of the agents yet (an agent adds a note through the panel API later, with UI5).
- [x] UI7-15 Presets of the person (could, S)
      The browser storage keeps the presets (decision of the person, not of the project); a sync between machines can come with the account settings of the studio host. A preset has no rename yet (`preset.remove`, then save it again).

## UI8: Time, animation and play

- [x] UI8-01 The Timeline v2 (must, L)
      The action form takes the arguments as JSON (a form from the action schema of a simulation plugin needs that schema in the plugin API, UI13). The picker opens a sequence with a reload of the page, as `sequence.new` does. J6 is in parts: the sequencer spec (keys, a play, the track kinds) and the gallery input spec (the record and the replay of the play mode).
- [x] UI8-02 The curve editor v2 (must, M)
      The tangents are the two control points of a Bézier ease (the format has no tangents of their own). Frame all fits the time; the value range of the lines always fits.
- [x] UI8-03 Keys from the inspector (must, M)
      The first key of a field is two steps (the track, then the key): the sequence runner has no batch yet. A field of a nested object keys its own path (`light/colour/0`); the parts of a transform key their transform track.
- [x] UI8-04 Sequence edits as change sets (must, M)
      The sequence proposals are in the Timeline (ghosts, Accept, Reject), not yet in the Review panel and its change sets (the Review lists scene ops by entity); a turn record does not hold them yet.
- [x] UI8-05 The clock in the main toolbar (must, S)
      The audio of the sequence plays at speed 1 (a speed other than 1 moves the time only).
- [x] UI8-06 Onion skins and ghosts in the Scene view, from `runtime-dev` (should, M)
      The copies are the meshes of the entity at its world place at each time (a skinned pose of a character at that time is not copied yet, as the labs onion skin does). The ghosts of the proposals are the ghosts of UI8-04 in the Timeline and the preview of UI5-04 in the view.
- [x] UI8-07 Play mode v2 (must, M)
      The saved recordings are in the browser storage of each project (the Project window has no delete yet); a recording as a project file (`*.input.json`) for the agents and CI can come with UI9. The Keep dialog is the keep list of SE6-10.
- [x] UI8-08 Streams and simulations (should, M)
      A recorded stream shows its state in the panel; to drive the core with it needs a place in the format (a source of a simulation in the sequence: an ADR 04 change). The page has no live source yet (an engine adapter, as the resus plugin of SE6-05 has in the labs).
- [x] UI8-09 The Animator window (should, L)
      The list editor is done; the graph view of the states (the second part of the task) is not yet. A blend of a state is edited in the inspector (the JSON of the motion) for now; the preview needs an open sequence (the core keeps the animator reports in its time line).
- [~] UI8-10 Character setup (should, L)
  Done: the Character setup window (the rig profile with Detect, the bone map from the profile and the `bones` of the component, the missing bones, the clip source of the animator, the retarget preview of a clip of the clip source in the view, the look variant, the handles of the IK targets in the view); the widgets of the foot lock and of the IK goals in the inspector; a Mixamo skeleton maps with the Mixamo profile (unit test); the Idle clip of the Rigify mannequin plays retargeted on the robot (e2e). Left: a Mixamo model in a sample (an asset with its rights, for the owner) for the done-when.
- [x] UI8-11 Walks (should, M)
      The routes come from `scenePath` of `@scenity/character/navigation` on the base scene; an obstacle with the footprint `bounds` of a model (no bounds in the page) does not bend a drawn route. The walk times and stand points are edited in the inspector (the list of `locomotion`), the stand points in the view with the gizmo.
- [x] UI8-12 The clip browser (should, M)
      The core plays the animation tracks now: an animation key names a model, skinned model or animation asset and a clip in it (`name`, a new optional field of the sequence format; default: the first clip). The Clips panel lists the clips of the model of the selected entity and of the clip source of its animator; the preview plays a clip in the view at the time of the clock and needs an open sequence (with no sequence the core has no time line). A clip dropped on a character in the Scene view goes on the animation track of that character at the time of the clock (the "play it on the character under it" of shell.md).
- [x] UI8-13 Audio (could, S)
      The preview plays the sound with no level and no spatial settings of the component (a plain preview of the asset). The audio keys are the audio tracks of UI8-01 with their waveform.

## UI9: Assets

- [x] UI9-01 The import dialog (must, M)
      A drop or Import opens the dialog: the importer of each file, the settings form of each importer (from the JSON Schema of its settings; the fields of more parts as JSON under "More"), a rights record of the project or a new one (the rights form of UI9-06), and the folder. The settings of a record hold only the changed fields.
- [x] UI9-02 The import queue (must, M)
      The queue of the asset browser: the state of each file (waits, imports, done, failed, cancelled), the reason of a failure, and the fix of a known reason (no Blender: the doctor fix, a link to the Blender download). Cancel stops the files that wait. A Blender import shows "Imports…" until its end: the dev server answers one request for each file, with no part progress.
- [x] UI9-03 The asset inspector (must, L)
      The details of the asset browser became the asset inspector: the preview of each asset kind of formats.md (a turntable for a model, a skinned model and an animation, with the first clip and the skeleton of an animation with no mesh; the channels of a texture; the mirror and matte balls of an environment map; the wave and a player for audio; a material ball; the still of a scene, a prefab and a plugin kind), the facts (the size, the triangles, the meshes, the extent, the levels of detail of the build, the clips, the rig or the joints, the pixels of a texture, the length of a sound), the record fields, the warnings of the import, and Import again with the settings form of the importer.
- [x] UI9-04 Stills (must, S)
      The editor page draws the stills: a hidden frame opens the still page for one asset and sends the WebP picture to the dev server, which writes the still and its stamp with `makeStills` (the renderer version of the stills script). A new import gets its still with no command line; "Make stills" draws each missing or stale still; a stale still has a mark on its tile. As in the check of `scenity assets stills`, the mark follows a change of the inputs, not of the still page. Note: the stills of the samples are stale for `assetStills.ts --check` (the renderer changed after 2026-10-16); a run of `assetStills.ts` under the GPU lock draws them again.
- [x] UI9-05 The asset build panel (must, M)
      The Asset build panel: the state of each asset (built, stale, not built, failed, with the reason), Run the build (`scenity assets build` in a child process of the dev server, with its log and its exit code), the build settings of an asset (the codec of each texture role, the levels of detail) written into its record, and a turntable of each level of the build. The build writes `.scenity/cache/build-state.json` (the inputs of each asset), so a change of a record or a source after the build gives a stale mark; a build output from before the file counts as built.
- [x] UI9-06 Rights and licences (must, M)
      The rights record form of UI9-01 (the SPDX picker, the source, the author, the date, the allowed use, the web delivery); Mod or Shift and a click picks tiles, and the rights bar gives one rights record to all of them; the Rights panel edits the licence policy of the project (`release.licences.allow`) and lists the rights records with their problems and a mark when the policy does not accept their licence; a tile that the release gate stops has a Rights mark with the problems. The rights step of the quickstart needs no text editor.
- [x] UI9-07 Approvals (should, M)
      The Approvals panel: a review queue for each approval role of the project (stale, not reviewed and not approved first), the review of an asset (the reviewer, kept in the browser storage, a note, Approve, Ask for changes, Reject) that writes `approvals/<ID>-<role>.json` with the source hash of now and links it from the asset record, a new role of the project (`release.approvals`), and a stale state after a source change. An approval made in the panel passes `assets release-check`.
- [x] UI9-08 The release check panel (must, S)
      The Release check panel runs `assets release-check --json` on the dev server and shows the result of the gate and the findings of each asset (the findings of the project first). Each finding links to its fix: the Rights panel for a rights record or a licence, the Approvals panel for an approval, and the asset in the asset browser.
- [x] UI9-09 Asset database tools (should, M)
      The Problems panel shows the problems of the asset database (a record that does not read, two records with one ID, a missing source or file, a broken reference of another document, a document that does not read or does not exist) with their fixes: a missing source relinks to a project file (the same file name first: a moved file, then the same extension), a broken reference of another document relinks to an asset by ID (the assets of the same kind of use first), a copied record gets a new ID. Used by is the list of the asset inspector (SE5-07). The broken references of the open scene stay the asset problems of the page (Go to selects their entities).
- [x] UI9-10 Asset sources (should, L)
      Done: the provider API of `@scenity/assets/sources` (a search, the preview of an item, the licence as a rights record, the files of an item, the import with the rights record of the provider), Poly Haven built in (CC0: skies, models with their buffers and textures, the diffuse map of a texture), "Get assets" in the asset browser: a sky imports with its rights record in 3 clicks. The dev server fetches the previews, so the page loads no picture of another site. Left: a plugin adds a provider through the registry (`ProviderRegistry.add`) with the studio face of the plugins (UI13-02).
      Done (2026-10-19): a plugin adds a provider through its host face (`assetSources`): the dev server of the studio loads the host faces of a trusted project (`scripts/hostFaces.ts`), and the source registry of each project has Poly Haven and the providers of its plugins (`sourcesApi.ts`; the cache goes when the plugins or the trust change). The spin sample has the source "Demo patterns" (two CC0 textures of the plugin, `file:` URLs). `scene-studio-plugins.spec.ts`: Get assets → Demo patterns → a texture → Import gives the asset and `rights/demo-patterns.yaml`; the Poly Haven test passes.
- [x] UI9-11 Generated assets through providers (could, M)
      "Generate" in "Get assets": a generator, a kind and a text; "Get the cost" shows the cost of the run first, and Generate runs only after it. The result imports with the rights record of the generator (`rights/generated-<id>.yaml`, `kind: generated`, the web delivery pending). Scenity has no generator of its own: `SCENITY_GENERATOR_URL` names a generation service (`httpGenerator`: `/estimate` and `/generate`), and a plugin can add another generator.
- [x] UI9-12 Export a scene as GLB (a job), with options (should, S)
      The Export panel exports a scene (the open scene by default) as GLB with `exportScene` of `@scenity/assets/export` on the dev server, with the options of `scenity assets export` (the output file, a run of the importers first), and checks the file with the glTF validator: the panel shows the file, its size, the warnings and the validator errors.
- [x] UI9-13 Hot reload state (must, S)

## UI10: Rules, checks, quality and performance

- [x] UI10-01 The rules editor (must, L)
      "New rule" and "Edit the rule" of the Rules panel open the rules editor: the file (the scene, the sequence, the project file, a rules file of the project or a new one), the ID, the metric picker with the fields of its arguments from the JSON Schema of the metric (an entity selector offers the entities and the tags of the scene), min, max, unit, level, provisional, note and the scope (scene, sequence, range, markers, entities). The scene and the sequence change by an edit of the page (one undo step; `sequence.rules`); the project file and the rules files change on the dev server, and the page reads the project rules again. The picker has the built-in metrics; the metrics of plugins come with UI10-03.
- [x] UI10-02 "Save as a rule" from a layout tool readout or a measure (must, S)
      The readout of a layout tool has "Save as a rule": the Rules panel shows the rules editor with the first metric of the result, its arguments and its value now as the limit (a max for a metric whose larger value is worse, else a min).
- [x] UI10-03 Plugin metrics in the editor page (must, M)
      The project plugins module of the scene page also gives the metric faces of the plugins (`scenity.dev`, `loadProjectDevPlugins`): the scene worker and the main-thread core add their metric libraries to the rule check (`useMetrics`), and the rules editor offers their metrics. The traffic plugin has a metric face (`traffic.vehicleGap`), and sim-road has the block rule `road.carGap` on it: the Rules panel shows its value (8 m) and a save passes the gate; `scenity check` passes it too.
- [x] UI10-04 The Rules panel v2 (must, M)
      The Rules panel has the groups by file, the filters (failed, level) and the graph of SE7-03, the rules editor of UI10-01, and the rules log: each override of the scene (`<name>.rules-log.jsonl`) with its time, its reason, the failed rules and the hash of the saved text; an override with the hash of the file now shows as current.
- [x] UI10-05 The check job (must, S)
      "Run scenity check" of the Problems panel runs `scenity check --json` on the dev server; each row that fails goes into Problems, and the Rules panel says whether the check gives the same status as the page for each rule of the open scene. The page check now gets the rights state of each asset (the asset list and the release gate of the dev server), as the CLI does, so `assetRights` gives the same result in both.
- [x] UI10-06 The Performance panel (must, M)
      The Performance panel reads `stats()` and the inspect report each second while it shows: a row for each value of the statistics (the frame time and the frame rate, the work, the update, the render, the poses, the GPU memory, the heap, the draw calls, the triangles, the entities, the instances, the effects, the assets and their loads, the GPU time, the backend and its reason; an unknown key shows as JSON), the cost of each entity (triangles, draw calls, meshes; a click selects it), and the switches of the tier, the backend and the render worker (the render settings, then a reload). A press on the render item of the status bar opens the panel.
- [x] UI10-07 The bench runner (should, M)
      The Bench panel runs `scenity bench --json` as a job of the dev server (quick or full, at a tier; the bench makes the build when the project has none), keeps each report in `.scenity/bench/history.jsonl`, and shows the budgets of the last run (the value, the limit and the result of each row) and the trend of the work, the frame time, the first frame, the draw calls and the triangles of each backend over the runs. `SCENITY_BENCH_LOCK` gives the runs another GPU lock file.
- [x] UI10-08 The budgets editor (should, M)
      The Budgets panel: the quality budgets of the project (`quality.budgets`: a group such as `scene` or `scene.webgpu`, each tier, the limit of each key) beside the value, the limit and the result of the last bench run of the tier; Save writes the project file through the route of Project settings (the reader checks it). Run a bench opens the Bench panel; the budgets of the build entries are in the Build window (UI11-01). The next bench judges with the new limit.
- [x] UI10-09 Debug layers in the View options overlay, also the layers of plugins (must, S)
      Done (2026-10-19): a dev face can give debug layers (`layers` beside `library`); the dev document core registers them with the data of the scene layers (`useMetrics`, `DevFace`), and View options lists them. The traffic plugin has the layer `traffic-gaps` (a line between each two vehicles, the nearest two in red). Tests: `dev.test.ts` of the traffic plugin (the lines), `scene-layout-tools.spec.ts` "the debug layer of a plugin toggles from the View options overlay" on the sim-road sample.
      Done: "Debug layers" in the View options overlay: a box for each layer that the core can draw (the names of the inspect report), so the generic layers and each layer that a core has from a plugin; a box turns its layer on or off and the URL parameter `debug` follows. Left: the page registers the metric libraries of the dev faces (UI10-03) but not their layers: a layer needs the data of the plugin core, and no plugin has a dev layer yet.
- [x] UI10-10 Layout search (could, M)
      "Find a place" under the layout tools searches places for the first selected entity (its position x and z, at most 2 m from where it stands) with `searchLayout` of `@scenity/rules` (SE7-06): each candidate scores on the scene and project rules with no sequence time, with the metric facts of the inspect report moved for the entity and its subtree (no render). The variants show their place, their move and how many rules pass, with Apply (one undo step); the script API has `layoutSearch(entity, radius)` (with the rule results where the entity stands now) and `applyPlace(variant)`.
- [x] UI10-11 The frame index browser (should, M)
      The Frame index panel (Build workspace): the frames of the project by sequence (or scene), document camera and time (0 ms and each marker and key time, with a mark), from `.scenity/frames/index.json`; "Index the project" runs `scenity frames` as a job of the dev server (a build first when the project has none), which draws only the frames with no picture (the player in headless Chromium, the scene pool when it runs). The list keeps two pictures of each place: a frame whose key (its documents, the assets, the plugin code) is not a key of the project now has a stale mark; two picks compare two frames side by side, and Before compares a frame with its picture before a change. The index of the walkthrough sample (116 frames: 4 cameras × 29 times) shows in the panel.

## UI11: Build, ship and visual tests

- [x] UI11-01 The Build window (must, M)
      The Build window: the output folder, Run the build (`scenity build --json` as a job of the dev server, with its log), the report (the gzip size of each entry against its budget, the marker gate), the size budget of each entry (written into `build.budgets` of the project), and Open the built player. J8 builds with no terminal.
- [x] UI11-02 Player preview and embed (must, M)
      The Embed panel: the player options (the scene, the sequence, the camera, the tier, the backend, autoplay, loop, muted), the built player with these options in a frame (a plain page of the dev server with the web component snippet), and the snippet for the web component, a script tag and Vue, with Copy; the base is the folder of the build on the dev server or a public URL. The snippet runs in a plain HTML file. The dev server now serves the web files of a built player in a project (`.html`, `.js`, `.css`, `.wasm` with their types).
- [x] UI11-03 Shots and baselines (must, L)
      The Shots panel: a shot of a scene (a camera, a time, a size, a backend) as a job of the dev server (`scenity shot --json`, the build first when the project has none), the shots with "Add as a baseline" (the owner confirms with a second press) and "Set as the poster" (`posters/<scene>.png` and the `poster` field of the open scene, one undo step), the baselines of the platform, and Run verify (`scenity verify` as a job) with the result of each baseline; a failed one shows its actual picture over the baseline with a difference blend. The Hub picture of the project is the first poster, so a poster from a shot shows in the Hub.
- [x] UI11-04 The render queue (should, M)
      The Render queue panel: the form of a contact sheet (a time range and its step, the cameras, the cell width) or a clip (a time range, a camera, the frames per second, the size) of a sequence; the queue of the dev server (one `scenity sheet` or `scenity clip` at a time, each under the GPU lock, the build first when the project has none) with the state of each item; and the gallery of the outputs (`test-results/renders/`: the pictures and the videos). A clip of the walkthrough comes out with no terminal.
- [x] UI11-05 Publish (should, M)
      Done: `scenity publish` (the release gate of the assets first, then the build folder as a ZIP archive) and Publish of the Build window: a failed release check stops the publish and gives its reasons; else the archive is there to download. Left: publish targets from plugins (a plugin face for a target, with UI13-02).
      Done (2026-10-19): publish targets from plugins: the `publishTargets` of a host face (`scripts/hostFaces.ts`); the Build state lists them and the result of the last send, and `project.publish.send` gives the archive of the last publish that passed to a target (`projectBuildApi.ts`). The Build panel shows Send to … after a publish that passes. The spin sample has "The published folder". `scene-studio-plugins.spec.ts`: a publish, then Send copies the archive into `published/`.
- [x] UI11-06 The scene pool controls (could, S)
      "Scene pool" under Advanced in Preferences: the state of the pool of the machine (it runs or not, its pages, the warm pages, the leases), Start with a count of pages (`scenity pool start` as a child process of the dev server, until a stop), Stop and Refresh. `scenity shot`, `sheet` and `clip` use the pool while it runs.

## UI12: Project, settings and version control

- [x] UI12-01 The Project settings window (must, L)
      Project settings (File menu): each field of `scenity.project.json` as a form from the JSON Schema of the project file (texts, numbers, flags, choices, objects with Add and Remove for an optional field, lists, maps of names, the options of a union), in sections (General, Assets, Plugins, Rules, Quality, Build, Release, Agents and runs, Editor, and Other for a new field), with a search over the names and the descriptions. The checks of the schema show at once under each field and in a list; Save sends the value to the dev server, where the reader of `@scenity/scene` checks it again and writes canonical JSON; the server names each scene, sequence and asset root of the lists that is not in the project folder. The Editor section has the project values of the editor settings. Only the arguments of a rule (free values) take JSON.
- [x] UI12-02 The Preferences window (must, M)
      Preferences shows the editor settings in groups under their headings (snaps, view, camera, dock, workspace, recent, render, autosave), the theme, the layout, the scene pool and, in the studio, the preferences of the host: the language, the recent projects, autosave and the defaults of new agent sessions (the permission mode, the budget, the model, the effort); outside the studio a note says where they are. A search shows the settings with its words. A change of the host preferences goes over the preferences of the host now (`patchHostPreferences`), so the theme and Preferences do not write an old copy; in the studio the language of the host is the language of the editor.
- [x] UI12-03 The Shortcuts window (should, M)
      The Shortcuts window (File menu): the key map on a keyboard picture with the modifiers and a context; each key shows its commands, and a key with a clash shows in the negative colour with the list of the clashes. Pick a command, then press a key on the picture: the command gets the key (Add keeps its other keys); a key with no picked command shows its commands with Remove. Export and Import write and read the key map of the person (`scenity.keymap/1`, the unknown commands named); Reset all gives the default keys.
- [x] UI12-04 The version control panel (must, L)
      The Version control panel (⇧⌘G, Review workspace): the branch and the changed files of the project folder, the diff of a file (the semantic diff of a scene, a prefab or a sequence with the text diff on request; the patch of another file), the commit of the picked files by the owner (one line), the branches with Switch (refused while the checkout has changes), the worktrees, and in the studio the agent tasks of each branch. A save of the page loads it again and shows the diff of the file. The routes of the dev server run Git with no shell on the files of the project folder. The cases of the Changes tab of the workbench (the files, a diff, the commit of the picked files, the diff after a save) pass in `vcs-panel.vitest.ts`.
- [x] UI12-05 The semantic diff view of documents (must, M)
      Done (2026-10-19): the semantic diff view is in the Version control panel, the conflict and draft dialogs, and the Review panel (each change set, with the Before and After pictures of Check). The Version control panel shows no frames.
      2026-10-19: the conflict dialog and the draft dialog show the semantic diff view of the Version control panel (`SemanticDiff.vue`; `diffDetails`, `diskDetails` of `sceneDiff.ts`; a dialog shows a view in place of its lines, `DialogDetails.view`). `scene-save.spec.ts` reads the view in the conflict dialog; `scene-diff.vitest.ts` checks the details.
      Done: `diff/semanticDiff.ts` (a scene or a prefab by entity and component: the new, removed and changed entities, a new parent, each changed value with the old and the new value, a vector as one value; a sequence by track and key time) and `SemanticDiff.vue`; the version control panel shows it, and the recovery dialog of a draft shows the changes of the draft. The diff of two showroom versions names each changed value. Left: the Review panel and the change sets (UI5-04), and the conflict dialog with the view (it shows the lines of `sceneDiff.ts`).
- [x] UI12-06 Runs and the gate (should, S)
      The forms of `workbench.runs` (a command line or a run object with presets) and `workbench.gate` are the Agents and runs section of Project settings (UI12-01). The Jobs panel has a button for each run and each preset; the dev server runs the command line with no shell in the project folder (`scenity` is the CLI of the checkout), and a restricted project has no runs (UI1-12).
- [x] UI12-07 The Jobs panel (must, M)
      The Jobs panel (Layout and Build workspaces): the jobs of the dev server (each child process of a plugin: the build, the publish, the shots, verify, the renders, the bench, the check, the asset build, the release check, the pool, the runs; `trackJob` of `cliJob.ts`) and in the studio the jobs of the host (UI1-09), the newest first, each with its state, its time, its output pictures, clips and files, its log, Stop and Run again (the studio jobs keep their request arguments now).
- [x] UI12-08 Autosave and recovery (must, M)
      The drafts of a scene file are in the browser storage and on the host (`.scenity/drafts.json` of the project folder, `HostDraftStorage`): the newer of the two comes back, so a closed tab or a new browser gets its unsaved edits back. The recovery dialog of a draft shows the changes of the draft. Autosave is a project option (`autosave.enabled`, `autosave.seconds` of `scenity.editor.json`): the open scene saves after the seconds with no edit, never in the play mode.
- [x] UI12-09 Format upgrades (should, S)
      A scene file of an older format (the reader upcasts it at the load) offers its upgrade in a dialog with the diff of the file text; Upgrade saves it in the current format.

## UI13: Plugins and extensibility

- [x] UI13-01 The studio face of a plugin (must, M)
      The `scenity.studio` field of a plugin's package.json (else `studio.ts` or `src/studio.ts`) names its studio face, a module whose default export is `defineStudioPlugin(...)` of `@scenity/editor/studio`. The dev server gives the faces of a project (`loadProjectStudioPlugins` of `virtual:scenity/project-plugins`; a restricted project gets none), and the editor window installs them after its start: the texts of the plugin, its panels (each with its `panel.open.<id>` command) and its commands, with a context (the open scene, the selection, the commands, the panels, the toasts, the texts). The demo plugin of the spin sample adds the panel "Spinners" and the command `demo.selectSpinners`. The Vite config of the scene page dedupes Vue, so a `.vue` file of a plugin uses the Vue of the editor.
- [x] UI13-02 The contribution points of [extensibility.md](extensibility.md) §3 (must, L)
      Done: `panels`, `commands` (with `menu` for the menu bar), `componentIcons`, `widgets`, `createPresets` (a scene command and the + menu of the hierarchy), `overlays`, `toolbar`, `sceneTools` (a toggle that takes the pointer input of the Scene view; Escape turns it off), `previews`, `settings` (a section of Preferences from a JSON Schema; the values in `ctx.settings`), `recipes`, `pageTools`, `contextLines`, `statusItems`, `problemSources`, `docs` (F1 on a panel, the docs button of a component card) and `texts`; each has an example in the demo plugin of the spin sample and a test. Left: `templates` (the Hub has no project, so the point needs the host face), the context menu of the hierarchy, a settings section in Project settings (project values), the docs of commands, and the handles of a scene tool.
      2026-10-19: `menus` (an item of the context menu of a hierarchy row or of the empty tree; a row item runs its command with the entity; the spin sample: "Make it a spinner"), the docs of commands (`command:<id>`: a **?** link in the search box, F1 opens it), and `settings` with `scope: "project"` (a section of Project settings; the values in `.scenity/plugin-settings.json` of the project, `scripts/pluginSettingsApi.ts`; the spin sample uses it). Tests: `hierarchy-menu.vitest.ts`, `studio-plugins.vitest.ts`, `plugin-settings-api.vitest.ts`, `scene-studio-plugins.spec.ts` (+2: the menu item, the docs link; the settings step reads Project settings and the file). Still left: the handles of a scene tool and the host-face point `importers`. UI2-09 gives `templates` (in the package.json of a plugin, because the Hub has no project), UI9-10 gives `assetSources`.
      2026-10-19: the host-face point `importers` (an `Importer` of `@scenity/assets/import` for a file type of the plugin): the Import of the Project panel, the import dialog (the form of its settings), the reload of an asset, `scenity assets import` and `scenity assets build` use the importers of the plugins of the project; a value that is not an importer or a clash of a name or an extension gives a warning. The spin sample imports a `.pattern` file as a `demo.pattern` asset. The handles of a scene tool: `handles(ctx)` and `moveHandle(ctx, id, point, done)` of a `sceneTools` entry; the editor draws each handle over the Scene view while the tool is on, and a drag moves it on the level plane of its point (the spin sample: "Place the spinners", one undo step). Each point of §3 is in the API, with an example in the spin sample and a test.
- [x] UI13-03 The core panels use the same API (must, M)
      The core panels (the hierarchy, the inspector, the Project window, the Console, Problems, the Timeline and the agent panel) get the services of the shell from the public module `@scenity/editor/studio` only, as a plugin panel does: `usePanelState`, `usePanelVisible`, `useAgentAsk` and `EmptyState` (studio/extensions/hooks.ts). Their specs are in the one panel registry with the panels of the plugins. `core-panel-api.vitest.ts` fails when a component of a core panel imports a part of the shell from another module, or a hook from outside Vue, the texts, the UI kit, the API or its own folder.
- [x] UI13-04 The Plugins window (must, M)
      The Plugins window (File menu): the plugins of the project with their package (the name, the version, the description), their faces and the error of an entry that does not resolve, Remove; Add a plugin of the checkout (each `plugins/<name>/<face>` folder with a `scenity` field, as a folder path) or a package name or a folder path; the docs of the plugins. A change writes the project file as canonical JSON and makes the module of the project plugins again; a notice offers Reload. A restricted project has no change of its plugins. A person adds the physics plugin with no text editor, and the inspector offers its components after the reload.
- [~] UI13-05 The new plugin wizard (must, M)
  2026-10-19: the wizard makes each part of the plan: a system, a presenter (a three.js object of the component, `src/presenter.ts`), a simulation (the action keys of a sequence, `src/sim/simulation.ts`), a metric and a studio panel; `plugin-scaffold.vitest.ts` runs the code of each part. Left for the owner: J10 with a real agent turn (a model with a paid credential writes the logic).
  Done: "A new plugin" in the Plugins window: the plugin ID, a component with its fields (number, flag, text) and the parts (a system, a metric of the rules, a studio panel); Make writes a folder plugin into `plugins/<id>/` of the project (`scripts/pluginScaffold.ts`) and lists it; the files open from the list; "Ask the agent to write it" puts a prompt for the logic in the agent panel (`agent.ask`, in the studio). The Vite config of the scene page takes `vue`, `zod`, `three` and the engine packages of the editor for the faces of the plugins (and `@scenity/editor/studio` is an alias), so a folder plugin of a project with no node_modules loads. The new component shows in the inspector after a reload, and the studio panel of the new plugin opens. Left: J10 with a real agent turn (the agent writes the system, the person reviews the files and plays).
- [x] UI13-06 Hot reload and error isolation (must, M)
      Done (2026-10-19): three errors in a row of one contribution turn it off in each place where it shows (`contributionErrors.ts`); its card says so, and Turn on starts it again. The hot reload of a studio face: the studio faces have a module of their own (`virtual:scenity/project-studio`) that only `studioFaces.ts` imports and takes the hot updates of; an edit of a face disposes each face and activates the new ones, with no reload of the window (a Console line says so). Tests: `studio-plugins.vitest.ts` (the turn off and Turn on), `studio-plugin-reload.spec.ts` (an edit of the studio face of the spin sample adds a command, the old commands are there once, the panel works, and a value of the page stays).
      Done: each panel, overlay, widget and preview of a plugin renders in an error boundary (an error card with Try again; the editor works on); a page tool, a problem source, a status item and a scene tool that throw give their errors to the Console; the errors of a face and of its contributions go into the Console with the source "plugin", so Problems shows them; safe mode (`safe=1`) loads no studio face. Left: three errors in a row turn a contribution off, and the hot reload of a studio face (dispose and activate again).
- [x] UI13-07 The lab face in the studio (should, L)
      Done (2026-10-20, the adapter that the owner chose): `adaptLabFace` (`studio/extensions/labFace.ts`, in `@scenity/editor/studio`) makes a studio face from a lab face; the lab fixture runs in the studio with its Takes panel (`lab-face.vitest.ts`). `kept` names the parts that need the lab page.
      2026-10-20: `docs/lab-to-studio.md`: each part of a lab face (`EditorPlugin`) and its place in the studio (the points of the studio face, the host face, the runtime face, the rules), the steps of a move part by part, and the parts with no point yet (`selectionKinds` beyond the entity, `sceneDocument` with tune values, a take model that is not a sequence). Left for the owner: the choice between the adapter (a lab face as a studio workspace) and the move part by part of the resus plugin of CodeBlue.
- [~] UI13-08 Extension docs (must, M)
  Done: "The studio face" in docs/plugins.md (the module, the context, the hooks, the IDs, the errors, the versions); `docs/studio-plugins.md`, a guide to each point (what it adds, where it shows, its fields, the example of the spin sample, its test) and the steps of a first panel; the spin sample has an example of each point (the widget `demo.speedDial` too). Left for the owner: the usability test of the done-when (a developer adds a panel with the guide in 15 minutes).
- [x] UI13-09 API versions (must, S)
      `apiVersion` is a whole number (`STUDIO_API_VERSION` 1): the editor takes the current version and the one before; an older face gets a warning in the Console (with the way to the new version), a newer or an unknown one is not loaded and the editor works on. A test of the public surface of `@scenity/editor/studio` fails when the surface changes.
- [x] UI13-10 Plugin tools and commands in the UI (should, S)
      The commands of the CLI faces of the plugins (the list of `scenity --help` for the project) are commands of the window (`cli.<name>` with the argument `args`: a form in the search box, and the agents find them in the catalogue) and rows of the Jobs panel with an arguments field and Run; a run is a job of the dev server with its log. The tools of the host faces load in the studio host: the agent sessions of the project get them beside the core tools (a core name stays the core tool), and each one is a command `tool.<name>` of the search box with a form from its input schema; the run shows its text in a toast and the Console. A restricted project has none.

## UI14: Learn, help, accessibility and polish

- [x] UI14-01 The tour (must, M)
      The first open of the editor shows the tour: six steps over the Scene view, the hierarchy, the inspector, the Project panel, the timeline and the menu bar (with the search box), each step opens its panel and marks it, with Back, Next, Done and Skip (Escape too). The browser keeps that the tour is done (`scenity.tour.done`); Help → Take the tour (`help.tour`) shows it again. A page under automation does not start it by itself, so the specs and the gallery frames stay the same. The time of new people on the tour is a measure of the study of UI14-08.
- [x] UI14-02 Tutorials (should, L)
      Help → Tutorials has three tutorials: your first scene (add, name, light, place, save), a prefab (select, make a prefab, copy the instance, save) and a sequence (a new sequence, select, two keys, play). A step names a part of the window for its callout (a target of `ui_highlight`) and has a check on the scene, the selection, the save state and the sequence; the person does the step, and the card (`TutorialCard.vue`) goes on when the check passes. Show me puts the callout again, Skip the step and End are on the card, and the session storage keeps the tutorial over a reload (a new sequence reloads the window). The agent prompt of the studio says to show a person how with `ui_highlight` and names the tutorials; the Hub Learn section names them. `ui_highlight` on a vector field now finds its row (it found no element before).
- [x] UI14-03 Help in context (must, M)
      F1 on a panel opens its section of `docs/editor.md` (the new "The panels": one section for each panel), F1 in a field of a component card opens the docs of the component, and the card has a docs button. `docs/components.md` has a section for each built-in component with its fields (the label of the editor, the kind of value, the description of the schema); `bun tools/component-docs.ts` writes it from the registry, and a test checks that it is current. A plugin gives the links of its panels and components (UI13-02). A test checks that each panel and each built-in component has a link that names a heading of its page.
- [x] UI14-04 Empty states (must, S)
      Each panel has an empty state: what to do next, and a prompt for the agent (`empty-<panel>` and `empty-prompt-<panel>`; "Ask the agent" puts the prompt in the agent panel through `agent.ask` when the window has an agent). A panel with no content yet shows its empty state (not "Loading"), and the panels with lists (the hierarchy, Problems, the Console, Activity, Review, Tasks, Scenes, Jobs, Plugins, Version control) show theirs with their own text. A test lists each panel with its empty state.
- [ ] UI14-05 Accessibility (must, L)
- [x] UI14-06 Languages (should, M)
      Each studio text is in Fluent: `tools/editor-texts.ts` covers the Hub, the shell and the editor and gives 0 problems. pt-BR has each of the 3,215 messages of en-US (`apps/editor/src/i18n/pt-BR/`, 44 files, with a glossary for the studio terms); the ui package had pt-BR already. The new check `tools/check-i18n.ts` (`bun run check:i18n`, in CI) finds a syntax error, a message ID in two files, a translation with a message, an attribute or a variable that en-US does not have, an en-US message with no pt-BR text, and a pseudo-locale that does not parse. The e2e `studio-pseudo.spec.ts` opens the editor in the pseudo-locale with each of the 44 panels, and the Hub with the first run, its four sections and its two dialogs: no visible text, title, label or placeholder is out of Fluent (data such as names, paths and tool versions has `translate="no"`); a third test sees the menus and the panel tabs in pt-BR. The language is a preference of the studio host (UI12-02); `locale=` in the URL overrides it.
      Left in English, as data: the measure texts of `@scenity/rules` (`data-package-text`, the same text as `scenity check`) and the titles of the recipe documents.
- [x] UI14-07 UI speed budgets (must, M)
      The speed suite `tests/e2e/studio-speed.spec.ts` measures the budgets of vision.md §7 on a copy of the showroom with a scene of 10,000 entities and a plugin of 50 components, with the Metal GPU of the new headless Chromium on macOS, and writes `test-results/speed.json`. On this machine (Apple silicon, 2026-10-19), two runs: Hub first paint 280–284 ms (budget 1 s); the editor ready, warm, median of three loads, 1.46–1.56 s (3 s); the hierarchy of 10,000 entities scrolls at 16.6–16.7 ms a frame (60 fps) and a click selects in 1 frame; an inspector of 50 components shows in 80–109 ms (0.5 s); a key in the search box shows its results in 16–17 ms (50 ms). `SCENITY_SPEED_SCALE` scales the budgets for a slower machine.
      The fixes that the suite found: each frame read all the entities of the scene for the cameras, the icons and the count (now a cache for each document: an edit makes a new document); the pool and the plugin command routes of the dev server ran the CLI with a block of the server (now async, and the command list keeps for 5 s); the page asked `/health` five times (now once); the lazy chunks of the edit mode load while the scene loads; the terminal panel loads xterm.js only when it opens. Before the fixes the warm editor took 10–17 s with the software renderer and 2.6–3.2 s with the GPU.
- [ ] UI14-08 The usability study, round 2, with the journeys of UI0-05 (must, M, owner)
- [x] UI14-09 The agent benchmark v2 with the set of UI0-06 (must, S)
      The studio adapter (`tools/agent-bench/studio.ts`) runs the 24 cases through a session of the studio with an editor window. The first run: 18 of 24 ($8.59); it found three faults (an approval card with no person, `sequence.new` before its answer, a silent `scenity build`), all fixed; the failed cases again: 4 of 6. 22 of 24 (92 %) against the target of 85 %; the two failures are readings of the words of two placement cases, and their words are a task for the owner (docs/ui/research/agent-bench.md).
- [x] UI14-10 Docs (must, M)
      `docs/studio.md` is the manual of the studio (start, the Hub, the editor window, agents and their modes, jobs, version control, plugins, trust, preferences and languages, the files of the studio, troubleshooting) with four pictures (`docs/pictures/`, made by `docs-pictures.spec.ts` on request). The quickstart runs in the studio: after `scenity studio` each step is in the browser (new project, import, entities, save, Problems → Run scenity check, the Build panel, the Shots panel, the Rights panel, the release check, Publish). `docs/editor.md` opens through the studio; `docs/README.md`, `docs/architecture.md`, the root README and the skill of the repository name the studio. `tools/studio-docs.test.ts` checks that the quickstart has no terminal step after `scenity studio` and that each link and picture of the pages names a file.
- [x] UI14-11 Retire the old parts (must, M)
      No doc names the workbench page as the way to work: `docs/workbench.md`, `apps/workbench/README.md` and the root README say that it retires and name the studio, and the page shows the same note. The studio tests of the workbench moved to `apps/editor/tests/e2e/studio-tools.spec.ts`; the tests of the page itself stay with it for its last phase. `dev:editor` runs the studio; the scene page has no old shell (UI3); the lab page stays for lab faces. A changeset (`.changeset/studio-replaces-workbench.md`) gives the notes for one phase.
      Kept on purpose: `scenity dev` and `scene.html?edit=1` with no redirect to the studio, because the scripts, the CI and every e2e spec serve the scene page that way (`scenity dev` prints the studio command). The removal of the code of `apps/workbench` and `packages/workbench-host` (except `studioTools.ts`) waits for the end of the phase and for the owner: CodeBlue uses the page.
- [ ] UI14-12 The desktop shell (Tauri, SE8-09) (could, L)
- [x] UI14-13 Usage data (could, S)
      There is no usage data by default. Preferences → Usage log (`usage.log`, a setting of this browser, off by default) keeps a line for each command that runs (its ID, a key, a menu or a call, the time) in the browser storage (`scenity.usage.log`, the last 2,000 lines); Preferences shows the count with Download (a file of JSON lines for the study) and Clear. The page sends the log nowhere.

## UI15: Remote and shared review

- [x] UI15-01 The studio in remote mode (could, M)
      Each session of the studio has a role (`admin`, the owner; `editor`; `viewer`), from its launch link. A control that a role cannot use stays in the window, off, with the reason as its title (Save, the edits, the turn actions, the composer and Share for review for a viewer; the terminals, the trust, Share for review, the plugins and the Auto mode for an editor), and a viewer window and the Hub of another role have a line that says so. The host refuses the same requests with the same reasons. Remote mode: `scenity studio --public-origin <url>` keeps the host on 127.0.0.1 behind the gateway of the studio (`packages/studio-host/src/gateway.ts`, the public port: only the public `Host`, no host secret, the HTTP and WebSocket requests as they are); the links have the public origin, the host opens no shell terminal, and each file write of an agent asks, in the Auto mode too.
- [x] UI15-02 Review links (could, M)
      **Share for review** on a turn of the Agent panel makes a review link: a launch link of the role `viewer` that works for 7 days and opens the editor window with the turn (`review=<session>:<turn>`). The window of the viewer shows the session of the turn (its pictures and the changes of its tools) and the Notes panel; the viewer leaves notes and changes nothing (UI15-01). A link works on the machine of the host; on another machine it needs the studio in remote mode (UI15-01).
- [x] UI15-03 Note threads on entities for a team (could, M)
      A note of the note file has a thread of `replies` (a text, an author and a time; `scenity.notes/1`, the JSON Schema regenerated). The Notes panel shows **Reply** on each file note: the thread with the names and the times, and a field for a reply. A reply reads the note file first, so the replies of the other people stay; the panel reads the file again every 5 s while it shows. The user setting `notes.author` ("Your name in notes") names the person on new notes and replies. The e2e `studio-notes-thread.spec.ts`: Ana and Bruno, in two browsers, reply in one thread, each sees the reply of the other, and the file holds both with their authors.

## Progress log

Add the newest entry at the end. Each entry has the date, the tasks, what changed, the checks that ran and what is
left.

### 2026-10-17: the plan

- The plan, its design documents and this checklist are written (no task started). Sources: the reviews of the
  editor app, the workbench and the reference products; the facts are in [coverage.md](coverage.md).

### 2026-10-17: the owner's answers (UI0-01)

- The owner chose option (a) of each question of [plan.md](plan.md) §9; the answers table is there.
- Changes from the answers: UI1-13 (the host from npm) is a must task (Q6); UI3-02 names dockview, with our own dock as
  the fallback only (Q8); UI14-12 (the desktop shell) comes after M8 (Q7); the docs name the decisions, not the
  questions.
- Next: UI0-02, UI0-03 and UI0-04 (the three ADRs).

### 2026-10-17: UI0-02, UI0-03 and UI0-04 (the three ADRs)

- ADR 05 (`docs/adr/05-studio-process.md`): one host on one fixed port that needs no project; one origin by a proxy in front of **one** scene Vite server (not one Vite per project, not `/p/<key>/` base paths); `projects.json` that the scene server watches; the documents in the host; the editor window is the scene page in edit mode; the Hub is `hub.html`. The spike: two projects with HMR through the proxy, a command message to the host and back in 0.067 ms (p95). The plan, architecture.md and shell.md follow the record.
- ADR 06 (`docs/adr/06-agent-interaction.md`): actors, sessions, turns (an MCP turn ends after 5 s with no call), change sets as override layers with base hashes, accept as one undo step, conflicts and stale ops, the turn record, undo the turn, checkpoints (100 turns or 14 days), modes and kinds checked in one host tool layer, the shadow view, presence events.
- ADR 07 (`docs/adr/07-studio-extensions.md`): the `studio` face, the contribution points (importers and asset sources in the host face), `@scenity/editor/studio` as the one public module, edits as commands, lazy loading for trusted projects only, error boundaries and safe mode, `apiVersion`, the lab face adapter.
- `docs/README.md` lists the three records. Next: UI0-07, UI0-08, UI0-06.

### 2026-10-17: UI0-07 (spec IDs)

- `docs/ui/shell.md` gives one spec ID to each part: panels (their panel IDs), menus (`menu.<name>`), menu items and keys (their command IDs, a new column of the key table that reuses today's IDs such as `file.save`, `gizmo.move` and `clock.toggle`), toolbar groups (`toolbar.<group>`), status items (`status.<item>`), drops (`drop.<dragged>.<target>`), confirmations (`confirm.<case>`), window states (`state.<name>`) and key screens (`screen.<n>`). A test names its spec ID in its title.

### 2026-10-17: UI0-08 (the design language as tokens)

- `packages/tokens`: new primitives (violet, fuchsia, lime; yellow 800, green 800); `color.studio.*` roles in the dark, navy and light themes (selection = the accent, play = the attention orange, prefab cyan, six agent colours, change marks and rule results on the status colours, axes, overlays, grids); the shared file `src/components/studio.tokens.json` with the dense and comfortable sizes and font sizes (`--sc-studio-*`).
- Checks (`src/checks.ts`): the selection, play, prefab, agent and axis colours pass 3:1 on each surface (4.5:1 in high contrast); a distinct pair can now name its vision kinds, and each agent colour is 0.1 OKLab or more from the other agents, the selection and the prefab colour with normal vision (162 results, all pass). Six colours cannot also pass every colour-vision deficiency, so the session name is the second cue (design-system.md §3).
- The token page: `apps/editor/tokens.html` (`src/tokens`, `tokens.ftl`) on the scene dev server shows the 41 studio tokens in the six variants with their checks (0 failed; checked in Chromium). Tests: `bun test ./packages/tokens` 26 pass; `token-rows.vitest.ts` 2 pass; the editor typecheck, ESLint and Prettier pass. `apps/editor` now depends on `@scenity/tokens` (the reference file).
- design-system.md §2 and §3 name the real tokens.

### 2026-10-17: UI0-06 (the agent benchmark) and UI1 (the studio host)

- UI0-06: `tools/agent-bench`: 24 cases over the samples (placement 6, look 4, time 4, assets 3, rules 3, code 2, project 2), a check of the documents for each, right answers for the tests (`agent-bench.test.ts`: each check fails before the task and passes after it), the `files` adapter (`claude -p` in a copy of the sample), `--dry`, `--solve` and `--recheck`. The baseline with claude-opus-5-5: 23 of 24, median 37.3 s, $8.64 (`docs/ui/research/agent-bench.md`; the check of the stacked crate now takes a crate that drops onto Crate 1).
- UI1: `packages/workbench-host/src/studio/`: the studio host on 127.0.0.1:5170 with no project (registry, open projects, user state, access, jobs, folders, doctor, proxy, one scene server); `scenity studio` (`packages/cli/src/studio/command.ts`); `bun run dev:studio` (and `dev:editor`); `dev:lab` for the lab page. The scene server reads the open projects from `projects.json` and loads the plugins of a project that came later from a module of its own, with no reload of the other pages (`apps/editor/scripts/projectsFile.ts`, `sceneProjectPlugins.ts`); a restricted project gets no plugin code. The scene page with no project goes to the Hub (UI1-08); `scenity dev` and the lab page name the studio.
- Checks: the host studio tests (state, registry, access, jobs, server with a fake scene server, doctor), `projects-file.vitest.ts`, `scene-no-project.vitest.ts`, the e2e spec `studio-origin.spec.ts` (two projects in two tabs of one origin with HMR; a restricted project keeps its plugin components and loads them after the trust); `bun run test` 2232 pass, 0 fail; `test:components` 309 + 265 + 14; typecheck, lint, format, boundaries, shape, domain words, fixtures and licences pass.

### 2026-10-17: M0 (design agreed)

- The must tasks of UI0 are done (UI0-01 to UI0-04, UI0-06 to UI0-08). UI0-05 has its study kit and waits for the sessions with people; UI0-09 waits for the Pencil app; UI0-10 (could) is not started.

### 2026-10-17: UI2 (the Hub), UI1-07 and UI1-10

- The Hub (`apps/editor/hub.html`, `src/hub`; texts in `src/i18n/en-US/studio-hub.ftl`, because a file name of two or three small letters such as `hub.ftl` reads as a locale tag): the side navigation (Projects, Learn, Agents, Settings) with the agent state at its foot, New project and Open, the safe-mode banner and the notice of a failed action. The host serves it at `/`.
- UI2-02: cards and a list with the picture, the name, the folder, the last open, the scene count, the format version, the Git branch and changed files; pin, search, sort, rename, reveal, trust, remove from the list; "Folder not found" with Locate…, "newer format" and "restricted" marks.
- UI2-03: the wizard: the template gallery (Empty, Showroom and the six samples with their posters; a sample needs a checkout), the name rule of `scenity create`, the place (the folder dialog), Git, the packages (the links of the checkout or the published packages); a `create` job and a `git.init` job with the log, Retry after a failure, then the editor. UI2-05: the folder dialog (roots, Up, a new folder, open or "make this folder a project") and "Clone from Git" (a new `git.clone` job: HTTPS, SSH and file URLs only; a job value that starts with "-" is refused). UI2-06: the samples open as copies through the wizard, the docs, what is new. UI2-07: the first run (theme and language, an agent choice, the doctor) once on a fresh state. UI1-10: Settings shows the doctor with its fixes as jobs (the fix names its job) and the WebGPU check of the browser.
- Host: a job runs only in a folder under a root; `scenity studio --root <dir>` (default the home folder; the checkout is always a root; the first root is the default place); `/api/state` says whether the studio runs from a checkout. The published editor now lists `hub.html` and `scripts/projectsFile.ts` (the scene config imports it since UI1-03; it was missing from the tarball).
- Checks: `hub.vitest.ts` (15: the list, the steps of a new project, the first run, a failed create with Retry, a clone, the notice, the browser keys, the API client); the gallery spec `hub.spec.ts` (baselines of five states on darwin and linux; axe with WCAG 2.2 AA in dark, light, navy and dark with more contrast: no violations; `@axe-core/playwright` 4.13.0 is a new dev dependency); the e2e spec `studio-hub.spec.ts` (J1 from the Hub to the editor of a new project in about 5 s, back to the Hub and open it again; a clone of it opens too); `studio-origin.spec.ts` passes; the host tests (job folders, `--root`, `git.clone`); `bun run test` 21 tasks pass; `test:components` 324 + 265 + 14; typecheck, lint, format, shape, editor texts, boundaries, domain words and licences pass.
- Left in UI1 and UI2: UI1-13 (the host from npm), the parts of UI1-02/03/05/11/12 that come with UI3 and UI4, the drop of a folder (desktop shell), UI2-04 (start from a prompt, needs UI5-04), UI2-09 and UI2-10 (could). M1 waits for UI1-13.
- `coverage.md` has the mark Hub: seven rows of "Projects and the start" moved to the Hub; 93 of the 164 rows now have a place in a UI (86 at the start).

### 2026-10-17: UI1-13 (the studio host from npm) and UI1-02

- The studio host is its own public package: `packages/studio-host` (`@scenity/studio-host`, in the fixed release group and the first-release changeset), as ADR 05 said (the ADR has a note). It depends on `@scenity/editor` (its scene server; `check:boundaries` allows this one user of the editor app), `@scenity/cli` (the jobs) and `@scenity/scene`; `@playwright/test` is an optional peer (the doctor). `src/runtime.ts` finds the parts: the checkout of the package, else the installed packages; `src/process.ts` has the server child, the log ring, a free port and the child environment (the workbench host now imports `LogRing`, `freePort` and `APP_ID` from it). An installed host keeps the Vite cache in `<state>/vite-scene` (`SCENITY_SCENE_CACHE_DIR` of `vite.scene.config.ts`).
- `scenity studio` runs `packages/studio-host` of a checkout, else the installed `@scenity/studio-host`, else that package at the version of the command through `bun x` (the studio host depends on the CLI, so the CLI does not depend on it); `--root` folders become absolute too. The bin `scenity-studio`.
- Proof: `bun tools/studio-pack-smoke.ts` packs the 18 public packages, installs them with Bun in a temp folder outside the checkout (real folders, no links), starts `scenity studio`, signs in, sees the Hub, makes a plain folder a project and sees its editor page draw (`data-ready="1"`); `/api/state` says "no checkout". The CI job of the end-to-end smoke now runs it and the two studio e2e specs. A new project of an installed studio takes the Scenity packages of its version from npm, so the wizard of an installed studio works after the first release.
- Checks: the studio host tests (42 + 6 for the runtime and the server child), `packages/cli/tests/studio.test.ts` (3), `release.ts check` (18 packages), `bun run test` 23 tasks pass, `test:components` 324 + 265 + 14, `studio-hub.spec.ts` and `studio-origin.spec.ts` pass, `scenity studio` of the checkout answers `/health`; typecheck, lint, format, shape, boundaries, domain words, licences and fixtures pass; actionlint is clean.
- M1 (starts empty): the journey works from a checkout and from the packs. Three must tasks of UI1 keep parts that land with the editor shell: UI1-03 (the specs and the gallery through the studio, UI3-01), UI1-05 (the pages read and write the user state, UI3-03) and UI1-12 (the trust prompt and the restricted banner in the editor, UI3-08). M1 gets its tick with them.

### 2026-10-17: UI3-01, UI3-11 (done); UI3-02, UI3-03, UI3-08 (in review)

- The editor window is one Vue app (`src/studio/shell`): title bar (Window menu, workspace tabs), toolbar (file bar, gizmo bar, Layout menu), banner row, dockview 8.4.0 dock, status row, dialog host. The three separate `createApp` panels are panel contents; the canvas and its overlays live in the Scene view; a ResizeObserver keeps the renderer size. Panel registry: id, title, icon, area, keys, key context, `many` (copies), `when`, panel state in the layout (`usePanelState`). Dock: default layouts, open/close/float/move/maximize/next by keyboard and the Window menu, size limits, layout store.
- Workspaces (Layout, Animate, Assets, Review, Build) with Save as/Rename/Delete/Reset, kept in the browser and in the host user state (`/api/user/layouts`), and the project default (`layout.workspace` in `scenity.editor.json`). Dialogs (confirm, prompt, choice) replace the notice bar with the same test IDs; toasts (saved), banners (play mode, restricted mode with `confirm.trust`), and the beforeunload guard.
- Checks so far: component and unit tests 347 pass; lint, typecheck, format, shape, editor texts, licences pass; the gallery frames of the samples match their baselines (107 pass; the Hub axe spec got a wait for the theme transition); the layout spec (keyboard-only dock, reload, workspaces) passes 3 runs in a row. The last full e2e run found the empty banner row shifting the grid (the status row covered the panels); after the fix the layout and assets specs pass. Left: one full rerun of the scene and studio e2e specs, then the ticks of UI3-02, UI3-03, UI3-08 and UI1-12.

### 2026-10-18: UI3-03, UI3-08, UI1-12 (done); UI3-06 (in part)

- The full scene and studio e2e suite passes (44 specs) after the fix of the empty banner row and the spec fixes (a point found again after a reload; the backend and tier are data values for the pseudo-locale check). studio-origin.spec.ts trusts the restricted project through the banner and `confirm.trust`.
- UI3-06: `WindowStatus` and `StatusBar.vue`: the save state (a press saves), the selection count (a press runs `view.frame`), the problem counts of a background rule check after each edit (a press opens the Rules panel), the backend, tier and frames per second from the core statistics (a press opens the inspect panel), and the bell of facts that need an action. `pageKeys().run(id)` runs a command by its ID. Tests: `studio-status.vitest.ts` (3), the status test of `scene-layout.spec.ts`.

### 2026-10-18: UI3-10 (done)

- `src/studio/shell/theme.ts` (`PageTheme`): the theme goes on the body (the dialogs and menus in the body take it too) and the contrast on the root element (the token rules are `[data-contrast="more"] [data-theme=…]`). The browser keeps the choice (`scenity.studio.theme`); in the studio `/api/user/preferences` keeps it too (the Hub uses the same rule now, so its contrast works). Preferences has a theme select and a High contrast box; `theme.dark`, `theme.light`, `theme.navy`, `theme.contrast` are page commands (the key map has them; the search box of UI3-07 will list them). No panel forces a theme now; the toolbar bars, the scene switcher and the gizmo bar take the tokens.
- axe on the window in the four variants found: the close button of a dock tab nested in the tab (`role="tab"`; now a pointer-only control, the keyboard closes with Delete on the tab or `panel.close`), a close target under 24 px (now 24 px), the scene switcher and the pressed gizmo button under AA in light and navy (now tokens). The asset panel on a host with no asset list gives a Fluent text, not a JSON parse error.
- Checks: `editor-themes.spec.ts` (gallery, scene project): four darwin baselines and four axe checks pass; the full gallery passes; component tests 354 pass; the settings spec has a theme test (select, contrast, reload); lint, typecheck, format, shape, texts, licences, boundaries pass. Left for the end of the phase: the Linux baselines (`scripts/gallery-linux-baselines.sh missing`).

### 2026-10-18: UI3-13 (done)

- `src/studio/shell/fold.ts` (`DockFold`, `unfolded`): under 1280×720 (`FOLD_QUERY`) the groups of the left and right areas hide, and `EdgeRail.vue` shows a rail of tabs on each edge. A rail tab shows its side (one at a time); a second press, or an active panel of the centre or the bottom, folds it; `Dock.open` (keys, Window menu) shows the side of the panel. The fold never goes into a stored layout (`unfolded` takes out `visible: false`), never touches the groups that a maximized group hides, and lays the dock out at the size of the window before the sides show again (else the dock gave all the new room to the last group). The dockview auto-hide edge groups are in the paid `dockview-enterprise` package, so the fold is ours.
- Tests: `studio-shell.vitest.ts` (2 fold tests); `scene-layout.spec.ts` (the small page folds; the rail test; 3 runs in a row pass); `studio-hub.spec.ts` J1 checks the Hub at 1024×700 (no sideways scroll; the project card and the main actions in the window). `editor-sizes.spec.ts` (gallery, three sizes) is written; its baselines come at the end of the phase.

### 2026-10-18: UI4-01 (done)

- `@scenity/editor-core`: a command has a description for agents, an icon, a category, a menu path and an undo kind (`scene`, `sequence`, `none`); `commandMeta` gives the defaults. `argsSchema.ts` makes the zod schema of the arguments (the same rules as `parseArgs`) and its JSON schema; each listing has the metadata, the keys and the schema. The core commands have their menu paths and icons (shell.md §6); the sequence commands have `undo: "sequence"`.
- One registry for the window: `pageKeys()` joins the page commands, the scene commands and the commands of the open sequence. `list()` gives each one with its keys now and its state; `execute(id, args, { by })` runs one (a script or an agent reaches only the page commands with `agents: true`; an agent edit of the sequence needs the switch "apply"). The script API `commands()`/`command()` and the bridge calls (`scene_commands`, `scene_command`) use it; `scene_commands` shows the description and the category.
- The shell commands are one list (`studio/shell/dockCommands.ts`): the panels, `panel.copy`, `panel.move.<area>`, `workspace.switch`, `layout.saveAs`/`rename`/`delete`/`reset`. The Window menu, the Layout menu (its name dialog is now the prompt of the window), the workspace tabs and the key map run the same specs. The play bar runs `play.start`, `play.replay`, `play.stop`, `play.keep`, `play.window`. Each button and menu item of the chrome has `data-command` (the ui `Menu` renders it; the status bar items too).
- Tests: `command-meta.test.ts` (5: defaults, listings, zod and parseArgs agree, JSON schema); `scene-layout.spec.ts` "each button and menu item of the window runs a command of the one registry"; the bridge and tool tests follow the new lines.

### 2026-10-18: UI3-04 (done)

- `MenuBar.vue` in the title bar: the menus of shell.md §6 in their order, made from the `menu` metadata of the commands (`edit`, `entity`, `sequence/loop`, `window/theme`; a menu ID, then a submenu ID) through the `CommandPort` of the shell context (shellHost.ts over `pageKeys().list()`). An entry shows the first key of its command, and the entry of a command that cannot run now is off with the reason as its tooltip and description. The labels are short Fluent texts (`menu-item-*`), else the title of the command. The Window menu is the dock menu with the theme submenu from the metadata. A menu with no command does not show.
- The ui `Menu` has shortcuts, hints and submenus. The page commands have their menus (save, undo, redo, frame, play, the clock, Preferences in File, the theme); the core commands have `edit`, `entity` and `sequence`.
- Tests: `studio-shell.vitest.ts` (the menus from a fake port: keys, an entry that is off with its reason, a press runs the command, a menu with no command does not show); `scene-layout.spec.ts` "the menu bar: an entry runs its command, and an entry that is off says why" and the UI4-01 test opens each menu of the bar.

### 2026-10-18: UI3-05 (done)

- The toolbar: the file bar, the tools (View Q, Move W, Turn E, Scale R) and the tool settings (pivot, axes, snaps) in a `role="toolbar"` group, the clock group in the centre (a new `clock` region of the shell), and the Layout menu at the right. The View tool (`gizmo.view`, a gizmo mode "view") shows no gizmo, and a press selects but drags nothing.
- The clock group: Play (`play.start`, ⌘P), Pause (`play.pause`, ⌘⇧P), Step (`play.step`, ⌥⌘P: one frame of 1/60 s with the clock stopped), Stop, Keep, Replay, Play in a window and the time field (`play-time`). Pause and Step show in the play mode with a clock; without a sequence they say why.
- Tests: `scene-play.spec.ts` "the toolbar works by keyboard" (Q and W, Tab and Enter on the tools, ⌘P, ⌘⇧P, ⌥⌘P, the time); `scene-gizmo.vitest.ts` (the View tool has no gizmo); the play spec checks that the clock group fits in the toolbar.

### 2026-10-18: UI3-07 (done)

- `studio/shell/search.ts` (`WindowSearch`, `searchAll`, `parseQuery`, `scoreText`, `readsAsSentence`) and `SearchBox.vue`: one box at the top of the window (a combobox with the results in groups, ↑ ↓ ↩, ⌘↩ asks, ⌘C copies, Escape gives the focus back). The rank: an exact name, a start, a word start, a part, all the words, the letters in order; a detail counts half; the last runs win among equal items (`scenity.studio.search.recent`). A sentence, or a text with no result, gives "Ask the agent" first (off with its reason while the window has no agent).
- `scene/searchProviders.ts`: the commands of the window (those with no required argument), the entities (`c:`), the scene files of the project, the assets (`t:`, `tag:`, `in:`; a result shows the asset in the Project panel through `assetFocus.ts`), the editor settings (Preferences at the field) and the headings of the docs (a lazy load of the docs of the person; a result opens GitHub at the heading). `search.open` (⌘K) and `search.scene` (⌘O, `@`) are page commands.
- Tests: `scene-search.vitest.ts`: 30 queries find their target in the first three results; the query words; the sentence test; the recent items. `scene-layout.spec.ts` "search and ask" (⌘K selects an entity, the agent row of a sentence, Escape, ⌘O, a command from the box).

### 2026-10-18: UI3-09 (done)

- The focus ring: the dock group with the focus has a frame (a `::after` frame: dockview puts `outline: none` in the style of each group). The keys of shell.md §10 for the commands that exist are their defaults: H, ⇧H, ⌥H (hide, solo, show all, the scene context), ⌘P on `play.toggle`, ⌘O on `scene.quickOpen`, `?` (`help.keys`) and F1 (`help.context`: the docs section of the active panel).
- Held and modal keys in the key map (`keyKind` of a page command; the key listener runs neither): the fly keys (`camera.fly.*`, context `fly`) and the look keys (`camera.look.*`) come from the key map, so a change works at once (viewportInput.ts reads them); Enter and Escape of a gizmo drag (`gizmo.confirm`, `gizmo.cancel`, context `drag`) show as fixed in Preferences. `commands()` leaves them out (no actions).
- The key sheet (`KeySheet.vue`, `keySheet.ts`): each key by its context, the held and modal keys marked, a filter.
- Tests: `scene-layout.spec.ts` "each default key of shell.md works in its context, and the key sheet lists it" (the defaults of 31 commands, the sheet, ⇧H and ⌥H on the selection, the focus ring, F1).

### 2026-10-18: UI4-02 (done)

- `@scenity/editor-core` `inspector/commands.ts`: `component.set` (`entity`, `component`, `field` with dots, `value` as JSON), `component.reset`, `component.add` (a value, else the default value) and `component.remove`. The ops are the ops of the inspector (`fieldOps`, `resetToDefaultOps`, `addComponentOps`, `removeComponentOps`), with the prefab overrides of a prefab entity; the target `scene` edits the scene values; no target edits each selected entity. The title names the component and the field ("Light: intensity", "Reset Light: intensity"), so Undo names the field. A bad component, a value that is not JSON, an unknown entity and an edit with no change give a clear reason. The scene page registers them (a run of an agent is a proposal by the rule of the runner).
- Tests: `component-commands.test.ts` (6, on the showroom); `scene-bridge.vitest.ts` "lets Claude set a field of a component with component.set; the step names the field".

### 2026-10-18: UI4-03 (done)

- `@scenity/editor-core` `entities/presets.ts`: 14 presets (empty, box, sphere, cylinder, plane, point, spot, directional and ambient light, camera, socket, path, stand point, note) as `entity.create.<preset>` (name, parent, x, y, z); each adds one entity in one step. `scene/projects/fileCommands.ts`: `scene.new`, `scene.open`, `scene.save`, `scene.saveAs`, `scene.close`, `sequence.new` (writes the file and opens it), `prefab.create` (the entity and its subtree, the root at the origin), `material.new` and `project.set`, all for agents too. A run of the person with no name or path asks in a dialog; a refusal throws the reason (a person sees it in a toast through `pageKeys().failed`). A new file carries the rule results of the page to the gate of the writer.
- `@scenity/cli` writer: a new file (no file and no base hash) makes its folder in the project (for example the first `prefabs/` file); a change of a file still needs its folder.
- The search box does not offer "Ask the agent" for a text with the prefix of a provider (`>create a point light` gives the command).
- Tests: `entity-presets.test.ts` (each preset gives a valid entity), `scene-file-commands.vitest.ts` (the file name, the prefab of a subtree), `scene-commands.spec.ts` (a preset from the search box; each file and project command as an agent on a copy of the showroom, with the files on the disk).
- Seen: `packages/cli` `build.test.ts` "the build passes the budgets and the marker gate" fails on the player markers of the scene worker (`runtime/src/plugins/*`, a browser stub of `packages/cli`); no source of the player, the runtime or the render changed since the plan, so it is older than this work. It stays open for a look.

### 2026-10-18: UI4-04 (in part)

- `@scenity/editor-core`: `Actor` (person, agent with session, name and colour, script, plugin); `Edit.actor` and the `StepLabel.actor` of the history; the runner sets it from `CommandOptions.actor`, else from `by` (owner: the person; Claude: an agent; a script). A proposal keeps the actor of its maker, so the step after Accept names the agent.
- The bridge: `command` reads `how.session` (`{ id, name, colour }`) into the actor; `scene_command` passes `ctx.session` of the tool call when the host has one. The script API `history()` gives each step with its title and actor.
- Tests: `scene-bridge.vitest.ts` (an agent session with its name and colour, then the person), `sceneTools.test.ts` (the session of the call goes to the page).

### 2026-10-18: UI4-05 (in part)

- `scene_commands` gives the JSON Schema of the arguments of each command (the `schema` of the listing) and finds a command by its description and category too. `scene_command` checks the arguments of a listed command on the host before the run (`argProblems`: an unknown name, a missing argument, the type, the range, the list); the page answers an unknown command.
- The job tools (`tools/jobs.ts`): `job_run` (the runs of the open project for agents, as `workbench_run`; it gives the job ID at once), `job_status`, `job_output`; the host gives them a `JobPort` over the run manager of the checkout.
- Tests: `sceneTools.test.ts` "an agent runs each command of the catalogue with checked arguments" (each command of the fake page, generated valid arguments, and a bad argument that stops at the host), `jobTools.test.ts` (2), the tool lists (29 tools over MCP).

### 2026-10-18: UI4-06 (done)

- `@scenity/bridge` `uiCalls.ts`: `ui.state`, `ui.reveal`, `ui.highlight`, `ui.notify` with their argument checks. The scene page (`scene/uiCalls.ts`) serves them and gives them in the script API (`__scenity.ui`): the state of the window; a reveal that selects (a field of a scene component selects nothing, so the inspector shows the scene), frames, opens a panel, waits for the field, scrolls it into view and puts a callout with the text on it; a highlight of a field, a panel, a test ID or a command ID; a toast. A press or Escape takes a callout away. The answer of a reveal is tokens (`panel:inspector`, `field:environment.exposure`).
- The host tools `ui_state`, `ui_reveal`, `ui_highlight`, `ui_notify` (`tools/ui.ts`); 33 tools over MCP.
- `scene/windowParts.ts` takes the start of the search box, the file commands and the UI calls out of `editMode.ts`.
- Tests: `scene-layout.spec.ts` "the UI calls: one reveal shows a person the exposure field with a callout", `uiTools.test.ts` (2).

### 2026-10-18: UI4-10 (done)

- `@scenity/editor-core`: `EditHistory.squash(mark, label)` folds the steps after a mark into one step; `Runner.propose(edit, command, args, by)` keeps an edit of many commands as one proposal.
- `scene/hierarchy/commandBatch.ts` (`runBatch`): the steps apply one by one after a mark of the history (each on the document of the step before it); a failed step rewinds to the mark and names the step; at the end the steps fold into one step with the title, or (an agent in the proposal mode) the history rewinds and the ops wait as one proposal. A person-only command stays out of a batch of a script or an agent.
- The bridge call `commandBatch` (`[steps, title, how]`), the script API `commandBatch`, and the host tool `scene_batch` (it checks the arguments of each listed step first); 34 tools over MCP.
- Tests: `scene-bridge.vitest.ts` "runs a batch as one step, all or none: a failed step of 10 leaves the document as before" and "keeps a batch of Claude as one proposal".

### 2026-10-18: UI4-09 (done)

- `@scenity/bridge` `STUDIO_STATE_CALL` (`studio.state`, the `StudioState` type); `scene/studioState.ts`: the project, the open scene (path, ID, name, entity count, dirty), the selection, the root entities (at most 40: ID, name, components, child count), the prefab files, the open sequence, the problem counts of the status bar and the switch of the session. The script API `studioState()`.
- The host tool `studio_state` (always loaded, the first core tool; it gives the state as JSON); the editor line of the system prompt and the tools line of the packet name it as the first call. 35 tools over MCP.
- Tests: `scene-layout.spec.ts` "the one state call of an agent is small: under 4 KB for the showroom"; the tool tests (the list of the always-loaded tools, the tools line).

### 2026-10-18: UI4-07 (done)

- `@scenity/studio-host` `bridgeHub.ts`: the editor windows connect to the socket `/bridge` (the session and origin checks of `/events`), say their project and scene (`hello`), and answer the bridge envelope of `@scenity/bridge`. `POST /api/bridge/<call>` (the host secret, or a session with its CSRF value) sends a call to the newest window of a project; `GET /api/bridge` lists the windows. A closed window or no answer in time is an error.
- The scene page (`scene/studioBridge.ts`): with no workbench frame, a page of the studio opens the socket and answers the same calls as in a frame (`pageCalls` of sceneBridge.ts and the script API, over the same `createWorkbenchBridge`); bytes travel as `{ $bytes }`; a closed socket opens again. The frame relay stays for embeds and the remote mode.
- `@scenity/workbench-host`: `studioPort.ts` (a `SurfacePort` over `/api/bridge`, the bytes back as `Uint8Array`) and `studioTools.ts` (a small tools server for the studio: `POST /tools/<name>`).
- Tests: `bridgeHub.test.ts` (2), `apps/workbench` `studio-bridge.spec.ts` "the tools of the workbench run against an editor window of the studio with no workbench page" (`studio_state`, `scene_query`, `scene_commands`, `scene_command`, `ui_state`, and a picture of `scene_frame`).

### 2026-10-18: UI4-08 (in part)

- `@scenity/bridge` `SHADOW_FRAME_CALL` (`shadow.frame`: a time, a document camera, a width); the scene page (`scene/shadowFrame.ts`) renders the camera off the screen (the camera preview of the core), so the camera of the view does not move; a time stops the clock there for the picture and puts back its time and its play state; the selection does not change. The script API has `playing()`.
- `scene_frame` takes its picture from `shadow.frame` on a page that has it; the lab keeps its visible frame.
- Tests: `apps/workbench` `studio-bridge.spec.ts` "20 agent frames leave the camera, the time and the selection of the person as they are" (the characters sample in the studio; times and cameras of the agent).

### 2026-10-18: UI4-11 (done)

- `scene/activity/activityLog.ts` (`ActivityLog`, `pageActivity`, `scriptText`, `promptText`, `replayLines`): the page commands record each run, each batch and each accepted proposal with its actor, its arguments, its title and its outcome (500 lines at most). The Activity panel (`activity`, a core panel of the bottom area; the Review workspace has it) shows the lines with the colour of an agent session and copies a line as a script call or as a prompt (Fluent texts).
- The script API: `activity()` and `replayActivity(lines)` (the lines that applied, in their order; a batch as a batch).
- Tests: `scene-layout.spec.ts` "the activity log of a session replays into a copy and gives the same document" (the person, a batch, an accepted proposal of an agent; reload, discard the draft, replay; the same document); the shell tests count the panels of the Layout workspace.

### 2026-10-18: UI4-12 (done)

- `entity.duplicate` takes an offset (`x`, `y`, `z`) that moves the roots of the copies. The page commands keep the last action of the person that made a step (`lastAction`); `adjust(change)` undoes that step and runs the action again with the changed arguments, only while its step is the step now; the activity log marks the replaced line "adjusted" (a replay leaves it out).
- `scene/activity/adjustPanel.ts`: the Adjust panel over the Scene view with the number arguments of the last action; a change runs it again; it goes when another step comes or on its close button. The script API: `lastAction()`, `adjustLast(change)`.
- Tests: `duplicate-offset.test.ts`; `scene-layout.spec.ts` "adjust the last action: a duplicate with an offset, then a new offset in the panel, one step".

### 2026-10-18: UI4-13 (in part)

- `@scenity/editor-core` `docDiff.ts` (`docOps`): the ops between two versions of a document (`remove` children first, `add` parents first, `move`, `set`, `addComponent`, `removeComponent`, the values of the scene), checked against the new version (else null).
- The scene page (`documentSync.ts`): in the studio, each change of the open scene (a drag at its end) goes as `doc.ops` over the socket of the bridge; the ops of another window or of an agent apply as one step ("A change from another window"); a change of the open scene says hello again with the new scene.
- `@scenity/studio-host`: the hub relays `doc.ops` to the other windows of the project and scene; `POST /api/documents/run` (`documents.ts`) runs an entity, hierarchy, transform, component or create command on a scene file with no window, writes it through `saveMeasured` (the host measures the rules) and relays the ops to the open windows. The host depends on `@scenity/editor-core` now.
- Tests: `doc-diff.test.ts` (2); `apps/workbench` `studio-bridge.spec.ts` "an agent edits a closed project; two windows and the agent edit one scene and stay equal".

### 2026-10-18: UI3-12 (done)

- `scene/windowIdentity.ts`: the title of the editor window is `* scene · project · Scenity` (`*` while the scene has changes that are not saved; Fluent texts) and the icon of the tab gets a dot then (two SVG assets). The file bar asks the window identity to show the title (`refreshWindowIdentity`); with none it sets its old title.
- The windows of a scene share their selection (`window.selection`) and their saves (`window.saved`: a window whose scene has the saved text takes it as its base, so it shows the same dirty state); a run of an agent with no window gives its saved text with its ops. `ScenePageEditor.listenSaved`.
- The proxy of the studio gives the scene server its own origin for a request that passed the access check of the host, so a save from an editor window of the studio works (UI1-03 had no save through the studio before).
- Tests: `apps/workbench` `studio-bridge.spec.ts` "a second window of a project shows the same selection and dirty state, and its title names the scene".

### 2026-10-18: UI5-01 (done)

- `@scenity/agent-tools` (new public package): the agent tools (`studio_state`, `scene_*`, `ui_*`, the job tools), their kit and their context, `STUDIO_TOOLS`, `listingsOf` (the MCP listing with the JSON schema from zod), `runToolOf` (the input check and the run) and `reviveBytes`. The workbench host takes its tools from it (`export *`), so both hosts run one implementation.
- `@scenity/studio-host` `agents/`: `AgentSessions` (sessions per project with a name, a colour token `agent-1` to `agent-6`, a mode Ask, Review or Auto, a model, an effort, a cost, a context share, a transcript and a queue; Stop; fork; close), the API `/api/agent/sessions…` (`routes.ts`) and the events `agent.session`, `agent.item`, `agent.closed` on `/events`. The tools go to the newest editor window of the project over the page bridge; Ask refuses the edit tools, Review sends each edit as a proposal. The drivers: Claude (`claude.ts`: one Agent SDK `query` per turn with the in-process MCP server `scenity`, a resume of the last SDK session, `forkSession` for a fork, only the read tools of Claude Code) and a script (`driver.ts`, `SCENITY_AGENT_SCRIPT=<file>`) for the tests.
- The editor (`scene/agent/`): the Agent panel (a core panel of the right area; available when the studio host answers, and it joins a default layout with no focus, `Dock.adopt`), its store and its client: session tabs in their colours, the transcript with a card per tool call, the composer (⌘↩ send, ⌘. stop, ↑ the last prompt, a queue during a turn), the mode, the model, the effort, the cost and the context share, and the ⋯ menu (rename, fork, export as Markdown, close). The mode of the active session sets the proposal switch of the window (Auto: apply). The commands `agent.focus` (⌘L), `agent.new` (⌘T), `agent.send`, `agent.stop`, `agent.rename`, `agent.fork`, `agent.export`, `agent.close` are in the Agent menu. The text `menu-entity-create` of the Create submenu was missing (UI4-03); it is there now.
- Tests: `packages/agent-tools/tests/registry.test.ts` (5); `packages/studio-host/tests/agentSessions.test.ts` (6: a turn with a tool call to a window, the modes, the queue and Stop, a fork, an error, the API and the events); `agent-panel.vitest.ts` (3); `studio-shell.vitest.ts` "adds the agent panel to a default layout when the studio answers"; `apps/editor` `studio-agent.spec.ts` (a prompt from ⌘L and ⌘↩ runs a script turn that moves the armchair as a proposal; Auto sets the switch; a queued prompt; Stop; rename through the ⋯ menu).

### 2026-10-18: UI5-02 (done)

- `@scenity/studio-host` `agents/context.ts`: a prompt takes its chips (`readChips`: at most 24, cut texts, PNG, JPEG or WebP pictures); the context packet (`<studio-context>`, one line a chip) and the pictures go to the model with the prompt (the Claude driver sends one SDK user message with the text and the image blocks); the prompt item keeps each chip with no picture data. The script driver has `{context}`.
- `@scenity/runtime-dev`: the preview `@view` (`VIEW_PREVIEW`): a picture of the view that draws now with no dev layer.
- The editor (`scene/agent/agentContext.ts`, `agentChips.ts`, `agentWindow.ts`, `viewRegion.ts`, `AgentComposer.vue`): the chips that come by themselves (the scene, the selection, the time of the sequence, the camera of the viewport, the last panel), ✕ (a removed chip comes back after the prompt), `@` mentions from the providers of the search box (entities, files with sequences, assets, commands) and the project rules, a drop of hierarchy rows (`application/x-scenity-entities`), asset tiles and picture files, a paste of a picture, ＋ a picture file or a region of the Scene view (a drag box over the view; the `@view` preview cropped to WebP). The transcript shows a Context fold per prompt.
- Tests: `agentSessions.test.ts` "the chips of a prompt go in the packet and in the prompt item"; `agent-panel.vitest.ts` (the chips of the window, a removed chip, an `@` mention, the region shares); `studio-agent.spec.ts` "the chips of the composer go with the prompt, and a removed chip stays out" (the selection, a mention, a real region of the view; the camera chip removed).

### 2026-10-18: UI5-03 (done)

- `@scenity/studio-host`: the pictures of the tool results go to a picture store (`agents/pictures.ts`, the newest 200; `GET /api/agent/pictures/<id>`); a tool item has their IDs. The sessions have the job tools (`agents/jobPort.ts`: `job_run` for `check`, `build`, `shot`, `sheet` and the asset commands, a command line read into the typed arguments of the studio jobs; `job_status`, `job_output`); Ask refuses `job_run`.
- The editor (`scene/agent/agentCards.ts`, `AgentToolCard.vue`): a card for each core tool: the sentence (the command title of the window and the names of its entities), the state, the first line of the result or the whole output of a job, the pictures, "Show in the scene" (select and frame) and the raw call in a fold.
- Tests: `agentTools.test.ts` (4: the command line of a job, the allowed jobs, Ask and `job_run`, the picture store); `agent-panel.vitest.ts` (the card of each core tool; pictures, raw call, Show in the scene); `studio-agent.spec.ts` (the card of the move: its target, its state, the raw call, Show in the scene selects the armchair).

### 2026-10-18: UI5-04 (in part)

- `@scenity/editor-core`: `Actor.turn`; `changeSets.ts` (`changeSetsOf`: the proposals of one turn of a session are one set, keys `<proposal>:<index>`; `opsByEntity`, `sceneOpEntity`, `sceneOpView` with the old and new value); `Runner.acceptOps(keys, title)` (the chosen ops as one step; the proposals keep the others) and `rejectOps(keys)`.
- `@scenity/agent-tools`, `@scenity/studio-host`: the session of a tool call has its turn; the page puts it in the actor of the edit. The script driver has `prompts` (the steps of a prompt text).
- The editor (`scene/review/`): the review state of the page (`pageReview`: the sets, the checked ops, the entity and field marks, the conflicts, the result of each review), the Review panel (a core panel of the bottom area), the status item "N changes wait", Preview (the core draws the result; the editor document stays), the marks of the hierarchy rows and inspector fields, the pins of the Scene view (`viewport/changePins.ts`), the bar of the agent panel and the review chip of the next prompt. `scene/actorColour.ts` gives the colour of an agent session token (the Activity panel uses it too). The script API: `changeSets`, `acceptOps`, `rejectOps`; an accepted part replays from the activity log.
- Tests: `change-sets.test.ts` (3); `review-panel.vitest.ts` (3); `studio-agent.spec.ts` "a person accepts 3 of 5 changes of a turn as one step, rejects the rest, and the agent hears it"; the layout lists of `studio-workspaces.vitest.ts` and `scene-layout.spec.ts` have the Review panel.

### 2026-10-18: UI5-05 (done)

- `@scenity/studio-host` `agents/turns.ts`: a record per turn (the prompt, the times, the tools, the frames, the jobs, the cost, each project file before its first write; a path out of the project is refused); `GET …/turns`, `POST …/turns/<n>/undo` (the files go back, a made file goes, then the bridge call `turn.undo` to the newest window of the project; an `undone` item in the transcript). An end item names its turn. The Claude driver lets an Auto session run Edit, Write, MultiEdit and NotebookEdit after a snapshot; the script driver has `write` steps.
- `@scenity/bridge` `turnCalls.ts`: `turn.undo`. The editor (`scene/review/turnUndo.ts`, `SceneCommands.undoTurn`): the steps of a turn (their actor has the session and the turn) go back as one new step from the history snapshots, after the later steps of the person too; the waiting proposals of the turn go. The agent panel has "Undo the turn" at the end of each turn.
- Tests: `agentTurns.test.ts` (2); `studio-agent.spec.ts` "Undo the turn takes back the scene edit and the file of a turn with one action" (an Auto turn renames an entity and writes a plugin file; a later rename of the person stays).

### 2026-10-18: UI5-06 (done)

- `@scenity/bridge`: `turn.checkpoint`, `turn.restore`. `@scenity/studio-host`: at each turn start the host asks the newest window of the project to keep its scene; a prompt item has its turn and its time; `TurnRecords.restoreFiles` (the files of the turn and of each later turn, newest first); `POST …/turns/<n>/restore`; an `undone` item with `restore: true`.
- The editor: `scene/review/checkpoints.ts` (the newest 50 scenes by session and turn, the entities that changed since, the restore as one step), `scene/review/viewPreview.ts` (one preview of a document in the view, for the Review panel and the checkpoints), `AgentCheckpoint.vue` (the checkpoint line of a prompt: Preview with the changed entities and files and a switch for the view, Restore).
- Tests: `agentTurns.test.ts` "a restore of a checkpoint puts each file back"; `studio-agent.spec.ts` "a restore after three turns gives the files and the scene of turn one".

### 2026-10-18: UI5-07 (done)

- `@scenity/studio-host` `agents/permissions.ts` (the values per mode and kind, the stricter value of the person and of `.scenity/agents.json`, the files that always ask, the read-only jobs of Ask mode, the roles), `agents/approvals.ts` (the cards that wait; Allow once, for the session, Deny; Stop denies), `agents/gate.ts` (`permit`). The sessions put each scene edit, job run, file write (script `write`, Claude's Edit and Write) and network call (Claude's WebFetch and WebSearch) through the gate; an approval item in the transcript; `waiting` and `budgetUsd` on the session; Auto needs a budget (default $5) and a session stops at its budget; the role caps the modes. `POST …/approvals/<id>`; the user preferences have `agent.kinds`.
- The editor: `AgentApproval.vue` (the card with its detail), a dot on the tab of a session that waits, the switch to Auto asks in the panel with the budget, the footer shows the cost and the budget. A prompt during the make of a session waits for it (a fix: the prompt went to the session before). Hub → Agents has a value per kind.
- Tests: `agentPermissions.test.ts` (6: each mode and kind, the overrides, the files that always ask, the roles, the cards, Review and Ask with a file write and a scene edit, Deny and Stop, the project file, the budget); `studio-agent.spec.ts` "a file write of a Review session waits for an approval; Auto asks for a budget".

### 2026-10-18: UI5-08 (done)

- `@scenity/studio-host` `agents/plans.ts` (the plan model, the Markdown file `.scenity/plans/<date>-<slug>.md`, the tool listings `plan_propose`, `plan_step`, `plan_done`), `agents/planTools.ts` (the card waits for Approve, Edit or Deny; an edit of the steps replaces them; the ticks and the summary follow in the card and the file). A session has `planFirst`: an edit, a write or a run of a turn needs the approved plan of the turn (`gate.ts` `sessionPermit`). The Claude prompt asks for a plan first. `agents/toolCalls.ts` holds the tool-call path (moved out of `sessions.ts`).
- The editor: `AgentPlan.vue` (the steps with ☐ ◐ ☑ ⊘, the files, the risks, the summary, Approve, Edit, Deny) and "Plan first" in the footer.
- Tests: `agentPlans.test.ts` (3); `studio-agent.spec.ts` "a plan of five steps runs with ticks after its approval; a denied plan changes nothing".

### 2026-10-18: UI5-09 (done)

- `@scenity/studio-host` `agents/presence.ts` (`SessionPresence`: at each tool call the activity, the entities of the call, the camera and the picture of the last frame; at the end of the turn the presence goes) and `BridgeHub.tell` (a message to each window of a project). `agents/toolCalls.ts` tells the presence before and after a call.
- The editor: `scene/agent/presence.ts` (the newest presence of each session, from `agent.presence` on the bridge socket), the ring of the working entities in the hierarchy, the "…" pins and the camera triangle in the Scene view (`presencePins`), the status item of the activity, "Follow the agent" (`followView.ts`, the command `agent.follow`), and the toasts and the bell of a turn that ends or waits (`watchAttention`).
- Tests: `agent-presence.vitest.ts` (3); `studio-agent.spec.ts` "during a turn the person sees what the agent works on, and the view does not change" (the marks, the camera, the activity, the followed frame; the view, the selection and the focus stay).

### 2026-10-18: UI5-10 (done)

- The editor: `scene/agent/inlinePrompt.ts` (the subject of the focus: an inspector field row with `data-component` and `data-field`, a hierarchy row, an asset tile, the selection, else a picked point; the prompt field; Escape closes), the command `agent.inline` (⌘I, in the Agent menu), `AgentStore.sendInline` (the active session, or a new one named after the subject). The review marks of a field have the op keys, and the field row has ✓ and ✕ beside it (`acceptMark`, `rejectMark`).
- A fix found on the way: the root type check does not cover `apps/editor`; its own check (`apps/editor` `vue-tsc`) found 12 errors of the agent and review work, now fixed (a field mark had no op keys).
- Tests: `agent-inline.vitest.ts` (2); `studio-agent.spec.ts` "Make this warmer on the colour of a light gives a change set on that field".

### 2026-10-18: UI5-11 (done)

- `@scenity/studio-host` `agents/questions.ts` (the host tool `ask_person`: 2 to 4 choices, the card in the transcript, the wait of the session, the answer for the agent; a stop ends a question with no answer), `agents/hostTools.ts` (one dispatch of the host tools: plans and questions), `POST …/questions/<id>`. The Claude prompt names `ask_person`. "Undo the turn" and the files of a turn moved next to the turn records (`turns.ts` `revertTurn`, `turnFiles`); the budget texts to `permissions.ts`.
- The editor: `AgentQuestion.vue` (a button per choice, "Other" with a text); the approval cards of UI5-07; the toast and the bell of a session that waits (UI5-09).
- Tests: `agentQuestions.test.ts` (2); `studio-agent.spec.ts` "an agent question with 3 options gets its answer in the panel".

### 2026-10-18: UI5-12 (done)

- `@scenity/studio-host` `agents/instructions.ts` (`AGENTS.md`, `CLAUDE.md`, the skills of `.scenity/skills/` with their names and uses; the text of a turn, cut at 20 000 characters), `GET` and `PUT /api/agent/instructions`. Each turn input has `instructions`; the Claude prompt ends with them; the script driver has `when` steps.
- The editor: the Instructions panel (`InstructionsPanel.vue`, a core panel of the right area in the Agent menu, in the studio only).
- Tests: `agentInstructions.test.ts` (3: an instruction changes the result, the text of the instructions and the skills, the API); `studio-agent.spec.ts` "an instruction in AGENTS.md changes the result of the agent".

### 2026-10-18: UI5-13 (in part)

- `@scenity/studio-host` `agents/recipes.ts` (`scenity.recipe/1`; the studio recipes "Light for a product shot" and "Tidy the names of the entities"; the recipes of `<state>/recipes.json` and `.scenity/recipes/*.json`, a later ID wins; `fillRecipe`), `GET /api/agent/recipes`.
- The editor (`scene/agent/recipes.ts`): a command per recipe (`recipe.<id in camel case>`, Agent ▸ Recipes), the parameter dialogs with their defaults and choices, the run to the active session (or a new one named after the recipe), `/` at the start of the composer lists the recipes. Hub → Agents lists the recipes of the studio and of the person.
- Tests: `agentRecipes.test.ts` (2); `agent-recipes.vitest.ts` (2); `studio-agent.spec.ts` "Light for a product shot runs from the search box; a recipe runs from / in the composer".

### 2026-10-18: UI5-17 (done)

- `@scenity/studio-host` `agents/limits.ts` (the defaults of an Auto session: $5, 200 turns, 30 minutes; `nextLimits`, `turnRefusal`, the text of each limit; `UsageLedger`: the cost and the tokens of each day in `<state>/agent-usage.json`), `GET /api/agent/usage`. A session has `tokens`, `maxTurns` and `maxMinutes`; a turn stops at its minutes; a prompt past a limit is refused with the reason. The drivers give the tokens of a turn. `agents/session.ts` holds the state of a session, its port and the context of its tool calls (moved out of `sessions.ts`).
- The editor: the footer shows the tokens; Hub → Agents shows the use of the day.
- Tests: `agentLimits.test.ts` (3: the defaults and the refusals, the tokens and the ledger, the turns and the minutes).

### 2026-10-18: UI5-18 (done)

- `@scenity/studio-host`: `--no-agent` (no agent sessions), `GET /api/agent/status` (`available`, `driver`).
- The editor: with no agent the agent panel says how to connect one (`NoAgentPanel.vue`), ⌘L and ⌘I show it with a toast, and the "Ask the agent" row of the search box shows the reason. With an agent, "Ask the agent" of the search box (UI3-07) sends the text to the agent panel.
- Tests: `studio-no-agent.spec.ts` (the entries say how to connect an agent; an edit, an undo and a save); `studio-agent.spec.ts` "Ask the agent of the search box sends the text to the agent panel".

### 2026-10-18: UI5-15 (in part)

- `@scenity/studio-host` `agents/external.ts` (`Connections`: the requests, the allow with a token and a session, the deny; `externalApi`: `/api/agent/connect`, `/api/agent/connections`, `/api/agent/external/tools` and `/call` with `x-agent-token`; the event `agent.connections`), `AgentSessions.external` (a turn begins at the first call after a pause of 60 s and ends after it; Stop ends it), `info.external` (no prompt of the panel), `src/mcp.ts` (the MCP server over stdio; the export `./mcp`). The turn begin and end are one pair of helpers (`#begin`, `#end`); `agents/session.ts` makes the info and the state of a new session.
- `@scenity/cli`: `scenity mcp` (it runs `src/mcp.ts` of the studio host of the checkout or the installed one).
- The editor: the requests with Allow and Deny at the top of the agent panel, the external session in its tab with no composer, and the setup lines in Hub → Agents.
- Tests: `agentExternal.test.ts` (2); `commands.test.ts` (the command list); `studio-agent.spec.ts` "an external agent over scenity mcp edits the open scene, and the change set waits" (a JSON-RPC client over the stdio of `src/mcp.ts`).

### 2026-10-18: UI5-16 (done)

- `@scenity/studio-host` `src/terminals.ts` (`Terminals`: a PTY per terminal in the project folder, the scrollback ring and the open again of a page, the output and the exit as events on `/events`, a close with SIGKILL after a wait, the refusal of a shell for a host that gives none; `claudeWithStudio`: the Claude Code CLI with `--mcp-config` of the studio MCP server; `terminalApi`).
- The editor: the Terminal panel (`scene/terminal/`: xterm.js 6 with the fit addon and the colours of the tokens; Claude Code and Shell tabs; a core panel of the bottom area in the studio). `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0 are dependencies of the editor (the versions of the workbench).
- Tests: `terminals.test.ts` (6: echo, environment, size, resize and exit; the open again with the scrollback; the close and SIGKILL; bad requests and the refused shell; the environment and the ring; the API with the events); `studio-agent.spec.ts` "the Terminal panel runs a shell in the project folder".

### 2026-10-18: UI5-14 (done)

- `@scenity/scene`: the `annotation` component gets `status` (`open` or `done`) and `task` (the key of the turn that did it); `docs/formats.md` and the JSON Schema.
- The editor: `scene/agent/noteTasks.ts` (the command `note.send`, "Send the note to the agent" in the Agent menu and the search box: the text of the selected note goes to the active session with the note and its target as chips; when the turn ends, the note gets the status "done" and the key of the turn as one step of the history).
- `@scenity/agent-tools` `src/notes.ts`: the tools `note_list` (the notes with their target, state, turn and text) and `note_resolve` (the status and the key of the turn of the session as one change: in Review mode it waits with the turn).
- Tests: `registry.test.ts` (the note tools); `agent-notes.vitest.ts` (2); `studio-agent.spec.ts` "a note on a chair becomes a turn with its change set, and the note is done".

### 2026-10-18: UI5-19 (in part)

- `@scenity/bridge` `taskCalls.ts`: `task.gate` and `task.frames` of the editor window.
- `@scenity/studio-host` `agents/tasks.ts` (`AgentTasks`: the start, the turns, the gate checks and their prompt to the agent, the most refusals, the end check at a limit, the time limit, the stop; it follows the events of the sessions), `taskStore.ts` (`agent-tasks.json`, the search, a running task is stopped at the next start), `taskPack.ts` (`.scenity/tasks/<task>/REVIEW.md` and the pictures); `/api/agent/tasks`; the event `agent.task`; `AgentSessions.tasks`.
- The editor: `scene/review/taskGate.ts` (the rules on the document after the change sets of the session, drawn by the core for the check; the pictures before and after), the Tasks panel (`TasksPanel.vue`, `tasks.ts`: the new task, the list with the state, the waiting changes, the budget, the branch, the gate and the pack, the search, Open, Review, Stop), the command `agent.task.new`, the notice at the end.
- Tests: `agentTasks.test.ts` (8: the parameters; the gate that refuses the end while the rules fail, with the change sets, the record and the pack; the most refusals; a gate that does not run; the end check at a turn limit; the time limit; the stop of the owner; the record and its search); `agent-tasks.vitest.ts` (3); `studio-agent.spec.ts` "a background task with a budget and the rules as its gate ends with a notice; its turn waits in Review" (J12).

### 2026-10-18: UI6-01 (done)

- The editor: `scene/viewport/overlays.ts` (`OverlayDock`: the four edges, the order, the fold, the hide, the menu of each overlay, the drag of the head to the nearest edge, the overlay menu; the saved places), `viewOverlays.ts` (the dock of the view, the command `overlay.menu` on the backtick key, the Orientation and Stats overlays), `SceneViewPanel.vue` (the view element in the panel; the places in the state of the panel, so the layout keeps them), the controls of the viewport bar in the overlays View options, Grid and snap and Cameras (`viewportBar.ts`; the bar stays for a page with no editor window), `gizmo/gizmoOverlays.ts` (Tools, Tool settings, the snap switches), the Agent overlay (`agent/followView.ts`).
- Tests: `scene-overlays.vitest.ts` (4); `scene-viewport.spec.ts` "the overlays dock to the edges, fold, and keep their places after a reload".

### 2026-10-18: UI6-02 (done)

- The editor: `scene/viewport/editorViews.ts` (the six views along the axes, the long lens of the orthographic projection, the commands `view.front`, `view.back`, `view.right`, `view.left`, `view.top`, `view.bottom` and `view.projection` with ⌥1, ⌥3, ⌥7, ⇧ for the opposite view and ⌥5, in Edit ▸ Editor camera), the projection and the views of `ViewportCamera`, the ends of the axes and the projection button of the Orientation overlay, `projection` and `view` in the viewport of the script API.
- Tests: `scene-overlays.vitest.ts` (4 more); `scene-viewport.spec.ts` "the six views and the projection switch work by mouse and by key".

### 2026-10-18: UI6-10 (done)

- `@scenity/editor-core`: `StateHistory.goTo` and `EditHistory.goTo` (a step in one action; after a jump back one redo comes back, after a jump forward one undo goes back; a new step clears the jump), `EditHistory.listen`, `SceneChannel.goTo`.
- The editor: `scene/history/` (the rows with the actor and the change set of each step, the groups of one agent turn, `watchHistory`, the command `history.goTo` for a script or an agent; `HistoryPanel.vue`), the panel `history` (⌘⇧H). UI4-04 is done with it.
- Tests: `history.test.ts` (the jump and the listen); `history-panel.vitest.ts` (3); `scene-layout.spec.ts` "a click on step 3 of 10 in the History panel undoes 7 steps as one action that redo brings back".

### 2026-10-18: UI6-14 (done)

- The editor: the History group of the toolbar (`studio/shell/HistoryButtons.vue`: Undo and Redo with the name of their step from the status of the window, a long press opens the History panel), `scene/sceneDiff.ts` (the semantic diff: a line for each new, removed or moved entity, each new or removed component, and the old and new value of each field; a set of a whole component gives a line for each field), the details of a dialog (`DialogRequest.details`: "See the diff"), the conflict dialog of a save and of a check of the disk with the diff.
- Tests: `scene-diff.vitest.ts` (4); `scene-save.spec.ts` "a save over a changed file gives a dialog with the diff"; `scene-layout.spec.ts` (the Undo and Redo buttons in the History test).

### 2026-10-18: UI6-08 (done)

- `@scenity/runtime-dev` `document/workerLog.ts`: the errors, the warnings and the uncaught errors of the dev scene worker go to the page as `workerLog` extension messages (`attachDevSceneWorker`).
- The editor: `scene/console/` (`ConsoleStore`: the folded entries with their count, the entity and the file that a line names, the counts, the filter; the taps of the page console and its uncaught errors with the source "plugin" for a stack in a plugin, of the worker, of `vite:error`, and of the failed jobs of the studio; `ConsolePanel.vue`: the counters as filters, the source menu, the search, the detail pane, a click that selects the entity or opens the scene file), `scene/pageLink.ts` (the link of the client starts the taps in the edit mode), the errors of the agent sessions and their tools (`watchAgentErrors`), the panel `console` (⌘⇧C).
- Tests: `workerLog.test.ts`; `console-panel.vitest.ts` (3); `scene-console.spec.ts` "a worker error shows once with its count and its source" (the test plugin `tests/fixtures/console-plugin`).

### 2026-10-18: UI6-09 (done)

- The editor: `scene/problems/` (`ProblemList`: the sources, one check at a time, the errors first, the counts; the sources of the failed rules with the kinds rule, budget and rights from the metric, the missing assets, the unknown components with the fix Remove the component, the schema findings, the plugin errors of the Console and the health of the assets; `ProblemsPanel.vue`: the kind filter, Go to, the fixes, Ask the agent to fix; `startProblems.ts`: a check a moment after each edit and each line of the Console, the counts and the press of the status bar), the panel `problems` (⌘⇧M). The status bar gets its problem counts from the panel (no rule check of its own).
- The dev server: `assets.health.json` (`assetHealth`: the assets that the release gate stops for their rights, as `scenity assets release-check`, and the assets with no build output).
- Tests: `problems-panel.vitest.ts` (5: a fixture for each kind, the list, the panel); `scene-asset-api.vitest.ts` (the health); `scene-rules-panel.spec.ts` "J7 from the Problems panel"; `studio-status.vitest.ts` and `studio-workspaces.vitest.ts` (the counts come from the panel; the Layout workspace has the Console and the Problems panels).

### 2026-10-18: UI6-12 (done)

- The editor: `scene/selectionCommands.ts` (Select all ⌘A, Select none ⇧⌘A, Invert, Select the children, Back ⌘[ and Forward ⌘] in the selection history, Select by tag, component and kind in Edit ▸ Select by; each one a command for a person, a script and an agent), one clipboard key for every project of the origin and a copy to the system clipboard (`pageClipboard.ts`), a long menu that scrolls in the space of the window (`@scenity/ui` Menu), and the place of the layout tools under the top overlays (`--scene-overlay-height`).
- Tests: `selection-tools.vitest.ts` (4); `scene-selection.spec.ts` (the keys, Edit ▸ Select by ▸ Select by tag, Invert, a copy in one project that pastes into another).

### 2026-10-18: UI6-13 (done)

- The editor: `scene/projects/sceneTabs.ts` (a tab for each open scene with its dirty mark, a click that switches, × with the close question, a middle click, the arrow keys, + for New scene, ⋯ with Open a path, Save as and the Scenes panel), `sceneActions.ts` (the actions with the questions of the notice, from the old switcher), `ScenesPanel.vue` (the scenes of the project with their pictures, the marks of the open scenes, the recent scenes, New scene), the panel `scenes`; the 72 px scene select is gone.
- Tests: `scene-tabs.vitest.ts` (2); `scene-projects.spec.ts` (two scenes open as tabs, a switch by a tab, a close by ×); `scene-pseudo.spec.ts` (+ asks for the name).

### 2026-10-18: UI6-05 (done)

- The editor: the virtual tree of the hierarchy (`HierarchyPanel.vue`: the window of the rows in the view, the spacers in the unit of the row class, the height of a row measured, a selection from elsewhere scrolls to its row, `aria-setsize` and `aria-posinset`), `hierarchy/treeKeys.ts` (↑ ↓ Home End → ← and Shift; Alt with the arrows moves the entity), `entityIcons.ts` (the icon of the main component), the prefab colour of the instances, the + menu of the presets, the drop of an asset on a row or on the tree (`entity.add`), one tab stop for the tree (a roving tabindex).
- Tests: `hierarchy-v2.vitest.ts` (5); `scene-hierarchy.spec.ts` "rename, move and delete work by keyboard only" and "10,000 entities scroll with few rows in the page and short frames".

### 2026-10-18: UI6-06 (in part)

- The editor: `scene/inspector/InspectorHeader.vue` (the ID with copy, the visible switch, the tags), `AddComponent.vue` (a search over the components in their groups; Enter, ↓, Escape), `EntityJson.vue` (the raw JSON mode), `InspectorHost.vue` (the lock and the JSON switch of each copy in the state of its panel; a locked copy has its own state), `componentIcons.ts`, the ⋯ menu of a card (`ComponentSection.vue`), `entityEdits.ts` (the tags, the visible switch with `visibilityOps` of `@scenity/editor-core`, Copy and Paste values in the browser storage, the ops of a JSON text), the override mark of `FieldRow.vue`; a copy of a panel opens in a split below it (`dock.ts`).
- Tests: `inspector-v2.vitest.ts` (5); `scene-inspector.vitest.ts` and `scene-inspector.spec.ts` (the search of Add component); `scene-inspector.spec.ts` "two locked inspectors show two entities; J4 edits the scene by the keyboard only"; the Layout workspace has the Scenes panel (`studio-workspaces.vitest.ts`, `scene-layout.spec.ts`).

### 2026-10-18: UI6-07 (done)

- The dev server: `scripts/projectFiles.ts` (the files of a project with their kinds; a move or a rename that takes the record of an asset with it, writes its `rights` path again and follows in `scenity.project.json`; a new folder; no path out of the project) and `projectFilesServer.ts` (`project.files.json`, `project.move`, `project.folder`, `project.reveal`; a write only from a page of the server; none in the remote mode).
- The editor: `scene/projectWindow/` (`ProjectWindow.vue`: the favourites, the folder tree, the Assets view, the grid or list of a folder with the icons of the kinds and the stills, the search and the kind filter, Create, open, F2, a drag onto a folder, Reveal, the star; `projectFiles.ts`: the client, the entries of a folder, the favourites), the panel "project" (`startAssetDock.ts`), the drop of an asset on an asset field and of a hierarchy row on an entity field (`RefWidget.vue`).
- Tests: `project-files.vitest.ts` (4); `inspector-v2.vitest.ts` (the drop on a field); `scene-assets.spec.ts` "the Project window: folders, a rename of a model folder keeps its ID, a drag moves an asset".

### 2026-10-18: UI6-04 (done)

- The editor: `scene/game/` (`GameView.vue`: the play page in a frame with the camera, the resolution and aspect presets that fit in the panel, the tier, the backend, the worker, the stats of the player, Refresh; the options in the state of the panel; `gameView.ts`; `startGameView.ts`: the panel `game.view` (⌘2), Play brings it to the front with the documents of the play mode), `PagePlay.handoffUrl` (the handoff of "play in a window" for a frame too), the render options of the play page (`tier`, `backend`, `worker=0`), the render group of the editor settings (Preferences: the tier, the backend, the render worker, the GPU timer, the assets, the audio; `renderParams.ts` fills the URL options of the edit mode; a URL parameter wins), the Scene view and the Game view stay mounted when another tab of their group shows (`dock.ts`).
- `@scenity/scene`: the `render` group of `scenity.editor/1` (the JSON Schema again); `@scenity/editor-core`: the render settings and their fields.
- Tests: `game-view.vitest.ts` (3); `scene-play.spec.ts` "the Game view plays the scene in the player path; Play brings it to the front; Preferences give the render options" (and ⌘1 back to the Scene view in the play mode test); `studio-workspaces.vitest.ts`, `scene-layout.spec.ts` (the default layouts have the Game view).

### 2026-10-18: UI6-11 (done)

- The editor: `scene/search/` (`searchTable.ts`: the query words `t:` (kind), `c:`, `tag:`, `name:` and the comparisons `>`, `<`, `>=`, `<=`, `=`, `!=` of a field with a value, the entity table with a column for each compared field, or the plain values of one exact `c:` component; `searchWindow.ts`: the text, the kind, the saved searches of the project; `SearchWindow.vue`: the table with a cell that edits by `component.set`, Select all, the lists of the other providers, Save; `startSearchWindow.ts`: the panel `search`, the command `search.window` (⌘⇧K), ⌥↩ in the search box). `WindowSearch` gives a limit for each provider and a load of the providers.
- Fixes after the e2e run of UI6: the tier labels of the Game view are Fluent texts (the pseudo spec); the specs know the Game view in the Animate workspace, the one clipboard key of UI6-12, the Scenes tab on the left side and the imports of the asset spec before.
- Tests: `search-window.vitest.ts` (3); `scene-search.spec.ts` "c:light intensity>2 lists the lights with an editable intensity column; a saved search stays".

### 2026-10-18: UI6-03 (done)

- `@scenity/runtime`: the document core has the size of the main view (`viewSize`, for the aim and the pick), the plain frames of a split view and `withEditorView`.
- `@scenity/runtime-dev`: `document/splitView.ts` (the layouts 1, 2 side by side, 2 stacked, 2 × 2; the panes with an editor view or a document camera and a view mode), `DevDocumentCore.setPanes` (a viewport and a scissor box for each pane, the shading of each pane, the shadow maps and the world matrices once), the dev message `scenePanes` and `setPanes` of the dev document client, `ViewShading.restore`.
- The editor: `scene/viewport/splitViews.ts` (the panes, their cameras along the axes, the free perspective view or a document camera, the view modes, the drag and the wheel of a pane, Main, the storage, the commands `view.split.one`, `view.split.side`, `view.split.stacked`, `view.split.four` in Window ▸ Split view), `splitBar.ts` (the bar of a pane), `mainView.ts` (the box of the main view: the gizmo, the drags, the asset drop, the icons, the pins, the layout tools, the frame and the camera input use it), `__scenity.setViewport({ split })` and `viewport().split`.
- Fix: the overlay of dockview for the panels that stay drawn (UI6-04) had a transform and a paint containment, so the fixed parts of the Scene view (the icons, the gizmo, the pins, the layout tools) were off by the place of the panel. The shell CSS takes both away.
- Fixes of the specs: the scene tabs run the commands `scene.open` and `scene.close` (with a path now) and mark `scene.new`; the first-load and pseudo specs show the Scene view again after the tab loop.
- Tests: `devDocumentCore.test.ts` "four panes draw in their boxes with their cameras and modes; the pick stays in the main view"; `split-views.vitest.ts` (3); `scene-split.spec.ts` "four views of the showroom: own cameras and modes, picks in the main view, Main, a reload".

### 2026-10-18: UI7-01 (done)

- `@scenity/editor-core`: the presets hemisphere light, audio source, obstacle, prefab instance (input `source`) and character (input `asset`: `model` and `character`); the inputs (`PresetInput`) refuse a run with no valid input; `yaw` and `pitch` turn a new entity; the titles say "an" before a vowel.
- The editor: `hierarchy/presetInput.ts` (a run of the person with no input asks for it), `viewport/cameraFromView.ts` (`entity.create.cameraFromView` in Entity ▸ Create: the camera preset at the place and the direction of the main view).
- Tests: `entity-presets.test.ts` (the inputs, the turn); `scene-commands.spec.ts` "J4 with the Create menu: a light, a camera from the view, a prefab that asks; one step and one agent command each".

### 2026-10-18: UI7-02 (done)

- `@scenity/editor-core`: `FieldModel.custom`, the name of the custom widget of a hint.
- The editor: `inspector/environmentPreviews.ts` (the fog over the distance, the bloom of a row of samples, the shade of a corner, the outline of a box; the defaults of `frameEffects`), `EnvironmentPreview.vue` over the fields of the hint (`FieldRow.vue`), the styles in `inspector.css`.
- Tests: `environment-widgets.vitest.ts` (2: the previews, and the previews in the inspector of the scene with an edit and a drag).

### 2026-10-18: UI7-03 (done)

- The editor: `scene/handles/handleModel.ts` (the handles and the wires of the targets of lights and cameras, of the shadow box of a directional light and of the safe frame box of a camera; the drag math on an axis and on the plane of the view), `startHandles.ts` (the overlay over the main view, the press in the capture phase, a live drag of the scene channel as one step, Escape), `__scenity.handles()`.
- Tests: `component-handles.vitest.ts` (3); `scene-gizmo.spec.ts` "the handles of the components: the shadow box of the sun and the target of a camera, one step each".

### 2026-10-18: UI7-04 (done)

- `@scenity/editor-core`: `itemCustom` of a list or a map widget (the custom widget of its items); `materialOverrides` is a map of `materialOverride` items.
- The editor: `inspector/customWidgets.ts` (a custom widget in place of the schema widget, `FieldRow.vue`), `widgets/LodChainWidget.vue`, `widgets/ClipSourceWidget.vue`, `widgets/PrefabOverridesWidget.vue` with `overrideRows.ts`, the part pick of the map of overrides (`ListWidget.vue`; `InspectorPort.pickPart`: the next click of the canvas names the glTF node of the mesh under it, `data-pick-part`, Escape).
- Tests: `model-widgets.vitest.ts` (4: the LOD chain, the part pick of a model and of a variant, the clip source, the prefab overrides); `scene-inspector.spec.ts` "a material override picks its part in the view".

### 2026-10-18: UI7-05 (done)

- The editor: `scene/lighting/` (`LightingPanel.vue`: the presets, the pictures of the environment maps, the fields of the `environment` component with their previews, the lights with their intensity, Ask the agent to light this; `lightingPresets.ts`), the panel `lighting` (`startInspector.ts`, a state of the scene with no entity), the styles of `#scene-lighting`, `lighting.ftl`.
- `@scenity/editor-core`: `NumberLimits.above` (an exclusive minimum), and the first value of such a number is 1 or a step above the minimum.
- Tests: `lighting-presets.vitest.ts`; `scene-inspector.spec.ts` "the lighting steps of J4 in the Lighting window: a map, the exposure, the fog, a preset, a light"; the default layout of `studio-workspaces.vitest.ts` and `scene-layout.spec.ts` has the Lighting panel.

### 2026-10-18: UI7-06 (done)

- The editor: `handles/rangeHandles.ts` (the range of a point light, the range and the cone of a spot light, the field of view of a camera, the distances of an audio source), `handles/spatialHandles.ts` (the socket points, the points of a path with add and delete, the footprint of an obstacle, the facing of a stand point), `handles/handleProviders.ts`, the frame of an entity and the wires of a circle and a sphere (`handleModel.ts`), a plane of a handle (the ground) and Alt to delete (`startHandles.ts`); the handles start before the gizmo, so a press on a handle comes first.
- Tests: `scene-handles.vitest.ts` (3); `scene-gizmo.spec.ts` "the handles of the view: the range of a light and the points of a path, one step per drag".

### 2026-10-18: UI7-07 (done)

- `@scenity/editor-core`: `makePrefab` and `relativePath` (prefabs/make.ts), `routeOverrides` (an op on an entity of a prefab instance becomes an override of the instance; prefabs/routing.ts), the command `prefab.unpack`.
- The editor: `prefabs/makePrefabCommand.ts` (`prefab.create`: the selection becomes an instance; `folder`, `replace`; a drop of hierarchy rows on a folder of the Project window), `prefabs/prefabLoader.ts` and `ScenePageEditor.usePrefabs` (the prefabs of new instances load with no step of the history; `prefabSetState.ts`), the scene commands and the gizmo see the expanded document with an entity of an instance and route their ops (`hierarchy/prefabRouting.ts`, `gizmoControl.ts`), rename and toggles on prefab rows, Unpack in the inspector and the hierarchy menu, Apply for each override, the breadcrumb of the prefab mode.
- Fix: the rule check of the Problems panel runs only while the panel shows (it held the frames of the scene worker after each edit); the prefab spec waits longer for the first frame with the selection outline.
- Tests: `prefab-make.test.ts` (4); `scene-prefabs.spec.ts` "J5: a prefab from two entities, two instances, an override applied to the prefab changes both"; `model-widgets.vitest.ts` (the Apply of an override).

### 2026-10-18: UI7-11 (done)

- The editor: the layout tools are buttons of the Tools overlay (after the gizmo modes), and the readout is the overlay "Readout" on the right edge that shows while a tool is on (`startLayoutTools.ts`, `layoutTools.css`, `.scene-overlay[data-idle]`). This also ends the overlap of the wrapped top overlays and the old tool bar (the pseudo spec).
- Tests: `scene-layout-tools.spec.ts` (the tools in the Tools overlay, the readout overlay).

### 2026-10-18: UI7-09 (done)

- The editor: `material/materialPresets.ts` (six presets for the values of each type), the presets row, the picture of the colour map on the swatch and of each texture slot (`PageMaterials.stills`), the drop of a texture tile on a slot (`TextureSlot.vue`), the drop of a material tile on a part of the Scene view (`assetDrop.ts`: `material.assign` on the mesh or the shape under the pointer, `data-material-drop`), the kind of a dragged asset tile (`ASSET_KIND_DRAG_TYPE`).
- Tests: `material-v2.vitest.ts` (2); `scene-materials.spec.ts` "the material steps of J4 by drag and drop: a material onto a part of the view, a texture onto a slot".

### 2026-10-18: UI7-13 (done)

- `@scenity/editor-core`: `tagUses`, `layerUses`, the commands `tag.rename` and `pickLayer.rename` (entities/tagCommands.ts).
- The editor: the panel `tags` (`scene/tags/TagsPanel.vue`: the tags and the pick layers with their counts, a press selects, Rename).
- Tests: `tag-commands.test.ts` (2); `scene-selection.spec.ts` "the Tags panel renames a tag on each entity in one undo step".

### 2026-10-18: UI7-12 (done)

- The editor: `placement/placementMath.ts` (align, spread, drop to the floor, on, against, near, facing, a free place) and `placement/placementCommands.ts` (`place.*` in Entity ▸ Place: the boxes of the inspect report, `entity.move` and the rotation of `component.set` as one batch).
- Tests: `placement-math.vitest.ts` (3); `scene-commands.spec.ts` "an agent puts 4 chairs around the table with the placement commands, and no box overlaps".

### 2026-10-18: UI7-14 (done)

- `@scenity/scene`: `schema/notes.ts` (`scenity.notes/1`, `notesPathOf`, `readNotesDocument`) and its JSON Schema; `@scenity/bridge` and `@scenity/cli`: a save writes `*.notes.json` through the canonical writer.
- The editor: `scene/notes/` (`pageNotes.ts`: the file notes and the note entities as one list, the filter, the writes; `notePins.ts`: the pins over the main view; `NotesPanel.vue`; `startNotes.ts`), the panel `notes`, the note mark of the hierarchy rows.
- docs/formats.md: the notes.
- Tests: `scene-notes.vitest.ts` (2); `scene-selection.spec.ts` "notes show in the Scene view and in the hierarchy; the note file keeps them"; the default layout lists have the Notes panel.

### 2026-10-18: UI7-10 (done)

- `@scenity/bridge` and `@scenity/cli`: a save writes `*.overrides.json` through the canonical writer (`canonicalOverridesText`).
- The editor: `scene/variants/` (`pageVariants.ts`: show a variant with core patches only, make one from the edits since the last save, apply one to the base scene; `VariantsPanel.vue` with the compare wipe; `startVariants.ts`), the panel `variants`.
- docs/editor.md: Variants.
- `@scenity/scene`: `diffDocuments` sets a number array with more than one changed item as one value, so a turn is one op and the core never sees a quaternion that is not a unit quaternion (the turns of `place.*` gave a refusal of the core).
- Tests: `scene-variants.vitest.ts` (3); `overridesFile.test.ts` (2); `layers.test.ts` "a turn is one set of the whole quaternion"; `scene-save.spec.ts` "a variant made from the edits gives the same frame as the edits"; the default layout lists have the Variants panel.

### 2026-10-18: UI7-15 (done)

- `@scenity/editor-core`: `entities/userPresets.ts` (the presets of the person in the browser storage `scenity.presets.user`, a camelCase ID of each name, the create command `entity.create.user.<id>` of each entity preset, the apply command `preset.apply.<id>` of each preset), `componentValueOps` (a set of a component that the entity has, an add of one that it has not).
- The editor: `scene/presets/pagePresets.ts` (the list of the page, the page commands `preset.save` and `preset.remove`, a name from the person), `SceneCommands.extend`, the card menu of the inspector ("Save as a preset", "Apply the preset <name>").
- docs/editor.md: the presets of your own.
- Tests: `user-presets.test.ts` (3); `scene-inspector.spec.ts` "a saved light preset applies to a second light, as one step".

### 2026-10-18: UI7-08 (done)

- `@scenity/editor-core`: `makeVariant` (a prefab with one root: an instance of the base with the overrides), `rebasedSource` and the `rebase` of `makePrefab` (a nested instance keeps its prefab file in the new prefab).
- The editor: the command `prefab.variant` (Entity menu: the variant beside the base file, the instance uses it as one step) in `prefabs/makePrefabCommand.ts`.
- docs/adr/02-scene-model.md: the notes of UI7-08; docs/editor.md: variants and nested prefabs.
- Tests: `prefab-make.test.ts` "a variant of a door prefab overrides one part", "a nested instance keeps its prefab file"; `scene-prefabs.spec.ts` "a variant of a prefab overrides one part; the instance uses it as one step".

### 2026-10-18: the checks at the end of phase UI7

- The e2e specs (chromium, 107 tests): 89 passed, 2 failed, 16 did not run (serial). Fixed: `scene-prefabs` "a variant of a prefab" read a value that an earlier test changes; `studio-agent` UI5-08 waited 5 s for a turn of ten tool calls (now the READY wait). `studio-agent` passes again on its own.
- The macOS gallery (216 tests): 143 passed, 15 failed; the Linux gallery in Docker: 106 passed, 14 failed. Fixed:
  - axe `aria-required-children` on the scene tabs: the × of a tab is out of the tab list (Delete on the tab closes the scene).
  - `input.spec` (replay) and `sim-road.spec` (the button in the play mode) since UI6-04: Play brought the Game view in front of the canvas, and a Game view behind another tab ran a second player. Now a hidden Game view has no frame (`usePanelVisible` of the dock), the play API takes `{ view: "scene" }`, and the handles and the note pins do no work in the play mode.
  - `crowd.spec` and `effects.spec` failed only under the load of a run that I started at the same time; they pass alone.
- Left:
  - Owner: the editor window frames (`editor-themes` for 4 themes) differ by about 4 % because the default layout now has the Lighting, Notes and Variants tabs. They need the approval of the owner (`update` mode). The `editor-size-*` frames had no macOS baseline: the run wrote them (new frames).
  - The Linux baselines of the editor window frames do not exist. They wait for the approval above (`gallery-linux-baselines.sh missing -g "the editor window"`).
  - `sim-road.spec` "a press of the button in the play mode" still fails in about 1 of 3 runs at a load of 13 to 15. A live event that reaches the core after its step is applied later than its time; the record keeps the time of the page.

### 2026-10-18: UI5-20 (done)

- `@scenity/studio-host`: groups of parallel tasks (`AgentTasks.startGroup`: variants with one prompt and their place in it, or a split with one prompt for each part; 2 to 6 tasks; `group` in the task record); `POST /api/agent/tasks` takes `variants` or `parts`.
- The editor: `agent/taskGroups.ts` (the groups of the tasks, Keep, Merge), `agent/TaskGrid.vue` (the grid of frames), the Variants field and Compare in the Tasks panel, `TaskGate.look` (the picture after the change sets of a session) and one call at a time for the gate and the pictures.
- docs/editor.md: variants and split work; docs/ui/agents.md §11: as built.
- Tests: `agentTasks.test.ts` "the groups of parallel tasks" (2); `agent-tasks.vitest.ts` (2 more); `studio-agent.spec.ts` "J11: three lighting moods as three variants in a grid of frames; keep one".

### 2026-10-18: UI8-05 (done)

- The editor: `sequencer/clockState.ts` (the clock of the page: the time, the play state, the speed and the loop; the `clock.*` commands while a sequence is open, also `clock.seek` and `clock.speed`; no clock key in the play mode), `sequencer/clockBar.ts` (the clock group of the toolbar), the speed of `PageClock` and of the page time; the sequencer panel shows the same clock.
- docs/editor.md: the clock in the toolbar.
- Tests: `scene-sequencer.spec.ts` "the clock keys also work from the clock of the toolbar, with no Timeline panel".

### 2026-10-18: UI8-07 (done)

- The editor: `play/playRecordings.ts` (the hints of the input maps, the saved recordings of a project), `play/playPanels.ts` (the keys of the game during a play, the Recordings list, the commands `play.hints`, `play.recordings`, `play.recording.save`, `play.recording.replay` with `view`, `play.recording.delete`), `PlayInput.maps` and `project`, the Recordings button of the play group.
- docs/editor.md: the keys of the game and the recordings.
- Tests: `play-recordings.vitest.ts` (2); the gallery `input.spec.ts` "a recorded play session replays to the same frames" with the hints, a save, a replay by name with the same frames, and a delete.

### 2026-10-18: UI8-01 (done)

- `@scenity/editor-core`: the change `settings` and the command `sequence.settings` (the duration, the loop, the initial state).
- The editor: `sequencer/SequencerHeader.vue` (the picker, New sequence, the duration, the loop, the initial state), `sequencer/SequencerKeyForm.vue` and `keyForms.ts` (the form of a key of each kind, the first value of a new key), `sequencer/timeWindow.ts` (the zoom, the pan, the snaps) in `SequencerTracks.vue`, `sequencer/waveform.ts` and `AudioWave.vue` (the waveform of an audio track; `pageSoundUrl` of `audio.ts`), the nine kinds in the add form, the command `sequence.open`.
- docs/editor.md: the sequencer.
- Tests: `sequence-commands.test.ts` "sets the duration, the loop and the initial state"; `timeline-v2.vitest.ts` (4); `scene-sequencer.spec.ts` "the Timeline adds a track of each kind with a key, sets the sequence and zooms".

### 2026-10-18: UI8-02 (done)

- The editor: `sequencer/curveEase.ts` (the eases, the control points of a name, the tangent handles of a Bézier and their drag), `SequencerCurve.vue` (the ease bar, the tangent handles, All curves, Frame all, the time window of the curve), `curvesOf` and `curveTracks` of `sequencerModel.ts` (the lines of many tracks with their track). Fixed: the key form gave a property key `{ value }` in place of its value.
- docs/editor.md: the curve editor.
- Tests: `curve-v2.vitest.ts` (3); `scene-sequencer.spec.ts` "each ease of the format comes from the curve editor; all curves and Frame all".

### 2026-10-18: UI8-03 (done)

- The editor: `sequencer/sequenceKeys.ts` (the track of a field, the key mark at the time of the clock, the key of a press; the record mode), the key mark of `FieldRow.vue`, the Record button of `InspectorHeader.vue`, started with the clock of the open sequence (`startSequenceClock`).
- docs/editor.md: keys from the inspector.
- Tests: `inspector-keys.vitest.ts` (2); `scene-sequencer.spec.ts` "J6 with the keys of the inspector only".

### 2026-10-18: UI8-04 (done)

- `@scenity/editor-core`: `sequence.track.add` takes `keys` (a track with its keys in one step).
- The editor: the proposals of `PageSequence` (`runAs`, `proposals`, `listenProposals`, `acceptAll`, `rejectAll`; the switch of the session), an agent run of a sequence command waits as a proposal (`pageKeys`), the ghosts of the Timeline (`proposedSequence` of `useSequencer.ts`, the dashed tracks and keys) and the bar of the proposals.
- docs/editor.md: the edits of an agent in the sequencer.
- Tests: `sequence-commands.test.ts` "adds a track with its keys in one step"; `scene-sequencer.spec.ts` "an agent adds a camera move: its keys are ghosts until the owner accepts them".

### 2026-10-18: UI8-06 (done)

- `@scenity/runtime-dev`: `document/onionCopies.ts` (the copies of the meshes of an entity at world matrices, in the tone of their side of the clock; no pick; the previews hide them), `setOnion` of the dev document core, the message `sceneOnion`, the client method, `onion` in the inspect report.
- The editor: `sequencer/onionSkins.ts` (the five times round the clock, the posed places, the command `view.onion`), started with the clock of the open sequence; `ViewportPort.setOnion`.
- docs/editor.md: onion skins.
- Tests: `onionCopies.test.ts` (2); `onion-skins.vitest.ts` (2); `scene-sequencer.spec.ts` "onion skins of five times show for a moving entity".

### 2026-10-18: UI8-13 (done)

- The editor: `inspector/soundPreview.ts` (one preview of a sound asset at a time, with Web Audio), the ▶ of a sound field in `FieldRow.vue`.
- docs/editor.md: the audio of the play mode and the preview.
- Tests: `scene-play.spec.ts` "an audio key plays at its time in the play mode; the inspector previews the sound".

### 2026-10-18: UI8-11 (done)

- The editor: `walks/walkRoutes.ts` (the walks of an actor and their routes round the obstacles), `walks/startWalks.ts` (the overlay `#scene-walks` of the selected actor, the command `walk.add`, `__scenity.walkRoutes()`), started with the gizmo and the handles.
- docs/editor.md: walks.
- Tests: `walk-routes.vitest.ts`; `scene-walks.spec.ts` "the route of a walk changes in the view when an obstacle moves; walk.add adds a walk".

### 2026-10-18: UI8-08 (done)

- `@scenity/runtime`: `SceneTimeline.simulations()` and `DocumentCore.simulations` (the states at the time of the last frame). `@scenity/runtime-dev`: the message `inspectSimulations` and the client method `simulations`.
- The editor: `simulation/simulationView.ts` (the tables and the values of a state), `SimulationPanel.vue` (the states at the time of the clock, a recorded stream), `startSimulation.ts`, the panel `simulation`, `__scenity.simulations()`.
- docs/editor.md: the Simulation panel.
- Tests: `simulation-view.vitest.ts`; `scene-simulation.spec.ts` "the traffic sample shows its car states at a time".

### 2026-10-18: UI8-09 (done, the list editor)

- `@scenity/runtime`: `DocumentCore.animators` (the state of each layer at the last frame). `@scenity/runtime-dev`: `animators` in the inspect report and `clips` in the parts of a model.
- The editor: `animator/animatorEdits.ts` (the edits of a controller), `AnimatorPanel.vue` (parameters with the preview value, layers, states, transitions, the ▶ of the active state), `startAnimator.ts`, the panel `animator`.
- docs/editor.md: the Animator window.
- Tests: `animator-edits.vitest.ts` (2); `scene-play.spec.ts` "the animator of the characters sample can be edited and previewed".

### 2026-10-18: UI8-10 (in part)

- `@scenity/runtime-dev`: `bones` in the parts of a model of the inspect report.
- The editor: `character/characterSetup.ts` (the rows of the bone map, the missing bones, the best profile), `CharacterSetupPanel.vue` (the rig, Detect, the bone map, the clip source), `startCharacterSetup.ts`, the panel `character`.
- docs/editor.md: Character setup.
- Tests: `character-setup.vitest.ts` (2); `scene-walks.spec.ts` "the character setup maps the bones of a rig and sets the bones of a robot".

### 2026-10-18: the checks at the end of phase UI8

- The e2e specs (chromium): 84 passed, 4 failed. Fixed: the panel list of the Animate workspace in `scene-layout.spec.ts` (the Animator and Character setup panels), the sequence picker shows paths as data (`translate="no"`, `scene-pseudo.spec.ts`), and the chairs of `scene-commands.spec.ts` wait for the frame that draws their moves. `studio-agent.spec.ts` passes alone (18 of 18); its first test fails only in the full run (the Agent tab does not show in 90 s).
- The macOS gallery: 154 passed, 4 failed: the editor theme frames, which wait for the approval of the owner (see the checks of UI7). The accessibility checks, the editor sizes, the input replay and sim-road pass.
- The Linux gallery (Docker, emulated): 111 passed, 9 failed: the editor frames have no Linux baselines yet (they wait for the approval above); the input replay and the crowd budget fail on the emulated CPU.

### 2026-10-18: UI9-13 (done) and UI9-01 (done)

- `@scenity/assets`: `settings` of `importProjectFile` and of a new record (the importer checks them), `importerForms` (the JSON Schema of the settings of each importer), `rightsSummaries` and `writeRightsRecord` (`rights/write.ts`).
- The editor: the toast of a hot reload (`hotReload.ts`); the routes `assets.importers.json`, `assets.rights.json`, `assets.rights.write` and the options header of `assets.import`; `settingsForm.ts`, `ImportDialog.vue`, `RightsForm.vue`, the import queue of the asset browser.
- Tests: `rightsWrite.test.ts` (2); `import-settings.vitest.ts` (2); `scene-assets.spec.ts` (the dialog, a rights record of the project and a new one at import, the queue); `scene-hot-reload.spec.ts` "in the edit mode a changed source gives one toast and the new model".

### 2026-10-18: UI9-02 (done)

- `@scenity/assets`: `NO_BLENDER`, the reason of a Blender run with no Blender 5.2 and no Docker (`blender/run.ts`).
- The editor: `importFixes.ts` (the fix of a known reason), the fix line and Cancel of the import queue (`useAssetBrowser.ts` `importQueue`, `cancelImports`).
- Tests: `import-settings.vitest.ts` "the fixes of the import queue"; `scene-assets.spec.ts` "an FBX import with no Blender shows the doctor fix (UI9-02)".

### 2026-10-18: UI9-03 (done)

- `@scenity/assets`: the model report has `clips` and `joints` (`modelReport`). `@scenity/runtime` exports `./materials`.
- The editor: `scripts/assetDetails.ts` (`assetDetails`, `reimportAsset`) and the routes `assets.asset.json` and `assets.reimport`; the client `details` and `reimport`; `AssetInspector.vue`, `ReimportForm.vue`, `SettingsFields.vue` (the import dialog uses it too); `preview/previewKinds.ts` (the preview of each kind, the channels, the facts, the record fields), `preview/previewScenes.ts` (the turntable, the environment balls, the material ball), `preview/previewLoads.ts`, `LivePreview.vue`, `TexturePreview.vue`, `AudioPreview.vue`, `AssetPreview.vue`.
- Tests: `asset-inspector.vitest.ts` (16: a preview test for each asset kind, the channels, the facts, the record, the import again); `scene-assets.spec.ts` "the asset inspector: the previews, the facts and an import again (UI9-03)".

### 2026-10-18: UI9-04 (done)

- The editor: `src/still/stillCapture.ts` (the scale and the quality of a capture), `scripts/stills/stillVersion.ts` (`rendererVersion` and the decoders, from `assetStills.ts`), `scripts/stillsApiServer.ts` (the routes `assets.stills.json` and `assets.still.write`, the decoders under `/decoders/`; one write after the other for each project), `pageStills.ts` (the hidden still page), the client `stills` and `makeStill`, `useAssetStills.ts`, the stale mark of `AssetTile.vue`, the Make stills button.
- Tests: `scene-assets.spec.ts` "a new import gets its still; a changed source marks its tile; Make stills draws it (UI9-04)".

### 2026-10-18: UI9-05 (done)

- `@scenity/assets`: `build/buildState.ts` (`writeBuildState`, `assetBuildStates`, `assetBuildInputs`); `assets build` writes the state after each run (not with `--check`).
- The editor: `scripts/buildApiServer.ts` (the routes `assets.build.json`, `assets.build.run`, `assets.build.settings`); the client `build`, `runBuild`, `writeBuildSettings`; `build/AssetBuildPanel.vue`, `build/buildForm.ts`, `build/startAssetBuild.ts`; the panel `assetBuild` (Hammer); a tier for the turntable (`previewLoads`).
- Tests: `buildState.test.ts`; `asset-build.vitest.ts` (2); `scene-asset-build.spec.ts` "the build runs from the panel; a changed record gives a stale mark (UI9-05)".

### 2026-10-18: UI9-06 (done)

- `@scenity/assets`: the rights summaries have the problems of each record.
- The editor: `scripts/rightsApi.ts` (the routes `assets.licences.json`, `assets.licences.write`, `assets.rights.assign`), `scripts/serverParts.ts`; the client `licences`, `writeLicences`, `assignRights`, `health`; `useAssetRights.ts`, `RightsBar.vue`, the picks and the Rights mark of `AssetTile.vue`, `rights/RightsPanel.vue`, `rights/spdx.ts`, `startAssetPanels.ts`; the panel `rights` (Scale).
- Tests: `rightsWrite.test.ts`; `scene-assets.spec.ts` "rights: marks on the tiles, one record for many assets, the licence policy (UI9-06)".

### 2026-10-18: UI9-07 (done)

- The editor: `scripts/approvalsApi.ts` (the routes `assets.approvals.json`, `assets.approval.write`, `assets.approval.role`); the client `approvals`, `writeApproval`, `addApprovalRole`; `approvals/approvalQueue.ts`, `approvals/ApprovalsPanel.vue`; the panel `approvals` (BadgeCheck).
- Tests: `approval-queue.vitest.ts`; `scene-assets.spec.ts` "approvals: a role, a review that passes release-check, a stale approval (UI9-07)" (it runs `assets release-check --json`).

### 2026-10-18: UI9-08 (done)

- The editor: `scripts/releaseApi.ts` (the route `assets.release.run`); the client `releaseCheck` (the calls of the asset panels are in `projectCalls`); `release/releaseFixes.ts`, `release/ReleasePanel.vue`; the panel `release` (ShieldCheck).
- Tests: `release-fixes.vitest.ts`; `scene-assets.spec.ts` "the release check runs from its panel and links each failure to its fix (UI9-08)".

### 2026-10-18: UI9-09 (done)

- The editor: `scripts/assetTools.ts` (the routes `assets.problems.json` and `assets.fix`: `databaseProblems`, `sourceChoices`, `applyFix`); the client `databaseProblems` and `fix`; `scene/problems/databaseProblems.ts` and the source "database" of the Problems panel.
- Tests: `database-problems.vitest.ts`; `scene-assets.spec.ts` "a deleted source shows in Problems with a relink fix; a copied record gets a new ID (UI9-09)".

### 2026-10-18: UI9-12 (done)

- The editor: `scripts/exportApi.ts` (the route `assets.export.run`: the export and `gltfErrors` of `@scenity/assets/build`); the client `exportGlb`; `export/ExportPanel.vue`; the panel `export` (PackageOpen).
- Tests: `scene-assets.spec.ts` "the Export panel exports the scene as GLB, and the glTF validator finds no error (UI9-12)".

### 2026-10-18: UI9-10 (in part)

- `@scenity/assets/sources`: `provider.ts` (`AssetProvider`, `ProviderRegistry`, the search words), `polyhaven.ts` (`polyHaven`, `polyHavenFiles`), `importFromSource.ts`.
- The editor: `scripts/sourcesApi.ts` (the routes `assets.sources.json`, `assets.sources.search`, `assets.sources.preview`, `assets.sources.import`; `SCENITY_POLYHAVEN_API` and `SCENITY_POLYHAVEN_CDN`), `listEntryOf` of `assetApi.ts`; the client `sourceProviders`, `searchSource`, `sourcePreview`, `importSource`; `sources/SourcesDialog.vue` and "Get assets" in the asset browser.
- Tests: `sources.test.ts` (3); `scene-asset-build.spec.ts` "a Poly Haven sky imports with its rights record in 3 clicks (UI9-10)" (a local fake of Poly Haven).

### 2026-10-18: UI9-11 (done)

- `@scenity/assets`: `sources/generator.ts` (`AssetGenerator`, `httpGenerator`, `importGenerated`); the rights writer takes `kind: generated` and `generator`. docs/formats.md has the two fields.
- The editor: `scripts/generatorsApi.ts` (the routes `assets.generators.json`, `assets.generate.estimate`, `assets.generate.run`); the client `generators`, `estimateGenerate`, `generate`; `sources/GenerateForm.vue` and the Generate toggle of "Get assets".
- Tests: `sources.test.ts` "a generator of assets (UI9-11)"; `scene-asset-build.spec.ts` "a generated model shows its cost first, then imports with its record (UI9-11)" (a local fake service).

### 2026-10-18: the checks at the end of phase UI9

- The e2e specs (chromium): 113 passed, 1 failed: the first test of `studio-agent.spec.ts` (it fails only in the full run, as at the end of UI8).
- The macOS gallery: 152 passed, 6 failed. Fixed: the frame of the editor at 1024x700. The asset toolbar showed "Get assets" and "Make stills" on a server with no asset list (now they show only with a list), and the text button "Recordings" of UI8-07 pushed the grid snap out of the toolbar (now a glyph button with a label). Left: the 4 editor theme frames (they wait for the approval of the owner, see UI7) and sim-road "a press of the button asks for the next walk" (364 pixels, the flaky late event of UI8).
- The Linux gallery did not run: Docker (OrbStack) was not on.

### 2026-10-18: UI10-01 (done)

- `@scenity/editor-core`: the command `sequence.rules` (the change `settings` takes `rules`).
- The editor: `scene/rules/ruleForm.ts` (the metric picker, the argument fields, `draftOf`, `ruleOf`), `ruleTargets.ts` (the files, `withRule`, `writeRules`), `RuleEditor.vue`, the buttons of `SceneRulesPanel.vue`, `liveProjectRules` and `reloadProjectRules` of `pageRules.ts`, `scripts/rulesApi.ts` (the route `rules.write`).
- Tests: `sequence-commands.test.ts` "sets the rules of the sequence as one undo step (UI10-01)"; `rule-form.vitest.ts` (3); `scene-rules-panel.spec.ts` "J7 makes a rule with no text editor: a scene rule, an edit, a new rules file (UI10-01)".

### 2026-10-18: UI10-02 (done)

- The editor: `scene/rules/ruleRequest.ts` (`askRule`), `draftFromValue` and the `worst` side of `ruleForm.ts`, the button of the readout (`startLayoutTools.ts` `saveButtons`), the draft of a new rule in `SceneRulesPanel.vue` and `RuleEditor.vue`.
- Tests: `rule-form.vitest.ts` "makes the draft of a measure …"; `scene-layout-tools.spec.ts` "Save as a rule: a measure becomes a distance rule with its value now as the limit (UI10-02)".

### 2026-10-18: UI10-03 (done)

- `@scenity/runtime-dev`: `DevDocumentCore.useMetrics`, the `metrics` loader of `attachDevSceneWorker`, the `metrics` option of `createDevDocumentClient`.
- `@scenity/traffic-runtime`: the metric face `src/dev.ts` (`traffic.vehicleGap`; `scenity.dev` in package.json). `samples/sim-road/scenity.project.json` has the rule `road.carGap`.
- The editor: `loadProjectDevPlugins` of `scripts/sceneProjectPlugins.ts` (and `projectPlugins.d.ts`), the worker entry and main.ts give the loaders; the rules editor lists the plugin metrics.
- Tests: `plugins/traffic/runtime/tests/dev.test.ts`; `packages/cli/tests/checkPlugins.test.ts` (the statuses have `road.carGap`); `scene-rules-panel.spec.ts` "a sample rule with a plugin metric shows its value and passes the save gate (UI10-03)".
- Found while checking: `packages/cli/tests/build.test.ts` "the build passes the budgets and the marker gate" failed: the module check of the marker gate read the source paths of the worker source maps from the wrong folder, so `packages/runtime/src/plugins/*` and the Vite shim of the Node modules of the decoders counted as dev modules. Not from UI10-03; fixed with UI11-01.

### 2026-10-18: UI10-04 (done)

- The editor: `scene/rules/rulesLog.ts` (`rulesLogPath`, `parseRulesLog`), `RulesLog.vue` in `SceneRulesPanel.vue` (it reads the log again after each save).
- Tests: `rule-form.vitest.ts` "reads the rules log of a scene, the newest first (UI10-04)"; `scene-rules-panel.spec.ts` "the rules log shows each override with its reason and its scene hash (UI10-04)".

### 2026-10-18: UI10-05 (done)

- The editor: `scripts/checkApi.ts` (the route `check.run`), `scene/problems/checkJob.ts` (`runCheckJob`, `ruleStatuses`, `differences`, `checkProblems`), the actions of `ProblemsPanel.vue`, the comparison line of `SceneRulesPanel.vue`, the asset statuses of `readProjectRules` (`pageRules.ts`). The CLIs of the dev server resolve from the main entry of their package.
- Tests: `check-job.vitest.ts`; `scene-rules-panel.spec.ts` "the check job: scenity check from the Problems panel gives the table of the page check (UI10-05)".

### 2026-10-18: UI10-06 (done)

- The editor: `scene/performance/perfStats.ts` (`statRows`, `entityCosts`), `PerformancePanel.vue`, `startPerformance.ts`; the panel `performance` (Cpu); the render item of the status bar runs `panel.open.performance` (`openPerformance` of `statusParts.ts`).
- Tests: `perf-stats.vitest.ts` (2); `studio-status.vitest.ts`; `scene-layout-tools.spec.ts` "the Performance panel shows each value of stats() and the cost of each entity (UI10-06)".

### 2026-10-18: UI10-07 (done)

- The editor: `scripts/benchApi.ts` (the routes `bench.run` and `bench.json`, the history), `scene/performance/benchTrend.ts` (`trendLines`, `sparkPoints`), `BenchPanel.vue`; the panel `bench` (Timer).
- Tests: `bench-trend.vitest.ts`; `scene-asset-build.spec.ts` "the bench runs from its panel; three runs show as a trend (UI10-07)" (three quick runs of the small project).

### 2026-10-18: UI10-09 (in part)

- The editor: `scene/viewport/debugLayersPart.ts` (`debugLayersPart`, `pageDebugLayers`) in the View options overlay (`viewportBar.ts`).
- Tests: `scene-layout-tools.spec.ts` "each generic debug layer toggles from the View options overlay (UI10-09)".

### 2026-10-18: UI10-10 (done)

- The editor: `scene/layoutTools/layoutSearch.ts` (`shiftedReport`, `placeRules`, `searchPlaces`, `startResults`, `placeOp`), `layoutSearchPart.ts` (the button, the variants, the script API), the rules of the layout tools (`layoutToolsHolder.ts`).
- Tests: `layout-search.vitest.ts` (2); `scene-layout-tools.spec.ts` "Find a place: a search places a chair that passes three rules (UI10-10)".

### 2026-10-19: UI11-01 (done)

- `@scenity/cli`: the module check of the marker gate reads the sources of a worker bundle from the output folder of the player package too (`sourceBases`), and skips the virtual modules of Vite (`__vite-browser-external`): the builds of the showroom and of spin pass the gate again.
- The editor: `scripts/cliJob.ts` (a CLI job of the dev server), `scripts/projectBuildApi.ts` (the routes `project.build.json`, `project.build.run`, `project.build.budgets`), `scene/build/BuildPanel.vue`, `startBuild.ts`; the panel `build` (Package) of the Build workspace.
- Tests: `packages/cli/tests/markerSources.test.ts` (2), `build.test.ts` passes again; `scene-asset-build.spec.ts` "J8 builds with no terminal: the Build window, its report, a budget and the built player (UI11-01)".
- Seen once: `scene-rules-panel.spec.ts` (UI10-05) failed in one run because the page loaded again while Vite optimized a new dependency; the next run passed 7 of 7.

### 2026-10-19: UI11-02 (done)

- The editor: `scene/build/embedSnippet.ts` (`embedSnippet`, `embedPage`), `EmbedPanel.vue` (the panel `embed`, Code), the route `embed.preview.html` of `scripts/projectBuildApi.ts`, the web types of the project files (`scripts/projects.ts`).
- Tests: `embed-snippet.vitest.ts`; `scene-asset-build.spec.ts` "the embed snippet runs in a plain HTML file, and the preview plays the build (UI11-02)".

### 2026-10-19: UI11-03 (done)

- The editor: `scripts/shotsApi.ts` (the routes `shots.json`, `shots.take`, `shots.baseline`, `shots.poster`, `shots.verify`; `baselinesOf`, `verifySteps`), `scene/build/shotNames.ts`, `ShotsPanel.vue` (the panel `baselines`, Images, of the Build workspace).
- Tests: `shot-names.vitest.ts` (2); `scene-asset-build.spec.ts` "shots and baselines: verify shows the diff of a failed shot; a poster from a shot is the Hub picture (UI11-03)" (the Hub picture from `projectPicture` of the studio host).

### 2026-10-19: UI11-04 (done)

- The editor: `scripts/renderQueueApi.ts` (the routes `render.add` and `render.json`; `readRequest`, `renderArgs`), `lockArgs` of `scripts/cliJob.ts` (it makes the folder of the lock file of `SCENITY_BENCH_LOCK`; the bench, the shots and the renders use it), `scene/build/RenderQueuePanel.vue` (the panel `renderQueue`, Film).
- Tests: `render-queue.vitest.ts` (2); `scene-render-queue.spec.ts` "a clip of the walkthrough comes out with no terminal (UI11-04)".

### 2026-10-19: UI11-05 (in part)

- `@scenity/cli`: the command `scenity publish` (`publish/command.ts`, `publish/zip.ts`: a ZIP writer on `node:zlib` with a fixed date and sorted files); docs/cli.md has it.
- The editor: the route `project.publish.run` of `scripts/projectBuildApi.ts` and the Publish part of `BuildPanel.vue`.
- Tests: `packages/cli/tests/publish.test.ts` (2: the archive that `unzip` reads, a stop with reasons); `scene-asset-build.spec.ts` "a failed release check stops the publish and gives its reasons (UI11-05)".

### 2026-10-19: UI11-06 (done)

- The editor: `scripts/poolApi.ts` (the routes `/pool.json` and `/pool.run`), `scene/settings/PoolControls.vue` in `SettingsPanel.vue`, the texts in `i18n/en-US/settings.ftl`.
- Tests: `scene-pool.spec.ts` "the pool state shows and changes from Preferences (UI11-06)" (a pool folder and a GPU lock of its own).

### 2026-10-19: the checks at the end of phase UI11

- The e2e specs (chromium): 126 passed, 2 failed, 18 did not run: the first test of `studio-agent.spec.ts` (it fails only in the full run) and J1 of `studio-hub.spec.ts` (the socket of the dev server closed: the run went on while files of the editor changed). The gallery run of the same time is not valid (130 passed, 28 failed): a change of `vite.scene.config.ts` during the run started the dev server again, and the pages did not get ready. The gallery runs again at the end of phase UI12, with no change during the run.

### 2026-10-19: UI12-01 (done)

- The editor: `scene/projectSettings/` (`projectForm.ts`: `projectNode`, `nodeOf`, `checkValue`, `searchHit`, `setIn`, `emptyOf`, `optionOf`, `renameKey`; `projectSections.ts`; `FormNodeView.vue`, `ProjectEditorFields.vue`, `ProjectSettingsPanel.vue`; `projectCalls.ts`, `projectRoutes.ts`), `scripts/projectSettingsApi.ts` (the routes `project.settings.json`, `project.settings.write`), the panel `projectSettings` (FileCog, File menu).
- Tests: `project-form.vitest.ts` (7); `scene-project-settings.spec.ts` (a text, a list, a map entry, a flag and a union in the form, canonical JSON; the search and Revert).

### 2026-10-19: UI12-02 (done)

- The editor: `studio/shell/hostPreferences.ts` (`HostPreferences`, `patchHostPreferences`; the theme uses it), `scene/settings/HostPreferencesFields.vue`, the groups and the search of `SettingsPanel.vue`.
- Tests: `scene-settings.spec.ts` "Preferences shows the settings in groups with a search, and names the host values (UI12-02)"; `studio-origin.spec.ts` "Preferences shows the preferences of the host and writes them over the new value (UI12-02)".

### 2026-10-19: UI12-03 (done)

- The editor: `scene/shortcuts/` (`keyboard.ts`: `KEYBOARD`, `keyBindings`, `keymapFile`, `readKeymapFile`; `ShortcutsPanel.vue`; `startShortcuts.ts`), `PageSettings.setKeymap`, the panel `shortcuts` (Keyboard, File menu).
- Tests: `shortcuts-keyboard.vitest.ts` (3); `scene-settings.spec.ts` "a person changes a key on the keyboard picture; clashes, import and export (UI12-03)".

### 2026-10-19: UI12-04 (done) and UI12-05 (in part)

- The editor: `scripts/vcsApi.ts` (the routes `vcs.status.json`, `vcs.diff.json`, `vcs.commit`, `vcs.branches.json`, `vcs.switch`), `scene/vcs/` (`useVcs.ts`, `VcsPanel.vue`, `startVcs.ts`), the panel `vcs` (GitBranch, ⇧⌘G); `scene/diff/semanticDiff.ts` and `SemanticDiff.vue`.
- Tests: `vcs-panel.vitest.ts` (4: the cases of the Changes tab of the workbench, the Git routes on a new repository); `semantic-diff.vitest.ts` (3); `scene-vcs.spec.ts` (a save shows its semantic diff, the commit, a switch of the branch).

### 2026-10-19: UI12-06, UI12-07 (done)

- The editor: the journal of `scripts/cliJob.ts` (`trackJob`, `journal`, `rerunJob`, `cancelJob`, `outputFiles`; the bench, the check, the asset build and the release check go into it too), `scripts/jobsApi.ts` (the routes `jobs.json`, `jobs.again`, `jobs.cancel`, `runs.json`, `runs.start`), `scene/jobs/` (`useJobs.ts`, `JobsPanel.vue`, `startJobs.ts`), the panel `jobs` (ListTodo). `@scenity/studio-host`: a job keeps the arguments of its request (`JobInfo.args`).
- Tests: `jobs-panel.vitest.ts` (6: the journal with real child processes, Stop, a run with its preset, the restricted project, the panel with the jobs of the server and of the studio); `scene-project-settings.spec.ts` "a run made in the form starts from the Jobs panel, with its log (UI12-06, UI12-07)".

### 2026-10-19: UI12-08, UI12-09 (done)

- `@scenity/scene` and `@scenity/editor-core`: the `autosave` group of the editor settings (`enabled`, `seconds`; project scope).
- The editor: `scene/drafts/` (`hostDrafts.ts`, `autosave.ts`, `formatUpgrade.ts`: `upgradeOffer`, `lineDiff`; `startRecovery.ts`: `pageDrafts`, `startRecovery`), `scripts/draftsApi.ts` (the routes `drafts.json`, `drafts.write`), the changes of a draft in the recovery dialog (`offerDraft`).
- Tests: `drafts-recovery.vitest.ts` (5); `scene-recovery.spec.ts` (a closed tab gets its edits back from the host, the autosave, the upgrade of a v0 scene with its diff).

### 2026-10-19: UI13-01, UI13-09 (done); UI13-06, UI13-08 (in part)

- `@scenity/cli`: the studio face of the resolver (`STUDIO_FILES`, `ProjectPlugin.studio`).
- The editor: `studio/extensions/` (`api.ts` = `@scenity/editor/studio`: `defineStudioPlugin`, `STUDIO_API_VERSION` and the types; `installStudioPlugin.ts`; `ContributionBoundary.vue`; `PluginIcon.ts`), `scene/extensions/` (`startStudioPlugins.ts`, `studioFaces.ts`), the studio faces of `scripts/sceneProjectPlugins.ts`, `resolve.dedupe: ["vue"]` of `vite.scene.config.ts`, the texts `i18n/en-US/plugins.ftl`. docs/plugins.md has "The studio face".
- The spin sample: `plugins/demo/src/studio.ts`, `SpinnersPanel.vue`, `src/i18n/en-US/demo.ftl` (the dependencies `vue` and `@scenity/editor`).
- UI12-08: the dev servers of the specs and of the gallery keep no drafts on the host (`SCENITY_SCENE_HOST_DRAFTS=0` in the Playwright configs), so the unsaved edits of one test never come back in another; the recovery spec turns them on. With no `autosave.enabled` in the project, the autosave preference of the studio host decides.
- Tests: `studio-plugins.vitest.ts` (4: the install, the versions and the prefixes, the error card with Try again, the public surface); `scene-studio-plugins.spec.ts` (the panel and the command of the demo plugin; safe mode); `packages/cli/tests/commands.test.ts` has the command `publish` of UI11-05.

### 2026-10-19: UI13-02 (in part)

- The editor: `studio/extensions/contributionPoints.ts` (`installPoints`: the prefixes, an overlay in an error boundary, the status items again after a change of the scene or the selection, the errors of a tool or a source in the Console), `studio/extensions/pluginSettings.ts`, `scene/extensions/` (`pagePoints.ts`, `pageViewPoints.ts`, `pageAgentParts.ts`, `docsLinks.ts`, `pluginPresets.ts`), the registries of the plugins in `componentIcons.ts`, `customWidgets.ts`, `previewKinds.ts` and `recipes.ts` (the source "plugin"), the custom items of the status bar (`WindowStatus.addCustom`), the page tools and the context lines of the plugins in `sceneBridgeCalls.ts`, `PluginSettingsFields.vue` in Preferences. The scene commands of the page are in `pluginPresets.ts` now (`sceneCommandsOf`).
- The spin sample: one example of each point in `plugins/demo/src/studio.ts` (`SpeedDial.vue`, `SpinReadout.vue`, `PatternPreview.vue`, `icons/spin.svg`); the speed of `demo.spin` has the custom hint `demo.speedDial` (with no studio face the number field of the schema shows).
- Tests: `studio-plugins.vitest.ts` (8); `scene-studio-plugins.spec.ts` (4: the panel and the command; safe mode; the widget, the preset, the overlay, the status item and Problems; the toolbar button, the scene tool and the settings).

### 2026-10-19: UI13-04 (done), UI13-05 (in part)

- The editor: `scripts/pluginsApi.ts` (the routes `plugins.json`, `plugins.add`, `plugins.remove`, `plugins.new`; the module of the project plugins is made again after a change), `scripts/pluginScaffold.ts` (`pluginFiles`, `requestProblem`), `scene/extensions/PluginsPanel.vue` and `NewPluginForm.vue`, the panel `plugins` (File menu), the command `agent.ask`, the dedupe and the alias of `vite.scene.config.ts`.
- Tests: `plugins-window.vitest.ts` (2); `plugin-scaffold.vitest.ts` (3: the files of the parts, the checks, and the code of the files runs); `scene-project-settings.spec.ts` "a person adds the physics plugin in the Plugins window with no text editor (UI13-04)" and "the new plugin wizard makes a folder plugin; its component and its panel show after a reload (UI13-05)".

### 2026-10-19: UI13-10 (in part)

- The editor: the routes `cli.commands.json` and `cli.run` of `scripts/jobsApi.ts` (`helpPluginCommands`, `cliCommands`, `startCliCommand`), the commands `cli.<name>` (`startJobs.ts`), the commands of the plugins in `JobsPanel.vue`.
- Tests: `jobs-panel.vitest.ts` "reads the commands of the plugins from the help of the CLI"; `scene-project-settings.spec.ts` "a command of the CLI face of a plugin runs from the search box as a job with its log (UI13-10)".

### 2026-10-19: UI10-08 (done)

- The editor: `scene/budgets/budgetTable.ts` (`BUDGET_KEYS`, `budgetRows`, `withLimit`, `tiersOf`, `groupsOf`), `BudgetsPanel.vue`, the panel `budgets` (Gauge).
- Tests: `budget-table.vitest.ts` (2); `scene-asset-build.spec.ts` "a budget change in the budgets editor shows in the next bench (UI10-08)".

### 2026-10-19: UI14-03 (done)

- Docs: "The panels" in `docs/editor.md`; `docs/components.md` (written by `tools/component-docs.ts`; Prettier leaves it out).
- The editor: `scene/panelDocs.ts` (`PANEL_DOCS`, `panelDocsUrl`, `componentDocsUrl`), F1 (`help.context`) with the card of the focus, the docs button of each component card.
- Tests: `panel-docs.vitest.ts` (2); `tools/component-docs.test.ts` (2).
- The partial run of the e2e specs at the end of UI13 (stopped at 123 of 164 by the end of the session) found two failures: `scene-assets.spec.ts` "a drop imports a file" passes alone (a flaky wait), and `scene-hot-reload.spec.ts` (UI9-13) took its first picture before the panels mounted (the Scene view is 8 pixels narrower then); the test waits for the hierarchy now.

### 2026-10-19: UI14-01 (done)

- The editor: `studio/tour/` (`tour.ts`: `TOUR_STEPS`, `startTour`, `startTourOnce`, `endTour`; `TourCard.vue` in `StudioShell.vue`), the command `help.tour`, the mark `[data-tour-target]` of `shell.css`, the texts `i18n/en-US/tour.ftl`.
- Tests: `tour.vitest.ts` (2); `scene-settings.spec.ts` "the tour shows six steps over the panels and comes back from Help (UI14-01)".

### 2026-10-19: UI14-04 (done)

- The editor: `studio/shell/emptyStates.ts` (`emptyStateOf`), `EmptyState.vue` (in `DockPanel.vue` and in the empty branches of the list panels), `has` and `execute` of the command port of the window, the texts `i18n/en-US/empty-states.ftl`.
- Tests: `empty-states.vitest.ts` (2).

### 2026-10-19: UI14-13 (done)

- `@scenity/scene` and `@scenity/editor-core`: the `usage` group of the editor settings (`log`, a user setting, off).
- The editor: `scene/usage/` (`usageLog.ts`, `UsageLogFields.vue` in Preferences), the hook `ran` of `pageKeys` (a key, a menu or a call), the texts in `settings.ftl`.
- Tests: `usage-log.vitest.ts` (2: off by default; the lines when on, the last 2,000, no request).

### 2026-10-19: UI14-07 (done)

- The speed suite `tests/e2e/studio-speed.spec.ts` (5 tests) and its report `test-results/speed.json`.
- `dragMath.ts` (`documentCameraIds`, `entityCount`) and `viewIcons.ts`: a cache for each document. `startViewport.ts` uses them.
- `scripts/cliJob.ts` (`runCli`, async), `poolApi.ts` and `jobsApi.ts` (no block of the dev server; a 5 s cache of the plugin commands).
- `projects/noProject.ts`: one `/health` request for each page. `editMode.ts` (`preloadEditParts`), `main.ts`. `agentPanel.ts`: the terminal panel is an async component.

### 2026-10-19: UI14-06 (done)

- pt-BR: 44 files in `apps/editor/src/i18n/pt-BR/` (3,215 messages). `tools/check-i18n.ts` and its test (4); `check:i18n` in `package.json` and CI; `@fluent/syntax` as a dev dependency of the root.
- `tests/e2e/studio-pseudo.spec.ts` (3: the editor in the pseudo-locale with each panel, the Hub, pt-BR).
- `translate="no"` on the data of the Hub (the doctor details, the folders, the paths, the language select, the project names, the recipe titles), the Jobs panel (the runs), the Lighting panel (the maps) and the Embed panel (the public URL). The folder list of the Hub has a label (`hub-folder-list`).
- UI14-06 follow-up: the pseudo-locale e2e also opens each menu and submenu. The scene command listings of the page give the titles and the reasons of `@scenity/editor-core` in the page language (`hierarchy/listingTexts.ts`); the shortcuts of the ui menus are `translate="no"`. Three texts now match the UI (the Problems status item, Entity → Create → Create a camera, New record… in the Rights panel).

### 2026-10-19: UI14-10 and UI14-11 (in part)

- A fix found by the docs pictures: in a studio window the agent panel read the viewport in its first render, before the lazy viewport chunk ran; the throw left a broken node, and each later workspace switch emptied the dock. `windowParts.ts` (`viewNow`) gives null until the viewport runs. The new test in `studio-tools.spec.ts` switches each workspace of a studio window with the agent panel.
- `tests/e2e/docs-pictures.spec.ts` (on request, `SCENITY_DOCS_PICTURES=1`) writes `docs/pictures/studio-hub.jpg`, `studio-new-project.jpg`, `studio-editor.jpg` and `studio-build.jpg`.
- UI14-11: `studio-bridge.spec.ts` moved from `apps/workbench` to `apps/editor/tests/e2e/studio-tools.spec.ts` (5 pass); the workbench page shows a note that names Scenity Studio; `dev:editor` runs the studio; the scene page has no old shell (UI3); `scenity dev` names the studio.
- To do: `docs/studio.md`, the quickstart through the studio (no terminal step after `scenity studio`), the "Open it" part of `docs/editor.md`, `docs/README.md`, the retirement note at the top of `docs/workbench.md`, the README and a changeset. The removal of the code of `apps/workbench` waits for the owner: CodeBlue uses the page, and the files are not in Git yet.

### 2026-10-19: UI14-10 and UI14-11 (done)

- `docs/studio.md` (new), `docs/quickstart.md` (through the studio), `docs/editor.md` (Open it, Agents in the editor), `docs/README.md`, `docs/architecture.md`, `docs/workbench.md`, the root README, `apps/workbench/README.md`, `.claude/skills/scenity/SKILL.md`, `.changeset/studio-replaces-workbench.md`.
- `tools/studio-docs.test.ts` (3). The Hub text "What is new" names the agents (en-US and pt-BR).

### 2026-10-19: UI14-02 (done) and a follow-up of UI14-06

- `scene/tutorials/` (`tutorials.ts`: the steps and their checks; `startTutorials.ts`: the commands `tutorial.start.<id>`, the checks, the callouts, the session storage), `studio/tutorials/` (`tutorialCard.ts`, `TutorialCard.vue` in the shell), the texts in `tutorials.ftl` (en-US, pt-BR), the line of the agent prompt (`studio-host` `claude.ts`), the Learn section of the Hub.
- Tests: `studio-tutorials.spec.ts` (3: the three tutorials, from the Help menu and over a reload), `tutorials.vitest.ts` (3), `studio-host` `studioPrompt.test.ts` (2).
- UI14-06 follow-up: the inspector shows the labels of the components, their groups and their fields in the page language (`inspector/componentTexts.ts`); `tools/component-texts.ts` writes the en-US messages from the schemas (`components.ftl`, 166 messages, with a test that it matches), and pt-BR has each one. The pseudo-locale e2e selects an entity, so it reads the inspector too. The rig option "none" of the Character panel is a message.

### 2026-10-19: UI15-03 (done)

- `@scenity/scene` `schema/notes.ts` (`noteReplySchema`, `replies`), `schema/editor.ts` and `@scenity/editor-core` `editorSettings.ts` (`notes.author`); the editor: `notes/pageNotes.ts` (`reply`), `NotesPanel.vue` (the thread), `startNotes.ts` (the author); the texts in `hierarchy.ftl` and `settings.ftl` (en-US, pt-BR); `docs/formats.md`, `docs/editor.md`.
- Tests: `notesDocument.test.ts` (3), `studio-notes-thread.spec.ts` (1); `scene-selection.spec.ts` (the notes, 3) passes.

### 2026-10-19: UI1-05, UI3-02 and UI3-06 (done)

- `settings/hostKeymap.ts` (`syncKeymapWithHost`), `shellHost.ts` (`syncHost`); `jobs/startJobs.ts` (the jobs item); the plural of `status-jobs`.
- Tests: `studio-tools.spec.ts` (+2: the layout in a new browser, the key map in a second browser), `scene-layout.spec.ts` (the jobs item).

### 2026-10-19: UI13-06 (done)

- `studio/extensions/contributionErrors.ts`, `ContributionBoundary.vue` (the turn off and Turn on); `scripts/sceneProjectPlugins.ts` (`projectStudioCode`, the module `virtual:scenity/project-studio`; the studio faces left the shared module), `pluginsApi.ts` (it invalidates both modules), `scene/extensions/studioFaces.ts` (the hot updates), `startStudioPlugins.ts` (dispose and activate again); the texts `plugin-error-off`, `plugin-error-on`, `plugin-reloaded`.
- Tests: `studio-plugins.vitest.ts` (+1), `studio-plugin-reload.spec.ts` (1); `scene-studio-plugins.spec.ts` (4) passes; the build of the scene page passes. The two functional test components of `studio-plugins.vitest.ts` keep the lint at 0 warnings.

### 2026-10-19: UI13-10 (done)

- `studio-host`: `agents/pluginTools.ts` (`loadPluginTools`, `PluginTools`, `pluginToolApi`: `GET /api/agent/tools`, `POST /api/agent/tools/run`), `server.ts` (the tools of a trusted project; the routes work with no agent), `AgentSessions` (the option `pluginTools`). The editor: `scene/agent/pluginToolCommands.ts` (`toolCommandId`, `toolInput`, `startPluginToolCommands`), started by `startAgentPanel` with or with no agent; the texts `plugin-tool`, `plugin-tool-result` (en-US, pt-BR). The spin sample: the tool `demo_spin_time` in `plugins/demo/src/host.ts`. `docs/plugins.md` (the `tools` of a host face in the studio).
- `tests/e2e/spinCopy.ts`: a temp copy of the spin sample with a link to the `zod` package of its plugin (the host face imports it); `scene-studio-plugins.spec.ts` uses it.
- Tests: `studio-host` `pluginTools.test.ts` (3); `plugin-tool-commands.vitest.ts` (3); `studio-tools.spec.ts` "a tool of a plugin runs from the search box with a form from its input schema (UI13-10)"; `scene-studio-plugins.spec.ts` (8) passes.

### 2026-10-19: UI2-10 (done)

- The editor: `hub/docsSearch.ts` (`docSections`, `headingAnchor`, `docsIndex`, `searchDocs`, `searchTutorials`, `loadDocsIndex`), `hub/AskBox.vue` in `LearnView.vue` (the docs list has Scenity Studio too), `HubApp.vue` (`openInEditor`), `scene/tutorials/startTutorials.ts` (`tutorial=<id>`); the texts `hub-ask-*` and `hub-doc-studio` (en-US, pt-BR); `tools/editor-texts-allowlist/hub.json` (the English stop words of the search); `docs/studio.md`.
- Tests: `hub-ask.vitest.ts` (12: the anchors, the 10 questions, the tutorials); `studio-hub.spec.ts` "UI2-10: the prompt box of Learn answers with the docs and starts a tutorial in the last project" (3 pass); `studio-pseudo.spec.ts` (3) passes.

### 2026-10-19: UI2-09 (done)

- `@scenity/cli`: `create/folder.ts` (`notInTemplate`, `templateFolderFiles`, `folderTemplate`; the export `@scenity/cli/folderTemplates`), `scenity create --from <folder>` (a copy keeps its own `.gitignore`); `docs/cli.md`.
- `studio-host`: `templates.ts` (`userTemplates`, `pluginTemplateList`, `listTemplates`, `saveTemplate`, `templateDir`), `api.ts` (`GET`/`POST /api/templates`, `GET /api/templates/picture`, a `create` job with a template ID gets `from`), `jobs.ts` (the flag `from`).
- The Hub: `studioApi.ts` (`DataTemplate`, `templates`, `saveTemplate`), `NewProjectDialog.vue` (the data templates after the built-in ones), `SaveTemplateDialog.vue`, `ProjectList.vue` (Save as a template…); the texts `hub-project-template`, `hub-template-save-*`, `hub-template-saved` (en-US, pt-BR); `docs/studio.md`, `docs/plugins.md` (Project templates).
- Tests: `create.test.ts` (+2), `studio-host` `templates.test.ts` (2) and `server.test.ts` (+1: save, list, a create job from the template, the refusals), `hub.vitest.ts` (+2), `studio-hub.spec.ts` "UI2-09: save the project as a template; the template shows in the wizard of a second project" (4 pass).

### 2026-10-19: UI13-03 (done)

- The editor: `studio/extensions/hooks.ts` (`usePanelState`, `usePanelVisible`, `useAgentAsk`, `EmptyState`), exported by `studio/extensions/api.ts`; the core panels import them from the API (`ConsolePanel.vue`, `ProblemsPanel.vue`, `ProjectWindow.vue`, `InspectorHost.vue`, `ComponentSection.vue`, `HierarchyPanel.vue`, `TasksPanel.vue`); `docs/plugins.md` (the hooks of a panel).
- Tests: `core-panel-api.vitest.ts` (9), the surface test of `studio-plugins.vitest.ts`; the component tests (126 files, 615) pass; `scene-inspector`, `scene-layout`, `scene-layout-tools`, `scene-studio-plugins` and `studio-no-agent` pass (one stale anchor of `scene-layout.spec.ts`, F1 on the hierarchy, now `#hierarchy-panel` as UI14-03 gives).

### 2026-10-19: UI10-11 (done), UI13-08 (in part)

- `@scenity/cli`: `frames/frameIndex.ts` (`wantedFrames`, `mergeFrames`, `withStaleMarks`, `projectContentHash`, the list file; the export `@scenity/cli/frameIndex`), `frames/run.ts`, `frames/command.ts` (`scenity frames`); `studio-host` `jobs.ts` (the job `frames`); `docs/cli.md`.
- The editor: `scripts/frameIndexApi.ts` (`frames.json`, `frames/<key>.png`, `frames.index`), `scene/frameIndex/` (`frameIndexModel.ts`, `FrameIndexPanel.vue`), the panel `frameIndex` in the Build workspace (`startBuild.ts`), the texts `frames.ftl` and the empty state (en-US, pt-BR); `docs/editor.md` (Frame index panel).
- UI13-08: `docs/studio-plugins.md`, linked from `docs/README.md` and `docs/plugins.md`.
- Tests: `frames.test.ts` (4) and `commands.test.ts` of the CLI; `frame-index.vitest.ts` (3); `scene-frame-index.spec.ts` (the walkthrough index in the panel, the compare, the stale marks after a change of the sequence file); `studio-pseudo.spec.ts` (3) passes with the new panel. A run of `scenity frames` on a copy of the walkthrough: a build and 116 frames in 15 s.

### 2026-10-19: UI5-15 (done)

- `studio-host`: `agents/mcpHttp.ts` (`mcpHttp`, `bearerToken`: the Streamable HTTP transport of the MCP SDK with no MCP session), `server.ts` (`/mcp`: the Host header, no foreign Origin, no agent → 404), `agents/external.ts` (`Connections.add`, `Connections.revoke`; `POST /api/agent/connections`, `…/revoke`).
- The Hub: `hub/ExternalClients.vue` in `AgentsView.vue` (the connections, Allow with a project, Deny, Revoke, Connect over HTTP), `agentClient.ts` (`addConnection`, `revokeConnection`); the texts `hub-clients-*` (en-US, pt-BR); `docs/studio.md`, `docs/cli.md`.
- Tests: `studio-host` `mcpHttp.test.ts` (4: an SDK client over HTTP, a plain JSON-RPC call, no token, a revoked token), `hub-clients.vitest.ts` (1), `studio-agent.spec.ts` "the Hub allows a request with no project; a client over HTTP edits the scene until a revoke (UI5-15)"; the spec passes (20).

### 2026-10-19: UI4-08 (in part: the scene pool with no window)

- `studio-host`: `poolFrames.ts` (`PoolFrames`, `shotArgs`, `pngSize`; the bytes in the form of the socket, `{ $bytes }`), `bridgeHub.ts` (`noWindow`), `server.ts` (the pool of the host; the option `cli`; the stop of the pool).
- Tests: `studio-host` `poolFrames.test.ts` (2, with a fake CLI); `studio-tools.spec.ts` "an agent picture of a project with no window comes from a warm page of the scene pool (UI4-08)"; the spec passes (9). No pool process stays after the studio stops.

### 2026-10-19: UI13-02 (the host-face importers)

- `@scenity/assets`: `isImporter`, `importerRegistryWith`; `runCli`, `runImportCli` and `runBuildCli` take a registry. `@scenity/cli`: `plugins/importers.ts` (`projectHostImporters`), `scenity assets import` and `build` with the importers of the plugins. The editor: `scripts/projectImporters.ts`, the registry of the project in `assetApi.ts`, `assetApiServer.ts`, `assetDetails.ts` and `assetReload.ts`; `hostFaces.ts` (`importers`). The spin sample: the importer `demo.pattern` in `plugins/demo/src/host.ts`. `docs/plugins.md`, `docs/studio-plugins.md`.
- Tests: `importRegistry.test.ts` of the assets (+1); `scene-studio-plugins.spec.ts` "an importer of the host face of the demo plugin imports a .pattern file as a demo.pattern asset (UI13-02)" (with the CC0 rights record of the plugin, so the publish test after it still passes; the spec passes, 9); a run of `scenity assets import` and `build` on a spin copy.

### 2026-10-19: UI13-02 (done: the handles of a scene tool)

- The editor: `studio/extensions/api.ts` (`StudioHandle`, `handles`, `moveHandle`), `contributionPoints.ts` (`toolHandleParts`), `scene/extensions/toolHandles.ts` (`startToolHandles`, `viewportView`), `pageViewPoints.ts` and `pagePoints.ts`; the spin sample: the tool `demo.placeSpinners`; `docs/studio-plugins.md`.
- Tests: `tool-handles.vitest.ts` (1), `studio-plugins.vitest.ts` (the handles of a tool); `scene-studio-plugins.spec.ts` "a scene tool with handles: a drag of the handle of a spinner moves it as one step (UI13-02)"; the spec passes (10).

### 2026-10-20: UI5-19 (done: a task in a worktree, the check of the project as the gate)

- `studio-host`: `agents/taskFolder.ts` (`makeWorktree`, `runProjectCheck`), `tasks.ts` (`worktree`, `folderOf`, `allowedOf`, the gate `check`: the rules, then `scenity check` of the task folder after `task.document`; the options `cli` and `worktrees`), `protocol.ts` (`TASK_GATES` with `check`, `AgentTaskInfo.worktree`), `sessions.ts` and `session.ts` (the folder of a session is the worktree of its task), `routes.ts` (`worktree`). `@scenity/bridge`: `TASK_DOCUMENT_CALL`. The editor: `review/taskGate.ts` (`document`), `sceneBridgeCalls.ts` (`task.document`), `TasksPanel.vue` (the gate "The rules and scenity check", In a worktree), `agentClient.ts`; the texts `tasks-gate-check`, `tasks-worktree`, `tasks-worktree-title`, `tasks-check-passed-check` (en-US, pt-BR); `docs/editor.md`, `docs/studio.md`.
- Tests: `studio-host` `agentTaskFolder.test.ts` (2: a worktree, a failed check that goes back to the agent, then a pass; no Git); `studio-agent.spec.ts` "a background task in a Git worktree with scenity check as its gate keeps the folder of the person (UI5-19)"; the spec passes (21).

### 2026-10-20: UI5-04 (the ghosts and the marks of the Project window)

- `@scenity/runtime-dev`: `document/ghostCopies.ts` (`GhostCopies`, `plainGhosts`), the message `sceneGhosts`, `setGhosts` of the client and of the dev core (the camera previews hide them; the inspect report has `ghosts`). The editor: `viewport/ghosts.ts` (`changeGhosts`, `hexColour`, `ghostSender`), `startViewport.ts` (the ghosts of each frame, none during a Preview), `main.ts` and `viewportTypes.ts` (`setGhosts`); `agent/turnFileMarks.ts` (`agentFileMarks`, `markOf`, `startTurnFileMarks`, started with the agent panel), `AssetTile.vue` (the dot of the session), `AssetBrowser.vue`; the texts `assets-agent-mark` (en-US, pt-BR).
- Tests: `runtime-dev` `ghostCopies.test.ts` (1), `change-ghosts.vitest.ts` (2), `turn-file-marks.vitest.ts` (1); `studio-agent.spec.ts`: the UI5-04 test checks the ghost of the moved lantern (and none after a reject), and "an asset whose file a turn wrote has the mark of the session in the Project window (UI5-04)"; the spec passes (22).

### 2026-10-20: UI4-08 (done: a clock of its own)

- `@scenity/runtime-dev`: `devDocumentCore.ts` (`previewCamera(name, width, at)`; the page time kept by `updateScene` and put back after the previews; a document camera preview with no effect), `cameraPreview.ts` (`at`), `messages.ts` and `client.ts`. The editor: `shadowFrame.ts` (no seek of the page clock), `sceneSheet.ts` (each cell at its time from the core), `main.ts`, `sceneIndex.ts`.
- Tests: `studio-tools.spec.ts` "20 agent frames …" samples the time of the page at each frame while the agent takes 20 pictures (it stays at 1200 ms), two times give two pictures, and the same time gives the same picture; `scene-viewport.spec.ts` and `scene-sequencer.spec.ts` pass (13).

### 2026-10-20: UI5-04 (done: the marks of the timeline)

- The editor: `sequencer/SequencerTracks.vue` (`ghostActor`, `keyTitle`: the border of a ghost key in the colour of the session of its proposal, `data-actor`, "proposed by …"); the text `sequencer-key-proposed` (en-US, pt-BR).
- Tests: `scene-sequencer.spec.ts` "an agent adds a camera move: its keys are ghosts until the owner accepts them (UI8-04)" checks the session of the ghost keys.

### 2026-10-20: UI8-10 (the look variant, the IK handles, the foot lock and IK widgets)

- The editor: `inspector/widgets/footLock.ts` (`footLockOf`, `guessLeg` from the words of the bone names, `withLegPart`), `FootLockWidget.vue`, `CharacterIkWidget.vue`, registered in `customWidgets.ts` (`footLock`, `characterIk`); `character/characterSetup.ts` (`ikHandles`), `CharacterSetupPanel.vue` (the look variant, Move the IK targets in the view with `startToolHandles`), `startCharacterSetup.ts` and `windowParts.ts` (the canvas); the texts `inspector-foot-*`, `inspector-ik-*`, `character-variant*`, `character-ik-*` (en-US, pt-BR); `docs/editor.md`.
- Tests: `character-widgets.vitest.ts` (4: the leg guess on Mixamo, Rigify, UE5 and VRM names, the IK handles, the two widgets); `scene-character.spec.ts` (2: the foot lock and the IK goals of the robot of the pickup scene in the inspector; the look variant and a drag of the handle of the cup as one undo step); `scene-walks.spec.ts` passes (2).

### 2026-10-20: UI8-12 (done) and UI8-10 (the retarget preview)

- `@scenity/scene`: `name` of an animation key (the clip in the asset), `ActiveClip.name`; `schema/sequence.schema.json`; `docs/formats.md`.
- `@scenity/runtime`: `scene/sequenceClips.ts` (`SequenceClipDriver`: the clips of the animation tracks after the animator, the own clips of the model or the clips of another asset retargeted through the rig profiles, `restore()` before the animator of each frame, `dispose()`), `scene/restPose.ts` (`atRest`, `entityTemplate`: a mixer and a retarget start at the rest pose of the template; the animator driver uses it too, so a new time line after a clip leaves no pose behind), `SceneTimeline.previewClip` and `dispose`, `SceneBuilder.acquireModel` and `releaseModel`; `documentPlugins.ts` (the time line before a new one releases its assets; the preview clip goes to each new time line); `documentCore.ts` (`plugins` is protected).
- `@scenity/runtime-dev`: `previewClip` of the dev core, the message `sceneClipPreview` and the client; the inspect report has `clipSeconds` and `sourceClips`.
- The editor: `scene/clips/clipBrowser.ts` (`clipRows`, `clipCommand`, the drag data), `ClipBrowserPanel.vue`, `startClipBrowser.ts`, `clipDrop.ts` (a clip dropped on a character in the Scene view), the panel `clips` (left area of the Animate workspace), the clip drop of `SequencerTracks.vue`, `previewClip` of the viewport port; the retarget preview of `CharacterSetupPanel.vue`; the texts `panel-clips`, `clips-*`, `character-retarget*`, `empty-clips`, `empty-prompt-clips` (en-US, pt-BR); `docs/editor.md` (Clips panel, Character setup).
- Tests: `sequenceSample.test.ts` (+1); `runtime` `sequenceClips.test.ts` (4: a named clip over the animator, the pose after the clip, seek equals play, a new time line after a clip, the preview clip); `clip-browser.vitest.ts` (5); `scene-character.spec.ts` "a clip dropped on the timeline plays in the Scene view; Preview plays a clip with no key (UI8-12)" and "the retarget preview of the Character setup plays a clip of the clip source on the robot (UI8-10)" (they compare the bone points of the inspect report; a picture of the view has the frame rate of the stats overlay); "a clip dropped on the robot in the view" is a step of the first; the spec passes 8 of 8 in two runs, and 12 of 12 with `scene-walks`; `scene-play`, `scene-sequencer`, `scene-layout` and `scene-walks` pass (30).

### 2026-10-20: UI1-03 (the e2e specs on the studio path) and UI1-11 (done)

- The specs: `apps/editor/tests/e2e/specServer.ts` (`startSpecServer`, `ON_STUDIO`, `SCENITY_E2E_SERVER=scene`); 37 specs start it in place of a scene server of their own (`project=${key}` in their URLs); `scene-first-load.spec.ts` keeps `scenity dev`. `docs/testing.md` (the path of the editor specs).
- The faults that the studio path found, fixed: a copy of a sample of the checkout (the same project ID) got the plugins of the sample (`scripts/projectsFile.ts` makes the plugin modules of all the projects again for an override); a layout change just before a reload did not reach the host (`hostLayouts.ts` sends a waiting change at `pagehide`); the chips of the agent showed the English lines of the packet (`agentContext.ts`: a Fluent title, `translate="no"` for data) and the recipes of the studio had English titles (`localRecipe`, the texts `recipe-*`); the Bench panel has `data-loaded`.
- UI1-11, the host: `server.ts` (a project with a window is not idle; the check at a quarter of the idle time; `/p/<key>` opens a closed project again and waits for the scene server), `main.ts` (`idleOf`, `SCENITY_STUDIO_IDLE_MS`); `docs/studio.md`.
- Tests: `studio-host` `server.test.ts` (a closed project opens again) and `idle.test.ts`; `studio-workspaces.vitest.ts` (a change at `pagehide`); `studio-sessions.spec.ts` "three projects in three tabs; the one with no window stops and comes back with its change". The full e2e run on the studio path: 186 passed, 1 skipped; the one failure (`studio-agent`, the title of the review chip) is fixed and the spec passes alone (22).

### 2026-10-20: UI4-13 (the order of the changes of a scene)

- `studio-host`: `documentLog.ts` (`DocumentLog`: a version and the last 200 steps of each scene), `bridgeHub.ts` (each `doc.ops` gets the next version; the window that made it gets `doc.version` with `ack`; a `hello` gets the version of its scene), `server.ts` (`GET /api/documents/log?project=…&path=…&since=…`). The editor: `documentSync.ts` (the changes with no `ack` go again after a change of another window, as one step "Your change, after the change of another window"; a new socket forgets them); the text `sync-again-title` (en-US, pt-BR).
- A first try sent the change of a window back from the host when the window was behind; it put back a reverted proposal of the Review panel (a window that sends changes faster than the answers come), so the windows now keep the order themselves.
- Tests: `studio-host` `documentLog.test.ts` (3), `bridgeHub.test.ts`; `document-sync.vitest.ts` (2); `studio-tools.spec.ts` "an agent edits a closed project; two windows and the agent edit one scene and stay equal (UI4-13)" sets the same value in two windows at once (3 runs pass); `studio-tools` and `studio-agent` pass (31).

### 2026-10-20: UI2-04 (start from a prompt, in part)

- `studio-host`: `agents/chooseTemplate.ts` (`chooseTemplate`: one turn of the driver with the tool `choose_template`, outside each session; `chooseTemplateApi`), the route `POST /api/agent/choose-template` in `server.ts` (the driver is a part of the host now). The Hub: `studioApi.ts` (`agentsAvailable`, `chooseTemplate`), `NewProjectDialog.vue` ("Describe what you want to make", "Start from the prompt", the choice of the agent in the progress, the words in the URL of the editor window); the texts `hub-wizard-prompt*`, `hub-wizard-choosing` (en-US, pt-BR). The editor: `agent/startFromPrompt.ts` (a new session "The first scene" in review mode, the prompt of the first scene, the words go from the URL), started by `agentPanel.ts`; the text `agent-start-session`. `docs/studio.md`.
- Tests: `studio-host` `chooseTemplate.test.ts` (3); `start-from-prompt.vitest.ts` (1); `hub*.vitest.ts` pass (30); `studio-start.spec.ts` "the words of the person make a project and a first scene that waits for review (UI2-04)" (the script driver chooses the empty template and makes two changes that wait); `studio-hub.spec.ts` passes (4).

### 2026-10-20: UI14-09 (done: the agent benchmark v2)

- `tools/agent-bench`: `studio.ts` (the `studio` adapter: a host, the project copy in an editor window of a headless Chromium, a session in the auto mode, the approval cards answered once and counted as review steps, the save of the window), `run.ts` (`--adapter studio`), `report.ts` (the review steps), `README.md`; `docs/ui/research/agent-bench.md` (the v2 section).
- The faults that the run found, fixed: `bridgeHub.ts` (a call waits for a window that reloads: `RELOAD_GRACE_MS`, `RELOAD_WAIT_MS`), `windowParts.ts` (`openSequence` answers first), `@scenity/cli` `build/run.ts` and `build/command.ts` (a progress line at the start of each step, on stderr).
- Tests: `studio-host` `bridgeHub.test.ts` "a call waits for a window that reloads (UI14-09)"; the CLI tests pass (173); the adapter with the script driver (`SCENITY_AGENT_SCRIPT`, `look-dark-floor`) passes; the runs of the model: 2 of 2 (a smoke run), 18 of 24, then 4 of 6.

### 2026-10-20: UI15-01 and UI15-02 (done)

- `studio-host`: `access.ts` (the role of each launch code and session, `VIEWER_REFUSAL`, `EDITOR_REFUSAL`, the note files as the one write of a viewer, `OWNER_PATHS`, `roleOf`; the public origin: `hostAllowed`, `ownOrigin`, `linkOrigin`, `Secure` cookies with HTTPS; a review code lasts 7 days), `server.ts` (`POST /api/launch-code` with `{ role, next, review }`; `/api/state` gives `role` and `remote`; the output of the terminals goes to the sockets of the owner only; in remote mode no shell and `files: ask` for the agents), `agents/routes.ts` (`modeRefusal`: the role of the request caps the modes), `gateway.ts` (the gateway of the studio), `main.ts` (`--public-origin`, `SCENITY_STUDIO_PUBLIC_ORIGIN`), `api.ts`; `@scenity/cli` `studio/command.ts`. `@scenity/editor-core` `SceneChannel` (`lock`, `remote()`).
- The editor: `scene/windowState.ts` (`showViewer`, `lockWindow`, the restricted bar of another role), `studio/shell/viewerRole.ts` (`viewerReason`, `studioAccess`, `roleReason`), the hooks `useViewerReason()` and `useRoleReason(action)` of the studio API, `sceneBar` (`lock`), `pageSequence`, `documentSync` (the changes of another window pass the lock), `AgentComposer.vue`, `AgentPanel.vue` (Share for review, the mode reason), `TerminalPanel.vue`, `PluginsPanel.vue`, `agent/reviewLink.ts` (`shareTurn`, `shareDialog`, `openReview`); the Hub: `HubApp.vue` (the line of the role), `ProjectList.vue` (Trust and Remove for the owner only); the texts `notice-viewer*`, `notice-restricted-owner`, `role-*`, `agent-share-*`, `hub-role-*` (en-US, pt-BR). `docs/studio.md` (Roles, review links and remote mode), `docs/cli.md`, `docs/studio-plugins.md`.
- The faults that the work found, fixed: each socket of `/events` got the output of the terminals (now the owner only); an editor could choose the Auto mode (the cap used the role of the host, not of the request); the gateway answered `/health` itself, so a window behind it did not find the studio.
- Tests: `studio-host` `access.test.ts` (the roles), `remote.test.ts` (2: the gateway with the public `Host` only, no host secret, the public links; no shell, a file write of Auto asks, no Auto for an editor, no terminal output for a viewer); `editor-core` `channel-lock.test.ts` (2); `role-reason.vitest.ts` (2), `hub.vitest.ts` (the role line), `studio-plugins.vitest.ts` (the surface); `studio-review.spec.ts` (the owner shares a turn; a viewer in a new browser opens the link, sees the bar, Save and the turn actions off with the reason, an edit refused with the reason, and leaves a note in the note file); `studio-remote.spec.ts` (2: through the gateway with a public name, an editor edits and saves, the terminals and Auto are off with the reason; the owner gets no shell, and Auto says that a file write asks); `studio-hub`, `scene-studio-plugins` and `scene-layout-tools` pass.

### 2026-10-20: the full e2e run on the studio path

- 209 tests: 196 passed, 1 skipped, 1 failed, and the 11 serial tests after it did not run. The failure: `scene-layout.spec.ts` read the boxes of the Assets workspace before its layout settled (now a poll; the checks of the folded and of the large page retry until the layout settles, `toPass`). `studio-agent.spec.ts` waits 20 s for a turn (on a busy machine a turn took more than the default 5 s).

### 2026-10-20: the final full e2e run and the macOS gallery

- The e2e specs (chromium, 211 tests, at a load of 24 to 38): 193 passed, 5 failed, 1 skipped, and 12 serial tests after the failures did not run. A rerun of the five spec files alone: `studio-speed` (the editor is ready in 2.6 s) and `scene-play` (the animator, UI8-09) pass. Three fail again at a load of 26 to 44, all from the time of the machine: `scene-gizmo` (the page was ready after 23 s and one script call took 41 s, so the test passed its 120 s), `scene-hot-reload` render worker (a new texture in 3.5 s, the limit is 2 s) and `scene-layout-tools` UI10-09 (the wireframe layer did not show in 5 s). They run again at a lower load.
- A fault that the trace showed, fixed: `scene/devTools.ts` kept the layers that are on only after the next report, so a change of the view layers in that time sent the layers before the change. Now `debug()` keeps the new layers at once.
- The macOS gallery (216 tests): 151 passed, 58 skipped, 7 failed. The 7 are the editor window frames; the axe checks of the editor window pass. They need the approval of the owner (`update` mode); the frames of the run are in the scratchpad of the session:
  - `editor-size-*` (1024x700, 1280x720, 1920x1080; about 1 %): the Jobs tab (UI12-07), the jobs item of the status bar (UI3-06), the Recordings button beside Play (UI8-07) and the docs link "?" of a component (UI13-02, the header of a component is 2 px higher). At 1280x720 the Recordings button makes the gizmo bar scroll: the snap value of Scale and the Surface box go out of the bar (they stay in its scroll region). A choice for the owner: keep the scroll, or make the bar fit at 1280.
  - `editor-themes` (4 themes; about 4 %): these baselines are from before UI7 (no menu bar, no scene tabs). They wait for the approval of the owner since the checks of UI7.
- The Linux baselines did not run (they wait for the approval above).

### 2026-10-20: UI3-13 (the toolbar fits at 1280x720)

- The owner chose a toolbar that fits at 1280x720 (the Recordings button of UI8-07 made the gizmo bar scroll, and the snap value of Scale and the Surface box went out of view). `studio/shell/shell.css` (`.studio-bar`: it gets smaller before the tools, its min-content width keeps the tabs, the state and Save), `scene/scene.css` and `scene/sceneBar.ts` (the path is in an inner span in a grid column `minmax(0, max-content)`, so it gets an ellipsis first), `scene/projects/projects.css` (the scene tabs keep their width up to 320 px; more tabs scroll in the list), `scene/gizmo/gizmo.css` (a gap of 4 px, number fields of 44 px).
- A measure of the build at four widths: at 1920 and 1440 the toolbar shows all (the path 135 px); at 1280 the gizmo bar shows all of its 718 px with no scroll (the path 31 px, with an ellipsis); at 1024 the path goes and the gizmo bar scrolls (493 of 718 px), the tabs and Save stay.
- This changes the `editor-size-*` and `editor-themes` frames again; they wait for the approval of the owner with the other changes of the editor window frames.

### 2026-10-20: UI0-10 (superseded)

- The owner agreed to mark UI0-10 (could) as superseded: the shell and the agent panel are built, so a clickable prototype with fixed data cannot change the layout before UI3 any more. The sessions with people (UI0-05, UI13-08) use the real editor. The checklist has a new mark `[-]` for a superseded task.

### 2026-10-20: the editor window frames (approved)

- The owner approved the changed editor window frames: `editor-size-1024x700`, `editor-size-1280x720`, `editor-size-1920x1080` and `editor-themes` (dark, light, navy, dark with more contrast). The macOS baselines (`scene-darwin`) are the frames of the run after the toolbar fit of UI3-13: the Jobs tab, the jobs item, the Recordings button, the docs link of a component, and the toolbar that fits at 1280x720. The Linux baselines of these frames come from `gallery-linux-baselines.sh missing -g "the editor window"`: the first run (at a load of 75, emulated) wrote `editor-dark-more`; in the other 9 tests the page was not ready after 60 s, so they run again at a lower load.
- A rerun of `scene-gizmo`, `scene-hot-reload`, `scene-layout-tools`, `scene-layout` and `scene-prefabs` at a load of 75 is not valid: 5 tests ran out of time (a page was not ready after 60 s). They run again at a lower load.

### 2026-10-20: the licence header

- The owner asked for the licence header without the copyright line: each source file now starts with `SPDX-License-Identifier: Apache-2.0` only (2,809 files: TypeScript, JavaScript, Vue, CSS, Fluent, Python, shell, Markdown). `NOTICE` and the README keep the copyright holder. The generators write the same header: the editor faces (`packages/cli/src/vite/editor.ts`), the component texts (`tools/component-texts.ts`) and the new plugin wizard (`apps/editor/scripts/pluginScaffold.ts`). The rule is in the skill of the repository (`.claude/skills/scenity/SKILL.md`) and in `docs/generic-engine-plan.md`.
- Checks: format, lint, both typechecks, `component-texts --check`, `editor-texts` and `check-i18n` (0 problems); the tests of the CLI (173), of `tools/` (136) and `plugin-scaffold.vitest.ts` (4) pass.

### 2026-10-20: UI1-03 and UI4-13 (closed by the owner)

- UI1-03: the owner chose to keep the gallery on the static build of the scene page. The e2e specs already run through the studio host, so the done-when holds for the specs; the gallery draws the page that ships.
- UI4-13: the owner chose to close the task as it is. The done-when passes (an external agent edits a closed project; two windows and the agent edit one scene and stay equal). The histories and the change sets stay in the windows; `docs/ui/architecture.md` records the decision, and the plan row has a note.

### 2026-10-20: UI13-07 (done: the adapter of a lab face)

- `adaptLabFace(face)`: the tabs are panels on the right and the dock tabs panels at the bottom (the labels become a Fluent file of the plugin), the take model is the Takes panel (`LabTakesPanel.vue`: the takes, their moments, the members and the marks at a time), the page tools are page tools of the window, the context lines go to the agents (a promise gives the last lines). `kept` names each part that needs the lab page, with the reason. The texts `lab-takes-*` (en-US, pt-BR). `docs/lab-to-studio.md` (The adapter) and `docs/studio-plugins.md` (A lab face in the studio).
- Tests: `lab-face.vitest.ts` (3: the panels, the tools and the lines of a lab face; a face with no parts; the lab fixture in the studio with its Takes panel), `studio-plugins.vitest.ts` (the surface has `adaptLabFace`).

### 2026-10-20: the journeys with a model (UI2-04, UI13-05)

- `tools/agent-bench/journeys.ts` runs J2 (`journeyStart.ts`: five prompts through the Hub, the change set, accept, a check of the parts of the words) and J10 (`journeyPlugin.ts`: the plugin wizard, the agent writes the system, the file reviews, the inspector and the play mode). `journeys.test.ts` tests the checks with no model.
- The first smoke run of J2 (the museum prompt) at a load of 40 to 70: the agent chose the template and made the project; the runner read the sessions with the name of the URL, not the key of the host, so it did not see the turn of the first scene (fixed: the key comes from `/api/state`, the session from its prompt, and the items go to `<prompt>.jsonl`). The runs of J2 and J10 come next.

### 2026-10-20: the comment pass of the sources (the request of the owner)

- Each source file (2,864: TypeScript, Vue, CSS, Fluent, Python, shell) went through a review of its comments: no task IDs, milestone or journey IDs, plan section marks, ADR numbers, plan file paths (`docs/ui/*`, `docs/generic-engine-plan.md`, `docs/adr/*`, the old plan names) or "phase" wording in comments and test titles; each comment in ASD-STE100; comments that did not match the code are correct now (wrong file names, wrong defaults, misplaced doc comments, missing items of lists), and history notes are gone. "phase" and "plan" stay where they name code (`phaseMs`, `planStills`, the plan mode of the agents).
- The runtime strings with task IDs or plan paths are clean too: the CLI help and command summaries, the lint messages of `eslint.config.js`, the errors and the generated headers of the asset build (the vendored GLTFLoader, Draco and Basis files are generated again), the tokens formats, the stills `$comment` (the showroom sample and template), the editor texts (`card-prop-propose`), the generated `components.ftl` header, the check tools and their tests. `tools/domain-words.ts` keeps the area of a file (`areaOf`) in place of a task ID. The journeys of `tools/agent-bench/journeys.ts` are `start` and `plugin`.
- The package READMEs, the root README, the changesets, the skill of the repository, the `package.json` descriptions, the CI workflows, the token descriptions, the sample notes and rights comments and the player pages have no plan references.
- 59 files with no licence header (Fluent files, the build folders of `@scenity/assets` and `@scenity/cli`) start with `SPDX-License-Identifier: Apache-2.0` now.
- `adaptLabFace` has types of its own (`LabFace`, `LabTakeModel`), so the studio API no longer brings the lab core into the type check of a plugin.
- A backup of the sources before the pass is in the scratchpad of the session (`source-backup-before-comments.tgz`).
- Checks: both typechecks, the lint of the repository, `editor-texts`, `check-i18n`, `component-texts --check`, `domain-words`, `licences` and the template check pass; the unit tests run next.
