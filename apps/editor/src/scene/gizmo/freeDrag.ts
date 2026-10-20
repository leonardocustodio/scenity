// SPDX-License-Identifier: Apache-2.0
/**
 * The free move of the scene page: the drag of an entity body and the centre
 * handle of the move gizmo. At the press the page reads the inspect report of the dev core once: the own world box of
 * each entity gives the surfaces, and its subtree box gives the base of the moved entity. The sockets come from the
 * document. Each move of the pointer gives the move ops of the selection from the document at the press
 * (`freeMove` of `@scenity/editor-core`: a surface, then a socket, else the level plane with the grid).
 */
import {
  freeMove,
  moveOps,
  socketPoints,
  surfacesOf,
  type ActiveSnaps,
  type BoxedEntity,
  type FreeMove,
  type FreeStart,
  type Ray,
  type SocketPoint,
  type SurfaceRect,
} from "@scenity/editor-core";
import { vsub, type Vec3 } from "@scenity/scene/math";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { worldTransform } from "@scenity/scene/world";
import type { SceneInspectReport } from "@scenity/runtime-dev/document/report";

/** The inspect report of the dev core, or null when the core has none. */
export type InspectPort = () => Promise<SceneInspectReport | null>;

/** What a free move keeps from its press. */
export interface FreeContext {
  readonly doc: SceneDocument;
  readonly targets: readonly string[];
  readonly start: FreeStart;
  readonly surfaces: readonly SurfaceRect[];
  readonly sockets: readonly SocketPoint[];
  readonly own: readonly Vec3[];
}

/** The entities and each entity under them. */
export function subtreeOf(doc: SceneDocument, ids: readonly string[]): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, entity] of Object.entries(doc.entities)) {
      if (out.has(id) || entity.parent === null || !out.has(entity.parent)) continue;
      out.add(id);
      grew = true;
    }
  }
  return out;
}

/** The boxes of the surfaces: the own box of each entity (a core with no own box gives the box of a leaf entity). */
export function boxesOf(report: SceneInspectReport | null): BoxedEntity[] {
  if (report === null) return [];
  const parents = new Set(report.entities.map((entity) => entity.parent));
  return report.entities.map((entity) => ({
    id: entity.id,
    box: entity.ownBounds !== undefined ? entity.ownBounds : parents.has(entity.id) ? null : entity.bounds,
  }));
}

/**
 * The context of a free move of `targets` (the first is the grabbed entity) from a press at the world point `grab`,
 * or null when the grabbed entity has no world place.
 */
export async function freeContext(
  doc: SceneDocument,
  targets: readonly string[],
  grab: Vec3,
  inspect: InspectPort | undefined,
): Promise<FreeContext | null> {
  const primary = targets[0];
  const origin = primary === undefined ? undefined : worldTransform(doc, primary)?.position;
  if (primary === undefined || origin === undefined) return null;
  const report = (await inspect?.().catch(() => null)) ?? null;
  const moved = subtreeOf(doc, targets);
  const base = report?.entities.find((entity) => entity.id === primary)?.bounds?.min[1] ?? origin[1];
  return {
    doc,
    targets,
    start: { origin, base, grab },
    surfaces: surfacesOf(boxesOf(report), moved),
    sockets: socketPoints(doc).filter((socket) => !moved.has(socket.owner)),
    own: socketPoints(doc, new Set([primary])).map((socket) => vsub(socket.at, origin)),
  };
}

/** The ops of a free move for a ray of the pointer with the snaps of the drag, and what it snapped to; null: no hit. */
export function freeOps(
  context: FreeContext,
  ray: Ray,
  snaps: ActiveSnaps,
): { readonly ops: SceneOp[]; readonly move: FreeMove } | null {
  const { start, surfaces, sockets, own } = context;
  const move = freeMove(start, ray, { grid: snaps.grid, surface: snaps.surface, surfaces, sockets, own });
  if (move === null) return null;
  return { ops: moveOps(context.doc, context.targets, vsub(move.origin, start.origin)), move };
}
