// SPDX-License-Identifier: Apache-2.0
/**
 * The files of a new folder plugin (the new plugin wizard): the package.json with the faces, the runtime face with a
 * component of the fields of the person, and the parts that the person selects. The parts are a system (an update
 * that reads the component), a presenter (a three.js object for the component), a simulation (the meaning of the
 * action keys of a sequence), a metric of the rules (the dev face) and a studio panel (the studio face with its texts).
 * The texts of the code are short: the agent or the owner writes the logic. Pure functions, no disk.
 */

/** A part that the person selects. */
export type PluginPart = "system" | "presenter" | "simulation" | "metric" | "studio";

/** The parts in the order of the wizard. */
export const PLUGIN_PARTS: readonly PluginPart[] = ["system", "presenter", "simulation", "metric", "studio"];

/** A field of the component: its name and its kind. */
export interface PluginField {
  readonly name: string;
  readonly kind: "number" | "boolean" | "text";
}

/** The request of the wizard. */
export interface PluginRequest {
  /** The plugin ID: a lower-case word. It is the folder name and the prefix of each ID. */
  readonly id: string;
  /** The name of the component (camelCase). */
  readonly component: string;
  readonly fields: readonly PluginField[];
  readonly parts: readonly PluginPart[];
}

const WORD = /^[a-z][a-z0-9]{0,31}$/;
const NAME = /^[a-z][A-Za-z0-9]{0,31}$/;
const HEADER = "// SPDX-License-Identifier: Apache-2.0\n";

/** The reason why a request is not valid, or null. */
export function requestProblem(request: PluginRequest): string | null {
  if (!WORD.test(request.id)) return "the plugin ID is a lower-case word (letters and digits)";
  if (!NAME.test(request.component)) return "the component name is a camelCase word";
  const names = request.fields.map((field) => field.name);
  if (names.some((name) => !NAME.test(name))) return "each field name is a camelCase word";
  if (new Set(names).size !== names.length) return "two fields have the same name";
  if (request.parts.some((part) => !PLUGIN_PARTS.includes(part))) return "an unknown part";
  return null;
}

const ZOD: Readonly<Record<PluginField["kind"], string>> = {
  number: "z.number()",
  boolean: "z.boolean()",
  text: "z.string()",
};
const DEFAULTS: Readonly<Record<PluginField["kind"], string>> = { number: "0", boolean: "false", text: '""' };
const WIDGETS: Readonly<Record<PluginField["kind"], string>> = {
  number: '{ kind: "number" }',
  boolean: '{ kind: "boolean" }',
  text: '{ kind: "text" }',
};

const label = (name: string): string => {
  const words = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

function componentFile(request: PluginRequest): string {
  const id = `${request.id}.${request.component}`;
  const schema = request.fields.map((field) => `  ${field.name}: ${ZOD[field.kind]}.optional(),`).join("\n");
  const defaults = request.fields.map((field) => `${field.name}: ${DEFAULTS[field.kind]}`).join(", ");
  const hints = request.fields
    .map(
      (field) =>
        `      ${field.name}: { widget: ${WIDGETS[field.kind]}, label: ${JSON.stringify(label(field.name))} },`,
    )
    .join("\n");
  return `${HEADER}/** The component \`${id}\`. */
import { z } from "zod";
import { defineComponent } from "@scenity/scene/components";

export const schema = z.strictObject({
${schema}
});
export type Value = z.infer<typeof schema>;

export const component = defineComponent({
  id: ${JSON.stringify(id)},
  schema,
  defaults: { ${defaults} },
  editor: {
    label: ${JSON.stringify(label(request.component))},
    group: ${JSON.stringify(label(request.id))},
    fields: {
${hints}
    },
  },
});
`;
}

function systemFile(request: PluginRequest): string {
  const id = `${request.id}.${request.component}`;
  return `${HEADER}/** The system \`${id}\`: it reads each entity with the component \`${id}\`. */
import { defineSystem, type SystemDefinition } from "@scenity/runtime/systems";
import type { Value } from "../component";

export function system(): SystemDefinition {
  return defineSystem({
    id: ${JSON.stringify(id)},
    order: 0,
    reads: [${JSON.stringify(id)}, "transform"],
    update(ctx) {
      for (const [entity, value] of Object.entries(ctx.frame.scene.entities)) {
        const data = value.components[${JSON.stringify(id)}] as Value | undefined;
        if (data === undefined) continue;
        // Write the logic here: for example ctx.out.setTransform(entity, { position: [...] }).
        void entity;
      }
    },
  });
}
`;
}

function presenterFile(request: PluginRequest): string {
  const id = `${request.id}.${request.component}`;
  return `${HEADER}/** The presenter of \`${id}\`: a three.js object for each entity with the component. It runs in the worker. */
import { BoxGeometry, Mesh, MeshStandardMaterial, type Material } from "three";
import type { Presenter } from "@scenity/runtime";
import type { Value } from "./component";

export const presenter: Presenter<Value, Mesh> = {
  id: ${JSON.stringify(id)},
  create: () => new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshStandardMaterial({ color: "#4f9cf7" })),
  // Write the logic here: change the object from the value; false makes the object again.
  update: () => true,
  dispose: (mesh) => {
    mesh.geometry.dispose();
    (mesh.material as Material).dispose();
  },
};
`;
}

function simulationFile(request: PluginRequest): string {
  const action = `${request.id}.step`;
  return `${HEADER}/** The simulation of the plugin \`${request.id}\`: the meaning of its action keys (\`${action}\`). It is pure. */
import { z } from "zod";
import { defineSimulation } from "@scenity/scene/sequence";

const state = z.strictObject({ steps: z.number().int().min(0) });
type State = z.infer<typeof state>;

export const simulation = defineSimulation<State, { steps: number }>({
  id: ${JSON.stringify(request.id)},
  stateSchema: state,
  initial: () => ({ steps: 0 }),
  // Write the logic here: each action key of the plugin changes the state.
  reduce: (now, key) => (key.action === ${JSON.stringify(action)} ? { steps: now.steps + 1 } : now),
  settle: (now) => now,
  project: (now) => ({ steps: now.steps }),
});
`;
}

function runtimeFile(request: PluginRequest): string {
  const system = request.parts.includes("system");
  const presenter = request.parts.includes("presenter");
  const simulation = request.parts.includes("simulation");
  const id = `${request.id}.${request.component}`;
  const imports = [
    ...(system ? [`import { system } from "./systems/${request.component}";`] : []),
    ...(presenter ? ['import { presenter } from "./presenter";'] : []),
    ...(simulation ? ['import { simulation } from "./sim/simulation";'] : []),
  ];
  const fields = [
    ...(presenter ? [`  presenters: { ${JSON.stringify(id)}: presenter },`] : []),
    ...(system ? ["  systems: [system],"] : []),
    ...(simulation ? ["  simulation,"] : []),
  ];
  return `${HEADER}/** The runtime face of the plugin \`${request.id}\`. */
import { defineRuntimePlugin } from "@scenity/runtime/definePlugin";
import { component } from "./component";
${imports.map((line) => `${line}\n`).join("")}
export default defineRuntimePlugin({
  id: ${JSON.stringify(request.id)},
  components: [component],
${fields.map((line) => `${line}\n`).join("")}});
`;
}

function devFile(request: PluginRequest): string {
  const id = `${request.id}.${request.component}Count`;
  return `${HEADER}/** The dev face of the plugin \`${request.id}\`: the metric \`${id}\` of the rules. */
import { z } from "zod";
import { defineMetric } from "@scenity/rules";

const count = defineMetric({
  id: ${JSON.stringify(id)},
  label: ${JSON.stringify(`${label(request.component)} count`)},
  unit: "",
  args: z.strictObject({}),
  evaluate(ctx) {
    const value = ctx.entities().filter((entity) => entity.components.includes(${JSON.stringify(`${request.id}.${request.component}`)})).length;
    return { value, unit: "" };
  },
});
export default { id: ${JSON.stringify(request.id)}, library: [count] };
`;
}

function studioFiles(request: PluginRequest): Record<string, string> {
  const id = `${request.id}.${request.component}`;
  return {
    "src/studio.ts": `${HEADER}/** The studio face of the plugin \`${request.id}\`: a panel of the editor window. */
import { defineStudioPlugin } from "@scenity/editor/studio";

export default defineStudioPlugin({
  id: ${JSON.stringify(request.id)},
  apiVersion: 1,
  texts: import.meta.glob<string>("./i18n/*/*.ftl", { query: "?raw", import: "default", eager: true }),
  contributes: {
    panels: [{ id: ${JSON.stringify(`${request.id}.panel`)}, title: ${JSON.stringify(`${request.id}-panel-title`)}, component: () => import("./Panel.vue") }],
  },
});
`,
    "src/Panel.vue": `<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** The panel of the plugin \`${request.id}\`: the entities with the component \`${id}\`. */
import type { StudioContext } from "@scenity/editor/studio";

defineProps<{ ctx: StudioContext }>();
</script>

<template>
  <ul class="p-1.5 text-caption">
    <li v-for="entity in ctx.documents.entities(${JSON.stringify(id)})" :key="entity.id">{{ entity.name ?? entity.id }}</li>
  </ul>
</template>
`,
    [`src/i18n/en-US/${request.id}.ftl`]: `${request.id}-panel-title = ${label(request.id)}\n`,
  };
}

/** The files of a new plugin by their path in its folder. */
export function pluginFiles(request: PluginRequest): Record<string, string> {
  const studio = request.parts.includes("studio");
  const metric = request.parts.includes("metric");
  const faces: Record<string, string> = { runtime: "src/runtime.ts" };
  if (metric) faces.dev = "src/dev.ts";
  if (studio) faces.studio = "src/studio.ts";
  const pack = { name: `@local/${request.id}`, private: true, version: "0.1.0", type: "module", scenity: faces };
  return {
    "package.json": `${JSON.stringify(pack, null, 2)}\n`,
    "src/component.ts": componentFile(request),
    "src/runtime.ts": runtimeFile(request),
    ...(request.parts.includes("system") ? { [`src/systems/${request.component}.ts`]: systemFile(request) } : {}),
    ...(request.parts.includes("presenter") ? { "src/presenter.ts": presenterFile(request) } : {}),
    ...(request.parts.includes("simulation") ? { "src/sim/simulation.ts": simulationFile(request) } : {}),
    ...(metric ? { "src/dev.ts": devFile(request) } : {}),
    ...(studio ? studioFiles(request) : {}),
  };
}
