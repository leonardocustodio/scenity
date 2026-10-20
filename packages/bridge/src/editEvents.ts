// SPDX-License-Identifier: Apache-2.0
/**
 * The events of the scene editor on the bridge (frame to workbench page). The workbench host runs a tool of the
 * checkout for some of them; the bridge checks only their form.
 *
 * - `ask`: the owner asks Claude about the picked item; the host types the text into the Claude terminal or
 *   the chat.
 * - `placement`: "Save placement": the host runs `labs tune-apply` of the place values (`path:value,…`), dry or
 *   real. `override` is the reason of the owner to save while a layout check fails.
 * - `camera`: "Save camera": the host runs `labs camera-save` of a named view (the text of the `view` URL
 *   parameter), dry or real; `replace` replaces a camera of the same name; `doc` is its doc line.
 * - `layout`: "Save layout as": the host runs `labs layout-save <name> --tunes "<tune text>"`.
 * - `variants`: the variants of a layout search; the host keeps them as candidates of the picker.
 */

/** The longest text of an `ask` event (characters). */
export const ASK_MAX_CHARS = 4_000;

export type AskEventBody = {
  readonly event: "ask";
  readonly text: string;
};

export type PlacementEventBody = {
  readonly event: "placement";
  readonly values: string;
  readonly dry: boolean;
  readonly override?: string;
};

export type CameraEventBody = {
  readonly event: "camera";
  readonly name: string;
  readonly view: string;
  readonly dry: boolean;
  readonly replace?: boolean;
  readonly doc?: string;
};

export type LayoutEventBody = {
  readonly event: "layout";
  readonly name: string;
  /** The layout values as a tune text `path:value,…` (empty: the layout of the code). */
  readonly tunes: string;
  readonly dry: boolean;
  readonly replace?: boolean;
  readonly doc?: string;
  /** The camera of the save (a camera name, or the view text): a note of the file. */
  readonly camera?: string;
};

/** One variant of a search for the picker: its ID, its words and its layout values as a tune text. */
export type LayoutVariantOffer = {
  readonly id: string;
  readonly label: string;
  readonly tune: string;
};

/** The variants of the last layout search of the frame (at most 9, the keys of the picker). */
export type VariantsEventBody = {
  readonly event: "variants";
  readonly seed: number;
  readonly variants: readonly LayoutVariantOffer[];
};

/** A camera name (small letters and digits, a hyphen between parts) and a view of seven numbers. */
const CAMERA_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VIEW_TEXT = /^-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){6}$/;
/** A layout name: small letters and digits, a hyphen between parts. */
export const LAYOUT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/**
 * One pair of a tune text: a tune path of names with dots, and a number. The host plugin gives the paths that
 * a layout may write (`paths.layoutPair`); the host checks them before a run.
 */
export const TUNE_PAIR = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*:-?\d+(?:\.\d+)?(?:e-?\d+)?$/;
/** The characters that a doc line or a camera note cannot have (a run refuses them), and line breaks. */
const BAD_TEXT = /[;|&$`<>\\"\r\n]/;
/** A camera note: a camera name, or seven numbers. */
const CAMERA_NOTE = /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){6})$/;

/** True for the fields of an `ask` event. */
export function isAskEvent(value: Readonly<Record<string, unknown>>): boolean {
  return typeof value.text === "string" && value.text.trim() !== "" && value.text.length <= ASK_MAX_CHARS;
}

/** True for the fields of a `placement` event. */
export function isPlacementEvent(value: Readonly<Record<string, unknown>>): boolean {
  return (
    typeof value.values === "string" &&
    typeof value.dry === "boolean" &&
    (value.override === undefined || (typeof value.override === "string" && value.override.length <= ASK_MAX_CHARS))
  );
}

/** True for the fields of a `camera` event (the doc line has no character that a run refuses). */
export function isCameraEvent(value: Readonly<Record<string, unknown>>): boolean {
  return (
    typeof value.name === "string" &&
    value.name.length <= 32 &&
    CAMERA_NAME.test(value.name) &&
    typeof value.view === "string" &&
    VIEW_TEXT.test(value.view) &&
    typeof value.dry === "boolean" &&
    (value.replace === undefined || typeof value.replace === "boolean") &&
    (value.doc === undefined ||
      (typeof value.doc === "string" && value.doc.length <= 100 && !/[;|&$`<>\\"\r\n]|\*\//.test(value.doc)))
  );
}

/** True for a tune text of layout values (empty is the layout of the code); `pair` is the rule of one pair. */
export function isLayoutTuneText(text: unknown, pair: RegExp = TUNE_PAIR): text is string {
  if (typeof text !== "string" || text.length > 8000) return false;
  return text === "" || text.split(",").every((item) => pair.test(item));
}

/** True for the fields of a `layout` event. */
export function isLayoutEvent(value: Readonly<Record<string, unknown>>): boolean {
  return (
    typeof value.name === "string" &&
    value.name.length <= 40 &&
    LAYOUT_NAME.test(value.name) &&
    isLayoutTuneText(value.tunes) &&
    typeof value.dry === "boolean" &&
    (value.replace === undefined || typeof value.replace === "boolean") &&
    (value.doc === undefined ||
      (typeof value.doc === "string" && value.doc.length <= 160 && !BAD_TEXT.test(value.doc))) &&
    (value.camera === undefined || (typeof value.camera === "string" && CAMERA_NOTE.test(value.camera)))
  );
}

/** True for one variant of a `variants` event. */
function isVariantOffer(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const offer = item as Record<string, unknown>;
  return (
    typeof offer.id === "string" &&
    /^v\d{1,2}$/.test(offer.id) &&
    typeof offer.label === "string" &&
    offer.label.length <= 200 &&
    isLayoutTuneText(offer.tune)
  );
}

/** True for the fields of a `variants` event. */
export function isVariantsEvent(value: Readonly<Record<string, unknown>>): boolean {
  const list = value.variants;
  return (
    typeof value.seed === "number" &&
    Number.isSafeInteger(value.seed) &&
    Array.isArray(list) &&
    list.length <= 9 &&
    list.every(isVariantOffer)
  );
}
