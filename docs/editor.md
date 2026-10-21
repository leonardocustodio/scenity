# The editor

The editor is the window of a project in Scenity Studio. It edits the documents of one project: scenes, prefabs,
materials and sequences. Each action is a command with one step in one undo history, and each change goes to the
runtime as a small patch. Nothing goes to the disk until you save.

## Open it

Start the studio with `scenity studio` and open the project in the Hub ([studio.md](studio.md)), or open it at once
with `scenity studio --project my-project`. In the checkout, `bun run dev:studio` starts the studio.

`scenity dev` still serves the editor page of one project with no Hub (for scripts and tests): it prints the address
of the first scene (with `edit=1`) and of the start screen. The page address takes these values:

| Parameter                       | What it does                                                      | The control in the editor                  |
| ------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| `project=<id>`                  | The project (the dev server knows it)                             | The Hub                                    |
| `scene=<path>`                  | The scene file; a `*.prefab.json` path opens the prefab mode      | The scene tabs, the Scenes panel           |
| `edit=1`                        | The editor. Without it the page only draws the scene              | —                                          |
| `sequence=<path>`               | The sequence to play (default: the first sequence of the project) | Sequence ▸ Open sequence                   |
| `camera=<name>`                 | A document camera                                                 | The Cameras overlay, the Game view         |
| `t=<ms>`, `paused=1`            | The start time of the clock; stand at that time                   | The clock of the toolbar                   |
| `worker=0`                      | Draw on the main thread, not in the worker                        | Preferences ▸ Render worker; the Game view |
| `backend=webgl` or `webgpu`     | Force a backend (WebGPU draws on the main thread)                 | Preferences ▸ Backend; the Game view       |
| `tier=ultra\|high\|medium\|low` | The quality tier (default high)                                   | Preferences ▸ Quality tier; the Game view  |
| `assets=source`                 | Load the source files, not the build                              | Preferences ▸ Assets                       |
| `gpu=1`                         | The GPU timer of the frame statistics                             | Preferences ▸ GPU timer                    |
| `audio=0`                       | No sound                                                          | Preferences ▸ Audio                        |
| `debug=bounds,skeleton`         | Debug layers; `inspect=1` (or I) opens the inspect panel          | The inspect panel (I)                      |
| `locale=pseudo`                 | Pseudo texts, to find text that is not translated                 | Preferences ▸ General                      |

A parameter of the address wins over Preferences; the render settings of Preferences act at the next open of the
editor.

## The layout

```text
┌ Window · file bar: scenes · dirty state · Save · Play / Stop / Keep ── gizmo bar: Move Turn Scale · World/Local · snaps ┐
├ Hierarchy ────────┬ Scene: the canvas, the gizmos, the camera menu, the view menu, the layout tools ┬ Inspector ─────┤
├───────────────────┴───────────────────────────────────────────────────────────────────────────────┴────────────────┤
└ Project · Timeline · Rules · Material · Preferences ────────────────────────────────────────────────────────────────┘
```

The title bar has the **menu bar**: File, Edit, Assets, Entity, Component, Sequence, Agent, Build, Window and Help. The menus come from the commands of the editor: each entry shows its keys, and an entry that
cannot run now is off and says why in its tooltip. A menu with no command yet does not show.

**Search and ask** (⌘K) is one box for the commands, the entities of the scene, the scene files, the assets, the
settings and the docs. A word at the start narrows it: `>` commands, `@` entities, `#` assets, `?` docs; `c:light`
keeps the entities with a light, `t:model`, `tag:wood` and `in:sources` narrow the assets. ↑ and ↓ choose, ↩ runs
or opens (an entity is selected and framed; an asset shows in the Project panel; a setting opens Preferences at its
field; a heading of the docs opens on GitHub), ⌘C copies the ID or the path. ⌘O opens the box with `@`. A text that
reads as a sentence gives "Ask the agent" first (⌘↩); the agent of the window comes with the Agent panel. ⌥↩ opens the
text in the Search window.

The **Search window** (⌘⇧K, Window ▸ Search) is the full form of the box, as a panel. The entities that match show as
a table. `t:` keeps a kind of entity (`model`, `light`, `camera`, `sound`, `note`), and `c:`, `tag:` and `name:`
work as in the hierarchy. A comparison of a field with a value (`intensity>2`, `light.range<=4`, `castShadow=true`,
with `>`, `<`, `>=`, `<=`, `=` and `!=`) keeps the entities that meet it and adds a column for the field. Each cell
edits its value, and each edit is one undo step. `c:` with the exact ID of a component and no comparison gives a
column for each plain value of the component. For example, `c:light intensity>2` lists the lights brighter than 2,
with an intensity column. Select all selects the rows. The other kinds (assets, files, commands, settings, docs) show
as lists under the table, and the menu keeps one kind. Save keeps the text in the saved searches of the project (the
storage of the browser keeps them); a press on a saved search runs it again.

The title of the window is `scene · project · Scenity`, with `*` first (and a dot on the icon of the tab) while the
scene has changes that are not saved. In Scenity Studio the windows of a scene share each change, the selection and
the saves.

The editor window is a dock. Each part is a panel with a tab: drag a tab to another place or
onto a side of a group, drag the edge between groups to change their size, close a panel with its ×. The **Window**
menu opens each panel, and acts on the active panel: maximize (⇧Space), float or dock, move to the left, the centre,
the right or the bottom, close, the next panel (F6). ⌘3 to ⌘6 and ⌘, open the Inspector, the Hierarchy, the
Project, the Timeline and the Preferences.

A window under 1280×720 folds the left and the right panels to a rail of tabs on each edge. A press on a rail tab shows
its side with the panel (one side at a time); a second press, or a press in the Scene view or the bottom area, folds it
again. A key or the Window menu that opens a panel of a folded side shows that side. The layout that the editor keeps
has no fold: a larger window shows each side again.

The **status bar** at the bottom shows the state of the scene file (a press saves), the selection (a press frames it),
the failed rules and warnings of the project (a press opens the Rules panel), the backend, the tier and the frame rate
(a press opens the inspect panel), and the bell of the facts that need an action. A question of the editor (a local
draft to restore, a file that changed on the disk, a reason for a save that a rule stops, a close with unsaved changes)
is a dialog with the safe choice first; a short fact (a save) is a toast; a state of the window (the play mode, a
project in restricted mode with **Trust this project…**) is a banner above the dock. The browser asks before it closes
a window with unsaved changes.

The tabs at the top are the **workspaces**: Layout (the default), Animate, Assets, Review and Build. Each one opens its
panels in its own layout and keeps its changes at once. The **Layout** menu has **Save as…** (a workspace of yours
with a name), **Rename…** and **Delete** (for your workspaces), and **Reset** (the default layout of the workspace).
The workspaces stay in the browser and, in Scenity Studio, in your user state on the studio host, so they follow you
to another browser. A project can name the workspace that a new person opens it with: `layout.workspace` in
`scenity.editor.json`. The settings `dock.tab` and `dock.height` give the panel that shows in the bottom area of a new
layout and its height.

## The panels

Each panel opens from the Window menu, from the search box (`panel.open.<id>`) and with its keys. F1 on a panel opens its
part of this page.

### Scene view

The scene through the editor camera, with the gizmos, the overlays (Tools, View options, Stats) and the drag of
entities. [The viewport](#the-viewport) and [Gizmos](#gizmos) give the details.

### Game view

The scene through a document camera in the player path (⌘2): a camera, a size, the tier, the backend and the stats of
the player.

### Hierarchy panel

The tree of the entities of the open scene: select, rename, move by drag, hide and lock. [The hierarchy](#the-hierarchy)
gives the details.

### Inspector panel

The components of the selected entities with a field for each value. [The inspector](#the-inspector) gives the details.

### Notes panel

The notes of the scene: pins on entities and places, with a text and a state.

### Tags panel

Each tag and pick layer of the scene with the count of its entities; a press selects them, Rename changes the name on
each entity.

### Scenes panel

The scenes and the sequences of the project: open, make, rename, and the recent scenes.

### Project panel

The files and the assets of the project: import, the import queue, stills, the asset inspector. [Assets](#assets) gives
the details.

### Timeline panel

The sequence of the scene: tracks, keys, markers and the clock. [The sequencer](#the-sequencer) gives the details.

### Rules panel

The rules of the scene and of the project with their state now, the rules editor and the log of overrides.
[Rules](#rules) gives the details.

### Material panel

The material of the selected entity or asset, with a preview. [Materials](#materials) gives the details.

### Lighting panel

The environment, the sky, the lights and the effects of the scene. [Lighting](#lighting) gives the details.

### Variants panel

The override layers of the scene and the compare wipe. [Variants](#variants) gives the details.

### Character panel

The setup of a character: the rig, the sockets and the clips.

### Animator panel

The states, the transitions and the parameters of the animator of the selected entity.

### Clips panel

The clips of the model of the selected entity and of the clip source of its animator, with the length of each clip.
Drag a clip onto the Timeline to add an animation key at the time of the drop (the key goes on the animation track of
the entity; with no such track, a new track starts with it), or press **Add at the playhead**. A clip dropped on a character in the Scene view goes on the animation track of that
character at the time of the clock (a clip of another model plays retargeted). **Preview** plays the
clip on the entity in the Scene view at the time of the clock, with no change of the sequence. The Timeline and the
preview need an open sequence. A clip of another asset than the model of the entity plays retargeted through the rig
profiles.

### Simulation panel

The simulations of the plugins: their actions, their state and their recordings.

### Build panel

The build of the project: the output folder, the report with the size of each entry against its budget, the marker gate
and Publish.

### Embed panel

The player options, the built player in a frame and the snippet for a web page.

### Baselines panel

The shots of a scene, the baselines of the project and the verify run.

### Render queue panel

The contact sheets and the clips of a sequence, one job at a time, and the gallery of the outputs.

### Frame index panel

The frames of the project by sequence, camera and time: a row for each document camera and a column for 0 ms and
each marker and key time of a sequence (◆). **Index the project** runs `scenity frames`, which draws only the frames
with no picture into `.scenity/frames/`. A frame whose documents, assets or plugin code changed after its picture has
a **stale** mark. Press a frame to see it large; press a second one to compare the two side by side. **Before**
compares a frame with its picture before the last change.

### Performance panel

The frame statistics of the core and the cost of each entity.

### Bench panel

The bench runs of the project, their budget rows and the trend of the values.

### Budgets panel

The quality budgets of the project beside the values of the last bench.

### Asset build panel

The build of the assets of the project: the state of each asset and the settings of the build.

### Rights panel

The licences and the rights records of the assets.

### Approvals panel

The approvals that the release of the project needs, by role.

### Release panel

The release check of the assets with a fix for each finding.

### Export panel

The export of a scene as a GLB file with the checks of the glTF validator.

### Activity panel

The edits, the saves and the turns of the agents in time order.

### Console panel

The log of the page, the worker, the server, the plugins, the jobs and the agent tools.

### Problems panel

The problems of the rules, the assets, the rights, the components and the plugins, with Go to and the fixes.

### Search panel

The search of the entities, the components, the commands and the docs.

### History panel

The undo history of the scene, with a jump to a step.

### Review panel

The change sets of the agents: accept or reject each change.

### Plugins panel

The plugins of the project with their faces, Add and Remove, and the new plugin wizard. [Plugins](plugins.md) gives the
details.

### Jobs panel

The jobs of the dev server and of the studio with their logs and outputs, Stop and Run again, the runs of the project
and the commands of the plugins.

### Version control panel

The changed files of the project with the semantic diff of each document, the commit of the picked files, the branches
and the worktrees.

### Instructions panel

The instructions of the project for the agents (AGENTS.md, CLAUDE.md and the skills).

### Tasks panel

The background tasks of the agents with their state and their results.

### Terminal panel

The terminals of the project in the studio: Claude Code and a shell.

### Agent panel

The sessions of the agents with the transcript, the composer and the cost.

### Project settings panel

Each field of `scenity.project.json` as a form, in sections, with a search and the checks of each field.

### Shortcuts panel

The key map on a keyboard picture: pick a command, press a key; the clashes, import and export.

### Preferences panel

The editor settings, the theme, the layout, the scene pool and the preferences of the studio. [Settings and
keys](#settings-and-keys) gives the details.

## The start screen and the scenes

The address with `edit=1` and no `scene=` opens the start screen: the scenes of the project with their pictures, the
recent scenes, **New scene** and **Open a path**. In the editor the open scenes are tabs in the file bar: a tab shows
a dot for unsaved changes, a click switches to it, × (or Delete on the tab) closes it (with the question about unsaved
changes), and the arrow keys move between the tabs. **+** asks for the name of a new scene, and **⋯** has Open a path, Save as and the
**Scenes** panel: the start screen in the dock (the scenes with their pictures, the open ones, the recent ones, New
scene). File has Open, New scene, Save as and Close too.

The **Problems** panel (⌘⇧M; a press on the problems of the status bar opens it too) lists what is wrong now: the
failed rules, the budgets over their limit, the assets that the scene uses and the project does not have, the assets
whose rights stop a release, the components that no plugin gives, the values that fail their schema, the errors of
plugin code, and the assets with no build. The errors come first. **Go to** selects the entities of a problem (and
seeks to the worst time of a rule), a problem can have its own fix (Remove the component), and in the studio **Ask the
agent to fix** sends it to the agent panel.

The **Console** panel (⌘⇧C) has the lines of the page, the scene worker, the dev server, the plugins, the failed jobs
of the studio and the errors of the agent tools. A line that comes again shows once with its count. The counters of
errors, warnings and messages are filters; a menu keeps one source and a search keeps the lines with its words. A
click shows the whole line in the detail pane and selects the entity that it names (`entity:<id>`), or opens the
scene file that it names.

Each open scene keeps its own undo history. A switch parks the scene that you leave and brings the other one back. The
**History** panel (⌘⇧H) lists the steps of the undo history with who made each one (you, an agent session in its
colour, a script); the steps of one agent turn are a group. A click on a step goes to it in one action, and one redo
(⇧⌘Z) takes that action back. Undo and Redo are in the toolbar too: their tooltips name the step, and a long press opens
the History panel.
**New scene** writes an empty scene file (never over a file) and adds its path to the project file. **Save as** writes
the scene to a new path.

## The hierarchy

The left panel shows the entity tree.

- Click selects; Shift and ⌘ (Ctrl) add to the selection. The selection is the same in the view and the inspector.
- Drag a row onto another row to change its parent, or between rows to change the order. The world place stays.
- Double-click or F2 renames.
- The eye hides an entity (saved in the scene). Solo shows only some entities, and lock stops the pick and the drag in
  the view; both are editor view state and never go into the file. **Show all** clears the solo.
- Search with words, `name:`, `tag:` or `component:` (for example `component:light`).
- Right-click a row: Add an empty child, Duplicate, Copy, Paste as a child, Rename, Delete, and the prefab actions.
  Right-click an empty part: Add an empty entity, Paste.
- Each row shows the icon of the main component (camera, light, model, sound, note, shape…); a prefab instance and
  its entities have the prefab colour.
- **+** creates an entity of a preset at the root. An asset of the Project window that drops on a row adds a model
  under it; on the empty tree, at the root.
- The keys of the tree: ↑ and ↓ select the row before and after (Shift extends), Home and End go to the first and the
  last row, → opens a parent or goes to its first child, ← closes it or goes to the parent. Alt with ↑ and ↓ moves the
  entity before or after its sibling, Alt+→ moves it into the sibling before it, Alt+← moves it out of its parent.
  F2 renames and Delete deletes.
- The tree draws only the rows in its view, so a scene of 10,000 entities scrolls at the frame rate.

## The inspector

The right panel shows the components of the selection. The widgets come from the schema of each component and its
editor hints, so a plugin component gets an inspector with no editor code.

- Numbers: type a value, or drag the label (Shift ×10, Alt ×0.1). Rotations show as Euler angles in degrees; the
  file keeps quaternions.
- Colours, enums, switches, lists, maps, curves and references. An asset reference has a picker; an entity reference
  has a picker and a socket choice. A material reference has **Edit**.
- With more than one entity selected, a field that differs shows "(mixed)", and an edit writes to each.
- **Add component** is a search over the components that the selection can take, in their groups: type words of the
  name, the ID or the group, then Enter (or ↓ and Enter). **Reset to the default** removes a value from the file.
- One entity shows its ID (with a copy button), a switch that shows or hides it, and its tags (× removes a tag, the
  field adds one).
- Each component card has an icon and a ⋯ menu: Reset to the defaults, Copy the values, Paste the values (into another
  entity, scene or project), Remove the component, Docs, and Ask the agent.
- **Presets of your own.** "Save as a preset" in the ⋯ menu keeps the values of the component under a name; the ⋯
  menu of that component on another entity then has "Apply the preset <name>" (one step). Component ▸ Save as a preset
  keeps the whole selected entity (with no transform): Entity ▸ Create then has it. The browser keeps your presets, so
  each project has them; an agent sees each one as a command (`preset.apply.<id>`, `entity.create.user.<id>`).
- An override of a prefab instance shows its value in bold with a bar in the margin.
- **{ }** switches to the raw JSON of the entity: edit its name, tags and components, then **Apply** (one step; a value
  that its schema refuses says why).
- The lock keeps the inspector on its entities while the selection changes. Window ▸ Copy the panel opens another
  inspector below it, with its own lock, so two locked inspectors show two entities.
- With no selection, **Scene** shows the `environment` values: background, tone mapping, exposure, environment map,
  fog and the effects. The fog, the bloom, the ambient occlusion and the selection outline each have a live preview
  over their fields: the fog over the distance from the background colour to the fog colour, a row of samples that
  glow above the bloom threshold, the shade of a corner, and the outline of a box. The preview follows each edit and
  each step of a number drag.
- **Model widgets.** Levels of detail is a chain of levels with the screen size where each one starts (the share of
  each level shows in a bar), the hysteresis, Add a level and Remove the last level. Material overrides and the
  variants of a character have **Pick a part in the view**: the next click on a model in the Scene view adds an
  override of the mesh under it (`mesh:<node>`); Escape stops. The clip source of an animator is a model and its rig
  profile (Auto, a profile, or none); "Use the clips of the model" takes it away. The overrides of a prefab instance
  are a list of the changes (the entity of the prefab, the component and the field, the value) with Revert for each one
  and Revert all.
- **Handles in the view.** A selected light or camera shows handles over the main view: a point target moves in the
  plane of the view (an entity target shows a line to the entity; with no target, a hollow handle 2 m in front of a
  directional light, a spot light or a camera sets a point target), each side of the shadow box of a directional
  light with a shadow moves along its axis (`left`, `right`, `top`, `bottom`, `near`, `far`), and the corners of the
  safe frame box of a camera move in the plane of the view. More handles: the range of a point light (a sphere), the
  range and the cone of a spot light, the field of view of a camera (the top edge of its frustum), the reference and
  the largest distances of an audio source, each socket point, each point of a path (a hollow handle in the middle of
  a segment adds a point; Alt and a press deletes one), the corners of a rectangle footprint and the points of a
  polygon footprint of an obstacle (on its ground), and the facing of a stand point (1 m in front of it). A range of 0
  (no limit) has a hollow handle 5 m out. Each drag is one undo step; Escape puts the start back. A handle takes the
  press before the axes of the gizmo. The fields of the inspector edit the same values. The script API has `handles()`
  (the canvas point of each handle).
- Each edit is one undo step that names the component and the field ("Light: intensity"). A script and an agent make
  the same edits with the commands `component.set` (`entity`, `component`, `field` with dots such as `position.1`,
  `value` as JSON), `component.reset`, `component.add` and `component.remove`; the target `scene` edits the scene
  values, and no target edits each selected entity.

⌘Z does not undo the scene while a field has the focus; it undoes the text of the field.

## Lighting

The **Lighting** window (Window ▸ Lighting, on the right side of the Layout workspace) holds the look of the whole
scene. **Presets** (Studio, Daylight, Evening, Night, Neutral) set the background, the tone mapping, the exposure, the
intensity of the environment map, the fog and the effects in one undo step; a preset keeps the environment map, the
anti-aliasing and the selection outline, and the button of the preset that the scene matches is on. **Environment
map** shows the environment maps of the project as pictures: a press uses one, **No map** takes it away. The fields of
the `environment` component follow, with the previews of the fog and the effects. **Lights** lists the lights of the
scene with their intensity (a press on a name selects the light). **Ask the agent to light this** sends a request to
the agent of the window (in Scenity Studio).

## Gizmos

Select an entity to see the gizmo. The tools are at the left of the toolbar; the clock group is in its centre.

| Key                        | Action                                                          |
| -------------------------- | --------------------------------------------------------------- |
| Q                          | The View tool: a press selects, nothing moves, no gizmo         |
| W, E, R                    | Move, turn, scale                                               |
| L                          | World or local axes                                             |
| P                          | The pivot of each entity, or the centre of the selection        |
| Alt (in a drag)            | No snap                                                         |
| Shift (in a drag)          | A snap ten times larger                                         |
| X, Y or Z, a number, Enter | Type a value on one axis; a number during a drag sets the value |
| Escape                     | Cancel the drag                                                 |

The gizmo bar sets the grid snap (m), the angle snap (degrees), the scale snap and the surface snap: a free move snaps
to the surface under the pointer and to a socket within 8 cm. A drag on an entity in the view moves the whole
selection. Each drag is one undo step. A locked entity does not move.

## The viewport

| Input                     | Action                      |
| ------------------------- | --------------------------- |
| Left drag on empty space  | Orbit (Shift: pan)          |
| Middle drag               | Pan                         |
| Wheel                     | Zoom                        |
| Right drag + W A S D, Q E | Fly (Shift: faster)         |
| Arrow keys                | Turn the view               |
| F                         | Frame the selection         |
| 1 to 9                    | Open document camera 1 to 9 |
| 0                         | The editor camera           |
| \`                        | The overlay menu            |
| ⌥1, ⌥3, ⌥7                | Front, right and top view   |
| ⇧⌥1, ⇧⌥3, ⇧⌥7             | Back, left and bottom view  |
| ⌥5                        | Perspective or orthographic |

The camera menu lists the document cameras. The view menu has Lit, Unlit, Wireframe and Normals; the grid switch shows
the floor grid and the axes. Lights and cameras have icons that select them on a click. A selected camera shows its
view in a small preview. The editor camera is never saved.

**Overlays.** Small panels over the Scene view hold its controls: Tools (view, move, turn, scale), Tool settings
(world or local, pivot or centre), View options (the view mode and Frame), Grid and snap (the grid and the snaps),
Cameras (the camera menu), Orientation (the world axes as the view sees them: a click on the end of an axis looks from
that side, and its button switches between perspective and orthographic), Stats (the backend, the tier, the frame
rate, the entities and the selection) and, in the studio, Agent (what the agent does, and Follow the agent). Each one
docks to an edge of the view: drag its head to an edge, or use its ⋯ menu. A click on its title folds it. The overlay
menu (the backtick key) shows and hides each one. The layout of the window keeps their places. Edit ▸ Editor camera has the six
views and the projection switch. The orthographic view is a long lens (a field of view of 1° from far away): the
levels of detail stay the same, and the fog of a scene shows more.

**Split view.** Window ▸ Split view shows one view, two views side by side, two views stacked or four views. The main
view at the top left is the view of the page: the editor camera, the view mode of the View options, the picks, the
gizmos, the drags and the layout tools. Each other view has a bar at its top right: its camera (the top, front, right,
back, left or bottom view, a free perspective view, or a document camera) and its view mode. A drag in a view pans an
axis view and turns the perspective view (Shift or the middle button pans); the wheel zooms. **Main** puts the camera
and the view mode of a view into the main view, and the main view into that view. The other views draw with no
effect (no selection outline), and they use the shadow maps of the main view. The browser keeps the split view for
the next open.

## Assets

The **Project** window (⌘5) has the favourites and the folder tree of the project on the left. **Assets** is the asset
browser: a tile per asset with its still, a search, kind and tag filters, and "Used by" (a click selects the entity, or
opens the scene that uses it). A folder shows its files in a grid or a list, each with the icon of its kind (scene,
prefab, material, sequence, rules, plugin, asset with its still): search words and a kind filter find files under the
folder; **Create** makes a folder, a scene, a material or a sequence; Enter or a double-click opens a scene, a material
or a prefab; F2 renames; a drag onto a folder of the tree moves the file. An asset moves with its record, so its ID and
every reference to it stay. **Reveal** shows a file on the disk; the star keeps it in the favourites. An asset drags to
the view, to the hierarchy (a model under the row) and to an asset field of its kind in the inspector.

- **Import** (or a drop on the browser) copies files into `assets/sources/`, writes the asset record and imports them.
  The formats: `.glb`, `.gltf` (with its buffers inside), `.fbx`, `.obj`, `.blend` (through Blender), `.png`, `.jpg`,
  `.webp`, `.avif`, `.hdr`, `.wav`, `.ogg`, `.mp3` and `.material.json`.
- Drag a tile onto the view to add an entity there. A model file dropped from the file manager onto the view imports
  and adds it in one undo step.
- **The import dialog** shows the importer of each file, the settings form of each importer (the fields of more parts
  under "More"), the rights record of the import (a record of the project, or **New rights record**) and the folder.
  The queue shows the state of each file, the reason of a failure and its fix (no Blender: the doctor fix); **Cancel
  the other files** stops the files that wait.
- A new import with no rights record points at `rights/imports.yaml` ("licence not known"). The release check stops it
  until you give it a real rights record ([formats.md](formats.md#the-rights-record)).
- A change of a source file on the disk imports it again and swaps it into the open scene with no page reload; a toast
  says so.
- **The asset inspector** (the right side of the browser) shows a preview of the kind of the asset (a turntable of a
  model, the channels of a texture, the balls of an environment map, a material ball, the wave and a player of a
  sound), the facts (the size, the triangles, the meshes, the extent, the levels of detail, the clips, the rig), the
  record fields, the warnings of the import and **Import again** with the settings form of its importer.
- **Stills**: a new import gets its still at once (the page draws it). A stale still has a mark on its tile; **Make
  stills** draws the missing and stale ones.
- **Rights**: Mod or Shift and a click picks tiles; the rights bar gives one rights record to all of them. A tile that
  the release gate stops has a **Rights** mark. The **Rights** panel edits the licences that a release accepts
  (`release.licences.allow`), lists the rights records with their problems and makes a new one.
- **Get assets** searches a source of free assets (Poly Haven is built in: skies, models, textures) and imports an item
  with the rights record of its source: a sky takes 3 clicks. **Generate** (with a generation service of
  `SCENITY_GENERATOR_URL`) shows the cost of a run first, then imports the result with a rights record of kind
  "generated".
- The **Asset build** panel shows the build state of each asset (built, stale, not built, failed), runs `assets build`
  with its log, keeps the build settings of an asset (the texture codecs, the levels of detail) and previews each level.
- The **Approvals** panel has a review queue for each approval role (a new role too): Approve, Ask for changes or
  Reject with a note writes the approval file; a source change makes the approval stale.
- The **Release check** panel runs `assets release-check` and links each failure to its fix (the Rights panel, the
  Approvals panel, the asset).
- The **Problems** panel shows the problems of the asset database with their fixes: a missing source relinks to a
  project file (a moved file first), a broken reference of another document relinks to an asset, a copied record gets
  a new ID.
- The **Export** panel exports a scene as GLB (the options of `assets export`) and checks the file with the glTF
  validator.

## Materials

The **Material** tab edits a material asset (`*.material.json`): the type (standard, physical, lambert, phong, unlit),
the values with a colour swatch, and the texture slots with colour space, repeat and offset. Open it with **Edit
material** in the asset browser or **Edit** beside a material reference in the inspector. **New** makes a material
asset; **Assign to a part** sets it on a mesh of the selected model. The view is the preview. **Save** writes the
material file.

- **Presets** (Plastic, Metal, Wood, Glass, Rubber, Ceramic) set the values that the type takes, in one undo step; the
  name and the maps stay. A change of the type keeps the values that the new type takes.
- The swatch shows the picture of the colour map. Each texture slot shows the picture of its texture, and a texture
  tile that drops on the slot goes into it.
- A material tile that drops on the Scene view goes on the part under the pointer: the mesh of a model
  (`mesh:<node>`) or the shape of an entity (`material.assign`, one undo step).

## Prefabs

A prefab file (`*.prefab.json`) is a group of entities that many scenes can use. In the hierarchy an instance has a
mark and a count of its overrides.

- **Make a prefab of the selection** (Entity menu, `prefab.create`): the selected entities (with their children)
  become a prefab file in `prefabs/`, and one instance of it takes their place as one undo step. One entity is the root
  of the prefab; two or more go under a new root at the middle of their places. A drag of hierarchy rows onto a folder
  of the Project window makes the prefab in that folder. An agent gives `name`, `entity`, `folder` and `replace`
  (false: the file only).
- **Create ▸ Prefab instance** places another instance (`source`); a prefab that the page did not read yet loads at
  once.
- **Edits inside an instance** change the instance only: a rename, the hide, solo and lock toggles, a move with the
  gizmo and each field of the inspector on an entity of the prefab become overrides of the instance.
- **Open prefab** (inspector, hierarchy menu or asset browser) opens the prefab mode, with a breadcrumb in the file bar:
  the scene (a press goes back to it) and the prefab. Save the scene first.
- **Apply to prefab** writes the overrides of an instance (or of one entity or one component) into the prefab, so
  every instance gets them. **Revert** removes them. The overrides field of the inspector lists each override with its
  own **Apply** and **Revert**.
- **Unpack** (inspector, hierarchy menu, `prefab.unpack`) makes the entities of the prefab plain entities of the scene
  under the instance entity; the link to the prefab goes.
- **Make a variant of the prefab** (Entity menu, `prefab.variant`) on an instance writes a variant beside the prefab
  file: a prefab whose root is an instance of the base prefab, with the overrides of the instance. The instance then
  uses the variant, with no overrides of its own (one undo step). A change of the base prefab reaches each variant;
  Open prefab on a variant edits its overrides.
- A prefab can hold instances of other prefabs (nested prefabs); a new prefab keeps the files of its nested instances.
- Save writes the changed prefab files after the scene.

## Variants

A variant of a scene is an override layer (`scenity.overrides/1`, see formats.md): a list of ops over the base scene,
in a file beside it that the scene names in `variants`. The **Variants** panel (Window ▸ Variants) lists them:

- **Show** puts a variant in the view. The document stays the base scene, so an edit goes to the base scene, and the
  view shows the base scene again. **Show** on the base scene row also shows the base scene again.
- **Make from the edits** writes a new variant of the edits since the last save (`<scene>.<name>.overrides.json`).
  The scene goes back to the saved values and names the variant, as one undo step. Save the scene to keep the name.
- **Apply** puts the ops of a variant into the base scene as one undo step.
- **Compare** takes a picture of two variants (or of the base scene) and shows them one over the other; the slider
  moves the edge between the two pictures.

## Layout tools

The **Tools** overlay of the Scene view has five layout tools under the gizmo modes, each over the built-in metrics:

| Tool       | Needs                                                   |
| ---------- | ------------------------------------------------------- |
| Measure    | Two selected entities, or two clicks (Escape clears)    |
| Reach      | An entity with a `character` component or a stand point |
| Clearance  | One or more selected entities with a box                |
| Walk paths | An entity with `locomotion`, or two entities            |
| Visibility | A target entity, and an eye entity or the camera        |

The **Readout** overlay (on the right edge while a tool is on) and the lines over the view show the result; Clear turns
the tool off. A tool says why it cannot run.

## Rules

The **Rules** tab lists the rules of the scene, its sequence and the project, grouped by file: the result (ok, fail,
known, n/a), the value, the limit and the provisional mark. Filter by failed only or by level. The check runs 400 ms
after an edit and after the end of a drag. A click selects the entities of the rule and seeks to the worst time.

A rule with a sequence scope has a graph of its value over the sequence time, with the limit band and the markers. A
click on the graph seeks; the arrow keys step.

A save runs the rules first. A failed `block` rule stops the save and shows a notice with a reason field: "Save with
the reason" saves and writes the reason to `<scene>.rules-log.jsonl`.

## The sequencer

With a sequence open, the **Sequence** tab shows a track list per entity, the keys on a time ruler, the markers and a
curve editor.

- **The head**: the sequence picker (the sequences of the project; a choice opens that sequence), **New sequence**,
  the duration in seconds, **Loop**, and **Initial state** (the initial state of the simulations, JSON by plugin ID).
  Each change is one undo step (`sequence.settings`, `sequence.open`).
- **Add track** of each kind: transform, property (with its path, `light/intensity`), visibility, animation (a clip),
  attach, audio (with the waveform of its sound), camera (a camera cut), event and action. A camera, an event and an
  action track belong to the sequence, not to an entity. **Add marker**, a key at the time now (an event, an action,
  a clip, a cut and an attach key get a first value), drag keys, Delete removes the selected key.
- **The key form** under the tracks edits the selected key: its time, its fields (a value, the parts of a transform,
  a sound, a clip, a camera, an attach parent, an event name, an action and its arguments as JSON) and the ease.
- **The curve editor** shows the selected number track (or **All curves**: each number track at once). A press on a
  point selects its key; the ease bar sets the ease from the key before: Step, Linear, In, Out, In and out, Bézier.
  A Bézier key has two tangent handles: drag them to shape the curve (one undo step). **Frame all** fits the keys of
  the lines; Fit shows the whole time line.
- **Zoom and snaps**: ⌘ or Ctrl and the wheel zoom at the pointer, the wheel pans, and −, + and Fit zoom too. A drag
  of a key or of a marker snaps to the clock, the markers and the other keys, else to 100 ms; Alt gives the exact
  time.
- **Record**: an edit at the time now (a gizmo drag, an inspector value, a hierarchy change) becomes a key.
- **Character setup** (Window ▸ Character setup) for the selected entity with a skinned model: the rig profile
  (`ue5`, `rigify`, `vrm`, `mixamo` or `none`; Detect takes the one that fits the bone names), the bone map (each
  canonical bone, its node from the profile or from the `bones` of the component, another node to choose, and the
  missing required bones), the clip source of the animator (the clips of another model, retargeted), the look variant
  (a key of the `variants` of the component, or none), and **Move the IK targets in the view**: a handle at each
  target entity of the IK goals in the Scene view; a drag moves the target on its level (one undo step). A socket
  target has no handle. **Retarget preview** plays a clip of the clip source on the character in the Scene view, at
  the time of the clock (an open sequence); the sequence does not change.
- **The foot lock and the IK goals in the inspector**: the foot lock of an animator has a row for each leg (the upper,
  the lower and the end bone, and a bone that follows the end; the bone names of the model are the choices), the
  contact share and the fade share. Add the foot lock takes a leg from the bone names of the model (the names of
  Mixamo, Rigify, UE5 and VRM rigs). The IK goals of a character (the left hand, the right hand and the look) each
  have a target (an entity or a socket), a weight, and for the look the max angle in degrees.
- **The Animator window** (Window ▸ Animator) edits the `animator` of the selected entity as lists: its parameters
  (with a value now that the view shows at once, the preview), its layers, the states of a layer (the clip, the start,
  a remove) and its transitions (from, to, the conditions as JSON). Each edit is one undo step; the state that each
  layer plays at the time of the clock has a ▶.
- **The Simulation panel** (Window ▸ Simulation) shows the state of each simulation plugin at the time of the clock,
  from the frame that the core draws: a table for each record of records (the cars and the walkers of the traffic
  sample) and the other fields as values. **Recorded stream** opens a `*.stream.jsonl` of the project and shows its
  state at the same time.
- **Walks**: select an actor with a `locomotion` component and the Scene view draws the route of each of its walks
  round the obstacles, with the number and the start time of the walk at its stand point. A move of a stand point or
  of an obstacle shows the new route at once. Entity ▸ Add a walk (`walk.add`: a stand point and a time) adds one.
- **Onion skins** (View ▸ Onion skins, `view.onion`): with a sequence open and one entity selected, the Scene view
  shows faint copies of the entity at five times round the clock (two before in blue, three after in orange, 250 ms
  apart), so a motion shows in one frame. The camera previews and the pick leave them out.
- **The edits of an agent** to the sequence wait as proposals, as its scene edits do: the Timeline shows their tracks
  and keys dashed (ghosts) and a bar with **Accept** (one undo step for each proposal) and **Reject**. An agent can add
  a whole track with its keys in one command (`sequence.track.add` with `keys`), for example a camera move.
- **Keys from the inspector**: with a sequence open, a field that a track can drive has a key mark: ◇ (no track),
  ◈ (a track, no key now) or ◆ (a key at the time now). A press keys the value of the field at the time of the clock
  (and adds the track first). The **Record** button of the inspector header is the record mode of the sequence.
- The play bar: Play and Pause (Space), step 50 ms (comma, period; Shift: 250 ms), loop from here (`[`), loop to here
  (`]`), clear the loop (`\`).
- **The clock in the toolbar.** With an open sequence the centre of the toolbar has the same clock, also with no
  Timeline panel: To the start, Step back, Play or Pause, Step forward, the time field (type the seconds, then Enter),
  the speed (0.25× to 4×), and A, B and Clear for the loop with its range. The clock keys work while a sequence is open
  (in the play mode they go to the game). `clock.seek` and `clock.speed` take a time and a speed.

Save writes the sequence file with the scene. The gizmo and the inspector show the scene at the clock time (the posed
view); an edit there changes the base scene, or adds a key in record mode.

## Play mode

**Play** (⌘P) in the centre of the toolbar plays the sequence from 0 ms on a copy of the edit state. The view gets an
orange frame. The Game view comes to the front (a script can keep the Scene view in front: `startPlay(replay, { view:
"scene" })`); a Game view behind another tab runs no player. **Pause** (⌘⇧P) stops the clock and starts it again; **Step** (⌥⌘P) moves it one frame forward. The
time field shows the clock.

- An edit during play changes only the play state. The file bar shows that the edit state is saved or not; a save is
  refused during play.
- The input map of the plugins works: keys and clicks go to the plugins, and the session records them. **Replay**
  plays again with the same input. During a play the bottom left of the view shows **the keys of the game** (each
  action of the input maps with its keys or its click); × hides them (`play.hints` shows them again).
- The audio keys of the sequence play at their time in the play mode too. In the inspector, a sound field (the
  `audioSource` of an entity) has ▶: a press plays the sound once (■ stops it); the range handles of the sound are in
  the Scene view.
- **Recordings** (in the play group) lists the saved input recordings of the project: **Save the last play** keeps
  the input of the last play under a name, **Replay** plays a saved recording again (the frames of its live play), and
  **Delete** removes it. The browser keeps the recordings of each project.
- **Stop** gives back the edit state, the time and the selection. **Keep** lists the changes of the play mode; keep
  the checked ones as one undo step.
- **Play in a window** opens the player page with the documents now.
- The **Game view** (⌘2) is the scene through a document camera in the player path (the player page in the panel,
  with no editor layer). Its toolbar has the camera, a resolution or aspect preset (the frame keeps its aspect in the
  panel), the tier, the backend, the render worker, the stats of the player, and Refresh (the documents now). Play
  brings it to the front with the documents of the play mode; ⌘1 goes back to the Scene view.

## Settings and keys

The **Preferences** panel has the editor settings and the key map.

- The snaps of the project go to `scenity.editor.json` next to the project file (the project file wins). The personal
  values (view mode, grid, camera speeds, the default dock tab and height, the number of recent scenes) stay in the
  browser. Each field says where its value comes from.
- **Theme**: dark (the default), light or navy, and **High contrast**. The change shows at once in all the window. The
  browser keeps the choice (`scenity.studio.theme`); in the studio the user preferences of the host keep it too, so the
  Hub and the editor share it. The commands `theme.dark`, `theme.light`, `theme.navy` and `theme.contrast` do the same
  from the key map.
- **Keys** lists each command with its keys. Search a command, **Change** and press a key, **Clear**, **Reset**. A key
  that two commands of one context share shows a warning. The key map is a `scenity.keymap/1` document in the browser.
- **Search** (the field at the top of Preferences) shows the settings with its words. In the studio, Preferences also
  has the language, the recent projects, autosave and the defaults of new agent sessions of the studio host.
- **Language**: English (en-US) or Brazilian Portuguese (pt-BR), and the pseudo-locale (en-XA), which shows each text
  with accented letters and brackets, so a text that does not come from Fluent shows plainly. The URL parameter
  `locale` (`locale=pt-BR`, `locale=pseudo`) overrides the preference for one page. `bun run check:i18n` checks that
  each Fluent file parses, and that pt-BR has each message of en-US with the same variables.
- **Shortcuts** (File ▸ Shortcuts) shows the key map on a keyboard picture: choose the modifiers and a context, pick a
  command, then press a key on the picture. A key with a clash shows in red. **Export** and **Import** write and read
  the key map file; **Reset all** gives the default keys.
- **Project settings** (File ▸ Project settings) has each field of `scenity.project.json` as a form, in sections, with a
  search and the checks of each field. **Save** writes canonical JSON. The Editor section has the project values of
  the editor settings.
- **Autosave** is a project option (Preferences ▸ Autosave of the project): the open scene saves after the given
  seconds with no edit. The drafts of unsaved edits are in the browser and in `.scenity/drafts.json` of the project,
  so a closed tab gets its edits back; the dialog of a draft shows its changes. A scene file of an older format offers
  its upgrade with the diff of the file.

**Version control and jobs.** The **Version control** panel (⇧⌘G) lists the changed files of the project with the
semantic diff of a scene, a prefab or a sequence (each changed value with the old and the new value), commits the
picked files with a one-line message, and switches the branch. The **Jobs** panel lists each job of the dev server
(builds, shots, renders, benches, checks, runs) and of the studio, with its state, its log and its output pictures and
files, **Stop** and **Run again**, and a button for each run of `workbench.runs` of the project.

**Placement.** Entity ▸ Place has the placement helpers, each a command for a person, a script and an agent; each run
is one undo step over the boxes that the view draws: `place.align` (`axis`, `edge`: the selection to the edge of the
first entity), `place.spread` (`axis`: equal gaps; the first and the last entity stay), `place.dropToFloor` (onto
the surface under each entity, else the height 0), `place.on` (`target`: on its top, in its middle), `place.against`
(`target`, `side` `+x`, `-x`, `+z` or `-z`), `place.near` (`entity`, `target`, `angle` in degrees about the up axis,
`gap` in metres, `face`: turn to the target), `place.facing` (`target`) and `place.findSpace` (`near`: the first free
place on the floor round it). `entities` names the entities with commas; the default is the selection.

**Tags.** The **Tags** panel (Window ▸ Tags) lists each tag and each pick layer (the `layers` of `pickable`) of the
scene with the number of its entities. A press on a name selects its entities; **Rename** changes the name on each
entity of the scene as one undo step (`tag.rename` and `pickLayer.rename` with `from` and `to`; a name that an entity
has already merges into it).

**Selection tools.** Edit has Select all (⌘A), Select none (⇧⌘A), Invert the selection, Select the children, Back and
Forward in the selection (⌘[ and ⌘]), and Select by ▸ tag, component or kind (model, light, camera, sound, note). A copy
(⌘C) pastes into any scene of any project of the studio (one clipboard for the origin), and it goes to the system
clipboard as JSON too.

The default keys:

| Key                                 | Command                                             |
| ----------------------------------- | --------------------------------------------------- |
| ⌘S                                  | Save the scene                                      |
| ⌘Z, ⇧⌘Z                             | Undo, redo                                          |
| ⌘D                                  | Duplicate the entities                              |
| Delete, Backspace                   | Delete the entities                                 |
| ⌘C, ⌘V                              | Copy, paste                                         |
| ⌘A, ⇧⌘A                             | Select all, select none                             |
| ⌘[, ⌘]                              | Back, forward in the selection                      |
| F2                                  | Rename                                              |
| W, E, R, L, P                       | The gizmo                                           |
| F, 0 to 9                           | Frame, the cameras                                  |
| H, ⇧H, ⌥H                           | Hide, solo, show all                                |
| ⌘K, ⌘O, ⌘⇧K                         | Search and ask, the scene filter, the Search window |
| ⌘P, ⌘⇧P, ⌥⌘P                        | Play or stop, pause, step                           |
| ?, F1                               | The key sheet, help for this                        |
| Space, comma, period, `[`, `]`, `\` | The clock                                           |
| I                                   | The inspect panel                                   |
| Escape                              | Clear the points of the measure                     |

⌘ is Ctrl on Linux and Windows. The keys act in the panel that has the focus (scene, dock, sequencer, hierarchy) or
everywhere (global); the panel that has the focus shows a ring. `?` opens the **key sheet**: each key now by its
context, with a filter. F1 opens the docs of the panel that has the focus. The held keys of the camera (fly with W A S
D Q E while the right button is down, turn with the arrows) are in the key map too, and a change of them works at
once. The keys of a gizmo drag (Enter, Escape) show as fixed.

## Saving and drafts

- **Save** (⌘S) writes the scene, then the changed prefabs, materials and the sequence. Each file is written in the
  canonical form through a temp file and a rename, so a crash never leaves half a file.
- A save refuses a path outside the project, a link out of it, a document that does not read and a file that changed
  on the disk since the load. For a changed file a dialog offers **Reload** (your changes go) or **Overwrite**, and
  **See the diff** lists the changes from your scene to the file on the disk (new and removed entities, a new parent,
  the old and the new value of each field).
- The page keeps a local draft of unsaved changes in the browser. At the next open it offers **Restore** or
  **Discard**.
- The page title starts with `*` while a change is not saved.

## Agents in the editor

The agents of the studio work in the editor window through the same commands as the person: the **Agent** panel, the
**Review** panel for their change sets, and the **Terminal** panel for Claude Code ([studio.md](studio.md#agents)).
The tools of an agent read the scene (`scene_query`), take a frame of the view of the agent (`scene_frame`), and run
commands (`scene_command`); in the Review mode each edit waits as a change set.

The workbench page of older versions showed the editor as a surface in a frame; that page retires
([workbench.md](workbench.md)).

## The script API

`globalThis.__scenity` gives tests and tools the page: `command(id, args)`, `commands()`, `select(ids)`,
`save(force, reason)`, `inspect()`, `stats()`, `viewport()`, `sequence()`, `startPlay()`, `stopPlay()` and more. The
canvas has `data-ready="1"` when the first frame with every asset is drawn.

The file and project commands run from the menus, the search box and an agent: `scene.new` (`name`), `scene.open`
(`path`), `scene.save`, `scene.saveAs` (`path`), `scene.close`, `sequence.new` (`name`; the page opens the new
sequence), `prefab.create` (`entity`, `name`; it writes `prefabs/<name>.prefab.json`), `material.new` (`name`) and
`project.set` (`setting`, `value` as JSON). `scene.close` takes a `path` (the × of a scene tab gives it). With no name
or path, the person gets a dialog. The Entity menu and the + of the hierarchy have **Create ▸** with the presets
`entity.create.<preset>`: empty, box, sphere, cylinder, plane, a point, spot, directional, ambient or hemisphere
light, camera, audio source, socket, path, stand point, obstacle, note, prefab instance (`source`: a `.prefab.json`
path or `asset:<id>`) and character (`asset`: a model; the entity gets `model` and `character`). Each preset takes
`name`, `parent`, `x`, `y`, `z`, `yaw` and `pitch` (degrees), and each run is one undo step. A prefab instance or a
character with no input asks the person for it; an agent run with no input gets the reason. **Camera from the view**
(`entity.create.cameraFromView`) puts a camera at the place of the main view, looking where it looks.

**Adjust** (a small panel at the bottom left of the Scene view) shows the number arguments of your last action, for
example the offset of a duplicate (`entity.duplicate` takes `x`, `y` and `z`). A new value runs the action again as the
same undo step; the panel goes when another step comes. The script API has `lastAction()` and `adjustLast(change)`.

The **Activity** panel (Window menu, the Review workspace) lists each run of a scene command, the newest first: the
time, the actor (you, or an agent with the colour of its session), the title and the outcome. A line copies as a call
of the script API or as a prompt. `activity()` gives the lines and `replayActivity(lines)` runs the lines that applied
again, so a session replays into a copy of the scene. The edits of the panels and the drags are no commands yet, so the
log does not have them.

The **Agent** panel (⌘L, the right area in Scenity Studio) talks to the agent sessions of the studio host. Each tab is
a session in its colour (⌘T a new one; the ⋯ menu renames it, forks it, exports its transcript as Markdown or closes it;
a fork keeps the transcript and continues the conversation). Type a prompt and press ⌘↩. A prompt during a turn waits in
a queue; ⌘. or Stop ends the turn and clears the queue; ↑ in an empty composer gives your last prompt again. The footer
has the mode (Ask: the agent reads only and runs nothing; Review: each edit is a proposal; Auto: the edits apply at
once), the model, the effort, the cost of the session and the share of the context. The panel needs the studio host; a
page of `scenity dev` has no agent panel.

With no agent (`scenity studio --no-agent`, or no Claude login) every feature works as before. The agent panel, ⌘L,
⌘I and "Ask the agent" of the search box say how to connect an agent. With an agent, "Ask the agent" of the search
box (⌘K, a sentence, ↩) sends the text to the agent panel.

The chips over the composer are the context of the prompt, and only they go with it: the scene, the selection, the
time of the open sequence, the camera of the Scene view and the panel you looked at come by themselves; ✕ takes one
out for the next prompt. Type `@` to mention an entity, an asset, a file, a sequence, a rule or a command (↑ ↓ choose, ↩
takes); drop hierarchy rows, asset tiles or picture files on the composer, or paste a picture. ＋ attaches a picture file
or a region of the Scene view (drag a box over the view; a click takes the whole view). Each prompt in the transcript
has a Context fold with its chips.

Each tool call is a card: a sentence ("Move the entities ▸ Armchair"), its state (running, done, waits for you,
failed), the first line of its result, its pictures, "Show in the scene" (select and frame its entities) and the raw
call in a fold. A job of the agent (`scenity check`, `build`, `shot`, `sheet` and the asset commands, in the Jobs panel
too) shows its output on its card.

The edits of an agent in Review mode wait as one **change set** per turn. The status bar says "5 changes wait" (a
press opens the **Review** panel), the agent panel has Review and Accept all, a changed row of the hierarchy has a dot
in the colour of the session (a removed one is struck out), a changed inspector field has a dot with the old and the
new value on hover, and the Scene view has a pin at each changed entity (＋ added, ~ changed or moved with a line from
its old place, − removed). The Review panel lists each change set by entity, each change with its old and new value:
✓ and ✕ accept or reject one change, the changes of one entity or the set; the check boxes choose changes for "Accept
checked" (↩ accepts, ⌫ rejects, ↑ ↓ move on a check box). Each accept is one undo step named after the session.
Preview shows the result in the view only. A change that you made to the same value after the agent, or a change of
an entity that is gone, has a ⚠ mark and starts unchecked. The next prompt of the session takes a chip with what you
accepted and rejected. The script API has `changeSets()`, `acceptOps(keys, title)` and `rejectOps(keys)`.

Each turn ends with **Undo the turn** in the transcript: the files that the agent wrote in the turn go back (a file
that it made goes) and the steps of the turn in the scene go back as one new step, also when you made steps after
them. An Auto session may edit the files of the project (Claude's Edit and Write); the host keeps each file before the
first write of the turn. The script API has `undoTurn(session, turn)`.

**Permissions.** The mode of a session gives a value to each kind of action: Ask (reads only; the jobs that only
read still run), Review (scene edits as proposals; a file write, an import or a network call shows an approval card:
Allow once, Allow for this session or Deny; the tab of the session has a dot while a card waits) and Auto (each action
runs; a session stops at its budget). The switch to Auto always asks, with the budget of the session (default $5).
An Auto session also has a count of turns (200) and the minutes of a turn (30); at a limit the session stops and says
why. The footer shows the cost, the budget, the tokens and the share of the context; Hub → Agents shows the cost and the
tokens of the day.
Hub → Agents sets a value per kind (Allow, Ask or Deny) for every session, and `.scenity/agents.json` of a project
(`{ "permissions": { "files": "ask" } }`) for the project; the stricter value wins. A write of a `package.json`, of
`scenity.project.json` or of `bunfig.toml` always asks; Git is the owner's only.

**Plans.** "Plan first" in the footer of the agent panel makes each turn start with a plan card: the steps, the
files it touches and the risks. Approve it, Edit its steps (one a line) and approve, or Deny it; with no approved plan
the agent makes no edit, write or run in that turn. During the run the steps tick (☐ ◐ ☑ ⊘) and a summary ends the
card. An approved plan is saved in `.scenity/plans/<date>-<title>.md` and follows the ticks. The agent can also
propose a plan for a large request with Plan first off.

**Presence.** While a turn runs, the entities that it reads or edits have a ring in the colour of the session in the
hierarchy and a "…" pin in the Scene view; the camera of its last frame shows as a triangle in the view for 3 s; the
status bar shows its activity (a press opens the agent panel). Agent ▸ Follow the agent shows the last frame of the
agent at the corner of the view. A toast says when a turn ends, and a toast and the bell say when a session waits. The
agent never moves your camera, your selection or your focus.

**External agents.** Claude Code, Codex, Cursor and Claude Desktop connect over MCP with `scenity mcp` (Hub → Agents
has the line to add in each app). Its first call asks to connect: the agent panel shows "Claude Code asks to work in
this project" with Allow and Deny. An allowed agent gets a session tab of its own (Review by default; it takes no prompt
of the panel): its edits wait as change sets, with its presence and its turns, as for the built-in agent.

**Terminal.** Window ▸ Terminal (Ctrl+\`) runs terminals of the project on the studio host: "+ Claude Code" starts the
Claude Code CLI with the tools of the studio (its MCP server, `scenity mcp`), "+ Shell" your login shell; both start
in the project folder. A tab keeps its terminal; a reload of the page shows its output again.

**Instructions.** Agent ▸ Agent instructions opens the Instructions panel: `AGENTS.md` of the project in a field
(Save writes it), `CLAUDE.md` to read, and the skills of `.scenity/skills/` (one Markdown file per skill: its first
heading is its name and its first paragraph says when to use it). Each turn of an agent reads them at its start.

**Recipes.** A recipe is a saved prompt with parameters. Run one from the search box (⌘K, `>` and its name), from
Agent ▸ Recipes, or with `/` at the start of the composer; it asks for each parameter (its default in the field) and
sends the prompt to the active session (or a new one named after it). The studio has "Light for a product shot" and
"Tidy the names of the entities"; your recipes are in `recipes.json` of the studio folder and a project keeps its own
in `.scenity/recipes/` (one file each: `{ "format": "scenity.recipe/1", "id", "title", "prompt", "params" }`, with
`{name}` in the prompt for each parameter). Hub → Agents lists them.

**Background tasks.** Agent ▸ New background task (or the Tasks panel) starts a task while you work on: a prompt, a
budget (default $5), a time limit (default 30 minutes) and a gate (the rules of the project by default, or none). The
task runs as a session in Review mode, so its changes wait in Review. After each turn the gate checks the rules on the
scene with the changes of the task; a failed check goes back to the agent, at most five times in a row. At the end a
toast and the bell say so (and a system notification when the window is not in front), and the task has a review pack
in `.scenity/tasks/<task>/` (`REVIEW.md` with the turns, the gate and the change sets, and a picture before and after).
The Tasks panel lists the tasks with their state, the changes that wait, the use of the budget, the branch and the
gate; its search finds old tasks; Open shows the session, Review opens the Review panel, Stop ends a task.

**A task in a worktree.** Tick **In a worktree** and the task works in a Git worktree of the project, on a branch of its
own (`scenity/task-<id>`), in `worktrees/` of the studio state: its file writes go there (they need no approval, as
they never change your folder), and your folder stays as it is. The worktree starts at the last commit of the project,
so an edit that is not committed is not in it. The gate **The rules and scenity check** checks the rules, then writes
the scene with the changes of the task into the task folder and runs `scenity check` there: the check of the project
is the gate. Merge the branch with Git when the task is good.

**Variants and split work.** Set **Variants** in the Tasks panel to 2 to 6 and the prompt goes to that many agents at
once, each with its place in the group ("… (variant 2 of 3)"). Each agent has its own session, so its changes wait as
their own change set. When each task of the group is at its end, **Compare** shows a grid of frames: the view camera
after the changes of each variant. **Keep this one** accepts the changes of that variant and rejects the changes of
the others. A host request with `parts` (one prompt for each part, "the chairs", "the lights") splits the work over
2 to 6 agents instead; its grid has **Merge all**.

**Notes as tasks.** A note (Create ▸ Note: an entity with the `annotation` component) on an entity or at a point can be
a task: select it and use Agent ▸ Send the note to the agent. The text goes to the active session with the note and
its entity as context. When the turn ends, the note gets the status "done" and the key of the turn (its change set) in
its `task` field.

**Notes in the views.** The notes of a scene are the notes of its note file (`<scene>.notes.json`, see formats.md)
and its note entities. Each one is a pin in the Scene view (a press selects the entity of the note), and a row of an
entity with file notes has a mark with their number in the hierarchy. The **Notes** panel lists them with a filter
(all, open, done, or no pins), **Add** (on the selected entity, else at the target of the view), Done and Open,
Remove for a file note, and Send (to the agent of the window). The editor writes the note file at once; a note is
not an undo step. **Reply** opens the thread of a file note: the replies of the team with their authors and times, and
a field for your reply. Preferences → **Your name in notes** (`notes.author`, a setting of this browser) names you on
your notes and replies; the panel reads the file again every few seconds, so the replies of the others come in.

**Questions.** An agent can ask you a question with 2 to 4 choices; the card in the transcript has a button per choice
and a field for another answer. The session waits (a dot on its tab, a toast and the bell) until you answer.

**Ask here (⌘I).** ⌘I opens a small prompt field at the place of the focus with the context of that place: an
inspector field (the entity, the component, the field and its value), a hierarchy row, an asset tile, the selection of
the Scene view, or, with nothing selected, a point of the view that you click (the entity under it and the world
point). The prompt goes to the active session (or a new one named after the subject). Its change waits in place: the
field has the mark of the session with ✓ and ✕ beside it.

Each prompt is a **checkpoint**: the state of the scene and the files at the start of its turn. Its line in the
transcript has Preview (the entities and files that changed since, and the scene of the checkpoint in the view on a
switch) and Restore (the scene and the files of the checkpoint come back; the scene change is one step that undo
reverts; the conversation stays).

`commandBatch(steps, title, { by })` runs many scene commands as one change: each step works on the document after the
one before it, all of them apply as one undo step with the title (or wait as one proposal of an agent), and a step
that fails changes nothing.

`commands()` lists each command of the editor window from one registry: the commands of the page (save, the panels,
the workspaces, the theme, the gizmo, the play mode, the clock), the scene commands (`entity.*`, `prefab.*`,
`material.assign`) and the commands of the open sequence (`sequence.*`). Each entry has its ID, title, description for
agents, category, icon, menu path, keys, undo kind (`scene`, `sequence` or `none`), the arguments with their JSON schema,
and whether it can run now. `command(id, args, { by })` runs any of them; a script or an agent (`by: "script"` or
`"claude"`) can run only the page commands that allow it. Each button and menu item of the window names its command in
`data-command`, and the layout spec fails on one that has none. `ui.state()`, `ui.reveal({ entities, frame, panel, field,
text })`, `ui.highlight({ target, text })` and `ui.notify({ text })` let a script or an agent show the person a part of
the window (the agent tools `ui_*`).
