// SPDX-License-Identifier: Apache-2.0
// The posed view on the generic garden scene: the scene at the time of the clock, with a memo. The ops on the posed
// scene become ops on the base scene that make the same change.
import { describe, expect, it } from "bun:test";
import type { SceneDocument, SceneOp } from "@scenity/scene";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { PosedView, unposeOps } from "../src/index";
import { components, garden } from "./helpers";

const TABLE = "/entities/table/components/transform";

const SEQUENCE: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "tour",
  scene: "garden",
  duration: 2000,
  tracks: [
    {
      kind: "transform",
      entity: "table",
      keys: [
        { t: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        { t: 2000, position: [2, 0, 0], rotation: [0, 0.7071068, 0, 0.7071068], scale: [2, 2, 2] },
      ],
    },
  ],
};

function close(a: unknown, b: readonly number[]): void {
  const values = a as number[];
  expect(values).toHaveLength(b.length);
  b.forEach((value, index) => expect(values[index] ?? Number.NaN).toBeCloseTo(value, 5));
}

/** The position of the table in a scene. */
function tableAt(doc: SceneDocument): unknown {
  return (doc.entities.table?.components.transform as { position?: unknown } | undefined)?.position;
}

function valueOf(ops: readonly SceneOp[], index = 0): unknown {
  const op = ops[index];
  return op?.op === "set" ? op.value : undefined;
}

describe("the posed view", () => {
  it("gives the scene at the time with a memo, and the base scene with no sequence", () => {
    const view = new PosedView(components);
    const scene = garden();
    expect(view.at(scene, null, 1000)).toBe(scene);
    const posed = view.at(scene, SEQUENCE, 2000);
    close(tableAt(posed), [2, 0, 0]);
    expect(view.at(scene, SEQUENCE, 2000)).toBe(posed);
    // A time after the end is the end, and a fractional time rounds.
    expect(view.at(scene, SEQUENCE, 2500.4)).toBe(posed);
    close(tableAt(view.at(scene, SEQUENCE, 1000)), [1, 0, 0]);
  });

  it("turns a move, a turn and a scale of the posed scene into the same change of the base scene", () => {
    const base = garden();
    const posed = new PosedView(components).at(base, SEQUENCE, 2000);
    const move = unposeOps(base, posed, [{ op: "set", path: `${TABLE}/position`, value: [2.5, 0, 1] }]);
    close(valueOf(move), [0.5, 0, 1]);
    const part = unposeOps(base, posed, [{ op: "set", path: `${TABLE}/position/0`, value: 3 }]);
    expect(valueOf(part)).toBeCloseTo(1, 6);
    const scale = unposeOps(base, posed, [{ op: "set", path: `${TABLE}/scale`, value: [4, 2, 2] }]);
    close(valueOf(scale), [2, 1, 1]);
    // A turn of 90 degrees over the posed turn of 90 degrees gives a base turn of 90 degrees.
    const turn = unposeOps(base, posed, [{ op: "set", path: `${TABLE}/rotation`, value: [0, 1, 0, 0] }]);
    close(valueOf(turn), [0, 0.7071068, 0, 0.7071068]);
  });

  it("keeps an op of a value that the sequence does not change, and each op with no sequence", () => {
    const base = garden();
    const posed = new PosedView(components).at(base, SEQUENCE, 2000);
    const bench: SceneOp = { op: "set", path: "/entities/bench/components/transform/position", value: [0, 0, 0] };
    const rename: SceneOp = { op: "set", path: "/entities/table/name", value: "Desk" };
    expect(unposeOps(base, posed, [bench, rename])).toEqual([bench, rename]);
    const move: SceneOp = { op: "set", path: `${TABLE}/position`, value: [1, 0, 0] };
    expect(unposeOps(base, base, [move])).toEqual([move]);
  });
});
