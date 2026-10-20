// SPDX-License-Identifier: Apache-2.0
// Autosave, recovery and the format upgrade. A closed browser tab recovers its unsaved edits from the drafts of the
// host (a new browser context has no browser storage). An old file upgrades with a diff that the page shows. The spec
// copies the walkthrough sample into a temp folder, with the plaza scene also as a v0 file. It starts the dev server of
// the scene page on it. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-recovery --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const WALKTHROUGH = join(LABS_ROOT, "../../samples/walkthrough");
const READY = { timeout: 60_000 };
const SCENE = "scenes/plaza.scene.json";
const OLD = "scenes/old.scene.json";

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

/** The plaza scene in the v0 format: the entities as a list with their IDs, and no index. */
function oldScene(): string {
  const doc = JSON.parse(readFileSync(join(WALKTHROUGH, SCENE), "utf8")) as {
    entities: Record<string, Record<string, unknown>>;
  };
  const entities = Object.entries(doc.entities)
    .sort(([, a], [, b]) => Number(a.index) - Number(b.index))
    .map(([id, entity]) => ({ id, ...Object.fromEntries(Object.entries(entity).filter(([key]) => key !== "index")) }));
  return `${JSON.stringify({ ...doc, format: "scenity.scene/0", entities }, null, 2)}\n`;
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-recovery-"));
  for (const part of ["assets", "build", "rights", "scenes", "sequences", "scenity.project.json"])
    cpSync(join(WALKTHROUGH, part), join(dir, part), { recursive: true });
  writeFileSync(join(dir, OLD), oldScene());
  server = await startSpecServer({ walk: dir }, { SCENITY_SCENE_HOST_DRAFTS: "1" });
  origin = server.origin;
  key = server.keys.walk ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

async function open(page: Page, scene: string): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=${scene}`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

const path = "/entities/bench/components/transform/position";
const benchAt = (page: Page) =>
  page.evaluate(
    () =>
      (
        globalThis.__scenity?.document() as unknown as {
          entities: Record<string, { components: { transform: { position: number[] } } }>;
        }
      ).entities.bench?.components.transform.position,
  );

test("a closed tab gets its unsaved edits back from the drafts of the host", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  const first = await browser.newContext();
  await server?.signIn(first);
  const page = await first.newPage();
  await open(page, SCENE);
  expect(
    await page.evaluate(
      (ops) => globalThis.__scenity?.apply(ops),
      [{ op: "set" as const, path, value: [-0.6, 0.23, -2.1] }],
    ),
  ).toBeNull();
  // The draft goes to the host: the drafts file of the project names the scene.
  await expect
    .poll(
      () =>
        existsSync(join(dir, ".scenity/drafts.json")) ? readFileSync(join(dir, ".scenity/drafts.json"), "utf8") : "",
      { timeout: 10_000 },
    )
    .toContain(SCENE);
  await first.close();
  // A new context has no browser storage: the draft comes from the host.
  const second = await browser.newContext();
  await server?.signIn(second);
  const again = await second.newPage();
  await open(again, SCENE);
  const dialog = again.locator('[data-spec="confirm.discardDraft"]');
  await expect(dialog).toBeVisible(READY);
  await again.getByTestId("draft-restore").click();
  await expect.poll(() => benchAt(again)).toEqual([-0.6, 0.23, -2.1]);
  await second.close();
});

test("the autosave of the project saves the open scene after a time with no edit", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, SCENE);
  // The dialog of the draft of the first test: discard it.
  const discard = page.getByTestId("draft-discard");
  if (await discard.isVisible().catch(() => false)) await discard.click();
  for (const [setting, value] of [
    ["autosave.seconds", 5],
    ["autosave.enabled", true],
  ] as const)
    expect(
      await page.evaluate(([key, item]) => globalThis.__scenity?.setEditorSetting?.(key as never, item), [
        setting,
        value,
      ] as const),
    ).toBeNull();
  expect(
    await page.evaluate(
      (ops) => globalThis.__scenity?.apply(ops),
      [{ op: "set" as const, path, value: [-0.7, 0.23, -2.1] }],
    ),
  ).toBeNull();
  await expect
    .poll(
      () =>
        (
          JSON.parse(readFileSync(join(dir, SCENE), "utf8")) as {
            entities: Record<string, { components: { transform: { position: number[] } } }>;
          }
        ).entities.bench?.components.transform.position,
      { timeout: 15_000 },
    )
    .toEqual([-0.7, 0.23, -2.1]);
  expect(await page.evaluate(() => globalThis.__scenity?.file().dirty)).toBe(false);
});

test("an old file offers its upgrade with the diff, and the upgrade saves the current format", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, OLD);
  const dialog = page.locator('[data-spec="confirm.formatUpgrade"]');
  await expect(dialog).toBeVisible(READY);
  await expect(dialog).toContainText("scenity.scene/0");
  await dialog.getByText(/The changes/).click();
  // The entities of v0 are a list; the upgrade gives the record of v1.
  await expect(dialog).toContainText('+   "entities": {');
  await expect(dialog).toContainText('-   "entities": [');
  await page.getByTestId("upgrade-format").click();
  await expect
    .poll(() => (JSON.parse(readFileSync(join(dir, OLD), "utf8")) as { format: string }).format)
    .toBe("scenity.scene/1");
});
