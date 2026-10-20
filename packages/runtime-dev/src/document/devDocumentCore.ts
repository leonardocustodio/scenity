// SPDX-License-Identifier: Apache-2.0
/**
 * The document core with the dev tools: the document core of the runtime, the inspect report of its scene
 * (inspectScene.ts) and the debug layers over it. The editor scene page makes it on the main thread (coreGl.ts,
 * coreGpu.ts) or in the dev scene worker (worker.ts). A player keeps the plain document core.
 *
 * - `setDebug(names)` shows the layers of the names: the generic layers (debugLayers.ts, sceneLayers.ts), the
 *   wireframe (wireframe.ts) and the layers of the dev plugins (`useDevPlugin`). A name that no layer has does
 *   nothing. With no layer on, the core draws the frames of the plain document core.
 * - The layers draw from the graph of the frame, after the update of the sequence and before the render.
 * - `checkRules(request)` evaluates rules on the scene with no render (ruleCheck.ts), with the built-in metrics and
 *   the library metrics of the dev plugins.
 * - The core layers of the editor viewport are "grid" (viewGrid.ts), the shading modes "unlit" and "normalShading"
 *   (viewShading.ts) and "wireframe".
 * - `previewCamera(name, width)` gives a picture of the view of a document camera. In the next frame, the core draws
 *   that view with no dev layer and takes a picture of the canvas. Then it draws the frame of the page. Thus the canvas
 *   never shows the preview.
 * - `setGhosts(spec)` draws a faint copy of each entity that a waiting change moves, at its new place
 *   (ghostCopies.ts); the camera previews hide them.
 * - `setOnion(spec)` draws the onion skins of an entity at the world matrices of the page (onionCopies.ts). The
 *   inspect report counts the copies, and a camera preview hides them.
 * - `previewClip(preview)` plays a clip on an entity at the time of each frame, over the animation tracks (the
 *   preview of the clip browser). It needs a sequence: with no sequence, the core has no time line.
 * - `setPanes(panes)` divides the canvas into 2 or 4 views (splitView.ts). The main view at the top left draws the
 *   frame of the page. Each other pane draws its own camera with its own view mode. The shadow maps and the world
 *   matrices update one time, in the main view. The panes draw with no effect (no selection outline).
 */
import type { ClipPreview } from "@scenity/runtime";
import type { DocumentCoreOptions } from "@scenity/runtime/documentCore";
import { DocumentCore } from "@scenity/runtime/documentCore";
import type { MetricDefinition, MetricPlugin, RuleResult } from "@scenity/rules";
import { DebugLayers } from "../debugLayers";
import { bindDevPlugin, type DevLayer } from "../devLayers";
import { inspectScene } from "./inspectScene";
import type { SceneInspectReport } from "./report";
import { checkRules, type RuleCheckRequest } from "./ruleCheck";
import { SCENE_LAYERS, sceneDebugInput, type SceneLayerData } from "./sceneLayers";
import { capturePreview, VIEW_PREVIEW, type PreviewRequest } from "./cameraPreview";
import { ViewGrid } from "./viewGrid";
import { SHADING_MODES, ViewShading } from "./viewShading";
import { Wireframe } from "./wireframe";
import { paneBoxes } from "../panes";
import { SINGLE_VIEW, type ScenePane, type ScenePanes } from "./splitView";
import { GhostCopies, type GhostSpec } from "./ghostCopies";
import { OnionCopies, type OnionCopiesSpec } from "./onionCopies";
import type { LightShadow, Object3D } from "three";

/** A dev face of a plugin (`scenity.dev`): its metric library and its debug layers over the scene. */
export interface DevFace extends MetricPlugin {
  readonly layers?: readonly DevLayer<SceneLayerData>[];
}

/** The core layers of the editor viewport: the grid and the shading modes. */
export const VIEWPORT_LAYERS: readonly string[] = ["grid", ...SHADING_MODES];

/** The layer names that the core handles without a drawer. */
const CORE_LAYERS = ["wireframe", ...VIEWPORT_LAYERS];

export class DevDocumentCore extends DocumentCore {
  /** The plugins whose debug layers the core has. */
  readonly #layered = new Set<string>();
  readonly #debug = new DebugLayers(CORE_LAYERS);
  readonly #wireframe = new Wireframe();
  readonly #grid = new ViewGrid();
  readonly #shading = new ViewShading();
  /** The camera previews that wait for the next frame. */
  readonly #previews: PreviewRequest[] = [];
  readonly #metrics: MetricPlugin[] = [];
  #debugAdded = false;
  /** The panes of the split view. */
  #panes: ScenePanes = SINGLE_VIEW;
  /** The onion skins of an entity. */
  readonly #onion = new OnionCopies();
  /** The ghosts of the changes that wait. */
  readonly #ghosts = new GhostCopies();
  /** The time of the frame of the page (ms), or null. */
  #sim: number | null = null;
  /** The shading of each pane after the main view. */
  readonly #paneShading = new Map<number, ViewShading>();

  constructor(options: DocumentCoreOptions) {
    super(options);
    this.#debug.register(bindDevPlugin({ layers: SCENE_LAYERS }, () => this.#layerData()));
  }

  /**
   * Add the debug layers of a dev plugin; `data` gives the data of its layers at each draw. The library metrics of the
   * plugin go to the registry of the rule checks.
   */
  useDevPlugin<Data>(
    plugin: {
      readonly id?: string;
      readonly layers: readonly DevLayer<Data>[];
      readonly library?: readonly MetricDefinition[];
    },
    data: () => Data,
  ): void {
    this.#debug.register(bindDevPlugin(plugin, data));
    if (plugin.id !== undefined && plugin.library !== undefined) {
      this.#metrics.push({ id: plugin.id, library: plugin.library });
    }
  }

  /**
   * Add the metric libraries of the dev faces of the plugins (`scenity.dev`) to the rule checks. The debug layers of a
   * dev face draw over the scene with the data of the scene layers (the builder and the camera).
   */
  useMetrics(plugins: readonly DevFace[]): void {
    for (const plugin of plugins) {
      if (plugin.library !== undefined && !this.#metrics.some((each) => each.id === plugin.id)) {
        this.#metrics.push({ id: plugin.id, library: plugin.library });
      }
      if (plugin.layers !== undefined && !this.#layered.has(plugin.id)) {
        this.#layered.add(plugin.id);
        this.#debug.register(bindDevPlugin({ layers: plugin.layers }, () => this.#layerData()));
      }
    }
  }

  /** Evaluate rules on the scene at the times of their scopes. After the check, the core returns to its time. */
  checkRules(request: RuleCheckRequest): RuleResult[] {
    if (!this.#hasDocument()) return [];
    const core = {
      builder: this.builder,
      update: (sim: number | null) => this.update(sim),
      time: this.lastSim ?? null,
    };
    const results = checkRules(core, request, this.#metrics);
    this.invalidate();
    return results;
  }

  /** The names of the debug layers that the core can draw. */
  debugLayers(): string[] {
    return this.#debug.names();
  }

  /** Show the debug layers of the names and hide every other layer. */
  setDebug(layers: readonly string[]): void {
    if (!this.#debugAdded && layers.length > 0) {
      this.scene.add(this.#debug.root);
      this.#debugAdded = true;
    }
    this.#debug.set(layers);
    this.invalidate();
  }

  /** Divide the canvas into the panes of a layout; one view (layout "1") draws only the frame of the page. */
  setPanes(panes: ScenePanes): void {
    this.#panes = panes;
    if (panes.layout === "1") this.viewSize = null;
    this.invalidate();
  }

  /** Set the onion skins of an entity (null or no copies: none). */
  setOnion(spec: OnionCopiesSpec | null): void {
    this.#onion.set(spec);
    this.invalidate();
  }

  /** Set the ghosts of the changes that wait (null or no copies: none). */
  setGhosts(spec: GhostSpec | null): void {
    this.#ghosts.set(spec);
    this.invalidate();
  }

  /** Set the preview clip of the clip browser (null: none). */
  previewClip(preview: ClipPreview | null): void {
    this.plugins.previewClip(preview);
    this.invalidate();
  }

  /**
   * A picture of the view of a document camera (null: the first one), `width` pixels wide with the aspect of the
   * canvas. Null with no document or when the browser cannot take the picture. `at` gives the scene at that time (ms),
   * only for the picture: the frame of the page keeps the time of its clock.
   */
  previewCamera(name: string | null, width: number, at: number | null = null): Promise<ImageBitmap | null> {
    if (!this.#hasDocument()) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.#previews.push({ name, width, at, resolve });
      this.invalidate();
    });
  }

  /** The inspect report of the last frame. */
  inspect(): SceneInspectReport {
    const names = this.#debug.names();
    const layers = { names, on: names.filter((name) => this.#debug.has(name)) };
    if (!this.#hasDocument()) {
      return {
        simMs: null,
        bounds: null,
        entities: [],
        totals: { entities: 0, triangles: 0, drawCalls: 0 },
        layers,
      };
    }
    const animators = this.animators().map(({ entity, layers: states }) => ({ entity, layers: states }));
    return {
      ...inspectScene(this.builder, this.lastSim ?? null, layers),
      onion: this.#onion.count,
      ghosts: this.#ghosts.count,
      animators,
    };
  }

  override dispose(): void {
    for (const request of this.#previews.splice(0)) request.resolve(Promise.resolve(null));
    if (this.#hasDocument()) for (const shading of this.#paneShading.values()) shading.clear(this.builder.root);
    this.#wireframe.clear();
    this.#grid.dispose();
    this.#debug.dispose();
    super.dispose();
  }

  /** Keep the time of the frame of the page, so a preview at another time can set it again. */
  protected override updateScene(input: unknown, simOrNull: number | null): void {
    this.#sim = simOrNull;
    super.updateScene(input, simOrNull);
  }

  /** Draw the debug layers of this frame, then the frame of the document core. */
  protected override renderPasses(): void {
    if (this.#hasDocument()) {
      this.#onion.apply(this.scene, (id) => this.builder.entityObject(id));
      this.#ghosts.apply(this.scene, (id) => this.builder.entityObject(id));
      this.#drawPreviews();
      this.#wireframe.apply(this.builder.root, this.#debug.has("wireframe"));
      this.#shading.apply(this.builder.root, SHADING_MODES.find((mode) => this.#debug.has(mode)) ?? null);
      this.#grid.apply(this.scene, this.#debug.has("grid"));
      if (this.#debug.drawing) {
        this.builder.root.updateMatrixWorld();
        this.#debug.draw(sceneDebugInput(this.builder));
      }
    }
    if (this.#panes.layout === "1" || !this.#hasDocument()) super.renderPasses();
    else this.#drawPanes();
  }

  /** Draw each pane of the split view in its viewport and scissor box. */
  #drawPanes(): void {
    const { renderer } = this;
    const canvas = renderer.domElement;
    const ratio = renderer.getPixelRatio();
    const boxes = paneBoxes(this.#panes.layout, canvas.width, canvas.height);
    const shadows = this.#shadows();
    this.plainFrames = true;
    renderer.setScissorTest(true);
    try {
      boxes.forEach((box, index) => {
        // The classic WebGL renderer measures y from the bottom edge, the WebGPU renderer from the top edge.
        const y = this.backend.kind === "webgl" ? canvas.height - box.y - box.height : box.y;
        renderer.setViewport(box.x / ratio, y / ratio, box.width / ratio, box.height / ratio);
        renderer.setScissor(box.x / ratio, y / ratio, box.width / ratio, box.height / ratio);
        this.viewSize = { width: box.width / ratio, height: box.height / ratio };
        if (index === 0) {
          super.renderPasses();
          // The other panes use the shadow maps and the world matrices of the main view.
          for (const shadow of shadows) shadow.autoUpdate = false;
          this.scene.matrixWorldAutoUpdate = false;
          return;
        }
        const pane = this.#panes.others[index - 1] ?? { view: null, camera: null, mode: null };
        this.#drawPane(index, pane, () => {
          super.renderPasses();
        });
      });
    } finally {
      for (const shadow of shadows) shadow.autoUpdate = true;
      this.scene.matrixWorldAutoUpdate = true;
      this.plainFrames = false;
      renderer.setScissorTest(false);
      const main = boxes[0];
      this.viewSize = main === undefined ? null : { width: main.width / ratio, height: main.height / ratio };
      const size = { width: canvas.width / ratio, height: canvas.height / ratio };
      renderer.setViewport(0, 0, size.width, size.height);
      renderer.setScissor(0, 0, size.width, size.height);
    }
  }

  /** Draw one pane with its view mode and its camera, then set the view mode of the main view again. */
  #drawPane(index: number, pane: ScenePane, draw: () => void): void {
    const root = this.builder.root;
    const shading = this.#paneShading.get(index) ?? new ViewShading();
    this.#paneShading.set(index, shading);
    const main = this.#wireframe;
    main.clear();
    this.#shading.restore(root);
    const wire = new Wireframe();
    wire.apply(root, pane.mode === "wireframe");
    shading.apply(root, pane.mode === "unlit" || pane.mode === "normalShading" ? pane.mode : null);
    try {
      if (pane.view !== null) this.withEditorView(pane.view, draw);
      else this.withDocumentCamera(pane.camera, draw);
    } finally {
      shading.restore(root);
      wire.clear();
    }
  }

  /** The shadows of the lights of the scene. */
  #shadows(): LightShadow[] {
    const found: LightShadow[] = [];
    this.scene.traverse((object) => {
      const light = object as Object3D & { readonly isLight?: boolean; readonly shadow?: LightShadow };
      if (light.isLight === true && light.shadow !== undefined) found.push(light.shadow);
    });
    return found;
  }

  /**
   * Draw the view of each waiting preview with no dev layer and no view mode, and take its picture. The frame
   * of the page comes after it in the same task, so the canvas shows the frame of the page.
   */
  #drawPreviews(): void {
    const requests = this.#previews.splice(0);
    if (requests.length === 0) return;
    const showGrid = this.#grid.hide();
    this.#onion.show(false);
    this.#ghosts.show(false);
    const layers = this.#debug.root.visible;
    this.#debug.root.visible = false;
    this.#wireframe.clear();
    this.#shading.clear(this.builder.root);
    try {
      for (const request of requests) {
        // The scene at the time of the request, only for its picture.
        if (request.at !== null) super.updateScene(this.input, request.at);
        // A preview of the view keeps the current camera.
        if (request.name === VIEW_PREVIEW) super.renderPasses();
        else {
          // The effects of the page are for its camera, so a picture of another camera draws with no effect. Thus the
          // pictures stay the same, and the core does not build the effects of the view of the person again.
          const plain = this.plainFrames;
          this.plainFrames = true;
          this.withDocumentCamera(request.name, () => {
            super.renderPasses();
          });
          this.plainFrames = plain;
        }
        request.resolve(capturePreview(this.options.canvas, request.width, this.surface));
      }
    } finally {
      // The scene returns to the time of the page before the frame of the page.
      if (requests.some((request) => request.at !== null)) super.updateScene(this.input, this.#sim);
      showGrid();
      this.#onion.show(true);
      this.#ghosts.show(true);
      this.#debug.root.visible = layers;
    }
  }

  #layerData(): SceneLayerData {
    return { builder: this.builder, frameCamera: this.anchorCamera() };
  }

  /** True after the first scene document. */
  #hasDocument(): boolean {
    try {
      this.builder.document();
      return true;
    } catch {
      return false;
    }
  }
}
