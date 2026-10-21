# Move a lab face to the studio

The lab face of a plugin (`EditorPlugin` of `apps/editor/src/core/plugin.ts`, the editor face of
[plugins.md](plugins.md#the-editor-face)) runs on the lab page of the plugin. Scenity Studio runs the studio face
(`defineStudioPlugin` of `@scenity/editor/studio`, [studio-plugins.md](studio-plugins.md)). This guide maps each part of
a lab face to its place in the studio, so a plugin can move part by part. The lab page and
the workbench keep working while the parts move.

## The parts and their places

| Part of the lab face      | Its place in the studio                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`                      | `id` of the studio face (a lower-case word; the prefix of each contribution ID)                                                |
| `install(app)`            | `activate(ctx)`: run once when the window loads the face; its result runs at the unload                                        |
| `useRuntimePlugins(load)` | The runtime face of the plugin: the scene page loads it with the project (`virtual:scenity/plugins`), so the studio needs none |
| `registerCommands`        | `commands` (an ID, a title, `args`, `keys`, `menu`, `when`, `run`); `menus` for a context menu of the hierarchy                |
| `ops`                     | Editor commands: a studio command edits through `ctx.commands.run`, so the core ops give undo and proposals                    |
| `tabs`                    | `panels` with `area: "right"` (a tab of the side panel is a dock panel)                                                        |
| `dockTabs`                | `panels` with `area: "bottom"`                                                                                                 |
| `cameras`                 | The document cameras of the scene (entities with `camera`); the view switches to them by name                                  |
| `sequence` (the takes)    | Sequence documents over the scene, with the simulation of the runtime face (`defineSimulation`)                                |
| `checks`                  | The rules of the project and the metrics of the dev face (Rules panel); `problemSources` for the checks of a panel             |
| `browser`                 | The Project window with `previews` of the asset kinds of the plugin, and `assetSources` of the host face                       |
| `selectionKinds`          | No point yet: the studio selects entities; a pick of a part of an entity is a sub-target of `pick` (the adapter keeps it)      |
| `placement`               | The layout tools of the core (snap, align, distribute); `sceneTools` with `handles` for a placement of the plugin              |
| `layout`                  | `problemSources` (the report now) and the rules of the project (the gate of a save)                                            |
| `overlays`                | `overlays` (a panel over the Scene view) and `sceneTools` (a tool that takes the pointer)                                      |
| `scene`                   | The scene document of the window: the studio context reads it (`ctx.documents`, frozen views)                                  |
| `apiExtensions`           | `pageTools` (a tool of the agents in the window) and `commands` with `agents: true`                                            |
| `bridgeCalls`             | `pageTools`; the host face keeps its `tools` (they run in the studio host)                                                     |
| `tools`                   | `pageTools` (in the window) or the `tools` of the host face (in the studio host)                                               |
| `contextLines`            | `contextLines(ctx)`                                                                                                            |
| `sceneDocument(tunes)`    | No point: the scene page holds the document; the tune values become component values of the scene                              |

## The steps

1. Make the studio face: `src/studio.ts` with `defineStudioPlugin({ id, apiVersion: 1, texts, contributes })`, and the
   field `scenity.studio` of the package.json. Move the texts of the plugin into Fluent files (`i18n/<locale>/*.ftl`).
2. Move the commands first: each command of `registerCommands` becomes an entry of `commands`. A command that edits the
   scene runs editor commands through `ctx.commands.run`, so it gets undo, the history and the proposals of the agents.
3. Move the tabs and the dock tabs to `panels`, one at a time. A panel gets `ctx` and the hooks of
   `@scenity/editor/studio` (`usePanelState`, `usePanelVisible`, `useAgentAsk`, `EmptyState`).
4. Move the tools of the agents to `pageTools` (in the window) or to the `tools` of the host face (in the studio host).
5. Move the checks to rules and metrics (the dev face) and to `problemSources`.
6. Move the takes to sequence documents with the simulation of the runtime face; the timeline of the editor plays them.
7. Open the project in the studio (`scenity studio --project <folder>`) and trust it: the studio face loads. Each
   contribution has an error boundary; the Console shows the errors of the face.

## The adapter

`adaptLabFace` of `@scenity/editor/studio` makes a studio face from the parts of a lab face that work in the editor
window, so a plugin runs in the studio before its parts move:

```ts
// src/studio.ts
import { adaptLabFace } from "@scenity/editor/studio";
import labFace from "./editor";

export default adaptLabFace(labFace).face;
```

| Part of the lab face | What the adapter makes                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `tabs`               | A panel on the right for each tab (its label is a Fluent text of the plugin); the panel gets `ctx` |
| `dockTabs`           | A panel at the bottom for each dock tab (the lab prop `browser` is not there)                      |
| `sequence`           | The Takes panel: the takes, their moments, and at a time the members and the marks                 |
| `tools`              | A page tool of the window for each tool (a result with `isError` is an error)                      |
| `contextLines`       | The lines of the plugin in the context packet of the agents (a promise gives the last lines)       |

`kept` of the result names each part that needs the lab page (for example `registerCommands`, `cameras`, `overlays`)
with the reason and its place in the studio (the table above). Move those parts one at a time; the adapter and a
studio face of your own do not mix in one plugin.

## What stays on the lab page

The parts with no point in the studio yet (`selectionKinds` beyond the entity, `sceneDocument` with tune values, the
play of a take in the view, and the runner of the lab commands) keep the lab page until they move.
