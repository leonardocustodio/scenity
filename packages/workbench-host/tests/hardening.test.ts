// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the hardening of the host:
 *
 * - every path of the server except `/health` needs the token (a walk over every route);
 * - a crash of the lab dev server: the surface goes to `failed` and starts again one time after a wait. After a
 *   second crash, it stays `failed` until the owner starts it again;
 * - `host.restart` without a supervisor fails with a reason.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startHost, type Host } from "../src/host";
import { HOOK_EVENTS, HOST_PATHS, TOKEN_HEADER, type HostEvent, type ServerStatus } from "../src/protocol";
import { workbenchTools } from "../src/tools/index";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir, until } from "./helpers";
import { ciWaitMs, scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const TOKEN = "3c".repeat(32);
const folders: string[] = [];
let host: Host;

beforeAll(async () => {
  const { parent, repo } = await makeRepo();
  const state = tempDir("hard-state");
  folders.push(parent, state);
  host = await startHost({
    checkout: repo,
    stateDir: state,
    token: TOKEN,
    serverCommand: fakeCommand,
    devServer: { backoffMs: 150, pollMs: 50 },
    reap: false,
  });
});

afterAll(async () => {
  await host.stop();
  cleanup(...folders);
});

/** Every route of the host: the fixed paths, each hook, each tool, the run files and the loop hooks. */
function routes(): { method: string; path: string }[] {
  const posts = [
    ...HOOK_EVENTS.map((event) => `${HOST_PATHS.hooks}${event}`),
    ...workbenchTools().map((tool) => `${HOST_PATHS.tools}${tool.name}`),
    "/loops/loop-1/hooks/Stop",
    "/loops/loop-1/hooks/PreToolUse",
  ];
  const gets = [HOST_PATHS.context, `${HOST_PATHS.context}?surface=web`, "/runs/r1/file?path=a.png", "/", "/nope"];
  return [
    ...posts.map((path) => ({ method: "POST", path })),
    ...gets.map((path) => ({ method: "GET", path })),
    { method: "GET", path: "/ws" },
    { method: "GET", path: "/ws?token=wrong" },
  ];
}

describe("the token on every path", () => {
  test("each route without the token or with a wrong token gives 401; /health needs none", async () => {
    const { origin } = host.endpoint;
    expect((await fetch(`${origin}${HOST_PATHS.health}`)).status).toBe(200);
    for (const { method, path } of routes()) {
      const bare = await fetch(`${origin}${path}`, { method, body: method === "POST" ? "{}" : null });
      expect([method, path, bare.status]).toEqual([method, path, 401]);
      const wrong = await fetch(`${origin}${path}`, {
        method,
        headers: { [TOKEN_HEADER]: "0".repeat(64) },
        body: method === "POST" ? "{}" : null,
      });
      expect([method, path, wrong.status]).toEqual([method, path, 401]);
    }
  });

  test("with the token the routes answer (not 401), and a preflight of another origin gives 403", async () => {
    const { origin } = host.endpoint;
    const answer = await fetch(`${origin}${HOST_PATHS.hooks}SessionEnd`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: TOKEN },
      body: "{}",
    });
    expect(answer.status).toBe(200);
    const preflight = await fetch(`${origin}${HOST_PATHS.context}`, {
      method: "OPTIONS",
      headers: { origin: "http://evil.example" },
    });
    expect(preflight.status).toBe(403);
  });
});

/** The statuses of the lab server in the `surface.state` events of a page. */
function statuses(page: FakePage): ServerStatus[] {
  return page.events
    .filter((event): event is HostEvent<"surface.state"> => event.type === "surface.state")
    .filter((event) => event.surface.id === "lab")
    .map((event) => event.surface.server.status);
}

describe("a crash of the dev server", () => {
  test(
    "failed, then ready by itself once; failed after the second crash until the restart",
    async () => {
      const page = await FakePage.open(host.endpoint);
      const lab = host.servers.ensure(host.current());
      await until(() => lab.info.status === "ready", 10_000, "the lab server");
      const firstPid = lab.pid ?? 0;
      process.kill(-firstPid, "SIGKILL");
      await until(() => statuses(page).includes("failed"), 5_000, "the failed state");
      await until(() => lab.info.status === "ready" && lab.pid !== firstPid, 10_000, "the automatic restart");
      expect(lab.log.lines().some((line) => line.includes("automatic restart 1"))).toBe(true);

      const secondPid = lab.pid ?? 0;
      page.events.length = 0;
      process.kill(-secondPid, "SIGKILL");
      await until(() => statuses(page).includes("failed"), 5_000, "the second failed state");
      await Bun.sleep(600);
      expect(lab.info.status).toBe("failed");
      expect(host.surfaces.state("lab").server.error).toContain("signal SIGKILL");

      // The Restart button of the page opens the checkout again.
      await page.call("checkouts.open", { path: host.current() });
      await until(() => lab.info.status === "ready", 10_000, "the restart by the owner");
      page.close();
    },
    ciWaitMs(40_000),
  );
});

describe("host.restart without a supervisor", () => {
  test("fails with a reason", async () => {
    const page = await FakePage.open(host.endpoint);
    const answer = await page.request("host.restart");
    expect(answer.ok ? "" : answer.error).toContain("without its supervisor");
    page.close();
  });
});
