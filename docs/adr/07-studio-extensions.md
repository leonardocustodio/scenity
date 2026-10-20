# ADR 07: The studio extension model

- Task: UI0-04 of `docs/ui/plan.md`
- Date: 2026-10-17
- Status: **accepted**. The design and an example of each contribution kind are in `docs/ui/extensibility.md`.

## Context

A plugin reaches the scene page today only through its components: the inspector builds fields from the schema and
the editor hints. The lab page has a large plugin interface (`EditorPlugin`, `apps/editor/src/core/plugin.ts`), but
only for a plugin with its own scene core, and it takes the first editor face only. The workbench host has a host face
(`defineHostPlugin`). The studio needs one way for a plugin to add panels, widgets, menus, tools, presets and agent
tools, and it must be the way the core panels use too, so that the API stays complete.

## Decision

1. **A seventh face: `studio`.** The `scenity.studio` field of a plugin's package.json names the module; a folder
   plugin uses `studio.ts` or `src/studio.ts`. Its default export is `defineStudioPlugin(...)` with the fields `id`,
   `apiVersion`, `texts`, `contributes` and `activate`. The face runs in the editor window only; the marker gate of
   `scenity build` keeps it out of a player.
2. **Contribution points.** `panels`, `widgets`, `componentIcons`, `commands`, `menus`, `toolbar`, `createPresets`,
   `sceneTools`, `overlays`, `previews`, `settings`, `templates`, `recipes`, `pageTools`, `contextLines`,
   `statusItems`, `problemSources`, `docs` and `texts`. Two points need Bun, the disk or the network, so they belong to
   the host face: `importers` and `assetSources`.
3. **One public module.** `@scenity/editor/studio` exports `defineStudioPlugin`, the contribution types, the context
   (`ctx`) and the test harness (`@scenity/editor/studio/testing`). The core panels import the same module and register
   as contributions; a test fails when a core panel uses a hook that the module does not export (UI13-03).
4. **Edits are commands.** A contribution changes documents only through commands of the one registry, with the
   plugin as the actor (ADR 06). So each plugin edit has undo, keys, history, review and an agent tool.
5. **Loading.** The studio faces load with the runtime faces through `virtual:scenity/project-plugins` (a `studio`
   part per project), only for a trusted project (UI1-12). A face module loads at start; the code of each
   contribution loads on first use (`() => import(...)`).
6. **Isolation.** Plugins are trusted code: there is no security sandbox. Each contribution renders inside an error
   boundary; three errors in a row turn it off for the session with a notice; plugin errors go to the Console and
   Problems; safe mode (`scenity studio --safe`, Help → Restart in safe mode) loads no plugin face.
7. **Versions.** `apiVersion` is a whole number. The studio supports the current version and the one before; an old
   call gets a console warning with its replacement.
8. **The lab face.** An `EditorPlugin` runs in the studio through an adapter as a workspace (UI13-07); its tabs and
   dock tabs become panels, its commands join the registry and its tools become page tools.

## Consequences

- The scene page gets extension points that it never had; the lab page interface stays until its adapter exists.
- The 17 `custom` hints of the built-in components become built-in `widgets` contributions (UI7-02 to UI7-04), so a
  plugin can give a widget for its own hint in the same way.
- `docs/plugins.md` gets "The studio face" (UI13-08), and the spin sample becomes its reference example.
