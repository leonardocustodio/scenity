// SPDX-License-Identifier: Apache-2.0
// The pictures of the docs: the Hub, the new project dialog, the editor window and the Build workspace of Scenity
// Studio on a copy of the showroom. The spec writes JPEG files into `docs/pictures/`, so it runs only on request:
//   SCENITY_DOCS_PICTURES=1 bunx --bun playwright test docs-pictures --project=chromium --workers=1
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";

const REPO = join(LABS_ROOT, "..", "..");
const PICTURES = join(REPO, "docs", "pictures");
const READY = { timeout: 120_000 };

test.skip(process.env.SCENITY_DOCS_PICTURES !== "1", "the pictures of the docs are made on request");
test.skip(({ browserName }) => browserName !== "chromium", "the studio spec runs in Chromium");
test.use({ viewport: { width: 1440, height: 900 }, ...(process.platform === "darwin" ? { channel: "chromium" } : {}) });
test.describe.configure({ mode: "serial", timeout: 300_000 });

let dir = "";
let origin = "";
let secret = "";
let studio: ReturnType<typeof Bun.spawn> | null = null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** The rest of the first stdout line of a process that starts with `prefix`. */
async function readyLine(process: ReturnType<typeof Bun.spawn>, prefix: string): Promise<string> {
  const reader = (process.stdout as ReadableStream<Uint8Array>).getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the studio ended: ${text}`);
    text += new TextDecoder().decode(value);
    const line = text.split("\n").find((each) => each.startsWith(prefix));
    if (line !== undefined) return line.slice(prefix.length + 1);
  }
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium" || process.env.SCENITY_DOCS_PICTURES !== "1") return;
  // A short folder, so the paths in the pictures are easy to read.
  dir = "/tmp/scenity-docs";
  rmSync(dir, { recursive: true, force: true });
  for (const part of ["assets", "build", "rights", "scenes", "posters", "stills", "scenity.project.json"])
    cpSync(join(REPO, "samples/showroom", part), join(dir, "work/showroom", part), { recursive: true });
  mkdirSync(PICTURES, { recursive: true });
  const port = await freePort();
  origin = `http://127.0.0.1:${String(port)}`;
  const state = join(dir, "state");
  const main = join(REPO, "packages/studio-host/src/main.ts");
  studio = Bun.spawn(
    ["bun", main, "--port", String(port), "--state", state, "--root", join(dir, "work"), "--no-open"],
    {
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  await readyLine(studio, "SCENITY_STUDIO_READY");
  secret = (JSON.parse(readFileSync(join(state, "host.json"), "utf8")) as { secret: string }).secret;
});

test.afterAll(() => {
  studio?.kill("SIGTERM");
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Sign the page in with a new launch link (a launch code works once). */
async function signIn(page: Page): Promise<void> {
  const answer = await fetch(`${origin}/api/launch-code`, { method: "POST", headers: { "x-studio-token": secret } });
  await page.goto(((await answer.json()) as { url: string }).url);
  await expect(page.getByTestId("hub")).toBeVisible();
}

const picture = (page: Page, name: string): Promise<Buffer> =>
  page.screenshot({ path: join(PICTURES, `${name}.jpg`), type: "jpeg", quality: 80 });

test("the pictures of the docs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  await page.getByTestId("first-skip").click();
  // The Hub with the showroom in its list.
  const opened = await fetch(`${origin}/api/projects/open`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ dir: join(dir, "work/showroom") }),
  });
  const { url } = (await opened.json()) as { url: string };
  // The showroom runs code (its runs): trust the copy, so the pictures show no restricted mode.
  await fetch(`${origin}/api/projects/trust`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ key: "showroom" }),
  });
  await page.reload();
  await expect(page.getByTestId("hub")).toBeVisible();
  await page.waitForTimeout(1000);
  await picture(page, "studio-hub");
  await page.getByTestId("hub-new-project").click();
  await page.waitForTimeout(800);
  await picture(page, "studio-new-project");
  await page.keyboard.press("Escape");
  // The editor window on the showroom.
  await page.goto(`${origin}${url}`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.select?.(["armchair"]));
  await page.waitForTimeout(1000);
  await picture(page, "studio-editor");
  // The Build workspace with the Build panel.
  await page.getByTestId("workspace-build").click();
  await expect(page.getByTestId("dock-tab-build")).toBeVisible();
  await page.getByTestId("dock-tab-build").click();
  await page.waitForTimeout(1500);
  await picture(page, "studio-build");
  expect(errors).toEqual([]);
});
