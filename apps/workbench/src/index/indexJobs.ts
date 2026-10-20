// SPDX-License-Identifier: Apache-2.0
/**
 * One job of the frame index in a frame of the workbench page. The indexer window can also use it. The steps are:
 * 1. Take a job of the host queue (`index.next`).
 * 2. The lab frame draws it without a seek (the bridge call `indexJob` of apps/editor `src/core/index/bridgeCalls.ts`).
 * 3. Send its picture as the binary index frame (`WBI\x01`), then `index.done` with the byte count and the metrics.
 * A frame that cannot draw the job gives it back (`index.fail`). This module has no framework, so a test gives fakes.
 */
import type { IndexJobWire, RequestParams, RequestResult } from "@scenity/workbench-host/protocol";

/** The requests of the frame index that a renderer page sends. */
type IndexRequest = "index.next" | "index.done" | "index.fail" | "index.status" | "index.shadow";

/** What one job needs: the host requests, the binary frame and a call into the renderer frame. */
export interface JobDeps {
  request<T extends IndexRequest>(type: T, params: RequestParams<T>): Promise<RequestResult<T>>;
  sendIndexFrame(job: number, mime: string, bytes: ArrayBuffer): void;
  /** A call of the lab bridge in the renderer frame. */
  callFrame(call: string, args: readonly unknown[], timeoutMs?: number): Promise<unknown>;
  /** The name of the renderer (`shadow`, `indexer`). */
  readonly renderer: string;
  readonly sizes?: readonly number[];
}

/** The outcome of one job: drawn and stored, no job, or given back. */
export type JobOutcome = "done" | "none" | "failed";

/** The time limit of one job in the frame (ms). */
export const JOB_TIMEOUT_MS = 20_000;

/** The answer of `indexJob`: the picture, the metrics and the reads of the frame. */
interface JobAnswer {
  readonly mime: string;
  readonly bytes: ArrayBuffer;
  readonly metrics: Record<string, number> | null;
  readonly reads: readonly string[] | null;
}

/** The picture, the metrics and the reads of the answer of `indexJob`, or an error. */
function answerOf(value: unknown): JobAnswer {
  const item = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (!(item.bytes instanceof ArrayBuffer) || typeof item.mime !== "string") {
    throw new Error("indexJob gave no picture.");
  }
  const metrics = typeof item.metrics === "object" && item.metrics !== null ? item.metrics : null;
  // The pose families of the frame. A list with an item that is not a string counts as unknown.
  const raw: unknown = item.reads;
  const reads = Array.isArray(raw) && raw.every((family): family is string => typeof family === "string") ? raw : null;
  return { mime: item.mime, bytes: item.bytes, metrics: metrics as Record<string, number> | null, reads };
}

/** Draw one job of the queue in the frame. */
export async function runJob(deps: JobDeps, job: IndexJobWire): Promise<JobOutcome> {
  try {
    const answer = answerOf(await deps.callFrame("indexJob", [job.input, job.size], JOB_TIMEOUT_MS));
    deps.sendIndexFrame(job.job, answer.mime, answer.bytes);
    await deps.request("index.done", {
      job: job.job,
      bytes: answer.bytes.byteLength,
      mime: answer.mime,
      metrics: answer.metrics,
      ...(answer.reads === null ? {} : { reads: answer.reads }),
    });
    return "done";
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await deps.request("index.fail", { job: job.job, error: text }).catch(() => null);
    return "failed";
  }
}

/** Take the next job of the queue and draw it; "none" when the queue has no job for this renderer. */
export async function takeJob(deps: JobDeps): Promise<JobOutcome> {
  const params = { renderer: deps.renderer, max: 1, ...(deps.sizes === undefined ? {} : { sizes: deps.sizes }) };
  const { jobs } = await deps.request("index.next", params);
  const job = jobs[0];
  return job === undefined ? "none" : runJob(deps, job);
}
