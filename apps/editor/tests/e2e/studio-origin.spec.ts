// SPDX-License-Identifier: Apache-2.0
// The studio host in front of one scene server. The spec starts `scenity studio` with no project and signs in with its
// launch link. It opens two project copies (the showroom and the spin sample, which has a plugin) through the API. It
// shows each editor page in a tab of the one origin of the studio. Each page draws its scene, and its Vite HMR socket
// connects through the studio. The spin project opens restricted (no plugin code): its scene loads and keeps the
// plugin components, and a banner says so. The action of the banner asks for the trust (`confirm.trust`). After the
// trust, the page loads the components with the plugin.
//   bunx --bun playwright test studio-origin --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";

const REPO = join(LABS_ROOT, "..", "..");
const READY = { timeout: 90_000 };
test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let origin = "";
let launch = "";
let secret = "";
let studio: ReturnType<typeof Bun.spawn> | null = null;
/** The cookies of the sign-in of the first test: the launch link signs in once. */
let signedIn: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;

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

/** The first stdout line of the studio that starts with `prefix`. */
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

async function api(path: string, body: unknown): Promise<Record<string, unknown>> {
  const answer = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(answer.status).toBe(200);
  return (await answer.json()) as Record<string, unknown>;
}

/** Open an editor page and wait for its first frame and for the HMR socket of the studio origin. */
async function openEditor(page: Page, path: string): Promise<void> {
  const ws = origin.replace("http", "ws");
  // The listener of the frames comes with the socket, so the first frame ("connected") is not missed.
  const connected = new Promise<void>((resolve) => {
    page.on("websocket", (socket) => {
      if (!socket.url().startsWith(ws)) return;
      socket.on("framereceived", (frame) => {
        if (String(frame.payload).includes('"connected"')) resolve();
      });
    });
  });
  await page.goto(`${origin}${path}`);
  await page.waitForSelector('canvas[data-ready="1"]', READY);
  await connected;
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-studio-origin-"));
  const showroom = join(dir, "showroom");
  for (const part of ["assets", "build", "rights", "scenes", "posters", "stills", "scenity.project.json"]) {
    cpSync(join(REPO, "samples", "showroom", part), join(showroom, part), { recursive: true });
  }
  const spin = join(dir, "spin");
  cpSync(join(REPO, "samples", "spin"), spin, { recursive: true, filter: (p) => !/\/(dist|node_modules)$/.test(p) });
  symlinkSync(
    join(REPO, "samples", "spin", "plugins", "demo", "node_modules"),
    join(spin, "plugins", "demo", "node_modules"),
  );
  const port = await freePort();
  origin = `http://127.0.0.1:${String(port)}`;
  const state = join(dir, "state");
  studio = Bun.spawn(
    [
      "bun",
      join(REPO, "packages", "studio-host", "src", "main.ts"),
      "--port",
      String(port),
      "--state",
      state,
      "--no-open",
    ],
    {
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  launch = (JSON.parse(await readyLine(studio, "SCENITY_STUDIO_READY")) as { url: string }).url;
  secret = (JSON.parse(readFileSync(join(state, "host.json"), "utf8")) as { secret: string }).secret;
});

test.afterAll(() => {
  studio?.kill("SIGTERM");
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("two projects in two tabs of the one studio origin, with HMR", async ({ browserName, context }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  const signIn = await context.newPage();
  await signIn.goto(launch);
  expect(new URL(signIn.url()).origin).toBe(origin);
  signedIn = await context.storageState();
  const showroom = await api("/api/projects/open", { dir: join(dir, "showroom") });
  const spin = await api("/api/projects/open", { dir: join(dir, "spin") });
  expect(showroom.key).toBe("showroom");
  expect(spin).toMatchObject({ key: "spin", restricted: true });

  const first = await context.newPage();
  await openEditor(first, String(showroom.url));
  const second = await context.newPage();
  await openEditor(second, String(spin.url));
  // Restricted: no plugin code, and the plugin components stay in the document.
  const kept = await second.evaluate(() => {
    const doc = (
      globalThis as unknown as {
        __scenity: { document(): { entities: Record<string, { components: Record<string, unknown> }> } };
      }
    ).__scenity.document();
    return Object.values(doc.entities).filter((e) => e.components["demo.spin"] !== undefined).length;
  });
  expect(kept).toBe(2);
  // The banner of the restricted mode; its action asks for the trust, then the page loads again.
  const banner = second.locator('[data-banner="restricted"]');
  await expect(banner).toBeVisible(READY);
  await second.getByTestId("trust-project").click();
  await expect(second.locator('[data-spec="confirm.trust"]')).toBeVisible();
  await Promise.all([second.waitForEvent("load"), second.getByTestId("trust-yes").click()]);
  await openEditor(second, String(spin.url));
  await expect(second.locator('[data-banner="restricted"]')).toHaveCount(0);
  // The first tab is still there and drew its scene.
  await expect(first.locator('canvas[data-ready="1"]')).toHaveCount(1);
});

test("Preferences shows the preferences of the host and writes them over the new value", async ({
  browserName,
  browser,
}) => {
  test.skip(browserName !== "chromium" || signedIn === null, "the studio spec runs in Chromium, after the sign-in");
  const context = await browser.newContext(signedIn === null ? {} : { storageState: signedIn });
  const showroom = await api("/api/projects/open", { dir: join(dir, "showroom") });
  const page = await context.newPage();
  await openEditor(page, String(showroom.url));
  await page.getByTestId("dock-tab-preferences").click();
  const host = page.getByTestId("settings-host");
  await expect(host.getByTestId("settings-host-model")).toBeVisible(READY);
  await host.getByTestId("settings-host-model").fill("test-model");
  await host.getByTestId("settings-host-model").press("Tab");
  await host.getByTestId("settings-host-autosave").check();
  const preferences = () =>
    page.evaluate(async () => {
      const answer = await fetch("/api/user/preferences");
      return (await answer.json()) as { theme: string; autosave: boolean; agent: { model?: string } };
    });
  await expect.poll(async () => (await preferences()).agent.model).toBe("test-model");
  // A change of the theme merges into the stored preferences: the model and autosave stay.
  await page.getByTestId("settings-theme").selectOption("light");
  await expect.poll(async () => (await preferences()).theme).toBe("light");
  expect(await preferences()).toMatchObject({ autosave: true, agent: { model: "test-model" } });
  // The search shows the agent defaults only.
  await page.getByTestId("settings-search").fill("agent");
  await expect(host.getByTestId("settings-host-mode")).toBeVisible();
  await expect(host.getByTestId("settings-host-recent")).toHaveCount(0);
  await expect(page.getByTestId("setting-row-snaps.grid")).toHaveCount(0);
  await context.close();
});
