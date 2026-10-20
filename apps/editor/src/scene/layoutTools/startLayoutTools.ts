// SPDX-License-Identifier: Apache-2.0
/**
 * The layout tools of the scene page in the edit mode: a tool menu, a readout and an overlay canvas for measure, reach,
 * clearance, walk paths and visibility. The page loads this module only with `edit=1` (a lazy chunk). The tools work
 * on any entity with the components that they need (`@scenity/runtime-dev/layoutTools`). A tool with no input shows
 * the reason in the readout.
 *
 * - The menu has a button for each tool and Clear. A tool runs again after each change of the selection, the scene
 *   or the clock time.
 * - Measure takes the first two selected entities. With fewer, two clicks on the canvas pick two points. Escape
 *   removes the picks (the command `layout.measureClear`). A click of the measure does not select.
 * - The overlay draws with the camera that draws (the editor camera or the document camera), as the gizmo overlay.
 * - The script API: `layoutTool(tool, input?)` selects a tool (null: no tool) and gives its result. `layoutTools()`
 *   gives the tool, the result, the picks and what the overlay drew.
 * - The texts of the menu and the readout are Fluent messages of `src/i18n/en-US/layout-tool.ftl`. The lines of a
 *   result and the reasons of a tool with no input come from `@scenity/runtime-dev` and stay in English.
 */
import type { ProjectDocument, Rule } from "@scenity/scene";
import type { PickHit } from "@scenity/runtime/protocol";
import { LAYOUT_TOOLS, type LayoutToolId, type LayoutToolResult } from "@scenity/runtime-dev/layoutTools/index";
import type { Vec3 } from "@scenity/scene/math";
import { pageView, type EditorPose } from "../dragMath";
import type { InspectPort } from "../gizmo/freeDrag";
import { fitOverlay } from "../gizmo/gizmoDraw";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { ScenePageEditor } from "../sceneEditor";
import { layoutSearchPart, type PlaceSearchResult } from "./layoutSearchPart";
import { drawLayout, layoutOverlay, type DrawnOverlay } from "./layoutToolsDraw";
import { LayoutToolsState, type ToolInput } from "./layoutToolsState";
import { placePart } from "../pageParts";
import { currentShell } from "../../studio/shell/shell";
import { whenOverlays } from "../viewport/viewOverlays";
import "./layoutTools.css";
import { pageKeys, SCENE_CONTEXT } from "../settings/pageKeys";
import { t } from "../../texts";
import { mainViewBox } from "../viewport/mainView";

/** What the layout tools read of the page. */
export interface LayoutToolsParts {
  readonly canvas: HTMLCanvasElement;
  readonly editor: ScenePageEditor;
  readonly selection: PageSelectionPort;
  readonly inspect: InspectPort;
  readonly project: ProjectDocument | null;
  pick(x: number, y: number): Promise<PickHit | null>;
  /** Wait for the frame of the last edit. */
  settle(): Promise<void>;
  camera(): string | null;
  editorView(): EditorPose | null;
  /** The rules of the layout search (the scene, then the project). */
  rules(): readonly Rule[];
}

/** The current state of the layout tools, for the script API and the tests. */
export interface LayoutToolsInfo {
  readonly tool: LayoutToolId | null;
  readonly result: LayoutToolResult | null;
  readonly picks: readonly Vec3[];
  readonly picking: boolean;
  readonly drawn: DrawnOverlay;
}

/** The layout tools part of the script API of the scene page. */
export interface LayoutToolsApi {
  /** Select a tool with an input (the fields of its request; null: no tool) and give its result. */
  layoutTool(tool: LayoutToolId | null, input?: ToolInput): Promise<LayoutToolResult | null>;
  layoutTools(): LayoutToolsInfo;
  /** Search places for an entity (default: the first selected entity) that pass the rules. */
  layoutSearch(entity?: string, radius?: number): Promise<PlaceSearchResult | null>;
  /** Move the entity of the last search to a variant (one undo step). Return the reason of a refusal, or null. */
  applyPlace(variant: string): string | null;
}

const NOTHING: DrawnOverlay = { lines: 0, dots: 0, labels: [] };

/** The texts of each tool: its name, and its title with what it needs (the order of the menu is LAYOUT_TOOLS). */
const TOOL_TEXTS: Readonly<Record<LayoutToolId, { label: () => string; title: () => string }>> = {
  measure: { label: () => t("layout-tool-measure"), title: () => t("layout-tool-measure-title") },
  reach: { label: () => t("layout-tool-reach"), title: () => t("layout-tool-reach-title") },
  clearance: { label: () => t("layout-tool-clearance"), title: () => t("layout-tool-clearance-title") },
  walk: { label: () => t("layout-tool-walk"), title: () => t("layout-tool-walk-title") },
  visibility: { label: () => t("layout-tool-visibility"), title: () => t("layout-tool-visibility-title") },
};

/**
 * The tools in the Tools overlay of the Scene view (after the gizmo modes): a button for each tool and Clear.
 * A page with no overlays (no editor window) shows them as a bar over the view.
 */
function toolBar(state: LayoutToolsState): () => void {
  const bar = document.createElement("div");
  bar.className = "scene-overlay-column scene-layout-tools";
  bar.dataset.testid = "scene-layout-tools";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", t("layout-tool-bar"));
  const buttons = LAYOUT_TOOLS.map(({ id }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = TOOL_TEXTS[id].label();
    button.title = TOOL_TEXTS[id].title();
    button.dataset.testid = `layout-tool-${id}`;
    button.addEventListener("click", () => void state.use(state.tool === id ? null : id));
    return { id, button };
  });
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = t("layout-tool-clear");
  clear.dataset.testid = "layout-tool-clear";
  clear.addEventListener("click", () => void state.use(null));
  bar.append(...buttons.map((item) => item.button), clear);
  placeInTools(bar);
  return () => {
    for (const { id, button } of buttons) button.setAttribute("aria-pressed", String(state.tool === id));
  };
}

/** Put the tools in the Tools overlay when the gizmo adds it (the gizmo is another lazy part), else over the view. */
function placeInTools(bar: HTMLElement, id = "scene-layout-tools"): void {
  if (currentShell() === null) {
    bar.id = id;
    placePart(bar, "view");
    return;
  }
  whenOverlays((dock) => {
    const attach = (): void => {
      const tools = dock.content("tools");
      if (tools === null) requestAnimationFrame(attach);
      else tools.append(bar);
    };
    attach();
  });
}

/** The readout: the tool, its lines, or the reason of a tool with no input. It is an overlay of the Scene view. */
function readout(state: LayoutToolsState): () => void {
  const panel = document.createElement("section");
  panel.id = "scene-layout-readout";
  panel.dataset.testid = "scene-layout-readout";
  panel.setAttribute("aria-live", "polite");
  panel.hidden = true;
  if (currentShell() === null) placePart(panel, "view");
  else
    whenOverlays((dock) => {
      dock.add({
        id: "layout-readout",
        title: () => t("layout-tool-readout"),
        edge: "right",
        order: 5,
        content: panel,
      });
      panel.closest<HTMLElement>(".scene-overlay")?.toggleAttribute("data-idle", state.tool === null);
    });
  return () => {
    const { tool, result } = state;
    panel.hidden = tool === null;
    // The overlay of the readout shows while a tool is on.
    panel.closest<HTMLElement>(".scene-overlay")?.toggleAttribute("data-idle", tool === null);
    if (tool === null) return;
    const title = document.createElement("h2");
    title.textContent = TOOL_TEXTS[tool].label();
    const list = document.createElement("ul");
    // The lines of a result come from @scenity/runtime-dev in English: they carry the package text mark.
    const lines = (result?.lines ?? ["…"]).map((text) => ({ text, page: false }));
    if (state.picking) lines.unshift({ text: t("layout-tool-pick", { index: state.picks.length + 1 }), page: true });
    list.append(
      ...lines.map(({ text, page }) => {
        const item = document.createElement("li");
        item.textContent = text;
        if (!page) item.dataset.packageText = "";
        return item;
      }),
    );
    panel.dataset.state = result === null ? "running" : result.ok ? "ok" : "none";
    panel.replaceChildren(title, list, ...saveButtons(result));
  };
}

/** "Save as a rule" for the first metric of a result with a value (its current value is the limit). */
function saveButtons(result: LayoutToolsState["result"]): HTMLButtonElement[] {
  const metric =
    result?.ok === true ? result.metrics.find((each) => typeof each.result?.value === "number") : undefined;
  const value = metric?.result?.value;
  if (metric === undefined || typeof value !== "number") return [];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scene-layout-save-rule";
  button.textContent = t("layout-tool-save-rule");
  button.dataset.testid = "layout-save-rule";
  button.dataset.metric = metric.metric;
  button.addEventListener("click", () => {
    void import("../rules/ruleRequest").then((chunk) => chunk.askRule(metric.metric, metric.args, value));
  });
  return [button];
}

/** The overlay: it draws again when the result, the camera or the canvas box changes. */
function startOverlay(parts: LayoutToolsParts, state: LayoutToolsState, drawn: { value: DrawnOverlay }): void {
  const overlay = layoutOverlay(parts.canvas);
  let last = "";
  let shown: LayoutToolResult | null = null;
  const draw = (): void => {
    const box = mainViewBox(parts.canvas);
    const view = pageView(parts.editor.doc, parts);
    const result = state.tool === null ? null : state.result;
    const key = JSON.stringify([box.width, box.height, box.left, box.top, view]);
    if (key !== last || result !== shown) {
      last = key;
      shown = result;
      const px = (value: number): string => `${String(value)}px`;
      Object.assign(overlay.style, {
        left: px(box.left),
        top: px(box.top),
        width: px(box.width),
        height: px(box.height),
      });
      const context = fitOverlay(overlay, box.width, box.height);
      drawn.value =
        context === null || view === null || result === null
          ? NOTHING
          : drawLayout(context, result.overlay, view, [box.width, box.height]);
      overlay.dataset.lines = String(drawn.value.lines);
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

/**
 * The picks of the measure: a click on the canvas with no drag (a capture listener: before the select and the drag).
 */
function listenPicks(parts: LayoutToolsParts, state: LayoutToolsState): void {
  const { canvas } = parts;
  let press: { x: number; y: number; id: number } | null = null;
  const at = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.target !== canvas || event.button !== 0 || !state.picking) return;
      event.stopImmediatePropagation();
      press = { ...at(event), id: event.pointerId };
    },
    { capture: true },
  );
  window.addEventListener(
    "pointerup",
    (event) => {
      if (press?.id !== event.pointerId) return;
      event.stopImmediatePropagation();
      const end = at(event);
      const start = press;
      press = null;
      if (Math.hypot(end.x - start.x, end.y - start.y) > 5) return;
      void parts.pick(end.x, end.y).then((hit) => {
        if (hit !== null) void state.pick([hit.point[0], hit.point[1], hit.point[2]]);
      });
    },
    { capture: true },
  );
  // Escape clears the picks of the measure: the page command `layout.measureClear` of the key map.
  pageKeys().register([
    {
      id: "layout.measureClear",
      title: t("layout-tool-command-measure-clear"),
      keys: ["Escape"],
      keyContext: SCENE_CONTEXT,
      when: () => (state.tool === "measure" && state.picks.length > 0 ? null : t("layout-tool-refuse-no-points")),
      run: () => void state.use("measure"),
    },
  ]);
}

/** Start the layout tools of the page; the result is the layout tools part of the script API. */
export function startLayoutTools(parts: LayoutToolsParts): LayoutToolsApi {
  const state = new LayoutToolsState({
    inspect: () => parts.inspect(),
    settle: () => parts.settle(),
    base: () => parts.editor.doc,
    posed: () => parts.editor.posed(),
    selection: () => parts.selection.ids,
    viewpoint: () => {
      const view = pageView(parts.editor.doc, parts);
      return view === null ? null : [view.position[0], view.position[1], view.position[2]];
    },
    project: parts.project,
  });
  const showBar = toolBar(state);
  const showReadout = readout(state);
  state.listen(() => {
    showBar();
    showReadout();
  });
  showBar();
  const drawn = { value: NOTHING };
  startOverlay(parts, state, drawn);
  listenPicks(parts, state);
  // The tool runs again after a change of the selection, the scene or the clock time: at most one run each 120 ms, so
  // a sequence that plays runs it while it plays.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const again = (): void => {
    if (state.tool === null || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void state.run();
    }, 120);
  };
  parts.selection.listen(again);
  parts.editor.listenPosed(again);
  parts.canvas.dataset.layoutTools = "1";
  // "Find a place" under the tools.
  const finder = layoutSearchPart({
    inspect: () => parts.inspect(),
    settle: () => parts.settle(),
    posed: () => parts.editor.posed(),
    rules: () => parts.rules(),
    selection: () => parts.selection.ids,
    apply: (ops, title) => parts.editor.apply(ops, title),
    project: parts.project,
  });
  placeInTools(finder.element, "scene-layout-search");
  return {
    layoutSearch: (entity, radius) => finder.search(entity, radius),
    applyPlace: (variant) => finder.apply(variant),
    layoutTool: (tool, input) => state.use(tool, input),
    layoutTools: () => ({
      tool: state.tool,
      result: state.result,
      picks: state.picks,
      picking: state.picking,
      drawn: drawn.value,
    }),
  };
}
