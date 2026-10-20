// SPDX-License-Identifier: Apache-2.0
// The widgets of the character setup. The foot lock of an animator takes its legs from the bone names of the model. The
// IK goals of a character set a target, a weight and the max angle of the look. The handles of the IK targets are at
// the world points of the target entities. Each change is one undo step.
import { SceneChannel } from "@scenity/editor-core";
import { builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { ikHandles } from "../../src/scene/character/characterSetup";
import InspectorPanel from "../../src/scene/inspector/InspectorPanel.vue";
import { createInspector, type InspectorPort } from "../../src/scene/inspector/inspectorState";
import { footLockOf, guessLeg, withLegPart } from "../../src/scene/inspector/widgets/footLock";

const registry = builtinRegistry();
const BONES = ["Hips", "UpperLeg_L", "LowerLeg_L", "Foot_L", "UpperLeg_R", "LowerLeg_R", "Foot_R", "Head"];
const before = globalThis.__scenity;
afterEach(() => {
  document.body.innerHTML = "";
  globalThis.__scenity = before;
});

const CONTROLLER = {
  layers: [{ name: "base", start: "idle", states: { idle: { motion: { kind: "clip", clip: "Idle" } } } }],
};
const SCENE = {
  format: "scenity.scene/1",
  id: "test",
  entities: {
    hero: {
      name: "Hero",
      parent: null,
      index: 0,
      components: {
        transform: { position: [1, 0, 0] },
        model: { asset: "asset:hero" },
        character: {},
        animator: { controller: CONTROLLER },
      },
    },
    cup: { name: "Cup", parent: "table", index: 0, components: { transform: { position: [0, 1, 0] } } },
    table: { name: "Table", parent: null, index: 1, components: { transform: { position: [2, 0, 3] } } },
  },
};

function setup() {
  const read = readDocument(JSON.stringify(SCENE), "scene", { registry });
  if (!read.ok) throw new Error("bad scene");
  const listeners = new Set<(doc: SceneDocument) => void>();
  const channel = new SceneChannel<SceneDocument>({
    doc: read.doc,
    registry,
    patch: () => undefined,
    onChange: (doc) => {
      for (const listener of listeners) listener(doc);
    },
  });
  const port: InspectorPort = {
    registry,
    assets: [],
    doc: () => channel.doc,
    listen: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    edit: (ops, title) => {
      try {
        channel.edit(ops, title);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    begin: () => channel.begin(),
    move: (ops) => {
      channel.move(ops);
      return null;
    },
    end: (cancel) => channel.end(cancel),
  };
  // The inspect report of the core: only the bone names of the model of the hero.
  const report = { entities: [{ id: "hero", parts: { bones: BONES } }] };
  globalThis.__scenity = {
    ...before,
    inspect: () => Promise.resolve(report),
  } as unknown as typeof globalThis.__scenity;
  return { channel, state: createInspector(port, ["hero"]) };
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const press = async (id: string): Promise<void> => {
  byId(id)?.click();
  await flushPromises();
};
/** Put a value in an input or a select of the inspector and commit it. */
async function put(id: string, value: string): Promise<void> {
  const input = byId<HTMLInputElement | HTMLSelectElement>(id);
  if (input === null) throw new Error(`no field ${id}`);
  input.value = value;
  input.dispatchEvent(new Event("change"));
  await flushPromises();
}

describe("the model of the foot lock", () => {
  it("takes a leg of each side from the bone names, and drops an empty follow bone", () => {
    const left = guessLeg(BONES, []);
    expect(left).toEqual({ upper: "UpperLeg_L", lower: "LowerLeg_L", end: "Foot_L" });
    // Mixamo, Rigify, UE5 and VRM: the right leg comes first, and the helper bones are not a part of a leg.
    const rigs = [
      ["mixamorig:RightUpLeg", "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot"],
      ["DEF-thigh.R", "DEF-thigh.L", "DEF-shin.L", "DEF-foot.L"],
      ["thigh_r", "thigh_l", "calf_l", "foot_l"],
      ["J_Bip_R_UpperLeg", "J_Bip_L_UpperLeg", "J_Bip_L_LowerLeg", "J_Bip_L_Foot"],
    ];
    for (const [right = "", upper = "", lower = "", end = ""] of rigs) {
      const names = [right, "thigh_twist_01_l", "ik_foot_l", "LowerLegL_end", upper, lower, end];
      expect(guessLeg(names, [])).toEqual({ upper, lower, end });
    }
    if (left === null) throw new Error("no leg");
    expect(guessLeg(BONES, [left])).toEqual({ upper: "UpperLeg_R", lower: "LowerLeg_R", end: "Foot_R" });
    expect(guessLeg(["Hips", "Head"], [])).toBeNull();
    const lock = { legs: [{ ...left, follow: "Toe_L" }] };
    expect(withLegPart(lock, 0, "follow", " ").legs[0]).toEqual(left);
    expect(withLegPart(lock, 0, "end", "Ankle_L").legs[0]?.end).toBe("Ankle_L");
    expect(footLockOf({ legs: [] })).toEqual({ legs: [] });
    expect(footLockOf("no")).toBeNull();
  });
});

describe("the handles of the IK targets", () => {
  it("puts a handle at the world point of each target entity, and none at a socket", () => {
    const read = readDocument(JSON.stringify(SCENE), "scene", { registry });
    if (!read.ok) throw new Error("bad scene");
    const ik = {
      look: { target: "entity:cup" },
      leftHand: { target: "entity:cup" },
      rightHand: { target: "entity:table#grip" },
    };
    expect(ikHandles(read.doc, ik)).toEqual([{ entity: "cup", point: [2, 1, 3], goals: ["leftHand", "look"] }]);
    expect(ikHandles(read.doc, { look: { target: "entity:gone" } })).toEqual([]);
    expect(ikHandles(read.doc, undefined)).toEqual([]);
  });
});

describe("the widgets of the character setup", () => {
  it("add the foot lock from the bone names, change a part, add and remove a leg", async () => {
    const { channel, state } = setup();
    mount(InspectorPanel, { props: { state }, attachTo: document.body });
    await flushPromises();
    await nextTick();
    const lock = () => (channel.doc.entities.hero?.components.animator as { footLock?: unknown }).footLock;
    expect(byId("field-animator-footLock")?.textContent).toContain("No foot lock");
    await press("field-animator-footLock-add");
    expect(lock()).toEqual({ legs: [{ upper: "UpperLeg_L", lower: "LowerLeg_L", end: "Foot_L" }] });
    await press("field-animator-footLock-add");
    expect((lock() as { legs: unknown[] }).legs).toHaveLength(2);
    expect(byId<HTMLButtonElement>("field-animator-footLock-add")?.disabled).toBe(true);
    await put("field-animator-footLock-leg-0-follow", "Foot_L");
    expect((lock() as { legs: { follow?: string }[] }).legs[0]?.follow).toBe("Foot_L");
    await put("field-animator-footLock-contact", "0.3");
    expect((lock() as { contact?: number }).contact).toBe(0.3);
    await press("field-animator-footLock-leg-1-remove");
    expect((lock() as { legs: unknown[] }).legs).toHaveLength(1);
    channel.undo();
    expect((lock() as { legs: unknown[] }).legs).toHaveLength(2);
    await nextTick();
    await press("field-animator-footLock-remove");
    expect(lock()).toBeUndefined();
  });

  it("set the target, the weight and the max angle of the IK goals, and remove a goal", async () => {
    const { channel, state } = setup();
    mount(InspectorPanel, { props: { state }, attachTo: document.body });
    await flushPromises();
    await nextTick();
    const ik = () => (channel.doc.entities.hero?.components.character as { ik?: Record<string, unknown> }).ik;
    expect(byId("field-character-ik-look-weight")).toBeNull();
    await put("field-character-ik-look-target", "cup");
    expect(ik()).toEqual({ look: { target: "entity:cup" } });
    await nextTick();
    await put("field-character-ik-look-weight", "0.5");
    await put("field-character-ik-look-angle", "90");
    expect(ik()?.look).toMatchObject({ target: "entity:cup", weight: 0.5 });
    expect((ik()?.look as { maxAngle: number }).maxAngle).toBeCloseTo(Math.PI / 2);
    expect(byId<HTMLInputElement>("field-character-ik-look-angle")?.value).toBe("90");
    await put("field-character-ik-rightHand-target", "table");
    expect(Object.keys(ik() ?? {})).toEqual(["rightHand", "look"]);
    await press("field-character-ik-look-remove");
    await press("field-character-ik-rightHand-remove");
    expect(ik()).toBeUndefined();
  });
});
