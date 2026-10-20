// SPDX-License-Identifier: Apache-2.0
/**
 * The pictures of the player page: `scenity shot`, `scenity sheet` and `scenity clip` open the page of page/serve.ts,
 * wait for the first frame with every asset, set the clock and take screenshots of the player element until two in
 * sequence are equal (the rule of `toHaveScreenshot` of the gallery).
 */
import type { Page } from "@playwright/test";
import { PAGE_SETTLED, PAGE_STATE } from "./serve";

/** The longest wait for the first frame with every asset (the gallery waits 30 s on a loaded machine). */
export const READY_MS = 120_000;
/** The most screenshots for two equal screenshots in sequence. */
const STABLE_TRIES = 6;

/** The backend and the path of the player that drew the page. */
export interface DrawnBy {
  readonly backend: string | null;
  readonly renderer: string | null;
}

/** Screenshots of the player element until two in sequence are equal (as `toHaveScreenshot`). */
export async function stableShot(page: Page): Promise<Buffer> {
  const player = page.locator("scenity-player");
  const take = () => player.screenshot({ animations: "disabled", caret: "hide", scale: "css" });
  let last = await take();
  for (let index = 1; index < STABLE_TRIES; index += 1) {
    const next = await take();
    if (next.equals(last)) return next;
    last = next;
  }
  throw new Error(`the picture did not stay the same in ${String(STABLE_TRIES)} screenshots`);
}

/** The clock of the `<scenity-player>` element. */
interface Seekable {
  seek(ms: number): Promise<void>;
  readonly currentTime: number;
}

/** Open the player page and wait for its first frame with every asset. Throws the error of the page. */
export async function openPlayer(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(PAGE_SETTLED, undefined, { timeout: READY_MS });
  const state = await page.evaluate<{ ready: number | null; error: string | null }>(PAGE_STATE);
  if (state.ready === null) throw new Error(state.error ?? "no first frame");
}

/** Set the clock of the player to a time, and check that it stands there. */
export async function seekPlayer(page: Page, at: number): Promise<void> {
  const time = await page.evaluate(async (ms) => {
    const element = document.querySelector("scenity-player") as unknown as Seekable;
    await element.seek(ms);
    return element.currentTime;
  }, at);
  if (time !== at) throw new Error(`the player stands at ${String(time)} ms, not at ${String(at)} ms`);
}

/** The backend and the path of the player of the page (`data-backend`, `data-renderer`). */
export function drawnBy(page: Page): Promise<DrawnBy> {
  return page.evaluate(() => {
    const element = document.querySelector("scenity-player");
    const backend = element?.getAttribute("data-backend") ?? null;
    return { backend, renderer: element?.getAttribute("data-renderer") ?? null };
  });
}

/** The first line of the message of an error. */
export function errorLine(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "error") : String(error);
}
