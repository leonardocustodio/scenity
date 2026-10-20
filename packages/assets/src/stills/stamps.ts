// SPDX-License-Identifier: Apache-2.0
/**
 * The stamps of the asset stills, one stamp for each asset. The render depends on the GPU, so a byte comparison
 * cannot tell if a still is current. The stamp file `<stills>/stills.json` keeps, for each still, the
 * input hash of the asset (`plan.ts`) and the version of the renderer when the still was made. A still is stale when
 * the input hash or the renderer version of now is different.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** The format of the stamp file. */
export const STILL_STAMP_FORMAT = "scenity.stills/1";
/** The name of the stamp file in the folder of the stills. */
export const STILL_STAMP_FILE = "stills.json";

/** The stamp of one still. */
export interface StillStamp {
  /** The input hash of the asset when the still was made. */
  readonly inputs: string;
  /** The version of the renderer that made the still. */
  readonly renderer: string;
  /** The day of the render (YYYY-MM-DD). */
  readonly made: string;
}

/** The state of a still: current, no file, or other inputs. */
export type StillState = "current" | "missing" | "stale";

/** The stamps of a stamp file by asset ID; none when the file does not exist or does not read. */
export function readStillStamps(path: string): Record<string, StillStamp> {
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { format?: unknown; stills?: unknown };
    if (data.format !== STILL_STAMP_FORMAT || typeof data.stills !== "object" || data.stills === null) return {};
    return { ...(data.stills as Record<string, StillStamp>) };
  } catch {
    return {};
  }
}

/** Write the stamps in the order of the IDs. */
export function writeStillStamps(path: string, stamps: Readonly<Record<string, StillStamp>>): void {
  const sorted = Object.fromEntries(Object.entries(stamps).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const $comment = "Written by the stills of @scenity/assets. Do not edit.";
  writeFileSync(path, `${JSON.stringify({ $comment, format: STILL_STAMP_FORMAT, stills: sorted }, null, 2)}\n`);
}

/** The facts of one still that give its state. */
export interface StillFacts {
  /** The input hash of the asset now. */
  readonly inputs: string;
  readonly stamp: StillStamp | undefined;
  /** True when the still file exists. */
  readonly exists: boolean;
  /** The renderer version of now; undefined: do not compare the renderer. */
  readonly renderer: string | undefined;
}

/** The state of a still and the reason (null for a current still). */
export function stillStatus(facts: StillFacts): { readonly status: StillState; readonly reason: string | null } {
  if (!facts.exists) return { status: "missing", reason: "no still" };
  const { stamp } = facts;
  if (stamp === undefined) return { status: "stale", reason: "no stamp, so the still can be stale" };
  if (stamp.inputs !== facts.inputs) {
    return {
      status: "stale",
      reason: `the source, the import settings or the build output changed after ${stamp.made}`,
    };
  }
  if (facts.renderer !== undefined && stamp.renderer !== facts.renderer) {
    return { status: "stale", reason: `the renderer changed after ${stamp.made}` };
  }
  return { status: "current", reason: null };
}
