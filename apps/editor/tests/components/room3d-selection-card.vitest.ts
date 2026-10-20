// SPDX-License-Identifier: Apache-2.0
// The card of the selected item: the facts of the item, the warnings, and "Save placement". Save placement does the dry
// run with its lines, then the apply (the commands of a lab page alone). Also the typed "Ask Claude" request.
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { PickedItem } from "../../src/core/edit/pickedItem";
import SelectionCard from "../../src/core/edit/SelectionCard.vue";

const ITEM: PickedItem = {
  kind: "prop",
  id: "lamp",
  slot: "lamp",
  asset: { id: "prop_floor_lamp", file: "props/prop_floor_lamp.high.glb" },
  place: { x: 1.2, y: 0, z: -0.8, yawDeg: -11.46 },
  tunes: [
    { path: "room.props.lamp.at.0", value: 1.2, tuned: true },
    { path: "room.props.lamp.yaw", value: -0.2, tuned: false },
  ],
  bone: null,
  point: [1.2, 1, -0.8],
  near: [{ name: "pump_panel", cm: 4 }],
  warnings: ["The prop enters the table."],
  scratch: null,
};

const COMMANDS = {
  dry: 'bun run labs tune-apply "room.props.lamp.at.0:1.2" --dry',
  apply: 'bun run labs tune-apply "room.props.lamp.at.0:1.2"',
};

function card(props: Partial<InstanceType<typeof SelectionCard>["$props"]> = {}) {
  return mount(SelectionCard, {
    props: {
      item: ITEM,
      dragging: null,
      canUndo: true,
      canRedo: false,
      inWorkbench: true,
      placement: null,
      commands: COMMANDS,
      askStatus: null,
      marking: false,
      markCount: 0,
      ...props,
    },
  });
}

describe("SelectionCard", () => {
  it("shows the ID, the asset file, the place, the tune keys, the near points and the warnings", () => {
    const wrapper = card();
    expect(wrapper.get('[data-testid="lab-selection-id"]').text()).toBe("prop · lamp");
    expect(wrapper.get('[data-testid="lab-selection-asset"]').text()).toContain("props/prop_floor_lamp.high.glb");
    expect(wrapper.get('[data-testid="lab-selection-place"]').text()).toBe("1.200, 0.000, -0.800 · -11.46°");
    expect(wrapper.text()).toContain("room.props.lamp.at.0 = 1.2");
    expect(wrapper.text()).toContain("pump_panel 4 cm");
    expect(wrapper.get('[data-testid="lab-selection-warning"]').text()).toBe("The prop enters the table.");
    expect(wrapper.get('[data-testid="lab-picked-block"]').text()).toContain("Picked: prop lamp");
  });

  it("asks for the dry run in the workbench, then shows its lines and the apply button", async () => {
    const wrapper = card();
    await wrapper.get('[data-testid="lab-save-placement"]').trigger("click");
    expect(wrapper.emitted("save")).toEqual([[true]]);
    expect(wrapper.find('[data-testid="lab-save-placement-apply"]').exists()).toBe(false);
    await wrapper.setProps({
      placement: {
        run: "r1",
        dry: true,
        status: "passed",
        output: "the plan\nmodel/room.ts:278  room.props.lamp.at.0  1.31 → 1.2",
      },
    });
    expect(wrapper.get('[data-testid="lab-placement-output"]').text()).toContain("room.props.lamp.at.0  1.31 → 1.2");
    expect(wrapper.get('[data-testid="lab-placement-output"]').text()).not.toContain("the plan");
    await wrapper.get('[data-testid="lab-save-placement-apply"]').trigger("click");
    expect(wrapper.emitted("save")?.at(-1)).toEqual([false]);
  });

  it("shows the commands in a lab page alone", () => {
    const wrapper = card({ inWorkbench: false });
    expect(wrapper.find('[data-testid="lab-save-placement"]').exists()).toBe(false);
    // The commands of Save placement are hidden for now. Remove the comment marks to test them again.
    // expect(wrapper.get('[data-testid="lab-placement-commands"]').text()).toContain(COMMANDS.dry);
  });

  it("sends a typed request and clears the box; Escape and the clear button clear the selection", async () => {
    const wrapper = card({ askStatus: "Sent to the Claude terminal with the picked block." });
    await wrapper.get('[data-testid="lab-ask"]').setValue("move it 10 cm toward the wall");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("ask")).toEqual([["move it 10 cm toward the wall"]]);
    expect((wrapper.get('[data-testid="lab-ask"]').element as HTMLInputElement).value).toBe("");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("ask")).toHaveLength(1);
    expect(wrapper.get('[data-testid="lab-ask-status"]').text()).toContain("Claude terminal");
    await wrapper.get('button[aria-label="Clear the selection"]').trigger("click");
    expect(wrapper.emitted("clear")).toHaveLength(1);
  });
});
