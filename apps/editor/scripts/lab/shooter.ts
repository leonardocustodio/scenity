// SPDX-License-Identifier: Apache-2.0
/**
 * The shooter of the 3D room lab tools: one browser page on the lab with a take, and a screenshot of the canvas at
 * each time and named camera. It drives the lab through its script API
 * (`globalThis.__room3dLab`, src/core/useLabApi.ts) and waits for the frame of each time (`frame`), so a
 * shot needs no retry. It also composes contact sheets and encodes WebP frames in the page.
 */
import { platform } from "node:os";
import type { Browser, Page } from "@playwright/test";
import type { CameraView } from "@scenity/runtime/framing";
import type { MetricValue } from "../../src/plugins";
import type { LabFrame } from "../../src/core/useLabApi";
import { LAB_PATH, labPageHeaders } from "./server";

export interface ShooterOptions {
  readonly origin: string;
  /** The path of the lab page (LAB_PATH; the review of an old commit gives `/dev/room3d`). */
  readonly labPath?: string;
  readonly take: string;
  /** The events of the panel after the take (the `rec` URL parameter of the lab), or none. */
  readonly rec?: string | undefined;
  /** The debug layers over the scene (the `debug` URL parameter of the lab), or none. */
  readonly debug?: string | undefined;
  /** A view track of a case of the engine in place of the take (`track:<name>`), or none. */
  readonly source?: string | undefined;
  /** False: the empty room without the team (the `team=0` URL parameter; the turntable of a prop). */
  readonly team?: boolean | undefined;
  readonly tier: string;
  /** The render worker (true) or the main-thread core (false: a screenshot always reads its canvas). */
  readonly worker: boolean;
  /** The glTF characters and models (true) or the graybox (false). */
  readonly assets: boolean;
  readonly width: number;
  readonly height: number;
  /**
   * More parameters of the lab URL (for example `tune` or `backend`), or none. A job of the render pool gives them.
   */
  readonly extra?: Readonly<Record<string, string>> | undefined;
}

export interface Shot {
  readonly png: Buffer;
  readonly simMs: number | null;
  readonly camera: string;
  readonly frame: LabFrame;
  /** The motion metrics of the frame. */
  readonly metrics: readonly MetricValue[];
}

/** The query of the lab page for a fixed frame of a take: no panel, no dock, no cards, no frame rate readout. */
export function labQuery(options: ShooterOptions, simMs: number, camera: string): URLSearchParams {
  const query = new URLSearchParams({
    take: options.take,
    freeze: String(Math.round(simMs)),
    panel: "0",
    dock: "0",
    worker: options.worker ? "1" : "0",
    tier: options.tier,
    assets: options.assets ? "1" : "0",
  });
  if (camera !== "overview") query.set("camera", camera);
  if (options.rec !== undefined) query.set("rec", options.rec);
  if (options.debug !== undefined) query.set("debug", options.debug);
  if (options.source !== undefined) query.set("source", options.source);
  if (options.team === false) query.set("team", "0");
  for (const [name, value] of Object.entries(options.extra ?? {})) if (!query.has(name)) query.set(name, value);
  return query;
}

/** The clip lanes under a sheet: the range of the sheet and a row of parts per member. */
export interface SheetLanes {
  readonly from: number;
  readonly to: number;
  readonly rows: readonly {
    readonly member: string;
    readonly parts: readonly {
      readonly label: string;
      readonly family: string;
      readonly from: number;
      readonly to: number;
      readonly clip: boolean;
    }[];
  }[];
}

/**
 * What the tools use of a shooter: the local `Shooter` of this file, or the remote shooter of a page of the
 * render pool (pool/client.ts). Both run the same `Shooter` methods on a lab page, so both give the same pictures.
 */
export interface LabShooter {
  readonly options: ShooterOptions;
  /** The lab page: only `evaluate` (a function and a JSON argument). */
  readonly page: Pick<Page, "evaluate">;
  shot(simMs: number, camera: string | CameraView): Promise<Shot>;
  sheet(
    cells: readonly { readonly png: Buffer; readonly label: string }[],
    columns: number,
    cellWidth: number,
    lanes?: SheetLanes | null,
  ): Promise<Buffer>;
  webp(png: Buffer, width: number, quality?: number): Promise<{ bytes: Buffer; width: number; height: number }>;
  close(): Promise<void>;
}

/**
 * The Chromium of the tools: the GPU of the machine (Metal on macOS). Linux uses the default (SwiftShader). On macOS
 * the new headless mode (channel "chromium") has the WebGPU adapter, so a lab page of the tools and of the render pool
 * draws WebGPU by the shared rule. `backend=webgl` in a URL still draws WebGL.
 */
export async function launchShooterBrowser(): Promise<Browser> {
  const mac = platform() === "darwin";
  const args = mac ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [];
  // Playwright loads only for a browser of its own (about 0.45 s). A tool with the render pool needs no browser.
  const { chromium } = await import("@playwright/test");
  return chromium.launch(mac ? { channel: "chromium", args } : { args });
}

/** The options of the page of a shooter (`browser.newPage` or `browser.newContext`). */
export function shooterPageOptions(options: ShooterOptions) {
  return {
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
    serviceWorkers: "block" as const,
    // The secret of a dev server of the tools lets the page pass the page key gate of the lab page.
    extraHTTPHeaders: labPageHeaders(options.origin),
  };
}

/** Load the lab with the take at `simMs` and `camera` in a page, and wait until its script API is available. */
export async function loadLab(page: Page, options: ShooterOptions, simMs: number, camera: string): Promise<void> {
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    await page.goto(`${options.origin}${options.labPath ?? LAB_PATH}?${labQuery(options, simMs, camera).toString()}`);
    await page.waitForFunction(() => globalThis.__room3dLab !== undefined, undefined, { timeout: 60_000 });
    if (errors.length > 0) throw new Error(`The lab page failed: ${errors.join("; ")}`);
  } finally {
    page.off("pageerror", onError);
  }
  // Only the canvas: the buttons of the lab are on the scene too. The style applies before the first shot, so a
  // change of the page cannot occur between the frame of that shot and its screenshot.
  await page.addStyleTag({
    content: "body * { visibility: hidden !important } canvas { visibility: visible !important }",
  });
}

export class Shooter implements LabShooter {
  private constructor(
    private readonly browser: Browser | null,
    readonly page: Page,
    readonly options: ShooterOptions,
  ) {}

  /**
   * Open the lab with the take at `simMs` and `camera`, and wait until its scene is ready. `webkit` opens the
   * WebKit of Playwright (headless), the replacement for the WKWebView of the app.
   */
  static async open(
    options: ShooterOptions,
    simMs: number,
    camera: string,
    engine: "chromium" | "webkit" = "chromium",
  ): Promise<Shooter> {
    const browser =
      engine === "webkit" ? await (await import("@playwright/test")).webkit.launch() : await launchShooterBrowser();
    try {
      const page = await browser.newPage(shooterPageOptions(options));
      await loadLab(page, options, simMs, camera);
      return new Shooter(browser, page, options);
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  /**
   * A shooter on a page that the lab is loaded in already (`loadLab`): a warm page of the render pool. Its
   * `close` keeps the page and the browser.
   */
  static onPage(page: Page, options: ShooterOptions): Shooter {
    return new Shooter(null, page, options);
  }

  /** The canvas of the scene at `simMs` from `camera` (PNG), after the frame of that time. */
  /** A shot at a time from a named camera, or from a free view (the turntable of `room3d asset`). */
  async shot(simMs: number, camera: string | CameraView): Promise<Shot> {
    const frame = await this.page.evaluate(
      async ({ at, name }) => {
        const lab = globalThis.__room3dLab;
        if (lab === undefined) throw new Error("The lab API is not on the page.");
        lab.seek(at);
        lab.camera(name);
        const drawn = await lab.frame();
        return { drawn, metrics: await lab.measure() };
      },
      { at: simMs, name: camera },
    );
    const png = await this.page.getByTestId("room-3d-canvas").screenshot({ type: "png" });
    const label = typeof camera === "string" ? camera : "view";
    return { png, simMs: frame.drawn.simMs, camera: label, frame: frame.drawn, metrics: frame.metrics };
  }

  /**
   * A contact sheet: the shots in a grid of `columns`, each cell `cellWidth` wide with its label under it. The page
   * draws it on a canvas and gives a PNG.
   */
  async sheet(
    cells: readonly { readonly png: Buffer; readonly label: string }[],
    columns: number,
    cellWidth: number,
    lanes: SheetLanes | null = null,
  ): Promise<Buffer> {
    const data = await this.page.evaluate(
      async ({ items, cols, width, lanes: rows }) => {
        const decode = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
        const bitmaps = await Promise.all(
          items.map((item) => createImageBitmap(new Blob([decode(item.png)], { type: "image/png" }))),
        );
        const first = bitmaps[0];
        if (first === undefined) throw new Error("A sheet needs a shot.");
        const height = Math.round((width * first.height) / first.width);
        const label = 22;
        const gap = 4;
        const lines = Math.ceil(bitmaps.length / cols);
        const laneHeight = 18;
        const lanesHeight = rows === null ? 0 : rows.rows.length * (laneHeight + 2) + gap;
        const sheetWidth = cols * (width + gap) + gap;
        const canvas = new OffscreenCanvas(sheetWidth, lines * (height + label + gap) + gap + lanesHeight);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("No 2D canvas.");
        context.fillStyle = "#1b1f27";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = "14px ui-monospace, Menlo, monospace";
        context.textBaseline = "middle";
        bitmaps.forEach((bitmap, index) => {
          const x = gap + (index % cols) * (width + gap);
          const y = gap + Math.floor(index / cols) * (height + label + gap);
          context.drawImage(bitmap, x, y, width, height);
          context.fillStyle = "#e8ecf3";
          context.fillText(items[index]?.label ?? "", x + 6, y + height + label / 2);
        });
        // The clip lanes: a row per member, a part per clip (pale: a family without a clip ID).
        if (rows !== null) {
          const colors = ["#4fb3bf", "#e0a63a", "#7bc96f", "#c47ad6", "#5b8def", "#e46b6b", "#9aa5b1", "#d6c75a"];
          const name = 60;
          const span = sheetWidth - gap * 2 - name;
          context.font = "11px ui-monospace, Menlo, monospace";
          rows.rows.forEach((row, index) => {
            const y = lines * (height + label + gap) + gap + index * (laneHeight + 2);
            context.fillStyle = "#9aa5b1";
            context.fillText(row.member, gap, y + laneHeight / 2);
            for (const part of row.parts) {
              let hash = 0;
              for (const char of part.family) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
              const x = gap + name + ((part.from - rows.from) / (rows.to - rows.from)) * span;
              const w = Math.max(1, ((part.to - part.from) / (rows.to - rows.from)) * span - 1);
              context.globalAlpha = part.clip ? 1 : 0.4;
              context.fillStyle = colors[hash % colors.length] ?? "#9aa5b1";
              context.fillRect(x, y, w, laneHeight);
              context.globalAlpha = 1;
              context.save();
              context.beginPath();
              context.rect(x, y, w, laneHeight);
              context.clip();
              context.fillStyle = "#11151c";
              context.fillText(part.label, x + 3, y + laneHeight / 2);
              context.restore();
            }
          });
        }
        const blob = await canvas.convertToBlob({ type: "image/png" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text = "";
        for (const byte of bytes) text += String.fromCharCode(byte);
        return btoa(text);
      },
      {
        items: cells.map((cell) => ({ png: cell.png.toString("base64"), label: cell.label })),
        cols: columns,
        width: cellWidth,
        lanes,
      },
    );
    return Buffer.from(data, "base64");
  }

  /** A shot as a WebP frame `width` wide (the same aspect), for an animation. */
  async webp(png: Buffer, width: number, quality = 0.85): Promise<{ bytes: Buffer; width: number; height: number }> {
    const result = await this.page.evaluate(
      async ({ data, size, q }) => {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const height = Math.round((size * bitmap.height) / bitmap.width);
        const canvas = new OffscreenCanvas(size, height);
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size, height);
        const blob = await canvas.convertToBlob({ type: "image/webp", quality: q });
        const out = new Uint8Array(await blob.arrayBuffer());
        let text = "";
        for (const byte of out) text += String.fromCharCode(byte);
        return { data: btoa(text), width: size, height };
      },
      { data: png.toString("base64"), size: width, q: quality },
    );
    return { bytes: Buffer.from(result.data, "base64"), width: result.width, height: result.height };
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }
}
