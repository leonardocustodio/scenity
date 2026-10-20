// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
// The asset list and the import of the asset browser on the dev server: the list of a copy of the showroom (kinds,
// tags, stills, numbers, "used by"), the import of a file into `assets/sources` with its record and its import, the
// refusals (a bad name, an extension with no importer, a folder outside the asset roots, a link out of the project,
// another origin, the remote mode). The showroom files are read only: each write goes to a temp copy.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { encode } from "fast-png";
import { afterAll, describe, expect, it } from "vitest";
import {
  assetHealth,
  IMPORT_FOLDER,
  IMPORT_RIGHTS,
  importFile,
  listAssets,
  safeFileName,
} from "../../scripts/assetApi";
import { handleAssetImport, handleAssetList } from "../../scripts/assetApiServer";
import { IMPORT_HEADER, NAME_HEADER, type AssetImportResult, type AssetList } from "../../src/assetBrowser/assetTypes";

const SHOWROOM = join(import.meta.dirname, "../../../../samples/showroom");
const LANTERN = "01M4ZPXYG26FPR940EDPJM9FCD";
const temp = mkdtempSync(join(tmpdir(), "scenity-asset-api-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let copies = 0;
/** A temp copy of the showroom with no import folder. */
function copy(): string {
  copies += 1;
  const dir = join(temp, `showroom-${String(copies)}`);
  cpSync(SHOWROOM, dir, { recursive: true, filter: (source) => !source.includes(".scenity") });
  return dir;
}

/** A PNG of 4 by 4 pixels, made here (CC0). */
function png(): Uint8Array {
  return encode({ width: 4, height: 4, data: new Uint8Array(64).fill(180), channels: 4 });
}

describe("the asset list", () => {
  it("gives the showroom assets with kinds, tags, stills, numbers and uses", async () => {
    const list = await listAssets(copy());
    expect(list.assets).toHaveLength(7);
    expect(list.importable).toBe(true);
    expect(list.extensions).toContain(".png");
    const lantern = list.assets.find((asset) => asset.id === LANTERN);
    expect(lantern).toMatchObject({ kind: "model", tags: ["furniture"], still: `stills/${LANTERN}.webp` });
    expect(lantern?.stats.triangles).toBeGreaterThan(0);
    expect(lantern?.usedBy).toContainEqual(
      expect.objectContaining({ document: "scenes/main.scene.json", entity: "lantern" }),
    );
    expect(list.assets.find((asset) => asset.kind === "environment")?.tags).toEqual(["studio"]);
  });

  it("refuses an import into a project whose asset roots do not hold assets/sources", async () => {
    const dir = copy();
    const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as { assets: string[] };
    project.assets = ["models"];
    writeFileSync(join(dir, "scenity.project.json"), JSON.stringify(project));
    const list = await listAssets(dir);
    expect(list.importable).toBe(false);
    expect(list.reason).toContain(IMPORT_FOLDER);
    const result = await importFile(dir, "chequer.png", png());
    expect(result.ok).toBe(false);
  });
});

describe("the import", () => {
  it("writes the file, its record and its import, and the list shows it", async () => {
    const dir = copy();
    const result = await importFile(dir, "my chequer.png", png(), { today: "2026-10-16" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.asset).toMatchObject({
      kind: "texture",
      name: "my_chequer",
      tags: ["imported"],
      source: `${IMPORT_FOLDER}/my_chequer.png`,
      still: `${IMPORT_FOLDER}/my_chequer.png`,
    });
    const record = JSON.parse(readFileSync(join(dir, `${IMPORT_FOLDER}/my_chequer.png.meta.json`), "utf8")) as {
      id: string;
      rights: string;
    };
    expect(record.id).toBe(result.asset.id);
    expect(record.rights).toBe("../../rights/imports.yaml");
    expect(existsSync(join(dir, ".scenity/imports", record.id, "import.json"))).toBe(true);
    expect(readFileSync(join(dir, IMPORT_RIGHTS), "utf8")).toContain("webDelivery: pending");
    const list = await listAssets(dir);
    expect(list.assets.map((asset) => asset.id)).toContain(record.id);
  });

  it("keeps an existing file and takes the next free name", async () => {
    const dir = copy();
    const first = await importFile(dir, "a.png", png());
    const second = await importFile(dir, "a.png", png());
    expect(first.ok && first.asset.source).toBe(`${IMPORT_FOLDER}/a.png`);
    expect(second.ok && second.asset.source).toBe(`${IMPORT_FOLDER}/a-2.png`);
  });

  it("refuses a bad name and an extension with no importer", async () => {
    const dir = copy();
    expect(safeFileName("../../up.png")).toBe("up.png");
    expect(safeFileName(".hidden.png")).toBeNull();
    expect(await importFile(dir, ".hidden.png", png())).toMatchObject({ ok: false });
    const exe = await importFile(dir, "tool.exe", png());
    expect(exe.ok).toBe(false);
    expect(!exe.ok && exe.reason).toContain("no importer");
    expect(existsSync(join(dir, IMPORT_FOLDER, "tool.exe"))).toBe(false);
  });

  it("refuses an import folder that is a link out of the project", async () => {
    const dir = copy();
    const outside = join(temp, `outside-${String(copies)}`);
    mkdirSync(outside);
    rmSync(join(dir, "assets/sources"), { recursive: true });
    symlinkSync(outside, join(dir, "assets/sources"));
    const result = await importFile(dir, "chequer.png", png());
    expect(result).toMatchObject({ ok: false });
    expect(existsSync(join(outside, "chequer.png"))).toBe(false);
  });
});

/** A request with headers and a body, and a response that keeps its status and its body. */
function exchange(headers: Record<string, string>, body: Uint8Array) {
  const request = Object.assign(Readable.from([Buffer.from(body)]), { headers }) as unknown as IncomingMessage;
  const sent: { status: number; body: string } = { status: 0, body: "" };
  const fake = {
    statusCode: 0,
    setHeader: () => undefined,
    end: (text: string) => {
      sent.status = fake.statusCode;
      sent.body = text;
    },
  };
  const response = fake as unknown as ServerResponse;
  return { request, response, sent };
}

const PAGE = { host: "127.0.0.1:5176", origin: "http://127.0.0.1:5176" };

describe("the requests of the dev server", () => {
  it("answers the list and an import of a page of the server", async () => {
    const dir = copy();
    const listed = exchange({}, new Uint8Array());
    await handleAssetList(listed.response, dir);
    expect(listed.sent.status).toBe(200);
    expect((JSON.parse(listed.sent.body) as AssetList).assets).toHaveLength(7);
    const headers = { ...PAGE, [IMPORT_HEADER]: "1", [NAME_HEADER]: encodeURIComponent("drop é.png") };
    const imported = exchange(headers, png());
    await handleAssetImport(imported.request, imported.response, dir, {});
    expect(imported.sent.status).toBe(200);
    const result = JSON.parse(imported.sent.body) as AssetImportResult;
    expect(result.ok && result.asset.source).toBe(`${IMPORT_FOLDER}/drop__.png`);
  });

  it("refuses another origin, a request with no header and the remote mode", async () => {
    const dir = copy();
    const cases: [Record<string, string>, Record<string, string>][] = [
      [{ ...PAGE, origin: "http://evil.test", [IMPORT_HEADER]: "1", [NAME_HEADER]: "a.png" }, {}],
      [{ ...PAGE, [NAME_HEADER]: "a.png" }, {}],
      [
        { ...PAGE, [IMPORT_HEADER]: "1", [NAME_HEADER]: "a.png" },
        { SCENITY_WORKBENCH_PUBLIC_ORIGIN: "https://x.test" },
      ],
    ];
    for (const [headers, env] of cases) {
      const { request, response, sent } = exchange(headers, png());
      await handleAssetImport(request, response, dir, env);
      expect(sent.status).toBe(403);
    }
    expect(existsSync(join(dir, IMPORT_FOLDER, "a.png"))).toBe(false);
  });
});

describe("the health of the assets", () => {
  it("names the assets that the release gate stops and the assets with no build", async () => {
    const dir = copy();
    expect(await assetHealth(dir)).toEqual({ rights: [], unbuilt: [] });
    const rights = join(dir, "rights/polyhaven.yaml");
    writeFileSync(rights, readFileSync(rights, "utf8").replace("spdx: CC0-1.0", "spdx: CC-BY-NC-4.0"));
    const imported = await importFile(dir, "chequer.png", png(), { today: "2026-10-18" });
    if (!imported.ok) throw new Error(imported.reason);
    const health = await assetHealth(dir);
    expect(health.rights.map((asset) => asset.id)).toContain(LANTERN);
    expect(health.rights.find((asset) => asset.id === LANTERN)?.problems.join(" ")).toMatch(/CC-BY-NC-4\.0|licen/i);
    expect(health.unbuilt).toEqual([imported.asset.id]);
  });
});
