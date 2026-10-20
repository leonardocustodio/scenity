# Scenity Studio: vision and principles

This page says why the studio is needed, what it must feel like, which products it learns from and how we know that it
works. The tasks are in [plan.md](plan.md).

## 1. The problem today

Scenity has a strong engine, a scene editor, a workbench with Claude and a CLI. A person who wants to use them meets
these problems (from the reviews of 2026-10-17; [coverage.md](coverage.md) has each feature):

**No start without a project.**

- `scenity dev` stops with "has no scenity.project.json" when the folder is not a project.
- The scene page with no `project=` uses `showroom` with no word (`apps/editor/src/scene/main.ts`). An installed editor
  then shows "Scene error: no scene at …".
- `bun run dev:editor` starts the lab page on port 5175, which says "No editor plugin" in this checkout
  (`apps/editor/src/core/NoPluginPage.vue`). The scene editor is on port 5176.
- A new project needs `scenity create` in a terminal. No page lists the projects, the templates or the samples.

**Three pages, two servers, two command systems.**

- The scene page (`scene.html`), the lab page (`index.html`) and the workbench page (`apps/workbench`).
- The workbench needs a host (`bun packages/workbench-host/src/main.ts --project …`), a second server
  (`bun run dev:workbench`) and an address with a 64-character token.
- The lab page has a palette, panes, a help dialog and undo buttons; the scene page has none of them.

**A developer shell.**

- The canvas fills the page; the hierarchy, inspector and dock float over it in fixed places
  (`apps/editor/src/scene/editLayout.css`). There is no docking, no second view and no saved layout.
- The file bar, the gizmo bar, the start screen and the play bar are plain DOM with hard-coded colours. The three Vue
  panels are three separate apps with a forced dark theme. The lab page is navy.
- There is no menu bar, no command palette, no undo or redo button, no history list and no key sheet.
- One notice bar stands in for every dialog (drafts, conflicts, rule reasons, names).
- The open scenes are in a 72-pixel `<select>`.

**Hidden features.**

- 14 options are URL parameters, and most of them have no control in the page: `sequence=`, `camera=`, `t=`,
  `paused=1`, `tier=`, `backend=`, `worker=0`, `assets=source`, `debug=`, `inspect=1`, `locale=`, `from=`, `audio=0`,
  `workbench=`.
- 15 commands exist only in the CLI: `check`, `build`, `verify`, `shot`, `sheet`, `clip`, `bench`, `pool`, and
  `assets build`, `stills`, `release-check`, `export`, `index`, `missing`, `used-by`.
- These files need a text editor: the project file (plugins, rules, units, quality, build, release, workbench), rules
  files, rights records, approvals, the agent runs and the gate.
- The create menu adds only an empty entity or a model. There is no light, camera or shape preset.
- 17 inspector hints (`fog`, `bloom`, `lodChain`, `walks`, `characterIk` and others) fall back to plain fields.

**Split agent features.**

- The agent lives in the workbench. Its proposals are cards inside the editor frame, one command at a time; its turns,
  diffs and commits are in the workbench dock. The editor history and the host's turn snapshots do not know each other.
- The switch that lets Claude apply at once has no UI (only `__scenity.setProposalMode`).
- Sequence edits get no proposals, so the agent cannot edit a sequence under review.
- Inspector edits and add or remove component are raw ops, not commands, so they are not agent tools, not keys and not
  named in the history.
- `scene_frame` pauses, seeks and moves the camera of the person's view and does not put it back.
- Lab words leak into the generic tools and texts: `lab_*`, "take", "tune", "the 3D lab".
- Three agent paths (terminal, chat, background runs) each have their own safety UX and credentials.

## 2. The aim

One application, **Scenity Studio**, where a person:

1. types `scenity studio` (or opens the desktop app) and sees the **Hub**, with no project needed;
2. makes a project from a template or from a sentence, or opens one, with no terminal;
3. edits it in an **editor window** that a Unity user knows at once: Scene view, Game view, hierarchy, inspector,
   Project window, console, timeline, in docks that they can arrange and save;
4. reaches **every feature of Scenity** from that window: assets, rights, rules, sequences, play, checks, builds,
   shots, benches, plugins, project settings;
5. works **with agents as partners**: they select something and ask; the agent works next to them in its own view;
   its edits wait as a change set that they review in place; each prompt is a checkpoint; any agent can connect.

**The first ten minutes, as a story.** Ana types `scenity studio`. The Hub greets her, asks for a theme, checks her
machine and offers to connect Claude. She picks the Showroom template, names it "Lobby" and clicks Make. The editor
opens with the scene, the hierarchy at the left, the inspector at the right and the Project window at the bottom. A
short tour shows the four areas. She selects the sofa, presses ⌘I and types "make this teal velvet". A teal ghost of
the sofa shows; the inspector marks the changed material values in the agent colour; she clicks Accept. She asks the
agent panel "add a reading lamp next to the sofa and light the corner warmer". The agent works in its own view; its
colour marks the entities it touches; the Review panel lists five changes. She rejects the second lamp, accepts the
rest, presses Play, then opens Build and makes a player. She never opened a terminal again and never read a doc.

## 3. Who it is for

| Person                    | Wants                                                        | Uses most                                                                 |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| A creator new to 3D       | To make a scene by saying what they want, and to fix details | The Hub, templates, the agent panel, the inline prompt, Review, Build     |
| A level or scene designer | Speed and control, as in Unity                               | Docks, keys, gizmos, prefabs, the timeline, the inspector, layout tools   |
| A technical artist        | Clean assets, rights, budgets, quality                       | Import, asset inspector, rights, the build, the Performance panel, rules  |
| A developer               | To add components, systems, panels and agent tools           | The plugin wizard, the studio face, the console, the agent, their own IDE |
| An owner or reviewer      | To trust what agents and others change                       | Review, the history, checkpoints, semantic diffs, review links            |

## 4. Principles

### 4.1 Principles of the experience

| ID  | Principle                                 | What it means in the studio                                                                                               |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| U1  | Familiar first                            | The default layout, keys and words follow Unity where Scenity has the same idea (Hierarchy, Inspector, Project, W/E/R, F) |
| U2  | One way in                                | ⌘K finds every command, entity, asset, file, setting and doc page, and offers "Ask the agent" when nothing matches        |
| U3  | Nothing hidden                            | No feature only in a URL, a CLI command or a hand-written file ([coverage.md](coverage.md))                               |
| U4  | Everything can be undone                  | Each edit is one named undo step; a turn of an agent is one step; a checkpoint restores files too                         |
| U5  | No dialog for what undo can fix           | Ask only before a loss that undo cannot bring back (a file delete, unsaved changes, a publish)                            |
| U6  | Show, do not tell                         | Previews, ghosts, marks in place and frames before and after, not log text                                                |
| U7  | Every empty state teaches                 | An empty panel says what to do next and offers a prompt for the agent                                                     |
| U8  | Small by default, deep on demand          | Workspaces per task; advanced fields fold; the inspector shows the values that matter first                               |
| U9  | Keyboard and screen reader for everything | Each panel works by keyboard; focus is visible; names for screen readers; AA contrast                                     |
| U10 | Fast                                      | The Scene view keeps its frame rate; panels answer in one frame; long work is a job with progress, never a freeze         |

### 4.2 Principles of agent-first work

| ID  | Principle                          | What it means in the studio                                                                                                     |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A1  | One set of verbs                   | The person and the agent use the same commands; each command is a tool; each tool shows its effect in the UI                    |
| A2  | Selection is context               | What the person selects, looks at and has open goes into the prompt as chips that they can see and remove                       |
| A3  | Review where you work              | Agent edits show as ghosts in the views and as marks in the hierarchy, inspector, timeline and Project window, not in a far tab |
| A4  | A turn is one unit                 | All edits of a turn (documents and files) form one change set, one undo step and one checkpoint                                 |
| A5  | The person's view is theirs        | The agent draws its pictures in its own view; it never moves the person's camera, clock, selection or focus                     |
| A6  | Visible trust                      | The permission mode is always on screen; Ask, Review and Auto have clear limits; risky actions always ask                       |
| A7  | Presence, not mystery              | The agent has a colour, marks what it works on, shows its camera, and its activity is in the status bar                         |
| A8  | Plans before big work              | A large request starts with a plan card that the person approves; steps tick during the run                                     |
| A9  | Any agent                          | The built-in agent and any external agent (over MCP) use the same tools, show the same presence and make the same change sets   |
| A10 | The agent checks its work          | Pictures after each step, the rules (`scenity check`) as the stop gate, and the result in the transcript                        |
| A11 | Instructions live with the project | `AGENTS.md`, skills, recipes and notes are files of the project, versioned with it                                              |
| A12 | Works with no agent                | Every feature works with the agent off; agent entry points say how to connect one                                               |

### 4.3 Simple to learn, to use and to extend

| Goal             | How                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Simple to learn  | Unity words and layout; templates; a 6-step tour; tutorials with checks; F1 help in context; "Show me how" from the agent; empty states |
| Simple to use    | One search box; one undo history; drag and drop between all panels; presets; snaps; workspaces; the agent for the long tasks            |
| Simple to extend | One studio face; the core panels use the same API; a plugin wizard; inspectors from schemas with no code; examples in the samples       |

## 5. The references

### 5.1 Unity: the model for the editor

What we take ([Unity manual](https://docs.unity3d.com/6000.3/Documentation/Manual/)):

- **The Hub**: a project list with versions and dates, a template gallery with a preview, Learn.
- **The default layout**: the toolbar at the top, the Hierarchy left, Scene and Game in the centre, the Inspector
  right, the Project window and the Console at the bottom.
- **Windows** that dock, tab, float and maximize (Shift+Space); saved layouts; more than one locked inspector.
- **Scene view overlays** ([Overlays](https://docs.unity3d.com/6000.3/Documentation/Manual/overlays.html)): Tools,
  Tool settings, Grid and snap, View options, Orientation, Cameras; they dock to the edges and fold; presets.
- **The toolbar**: Play, Pause and Step in the centre; a tint in Play mode.
- **Prefabs**: prefab mode with a breadcrumb and "in context"; override marks (bold value, margin bar); the
  Overrides list with Apply and Revert; variants.
- **Search** (Ctrl+K) with providers and query words; a table view with editable columns.
- **Project Settings** (per project, versioned) apart from **Preferences** (per person); the Shortcuts window.
- **The Console** with counters as filters, fold of repeats and a detail pane.
- **The Animation window** with Record mode; the Timeline; the Animator graph.
- **Unity AI** ([Assistant](https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.11/manual/about/assistant-modes.html)):
  Ask, Plan and Agent modes; plan approval with a progress list; Allow, Ask or Deny per operation; a checkpoint at each
  prompt ([Checkpoints](https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.11/manual/reference/checkpoints-reference.html));
  attach objects, assets and console lines as context; MCP clients that the owner allows.

What we do not copy: Play mode edits that are lost at Stop (Scenity has **Keep**); modal windows for settings; the
many separate windows of the Animation tools in one view.

### 5.2 pen.dev: the model for agent-first work

pen.dev (formerly Pencil) is "an agentic canvas" for design, with agents that edit `.pen` files over MCP
([pen.dev](https://www.pen.dev/), [AI agents](https://docs.pencil.dev/core-concepts/ai-agents),
[AI integration](https://docs.pencil.dev/getting-started/ai-integration)). What we take:

- **Selection is context**: "Canvas selections are automatically added to the chat's context."
- **A cheap state call** (`get_app_state`): the document, the selection, the top nodes and the components in one answer
  (our `studio_state`, UI4-09).
- **Atomic agent calls** (`execute`): one call applies all its changes or none (UI4-10).
- **Live work on the canvas with visible "in progress" marks**, a name on every node, a find-empty-space helper and a
  screenshot after each section (UI5-09, UI7-12).
- **Parallel agents**: split the work, or the same task side by side with different models; "let it cook" for 2 to 6
  variants (agents.md §11).
- **Permission requests** with Allow or Deny and a switch to Auto.
- **Skills** on `/`; **MCP** that sets up Claude Code, Codex and Claude Desktop from Settings (UI5-15).
- **Design as code**: plain JSON files with stable IDs in the repository, with diffs and branches. Scenity documents
  are already this kind of file.
- **Notes, prompts and context stored with the objects** they describe (UI5-14).
- **Onboarding in three steps**: prompt, select the result, prompt again.

What we do not copy: pen.dev has no accept and reject view of agent changes; the person rolls back with undo. The
studio keeps review as the default (change sets), because a 3D scene is harder to check by eye than a page.

### 5.3 Other products

| Product                                                                                  | What we take                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [Cursor](https://cursor.com/docs/agent/overview)                                         | Checkpoints on the chat timeline with preview and restore; one review view of all changes; parallel agents in worktrees; plan mode |
| Blender                                                                                  | Workspaces as tabs per task; F3 search of every operator; the Info log of every action as code; "Adjust the last operation"        |
| [Spline](https://blog.spline.design/spline-v2)                                           | An agent that uses the same tools as the person and checks its work with screenshots; placement by relations (on, against, near)   |
| Godot                                                                                    | A small default editor; scenes as text files that diff well; the running game embedded in the editor                               |
| [PlayCanvas](https://developer.playcanvas.com/user-manual/editor/realtime-collaboration) | A colour per actor; others' cameras as frustums in the view; marks in the hierarchy                                                |
| [Figma](https://help.figma.com/hc/en-us/articles/31304485164695)                         | Point and edit: select in the view, then prompt; notes sent to the agent as one prompt                                             |

## 6. Journeys

The journeys are the acceptance tests of the plan (e2e specs) and the tasks of the usability studies (UI0-05,
UI14-08). Each one starts in the Hub or the editor with a clean user state.

| ID  | Journey                | Steps                                                                                                                                     |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| J1  | Start empty            | `scenity studio` → the first run → New project → Empty → a name and a place → the editor opens; then open a recent project from the Hub   |
| J2  | Start from a sentence  | On the Hub, "a small museum room with three statues on plinths" → a project → a first scene as a change set → accept                      |
| J3  | Import and place       | Import a `.glb` with a rights record → see its preview → drag it onto the floor → scale it → save                                         |
| J4  | Light, camera, look    | Add a point light and a camera from the create menu → set the environment map, exposure and fog → a material on a part → save             |
| J5  | Prefab                 | Make a prefab from two entities → place two instances → override one value → apply it to the prefab → both change                         |
| J6  | Animate and play       | New sequence → a camera move with two keys → a clip on a character → play → record input in play mode → replay                            |
| J7  | Rules                  | Measure two entities → save as a rule → move one so the rule fails → see it in Problems → fix it (or ask the agent) → save                |
| J8  | Ship                   | Build → read the budgets → take a shot of a camera → copy the embed snippet → export a zip                                                |
| J9  | Agent task with review | "Add four chairs around the table and light it warmer" → watch the presence → review → accept 3 of 5 changes → undo the turn → redo       |
| J10 | A plugin               | New plugin → a component with two fields → "ask the agent to write the system" → review the files → the component in the inspector → play |
| J11 | Variants               | "Give me three lighting moods" → three variants in a grid of frames → keep one                                                            |
| J12 | A background task      | Start a background task with a budget and the rules as its gate → work on → a notification → review its turn                              |

## 7. Success measures

| Measure                                                       | Today (2026-10-17)                                               | Target                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| From the command to the editor of a new project               | About 5 minutes with the docs, two terminals and a typed address | Under 2 minutes, no terminal after `scenity studio`                |
| Features of [coverage.md](coverage.md) with a place in the UI | 86 of 164 rows (78 only in a URL, the CLI, a file or nowhere)    | Each must row                                                      |
| Editor actions that are commands with an agent tool           | Registry commands only (inspector edits are raw ops)             | Every action (a test checks it)                                    |
| Places where a person reviews agent work                      | Two (a card in the frame, the workbench Changes tab)             | One Review panel and marks in place                                |
| Journeys J1 and J3 to J8 done with no help, by new people     | Measured in UI0-05                                               | 90 %                                                               |
| System Usability Scale (SUS)                                  | Measured in UI0-05                                               | 80 or more                                                         |
| Agent benchmark: tasks done right                             | Measured in UI0-06                                               | 85 %, with a median review time under 60 s                         |
| Agent frames that move the person's view                      | All `scene_frame` calls                                          | None                                                               |
| Editor ready time (showroom, reference machine, warm)         | Measured in UI0-05                                               | Under 3 s                                                          |
| Hub first paint                                               | No Hub                                                           | Under 1 s                                                          |
| Hierarchy with 10,000 entities                                | Not measured                                                     | 60 fps scroll; a click selects in one frame                        |
| Accessibility                                                 | Not measured                                                     | 0 serious axe issues on the 14 key screens; each panel by keyboard |

The reference machine is an Apple silicon laptop with 16 GB of memory and Chromium in its current stable release.

## 8. Non-goals

The non-goals are in [plan.md](plan.md) §8.
