// SPDX-License-Identifier: Apache-2.0
/**
 * The jobs of the render pool: a lab URL, a time list and an action. The
 * pool runs a job on a warm page and writes the results as files and JSON into the output folder of the job:
 *
 *   shot     a picture per time and camera (`<time>-<camera>.webp`, or PNG with `format: "png"`)
 *   sheet    one contact sheet of the times and cameras (`sheet.png`), as `labs sheet`
 *   clip     a video of the first to the last time from one camera, made in the page (`clip.webm`, or `clip.mp4`
 *            with `format: "mp4"`; `pageClip`), as `labs clip`. `format: "webp"` (or a page without a video
 *            encoder) gives the animated WebP of the WebP path (`clip.webp`)
 *   stills   small WebP pictures (`width`, default 320) per time and camera
 *   measure  the metrics at the times (`measure.json`), as `labs motion` (`render` draws each frame)
 *   sweep    the inspect report from the first to the last time at the step of the list (`sweep.json`)
 *
 * Each job writes `result.json` with the records of its frames. The actions use the methods of the `Shooter`, so a
 * picture of a job equals the picture of the tool.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { LabShooter, Shot } from "../shooter";
import { pageClip, webpClip } from "../clipTool";
import type { PageSpec } from "./pages";

export const JOB_ACTIONS = ["shot", "sheet", "clip", "stills", "measure", "sweep"] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

export interface JobRequest {
  /** A lab URL or its query: `take` (or `preset`), `rec`, `debug`, `source`, `team`, `tier`, `worker`, `assets`, `camera`; other parameters (for example `tune`, `backend`) go to the page as they are. */
  readonly url: string;
  readonly action: JobAction;
  readonly times: readonly number[];
  /** Named cameras; the default is the `camera` of the URL, else `overview`. */
  readonly cameras?: readonly string[];
  /** The size of the page, `<width>x<height>` (default 1280x800). */
  readonly size?: string;
  /** The output folder (absolute). */
  readonly out: string;
  /** shot: "webp" (default) or "png"; clip: "webm" (default), "mp4" or "webp" (the animated WebP). */
  readonly format?: "webp" | "png" | "webm" | "mp4";
  /** The width of a still, a clip frame or a sheet cell. */
  readonly width?: number;
  readonly columns?: number;
  readonly fps?: number;
  readonly render?: boolean;
  /**
   * `chromium` (default) or `webkit` (the frame of an indexer window of Scenity; shots as PNG only, no
   * sheet, clip, WebP, measure or sweep).
   */
  readonly engine?: "chromium" | "webkit";
}

/** One frame of a job. */
export interface JobRecord {
  readonly file: string | null;
  readonly at: number;
  readonly camera: string;
  readonly simMs: number | null;
  readonly failures: readonly string[];
  readonly metrics: readonly { readonly metric: string; readonly member: string | null; readonly value: number }[];
}

export interface JobResult {
  readonly action: JobAction;
  readonly out: string;
  readonly files: readonly string[];
  readonly records: readonly JobRecord[];
  readonly ms: number;
}

/** The parameters of a lab URL that the spec of the page takes; the rest goes to the page as it is. */
const SPEC_PARAMS = ["take", "preset", "rec", "debug", "source", "team", "tier", "worker", "assets", "camera"];
/** Parameters that a job never passes: the clock and the page options of the tools (the shooter sets them). */
const DROPPED = ["t", "paused", "freeze", "panel", "dock", "workbench", "labsKey"];

/**
 * The page spec and the default camera of a job. Throw on a bad request. `defaultTake` is the take of a URL
 * with no take (the default take of the project; empty: the lab with no take).
 */
export function jobSpec(
  job: JobRequest,
  defaultTake = "",
): { readonly spec: PageSpec; readonly cameras: readonly string[] } {
  const query = new URLSearchParams(job.url.includes("?") ? job.url.slice(job.url.indexOf("?") + 1) : job.url);
  const size = /^(\d{2,4})x(\d{2,4})$/.exec(job.size ?? "1280x800");
  if (size === null) throw new Error('"size" must be <width>x<height>.');
  const extra: Record<string, string> = {};
  for (const [name, value] of query) {
    if (!SPEC_PARAMS.includes(name) && !DROPPED.includes(name)) extra[name] = value;
  }
  const spec: PageSpec = {
    take: query.get("take") ?? query.get("preset") ?? defaultTake,
    rec: query.get("rec") ?? undefined,
    debug: query.get("debug") ?? undefined,
    source: query.get("source") ?? undefined,
    team: query.get("team") === "0" ? false : undefined,
    tier: query.get("tier") ?? "high",
    worker: query.get("worker") === "1",
    assets: query.get("assets") !== "0",
    width: Number(size[1]),
    height: Number(size[2]),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
  const cameras = job.cameras ?? [query.get("camera") ?? "overview"];
  if (!isAbsolute(job.out)) throw new Error('"out" must be an absolute folder.');
  if (job.times.length === 0 || job.times.length > 400) throw new Error('"times" needs 1 to 400 times.');
  if (!job.times.every((time) => Number.isFinite(time) && time >= 0)) throw new Error('"times" must be ms ≥ 0.');
  if (!JOB_ACTIONS.includes(job.action)) throw new Error(`"action" must be one of ${JOB_ACTIONS.join(", ")}.`);
  return { spec, cameras };
}

function recordOf(shot: Shot, at: number, file: string | null): JobRecord {
  return {
    file,
    at,
    camera: shot.camera,
    simMs: shot.simMs,
    failures: shot.frame.stats?.failures ?? [],
    metrics: shot.metrics.map((value) => ({
      metric: value.metric,
      member: value.member,
      value: Number(value.value.toFixed(4)),
    })),
  };
}

/** The pictures of a job: per time and camera, a file of the action. */
async function pictures(shooter: LabShooter, job: JobRequest, cameras: readonly string[]) {
  const files: string[] = [];
  const records: JobRecord[] = [];
  const cells: { png: Buffer; label: string }[] = [];
  for (const at of job.times) {
    for (const camera of cameras) {
      const shot = await shooter.shot(at, camera);
      let file: string | null = null;
      if (job.action === "sheet") cells.push({ png: shot.png, label: `${String(at)} ms · ${camera}` });
      else {
        const png = job.action === "shot" && job.format === "png";
        file = `${String(at)}-${camera}.${png ? "png" : "webp"}`;
        const bytes = png
          ? shot.png
          : (await shooter.webp(shot.png, job.width ?? (job.action === "stills" ? 320 : 1280))).bytes;
        writeFileSync(join(job.out, file), bytes);
        files.push(file);
      }
      records.push(recordOf(shot, at, file));
    }
  }
  if (job.action === "sheet") {
    const columns = job.columns ?? (cameras.length > 1 ? cameras.length : Math.min(job.times.length, 4));
    const width = Math.min(job.width ?? 400, Math.floor((1600 - 4) / columns) - 4);
    writeFileSync(join(job.out, "sheet.png"), await shooter.sheet(cells, columns, width));
    files.push("sheet.png");
  }
  return { files, records };
}

/**
 * The clip of a job: the video of the page, as `labs clip` makes it on the same page code. The clip is the animated
 * WebP with `format: "webp"` or when the page makes no video.
 */
async function clipJob(shooter: LabShooter, job: JobRequest, camera: string) {
  const fps = job.fps ?? 12;
  const width = job.width ?? 640;
  if (job.format !== "webp") {
    const request = {
      from: Math.min(...job.times),
      to: Math.max(...job.times),
      fps,
      camera,
      width,
      format: job.format === "mp4" ? ("mp4" as const) : ("webm" as const),
    };
    const made = await pageClip(shooter, request).catch(() => null);
    if (made !== null) {
      const file = `clip.${made.extension}`;
      writeFileSync(join(job.out, file), made.bytes);
      return { files: [file], records: [] };
    }
  }
  const records: JobRecord[] = [];
  const made = await webpClip(shooter, job.times, camera, width, fps, (shot) => {
    records.push(recordOf(shot, shot.simMs ?? 0, "clip.webp"));
  });
  writeFileSync(join(job.out, "clip.webp"), made.bytes);
  return { files: ["clip.webp"], records };
}

/** The numbers of a job: the metrics at the times, or the sweep of the inspect report. */
async function numbers(shooter: LabShooter, job: JobRequest): Promise<string> {
  const render = job.render === true;
  if (job.action === "measure") {
    const values = await shooter.page.evaluate(
      async ({ at, draw }) => globalThis.__room3dLab?.measureAt(at, { render: draw }) ?? null,
      { at: [...job.times], draw: render },
    );
    writeFileSync(join(job.out, "measure.json"), `${JSON.stringify({ times: job.times, values }, null, 2)}\n`);
    return "measure.json";
  }
  const from = Math.min(...job.times);
  const to = Math.max(...job.times);
  const step = job.times.length > 1 ? Math.abs((job.times[1] ?? 0) - (job.times[0] ?? 0)) || 100 : 100;
  const samples = await shooter.page.evaluate(
    async ({ start, end, every, draw }) => globalThis.__room3dLab?.sweep(start, end, every, { render: draw }) ?? null,
    { start: from, end: to, every: step, draw: render },
  );
  writeFileSync(join(job.out, "sweep.json"), `${JSON.stringify({ from, to, step, samples })}\n`);
  return "sweep.json";
}

/** Run a job on a shooter whose page has the lab of `jobSpec(job).spec`. */
export async function runJob(shooter: LabShooter, job: JobRequest): Promise<JobResult> {
  const begun = performance.now();
  const { cameras } = jobSpec(job);
  mkdirSync(job.out, { recursive: true });
  let files: readonly string[];
  let records: readonly JobRecord[] = [];
  if (job.action === "measure" || job.action === "sweep") files = [await numbers(shooter, job)];
  else if (job.action === "clip") ({ files, records } = await clipJob(shooter, job, cameras[0] ?? "overview"));
  else ({ files, records } = await pictures(shooter, job, cameras));
  const result: JobResult = {
    action: job.action,
    out: job.out,
    files,
    records,
    ms: Math.round(performance.now() - begun),
  };
  writeFileSync(join(job.out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
