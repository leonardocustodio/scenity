// SPDX-License-Identifier: Apache-2.0
// The material editor of the scene page on a temp copy of the materials scene of samples/gltf-samples. The test opens a
// material asset and changes its values (each change goes to the core). It assigns the material to a part of a model
// with the command `material.assign` (one step). It undoes both changes and saves: the page editor writes the scene and
// the material file through the canonical writer. The panel shows the fields and the slots of the type. A type change
// shows the fields of the new type. The sample files are read only: each write goes to a temp copy.
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markRaw } from "vue";
import { readSceneFile, saveSceneFile, type SceneSaveParams } from "@scenity/cli/sceneFile";
import type { MaterialEdits } from "@scenity/editor-core";
import { assetIndex } from "../../scripts/projects";
import { sceneCommands } from "../../src/scene/hierarchy/sceneCommands";
import MaterialPanel from "../../src/scene/material/MaterialPanel.vue";
import { openMaterial } from "../../src/scene/material/materialEvents";
import { PageMaterials } from "../../src/scene/material/pageMaterials";
import { parseScene } from "../../src/scene/project";
import { sceneBar } from "../../src/scene/sceneBar";
import { ScenePageEditor } from "../../src/scene/sceneEditor";
import type { SceneFilePort } from "../../src/scene/sceneFiles";

const SAMPLES = join(import.meta.dirname, "../../../../samples/gltf-samples");
const SCENE = "scenes/materials.scene.json";
const STANDARD = "asset:01M51H7Y9ZE026AZ1AQJ288Y3V";
const STANDARD_FILE = "assets/materials/standard.material.json";
const temp = mkdtempSync(join(tmpdir(), "scenity-scene-materials-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let copies = 0;
/** A temp copy of the scenes and the material assets of the glTF samples. */
function copy(): string {
  copies += 1;
  const dir = join(temp, `samples-${String(copies)}`);
  for (const part of ["scenes", "assets/materials"]) cpSync(join(SAMPLES, part), join(dir, part), { recursive: true });
  return dir;
}

function diskPort(dir: string): SceneFilePort {
  return {
    read: (path) => Promise.resolve(readSceneFile(dir, path)),
    save: (params: SceneSaveParams) => Promise.resolve(saveSceneFile(dir, params)),
  };
}

/** A selection of the page in memory. */
function memorySelection() {
  const listeners = new Set<(ids: readonly string[]) => void>();
  const selection = {
    ids: [] as readonly string[],
    set(ids: readonly string[]) {
      selection.ids = [...ids];
      for (const listener of listeners) listener(selection.ids);
    },
    listen(listener: (ids: readonly string[]) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return selection;
}

/** The page editor and the material editor of a temp copy; `sent` lists the documents that the core got. */
function page(dir: string) {
  const diskText = readFileSync(join(dir, SCENE), "utf8");
  const files = diskPort(dir);
  const sent: MaterialEdits[] = [];
  const parts = { meshes: ["Orange_Object", "Blue_Object"], materials: ["Blue", "Orange"] };
  const materials = new PageMaterials({
    base: "/projects/samples/",
    files,
    send: (docs) => {
      sent.push(docs);
      return Promise.resolve();
    },
    inspect: () => Promise.resolve({ entities: [{ id: "model", parts }] }),
  });
  const editor = new ScenePageEditor({
    ...materials.editorParts(),
    patch: () => Promise.resolve({ ok: true, warnings: [] }),
    doc: parseScene(diskText),
    path: SCENE,
    diskText,
    files,
    bar: sceneBar(SCENE, () => undefined),
    checkRules: () => Promise.resolve([]),
  });
  const selection = memorySelection();
  materials.connect(editor);
  // The page commands also have `material.assign` (for the palette and Claude).
  const commands = sceneCommands(editor, selection);
  expect(commands.listings().some((listing) => listing.id === "material.assign")).toBe(true);
  return { editor, materials, sent, selection };
}

beforeEach(() => {
  document.body.replaceChildren();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Serve the asset index of a temp copy to the page (the dev server of scripts/projects.ts). */
function serveIndex(dir: string): void {
  const index = assetIndex(dir);
  vi.stubGlobal("fetch", (url: string) =>
    Promise.resolve(
      url.endsWith("assets.index.json")
        ? new Response(JSON.stringify(index), { headers: { "Content-Type": "application/json" } })
        : new Response("no", { status: 404 }),
    ),
  );
}

describe("the material editor of the scene page", () => {
  it("changes a material for the core, assigns it as one step, undoes, and saves the scene and the material", async () => {
    const dir = copy();
    serveIndex(dir);
    const { editor, materials, sent } = page(dir);
    openMaterial(STANDARD);
    await flushPromises();
    expect(materials.current).toBe(STANDARD);
    expect(materials.channel.doc(STANDARD).roughness).toBe(0.45);
    const doc = materials.channel.doc(STANDARD);
    materials.channel.set(STANDARD, { ...doc, roughness: 0.15, colour: "#ff2020" });
    await materials.settled();
    expect(sent.at(-1)?.[STANDARD]).toMatchObject({ roughness: 0.15, colour: "#ff2020" });
    expect(editor.dirty).toBe(true);
    // The model takes the material for one of its parts: the command, one step of the history.
    const targets = await materials.targets("model");
    expect(targets.map((target) => target.key)).toContain("mesh:Blue_Object");
    await materials.assign("model", "mesh:Blue_Object", STANDARD);
    const model = editor.doc.entities.model?.components.model as { materials: Record<string, unknown> };
    expect(model.materials["mesh:Blue_Object"]).toEqual({ material: STANDARD });
    expect(editor.channel.undo()).toBe(true);
    expect((editor.doc.entities.model?.components.model as typeof model).materials["mesh:Blue_Object"]).toBeUndefined();
    expect(editor.channel.undo()).toBe(true);
    expect(materials.channel.doc(STANDARD).roughness).toBe(0.45);
    await materials.settled();
    expect(sent.at(-1)?.[STANDARD]?.roughness).toBe(0.45);
    expect(editor.channel.redo() && editor.channel.redo()).toBe(true);
    const result = await editor.save();
    expect(result.ok).toBe(true);
    const saved = JSON.parse(readFileSync(join(dir, STANDARD_FILE), "utf8")) as Record<string, unknown>;
    expect(saved).toMatchObject({ roughness: 0.15, colour: "#ff2020", type: "standard", name: "Checker standard" });
    const scene = parseScene(readFileSync(join(dir, SCENE), "utf8"));
    expect((scene.entities.model?.components.model as typeof model).materials["mesh:Blue_Object"]).toEqual({
      material: STANDARD,
    });
    expect(editor.dirty).toBe(false);
    expect(materials.channel.dirtyRefs()).toEqual([]);
  });

  it("the panel shows the fields and the slots of the type, and a type change shows the new fields", async () => {
    const dir = copy();
    serveIndex(dir);
    const { editor, materials, selection } = page(dir);
    await materials.open(STANDARD);
    // The page gives raw objects (startMaterials.ts): a reactive proxy cannot read private fields.
    const parts = markRaw({ materials: markRaw(materials), editor: markRaw(editor), selection });
    const wrapper = mount(MaterialPanel, { props: { parts } });
    await flushPromises();
    const id = (name: string) => `[data-testid="${name}"]`;
    expect(wrapper.find(id("material-panel")).attributes("data-material")).toBe(STANDARD);
    expect(wrapper.find(id("material-field-roughness")).exists()).toBe(true);
    expect(wrapper.find(id("material-field-clearcoat")).exists()).toBe(false);
    expect(wrapper.find(id("material-slot-normal-texture")).exists()).toBe(true);
    expect(wrapper.find(id("material-users")).text()).toBe("Used by 1 entity");
    await wrapper.find(id("material-type")).setValue("physical");
    await flushPromises();
    expect(materials.channel.doc(STANDARD).type).toBe("physical");
    expect(wrapper.find(id("material-field-clearcoat")).exists()).toBe(true);
    await wrapper.find(id("material-field-roughness")).setValue("0.3");
    await wrapper.find(id("material-field-roughness")).trigger("change");
    expect(materials.channel.doc(STANDARD).roughness).toBe(0.3);
    expect(wrapper.find(id("material-panel")).attributes("data-dirty")).toBe("1");
    selection.set(["model"]);
    await flushPromises();
    expect(wrapper.findAll(`${id("material-assign-part")} option`).length).toBeGreaterThan(1);
    // A value over the limit of the schema (0 to 1) goes to the limit.
    await wrapper.find(id("material-field-roughness")).setValue("7");
    await wrapper.find(id("material-field-roughness")).trigger("change");
    expect(materials.channel.doc(STANDARD).roughness).toBe(1);
    wrapper.unmount();
  });
});
