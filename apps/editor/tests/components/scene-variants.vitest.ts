// SPDX-License-Identifier: Apache-2.0
// The variants of a scene. A variant from the edits since the last save is an override layer beside the scene. The
// scene returns to the saved values and names the variant. A variant shows in the view with the core patches only. An
// edit while it shows goes to the base scene. Apply puts a variant into the base scene.
import { applyOps, builtinRegistry, writeDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { describe, expect, it } from "vitest";
import type { ScenePageEditor } from "../../src/scene/sceneEditor";
import type { SceneFilePort } from "../../src/scene/sceneFiles";
import { BASE, PageVariants, variantFile, variantSlug } from "../../src/scene/variants/pageVariants";

const registry = builtinRegistry();
const SAVED = {
  format: "scenity.scene/1",
  id: "room",
  entities: { lamp: { parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } } },
} as unknown as SceneDocument;

/** A fake page: the editor document with its edits, a file port in a map, and the patches of the core. */
function page() {
  const texts = new Map<string, string>();
  const listeners = new Set<() => void>();
  let doc = SAVED;
  // The scene that the core shows: the patches change it, the edits of the editor change it too.
  const core = { doc: SAVED };
  const editor = {
    get doc() {
      return doc;
    },
    file: { path: "scenes/room.scene.json", baseText: writeDocument(SAVED) },
    listen: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
    apply: (ops: readonly SceneOp[]) => {
      const result = applyOps(doc, [...ops], registry);
      if (!result.ok) return result.reason;
      doc = result.doc;
      const shown = applyOps(core.doc, [...ops], registry);
      if (shown.ok) core.doc = shown.doc;
      for (const listener of listeners) listener();
      return null;
    },
  } as unknown as ScenePageEditor;
  const files: SceneFilePort = {
    read: (path) => {
      const text = texts.get(path);
      return text === undefined ? Promise.reject(new Error("no file")) : Promise.resolve({ path, text, hash: "h" });
    },
    save: (params) => {
      texts.set(params.path, params.text);
      return Promise.resolve({ ok: true, path: params.path, hash: "h", text: params.text, changed: true });
    },
  };
  const variants = new PageVariants({
    editor,
    files,
    registry,
    patch: (ops) => {
      const result = applyOps(core.doc, [...ops], registry);
      if (!result.ok) return Promise.reject(new Error(result.reason));
      core.doc = result.doc;
      return Promise.resolve();
    },
  });
  return { editor, texts, core, variants };
}

const move: SceneOp = { op: "set", path: "/entities/lamp/components/transform/position", value: [2, 0, 0] };
const placeOf = (doc: SceneDocument): number[] =>
  (doc.entities.lamp?.components.transform as { position: number[] }).position;

describe("the variants of a scene", () => {
  it("name the file of a variant beside the scene", () => {
    expect(variantSlug(" Evening Light ")).toBe("evening-light");
    expect(variantFile("scenes/room.scene.json", "evening")).toEqual({
      path: "scenes/room.evening.overrides.json",
      relative: "room.evening.overrides.json",
    });
  });

  it("make a variant from the edits, show it with core patches only, and apply it to the base", async () => {
    const { editor, texts, core, variants } = page();
    expect(await variants.makeFromEdits("Evening")).toBe("No edit since the last save.");
    expect(await variants.makeFromEdits(" - ")).toBe("A variant needs a name.");
    expect(editor.apply([move], "Move")).toBeNull();
    expect(await variants.makeFromEdits("Evening")).toBeNull();
    // The scene is back at the saved place and names the variant; the layer holds the move.
    expect(placeOf(editor.doc)).toEqual([0, 0, 0]);
    expect(editor.doc.variants).toEqual({ evening: "room.evening.overrides.json" });
    expect(texts.get("scenes/room.evening.overrides.json")).toContain('"ops"');
    expect(variants.names()).toEqual(["evening"]);
    await variants.show("evening");
    expect(variants.shown.value).toBe("evening");
    expect(placeOf(core.doc)).toEqual([2, 0, 0]);
    // The document of the editor stays the base scene while the variant shows.
    expect(placeOf(editor.doc)).toEqual([0, 0, 0]);
    await variants.show(BASE);
    expect(placeOf(core.doc)).toEqual([0, 0, 0]);
    expect(await variants.applyToBase("evening")).toBeNull();
    expect(placeOf(editor.doc)).toEqual([2, 0, 0]);
  });

  it("give the edit of the base scene to the view while a variant shows", async () => {
    const { editor, core, variants } = page();
    editor.apply([move], "Move");
    await variants.makeFromEdits("Wide");
    await variants.show("wide");
    editor.apply([{ op: "set", path: "/entities/lamp/name", value: "Lamp" }], "Rename");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(variants.shown.value).toBe(BASE);
    // The core goes from the variant with the rename back to the base scene with the rename.
    expect(placeOf(core.doc)).toEqual([0, 0, 0]);
    expect(core.doc.entities.lamp?.name).toBe("Lamp");
  });
});
