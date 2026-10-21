# Plugins

A plugin adds things that the engine does not know: components, presenters, systems, simulations, input actions,
metrics, editor panels, Claude tools and `scenity` commands. The engine never imports a plugin. The project lists its
plugins, and the build bundles them.

This guide starts with a plugin from zero, then gives each face in turn. Two plugins in the repository are complete
examples: `samples/spin/plugins/demo` (a component, a presenter, a system and an input map) and `plugins/traffic`
(a simulation of a road crossing).

## A plugin from zero

The plugin `hello` makes each entity with the component `hello.bob` move up and down. You can add it to the project of
the [quickstart](quickstart.md).

### 1. The folder and the project entry

```text
demo/
├── scenity.project.json         "plugins": ["./plugins/hello"]
├── sequences/main.sequence.json the clock of the scene
└── plugins/hello/
    ├── runtime.ts               the runtime face
    ├── component.ts
    └── bob.ts                   the system
```

A plugin entry is a path relative to the project (a folder or a file) or a package name. A package can have any npm
scope (for example `@acme/demo-runtime`): the `plugins` list makes a package a plugin, not its scope. For a folder,
the runtime face is the `scenity.runtime` field of its `package.json`, else the first of `runtime.ts`,
`src/runtime.ts`, `runtime.js` and `src/runtime.js`. A folder plugin needs no `package.json`.

In `scenity.project.json`:

```json
"plugins": ["./plugins/hello"],
"sequences": ["sequences/main.sequence.json"]
```

Systems step with the clock of the scene. The scene page and the player run the clock while a sequence plays, so give
the scene a sequence (it needs no tracks). `sequences/main.sequence.json`:

```json
{ "format": "scenity.sequence/1", "id": "main", "scene": "main", "duration": 8000, "loop": true, "tracks": [] }
```

The plugin imports zod. Add the version of the engine to the project: `bun add zod@4.6.5`.

### 2. The component

`plugins/hello/component.ts`:

```ts
import { z } from "zod";
import { defineComponent } from "@scenity/scene/components";

export const bobSchema = z.strictObject({
  /** The height of the move in metres. */
  height: z.number().min(0).max(10).optional(),
  /** The time of one move up and down in ms. */
  period: z.number().int().min(100).optional(),
});
export type BobValue = z.infer<typeof bobSchema>;

export const bobComponent = defineComponent({
  id: "hello.bob", // the plugin ID, a dot and a name
  schema: bobSchema,
  defaults: { height: 0.2, period: 2000 },
  editor: {
    label: "Bob",
    group: "Hello",
    fields: {
      height: { widget: { kind: "number", unit: "m", min: 0, max: 10, step: 0.05 }, label: "Height" },
      period: { widget: { kind: "number", unit: "ms", min: 100, step: 100 }, label: "Period" },
    },
  },
});
```

The inspector of the editor makes its fields from the schema and the `editor` hints. You write no editor code.

### 3. The system

`plugins/hello/bob.ts`:

```ts
import type { Vec3 } from "@scenity/scene/math";
import { defineSystem } from "@scenity/runtime/systems";
import type { BobValue } from "./component";

export const bobSystem = defineSystem({
  id: "hello.bob",
  order: 0,
  reads: ["hello.bob", "transform"],
  update(ctx) {
    const entities = ctx.frame.scene.entities;
    for (const id of Object.keys(entities).sort()) {
      const components = entities[id]?.components ?? {};
      const bob = components["hello.bob"] as BobValue | undefined;
      if (bob === undefined) continue;
      const base = (components.transform as { position?: Vec3 } | undefined)?.position ?? [0, 0, 0];
      const phase = (2 * Math.PI * ctx.t) / (bob.period ?? 2000);
      const lift = ((bob.height ?? 0.2) * (1 - Math.cos(phase))) / 2;
      ctx.out.setTransform(id, { position: [base[0], base[1] + lift, base[2]] });
    }
  },
});
```

`ctx.t` is the simulation time in ms. The position is a function of `t` only, so the system has no memory. A system
that keeps memory (an angle that grows with `dt`) must give `save` and `restore`, so that a seek gives the frame of a
play. See `samples/spin/plugins/demo/src/systems/spin.ts`.

### 4. The runtime face

`plugins/hello/runtime.ts`:

```ts
import { defineRuntimePlugin } from "@scenity/runtime/definePlugin";
import { bobComponent } from "./component";
import { bobSystem } from "./bob";

export default defineRuntimePlugin({
  id: "hello",
  components: [bobComponent],
  systems: [bobSystem],
});
```

### 5. Use it

Restart `bun run dev`. A change of a plugin file reloads the page; a change of the project file needs a restart of
the dev server. Select the box, click **Add component…** in the inspector and choose **Bob**. Play the sequence (Space,
or Play in the file bar): the box moves up and down. Save, then `bun run build`: the plugin is a chunk of its own in
`dist/player/`, and the player runs it.

## The runtime face

`defineRuntimePlugin` (`@scenity/runtime/definePlugin`) takes:

| Field        | What it is                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `id`         | The plugin ID: a lower-case word. Each part ID below starts with it and a dot                  |
| `components` | `defineComponent` results: ID, zod schema, defaults, editor hints, optional version and `site` |
| `presenters` | A map from a component ID to a presenter that makes three.js objects for it                    |
| `systems`    | `defineSystem` results, or factories `() => defineSystem(...)` for systems with memory         |
| `simulation` | A `defineSimulation` result: the meaning of the `action` keys of a sequence                    |
| `input`      | A schema (any object with `safeParse`) of the plugin input that the page sends                 |
| `inputMap`   | A `defineInputMap` result: the key and pointer actions of play mode                            |

The plugin host refuses a plugin with a wrong ID, a part ID with another prefix, a presenter with no component and a
system that reads an unknown component. One error lists all the problems.

### Components

A component value is plain JSON in the scene file. Keep the schema strict (`z.strictObject`) and give defaults: a
document keeps only the values that differ from them. A component that changes its shape needs a new `version` and a
migration. The widget kinds of the editor hints: `number`, `vector`, `quaternion`, `colour`, `enum`, `boolean`,
`string`, `assetRef`, `entityRef`, `curve`, `list`, `map`, `object`, `custom`. With no hint, the inspector chooses a
widget from the schema.

### Presenters

A presenter turns one component value into a three.js object, which becomes a child of the entity object:

```ts
import type { Presenter } from "@scenity/runtime";

export const ringPresenter: Presenter<RingValue, Mesh> = {
  id: "hello.ring",
  create: (value) => makeRing(value),
  update: (ring, value) => {
    ring.scale.setScalar(value.size ?? 1);
    return true; // false: the builder disposes the object and creates it again
  },
  dispose: (ring) => {
    ring.geometry.dispose();
    (ring.material as Material).dispose();
  },
};
```

A presenter runs in the render worker, so it uses no DOM. `samples/spin/plugins/demo/src/presenter.ts` is a complete
one.

### Systems

A system runs in fixed steps of 60 per second at whole ms, after `evaluate()`. `ctx` has:

- `frame`: the evaluated frame state (the scene at `t`, the track samples, the simulation states);
- `input`: the plugin input (the `project` output of its simulation, else the page input of the plugin);
- `t` and `dt` in ms; `random(name)`: a seeded random stream of the system;
- `out`: `setTransform(id, { position?, rotation?, scale? })`, `setVisible(id, visible)` and `setValue(id, key, value)`;
- `inputs` in play mode: `events`, `pressed(action)`, `held(action)`.

The rules of determinism: no `Date.now`, no `Math.random`, no timers and no loop over a `Set` or a `Map` whose order
depends on input order. `bun run check:determinism` checks the `systems/` and `sim/` folders of each plugin in the
repository. A comment `// determinism: ordered` accepts one line.

### Simulation

A simulation gives the meaning of the `action` keys whose name starts with the plugin ID. It is pure:

```ts
import { z } from "zod";
import { defineSimulation } from "@scenity/scene/sequence";

const doorsState = z.strictObject({ open: z.array(z.string()) });
type DoorsState = z.infer<typeof doorsState>;

export const doorsSimulation = defineSimulation<DoorsState, { open: string[] }>({
  id: "doors",
  stateSchema: doorsState, // any object with safeParse
  initial: () => ({ open: [] }), // it gets the `initial.doors` value of the sequence
  reduce: (state, key) => (key.action === "doors.open" ? { open: [...state.open, String(key.args?.door)] } : state),
  settle: (state) => state, // the rules that run on the clock, with no key
  project: (state) => ({ open: state.open }), // the plugin input of the systems at t
});
```

The evaluator keeps checkpoints, so a seek replays at most one second of keys. `plugins/traffic/runtime/src/simulation.ts`
is a full example: cars that stop at a red signal and walkers that press a button. A `SimulationSource` can replace a
simulation with a live or recorded input (`liveSource`, `recordedSource` of a `scenity.stream/1` file).

### Input map

```ts
import { defineInputMap } from "@scenity/runtime/inputMap";

export const helloInput = defineInputMap({
  keys: { "hello.jump": ["Space"] }, // KeyboardEvent.code values
  pointer: { "hello.poke": { component: "hello.bob" } }, // a press on an entity with this component
});
```

In play mode the page turns DOM events into input events (`{ t, kind, action, entity?, point? }`). A system reads them
as `ctx.inputs`; a simulation gets them as action keys. Play mode records them as a `scenity.input/1` file, and a
replay gives the same frames.

## The dev face: debug layers and metrics

The dev face holds what only the editor and the checks need. It never goes into a player build.

- **Metrics for rules.** The `scenity.dev` field of the `package.json`, else `dev.ts` or `src/dev.ts`, names a module
  whose default export is `{ id, library }`. `library` lists metrics made with `defineMetric` of `@scenity/rules`.
  `scenity check` and the scene page of the editor load them, so a rule can name `hello.liftHeight`: the Rules panel
  shows its value, the save gate checks it, and the rules editor offers it in its metric picker.

```ts
import { z } from "zod";
import { defineMetric } from "@scenity/rules";

const liftHeight = defineMetric({
  id: "hello.liftHeight",
  label: "Lift height",
  unit: "m",
  args: z.strictObject({ entity: z.string() }),
  evaluate(ctx, args) {
    const entity = ctx.entity(args.entity);
    if (entity === undefined) return { value: null, unit: "m", detail: `no entity ${args.entity}` };
    return { value: entity.transform.position[1], unit: "m" };
  },
});
export default { id: "hello", library: [liftHeight] };
```

- **Debug layers.** The default export of the dev face can have `layers` too: `{ id, library, layers }`. A layer has a
  `name` (a word with `-`), an optional `label`, an `order` and `scene(draw, input, data)`, which draws lines and
  points (`draw.line(from, to, rgb)`, `draw.point(at, rgb)`). `data.builder` gives the entities of the scene now
  (`entityIds()`, `componentIds(id)`, `entityObject(id)`). The editor lists the layer in View options → Debug layers
  (and `debug=<name>` in the URL). A lab plugin core uses `defineDevPlugin` of `@scenity/runtime-dev/devLayers`. The
  generic layers (`bounds`, `sockets`, `obstacles`, `paths`, `skeleton`, `wireframe`, `normals`, `lights`, `cameras`)
  need no plugin.

The traffic plugin (`plugins/traffic/runtime/src/dev.ts`) has the metric `traffic.vehicleGap`, which a rule of the
sim-road sample names, and the layer `traffic-gaps`: a line between each two vehicles, the nearest two in red.

## The studio face

The studio face adds parts to the editor window, through the points of [studio-plugins.md](studio-plugins.md). The `scenity.studio` field of the `package.json` (else
`studio.ts` or `src/studio.ts`) names a module whose default export is `defineStudioPlugin(...)` of
`@scenity/editor/studio`. A player build never has this code.

```ts
import { defineStudioPlugin } from "@scenity/editor/studio";

export default defineStudioPlugin({
  id: "hello",
  apiVersion: 1,
  // The Fluent files of the plugin: i18n/<locale>/<name>.ftl.
  texts: import.meta.glob<string>("./i18n/*/*.ftl", { query: "?raw", import: "default", eager: true }),
  contributes: {
    panels: [{ id: "hello.stats", title: "hello-stats-title", area: "right", component: () => import("./Stats.vue") }],
    commands: [
      {
        id: "hello.selectBobbing",
        title: "hello-select-bobbing",
        agents: true,
        run: (ctx) => ctx.selection.set(ctx.documents.entities("hello.bob").map((entity) => entity.id)),
      },
    ],
  },
});
```

- **The points.** `contributes` takes `panels`, `commands` (with `menu: "entity/demo"` for the menu bar),
  `componentIcons`, `widgets` (the renderer of a `custom` hint: it gets `value`, `label` and `set`), `createPresets`,
  `overlays` (over the Scene view), `toolbar`, `sceneTools` (a toggle of the toolbar that takes the pointer input of
  the view, with handles that the person drags), `previews` (an asset kind in the asset inspector), `statusItems`, `problemSources`, `pageTools` (tools of
  the agents in the window; the name starts with the plugin ID and `_`), `contextLines`, `recipes`, `settings` (a JSON
  Schema: a section of Preferences with the values of the person, or with `scope: "project"` a section of Project
  settings with the values in `.scenity/plugin-settings.json` of the project; either way the values are in
  `ctx.settings`), `menus` (an item of the context menu of a hierarchy row, `menu: "hierarchy"`, or of the empty tree,
  `"hierarchy.empty"`; the command of a row item gets `{ entity }`) and `docs` (`panel:<id>`, `component:<id>`, and
  `command:<id>`, which the search box shows as a **?** link of the command and F1 opens).
- **The context.** Each contribution gets `ctx`: `documents` (the entities of the open scene as frozen views, with a
  listener of changes), `selection`, `commands.run(id, args)` (edits go through commands, so they get undo and an
  agent tool), `panels.open(id)`, `notify.toast(title, text)` and `t(id, args)` (the texts of the plugin). A panel
  component gets `ctx` as a prop.
- **The hooks of a panel.** `@scenity/editor/studio` also gives the services of the shell to the component of a
  panel: `usePanelState(key, fallback)` (a value that the layout keeps with the panel, as a search text or a filter),
  `usePanelVisible()` (true while the tab of the panel shows), `useAgentAsk()` (`can`, and `ask(prompt)` for the agent
  panel) and the component `EmptyState` (the empty state of a panel, with **Ask the agent**). The core panels (the
  hierarchy, the inspector, the Project window, the Console, Problems, the Timeline and the agent panel) use the same
  hooks; a test fails when one of them takes a part of the shell from another module.
- **IDs.** Each contribution ID starts with the plugin ID and a dot (`hello.stats`); a command ID is camelCase words.
  The panel opens with `panel.open.<id>` and from the Window menu.
- **Errors.** Each panel renders in an error boundary: an error shows a card with Try again in its place, goes into
  the Console with the source "plugin" and shows in Problems; the editor works on. The URL parameter `safe=1` loads no
  studio face.
- **Versions.** `apiVersion` is a whole number. The editor takes the current version and the one before; an older one
  gives a warning in the Console, a newer one is not loaded.

The demo plugin of the spin sample (`samples/spin/plugins/demo/src/studio.ts`) is the reference: it has one example of
each point (the panel "Spinners", the widget `demo.speedDial`, the preset "Spinner", the scene tool "Count clicks" and
the others). [studio-plugins.md](studio-plugins.md) is a guide to each point, with its fields, its example and its test,
and the steps of a first panel.

## The editor face

The scene page needs no editor face: it shows plugin components in the inspector from their schemas. The editor face
is for the lab page (`apps/editor` `index.html`), a second editor with panes, takes and a content browser for a
plugin with its own scene core. The `scenity.editor` field (else `editor.ts` or `src/editor.ts`) names a module whose
default export is an `EditorPlugin` (`apps/editor/src/core/plugin.ts`): commands, op kinds, tabs, cameras, the take
model, checks, the content browser, dock tabs, overlays, script API methods, bridge calls, page tools for Claude and
context lines.

The editor config face (`scenity.editorConfig`, else `editorConfig.ts` or `src/editorConfig.ts`) gives the Vite parts
of the editor: `plugins`, `workerPlugins`, `alias`, `proxy`, `fsAllow`, `styles`, `content`, `stills` and
`defaultTake`. The editor writes the generated plugin list into `<project>/.scenity/editor`.

## The host face

The workbench host loads the host face of each plugin (`scenity.host`, else `host.ts` or `src/host.ts`). It adds MCP
tools for Claude, runs, surfaces and a stop gate:

```ts
import { z } from "zod";
import { defineHostPlugin, defineTool, textResult } from "@scenity/workbench-host/plugin";

const countTool = defineTool({
  name: "hello_count",
  description: "Count the entities with the hello.bob component in the open project.",
  input: z.object({}),
  alwaysLoad: false,
  async handler(_input, ctx) {
    return textResult(`project: ${ctx.projectDir ?? ctx.checkout}`);
  },
});

export default defineHostPlugin({
  id: "hello",
  tools: [countTool],
  contextLines: {},
  runs: { commands: { bench: "scenity bench --quick" } },
  paths: {},
  toolNotes: { scene_query: "The bobbing entities have the component hello.bob." },
});
```

A tool with the name of a core tool replaces it. `runs` adds runs to the Runs tab (the project `workbench.runs` comes
after them). `gateCheck` gives a fast stop gate. `@scenity/workbench-host` is a checkout-only package: a host face
works when the host runs from a checkout.

Scenity Studio reads the same module for the points that need Bun, the disk or the network, and ignores the parts of
the workbench. The project must be trusted (a restricted project loads no host face):

- **`assetSources`**: providers of assets (the `AssetProvider` of `@scenity/assets`: `id`, `name`, `kinds`, the
  `rights` record of its items, `search(kind, text)`, `preview(id)` and `files(id, kind)`). Get assets of the Project
  panel lists them beside Poly Haven; an import writes the files and the rights record `rights/<id>.yaml`. A URL can be
  a `file:` URL of the plugin folder. `samples/spin/plugins/demo/src/host.ts` gives the source "Demo patterns".
- **`publishTargets`**: places of a publish (`id`, `title`, `publish({ zip, dist, dir, project })`, which gives a
  text for the person). After a publish that passes, the Build panel shows **Send to <title>** for each one; the
  target gets the archive of the last publish. The spin sample gives "The published folder" (a copy in
  `published/` of the project).
- **`importers`**: importers of the file types of the plugin (the `Importer` of `@scenity/assets/import`: `name`,
  `version`, `extensions`, `kinds`, a Zod `schema` of the settings, `parseSettings(raw)` and
  `run({ id, kind, source, outDir, settings })`, which writes the files of the asset into `outDir`). The Import of the
  Project panel takes a file of such a type (the import dialog has the form of the settings), the asset reloads with
  it, and `scenity assets import` and `scenity assets build` use it too. An importer whose name or extension has an
  importer already is left out with a warning. The spin sample imports a `.pattern` file as an asset of the kind
  `demo.pattern`, which the `previews` point of its studio face shows.
- **`tools`**: the same tools as for the workbench (`name`, `description`, a Zod `input`, `handler`). The agent
  sessions of the studio get them beside the core tools; a tool with the name of a core tool is left out, with a
  warning. Each tool is also a command of the search box of the editor window (`tool.<name>` in camelCase, the title
  "Run the plugin tool <name>"): a run asks for each field of the input schema (its `describe` text is the label),
  runs the tool on the host and shows its text in a toast and the Console. The context of a run from the search box
  has the editor windows of the project and no session. The spin sample gives `demo_spin_time`. The host face imports
  `zod` from the `node_modules` of the plugin, so a plugin with tools needs its packages installed.

## Project templates

A plugin package of the checkout can give templates to the new project wizard of the Hub.
The field `scenity.templates` of its `package.json` lists them; each `folder` is a project folder in the package:

```json
{
  "name": "@acme/traffic-runtime",
  "scenity": {
    "templates": [
      {
        "id": "crossing",
        "title": "Road crossing",
        "description": "A road with a crossing.",
        "folder": "templates/crossing"
      }
    ]
  }
}
```

The wizard shows each template after the built-in ones (the picture is the first poster or still of the folder). A
new project is a copy of the folder (`scenity create --from`), with no outputs and no local state. A folder outside
the package, or with no `scenity.project.json`, is left out.

## The CLI face

The `scenity.cli` field of the `package.json` (no file search) names a module whose default export is a `CliFace`:

```ts
import type { CliFace } from "@scenity/cli";

const face: CliFace = {
  commands: [
    {
      name: "hello",
      summary: "say hello to the project",
      run: (argv, { project }) => {
        console.log(`hello ${project} ${argv.join(" ")}`);
        return 0; // the exit code
      },
    },
  ],
};
export default face;
```

`scenity hello` then runs it, and `scenity --help` lists it. A command of the CLI wins over a plugin command of the
same name. The face runs in the CLI process; a command that needs more starts its own process.

## The markers face

`scenity build` fails when a player build holds dev code. A plugin with dev parts names its own markers in the
`scenity.markers` field, else `markers.ts` or `src/markers.ts`:

```ts
export default {
  markers: [{ id: "hello.debug", what: "the debug text of hello", text: "hello.debug" }],
  modules: [{ id: "hello-dev", what: "the dev part of hello", pattern: "/plugins/hello/dev/" }],
};
```

A marker has `text` (a quoted string in the scripts) or `pattern` (a RegExp), and a `kind` (`lab`, `dev` or `info`).
A module marker matches a module path in the source maps.

## Plugins in this repository

A plugin inside the Scenity checkout (`plugins/<name>/<face>`) also follows the rules of the repository:

- each face is a workspace package `@scenity/<name>-<face>` with the `scenity` field in its `package.json`;
- the boundary rules (`bun run check:boundaries`): a plugin can import every engine package, and no engine package imports
  a plugin;
- the code shape: at most 500 lines per file and 80 per function (`bun run check:shape`). A plugin keeps its own
  exceptions in `plugins/<name>/shape-exceptions.json`, with paths relative to the plugin folder; split a large unit
  before you add an exception;
- the licence header on each source file, and code comments in ASD-STE100 Simplified Technical English;
- tests next to the plugin (`plugins/<name>/<face>/tests`), run by `bun test ./plugins`.
