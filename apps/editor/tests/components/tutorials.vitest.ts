// SPDX-License-Identifier: Apache-2.0
// The tutorials of the editor window: the checks of the steps on the state of the window, and the texts of each step in
// each locale.
import { describe, expect, it } from "vitest";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { EDITOR_RESOURCES, messageIdOf } from "../../src/texts";
import { LAMP, nextOpenStep, tutorialOf, TUTORIALS, type TutorialView } from "../../src/scene/tutorials/tutorials";

const doc = (entities: Record<string, object>): SceneDocument =>
  ({ format: "scenity.scene/1", id: "s", entities }) as unknown as SceneDocument;
const view = (part: Partial<TutorialView>): TutorialView => ({
  doc: doc({}),
  selection: [],
  dirty: true,
  sequence: null,
  playing: false,
  ...part,
});
const entity = (name: string, components: object = {}): object => ({ name, parent: null, index: 0, components });

describe("the tutorials", () => {
  it("the first scene goes on step by step as the scene changes", () => {
    const tutorial = tutorialOf("firstScene");
    if (tutorial === undefined) throw new Error("no tutorial");
    const start = { entities: 1 };
    const base = { a: entity("Floor") };
    expect(nextOpenStep(tutorial, 0, view({ doc: doc(base) }), start)).toBe(0);
    expect(nextOpenStep(tutorial, 0, view({ doc: doc({ ...base, b: entity("Entity") }) }), start)).toBe(1);
    expect(nextOpenStep(tutorial, 0, view({ doc: doc({ ...base, b: entity(LAMP) }) }), start)).toBe(2);
    const lit = { ...base, b: entity(LAMP, { light: {}, transform: { position: [0, 2, 0] } }) };
    expect(nextOpenStep(tutorial, 0, view({ doc: doc(lit) }), start)).toBe(4);
    expect(nextOpenStep(tutorial, 0, view({ doc: doc(lit), dirty: false }), start)).toBe(5);
  });

  it("the prefab and the sequence tutorials read the instances, the keys and the clock", () => {
    const prefab = tutorialOf("prefab");
    const sequence = tutorialOf("sequence");
    if (prefab === undefined || sequence === undefined) throw new Error("no tutorial");
    const start = { entities: 0 };
    const two = doc({
      a: entity("A", { prefab: { source: "asset:p" } }),
      b: entity("B", { prefab: { source: "asset:p" } }),
    });
    expect(nextOpenStep(prefab, 0, view({ doc: two, selection: ["a"] }), start)).toBe(3);
    const keys = (count: number) =>
      ({
        format: "scenity.sequence/1",
        id: "q",
        scene: "s",
        duration: 1000,
        tracks: [{ kind: "transform", entity: "a", keys: Array.from({ length: count }, (_, t) => ({ t })) }],
      }) as unknown as TutorialView["sequence"];
    expect(nextOpenStep(sequence, 0, view({ sequence: keys(0), selection: ["a"] }), start)).toBe(2);
    expect(nextOpenStep(sequence, 0, view({ sequence: keys(2), selection: ["a"] }), start)).toBe(4);
    expect(nextOpenStep(sequence, 0, view({ sequence: keys(2), selection: ["a"], playing: true }), start)).toBe(5);
  });

  it("each tutorial and step has a text in each locale", () => {
    for (const locale of ["en-US", "pt-BR"]) {
      const text = EDITOR_RESOURCES.filter((resource) => resource.locale === locale)
        .map((resource) => resource.source)
        .join("\n");
      for (const tutorial of TUTORIALS) {
        const id = messageIdOf("tutorial", tutorial.id);
        expect(text).toContain(`${id}-title =`);
        for (const step of tutorial.steps) expect(text).toContain(`${id}-${step.id} =`);
      }
    }
  });
});
