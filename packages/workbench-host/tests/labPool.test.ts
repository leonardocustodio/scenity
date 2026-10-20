// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the render pool and the built lab in the host:
 * - the command of the pool process, and the build ID that the shadow asks for;
 * - the frame URLs of a surface with a built lab (the shadow on the built lab with its own secret, the visible frame
 *   only by the setting);
 * - the new shadow after a new build.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { LAB_KEY_ENV, LAB_KEY_PARAM } from "@scenity/labs-platform/labKey";
import { LabPool, LabPools, poolCommand, POOL_TOKEN_ENV, POOL_WORKER_TOKEN_ENV } from "../src/labPool";
import { BUILD_PARAM, ShadowFrames, type ShadowRegistry } from "../src/shadow";
import { DevServer, type CommandFactory } from "../src/servers";
import { SurfaceRegistry } from "../src/surfaces";
import { fakeCommand, tempDir, cleanup } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

scaleTestTimeouts();

const FAKE_POOL = join(import.meta.dir, "fixtures", "fakePool.ts");
const POOL_KEY = "c".repeat(43);
const DEV_KEY = "d".repeat(43);
const checkout = tempDir("pool-checkout");
const started: DevServer[] = [];

/** The fake pool process: the token and the secret that the host gives. */
const fakePool =
  (token: string): CommandFactory =>
  (dir, port) => ({
    cmd: [process.execPath, FAKE_POOL, String(port)],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "", [POOL_TOKEN_ENV]: token, [LAB_KEY_ENV]: POOL_KEY },
  });

afterAll(async () => {
  await Promise.all(started.map((server) => server.stop()));
  cleanup(checkout);
});

describe("the pool command", () => {
  test("runs the pool script of the checkout with its port, pages and state folder, a secret and the token", () => {
    const repo = join(tempDir("pool-repo"), "repo");
    mkdirSync(join(repo, "apps", "editor"), { recursive: true });
    const command = poolCommand(() => "/state/host", "t".repeat(64), 3)(repo, 4321);
    expect(command.cmd.slice(1)).toEqual([
      join(repo, "apps/editor/scripts/lab/pool/main.ts"),
      "--port",
      "4321",
      "--pages",
      "3",
      "--state",
      "/state/host",
    ]);
    expect(command.cwd).toBe(join(repo, "apps", "editor"));
    expect(command.env[POOL_TOKEN_ENV]).toBe("t".repeat(64));
    expect(command.env[LAB_KEY_ENV]?.length).toBeGreaterThan(20);
    // Without a worker token argument, the environment has no worker token. The pool of the host gets its own.
    expect(command.env[POOL_WORKER_TOKEN_ENV]).toBeUndefined();
    const withWorker = poolCommand(() => "/state/host", "t".repeat(64), 3, "w".repeat(64))(repo, 4321);
    expect(withWorker.env[POOL_WORKER_TOKEN_ENV]).toBe("w".repeat(64));
  });

  test("a host without pools has none", () => {
    expect(new LabPools(null).ensure("/repo")).toBeNull();
  });
});

describe("a surface with a built lab", () => {
  test("the shadow loads the built lab with its secret; the visible frame only by the setting", async () => {
    let visible = false;
    const pool = new LabPool(checkout, {
      stateDir: () => checkout,
      visible: () => visible,
      command: fakePool,
      devServer: { pollMs: 20 },
    });
    const dev = new DevServer({
      checkout,
      kind: "lab",
      pollMs: 20,
      command: (dir, port) => ({
        ...fakeCommand(dir, port),
        env: { ...fakeCommand(dir, port).env, [LAB_KEY_ENV]: DEV_KEY },
      }),
    });
    started.push(pool.server, dev);
    expect(await pool.fresh()).toBeNull();
    await Promise.all([pool.server.start(), dev.start()]);
    const registry = new SurfaceRegistry({ broadcast: () => undefined });
    const capabilities = ["scene", "index"];
    const def = { id: "lab", kind: "scene", label: "Lab", capabilities, checkout, savedUrl: null };
    registry.define({ ...def, server: dev, watcher: null, built: pool });
    registry.setShadow("lab", "http://127.0.0.1:1/?take=storm&panel=0&dock=0");
    const state = registry.state("lab");
    const shadow = new URL(state.shadowUrl ?? "");
    expect(shadow.origin).toBe(pool.server.info.origin ?? "");
    expect(shadow.searchParams.get(LAB_KEY_PARAM)).toBe(POOL_KEY);
    expect(shadow.searchParams.get("take")).toBe("storm");
    expect(new URL(state.url ?? "").origin).toBe(dev.info.origin ?? "");
    // The indexer window gets the worker paths of the pool: its origin and the worker token.
    expect(state.indexerWorker).toEqual({ origin: pool.server.info.origin ?? "", token: pool.workerToken });
    expect(pool.workerToken).toMatch(/^[0-9a-f]{64}$/);
    visible = true;
    const moved = new URL(registry.state("lab").url ?? "");
    expect(moved.origin).toBe(pool.server.info.origin ?? "");
    expect(moved.searchParams.get(LAB_KEY_PARAM)).toBe(POOL_KEY);
    // The build that the shadow asks for, with the token of the host.
    expect(await registry.shadowBuild("lab")).toBe("1");
    await pool.server.stop();
    expect(new URL(registry.state("lab").shadowUrl ?? "").origin).toBe(dev.info.origin ?? "");
    expect(registry.state("lab").indexerWorker).toBeNull();
    expect(await registry.shadowBuild("lab")).toBeNull();
    registry.close();
  });
});

describe("the shadow and the builds", () => {
  test("a new build replaces an idle shadow with a URL of the new build", async () => {
    let build: string | null = "1";
    const shadows: (string | null)[] = [];
    const registry: ShadowRegistry = {
      visibleUrl: () => "http://127.0.0.1:5400/?take=greet&t=100",
      setShadow: (_surface, url) => shadows.push(url),
      call: (_surface, call) => Promise.resolve({ call }),
      build: () => Promise.resolve(build),
    };
    const frames = new ShadowFrames({ registry, idleMs: 60_000 });
    const ready = { workbench: 1, event: "ready", url: "x" } as const;
    const first = frames.call("lab", "frame");
    await Bun.sleep(5);
    frames.onEvent("lab", "shadow", ready);
    await first;
    expect(new URL(shadows[0] ?? "").searchParams.get(BUILD_PARAM)).toBe("1");
    await frames.call("lab", "frame");
    expect(shadows).toHaveLength(1);
    build = "2";
    const second = frames.call("lab", "frame");
    await Bun.sleep(5);
    frames.onEvent("lab", "shadow", ready);
    await second;
    expect(shadows.at(-2)).toBeNull();
    expect(new URL(shadows.at(-1) ?? "").searchParams.get(BUILD_PARAM)).toBe("2");
    build = null;
    const third = frames.call("lab", "frame");
    await Bun.sleep(5);
    frames.onEvent("lab", "shadow", ready);
    await third;
    expect(new URL(shadows.at(-1) ?? "").searchParams.has(BUILD_PARAM)).toBe(false);
    frames.closeAll();
  });
});
