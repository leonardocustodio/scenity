// SPDX-License-Identifier: Apache-2.0
/**
 * The capture check of the labs: a picture of the canvas from `createImageBitmap` (the path of `capture`, the strip,
 * the index and the poster) against a readback of the pixels that the renderer drew in the same task. On WebGL the
 * readback is `readPixels` of the drawing buffer; on WebGPU it is a copy of the current texture of the `webgpu` canvas
 * context to a buffer. Equal pixels prove that a capture of a WebGPU canvas gives the frame and not an empty or an old
 * drawing buffer.
 *
 * The functions read the renderer through its fields (no three.js import), so this module adds no renderer code.
 */

/** The pixels of a picture: RGBA, top row first. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

/** The result of a capture check: the largest channel difference and the count of pixels that differ. */
export interface CaptureCheck {
  readonly backend: "webgpu" | "webgl";
  readonly width: number;
  readonly height: number;
  readonly maxDiff: number;
  readonly differing: number;
  /** The mean colour (RGB) of the capture and of the readback: an empty or an old picture shows here. */
  readonly captureMean: readonly number[];
  readonly readbackMean: readonly number[];
}

/** The mean colour of a picture (RGB, 0–255, one decimal). */
export function meanColour(pixels: Pixels): number[] {
  const sums = [0, 0, 0];
  for (let index = 0; index < pixels.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      sums[channel] = (sums[channel] ?? 0) + (pixels.data[index + channel] ?? 0);
    }
  }
  const count = Math.max(1, pixels.data.length / 4);
  return sums.map((sum) => Math.round((sum / count) * 10) / 10);
}

/** The parts of a WebGL 2 context that the readback uses. */
interface GlLike {
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
  readonly RGBA: number;
  readonly UNSIGNED_BYTE: number;
  readPixels(x: number, y: number, width: number, height: number, format: number, type: number, out: Uint8Array): void;
}

/** The parts of the WebGPU objects that the readback uses (`GPUBufferUsage` and `GPUMapMode` values of the spec). */
interface GpuTextureLike {
  readonly width: number;
  readonly height: number;
  readonly format: string;
}
interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}
interface GpuDeviceLike {
  createBuffer(descriptor: { size: number; usage: number }): GpuBufferLike;
  createCommandEncoder(): {
    copyTextureToBuffer(
      source: { texture: GpuTextureLike },
      destination: { buffer: GpuBufferLike; bytesPerRow: number },
      size: [number, number],
    ): void;
    finish(): unknown;
  };
  readonly queue: { submit(buffers: unknown[]): void };
}

/** The renderer fields that the readback reads: the WebGPU backend, or the WebGL context. */
interface RendererLike {
  readonly isWebGPURenderer?: boolean;
  readonly backend?: { readonly device?: GpuDeviceLike; readonly context?: { getCurrentTexture(): GpuTextureLike } };
  getContext?(): unknown;
}

const COPY_DST_MAP_READ = 0x0008 | 0x0001;
const MAP_READ = 0x0001;

/** A readback of the WebGPU canvas: the current texture of this task, in RGBA, top row first. */
function readGpu(renderer: RendererLike): Promise<Pixels> | null {
  const device = renderer.backend?.device;
  const texture = renderer.backend?.context?.getCurrentTexture();
  if (device === undefined || texture === undefined) return null;
  const { width, height } = texture;
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: COPY_DST_MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
  device.queue.submit([encoder.finish()]);
  const bgra = texture.format.startsWith("bgra");
  return buffer.mapAsync(MAP_READ).then(() => {
    const rows = new Uint8Array(buffer.getMappedRange());
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const from = y * bytesPerRow + x * 4;
        const to = (y * width + x) * 4;
        data[to] = rows[from + (bgra ? 2 : 0)] ?? 0;
        data[to + 1] = rows[from + 1] ?? 0;
        data[to + 2] = rows[from + (bgra ? 0 : 2)] ?? 0;
        data[to + 3] = rows[from + 3] ?? 0;
      }
    }
    buffer.unmap();
    buffer.destroy();
    return { width, height, data };
  });
}

/** A readback of the WebGL drawing buffer in this task, in RGBA, top row first. */
function readGl(renderer: RendererLike): Pixels | null {
  const gl = renderer.getContext?.() as GlLike | undefined;
  if (gl === undefined) return null;
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const flipped = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
  const data = new Uint8Array(flipped.length);
  const row = width * 4;
  for (let y = 0; y < height; y += 1) data.set(flipped.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return { width, height, data };
}

/** Start the readback of the frame that the renderer drew in this task (call it in the task of the render). */
export function readback(renderer: unknown): Promise<Pixels | null> {
  const made = renderer as RendererLike;
  if (made.isWebGPURenderer === true) return readGpu(made) ?? Promise.resolve(null);
  return Promise.resolve(readGl(made));
}

/** The pixels of a bitmap (a 2D canvas copy). */
export function bitmapPixels(bitmap: ImageBitmap): Pixels | null {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: image.width, height: image.height, data: image.data };
}

/** Compare two pictures of the same size: the largest channel difference and the pixels that differ. */
export function comparePixels(a: Pixels, b: Pixels): { readonly maxDiff: number; readonly differing: number } {
  if (a.width !== b.width || a.height !== b.height) return { maxDiff: 255, differing: a.width * a.height };
  let maxDiff = 0;
  let differing = 0;
  for (let index = 0; index < a.data.length; index += 4) {
    let pixel = 0;
    // The alpha channel is opaque in both (alpha: false); compare the colour.
    for (let channel = 0; channel < 3; channel += 1) {
      pixel = Math.max(pixel, Math.abs((a.data[index + channel] ?? 0) - (b.data[index + channel] ?? 0)));
    }
    if (pixel > 0) differing += 1;
    maxDiff = Math.max(maxDiff, pixel);
  }
  return { maxDiff, differing };
}

/**
 * The capture check of the frame that the renderer drew in this task (call it in the task of the render, as the dev
 * core does after a frame): a `createImageBitmap` copy of the canvas against a readback, then the comparison. Null
 * where the page has no `createImageBitmap` or `OffscreenCanvas`.
 */
export function checkCapture(
  renderer: { readonly domElement: HTMLCanvasElement | OffscreenCanvas },
  backend: CaptureCheck["backend"],
): Promise<CaptureCheck | null> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return Promise.resolve(null);
  // Both copies start in the task of the render, before the browser shows the frame. The readback goes first: in a
  // worker, `createImageBitmap` of a `webgpu` OffscreenCanvas ends its current texture (in Chromium), and a
  // readback after it reads a new, empty texture.
  const read = readback(renderer);
  const copy = createImageBitmap(renderer.domElement);
  return Promise.all([copy, read]).then(
    ([bitmap, pixels]) => {
      const captured = bitmapPixels(bitmap);
      bitmap.close();
      if (captured === null || pixels === null) return null;
      return {
        backend,
        width: pixels.width,
        height: pixels.height,
        ...comparePixels(captured, pixels),
        captureMean: meanColour(captured),
        readbackMean: meanColour(pixels),
      };
    },
    () => null,
  );
}
