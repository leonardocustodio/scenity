// SPDX-License-Identifier: Apache-2.0
// The studio in remote mode: the studio host with a public origin (`SCENITY_STUDIO_PUBLIC_ORIGIN`) behind the gateway
// of the studio (packages/studio-host src/gateway.ts). A browser that finds the public name on this machine opens the
// links of the owner through the gateway. An editor gets the editor window (the scene, an edit, Save). The parts of
// the owner and the Auto mode are disabled with the reason. The owner gets no shell in remote mode, with the reason,
// and the Auto mode says that a file write asks.
//   bunx --bun playwright test studio-remote --project=chromium --workers=1
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { freePort, startSpecServer, type SpecServer } from "./specServer";

const REPO = join(LABS_ROOT, "..", "..");
const SHOWROOM = join(REPO, "samples", "showroom");
const READY = { timeout: 90_000 };
const PUBLIC_NAME = "studio.test";
const OWNER_ONLY = "Only the owner of the studio does this, not an editor or a viewer.";
const EDITOR_AUTO = "An editor chooses Ask or Review. Only the owner of the studio chooses Auto.";
const NO_SHELL = "The studio in remote mode opens no shell. Use the Claude terminal.";
const REMOTE_FILES = "Remote mode: each file write of an agent asks, in the Auto mode too.";

test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let server: SpecServer | null = null;
let gateway: ReturnType<typeof Bun.spawn> | null = null;
let browser: Browser | null = null;
let publicOrigin = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-studio-remote-"));
  const room = join(dir, "showroom");
  mkdirSync(room);
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"])
    cpSync(join(SHOWROOM, part), join(room, part), { recursive: true });
  const port = await freePort();
  publicOrigin = `http://${PUBLIC_NAME}:${String(port)}`;
  server = await startSpecServer({ showroom: room }, { SCENITY_STUDIO_PUBLIC_ORIGIN: publicOrigin });
  gateway = Bun.spawn(["bun", join(REPO, "packages", "studio-host", "src", "gateway.ts")], {
    env: {
      ...process.env,
      SCENITY_STUDIO_PUBLIC_ORIGIN: publicOrigin,
      SCENITY_PORT: String(port),
      SCENITY_STUDIO_PORT: new URL(server.origin).port,
      SCENITY_HOSTNAME: "127.0.0.1",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  // The browser finds the public name on this machine, and takes its origin as a secure one (as HTTPS would be).
  browser = await chromium.launch({
    args: [
      `--host-resolver-rules=MAP ${PUBLIC_NAME} 127.0.0.1`,
      `--unsafely-treat-insecure-origin-as-secure=${publicOrigin}`,
    ],
  });
  for (let wait = 0; wait < 100; wait += 1) {
    const up = await fetch(`http://127.0.0.1:${String(port)}/health`).then(
      (answer) => answer.ok,
      () => false,
    );
    if (up) return;
    await Bun.sleep(100);
  }
  throw new Error("the gateway did not start");
});

test.afterAll(async () => {
  await browser?.close();
  gateway?.kill();
  await gateway?.exited;
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** A launch link of a role that opens the project, through the gateway. */
async function linkOf(role: "admin" | "editor"): Promise<string> {
  const key = server?.keys.showroom ?? "showroom";
  const answer = await server?.fetch("/api/launch-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role, next: `/p/${key}` }),
  });
  const { url } = (await answer?.json()) as { url: string };
  expect(url.startsWith(`${publicOrigin}/launch?code=`)).toBe(true);
  return url;
}

/** A new browser context that opens a launch link and waits for the scene. */
async function open(role: "admin" | "editor"): Promise<Page> {
  const context = await browser!.newContext();
  const page = await context.newPage();
  await page.goto(await linkOf(role));
  await page.waitForSelector('canvas[data-ready="1"]', READY);
  expect(new URL(page.url()).origin).toBe(publicOrigin);
  await expect(page.locator('.dv-tab:has-text("Agent")')).toHaveCount(1, READY);
  return page;
}

test("an editor works through the gateway; the parts of the owner are off with the reason", async ({ browserName }) => {
  test.skip(browserName !== "chromium" || server === null, "the studio spec runs in Chromium");
  const page = await open("editor");
  // An edit and Save reach the scene file through the gateway.
  const path = "/entities/armchair/components/transform/position";
  expect(
    await page.evaluate(
      (ops) => globalThis.__scenity?.apply(ops),
      [{ op: "set" as const, path, value: [-1.5, 0, 0.5] }],
    ),
  ).toBeNull();
  await page.locator('#scene-bar button[data-command="file.save"]').click();
  const scene = join(dir, "showroom", "scenes", "main.scene.json");
  await expect
    .poll(
      () =>
        JSON.stringify(
          (JSON.parse(readFileSync(scene, "utf8")) as { entities: Record<string, unknown> }).entities.armchair,
        ),
      READY,
    )
    .toContain("-1.5");
  // The terminals are for the owner: both buttons are disabled with the reason.
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.terminal"));
  const terminal = page.getByTestId("terminal-panel");
  for (const kind of ["claude", "shell"]) {
    await expect(terminal.getByTestId(`terminal-new-${kind}`)).toBeDisabled();
    await expect(terminal.getByTestId(`terminal-new-${kind}`)).toHaveAttribute("title", OWNER_ONLY);
  }
  await expect(terminal.getByTestId("terminal-reason")).toHaveText(OWNER_ONLY);
  // The Auto mode is disabled with the reason.
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  await expect(page.getByTestId("agent-mode-reason")).toHaveText(EDITOR_AUTO);
  await page.getByTestId("agent-mode").click();
  await expect(page.getByRole("option", { name: "Auto" })).toHaveAttribute("data-disabled", "");
  await page.keyboard.press("Escape");
  await page.context().close();
});

test("the owner gets no shell in remote mode, and Auto says that a file write asks", async ({ browserName }) => {
  test.skip(browserName !== "chromium" || server === null, "the studio spec runs in Chromium");
  const page = await open("admin");
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.terminal"));
  const terminal = page.getByTestId("terminal-panel");
  await expect(terminal.getByTestId("terminal-new-claude")).toBeEnabled();
  await expect(terminal.getByTestId("terminal-new-shell")).toBeDisabled();
  await expect(terminal.getByTestId("terminal-new-shell")).toHaveAttribute("title", NO_SHELL);
  await page.keyboard.press("ControlOrMeta+L");
  await page.getByTestId("agent-new").click();
  await expect(page.getByTestId("agent-mode-reason")).toHaveText(REMOTE_FILES);
  await page.context().close();
});
