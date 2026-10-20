// SPDX-License-Identifier: Apache-2.0
/**
 * The `scenity` command: the command list, the help of each command, the arguments of the commands with the shared
 * reader (create, dev, sheet, clip, verify, pool, assets), the plugin commands, and the project folders of a command.
 * `create.test.ts` makes projects; `createDev.test.ts` runs a new project in a browser.
 */
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assetArgs } from "../src/assets/command";
import { main } from "../src/cli";
import { parseClipArgs } from "../src/clip/command";
import { clipTimes, MAX_FRAMES } from "../src/clip/run";
import { COMMANDS, usageLines } from "../src/commands";
import { parseCreateArgs } from "../src/create/command";
import { parseDevArgs, projectsValue, scenePageUrl, serverName } from "../src/dev/command";
import { pluginCommands, projectCommands } from "../src/plugins/commands";
import { parsePoolArgs, runPoolCommand } from "../src/pool/command";
import { parseSheetArgs, sheetTimes } from "../src/sheet/command";
import { cellLabel, cellWidth, sheetColumns } from "../src/sheet/run";
import { parseVerifyArgs, projectBaselines } from "../src/verify/command";
import {
  checkoutRoot,
  commandProjectDir,
  CommandSetupError,
  editorAppDir,
  installedEditorDir,
  SCENE_CONFIG,
} from "../src/workspace";

const ROOT = join(import.meta.dir, "../../..");
const temp = mkdtempSync(join(tmpdir(), "scenity-cli-commands-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A temp project with the given plugin entries. */
function project(name: string, plugins: readonly string[] = [], scenes: readonly string[] = []): string {
  const dir = join(temp, name);
  put(
    join(dir, "scenity.project.json"),
    JSON.stringify({ format: "scenity.project/1", id: name, name, scenes, plugins }),
  );
  return dir;
}

/** The lines that `main` prints to stdout and stderr, and its exit code. */
async function run(argv: readonly string[]): Promise<{ out: string[]; err: string[]; code: number }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
  const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
  try {
    return { out, err, code: await main(argv) };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("scenity: the commands and their help", () => {
  test("the command list has each command in its order", () => {
    expect(COMMANDS.map((entry) => entry.name)).toEqual([
      "create",
      "studio",
      "mcp",
      "dev",
      "build",
      "check",
      "shot",
      "sheet",
      "frames",
      "clip",
      "bench",
      "verify",
      "publish",
      "pool",
      "assets",
    ]);
  });

  test("--help and no command print the list with exit 0; an unknown command exits 2", async () => {
    const help = await run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.out.join("\n")).toContain("  create   a new project folder");
    expect((await run([])).code).toBe(0);
    const unknown = await run(["frobnicate", "--project", project("unknown")]);
    expect(unknown.code).toBe(2);
    expect(unknown.err.at(-1)).toBe('scenity: no command "frobnicate"');
  });

  test.each(COMMANDS.map((entry) => entry.name))("scenity %s --help prints its usage with exit 0", async (name) => {
    const result = await run([name, "--help"]);
    expect(result.code).toBe(0);
    expect(result.out[0]).toStartWith(`usage: scenity ${name}`);
  });

  test("a usage error of a command exits 2", async () => {
    for (const argv of [
      ["create"],
      ["dev", "--port", "x"],
      ["sheet", "--format", "gif"],
      ["clip"],
      ["verify", "a", "b"],
    ]) {
      expect((await run(argv)).code).toBe(2);
    }
  });

  test("the plugin commands follow the commands of the CLI in the list", () => {
    const lines = usageLines([{ name: "labs", summary: "the lab" }]);
    expect(lines.slice(-2)).toEqual(["commands of the project plugins:", "  labs     the lab"]);
  });
});

describe("scenity create and dev: the arguments", () => {
  test("create takes one name, a template, a version and --install", () => {
    expect(parseCreateArgs(["demo"])).toEqual({
      options: { name: "demo", template: "empty", version: null, install: false },
      json: false,
    });
    expect(parseCreateArgs(["a/demo", "--template", "showroom", "--version", "^0.2.0", "--install", "--json"])).toEqual(
      {
        options: { name: "a/demo", template: "showroom", version: "^0.2.0", install: true },
        json: true,
      },
    );
    for (const argv of [[], ["a", "b"], ["demo", "--template", "nope"], ["demo", "--template"], ["demo", "--x"]]) {
      expect(parseCreateArgs(argv)).toBeNull();
    }
  });

  test("dev takes a project, a scene, a port and --view", () => {
    expect(parseDevArgs([])).toEqual({ edit: true });
    expect(parseDevArgs(["--project", "p", "--scene", "scenes/a.scene.json", "--port", "5300", "--view"])).toEqual({
      project: "p",
      scene: "scenes/a.scene.json",
      port: 5300,
      edit: false,
    });
    expect(parseDevArgs(["p"])).toEqual({ project: "p", edit: true });
    for (const argv of [["--port", "0"], ["--port", "70000"], ["--port", "1.5"], ["a", "b"], ["--open"]]) {
      expect(parseDevArgs(argv)).toBeNull();
    }
  });

  test("the server name, the project variable and the page URL", () => {
    expect(serverName("Demo_Scene")).toBe("demo-scene");
    expect(serverName("__")).toBe("project");
    expect(projectsValue(undefined, "demo", "/tmp/demo")).toBe("demo=/tmp/demo");
    expect(projectsValue("a=/x,demo=/old", "demo", "/tmp/demo")).toBe("a=/x,demo=/tmp/demo");
    expect(scenePageUrl("http://127.0.0.1:5176/", "demo", { edit: true })).toBe(
      "http://127.0.0.1:5176/scene.html?project=demo&edit=1",
    );
    expect(scenePageUrl("http://h:1", "demo", { edit: false, scene: "scenes/b.scene.json" })).toBe(
      "http://h:1/scene.html?project=demo&scene=scenes%2Fb.scene.json",
    );
  });
});

describe("scenity sheet and clip: the arguments", () => {
  test("the times of a sheet", () => {
    expect(sheetTimes({})).toEqual([]);
    expect(sheetTimes({ times: "0,500,1000" })).toEqual([0, 500, 1000]);
    expect(sheetTimes({ from: "1000", to: "2000", step: "250" })).toEqual([1000, 1250, 1500, 1750, 2000]);
    expect(sheetTimes({ from: "0", to: "700" })).toEqual([0, 100, 200, 300, 400, 500, 600, 700]);
    for (const values of [{ times: "a" }, { times: "-1" }, { from: "5", to: "1" }, { step: "10" }, { to: "x" }]) {
      expect(sheetTimes(values)).toBeNull();
    }
  });

  test("the options of a sheet", () => {
    const parsed = parseSheetArgs([
      "p",
      "--camera",
      "front,top",
      "--times",
      "0,100",
      "--format",
      "jpeg",
      "--worker",
      "0",
    ]);
    expect(parsed?.options).toMatchObject({
      dir: "p",
      cameras: ["front", "top"],
      times: [0, 100],
      format: "jpeg",
      worker: false,
      cell: 400,
      maxWidth: 1600,
      build: false,
    });
    expect(parseSheetArgs(["--project", "p", "q"])).toBeNull();
    expect(parseSheetArgs(["--backend", "metal"])).toBeNull();
    expect(parseSheetArgs(["--size", "big"])).toBeNull();
  });

  test("the layout of the lab sheet", () => {
    expect(sheetColumns(10, 1)).toBe(4);
    expect(sheetColumns(2, 1)).toBe(2);
    expect(sheetColumns(5, 3)).toBe(3);
    expect(cellWidth(4)).toBe(395);
    expect(cellWidth(1)).toBe(400);
    expect(cellLabel(500, "front")).toBe("500 ms · front");
    expect(cellLabel(null, null)).toBe("scene camera");
  });

  test("the options and the frame times of a clip", () => {
    const parsed = parseClipArgs([
      "--from",
      "1000",
      "--to",
      "2000",
      "--fps",
      "10",
      "--camera",
      "front",
      "--size",
      "320x200",
    ]);
    expect(parsed?.options).toMatchObject({ dir: ".", from: 1000, to: 2000, fps: 10, camera: "front" });
    expect(parsed?.options.size).toEqual({ width: 320, height: 200 });
    for (const argv of [
      [],
      ["--from", "5"],
      ["--from", "5", "--to", "1"],
      ["--from", "0", "--to", "1", "--fps", "0"],
    ]) {
      expect(parseClipArgs(argv)).toBeNull();
    }
    expect(clipTimes(1000, 1500, 4)).toEqual([1000, 1250, 1500]);
    expect(clipTimes(0, 100, 12)).toEqual([0, 83]);
    expect(clipTimes(0, 10_000_000, 60)).toHaveLength(MAX_FRAMES);
  });
});

describe("scenity verify, pool and assets", () => {
  test("verify takes a project, --no-shots and --lock", () => {
    expect(parseVerifyArgs([])).toEqual({ shots: true });
    expect(parseVerifyArgs(["p", "--no-shots", "--lock", "l"])).toEqual({ project: "p", shots: false, lock: "l" });
    expect(parseVerifyArgs(["--project", "p", "q"])).toBeNull();
  });

  test("the baselines of a project: a scene of the project and a camera", () => {
    const dir = project("baselines", [], ["scenes/main.scene.json"]);
    for (const name of ["main--front.png", "main--scene.png", "other--front.png", "main.png", "notes.txt"]) {
      put(join(dir, "baselines", "linux", name), "");
    }
    expect(projectBaselines(dir, ["scenes/main.scene.json"], "linux")).toEqual([
      { scene: "scenes/main.scene.json", camera: "front", file: join(dir, "baselines/linux/main--front.png") },
      { scene: "scenes/main.scene.json", camera: null, file: join(dir, "baselines/linux/main--scene.png") },
    ]);
    expect(projectBaselines(dir, ["scenes/main.scene.json"], "win32")).toEqual([]);
  });

  test("pool takes start, status or stop, the pages and the lock", async () => {
    expect(parsePoolArgs([])).toEqual({ action: "start", pages: 2, json: false });
    expect(parsePoolArgs(["status", "--json"])).toEqual({ action: "status", pages: 2, json: true });
    expect(parsePoolArgs(["start", "--pages", "3", "--lock", "l"])).toEqual({
      action: "start",
      pages: 3,
      lock: "l",
      json: false,
    });
    for (const argv of [["go"], ["start", "stop"], ["--pages", "0"], ["--pages", "1.5"], ["--pages", "9"]]) {
      expect(parsePoolArgs(argv)).toBeNull();
    }
    expect((await runPoolCommand(["a", "b"])).code).toBe(2);
  });

  test("pool status and stop without a pool exit 1", async () => {
    const before = process.env.SCENITY_SCENE_POOL_DIR;
    process.env.SCENITY_SCENE_POOL_DIR = join(temp, "no-pool");
    try {
      const status = await runPoolCommand(["status"]);
      expect(status.code).toBe(1);
      expect(status.out[0]).toContain("no scene pool runs");
      expect((await runPoolCommand(["stop"])).code).toBe(1);
    } finally {
      if (before === undefined) delete process.env.SCENITY_SCENE_POOL_DIR;
      else process.env.SCENITY_SCENE_POOL_DIR = before;
    }
  });

  test("assets puts the project folder first when a plain word is missing", () => {
    const dir = () => "/p";
    expect(assetArgs(["build", "--check"], dir)).toEqual(["build", "/p", "--check"]);
    expect(assetArgs(["build", "other", "--json"], dir)).toEqual(["build", "other", "--json"]);
    expect(assetArgs(["import", "a.glb", "--kind", "model"], dir)).toEqual([
      "import",
      "/p",
      "a.glb",
      "--kind",
      "model",
    ]);
    expect(assetArgs(["export", "scenes/a.scene.json", "--out", "a.glb"], dir)).toEqual([
      "export",
      "/p",
      "scenes/a.scene.json",
      "--out",
      "a.glb",
    ]);
    expect(assetArgs(["release-check", "--project", "q"], dir)).toEqual(["release-check", "q"]);
    expect(assetArgs(["new-id"], dir)).toEqual(["new-id"]);
    for (const argv of [[], ["nope"], ["import"], ["build", "a", "b"], ["new-id", "x"], ["build", "--out"]]) {
      expect(assetArgs(argv, dir)).toBeNull();
    }
  });
});

describe("scenity: the project of a command and the plugin commands", () => {
  test("the project folder: --project, the work folder, the scenity.project field", () => {
    const dir = project("own");
    expect(commandProjectDir(undefined, dir)).toBe(dir);
    expect(commandProjectDir("own", temp)).toBe(dir);
    const host = join(temp, "host");
    put(join(host, "package.json"), JSON.stringify({ name: "host", scenity: { project: "../own" } }));
    expect(commandProjectDir(undefined, host)).toBe(dir);
    expect(() => commandProjectDir("missing", temp)).toThrow(CommandSetupError);
    expect(checkoutRoot()).toBe(ROOT);
  });

  test("the editor of scenity dev: the app of the checkout, else the installed package", () => {
    expect(editorAppDir(temp)).toBe(join(ROOT, "apps/editor"));
    expect(installedEditorDir([project("bare")])).toBeNull();
    const dir = project("installed");
    const editor = join(dir, "node_modules/@scenity/editor");
    const manifest = { name: "@scenity/editor", exports: { "./package.json": "./package.json" } };
    put(join(editor, "package.json"), JSON.stringify(manifest));
    put(join(editor, SCENE_CONFIG), "export default {};\n");
    expect(installedEditorDir([join(temp, "nowhere"), dir])).toBe(realpathSync(editor));
  });

  test("a plugin gives a command through its cli face; a command of the CLI wins", async () => {
    const dir = project("tools", ["./plugins/tools"]);
    put(join(dir, "plugins/tools/package.json"), JSON.stringify({ name: "tools", scenity: { cli: "./cli.ts" } }));
    put(
      join(dir, "plugins/tools/cli.ts"),
      [
        "export default { commands: [",
        '  { name: "hello", summary: "say hello", run: (argv, context) => (argv[0] === "fail" ? 3 : context.project.length > 0 ? 0 : 1) },',
        '  { name: "build", summary: "a second build", run: () => 9 },',
        "] };",
      ].join("\n"),
    );
    const names = new Set(COMMANDS.map((entry) => entry.name));
    const commands = await pluginCommands(dir, ["./plugins/tools"], names);
    expect(commands.map((entry) => [entry.name, entry.plugin])).toEqual([["hello", "./plugins/tools"]]);
    expect((await run(["hello", "--project", dir])).code).toBe(0);
    expect((await run(["hello", "fail", "--project", dir])).code).toBe(3);
    const help = await run(["hello", "--help", "--project", dir]);
    expect(help.out).toEqual(["scenity hello: say hello"]);
    const list = await run(["--help", "--project", dir]);
    expect(list.out.at(-1)).toBe("  hello    say hello");
  });

  test("a face that does not load is a problem, not an exception", async () => {
    const dir = project("broken", ["./plugins/bad"]);
    put(join(dir, "plugins/bad/package.json"), JSON.stringify({ name: "bad", scenity: { cli: "./cli.ts" } }));
    put(join(dir, "plugins/bad/cli.ts"), "export default { commands: 3 };\n");
    const found = await projectCommands(["--project", dir], new Set());
    expect(found.commands).toEqual([]);
    expect(found.problems[0]).toContain("no default export");
  });

  test("the checkout has no default project, so it gives no plugin command", async () => {
    const found = await projectCommands([], new Set(COMMANDS.map((entry) => entry.name)), ROOT);
    expect(found.commands).toEqual([]);
    expect(found.problems).toEqual([]);
  });
});
