// SPDX-License-Identifier: Apache-2.0
/**
 * The pairs of the compare view of the workbench: two pictures of the host by ID (`GET /pictures/<id>`) or by URL (a
 * run file of the picker). A turn gives two pairs: the frame before and after, and the sheet of the turn window before
 * and after. The picker gives the sheets of two candidates.
 */
import type { PictureRef } from "@scenity/workbench-host/protocol";

/** One side of a pair: a picture of the host by ID, or an image URL; both null: no picture. */
export interface CompareSide {
  readonly label: string;
  readonly picture: string | null;
  readonly url: string | null;
  /** The sim time of the picture (ms), or null. */
  readonly simMs: number | null;
}

export interface ComparePair {
  readonly label: string;
  readonly a: CompareSide;
  readonly b: CompareSide;
}

export function pictureSide(label: string, picture: PictureRef | null): CompareSide {
  return { label, picture: picture?.id ?? null, url: null, simMs: picture?.simMs ?? null };
}

/** The pairs of a turn: the frame, then the motion of the turn window (when the turn has a sheet). */
export function turnPairs(turn: {
  readonly turn: number;
  readonly before: PictureRef | null;
  readonly after: PictureRef | null;
  readonly beforeSheet: PictureRef | null;
  readonly afterSheet: PictureRef | null;
}): ComparePair[] {
  const name = `turn ${String(turn.turn)}`;
  const pairs: ComparePair[] = [
    { label: "Frame", a: pictureSide(`Before ${name}`, turn.before), b: pictureSide(`After ${name}`, turn.after) },
  ];
  if (turn.beforeSheet !== null || turn.afterSheet !== null) {
    pairs.push({
      label: "Motion",
      a: pictureSide(`Before ${name}`, turn.beforeSheet),
      b: pictureSide(`After ${name}`, turn.afterSheet),
    });
  }
  return pairs;
}

/** The pair with the sides in the other order. */
export function swapPair(pair: ComparePair): ComparePair {
  return { label: pair.label, a: pair.b, b: pair.a };
}
