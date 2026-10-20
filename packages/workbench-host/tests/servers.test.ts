// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the dev servers against a fake command: the states, the log, a restart on a new port, a failure, one
 * server per checkout, and a stop that ends the whole process group. The real Vite server runs only in the
 * integration test (labServer.it.test.ts).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DevServer, DevServers, LogRing, childEnv, freePort, labCommand, labProjectEnv, labRoot } from "../src/servers";
import { TOKEN_ENV, type ServerStatus } from "../src/protocol";
import { cleanup, failingCommand, fakeCommand, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const dir = tempDir("servers");
afterAll(() => cleanup(dir));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function childPid(server: DevServer): number {
  const line = server.log.lines().find((text) => text.startsWith("fake child "));
  return Number(line?.slice("fake child ".length));
}

describe("the log ring", () => {
  test("it keeps the last lines and joins split lines", () => {
    const ring = new LogRing(3);
    ring.push("a\nb");
    ring.push("c\nd\n");
    ring.push("e\r\nf");
    // Three full lines stay; the open line "f" comes at the end.
    expect(ring.lines()).toEqual(["bc", "d", "e", "f"]);
    expect(ring.tail(1)).toBe("f");
  });
});

describe("the lab command", () => {
  test("it starts Vite of apps/editor of the checkout with HMR on", async () => {
    process.env.SCENITY_LAB_TOOLS = "1";
    process.env.SCENITY_WORKBENCH_TOKEN = "ab".repeat(32);
    const repo = join(dir, "lab-repo");
    mkdirSync(join(repo, "apps", "editor"), { recursive: true });
    const command = labCommand(repo, 5199);
    delete process.env.SCENITY_LAB_TOOLS;
    delete process.env.SCENITY_WORKBENCH_TOKEN;
    expect(command.cwd).toBe(join(repo, "apps", "editor"));
    expect(command.cmd.slice(1)).toEqual([
      "x",
      "--bun",
      "vite",
      "--port",
      "5199",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
    expect(command.env.SCENITY_LAB_TOOLS).toBeUndefined();
    expect(command.env[TOKEN_ENV]).toBeUndefined();
    expect(childEnv({ A: "1" }).A).toBe("1");
    expect(await freePort()).toBeGreaterThan(0);
  });

  test("a workspace with no labs app runs the labs app of the host source with its project", () => {
    const web = join(dir, "other-repo", "web");
    mkdirSync(join(web, "samples", "room"), { recursive: true });
    writeFileSync(join(web, "package.json"), JSON.stringify({ workspaces: [], scenity: { project: "samples/room" } }));
    const scenity = resolve(import.meta.dir, "..", "..", "..");
    expect(labRoot(web)).toBe(scenity);
    expect(labProjectEnv(web, {})).toEqual({ SCENITY_PROJECT: join(web, "samples", "room") });
    expect(labProjectEnv(web, { SCENITY_PROJECT: "/given" })).toEqual({});
    expect(labProjectEnv(scenity, {})).toEqual({});
    const saved = process.env.SCENITY_PROJECT;
    delete process.env.SCENITY_PROJECT;
    try {
      const command = labCommand(web, 5199);
      expect(command.cwd).toBe(join(scenity, "apps", "editor"));
      expect(command.env.SCENITY_PROJECT).toBe(join(web, "samples", "room"));
    } finally {
      if (saved !== undefined) process.env.SCENITY_PROJECT = saved;
    }
  });
});

describe("a dev server", () => {
  test("it starts, restarts on a new port and stops its process group", async () => {
    const server = new DevServer({ checkout: dir, kind: "lab", command: fakeCommand, pollMs: 50 });
    const seen: ServerStatus[] = [];
    server.onChange((info) => seen.push(info.status));
    await server.start();
    expect(server.info.status).toBe("ready");
    expect(await (await fetch(`${server.info.origin ?? ""}/`)).text()).toBe("fake lab");
    const firstPort = server.info.port;
    const grandchild = childPid(server);
    expect(alive(grandchild)).toBe(true);

    await server.restart();
    expect(server.info.status).toBe("ready");
    expect(server.info.port).not.toBe(firstPort);
    expect(alive(grandchild)).toBe(false);

    const pid = server.pid ?? 0;
    await server.stop();
    expect(server.info).toEqual({ status: "stopped", port: null, origin: null, frameOrigin: null, error: null });
    expect(alive(pid)).toBe(false);
    expect(seen).toEqual(["starting", "ready", "stopped", "starting", "ready", "stopped"]);
  });

  test("a command that ends gives failed with the log", async () => {
    const server = new DevServer({ checkout: dir, kind: "lab", command: failingCommand, pollMs: 50 });
    await server.start();
    expect(server.info.status).toBe("failed");
    expect(server.info.error).toContain("code 3");
    expect(server.log.lines()).toContain("boom");
  });

  test("a folder that does not exist gives failed", async () => {
    const server = new DevServer({ checkout: `${dir}/absent`, kind: "lab", command: fakeCommand, pollMs: 50 });
    await server.start();
    expect(server.info.status).toBe("failed");
  });

  test("a server that does not answer in time gives failed and ends", async () => {
    const silent = () => ({
      cmd: ["sleep", "30"] as [string, string],
      cwd: dir,
      env: { PATH: process.env.PATH ?? "" },
    });
    const server = new DevServer({ checkout: dir, kind: "lab", command: silent, pollMs: 50, readyTimeoutMs: 300 });
    await server.start();
    expect(server.info.status).toBe("failed");
    expect(server.info.error).toContain("did not answer");
    expect(server.pid).toBeNull();
  });

  test("a stop during the start ends the start", async () => {
    const server = new DevServer({ checkout: dir, kind: "lab", command: fakeCommand, pollMs: 50 });
    const start = server.start();
    await server.stop();
    await start;
    expect(server.info.status).toBe("stopped");
    expect(server.pid).toBeNull();
  });
});

describe("the servers of the host", () => {
  test("a second checkout gets a second server, and stopAll ends every child", async () => {
    const other = tempDir("servers-b");
    const servers = new DevServers(
      (checkout, kind) => new DevServer({ checkout, kind, command: fakeCommand, pollMs: 50 }),
    );
    const a = servers.ensure(dir);
    const b = servers.ensure(other);
    expect(servers.ensure(dir)).toBe(a);
    await Promise.all([a.start(), b.start()]);
    expect(a.info.port).not.toBe(b.info.port);
    const pids = [a.pid ?? 0, b.pid ?? 0, childPid(a), childPid(b)];
    expect(pids.every(alive)).toBe(true);
    await servers.stopAll();
    expect(pids.some(alive)).toBe(false);
    cleanup(other);
  });
});
