// SPDX-License-Identifier: Apache-2.0
/**
 * The lab layers of the labs core: the objects that the lab page puts over the scene. The dev core (devCore.ts)
 * extends this mixin, which is a mixin over the split screen (`withLayers`).
 *
 * - **Views of the lab, not frame inputs**: the selection outline (selection.ts), the import previews (preview.ts), the
 *   ghosts of the proposals (ghosts.ts), the editor overlay (overlay.ts) and the onion skin (onion.ts). The pictures of
 *   the core (the captures, the strip, the frame index) hide them (`pictureLayers`). The pick skips them (pick.ts).
 * - **A frame input**: the scratch props of the checkout (scratch.ts). Every picture shows them.
 *
 * Each layer goes into the scene at its first use. `captureGroup` copies the captures of one frame without the views of
 * the lab (with the onion skin when the captures ask for it).
 *
 * The solo and hide of the panes (hiding.ts) is a view of the lab: each pane draws and picks without the items that it
 * hides. A capture shows every item unless it asks for the hide (`hidden`). The pictures of the frame index never hide
 * items.
 */
import { GhostLayer, type GhostSpec, type GhostView } from "./ghosts";
import type { HideSpec } from "./hideSpec";
import { PaneHiding } from "./hiding";
import type { FrameCapture, Joints } from "./inspect";
import { OnionLayer, type OnionSpec, type OnionView } from "./onion";
import { OverlayLayer, type OverlaySpec, type OverlayView, type PropBox } from "./overlay";
import { withPanes, type SceneCoreClass } from "./panesCore";
import { handTips, pickScene, placeBox, type PickResult } from "./pick";
import type { CaptureTarget } from "./panes";
import { hideLayers, PreviewLayer, type HiddenLayer, type PreviewModel } from "./preview";
import { ScratchLayer, type ScratchUpdate } from "./scratch";
import { propObject, SelectionOutline, type SelectTarget } from "./selection";
import type { Vec3 } from "@scenity/character/math";
import type { HandGoal } from "@scenity/character/place";
import type { Object3D } from "three";

/** The place of a prop of the scene: its position (metres) and its turn about the vertical (radians). */
export interface PropPlace {
  readonly at: Vec3;
  readonly yaw: number;
}

/** A figure that the last update drew (a hook of the plugin core): a member of the scene. */
export interface DevFigure {
  readonly id: string;
  /** The root of the figure in the scene (the pick skips its meshes and tests the capsules of its joints). */
  readonly root: Object3D;
  /** The pose of the figure shows it in the frame. */
  readonly visible: boolean;
  readonly clip: string | null;
  readonly family: string;
  /** The goals of the two hands (left, right) for the debug layer `ik`; absent: no goals. */
  readonly hands?: readonly [HandGoal, HandGoal];
  /** The current places of the joints in the room. */
  joints(): Joints;
}

/** A caller that waits for a capture of the next frame (for the content browser): the size of the picture. */
export interface CaptureRequest {
  readonly width: number;
  /** Above 0: the picture has this height, drawn at its own aspect. */
  readonly height: number;
  /** One pane (default: the main pane) or the whole canvas, with or without the onion skin. */
  readonly target: CaptureTarget;
  readonly done: (capture: FrameCapture) => void;
}

/** The lab layers over the split screen of a scene core. */
// eslint-disable-next-line max-lines-per-function -- A mixin is a class in a function; each method keeps the limit.
export function withLayers<Base extends SceneCoreClass>(base: Base) {
  abstract class LayersCore extends withPanes(base) {
    /** The selection outline. */
    protected outline: SelectionOutline | null = null;
    /** The import previews. */
    protected previews: PreviewLayer | null = null;
    /** The scratch props of the checkout (scratch.ts), a frame input: every picture shows them. */
    protected scratchProps: ScratchLayer | null = null;
    /** The ghosts of the proposals (ghosts.ts). */
    protected ghostLayer: GhostLayer | null = null;
    /** The editor overlay (overlay.ts). */
    protected overlay: OverlayLayer | null = null;
    /** The onion skin (onion.ts); the dev core poses it. */
    protected onionLayer: OnionLayer | null = null;
    /** The solo and hide of the panes (hiding.ts). The base constructor can draw before this field exists. */
    protected readonly hiding = new PaneHiding();

    /**
     * The layers that a picture of the core hides: the views of the lab. With `onion`, the picture keeps the onion skin
     * (a capture that asks for it).
     */
    protected pictureLayers(onion = false): (HiddenLayer | null)[] {
      const layers = [this.outline, this.previews, this.ghostLayer, this.overlay];
      return onion ? layers : [...layers, this.onionLayer];
    }

    /** Set the solo and hide of the panes (hiding.ts); an empty spec shows every item. Not a frame input. */
    setHidden(spec: HideSpec): void {
      this.hiding.set(spec);
      this.invalidate();
    }

    /** The current solo and hide of the panes (the script API `hidden()`). */
    hiddenView(): HideSpec {
      return this.hiding.get();
    }

    protected override showPane(index: number): (() => void) | null {
      // The base constructor can draw before the field exists.
      return (this.hiding as PaneHiding | undefined)?.apply(this.scene, index) ?? null;
    }

    protected override ownShadows(): boolean {
      return (this.hiding as PaneHiding | undefined)?.active ?? false;
    }

    /**
     * The pictures of the captures of one frame in groups: first without the onion skin, then with it (`onionMode` is
     * the capture mode of the page). In each group, first the pictures with every item, then the pictures with the
     * hide.
     */
    protected captureAll(
      asked: readonly CaptureRequest[],
      sim: number | null,
      members: FrameCapture["members"],
      onionMode: boolean,
    ): void {
      for (const withOnion of [false, true]) {
        for (const withHidden of [false, true]) {
          const group = asked.filter(
            ({ target }) => (target.onion ?? onionMode) === withOnion && (target.hidden === true) === withHidden,
          );
          if (group.length > 0) this.captureGroup(group, sim, members, withOnion, withHidden);
        }
      }
    }

    /** The figures that the last update drew (the members of the scene). */
    protected devFigures(): readonly DevFigure[] {
      return [];
    }

    /** The named work points of the scene in the room: the near points of a pick and the points of the report. */
    protected devPoints(): Readonly<Record<string, Vec3>> {
      return {};
    }

    /** The joints of the members of the last frame, for the selection outline. */
    protected outlineMembers(): Map<string, Joints> {
      return new Map(this.devFigures().map((figure) => [figure.id, figure.joints()]));
    }

    /**
     * What is under a point of the canvas (CSS pixels) in the last frame (pick.ts): the prop, the member or the item of
     * a plugin kind, the bone, the hit point and the near work points. `pane` is the pane of the split screen. The
     * point is a canvas point, and the pick uses the camera and the box of that pane. The main pane is at the top left
     * corner, so its points are canvas points. The pick reads the scene and draws nothing.
     */
    pick(x: number, y: number, pane = 0): PickResult | null {
      const target = this.disposed ? null : this.paneTarget(pane);
      if (target === null) return null;
      const { camera, box } = target;
      this.scene.updateMatrixWorld();
      // The pick of a pane skips the items that the pane hides (a hidden member root is not visible).
      const showAgain = this.showPane(pane);
      try {
        const members = this.devFigures()
          .filter((figure) => figure.visible && figure.root.visible)
          .map((figure) => {
            const root = figure.root;
            return { id: figure.id, root, joints: figure.joints(), tips: handTips(root) };
          });
        const input = { scene: this.scene, camera, width: box.width, height: box.height, members };
        const places = { points: this.devPoints(), places: this.devPlaces() };
        return pickScene({ ...input, ...places }, x - box.x, y - box.y, { pane });
      } finally {
        showAgain?.();
      }
    }

    /**
     * The places of the props of the scene by slot (a hook of the plugin core): the outline, the ghosts, the
     * pick and the prop boxes read them. The default has no props.
     */
    protected devPlaces(): Readonly<Record<string, PropPlace>> {
      return {};
    }

    /**
     * Outline the selected prop, member or item of a plugin kind, or nothing (null) (selection.ts). A list of the
     * selected items gets one box for each item.
     */
    setSelection(target: SelectTarget | readonly SelectTarget[] | null): void {
      if (this.outline === null) {
        if (target === null || (Array.isArray(target) && target.length === 0)) return;
        this.outline = new SelectionOutline();
        this.scene.add(this.outline.root);
      }
      this.outline.set(target);
      this.drawOutline();
      this.invalidate();
    }

    /** Update the outline of the selection from the current scene. */
    protected drawOutline(): void {
      if (this.outline?.active !== true) return;
      this.outline.update({ scene: this.scene, places: this.devPlaces(), members: this.outlineMembers() });
    }

    /** Set the scratch props and their models (scratch.ts). */
    setScratch(update: ScratchUpdate): void {
      this.scratchProps ??= ScratchLayer.addTo(this.scene);
      this.scratchProps.set(update);
      this.invalidate();
    }

    /** Set the import previews at their drop points; an empty list removes them (preview.ts). */
    setPreviews(models: readonly PreviewModel[]): void {
      if (this.previews === null) {
        if (models.length === 0) return;
        this.previews = new PreviewLayer();
        this.scene.add(this.previews.root);
      }
      this.previews.set(models);
      this.invalidate();
    }

    /**
     * Set the ghosts of the proposals (ghosts.ts): a copy of each prop at its proposed place, and the markers. An empty
     * list removes them. The captures, the strip and the frame index do not show them.
     */
    setGhosts(specs: readonly GhostSpec[]): void {
      if (this.ghostLayer === null) {
        if (specs.length === 0) return;
        this.ghostLayer = new GhostLayer();
        this.scene.add(this.ghostLayer.root);
      }
      this.ghostLayer.set(specs);
      this.ghostLayer.update(this.scene, this.devPlaces());
      this.invalidate();
    }

    /** The ghosts as the core draws them (the script API `ghosts()`). */
    ghosts(): GhostView[] {
      return this.ghostLayer?.list() ?? [];
    }

    /**
     * Set the editor overlay (overlay.ts): the snap target of a drag and the measurements. An empty spec removes it.
     * The captures, the strip and the frame index do not show it.
     */
    setOverlay(spec: OverlaySpec): void {
      if (this.overlay === null) {
        if (spec.lines.length + spec.dots.length + spec.labels.length === 0) return;
        this.overlay = new OverlayLayer();
        this.scene.add(this.overlay.root);
      }
      this.overlay.set(spec);
      this.invalidate();
    }

    /** The editor overlay as the core draws it (the script API), or null before its first use. */
    overlayView(): OverlayView | null {
      return this.overlay?.list() ?? null;
    }

    /**
     * Set the onion skin (onion.ts): the members and the offsets of the copies from the clock time. A spec with no
     * offsets removes it. The captures, the strip and the frame index do not show it, unless a capture asks for it.
     */
    setOnion(spec: OnionSpec): void {
      if (this.onionLayer === null) {
        if (spec.offsets.length === 0) return;
        this.onionLayer = new OnionLayer();
        this.scene.add(this.onionLayer.root);
      }
      this.onionLayer.set(spec);
      this.invalidate();
    }

    /** The onion skin as the core draws it (the script API `onionView()`), or null before its first use. */
    onionView(): OnionView | null {
      return this.onionLayer?.list() ?? null;
    }

    /**
     * The box of each prop of the scene in the frame of its place (for the surfaces of the snap), as the pick gives
     * `local`: the model of the prop, else its graybox part. A prop that the scene does not show has no box.
     */
    propBoxes(): Record<string, PropBox> {
      const boxes: Record<string, PropBox> = {};
      if (this.disposed) return boxes;
      this.scene.updateMatrixWorld();
      for (const [slot, place] of Object.entries(this.devPlaces())) {
        const object = propObject(this.scene, slot);
        if (object !== null) boxes[slot] = placeBox(object, place);
      }
      return boxes;
    }

    /** The pictures of a group of captures of one frame, with or without the onion skin. */
    protected captureGroup(
      group: readonly CaptureRequest[],
      sim: number | null,
      members: FrameCapture["members"],
      withOnion: boolean,
      withHidden = false,
    ): void {
      const canvas = this.renderer.domElement;
      // A capture has no selection outline, no import preview, no ghost, no editor overlay and (unless it asks) no
      // onion skin. Unless the capture asks for the hide, it also shows every item that a pane hides. The frame draws
      // again without these layers, then again with them after the copies.
      const showAgain = hideLayers(this.pictureLayers(withOnion));
      const unhide = !withHidden && this.hiding.active;
      if (unhide) this.hiding.suppress(true);
      const again = showAgain !== null || unhide;
      if (again) this.drawPage();
      for (const { width, height: asked, target, done } of group) {
        const fail = () => done({ simMs: sim, bitmap: null, members });
        // The box of the pane or of the grid; none for a pane that the layout does not have.
        const box = this.captureBox(target);
        if (width <= 0 || canvas.width === 0 || box === null || typeof createImageBitmap !== "function") {
          fail();
          continue;
        }
        if (asked > 0) {
          this.drawAtSize(width, asked, target).then((bitmap) => done({ simMs: sim, bitmap, members }), fail);
          continue;
        }
        const height = Math.max(1, Math.round((width * box.height) / box.width));
        const options = { resizeWidth: width, resizeHeight: height, resizeQuality: "medium" } as const;
        const whole = box.width === canvas.width && box.height === canvas.height;
        const copy = whole
          ? createImageBitmap(canvas, options)
          : createImageBitmap(canvas, box.x, box.y, box.width, box.height, options);
        copy.then((bitmap) => done({ simMs: sim, bitmap, members }), fail);
      }
      if (again) {
        showAgain?.();
        this.hiding.suppress(false);
        this.drawPage();
      }
    }

    /** Remove the lab layers (the dispose of the core). */
    protected disposeLayers(): void {
      const layers: ({ dispose(): void } | null)[] = [
        this.outline,
        this.previews,
        this.scratchProps,
        this.ghostLayer,
        this.overlay,
        this.onionLayer,
      ];
      for (const layer of layers) layer?.dispose();
    }
  }
  return LayersCore;
}
