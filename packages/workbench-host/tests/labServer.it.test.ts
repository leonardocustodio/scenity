// SPDX-License-Identifier: Apache-2.0
/**
 * The integration test of the lab dev server: the real Vite server of apps/editor of this
 * checkout starts on a free port, with HMR on, and answers. It takes some seconds, so it runs only with
 * `WORKBENCH_IT=1 bun test ./packages/workbench-host`.
 */
import { describe, expect, test } from "bun:test";
import { worktreeRoot } from "../src/checkouts";
import { DevServer, labCommand } from "../src/servers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const ENABLED = process.env.WORKBENCH_IT === "1";

describe("the lab dev server of this checkout", () => {
  test.skipIf(!ENABLED)(
    "Vite of apps/editor starts, serves the lab page and stops",
    async () => {
      const checkout = await worktreeRoot(import.meta.dir);
      const server = new DevServer({ checkout, kind: "lab", command: labCommand });
      await server.start();
      try {
        expect(server.info.status).toBe("ready");
        const page = await (await fetch(`${server.info.origin ?? ""}/`)).text();
        expect(page).toContain("<div id=");
        // HMR is on: the Vite client is in the page.
        expect(page).toContain("/@vite/client");
      } finally {
        await server.stop();
      }
      expect(server.info.status).toBe("stopped");
    },
    120_000,
  );
});
