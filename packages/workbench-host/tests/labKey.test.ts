// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the per-process secret of the lab servers of the host. Each lab server gets a new secret, and no child
 * inherits one. The frame URL carries it, so the frame skips the sign-in of the lab page. The host keeps, saves and
 * shows the URL without it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LAB_KEY_ENV } from "@scenity/labs-platform/labKey";
import { startHost, type Host } from "../src/host";
import { childEnv, labCommand, type CommandFactory } from "../src/servers";
import { shownUrl } from "../src/tools/kit";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const KEY = "7e".repeat(32);
const folders: string[] = [];
let host: Host;
let page: FakePage;

/** The fake dev server with a secret, as `labCommand` gives one. */
const keyedCommand: CommandFactory = (checkout, port) => {
  const command = fakeCommand(checkout, port);
  return { ...command, env: { ...command.env, [LAB_KEY_ENV]: KEY } };
};

beforeAll(async () => {
  const { parent, repo } = await makeRepo();
  const state = tempDir("key-state");
  folders.push(parent, state);
  host = await startHost({ checkout: repo, stateDir: state, serverCommand: keyedCommand, reap: false, watch: false });
  page = await FakePage.open(host.endpoint);
  await page.call("host.hello", { origin: "http://127.0.0.1:5999" });
  await until(() => host.surfaces.state("lab").url !== null, 10_000, "the lab server");
});

afterAll(async () => {
  page.close();
  await host.stop();
  cleanup(...folders);
});

describe("the secret of a lab server", () => {
  test("each lab command has a new secret, and no child inherits one", () => {
    const first = labCommand("/repo", 5400).env[LAB_KEY_ENV];
    const second = labCommand("/repo", 5401).env[LAB_KEY_ENV];
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    process.env[LAB_KEY_ENV] = KEY;
    try {
      expect(childEnv()[LAB_KEY_ENV]).toBeUndefined();
    } finally {
      Reflect.deleteProperty(process.env, LAB_KEY_ENV);
    }
  });

  test("the frame URL carries the secret; the kept and shown URLs do not", async () => {
    const url = new URL(host.surfaces.state("lab").url ?? "");
    expect(url.searchParams.get("labsKey")).toBe(KEY);
    url.searchParams.set("take", "greet");
    const event = { workbench: 1, event: "url", url: url.toString() };
    await page.call("surface.report", { surface: "lab", where: "visible", event });
    const shown = new URL(host.surfaces.state("lab").url ?? "");
    expect(shown.searchParams.get("take")).toBe("greet");
    expect(shown.searchParams.getAll("labsKey")).toEqual([KEY]);
    await host.stop();
    const saved = host.state.surfaceUrls(host.current()).lab ?? "";
    expect(saved).toContain("take=greet");
    expect(saved).not.toContain(KEY);
    expect(shownUrl(url.toString())).not.toContain("labsKey");
  });
});
