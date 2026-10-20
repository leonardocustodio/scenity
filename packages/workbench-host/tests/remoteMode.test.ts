// SPDX-License-Identifier: Apache-2.0
/**
 * The host in the remote mode (remote.ts) refuses a shell terminal and a chat session in the mode "all"
 * (`bypassPermissions`). A host in the local mode allows both. The terminals run a small script, and the chat uses
 * the fake Agent SDK, so no test starts `claude` or calls a model.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { startHost, type Host } from "../src/host";
import type { TerminalOpened } from "../src/protocol";
import { REMOTE_BYPASS_REFUSED, REMOTE_SHELL_REFUSED, type RemoteSetup } from "../src/remote";
import { freePort } from "../src/servers";
import { fakeSdk } from "./fakeSdk";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const made: string[] = [];
afterAll(() => cleanup(...made));

/** Start a host on a new repository, in the remote mode when `remote` is given. */
async function host(
  remote: RemoteSetup | null,
): Promise<{ host: Host; page: FakePage; sdk: ReturnType<typeof fakeSdk> }> {
  const { parent, repo } = await makeRepo();
  const state = tempDir("remote-state");
  made.push(parent, state);
  const sdk = fakeSdk();
  const started = await startHost({
    checkout: repo,
    stateDir: state,
    serverCommand: fakeCommand,
    watch: false,
    remote,
    terminal: { program: () => ["/bin/sh", "-c", "cat"] },
    chat: { sdk, env: { PATH: process.env.PATH ?? "/usr/bin" } },
  });
  return { host: started, page: await FakePage.open(started.endpoint), sdk };
}

const TERMINAL = { cols: 80, rows: 24 };

describe("the remote mode", () => {
  test("refuses a shell terminal and the mode bypassPermissions", async () => {
    const remote = { publicOrigin: "https://scenity.example.org", labPort: await freePort(), labBase: "/s/abc123/" };
    const { host: started, page, sdk } = await host(remote);
    try {
      const shell = await page.request("terminal.open", { kind: "shell", ...TERMINAL });
      expect(shell).toMatchObject({ ok: false, error: REMOTE_SHELL_REFUSED });
      expect(started.terminals.ids()).toEqual([]);
      const claude = (await page.call("terminal.open", { kind: "claude", ...TERMINAL })) as TerminalOpened;
      expect(claude.kind).toBe("claude");

      const all = await page.request("agent.start", { mode: "bypassPermissions" });
      expect(all).toMatchObject({ ok: false, error: REMOTE_BYPASS_REFUSED });
      expect(sdk.queries).toHaveLength(0);
      const { session } = (await page.call("agent.start", { mode: "default", maxBudgetUsd: 1 })) as {
        session: string;
      };
      // A session with a budget never gets the flag of the mode "all" from the SDK, and cannot change to it.
      expect(sdk.queries[0]?.options.allowDangerouslySkipPermissions).toBe(false);
      const change = await page.request("agent.setMode", { session, mode: "bypassPermissions" });
      expect(change).toMatchObject({ ok: false, error: REMOTE_BYPASS_REFUSED });
      expect(await page.request("agent.setMode", { session, mode: "acceptEdits" })).toMatchObject({ ok: true });
    } finally {
      page.close();
      await started.stop();
    }
  });

  test("the local mode still allows a shell terminal and the mode bypassPermissions", async () => {
    const { host: started, page, sdk } = await host(null);
    try {
      const shell = (await page.call("terminal.open", { kind: "shell", ...TERMINAL })) as TerminalOpened;
      expect(shell.kind).toBe("shell");
      await page.call("agent.start", { mode: "bypassPermissions" });
      expect(sdk.queries[0]?.options.permissionMode).toBe("bypassPermissions");
      expect(sdk.queries[0]?.options.allowDangerouslySkipPermissions).toBe(true);
    } finally {
      page.close();
      await started.stop();
    }
  });
});
