// SPDX-License-Identifier: Apache-2.0
/**
 * The dev tools of the scene page: the inspect report of the scene and the debug layers of the dev document core
 * (`@scenity/runtime-dev/document/client`).
 *
 * - `debug=bounds,skeleton` shows these layers at the start. `__scenity.debug(names)` and the boxes of the panel change
 *   them, and the URL follows. `__scenity.debugLayers()` gives the names that the core can draw.
 * - `inspect=1` opens the inspect panel at the start. The I key (the command `inspect.toggle`) opens and closes it. The
 *   panel shows the totals and a row per entity (components, world place, bounds, triangles, draw calls, instance
 *   batch, joints); a click on a row shows the report of the entity. `__scenity.inspect()` gives the whole report.
 *
 * The panel covers the right side of the canvas only while it is open: the frames of the gallery do not change.
 *
 * The viewport of the edit mode adds its view layers (the grid, a view mode) with `setViewLayers`. They go to the core
 * with the debug layers, but not into the `debug` parameter of the URL or the boxes of the panel.
 *
 * The labels of the panel are Fluent messages of `src/i18n/en-US/scene.ftl`. The cells, the layer names and the detail
 * are raw data of the report: they stay as they are, with `translate="no"`.
 */
import type { DevDocumentClient } from "@scenity/runtime-dev/document/client";
import type { EntityReport, SceneInspectReport } from "@scenity/runtime-dev/document/report";
import { t } from "../texts";
import { placePart } from "./pageParts";
import { pageKeys } from "./settings/pageKeys";

/** The dev part of the script API of the scene page. */
export interface DevToolsApi {
  /** The inspect report of the last frame (after a new frame), or null when the client stops first. */
  inspect(): Promise<SceneInspectReport | null>;
  /** Show the debug layers of the names, hide the other debug layers, and wait for the frame that shows them. */
  debug(layers: readonly string[]): Promise<void>;
  /** The names of the debug layers that the core can draw (after the first report). */
  debugLayers(): readonly string[];
  /** The simulation states of the plugins at the time of the last frame, or null. */
  simulations(): Promise<Record<string, unknown> | null>;
}

/** The layer names of the `debug` parameter: a list with commas. */
export function debugParam(value: string | null): string[] {
  if (value === null) return [];
  return value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.textContent = text;
  return made;
}

function vec(values: readonly number[]): string {
  return values.map((value) => value.toFixed(2)).join(", ");
}

/** The cells of the row of an entity. */
function rowCells(entity: EntityReport): string[] {
  const size =
    entity.bounds === null ? "" : vec(entity.bounds.max.map((max, axis) => max - (entity.bounds?.min[axis] ?? 0)));
  const { stats } = entity;
  return [
    entity.id,
    entity.components.join(" "),
    vec(entity.transform.position),
    size,
    String(stats.triangles),
    String(stats.drawCalls),
    stats.instanced ? t("scene-inspect-batched") : "",
    entity.joints === null ? "" : String(Object.keys(entity.joints).length),
  ];
}

/** The message IDs of the heads of the entity table. */
const HEADS = [
  "scene-inspect-head-entity",
  "scene-inspect-head-components",
  "scene-inspect-head-position",
  "scene-inspect-head-size",
  "scene-inspect-head-triangles",
  "scene-inspect-head-draws",
  "scene-inspect-head-batch",
  "scene-inspect-head-joints",
] as const;

/** The column of the batch mark: its text is a message, not raw data. */
const BATCH_COLUMN = 6;

/** A node of raw report data: the text stays as it is. */
function data<K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] {
  const made = element(tag, text);
  made.setAttribute("translate", "no");
  return made;
}

/** The inspect panel: the layer boxes, the totals, the entity table and the details of one entity. */
class InspectPanel {
  readonly root = element("aside");
  readonly #layers = element("fieldset");
  readonly #totals = element("p");
  readonly #rows = element("tbody");
  readonly #detail = element("pre");

  constructor(
    private readonly toggle: (name: string, on: boolean) => void,
    refresh: () => void,
  ) {
    this.root.id = "scene-inspect";
    this.root.dataset.testid = "scene-inspect";
    this.root.setAttribute("aria-label", t("scene-inspect"));
    this.root.hidden = true;
    const head = element("header");
    const title = element("h2", t("scene-inspect"));
    const again = element("button", t("scene-inspect-refresh"));
    again.type = "button";
    again.addEventListener("click", refresh);
    head.append(title, again);
    this.#layers.append(element("legend", t("scene-inspect-layers")));
    const table = element("table");
    const heads = element("tr");
    for (const id of HEADS) heads.append(element("th", t(id)));
    table.append(element("thead"), this.#rows);
    table.tHead?.append(heads);
    this.#detail.dataset.testid = "scene-inspect-detail";
    this.#detail.setAttribute("translate", "no");
    this.root.append(head, this.#layers, this.#totals, table, this.#detail);
    placePart(this.root, "view");
  }

  /** Show a report. */
  show(report: SceneInspectReport): void {
    this.#showLayers(report.layers);
    const { totals } = report;
    this.#totals.textContent = t("scene-inspect-totals", {
      entities: String(totals.entities),
      triangles: String(totals.triangles),
      calls: String(totals.drawCalls),
    });
    this.#rows.replaceChildren(
      ...report.entities.map((entity) => {
        const row = element("tr");
        row.dataset.entity = entity.id;
        row.tabIndex = 0;
        const cells = rowCells(entity).map((text, column) =>
          column === BATCH_COLUMN ? element("td", text) : data("td", text),
        );
        row.append(...cells);
        const pick = (): void => {
          this.#detail.textContent = JSON.stringify(entity, null, 2);
        };
        row.addEventListener("click", pick);
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter") pick();
        });
        return row;
      }),
    );
  }

  #showLayers(layers: SceneInspectReport["layers"]): void {
    const boxes = layers.names.map((name) => {
      const label = element("label");
      const box = element("input");
      box.type = "checkbox";
      box.name = name;
      box.checked = layers.on.includes(name);
      box.addEventListener("change", () => {
        this.toggle(name, box.checked);
      });
      label.append(box, " ", data("span", name));
      return label;
    });
    this.#layers.replaceChildren(element("legend", t("scene-inspect-layers")), ...boxes);
  }
}

/** Write the layers that are on into the `debug` parameter of the URL (no new history entry). */
function writeDebugParam(layers: readonly string[]): void {
  const url = new URL(location.href);
  if (layers.length === 0) url.searchParams.delete("debug");
  else url.searchParams.set("debug", layers.join(","));
  history.replaceState(history.state, "", url);
}

/**
 * Start the dev tools of the page: the layers of the `debug` parameter (call before the load, so the first frame shows
 * them), the panel and the script API. `frame` waits for the next frame of the core.
 */
export function startDevTools(
  params: URLSearchParams,
  client: DevDocumentClient,
  frame: () => Promise<void>,
): { readonly api: DevToolsApi; open(): Promise<void>; setViewLayers(layers: readonly string[]): Promise<void> } {
  let on = debugParam(params.get("debug"));
  let names: readonly string[] = [];
  // The layers of the viewport (the grid, a view mode).
  let view: readonly string[] = [];
  const send = (layers: readonly string[]): void => {
    client.setDebug([...new Set([...layers, ...view])]);
  };
  send(on);
  const report = async (): Promise<SceneInspectReport | null> => {
    await frame();
    const made = await client.inspect();
    if (made !== null) {
      names = made.layers.names;
      on = made.layers.on.filter((name) => !view.includes(name));
    }
    return made;
  };
  const refresh = async (): Promise<void> => {
    const made = await report();
    if (made !== null && !panel.root.hidden) panel.show(made);
  };
  const debug = async (layers: readonly string[]): Promise<void> => {
    // A change of the view layers before the next report sends these layers, not the layers before them.
    on = [...layers];
    send(layers);
    writeDebugParam(layers.filter((name) => names.length === 0 || names.includes(name)));
    await refresh();
  };
  const panel = new InspectPanel(
    (name, checked) => {
      void debug(checked ? [...on, name] : on.filter((each) => each !== name));
    },
    () => void refresh(),
  );
  const open = async (): Promise<void> => {
    panel.root.hidden = false;
    await refresh();
  };
  // The I key is the page command `inspect.toggle` of the key map (settings/pageKeys.ts).
  pageKeys().register([
    {
      id: "inspect.toggle",
      title: t("scene-inspect-toggle"),
      keys: ["I"],
      run: () => {
        if (panel.root.hidden) void open();
        else panel.root.hidden = true;
      },
    },
  ]);
  const setViewLayers = async (layers: readonly string[]): Promise<void> => {
    view = [...layers];
    send(on);
    await frame();
  };
  const simulations = () => client.simulations();
  return { api: { inspect: report, debug, debugLayers: () => names, simulations }, open, setViewLayers };
}
