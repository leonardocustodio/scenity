// SPDX-License-Identifier: Apache-2.0
// The semantic diff: the diff of two showroom versions names each changed value. The test makes a second version of the
// showroom scene and of the walkthrough sequence.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SemanticDiff from "../../src/scene/diff/SemanticDiff.vue";
import { changeCount, documentDiff, entityDiff, sequenceDiff } from "../../src/scene/diff/semanticDiff";
import { editorI18n } from "../../src/texts";

const SAMPLES = join(__dirname, "../../../../samples");
const sceneText = readFileSync(join(SAMPLES, "showroom/scenes/main.scene.json"), "utf8");
const sequenceText = readFileSync(join(SAMPLES, "walkthrough/sequences/meet.sequence.json"), "utf8");
type Doc = { entities: Record<string, Record<string, unknown> & { components: Record<string, unknown> }> } & Record<
  string,
  unknown
>;

/** The second version of the showroom scene: each kind of change once. */
function secondVersion(): Doc {
  const doc = JSON.parse(sceneText) as Doc;
  const armchair = doc.entities.armchair;
  const table = doc.entities["coffee-table"];
  if (armchair === undefined || table === undefined) throw new Error("no armchair");
  armchair.name = "Reading chair";
  (armchair.components.transform as { position: number[] }).position = [-2, 0, 0.3];
  delete armchair.components.obstacle;
  armchair.components.pickable = { layers: ["seat"] };
  table.parent = "armchair";
  table.index = 0;
  delete doc.entities.fill;
  doc.entities.lamp = { name: "Lamp", parent: null, index: 11, components: { transform: { position: [1, 0, 1] } } };
  doc.name = "Showroom two";
  return doc;
}

describe("the semantic diff", () => {
  it("names each changed value of two showroom versions", () => {
    const diff = entityDiff(JSON.parse(sceneText) as never, secondVersion() as never);
    expect(diff.values).toEqual([
      { field: "name", before: (JSON.parse(sceneText) as Doc).name, after: "Showroom two" },
    ]);
    const byId = new Map(diff.entities.map((entity) => [entity.id, entity]));
    expect([...byId.keys()]).toEqual(["armchair", "coffee-table", "fill", "lamp"]);
    expect(byId.get("armchair")).toEqual({
      id: "armchair",
      name: "Reading chair",
      state: "changed",
      values: [{ field: "name", before: "Armchair", after: "Reading chair" }],
      components: [
        { component: "obstacle", state: "removed", values: [] },
        { component: "pickable", state: "added", values: [{ field: "layers", before: undefined, after: ["seat"] }] },
        {
          component: "transform",
          state: "changed",
          values: [{ field: "position", before: [-2.5, 0, 0.3], after: [-2, 0, 0.3] }],
        },
      ],
    });
    expect(byId.get("coffee-table")).toMatchObject({
      parent: { before: null, after: "armchair" },
      values: [{ field: "index", before: 7, after: 0 }],
    });
    expect(byId.get("fill")).toMatchObject({ state: "removed", components: [] });
    expect(byId.get("lamp")).toMatchObject({
      state: "added",
      components: [{ component: "transform", state: "added" }],
    });
    // 1 scene name + armchair (1 name, 1 removed, 1 added, 1 position) + table (1 parent, 1 index) + fill + lamp.
    expect(changeCount(diff)).toBe(9);
    expect(entityDiff(JSON.parse(sceneText) as never, JSON.parse(sceneText) as never).entities).toEqual([]);
  });

  it("gives the changes of a sequence by track and key time", () => {
    const before = JSON.parse(sequenceText) as { tracks: { name?: string; keys: Record<string, unknown>[] }[] };
    const after = JSON.parse(sequenceText) as typeof before;
    const reach = after.tracks[0];
    if (reach === undefined) throw new Error("no track");
    reach.name = "Reach out";
    reach.keys[1] = { ...reach.keys[1], value: 0.8 };
    reach.keys.push({ t: 7000, value: 0 });
    after.tracks.splice(1, 1);
    const diff = sequenceDiff(before, after);
    expect(diff.tracks).toEqual([
      {
        track: "property bo character/ik/rightHand/weight",
        state: "changed",
        values: [{ field: "name", before: "Reach", after: "Reach out" }],
        keys: [
          { t: 4000, state: "changed", values: [{ field: "value", before: 1, after: 0.8 }] },
          { t: 7000, state: "added", values: [{ field: "value", before: undefined, after: 0 }] },
        ],
      },
      { track: "property bo character/ik/rightHand/target", state: "removed", values: [], keys: [] },
    ]);
  });

  it("reads a diff from two file texts and shows it", () => {
    expect(documentDiff("notes.txt", "a", "b")).toBeNull();
    expect(documentDiff("scenes/main.scene.json", "{", sceneText)).toBeNull();
    const added = documentDiff("scenes/main.scene.json", null, sceneText);
    expect(added?.entities.every((entity) => entity.state === "added")).toBe(true);
    const diff = documentDiff("scenes/main.scene.json", sceneText, JSON.stringify(secondVersion()));
    if (diff === null) throw new Error("no diff");
    const wrapper = mount(SemanticDiff, { props: { diff }, global: { plugins: [editorI18n().plugin] } });
    const root = wrapper.get('[data-testid="semantic-diff"]');
    expect(root.attributes("data-count")).toBe("9");
    expect(wrapper.get('[data-entity="armchair"] [data-field="transform.position"]').text()).toContain(
      "(-2.5, 0, 0.3)",
    );
    expect(wrapper.get('[data-entity="fill"]').attributes("data-state")).toBe("removed");
    expect(wrapper.get('[data-entity="coffee-table"] [data-diff="parent"]').text()).toContain("armchair");
    wrapper.unmount();
  });
});
