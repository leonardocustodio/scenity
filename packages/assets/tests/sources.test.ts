// SPDX-License-Identifier: Apache-2.0
// The asset sources: the search and the files of the Poly Haven provider, and the import of
// a sky and of a model with its parts and the rights record of the provider. A fake fetch serves the API answers
// and the files of the fixtures.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  httpGenerator,
  importFromSource,
  importGenerated,
  polyHaven,
  ProviderRegistry,
  type Fetcher,
} from "../src/sources";

const FIXTURES = join(import.meta.dir, "fixtures/import");
const API = "http://polyhaven.test/api";
const DL = "http://polyhaven.test/dl";

const LIST: Record<string, unknown> = {
  hdris: {
    studio_small_09: { name: "Studio Small 09", tags: ["studio", "soft"], categories: ["indoor"], download_count: 9 },
    sunset_field: { name: "Sunset Field", tags: ["sky", "sunset"], categories: ["outdoor"], download_count: 20 },
  },
  models: { box_crate: { name: "Box Crate", tags: ["crate"], categories: ["props"], download_count: 1 } },
};
const FILES: Record<string, unknown> = {
  studio_small_09: { hdri: { "1k": { hdr: { url: `${DL}/studio_small_09_1k.hdr`, size: 10 } } } },
  box_crate: {
    gltf: {
      "1k": {
        gltf: {
          url: `${DL}/box.gltf`,
          include: { "box.bin": { url: `${DL}/box.bin` }, "box_color.png": { url: `${DL}/box_color.png` } },
        },
      },
    },
  },
};

const fakeFetch: Fetcher = (url) => {
  const json = (value: unknown): Promise<Response> => Promise.resolve(Response.json(value));
  if (url.startsWith(`${API}/assets?t=`)) return json(LIST[url.slice(`${API}/assets?t=`.length)] ?? {});
  if (url.startsWith(`${API}/files/`)) return json(FILES[url.slice(`${API}/files/`.length)] ?? {});
  if (url.startsWith(`${DL}/`)) {
    const name = url.slice(`${DL}/`.length);
    const file = name === "studio_small_09_1k.hdr" ? "sky.hdr" : name;
    return Promise.resolve(new Response(readFileSync(join(FIXTURES, file))));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "scenity-sources-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "scenity.project.json"),
    JSON.stringify({ format: "scenity.project/1", id: "p", name: "P", assets: ["assets"], scenes: [] }),
  );
  mkdirSync(join(dir, "assets"));
  return dir;
}

describe("the Poly Haven provider", () => {
  const provider = polyHaven({ api: API, cdn: "http://polyhaven.test/cdn", fetch: fakeFetch });

  test("searches by name, ID and tag, the most downloaded first", async () => {
    expect((await provider.search("environment", "")).map((item) => item.id)).toEqual([
      "sunset_field",
      "studio_small_09",
    ]);
    expect((await provider.search("environment", "indoor")).map((item) => item.id)).toEqual(["studio_small_09"]);
    expect((await provider.search("model", "crate"))[0]).toMatchObject({ name: "Box Crate", licence: "CC0-1.0" });
    expect(provider.preview("sunset_field")).toBe(
      "http://polyhaven.test/cdn/asset_img/thumbs/sunset_field.png?width=256&height=256",
    );
    expect(new ProviderRegistry().add(provider).get("polyhaven")).toBe(provider);
  });

  test("imports a sky with the rights record of Poly Haven", async () => {
    const dir = project();
    const result = await importFromSource(dir, provider, "studio_small_09", "environment", {
      fetch: fakeFetch,
      today: "2026-10-18",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.kind).toBe("environment");
    expect(result.source).toBe("assets/sources/polyhaven/studio_small_09/studio_small_09_1k.hdr");
    expect(result.rights.record).toBe("rights/polyhaven.yaml");
    const rights = readFileSync(join(dir, "rights/polyhaven.yaml"), "utf8");
    expect(rights).toContain('spdx: "CC0-1.0"');
    expect(rights).toContain("licenceDate: 2026-10-18");
    const record = JSON.parse(readFileSync(join(dir, result.record), "utf8")) as { rights: string; tags: string[] };
    expect(record.rights).toBe("../../../../rights/polyhaven.yaml");
    expect(record.tags).toEqual(["polyhaven", "environment"]);
  });

  test("imports a model with its buffer and its texture", async () => {
    const dir = project();
    const result = await importFromSource(dir, provider, "box_crate", "model", { fetch: fakeFetch });
    expect(result.ok).toBe(true);
    for (const file of ["box.gltf", "box.bin", "box_color.png"]) {
      expect(existsSync(join(dir, "assets/sources/polyhaven/box_crate", file))).toBe(true);
    }
    if (result.ok) expect(result.warnings).toEqual([]);
  });
});

describe("a generator of assets", () => {
  const GEN = "http://generator.test";
  const calls: string[] = [];
  const genFetch: Fetcher = (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === `${GEN}/estimate`) return Promise.resolve(Response.json({ cost: 2, unit: "credits", seconds: 90 }));
    if (url === `${GEN}/generate`) {
      const files = ["box.gltf", "box.bin", "box_color.png"].map((path) => ({ path, url: `${DL}/${path}` }));
      return Promise.resolve(Response.json({ name: "Red Crate", files }));
    }
    return fakeFetch(url, init);
  };
  const generator = httpGenerator({ id: "acme", name: "Acme 3D", url: GEN, fetch: genFetch });

  test("gives the cost first, then imports the result with a generated rights record", async () => {
    const request = { prompt: "a red wooden crate", kind: "model" as const };
    expect(await generator.estimate(request)).toEqual({ cost: 2, unit: "credits", seconds: 90 });
    const dir = project();
    const result = await importGenerated(dir, generator, request, { fetch: genFetch, today: "2026-10-18" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("assets/sources/generated/red-crate/box.gltf");
    expect(existsSync(join(dir, "assets/sources/generated/red-crate/box.bin"))).toBe(true);
    const rights = readFileSync(join(dir, "rights/generated-acme.yaml"), "utf8");
    expect(rights).toContain("kind: generated");
    expect(rights).toContain('generator: "acme"');
    expect(rights).toContain("webDelivery: pending");
    expect(calls.slice(0, 2)).toEqual([`POST ${GEN}/estimate`, `POST ${GEN}/generate`]);
  });
});
