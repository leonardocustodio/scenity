// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the setup of a new worktree: the steps of `startSetup`, and `checkouts.create` through a running host. The
 * new checkout is `preparing` while `bun install` and `bun run generate` run as the run `setup`. It does not open
 * before the end. A failed setup shows as `failed`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SETUP_LINE, startSetup } from "../src/checkoutSetup";
import { startHost, type Host } from "../src/host";
import { CHECKOUT_SETUP_LINE, isEventOf, type Checkout } from "../src/protocol";
import type { RunExit, RunSpawner, SpawnOptions } from "../src/runs";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

interface Started {
  readonly argv: readonly string[];
  readonly options: SpawnOptions;
  readonly signals: string[];
  end(code: number | null): void;
}

function fakeSpawner(): { spawn: RunSpawner; started: Started[] } {
  const started: Started[] = [];
  const spawn: RunSpawner = (argv, options) => {
    let end: (exit: RunExit) => void = () => undefined;
    const exited = new Promise<RunExit>((resolve) => (end = resolve));
    const signals: string[] = [];
    started.push({ argv, options, signals, end: (code) => end({ code, signal: null }) });
    return {
      exited,
      signal: (signal) => {
        signals.push(signal);
        end({ code: null, signal });
      },
    };
  };
  return { spawn, started };
}

describe("the steps of the setup", () => {
  test("install, then generate, in the repo root; the output and the steps go to the caller", async () => {
    expect(SETUP_LINE).toBe("bun install --frozen-lockfile && bun run generate");
    expect(CHECKOUT_SETUP_LINE).toBe(SETUP_LINE);
    const { spawn, started } = fakeSpawner();
    const output: string[] = [];
    const steps: string[] = [];
    const setup = startSetup("/w", {
      env: { PATH: "/bin" },
      spawn,
      bun: "/bin/bun",
      onOutput: (_stream, text) => output.push(text),
      onStep: (step) => steps.push(step.join(" ")),
    });
    await until(() => started.length === 1);
    expect(started[0]?.argv).toEqual(["/bin/bun", "install", "--frozen-lockfile"]);
    expect(started[0]?.options.cwd).toBe(join("/w", "."));
    started[0]?.end(0);
    await until(() => started.length === 2);
    expect(started[1]?.argv).toEqual(["/bin/bun", "run", "generate"]);
    started[1]?.end(0);
    expect(await setup.exited).toEqual({ code: 0, signal: null });
    expect(output).toEqual(["$ bun install --frozen-lockfile\n", "$ bun run generate\n"]);
    expect(steps).toEqual(["bun install --frozen-lockfile", "bun run generate"]);
  });

  test("a failed step ends the setup; a signal stops the step that runs and the next steps", async () => {
    const failing = fakeSpawner();
    const setup = startSetup("/w", { env: {}, spawn: failing.spawn, onOutput: () => undefined });
    await until(() => failing.started.length === 1);
    failing.started[0]?.end(1);
    expect((await setup.exited).code).toBe(1);
    expect(failing.started).toHaveLength(1);
    const stopped = fakeSpawner();
    const second = startSetup("/w", { env: {}, spawn: stopped.spawn, onOutput: () => undefined });
    await until(() => stopped.started.length === 1);
    second.signal("SIGINT");
    expect((await second.exited).code).toBeNull();
    expect(stopped.started[0]?.signals).toEqual(["SIGINT"]);
    expect(stopped.started).toHaveLength(1);
  });
});

describe("a worktree of the start screen", () => {
  const TOKEN = "55".repeat(32);
  const state = tempDir("setup-state");
  const { spawn, started } = fakeSpawner();
  let parent = "";
  let host: Host;
  let page: FakePage;

  beforeAll(async () => {
    ({ parent } = await makeRepo());
    const repo = join(parent, "repo");
    host = await startHost({
      checkout: repo,
      stateDir: state,
      token: TOKEN,
      serverCommand: fakeCommand,
      runSpawn: spawn,
    });
    page = await FakePage.open(host.endpoint);
    await page.call("host.hello", {});
  });
  afterAll(async () => {
    page.close();
    await host.stop();
    cleanup(parent, state);
  });

  async function setupOf(path: string): Promise<Checkout["setup"]> {
    const list = (await page.call("checkouts.list")) as Checkout[];
    return list.find((item) => item.path === path)?.setup;
  }

  /** Wait until the setup state of the checkout is the given one (the host updates it after `runs.done`). */
  async function setupBecomes(path: string, wanted: string | undefined): Promise<Checkout["setup"]> {
    let setup = await setupOf(path);
    for (let tries = 0; tries < 100 && setup?.state !== wanted; tries += 1) {
      await Bun.sleep(20);
      setup = await setupOf(path);
    }
    return setup;
  }

  test("is preparing while its setup run runs, opens after it, and shows a failed setup", async () => {
    const made = (await page.call("checkouts.create", { branch: "lc/new-work" })) as Checkout;
    expect(made.setup?.state).toBe("preparing");
    const run = made.setup!.run;
    await page.waitEvent((event) => isEventOf(event, "runs.output") && event.run === run);
    await until(() => started.length === 1);
    expect(started[0]?.argv.slice(1)).toEqual(["install", "--frozen-lockfile"]);
    expect(started[0]?.options.cwd).toBe(join(made.path, "."));
    expect((await setupOf(made.path))?.state).toBe("preparing");
    const refused = await page.request("checkouts.open", { path: made.path });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? "" : refused.error).toContain("still preparing");
    const listed = ((await page.call("runs.list")) as { run: string; command: string }[]).find((r) => r.run === run);
    expect(listed?.command).toBe("setup");

    started[0]?.end(0);
    await until(() => started.length === 2);
    started[1]?.end(0);
    await page.waitEvent((event) => isEventOf(event, "runs.done") && event.run === run && event.code === 0);
    expect(await setupBecomes(made.path, undefined)).toBeUndefined();
    const opened = (await page.call("checkouts.open", { path: made.path })) as { checkout: Checkout };
    expect(opened.checkout.path).toBe(made.path);

    const other = (await page.call("checkouts.create", { branch: "lc/broken" })) as Checkout;
    await until(() => started.length === 3);
    started[2]?.end(1);
    await page.waitEvent((event) => isEventOf(event, "runs.done") && event.run === other.setup?.run);
    expect(await setupBecomes(other.path, "failed")).toEqual({ state: "failed", run: other.setup!.run });
  });
});
