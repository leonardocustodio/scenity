// SPDX-License-Identifier: Apache-2.0
// The offset of a duplicate: `entity.duplicate` with x, y and z moves the roots of the copies by the offset in the
// frame of their parent. With no offset, the copies stay on the originals.
import { applyOps } from "@scenity/scene";
import { describe, expect, it } from "bun:test";
import {
  createCommandRegistry,
  ENTITY_COMMANDS,
  type EntityHost,
  type EntityState,
  type HierarchyOp,
} from "../src/index";
import { components, garden } from "./helpers";

const commands = createCommandRegistry<EntityState, EntityHost, HierarchyOp>();
commands.register(ENTITY_COMMANDS);

function duplicate(args: Record<string, unknown>) {
  const doc = garden();
  const state: EntityState = { doc, view: { solo: [], locked: [] }, selection: null, clipboard: null };
  const outcome = commands.prepare("entity.duplicate", args, state);
  if (outcome.kind !== "edit") throw new Error("not an edit");
  const applied = applyOps(
    doc,
    outcome.ops.flatMap((op) => (op.kind === "scene" ? [op.op] : [])),
    components,
  );
  if (!applied.ok) throw new Error(applied.reason);
  const copy = Object.keys(applied.doc.entities).find((id) => !Object.hasOwn(doc.entities, id)) ?? "";
  const place = (id: string): unknown =>
    (applied.doc.entities[id]?.components.transform as { position?: unknown }).position;
  const entity = String(args.entity);
  return { original: place(entity), copy: place(copy) };
}

describe("the offset of a duplicate", () => {
  it("moves the copy by the offset, and keeps it on the original with no offset", () => {
    const plain = duplicate({ entity: "bench" });
    expect(plain.copy).toEqual(plain.original);
    const moved = duplicate({ entity: "bench", x: 1.5, z: -0.25 });
    const [x, y, z] = moved.original as number[];
    expect(moved.copy).toEqual([(x ?? 0) + 1.5, y, (z ?? 0) - 0.25]);
  });
});
