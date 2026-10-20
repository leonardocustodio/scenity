// SPDX-License-Identifier: Apache-2.0
/**
 * The global setup of the workbench end-to-end tests. It takes the GPU lock of the lab tools (one WebGL user at a
 * time). It starts the host in test mode on this checkout (its lab dev server starts with it) and the Vite server of
 * the workbench page. It gives both to the tests in `E2E_ENV`. The teardown stops them and releases the lock.
 */
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gpuLock } from "../../../editor/scripts/lab/gpuLock";
import { E2E_ENV, savedLabQuery, type E2eSetup } from "./env";
import { CHECKOUT, startPageServer, startTestHost, stopChild } from "./processes";

/**
 * The saved lab URL: stopped at 6 s, with the render worker. It has the tier of `labs shot` (high) and no adaptive
 * quality, so a capture through the bridge compares with `labs shot` of the same frame. The take comes from the project
 * of the lab plugin (`LAB_QUERY_ENV` of env.ts). This checkout has no lab plugin.
 */
const LAB_QUERY = savedLabQuery();

export default async function globalSetup(): Promise<() => Promise<void>> {
  const release = await gpuLock({ log: (text) => console.error(`workbench e2e: ${text}`) });
  const state = mkdtempSync(join(tmpdir(), "workbench-e2e-state-"));
  const children: ChildProcess[] = [];
  const teardown = async (): Promise<void> => {
    await Promise.all(children.map(stopChild));
    rmSync(state, { recursive: true, force: true });
    release();
  };
  try {
    const host = await startTestHost({ state, labQuery: LAB_QUERY }, children);
    const page = await startPageServer(children);
    const setup: E2eSetup = { host: host.endpoint, page: page.origin, checkout: CHECKOUT, state };
    process.env[E2E_ENV] = JSON.stringify(setup);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
