// SPDX-License-Identifier: Apache-2.0
/**
 * Fakes of the render pool tests: a lab build that writes two files, and a Playwright browser that records the page
 * loads, the contexts and the web lifecycle states.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "@playwright/test";
import type { LabBuilder } from "../../scripts/lab/pool/builtLab";
import type { PageSpec } from "../../scripts/lab/pool/pages";

export const SPEC: PageSpec = { take: "greet", tier: "high", worker: false, assets: true, width: 1280, height: 800 };

/** A build that writes `index.html` and one module; `failNext` makes the next build fail. */
export function fakeBuilder() {
  let count = 0;
  let fail = false;
  const build: LabBuilder = (outDir) => {
    count += 1;
    if (fail) {
      fail = false;
      return Promise.reject(new Error("fake build failed"));
    }
    mkdirSync(join(outDir, "assets"), { recursive: true });
    writeFileSync(join(outDir, "index.html"), `<!doctype html><title>built lab ${String(count)}</title>`);
    writeFileSync(join(outDir, "assets", "app.js"), "export {};");
    return Promise.resolve();
  };
  return { build, count: () => count, failNext: () => (fail = true) };
}

/** A browser whose pages record each `goto` and each web lifecycle state. */
export function fakeBrowser() {
  const record = { gotos: [] as string[], lifecycle: [] as string[], contexts: 0 };
  const page = () => ({
    goto: (url: string) => {
      record.gotos.push(url);
      return Promise.resolve(null);
    },
    waitForFunction: () => Promise.resolve(null),
    addStyleTag: () => Promise.resolve(null),
    on: () => undefined,
    off: () => undefined,
  });
  const browser = {
    isConnected: () => true,
    close: () => Promise.resolve(),
    newContext: () => {
      record.contexts += 1;
      return Promise.resolve({
        newPage: () => Promise.resolve(page()),
        newCDPSession: () =>
          Promise.resolve({
            send: (_method: string, params: { state: string }) => {
              record.lifecycle.push(params.state);
              return Promise.resolve({});
            },
          }),
        close: () => Promise.resolve(),
      });
    },
  };
  return {
    browser: browser as unknown as Browser,
    get gotos() {
      return record.gotos;
    },
    get lifecycle() {
      return record.lifecycle;
    },
    get contexts() {
      return record.contexts;
    },
  };
}
