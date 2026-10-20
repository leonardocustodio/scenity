// SPDX-License-Identifier: Apache-2.0
/**
 * The start journey with a model: start from a sentence. For each prompt the
 * runner starts a studio host with a work folder of its own and opens the Hub in a headless Chromium. It types the
 * words in the new project wizard and presses "Start from the prompt". The agent chooses the template and the name,
 * the wizard makes the project, and the editor window sends the words to a new session in the review mode. When the
 * turn ends, the first scene must wait as a change set. The person accepts it and saves. The check reads the saved
 * scene: each part of the words must be there (an entity name or ID that matches, enough times).
 *
 * The target: the journey passes for 4 of the 5 prompts.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScenityPage } from "./journeyPlugin";
import {
  editorBrowser,
  hostApi,
  hostSecret,
  startHost,
  waitForSession,
  type Browser,
  type Page,
  type SessionView,
} from "./studio";

/** A part of the words: a name pattern and the number of entities that must match it. */
export interface StartPart {
  readonly pattern: RegExp;
  readonly count: number;
}

/** A prompt of the start journey and the parts that its first scene must have. */
export interface StartPrompt {
  readonly id: string;
  readonly words: string;
  readonly parts: readonly StartPart[];
}

/** The five prompts of the start journey. The first one is the museum example. */
export const START_PROMPTS: readonly StartPrompt[] = [
  {
    id: "museum",
    words: "a small museum room with three statues on plinths",
    parts: [
      { pattern: /statue|sculpture|bust/i, count: 3 },
      { pattern: /plinth|pedestal|base/i, count: 3 },
    ],
  },
  {
    id: "reading-corner",
    words: "a cosy reading corner with an armchair, a floor lamp and a bookshelf",
    parts: [
      { pattern: /armchair|chair/i, count: 1 },
      { pattern: /lamp|light/i, count: 1 },
      { pattern: /shelf|bookcase/i, count: 1 },
    ],
  },
  {
    id: "dining",
    words: "a dining room with one long table and six chairs around it",
    parts: [
      { pattern: /table/i, count: 1 },
      { pattern: /chair/i, count: 6 },
    ],
  },
  {
    id: "garden",
    words: "a little garden with two trees, a bench and a path",
    parts: [
      { pattern: /tree/i, count: 2 },
      { pattern: /bench/i, count: 1 },
      { pattern: /path|walk/i, count: 1 },
    ],
  },
  {
    id: "parking",
    words: "a parking lot with four cars in a row and a lamp post",
    parts: [
      { pattern: /car|vehicle/i, count: 4 },
      { pattern: /lamp|light|post/i, count: 1 },
    ],
  },
];

/** The entities of a scene document as `id name` texts. */
function entityTexts(scene: { readonly entities?: Record<string, { readonly name?: string }> }): string[] {
  return Object.entries(scene.entities ?? {}).map(([id, entity]) => `${id} ${entity.name ?? ""}`);
}

/** The parts that a scene does not have (empty: the check passes). */
export function missingParts(scene: object, prompt: StartPrompt): string[] {
  const texts = entityTexts(scene);
  return prompt.parts
    .map((part) => ({ part, found: texts.filter((text) => part.pattern.test(text)).length }))
    .filter(({ part, found }) => found < part.count)
    .map(({ part, found }) => `${part.pattern.source}: ${String(found)} of ${String(part.count)}`);
}

/** The result of one prompt. */
export interface StartRun {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
  readonly project: string | null;
  readonly waiting: string;
  readonly costUsd: number;
  readonly durationMs: number;
}

/** The text of the review item of the status bar ("3 changes wait"), or "". */
function reviewText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('[data-testid="status-review"]')?.textContent ?? "");
}

/** Run the start journey for one prompt. The new project stays in `out/<prompt>/`. */
export async function runStart(prompt: StartPrompt, minutes: number, out: string): Promise<StartRun> {
  const start = performance.now();
  const work = join(out, prompt.id);
  mkdirSync(work, { recursive: true });
  const state = mkdtempSync(join(tmpdir(), "scenity-journey-start-"));
  const host = await startHost(state, ["--root", work]);
  let browser: Browser | null = null;
  const result = (passed: boolean, detail: string, extra: Partial<StartRun> = {}): StartRun => ({
    id: prompt.id,
    passed,
    detail,
    project: null,
    waiting: "",
    costUsd: 0,
    durationMs: Math.round(performance.now() - start),
    ...extra,
  });
  try {
    const api = hostApi(host.origin, hostSecret(state));
    const editor = await editorBrowser();
    browser = editor.browser;
    const page = editor.page;
    const { url: launch } = await api<{ url: string }>("/api/launch-code", "POST", {});
    await page.goto(launch);
    // The first run, then the wizard with the words.
    await page.click('[data-testid="first-skip"]', { timeout: 60_000 });
    await page.click('[data-testid="hub-new-project"]');
    await page.fill('[data-testid="wizard-words"]', prompt.words);
    await page.click('[data-testid="wizard-start"]');
    await page.waitForURL(/[?&]project=[^&]+/, { timeout: minutes * 60_000 });
    await page.waitForSelector('canvas[data-ready="1"]', { timeout: 180_000 });
    // The key of the new project on the host, and the session of the first scene (the window sends its prompt).
    const name = new URL(page.url()).searchParams.get("project") ?? "";
    const hostState = await api<{ open: readonly { key: string; dir: string }[] }>("/api/state");
    const key = hostState.open.find((item) => item.dir.endsWith(`/${name}`))?.key ?? name;
    let id = "";
    for (let wait = 0; wait < 120 && id === ""; wait += 1) {
      const list = await api<{ sessions: SessionView[] }>(`/api/agent/sessions?project=${key}`);
      id =
        list.sessions.find((item) => item.items.some((entry) => entry.text?.startsWith("Build the first scene")))?.id ??
        "";
      if (id === "") await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (id === "") return result(false, "no session of the first scene", { project: key });
    const { session, timedOut } = await waitForSession(api, key, id, minutes);
    writeFileSync(join(out, `${prompt.id}.jsonl`), session.items.map((item) => JSON.stringify(item)).join("\n"));
    const waiting = await reviewText(page);
    const extra = { project: key, waiting, costUsd: session.costUsd };
    if (timedOut) return result(false, "the time limit ended the turn", extra);
    if (!/\d/.test(waiting)) return result(false, "no change set waits for review", extra);
    // The person accepts the change set and saves.
    await page.evaluate(() => (globalThis as ScenityPage).__scenity?.command("proposal.acceptAll"));
    await page.evaluate(() => (globalThis as ScenityPage).__scenity?.save());
    const folder = join(work, key);
    const project = JSON.parse(readFileSync(join(folder, "scenity.project.json"), "utf8")) as { scenes?: string[] };
    const scene = JSON.parse(readFileSync(join(folder, project.scenes?.[0] ?? ""), "utf8")) as object;
    const missing = missingParts(scene, prompt);
    return result(missing.length === 0, missing.length === 0 ? "each part is there" : missing.join("; "), extra);
  } catch (error) {
    return result(false, error instanceof Error ? error.message : String(error));
  } finally {
    await browser?.close();
    host.child.kill("SIGTERM");
    rmSync(state, { recursive: true, force: true });
  }
}
