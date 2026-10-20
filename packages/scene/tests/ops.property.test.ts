// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { applyOps, checkTree, writeDocument, type SceneDocument, type SceneOp } from "../src/index";
import { deepFreeze, fixture, registry, seeded } from "./helpers";
import { randomOp } from "./opGen";

const CASES = 600;

describe("ops then their inverse (a property test)", () => {
  const bases = [deepFreeze(fixture("main.scene.json", "scene")), deepFreeze(fixture("workshop.scene.json", "scene"))];

  test(`${String(CASES)} random op lists: the inverse gives the same document`, () => {
    const random = seeded(20261015);
    let applied = 0;
    for (let index = 0; index < CASES; index += 1) {
      const base = bases[index % bases.length]!;
      const counter = { next: 0 };
      const ops: SceneOp[] = [];
      let doc: SceneDocument = base;
      const length = 1 + Math.floor(random() * 12);
      while (ops.length < length) {
        const op = randomOp(doc, random, counter);
        if (op === undefined) continue;
        const step = applyOps(doc, [op], registry);
        if (!step.ok)
          throw new Error(`case ${String(index)}: a generated op is refused: ${step.reason}\n${JSON.stringify(op)}`);
        expect(checkTree(step.doc.entities)).toEqual([]);
        doc = step.doc;
        ops.push(op);
      }
      const forward = applyOps(base, ops, registry);
      if (!forward.ok) throw new Error(`case ${String(index)}: ${forward.reason}`);
      expect(forward.doc).toEqual(doc);
      expect(checkTree(forward.doc.entities)).toEqual([]);
      const back = applyOps(forward.doc, forward.inverse, registry);
      if (!back.ok)
        throw new Error(`case ${String(index)}: the inverse is refused at ${String(back.index)}: ${back.reason}`);
      expect(back.doc).toEqual(base);
      expect(writeDocument(back.doc)).toBe(writeDocument(base));
      applied += ops.length;
    }
    expect(applied).toBeGreaterThan(CASES * 3);
  });
});
