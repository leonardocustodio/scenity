// SPDX-License-Identifier: Apache-2.0
// The sources of the parts of the studio: the checkout, or the installed packages. Also the server child of the scene
// server (its start, its ready check and its stop).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { childEnv, ServerChild } from "../src/process";
import { checkoutRoot, cliCommand, editorAppDir, viteCommand } from "../src/runtime";
import { sceneServerCommand } from "../src/sceneServer";

const CHECKOUT = resolve(import.meta.dir, "..", "..", "..");

describe("the parts of the studio", () => {
  test("come from the checkout that holds the package", () => {
    expect(checkoutRoot()).toBe(CHECKOUT);
    expect(checkoutRoot("/tmp/node_modules/@scenity/studio-host")).toBeNull();
    expect(editorAppDir(CHECKOUT)).toBe(join(CHECKOUT, "apps", "editor"));
    expect(cliCommand(CHECKOUT)).toEqual([process.execPath, join(CHECKOUT, "packages", "cli", "src", "cli.ts")]);
  });

  test("come from the installed packages with no checkout", () => {
    // In the workspace the installed packages are links to the checkout folders.
    expect(editorAppDir(null)).toBe(join(CHECKOUT, "apps", "editor"));
    expect(cliCommand(null)[1]).toBe(join(CHECKOUT, "packages", "cli", "src", "cli.ts"));
    const [bun, vite] = viteCommand(editorAppDir(null));
    expect(bun).toBe(process.execPath);
    expect(existsSync(vite ?? "")).toBe(true);
  });

  test("give the scene server its projects file and, when installed, its cache folder", () => {
    const app = join(CHECKOUT, "apps", "editor");
    const plain = sceneServerCommand(app, "/state/projects.json", 5200);
    expect(plain.cmd.slice(2)).toEqual([
      "--config",
      "vite.scene.config.ts",
      "--port",
      "5200",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
    expect(plain.env.SCENITY_SCENE_PROJECTS_FILE).toBe("/state/projects.json");
    expect(plain.env.SCENITY_SCENE_CACHE_DIR).toBeUndefined();
    expect(sceneServerCommand(app, "/p.json", 1, "/state/vite").env.SCENITY_SCENE_CACHE_DIR).toBe("/state/vite");
  });

  test("keep the host-only variables out of a child", () => {
    process.env.SCENITY_LAB_TOOLS = "1";
    try {
      expect(childEnv({ A: "b" })).toMatchObject({ A: "b" });
      expect(childEnv().SCENITY_LAB_TOOLS).toBeUndefined();
    } finally {
      delete process.env.SCENITY_LAB_TOOLS;
    }
  });
});

describe("the server child", () => {
  test("starts, answers on its ready path and stops with its process group", async () => {
    const script =
      "Bun.serve({ port: Number(process.argv[1]), hostname: '127.0.0.1', fetch: () => new Response('ok') });";
    const server = new ServerChild({
      command: (port) => ({ cmd: [process.execPath, "-e", script, String(port)], cwd: CHECKOUT, env: childEnv() }),
      readyPath: "/",
    });
    await server.start();
    expect(server.info.status).toBe("ready");
    const origin = server.info.origin ?? "";
    expect(await (await fetch(origin)).text()).toBe("ok");
    await server.stop();
    expect(server.info).toMatchObject({ status: "stopped", origin: null });
    expect(
      await fetch(origin).then(
        () => "up",
        () => "down",
      ),
    ).toBe("down");
  });

  test("fails with the reason when the program ends before it is ready", async () => {
    const server = new ServerChild({
      command: () => ({ cmd: [process.execPath, "-e", "process.exit(3)"], cwd: CHECKOUT, env: childEnv() }),
      readyPath: "/",
      readyTimeoutMs: 5000,
    });
    await server.start();
    expect(server.info.status).toBe("failed");
    expect(server.info.error).toContain("code 3");
  });
});
