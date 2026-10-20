// SPDX-License-Identifier: Apache-2.0
/**
 * The MP4 of a clip in the labs app (the desktop part).
 *
 * `POST /clips/mp4` with `{ from, to, fps?, camera?, width?, height?, take? }` (the token header, as every route):
 * the host sends the surface call `clipMp4` to the visible lab frame. The workbench page answers it itself in the
 * labs app (apps/workbench `desktop/mp4Clip.ts`). It steps the frame and takes a JPEG of each frame (3–4 ms in
 * WebKit). It gives each JPEG with its sim time to the shell (`clip_mp4_frame`, raw bytes). The shell writes the MP4
 * with AVAssetWriter (H.264 by VideoToolbox). The page sends the MP4 as one binary frame. The host keeps it in the
 * picture store and answers `{ id, mime, bytes, frames, width, height, ms }`. `GET /pictures/<id>` gives the file.
 *
 * A browser page has no MP4 writer: the answer is 501 (`NO_NATIVE_MP4`), and `labs clip --format mp4` makes the clip
 * with MediaRecorder (the browser path).
 */
import type { PictureStore } from "./pictures";
import { CLIP_MP4_CALL, CLIP_MP4_PATH, NO_NATIVE_MP4, type ClipMp4Request } from "./protocol";
import type { SurfaceRegistry } from "./surfaces";

/** The longest clip: 2 minutes of frames take about 1 minute to step. */
const CLIP_TIMEOUT_MS = 180_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** An even side of a picture from 16 to 4096 px. */
function side(value: unknown, fallback: number): number {
  const size = Math.round(finite(value, fallback));
  return Math.min(4096, Math.max(16, size - (size % 2)));
}

/** Read the JSON body of a clip request; throw for a request that is not valid. */
export function clipRequest(body: unknown): ClipMp4Request {
  if (typeof body !== "object" || body === null) throw new Error("The clip request must be a JSON object.");
  const item = body as Record<string, unknown>;
  const from = finite(item.from, Number.NaN);
  const to = finite(item.to, Number.NaN);
  if (!(from >= 0 && to > from)) throw new Error("The clip needs a time range: 0 ≤ from < to (ms).");
  const width = side(item.width, 640);
  return {
    from,
    to,
    fps: Math.min(60, Math.max(1, finite(item.fps, 15))),
    camera: typeof item.camera === "string" ? item.camera : null,
    width,
    height: side(item.height, (width * 10) / 16),
    take: typeof item.take === "string" ? item.take : null,
  };
}

/** The bytes of a page answer (the binary frame), or null. */
function bytesOf(value: Record<string, unknown>): Uint8Array | null {
  return value.bytes instanceof Uint8Array ? value.bytes : null;
}

/** The route `POST /clips/mp4`; null for another path. */
export function clipsHttp(parts: {
  readonly surfaces: () => SurfaceRegistry;
  readonly pictures: PictureStore;
}): (request: Request, url: URL) => Promise<Response | null> {
  return async (request, url) => {
    if (url.pathname !== CLIP_MP4_PATH || request.method !== "POST") return null;
    let asked: ClipMp4Request;
    try {
      asked = clipRequest(await request.json());
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 400 });
    }
    let value: Record<string, unknown>;
    try {
      // The visible frame of the scene surface records the clip.
      const surfaces = parts.surfaces();
      const answer = await surfaces.call(surfaces.scene(), CLIP_MP4_CALL, [asked], { timeoutMs: CLIP_TIMEOUT_MS });
      value = typeof answer === "object" && answer !== null ? (answer as Record<string, unknown>) : {};
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const status = text.includes(NO_NATIVE_MP4) || text.includes(`No call "${CLIP_MP4_CALL}"`) ? 501 : 502;
      return new Response(text, { status });
    }
    const bytes = bytesOf(value);
    if (bytes === null || value.mime !== "video/mp4") {
      return new Response("The page gave no MP4.", { status: 502 });
    }
    const id = parts.pictures.put(bytes, "video/mp4");
    return Response.json({ ...value, id, bytes: bytes.length });
  };
}
