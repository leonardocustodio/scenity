// SPDX-License-Identifier: Apache-2.0
// The page bridge in the studio: the tools of the workbench host run against an editor window of Scenity Studio with
// no workbench page. The studio host serves a copy of the showroom. The editor page connects to the socket `/bridge` of
// the studio. The tools server of the workbench host for the studio (studioTools.ts) runs the tools with
// `POST /tools/<name>`. Each tool reaches the window through `POST /api/bridge/<call>` of the studio. The tool of the
// demo plugin of a spin copy runs from the search box. Run it alone:
//   bunx --bun playwright test studio-tools --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { copySpin } from "./spinCopy";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const READY = { timeout: 90_000 };
test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let origin = "";
let secret = "";
let studio: ReturnType<typeof Bun.spawn> | null = null;
let tools: ReturnType<typeof Bun.spawn> | null = null;
let toolsAt = { origin: "", token: "" };

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

// The studio specs run in Chromium.
test.skip(({ browserName }) => browserName !== "chromium", "the studio spec runs in Chromium");

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-studio-bridge-"));
  for (const part of ["assets", "build", "rights", "scenes", "posters", "stills", "scenity.project.json"]) {
    cpSync(join(REPO, "samples", "showroom", part), join(dir, "showroom", part), { recursive: true });
  }
  for (const part of ["assets", "posters", "rights", "scenes", "sequences", "tools", "scenity.project.json"]) {
    cpSync(join(REPO, "samples", "characters", part), join(dir, "characters", part), { recursive: true });
  }
  const port = await freePort();
  origin = `http://127.0.0.1:${String(port)}`;
  const state = join(dir, "state");
  const main = join(REPO, "packages", "studio-host", "src", "main.ts");
  studio = Bun.spawn(["bun", main, "--port", String(port), "--state", state, "--no-open"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  await readyLine(studio, "SCENITY_STUDIO_READY");
  secret = (JSON.parse(readFileSync(join(state, "host.json"), "utf8")) as { secret: string }).secret;
  const server = join(REPO, "packages", "workbench-host", "src", "studioTools.ts");
  tools = Bun.spawn(["bun", server, "--studio", origin, "--token", secret], { stdout: "pipe", stderr: "inherit" });
  toolsAt = JSON.parse(await readyLine(tools, "SCENITY_STUDIO_TOOLS_READY")) as typeof toolsAt;
});

test.afterAll(() => {
  tools?.kill("SIGTERM");
  studio?.kill("SIGTERM");
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** A new launch link of the studio (a launch code works once). */
async function launchLink(): Promise<string> {
  const answer = await fetch(`${origin}/api/launch-code`, { method: "POST", headers: { "x-studio-token": secret } });
  return ((await answer.json()) as { url: string }).url;
}

/** The text of a tool result (as the MCP server of the host calls a tool). */
async function tool(name: string, input: unknown): Promise<string> {
  const answer = await fetch(`${toolsAt.origin}/tools/${name}`, {
    method: "POST",
    headers: { "x-workbench-token": toolsAt.token, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = (await answer.json()) as { content: { type: string; text?: string }[] };
  return result.content.map((block) => (block.type === "text" ? (block.text ?? "") : "[image]")).join("\n");
}

test("the tools of the workbench run against an editor window of the studio with no workbench page", async ({
  page,
}) => {
  await page.goto(await launchLink());
  const opened = await fetch(`${origin}/api/projects/open`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ dir: join(dir, "showroom") }),
  });
  const { url } = (await opened.json()) as { url: string };
  await page.goto(`${origin}${url}`);
  await page.waitForSelector('canvas[data-ready="1"]', READY);
  // The window says hello on the socket of the studio.
  const pages = async (): Promise<number> => {
    const answer = await fetch(`${origin}/api/bridge`, { headers: { "x-studio-token": secret } });
    return ((await answer.json()) as { pages: unknown[] }).pages.length;
  };
  await expect.poll(pages, READY).toBe(1);
  expect(JSON.parse(await tool("studio_state", {}))).toMatchObject({ project: "showroom", scene: { entities: 14 } });
  expect(await tool("scene_query", { ids: ["armchair"] })).toContain("armchair");
  expect(await tool("scene_commands", { filter: "entity.move" })).toContain("entity.move");
  expect(await tool("scene_command", { command: "entity.move", args: { entity: "armchair", x: 0.5 } })).toContain(
    "Proposal p1",
  );
  expect(await tool("ui_state", {})).toContain("Workspace: layout");
  // A picture crosses the socket as bytes.
  expect(await tool("scene_frame", { width: 320 })).toContain("[image]");
});

test("20 agent frames leave the camera, the time and the selection of the person as they are", async ({ page }) => {
  await page.goto(await launchLink());
  const opened = await fetch(`${origin}/api/projects/open`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ dir: join(dir, "characters") }),
  });
  const { url } = (await opened.json()) as { url: string };
  await page.goto(`${origin}${url}&t=1200&paused=1`);
  await page.waitForSelector('canvas[data-ready="1"]', READY);
  // The window says hello on the socket after its first frame. At that time, the state names its project.
  const project = async (): Promise<string> => {
    const text = await tool("studio_state", {});
    return text.startsWith("{") ? (JSON.parse(text) as { project: string }).project : text;
  };
  await expect.poll(project, READY).toBe("characters");
  await page.evaluate(() =>
    (globalThis as unknown as { __scenity: { select(ids: string[]): void } }).__scenity.select(["robot"]),
  );
  const view = (): Promise<unknown> =>
    page.evaluate(() => {
      const api = (
        globalThis as unknown as {
          __scenity: {
            viewport(): { camera: string; position: unknown; target: unknown };
            time(): number;
            selection(): string[];
          };
        }
      ).__scenity;
      const info = api.viewport();
      return {
        camera: info.camera,
        position: info.position,
        target: info.target,
        time: api.time(),
        selection: api.selection(),
      };
    });
  const before = await view();
  // The clock of the person never moves while the agent takes its pictures (the pictures have a clock of their own).
  await page.evaluate(() => {
    const store = globalThis as unknown as { __times: number[]; __scenity: { time(): number } };
    store.__times = [];
    const sample = (): void => {
      store.__times.push(store.__scenity.time());
      requestAnimationFrame(sample);
    };
    sample();
  });
  for (let index = 0; index < 20; index += 1) {
    const input = { t: 300 * index, width: 320, ...(index % 2 === 0 ? { camera: "front" } : {}) };
    expect(await tool("scene_frame", input)).toContain("[image]");
  }
  expect(await view()).toEqual(before);
  const times = await page.evaluate(() => (globalThis as unknown as { __times: number[] }).__times);
  expect(times.length).toBeGreaterThan(5);
  expect(new Set(times)).toEqual(new Set([1200]));
  // The pictures show the scene at their own times: two times give two pictures.
  const frameAt = async (t: number): Promise<string> => {
    const answer = await fetch(`${origin}/api/bridge/shadow.frame`, {
      method: "POST",
      headers: { "x-studio-token": secret, "content-type": "application/json" },
      body: JSON.stringify({ project: "characters", args: [{ t, camera: "front", width: 320 }] }),
    });
    return ((await answer.json()) as { result: { bytes: { $bytes: string } } }).result.bytes.$bytes;
  };
  expect(await frameAt(0)).not.toBe(await frameAt(2400));
  // The same time and camera give the same picture.
  expect(await frameAt(2400)).toBe(await frameAt(2400));
});

test("an agent picture of a project with no window comes from a warm page of the scene pool", async () => {
  const opened = await fetch(`${origin}/api/projects/open`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ dir: join(dir, "characters") }),
  });
  const { key } = (await opened.json()) as { key: string };
  // No editor window of the project is open: the host draws the picture with `scenity shot` in the scene pool.
  const answer = await fetch(`${origin}/api/bridge/shadow.frame`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ project: key, args: [{ width: 320 }], timeoutMs: 240_000 }),
  });
  const { result } = (await answer.json()) as {
    result: { mime: string; width: number; height: number; bytes: { $bytes: string } };
  };
  expect(result).toMatchObject({ mime: "image/png", width: 320, height: 200 });
  // A PNG of the player (the default view of the scene: the floor and the sky).
  const bytes = Buffer.from(result.bytes.$bytes, "base64");
  expect([...bytes.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
  expect(bytes.length).toBeGreaterThan(500);
});

test("an agent edits a closed project; two windows and the agent edit one scene and stay equal", async ({
  context,
}) => {
  const studioPost = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const answer = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "x-studio-token": secret, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await answer.json()) as Record<string, unknown>;
  };
  const scene = "scenes/main.scene.json";
  const file = join(dir, "showroom", scene);
  // No window: the agent renames the ottoman; the host writes the file.
  const { url } = (await studioPost("/api/projects/open", { dir: join(dir, "showroom") })) as { url: string };
  const closed = await studioPost("/api/documents/run", {
    project: "showroom",
    path: scene,
    command: "entity.rename",
    args: { entity: "ottoman", name: "Footstool" },
  });
  expect(closed).toMatchObject({ ok: true });
  expect(readFileSync(file, "utf8")).toContain("Footstool");
  // Two windows of the scene.
  const signIn = await context.newPage();
  await signIn.goto(await launchLink());
  const [first, second] = [await context.newPage(), await context.newPage()];
  for (const page of [first, second]) {
    await page.goto(`${origin}${url}`);
    await page.waitForSelector('canvas[data-ready="1"]', READY);
  }
  const pages = async (): Promise<number> => {
    const answer = await fetch(`${origin}/api/bridge`, { headers: { "x-studio-token": secret } });
    return ((await answer.json()) as { pages: { scene: string | null }[] }).pages.filter((item) => item.scene === scene)
      .length;
  };
  await expect.poll(pages, READY).toBe(2);
  type Api = { __scenity: { command(id: string, args: object): Promise<unknown>; document(): object } };
  const doc = (page: typeof first): Promise<string> =>
    page.evaluate(() => JSON.stringify((globalThis as unknown as Api).__scenity.document()));
  expect(await doc(first)).toContain("Footstool");
  // The first window moves the armchair; the second renames the shelf; the agent turns the table.
  await first.evaluate(() =>
    (globalThis as unknown as Api).__scenity.command("entity.move", { entity: "armchair", x: -1.5 }),
  );
  await expect.poll(() => doc(second)).toBe(await doc(first));
  await second.evaluate(() =>
    (globalThis as unknown as Api).__scenity.command("entity.rename", { entity: "shelf", name: "Bookcase" }),
  );
  await expect.poll(() => doc(first)).toBe(await doc(second));
  const open = await studioPost("/api/documents/run", {
    project: "showroom",
    path: scene,
    command: "entity.turn",
    args: { entity: "table", degrees: 30 },
  });
  expect(open).toMatchObject({ ok: true });
  await expect
    .poll(async () => (await doc(first)) === (await doc(second)) && (await doc(first)).includes("Bookcase"))
    .toBe(true);
  const turned = (page: typeof first): Promise<unknown> =>
    page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __scenity: {
              document(): { entities: Record<string, { components: { transform: { rotation?: unknown } } }> };
            };
          }
        ).__scenity.document().entities.table?.components.transform.rotation,
    );
  expect(await turned(first)).toEqual(await turned(second));
  expect(await turned(first)).toBeDefined();
  // Both windows set the same value at once: the host gives the changes one order, and both windows end with the
  // value of the last change at the host (the window that was late gets its change again).
  const path = "/entities/armchair/components/transform/position";
  const set = (page: typeof first, x: number): Promise<unknown> =>
    page.evaluate(
      ([at, value]) =>
        (globalThis as unknown as { __scenity: { apply(ops: object[]): unknown } }).__scenity.apply([
          { op: "set", path: at, value: [value, 0, 0] },
        ]),
      [path, x] as const,
    );
  await Promise.all([set(first, 2), set(second, 3)]);
  const log = async (): Promise<{ version: number; steps: { ops: { value?: unknown }[] }[] }> => {
    const answer = await fetch(`${origin}/api/documents/log?project=showroom&path=${scene}`, {
      headers: { "x-studio-token": secret },
    });
    return (await answer.json()) as { version: number; steps: { ops: { value?: unknown }[] }[] };
  };
  const position = (page: typeof first): Promise<unknown> =>
    page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __scenity: {
              document(): { entities: Record<string, { components: { transform: { position?: unknown } } }> };
            };
          }
        ).__scenity.document().entities.armchair?.components.transform.position,
    );
  await expect
    .poll(async () => JSON.stringify(await position(first)) === JSON.stringify(await position(second)))
    .toBe(true);
  // The last op of the host sets the position, or the whole transform.
  const value = (await log()).steps.at(-1)?.ops.at(-1)?.value;
  const last = Array.isArray(value) ? value : (value as { position?: unknown } | undefined)?.position;
  expect(last).toBeDefined();
  expect(await position(first)).toEqual(last);
  expect(await position(second)).toEqual(last);
});

test("a second window of a project shows the same selection and dirty state, and its title names the scene", async ({
  context,
}) => {
  const opened = await fetch(`${origin}/api/projects/open`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ dir: join(dir, "showroom") }),
  });
  const { url } = (await opened.json()) as { url: string };
  const signIn = await context.newPage();
  await signIn.goto(await launchLink());
  const [first, second] = [await context.newPage(), await context.newPage()];
  for (const page of [first, second]) {
    await page.goto(`${origin}${url}`);
    await page.waitForSelector('canvas[data-ready="1"]', READY);
  }
  await expect
    .poll(async () => {
      const answer = await fetch(`${origin}/api/bridge`, { headers: { "x-studio-token": secret } });
      return ((await answer.json()) as { pages: unknown[] }).pages.length;
    }, READY)
    .toBeGreaterThanOrEqual(2);
  type Api = {
    __scenity: {
      select(ids: string[]): void;
      selection(): string[];
      command(id: string, args: object): Promise<unknown>;
      save(force?: boolean, reason?: string): Promise<{ ok: boolean }>;
    };
  };
  await expect(first).toHaveTitle("main · showroom · Scenity");
  // The selection of one window is the selection of the other.
  await first.evaluate(() => (globalThis as unknown as Api).__scenity.select(["armchair"]));
  await expect
    .poll(() => second.evaluate(() => (globalThis as unknown as Api).__scenity.selection()))
    .toEqual(["armchair"]);
  // An edit: both windows have changes that are not saved; a save of one: neither has.
  await second.evaluate(() =>
    (globalThis as unknown as Api).__scenity.command("entity.rename", { entity: "armchair", name: "Lounge chair" }),
  );
  await expect(first).toHaveTitle("* main · showroom · Scenity");
  await expect(second).toHaveTitle("* main · showroom · Scenity");
  const saved = await first.evaluate(() =>
    (globalThis as unknown as Api).__scenity.save(false, "the studio bridge test"),
  );
  expect(saved).toMatchObject({ ok: true });
  await expect(first).toHaveTitle("main · showroom · Scenity");
  await expect(second).toHaveTitle("main · showroom · Scenity");
});

test("each workspace of a studio window opens its panels with the agent panel in the dock", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const opened = await fetch(`${origin}/api/projects/open`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ dir: join(dir, "showroom") }),
  });
  const { url } = (await opened.json()) as { url: string };
  await page.goto(await launchLink());
  await page.goto(`${origin}${url}`);
  await page.waitForSelector('canvas[data-ready="1"]', READY);
  // The agent panel renders before the viewport chunk runs; that render must not stop the changes of the dock.
  for (const [workspace, panel] of [
    ["build", "build"],
    ["review", "review"],
    ["animate", "timeline"],
    ["assets", "project"],
    ["layout", "hierarchy"],
  ] as const) {
    await page.getByTestId(`workspace-${workspace}`).click();
    await expect(page.getByTestId(`dock-tab-${panel}`)).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("the layout of the dock returns in a new browser: the host keeps it", async ({ browser }) => {
  const opened = await fetch(`${origin}/api/projects/open`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ dir: join(dir, "showroom") }),
  });
  const { url } = (await opened.json()) as { url: string };
  type Layout = { panels: string[]; floating: string[] };
  const layoutOf = (page: Page): Promise<Layout> =>
    page.evaluate(() => (globalThis.__scenity as unknown as { pageLayout(): Layout }).pageLayout());
  const first = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await first.goto(await launchLink());
  await first.goto(`${origin}${url}`);
  await first.waitForSelector('canvas[data-ready="1"]', READY);
  // Open the Bench panel and float it.
  await first.evaluate(() => globalThis.__scenity?.command?.("panel.open.bench"));
  await first.evaluate(() => globalThis.__scenity?.command?.("panel.float"));
  await expect.poll(async () => (await layoutOf(first)).floating).toEqual(["bench"]);
  const panels = (await layoutOf(first)).panels.length;
  expect(panels).toBeGreaterThanOrEqual(12);
  await first.waitForTimeout(1500);
  await first.context().close();
  // A new browser has no storage of its own: the layout comes from the host.
  const second = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await second.goto(await launchLink());
  await second.goto(`${origin}${url}`);
  await second.waitForSelector('canvas[data-ready="1"]', READY);
  await expect.poll(async () => (await layoutOf(second)).floating, READY).toEqual(["bench"]);
  expect((await layoutOf(second)).panels.length).toBe(panels);
  await second.context().close();
});

test("a second browser on the machine has the same key map", async ({ browser }) => {
  const opened = await fetch(`${origin}/api/projects/open`, {
    method: "POST",
    headers: { "x-studio-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ dir: join(dir, "showroom") }),
  });
  const { url } = (await opened.json()) as { url: string };
  const window = async (): Promise<Page> => {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(await launchLink());
    await page.goto(`${origin}${url}`);
    await page.waitForSelector('canvas[data-ready="1"]', READY);
    await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.preferences"));
    await expect(page.getByTestId("settings-panel")).toHaveAttribute("data-loaded", "1", READY);
    return page;
  };
  const first = await window();
  await first.getByTestId("key-change-view.frame").click();
  await expect(first.getByTestId("keymap-capture")).toBeVisible();
  await first.keyboard.press("g");
  await expect(first.getByTestId("key-row-view.frame")).toHaveAttribute("data-keys", "G");
  await expect
    .poll(async () => {
      const answer = await fetch(`${origin}/api/user/keymap`, { headers: { "x-studio-token": secret } });
      return ((await answer.json()) as { keys: Record<string, string[]> }).keys["view.frame"];
    })
    .toEqual(["G"]);
  await first.context().close();
  // A new browser: the key map comes from the host.
  const second = await window();
  await expect(second.getByTestId("key-row-view.frame")).toHaveAttribute("data-keys", "G", READY);
  await second.context().close();
});

test("a tool of a plugin runs from the search box with a form from its input schema", async ({ page }) => {
  copySpin("", join(dir, "spin"));
  const headers = { "x-studio-token": secret, "content-type": "application/json" };
  const opened = await fetch(`${origin}/api/projects/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ dir: join(dir, "spin") }),
  });
  const { key, url } = (await opened.json()) as { key: string; url: string };
  // The spin sample runs code (its plugin): trust the copy, so the host face of the plugin loads.
  await fetch(`${origin}/api/projects/trust`, { method: "POST", headers, body: JSON.stringify({ key }) });
  await page.goto(await launchLink());
  await page.goto(`${origin}${url}`);
  await page.waitForSelector('canvas[data-ready="1"]', READY);
  await page.keyboard.press("ControlOrMeta+K");
  await page.keyboard.type(">demo_spin_time");
  await expect(page.getByTestId("search-row").first()).toContainText("Run the plugin tool demo_spin_time", READY);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-prompt-input")).toBeVisible();
  await page.getByTestId("command-prompt-input").fill("90");
  await page.getByTestId("command-prompt-go").click();
  await expect(page.getByTestId("studio-toast").last()).toContainText("turns once in 4 s.");
});
