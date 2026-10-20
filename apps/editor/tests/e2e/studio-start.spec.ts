// SPDX-License-Identifier: Apache-2.0
// Start from a prompt through the Hub of Scenity Studio. The studio runs the script driver (`SCENITY_AGENT_SCRIPT`).
// The first turn chooses the empty template and the name "prompt-shop". The turn of the first scene renames and moves
// the box. The spec types the words in the new project wizard and presses "Start from the prompt". It sees the editor
// window of the new project with the first scene as a change set that waits for review.
//   bunx --bun playwright test studio-start --project=chromium --workers=1
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { freePort } from "./specServer";

const REPO = join(LABS_ROOT, "..", "..");
const WORDS = "a shop with a red box";
/** The prompt of the turn of the first scene (src/scene/agent/startFromPrompt.ts). */
const FIRST_SCENE = `Build the first scene of this new project for these words of the person: ${WORDS}`;
const SCRIPT = {
  turns: [[{ tool: "choose_template", input: { template: "empty", name: "prompt-shop" } }]],
  prompts: {
    [FIRST_SCENE]: [
      { tool: "scene_command", input: { command: "entity.rename", args: { entity: "box", name: "Red box" } } },
      { tool: "scene_command", input: { command: "entity.move", args: { entity: "box", x: 1.5 } } },
      { say: "The box is the shop counter now." },
    ],
  },
};

test.describe.configure({ mode: "serial", timeout: 300_000 });

let dir = "";
let launch = "";
let studio: ReturnType<typeof Bun.spawn> | null = null;

/** The first stdout line of the studio that starts with `prefix`. */
async function readyLine(child: ReturnType<typeof Bun.spawn>, prefix: string): Promise<string> {
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the studio ended: ${text}`);
    text += new TextDecoder().decode(value);
    const line = text.split("\n").find((item) => item.startsWith(prefix));
    if (line !== undefined) return line.slice(prefix.length + 1);
  }
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-studio-start-"));
  mkdirSync(join(dir, "work"));
  const script = join(dir, "script.json");
  writeFileSync(script, JSON.stringify(SCRIPT));
  const port = await freePort();
  studio = Bun.spawn(
    [
      "bun",
      join(REPO, "packages", "studio-host", "src", "main.ts"),
      ...["--port", String(port), "--state", join(dir, "state"), "--root", join(dir, "work"), "--no-open"],
    ],
    { stdout: "pipe", stderr: "inherit", env: { ...process.env, SCENITY_AGENT_SCRIPT: script } },
  );
  launch = (JSON.parse(await readyLine(studio, "SCENITY_STUDIO_READY")) as { url: string }).url;
});

test.afterAll(() => {
  studio?.kill("SIGTERM");
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("the words of the person make a project and a first scene that waits for review", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(launch);
  await expect(page.getByTestId("first-run")).toBeVisible();
  await page.getByTestId("first-skip").click();
  await page.getByTestId("hub-new-project").click();
  // With agents the wizard starts from a prompt.
  await expect(page.getByTestId("wizard-prompt")).toBeVisible();
  await page.getByTestId("wizard-words").fill(WORDS);
  await page.getByTestId("wizard-start").click();
  // The agent chose the empty template and the name; the steps make the project and open the editor window.
  await page.waitForURL(/[?&]project=prompt-shop&/, { timeout: 240_000 });
  await page.waitForSelector('canvas[data-ready="1"]', { timeout: 120_000 });
  expect(existsSync(join(dir, "work", "prompt-shop", "scenity.project.json"))).toBe(true);
  // The words go from the URL; the first scene waits as a change set of the new session (review mode).
  await expect.poll(() => new URL(page.url()).searchParams.has("prompt")).toBe(false);
  await expect(page.getByTestId("status-review")).toHaveText(/2 changes wait/, { timeout: 60_000 });
  expect(await page.evaluate(() => globalThis.__scenity?.document().entities.box?.name)).not.toBe("Red box");
  await expect(page.getByTestId("agent-tab")).toHaveCount(1);
});
