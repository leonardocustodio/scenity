// SPDX-License-Identifier: Apache-2.0
/**
 * The encoder of `scenity clip`. The frames are screenshots of the player (PNG). WebCodecs in the player page encodes
 * them (VP9, else VP8: the order of the lab clip, without AV1, which needs codec private data), and the muxer of the
 * lab clip (`@scenity/labs-platform/webm`) writes the WebM file in Bun.
 *
 * The functions that run in the page have no outer names: Playwright or the scene pool sends their text to the page.
 */
import { CLIP_CODECS } from "@scenity/labs-platform";
import { muxWebm, type MuxFrame, type WebmCodec } from "@scenity/labs-platform/webm";
import type { PlayerTab } from "../page/tabs";

/** The codecs of a clip in their order of choice: the codec string of WebCodecs and the codec ID of WebM. */
export const CLIP_CODEC_ORDER: readonly { readonly codec: string; readonly webm: WebmCodec }[] = [
  { codec: CLIP_CODECS.vp9, webm: "V_VP9" },
  { codec: "vp8", webm: "V_VP8" },
];

/** About 0.25 bit per pixel and frame, from 0.5 to 12 Mbit/s (`clipBitrate` of the lab clip). */
export function clipBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(12_000_000, Math.max(500_000, width * height * fps * 0.25)));
}

interface StartArgs {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly bitrate: number;
  readonly codecs: readonly { readonly codec: string; readonly webm: string }[];
}

/** In the page: configure an encoder with the first codec that the browser can encode. The result is its WebM ID. */
async function startInPage(args: StartArgs): Promise<string | null> {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (typeof VideoEncoder !== "function") return null;
  for (const item of args.codecs) {
    const config: VideoEncoderConfig = {
      codec: item.codec,
      width: args.width,
      height: args.height,
      framerate: args.fps,
      bitrate: args.bitrate,
      bitrateMode: "variable",
      latencyMode: "quality",
    };
    const answer = await VideoEncoder.isConfigSupported(config).catch(() => null);
    if (answer?.supported !== true) continue;
    const state = { chunks: [] as { data: string; us: number; key: boolean }[], error: null as string | null };
    const encoder = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        let text = "";
        for (let at = 0; at < data.length; at += 0x8000) text += String.fromCharCode(...data.subarray(at, at + 0x8000));
        state.chunks.push({ data: btoa(text), us: chunk.timestamp, key: chunk.type === "key" });
      },
      error: (error) => {
        state.error = String(error);
      },
    });
    encoder.configure(config);
    scope.__scenityClip = { encoder, state };
    return item.webm;
  }
  return null;
}

/** In the page: encode one PNG frame (base64) at a time of the video (µs). */
async function addInPage(args: { png: string; us: number; key: boolean }): Promise<void> {
  const clip = (globalThis as unknown as Record<string, unknown>).__scenityClip as { encoder: VideoEncoder };
  const bytes = Uint8Array.from(atob(args.png), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const frame = new VideoFrame(bitmap, { timestamp: args.us });
  clip.encoder.encode(frame, { keyFrame: args.key });
  frame.close();
  bitmap.close();
  while (clip.encoder.encodeQueueSize > 4) await new Promise((resolve) => setTimeout(resolve, 5));
}

/** In the page: flush the encoder and give the encoded chunks. */
async function finishInPage(): Promise<{ chunks: { data: string; us: number; key: boolean }[]; error: string | null }> {
  const clip = (globalThis as unknown as Record<string, unknown>).__scenityClip as {
    encoder: VideoEncoder;
    state: { chunks: { data: string; us: number; key: boolean }[]; error: string | null };
  };
  await clip.encoder.flush();
  clip.encoder.close();
  return clip.state;
}

/** An encoder of the frames of one clip in a page. */
export interface PageEncoder {
  readonly codec: WebmCodec;
  add(png: Uint8Array, us: number, key: boolean): Promise<void>;
  /** Flush the encoder and write the WebM file. */
  finish(frameUs: number): Promise<Uint8Array>;
}

/** Start an encoder in the page, or throw when the browser has no WebCodecs encoder of VP9 or VP8. */
export async function pageEncoder(
  page: Pick<PlayerTab, "evaluate">,
  size: { readonly width: number; readonly height: number },
  fps: number,
): Promise<PageEncoder> {
  const bitrate = clipBitrate(size.width, size.height, fps);
  const codec = (await page.evaluate(startInPage, {
    ...size,
    fps,
    bitrate,
    codecs: CLIP_CODEC_ORDER,
  })) as WebmCodec | null;
  if (codec === null) throw new Error("the browser has no WebCodecs encoder of VP9 or VP8");
  return {
    codec,
    add: (png, us, key) => page.evaluate(addInPage, { png: Buffer.from(png).toString("base64"), us, key }),
    async finish(frameUs) {
      const done = await page.evaluate(finishInPage, undefined);
      if (done.error !== null) throw new Error(`the encoder failed: ${done.error}`);
      const frames: MuxFrame[] = done.chunks.map((chunk) => ({
        data: new Uint8Array(Buffer.from(chunk.data, "base64")),
        timestampUs: chunk.us,
        key: chunk.key,
      }));
      return muxWebm({ codec, ...size, frameUs, frames });
    },
  };
}
