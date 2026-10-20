// SPDX-License-Identifier: Apache-2.0
// The editor window of the scene page on a small and a large page: the file bar and the gizmo bar in the top row, the
// panels of the default layout in the dock with no overlap, the canvas that fills the Scene view, and the notices over
// the canvas. The dock works by keyboard only (maximize, the next panel, the Window menu: float, move, close, open
// again). It keeps its layout after a reload. A page without `edit=1` has no editor window. The spec reads the
// showroom of the repository and never saves.
// Run it alone under the GPU lock:
//   bunx --bun playwright test scene-layout --project=chromium --workers=1
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { ON_STUDIO, startSpecServer, type SpecServer } from "./specServer";

const READY = { timeout: 60_000 };
const SCENE = "/scene.html?project=showroom&camera=front";

/** The parts of the editor window and their elements. */
const PARTS = {
  file: "#scene-bar",
  tools: "#scene-gizmo-bar",
  left: "#scene-hierarchy",
  right: "#scene-inspector",
  dock: "#scene-assets",
  view: "[data-testid=studio-view]",
} as const;

type Part = keyof typeof PARTS;

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface Layout {
  readonly workspace: string;
  readonly panels: readonly string[];
  readonly active: string | null;
  readonly maximized: boolean;
  readonly floating: readonly string[];
  readonly folded: boolean;
  readonly shown: "left" | "right" | null;
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

let origin = "";
let server: SpecServer | null = null;

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  server = await startSpecServer({ showroom: join(LABS_ROOT, "../../samples/showroom") });
  origin = server.origin;
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
});

/** Open the showroom in the edit mode and wait for the first frame and for each panel. */
async function open(page: Page): Promise<void> {
  await page.goto(`${origin}${SCENE}&edit=1&scene=scenes/main.scene.json`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  for (const mark of ["data-hierarchy", "data-inspector", "data-gizmo"]) await expect(view).toHaveAttribute(mark, "1");
  await expect(page.getByTestId("scene-assets")).toBeVisible();
}

/** The boxes of the parts that show now. */
function boxes(page: Page): Promise<Partial<Record<Part, Box>>> {
  return page.evaluate((parts) => {
    const found: Partial<Record<string, Box>> = {};
    for (const [part, selector] of Object.entries(parts)) {
      const node = document.querySelector<HTMLElement>(selector);
      if (node === null || node.hidden || !node.checkVisibility({ visibilityProperty: true })) continue;
      const { left, top, right, bottom } = node.getBoundingClientRect();
      found[part] = { left, top, right, bottom };
    }
    return found;
  }, PARTS);
}

function overlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Check that no two parts overlap, that each is in the page, and that the canvas fills the Scene view. The parts in
 * `folded` do not show (a small window folds the sides).
 */
async function expectLayout(page: Page, folded: readonly Part[] = []): Promise<void> {
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  const found = await boxes(page);
  const parts = (Object.keys(PARTS) as Part[]).filter((part) => !folded.includes(part));
  expect(Object.keys(found).sort()).toEqual(parts.sort());
  const entries = Object.entries(found);
  for (const [index, [name, box]] of entries.entries()) {
    expect(box.left, `${name} in the page`).toBeGreaterThanOrEqual(0);
    expect(box.top, `${name} in the page`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${name} in the page`).toBeLessThanOrEqual(size.width + 0.5);
    expect(box.bottom, `${name} in the page`).toBeLessThanOrEqual(size.height + 0.5);
    for (const [other, next] of entries.slice(index + 1))
      expect(overlap(box, next), `${name} and ${other}`).toBe(false);
  }
  const view = found.view;
  if (view === undefined) throw new Error("no Scene view");
  expect(view.right - view.left, "the width of the Scene view").toBeGreaterThan(size.width * 0.3);
  expect(view.bottom - view.top, "the height of the Scene view").toBeGreaterThan(size.height * 0.3);
  const canvas = await page.getByTestId("scene-view").boundingBox();
  expect(canvas).toEqual({ x: view.left, y: view.top, width: view.right - view.left, height: view.bottom - view.top });
  // The middle of the Scene view is a pixel of the canvas.
  const middle = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id ?? "", {
    x: (view.left + view.right) / 2,
    y: (view.top + view.bottom) / 2,
  });
  expect(middle).toBe("scene");
}

/** True when a panel is right of the Scene view. */
async function rightOfView(page: Page, selector: string): Promise<boolean> {
  const panel = await page.locator(selector).boundingBox();
  const view = await page.getByTestId("studio-view").boundingBox();
  return panel !== null && view !== null && panel.x >= view.x + view.width - 1;
}

function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const api = globalThis.__scenity as unknown as { pageLayout(): Layout };
    return api.pageLayout();
  });
}

test("the editor window: the bars, the panels and the canvas do not overlap", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page);
  await expectLayout(page);
  // An edit with no save, then a reload: the draft offer is a dialog of the window, not a bar.
  const path = "/entities/ottoman/components/transform/position";
  expect(
    await page.evaluate((at) => globalThis.__scenity?.apply([{ op: "set", path: at, value: [0, 0, 1.4] }]), path),
  ).toBeNull();
  await page.reload();
  await open(page);
  const notice = page.getByTestId("scene-notice");
  await expect(notice).toHaveAttribute("data-kind", "draft");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("draft-discard").click();
  await expect(notice).toBeHidden();
  // A small page folds the sides. A large page shows them.
  await page.setViewportSize({ width: 1024, height: 640 });
  await expect(page.getByTestId("studio-rail-left")).toBeVisible();
  // The dock makes its layout again after the resize and folds the sides: the check runs until the layout settles.
  await expect(() => expectLayout(page, ["left", "right"])).toPass({ timeout: 15_000 });
  const large = { width: 1600, height: 1000 };
  await page.setViewportSize(large);
  // The dock makes its layout again after the resize (its resize observer): wait for the right edge of the inspector.
  await expect
    .poll(async () => {
      const box = await page.locator("#scene-inspector").boundingBox();
      return box === null ? Infinity : box.x + box.width;
    })
    .toBeLessThanOrEqual(large.width + 0.5);
  await expect(() => expectLayout(page)).toPass({ timeout: 15_000 });
});

test("a small window folds the sides to rails; a rail tab shows its side", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1100, height: 700 });
  await open(page);
  await expect(page.getByTestId("studio-rail-left")).toBeVisible();
  await expect(page.getByTestId("studio-rail-right")).toBeVisible();
  await expect(page.locator(PARTS.left)).toBeHidden();
  await expect(page.locator(PARTS.right)).toBeHidden();
  // A press on a rail tab shows its side with the panel; one side at a time.
  await page.getByTestId("rail-tab-hierarchy").click();
  await expect(page.locator(PARTS.left)).toBeVisible();
  await expect(page.getByTestId("rail-tab-hierarchy")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("rail-tab-inspector").click();
  await expect(page.locator(PARTS.right)).toBeVisible();
  await expect(page.locator(PARTS.left)).toBeHidden();
  expect(await layout(page)).toMatchObject({ folded: true, shown: "right", active: "inspector" });
  // A press on the tab of the side that shows folds it again.
  await page.getByTestId("rail-tab-inspector").click();
  await expect(page.locator(PARTS.right)).toBeHidden();
  // The stored layout keeps no fold: a large window shows each side.
  const stored = await page.evaluate(() => localStorage.getItem("scenity.studio.layout") ?? "");
  expect(stored).not.toContain('"visible":false');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("studio-rail-left")).toHaveCount(0);
  await expect(page.locator(PARTS.left)).toBeVisible();
  await expect(page.locator(PARTS.right)).toBeVisible();
});

test("the dock works by keyboard only and keeps its layout after a reload", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  // A new browser context has no layout, and the spec server gives the host no layout either: the default layout.
  // The studio host has agents, so its window has the Agent panel too.
  await open(page);
  await expect
    .poll(async () => [...(await layout(page)).panels].sort())
    .toEqual([
      ...(ON_STUDIO ? ["agent"] : []),
      "console",
      "game.view",
      "hierarchy",
      "inspector",
      "jobs",
      "lighting",
      "material",
      "notes",
      "preferences",
      "problems",
      "project",
      "review",
      "rules",
      "scene.view",
      "scenes",
      "timeline",
      "variants",
    ]);
  // ⌘4 opens the hierarchy. ⇧Space maximizes its group and then restores it.
  await page.keyboard.press("ControlOrMeta+4");
  await expect.poll(async () => (await layout(page)).active).toBe("hierarchy");
  await page.keyboard.press("Shift+Space");
  await expect.poll(async () => (await layout(page)).maximized).toBe(true);
  await expect(page.locator("#scene-inspector")).toBeHidden();
  await page.keyboard.press("Shift+Space");
  await expect.poll(async () => (await layout(page)).maximized).toBe(false);
  // F6 gives the focus to the next group.
  await page.keyboard.press("F6");
  await expect.poll(async () => (await layout(page)).active).not.toBe("hierarchy");
  // The Window menu by keyboard: open the hierarchy, float it, move it to the right, close it, open it again.
  const windowMenu = async (item: string): Promise<void> => {
    // The menu of the last step closes first (its focus returns to the trigger).
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByTestId("menu-window").focus();
    await page.keyboard.press("Enter");
    const entry = page.getByRole("menuitem", { name: item, exact: true });
    await expect(entry).toBeVisible();
    // The menu gives the focus to an item after it opens; the press goes to the item then (no pointer).
    const focusedRole = (): Promise<string | null> =>
      page.evaluate(() => document.activeElement?.getAttribute("role") ?? null);
    await expect.poll(focusedRole).toBe("menuitem");
    await entry.press("Enter");
    // The menu closes and returns the focus to its trigger (a moment later): the next step starts after that.
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByTestId("menu-window")).toBeFocused();
  };
  await windowMenu("Hierarchy");
  await expect.poll(async () => (await layout(page)).active).toBe("hierarchy");
  await windowMenu("Float or dock the panel");
  await expect.poll(async () => (await layout(page)).floating).toEqual(["hierarchy"]);
  await windowMenu("Move the panel to the right");
  await expect.poll(async () => (await layout(page)).floating).toEqual([]);
  await expect.poll(() => rightOfView(page, "#scene-hierarchy")).toBe(true);
  await windowMenu("Close the panel");
  await expect.poll(async () => (await layout(page)).panels).not.toContain("hierarchy");
  await windowMenu("Hierarchy");
  await expect.poll(async () => (await layout(page)).panels).toContain("hierarchy");
  // The layout returns after a reload: the hierarchy stays on the right.
  await windowMenu("Move the panel to the right");
  await expect.poll(() => rightOfView(page, "#scene-hierarchy")).toBe(true);
  await page.reload();
  await open(page);
  expect(await rightOfView(page, "#scene-hierarchy")).toBe(true);
  // Reset the layout returns the hierarchy to the left.
  await windowMenu("Reset the layout");
  await expect.poll(async () => (await page.locator("#scene-hierarchy").boundingBox())?.x ?? Infinity).toBeLessThan(10);
});

test("each workspace opens its panels and the active workspace comes back after a reload", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await expect(page.getByTestId("workspace-layout")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("workspace-animate").click();
  await expect.poll(async () => (await layout(page)).workspace).toBe("animate");
  // The Agent panel of the workspace shows on the studio path (a host with agents).
  await expect
    .poll(async () => [...(await layout(page)).panels].sort())
    .toEqual([
      ...(ON_STUDIO ? ["agent"] : []),
      "animator",
      "character",
      "clips",
      "game.view",
      "hierarchy",
      "inspector",
      "project",
      "scene.view",
      "timeline",
    ]);
  // The canvas follows the Scene view into the layout of the workspace.
  await expect
    .poll(async () => {
      const canvas = await page.getByTestId("scene-view").boundingBox();
      const view = await page.getByTestId("studio-view").boundingBox();
      return canvas !== null && view !== null && canvas.width === view.width && canvas.height === view.height;
    })
    .toBe(true);
  await page.getByTestId("workspace-assets").click();
  await expect.poll(async () => (await layout(page)).workspace).toBe("assets");
  // The Project window is at the left of the view when the layout of the workspace settles.
  await expect
    .poll(async () => {
      const project = await page.getByTestId("scene-assets").boundingBox();
      const view = await page.getByTestId("studio-view").boundingBox();
      return project !== null && view !== null && project.x + project.width <= view.x + 1;
    })
    .toBe(true);
  await page.reload();
  await open(page);
  await expect.poll(async () => (await layout(page)).workspace).toBe("assets");
  await page.getByTestId("workspace-layout").click();
  await expect.poll(async () => (await layout(page)).workspace).toBe("layout");
});

test("the status bar shows the save, the selection, the rules and the renderer; each item opens its panel", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await expect(page.getByTestId("status-save")).toHaveAttribute("data-state", "saved");
  await expect(page.getByTestId("status-render")).toContainText(/webgl|webgpu/, READY);
  await expect(page.getByTestId("status-render")).toContainText("fps", READY);
  await expect(page.getByTestId("status-problems")).toBeVisible(READY);
  await page.evaluate(() => globalThis.__scenity?.select?.(["table"]));
  await expect(page.getByTestId("status-selection")).toContainText("1 selected");
  // A press on the problems opens the Problems panel. A press on the save state saves.
  await page.getByTestId("status-problems").click();
  await expect.poll(async () => (await layout(page)).active).toBe("problems");
  // The jobs item counts the jobs that run, and a press opens the Jobs panel.
  await expect(page.getByTestId("status-jobs")).toContainText("0", READY);
  await page.getByTestId("status-jobs").click();
  await expect.poll(async () => (await layout(page)).active).toBe("jobs");
  const path = "/entities/table/components/transform/position";
  await page.evaluate((at) => globalThis.__scenity?.apply([{ op: "set", path: at, value: [1.6, 0, -0.9] }]), path);
  await expect(page.getByTestId("status-save")).toHaveAttribute("data-state", /saved|unsaved/);
});

/** The buttons and the menu items of the window chrome that show now, with their command (menu triggers stay out). */
function chromeActions(page: Page): Promise<{ name: string; command: string | null }[]> {
  return page.evaluate(() => {
    const places = ".studio-titlebar, .studio-top, .studio-statusrow, .studio-rail, [role=menu]";
    const controls = "button, [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]";
    return [...document.querySelectorAll(places)].flatMap((place) =>
      [...place.querySelectorAll<HTMLElement>(controls)]
        .filter((node) => !node.hasAttribute("aria-haspopup") && node.checkVisibility())
        .map((node) => ({
          name: node.dataset.testid ?? node.outerHTML.slice(0, 80),
          command: node.dataset.command ?? null,
        })),
    );
  });
}

test("each button and menu item of the window runs a command of the one registry", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const commands = await page.evaluate(() => (globalThis.__scenity?.commands?.() ?? []).map((item) => item.id));
  // commands() lists the page, the scene and the sequence commands of the window.
  expect(commands).toEqual(
    expect.arrayContaining(["file.save", "entity.duplicate", "panel.open.rules", "workspace.switch", "theme.light"]),
  );
  const found = await chromeActions(page);
  // Each menu of the menu bar and the Layout menu.
  const menus = await page
    .locator(".studio-titlebar [data-testid^='menu-'], .studio-top [data-testid^='menu-']")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.testid ?? ""));
  expect(menus).toEqual(expect.arrayContaining(["menu-file", "menu-edit", "menu-window", "menu-layout"]));
  for (const menu of menus.filter((id) => id !== "menu-bar")) {
    await page.getByTestId(menu).click();
    await expect(page.getByRole("menu")).toBeVisible();
    found.push(...(await chromeActions(page)));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
  expect(found.length).toBeGreaterThan(20);
  const gaps = found.filter((item) => item.command === null || !commands.includes(item.command));
  expect(gaps, "an action of the window with no command").toEqual([]);
});

test("the menu bar: an entry runs its command, and an entry that is off says why", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.select?.([]));
  await page.getByTestId("menu-edit").click();
  // No selection: Copy is disabled, and its tooltip gives the reason of the command.
  const copy = page.locator('[role=menuitem][data-command="entity.copy"]');
  await expect(copy).toHaveAttribute("data-disabled", "");
  await expect(copy).toHaveAttribute("title", /.+/);
  await expect(page.locator('[role=menuitem][data-command="history.undo"]')).toContainText(/Z/);
  await page.keyboard.press("Escape");
  // Select the table: Frame runs from the menu.
  await page.evaluate(() => globalThis.__scenity?.select?.(["table"]));
  await page.getByTestId("menu-edit").click();
  await expect(copy).not.toHaveAttribute("data-disabled", "");
  await page.locator('[role=menuitem][data-command="view.frame"]').click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  // The theme from the Window menu (a submenu of the command metadata).
  await page.getByTestId("menu-window").click();
  await page.getByRole("menuitem", { name: "Theme" }).click();
  await page.locator('[role=menuitem][data-command="theme.light"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
  await page.evaluate(() => localStorage.removeItem("scenity.studio.theme"));
});

test("search and ask: ⌘K finds an entity and selects it; ⌘O has the scene filter; a sentence asks", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.select?.([]));
  const box = page.getByTestId("search");
  const input = page.getByTestId("search-input");
  const rows = page.getByTestId("search-row");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(input).toBeFocused();
  await input.fill("armchair");
  await expect(rows.first()).toHaveAttribute("data-item", "armchair");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(box).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.selection?.())).toEqual(["armchair"]);
  // A sentence gives "Ask the agent" first; a window with no agent (the scene server alone) says why on the row.
  await page.keyboard.press("ControlOrMeta+k");
  await input.fill("how do I add a light?");
  await expect(rows.first()).toHaveAttribute("data-kind", "agent");
  if (ON_STUDIO) await expect(rows.first()).not.toHaveAttribute("aria-disabled", "true");
  else await expect(rows.first()).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  // ⌘O opens the box with the scene filter: only entities.
  await page.keyboard.press("ControlOrMeta+o");
  await expect(input).toHaveValue("@");
  await input.pressSequentially("otto");
  await expect(rows.first()).toHaveAttribute("data-item", "ottoman");
  expect(await rows.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.kind))).toEqual([
    "entities",
  ]);
  // A command runs from the box: the light theme.
  await input.fill(">light theme");
  await expect(rows.first()).toHaveAttribute("data-item", "theme.light");
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
  await page.evaluate(() => localStorage.removeItem("scenity.studio.theme"));
});

/** The default keys of the editor for the commands of the showroom page (the clock keys need a sequence). */
const SHELL_KEYS: Readonly<Record<string, readonly string[]>> = {
  "search.open": ["Mod+K"],
  "scene.quickOpen": ["Mod+O"],
  "file.save": ["Mod+S"],
  "history.undo": ["Mod+Z"],
  "history.redo": ["Mod+Shift+Z"],
  "play.toggle": ["Mod+P"],
  "play.pause": ["Mod+Shift+P"],
  "play.step": ["Mod+Alt+P"],
  "panel.open.scene.view": ["Mod+1"],
  "panel.open.inspector": ["Mod+3"],
  "panel.open.hierarchy": ["Mod+4"],
  "panel.maximize": ["Shift+Space"],
  "panel.next": ["Mod+Tab", "F6"],
  "help.keys": ["Shift+/"],
  "help.context": ["F1"],
  "gizmo.view": ["Q"],
  "gizmo.move": ["W"],
  "gizmo.turn": ["E"],
  "gizmo.scale": ["R"],
  "gizmo.space": ["L"],
  "gizmo.pivot": ["P"],
  "view.frame": ["F"],
  "camera.open1": ["1"],
  "gizmo.typeX": ["X"],
  "entity.hide": ["H"],
  "entity.solo": ["Shift+H"],
  "view.showAll": ["Alt+H"],
  "entity.duplicate": ["Mod+D"],
  "entity.delete": ["Delete", "Backspace"],
  "entity.copy": ["Mod+C"],
  "entity.paste": ["Mod+V"],
};

test("each default key works in its context, and the key sheet lists it", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const keys = await page.evaluate(() =>
    Object.fromEntries((globalThis.__scenity?.commands?.() ?? []).map((item) => [item.id, item.keys])),
  );
  for (const [id, chords] of Object.entries(SHELL_KEYS)) expect(keys[id], id).toEqual(chords);
  // ? opens the key sheet: each key, and the held keys and the modal keys too.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("Shift+Slash");
  const sheet = page.getByTestId("key-sheet");
  await expect(sheet).toBeVisible();
  for (const id of Object.keys(SHELL_KEYS)) await expect(sheet.getByTestId(`key-sheet-row-${id}`)).toHaveCount(1);
  await expect(sheet.getByTestId("key-sheet-row-camera.fly.forward")).toHaveAttribute("data-kind", "held");
  await expect(sheet.getByTestId("key-sheet-row-gizmo.confirm")).toHaveAttribute("data-kind", "modal");
  await sheet.getByTestId("key-sheet-filter").fill("entity.solo");
  await expect(sheet.locator("tr")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // H, ⇧H and ⌥H act on the selection in the Scene view.
  await page.evaluate(() => globalThis.__scenity?.select?.(["armchair"]));
  await page.keyboard.press("Shift+h");
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.view?.().solo)).toEqual(["armchair"]);
  await page.keyboard.press("Alt+h");
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.view?.().solo)).toEqual([]);
  // The group of the panel with the focus shows a ring.
  await page.getByTestId("dock-tab-hierarchy").click();
  const ring = await page.evaluate(() => {
    const group = document.querySelector(".studio-dock .dv-groupview:focus-within");
    return group === null ? "none" : getComputedStyle(group, "::after").borderTopStyle;
  });
  expect(ring).toBe("solid");
  // F1 opens the docs of the panel that has the focus.
  const popup = page.waitForEvent("popup");
  await page.keyboard.press("F1");
  expect((await popup).url()).toContain("docs/editor.md#hierarchy-panel");
});

test("the UI calls: one reveal shows a person the exposure field with a callout", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.select?.(["armchair"]));
  const state = await page.evaluate(() => globalThis.__scenity?.ui?.state());
  expect(state).toMatchObject({ workspace: "layout", selection: ["armchair"], scene: "scenes/main.scene.json" });
  // One call: the scene subject (no selection), the Inspector, the field in view, and the callout with the text.
  const answer = await page.evaluate(() =>
    globalThis.__scenity?.ui?.reveal({ field: "environment.exposure", text: "Turn this down a little" }),
  );
  expect(answer?.missing).toEqual([]);
  const field = page.getByTestId("field-environment-exposure");
  await expect(field).toBeInViewport();
  const callout = page.getByTestId("ui-callout");
  await expect(callout).toContainText("Turn this down a little");
  const [fieldBox, calloutBox] = await Promise.all([field.boundingBox(), callout.boundingBox()]);
  expect(Math.abs((calloutBox?.x ?? 0) - (fieldBox?.x ?? 0))).toBeLessThan(8);
  expect(await page.evaluate(() => globalThis.__scenity?.selection?.())).toEqual([]);
  // A press removes the callout. Then a highlight of a control and a toast.
  await page.mouse.click(2, 2);
  await expect(callout).toHaveCount(0);
  expect(
    await page.evaluate(() => globalThis.__scenity?.ui?.highlight({ target: "scene-save", text: "Save here" })),
  ).toBe(true);
  await expect(callout).toContainText("Save here");
  expect(await page.evaluate(() => globalThis.__scenity?.ui?.highlight({ target: "no-such-part" }))).toBe(false);
  await page.evaluate(() => globalThis.__scenity?.ui?.notify({ text: "The lights are set." }));
  await expect(page.getByText("The lights are set.")).toBeVisible();
});

test("the one state call of an agent is small: under 4 KB for the showroom", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.select?.(["armchair"]));
  const state = await page.evaluate(() => globalThis.__scenity?.studioState?.());
  expect(state).toMatchObject({
    project: "showroom",
    scene: { path: "scenes/main.scene.json", id: "main", entities: 14, dirty: false },
    selection: ["armchair"],
    more: false,
    agentMode: "propose",
  });
  expect(state?.top.map((item) => item.id)).toContain("armchair");
  expect(new TextEncoder().encode(JSON.stringify(state)).length).toBeLessThan(4096);
});

test("the activity log of a session replays into a copy and gives the same document", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  // The runs of a session: the person, a batch, and a proposal of an agent that the person accepts.
  const steps = [
    { command: "entity.create.pointLight", args: { name: "Reading light", x: 1, y: 2 } },
    { command: "entity.move", args: { entity: "coffee-table", x: 0.4 } },
  ];
  await page.evaluate(
    async ([batch]) => {
      const api = globalThis.__scenity;
      await api?.command?.("entity.move", { entity: "armchair", x: -1.2 });
      await api?.command?.("entity.rename", { entity: "ottoman", name: "Footstool" });
      await api?.commandBatch?.(batch, "Light the corner");
      const session = { by: "claude", actor: { kind: "agent", name: "Layout helper", colour: "#7c3aed" } } as const;
      await api?.command?.("entity.move", { entity: "shelf", z: -2.5 }, session);
      const [waiting] = api?.proposals?.() ?? [];
      if (waiting !== undefined) api?.accept?.(waiting.id);
    },
    [steps] as const,
  );
  const after = await page.evaluate(() => JSON.stringify(globalThis.__scenity?.document()));
  const entries = await page.evaluate(() => globalThis.__scenity?.activity?.() ?? []);
  expect(entries.map((entry) => `${entry.command}:${entry.outcome}`)).toEqual([
    "entity.move:applied",
    "entity.rename:applied",
    "batch:applied",
    "entity.move:proposed",
    "entity.move:applied",
  ]);
  // The Activity panel shows each line with the actor; the line of the agent names it.
  await page.evaluate(() => globalThis.__scenity?.ui?.reveal({ panel: "activity" }));
  await expect(page.getByTestId("activity-line")).toHaveCount(5);
  await expect(page.getByTestId("activity-line").first()).toContainText("Layout helper");
  // The copy: the scene of the disk (the draft goes), then the replay of the log.
  await page.evaluate(() => globalThis.__scenity?.ui?.reveal({ panel: "project" }));
  await page.reload();
  await open(page);
  await page.getByTestId("draft-discard").click();
  await page.evaluate((lines) => globalThis.__scenity?.replayActivity?.(lines), entries);
  expect(await page.evaluate(() => JSON.stringify(globalThis.__scenity?.document()))).toBe(after);
});

test("adjust the last action: a duplicate with an offset, then a new offset in the panel, one step", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const position = (id: string): Promise<unknown> =>
    page.evaluate(
      (entity) =>
        (globalThis.__scenity?.document().entities[entity]?.components.transform as { position?: number[] } | undefined)
          ?.position,
      id,
    );
  const start = (await position("ottoman")) as number[];
  // The commands round a place to 0.1 mm.
  const at = (dx: number): number[] => [Math.round(((start[0] ?? 0) + dx) * 1e4) / 1e4, start[1] ?? 0, start[2] ?? 0];
  const before = await page.evaluate(() => Object.keys(globalThis.__scenity?.document().entities ?? {}));
  await page.evaluate(() => globalThis.__scenity?.command?.("entity.duplicate", { entity: "ottoman", x: 1 }));
  const copy = await page.evaluate(
    (ids) => Object.keys(globalThis.__scenity?.document().entities ?? {}).find((id) => !ids.includes(id)) ?? "",
    before,
  );
  expect(await position(copy)).toEqual(at(1));
  // The panel shows the offset of the last action; a new value runs it again as the same step.
  const panel = page.getByTestId("scene-adjust");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("scene-adjust-x")).toHaveValue("1");
  await page.getByTestId("scene-adjust-x").fill("2.5");
  await page.getByTestId("scene-adjust-x").press("Enter");
  await expect.poll(() => position(copy)).toEqual(at(2.5));
  // One undo removes the duplicate: the adjust made no second step.
  await page.evaluate(() => globalThis.__scenity?.undo());
  expect(await page.evaluate(() => Object.keys(globalThis.__scenity?.document().entities ?? {}))).toEqual(before);
  await expect(panel).toBeHidden();
});

test("a page without edit=1 has no editor window", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}${SCENE}`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  expect(await boxes(page)).toEqual({});
  await expect(page.locator("#studio")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-scene-layout", /./);
});

test("a click on step 3 of 10 in the History panel undoes 7 steps as one action that redo brings back", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const start = await page.evaluate(() => globalThis.__scenity?.history?.().steps.length ?? 0);
  for (let step = 1; step <= 10 - start; step += 1) {
    await page.evaluate((x) => globalThis.__scenity?.command?.("entity.move", { entity: "armchair", x }), step / 10);
  }
  const history = () => page.evaluate(() => globalThis.__scenity?.history?.());
  const x = () =>
    page.evaluate(
      () =>
        (globalThis.__scenity?.document().entities.armchair?.components.transform as { position?: number[] })
          .position?.[0],
    );
  expect((await history())?.steps).toHaveLength(10);
  await page.keyboard.press("ControlOrMeta+Shift+H");
  const panel = page.getByTestId("history-panel");
  await expect(panel.getByTestId("history-step")).toHaveCount(10);
  await expect(panel.locator('[data-index="9"]')).toHaveAttribute("aria-current", "step");
  // Step 3 of 10: an undo of seven steps as one action.
  await panel.locator('[data-index="2"]').click();
  await expect.poll(async () => (await history())?.index).toBe(2);
  await expect(panel.locator('[data-index="2"]')).toHaveAttribute("aria-current", "step");
  await expect(panel.locator("[data-undone]")).toHaveCount(7);
  // One redo does the seven steps again. The Redo button of the toolbar names the step.
  await expect(page.getByTestId("toolbar-redo")).toHaveAttribute("aria-label", /^Redo /);
  await page.getByTestId("toolbar-redo").click();
  await expect.poll(async () => (await history())?.index).toBe(9);
  expect(await x()).toBeCloseTo((10 - start) / 10);
  await expect(panel.locator('[data-index="9"]')).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("toolbar-redo")).toBeDisabled();
  await page.getByTestId("toolbar-undo").click();
  await expect.poll(async () => (await history())?.index).toBe(8);
});
