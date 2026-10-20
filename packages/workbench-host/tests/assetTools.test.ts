// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the asset tools of the host on a copy of the showroom sample (a temp folder, so the repository sample does
 * not change). `asset_search` finds the assets of the database by words and kind, with their users. `asset_import`
 * makes a project asset of a model file of the checkout. It refuses a file out of the checkout and refuses the role
 * viewer.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { handleToolRequest } from "../src/tools/index";
import type { ToolContext } from "../src/tools/context";
import type { ToolResult } from "../src/tools/kit";
import { scaleTestTimeouts } from "./ciTiming";
import { fakeContext, fakeLab, labAnswers } from "./fakeLab";
import { cleanup, tempDir } from "./helpers";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const SHOWROOM = resolve(import.meta.dir, "../../../samples/showroom");
const BOX_GLB = resolve(import.meta.dir, "../../assets/tests/fixtures/import/box.glb");
const made: string[] = [];
afterAll(() => cleanup(...made));

/** A copy of the showroom (without the player build) with a model file to import. */
function showroom(): string {
  const parent = tempDir("asset-tools");
  made.push(parent);
  const dir = join(parent, "showroom");
  cpSync(SHOWROOM, dir, { recursive: true, filter: (path) => !path.includes("/dist") });
  mkdirSync(join(dir, "incoming"));
  copyFileSync(BOX_GLB, join(dir, "incoming", "box.glb"));
  return dir;
}

function context(dir: string, more: Partial<ToolContext> = {}): ToolContext {
  return { ...fakeContext(fakeLab(labAnswers()).port), checkout: dir, projectDir: dir, ...more };
}

function textOf(result: ToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
}

describe("the asset tools", () => {
  test("asset_search finds the assets by words and kind, with the documents that use them", async () => {
    const dir = showroom();
    const all = textOf(await handleToolRequest("asset_search", {}, context(dir)));
    expect(all).toMatch(/^\d+ of \d+ assets match\./);
    const lantern = textOf(await handleToolRequest("asset_search", { q: "lantern" }, context(dir)));
    expect(lantern).toContain("1 of");
    expect(lantern).toContain("source assets/sources/Lantern_01/Lantern_01_1k.gltf");
    expect(lantern).toContain("scenes/main.scene.json#lantern");
    expect(lantern).toContain("    used by ");
    const none = textOf(await handleToolRequest("asset_search", { q: "lantern", kind: "texture" }, context(dir)));
    expect(none).toMatch(/^0 of \d+ assets match\./);
  });

  test("asset_import makes a project asset of a model file; a viewer and a file out of the checkout are refused", async () => {
    const dir = showroom();
    const viewer = await handleToolRequest(
      "asset_import",
      { file: "incoming/box.glb" },
      context(dir, { role: "viewer" }),
    );
    expect(viewer.isError).toBe(true);
    expect(textOf(viewer)).toBe("asset_import: the role viewer cannot import assets.");
    const outside = await handleToolRequest("asset_import", { file: BOX_GLB }, context(dir));
    expect(outside.isError).toBe(true);
    expect(textOf(outside)).toContain("is not in the checkout");
    const result = await handleToolRequest("asset_import", { file: "incoming/box.glb" }, context(dir));
    const text = textOf(result);
    expect(result.isError).toBeUndefined();
    expect(text).toMatch(/^Imported asset:\S+ \(model\) · source assets\/sources\/box\.glb · record /);
    expect(text).toContain("rights/imports.yaml");
    expect(existsSync(join(dir, "assets", "sources", "box.glb"))).toBe(true);
    const found = textOf(await handleToolRequest("asset_search", { q: "box" }, context(dir)));
    expect(found).toContain("source assets/sources/box.glb");
  }, 60_000);
});
