// SPDX-License-Identifier: Apache-2.0
// The review of the change sets: the rows of a change set by entity with the old and new values, and the marks of the
// entities and fields in the colour of the session. Also the panel (checks, Accept checked, Reject all) and the result
// of the review for the agent.
import { builtinRegistry } from "@scenity/scene";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import { changeSetsOf, sceneOpEntity, type Actor, type Proposal } from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { PageOp, SceneCommands } from "../../src/scene/hierarchy/sceneCommands";
import ReviewPanel from "../../src/scene/review/ReviewPanel.vue";
import { reviewSet, valueText } from "../../src/scene/review/reviewModel";
import { acceptTitle, createReviewState } from "../../src/scene/review/reviewState";

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
});

const ACTOR: Actor = { kind: "agent", session: "s1", name: "Chairs", colour: "agent-2", turn: 2 };

const DOC = {
  format: "scenity.scene/1",
  id: "room",
  entities: {
    lamp: { name: "Lamp", parent: null, index: 0, components: { light: { colour: "#ffffff", intensity: 1 } } },
    sofa: { name: "Sofa", parent: null, index: 1, components: {} },
  },
} as unknown as SceneDocument;

function proposal(id: string, ops: PageOp[]): Proposal<PageOp> {
  return {
    id,
    edit: { id: `${id}#1`, title: "Warm the room", ops, actor: ACTOR },
    command: "batch",
    args: {},
    by: "claude",
  };
}

const set = (op: PageOp): PageOp => op;
const OPS: PageOp[] = [
  set({ kind: "scene", op: { op: "set", path: "/entities/lamp/components/light/colour", value: "#ffd9a8" } }),
  set({ kind: "scene", op: { op: "set", path: "/entities/lamp/components/light/intensity", value: 1.5 } }),
  set({ kind: "scene", op: { op: "remove", id: "sofa" } }),
];

/** Fake commands over one list of proposals: the accept and the reject of ops. */
function fakeCommands() {
  let proposals: Proposal<PageOp>[] = [proposal("p1", OPS)];
  const accepted: { keys: readonly string[]; title: string }[] = [];
  const drop = (keys: readonly string[]): void => {
    const gone = new Set(keys);
    proposals = proposals
      .map((item) => ({
        ...item,
        edit: { ...item.edit, ops: item.edit.ops.filter((_op, index) => !gone.has(`${item.id}:${String(index)}`)) },
      }))
      .filter((item) => item.edit.ops.length > 0);
  };
  const commands = {
    changeSets: () => changeSetsOf(proposals, (op) => (op.kind === "scene" ? sceneOpEntity(op.op) : null)),
    acceptOps: (keys: readonly string[], title: string) => {
      accepted.push({ keys, title });
      drop(keys);
      return {} as never;
    },
    rejectOps: (keys: readonly string[]) => {
      drop(keys);
      return keys.length;
    },
  } as unknown as SceneCommands;
  return { commands, accepted };
}

describe("the review model", () => {
  it("lists the ops by entity with short values", () => {
    const sets = changeSetsOf([proposal("p1", OPS)], (op) => (op.kind === "scene" ? sceneOpEntity(op.op) : null));
    const view = reviewSet(sets[0]!, DOC);
    expect(view.rows.map((row) => [row.entity, row.name, row.change, row.ops.length])).toEqual([
      ["lamp", "Lamp", "changed", 2],
      ["sofa", "Sofa", "removed", 1],
    ]);
    expect(view.rows[0]?.ops[0]).toMatchObject({
      field: "components.light.colour",
      before: "#ffffff",
      after: "#ffd9a8",
    });
    expect(valueText([1, 2.12345, 3])).toBe("(1, 2.123, 3)");
    expect(valueText(undefined)).toBe("—");
    expect(valueText({ a: "x".repeat(80) }).endsWith("…")).toBe(true);
    expect(acceptTitle({ actor: ACTOR, title: "Warm the room" })).toBe("Chairs: Warm the room");
  });

  it("marks the entities and fields in the colour of the session, and gives the result to the agent", () => {
    const { commands, accepted } = fakeCommands();
    const review = createReviewState(commands, () => DOC);
    review.refresh();
    expect(review.count()).toBe(3);
    expect(review.entities.value.get("lamp")).toMatchObject({
      change: "changed",
      colour: "var(--sc-color-studio-agent-2)",
    });
    expect(review.fieldMark(["lamp"], "components.light.intensity")).toMatchObject({ before: "1", after: "1.5" });
    expect(review.fieldMark(["sofa"], "components.light.intensity")).toBeNull();
    const first = review.sets.value[0];
    if (first === undefined) throw new Error("no set");
    expect(review.accept(first, ["p1:0", "p1:1"])).toBeNull();
    expect(accepted).toEqual([{ keys: ["p1:0", "p1:1"], title: "Chairs: Warm the room" }]);
    expect(review.feedback("s1")).toBeNull();
    const rest = review.sets.value[0];
    if (rest === undefined) throw new Error("no set");
    review.reject(rest, ["p1:0"]);
    expect(review.count()).toBe(0);
    expect(review.feedback("s1")).toBe("Turn 2: the person accepted 2 of 3 changes. Rejected: Sofa.");
  });
});

describe("the Review panel", () => {
  it("accepts the checked ops as one step and rejects the rest", async () => {
    const { commands, accepted } = fakeCommands();
    const review = createReviewState(commands, () => DOC);
    review.refresh();
    const preview = { key: shallowRef<string | null>(null), set: () => undefined };
    const selected: (readonly string[])[] = [];
    mounted.push(
      mount(ReviewPanel, {
        props: {
          ...{ review, doc: () => DOC, select: (ids: readonly string[]) => selected.push(ids), preview },
          registry: builtinRegistry(),
        },
        attachTo: document.body,
      }),
    );
    await flushPromises();
    const rows = document.querySelectorAll('[data-testid="review-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.textContent).toContain("−");
    const intensity = document.querySelector<HTMLInputElement>('[data-op="p1:1"] [data-testid="review-check"]');
    intensity?.click();
    await flushPromises();
    const acceptChecked = document.querySelector<HTMLButtonElement>('[data-testid="review-accept-checked"]');
    expect(acceptChecked?.textContent).toContain("Accept 2 checked");
    acceptChecked?.click();
    await flushPromises();
    expect(accepted).toEqual([{ keys: ["p1:0", "p1:2"], title: "Chairs: Warm the room" }]);
    document.querySelector<HTMLButtonElement>('[data-testid="review-entity"]')?.click();
    expect(selected).toEqual([["lamp"]]);
    document.querySelector<HTMLButtonElement>('[data-testid="review-reject-all"]')?.click();
    await flushPromises();
    expect(document.querySelector('[data-testid="review-panel"]')?.textContent).toContain(
      "No change waits for review.",
    );
  });
});
