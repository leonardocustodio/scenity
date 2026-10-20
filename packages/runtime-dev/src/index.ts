// SPDX-License-Identifier: Apache-2.0
/**
 * The dev tools of the runtime: the page side of the lab tools. Only the editor imports this package; a player build
 * never holds it. The dev core runs in the render worker or on the main thread (`@scenity/runtime-dev/devCore`, a mixin
 * over the scene core of a plugin); this entry gives the types, the plain math and the lab methods of a renderer, with
 * no three.js values.
 */
export * from "./client";
export * from "./inspect";
export * from "./metrics";
// The layouts of the split screen (plain math; the panes draw in the core).
export * from "./panes";
// The types and the plain math of the pick (no three.js on the page); the pick itself runs in the core.
export * from "./pickMath";
// The pick kinds of the plugins (a plugin registers its classifier on the page and in the core).
export * from "./pickKinds";
// The import previews that the lab page gives the core (the types only; the layer runs in the core).
export type { PreviewMesh, PreviewModel } from "./preview";
// The scratch props that the lab page gives the core (the types only; the layer runs in the core).
export type { ScratchModel, ScratchPlace, ScratchUpdate } from "./scratch";
// The ghosts of the proposals (the types only; the layer runs in the core).
export type { GhostSpec, GhostView } from "./ghosts";
// The editor overlay and the prop boxes (the types and the empty spec; the layer runs in the core).
export { NO_OVERLAY, OVERLAY_ROOT } from "./overlay";
export type { OverlayDot, OverlayLabel, OverlayLine, OverlaySpec, OverlayTone, OverlayView, PropBox } from "./overlay";
// The onion skin (the types and the colours; the layer runs in the core).
export { ONION_COLORS, ONION_OPACITY, ONION_ROOT } from "./onion";
export type { OnionCopyView, OnionSpec, OnionView } from "./onion";
// The solo and hide of the panes (the types and the plain functions; the hide runs in the core).
export * from "./hideSpec";
export * from "./previewFormats";
// The capture check of a backend (the type only; the check runs in the core).
export type { CaptureCheck } from "./readback";
export * from "./shots";
export * from "./sweep";
export * from "./tune";
// The timed prop places of a lab take (the scene input carries them; plain math).
export * from "./timedPlaces";
export type { DevCoreOptions, DevFigure } from "./devCore";
// The layer face (the generic layer names, the dev plugins) and the inspect report of a scene document.
export * from "./devLayers";
export type * from "./document/report";
export type { PropPlace } from "./layersCore";
export type * from "./worker/protocol";
