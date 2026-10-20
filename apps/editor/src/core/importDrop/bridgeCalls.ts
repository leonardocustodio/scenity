// SPDX-License-Identifier: Apache-2.0
/**
 * The bridge calls of the import by drop. The workbench page tells the lab the state of the import job of a drop
 * (`importStatus`). It also gives the lab the optimized model of the job (`importPreview`: the bytes of its
 * `preview.glb`). This model replaces the quick preview of the drop.
 *
 * The desktop path (Scenity): the drag and drop of the shell gives the workbench page the drop, not this frame.
 * The page calls `importDragHint` when a file of the shell is over the frame. It calls `importDropAt` with the point
 * of the drop in this frame (useImportDrop.ts).
 */
import type { Vec3 } from "@scenity/character";
import type { BridgeCall } from "../bridge/workbenchBridge";

function api() {
  const value = globalThis.__labImport;
  if (value === undefined) throw new Error("The import preview of the lab is not ready.");
  return value;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a text.`);
  return value;
}

function coordinate(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function point(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => Number.isFinite(item))) return null;
  return [value[0] as number, value[1] as number, value[2] as number];
}

export const IMPORT_BRIDGE_CALLS: Readonly<Record<string, BridgeCall>> = {
  /**
   * `[{ drop, name, x, y }]`: a file of the drag and drop of the shell at the point (x, y) of this page (CSS pixels).
   * The answer is the drop point (`{ point, on }`) or the reason of a refusal (`{ refused }`).
   */
  importDropAt: (args) => {
    const info = (args[0] ?? {}) as Record<string, unknown>;
    const lab = api();
    if (lab.dropAt === undefined) throw new Error("The scene of the lab takes no drop.");
    return lab.dropAt({
      drop: text(info.drop, "drop"),
      name: text(info.name, "name"),
      x: coordinate(info.x, "x"),
      y: coordinate(info.y, "y"),
    });
  },
  /** `[over]`: a file of the shell is over the scene (true) or not (false). */
  importDragHint: (args) => {
    api().dragHint?.(args[0] === true);
    return null;
  },
  /** `[{ drop, state, text }]`: the state of the job of a drop. */
  importStatus: (args) => {
    const info = (args[0] ?? {}) as Record<string, unknown>;
    api().status({ drop: text(info.drop, "drop"), state: text(info.state, "state"), text: text(info.text, "text") });
    return null;
  },
  /** `[bytes, { name, drop, point, label }]`: show the optimized model of a drop at its drop point. */
  importPreview: (args) => {
    const bytes = args[0];
    if (!(bytes instanceof ArrayBuffer)) throw new Error("importPreview needs the bytes of a GLB file.");
    const info = (args[1] ?? {}) as Record<string, unknown>;
    return api().show(bytes, {
      name: text(info.name, "name"),
      point: point(info.point),
      ...(typeof info.label === "string" ? { label: info.label } : {}),
      ...(typeof info.drop === "string" ? { drop: info.drop } : {}),
    });
  },
};
