// SPDX-License-Identifier: Apache-2.0
// The first steps of a person through the Hub of Scenity Studio. The spec starts `scenity studio` with a fresh state
// and a root folder, signs in with the launch link, and skips the first run. It makes the project "demo" from the
// empty template with the wizard (a `create` job and a `git.init` job) and sees the editor draw it. Then it returns to
// the Hub and opens the project again from the list. A clone of that project over a file URL (the open dialog, "Clone
// from Git") opens in the editor too. The project saved as a template makes a second project from the wizard. The
// prompt box of Learn answers a question with a section of the docs and a tutorial, which starts in the project.
//   bunx --bun playwright test studio-hub --project=chromium --workers=1
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";

const REPO = join(LABS_ROOT, "..", "..");
test.describe.configure({ mode: "serial", timeout: 300_000 });

let dir = "";
let origin = "";
let launch = "";
let studio: ReturnType<typeof Bun.spawn> | null = null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function readyLine(process: ReturnType<typeof Bun.spawn>, prefix: string): Promise<string> {
  const reader = (process.stdout as ReadableStream<Uint8Array>).getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the studio ended: ${text}`);
    text += new TextDecoder().decode(value);
    const line = text.split("\n").find((l) => l.startsWith(prefix));
    if (line !== undefined) return line.slice(prefix.length + 1);
  }
}

/** Sign a new browser context in with a new launch code of the host (a code works once). */
async function signIn(page: Page): Promise<void> {
  const secret = (JSON.parse(readFileSync(join(dir, "state", "host.json"), "utf8")) as { secret: string }).secret;
  const answer = await fetch(`${origin}/api/launch-code`, { method: "POST", headers: { "x-studio-token": secret } });
  await page.goto(((await answer.json()) as { url: string }).url);
  await expect(page.getByTestId("hub")).toBeVisible();
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-studio-hub-"));
  mkdirSync(join(dir, "work"));
  const port = await freePort();
  origin = `http://127.0.0.1:${String(port)}`;
  studio = Bun.spawn(
    [
      "bun",
      join(REPO, "packages", "studio-host", "src", "main.ts"),
      "--port",
      String(port),
      "--state",
      join(dir, "state"),
      "--root",
      join(dir, "work"),
      "--no-open",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  launch = (JSON.parse(await readyLine(studio, "SCENITY_STUDIO_READY")) as { url: string }).url;
});

test.afterAll(() => {
  studio?.kill("SIGTERM");
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("make a project from the Hub, open it, go back and open it again", async ({ browserName, page }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(launch);
  await expect(page.getByTestId("hub")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
  // The first run comes once, on a fresh state.
  await expect(page.getByTestId("first-run")).toBeVisible();
  await page.getByTestId("first-skip").click();
  await expect(page.getByTestId("first-run")).toHaveCount(0);
  await expect(page.getByTestId("hub-projects-empty")).toBeVisible();

  await page.getByTestId("hub-new-project").click();
  await page.locator('[data-template="empty"]').click();
  await page.getByTestId("wizard-name").fill("demo");
  await expect(page.getByTestId("wizard-place")).toContainText("/work/demo");
  await page.getByTestId("wizard-make").click();
  await page.waitForURL(/[?&]project=demo&/, { timeout: 240_000 });
  await page.waitForSelector('canvas[data-ready="1"]', { timeout: 120_000 });
  expect(existsSync(join(dir, "work", "demo", "scenity.project.json"))).toBe(true);
  expect(existsSync(join(dir, "work", "demo", ".git"))).toBe(true);

  await page.goto(`${origin}/`);
  const card = page.locator('[data-project="demo"]');
  await expect(card).toBeVisible();
  await expect(page.getByTestId("first-run")).toHaveCount(0);
  // The Hub works at 1024×700: no sideways scroll, and the project and the main actions are in the window.
  await page.setViewportSize({ width: 1024, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const part of [card, page.getByTestId("hub-new-project"), page.getByTestId("hub-open")]) {
    await expect(part).toBeInViewport({ ratio: 1 });
  }
  await card.locator("button").first().click();
  await page.waitForURL(/[?&]project=demo&/);
  await page.waitForSelector('canvas[data-ready="1"]', { timeout: 120_000 });
});

test("the prompt box of Learn answers with the docs and starts a tutorial in the last project", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await signIn(page);
  await page.getByTestId("hub-nav-learn").click();
  await page.getByTestId("hub-ask-input").fill("How do I make a prefab?");
  await page.getByTestId("hub-ask-go").click();
  const docs = page.getByTestId("hub-ask-doc");
  await expect(docs.first()).toHaveAttribute("href", /docs\/editor\.md#prefabs$/);
  await expect(page.getByTestId("hub-ask-tutorial")).toHaveAttribute("data-tutorial", "prefab");
  // The tutorial starts in the last project (demo of the first test): the editor window opens and runs it.
  await page.getByTestId("hub-ask-start").click();
  await page.waitForURL(/[?&]project=demo&/);
  await expect(page.getByTestId("tutorial")).toHaveAttribute("data-tutorial", "prefab", { timeout: 120_000 });
  expect(new URL(page.url()).searchParams.has("tutorial")).toBe(false);
});

test("save the project as a template; the template shows in the wizard of a second project", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await signIn(page);
  await page.getByRole("button", { name: "Actions for demo" }).click();
  await page.getByRole("menuitem", { name: "Save as a template…" }).click();
  await page.getByTestId("hub-template-title").fill("Demo start");
  await page.getByTestId("hub-template-about").fill("The demo project as a start.");
  await page.getByTestId("hub-template-go").click();
  await expect(page.getByTestId("hub-template-saved")).toContainText("Demo start");
  await page.getByTestId("hub-new-project").click();
  const tile = page.locator('[data-template="user:demo-start"]');
  await expect(tile).toContainText("The demo project as a start.");
  await tile.click();
  await page.getByTestId("wizard-name").fill("second");
  await page.getByTestId("wizard-make").click();
  await page.waitForURL(/[?&]project=second&/, { timeout: 240_000 });
  await page.waitForSelector('canvas[data-ready="1"]', { timeout: 120_000 });
  const made = JSON.parse(readFileSync(join(dir, "work", "second", "scenity.project.json"), "utf8")) as { id: string };
  expect(made.id).toBe("second");
  expect(existsSync(join(dir, "state", "templates", "demo-start", "template.json"))).toBe(true);
});

test("clone a repository from the open dialog and open the copy", async ({ browserName, page }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  const demo = join(dir, "work", "demo");
  const git = (args: string[]): void => {
    const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: demo });
    expect(run.status, String(run.stderr)).toBe(0);
  };
  git(["add", "-A"]);
  git(["commit", "-m", "First"]);
  await signIn(page);
  await page.getByTestId("hub-open").click();
  await expect(page.getByTestId("folder-path")).toHaveText(/\/work$/);
  await page.getByTestId("clone-toggle").click();
  await page.getByTestId("clone-url").fill(`file://${demo}`);
  await page.getByRole("textbox", { name: "Folder name" }).fill("demo-copy");
  await page.getByTestId("clone-start").click();
  await expect(page.getByTestId("folder-path")).toHaveText(/\/work\/demo-copy$/, { timeout: 60_000 });
  await page.getByTestId("folder-open-project").click();
  // The copy has the project ID of the original ("demo"), so the host gives it the next free key.
  await page.waitForURL(/[?&]project=demo-2&/);
  await page.waitForSelector('canvas[data-ready="1"]', { timeout: 120_000 });
});
