# Scenity Studio: the shell

This page gives the shape of the studio: the launch, the Hub, the editor window, its panels, menus, toolbar, status
bar, keys and the rules of interaction.

**Spec IDs** (UI0-07). Tasks, tests and the code name each part of this page by one ID:

| Part                 | ID form                   | Example                   | Where   |
| -------------------- | ------------------------- | ------------------------- | ------- |
| A panel              | its panel ID              | `inspector`, `scene.view` | §5      |
| A menu               | `menu.<name>`             | `menu.entity`             | §6      |
| A menu item or a key | its command ID            | `entity.duplicate`        | §6, §10 |
| A toolbar group      | `toolbar.<group>`         | `toolbar.clock`           | §7.1    |
| A status bar item    | `status.<item>`           | `status.jobs`             | §7.2    |
| A drop               | `drop.<dragged>.<target>` | `drop.model.view`         | §9.2    |
| A confirmation       | `confirm.<case>`          | `confirm.closeUnsaved`    | §9.5    |
| A window state       | `state.<name>`            | `state.restricted`        | §13     |
| A key screen         | `screen.<n>`              | `screen.4`                | §11     |

A test names its spec ID in its title (`"menu.entity: Create ▸ Point light adds a light"`), so a search finds the tests
of a part. The agent
parts are in [agents.md](agents.md); the visual language is in [design-system.md](design-system.md).

## 1. The launch

```text
scenity studio ──► host (Bun, one origin, e.g. http://127.0.0.1:5170)
                    │
                    ├─ /            the Hub page (no project needed)
                    │                 first run → projects → New project / Open / Learn / Agents / Settings
                    │
                    └─ /p/<key>     the editor window of one project (a redirect to scene.html?project=<key>&edit=1)
                                      restricted mode until the project is trusted (UI1-12)
```

- `scenity studio` starts the host, opens the browser on the Hub and prints `SCENITY_STUDIO_READY {"origin":…}`.
- `scenity studio --project <dir>` opens that project at once. A second `scenity studio` finds the running host and
  only opens the browser.
- `bun run dev:studio` in the checkout does the same with the editor sources of the checkout. `bun run dev:editor`
  opens the studio too (UI1-02).
- The desktop shell (UI14-12) starts the same host and shows the same pages in its own windows.
- The scene page with no `project=` and the lab page with no editor plugin send the person to the Hub (UI1-08).

## 2. The Hub

```text
┌─────────────┬───────────────────────────────────────────────────────────────────────────────────────────┐
│  Scenity    │  Projects                                  [ Search projects ]  [ Open… ]  [ New project ] │
│             ├───────────────────────────────────────────────────────────────────────────────────────────┤
│ ▸ Projects  │  ★ Lobby            ~/work/lobby            2 h ago     main ●   Scenity 0.3   ⋯            │
│   Learn     │    Robot walk       ~/work/robot-walk       yesterday   main     Scenity 0.3   ⋯            │
│   Agents    │    Crossing         ~/work/crossing         3 days ago  —        Scenity 0.2 ⚠ upgrade ⋯    │
│   Settings  │    (folder not found) ~/old/demo                                    Locate…  Remove         │
│             │                                                                                           │
│             │  ┌ What do you want to make? ─────────────────────────────────────────────────────────────┐ │
│             │  │ a small museum room with three statues on plinths                              [ Make ] │ │
│ Claude ● on │  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
│ Doctor ✓    │                                                                                           │
└─────────────┴───────────────────────────────────────────────────────────────────────────────────────────┘
```

| Part           | What it does                                                                                              | Task           |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------------- |
| Projects       | Cards or a list: picture, name, path, last open, Git branch and changed mark, format version, pin, ⋯ menu | UI2-02         |
| ⋯ menu         | Open, Open in a new window, Reveal on disk, Rename, Remove from the list (never deletes files), Upgrade   | UI2-02, UI1-06 |
| New project    | The wizard (below)                                                                                        | UI2-03         |
| Open…          | The folder dialog; a folder with no project file gets "Make this folder a project"; also a Git URL        | UI2-05, UI1-06 |
| The prompt box | "What do you want to make?" → a project and a first scene from the agent (shown only with an agent)       | UI2-04         |
| Learn          | The samples (open as copies), tutorials, docs, what is new                                                | UI2-06         |
| Agents         | Connect Claude (login or API key), connect an external agent over MCP, defaults (model, mode, budget)     | UI2-07, UI5-15 |
| Settings       | Theme, language, Preferences, the doctor                                                                  | UI2-07, UI1-10 |

**The new project wizard** (UI2-03):

```text
┌ New project ───────────────────────────────────────────────────────────────────────────────────────────┐
│ Templates                                 │  Showroom                                                   │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │  ┌───────────────────────────────┐                         │
│ │Empty │ │Show- │ │Chara-│ │Walk- │       │  │      (picture of the scene)   │  Six furniture models, │
│ │      │ │room ✓│ │cters │ │through│      │  └───────────────────────────────┘  an HDR sky, 3 scenes.  │
│ └──────┘ └──────┘ └──────┘ └──────┘       │  Name      [ Lobby                ]                         │
│ ┌──────┐ ┌──────┐ ┌──────┐                │  Place     [ ~/work            ] [ Choose… ]                 │
│ │Physics│ │Sim   │ │glTF  │               │  Packages  (•) linked to this checkout  ( ) from npm         │
│ │      │ │road  │ │samples│               │  [✓] Make a Git repository                                   │
│ └──────┘ └──────┘ └──────┘                │                                       [ Cancel ]  [ Make ]  │
└───────────────────────────────────────────┴─────────────────────────────────────────────────────────────┘
```

After Make, the wizard shows the create job (copy, install, first import) with its log folded, then opens the editor.
A failed job keeps the form and shows the log and Retry (UI2-08).

**The first run** (UI2-07) has four steps that the person can skip: welcome; theme and language; connect an agent
(Claude login, an API key, an external agent, or no agent); the doctor results with fix actions. It never shows again
unless the person picks Help → First run.

## 3. The editor window

```text
┌ ☰ Scenity ▸ Lobby ▾ │ File Edit Assets Entity Component Sequence Agent Build Window Help │ [Layout][Animate][Assets][Review][Build] │ ⌘K Search and ask │ ● Claude │
├ ✋ ✥ ↻ ⤢ │ Pivot ▾ World ▾ │ ⊞ 0.05 m  ∠ 15°  ⇲ 0.1  ⌖ Surface │ ◀◀  ▶  ❚❚  ▶❚  00:01.250 ⟲ │ ↶ ↷ │ Review mode ▾ │ Layout ▾ ┤
├ Hierarchy ─────────┬ [main.scene ●] [lobby.scene] + ──────────────────────────────┬ Inspector ─────────────┬ Agent ─────────────────────┤
│ 🔍 search…         │ [Scene] [Game]                                              │ ▣ Sofa   sofa  ⧉ ID    │ [Session 1] [+]            │
│ ▾ ⌂ Room           │  ┌ Tools ┐                      ┌ View: Lit ▾ ⊞ ┐ ┌ ⟲ ┐   │ Tags: furniture        │ …transcript…               │
│   ▸ ▣ Sofa      ●  │  │✥ ↻ ⤢│                         └───────────────┘ │XYZ│   │ ▾ Transform       ⋯    │ ┌ card: Moved Lamp 0.4 m ┐ │
│   ▸ ☀ Key light    │  └──────┘        (the scene)                      └───┘   │   Position 1 0 2       │ └────────────────────────┘ │
│     ◉ Camera front │                                                           │ ▾ Model           ⋯    │ chips: [scene] [Sofa] [t=1.25s] │
│                    │  ┌ Stats: 60 fps · 120 draws ┐   ┌ Agent: placing lamp… ┐ │ ▾ + Add component      │ [ Ask about the selection… ]│
├────────────────────┴───────────────────────────────────────────────────────────┴────────────────────────┴────────────────────────────┤
│ [Project] [Console] [Problems ⚠2] [Timeline] [Review 5] [Jobs]                                                                       │
│ ▾ Assets      │ ▣ chair  ▣ lamp  ▣ sofa  ◐ studio_sky  ◍ teal_velvet …                                                                │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ● saved · 1 selected · ⟳ stills 3/6 · ⚠ 2 ⛔ 0 · Claude: placing lamp (4/9) · WebGPU · high · 60 fps · 🔔                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

From top to bottom:

1. **The title bar.** The app menu (☰: Hub, New window, Preferences, Quit), the project switcher, the menu bar, the
   workspace tabs, the search box and the agent state (a dot in the agent colour; a click opens the agent panel).
2. **The main toolbar** (§7.1).
3. **The dock.** Docked panels in tab groups. The scene tabs sit above the centre group.
4. **The status bar** (§7.2).

The menu bar sits in the title bar to save one row (as in VS Code on the web). In the desktop shell the menus are
native and the row holds the workspaces and the search box only.

## 4. The default layout and the workspaces

**Layout** is the default workspace:

| Area         | Panels (tab order)                                 | Size                     |
| ------------ | -------------------------------------------------- | ------------------------ |
| Left         | Hierarchy, Scenes                                  | 260 px                   |
| Centre       | Scene view, Game view                              | the rest                 |
| Right        | Inspector                                          | 320 px                   |
| Far right    | Agent (wide screens, 1600 px or more)              | 360 px                   |
| Right, lower | Agent (narrow screens)                             | 40 % of the right column |
| Bottom       | Project, Console, Problems, Timeline, Review, Jobs | 30 % of the height       |

The agent panel is in the default layout from the first day (principle A1). A person can close it; the agent dot in
the title bar and ⌘L open it again.

| Workspace | For                    | Panels                                                                                                              |
| --------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Layout    | Build the scene        | As above                                                                                                            |
| Animate   | Time, animation, play  | Hierarchy; Scene view and Game view; Inspector; a tall Timeline with the curve editor; Animator; Agent              |
| Assets    | Import, rights, build  | A large Project window; the asset inspector; the import queue; Rights and licences; Asset build; a small Scene view |
| Review    | Agent work and changes | Review; Scene view with ghosts; Inspector in diff mode; History; Activity; Version control; Tasks; Agent            |
| Build     | Quality and shipping   | Build; Game view; Performance; Shots and baselines; Render queue; Jobs; Problems                                    |

- The workspace tabs keep their own layout. A change to a layout is kept at once (no "save" needed); **Layout → Reset**
  puts the default back; **Layout → Save as…** makes a named copy; **Layout → New workspace** adds a tab.
- A project can give a default workspace set in Project settings → Editor (UI3-03).
- Panels open where they were last. A panel that is not open opens in its default area.

## 5. The panels

| ID                | Panel               | What it does                                                                                  | Default place        | Key    | Task             |
| ----------------- | ------------------- | --------------------------------------------------------------------------------------------- | -------------------- | ------ | ---------------- |
| `scene.view`      | Scene view          | The editor camera, gizmos, handles, overlays, ghosts of agent changes                         | Centre               | ⌘1     | UI6-01           |
| `game.view`       | Game view           | The scene through a document camera in the player path; resolution, tier, backend; play input | Centre (tab)         | ⌘2     | UI6-04           |
| `inspector`       | Inspector           | The components of the selection; the asset inspector for an asset; diff mode in Review        | Right                | ⌘3     | UI6-06, UI9-03   |
| `hierarchy`       | Hierarchy           | The entity tree of the open scene                                                             | Left                 | ⌘4     | UI6-05           |
| `project`         | Project             | The project folder: assets, scenes, prefabs, materials, sequences, rules, plugins             | Bottom               | ⌘5     | UI6-07           |
| `timeline`        | Timeline            | Sequences, tracks, keys, markers, curves, record                                              | Bottom (tab)         | ⌘6     | UI8-01           |
| `performance`     | Performance         | Live stats, cost per entity, tier, backend and worker, bench results                          | Build workspace      | ⌘7     | UI10-06          |
| `agent`           | Agent               | Sessions, composer, transcript, mode                                                          | Far right            | ⌘8, ⌘L | UI5-01           |
| `review`          | Review              | The change sets that wait, by entity and op                                                   | Bottom (tab)         | ⌘9     | UI5-04           |
| `console`         | Console             | Logs of the page, worker, server, host, plugins, jobs and agent tools                         | Bottom (tab)         | ⌘⇧C    | UI6-08           |
| `problems`        | Problems            | Rules, assets, rights, schemas, budgets, plugins, the build                                   | Bottom (tab)         | ⌘⇧M    | UI6-09           |
| `history`         | History             | The undo stack with actors                                                                    | Review workspace     | ⌘⇧H    | UI6-10           |
| `search`          | Search              | Full search with providers and a table view                                                   | Floating             | ⌘⇧K    | UI6-11           |
| `scenes`          | Scenes              | The scenes of the project with pictures; new scene; recent                                    | Left (tab)           | —      | UI6-13           |
| `jobs`            | Jobs                | Every job with its output; run again                                                          | Bottom (tab)         | ⌘⇧J    | UI12-07          |
| `lighting`        | Lighting            | Environment, tone mapping, exposure, sky, fog, effects, presets                               | Right (tab)          | —      | UI7-05           |
| `material`        | Material            | The material editor with a preview object                                                     | Right (tab)          | —      | UI7-09           |
| `variants`        | Variants            | The override layers of the scene                                                              | Right (tab)          | —      | UI7-10           |
| `notes`           | Notes               | The notes of the scene; send to the agent                                                     | Left (tab)           | —      | UI7-14, UI5-14   |
| `animator`        | Animator            | States, transitions, parameters, layers                                                       | Animate workspace    | —      | UI8-09           |
| `character`       | Character setup     | Bone map, retarget preview, look variants, IK goals                                           | Animate workspace    | —      | UI8-10           |
| `rules`           | Rules               | Rule results, graphs, the editor, the rules log                                               | Bottom (tab)         | —      | UI10-01, UI10-04 |
| `frameIndex`      | Frame index         | The frames of the project; compare                                                            | Build workspace      | —      | UI10-11          |
| `importQueue`     | Import queue        | Imports with progress and errors                                                              | Assets workspace     | —      | UI9-02           |
| `assetBuild`      | Asset build         | The build state per asset; build settings                                                     | Assets workspace     | —      | UI9-05           |
| `rights`          | Rights and licences | Rights records, the licence policy, the release check                                         | Assets workspace     | —      | UI9-06, UI9-08   |
| `approvals`       | Approvals           | The review queue per role                                                                     | Assets workspace     | —      | UI9-07           |
| `assetSources`    | Asset sources       | Search and import from Poly Haven and plugin sources                                          | Assets workspace     | —      | UI9-10           |
| `build`           | Build               | Build settings, run, report, preview, embed, publish                                          | Build workspace      | ⌘⇧B    | UI11-01          |
| `baselines`       | Shots and baselines | Shots, baselines, verify                                                                      | Build workspace      | —      | UI11-03          |
| `renderQueue`     | Render queue        | Sheets and clips                                                                              | Build workspace      | —      | UI11-04          |
| `vcs`             | Version control     | Changes, semantic diffs, commit, branches                                                     | Review workspace     | ⌘⇧G    | UI12-04          |
| `plugins`         | Plugins             | The plugins of the project; add, remove, new                                                  | Floating             | —      | UI13-04          |
| `tasks`           | Tasks               | Agent tasks, background tasks, variants                                                       | Review workspace     | —      | UI5-19           |
| `activity`        | Activity            | Every command run as a line, by actor                                                         | Review workspace     | —      | UI4-11           |
| `instructions`    | Agent instructions  | `AGENTS.md`, skills, recipes of the project                                                   | Floating             | —      | UI5-12, UI5-13   |
| `terminal`        | Terminal            | Claude Code terminal, shell                                                                   | Bottom (tab, closed) | ⌃\`    | UI5-16           |
| `projectSettings` | Project settings    | Each field of the project file                                                                | Floating             | —      | UI12-01          |
| `preferences`     | Preferences         | The person's settings                                                                         | Floating             | ⌘,     | UI12-02          |
| `shortcuts`       | Shortcuts           | The key map on a keyboard picture                                                             | Floating             | —      | UI12-03          |

**Panel rules.**

- Each panel has a header with its icon, its title, a ⋯ menu (panel options, Docs, Close) and, for panels with a
  subject, a lock (the inspector, the timeline, the material editor).
- A panel opens again with its state: scroll, folds, filters, the locked subject.
- A panel that can have many copies (Inspector, Scene view, Search) gets a number in its title ("Inspector 2").
- A panel never opens a modal dialog for its own settings: they are in its ⋯ menu or in a fold of the panel.

## 6. The menus

The menu bar comes from command metadata (UI3-04). Each item shows its keys; a disabled item says why in its tooltip.
Plugins add items through the studio face (UI13-02).

| Menu      | ID               | Items                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File      | `menu.file`      | New scene ⌘N · Open scene ⌘O · Open recent ▸ · Save ⌘S · Save as ⌘⇧S · Save all ⌥⌘S · Close scene ⌘W — New project… · Open project… · Recent projects ▸ · Go to the Hub — Project settings… · Preferences ⌘, — Export scene as GLB… — Reveal the project on the disk · Close the project                                                                                                                         |
| Edit      | `menu.edit`      | Undo ⌘Z · Redo ⌘⇧Z · History — Cut ⌘X · Copy ⌘C · Paste ⌘V · Paste as a child ⌘⇧V · Duplicate ⌘D · Delete ⌫ · Rename F2 — Select all ⌘A · Select none ⌘⇧A · Invert · Select children · Select by ▸ · Back ⌘[ · Forward ⌘] — Frame F · Follow ⇧F · Align with the view ⌘⇧F · Align the view to the selection ⌥⌘⇧F — Play ⌘P · Pause ⌘⇧P · Step ⌥⌘P — Search and ask ⌘K · Adjust the last action                   |
| Assets    | `menu.assets`    | Import… ⌘⇧I · From a source ▸ · Create ▸ (Folder, Scene, Prefab, Material, Sequence, Rules file, Plugin) — Show in the Project window · Reveal on the disk · Import again — Make stills · Build assets · Rights and licences… · Approvals… · Release check · Find missing references                                                                                                                             |
| Entity    | `menu.entity`    | Create empty ⌘⇧N · Create ▸ (Shapes, Lights, Camera, Audio source, Socket, Path, Stand point, Obstacle, Note, Prefab instance, Character, plugin presets) · Create a child ⌥⌘N · Camera from the view — Group ⌘G · Ungroup ⌘⇧G — Make a prefab · Open the prefab · Unpack — Hide H · Solo ⇧H · Show all ⌥H · Lock — Align ▸ · Spread ▸ · Drop to the floor ⌘↓ · Place ▸ (On, Against, Facing, Near) — Add a note |
| Component | `menu.component` | Add component… ⌘⇧A · the built-in groups ▸ · the plugin groups ▸ — Copy values · Paste values · Reset · Remove — Save as a preset                                                                                                                                                                                                                                                                                |
| Sequence  | `menu.sequence`  | New sequence · Open sequence ▸ · Sequence settings… — Add a track ▸ · Add a key K · Add a marker M · Record ⌘R — Loop range ▸ — Play or pause Space · Step back , · Step forward . · Go to the start Home · Go to the end End — Animator · Recordings · Streams                                                                                                                                                  |
| Agent     | `menu.agent`     | Ask ⌘L · Ask about this ⌘I · New session ⌘T — Mode ▸ (Ask, Review, Auto) — Review · Accept all ⌥⌘↩ · Reject all · Undo the turn · Checkpoints — Plan first · Recipes ▸ · Instructions · Notes — Tasks · Start a background task… · Variants… — Connect an external agent… · Agent settings…                                                                                                                      |
| Build     | `menu.build`     | Build ⌘B · Build settings… · Open the built player — Take a shot… · Baselines · Verify — Render queue… — Check the rules · Bench… — Publish… · Embed code…                                                                                                                                                                                                                                                       |
| Window    | `menu.window`    | Workspaces ▸ · Layout ▸ (Save as…, Reset, Delete) — General ▸ · Animation ▸ · Rendering ▸ · Assets ▸ · Agent ▸ · Project ▸ · Plugins ▸ — Maximize the panel ⇧Space · Next panel ⌃Tab — New window                                                                                                                                                                                                                |
| Help      | `menu.help`      | Search the docs · Keys ? · Help for this F1 — Tour · Tutorials ▸ · Docs ▸ — Doctor · First run · Copy the diagnostic info — About Scenity                                                                                                                                                                                                                                                                        |

**Context menus** hold the commands of the item under the pointer, in the same words as the menu bar, and end with
"Ask the agent about this…" (⌘I).

## 7. The toolbar and the status bar

### 7.1 The main toolbar

| Group         | ID                     | Controls                                                                                | Task   |
| ------------- | ---------------------- | --------------------------------------------------------------------------------------- | ------ |
| Tools         | `toolbar.tools`        | View (Q), Move (W), Turn (E), Scale (R); the tools of plugins after a separator         | UI3-05 |
| Tool settings | `toolbar.toolSettings` | Pivot or centre (P), world or local (L), grid, angle and scale snaps, surface snap      | UI3-05 |
| Clock         | `toolbar.clock`        | To the start, Play (⌘P), Pause (⌘⇧P), Step (⌥⌘P), the time field, speed, loop           | UI8-05 |
| History       | `toolbar.history`      | Undo, Redo (a long press lists the last steps)                                          | UI6-14 |
| Agent         | `toolbar.agent`        | The permission mode of the active session; the state of the agent; a click opens Review | UI5-07 |
| Layout        | `toolbar.layout`       | The layout menu                                                                         | UI3-03 |

In play mode the Play button and the frames of the Scene and Game views take the play colour (orange today), and the
status bar says "Playing; edits are not saved".

### 7.2 The status bar

From left to right (`status.save`, `status.selection`, `status.jobs`, `status.problems`, `status.agent`,
`status.render`, `status.bell`): the save state of the scene (saved, unsaved, saving, error; a click saves), the selection count
(a click frames it), the jobs in progress (a click opens Jobs), the problem counts (Problems), the agent activity
("Claude: placing lamp (4/9)"; Agent), the backend, the tier and the frame rate (Performance), the notifications bell.

## 8. Search and ask

⌘K opens one box at the top of the window (UI3-07):

```text
┌ ⌘K ─────────────────────────────────────────────────────────────────────────┐
│ > lamp                                                                      │
│   ENTITIES     ☀ Floor lamp            scenes/main                          │
│   ASSETS       ▣ lamp_01               assets/sources/lamp_01.glb           │
│   COMMANDS     Create ▸ Point light                        Entity menu      │
│   SETTINGS     Scene view ▸ Light icons size                Preferences     │
│   DOCS         The light component                         formats.md       │
│   AGENT        ✦ Ask the agent: "lamp"                     ⌘↩               │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Words** narrow the providers: `>` commands, `@` entities, `#` assets, `/` recipes, `?` docs, `t:` kind, `c:`
  component, `tag:`, `in:` folder. ⌘O opens the box with the scene filter.
- **Ranking** puts recent and frequent items first; an exact command name wins.
- **Ask**: when the text reads as a sentence, the first item is "Ask the agent" (⌘↩ always asks). The question goes
  to the active session with the selection as context.
- **Actions on results**: ↩ runs or opens; ⌥↩ opens in a new panel; ⌘C copies the ID or path.
- The Search window (⌘⇧K, UI6-11) is the full form, with a table view and saved searches.

## 9. Interaction rules

### 9.1 Selection

- One selection for the whole window: the hierarchy, the views, the inspector, the timeline and the Review panel show
  the same entities. An asset in the Project window is a second, separate subject that the inspector shows when the
  Project window has the focus.
- Click selects; Shift adds a range (in lists) or adds (in views); ⌘ toggles; Esc clears; ⌘[ and ⌘] go back and
  forward in the selection history.
- A locked inspector or timeline keeps its subject while the selection changes.

### 9.2 Drag and drop

| Dragged \ onto   | Scene view                           | Hierarchy                 | Inspector field        | Project window     | Timeline         | Agent composer |
| ---------------- | ------------------------------------ | ------------------------- | ---------------------- | ------------------ | ---------------- | -------------- |
| A model asset    | A new entity at the surface point    | A new child of the row    | The asset reference    | Move to the folder | —                | A mention chip |
| A material       | Assign to the part under the pointer | —                         | The material reference | Move               | —                | A mention chip |
| A texture        | —                                    | —                         | A texture slot         | Move               | —                | A mention chip |
| A prefab         | An instance at the point             | An instance under the row | The reference          | Move               | —                | A mention chip |
| A clip           | Play it on the character under it    | —                         | `clipSource`           | Move               | An animation key | A mention chip |
| An audio asset   | A new audio source                   | —                         | The reference          | Move               | An audio key     | A mention chip |
| An entity (row)  | —                                    | Reparent or reorder       | An entity reference    | Make a prefab      | A track for it   | A mention chip |
| A file of the OS | Import, then place                   | Import, then add          | Import, then set       | Import into folder | —                | An attachment  |
| A scene file     | Open it                              | —                         | A scene reference      | Move               | —                | A mention chip |

- The spec ID of a cell is `drop.<dragged>.<target>`: the dragged items are `model`, `material`, `texture`, `prefab`,
  `clip`, `audio`, `entity`, `file`, `scene`; the targets are `view`, `hierarchy`, `field`, `project`, `timeline`,
  `composer`.
- While a drag is on, each target that takes the item shows a mark; a target that does not take it shows nothing.
- Esc cancels a drag. Each drop is one undo step.

### 9.3 Fields

- A number field takes a value, a sum (`2*0.5`, `+=0.1`) or a drag of its label (Shift ×10, Alt ×0.1).
- More than one entity selected: a field that differs shows "(mixed)"; an edit writes to each.
- A field driven by a track shows a key mark (UI8-03); a field changed by an agent change set shows the agent colour
  and its old value on hover (UI5-04); an override of a prefab instance is bold with a margin bar (UI7-07).
- ⌘Z in a field with the focus undoes the text of the field; Esc leaves the field and gives the old value back.

### 9.4 Undo

- One history per open scene, over every channel (scene, view, prefabs, sequence, materials, project settings).
- Every command is one step with a label and an actor. A drag is one step. A change set that the person accepts is one
  step. A turn of an agent can be undone with "Undo the turn" (documents and files, UI5-05).
- The History panel shows the steps; a click goes back to a step.

### 9.5 Dialogs and confirmation

- **No confirmation for what undo can fix** (delete an entity, a component, a key).
- **Confirm** before: a file delete on the disk (it goes to the trash where the system has one;
  `confirm.fileDelete`), a close with unsaved changes (`confirm.closeUnsaved`), a discard of a draft
  (`confirm.discardDraft`), a new baseline (`confirm.baseline`), a publish (`confirm.publish`), a run marked `confirm`
  after its dry run (`confirm.run`), the trust of a project (`confirm.trust`), the switch to Auto mode
  (`confirm.autoMode`), a commit (`confirm.commit`).
- A dialog says what happens, names the thing, and has the safe choice as the default button.
- Prompts for a name are in place (an inline field), not a dialog, where the place exists (a tree row, a tab).

### 9.6 Notifications

- A toast for a short fact (saved, imported, a job done). It never takes the focus and goes after 5 s.
- The bell keeps the facts that need an action (a failed job, an agent that waits, a background task done).
- A banner across the top of the dock for a state of the window: restricted mode, the host lost, a read-only role,
  play mode.

## 10. Keys

The key map is a `scenity.keymap/1` document per person (UI1-05); the Shortcuts window edits it. **Key sets** give the
defaults: Scenity (below), Unity, Blender. ⌘ is Ctrl on Linux and Windows.

| Keys                                   | Command                                                     | Context               | Command IDs                                                                                                |
| -------------------------------------- | ----------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| ⌘K, ⌘O, ⌘⇧K                            | Search and ask, open a scene, Search window                 | Global                | `search.open`, `scene.quickOpen`, `search.window`                                                          |
| ⌘L, ⌘I, ⌘T, ⌘.                         | Agent composer, ask about this, new session, stop the agent | Global                | `agent.composer`, `agent.inline`, `agent.newSession`, `agent.stop`                                         |
| ⌥⌘↩, ⌥⌘⌫                               | Accept all, reject all (the active change set)              | Global                | `changes.acceptAll`, `changes.rejectAll`                                                                   |
| ⌘N, ⌘S, ⌘⇧S, ⌥⌘S, ⌘W                   | New, save, save as, save all, close scene                   | Global                | `scene.new`, `file.save`, `scene.saveAs`, `file.saveAll`, `scene.close`                                    |
| ⌘Z, ⌘⇧Z                                | Undo, redo                                                  | Global                | `history.undo`, `history.redo`                                                                             |
| ⌘P, ⌘⇧P, ⌥⌘P                           | Play, pause, step                                           | Global                | `play.toggle`, `play.pause`, `play.step`                                                                   |
| ⌘1 to ⌘9, ⌘⇧C, ⌘⇧M, ⌘⇧H, ⌘⇧J, ⌘⇧G, ⌘⇧B | Panels (§5)                                                 | Global                | `panel.open.<panel ID>`                                                                                    |
| ⇧Space, ⌃Tab                           | Maximize the panel, next panel                              | Global                | `panel.maximize`, `panel.next`                                                                             |
| ?, F1                                  | Key sheet, help for this                                    | Global                | `help.keys`, `help.context`                                                                                |
| Q, W, E, R                             | View, move, turn, scale                                     | Scene view            | `gizmo.view`, `gizmo.move`, `gizmo.turn`, `gizmo.scale`                                                    |
| L, P                                   | World or local, pivot or centre                             | Scene view            | `gizmo.space`, `gizmo.pivot`                                                                               |
| F, ⇧F                                  | Frame, follow                                               | Scene view, hierarchy | `view.frame`, `view.follow`                                                                                |
| 1 to 9, 0                              | Document cameras, the editor camera                         | Scene view            | `camera.open1` to `camera.open9`, `camera.editor`                                                          |
| \`                                     | The overlay menu                                            | Scene view            | `overlay.menu`                                                                                             |
| X, Y, Z then a number                  | A typed value on one axis                                   | Scene view (gizmo)    | `gizmo.typeX`, `gizmo.typeY`, `gizmo.typeZ`                                                                |
| H, ⇧H, ⌥H                              | Hide, solo, show all                                        | Scene view, hierarchy | `entity.hide`, `entity.solo`, `view.showAll`                                                               |
| ⌘D, ⌫, ⌘C, ⌘V, F2, ⌘G                  | Duplicate, delete, copy, paste, rename, group               | Scene view, hierarchy | `entity.duplicate`, `entity.delete`, `entity.copy`, `entity.paste`, `entity.rename`, `entity.group`        |
| Space, comma, period, `[`, `]`, `\`    | Clock, steps, loop range                                    | Scene view, timeline  | `clock.toggle`, `clock.stepBack`, `clock.stepForward`, `clock.loopFrom`, `clock.loopTo`, `clock.loopClear` |
| K, M                                   | Add a key, add a marker                                     | Timeline              | `sequence.key.add`, `sequence.marker.add`                                                                  |
| Tab, ⇧Tab, arrows                      | Move between fields, tree rows, tiles                       | Every panel           | (focus, no command)                                                                                        |

The keys of a context act in the panel that has the focus. A held key (fly with W A S D) and the modal keys of the
gizmo are in the key map too (UI3-09).

## 11. The 14 key screens

These screens get mockups in UI0-09 and picture tests and axe checks in UI14-05:

1. The Hub with projects. 2. The new project wizard. 3. The first run. 4. The editor in the Layout workspace.
2. The agent panel during a turn. 6. The Review panel with a change set and ghosts. 7. Inspector v2 with prefab and
   agent marks. 8. The Project window. 9. The Timeline with the curve editor. 10. The import dialog and the asset
   inspector. 11. The rules editor. 12. The Build window with its report. 13. Project settings. 14. The Plugins window.

## 12. Project settings and Preferences

| Window           | Sections                                                                                                                                                                                                                                                                                         | Kept in                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Project settings | General (name, ID, units, scenes, sequences) · Assets (roots, build output, LODs, codecs) · Plugins · Rules · Quality · Build · Release · Editor (snaps, default workspaces) · Agents and runs (instructions, runs, gate, setup, denylist, content roots, credential file) · Surfaces (advanced) | `scenity.project.json`, `scenity.editor.json` (Git) |
| Preferences      | General (theme, language, recent count, autosave) · Scene view (camera speeds, grid, default view mode, icon size) · Keys · Agents (model, effort, default mode, budgets, notifications, external agents, the Blender tools) · Advanced (scene pool, cache folders, safe mode) · Doctor          | The user state of the host (UI1-05)                 |

Each field says where its value comes from (project, person, default) and has a reset. Both windows have a search
field. A change takes effect at once and is one undo step for project fields.

## 13. Window states

| State            | ID                 | What the person sees                                                                                       | Task    |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- | ------- |
| Restricted mode  | `state.restricted` | A banner "This project runs code. Trust it?" with Trust and Learn more; plugin parts show why they are off | UI1-12  |
| Prefab mode      | `state.prefab`     | A breadcrumb above the Scene view (Scene ▸ Door), the prefab colour on the view frame, "In context" switch | UI7-07  |
| Play mode        | `state.play`       | The play colour on the views and the Play button; a banner; Keep at Stop                                   | UI8-07  |
| The agent works  | `state.agentWorks` | Its colour on the entities it touches, its frustum, the status bar line; nothing moves the person's view   | UI5-09  |
| The host is lost | `state.hostLost`   | A banner with the reconnect state; edits stay in drafts; saves wait                                        | UI12-08 |
| A read-only role | `state.readOnly`   | A banner with the role; controls are off with the reason in the tooltip                                    | UI15-01 |
| Safe mode        | `state.safeMode`   | A banner "Plugins are off"; the plugin panels show their place holders                                     | UI13-06 |

## 14. Sizes and windows

- The editor window needs 1280×720 or more. Under it, the side docks fold to tabs on the edge (UI3-13).
- At 1280 pixels the whole toolbar shows. When the room gets less, the path of the file bar gets an ellipsis first
  (its tooltip gives the whole path), then the gizmo bar scrolls in its region. The scene tabs and Save stay.
- A project can open in more than one window (Window → New window). The windows share the selection, the dirty state
  and the agent sessions through the host (UI3-12).
- A panel can float in the page. A floating panel never leaves the browser window; the desktop shell (UI14-12) can
  later put it in a window of its own.
