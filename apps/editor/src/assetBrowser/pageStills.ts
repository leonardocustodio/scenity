// SPDX-License-Identifier: Apache-2.0
/**
 * The stills that the editor page draws: a hidden frame opens the still page (still.html) for one asset, waits for
 * its view, and takes the WebP picture with the capture values of the stills script
 * (`stillCapture.ts`). The dev server then writes the still and its stamp (scripts/stillsApiServer.ts).
 */
import type { StillPageApi } from "../still/main";
import { STILL_QUALITY, STILL_SCALE } from "../still/stillCapture";
import type { StillJobInfo } from "./assetTypes";

/** The longest wait for the view of the still page (ms). */
const STILL_TIMEOUT = 60_000;

/** The name of the project of a source base (`.../projects/<name>/`), or null. */
export function projectOfBase(base: string): string | null {
  return /\/projects\/([a-z0-9-]+)\/$/.exec(base)?.[1] ?? null;
}

/** The URL of the still page for one still of the stills plan. */
export function stillPageUrl(project: string, job: StillJobInfo): string {
  const query = new URLSearchParams({
    project,
    mode: job.mode,
    asset: job.id,
    file: job.input ?? "",
    width: String(job.width),
    height: String(job.height),
  });
  return `/still.html?${query.toString()}`;
}

/** The bytes of a base64 text. */
function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Wait for the view of the still page in a frame: the API of the page, or the error of the page. */
async function viewOf(frame: HTMLIFrameElement): Promise<StillPageApi> {
  const end = performance.now() + STILL_TIMEOUT;
  while (performance.now() < end) {
    const canvas = frame.contentDocument?.querySelector<HTMLCanvasElement>("#still");
    const error = canvas?.dataset.error;
    if (error !== undefined) throw new Error(error);
    // The window of the frame is the window of another page: its script API is not in the types of this page.
    const view = frame.contentWindow as unknown as { readonly __scenityStill?: StillPageApi } | null;
    const api = view?.__scenityStill;
    if (canvas?.dataset.ready === "1" && api !== undefined) return api;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the still page did not draw");
}

/** Draw one still of the stills plan in a hidden frame. Returns the WebP bytes. */
export async function drawStill(project: string, job: StillJobInfo): Promise<Uint8Array<ArrayBuffer>> {
  if (job.input === null) throw new Error(job.problem ?? "no file to draw");
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.dataset.testid = "asset-still-frame";
  Object.assign(frame.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${String(job.width * STILL_SCALE)}px`,
    height: `${String(job.height * STILL_SCALE)}px`,
    border: "0",
  });
  frame.src = stillPageUrl(project, job);
  document.body.append(frame);
  try {
    const api = await viewOf(frame);
    return bytesOf(await api.capture(STILL_QUALITY));
  } finally {
    frame.remove();
  }
}
