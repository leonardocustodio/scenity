// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the layout tools of the scene page: the tool that is on, its input (the selection, the picks of the
 * measure, the values of the script API) and its last result. A run reads the inspect report of the current frame,
 * makes a metric context of `@scenity/rules` from it and from the documents of the editor, and runs the tool of
 * `@scenity/runtime-dev/layoutTools`. No DOM: the bar, the readout and the overlay read it.
 *
 * - The context: the facts are the inspect report (the world boxes, the sockets, the joints of the frame); the scene is
 *   the posed scene (the scene at the clock time); the base is the scene of the file (the walk plans start from it);
 *   the own box of each entity is its mesh box.
 * - A run waits for the frame of the last edit first, so the report shows the scene of the document.
 */
import { createMetricContext, type Box, type MetricContext } from "@scenity/rules";
import type { ProjectDocument, SceneDocument } from "@scenity/scene";
import type { SceneInspectReport } from "@scenity/runtime-dev/document/report";
import {
  runLayoutTool,
  type LayoutToolId,
  type LayoutToolRequest,
  type LayoutToolResult,
} from "@scenity/runtime-dev/layoutTools/index";
import type { Vec3 } from "@scenity/scene/math";

/** The input of a tool from the script API: the fields of its request, without the tool and the selection. */
export type ToolInput = Readonly<Record<string, unknown>>;

/** What the state reads of the page. */
export interface LayoutToolsPort {
  /** The inspect report of the current frame (null: the core has none). */
  inspect(): Promise<SceneInspectReport | null>;
  /** Wait for the frame of the last edit. */
  settle(): Promise<void>;
  /** The scene of the file and the posed scene at the clock time. */
  base(): SceneDocument;
  posed(): SceneDocument;
  selection(): readonly string[];
  /** The place of the camera that draws: the eye of the visibility tool when the input gives none. */
  viewpoint(): Vec3 | null;
  readonly project: ProjectDocument | null;
}

/** The metric context of the current frame from an inspect report and the documents of the page. */
export function pageMetricContext(
  report: SceneInspectReport,
  docs: { readonly posed: SceneDocument; readonly base: SceneDocument; readonly project: ProjectDocument | null },
): MetricContext {
  const own = new Map(report.entities.map((entity) => [entity.id, entity.ownBounds ?? null]));
  return createMetricContext({
    facts: report,
    scene: docs.posed,
    base: docs.base,
    ...(docs.project === null ? {} : { project: docs.project }),
    meshBoxes: (id): readonly Box[] => {
      const box = own.get(id) ?? null;
      return box === null ? [] : [box];
    },
  });
}

/** The tools of the page: the tool that is on, its input and its last result. */
export class LayoutToolsState {
  readonly #port: LayoutToolsPort;
  readonly #listeners = new Set<() => void>();
  #tool: LayoutToolId | null = null;
  #input: ToolInput = {};
  #picks: Vec3[] = [];
  #result: LayoutToolResult | null = null;
  #runs = 0;

  constructor(port: LayoutToolsPort) {
    this.#port = port;
  }

  get tool(): LayoutToolId | null {
    return this.#tool;
  }

  get result(): LayoutToolResult | null {
    return this.#result;
  }

  get picks(): readonly Vec3[] {
    return this.#picks;
  }

  /** True while the measure waits for picks: it is on, and the selection and the input give no two ends. */
  get picking(): boolean {
    if (this.#tool !== "measure" || this.#input.from !== undefined) return false;
    return this.#port.selection().length < 2 && this.#picks.length < 2;
  }

  /** Call `listener` after each change of the tool, the input or the result; the result stops it. */
  listen(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Select a tool with an input (null: no tool), then run it. */
  async use(tool: LayoutToolId | null, input: ToolInput = {}): Promise<LayoutToolResult | null> {
    this.#tool = tool;
    this.#input = input;
    this.#picks = [];
    this.#result = null;
    this.#tell();
    return this.run();
  }

  /** Add a pick of the measure: the second pick measures from the first. */
  async pick(point: Vec3): Promise<LayoutToolResult | null> {
    this.#picks = this.#picks.length >= 2 ? [point] : [...this.#picks, point];
    this.#tell();
    return this.run();
  }

  /** Run the tool that is on with the current scene; a later run replaces the result of an earlier one. */
  async run(): Promise<LayoutToolResult | null> {
    const tool = this.#tool;
    if (tool === null) return null;
    this.#runs += 1;
    const run = this.#runs;
    await this.#port.settle();
    const report = await this.#port.inspect();
    if (run !== this.#runs || report === null) return this.#result;
    const ctx = pageMetricContext(report, {
      posed: this.#port.posed(),
      base: this.#port.base(),
      project: this.#port.project,
    });
    this.#result = runLayoutTool(ctx, this.#request(tool));
    this.#tell();
    return this.#result;
  }

  #request(tool: LayoutToolId): LayoutToolRequest {
    const selection = [...this.#port.selection()];
    const picks = this.#picks;
    const ends =
      tool === "measure" && picks.length === 2 && picks[0] !== undefined && picks[1] !== undefined
        ? { from: picks[0], to: picks[1] }
        : {};
    const viewpoint = tool === "visibility" ? { viewpoint: this.#port.viewpoint() } : {};
    return { ...ends, ...viewpoint, ...this.#input, tool, selection };
  }

  #tell(): void {
    for (const listener of this.#listeners) listener();
  }
}
