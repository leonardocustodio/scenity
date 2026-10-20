// SPDX-License-Identifier: Apache-2.0
// The pseudo-locale check of the studio. The pseudo-locale (en-XA, `locale=pseudo`) gives
// each Fluent text accented letters and brackets, so a text with no accented letter does not come from Fluent. The
// spec opens the Hub of `scenity studio` and the editor on a copy of the showroom in the pseudo-locale. It opens each
// panel and reads the visible texts, titles, labels and placeholders. A data value (a name, a path, an ID) is in an
// element with `translate="no"`, so the check skips it. A text of a package in English (`data-package-text`, the
// measure of a rule from @scenity/rules) is not a text of the studio, so the check skips it too. The files of the
// repository never change. Run it alone:
//   bunx --bun playwright test studio-pseudo --project=chromium --workers=1
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { freePort, startSpecServer, type SpecServer } from "./specServer";

const REPO = join(LABS_ROOT, "..", "..");
const SHOWROOM = join(REPO, "samples/showroom");
const READY = { timeout: 120_000 };
/** The panels of the editor window (src/scene/panelDocs.ts). */
const PANELS = [
  "scene.view",
  "game.view",
  "hierarchy",
  "inspector",
  "notes",
  "tags",
  "scenes",
  "project",
  "timeline",
  "rules",
  "material",
  "lighting",
  "variants",
  "character",
  "animator",
  "simulation",
  "build",
  "embed",
  "baselines",
  "renderQueue",
  "performance",
  "bench",
  "budgets",
  "assetBuild",
  "rights",
  "approvals",
  "release",
  "export",
  "activity",
  "console",
  "problems",
  "search",
  "history",
  "review",
  "plugins",
  "jobs",
  "vcs",
  "instructions",
  "tasks",
  "terminal",
  "agent",
  "projectSettings",
  "shortcuts",
  "preferences",
];

test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ mode: "serial", timeout: 300_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";
let studio: ReturnType<typeof Bun.spawn> | null = null;

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
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-pseudo-"));
  mkdirSync(join(dir, "showroom"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"])
    cpSync(join(SHOWROOM, part), join(dir, "showroom", part), { recursive: true });
  server = await startSpecServer({ pseudo: join(dir, "showroom") });
  origin = server.origin;
  key = server.keys.pseudo ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  studio?.kill("SIGTERM");
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** The visible texts of the page with no pseudo letter, out of the data elements (`translate="no"`). */
function plainTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ATTRIBUTES = ["title", "aria-label", "placeholder"];
    const pseudo = /[ȦƁƇḒḖƑƓĦĪĴĶĿḾȠǾƤɊŘŞŦŬṼẆẊẎẐȧƀƈḓḗƒɠħīĵķŀḿƞǿƥɋřşŧŭṽẇẋẏẑ]/;
    const found = new Set<string>();
    const data = (element: Element): boolean =>
      element.closest('[translate="no"], [data-package-text], canvas, script, style, svg, .xterm') !== null;
    const visible = (element: Element): boolean =>
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
    const check = (text: string, where: Element): void => {
      const value = text.trim().replace(/\s+/g, " ");
      if (!/[A-Za-z]{3,}/.test(value) || pseudo.test(value)) return;
      const panel = where.closest("[data-panel]")?.getAttribute("data-panel") ?? "window";
      found.add(`${panel}: ${value.slice(0, 120)}`);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent === null || data(parent) || !visible(parent)) continue;
      check(node.textContent ?? "", parent);
    }
    for (const element of document.querySelectorAll("[title], [aria-label], [placeholder]")) {
      if (data(element) || !visible(element)) continue;
      // A title with `data-package-title` holds a text of a package in English (the measure of a rule).
      const names = element.hasAttribute("data-package-title") ? ["aria-label", "placeholder"] : ATTRIBUTES;
      for (const name of names) check(element.getAttribute(name) ?? "", element);
    }
    return [...found].sort();
  });
}

test("the editor shows each text of each panel from Fluent", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&scene=scenes/main.scene.json&camera=front&edit=1&locale=pseudo`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  // A selected entity fills the inspector: the labels of its components and fields.
  await page.evaluate(() => globalThis.__scenity?.select?.(["armchair"]));
  const found = new Set(await plainTexts(page));
  for (const panel of PANELS) {
    // A panel that the project does not have refuses to open.
    await page.evaluate(async (id) => {
      try {
        await globalThis.__scenity?.command?.(`panel.open.${id}`);
      } catch {
        // The check continues with the next panel.
      }
    }, panel);
    await page.waitForTimeout(300);
    for (const text of await plainTexts(page)) found.add(text);
  }
  // Each menu of the menu bar and each submenu.
  for (const menu of await page.locator('[data-testid^="menu-"]:not([data-testid="menu-bar"])').all()) {
    if (!(await menu.isVisible())) continue;
    await menu.click();
    await page.waitForTimeout(200);
    for (const text of await plainTexts(page)) found.add(text);
    for (const sub of await page.locator('[role="menuitem"][aria-haspopup="menu"]').all()) {
      await sub.hover();
      await page.waitForTimeout(200);
      for (const text of await plainTexts(page)) found.add(text);
    }
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  console.log(`[pseudo] ${String(found.size)} texts\n${[...found].join("\n")}`);
  expect([...found]).toEqual([]);
});

test("the editor shows its texts in pt-BR", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&scene=scenes/main.scene.json&camera=front&edit=1&locale=pt-BR`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  const bar = page.getByTestId("menu-bar");
  await expect(bar).toContainText("Arquivo");
  await expect(bar).toContainText("Editar");
  await expect(page.getByTestId("dock-tab-hierarchy")).toContainText("Hierarquia");
  await expect(page.getByTestId("dock-tab-inspector")).toContainText("Inspetor");
});

test("the Hub shows each text from Fluent", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  const port = await freePort();
  studio = Bun.spawn(
    [
      "bun",
      join(REPO, "packages/studio-host/src/main.ts"),
      "--port",
      String(port),
      "--state",
      join(dir, "state"),
    ].concat(["--root", dir, "--no-open"]),
    { stdout: "pipe", stderr: "inherit" },
  );
  const launch = (JSON.parse(await readyLine(studio, "SCENITY_STUDIO_READY")) as { url: string }).url;
  await page.goto(launch);
  await expect(page.getByTestId("hub")).toBeVisible();
  await page.goto(`http://127.0.0.1:${String(port)}/?locale=pseudo`);
  // The first run comes on a fresh state.
  await expect(page.getByTestId("first-run")).toBeVisible();
  const found = new Set(await plainTexts(page));
  await page.getByTestId("first-skip").click();
  for (const section of ["projects", "learn", "agents", "settings"]) {
    await page.getByTestId(`hub-nav-${section}`).click();
    await page.waitForTimeout(300);
    for (const text of await plainTexts(page)) found.add(text);
  }
  for (const dialog of ["hub-new-project", "hub-open"]) {
    await page.getByTestId(dialog).click();
    await page.waitForTimeout(500);
    for (const text of await plainTexts(page)) found.add(text);
    await page.keyboard.press("Escape");
  }
  console.log(`[pseudo-hub] ${String(found.size)} texts\n${[...found].join("\n")}`);
  expect([...found]).toEqual([]);
});
