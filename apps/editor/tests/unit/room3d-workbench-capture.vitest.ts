// SPDX-License-Identifier: Apache-2.0
/**
 * The `capture` call of the workbench bridge at a size. With a height, the scene draws the picture at that size and
 * aspect (`ViewHandle.capture(width, height)`), so a thin frame gives no strip. Without a height, the picture keeps the
 * aspect of the canvas. A browser without a WebP encoder gives JPEG, not PNG.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewHandle } from "../../src/core/useLabStats";
import {
  captureFrame,
  encodePicture,
  JPEG_QUALITY,
  resetWebpCheck,
  webpOnce,
} from "../../src/core/bridge/workbenchCapture";

/** A canvas of a thin frame: 1280 × 71. A capture without a height has its aspect. */
const CANVAS = { width: 1280, height: 71 };

function fakeView(asked: unknown[][]): ViewHandle {
  return {
    stats: () => null,
    quality: () => null,
    mark: () => Promise.resolve(0),
    inspect: () => Promise.resolve(null),
    capture: (width: number, height?: number) => {
      asked.push(height === undefined ? [width] : [width, height]);
      const tall = height ?? Math.round((width * CANVAS.height) / CANVAS.width);
      const bitmap = { width, height: tall, close: () => undefined } as unknown as ImageBitmap;
      return Promise.resolve({ simMs: 6350, bitmap, members: [] });
    },
  };
}

class FakeOffscreenCanvas {
  getContext(): { transferFromImageBitmap(): void } {
    return { transferFromImageBitmap: () => undefined };
  }

  convertToBlob(): Promise<Blob> {
    return Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetWebpCheck();
});

describe("the capture at a size", () => {
  it("draws at the asked width and height, not at the thin aspect of the canvas", async () => {
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    const asked: unknown[][] = [];
    const shot = await captureFrame(fakeView(asked), 1280, null, 800);
    expect(asked).toEqual([[1280, 800]]);
    expect([shot.width, shot.height, shot.simMs, shot.mime]).toEqual([1280, 800, 6350, "image/webp"]);
  });

  it("keeps the aspect of the canvas without a height, and checks the height", async () => {
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    const asked: unknown[][] = [];
    const shot = await captureFrame(fakeView(asked), 640);
    expect(asked).toEqual([[640]]);
    expect(shot.height).toBe(36);
    await expect(captureFrame(fakeView(asked), 640, null, -3)).rejects.toThrow("height");
    await expect(captureFrame(fakeView(asked), 640, null, 5000)).rejects.toThrow("height");
  });
});

/** An encoder of a browser that can encode only the given types; another type gives PNG, as a browser does. */
function encoder(
  types: readonly string[],
  asked: [string, number][],
): (type: string, quality: number) => Promise<Blob> {
  return (type, quality) => {
    asked.push([type, quality]);
    return Promise.resolve(new Blob([new Uint8Array([1])], { type: types.includes(type) ? type : "image/png" }));
  };
}

describe("the picture type", () => {
  const yes = () => Promise.resolve(true);
  const no = () => Promise.resolve(false);

  it("is WebP where the browser encodes WebP", async () => {
    const asked: [string, number][] = [];
    expect((await encodePicture(encoder(["image/webp", "image/jpeg"], asked), 0.92, yes)).type).toBe("image/webp");
    expect(asked).toEqual([["image/webp", 0.92]]);
  });

  it("is JPEG at quality 0.9 at once without a WebP encoder (WebKit), and PNG only as the last resort", async () => {
    const asked: [string, number][] = [];
    expect((await encodePicture(encoder(["image/jpeg"], asked), 0.92, no)).type).toBe("image/jpeg");
    expect(asked).toEqual([["image/jpeg", JPEG_QUALITY]]);
    expect((await encodePicture(encoder([], []), 0.92, no)).type).toBe("image/png");
  });
});

/**
 * A stub of the OffscreenCanvas of WebKit: a WebP request gives a PNG, as WebKit does. Each encode records the
 * size of the canvas and the type that it asked for.
 */
function webkitCanvas(encodes: string[]) {
  return class WebKitCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}

    getContext(): { transferFromImageBitmap(): void } {
      return { transferFromImageBitmap: () => undefined };
    }

    convertToBlob(options: { type?: string } = {}): Promise<Blob> {
      const type = options.type ?? "image/png";
      encodes.push(`${String(this.width)}x${String(this.height)} ${type}`);
      return Promise.resolve(new Blob([new Uint8Array([1, 2])], { type: type === "image/webp" ? "image/png" : type }));
    }
  };
}

describe("the WebP check once per page", () => {
  afterEach(() => {
    resetWebpCheck();
  });

  it("checks a 1 × 1 canvas once; each WebKit capture then encodes one JPEG and no PNG", async () => {
    const encodes: string[] = [];
    vi.stubGlobal("OffscreenCanvas", webkitCanvas(encodes));
    const first = await captureFrame(fakeView([]), 1280, null, 800);
    const second = await captureFrame(fakeView([]), 640, null, 400);
    expect(encodes).toEqual(["1x1 image/webp", "1280x800 image/jpeg", "640x400 image/jpeg"]);
    expect([first.mime, second.mime]).toEqual(["image/jpeg", "image/jpeg"]);
    // The bytes, not base64.
    expect(first.bytes).toBeInstanceOf(ArrayBuffer);
    expect(first.bytes.byteLength).toBe(2);
    expect(await webpOnce()).toBe(false);
    expect(encodes).toHaveLength(3);
  });

  it("a browser with a WebP encoder encodes WebP after its one check", async () => {
    const encodes: string[] = [];
    class Chromium {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}

      getContext(): { transferFromImageBitmap(): void } {
        return { transferFromImageBitmap: () => undefined };
      }

      convertToBlob(options: { type?: string } = {}): Promise<Blob> {
        encodes.push(`${String(this.width)}x${String(this.height)} ${options.type ?? "image/png"}`);
        return Promise.resolve(new Blob([new Uint8Array([1])], { type: options.type ?? "image/png" }));
      }
    }
    vi.stubGlobal("OffscreenCanvas", Chromium);
    const shot = await captureFrame(fakeView([]), 1280, null, 800);
    expect(encodes).toEqual(["1x1 image/webp", "1280x800 image/webp"]);
    expect(shot.mime).toBe("image/webp");
  });
});
