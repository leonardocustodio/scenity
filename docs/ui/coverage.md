# Scenity Studio: the feature map

This page lists each feature of Scenity on 2026-10-17, where a person reaches it today, where it goes in the studio,
how an agent reaches it, and the task that does it ([plan.md](plan.md)). A feature with no place in the studio is a
gap in the plan: add a task for it.

**Today** says where the feature is now:

| Mark | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| Hub  | In the Hub of Scenity Studio (UI2, added after the start of the plan)   |
| UI   | In the scene page of the editor                                         |
| Part | In the scene page in part (plain fields, a dev panel, one case of many) |
| WB   | Only in the workbench page                                              |
| Lab  | Only in the lab page of a plugin                                        |
| URL  | Only as a parameter of the page address                                 |
| CLI  | Only as a `scenity` command                                             |
| File | Only by a change of a file in a text editor                             |
| API  | Only through the script API `__scenity`, a tool or code                 |
| None | Not possible today                                                      |

**Agent** names the way an agent does it in the studio: a command through `scene_command` (UI4-05), a job through
`job_run` (UI4-05), a named tool, or "UI" when only the UI tools of UI4-06 apply.

## Projects and the start

| Feature                                                   | Today    | In the studio                                             | Agent           | Task           |
| --------------------------------------------------------- | -------- | --------------------------------------------------------- | --------------- | -------------- |
| Make a project from a template (`empty`, `showroom`)      | Hub, CLI | Hub → New project, the template gallery                   | job `create`    | UI2-03         |
| Make a project from a sentence                            | None     | Hub → "Describe what you want to make"                    | agent session   | UI2-04         |
| Open a project folder                                     | Hub, CLI | Hub → Open, the folder dialog, a folder drop, a Git clone | `projects.open` | UI2-05, UI1-07 |
| Recent and pinned projects                                | Hub      | Hub project list                                          | `projects.list` | UI2-02         |
| Many projects in one server (`SCENITY_SCENE_PROJECTS`)    | URL      | One host, a window or tab per project                     | —               | UI1-11         |
| The samples                                               | Hub      | Hub → Learn, opened as copies                             | job `create`    | UI2-06         |
| A folder with no project file                             | Hub      | "Make this folder a project"                              | `projects.make` | UI1-06         |
| Project trust before plugin code runs                     | Hub      | The trust prompt and restricted mode                      | —               | UI1-12         |
| The tools of the machine (Bun, Blender, Chromium, WebGPU) | Hub      | The doctor in the Hub and in Help                         | `studio_state`  | UI1-10         |
| Agent credentials (login, API key in `.env`)              | WB, File | First run, Preferences → Agents                           | —               | UI2-07         |
| Templates of the person and of plugins                    | None     | The template registry; "Save as a template"               | —               | UI2-09         |

## Project settings (`scenity.project.json`)

| Feature                                                        | Today | In the studio                          | Agent         | Task             |
| -------------------------------------------------------------- | ----- | -------------------------------------- | ------------- | ---------------- |
| Name, ID, scenes and sequences lists                           | File  | Project settings → General             | `project.set` | UI12-01          |
| Asset roots                                                    | File  | Project settings → Assets              | `project.set` | UI12-01          |
| Plugins list                                                   | File  | Plugins window                         | `project.set` | UI13-04          |
| Project rules and rules files                                  | File  | Rules editor, Project settings → Rules | commands      | UI10-01          |
| Units                                                          | File  | Project settings → General             | `project.set` | UI12-01          |
| Quality tiers and budgets                                      | File  | Budgets editor                         | `project.set` | UI10-08          |
| Build output, LODs, codecs, entry budgets                      | File  | Build window, budgets editor           | `project.set` | UI11-01, UI10-08 |
| Release: licences, rights review, deny tags, approvals         | File  | Rights and licences, approvals         | `project.set` | UI9-06, UI9-07   |
| Workbench: surfaces, runs, gate, setup, roots, denylist, theme | File  | Project settings → Agents and runs     | `project.set` | UI12-06, UI12-01 |
| Project snaps (`scenity.editor.json`)                          | UI    | Project settings → Editor              | `project.set` | UI12-01          |

## Scenes and sessions

| Feature                                                            | Today | In the studio                       | Agent              | Task           |
| ------------------------------------------------------------------ | ----- | ----------------------------------- | ------------------ | -------------- |
| Open, new, save, save as, close a scene                            | UI    | Scene tabs, the File menu, dialogs  | `scene.*` commands | UI6-13, UI4-03 |
| The start screen of the scenes                                     | UI    | The Scenes panel                    | `studio_state`     | UI6-13         |
| Drafts of unsaved edits                                            | UI    | Recovery dialog; drafts in the host | —                  | UI12-08        |
| A file changed on the disk (Reload, Overwrite)                     | UI    | A dialog with the semantic diff     | —                  | UI6-14         |
| Environment: background, tone mapping, exposure, map, fog, effects | Part  | The Lighting window and its widgets | `component.set`    | UI7-05, UI7-02 |
| Scene variants (override layers)                                   | File  | The Variants panel                  | commands           | UI7-10         |
| Scene poster                                                       | File  | A shot as the poster                | job `shot`         | UI11-03        |
| Older document formats                                             | API   | An upgrade with its diff            | —                  | UI12-09        |

## Entities and the hierarchy

| Feature                                                           | Today | In the studio                   | Agent                    | Task           |
| ----------------------------------------------------------------- | ----- | ------------------------------- | ------------------------ | -------------- |
| Tree, select, reparent, reorder, rename, hide, solo, lock, search | UI    | Hierarchy v2                    | `entity.*` commands      | UI6-05         |
| Add an empty entity, duplicate, delete, copy, paste               | UI    | Hierarchy, the Entity menu      | `entity.*` commands      | UI6-05, UI4-03 |
| Add a shape, light, camera or another preset                      | None  | The create menu                 | `entity.create.<preset>` | UI7-01         |
| Tags                                                              | Part  | Tags list, the inspector header | commands                 | UI7-13, UI6-06 |
| Select by tag, component or kind; selection history               | Part  | Selection tools                 | commands                 | UI6-12         |
| Copy and paste across scenes and projects                         | Part  | Selection tools                 | commands                 | UI6-12         |
| Notes on entities                                                 | Part  | Note pins; notes as agent tasks | `note.*` commands        | UI7-14, UI5-14 |
| Presets of the person                                             | None  | "Save as a preset"              | commands                 | UI7-15         |

## Components

| Component or feature                          | Today | In the studio                                     | Agent           | Task                               |
| --------------------------------------------- | ----- | ------------------------------------------------- | --------------- | ---------------------------------- |
| Add, remove and reset a component             | Part  | Inspector v2 (commands, not raw ops)              | `component.*`   | UI4-02, UI6-06                     |
| `transform`                                   | UI    | Inspector v2, gizmos                              | `entity.move` … | UI6-06                             |
| `model` (asset, overrides, shadows, LOD)      | Part  | Model widgets, material picks in the view         | `component.set` | UI7-04                             |
| `shape`                                       | UI    | Presets, inspector                                | `component.set` | UI7-01                             |
| `light` (five kinds, shadow camera)           | Part  | Presets, handles, `shadowCamera` widget           | `component.set` | UI7-01, UI7-03, UI7-06             |
| `camera` (fov, target, safe frame)            | Part  | Presets, "camera from the view", handles, widgets | `component.set` | UI7-01, UI7-03, UI7-06             |
| `socket`                                      | Part  | Socket handles                                    | `component.set` | UI7-06                             |
| `visibility`                                  | UI    | Inspector header, hierarchy eye                   | `entity.hide`   | UI6-06                             |
| `pickable` and its layers                     | Part  | Tags and pick layers                              | `component.set` | UI7-13                             |
| `obstacle`                                    | Part  | Footprint handle                                  | `component.set` | UI7-06                             |
| `standPoint`                                  | Part  | Stand point handle with facing                    | `component.set` | UI7-06                             |
| `path`                                        | Part  | Path point handles (add, move, delete)            | `component.set` | UI7-06                             |
| `annotation`                                  | Part  | Note pins                                         | `component.set` | UI7-14                             |
| `prefab`                                      | UI    | Prefabs v2                                        | `prefab.*`      | UI7-07                             |
| `animator`                                    | Part  | The Animator window                               | `component.set` | UI8-09                             |
| `character`                                   | Part  | Character setup                                   | `component.set` | UI8-10                             |
| `locomotion`                                  | Part  | The walk route editor                             | `component.set` | UI8-11                             |
| `audioSource`                                 | Part  | Audio preview, range handle                       | `component.set` | UI8-13                             |
| The 17 `custom` hints (plain fields today)    | Part  | Special widgets                                   | `component.set` | UI7-02 to UI7-04, UI8-09 to UI8-11 |
| Plugin components (inspector from the schema) | UI    | Inspector v2, plugin widgets and icons            | `component.set` | UI13-02                            |

## Gizmos, the views and the render options

| Feature                                                      | Today | In the studio                             | Agent           | Task            |
| ------------------------------------------------------------ | ----- | ----------------------------------------- | --------------- | --------------- |
| Move, turn and scale; world or local; pivot or centre; snaps | UI    | The toolbar and the Tools overlay         | `entity.move` … | UI3-05, UI6-01  |
| Surface and socket snap; typed values                        | UI    | The Grid and snap overlay                 | commands        | UI6-01          |
| Orbit, pan, fly, frame                                       | UI    | Scene view                                | `ui_reveal`     | UI6-01          |
| Axis views, orthographic                                     | None  | The orientation gizmo                     | `ui_reveal`     | UI6-02          |
| Document cameras 1 to 9 and the camera preview               | UI    | The Cameras overlay                       | `scene_frame`   | UI6-01          |
| Lit, Unlit, Wireframe, Normals; the grid                     | UI    | The View options overlay                  | UI              | UI6-01          |
| More than one view                                           | None  | Split views                               | —               | UI6-03          |
| The view through a document camera at a resolution           | Part  | The Game view                             | `scene_frame`   | UI6-04          |
| Tier, backend, worker, source assets (`tier=` and others)    | URL   | Game view switches, the Performance panel | UI              | UI6-04, UI10-06 |
| Debug layers (`debug=`)                                      | Part  | The View options overlay                  | UI              | UI10-09         |
| The inspect report (totals, per entity)                      | Part  | The Performance panel                     | `scene_query`   | UI10-06         |
| Frame statistics (`stats()`)                                 | API   | The Stats overlay, the Performance panel  | `studio_state`  | UI10-06         |
| Onion skins and ghosts                                       | Lab   | Scene view                                | UI              | UI8-06          |
| The editor camera speeds                                     | UI    | Preferences                               | —               | UI12-02         |

## Prefabs and materials

| Feature                                       | Today | In the studio                                  | Agent            | Task   |
| --------------------------------------------- | ----- | ---------------------------------------------- | ---------------- | ------ |
| Open a prefab, back to the scene              | UI    | Prefab mode with a breadcrumb and "in context" | `prefab.open`    | UI7-07 |
| Apply and revert overrides                    | UI    | The overrides list, marks in the inspector     | `prefab.apply` … | UI7-07 |
| Make a prefab from the selection              | None  | Menu, or a drag to the Project window          | `prefab.create`  | UI7-07 |
| Edits inside an instance (rename, hide, move) | None  | Edits become overrides                         | commands         | UI7-07 |
| Prefab variants and nested prefabs            | None  | (needs a format change)                        | commands         | UI7-08 |
| The material editor (type, values, maps)      | UI    | Material editor v2 with a preview object       | `material.*`     | UI7-09 |
| New material; assign to a part                | UI    | Drop on a mesh part in the view                | `material.*`     | UI7-09 |

## Assets

| Feature                                                  | Today     | In the studio                          | Agent                      | Task           |
| -------------------------------------------------------- | --------- | -------------------------------------- | -------------------------- | -------------- |
| The asset browser (tiles, search, filters, Used by)      | UI        | The Project window                     | `asset_search`             | UI6-07         |
| Import by button, by drop, a model dropped on the view   | UI        | The import dialog and queue            | `asset_import`             | UI9-01, UI9-02 |
| Importer settings (scale, up, origin, decimate, rig)     | File, CLI | The import dialog, the asset inspector | `asset_import`             | UI9-01, UI9-03 |
| The rights record at import                              | File, CLI | The import dialog                      | `asset_import`             | UI9-01         |
| Asset record fields (kind, tags, rig, build)             | File      | The asset inspector                    | commands                   | UI9-03         |
| Previews of models, textures, skies, audio and materials | Part      | The asset inspector                    | `scene_frame`              | UI9-03         |
| Stills                                                   | CLI       | The stills job, stale marks            | job `assets stills`        | UI9-04         |
| The asset build (LODs, KTX2, meshopt, manifest)          | CLI       | The asset build panel                  | job `assets build`         | UI9-05         |
| Rights records                                           | File      | The rights form                        | commands                   | UI9-06         |
| The licence policy of the project                        | File      | Rights and licences → policy           | `project.set`              | UI9-06         |
| Approvals                                                | File      | The approvals queue                    | commands                   | UI9-07         |
| The release check                                        | CLI       | The release check panel                | job `assets release-check` | UI9-08         |
| Asset index, missing references, Used by, a new ID       | CLI, Part | Problems, the asset tools              | job `assets …`             | UI9-09         |
| Export a scene as GLB                                    | CLI       | The export job                         | job `assets export`        | UI9-12         |
| Hot reload of a changed source                           | UI        | A toast and the swap                   | —                          | UI9-13         |
| Asset sources (Poly Haven and others)                    | None      | Asset sources                          | `asset_source_*`           | UI9-10         |
| Generated assets                                         | None      | Asset sources of kind "generate"       | `asset_source_*`           | UI9-11         |

## Time, animation and play

| Feature                                                       | Today      | In the studio                           | Agent              | Task           |
| ------------------------------------------------------------- | ---------- | --------------------------------------- | ------------------ | -------------- |
| Tracks, keys, markers, curves, record, the loop range         | UI         | The Timeline v2, the curve editor       | `sequence.*`       | UI8-01, UI8-02 |
| Choose a sequence (`sequence=`)                               | URL        | The sequence picker of the Timeline     | `sequence.open`    | UI8-01         |
| New sequence, duration, loop, `initial`                       | File       | The Timeline                            | `sequence.new` …   | UI8-01         |
| Track kinds `animation`, `camera`, `audio`, `event`, `action` | Part       | The Timeline v2 with forms from schemas | `sequence.*`       | UI8-01         |
| Keys from the inspector                                       | Part       | Key marks beside fields                 | `sequence.key.add` | UI8-03         |
| Agent edits of a sequence under review                        | None       | Sequence change sets                    | `sequence.*`       | UI8-04         |
| The clock (`t=`, `paused=1`, Space, steps)                    | UI, URL    | The clock in the toolbar                | `scene_frame`      | UI8-05         |
| Play, Stop, Keep, Replay, Play in a window                    | UI         | Play mode v2 and the Game view          | `play.*`           | UI8-07         |
| Input recordings                                              | Part       | The recordings list                     | `play.*`           | UI8-07         |
| Streams and live sources                                      | API        | Streams and simulations                 | commands           | UI8-08         |
| The simulation state at a time                                | API        | The simulation watch                    | `scene_query`      | UI8-08         |
| The animator state machine                                    | Part       | The Animator window                     | `component.set`    | UI8-09         |
| Rig profiles, retarget, look variants, IK goals, foot lock    | Part, File | Character setup                         | `component.set`    | UI8-10         |
| Walks                                                         | Part       | The walk route editor                   | `component.set`    | UI8-11         |
| The clips of a model                                          | None       | The clip browser                        | `asset_search`     | UI8-12         |
| Audio preview and audio keys                                  | Part       | Audio in the inspector and the Timeline | commands           | UI8-13         |

## Rules, checks, quality and performance

| Feature                                                          | Today    | In the studio                        | Agent              | Task    |
| ---------------------------------------------------------------- | -------- | ------------------------------------ | ------------------ | ------- |
| The Rules panel (results, graph, filters, seek)                  | UI       | The Rules panel v2                   | `scene_check`      | UI10-04 |
| Make and edit rules                                              | File     | The rules editor                     | `rule.*` commands  | UI10-01 |
| A rule from a measure                                            | None     | "Save as a rule"                     | `rule.*` commands  | UI10-02 |
| The save gate with a reason; the rules log                       | UI, File | A gate dialog; the rules log view    | —                  | UI10-04 |
| Plugin metrics in the editor                                     | None     | Loaded from the dev faces            | `scene_check`      | UI10-03 |
| Layout tools (measure, reach, clearance, walk paths, visibility) | UI       | Layout tools v2 in the Tools overlay | `scene_measure`    | UI7-11  |
| Placement by relation; find an empty space                       | None     | Placement helpers                    | `place.*` commands | UI7-12  |
| Layout search                                                    | API      | Layout search                        | commands           | UI10-10 |
| `scenity check`                                                  | CLI      | The check job, results in Problems   | `scene_check`      | UI10-05 |
| One list of problems (rules, assets, rights, schemas, plugins)   | None     | The Problems panel                   | `studio_state`     | UI6-09  |
| Logs of the page, worker, server, host and plugins               | Part     | The Console                          | `studio_console`   | UI6-08  |
| Quality budgets                                                  | File     | The budgets editor                   | `project.set`      | UI10-08 |
| `scenity bench`                                                  | CLI      | The bench runner                     | job `bench`        | UI10-07 |
| The frame index and the Picker                                   | WB       | The frame index browser              | `index_*`          | UI10-11 |

## Build, ship and visual tests

| Feature                                            | Today | In the studio                         | Agent              | Task    |
| -------------------------------------------------- | ----- | ------------------------------------- | ------------------ | ------- |
| `scenity build` (site, entry budgets, marker gate) | CLI   | The Build window                      | job `build`        | UI11-01 |
| The built player and its embed code                | File  | Player preview and the embed snippet  | job `build`        | UI11-02 |
| `scenity shot` and compare                         | CLI   | The shot dialog                       | job `shot`         | UI11-03 |
| Baselines and `scenity verify`                     | CLI   | The baselines list and the verify job | job `verify`       | UI11-03 |
| `scenity sheet`                                    | CLI   | The render queue                      | `scene_sheet`, job | UI11-04 |
| `scenity clip`                                     | CLI   | The render queue                      | job `clip`         | UI11-04 |
| `scenity pool`                                     | CLI   | Preferences → Advanced                | job `pool`         | UI11-06 |
| Publish (a zip, hosting targets)                   | None  | Publish                               | job `publish`      | UI11-05 |

## Plugins

| Feature                                          | Today | In the studio                               | Agent            | Task             |
| ------------------------------------------------ | ----- | ------------------------------------------- | ---------------- | ---------------- |
| The plugins of a project; add and remove         | File  | The Plugins window                          | `project.set`    | UI13-04          |
| Make a plugin                                    | None  | The plugin wizard                           | agent session    | UI13-05          |
| UI parts of plugins in the scene editor          | None  | The studio face and its contribution points | —                | UI13-01, UI13-02 |
| Tools of host faces                              | WB    | The search box and the agent catalogue      | the plugin tools | UI13-10          |
| Commands of CLI faces                            | CLI   | The search box and the Jobs panel           | job              | UI13-10          |
| The editor face of the lab page (`EditorPlugin`) | Lab   | A studio workspace                          | the page tools   | UI13-07          |
| Plugin errors and safe mode                      | Part  | Console, Problems, safe mode                | `studio_console` | UI13-06          |

## Agents and the workbench

| Feature                                                      | Today    | In the studio                                 | Agent                | Task             |
| ------------------------------------------------------------ | -------- | --------------------------------------------- | -------------------- | ---------------- |
| The chat with Claude (Ask, Edits, All)                       | WB       | The agent panel with Ask, Review and Auto     | —                    | UI5-01, UI5-07   |
| The Claude Code terminal and a shell                         | WB       | The terminal panel                            | —                    | UI5-16           |
| The context packet                                           | WB       | Context chips that the person sees            | `studio_state`       | UI5-02           |
| Proposals with Accept and Reject                             | UI       | Change sets, the Review panel, marks in place | `scene_command`      | UI5-04           |
| The switch to apply at once                                  | API      | The permission mode in the composer           | —                    | UI5-07           |
| Frames before and after a turn; keep or undo a turn          | WB       | The turn record and checkpoints               | `workbench_after`    | UI5-05, UI5-06   |
| Approval and question cards                                  | WB       | Cards in the agent panel                      | —                    | UI5-11           |
| Changes, diffs and commits                                   | WB       | The version control panel, semantic diffs     | —                    | UI12-04, UI12-05 |
| Runs, presets and the stop gate                              | WB, File | The Jobs panel, the runs form                 | `workbench_run`, job | UI12-06, UI12-07 |
| Background runs (loops), review packs, the experiment log    | WB       | The Tasks panel                               | —                    | UI5-19           |
| Parallel agents and variants                                 | None     | Parallel agents and the variants grid         | —                    | UI5-20           |
| The Picker                                                   | WB       | The frame index browser                       | `index_*`            | UI10-11          |
| External agents (Claude Code, Codex, Cursor, Claude Desktop) | None     | `scenity mcp` and the connection setup        | all tools            | UI5-15           |
| Project instructions and skills                              | File     | The instructions panel                        | —                    | UI5-12           |
| Recipes (saved prompts)                                      | None     | Recipes in the search box and menus           | —                    | UI5-13           |
| The Blender MCP option                                       | WB       | Preferences → Agents                          | the Blender tools    | UI12-02          |
| Cost and budgets                                             | WB       | The cost meter, budgets                       | —                    | UI5-17           |
| Roles and remote mode                                        | WB, File | The studio in remote mode; review links       | —                    | UI15-01, UI15-02 |

## Settings, keys, language and theme

| Feature                                      | Today | In the studio                         | Agent      | Task    |
| -------------------------------------------- | ----- | ------------------------------------- | ---------- | ------- |
| Personal settings (view, grid, speeds, dock) | UI    | Preferences                           | `ui_state` | UI12-02 |
| The key map                                  | UI    | The Shortcuts window                  | —          | UI12-03 |
| The page layout and its reset                | UI    | Layouts and workspaces                | `ui_state` | UI3-03  |
| Theme                                        | UI    | Preferences, the search box           | —          | UI3-10  |
| Language and the pseudo-locale (`locale=`)   | URL   | Preferences → Language                | —          | UI14-06 |
| The script API `__scenity`                   | API   | Stays for tests; agents use the tools | all tools  | UI4-05  |

## The count

At the start of the plan (2026-10-17), 86 of the 164 rows above had a place in a UI (the marks UI, Part, WB or Lab);
78 rows were reachable only through a URL, the CLI, a file, code or not at all. The plan gives each of the 164 rows a
place in the studio. A done task changes the "Today" mark of its rows: after UI2 (the Hub), 93 rows have a place in a
UI (the mark Hub counts too).
