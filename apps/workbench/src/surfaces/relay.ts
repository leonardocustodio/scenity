// SPDX-License-Identifier: Apache-2.0
/**
 * The relay between the host and the surface frames (the page half). The host never speaks to a frame. It sends
 * `surface.request`, the page posts `{ workbench: 1, id, call, args }` into the frame, and the answer of the frame
 * returns with `surface.call`. Each bridge event of a frame (`ready`, `url`, `hmr`, `reload`, `console`) goes to the
 * host with `surface.report`. A `key` event (a workbench chord), an `import` event, a `scratch` event, a `link` event
 * and a `detach` event stay in the page.
 *
 * The relay accepts a message only from the window of an attached frame and only with the origin of that frame. The
 * relay has no framework. `useSurface.ts` connects it to the window and to the host client. The messages are the
 * contract of `@scenity/bridge`, which the editor also imports.
 */
import {
  answerOutcome,
  callMessage,
  isBridgeAnswer,
  isBridgeEvent,
  type BridgeCall,
  type BridgeDetachEvent,
  type BridgeEvent,
  type BridgeLinkEvent,
  type BridgeImportEvent,
  type BridgeScratchEvent,
  type WorkbenchKey,
} from "@scenity/bridge";
import {
  surfaceWith,
  type EventPayload,
  type RequestParams,
  type SurfaceWhere,
} from "@scenity/workbench-host/protocol";

/** The window of a frame (`iframe.contentWindow`) and the origin of its page. */
export interface FrameTarget {
  readonly window: { postMessage(message: unknown, targetOrigin: string): void };
  readonly origin: string;
}

/** A message that the page receives (a `MessageEvent`). */
export interface FrameMessage {
  readonly source: unknown;
  readonly origin: string;
  readonly data: unknown;
}

/** The picture bytes of an answer, for the binary frame before its `surface.call`. */
export interface RelayPicture {
  readonly mime: string;
  readonly bytes: ArrayBuffer;
}

export interface RelayOptions {
  /**
   * Send `surface.call` to the host. With a picture, the page sends its bytes as a binary frame first, and the
   * JSON result has `bytes: <byte count>` in place of the bytes.
   */
  readonly answer: (params: RequestParams<"surface.call">, picture?: RelayPicture) => void;
  /** Send `surface.report` to the host. */
  readonly report: (params: RequestParams<"surface.report">) => void;
  /** A workbench chord that a frame sent (the `key` event). The host does not get it. */
  readonly onKey?: (key: WorkbenchKey) => void;
  /**
   * A file that the owner dropped on the scene of a frame (the `import` event). The host does not get it: the
   * page uploads the file (imports/importDrop.ts).
   */
  readonly onImport?: (surface: string, event: BridgeImportEvent) => void;
  /**
   * A frame needs the models of its scratch props (the `scratch` event). The host does not get it: the page
   * reads the models and gives them to the frame that asked (imports/scratchModels.ts).
   */
  readonly onScratch?: (surface: string, where: SurfaceWhere, event: BridgeScratchEvent) => void;
  /** A message of the clock link of a frame (the `link` event). The page sends it to the host (`link.post`). */
  readonly onLink?: (surface: string, where: SurfaceWhere, event: BridgeLinkEvent) => void;
  /** "Open in a window" of a part of a frame (the `detach` event). The page opens the window. */
  readonly onDetach?: (surface: string, where: SurfaceWhere, event: BridgeDetachEvent) => void;
  /** The time limit of a frame answer (ms). */
  readonly timeoutMs?: number;
  /**
   * The calls that the page answers itself (a native snapshot, an MP4 of the labs app; `desktop/localCalls.ts`): a
   * promise of the result, or null for a call that goes into the frame.
   */
  readonly local?: (payload: EventPayload<"surface.request">, context: LocalContext) => Promise<unknown> | null;
  /** The surfaces of the host with their capabilities, for `idWith` (default: none). */
  readonly surfaces?: () => readonly RelaySurface[];
}

/** The ID and the capabilities of a surface of the host (a `SurfaceState`). */
export interface RelaySurface {
  readonly id: string;
  readonly capabilities?: readonly string[];
}

/** What a call that the page answers itself can use. */
export interface LocalContext {
  /** The tab of the surface is behind another tab. */
  readonly hidden: boolean;
  /** A call into the frame of the request (an MP4 clip steps the frame). */
  call(call: string, args?: readonly unknown[], timeoutMs?: number): Promise<unknown>;
}

export interface SurfaceRelay {
  /** Attach the frame of a surface. A second frame of the same surface and place replaces the first. */
  attach(surface: string, where: SurfaceWhere, target: FrameTarget): () => void;
  /** Send a call of the host into its frame. */
  request(payload: EventPayload<"surface.request">): void;
  /** Read a message of the window. Messages of other windows or other origins do nothing. */
  receive(message: FrameMessage): void;
  /** The count of calls that wait for a frame answer. */
  waiting(): number;
  /**
   * A call of the page into a frame (for example the indexer page, the frame pace of the main page, an MP4 clip): the
   * result of the frame, or its error. It fails when the frame is not attached or does not answer in time.
   */
  call(
    surface: string,
    where: SurfaceWhere,
    call: string,
    args?: readonly unknown[],
    timeoutMs?: number,
  ): Promise<unknown>;
  /**
   * A surface tab is behind another tab (true) or in front (false). The relay sends the call `visibility` to its
   * visible frame, and again after each attach and each `ready` of the frame. A hidden frame pauses its render loops. A
   * call of the host that needs frames wakes the frame for that call (the bridge does this).
   */
  setHidden(surface: string, hidden: boolean): void;
  /** True while a frame of the surface is attached at the place. */
  has(surface: string, where: SurfaceWhere): boolean;
  /**
   * The ID of the first surface with a capability (default `scene`: the surface of the lab API), or null. The
   * page code asks for a capability, never for a surface name.
   */
  idWith(capability?: string): string | null;
  /** The surface, the place and the target of the frame of a message, or null for another window or origin. */
  frameOf(
    message: FrameMessage,
  ): { readonly surface: string; readonly where: SurfaceWhere; readonly target: FrameTarget } | null;
  /** Fail every waiting call and forget the frames. */
  dispose(): void;
}

/** The default time limit of a frame answer (ms). */
export const FRAME_TIMEOUT_MS = 30_000;

interface Frame extends FrameTarget {
  readonly surface: string;
  readonly where: SurfaceWhere;
}

interface Waiting {
  /** The `surface.request` of the host, or null for a call of the page. */
  readonly request: number | null;
  readonly frame: Frame;
  readonly timer: ReturnType<typeof setTimeout>;
  /** A call of the page gets its outcome here. */
  readonly settle?: (outcome: Outcome) => void;
}

/** The answer of a frame to a call: its result, or its error. */
type Outcome = { result: unknown } | { error: string };

function key(surface: string, where: SurfaceWhere): string {
  return `${surface}\u0000${where}`;
}

/**
 * A result with picture bytes (`bytes`: an `ArrayBuffer` that the bridge moved to the page) gives the JSON
 * result with the byte count and the picture; another result gives null.
 */
export function splitPicture(
  result: unknown,
): { readonly result: Record<string, unknown>; readonly picture: RelayPicture } | null {
  if (typeof result !== "object" || result === null) return null;
  const { bytes, ...rest } = result as Record<string, unknown>;
  if (!(bytes instanceof ArrayBuffer)) return null;
  const mime = typeof rest.mime === "string" ? rest.mime : "image/webp";
  return { result: { ...rest, bytes: bytes.byteLength }, picture: { mime, bytes } };
}

/** Send an outcome to the host. A result with picture bytes goes with its picture. */
function sendOutcome(options: RelayOptions, request: number, outcome: Outcome): void {
  const split = "result" in outcome ? splitPicture(outcome.result) : null;
  if (split === null) options.answer({ request, ...outcome });
  else options.answer({ request, result: split.result }, split.picture);
}

/** Post a call into a frame. Give the error text when the post fails (a frame that closed), else null. */
function postCall(frame: FrameTarget, call: BridgeCall): string | null {
  try {
    frame.window.postMessage(call, frame.origin);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The attached frame of a message: the same window and the same origin, or null. */
function frameOf(frames: ReadonlyMap<string, Frame>, message: FrameMessage): Frame | null {
  for (const frame of frames.values()) {
    if (frame.window === message.source && frame.origin === message.origin) return frame;
  }
  return null;
}

/** The call `visibility` of a frame: its tab is hidden or visible. */
function visibilityCall(id: number, hidden: boolean): BridgeCall {
  return callMessage(id, "visibility", [hidden ? "hidden" : "visible"]);
}

/** The calls that wait for a frame answer: a request of the host, or a call of the page. */
function callBook(options: RelayOptions, frames: ReadonlyMap<string, Frame>) {
  const waiting = new Map<number, Waiting>();
  let nextId = 1;

  function finish(id: number, outcome: Outcome): void {
    const entry = waiting.get(id);
    if (entry === undefined) return;
    waiting.delete(id);
    clearTimeout(entry.timer);
    if (entry.settle !== undefined) entry.settle(outcome);
    else if (entry.request !== null) sendOutcome(options, entry.request, outcome);
  }

  /** Post a call into a frame; the outcome goes to `settle` (a call of the page) or to the host. */
  function post(
    frame: Frame,
    call: string,
    args: readonly unknown[],
    request: number | null,
    settle?: (outcome: Outcome) => void,
    timeoutMs?: number,
  ): void {
    const id = nextId++;
    const limit = timeoutMs ?? options.timeoutMs ?? FRAME_TIMEOUT_MS;
    const timer = setTimeout(() => {
      finish(id, { error: `The frame did not answer ${call} in ${String(limit)} ms.` });
    }, limit);
    waiting.set(id, { request, frame, timer, ...(settle === undefined ? {} : { settle }) });
    const failed = postCall(frame, callMessage(id, call, args));
    if (failed !== null) finish(id, { error: failed });
  }

  /** A call of the page into a frame: the promise of its result. */
  function ask(frame: Frame, call: string, args: readonly unknown[], timeoutMs?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const settle = (outcome: Outcome): void => {
        if ("result" in outcome) resolve(outcome.result);
        else reject(new Error(outcome.error));
      };
      post(frame, call, args, null, settle, timeoutMs);
    });
  }

  return {
    waiting,
    newId: () => nextId++,
    finish,
    post,
    /** A call of the page into the frame of a surface. */
    callFrame(
      surface: string,
      where: SurfaceWhere,
      call: string,
      args: readonly unknown[] = [],
      timeoutMs?: number,
    ): Promise<unknown> {
      const frame = frames.get(key(surface, where));
      if (frame === undefined) return Promise.reject(new Error(`No ${where} frame of surface ${surface}.`));
      return ask(frame, call, args, timeoutMs);
    },
    failFrame(frame: Frame, error: string): void {
      for (const [id, entry] of waiting) if (entry.frame === frame) finish(id, { error });
    },
  };
}

/** A call that the page answers itself (`options.local`); false when the call goes into the frame. */
function answerLocally(
  options: RelayOptions,
  payload: EventPayload<"surface.request">,
  context: LocalContext,
): boolean {
  const local = options.local?.(payload, context) ?? null;
  if (local === null) return false;
  local.then(
    (result) => sendOutcome(options, payload.request, { result }),
    (error: unknown) =>
      sendOutcome(options, payload.request, { error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
}

export function createRelay(options: RelayOptions): SurfaceRelay {
  const frames = new Map<string, Frame>();
  const book = callBook(options, frames);
  /** The surfaces whose tab is behind another tab. */
  const hidden = new Set<string>();

  /** Tell a visible frame whether its tab is hidden. The answer of the frame has no waiting call: the relay drops it. */
  function tellVisibility(frame: Frame | undefined): void {
    if (frame?.where !== "visible") return;
    // A frame that closed: its next attach tells it again.
    postCall(frame, visibilityCall(book.newId(), hidden.has(frame.surface)));
  }

  return {
    attach(surface, where, target) {
      const frame: Frame = { surface, where, window: target.window, origin: target.origin };
      const old = frames.get(key(surface, where));
      if (old !== undefined) book.failFrame(old, "The frame of the surface changed.");
      frames.set(key(surface, where), frame);
      if (hidden.has(surface)) tellVisibility(frame);
      return () => {
        if (frames.get(key(surface, where)) !== frame) return;
        frames.delete(key(surface, where));
        book.failFrame(frame, "The frame of the surface closed.");
      };
    },
    request(payload) {
      const context: LocalContext = {
        hidden: hidden.has(payload.surface),
        call: (call, args, timeoutMs) => book.callFrame(payload.surface, payload.where, call, args, timeoutMs),
      };
      if (answerLocally(options, payload, context)) return;
      const frame = frames.get(key(payload.surface, payload.where));
      if (frame === undefined) {
        options.answer({ request: payload.request, error: `No ${payload.where} frame of surface ${payload.surface}.` });
        return;
      }
      book.post(frame, payload.call, payload.args, payload.request);
    },
    call: (surface, where, call, args, timeoutMs) => book.callFrame(surface, where, call, args, timeoutMs),
    receive(message) {
      const frame = frameOf(frames, message);
      if (frame === null) return;
      const data = message.data;
      if (isBridgeAnswer(data)) {
        if (book.waiting.get(data.id)?.frame === frame) book.finish(data.id, answerOutcome(data));
      } else if (isBridgeEvent(data)) {
        // A frame that loaded again starts visible. For a hidden tab, the relay tells the frame again.
        if (data.event === "ready" && hidden.has(frame.surface)) tellVisibility(frame);
        if (data.event === "key") options.onKey?.(data.key);
        else if (data.event === "import") options.onImport?.(frame.surface, data);
        else if (data.event === "scratch") options.onScratch?.(frame.surface, frame.where, data);
        else if (data.event === "link") options.onLink?.(frame.surface, frame.where, data);
        else if (data.event === "detach") options.onDetach?.(frame.surface, frame.where, data);
        else options.report({ surface: frame.surface, where: frame.where, event: data satisfies BridgeEvent });
      }
    },
    waiting: () => book.waiting.size,
    setHidden(surface, value) {
      if (hidden.has(surface) === value) return;
      if (value) hidden.add(surface);
      else hidden.delete(surface);
      tellVisibility(frames.get(key(surface, "visible")));
    },
    has: (surface, where) => frames.has(key(surface, where)),
    idWith: (capability) => surfaceWith(options.surfaces?.() ?? [], capability)?.id ?? null,
    frameOf(message) {
      const frame = frameOf(frames, message);
      return frame === null ? null : { surface: frame.surface, where: frame.where, target: frame };
    },
    dispose() {
      for (const frame of frames.values()) book.failFrame(frame, "The workbench page closed the relay.");
      frames.clear();
    },
  };
}
