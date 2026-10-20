// SPDX-License-Identifier: Apache-2.0
/**
 * The lab methods of a renderer: the scene client of the runtime with the methods of the dev core. With a worker (the
 * dev worker of the plugin), the lab methods are messages. The main-thread fallback calls the dev core. The plugin
 * makes the client with its core (its `createLabsRenderer`), then adds these methods (`withDevMethods`).
 */
import type { SceneLink } from "@scenity/runtime/client";
import type { CameraView } from "@scenity/runtime/framing";
import type { ExtensionMessage } from "@scenity/runtime/protocol";
import type { GhostSpec, GhostView } from "./ghosts";
import { PANE_HIDE_MESSAGE, plainHide, type HideSpec } from "./hideSpec";
import type { FrameCapture, InspectReport } from "./inspect";
import type { OnionSpec, OnionView } from "./onion";
import type { OverlaySpec, OverlayView, PropBox } from "./overlay";
import { plainPanes, type CaptureTarget, type PaneViews } from "./panes";
import type { PickResult, SelectTarget } from "./pickMath";
import type { PreviewModel } from "./preview";
import type { ScratchUpdate } from "./scratch";
import type { CaptureCheck } from "./readback";
import type { IndexShot, ShotRequest } from "./shots";
import type { SweepSample } from "./sweep";
import type { DevInit, DevToWorker } from "./worker/protocol";

/** The options of the lab methods: the fields of the "init" message of the dev worker. */
export interface DevRendererOptions {
  /** A fixed camera in place of the framing, for a close look at the props. */
  readonly view?: CameraView | null;
  /** The count of asset loads at the same time; absent: the value of the runtime. */
  readonly loads?: number | undefined;
  /** The panes of the split screen at the start; absent: one pane. */
  readonly panes?: PaneViews | null | undefined;
}

/** The lab methods of a renderer. `Report` is the inspect report of the plugin core. */
export interface DevMethods<Report extends InspectReport = InspectReport> {
  /** A fixed camera of the main pane, or null for the framing of the plugin core. */
  setView(view: CameraView | null): void;
  /** The layout of the split screen and the camera of each pane, the main pane first. */
  setPanes(panes: PaneViews): void;
  /** Draw a frame at the current time of the page clock. The promise gives that time after the frame. */
  mark(): Promise<number | null>;
  /** The debug layers over the scene. */
  setDebug(layers: readonly string[]): void;
  /** The report of the last frame. */
  inspect(): Promise<Report | null>;
  /**
   * The tune values. Each other tuned number returns to its default. `quick`: a step of a prop drag moves only the
   * props. The rest of the plugin follows at the next call without `quick`.
   */
  setTunes(values: Readonly<Record<string, number>>, quick?: boolean): void;
  /**
   * Draw a frame at the current time of the page clock. Give a picture of it `width` CSS pixels wide (0: none) and the
   * clips of the members (for the content browser). A `height` above 0 draws the picture at `width` × `height` pixels,
   * with the camera framed for that aspect, whatever the size of the canvas. With panes, the picture is one pane
   * (`target.pane`, default the main pane) or the whole canvas (`target.grid`).
   */
  capture(width: number, height?: number, target?: CaptureTarget): Promise<FrameCapture>;
  /**
   * The inspect report at each sample, without a render: one message for all the samples. Null when the renderer stops
   * first.
   */
  sweep(samples: readonly SweepSample[]): Promise<readonly Report[] | null>;
  /**
   * The pictures of the frame index at the samples, at a size and a view, without a seek: the page shows no other
   * time. Null when the renderer stops first.
   */
  shots(request: ShotRequest): Promise<readonly IndexShot<Report>[] | null>;
  /**
   * The page clock changed: a seek, a play or a pause. The worker gets the clock immediately (not at the next sample of
   * the timer) and draws its time. A stopped clock then stops the frame loop and the clock samples until the next
   * change.
   */
  clockChanged(stopped: boolean): void;
  /**
   * What is under a point of the canvas (CSS pixels) in a pane of the last frame. Null when the ray hits nothing or the
   * renderer stops first.
   */
  pick(x: number, y: number, pane?: number): Promise<PickResult | null>;
  /** The selection outline: one item, a list of the selected items with one box for each, or null for none. */
  setSelection(target: SelectTarget | readonly SelectTarget[] | null): void;
  /** The import previews at their drop points (preview.ts); an empty list removes them. */
  setPreviews(models: readonly PreviewModel[]): void;
  /** The scratch props of the checkout and, when they change, their models (scratch.ts). */
  setScratch(update: ScratchUpdate): void;
  /** The ghosts of the proposals (ghosts.ts); an empty list removes them. Not a frame input. */
  setGhosts(specs: readonly GhostSpec[]): void;
  /** The ghosts as the core draws them; an empty list when the renderer stops first. */
  ghosts(): Promise<readonly GhostView[]>;
  /** The editor overlay (overlay.ts); an empty spec removes it. Not a frame input. */
  setOverlay(spec: OverlaySpec): void;
  /** The overlay as the core draws it; null before its first use or when the renderer stops first. */
  overlay(): Promise<OverlayView | null>;
  /** The box of each prop in the frame of its place; an empty object when the renderer stops first. */
  propBoxes(): Promise<Readonly<Record<string, PropBox>>>;
  /** The onion skin (onion.ts); a spec with no offsets removes it. Not a frame input. */
  setOnion(spec: OnionSpec): void;
  /** The onion skin as the core draws it; null before its first use or when the renderer stops first. */
  onion(): Promise<OnionView | null>;
  /** The solo and hide of the panes (hiding.ts); an empty spec shows every item. Not a frame input. */
  setHidden(spec: HideSpec): void;
  /** The solo and hide as the core holds it; null when the renderer stops first. */
  hidden(): Promise<HideSpec | null>;
  /**
   * Draw a frame and compare a capture of the canvas with a readback of its pixels. Null when the renderer stops first
   * or cannot copy the canvas.
   */
  captureCheck(): Promise<CaptureCheck | null>;
}

/** The public methods of the dev core that the lab methods call (devCore.ts; the main thread and the worker). */
export interface DevCoreApi<Report extends InspectReport = InspectReport> {
  setView(view: CameraView | null): void;
  setPanes(panes: PaneViews): void;
  mark(done: (simMs: number | null) => void): void;
  setDebug(layers: readonly string[]): void;
  inspect(): Report;
  setTunes(values: Readonly<Record<string, number>>, quick?: boolean): string[];
  capture(width: number, done: (capture: FrameCapture) => void, height?: number, target?: CaptureTarget): void;
  sweep(samples: readonly SweepSample[]): Report[];
  shots(request: ShotRequest): Promise<IndexShot<Report>[]>;
  setClockStopped(stopped: boolean): void;
  pick(x: number, y: number, pane?: number): PickResult | null;
  setSelection(target: SelectTarget | readonly SelectTarget[] | null): void;
  setPreviews(models: readonly PreviewModel[]): void;
  setScratch(update: ScratchUpdate): void;
  setGhosts(specs: readonly GhostSpec[]): void;
  ghosts(): GhostView[];
  setOverlay(spec: OverlaySpec): void;
  overlayView(): OverlayView | null;
  propBoxes(): Record<string, PropBox>;
  setOnion(spec: OnionSpec): void;
  onionView(): OnionView | null;
  setHidden(spec: HideSpec): void;
  hiddenView(): HideSpec;
  captureCheck(done: (check: CaptureCheck | null) => void): void;
}

/** The lab methods on the core of the main thread. */
export function devMainMethods<Report extends InspectReport>(core: DevCoreApi<Report>): DevMethods<Report> {
  return {
    setView: (view) => {
      core.setView(view);
    },
    setPanes: (panes) => {
      core.setPanes(plainPanes(panes));
    },
    mark: () =>
      new Promise<number | null>((resolve) => {
        core.mark(resolve);
      }),
    setDebug: (layers) => {
      core.setDebug(layers);
    },
    inspect: () => Promise.resolve(core.inspect()),
    setTunes: (values, quick) => {
      core.setTunes(values, quick);
    },
    capture: (width, height = 0, target = {}) =>
      new Promise<FrameCapture>((resolve) => {
        core.capture(width, resolve, height, target);
      }),
    sweep: (samples) => Promise.resolve(core.sweep(samples)),
    shots: (request) => core.shots(request),
    // The core of the main thread reads the page clock at each frame: it needs no samples.
    clockChanged: (stopped) => {
      core.setClockStopped(stopped);
    },
    pick: (x, y, pane = 0) => Promise.resolve(core.pick(x, y, pane)),
    setSelection: (target) => {
      core.setSelection(target);
    },
    setPreviews: (models) => {
      core.setPreviews(models);
    },
    setScratch: (update) => {
      core.setScratch(update);
    },
    setGhosts: (specs) => {
      core.setGhosts(specs);
    },
    ghosts: () => Promise.resolve(core.ghosts()),
    setOverlay: (spec) => {
      core.setOverlay(spec);
    },
    overlay: () => Promise.resolve(core.overlayView()),
    propBoxes: () => Promise.resolve(core.propBoxes()),
    setOnion: (spec) => {
      core.setOnion(spec);
    },
    onion: () => Promise.resolve(core.onionView()),
    setHidden: (spec) => {
      core.setHidden(plainHide(spec));
    },
    hidden: () => Promise.resolve(core.hiddenView()),
    captureCheck: () =>
      new Promise<CaptureCheck | null>((resolve) => {
        core.captureCheck(resolve);
      }),
  };
}

/**
 * Send the page clock to the worker immediately. A stopped clock gets two samples of the same time, so its last anchor
 * stays (not the slope of the samples before it), and the timer samples stop. A clock that runs gets one more sample at
 * the next paint. Thus the worker has the slope one frame after a play or a seek, not after 100 ms.
 */
function sendClock(link: WorkerLink, stopped: boolean): void {
  link.hold(stopped);
  link.tick();
  if (stopped) link.tick();
  link.send({ type: "clockStopped", stopped } satisfies DevToWorker);
  if (!stopped && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      link.tick();
    });
  }
}

/** The channel of a client in a worker. */
type WorkerLink = Extract<SceneLink<unknown>, { mode: "worker" }>;

/** The answer of each lab message: the field of the value, and the value when the renderer stops first. */
const ANSWERS = {
  drawn: { field: "simMs", stopped: null },
  inspected: { field: "report", stopped: null },
  captured: { field: "capture", stopped: { simMs: null, bitmap: null, members: [] } },
  swept: { field: "reports", stopped: null },
  shot: { field: "shots", stopped: null },
  picked: { field: "result", stopped: null },
  captureChecked: { field: "check", stopped: null },
  ghostList: { field: "ghosts", stopped: [] },
  overlayList: { field: "overlay", stopped: null },
  boxList: { field: "boxes", stopped: {} },
  onionList: { field: "onion", stopped: null },
  hideList: { field: "spec", stopped: null },
} as const;

type AnswerType = keyof typeof ANSWERS;

/** The requests of the page that wait for an answer of the dev worker, by request ID. */
class Waiting {
  private readonly entries = new Map<number, { readonly answer: AnswerType; readonly done: (value: never) => void }>();
  private nextId = 1;

  /**
   * Send a request with a new ID and give its answer (`tick`: first a clock sample of the current time, as for a mark).
   */
  ask<T>(link: WorkerLink, answer: AnswerType, message: (id: number) => DevToWorker, tick = false): Promise<T> {
    return new Promise<T>((resolve) => {
      const id = this.nextId;
      this.nextId += 1;
      this.entries.set(id, { answer, done: resolve });
      if (tick) link.tick();
      link.send(message(id));
    });
  }

  /** An answer of the worker: the value of its field ends the request of its ID. */
  answer(message: ExtensionMessage): void {
    const id = message.id;
    const entry = typeof id === "number" ? this.entries.get(id) : undefined;
    if (entry === undefined) return;
    this.entries.delete(id as number);
    entry.done(message[ANSWERS[entry.answer].field] as never);
  }

  /** The renderer stops: each request gets its value for a stop. */
  stop(): void {
    for (const entry of this.entries.values()) entry.done(ANSWERS[entry.answer].stopped as never);
    this.entries.clear();
  }
}

/** The lab methods as messages to the dev worker, and the answers that end them on dispose. */
export function devWorkerMethods<Report extends InspectReport>(
  link: WorkerLink,
): DevMethods<Report> & { readonly stop: () => void } {
  const send = (message: DevToWorker): void => {
    link.send(message);
  };
  const waiting = new Waiting();
  link.listen((message: ExtensionMessage) => {
    waiting.answer(message);
  });
  return {
    ...workerSetters(send),
    // First a clock sample of the current time: the frame of the mark has the current time of the page clock.
    mark: () => waiting.ask(link, "drawn", (id) => ({ type: "mark", id }), true),
    inspect: () => waiting.ask(link, "inspected", (id) => ({ type: "inspect", id })),
    capture: (width, height = 0, target = {}) =>
      waiting.ask(link, "captured", (id) => ({ type: "capture", id, width, height, target: { ...target } }), true),
    sweep: (samples) => waiting.ask(link, "swept", (id) => ({ type: "sweep", id, samples })),
    shots: (request) => waiting.ask(link, "shot", (id) => ({ type: "shots", id, ...request })),
    clockChanged: (stopped) => {
      sendClock(link, stopped);
    },
    pick: (x, y, pane = 0) => waiting.ask(link, "picked", (id) => ({ type: "pick", id, x, y, pane })),
    ghosts: () => waiting.ask(link, "ghostList", (id) => ({ type: "listGhosts", id })),
    overlay: () => waiting.ask(link, "overlayList", (id) => ({ type: "listOverlay", id })),
    propBoxes: () => waiting.ask(link, "boxList", (id) => ({ type: "propBoxes", id })),
    onion: () => waiting.ask(link, "onionList", (id) => ({ type: "listOnion", id })),
    hidden: () => waiting.ask(link, "hideList", (id) => ({ type: "listHide", id })),
    captureCheck: () => waiting.ask(link, "captureChecked", (id) => ({ type: "captureCheck", id }), true),
    stop: () => {
      waiting.stop();
    },
  };
}

/** The lab methods that only send a message to the dev worker (no answer). */
function workerSetters(
  send: (message: DevToWorker) => void,
): Pick<
  DevMethods,
  | "setView"
  | "setPanes"
  | "setDebug"
  | "setTunes"
  | "setSelection"
  | "setPreviews"
  | "setScratch"
  | "setGhosts"
  | "setOverlay"
  | "setOnion"
  | "setHidden"
> {
  return {
    setView: (view) => {
      send({ type: "view", view });
    },
    setPanes: (panes) => {
      send({ type: "views", ...plainPanes(panes) });
    },
    setDebug: (layers) => {
      send({ type: "debug", layers });
    },
    setTunes: (values, quick) => {
      send({ type: "tune", values, quick: quick === true });
    },
    setSelection: (target) => {
      send({ type: "select", target });
    },
    setPreviews: (models) => {
      send({ type: "previews", models });
    },
    setScratch: (update) => {
      send({ type: "scratch", update });
    },
    setGhosts: (specs) => {
      send({ type: "ghosts", specs });
    },
    setOverlay: (spec) => {
      send({ type: "overlay", spec });
    },
    setOnion: (spec) => {
      send({ type: "onion", spec });
    },
    setHidden: (spec) => {
      send({ type: PANE_HIDE_MESSAGE, spec: plainHide(spec) });
    },
  };
}

/** The fields of the "init" message of the dev worker from the options of the renderer. */
export function devInit(options: DevRendererOptions): DevInit {
  return {
    view: options.view ?? null,
    ...(options.loads === undefined ? {} : { loads: options.loads }),
    ...(options.panes == null ? {} : { panes: plainPanes(options.panes) }),
  };
}

/**
 * Add the lab methods to a scene client: on the dev core of the main thread, or as messages to the dev worker. The
 * plugin gives the link that its client made (SceneClientOptions.link).
 */
export function withDevMethods<Client extends { dispose(): void }, Report extends InspectReport>(
  base: Client,
  link: SceneLink<unknown> | null,
): Client & DevMethods<Report> {
  if (link === null) throw new Error("The scene client gave no link.");
  if (link.mode === "main") return { ...base, ...devMainMethods(link.core as DevCoreApi<Report>) };
  const { stop, ...methods } = devWorkerMethods<Report>(link);
  return {
    ...base,
    ...methods,
    dispose: () => {
      stop();
      base.dispose();
    },
  };
}
