// SPDX-License-Identifier: Apache-2.0
/**
 * The split screen of the labs core: one canvas, 1 to 4 panes, each with its camera. The core updates the scene one
 * time per frame. Then the hook `renderPasses` of the runtime draws each pane with its viewport, its scissor and its
 * camera. Thus all the panes show the same simulation time.
 *
 * - The shadow map and the world matrices: the first pane draws and updates them; the other panes of the frame use
 *   them (`LightShadow.autoUpdate` and `Scene.matrixWorldAutoUpdate` off). Both renderers obey these flags.
 * - The cards and the hit tests use the main pane: after the panes, `camera` has the view of the main pane with
 *   a view offset, so the projection of a point on the full canvas gives its point in the main pane (the main pane is
 *   at the top left corner). A pointer outside the main pane hits no member.
 * - The capture: one pane (default: the main pane) or the whole canvas (`grid`).
 *
 * One pane (the default) draws exactly the frame of the runtime: the hook of the runtime draws it.
 *
 * A pane can have its own tune values (`PaneViews.tunes`, a layout variant). Then each pane draws its own scene. Before
 * its render, the labs core updates the scene of the page input at the clock time with the tune values of the pane
 * (`paneScene`). It starts from the frame memory of a page that opens (as a seek). The pane draws its own shadow map
 * and world matrices. After the panes, the core sets the scene of the page again, so the cards, the pick and the
 * inspect report read the page. All the panes show the same clock time. Each pane is a pure function of the input, its
 * tune values and the time.
 *
 * The labs core can hide items in a pane for its render (`showPane`, solo and hide). While a hide is on, each render
 * draws its own shadow map (`ownShadows`). Thus a hidden item casts no shadow in its pane, and a picture that shows
 * every item has every shadow.
 *
 * The split screen is a mixin over the generic scene core of the runtime (`withPanes`), so the dev tools extend any
 * plugin core through its hooks. The frame memory of the plugin core goes through `saveMemory` and `restoreMemory`.
 */
import type { AssetReport, PointerKind, SceneCoreOptions } from "@scenity/runtime/protocol";
import { viewCamera, type CameraView } from "@scenity/runtime/framing";
import type { SceneCore } from "@scenity/runtime/sceneCore";
import { PerspectiveCamera, Vector2, type LightShadow, type Object3D } from "three";
import {
  hasPaneTunes,
  paneBoxes,
  paneCount,
  SINGLE_PANE,
  type CaptureTarget,
  type PaneBox,
  type PaneTunes,
  type PaneViews,
} from "./panes";

/**
 * A class of a scene core: the base of the mixins of the dev tools. The mixins read the input and the memory of
 * the plugin as unknown values.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- A mixin base has a constructor with one rest parameter of type any[] (TS2545).
export type SceneCoreClass = abstract new (...args: any[]) => SceneCore<unknown, unknown, AssetReport>;

/** The options of the split screen: the view of the main pane and the panes at the start. */
export interface PanesCoreOptions extends SceneCoreOptions {
  /** A fixed camera of the main pane in place of the framing, or null. */
  readonly view?: CameraView | null;
  /** The panes at the start; absent: one pane. */
  readonly panes?: PaneViews | null;
}

/**
 * A small part of a pixel: the renderers multiply the CSS values by the pixel ratio, then round (WebGL) or floor
 * (WebGPU). With this part both give the whole pixel of the pane box.
 */
const PIXEL_PART = 1e-3;

/** The panes with another view of one pane. */
function withView(panes: PaneViews, index: number, view: CameraView | null): PaneViews {
  const views = [...panes.views];
  while (views.length <= index) views.push(null);
  views[index] = view;
  return { ...panes, views };
}

/** The split screen over a scene core: the panes, their renders, their picks and their captures. */
// eslint-disable-next-line max-lines-per-function -- A mixin is a class in a function; each method keeps the limit.
export function withPanes<Base extends SceneCoreClass>(base: Base) {
  abstract class PanesCore extends base {
    /** The current panes. The base constructor aims the camera before the core sets this field. */
    private panes: PaneViews = SINGLE_PANE;
    /** The shadows of the lights of the scene, found at the first frame with panes. */
    private shadows: LightShadow[] | null = null;
    private readonly size = new Vector2();
    /** The camera of a pick in a pane (paneTarget). */
    private readonly pickCamera = new PerspectiveCamera();
    /** The frame memory of a page that opens: a pane with its own tune values starts from it (as a seek). */
    private readonly openMemory: unknown = this.saveMemory();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- A mixin class has a constructor with one rest parameter of type any[] (TS2545).
    constructor(...args: any[]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- The arguments of the base core.
      super(...args);
      const options = args[0] as PanesCoreOptions;
      this.panes = options.panes ?? SINGLE_PANE;
      if (options.view !== undefined) this.panes = withView(this.panes, 0, options.view);
      if (this.mainView !== null || this.split) this.applySurface();
    }

    /** The view of the main pane: a fixed camera, or null for the framing of the plugin core. */
    protected get mainView(): CameraView | null {
      return this.viewOf(0);
    }

    protected set mainView(view: CameraView | null) {
      this.panes = withView(this.panes, 0, view);
    }

    /** True with two or more panes. */
    protected get split(): boolean {
      return paneCount(this.currentPanes().layout) > 1;
    }

    /** Set the main pane to a fixed view, or to the framing of the plugin core (null). */
    setView(view: CameraView | null): void {
      this.mainView = view;
      this.applySurface();
      this.invalidate();
    }

    /** The layout and the views of the panes (the worker message `views`). */
    setPanes(panes: PaneViews): void {
      this.panes = panes;
      this.applySurface();
      this.invalidate();
    }

    /**
     * Update the scene for one pane: the page input at the clock time with these tune values (null: the tune
     * values of the page), from this frame memory. A hook of the labs core; the split screen alone does nothing.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- A hook: the labs core reads the arguments.
    protected paneScene(_tunes: PaneTunes | null, _memory: unknown): void {
      // The split screen alone has no scene of its own for a pane.
    }

    /**
     * Start a new node frame of the WebGPU renderer before a pane with its own scene. Its shadow maps draw one time for
     * each camera and node frame (three.js 0.186 `ShadowNode.updateBefore`). The panes share the camera and the frame
     * of the browser. Without a new frame, the second pane draws with the shadow map of the first scene. The node frame
     * is a field of the renderer without a public setter (`_nodes.nodeFrame`). Without that field, the shadow map does
     * not change. WebGLRenderer draws the shadow maps at each render with `autoUpdate`.
     */
    private newShadowFrame(): void {
      if (this.backend.kind !== "webgpu") return;
      const nodes = (this.renderer as unknown as { _nodes?: { nodeFrame?: { frameId: number } } })._nodes;
      if (nodes?.nodeFrame !== undefined) nodes.nodeFrame.frameId += 1;
    }

    /** The own tune values of the panes of the layout, or null when every pane shows the scene of the page. */
    private ownTunes(): readonly (PaneTunes | null)[] | null {
      const panes = this.currentPanes();
      if (!this.split || !hasPaneTunes(panes)) return null;
      return Array.from({ length: paneCount(panes.layout) }, (_, index) => panes.tunes?.[index] ?? null);
    }

    /**
     * Hide the items that a pane does not show, for its render; the function shows them again (null: no change).
     * A hook of the labs core; the split screen alone hides nothing.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- A hook: the labs core reads the argument.
    protected showPane(_index: number): (() => void) | null {
      return null;
    }

    /**
     * True while the items of a render can differ from the items of the render before it (a hook of the labs core:
     * a hide is on). Each render then draws its own shadow map.
     */
    protected ownShadows(): boolean {
      return false;
    }

    /** One render of a pane with the items that the pane shows (and its own shadow map while a hide is on). */
    private renderPane(index: number): void {
      if (this.ownShadows()) this.newShadowFrame();
      const showAgain = this.showPane(index);
      try {
        this.backend.render(this.scene, this.camera);
      } finally {
        showAgain?.();
      }
    }

    /** The debug layers of the scene, or null (a hook of the labs core: a pane can hide them). */
    protected debugLayer(): Object3D | null {
      return null;
    }

    protected override aimCamera(aspect: number): void {
      this.aimPane(0, aspect);
    }

    /** Aim `camera` at the view of a pane for an aspect, without the view offset of the cards. */
    protected aimPane(index: number, aspect: number): void {
      const camera = this.camera;
      if (camera.view !== null) camera.view.enabled = false;
      const view = this.viewOf(index);
      if (view === null) super.aimCamera(aspect);
      else viewCamera(camera, view, aspect);
    }

    protected override renderPasses(): void {
      if (this.split) this.drawPanes();
      else {
        // The pass of the runtime draws the one pane with the items that the pane shows.
        if (this.ownShadows()) this.newShadowFrame();
        const showAgain = this.showPane(0);
        try {
          super.renderPasses();
        } finally {
          showAgain?.();
        }
      }
    }

    /** Draw the frame of the page again: after a capture at another size or without some layers. */
    protected drawPage(): void {
      if (this.split) this.drawPanes();
      else this.renderPane(0);
    }

    override pointerAt(x: number, y: number, kind: PointerKind): void {
      if (!this.split) {
        super.pointerAt(x, y, kind);
        return;
      }
      // The hit tests use only the main pane.
      const size = this.renderer.getSize(this.size);
      const main = paneBoxes(this.panes.layout, size.x, size.y)[0];
      const inside = main !== undefined && x >= 0 && y >= 0 && x < main.width && y < main.height;
      super.pointerAt(x, y, inside ? kind : "leave");
    }

    /**
     * The camera and the box (CSS pixels) of a pane for a pick, or null for a pane that the layout does not
     * have. The camera has the world matrix of the view of the pane.
     */
    protected paneTarget(pane: number): { readonly camera: PerspectiveCamera; readonly box: PaneBox } | null {
      const count = paneCount(this.panes.layout);
      if (!Number.isInteger(pane) || pane < 0 || pane >= count) return null;
      const size = this.renderer.getSize(this.size);
      if (count === 1) {
        this.camera.updateMatrixWorld();
        return { camera: this.camera, box: { x: 0, y: 0, width: size.x, height: size.y } };
      }
      const box = paneBoxes(this.panes.layout, size.x, size.y)[pane];
      if (box === undefined) return null;
      this.aimPane(pane, box.width / box.height);
      this.camera.updateMatrixWorld();
      this.pickCamera.copy(this.camera);
      this.aimCards();
      return { camera: this.pickCamera, box };
    }

    /**
     * The box of a capture in pixels of the drawing buffer: the whole canvas for `grid` or for one pane, else the
     * box of the pane (default: the main pane). Null for a pane that the layout does not have.
     */
    protected captureBox(target: CaptureTarget): PaneBox | null {
      const canvas = this.renderer.domElement;
      const full = { x: 0, y: 0, width: canvas.width, height: canvas.height };
      const pane = target.pane ?? 0;
      if (target.grid === true) return full;
      if (!Number.isInteger(pane) || pane < 0 || pane >= paneCount(this.panes.layout)) return null;
      return this.split ? (paneBoxes(this.panes.layout, canvas.width, canvas.height)[pane] ?? null) : full;
    }

    /**
     * Draw the frame again at `width` × `height` pixels at its own aspect, copy the picture, then give the canvas its
     * own size and draw the frame of the page again. The picture is one pane with its camera, or with `grid` all the
     * panes at that size. All of it runs in the task of the render: `createImageBitmap` copies the canvas at the call,
     * and the browser shows only the last drawing.
     */
    protected drawAtSize(width: number, height: number, target: CaptureTarget): Promise<ImageBitmap> {
      const canvas = this.renderer.domElement;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      if (target.grid === true && this.split) {
        this.drawPanes();
      } else {
        // A pane with its own tune values draws its own scene. Then the core sets the scene of the page again.
        const own = this.ownTunes();
        const memory = this.saveMemory();
        if (own !== null) {
          this.paneScene(own[target.pane ?? 0] ?? null, this.openMemory);
          this.newShadowFrame();
        }
        this.aimPane(target.pane ?? 0, width / height);
        this.renderPane(target.pane ?? 0);
        if (own !== null) this.paneScene(null, memory);
      }
      const copy = createImageBitmap(canvas);
      this.applySurface();
      this.drawPage();
      return copy;
    }

    /** The panes, also during the base constructor (before the field exists). */
    private currentPanes(): PaneViews {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The base constructor aims before this field exists.
      return this.panes ?? SINGLE_PANE;
    }

    private viewOf(index: number): CameraView | null {
      return this.currentPanes().views[index] ?? null;
    }

    /** Draw every pane: its viewport, its scissor, its camera and its debug layers; the shadow map one time. */
    private drawPanes(): void {
      const { renderer } = this;
      const canvas = renderer.domElement;
      const ratio = renderer.getPixelRatio();
      const boxes = paneBoxes(this.panes.layout, canvas.width, canvas.height);
      const shadows = this.lightShadows();
      const debug = this.debugLayer();
      const debugShown = debug?.visible === true;
      // With own tune values, every pane draws its own scene. After the panes, the core sets the page memory again.
      const own = this.ownTunes();
      const memory = this.saveMemory();
      // While a hide is on, each pane draws its own shadow map (renderPane).
      const apart = own === null && this.ownShadows();
      renderer.setScissorTest(true);
      try {
        boxes.forEach((box, index) => {
          // The classic WebGL renderer measures y from the bottom edge, the WebGPU renderer from the top edge.
          const y = this.backend.kind === "webgl" ? canvas.height - box.y - box.height : box.y;
          const css = (value: number) => (value + PIXEL_PART) / ratio;
          renderer.setViewport(css(box.x), css(y), css(box.width), css(box.height));
          renderer.setScissor(css(box.x), css(y), css(box.width), css(box.height));
          this.aimPane(index, box.width / box.height);
          if (own !== null) {
            this.paneScene(own[index] ?? null, this.openMemory);
            this.newShadowFrame();
          }
          if (debug !== null) debug.visible = debugShown && this.panes.hideDebug?.[index] !== true;
          // The first pane draws the shadow map and updates the world matrices; the other panes of the frame use them.
          // While a hide is on, each pane draws its own shadow map. A pane with its own scene draws its own shadow map
          // and world matrices.
          if (index === 1 && own === null) {
            for (const shadow of shadows) shadow.autoUpdate = apart;
            this.scene.matrixWorldAutoUpdate = false;
          }
          this.renderPane(index);
        });
      } finally {
        if (own !== null) this.paneScene(null, memory);
        for (const shadow of shadows) shadow.autoUpdate = true;
        this.scene.matrixWorldAutoUpdate = true;
        if (debug !== null) debug.visible = debugShown;
        renderer.setScissorTest(false);
        renderer.getSize(this.size);
        renderer.setViewport(0, 0, this.size.x, this.size.y);
        renderer.setScissor(0, 0, this.size.x, this.size.y);
        this.aimCards();
      }
    }

    /**
     * Aim `camera` for the cards and the hit tests: the view of the main pane with a view offset, so that a
     * projection on the full canvas gives the point in the main pane at the top left corner.
     */
    private aimCards(): void {
      const canvas = this.renderer.domElement;
      const main = paneBoxes(this.panes.layout, canvas.width, canvas.height)[0];
      if (main === undefined || !this.split) return;
      this.aimPane(0, main.width / main.height);
      this.camera.setViewOffset(main.width, main.height, 0, 0, canvas.width, canvas.height);
      this.camera.updateMatrixWorld();
    }

    /** The shadows of the lights of the scene (the core makes its lights one time, in its constructor). */
    private lightShadows(): LightShadow[] {
      if (this.shadows === null) {
        const found: LightShadow[] = [];
        this.scene.traverse((object) => {
          const light = object as Object3D & { readonly isLight?: boolean; readonly shadow?: LightShadow };
          if (light.isLight === true && light.shadow !== undefined) found.push(light.shadow);
        });
        this.shadows = found;
      }
      return this.shadows;
    }
  }
  return PanesCore;
}
