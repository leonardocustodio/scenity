// SPDX-License-Identifier: Apache-2.0
// Many projects at once: one studio host with three samples in three tabs. A project with an open window never stops.
// A project with no window and no request for the idle time closes (`SCENITY_STUDIO_IDLE_MS`). Its short link
// `/p/<key>` opens it again, and its unsaved change returns from the drafts of the host.
//   bunx --bun playwright test studio-sessions --project=chromium --workers=1
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SAMPLES = join(LABS_ROOT, "../../samples");
const READY = { timeout: 90_000 };
/** The idle time of the host in the spec (ms). */
const IDLE_MS = 5000;

test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let server: SpecServer | null = null;

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-studio-sessions-"));
  const copies: Record<string, string> = {};
  for (const sample of ["showroom", "characters", "walkthrough"]) {
    const to = join(dir, sample);
    mkdirSync(to);
    for (const part of ["assets", "build", "rights", "scenes", "sequences", "scenity.project.json"]) {
      if (existsSync(join(SAMPLES, sample, part)))
        cpSync(join(SAMPLES, sample, part), join(to, part), { recursive: true });
    }
    copies[sample] = to;
  }
  // The drafts of the host are enabled (the e2e config disables them).
  server = await startSpecServer(copies, { SCENITY_STUDIO_IDLE_MS: String(IDLE_MS), SCENITY_SCENE_HOST_DRAFTS: "1" });
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** The keys of the open projects of the host. */
async function openKeys(): Promise<string[]> {
  const answer = await server?.fetch("/api/state");
  const body = (await answer?.json()) as { open?: { key: string }[] } | undefined;
  return (body?.open ?? []).map((project) => project.key).sort();
}

/** Open the editor page of a project and wait for its first frame. */
async function openEditor(page: Page, path: string): Promise<void> {
  await page.goto(`${server?.origin ?? ""}${path}`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

test("three projects in three tabs; the one with no window stops and comes back with its change", async ({
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the studio spec runs in Chromium");
  const keys = server?.keys ?? {};
  const pages: Page[] = [];
  for (const name of ["showroom", "characters", "walkthrough"]) {
    const page = await context.newPage();
    await openEditor(page, `/p/${keys[name] ?? name}`);
    pages.push(page);
  }
  expect(await openKeys()).toEqual(Object.values(keys).sort());
  // An unsaved move of the guide of the walkthrough: the draft goes to the host.
  const walk = pages[2];
  if (walk === undefined) throw new Error("no walkthrough page");
  const path = "/entities/guide/components/transform/position";
  expect(
    await walk.evaluate(
      (ops) => globalThis.__scenity?.apply(ops),
      [{ op: "set" as const, path, value: [1.25, 0, -3.5] }],
    ),
  ).toBeNull();
  const drafts = join(dir, "walkthrough", ".scenity/drafts.json");
  await expect
    .poll(() => (existsSync(drafts) ? readFileSync(drafts, "utf8") : ""), { timeout: 15_000 })
    .toContain("plaza.scene.json");
  // The tab of the walkthrough closes: after the idle time the project stops; the two others keep their windows.
  await walk.close();
  await expect.poll(openKeys, { timeout: IDLE_MS * 6 }).toEqual([keys.characters, keys.showroom].sort());
  // The short link opens the project again, and the draft of the host restores the move.
  const again = await context.newPage();
  await again.goto(`${server?.origin ?? ""}/p/${keys.walkthrough ?? "walkthrough"}`);
  await expect(again.locator('[data-spec="confirm.discardDraft"]')).toBeVisible(READY);
  await again.getByTestId("draft-restore").click();
  await expect
    .poll(() =>
      again.evaluate(
        () =>
          (globalThis.__scenity?.document().entities.guide?.components.transform as { position?: number[] } | undefined)
            ?.position,
      ),
    )
    .toEqual([1.25, 0, -3.5]);
  expect(await openKeys()).toEqual(Object.values(keys).sort());
});
