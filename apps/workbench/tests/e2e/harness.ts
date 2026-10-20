// SPDX-License-Identifier: Apache-2.0
/**
 * The helpers of the workbench end-to-end tests: the routes of the host in test mode (the hooks and the tools of
 * Claude Code), one request over the WebSocket of the host, the workbench page with its lab frame, and an `hmr` event.
 * The lab frame sends the `hmr` event to the page, as the bridge does after a Vite update.
 */
import { expect, type Frame, type Page } from "@playwright/test";
import { isAnswer } from "@scenity/workbench-host/protocol";
import { e2eSetup, savedLabQuery } from "./env";

/** A tool result in the shape of MCP. */
export interface ToolAnswer {
  readonly content: readonly (
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  )[];
  readonly isError?: boolean;
}

async function hostPost(path: string, body: unknown): Promise<unknown> {
  const { host } = e2eSetup();
  const response = await fetch(`${host.origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-workbench-token": host.token },
    body: JSON.stringify(body),
  });
  expect(response.status, `POST ${path}`).toBe(200);
  return response.json();
}

/** Call a hook of Claude Code (`POST /hooks/<event>`), as the `http` hooks of the generated settings do. */
export async function hostHook(event: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await hostPost(`/hooks/${event}`, { hook_event_name: event, ...payload })) as Record<string, unknown>;
}

/** Call a workbench tool (`POST /tools/<name>`), as the stdio MCP server does. */
export async function hostTool(name: string, input: Record<string, unknown> = {}): Promise<ToolAnswer> {
  return (await hostPost(`/tools/${name}`, input)) as ToolAnswer;
}

/** The context packet of the lab (`GET /context`). */
export async function hostPacket(): Promise<string> {
  const { host } = e2eSetup();
  const response = await fetch(`${host.origin}/context?surface=lab`, { headers: { "x-workbench-token": host.token } });
  return response.text();
}

/** Send one request over a new WebSocket of the host and give its result. */
export async function hostRequest(type: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const { host } = e2eSetup();
  const socket = new WebSocket(`${host.origin.replace(/^http/, "ws")}/ws?token=${host.token}`);
  try {
    return await new Promise((done, fail) => {
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ id: 1, type, ...params }));
      });
      socket.addEventListener("error", () => {
        fail(new Error("The WebSocket of the host failed."));
      });
      socket.addEventListener("message", (message) => {
        const value: unknown = JSON.parse(String(message.data));
        if (!isAnswer(value) || value.id !== 1) return;
        if (value.ok) done(value.result);
        else fail(new Error(value.error));
      });
    });
  } finally {
    socket.close();
  }
}

/** Open the workbench page on the host of the test, and wait until the lab frame answers the host. */
export async function openWorkbench(page: Page): Promise<void> {
  const { host, page: origin } = e2eSetup();
  await page.goto(`${origin}/?host=${encodeURIComponent(host.origin)}#token=${host.token}`);
  await expect(page.getByTestId("workspace")).toBeVisible({ timeout: 30_000 });
  // The lab frame of this page answers the host. The host forgets the frames of a page that closed.
  const console = async (): Promise<string> => toolText(await hostTool("lab_console", { clear: false }));
  await expect.poll(console, { timeout: 60_000, intervals: [500] }).not.toContain("did not answer");
  // The packet names the frame when the bridge of the lab answers the host through the page.
  // The packet names the time of a drawn frame and its members (not "On screen at ? ms" before the first frame).
  await expect.poll(hostPacket, { timeout: 60_000, intervals: [500] }).toMatch(/On screen at \d+ ms:\n {2}\S/);
}

/** The lab frame of the page. */
export async function labFrame(page: Page): Promise<Frame> {
  const element = await page.locator('[data-surface-tab="lab"] [data-testid="surface-frame-visible"]').elementHandle();
  const frame = await element.contentFrame();
  if (frame === null) throw new Error("The page has no lab frame.");
  return frame;
}

/** The calls of the lab script API (apps/editor/src/core/useLabApi.ts) that `labAtSavedFrame` uses. */
interface LabReset {
  select(target: string | null): void;
  open(key: string, options?: { play?: boolean }): boolean;
  pause(): void;
  seek(ms: number): void;
  camera(view: string | null): void;
  frame(): Promise<unknown>;
}

/**
 * Set the lab frame to the frame of the saved lab URL of the global setup (`savedLabQuery` of env.ts): its take and
 * its time, the overview camera, no selection. The host keeps the lab URL of an earlier spec. For example, a spec
 * leaves an open item at 2.5 s, and another spec leaves another camera. A spec that picks a pixel calls this first.
 */
export async function labAtSavedFrame(frame: Frame): Promise<void> {
  const query = new URLSearchParams(savedLabQuery());
  const saved = { take: query.get("take"), t: Number(query.get("t") ?? 0) };
  await frame.evaluate(async ({ take, t }) => {
    const lab = (globalThis as unknown as { __room3dLab: LabReset }).__room3dLab;
    lab.select(null);
    // The item of the take closes the item of an earlier spec and sets the whole take as the window of the clock.
    if (take !== null && !lab.open(`take:${take}`, { play: false }))
      throw new Error(`The lab has no item take:${take}.`);
    lab.pause();
    lab.seek(t);
    lab.camera("overview");
    await lab.frame();
  }, saved);
}

/**
 * Send an `hmr` event from the lab frame to the page, as the bridge does after a Vite update (workbenchEvents.ts).
 * The page relays it to the host: the wait of the after picture ends.
 */
export async function injectHmr(page: Page, files: readonly string[]): Promise<void> {
  const frame = await labFrame(page);
  const origin = e2eSetup().page;
  await frame.evaluate(
    ({ list, target }) => {
      window.parent.postMessage({ workbench: 1, event: "hmr", files: list }, target);
    },
    { list: [...files], target: origin },
  );
}

/** The text of a tool result. */
export function toolText(result: ToolAnswer): string {
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

/** The pictures of a tool result. */
export function toolImages(result: ToolAnswer): { mimeType: string; bytes: number }[] {
  return result.content.flatMap((block) =>
    block.type === "image" ? [{ mimeType: block.mimeType, bytes: Buffer.from(block.data, "base64").length }] : [],
  );
}

/** The bytes of a picture of the host (`GET /pictures/<id>` with the token header). */
export async function hostPicture(id: string): Promise<Buffer> {
  const { host } = e2eSetup();
  const response = await fetch(`${host.origin}/pictures/${id}`, { headers: { "x-workbench-token": host.token } });
  expect(response.status, `GET /pictures/${id}`).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The pictures of the given test IDs show as object URLs of the host (decoded, with a width). No image of the page
 * has a `data:` URL.
 */
export async function expectPicturesByUrl(page: Page, testIds: readonly string[]): Promise<void> {
  for (const testId of testIds) {
    const shown = (): Promise<boolean> =>
      page
        .getByTestId(testId)
        .evaluateAll(
          (images) =>
            images.length > 0 &&
            images.every(
              (image) => image instanceof HTMLImageElement && image.src.startsWith("blob:") && image.naturalWidth > 0,
            ),
        );
    await expect.poll(shown, { timeout: 60_000, message: `the pictures of ${testId}` }).toBe(true);
  }
  const dataImages = await page.evaluate(
    () => [...document.querySelectorAll("img")].filter((image) => image.src.startsWith("data:")).length,
  );
  expect(dataImages, "images with a data: URL").toBe(0);
  expect(await page.evaluate(() => document.documentElement.outerHTML.includes("data:image/"))).toBe(false);
}
