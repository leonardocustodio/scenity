// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the content hash. The hash follows the content of the files that a frame depends on, not the time or the
 * order of the files. An edit of a family file changes it. An edit of a file that a frame does not depend on does not
 * change it.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  ALWAYS_EXCLUDED,
  ContentHasher,
  contentHashOf,
  fsContentReader,
  isContentFileIn,
  type ContentConfig,
  type FsLike,
} from "../src/contentHash";

/** A content config as a plugin gives it (the lab of a plugin keeps such a config in its frame index source). */
const MANIFEST = "game/content/built/manifest.json";
const CONTENT: ContentConfig = {
  roots: ["game/room/src", "game/dev/src", "game/view/src", "game/editor/src", "game/core"],
  manifest: MANIFEST,
  excluded: [
    /^game\/core\/browser\//,
    /^game\/core\/[^/]+\.vue$/,
    /^game\/editor\/src\/(browser|stills|generated)\//,
    /^game\/editor\/src\/(?!LabsRoomView\.vue$)[^/]+\.vue$/,
    ...ALWAYS_EXCLUDED,
  ],
};
const isContentFile = (path: string): boolean => isContentFileIn(CONTENT, path);
const reader = (root: string) => fsContentReader(nodeFs, root, CONTENT);

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

/** A small workspace tree (the repo root): a pose family file, a lab take, the manifest and files that do not count. */
function makeWeb(): string {
  const root = fs.mkdtempSync(join(tmpdir(), "labs-content-"));
  folders.push(root);
  const files: Record<string, string> = {
    "game/room/src/model/families/walk.ts": "export const WALK = 1;\n",
    "game/dev/src/metrics.ts": "export const M = 1;\n",
    "game/view/src/RoomView.vue": "<template />\n",
    "game/content/built/files/char.glb": "big",
    [MANIFEST]: '{"files":[]}\n',
    "game/editor/src/takes.ts": "export const TAKES = [];\n",
    "game/editor/src/LabsRoomView.vue": "<template />\n",
    "game/core/LabTimeline.vue": "<template />\n",
    "game/core/browser/DockStrip.vue": "<template />\n",
    "game/editor/src/generated/takeLanes.json": "{}\n",
    "game/room/src/.DS_Store": "x",
  };
  for (const [path, text] of Object.entries(files)) {
    fs.mkdirSync(join(root, path, ".."), { recursive: true });
    fs.writeFileSync(join(root, path), text);
  }
  return root;
}

const nodeFs = fs as unknown as FsLike;
const nodeSha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("content hash", () => {
  test("lists only the files that a frame depends on", () => {
    const files = reader(makeWeb()).files().sort();
    expect(files).toEqual(
      [
        "game/editor/src/LabsRoomView.vue",
        "game/editor/src/takes.ts",
        "game/dev/src/metrics.ts",
        "game/view/src/RoomView.vue",
        MANIFEST,
        "game/room/src/model/families/walk.ts",
      ].sort(),
    );
    expect(isContentFile("game/editor/src/tracks/t01_demo.json")).toBe(true);
    expect(isContentFile("game/editor/src/stills/walk.webp")).toBe(false);
    expect(isContentFile("game/room/src/secret.pem")).toBe(false);
    expect(isContentFile("apps/workbench/src/main.ts")).toBe(false);
  });

  test("an edit of a family file changes the hash; undoing it gives the old hash; a restart keeps it", () => {
    const root = makeWeb();
    const before = new ContentHasher(reader(root)).hash();
    expect(before).toMatch(/^[0-9a-f]{32}$/);
    const family = join(root, "game/room/src/model/families/walk.ts");
    fs.writeFileSync(family, "export const WALK = 2;\n");
    const hasher = new ContentHasher(reader(root));
    const edited = hasher.hash();
    expect(edited).not.toBe(before);
    fs.writeFileSync(family, "export const WALK = 1;\n");
    // A new mtime with the old bytes gives the old hash: the hash reads the content, not the time.
    expect(hasher.hash()).toBe(before);
    expect(new ContentHasher(reader(root)).hash()).toBe(before);
  });

  test("the asset manifest, a new file and a removed file change the hash; a file of the UI does not", () => {
    const root = makeWeb();
    const hasher = new ContentHasher(reader(root));
    const start = hasher.hash();
    fs.writeFileSync(join(root, "game/core/LabTimeline.vue"), "<template><b /></template>\n");
    fs.writeFileSync(join(root, "game/editor/src/generated/takeLanes.json"), '{"a":1}\n');
    expect(hasher.hash()).toBe(start);
    fs.writeFileSync(join(root, MANIFEST), '{"files":[1]}\n');
    const manifest = hasher.hash();
    expect(manifest).not.toBe(start);
    fs.writeFileSync(join(root, "game/dev/src/new.ts"), "export {};\n");
    const added = hasher.hash();
    expect(added).not.toBe(manifest);
    fs.rmSync(join(root, "game/dev/src/new.ts"));
    expect(hasher.hash()).toBe(manifest);
  });

  test("the pure SHA-256 and the SHA-256 of node:crypto give the same hash; the order of entries does not count", () => {
    const root = makeWeb();
    expect(new ContentHasher(reader(root), nodeSha).hash()).toBe(new ContentHasher(reader(root)).hash());
    const entries = [
      { path: "a", digest: "1" },
      { path: "b", digest: "2" },
    ];
    expect(contentHashOf(entries)).toBe(contentHashOf([...entries].reverse()));
    expect(contentHashOf(entries)).not.toBe(
      contentHashOf([
        { path: "a", digest: "2" },
        { path: "b", digest: "1" },
      ]),
    );
  });
});
