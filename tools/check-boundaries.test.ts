// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkBoundaries, findManifests, type Problem } from "./check-boundaries";

let roots: string[] = [];

/** Make a workspace in a temporary folder from a map of package.json paths and their contents. */
function workspace(manifests: Record<string, object>): string {
  const root = mkdtempSync(join(tmpdir(), "check-boundaries-"));
  roots.push(root);
  for (const [path, manifest] of Object.entries(manifests)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(manifest));
  }
  return root;
}

afterEach(() => {
  roots.forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  });
  roots = [];
});

function rules(problems: readonly Problem[]): string[] {
  return problems.map((problem) => `${problem.path}:${problem.rule}`);
}

/** The packages of the 3D room as the workspace has them. */
const GOOD = {
  "package.json": { name: "scenity", workspaces: { packages: ["apps/*", "packages/*"] } },
  "apps/editor/package.json": {
    name: "@scenity/editor",
    dependencies: { "@scenity/room3d": "workspace:*", "@scenity/room3d-labs": "workspace:*" },
  },
  "apps/player/package.json": {
    name: "@scenity/player",
    dependencies: { "@scenity/room3d": "workspace:*", "@scenity/room3d-view": "workspace:*" },
  },
  "packages/room3d/package.json": { name: "@scenity/room3d", dependencies: { three: "catalog:" } },
  "packages/room3d-labs/package.json": {
    name: "@scenity/room3d-labs",
    dependencies: { "@scenity/room3d": "workspace:*" },
  },
  "packages/room3d-view/package.json": {
    name: "@scenity/room3d-view",
    dependencies: { "@scenity/room3d": "workspace:*" },
  },
  // The labs workbench: the page uses the host package.
  "apps/workbench/package.json": {
    name: "@scenity/workbench",
    dependencies: { "@scenity/workbench-host": "workspace:*" },
  },
  "packages/workbench-host/package.json": { name: "@scenity/workbench-host", dependencies: { zod: "4.6.5" } },
};

describe("findManifests", () => {
  test("finds the root and each package folder", () => {
    const root = workspace({ ...GOOD, "apps/player/node_modules/x/package.json": { name: "x" } });
    expect(findManifests(root)).toEqual([
      "apps/editor/package.json",
      "apps/player/package.json",
      "apps/workbench/package.json",
      "package.json",
      "packages/room3d-labs/package.json",
      "packages/room3d-view/package.json",
      "packages/room3d/package.json",
      "packages/workbench-host/package.json",
    ]);
  });
});

describe("checkBoundaries", () => {
  test("passes the workspace layout of the 3D room", () => {
    expect(checkBoundaries(workspace(GOOD))).toEqual([]);
  });

  test("passes the real workspace", () => {
    expect(checkBoundaries()).toEqual([]);
  });

  test("fails a package that depends on the dev tools", () => {
    const root = workspace({
      ...GOOD,
      "apps/player/package.json": {
        name: "@scenity/player",
        devDependencies: { "@scenity/runtime-dev": "workspace:*" },
      },
      "packages/room3d-view/package.json": {
        name: "@scenity/room3d-view",
        peerDependencies: { "@scenity/runtime-dev": "*" },
      },
    });
    const problems = checkBoundaries(root);
    expect(rules(problems)).toEqual([
      "apps/player/package.json:labs-sdk",
      "packages/room3d-view/package.json:labs-sdk",
    ]);
    expect(problems[0]?.message).toContain("@scenity/player depends on @scenity/runtime-dev (packages/runtime-dev).");
  });

  test("fails a package that depends on the labs app, by name or by path", () => {
    const root = workspace({
      ...GOOD,
      "package.json": { name: "scenity", devDependencies: { "@scenity/editor": "workspace:*" } },
      "packages/room3d/package.json": { name: "@scenity/room3d", dependencies: { lab: "file:../../apps/editor" } },
      "packages/room3d-labs/package.json": {
        name: "@scenity/room3d-labs",
        dependencies: { "@scenity/editor": "workspace:*" },
      },
    });
    expect(rules(checkBoundaries(root))).toEqual([
      "package.json:labs-app",
      "packages/room3d-labs/package.json:labs-app",
      "packages/room3d/package.json:labs-app",
    ]);
  });

  test("fails a package that depends on the workbench page", () => {
    const root = workspace({
      ...GOOD,
      "apps/editor/package.json": { name: "@scenity/editor", devDependencies: { "@scenity/workbench": "workspace:*" } },
      "packages/workbench-host/package.json": {
        name: "@scenity/workbench-host",
        dependencies: { page: "workspace:../../apps/workbench" },
      },
    });
    const problems = checkBoundaries(root);
    expect(rules(problems)).toEqual([
      "apps/editor/package.json:workbench-app",
      "packages/workbench-host/package.json:workbench-app",
    ]);
    expect(problems[0]?.message).toContain("@scenity/editor depends on @scenity/workbench (apps/workbench).");
  });

  test("fails a package other than the workbench page that depends on the workbench host", () => {
    const root = workspace({
      ...GOOD,
      "apps/player/package.json": {
        name: "@scenity/player",
        dependencies: { "@scenity/workbench-host": "workspace:*" },
      },
      "apps/editor/package.json": {
        name: "@scenity/editor",
        devDependencies: { host: "link:../../packages/workbench-host" },
      },
      "packages/room3d-labs/package.json": {
        name: "@scenity/room3d-labs",
        peerDependencies: { "@scenity/workbench-host": "*" },
      },
    });
    expect(rules(checkBoundaries(root))).toEqual([
      "apps/editor/package.json:workbench-host",
      "apps/player/package.json:workbench-host",
      "packages/room3d-labs/package.json:workbench-host",
    ]);
  });

  test("passes the lab page and the workbench page on the platform capabilities", () => {
    const root = workspace({
      ...GOOD,
      "apps/editor/package.json": {
        name: "@scenity/editor",
        dependencies: { "@scenity/labs-platform": "workspace:*" },
      },
      "apps/workbench/package.json": {
        name: "@scenity/workbench",
        dependencies: { "@scenity/labs-platform": "workspace:*" },
      },
      "packages/labs-platform/package.json": { name: "@scenity/labs-platform" },
    });
    expect(checkBoundaries(root)).toEqual([]);
  });

  test("fails the learner app and the runtime on the platform capabilities", () => {
    const root = workspace({
      ...GOOD,
      "apps/player/package.json": {
        name: "@scenity/player",
        dependencies: { "@scenity/labs-platform": "workspace:*" },
      },
      "packages/room3d/package.json": {
        name: "@scenity/room3d",
        dependencies: { platform: "workspace:../labs-platform" },
      },
      "packages/room3d-view/package.json": {
        name: "@scenity/room3d-view",
        peerDependencies: { "@scenity/labs-platform": "*" },
      },
      "packages/labs-platform/package.json": { name: "@scenity/labs-platform" },
    });
    const problems = checkBoundaries(root);
    expect(rules(problems)).toEqual([
      "apps/player/package.json:labs-platform",
      "packages/room3d-view/package.json:labs-platform",
      "packages/room3d/package.json:labs-platform",
    ]);
    expect(problems[0]?.message).toContain(
      "@scenity/player depends on @scenity/labs-platform (packages/labs-platform).",
    );
  });
});

describe("the bridge contract", () => {
  test("passes the editor, the workbench page and the host on the bridge", () => {
    const bridge = { "@scenity/bridge": "workspace:*" };
    const root = workspace({
      ...GOOD,
      "apps/editor/package.json": { name: "@scenity/editor", dependencies: bridge },
      "apps/workbench/package.json": { name: "@scenity/workbench", dependencies: bridge },
      "packages/workbench-host/package.json": { name: "@scenity/workbench-host", dependencies: bridge },
      "packages/bridge/package.json": { name: "@scenity/bridge" },
      // The editor face and the host face of a plugin define and send its typed calls.
      "plugins/demo/editor/package.json": { name: "@scenity/demo-editor", dependencies: bridge },
      "plugins/demo/host/package.json": { name: "@scenity/demo-host", dependencies: bridge },
    });
    expect(checkBoundaries(root)).toEqual([]);
  });

  test("fails the player and the runtime on the bridge, and the bridge on another workspace package", () => {
    const root = workspace({
      ...GOOD,
      "apps/player/package.json": { name: "@scenity/player", dependencies: { "@scenity/bridge": "workspace:*" } },
      "packages/room3d/package.json": { name: "@scenity/room3d", dependencies: { b: "workspace:../bridge" } },
      "packages/bridge/package.json": { name: "@scenity/bridge", dependencies: { "@scenity/scene": "workspace:*" } },
      "plugins/demo/room/package.json": { name: "@scenity/demo-room", dependencies: { "@scenity/bridge": "*" } },
    });
    expect(rules(checkBoundaries(root))).toEqual([
      "apps/player/package.json:bridge",
      "packages/bridge/package.json:engine-layer",
      "packages/room3d/package.json:bridge",
      "plugins/demo/room/package.json:bridge",
    ]);
  });
});

describe("the layer rules of the engine packages", () => {
  test("passes an engine package on the packages of its layer", () => {
    const root = workspace({
      ...GOOD,
      "packages/scene/package.json": { name: "@scenity/scene", dependencies: { zod: "4.6.5" } },
      "packages/runtime/package.json": {
        name: "@scenity/runtime",
        dependencies: { "@scenity/scene": "workspace:*", three: "catalog:" },
      },
    });
    expect(checkBoundaries(root)).toEqual([]);
  });

  test("fails an engine package on a package outside its layer", () => {
    const root = workspace({
      ...GOOD,
      "packages/render/package.json": { name: "@scenity/render", dependencies: { "@scenity/scene": "workspace:*" } },
    });
    expect(rules(checkBoundaries(root))).toEqual(["packages/render/package.json:engine-layer"]);
  });

  test("fails an engine package on a plugin, by name or by path, and finds the parts of a plugin", () => {
    const root = workspace({
      ...GOOD,
      "packages/runtime/package.json": { name: "@scenity/runtime", dependencies: { "@scenity/demo-room": "*" } },
      "apps/workbench/package.json": {
        name: "@scenity/workbench",
        dependencies: { "@scenity/workbench-host": "workspace:*", room: "workspace:../../plugins/demo/room" },
      },
      "plugins/demo/room/package.json": { name: "@scenity/demo-room", dependencies: { "@scenity/runtime": "*" } },
    });
    expect(findManifests(root)).toContain("plugins/demo/room/package.json");
    expect(rules(checkBoundaries(root))).toEqual([
      "apps/workbench/package.json:no-plugin",
      "packages/runtime/package.json:no-plugin",
      "packages/runtime/package.json:engine-layer",
    ]);
  });

  test("fails an engine package on a name with the prefix of a plugin, also with no such part", () => {
    const root = workspace({
      ...GOOD,
      "plugins/demo/room/package.json": { name: "@scenity/demo-room" },
      "packages/scene/package.json": { name: "@scenity/scene", dependencies: { "@scenity/demo-gone": "*" } },
    });
    expect(rules(checkBoundaries(root))).toEqual([
      "packages/scene/package.json:no-plugin",
      "packages/scene/package.json:engine-layer",
    ]);
  });

  test("finds the parts of a group folder of a plugin and knows their names", () => {
    const root = workspace({
      ...GOOD,
      "plugins/demo/sdk/vue/package.json": { name: "@scenity/vue" },
      "plugins/demo/sdk/vue/node_modules/x/package.json": { name: "x" },
      "packages/runtime/package.json": { name: "@scenity/runtime", dependencies: { "@scenity/vue": "workspace:*" } },
    });
    expect(findManifests(root)).toContain("plugins/demo/sdk/vue/package.json");
    expect(findManifests(root)).not.toContain("plugins/demo/sdk/vue/node_modules/x/package.json");
    expect(rules(checkBoundaries(root))).toEqual([
      "packages/runtime/package.json:no-plugin",
      "packages/runtime/package.json:engine-layer",
    ]);
  });

  test("lets the editor use a plugin (PLUGIN_USERS)", () => {
    const root = workspace({
      ...GOOD,
      "apps/editor/package.json": { name: "@scenity/editor", dependencies: { "@scenity/demo-editor": "workspace:*" } },
    });
    expect(checkBoundaries(root)).toEqual([]);
  });
});

describe("the faces of a plugin (one rule set for each plugin)", () => {
  /** Two plugins with an editor, a host, a dev and a room part, on the packages that their faces may use. */
  const PLUGINS: Record<string, object> = {
    "packages/runtime-dev/package.json": { name: "@scenity/runtime-dev" },
    "packages/labs-platform/package.json": { name: "@scenity/labs-platform" },
    ...Object.fromEntries(
      ["demo", "other"].flatMap((plugin): [string, object][] => [
        [
          `plugins/${plugin}/editor/package.json`,
          {
            name: `@scenity/${plugin}-editor`,
            dependencies: {
              "@scenity/editor": "workspace:*",
              "@scenity/runtime-dev": "workspace:*",
              "@scenity/labs-platform": "workspace:*",
              [`@scenity/${plugin}-dev`]: "workspace:*",
            },
          },
        ],
        [
          `plugins/${plugin}/host/package.json`,
          { name: `@scenity/${plugin}-host`, dependencies: { "@scenity/workbench-host": "*" } },
        ],
        [
          `plugins/${plugin}/dev/package.json`,
          { name: `@scenity/${plugin}-dev`, dependencies: { "@scenity/runtime-dev": "*" } },
        ],
        [
          `plugins/${plugin}/room/package.json`,
          { name: `@scenity/${plugin}-room`, dependencies: { "@scenity/runtime": "*" } },
        ],
      ]),
    ),
  };

  test("passes the faces of each plugin on the packages of their face", () => {
    const root = workspace({
      ...GOOD,
      ...PLUGINS,
      "apps/editor/package.json": {
        name: "@scenity/editor",
        dependencies: { "@scenity/runtime-dev": "workspace:*", "@scenity/demo-dev": "workspace:*" },
      },
    });
    expect(checkBoundaries(root)).toEqual([]);
  });

  test("fails a part of a plugin on a package of another face", () => {
    const root = workspace({
      ...GOOD,
      ...PLUGINS,
      "plugins/demo/room/package.json": {
        name: "@scenity/demo-room",
        dependencies: { "@scenity/editor": "*", "@scenity/runtime-dev": "*", "@scenity/labs-platform": "*" },
      },
      "plugins/other/host/package.json": {
        name: "@scenity/other-host",
        dependencies: { "@scenity/workbench-host": "*", "@scenity/runtime-dev": "*" },
      },
      "plugins/other/dev/package.json": {
        name: "@scenity/other-dev",
        dependencies: { "@scenity/workbench-host": "*" },
      },
    });
    expect(rules(checkBoundaries(root))).toEqual([
      "plugins/demo/room/package.json:labs-app",
      "plugins/demo/room/package.json:labs-sdk",
      "plugins/demo/room/package.json:labs-platform",
      "plugins/other/dev/package.json:workbench-host",
      "plugins/other/host/package.json:labs-sdk",
    ]);
  });

  test("fails a package other than the editor and an editor face on the dev part of a plugin, by name or by path", () => {
    const root = workspace({
      ...GOOD,
      ...PLUGINS,
      "apps/player/package.json": { name: "@scenity/player", dependencies: { "@scenity/demo-dev": "workspace:*" } },
      "plugins/demo/room/package.json": {
        name: "@scenity/demo-room",
        dependencies: { dev: "workspace:../dev" },
      },
      "plugins/other/host/package.json": {
        name: "@scenity/other-host",
        dependencies: { "@scenity/workbench-host": "*", "@scenity/demo-dev": "*" },
      },
    });
    const problems = checkBoundaries(root).filter((problem) => problem.rule === "labs-sdk");
    expect(rules(problems)).toEqual([
      "apps/player/package.json:labs-sdk",
      "plugins/demo/room/package.json:labs-sdk",
      "plugins/other/host/package.json:labs-sdk",
    ]);
    expect(problems[0]?.message).toContain("@scenity/player depends on @scenity/demo-dev, the dev part of a plugin.");
  });

  test("applies the same rules to the parts of a plugin under another npm scope", () => {
    const root = workspace({
      ...GOOD,
      "packages/runtime-dev/package.json": { name: "@scenity/runtime-dev" },
      "plugins/demo/editor/package.json": {
        name: "@acme/demo-editor",
        dependencies: { "@scenity/editor": "workspace:*", "@acme/demo-dev": "workspace:*" },
      },
      "plugins/demo/dev/package.json": { name: "@acme/demo-dev", dependencies: { "@scenity/runtime-dev": "*" } },
      "plugins/demo/room/package.json": { name: "@acme/demo-room", dependencies: { "@acme/demo-dev": "*" } },
      // The prefix of a plugin with another scope marks a part that the workspace does not hold.
      "packages/scene/package.json": { name: "@scenity/scene", dependencies: { "@acme/demo-runtime": "*" } },
    });
    expect(rules(checkBoundaries(root))).toEqual([
      "packages/scene/package.json:no-plugin",
      "plugins/demo/room/package.json:labs-sdk",
    ]);
  });
});
