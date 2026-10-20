// SPDX-License-Identifier: Apache-2.0
// The studio with no agent: `scenity studio --no-agent`. The agent panel, ⌘L, ⌘I and "Ask the agent" of the search
// box say how to connect an agent. The work of the person continues as usual: an edit, its undo and a save of the
// scene.
//   bunx --bun playwright test studio-no-agent --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LABS_ROOT } from "./builds";

const REPO = join(LABS_ROOT, "..", "..");
const READY = { timeout: 90_000 };
test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let origin = "";
let secret = "";
let launchUrl = "";
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

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-studio-no-agent-"));
  for (const part of ["assets", "build", "rights", "scenes", "posters", "stills", "scenity.project.json"]) {
    cpSync(join(REPO, "samples", "showroom", part), join(dir, "showroom", part), { recursive: true });
  }
  const port = await freePort();
  origin = `http://127.0.0.1:${String(port)}`;
  const state = join(dir, "state");
  const main = join(REPO, "packages", "studio-host", "src", "main.ts");
  studio = Bun.spawn(["bun", main, "--port", String(port), "--state", state, "--no-open", "--no-agent"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  launchUrl = (JSON.parse(await readyLine(studio, "SCENITY_STUDIO_READY")) as { url: string }).url;
  secret = (JSON.parse(readFileSync(join(state, "host.json"), "utf8")) as { secret: string }).secret;
});

test.afterAll(() => {
  studio?.kill("SIGTERM");
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("with no agent each agent entry says how to connect one, and the work goes on", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  await page.goto(launchUrl);
  const opened = await fetch(`${origin}/api/projects/open`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ dir: join(dir, "showroom") }),
  });
  const { url } = (await opened.json()) as { url: string };
  await page.goto(`${origin}${url}`);
  await page.waitForSelector('canvas[data-ready="1"]', READY);
  await page.waitForLoadState("networkidle");
  await page.waitForSelector('canvas[data-ready="1"]', READY);
  // ⌘L shows the agent panel with the way to connect an agent.
  await page.keyboard.press("ControlOrMeta+L");
  await expect(page.getByTestId("agent-none")).toContainText("No agent is connected");
  // "Ask the agent" of the search box is disabled and says why.
  await page.keyboard.press("ControlOrMeta+K");
  await page.keyboard.type("how do I light the table");
  await expect(page.getByTestId("search-row").first()).toContainText("No agent is connected");
  await page.keyboard.press("Escape");
  // The work of the person continues: an edit, its undo, an edit and a save.
  const name = () => page.evaluate(() => globalThis.__scenity?.document().entities.armchair?.name);
  await page.evaluate(() =>
    globalThis.__scenity?.command?.("entity.rename", { entity: "armchair", name: "Reading chair" }),
  );
  expect(await name()).toBe("Reading chair");
  await page.evaluate(() => globalThis.__scenity?.undo());
  expect(await name()).toBe("Armchair");
  await page.evaluate(() =>
    globalThis.__scenity?.command?.("entity.rename", { entity: "armchair", name: "Easy chair" }),
  );
  const saved = await page.evaluate(() => globalThis.__scenity?.save());
  expect(saved).toMatchObject({ ok: true });
  expect(readFileSync(join(dir, "showroom", "scenes", "main.scene.json"), "utf8")).toContain("Easy chair");
  const status = await fetch(`${origin}/api/agent/status`, { headers: { "x-studio-token": secret } });
  expect(await status.json()).toEqual({ available: false, driver: null });
});
