// SPDX-License-Identifier: Apache-2.0
/**
 * The dev core: a scene core of a plugin with the lab tools. It is a mixin over the generic scene core of the runtime
 * (`withDevCore`). Thus the runtime has no lab code, and each plugin core gets the tools through its hooks. The tools
 * are the frame mark, the debug layers, the inspect report, the tune values, the fixed camera of the lab and the split
 * of the work in the statistics. The tools also include the update-only sweep, the split screen (panesCore.ts), the lab
 * layers (layersCore.ts) and the onion skin (onion.ts). A pane with its own tune values (a layout variant) gets its own
 * scene (`paneScene`).
 *
 * The plugin core gives its data through the hooks of this class and of layersCore.ts: the figures of the last update
 * (`devFigures`), the work points (`devPoints`), the prop places (`devPlaces`) and the data of the debug layers
 * (`debugScene`). The hooks also give the inspect report (`inspect`), the effects of the tune values (`movesPlaces`,
 * `placeAgain`, `tunesApplied`) and the trace of the reads of a frame (`traceReads`). The defaults give a core without
 * these parts.
 */
import { percentile } from "@scenity/runtime/hostMath";
import type { AssetReport, SceneStats } from "@scenity/runtime/protocol";
import type { Object3D } from "three";
import { DebugLayers, NO_DEBUG_INPUT, type DebugInput } from "./debugLayers";
import { bindDevPlugin, type BoundLayer, type DevLayer } from "./devLayers";
import { heapMb } from "./heap";
import type { FrameCapture, InspectReport } from "./inspect";
import { withLayers, type CaptureRequest } from "./layersCore";
import type { CaptureTarget, PaneTunes } from "./panes";
import type { PanesCoreOptions, SceneCoreClass } from "./panesCore";
import { checkCapture, type CaptureCheck } from "./readback";
import { validShotRequest, type IndexShot, type ShotRequest } from "./shots";
import type { SweepSample } from "./sweep";
import { propTimesOf, TimedTunes } from "./timedPlaces";
import { applyTunes } from "./tune";

export type { DevFigure } from "./layersCore";

/** The options of the dev core: a fixed camera of the main pane in place of the framing, and the panes. */
export interface DevCoreOptions extends PanesCoreOptions {
  /** The count of asset loads at the same time; absent: the value of the runtime. */
  readonly loads?: number;
}

/** The lab tools over the lab layers and the split screen of a scene core. */
// eslint-disable-next-line max-lines-per-function -- A mixin is a class in a function; each method keeps the limit.
export function withDevCore<Base extends SceneCoreClass>(base: Base) {
  abstract class DevCore extends withLayers(base) {
    /** The callers that wait for the next frame (mark). */
    private readonly marks: ((simMs: number | null) => void)[] = [];
    /** The callers that wait for a capture of the next frame (for the content browser): the size of the picture. */
    private readonly captures: CaptureRequest[] = [];
    /** The requests of index pictures for the next frame (shots). */
    private readonly shotRequests: { readonly request: ShotRequest; readonly done: (shots: IndexShot[]) => void }[] =
      [];
    /** The callers that wait for a capture check of the next frame (readback.ts). */
    private readonly checks: ((check: CaptureCheck | null) => void)[] = [];
    /** The debug layers over the scene. The core adds them to the scene at their first use. */
    private debug: DebugLayers | null = null;
    /** The debug layers of the dev plugins of the core (useDevPlugin). */
    private readonly pluginLayers: BoundLayer[] = [];
    /** The work split: the update of the scene (poses, IK, props, debug layers) and the render calls. */
    private readonly updateTimes: number[] = [];
    private readonly renderTimes: number[] = [];
    /** The part of the update that poses the figures; the plugin core adds to `poseMs` in each update. */
    private readonly poseTimes: number[] = [];
    protected poseMs = 0;
    /** True when the clock of the page is stopped (setClockStopped). */
    private stopped = false;
    /** The last input of the page (setInput): the sweep gives the core other inputs, then this input again. */
    private pageInput: unknown = null;
    /** The time of the last update of the scene (the clock time of the frame in `renderPasses`). */
    private updatedSim: number | null = null;
    /** The frame memory of a page that opens, for the onion skin. */
    private readonly freshMemory: unknown = this.saveMemory();
    /** The tune values of the page and the timed prop places of the input (timedPlaces.ts). */
    private readonly timedTunes = new TimedTunes();
    /** True after a quick new placement of the props (a step of a drag): the plugin waits for the rest. */
    private propsQuick = false;

    override setInput(input: unknown): void {
      this.pageInput = input;
      this.useInput(input);
    }

    /** Use an input of the page or of a sample, with its timed prop places for the next updates. */
    private useInput(input: unknown): void {
      // The base class can call setInput before the fields of this class exist.
      (this.timedTunes as TimedTunes | undefined)?.setTimes(propTimesOf(input));
      super.setInput(input);
    }

    // The hooks of the plugin core. -------------------------------------------------------------------------------

    /** The data of the debug layers that the figures and the points do not give: obstacles, stands, walks, routes. */
    protected debugScene(): Omit<DebugInput, "figures" | "points"> {
      return NO_DEBUG_INPUT;
    }

    /**
     * Add the debug layers of a dev plugin (devLayers.ts). `data` gives the data of the plugin layers at each draw. The
     * plugin core calls this method in its constructor.
     */
    protected useDevPlugin<Data>(plugin: { readonly layers: readonly DevLayer<Data>[] }, data: () => Data): void {
      const bound = bindDevPlugin(plugin, data);
      this.pluginLayers.push(...bound);
      this.debug?.register(bound);
    }

    /** True when the changed tune keys move the props of the scene (the plugin then places them again). */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- A hook: the plugin core reads the argument.
    protected movesPlaces(_changed: readonly string[]): boolean {
      return false;
    }

    /** Place the props again after a tune change; `quick` (a step of a drag) moves only the props. */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- A hook: the plugin core reads the argument.
    protected placeAgain(_quick: boolean): void {
      // A core without props does nothing here.
    }

    /** After the tune values changed the keys `changed` (for example, the plugin applies its lights). */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- A hook: the plugin core reads the argument.
    protected tunesApplied(_changed: readonly string[]): void {
      // A core without such parts does nothing here.
    }

    /**
     * Call `draw` (one frame of a sample) and give the reads of the plugin code that it called, or null when they are
     * not known. The frame index keeps a picture after an edit of code that the frame does not read.
     */
    protected traceReads(draw: () => void): readonly string[] | null {
      draw();
      return null;
    }

    /**
     * What the last frame drew: the report of each member and the work points. The plugin core gives the
     * members and its own fields; the default has no members.
     */
    inspect(): InspectReport {
      return { simMs: this.lastSim ?? null, members: [], points: { ...this.devPoints() } };
    }

    // ------------------------------------------------------------------------------------------------------------

    /**
     * The inspect report at each time of the samples, without a render. For each sample in time order, the core does
     * what a frame after a seek does without the render. It takes the input of the sample, removes the history
     * (forgetHistory) and updates the scene at the time. Then it updates the world matrices, as a render does, and
     * gives the report. The frame memory of the plugin goes from sample to sample, as in a rendered sweep. At the end,
     * the core uses the input of the page again and removes the history. The next frame draws the time of the clock.
     */
    sweep(samples: readonly SweepSample[]): InspectReport[] {
      const reports: InspectReport[] = [];
      if (this.disposed) return reports;
      const pageInput = this.pageInput;
      try {
        for (const { simMs, input } of samples) {
          this.useInput(input);
          this.forgetHistory();
          this.beforeUpdate();
          this.update(simMs);
          this.afterUpdate();
          this.scene.updateMatrixWorld();
          this.camera.updateMatrixWorld();
          this.lastSim = simMs;
          // A copy: the next sample can change the points that a report refers to (main-thread core).
          reports.push(structuredClone(this.inspect()));
        }
      } finally {
        if (pageInput !== null) this.useInput(pageInput);
        this.forgetHistory();
        this.invalidate();
      }
      return reports;
    }

    /**
     * The pictures of the frame index without a seek (shots.ts). For each sample in time order, the core updates the
     * scene as the sweep does, draws it at the size and the view of the request and copies the canvas. In the same
     * task, it sets the input, the view and the size of the page again and draws the frame of the page time again. Thus
     * the browser never shows a picture of the index.
     */
    shots(request: ShotRequest): Promise<IndexShot[]> {
      // A WebGPU backend draws only after its device is ready.
      const unready = this.disposed || !this.backend.isReady();
      if (unready || !validShotRequest(request) || typeof createImageBitmap !== "function") {
        return Promise.resolve([]);
      }
      // The pictures come in the task of the next frame, after its render, as a capture does. In Chromium, a draw
      // outside the frame loop of the worker stopped its next animation frame (an end-to-end test showed this).
      return new Promise((resolve) => {
        this.shotRequests.push({ request, done: resolve });
        this.invalidate();
      });
    }

    /** Draw the pictures of a request after the frame of the page at `pageSim` (afterFrame, shots). */
    private drawShots(request: ShotRequest, pageSim: number | null): Promise<IndexShot[]> {
      const canvas = this.renderer.domElement;
      const { pageInput, mainView: pageView } = this;
      // The samples change the frame memory of the plugin. The page frame after them gets the memory of the page
      // frames again: a picture of the index must not change the next frame of the page.
      const memory = this.saveMemory();
      const copies: Promise<ImageBitmap | null>[] = [];
      const reports: InspectReport[] = [];
      const reads: (readonly string[] | null)[] = [];
      // The pictures of the index have no selection outline, no import preview, no ghost, no editor overlay and no
      // onion skin. Each layer stays hidden for all the samples (a member that the page frame does not draw can show in
      // a sample).
      const layers = this.pictureLayers();
      for (const layer of layers) layer?.suppress(true);
      try {
        // An index picture is one view on the full picture, also when the page has panes.
        this.mainView = request.view;
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(request.width, request.height, false);
        for (const { simMs, input } of request.samples) {
          // The reads of the plugin code from the update to the report (traceReads).
          const traced = this.traceReads(() => {
            this.drawAt(input, simMs);
            this.aimCamera(request.width / request.height);
            this.renderer.render(this.scene, this.camera);
            copies.push(createImageBitmap(canvas).catch(() => null));
            this.lastSim = simMs;
            reports.push(structuredClone(this.inspect()));
          });
          reads.push(traced);
        }
      } finally {
        for (const layer of layers) layer?.suppress(false);
        this.mainView = pageView;
        this.applySurface();
        this.restoreMemory(memory);
        if (pageInput !== null) this.drawAt(pageInput, pageSim);
        this.drawPage();
        this.lastSim = pageSim;
        this.forgetHistory();
      }
      return Promise.all(copies).then((bitmaps) =>
        reports.map((report, index) => ({
          simMs: report.simMs ?? 0,
          bitmap: bitmaps[index] ?? null,
          report,
          families: reads[index] ?? null,
        })),
      );
    }

    protected override update(simOrNull: number | null): void {
      this.updatedSim = simOrNull;
      // The timed prop places of the input at the time of this update (a change places the props again).
      const timed = this.timedTunes.at(simOrNull ?? 0);
      if (timed !== null) this.tuneScene(timed);
      super.update(simOrNull);
    }

    protected override renderPasses(): void {
      this.poseOnion();
      super.renderPasses();
    }

    /**
     * The onion skin of a frame (onion.ts). For each offset, the core updates the scene at the clock time plus the
     * offset with the scene input of that time. It does this as a page that opens at that time (no frame history, the
     * frame memory of a new page). The layer then copies the poses of the members. Then the core updates the scene at
     * the clock time again with the frame memory of the page. Only a stopped clock gets a pass. A scene that runs keeps
     * its frame history, and the copies are hidden.
     */
    private poseOnion(): void {
      const onion = this.onionLayer;
      if (onion?.active !== true) return;
      const input = this.pageInput;
      const sim = this.updatedSim;
      if (!this.clockStopped() || input === null || sim === null) {
        onion.idle(this.clockStopped() ? "no clock time" : "the clock runs: the onion skin shows on a stopped clock");
        return;
      }
      if (!onion.hasSamples(sim)) {
        onion.idle("no scene input at the times of the copies (the page sends them for a stopped clock)");
        return;
      }
      const memory = this.saveMemory();
      try {
        onion.pose(sim, (time, sample) => {
          this.restoreMemory(this.freshMemory);
          this.drawAt(sample, time);
          this.scene.updateMatrixWorld();
          return this.devFigures()
            .filter((figure) => figure.visible)
            .map((figure) => ({ id: figure.id, root: figure.root, joints: () => figure.joints() }));
        });
      } finally {
        this.restoreMemory(memory);
        this.drawAt(input, sim);
      }
    }

    /** Update one pane with its own tune values (null: the page) from a memory (panesCore.ts). */
    protected override paneScene(tunes: PaneTunes | null, memory: unknown): void {
      if (this.pageInput === null) return;
      this.tuneScene(this.timedTunes.paneValues(tunes, this.updatedSim ?? 0));
      this.restoreMemory(memory);
      this.drawAt(this.pageInput, this.updatedSim);
    }

    /** Update the scene at a time for an input after a seek (no history): the sweep and the shots. */
    private drawAt(input: unknown, simMs: number | null): void {
      this.useInput(input);
      this.forgetHistory();
      this.beforeUpdate();
      this.update(simMs);
      this.afterUpdate();
    }

    /**
     * The clock of the page is stopped (true) or runs (false). A stopped clock stops the frame loop: a frame of the
     * same time is the same frame. Each call draws one frame, so a seek of a stopped clock shows the new time. The
     * poses do not read this value (it is not `flags.paused`, which gives still poses).
     */
    setClockStopped(stopped: boolean): void {
      this.stopped = stopped;
      this.invalidate();
    }

    protected override clockStopped(): boolean {
      // The base class can call this method before the fields of this class exist.
      return (this.stopped as boolean | undefined) === true;
    }

    /** The debug layers, which a pane of the split screen can hide. */
    protected override debugLayer(): Object3D | null {
      return this.debug?.root ?? null;
    }

    /** Show or hide the debug layers: the generic layers and the layers of the dev plugins. */
    setDebug(layers: readonly string[]): void {
      if (this.debug === null) {
        if (layers.length === 0) return;
        this.debug = new DebugLayers();
        this.debug.register(this.pluginLayers);
        this.scene.add(this.debug.root);
      }
      this.debug.set(layers);
      this.invalidate();
    }

    /**
     * Set the tune values (tune.ts): each value at its path, every other tuned number at its default. The next frame
     * uses them. A change that moves the props places them again (`placeAgain` of the plugin). Returns the paths that
     * are not tuned numbers. The timed prop places of the input have priority over the tune values of the page. `quick`
     * (a step of a prop drag): the props move immediately. The rest of the plugin waits for the next call without
     * `quick` (the end of the drag), which also comes with the same values.
     */
    setTunes(values: Readonly<Record<string, number>>, quick = false): string[] {
      const { changed, unknown } = this.tuneScene(this.timedTunes.setPage(values), quick);
      const due = !quick && this.propsQuick;
      if (due) this.placeAgain(false);
      this.propsQuick = quick && (this.propsQuick || this.movesPlaces(changed));
      if (changed.length > 0 || due) this.invalidate();
      return unknown;
    }

    /** Apply tune values: the props again after a change of their places, then the other effects of the plugin. */
    private tuneScene(
      values: Readonly<Record<string, number>>,
      quick = false,
    ): { changed: string[]; unknown: string[] } {
      const done = applyTunes(values);
      if (this.movesPlaces(done.changed)) this.placeAgain(quick);
      this.tunesApplied(done.changed);
      return done;
    }

    /**
     * Draw a frame at the current time of the clock, then call `done` with that time. The lab and its tools take a
     * screenshot after it. A stopped clock also draws again. The frame comes at the next frame of the scheduler. In
     * Chromium, a frame outside the scheduler slowed the frame loop of the worker after it.
     */
    mark(done: (simMs: number | null) => void): void {
      this.marks.push(done);
      this.invalidate();
    }

    /**
     * Draw a frame at the current time of the clock, and give a picture of the canvas `width` CSS pixels wide (0: no
     * picture) with the clip of each member (for the content browser). The picture comes from the canvas in the task of
     * the render, before the browser shows the frame, so the drawing buffer still has it. A `height` above 0 gives a
     * picture of `width` × `height` pixels at its own aspect (`drawAtSize`), so a thin canvas still gives a full
     * picture. With panes, the picture is one pane (`target.pane`, default the main pane) or the whole canvas
     * (`target.grid`).
     */
    capture(width: number, done: (capture: FrameCapture) => void, height = 0, target: CaptureTarget = {}): void {
      this.captures.push({ width, height, target, done });
      this.invalidate();
    }

    /**
     * Draw a frame and compare a `createImageBitmap` copy of the canvas with a readback of its pixels
     * (readback.ts). Equal pixels prove the capture path on the backend.
     */
    captureCheck(done: (check: CaptureCheck | null) => void): void {
      this.checks.push(done);
      this.invalidate();
    }

    override stats(reset: boolean): SceneStats & AssetReport {
      // The split of the work and the memory: the stats card of the lab shows them.
      const split = {
        updateP95: percentile(this.updateTimes, 0.95),
        renderP95: percentile(this.renderTimes, 0.95),
        poseP95: percentile(this.poseTimes, 0.95),
        // The memory of the backend (WebGL programs or WebGPU pipelines).
        memory: this.backend.memory(),
        heapMb: heapMb(),
      };
      if (reset) this.updateTimes.length = this.renderTimes.length = this.poseTimes.length = 0;
      return { ...super.stats(reset), ...split };
    }

    override dispose(): void {
      super.dispose();
      // A caller that waits for a frame (mark, the lab tools) gets no frame of this core.
      for (const done of this.marks.splice(0)) done(null);
      for (const capture of this.captures.splice(0)) capture.done({ simMs: null, bitmap: null, members: [] });
      for (const shot of this.shotRequests.splice(0)) shot.done([]);
      for (const done of this.checks.splice(0)) done(null);
      this.debug?.dispose();
      this.disposeLayers();
    }

    protected override beforeUpdate(): void {
      super.beforeUpdate();
      this.poseMs = 0;
    }

    protected override afterUpdate(): void {
      super.afterUpdate();
      this.drawOutline();
      this.ghostLayer?.update(this.scene, this.devPlaces());
      if (this.debug?.active !== true) return;
      this.debug.draw({ ...this.debugScene(), figures: this.devFigures(), points: Object.values(this.devPoints()) });
    }

    protected override afterFrame(sim: number | null, start: number, updated: number, rendered: number): void {
      super.afterFrame(sim, start, updated, rendered);
      this.pushStat(this.updateTimes, updated - start);
      this.pushStat(this.poseTimes, this.poseMs);
      this.pushStat(this.renderTimes, rendered - updated);
      for (const done of this.marks.splice(0)) done(sim);
      // The check reads the frame of the render before a capture draws again.
      if (this.checks.length > 0) {
        const check = checkCapture(this.renderer, this.backend.kind);
        for (const done of this.checks.splice(0)) void check.then(done);
      }
      if (this.captures.length > 0) this.takeCaptures(sim);
      // The index pictures come after the captures, which read the frame of the page.
      for (const { request, done } of this.shotRequests.splice(0)) {
        this.drawShots(request, sim).then(done, () => done([]));
      }
    }

    /**
     * The pictures and the clips of the frame that the render just drew (capture). First the captures without the onion
     * skin, then the captures that ask for it (`target.onion`, else the capture mode of the page). The groups of the
     * captures are in layersCore.ts (with or without the onion skin, with or without the hide).
     */
    private takeCaptures(sim: number | null): void {
      const members = this.devFigures()
        .filter((figure) => figure.visible)
        .map((figure) => ({ id: figure.id, clip: figure.clip, family: figure.family }));
      this.captureAll(this.captures.splice(0), sim, members, this.onionLayer?.inCaptures ?? false);
    }
  }
  return DevCore;
}
