// SPDX-License-Identifier: Apache-2.0
/**
 * The pictures of a project with no editor window. The call `shadow.frame` of an agent goes to a window when one is
 * open. With no window, `scenity shot` of the project draws the picture in a warm page of the scene pool. The host
 * starts the pool (`scenity pool start --pages 1`) at the first picture and keeps it until the host stops. Thus the
 * next pictures load no browser. The answer has the form of the answer of a window on the bridge
 * socket: the bytes of the picture are `{ $bytes: <base64> }` (the tools revive them, `reviveBytes`).
 *
 * With a time, the picture shows the first sequence of the project (a window shows its open sequence). With no time,
 * it shows the first scene. A picture of the pool shows the project files on the disk. Thus it does not show an unsaved
 * edit of a window.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BridgeCapture, ShadowFrameRequest } from "@scenity/bridge";

/** A capture in the form of the bridge socket: the bytes as base64. */
export type WireCapture = Omit<BridgeCapture, "bytes"> & { readonly bytes: { readonly $bytes: string } };
import type { Subprocess } from "bun";

/** The ready line of `scenity pool start`. */
const POOL_READY = "SCENITY_POOL_READY";
/** The wait for the pool to start (ms). */
const POOL_START_MS = 60_000;

export interface PoolFramesOptions {
  /** The command line of the `scenity` CLI. */
  readonly cli: readonly string[];
  /** The folder of a project, or null. */
  dirOf(project: string): string | null;
  /** The folder of the pictures. */
  readonly tmp: string;
  readonly log?: (line: string) => void;
}

/** The width and the height of a PNG file (its IHDR chunk). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The arguments of `scenity shot` for a request of a project. */
export function shotArgs(dir: string, request: ShadowFrameRequest, out: string): string[] {
  const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as { sequences?: string[] };
  const sequence = request.t === undefined ? undefined : project.sequences?.[0];
  if (request.t !== undefined && sequence === undefined) {
    throw new Error("shadow.frame: the project has no sequence, so the picture takes no time; give a camera only.");
  }
  const width = request.width ?? 960;
  return [
    "shot",
    "--project",
    dir,
    ...(sequence === undefined ? [] : ["--sequence", sequence, "--at", String(Math.round(request.t ?? 0))]),
    ...(request.camera === undefined ? [] : ["--camera", request.camera]),
    "--size",
    `${String(width)}x${String(Math.round(width * 0.625))}`,
    "--out",
    out,
    "--json",
  ];
}

/** The pictures of the scene pool for the projects with no window. */
export class PoolFrames {
  readonly #options: PoolFramesOptions;
  #pool: Subprocess | null = null;
  #ready: Promise<void> | null = null;
  #count = 0;

  constructor(options: PoolFramesOptions) {
    this.#options = options;
  }

  /** Start the pool once; a pool that does not start leaves the pictures to the own browser of `scenity shot`. */
  #warm(): Promise<void> {
    this.#ready ??= (async () => {
      const pool = Bun.spawn([...this.#options.cli, "pool", "start", "--pages", "1"], {
        stdout: "pipe",
        stderr: "ignore",
      });
      this.#pool = pool;
      const reader = pool.stdout.getReader();
      const until = Date.now() + POOL_START_MS;
      let text = "";
      while (!text.includes(POOL_READY) && Date.now() < until) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      reader.releaseLock();
      this.#options.log?.(text.includes(POOL_READY) ? "the scene pool runs" : "the scene pool did not start");
    })();
    return this.#ready;
  }

  /** A picture of a project with no window, as the answer of `shadow.frame`. */
  async frame(project: string, request: ShadowFrameRequest): Promise<WireCapture> {
    const dir = this.#options.dirOf(project);
    if (dir === null) throw new Error(`no project ${project} is open in the studio`);
    await this.#warm();
    mkdirSync(this.#options.tmp, { recursive: true });
    this.#count += 1;
    const out = join(this.#options.tmp, `frame-${String(this.#count)}.png`);
    const shot = Bun.spawn([...this.#options.cli, ...shotArgs(dir, request, out)], { stdout: "pipe", stderr: "pipe" });
    const code = await shot.exited;
    if (code !== 0 || !existsSync(out)) {
      const words = (await new Response(shot.stdout).text()).trim().split("\n").at(-1) ?? "";
      throw new Error(`shadow.frame: no window is open, and scenity shot failed: ${words}`);
    }
    const bytes = new Uint8Array(readFileSync(out));
    rmSync(out, { force: true });
    const $bytes = Buffer.from(bytes).toString("base64");
    return { simMs: request.t ?? null, ...pngSize(bytes), mime: "image/png", bytes: { $bytes } };
  }

  /** Stop the pool of the host. */
  stop(): void {
    this.#pool?.kill();
    this.#pool = null;
    this.#ready = null;
  }
}
