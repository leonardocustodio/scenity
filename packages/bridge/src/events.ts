// SPDX-License-Identifier: Apache-2.0
/**
 * The events of the bridge (frame to workbench page): `{ workbench: 1, event, ... }`.
 *
 * The base events come from each surface page with a bridge:
 * - `ready` (`url`): the page and its script API are ready.
 * - `url` (`url`): the page changed its URL (the editor keeps its state in the URL).
 * - `hmr` (`files`): the dev server replaced modules (the paths and the accepted paths of the update).
 * - `reload` (`url`): the dev server loads the page again.
 * - `console` (`level`, `text`): a new error or warning of the page.
 * - `key` (`key`): a workbench chord while the frame has the focus (keys.ts).
 *
 * The other events come from the scene editor (editEvents.ts), the dropped files and the scratch props
 * (assetEvents.ts) and the detached windows (windowEvents.ts).
 */
import {
  isImportEvent,
  isPromoteEvent,
  isScratchEvent,
  type ImportEventBody,
  type PromoteEventBody,
  type ScratchEventBody,
} from "./assetEvents";
import {
  isAskEvent,
  isCameraEvent,
  isLayoutEvent,
  isPlacementEvent,
  isVariantsEvent,
  type AskEventBody,
  type CameraEventBody,
  type LayoutEventBody,
  type PlacementEventBody,
  type VariantsEventBody,
} from "./editEvents";
import { BRIDGE_VERSION, isObject, type BridgeVersion } from "./envelope";
import { isWorkbenchKey, type WorkbenchKey } from "./keys";
import { isDetachEvent, isLinkEvent, type DetachEventBody, type LinkEventBody } from "./windowEvents";

/** The events of the bridge without the `workbench` key: the frame gives them to `emit`. */
export type BridgeEventBody =
  | { readonly event: "ready"; readonly url: string }
  | { readonly event: "url"; readonly url: string }
  | { readonly event: "hmr"; readonly files: readonly string[] }
  | { readonly event: "reload"; readonly url: string }
  | { readonly event: "console"; readonly level: "error" | "warn"; readonly text: string }
  | { readonly event: "key"; readonly key: WorkbenchKey }
  | AskEventBody
  | PlacementEventBody
  | CameraEventBody
  | LayoutEventBody
  | VariantsEventBody
  | ImportEventBody
  | ScratchEventBody
  | PromoteEventBody
  | LinkEventBody
  | DetachEventBody;

/** A message of the bridge: a body with the `workbench` key. */
export type WithEnvelope<Body> = { readonly workbench: BridgeVersion } & Body;

/** Frame to workbench page: an event of the surface page. */
export type BridgeEvent = BridgeEventBody extends infer Body
  ? Body extends unknown
    ? WithEnvelope<Body>
    : never
  : never;
export type BridgeEventName = BridgeEventBody["event"];

export type BridgeCameraEvent = WithEnvelope<CameraEventBody>;
export type BridgeLayoutEvent = WithEnvelope<LayoutEventBody>;
export type BridgeVariantsEvent = WithEnvelope<VariantsEventBody>;
export type BridgeImportEvent = WithEnvelope<ImportEventBody>;
export type BridgeScratchEvent = WithEnvelope<ScratchEventBody>;
export type BridgePromoteEvent = WithEnvelope<PromoteEventBody>;
export type BridgeLinkEvent = WithEnvelope<LinkEventBody>;
export type BridgeDetachEvent = WithEnvelope<DetachEventBody>;

type FieldCheck = (value: Readonly<Record<string, unknown>>) => boolean;

const isUrlEvent: FieldCheck = (value) => typeof value.url === "string";

/** The check of the fields of each event. The `satisfies` keeps the table in step with `BridgeEventName`. */
const EVENT_CHECKS = {
  ready: isUrlEvent,
  url: isUrlEvent,
  hmr: (value) => Array.isArray(value.files) && value.files.every((file) => typeof file === "string"),
  reload: isUrlEvent,
  console: (value) => (value.level === "error" || value.level === "warn") && typeof value.text === "string",
  key: (value) => isWorkbenchKey(value.key),
  ask: isAskEvent,
  placement: isPlacementEvent,
  camera: isCameraEvent,
  layout: isLayoutEvent,
  variants: isVariantsEvent,
  import: isImportEvent,
  scratch: isScratchEvent,
  promote: isPromoteEvent,
  link: isLinkEvent,
  detach: isDetachEvent,
} as const satisfies Record<BridgeEventName, FieldCheck>;

/** The names of the events, in the order of the table. */
export const BRIDGE_EVENT_NAMES = Object.keys(EVENT_CHECKS) as readonly BridgeEventName[];
/** The base events: each surface page with a bridge sends them. */
export const BASE_EVENT_NAMES = [
  "ready",
  "url",
  "hmr",
  "reload",
  "console",
  "key",
] as const satisfies BridgeEventName[];

/** True for an event of the bridge (frame to workbench page). */
export function isBridgeEvent(value: unknown): value is BridgeEvent {
  if (!isObject(value) || value.workbench !== BRIDGE_VERSION || "id" in value) return false;
  if (typeof value.event !== "string" || !Object.hasOwn(EVENT_CHECKS, value.event)) return false;
  return EVENT_CHECKS[value.event as BridgeEventName](value);
}

/** The message of an event. */
export function eventMessage<Body extends BridgeEventBody>(body: Body): WithEnvelope<Body> {
  return { workbench: BRIDGE_VERSION, ...body };
}
