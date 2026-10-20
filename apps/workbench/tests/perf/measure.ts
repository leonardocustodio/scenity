// SPDX-License-Identifier: Apache-2.0
/**
 * The measurements of the workbench performance run (run.ts): the frame statistics of the lab (as `labs perf`), the
 * CPU of a process, the sizes of the captures, the time of `lab_frame` and the time from an edit hook to the after
 * picture.
 */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import type { Frame, Page } from "@playwright/test";
import { isEvent, type HostEndpoint, type HostEvent } from "@scenity/workbench-host/protocol";
import { hostHook, hostRequest, hostTool, toolImages } from "../e2e/harness";

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The frame statistics of one window: the fields of `Room3DStats` that the record compares. */
export interface FrameStats {
  readonly fps: number;
  readonly intervalP50: number;
  readonly intervalP95: number;
  readonly workP50: number;
  readonly workP95: number;
  readonly gpuP95: number | null;
  readonly canvas: string;
  /** The size of the window or frame of the page (css px), when the run gives it. */
  readonly frame?: string;
}

/** The p50 and the p95 of a list of numbers. */
export function percentiles(values: readonly number[]): { p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0 };
}

/** Wait until the lab of a frame drew its scene. */
export async function labReady(frame: Frame): Promise<void> {
  await frame.waitForFunction(() => "__room3dLab" in globalThis, undefined, { timeout: 60_000 });
  await frame.evaluate(async () => {
    const lab = (globalThis as unknown as { __room3dLab: { frame(ms: number): Promise<unknown> } }).__room3dLab;
    await lab.frame(60_000);
  });
}

/** Play, wait 3 s, measure the statistics for 8 s, then pause (the method of `labs perf`). */
export async function frameStats(frame: Frame): Promise<FrameStats> {
  return frame.evaluate(async () => {
    interface Stats {
      frames: number;
      intervalP50: number;
      intervalP95: number;
      workP50: number;
      workP95: number;
      gpu?: { p95: number } | null;
    }
    interface Lab {
      play(): void;
      pause(): void;
      stats(reset: boolean): Promise<Stats | null>;
    }
    const lab = (globalThis as unknown as { __room3dLab: Lab }).__room3dLab;
    const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
    lab.play();
    await wait(3_000);
    await lab.stats(true);
    const start = performance.now();
    await wait(8_000);
    const stats = await lab.stats(false);
    const seconds = (performance.now() - start) / 1000;
    lab.pause();
    if (stats === null) throw new Error("The lab gave no statistics.");
    const canvas = document.querySelector("canvas");
    const round = (value: number): number => Math.round(value * 100) / 100;
    return {
      fps: round(stats.frames / seconds),
      intervalP50: round(stats.intervalP50),
      intervalP95: round(stats.intervalP95),
      workP50: round(stats.workP50),
      workP95: round(stats.workP95),
      gpuP95: stats.gpu === undefined || stats.gpu === null ? null : round(stats.gpu.p95),
      canvas: canvas === null ? "none" : `${String(canvas.clientWidth)}x${String(canvas.clientHeight)} css px`,
    };
  });
}

/** The CPU of a process over a window: the mean of `ps -o %cpu` each second and the CPU time over the wall time. */
export async function processCpu(pid: number, seconds: number): Promise<{ meanPercent: number; cpuPercent: number }> {
  const read = (): { percent: number; cpuSeconds: number } => {
    const out = execFileSync("ps", ["-o", "%cpu=,time=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const [percent = "0", time = "0:0"] = out.split(/\s+/);
    const parts = time.split(":").map(Number);
    const cpuSeconds = parts.reduce((total, part) => total * 60 + part, 0);
    return { percent: Number(percent), cpuSeconds };
  };
  const first = read();
  const start = performance.now();
  const samples: number[] = [];
  for (let index = 0; index < seconds; index += 1) {
    await sleep(1_000);
    samples.push(read().percent);
  }
  const wall = (performance.now() - start) / 1000;
  const used = read().cpuSeconds - first.cpuSeconds;
  const mean = samples.reduce((total, value) => total + value, 0) / Math.max(1, samples.length);
  return { meanPercent: Math.round(mean * 100) / 100, cpuPercent: Math.round((used / wall) * 10_000) / 100 };
}

/**
 * The sizes of one capture at a width: WebP at the bridge quality (0.92), lossless WebP (quality 1), and PNG of the
 * same pixels (the lossless WebP decoded and encoded again). The page sends the bridge call into the lab frame.
 */
export async function captureSizes(
  page: Page,
  width: number,
): Promise<{ webp: number; lossless: number; png: number }> {
  return page.evaluate(async (size) => {
    const frame = document.querySelector<HTMLIFrameElement>(
      '[data-surface-tab="lab"] iframe[data-frame="lab-visible"]',
    );
    const target = frame?.contentWindow;
    if (frame === null || target === null || target === undefined) throw new Error("No lab frame.");
    const origin = new URL(frame.src).origin;
    let next = 900_000;
    // The bridge gives the bytes as an ArrayBuffer.
    const call = (args: unknown[]): Promise<{ bytes: ArrayBuffer; mime: string }> =>
      new Promise((done, fail) => {
        const id = (next += 1);
        const listen = (event: MessageEvent<{ workbench?: number; id?: number; result?: unknown; error?: string }>) => {
          if (event.source !== target || event.data.id !== id) return;
          removeEventListener("message", listen);
          if (typeof event.data.error === "string") fail(new Error(event.data.error));
          else done(event.data.result as { bytes: ArrayBuffer; mime: string });
        };
        addEventListener("message", listen);
        target.postMessage({ workbench: 1, id, call: "capture", args }, origin);
      });
    const webp = await call([size]);
    const lossless = await call([size, 1]);
    const bitmap = await createImageBitmap(new Blob([lossless.bytes], { type: lossless.mime }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return { webp: webp.bytes.byteLength, lossless: lossless.bytes.byteLength, png: png.size };
  }, width);
}

/** The time of `lab_frame` calls (ms) at a width, and the bytes of their pictures. */
export async function labFrameTimes(width: number, count: number): Promise<{ ms: number[]; bytes: number[] }> {
  const ms: number[] = [];
  const bytes: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    const result = await hostTool("lab_frame", { t: index % 2 === 0 ? 6000 : 9000, width });
    ms.push(Math.round(performance.now() - start));
    if (result.isError === true) throw new Error(`lab_frame failed: ${JSON.stringify(result.content)}`);
    bytes.push(toolImages(result)[0]?.bytes ?? 0);
  }
  return { ms, bytes };
}

/** A WebSocket of the host that keeps its events. */
export class HostEvents {
  readonly events: HostEvent[] = [];
  readonly #socket: WebSocket;

  constructor(endpoint: HostEndpoint) {
    this.#socket = new WebSocket(`${endpoint.origin.replace(/^http/, "ws")}/ws?token=${endpoint.token}`);
    this.#socket.addEventListener("message", (message) => {
      const value: unknown = JSON.parse(String(message.data));
      if (isEvent(value)) this.events.push(value);
    });
  }

  async wait(test: (event: HostEvent) => boolean, timeoutMs: number): Promise<HostEvent> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.find(test);
      if (found !== undefined) return found;
      if (Date.now() > end) throw new Error("No such event of the host in time.");
      await sleep(10);
    }
  }

  close(): void {
    this.#socket.close();
  }
}

export interface EditTimeOptions {
  readonly events: HostEvents;
  readonly checkout: string;
  /** The scratch file (absolute path) that the edit writes and the undo deletes. */
  readonly scratch: string;
  /** Send the `hmr` event of the file from the lab frame. */
  hmr(file: string): Promise<void>;
}

/** The time from a `PostToolUse` hook to the `agent.turn` event with the after picture (ms), for one turn. */
export async function editToAfter(options: EditTimeOptions, session: string): Promise<number> {
  const base = { session_id: session, cwd: options.checkout, transcript_path: "" };
  await hostHook("UserPromptSubmit", { ...base, prompt: "A measured turn of the performance run." });
  for (let tries = 0; tries < 300; tries += 1) {
    const result = (await hostRequest("git.turns")) as { turns: { session: string }[] };
    if (result.turns.some((turn) => turn.session === session)) break;
    await sleep(100);
  }
  writeFileSync(options.scratch, `A scratch file of the performance run (${session}).\n`);
  await sleep(300);
  const start = performance.now();
  const input = { file_path: options.scratch, content: "" };
  await hostHook("PostToolUse", { ...base, tool_name: "Write", tool_input: input });
  await options.hmr(options.scratch);
  const event = await options.events.wait(
    (item) => item.type === "agent.turn" && item.session === session && item.after !== null,
    30_000,
  );
  const ms = Math.round(performance.now() - start);
  if (event.type === "agent.turn") await hostRequest("git.undoTurn", { session, turn: event.turn });
  rmSync(options.scratch, { force: true });
  return ms;
}
