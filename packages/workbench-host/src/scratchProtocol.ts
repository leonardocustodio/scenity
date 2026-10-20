// SPDX-License-Identifier: Apache-2.0
/**
 * The scratch props and the promote of a model on the surface bridge and as a host request. The module is pure (no
 * `node:` or `bun:` import): the page imports it
 * through `@scenity/workbench-host/protocol`.
 *
 * - `scratch` (frame to page): the lab frame needs the models of these imports (a fresh page with `scratch=` in its
 *   URL). The page reads `record.json` and `preview.glb` of each import (`GET /imports/<id>/<file>`) and gives them to
 *   that frame with the bridge call `scratchModel`. The host never gets the event.
 * - `promote` (frame to host) and the request `asset.promote` (page to host): the promote of the model of an import
 *   (promoteRun.ts). The host copies the model into the asset sources of the project, writes its record
 *   through the importer, updates the asset database and adds an entity with a `model` component of the new asset at
 *   the place of the scratch prop to the scene document. A dry run gives the list of the changes and writes nothing.
 *   The host writes no Claude prompt. The answer of the event is the bridge call `promoteResult` of the lab.
 *
 * The events and their checks are in @scenity/bridge (assetEvents.ts). This module keeps the answer.
 */
import { IMPORT_ID_PATTERN } from "@scenity/bridge";

/** The asset of a promote, its paths relative to the checkout. */
export interface PromotedAsset {
  readonly id: string;
  readonly source: string;
  readonly record: string;
}

/** The answer of the host to a promote (the bridge call `promoteResult` of the lab, the result of `asset.promote`). */
export interface PromoteResult {
  readonly dry: boolean;
  /** The reason that the model cannot be promoted, or null. */
  readonly refused: string | null;
  /** The files that the promote writes (a dry run) or wrote, one line each. */
  readonly changes: readonly string[];
  /** The new project asset, or null (a dry run or a refusal). */
  readonly asset: PromotedAsset | null;
  /** The new entity and its scene document (relative to the checkout), or null. */
  readonly entity: { readonly id: string; readonly scene: string } | null;
  /** The rights record of the asset, and one sentence on the release gate, or null (a refusal). */
  readonly rights: { readonly record: string; readonly blocked: boolean; readonly note: string } | null;
  /**
   * The changes that the project still needs and the promote does not make (from the host plugin): a project whose
   * scene does not show every `model` entity needs a code change. Empty for a project with no such need.
   */
  readonly followUp: readonly string[];
}

/** The parameters of `asset.promote`: the import, the place of the model and the scene document. */
export interface PromoteParams {
  /** The import ID of the model (the import folder of the host state). */
  readonly import: string;
  /** The base centre in the scene (metres). */
  readonly at: readonly [number, number, number];
  /** The turn about the vertical axis (degrees). */
  readonly turnDeg: number;
  readonly dry: boolean;
  /** The scene document, relative to the project folder (default: the scene of the host plugin, else the first). */
  readonly scene?: string;
}

/** The promote requests (page to host). `RequestMap` of protocol.ts extends this map. */
export interface PromoteRequests {
  /** The promote of the model of an import: a project asset and an entity of the scene. */
  "asset.promote": { params: PromoteParams; result: PromoteResult };
}

export const PROMOTE_REQUEST_NAMES: Readonly<Record<keyof PromoteRequests, true>> = { "asset.promote": true };

/** True for the parameters of `asset.promote`. */
export function isPromoteParams(value: unknown): value is PromoteParams {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const at = item.at;
  return (
    typeof item.import === "string" &&
    IMPORT_ID_PATTERN.test(item.import) &&
    Array.isArray(at) &&
    at.length === 3 &&
    at.every((part) => typeof part === "number" && Number.isFinite(part) && Math.abs(part) < 1000) &&
    typeof item.turnDeg === "number" &&
    Number.isFinite(item.turnDeg) &&
    typeof item.dry === "boolean" &&
    (item.scene === undefined || (typeof item.scene === "string" && item.scene.endsWith(".scene.json")))
  );
}
