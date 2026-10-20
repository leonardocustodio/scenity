// SPDX-License-Identifier: Apache-2.0
// The Hub of Scenity Studio on the scene page build: a picture baseline of each state
// (no projects, the project marks, a failed create with its log, the first run) and the axe checks of the page in the
// four theme variants. A fake of the studio host API answers the requests (page.route); the page has no host.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "en-US", timezoneId: "UTC" });

const PREFERENCES = {
  format: "scenity.studio-preferences/1",
  theme: "dark",
  contrast: "standard",
  locale: "en-US",
  recentCount: 8,
  autosave: true,
  firstRunDone: true,
  editor: {},
  agent: { mode: "review", budgetUsd: 5 },
  importedKeys: [],
};

function project(key: string, change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key,
    dir: `/home/me/work/${key}`,
    name: key,
    lastOpened: "2026-10-01T10:00:00.000Z",
    pinned: false,
    exists: true,
    id: key,
    format: "scenity.project/1",
    newer: false,
    scenes: 2,
    picture: null,
    git: null,
    trusted: true,
    runsCode: false,
    ...change,
  };
}

const PROJECTS = [
  project("courtyard", { pinned: true, git: { branch: "main", changed: 3 } }),
  project("old-demo", { exists: false }),
  project("future", { newer: true, format: "scenity.project/9" }),
  project("plugin-lab", { runsCode: true, trusted: false }),
];

const CHECKS = [
  { id: "bun", state: "ok", detail: "Bun 1.4.2", needed: "the studio", fix: null },
  { id: "claude", state: "ok", detail: "2.1.0 (Claude Code)", needed: "the built-in agent", fix: null },
];

interface Fake {
  readonly projects?: readonly unknown[];
  readonly preferences?: Record<string, unknown>;
  readonly failCreate?: boolean;
}

/** Answer the API of the studio host with fixed data. */
async function fakeHost(page: Page, fake: Fake = {}): Promise<void> {
  const state = {
    origin: "http://127.0.0.1:5170",
    safe: false,
    preferences: { ...PREFERENCES, ...fake.preferences },
    projects: fake.projects ?? [],
    open: [],
    roots: ["/home/me"],
    checkout: true,
  };
  const job = { id: "job-1", command: "create", cwd: "/home/me", exitCode: 1, outputs: [] };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const answers: Record<string, unknown> = {
      "/api/state": state,
      "/api/doctor": CHECKS,
      "/api/user/preferences": state.preferences,
      "/api/jobs": { ...job, state: "running" },
      "/api/jobs/job-1": {
        job: { ...job, state: fake.failCreate === true ? "failed" : "done" },
        log: ["Make the project folder demo", "error: the folder demo is not empty"],
      },
    };
    return route.fulfill({ json: answers[path] ?? {} });
  });
}

async function openHub(page: Page, fake?: Fake): Promise<void> {
  await fakeHost(page, fake);
  await page.goto("/hub.html");
  await expect(page.getByTestId("hub")).toBeVisible();
  await expect(page.getByTestId("hub-agent-state")).toHaveAttribute("data-state", "ok");
}

test("no projects yet", async ({ page }) => {
  await openHub(page);
  await expect(page.getByTestId("hub-projects-empty")).toBeVisible();
  await expect(page).toHaveScreenshot("hub-empty.png");
});

test("the projects with their marks", async ({ page }) => {
  await openHub(page, { projects: PROJECTS });
  await expect(page.locator("[data-project]")).toHaveCount(4);
  await expect(page).toHaveScreenshot("hub-projects.png");
  await page.getByRole("button", { name: "List" }).click();
  await expect(page).toHaveScreenshot("hub-projects-list.png");
});

test("a failed create with its log and a retry", async ({ page }) => {
  await openHub(page, { failCreate: true });
  await page.getByTestId("hub-new-project").click();
  await page.getByTestId("wizard-name").fill("demo");
  await expect(page.getByTestId("new-project")).toBeVisible();
  await page.getByTestId("wizard-make").click();
  await expect(page.getByTestId("wizard-log")).toContainText("is not empty", { timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page).toHaveScreenshot("hub-create-failed.png");
});

test("the first run", async ({ page }) => {
  await openHub(page, { preferences: { firstRunDone: false } });
  await expect(page.getByTestId("first-run")).toBeVisible();
  await expect(page).toHaveScreenshot("hub-first-run.png");
});

for (const variant of [
  { theme: "dark", contrast: "standard" },
  { theme: "light", contrast: "standard" },
  { theme: "navy", contrast: "standard" },
  { theme: "dark", contrast: "more" },
]) {
  test(`axe: no violations in ${variant.theme}/${variant.contrast}`, async ({ page }) => {
    await openHub(page, { projects: PROJECTS, preferences: variant });
    await expect(page.locator("body")).toHaveAttribute("data-theme", variant.theme);
    // The colours change with a transition after the theme: the check reads the colours at the end of it.
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}
