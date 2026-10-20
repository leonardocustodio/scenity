// SPDX-License-Identifier: Apache-2.0
/**
 * The plugin journey with a model. The runner opens a copy of the
 * showroom in an editor window of a studio host (headless Chromium). In the Plugins window the person makes the
 * plugin `bounce` with the component `bob` (two number fields: `height` and `speed`) and a system, then presses "Ask
 * the agent to write it". The person adds the behaviour to the prompt of the composer and sends it in the review
 * mode. The person answers each file write once (the review of the files). Then the checks:
 * - the system file has logic (not the stub of the wizard), and `scenity check` passes;
 * - after a reload the inspector can add `bounce.bob`;
 * - with `bob` on the ottoman, the play mode moves the ottoman up and down.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copySample, SCENITY } from "./project";
import { editorBrowser, hostApi, hostSecret, startHost, waitForSession, type Browser, type Page } from "./studio";

/** The script API of the editor window that the journeys use. */
export interface ScenityPage {
  readonly __scenity?: {
    command(id: string, args?: object): unknown;
    save(): Promise<unknown>;
    apply(ops: readonly object[]): string | null;
    frame(): Promise<unknown>;
    time?(): number;
    stopPlay?(): unknown;
    inspect?(): Promise<{ entities: { id: string; transform: { position: number[] } }[] } | null>;
  };
}

/** The words that the person adds to the prompt of the wizard: the behaviour of the system. */
export const BOB_BEHAVIOUR =
  "The component bob has two fields: height (metres) and speed (cycles per second). The system moves each entity " +
  "with bob up and down in the play mode: its y position is its y in the scene plus height × sin(2π × speed × t), " +
  "where t is the time of the play in seconds. The x and z positions stay.";

/** The result of the plugin journey. */
export interface PluginRun {
  readonly passed: boolean;
  readonly detail: string;
  readonly reviews: number;
  readonly costUsd: number;
  readonly durationMs: number;
}

/** Make the plugin in the Plugins window and press "Ask the agent to write it". The result is the prompt. */
async function makePlugin(page: Page): Promise<string> {
  await page.evaluate(() => (globalThis as ScenityPage).__scenity?.command("panel.open.plugins"));
  await page.fill('[data-testid="plugins-new-id"]', "bounce");
  await page.fill('[data-testid="plugins-new-component"]', "bob");
  await page.fill('[data-testid="plugins-new-field-0"]', "height");
  await page.click('[data-testid="plugins-new-add-field"]');
  await page.fill('[data-testid="plugins-new-field-1"]', "speed");
  await page.selectOption('[data-testid="plugins-new-kind-1"]', "number");
  await page.click('[data-testid="plugins-new-make"]');
  await page.waitForSelector('[data-testid="plugins-new-ask"]', { timeout: 60_000 });
  await page.click('[data-testid="plugins-new-ask"]');
  return page.evaluate(
    () => document.querySelector<HTMLTextAreaElement>('[data-testid="agent-composer"]')?.value ?? "",
  );
}

/** Reload until the inspector can add `bounce.bob` (the dev server makes the module of the plugins again). */
async function reloadWithPlugin(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.reload();
    await page.waitForSelector('canvas[data-ready="1"]', { timeout: 180_000 });
    const reason = await page.evaluate(() =>
      (globalThis as ScenityPage).__scenity?.apply([
        { op: "set", path: "/entities/ottoman/components/bounce.bob", value: { height: 0.5, speed: 1 } },
      ]),
    );
    if (reason === null) return true;
  }
  return false;
}

/** The y of the ottoman at two times of the play mode, after `from` and `to` ms. */
async function playHeights(page: Page, from: number, to: number): Promise<[number, number]> {
  await page.click('[data-testid="play-start"]');
  const heightAfter = (ms: number): Promise<number> =>
    page.evaluate(async (limit) => {
      const api = (globalThis as ScenityPage).__scenity;
      for (let wait = 0; wait < 600 && (api?.time?.() ?? 0) < limit; wait += 1) await api?.frame();
      const report = await api?.inspect?.();
      return report?.entities.find((item) => item.id === "ottoman")?.transform.position[1] ?? Number.NaN;
    }, ms);
  const first = await heightAfter(from);
  const second = await heightAfter(to);
  await page.evaluate(() => (globalThis as ScenityPage).__scenity?.stopPlay?.());
  return [first, second];
}

/** Run the plugin journey. The project copy stays in `out/plugin/`. */
export async function runPlugin(minutes: number, out: string): Promise<PluginRun> {
  const start = performance.now();
  const project = copySample("showroom", join(out, "plugin"));
  const state = mkdtempSync(join(tmpdir(), "scenity-journey-plugin-"));
  const host = await startHost(state);
  let browser: Browser | null = null;
  let reviews = 0;
  let costUsd = 0;
  const result = (passed: boolean, detail: string): PluginRun => ({
    passed,
    detail,
    reviews,
    costUsd,
    durationMs: Math.round(performance.now() - start),
  });
  try {
    const api = hostApi(host.origin, hostSecret(state));
    const opened = await api<{ key: string; url: string; restricted: boolean }>("/api/projects/open", "POST", {
      dir: project.dir,
    });
    if (opened.restricted) await api("/api/projects/trust", "POST", { key: opened.key });
    const editor = await editorBrowser();
    browser = editor.browser;
    const page = editor.page;
    const { url: launch } = await api<{ url: string }>("/api/launch-code", "POST", {});
    await page.goto(launch);
    await page.goto(`${host.origin}${opened.url}`);
    await page.waitForSelector('canvas[data-ready="1"]', { timeout: 180_000 });
    const asked = await makePlugin(page);
    if (!asked.includes("bounce")) return result(false, "the composer has no prompt of the wizard");
    const made = await api<{ id: string }>("/api/agent/sessions", "POST", {
      project: opened.key,
      name: "bounce",
      mode: "review",
    });
    await api(`/api/agent/sessions/${made.id}/prompt`, "POST", { text: `${asked} ${BOB_BEHAVIOUR}` });
    const ended = await waitForSession(api, opened.key, made.id, minutes);
    reviews = ended.reviews;
    costUsd = ended.session.costUsd;
    if (ended.timedOut) return result(false, "the time limit ended the turn");
    const system = readFileSync(project.path("plugins/bounce/src/systems/bob.ts"), "utf8");
    if (system.includes("Write the logic here")) return result(false, "the system is still the stub of the wizard");
    const check = spawnSync(SCENITY[0] ?? "bun", [...SCENITY.slice(1), "check", project.dir], { encoding: "utf8" });
    if (check.status !== 0) return result(false, `scenity check failed: ${check.stdout.slice(-400)}`);
    if (!(await reloadWithPlugin(page))) return result(false, "the inspector cannot add bounce.bob after a reload");
    const [first, second] = await playHeights(page, 250, 750);
    const moved = Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) > 0.05;
    return result(moved, `the ottoman y at 0.25 s and 0.75 s: ${first.toFixed(3)}, ${second.toFixed(3)}`);
  } catch (error) {
    return result(false, error instanceof Error ? error.message : String(error));
  } finally {
    await browser?.close();
    host.child.kill("SIGTERM");
    rmSync(state, { recursive: true, force: true });
  }
}
