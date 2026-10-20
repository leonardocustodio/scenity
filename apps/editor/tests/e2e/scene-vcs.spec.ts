// SPDX-License-Identifier: Apache-2.0
// The version control panel on a Git repository. The spec copies the walkthrough sample into a new repository in a
// temp folder and starts the dev server of the scene page on it. A save of a moved entity shows in the panel with its
// semantic diff. The owner commits it, and a switch goes to another branch. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-vcs --project=chromium --workers=1
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const WALKTHROUGH = join(LABS_ROOT, "../../samples/walkthrough");
const READY = { timeout: 60_000 };
const SCENE = "scenes/plaza.scene.json";
const IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";
const git = (...args: string[]): string => execFileSync("git", [...IDENTITY, ...args], { cwd: dir, encoding: "utf8" });

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-vcs-"));
  for (const part of ["assets", "build", "rights", "scenes", "sequences", "scenity.project.json"])
    cpSync(join(WALKTHROUGH, part), join(dir, part), { recursive: true });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "The walkthrough");
  git("branch", "agent/try");
  server = await startSpecServer(
    { walk: dir },
    {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  );
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

test("a saved edit shows with its semantic diff, the owner commits it and switches the branch", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=${SCENE}`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.vcs"));
  const panel = page.getByTestId("vcs");
  await expect(panel).toHaveAttribute("data-git", "1", READY);
  await expect(panel.getByTestId("vcs-branch")).toHaveText("main");
  await expect(panel.locator("[data-testid=vcs-files] li")).toHaveCount(0);
  // An edit and a save of the page: the panel loads again and shows the diff of the scene file.
  const path = "/entities/bench/components/transform/position";
  expect(
    await page.evaluate(
      (ops) => globalThis.__scenity?.apply(ops),
      [{ op: "set" as const, path, value: [-0.5, 0.23, -2.1] }],
    ),
  ).toBeNull();
  expect((await page.evaluate(() => globalThis.__scenity?.save()))?.ok).toBe(true);
  await expect(panel.locator(`[data-path="${SCENE}"]`)).toBeVisible();
  const field = panel.locator("[data-entity=bench] [data-field='transform.position']");
  await expect(field).toContainText("(-0.5, 0.23, -2.1)");
  await panel.getByTestId("vcs-show-patch").check();
  await expect(panel.getByTestId("vcs-patch").locator("[data-kind=add]").first()).toBeVisible();
  // The owner commits the scene file.
  await panel.getByTestId(`vcs-pick-${SCENE}`).check();
  await panel.getByTestId("vcs-message").fill("Move the bench");
  await panel.getByTestId("vcs-commit").click();
  await expect(panel.getByTestId("vcs-notice")).toContainText("Committed");
  expect(git("log", "-1", "--format=%s")).toBe("Move the bench\n");
  await expect(panel.locator("[data-testid=vcs-files] li")).toHaveCount(0);
  // The branches: a switch to the other branch.
  await expect(panel.locator("[data-branch=main]")).toHaveAttribute("data-current", "1");
  await panel.getByTestId("vcs-switch-agent/try").click();
  await expect(panel.getByTestId("vcs-branch")).toHaveText("agent/try");
  expect(git("branch", "--show-current")).toBe("agent/try\n");
});
