// SPDX-License-Identifier: Apache-2.0
// The onion skins of the Scene view: five copies of an entity that moves, two before and three after the clock time, at
// the places of the open sequence. A time out of the sequence has no copy.
import { PosedView } from "@scenity/editor-core";
import { builtinRegistry } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { describe, expect, it } from "vitest";
import { onionCopies } from "../../src/scene/sequencer/onionSkins";

const SCENE = {
  format: "scenity.scene/1",
  id: "room",
  entities: { box: { parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } } },
} as unknown as SceneDocument;
const SEQUENCE = {
  format: "scenity.sequence/1",
  id: "move",
  scene: "room",
  duration: 2000,
  tracks: [
    {
      kind: "transform",
      entity: "box",
      keys: [
        { t: 0, position: [0, 0, 0] },
        { t: 2000, position: [2, 0, 0] },
      ],
    },
  ],
} as unknown as SequenceDocument;

describe("the onion skins", () => {
  it("gives five copies of a moving entity round the clock time", () => {
    const copies = onionCopies(SCENE, SEQUENCE, "box", 1000, new PosedView(builtinRegistry()));
    expect(copies.map((copy) => Math.round((copy.matrix[12] ?? 0) * 100) / 100)).toEqual([0.5, 0.75, 1.25, 1.5, 1.75]);
    expect(copies.map((copy) => copy.side)).toEqual(["before", "before", "after", "after", "after"]);
    expect(copies.map((copy) => copy.opacity)).toEqual([0.38, 0.5, 0.5, 0.38, 0.26]);
  });

  it("gives no copy out of the sequence, nor of an entity that the scene does not have", () => {
    const view = new PosedView(builtinRegistry());
    expect(onionCopies(SCENE, SEQUENCE, "box", 0, view)).toHaveLength(3);
    expect(onionCopies(SCENE, SEQUENCE, "missing", 1000, view)).toEqual([]);
  });
});
