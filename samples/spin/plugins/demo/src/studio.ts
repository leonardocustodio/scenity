// SPDX-License-Identifier: Apache-2.0
/**
 * The studio face of the demo plugin (docs/studio-plugins.md): the reference example of the API of the editor window.
 * It has one example of each point that a scene page has: the panel "Spinners", the command `demo.selectSpinners` in
 * Entity → Demo, the icon of `demo.spin`, the widget `demo.speedDial`, the create preset "Spinner", an overlay, a
 * status item, a problem source, a page tool of the agents, the context lines, the docs link of the panel, a toolbar
 * button, the scene tool "Count clicks", the scene tool "Place the spinners" with a handle at each spinner, a recipe,
 * the settings of the plugin in Project settings and the preview of the asset kind `demo.pattern`. Its texts are the
 * Fluent files of `src/i18n`. A player build never has this code: the build takes the runtime face only.
 */
import { defineStudioPlugin, type StudioContext } from "@scenity/editor/studio";
import spinIcon from "./icons/spin.svg?url";

/** The turn speed above which a spinner gets a warning in Problems (degrees per second), else the setting. */
const FAST = 360;
/** The turn speed of the create preset (degrees per second). */
const DEFAULT_PRESET_SPEED = 90;
const fastOf = (ctx: StudioContext): number => {
  const value = ctx.settings.value().fast;
  return typeof value === "number" ? value : FAST;
};

/** The place of an entity of the demo: its transform. The spinners have no parent, so it is the world place. */
const placeOf = (components: Readonly<Record<string, unknown>>): [number, number, number] => {
  const position = (components.transform as { position?: [number, number, number] } | undefined)?.position;
  return position === undefined ? [0, 0, 0] : [...position];
};

const spinners = (ctx: StudioContext) =>
  ctx.documents.entities("demo.spin").map((entity) => ({
    id: entity.id,
    name: entity.name ?? entity.id,
    speed: (entity.components["demo.spin"] as { speed?: number } | undefined)?.speed ?? 90,
  }));

export default defineStudioPlugin({
  id: "demo",
  apiVersion: 1,
  texts: import.meta.glob<string>("./i18n/*/*.ftl", { query: "?raw", import: "default", eager: true }),
  contributes: {
    panels: [
      {
        id: "demo.spinners",
        title: "demo-spinners-title",
        area: "right",
        component: () => import("./SpinnersPanel.vue"),
      },
    ],
    commands: [
      {
        id: "demo.selectSpinners",
        title: "demo-select-spinners",
        agents: true,
        menu: "entity/demo",
        when: (ctx) => (spinners(ctx).length === 0 ? ctx.t("demo-no-spinners") : null),
        run: (ctx) => ctx.selection.set(spinners(ctx).map((entity) => entity.id)),
      },
      {
        // The command of the item of the context menu of a hierarchy row (it gets the entity of the row).
        id: "demo.makeSpinner",
        title: "demo-make-spinner",
        args: { entity: { type: "string", description: "The entity" } },
        run: (ctx, args) => ctx.commands.run("component.add", { entity: args.entity, component: "demo.spin" }),
      },
    ],
    menus: [{ menu: "hierarchy", command: "demo.makeSpinner", label: "demo-make-spinner" }],
    componentIcons: { "demo.spin": spinIcon },
    widgets: { "demo.speedDial": () => import("./SpeedDial.vue") },
    createPresets: [
      {
        id: "demo.spinner",
        label: "demo-preset-spinner",
        name: "Spinner",
        icon: "rotate-cw",
        components: { shape: { kind: "box", size: [0.4, 0.4, 0.4] }, "demo.spin": { speed: DEFAULT_PRESET_SPEED } },
      },
    ],
    overlays: [
      { id: "demo.readout", title: "demo-readout-title", edge: "top", component: () => import("./SpinReadout.vue") },
    ],
    statusItems: [
      {
        id: "demo.count",
        text: (ctx) => ctx.t("demo-status", { count: spinners(ctx).length }),
        command: "demo.selectSpinners",
      },
    ],
    problemSources: [
      {
        id: "demo.fast",
        problems: (ctx) =>
          spinners(ctx)
            .filter((spinner) => Math.abs(spinner.speed) > fastOf(ctx))
            .map((spinner) => ({
              key: spinner.id,
              level: "warn" as const,
              title: ctx.t("demo-problem-fast", { name: spinner.name, speed: spinner.speed, max: fastOf(ctx) }),
              entities: [spinner.id],
            })),
      },
    ],
    pageTools: [
      {
        name: "demo_spinners",
        description: "List the entities of the open scene with the component demo.spin and their turn speed (deg/s).",
        input: { type: "object", properties: {}, additionalProperties: false },
        run: (ctx) => JSON.stringify(spinners(ctx)),
      },
    ],
    contextLines: (ctx) => [`Spinners (demo.spin): ${String(spinners(ctx).length)}.`],
    docs: {
      "panel:demo.spinners": "https://github.com/leonardocustodio/scenity/blob/main/docs/plugins.md#the-studio-face",
      "command:demo.selectSpinners":
        "https://github.com/leonardocustodio/scenity/blob/main/docs/plugins.md#the-studio-face",
    },
    toolbar: [{ id: "demo.selectAll", title: "demo-select-spinners", icon: spinIcon, command: "demo.selectSpinners" }],
    sceneTools: [
      {
        id: "demo.countClicks",
        title: "demo-tool-count",
        icon: spinIcon,
        // While the tool is active, each press on the Scene view counts. The toast shows the count.
        activate: (ctx, view) => {
          let count = 0;
          const press = (): void => {
            count += 1;
            ctx.notify.toast(ctx.t("demo-tool-counted", { count }));
          };
          view.canvas.addEventListener("pointerdown", press);
          return () => view.canvas.removeEventListener("pointerdown", press);
        },
      },
      {
        // A tool with handles: a dot at each spinner. A drag moves the spinner on its level, as one step.
        id: "demo.placeSpinners",
        title: "demo-tool-place",
        icon: spinIcon,
        activate: () => () => undefined,
        handles: (ctx) =>
          ctx.documents.entities("demo.spin").map((entity) => ({
            id: entity.id,
            point: placeOf(entity.components),
            label: ctx.t("demo-handle", { name: entity.name ?? entity.id }),
          })),
        moveHandle: (ctx, id, point, done) => {
          if (done) void ctx.commands.run("entity.move", { entity: id, x: point[0], z: point[2] });
        },
      },
    ],
    recipes: [
      {
        id: "demo.slowDown",
        title: "demo-recipe-slow",
        prompt: "Set the speed of each spinner (demo.spin) to {speed} deg/s, with one command for each entity.",
        params: [{ name: "speed", label: "Speed (deg/s)", default: "45" }],
      },
    ],
    // A project setting: a section of Project settings, with the value in `.scenity/plugin-settings.json`.
    settings: {
      title: "demo-settings-title",
      scope: "project",
      schema: {
        type: "object",
        properties: {
          fast: { type: "number", minimum: 0, description: "The speed of a warning in Problems (deg/s)." },
        },
      },
    },
    previews: [{ kind: "demo.pattern", component: () => import("./PatternPreview.vue") }],
  },
});
