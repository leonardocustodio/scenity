# The studio face: a guide to each point

The studio face of a plugin adds parts to the editor window of Scenity Studio. [plugins.md](plugins.md#the-studio-face)
tells how the face loads, its context, its IDs, its errors and its versions. This guide takes each contribution point
in turn: what it adds, where the person sees it, its fields, an example, and how to test it.

Each example comes from the demo plugin of the spin sample (`samples/spin/plugins/demo/src/studio.ts`), the reference
plugin. Open the sample to see each point work:

```sh
scenity studio --project samples/spin
```

Every point is a field of `contributes` in `defineStudioPlugin(...)` of `@scenity/editor/studio`. A text of a point
is a Fluent ID of the plugin (its `texts`), not English in code. Each ID starts with the plugin ID and a dot.

## Your first panel in 15 minutes

1. Make the plugin in the Plugins window (File menu): **A new plugin**, tick **A studio panel**, then **Make the
   plugin**. The wizard writes `plugins/<id>/src/studio.ts`, the panel `src/Panel.vue` and the Fluent file
   `src/i18n/en-US/<id>.ftl`, and adds the plugin to the project. (Or copy `samples/spin/plugins/demo` and change its
   ID.)
2. Trust the project (Hub → the project menu → **Trust this project**): a restricted project loads no plugin code.
3. Change the component of the panel. It gets `ctx` as a prop:

   ```vue
   <script setup lang="ts">
   import { EmptyState, usePanelState, type StudioContext } from "@scenity/editor/studio";
   import { computed, onBeforeUnmount, ref } from "vue";

   const props = defineProps<{ ctx: StudioContext }>();
   const filter = usePanelState("filter", "");
   const tick = ref(0);
   const stop = props.ctx.documents.listen(() => (tick.value += 1));
   onBeforeUnmount(stop);
   const names = computed(() => {
     void tick.value;
     return props.ctx.documents
       .entities("hello.bob")
       .map((entity) => entity.name ?? entity.id)
       .filter((name) => name.includes(filter.value));
   });
   </script>

   <template>
     <input v-model="filter" :aria-label="ctx.t('hello-filter')" />
     <EmptyState v-if="names.length === 0" panel="hello.stats" :text="ctx.t('hello-none')" />
     <ul v-else>
       <li v-for="name in names" :key="name">{{ name }}</li>
     </ul>
   </template>
   ```

4. Save. The window loads the new code with no reload (a hot update of the studio face). Open the panel from the
   Window menu or with the search box (`panel.open.hello.stats`).

## panels

**What it adds.** A dock panel: a tab that the person can move, float, split and close, like a core panel.

**Where.** The area of `area` in the default layout (`left`, `right`, `bottom` or `floating`; default `right`), the
Window menu, the search box (`panel.open.<id>`).

**Fields.** `id`, `title` (a Fluent ID), `icon` (the URL of an SVG file: `import icon from "./icon.svg?url"`; default
the icon of plugins), `area`, `component` (a lazy import: the code loads at the first open).

**Example.** `demo.spinners` lists the entities with `demo.spin`, with Select.

**The hooks.** A panel component imports the services of the shell from `@scenity/editor/studio` only:
`usePanelState(key, fallback)` (the layout keeps the value with the panel), `usePanelVisible()` (true while its tab
shows), `useAgentAsk()` (send a prompt to the agent panel), `useViewerReason()` (the reason why a viewer of a review link
changes nothing, or null: show the controls that change the project off with it, not hidden),
`useRoleReason(action)` (the reason why the role of the window does not do an action, or null: `owner` for an action
of the owner of the studio, `shell` for a shell terminal, `auto` for the Auto mode of an agent, `files` for a file
write of an agent in remote mode) and `EmptyState`. The core panels use the same hooks.
`EmptyState` shows the text of `text`, else the Fluent message `empty-<panel>` (`empty-hello-stats` for
`hello.stats`); **Ask the agent** sends `empty-prompt-<panel>`, so give both messages in the Fluent file of the plugin.

**Test.** Mount the component with `@vue/test-utils` and a fake `ctx` (`studio-plugins.vitest.ts` of the editor has
one). An e2e opens the panel with `__scenity.command("panel.open.<id>")`.

## commands

**What it adds.** A command of the window: the search box finds it, a key can run it, a menu can show it, and with
`agents: true` the agents can run it too.

**Fields.** `id` (camelCase words after the dot), `title`, `keys` (as `["Mod+Shift+K"]`), `args` (each argument with
its type and description: the search box asks for them, and the agent tool takes them), `agents`, `menu` (a menu of
the menu bar: `entity/demo` puts it in Entity → Demo; the Fluent ID `menu-entity-demo` names the submenu), `when(ctx)`
(the reason why it cannot run now, or null: the menu item is off and says why) and `run(ctx, args)`.

**Edits.** A command that changes a document runs editor commands (`ctx.commands.run("component.add", …)`), so the
change has undo, a place in the history and a proposal when an agent runs it.

**Example.** `demo.selectSpinners` (Entity → Demo; off with "No spinner" when the scene has none).

## menus

**What it adds.** An item of a context menu: `hierarchy` (the menu of an entity row: the command gets `{ entity }`)
or `hierarchy.empty` (the menu of the empty tree).

**Fields.** `menu`, `command` (a command of the plugin or of the editor), `label`.

**Example.** "Make it a spinner" on a hierarchy row runs `demo.makeSpinner` with the entity of the row.

## componentIcons

**What it adds.** The icon of a component of the plugin in the hierarchy, the inspector and the Add component list.

**Fields.** A map of the component ID to the URL of an SVG file.

**Example.** `{ "demo.spin": spinIcon }`.

## widgets

**What it adds.** The field editor of a `custom` hint of a component of the plugin, in the inspector.

**Fields.** A map of the hint name to a lazy component. The widget gets `ctx`, `value`, `label` and `set(value)`; one
`set` is one undo step.

**Example.** `demo.speedDial`: a slider from -720 to 720 deg/s for the speed of `demo.spin` (the schema of the
component names the hint).

## createPresets

**What it adds.** An entry of Entity → Create and of the + menu of the hierarchy: a new entity with components.

**Fields.** `id`, `label`, `name` (the name of the new entity), `icon` (the name of a lucide icon), `components`.

**Example.** "Spinner": a box of 0.4 m with `demo.spin` at 90 deg/s.

## overlays

**What it adds.** A small panel over the Scene view, as the tools and View options overlays.

**Fields.** `id`, `title`, `edge` (`top`, `right`, `bottom` or `left`), `order`, `component` (it gets `ctx`).

**Example.** `demo.readout`: the count of spinners over the view; it changes with the scene.

## toolbar

**What it adds.** A button of the toolbar of the Scene view that runs a command.

**Fields.** `id`, `title` (the tooltip and the name of the button), `icon` (the URL of an SVG file), `command`.

## sceneTools

**What it adds.** A tool of the Scene view: a toggle of the toolbar. While it is on, it takes the pointer input of
the view; Escape or a second press turns it off.

**Fields.** `id`, `title`, `icon`, `activate(ctx, { canvas })`, which adds its listeners and gives a function that
takes them out; `handles(ctx)` (the handles while the tool is on: `{ id, point, label }`, a world point and its name)
and `moveHandle(ctx, id, point, done)`. The editor draws each handle as a dot over the view (it reads the handles at
each frame) and a drag moves it on the level plane of its point: `moveHandle` gets the new point at each move
(`done` false) and at the release (`done` true). Run the edit command at the release, so the move is one undo step.

**Example.** "Count clicks": each press on the view adds one to a count, and a toast shows it. "Place the spinners":
a handle at each spinner; a drag moves the spinner with `entity.move` at the release.

## previews

**What it adds.** The preview of an asset kind in the asset inspector of the Project window.

**Fields.** `kind` (the asset kind) and `component` (it gets `asset` and `url`, the URL of the source file).

**Example.** `demo.pattern`: a ring and the name of the asset.

## statusItems

**What it adds.** An item of the status bar. The bar reads its text again after each change of the scene or of the
selection; a press runs its command.

**Fields.** `id`, `text(ctx)`, `title(ctx)` (the tooltip), `command`.

**Example.** `demo.count`: "3 spinners"; a press selects them.

## problemSources

**What it adds.** Problems of the plugin in the Problems panel and in the count of the status bar. The panel runs each
source after each change of the scene.

**Fields.** `id` and `problems(ctx)`, which gives a list (or a promise of a list) of `{ key, level, title, detail,
entities, fixes }`. Go to selects the `entities`; each fix is a button.

**Example.** `demo.fast`: a warning for each spinner faster than the setting `fast` (default 360 deg/s).

## settings

**What it adds.** A section of Preferences (`scope: "user"`, the default: the values of the person in this browser)
or of Project settings (`scope: "project"`: the values in `.scenity/plugin-settings.json` of the project, shared
through Git). The form comes from the JSON Schema; the values are in `ctx.settings.value()`, and
`ctx.settings.listen(listener)` tells of a change.

**Fields.** `title`, `schema` (an object schema), `scope`.

**Example.** The project setting `fast` of the demo plugin.

## recipes

**What it adds.** A saved prompt of the agents with parameters: a command `recipe.<id>` of the search box, an item of
Agent → Recipes and of `/` in the composer.

**Fields.** `id`, `title`, `prompt` (each `{name}` is a parameter), `params` (`name`, `label`, `default`).

**Example.** "Slow the spinners down": the agent sets each speed to `{speed}` with one command for each entity.

## pageTools

**What it adds.** A tool of the agents that runs in the editor window, beside the core tools.

**Fields.** `name` (the plugin ID and `_`, then lower-case words with `_`), `description` (for the model: what it
gives and when to use it), `input` (an object JSON Schema), `run(ctx, input)`, which gives the text of the result.

**Example.** `demo_spinners`: the spinners and their speeds as JSON.

## contextLines

**What it adds.** Lines of the plugin in the context packet that the agent gets with each prompt.

**Fields.** A function `contextLines(ctx)` that gives the lines. Keep them short: the packet has a budget.

**Example.** "Spinners (demo.spin): 3."

## docs

**What it adds.** Docs links: F1 on a panel of the plugin, the docs button of a component card, and the **?** link of a
command in the search box.

**Fields.** A map of `panel:<id>`, `component:<id>` or `command:<id>` to a URL.

## texts

**What it adds.** The Fluent files of the plugin, in the language of the page; a locale with no file uses en-US.

**Fields.** `texts` of the definition (not of `contributes`): the files by path, from `import.meta.glob(...)`. A file
is `i18n/<locale>/<name>.ftl`.

## A lab face in the studio

A plugin with a lab face (`EditorPlugin`) can run in the studio through `adaptLabFace`: its tabs become panels, its
take model the Takes panel, its tools page tools and its context lines the lines of the agents. The parts that need
the lab page are in `kept`. [lab-to-studio.md](lab-to-studio.md#the-adapter) has the details and the steps of a move
part by part.

## The host face: tools, asset sources and publish targets

Four more points live in the host face (`src/host.ts`), because they need Bun, the disk or the network. See
[plugins.md](plugins.md#the-host-face): `tools` (agent tools that run in the studio host, and commands of the search
box), `importers` (the import of a file type of the plugin), `assetSources` (a source of Get assets) and
`publishTargets` (Send to … of the Build panel). A plugin package can
also give project templates to the new project wizard ([plugins.md](plugins.md#project-templates)).
