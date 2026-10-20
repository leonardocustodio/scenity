// SPDX-License-Identifier: Apache-2.0
// The pictures of a project with no window: the arguments of `scenity shot`, the size of a PNG, and a picture through a
// fake CLI: the pool starts once, the shot writes the picture, and the hub gives the answer of `shadow.frame` in the
// form of the bridge socket when no window is open.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeHub } from "../src/bridgeHub";
import { PoolFrames, pngSize, shotArgs } from "../src/poolFrames";

const temp = mkdtempSync(join(tmpdir(), "studio-pool-frames-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** The first bytes of a PNG file of 320 × 200 (the signature and the IHDR chunk). */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const project = join(temp, "lobby");
mkdirSync(project);
writeFileSync(join(project, "scenity.project.json"), JSON.stringify({ sequences: ["sequences/walk.sequence.json"] }));
const log = join(temp, "calls.log");
// The fake CLI: `pool start` prints the ready line and waits; `shot` writes a PNG to its --out file.
const cli = join(temp, "cli.ts");
writeFileSync(
  cli,
  `import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, args.join(" ") + "\\n");
if (args[0] === "pool") { console.log("SCENITY_POOL_READY {}"); await new Promise(() => undefined); }
const out = args[args.indexOf("--out") + 1];
writeFileSync(out, new Uint8Array(${JSON.stringify([...png(320, 200)])}));
`,
);

describe("the pictures of the scene pool", () => {
  test("give the arguments of scenity shot and read the size of a PNG", () => {
    expect(shotArgs(project, { camera: "front", width: 320 }, "/o.png")).toEqual([
      "shot",
      "--project",
      project,
      "--camera",
      "front",
      "--size",
      "320x200",
      "--out",
      "/o.png",
      "--json",
    ]);
    expect(shotArgs(project, { t: 1500.4 }, "/o.png").slice(3, 7)).toEqual([
      "--sequence",
      "sequences/walk.sequence.json",
      "--at",
      "1500",
    ]);
    expect(pngSize(png(64, 48))).toEqual({ width: 64, height: 48 });
  });

  test("answer shadow.frame of a project with no window; the pool starts once", async () => {
    const pool = new PoolFrames({
      cli: [process.execPath, cli],
      dirOf: (key) => (key === "lobby" ? project : null),
      tmp: join(temp, "frames"),
    });
    const hub = new BridgeHub();
    hub.noWindow = (key, call, args) => (call === "shadow.frame" ? pool.frame(key, args[0] as object) : null);
    try {
      const first = (await hub.call("shadow.frame", [{ width: 320 }], { project: "lobby" })) as Record<string, unknown>;
      expect(first).toMatchObject({ simMs: null, width: 320, height: 200, mime: "image/png" });
      expect(typeof (first.bytes as { $bytes?: unknown }).$bytes).toBe("string");
      await hub.call("shadow.frame", [{ camera: "top" }], { project: "lobby" });
      const calls = readFileSync(log, "utf8").trim().split("\n");
      expect(calls.filter((line) => line.startsWith("pool start")).length).toBe(1);
      expect(calls.filter((line) => line.startsWith("shot")).length).toBe(2);
      // Another call needs a window.
      const refused = await hub.call("scene.query", [], { project: "lobby" }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(String(refused)).toContain("no editor window");
    } finally {
      pool.stop();
    }
  });
});
