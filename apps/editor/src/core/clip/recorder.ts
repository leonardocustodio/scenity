// SPDX-License-Identifier: Apache-2.0
/**
 * The MediaRecorder path of a clip: for a browser without a WebCodecs encoder, and for an MP4 (Safari and WebKit
 * record `video/mp4`). The lab draws each frame at its simulation time, and the page draws it on a canvas. The recorder
 * records the stream of that canvas at real time: frame i goes to the canvas at i / fps seconds after the start. This
 * path is slower than WebCodecs, because the clip uses its own duration. Its timing is true: a frame that the lab draws
 * late is also late in the video.
 */
import type { SourceFrame } from "./encoder";

/** The parts of the page that the recorder uses (a test gives fakes). */
export interface RecordDeps {
  /** A canvas of the page with `captureStream` (not in the document). */
  readonly canvas: (width: number, height: number) => HTMLCanvasElement;
  readonly MediaRecorder: new (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface RecordRequest {
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly times: readonly number[];
  readonly bitrate: number;
}

export interface RecordedClip {
  readonly bytes: ArrayBuffer;
  /** The type of the recorder (for example `video/webm;codecs=vp9` or `video/mp4`). */
  readonly mime: string;
  /** The time to seek and draw the frames (ms), in the recording. */
  readonly stepMs: number;
  /** The time of the recording, from the start to the last data (ms). */
  readonly recordMs: number;
}

/** The page parts of the recorder. */
export function pageRecordDeps(): RecordDeps {
  return {
    canvas(width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    MediaRecorder,
    now: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** Record the frames that `step` gives at the times of the request, at real time. */
export async function recordClip(
  step: (simMs: number) => Promise<SourceFrame>,
  request: RecordRequest,
  deps: RecordDeps,
): Promise<RecordedClip> {
  const canvas = deps.canvas(request.width, request.height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("clip: the page has no 2D canvas for the recorder.");
  // A stream without its own frame rate. A frame goes to the stream at each `requestFrame` (if the browser has it).
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
  const live = track?.requestFrame === undefined ? canvas.captureStream(request.fps) : stream;
  const recorder = new deps.MediaRecorder(live, { mimeType: request.mime, videoBitsPerSecond: request.bitrate });
  const parts: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) parts.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => {
      resolve();
    };
    recorder.onerror = (event) => {
      reject(new Error(`clip: MediaRecorder failed (${event.type}).`));
    };
  });
  const frameMs = 1000 / request.fps;
  let stepMs = 0;
  recorder.start();
  const start = deps.now();
  for (const [index, at] of request.times.entries()) {
    const mark = deps.now();
    const shot = await step(at);
    stepMs += deps.now() - mark;
    const wait = start + index * frameMs - deps.now();
    if (wait > 0) await deps.sleep(wait);
    context.drawImage(shot.bitmap, 0, 0, request.width, request.height, 0, 0, request.width, request.height);
    shot.bitmap.close();
    track?.requestFrame?.();
  }
  // The last frame stays for one frame time.
  const end = start + request.times.length * frameMs - deps.now();
  if (end > 0) await deps.sleep(end);
  recorder.stop();
  await stopped;
  for (const item of [...stream.getTracks(), ...live.getTracks()]) item.stop();
  const recordMs = deps.now() - start;
  const blob = new Blob(parts, { type: recorder.mimeType || request.mime });
  return { bytes: await blob.arrayBuffer(), mime: blob.type, stepMs, recordMs };
}
