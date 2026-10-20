// SPDX-License-Identifier: Apache-2.0
/**
 * The sides of the compare view. A side is a take of the current code (`take:<name>` or only `<name>`), or a take of
 * an older content hash (`hash:<content hash>:<take>`) that only the frame index has. The URL of the view is
 * `?view=compare&a=<side>&b=<side>&t=<ms>&camera=<name>&mode=side|wipe&split=<0-100>`.
 */
import { isFrameKey } from "@scenity/labs-platform/frameKey";
import { cameraNames, FRAMING_CAMERA, isCameraName } from "../cameras";
import { takeList } from "../sequence";
import { t } from "../../texts";

export type CompareSide =
  | { readonly kind: "take"; readonly take: string }
  | { readonly kind: "hash"; readonly take: string; readonly contentHash: string };

export type CompareMode = "side" | "wipe";

/** The data that the stage shows of one side: its label, its picture, a note and the simulation time of the picture. */
export interface StageSide {
  readonly label: string;
  readonly url: string | null;
  readonly note: string | null;
  readonly simMs: number | null;
}

export interface CompareParams {
  readonly a: CompareSide | null;
  readonly b: CompareSide | null;
  readonly timeMs: number;
  readonly camera: string;
  readonly mode: CompareMode;
  /** The percentage of side A in the wipe (0 to 100). */
  readonly split: number;
}

/** True for the name of a take of the plugin. */
const isTake = (name: string): boolean => takeList().some((item) => item.name === name);

/** A side from its URL text, or null for a text that names no take. */
export function parseSide(text: string | null): CompareSide | null {
  if (text === null) return null;
  const value = text.trim();
  if (value.startsWith("hash:")) {
    const [, contentHash = "", take = ""] = value.split(":");
    return isFrameKey(contentHash) && isTake(take) ? { kind: "hash", take, contentHash } : null;
  }
  const take = value.startsWith("take:") ? value.slice("take:".length) : value;
  return isTake(take) ? { kind: "take", take } : null;
}

/** The URL text of a side. */
export function sideText(side: CompareSide): string {
  return side.kind === "take" ? `take:${side.take}` : `hash:${side.contentHash}:${side.take}`;
}

/** A short label of a side: the take, and the start of an older content hash. */
export function sideLabel(side: CompareSide | null): string {
  if (side === null) return t("compare-no-take");
  return side.kind === "take" ? side.take : `${side.take} @ ${side.contentHash.slice(0, 8)}`;
}

/** The parameters of the compare view from the URL query. */
export function compareParams(search: string): CompareParams {
  const params = new URLSearchParams(search);
  const camera = params.get("camera");
  const split = Number(params.get("split"));
  return {
    a: parseSide(params.get("a")),
    b: parseSide(params.get("b")),
    timeMs: Math.max(0, Number(params.get("t")) || 0),
    camera: camera !== null && isCameraName(camera) ? camera : (cameraNames()[0] ?? FRAMING_CAMERA),
    mode: params.get("mode") === "wipe" ? "wipe" : "side",
    split: Number.isFinite(split) && params.has("split") ? Math.min(100, Math.max(0, split)) : 50,
  };
}

/** The URL query of the compare view. The page keeps it current, so a reload shows the same frames. */
export function compareQuery(state: CompareParams): string {
  const params = new URLSearchParams({ view: "compare" });
  if (state.a !== null) params.set("a", sideText(state.a));
  if (state.b !== null) params.set("b", sideText(state.b));
  params.set("t", String(Math.round(state.timeMs)));
  params.set("camera", state.camera);
  params.set("mode", state.mode);
  if (state.mode === "wipe") params.set("split", String(Math.round(state.split)));
  return params.toString();
}
