// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { ASSET_ID_RE } from "../src/record";
import { putAsset, removeTemps, SHOWROOM, tempProject } from "./helpers";

const A = "01J9Z6Q3R9AAAAAAAAAAAAAAAA";
const B = "01J9Z6Q3R9BBBBBBBBBBBBBBBB";

afterEach(removeTemps);

describe("the CLI of the asset database", () => {
  test("index of the showroom prints 7 assets and exits with 0", async () => {
    const result = await runCli(["index", SHOWROOM]);
    expect(result.code).toBe(0);
    expect(result.out.at(-1)).toBe("7 assets, 0 problems");
    const json = await runCli(["index", SHOWROOM, "--json"]);
    const parsed = JSON.parse(json.out.join("\n")) as { entries: unknown[]; problems: unknown[] };
    expect(parsed.entries).toHaveLength(7);
  });

  test("index and missing exit with 1 on a broken reference", async () => {
    const dir = tempProject([A, B]);
    putAsset(dir, "assets/a.glb", A);
    expect((await runCli(["index", dir])).code).toBe(1);
    const missing = await runCli(["missing", dir]);
    expect(missing.code).toBe(1);
    expect(missing.out[0]).toBe(`asset:${B}  scenes/main.scene.json#/entities/e1/components/model/asset  entity e1`);
  });

  test("index exits with 1 on a duplicate ID", async () => {
    const dir = tempProject();
    putAsset(dir, "assets/a.glb", A);
    putAsset(dir, "assets/b.glb", A);
    expect((await runCli(["index", dir])).code).toBe(1);
  });

  test("used-by prints the document, the pointer and the entity", async () => {
    // The test uses the lantern: the crowd scene gives the table 500 more users. The effects scene also has a lantern.
    const result = await runCli(["used-by", SHOWROOM, "01M4ZPXYG26FPR940EDPJM9FCD"]);
    expect(result.out).toEqual([
      "scenes/effects.scene.json#/entities/lantern/components/model/asset  entity lantern",
      "scenes/main.scene.json#/entities/lantern/components/model/asset  entity lantern",
    ]);
  });

  test("new-id prints a ULID, and a bad command prints the usage", async () => {
    expect((await runCli(["new-id"])).out[0]).toMatch(ASSET_ID_RE);
    expect((await runCli(["nothing"])).code).toBe(2);
    expect((await runCli(["index", "/no/such/folder"])).code).toBe(2);
  });
});
