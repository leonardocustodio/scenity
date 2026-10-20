// SPDX-License-Identifier: Apache-2.0
/**
 * The adapter of a lab face (docs/lab-to-studio.md). `adaptLabFace` makes a studio face from the parts of a lab face
 * (`EditorPlugin`) that work in the editor window:
 * - each tab of the side panel and each section of the View tab is a panel on the right. Each dock tab is a panel at
 *   the bottom. The component gets the prop `ctx` (it does not get the lab props, for example `browser`).
 * - each page tool for Claude is a page tool of the window;
 * - the context lines go into the context packet of the agents;
 * - the take model is the Takes panel (LabTakesPanel.vue): the takes, their moments and the state at a time.
 *
 * The labels of the lab face are plain text, so the adapter makes a Fluent file of the plugin with them (en-US). The
 * other parts need the lab page (its scene core, its takes, its runner). `kept` names them with the reason. Thus the
 * author can move them one part at a time. A plugin uses the adapter in its studio face:
 *
 *   import labFace from "./editor";
 *   export default adaptLabFace(labFace).face;
 */
import { defineComponent, h, type Component } from "vue";
import type { LazyComponent, StudioPageTool, StudioPanel, StudioPanelArea, StudioPluginDefinition } from "./api";
import { STUDIO_API_VERSION } from "./api";

/** The take model of a lab face, as the Takes panel reads it (the `sequence` part of `EditorPlugin`). */
export interface LabTakeModel {
  readonly takes: readonly { readonly name: string; readonly label: string; readonly events: readonly object[] }[];
  stateAt(events: readonly object[], simMs: number): unknown;
  members(state: unknown): readonly string[];
  readonly moments: Readonly<Record<string, Readonly<Record<string, number>>>>;
  marks(events: readonly object[], end: number): readonly { readonly at: number; readonly label: string }[];
  length(take: string): number;
  readonly defaultTake?: string;
  memberLabel?(member: string): string;
}

/** A page tool of a lab face for Claude. */
interface LabPageTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly type: "object"; readonly [key: string]: unknown };
  run(
    input: Record<string, unknown>,
  ):
    | string
    | { readonly text: string; readonly isError: boolean }
    | Promise<string | { readonly text: string; readonly isError: boolean }>;
}

/** A tab of a lab face. */
interface LabTab {
  readonly value: string;
  readonly label: string;
  readonly component: Component;
}

/**
 * The parts of a lab face (`EditorPlugin` of the lab page) that the adapter reads. The other parts stay on the lab
 * page; the adapter only names them. The adapter does not import the lab core, so a studio face
 * gets no lab types.
 */
export interface LabFace {
  readonly id: string;
  readonly tabs?: readonly LabTab[];
  readonly dockTabs?: readonly LabTab[];
  readonly sequence?: LabTakeModel;
  readonly tools?: readonly LabPageTool[];
  contextLines?(): readonly string[] | Promise<readonly string[]>;
}

/** The names of the parts of a lab face that need the lab page. */
type LabOnlyPart =
  | "install"
  | "useRuntimePlugins"
  | "registerCommands"
  | "cameras"
  | "sequence"
  | "checks"
  | "browser"
  | "selectionKinds"
  | "placement"
  | "layout"
  | "overlays"
  | "scene"
  | "apiExtensions"
  | "bridgeCalls"
  | "sceneDocument";

/** A part of a lab face that stays on the lab page, and why. */
export interface KeptLabPart {
  readonly part: string;
  readonly reason: string;
}

/** The studio face of a lab face, and the parts that stay on the lab page. */
export interface AdaptedLabFace {
  readonly face: StudioPluginDefinition;
  readonly kept: readonly KeptLabPart[];
}

/** The parts of a lab face that need the lab page, and the place of each one in the studio (lab-to-studio.md). */
const LAB_ONLY: readonly (readonly [LabOnlyPart, string])[] = [
  ["install", "it starts data sources in the Vue app of the lab page; a studio face uses activate(ctx)"],
  ["useRuntimePlugins", "the scene page loads the runtime faces of the project itself"],
  ["registerCommands", "the commands run on the runner of the lab page; move each one to `commands`"],
  ["cameras", "the studio uses the document cameras of the scene"],
  ["sequence", "the Takes panel shows the takes; a play of a take in the view needs the lab page"],
  ["checks", "the checks become rules, metrics of the dev face or `problemSources`"],
  ["browser", "the Project window shows the assets; use `previews` and the asset sources of the host face"],
  ["selectionKinds", "the studio selects entities only"],
  ["placement", "the layout tools of the core, or `sceneTools` with `handles`"],
  ["layout", "`problemSources` and the rules of the project"],
  ["overlays", "`overlays` and `sceneTools` of the studio face"],
  ["scene", "the scene document of the window (`ctx.documents`)"],
  ["apiExtensions", "the script API of the lab page; use `pageTools` or commands with `agents: true`"],
  ["bridgeCalls", "use `pageTools`, or the `tools` of the host face"],
  ["sceneDocument", "the scene page holds the document; the tune values become component values"],
];

/** A part of an ID from a tab key: lower-case words with hyphens. */
function idPart(value: string): string {
  const part = value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return part === "" ? "tab" : part;
}

/** The camelCase form of a tab key, for the ID of its panel. */
function camelPart(value: string): string {
  return idPart(value).replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

/** A Fluent value on one line, with no line breaks. The braces and the special start characters are string literals. */
function fluentValue(text: string): string {
  const line = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[{}]/g, (brace) => `{"${brace}"}`);
  return /^[[*.]/.test(line) ? `{"${line.slice(0, 1)}"}${line.slice(1)}` : line;
}

/** The kept parts of a face: the lab parts that the face has. */
function keptParts(face: LabFace): KeptLabPart[] {
  const parts = face as unknown as Readonly<Record<string, unknown>>;
  const has = (part: LabOnlyPart): boolean => {
    const value = parts[part];
    if (value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  };
  return LAB_ONLY.filter(([part]) => has(part)).map(([part, reason]) => ({ part, reason }));
}

/** The page tools of a lab face as page tools of the window. An error result becomes a thrown error. */
function pageTools(face: LabFace): StudioPageTool[] {
  return (face.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input: tool.inputSchema,
    run: async (_ctx, input) => {
      const result = await tool.run({ ...input });
      if (typeof result === "string") return result;
      if (result.isError) throw new Error(result.text);
      return result.text;
    },
  }));
}

/** The Takes panel of a take model: the panel component with the take model of the face. */
function takesPanel(id: string, sequence: LabTakeModel): StudioPanel {
  const load: LazyComponent = async () => {
    const panel = (await import("./LabTakesPanel.vue")).default;
    return defineComponent({ name: "LabTakes", setup: () => () => h(panel, { sequence }) });
  };
  return { id: `${id}.takes`, title: "lab-takes-title", area: "bottom", component: load };
}

/**
 * Make a studio face from the parts of a lab face that work in the editor window. Each part is optional: a lab face of
 * a test has only the parts that it needs.
 */
export function adaptLabFace(face: LabFace): AdaptedLabFace {
  const lines: string[] = [];
  const panels: StudioPanel[] = [];
  const add = (value: string, label: string, component: Component, area: StudioPanelArea): void => {
    const title = `${face.id}-lab-${idPart(value)}`;
    lines.push(`${title} = ${fluentValue(label)}`);
    const load: LazyComponent = () => Promise.resolve(component);
    panels.push({ id: `${face.id}.${camelPart(value)}`, title, area, component: load });
  };
  for (const tab of face.tabs ?? []) add(tab.value, tab.label, tab.component, "right");
  for (const tab of face.dockTabs ?? []) add(tab.value, tab.label, tab.component, "bottom");
  if (face.sequence !== undefined && face.sequence.takes.length > 0) panels.push(takesPanel(face.id, face.sequence));
  // A lab face can give its lines later (a promise). The window shows the last lines that it got.
  let context: readonly string[] = [];
  const refresh = (): void => {
    void Promise.resolve(face.contextLines?.() ?? []).then((value) => {
      context = value;
    });
  };
  const studio: StudioPluginDefinition = {
    id: face.id,
    apiVersion: STUDIO_API_VERSION,
    texts: lines.length === 0 ? {} : { [`./i18n/en-US/${face.id}-lab.ftl`]: `${lines.join("\n")}\n` },
    contributes: {
      panels,
      pageTools: pageTools(face),
      ...(face.contextLines === undefined
        ? {}
        : {
            contextLines: () => {
              refresh();
              return context;
            },
          }),
    },
    ...(face.contextLines === undefined
      ? {}
      : {
          activate: () => {
            refresh();
            return undefined;
          },
        }),
  };
  return { face: studio, kept: keptParts(face) };
}
