// SPDX-License-Identifier: Apache-2.0
// The generic frame key and the content roots of a project.
import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameKey, isFrameKey, sceneFrameKey, type SceneFrameKeyInput } from "../src/frameKey";
import { ContentHasher, fsContentReader, isContentFileIn, projectContent } from "../src/contentHash";

const scene = {
  format: "scenity.scene/1",
  id: "main",
  entities: { cart: { parent: null, index: 0, components: { transform: { position: [0.85, 0, -1.45] } } } },
};

const input: SceneFrameKeyInput = {
  documents: { "scenes/main.scene.json": scene },
  overrides: [],
  sequence: null,
  timeMs: 5650,
  input: null,
  view: "front",
  renderer: { debug: [] },
  tier: "high",
  contentHash: "0123456789abcdef0123456789abcdef",
};

describe("sceneFrameKey", () => {
  test("gives the same key for the same inputs, in any key order", () => {
    const reordered: SceneFrameKeyInput = {
      ...input,
      documents: { "scenes/main.scene.json": { entities: scene.entities, id: "main", format: scene.format } },
    };
    expect(sceneFrameKey(input)).toBe(sceneFrameKey(reordered));
    expect(isFrameKey(sceneFrameKey(input))).toBe(true);
  });

  test("this key is stable across runs and machines (a fixed value)", () => {
    // The key is a SHA-256 of a stable JSON text, so it does not depend on the machine. A change of this value is
    // a change of the key format: it makes every index entry stale.
    expect(sceneFrameKey(input)).toBe("c30d88205f12312a1ae3fc75f3f69f6b");
  });

  test("a document change, an override, the time and the sequence change the key", () => {
    const base = sceneFrameKey(input);
    const moved = structuredClone(scene);
    moved.entities.cart.components.transform.position[0] = 0.9;
    expect(sceneFrameKey({ ...input, documents: { "scenes/main.scene.json": moved } })).not.toBe(base);
    expect(sceneFrameKey({ ...input, overrides: [{ ops: [{ op: "set", path: "/x", value: 1 }] }] })).not.toBe(base);
    expect(sceneFrameKey({ ...input, timeMs: 5651 })).not.toBe(base);
    expect(sceneFrameKey({ ...input, timeMs: 5650.4 })).toBe(base);
    expect(sceneFrameKey({ ...input, sequence: { format: "scenity.sequence/1" } })).not.toBe(base);
  });

  test("differs from the key of a take with the same parts", () => {
    const take = frameKey({
      source: "take:x",
      events: [],
      timeMs: 5650,
      view: "front",
      tunes: {},
      renderer: { debug: [] },
      tier: "high",
      contentHash: input.contentHash,
    });
    expect(take).not.toBe(sceneFrameKey(input));
  });
});

describe("projectContent", () => {
  test("takes the folders of the documents and the asset roots", () => {
    const config = projectContent(
      {
        scenes: ["scenes/main.scene.json"],
        sequences: ["sequences/tour.sequence.json"],
        assets: ["assets"],
        plugins: ["./plugins/doors"],
        rules: ["rules/layout.rules.json"],
      },
      "samples/showroom",
    );
    expect(config.roots).toEqual([
      "samples/showroom/assets",
      "samples/showroom/plugins/doors",
      "samples/showroom/rules",
      "samples/showroom/scenes",
      "samples/showroom/sequences",
    ]);
    expect(config.manifest).toBeNull();
    expect(isContentFileIn(config, "samples/showroom/scenes/main.scene.json")).toBe(true);
    expect(isContentFileIn(config, "samples/showroom/README.md")).toBe(false);
    expect(isContentFileIn(config, "samples/showroom/assets/.cache/x")).toBe(false);
  });

  test("uses workbench.contentRoots when the project gives them, and drops inner roots", () => {
    const config = projectContent({ scenes: ["a/b.scene.json"], workbench: { contentRoots: ["src", "src/inner"] } });
    expect(config.roots).toEqual(["src"]);
  });

  test("a document at the project root makes the project folder a root", () => {
    expect(projectContent({ scenes: ["main.scene.json"] }, "demo").roots).toEqual(["demo"]);
  });
});

test("the content hash of a project changes with a document and not with a file outside its roots", () => {
  const root = mkdtempSync(join(tmpdir(), "scenity-content-"));
  try {
    mkdirSync(join(root, "demo/scenes"), { recursive: true });
    mkdirSync(join(root, "demo/node_modules/x"), { recursive: true });
    writeFileSync(join(root, "demo/scenes/main.scene.json"), JSON.stringify(scene));
    writeFileSync(join(root, "demo/node_modules/x/index.js"), "1");
    writeFileSync(join(root, "demo/README.md"), "a");
    const fs = { readdirSync, readFileSync, statSync, existsSync };
    const config = projectContent({ scenes: ["scenes/main.scene.json"] }, "demo");
    const hash = () => new ContentHasher(fsContentReader(fs, root, config)).hash();
    const first = hash();
    expect(fsContentReader(fs, root, config).files()).toEqual(["demo/scenes/main.scene.json"]);
    writeFileSync(join(root, "demo/README.md"), "b");
    expect(hash()).toBe(first);
    writeFileSync(join(root, "demo/scenes/main.scene.json"), JSON.stringify({ ...scene, id: "other" }));
    expect(hash()).not.toBe(first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
