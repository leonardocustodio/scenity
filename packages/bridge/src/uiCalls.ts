// SPDX-License-Identifier: Apache-2.0
/**
 * The UI calls of the editor window: an agent reads the state of the window and shows a
 * person a part of it. `ui.state` gives the workspace, the panels, the selection, the open scene and the time;
 * `ui.reveal` selects and frames entities, opens a panel and shows a field of the inspector; `ui.highlight` puts a
 * callout on a part of the window; `ui.notify` shows a short message.
 */
import { argError, defineBridgeCall, noArgs } from "./define";
import { isObject } from "./envelope";

/** The state of the editor window. */
export interface UiState {
  readonly workspace: string;
  readonly panels: readonly string[];
  readonly activePanel: string | null;
  readonly selection: readonly string[];
  /** The path of the open scene file. */
  readonly scene: string;
  /** The time of the clock (ms), or null with no clock. */
  readonly time: number | null;
  readonly theme: string;
}

/** A request of `ui.reveal`; each part is optional. */
export interface UiReveal {
  /** Select these entities (an empty list clears the selection). */
  readonly entities?: readonly string[];
  /** Frame the selection in the Scene view. */
  readonly frame?: boolean;
  /** Open this panel of the window. */
  readonly panel?: string;
  /** Show this field of the inspector: `component.field` (for example `environment.exposure` or `light.intensity`). */
  readonly field?: string;
  /** A callout on the field or the panel with this text. */
  readonly text?: string;
}

/**
 * The answer of `ui.reveal`: what the window did and the parts that it did not find, as tokens: `select:<ids>`,
 * `frame`, `panel:<id>`, `field:<component.field>`, `callout:<panel>`.
 */
export interface UiRevealAnswer {
  readonly done: readonly string[];
  readonly missing: readonly string[];
}

/** A request of `ui.highlight`: a field (`component.field`), a panel ID, or a test ID or command ID of a control. */
export interface UiHighlight {
  readonly target: string;
  readonly text?: string;
}

/** A request of `ui.notify`. */
export interface UiNotify {
  readonly text: string;
  readonly tone?: "status" | "alert";
}

const texts = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function revealArgs(raw: readonly unknown[]): [UiReveal] {
  const [request] = raw;
  if (!isObject(request)) argError("ui.reveal", "the request must be an object.");
  if (request.entities !== undefined && !texts(request.entities)) argError("ui.reveal", "entities is a list of IDs.");
  for (const key of ["panel", "field", "text"] as const) {
    if (request[key] !== undefined && typeof request[key] !== "string") argError("ui.reveal", `${key} is a text.`);
  }
  return [request];
}

function highlightArgs(raw: readonly unknown[]): [UiHighlight] {
  const [request] = raw;
  if (!isObject(request) || typeof request.target !== "string" || request.target === "")
    argError("ui.highlight", "the target is a text.");
  return [request as unknown as UiHighlight];
}

function notifyArgs(raw: readonly unknown[]): [UiNotify] {
  const [request] = raw;
  if (!isObject(request) || typeof request.text !== "string" || request.text === "")
    argError("ui.notify", "the text is a text that is not empty.");
  if (request.tone !== undefined && request.tone !== "status" && request.tone !== "alert")
    argError("ui.notify", 'the tone is "status" or "alert".');
  return [request as unknown as UiNotify];
}

export const UI_STATE_CALL = defineBridgeCall({ name: "ui.state", args: noArgs, result: (raw) => raw as UiState });
export const UI_REVEAL_CALL = defineBridgeCall({
  name: "ui.reveal",
  args: revealArgs,
  result: (raw) => raw as UiRevealAnswer,
});
export const UI_HIGHLIGHT_CALL = defineBridgeCall({
  name: "ui.highlight",
  args: highlightArgs,
  result: (raw) => raw === true,
});
export const UI_NOTIFY_CALL = defineBridgeCall({ name: "ui.notify", args: notifyArgs, result: (raw) => raw === true });

/** One small state of the editor for an agent: the first call of a session. */
export interface StudioState {
  readonly project: string;
  /** The open scene: its path, its ID, its name, its entity count and whether it has changes that are not saved. */
  readonly scene: {
    readonly path: string;
    readonly id: string;
    readonly name: string | null;
    readonly entities: number;
    readonly dirty: boolean;
  };
  readonly selection: readonly string[];
  /** The entities at the root of the scene (at most 40): the ID, the name, the components and the child count. */
  readonly top: readonly {
    readonly id: string;
    readonly name: string | null;
    readonly components: readonly string[];
    readonly children: number;
  }[];
  /** True when the scene has more root entities than `top` gives. */
  readonly more: boolean;
  /** The prefab files of the instances of the scene. */
  readonly prefabs: readonly string[];
  /** The open sequence file, or null. */
  readonly sequence: string | null;
  /** The failed rules (block) and the warnings of the last check, or null before the first check. */
  readonly problems: { readonly fail: number; readonly warn: number } | null;
  /** The switch of the session: "propose" (an edit of an agent waits for the person) or "apply". */
  readonly agentMode: "propose" | "apply";
}

export const STUDIO_STATE_CALL = defineBridgeCall({
  name: "studio.state",
  args: noArgs,
  result: (raw) => raw as StudioState,
});

/** A request of `shadow.frame`: the time (ms), the document camera and the width of the picture. */
export interface ShadowFrameRequest {
  readonly t?: number;
  readonly camera?: string;
  readonly width?: number;
}

function shadowArgs(raw: readonly unknown[]): [ShadowFrameRequest] {
  const [request = {}] = raw;
  if (!isObject(request)) argError("shadow.frame", "the request must be an object.");
  if (request.t !== undefined && (typeof request.t !== "number" || request.t < 0))
    argError("shadow.frame", "t is a time in ms (0 or more).");
  if (request.camera !== undefined && typeof request.camera !== "string") argError("shadow.frame", "camera is a text.");
  if (request.width !== undefined && (typeof request.width !== "number" || request.width < 16))
    argError("shadow.frame", "width is a number of pixels.");
  return [request];
}

/**
 * A picture of the open scene for an agent that does not move the view of the person: the page renders the
 * camera off the screen and puts its clock back after a time of its own (`BridgeCapture` of base.ts).
 */
export const SHADOW_FRAME_CALL = defineBridgeCall({ name: "shadow.frame", args: shadowArgs });
