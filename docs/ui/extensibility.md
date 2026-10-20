# Scenity Studio: extensions

This page gives the design of the studio face of a plugin: how a plugin adds to the UI, to the agent tools and to the
commands, with the same API that the core panels use. ADR 07 (UI0-04) records the decisions; the tasks are in phase
UI13 of [plan.md](plan.md).

## 1. Goals

1. **One face for the UI.** A plugin adds every UI part through one module: the studio face.
2. **The core uses the same API.** The hierarchy, the inspector, the Project window and the other core panels are
   contributions too (UI13-03). If the core needs a hook, plugins get it.
3. **No code for the common case.** A component with a schema and editor hints gets an inspector, an icon and a
   create entry with no studio face (as today). The face is for more.
4. **Every edit is a command.** A contribution that edits runs commands, so it gets undo, keys, the history, review
   and an agent tool for free.
5. **A broken plugin never breaks the editor.** Each contribution renders inside an error boundary; safe mode starts
   with no plugins (UI13-06).

## 2. The faces of a plugin, after this plan

| Face         | Runs in               | Gives                                                                                   | Today                  |
| ------------ | --------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| Runtime      | The worker, the page  | Components, presenters, systems, simulation, input map                                  | Yes                    |
| Dev          | The editor, the CLI   | Debug layers and the metrics of rules (the editor loads them too, UI10-03)              | Yes (CLI only)         |
| **Studio**   | The editor window     | Panels, widgets, icons, menus, tools, presets, overlays, previews, recipes, page tools  | New (UI13-01)          |
| Host         | The host (Bun)        | MCP tools, runs, surfaces, the gate, importers and asset sources (new fields)           | Yes (no importers yet) |
| CLI          | The `scenity` process | Commands of `scenity` (shown in the studio as jobs, UI13-10)                            | Yes                    |
| Markers      | `scenity build`       | Strings and modules that must not be in a player build                                  | Yes                    |
| Editor (lab) | The lab page          | The `EditorPlugin` of today; it runs as a studio workspace through an adapter (UI13-07) | Yes                    |

The studio face is found like the others: the `scenity.studio` field of the plugin's package.json, else `studio.ts`
or `src/studio.ts` in a folder plugin. Its code never goes into a player build; the marker gate checks it.

## 3. The contribution points

| Point            | What it adds                                                                 | Example                              | Core use                             |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| `panels`         | A dock panel: id, title, icon, default area, one or many, a lock, state save | A traffic signal timeline            | Every core panel                     |
| `widgets`        | The renderer of a `custom` hint or a field kind in the inspector             | `hello.bobCurve` for a bob curve     | The 17 core hints (UI7-02 to UI7-04) |
| `componentIcons` | An icon per component ID                                                     | An icon for `traffic.signal`         | The built-in component icons         |
| `commands`       | Commands with label, description, args schema, keys, `when`                  | `traffic.cycleSignals`               | Every core command                   |
| `menus`          | Items in the menu bar and context menus, by path                             | Entity → Traffic → Add a crossing    | The menu bar                         |
| `toolbar`        | Buttons in the main toolbar or a panel toolbar                               | A "paint lanes" tool                 | Transform tools, clock               |
| `createPresets`  | Entries of the create menu: an entity template with components               | Entity → Create → Car                | Shapes, lights, cameras              |
| `sceneTools`     | A Scene view tool with handles and pointer input                             | A lane paint tool                    | Move, turn, scale, layout tools      |
| `overlays`       | A Scene view overlay (a panel over the view)                                 | A signal state readout               | Tools, View options, Stats, Agent    |
| `previews`       | A preview of an asset kind in the asset inspector                            | A preview of a `traffic.route` asset | Model, texture, sky, audio, material |
| `settings`       | A section in Project settings or Preferences, from a zod schema              | Traffic → default car speed          | Every core section                   |
| `templates`      | Project templates in the Hub wizard                                          | "Road crossing"                      | Empty, Showroom, the samples         |
| `recipes`        | Saved prompts with parameters                                                | "Add a crossing at the selection"    | The core recipes                     |
| `pageTools`      | Agent tools that run in the editor page (as `EditorPlugin.tools` today)      | `traffic_signal_state`               | `ui_*` tools                         |
| `contextLines`   | Lines for the agent context packet                                           | "Signals: north red, east green"     | The core packet                      |
| `statusItems`    | Items in the status bar                                                      | The signal phase                     | Save state, jobs, agent              |
| `problemSources` | Problems with fixes for the Problems panel                                   | "A car route crosses an obstacle"    | Rules, assets, rights, schemas       |
| `docs`           | Docs links for components, panels and commands (F1 help)                     | The docs page of `traffic.signal`    | The core docs links                  |
| `texts`          | A folder of Fluent files for the plugin's texts                              | `i18n/en-US/traffic.ftl`             | The core texts                       |

Two points live in the **host face**, because they need Bun, the disk or the network:

| Point          | What it adds                                                           | Example                 |
| -------------- | ---------------------------------------------------------------------- | ----------------------- |
| `importers`    | An importer for a file type or an asset kind, with its settings schema | A `.ifc` importer       |
| `assetSources` | Search, preview, licence and download of assets, with a rights record  | A company asset library |

## 4. The API

```ts
// plugins/hello/studio.ts
import { z } from "zod";
import { defineStudioPlugin } from "@scenity/editor/studio";

export default defineStudioPlugin({
  id: "hello",
  apiVersion: 1,
  texts: "./i18n", // Fluent files: i18n/<locale>/hello.ftl
  contributes: {
    componentIcons: { "hello.bob": "./icons/bob.svg" },
    widgets: { "hello.bobCurve": () => import("./BobCurveWidget.vue") },
    panels: [
      {
        id: "hello.stats",
        title: "hello-stats-title",
        icon: "./icons/bob.svg",
        area: "right",
        component: () => import("./StatsPanel.vue"),
      },
    ],
    createPresets: [
      {
        id: "hello.bobbingBox",
        label: "hello-preset-bobbing-box",
        menu: "Entity/Create/Hello",
        entity: { name: "Bobbing box", components: { shape: { kind: "box" }, "hello.bob": {} } },
      },
    ],
    commands: [
      {
        id: "hello.resetBob",
        label: "hello-command-reset-bob",
        description: "Set the bob height of the selected entities back to the default.",
        args: { schema: z.strictObject({}) },
        when: "selection.has(hello.bob)",
        run: (ctx) => ctx.commands.run("component.reset", { component: "hello.bob", field: "height" }),
      },
    ],
    menus: [{ path: "Component/Hello", command: "hello.resetBob" }],
    pageTools: [
      {
        name: "hello_bobbing",
        description: "List the entities with the hello.bob component and their height now.",
        input: z.object({}),
        run: (ctx) =>
          ctx.documents
            .scene()
            .entitiesWith("hello.bob")
            .map((e) => ({ id: e.id, height: e.value.height })),
      },
    ],
  },
});
```

**The context (`ctx`)** that a contribution gets:

| Field       | What it gives                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `commands`  | Run a command (with the plugin as the actor); register commands at run time                         |
| `selection` | Read and change the selection; events                                                               |
| `documents` | Read the open documents (frozen views) and subscribe to op events with a selector; no direct writes |
| `panels`    | Open, focus and reveal panels; the state of its own panel                                           |
| `notify`    | Toasts, the bell, banners                                                                           |
| `jobs`      | Start a job (a `scenity` command or a run) and follow it                                            |
| `agent`     | Add context lines; add a chip to the composer; start a prompt with a recipe                         |
| `settings`  | Its own settings (project and person), typed by its schema                                          |
| `t`         | Its Fluent texts                                                                                    |
| `theme`     | The tokens; its own `pluginSet()` tokens                                                            |
| `host`      | Calls to its own host face (typed routes), when it has one                                          |

## 5. The life cycle

1. **Trust.** The studio loads no plugin code of a project that the owner has not trusted (UI1-12). The trust prompt
   lists the faces of each plugin and what they can do.
2. **Load.** The editor dev server bundles the studio faces with the runtime faces (`virtual:scenity/project-plugins`
   grows a studio part). A face loads at start; each contribution's code loads on first use (lazy `import()`).
3. **Activate.** `activate(ctx)` (optional) runs once and returns a dispose function.
4. **Hot reload.** A change of a studio file disposes and activates the plugin again; open panels keep their state if
   they saved it.
5. **Errors.** A contribution that throws shows an error card in place (a panel, a widget, a menu item) with the error
   and "Open in the console". Three errors in a row turn it off for the session with a notice. Plugin errors show in
   the Console and in Problems.
6. **Safe mode.** Help → Restart in safe mode, or `scenity studio --safe`, starts with no plugin faces.

## 6. Rules for a contribution

- Texts come from its Fluent files; no English in code.
- Visuals use `@scenity/ui` and tokens; no raw colours (the lint rule runs on plugin code in the checkout).
- Edits go through commands; a panel never changes a document by another path.
- A panel renders in under 4 ms per frame while the Scene view draws (UI14-07 measures the core and the samples).
- No network call from the page unless the plugin's package.json declares `scenity.permissions: ["network"]`; the
  trust prompt shows it. (This is a statement for the person, not a sandbox: plugins are trusted code.)
- A contribution that a plugin of another project could clash with uses the plugin ID as a prefix (`hello.stats`).

## 7. Versions and compatibility

- `apiVersion` is a whole number. The studio supports the current version and the one before; an older plugin gets a
  console warning with the replacement for each old call (UI13-09).
- The public API is one module, `@scenity/editor/studio`; a test fails when a core panel imports from somewhere else
  (UI13-03).
- **The lab face.** An `EditorPlugin` (`apps/editor/src/core/plugin.ts`) runs through an adapter as a studio
  workspace: its tabs and dock tabs become panels, its commands join the registry, its tools become page tools, its
  overlays become overlays (UI13-07). The resus plugin of CodeBlue can then move part by part to the studio face.

## 8. Tests for plugins

- `mountContribution(contribution, { scene, selection })` in `@scenity/editor/studio/testing` mounts a panel, widget or
  overlay with a fake context for a Vitest component test.
- E2e helpers open a sample with the plugin and reach its panel by ID.
- The spin sample plugin (`samples/spin/plugins/demo`) gets a studio face with a panel, a widget and a create preset as
  the reference example (UI13-08).
