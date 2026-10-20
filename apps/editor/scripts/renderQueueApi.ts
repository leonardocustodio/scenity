// SPDX-License-Identifier: Apache-2.0
/**
 * The render queue on a dev server, a Vite plugin: contact sheets (`scenity sheet`) and
 * clips (`scenity clip`) of a project, one at a time (each run takes the GPU lock), in the order of the requests.
 *
 * - `POST /projects/<name>/render.add`: a sheet or a clip (`RenderRequest`). The outputs go into `test-results/renders/`.
 * - `GET .../render.json`: the queue (each item with its state and its output) and the outputs, the newest first.
 *
 * `SCENITY_BENCH_LOCK` names another GPU lock file for the runs (a test that holds the lock of the labs tools). The
 * post needs the import header and the same origin, as the import does.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { cliOf, jobOf, lockArgs, startCliJob } from "./cliJob.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

/** The folder of the outputs, relative to the project folder. */
export const RENDERS_FOLDER = "test-results/renders";

/** A request of the queue. */
export interface RenderRequest {
  readonly kind: "sheet" | "clip";
  readonly sequence: string;
  readonly camera?: string;
  readonly from: number;
  readonly to: number;
  /** A sheet: the step between two times (ms) and the cell width (px). */
  readonly step?: number;
  readonly cell?: number;
  /** A clip: the frames per second and the size. */
  readonly fps?: number;
  readonly size?: string;
}

/** An item of the queue. */
interface RenderItem {
  readonly id: number;
  readonly request: RenderRequest;
  state: "waiting" | "running" | "done" | "failed";
  readonly output: string;
  log: string[];
}

const queues = new Map<string, RenderItem[]>();
let next = 1;

/** The checked request of a body, or the reason of a refusal. */
export function readRequest(value: unknown): RenderRequest | string {
  const input = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (input.kind !== "sheet" && input.kind !== "clip") return "a request is a sheet or a clip";
  if (typeof input.sequence !== "string" || !/^[\w./-]+\.sequence\.json$/.test(input.sequence)) {
    return "the request names no sequence of the project";
  }
  const number = (key: string): number | undefined =>
    typeof input[key] === "number" && Number.isFinite(input[key]) ? Math.round(input[key]) : undefined;
  const from = number("from");
  const to = number("to");
  if (from === undefined || to === undefined || from < 0 || to <= from) return "the time range is from < to (ms)";
  const camera = typeof input.camera === "string" && /^[\w.-]+$/.test(input.camera) ? input.camera : undefined;
  const size = typeof input.size === "string" && /^\d+x\d+$/.test(input.size) ? input.size : undefined;
  const optional = { step: number("step"), cell: number("cell"), fps: number("fps") };
  return {
    kind: input.kind,
    sequence: input.sequence,
    from,
    to,
    ...(camera === undefined ? {} : { camera }),
    ...(size === undefined ? {} : { size }),
    ...Object.fromEntries(Object.entries(optional).filter(([, item]) => item !== undefined && item > 0)),
  };
}

/** The CLI arguments of a request. */
export function renderArgs(dir: string, request: RenderRequest, output: string): string[] {
  const common = ["--sequence", request.sequence, "--from", String(request.from), "--to", String(request.to)];
  const camera = request.camera === undefined ? [] : ["--camera", request.camera];
  const build = existsSync(join(dir, "dist", "index.html")) ? [] : ["--build"];
  const lock = lockArgs();
  const extra =
    request.kind === "sheet"
      ? [
          ...(request.step === undefined ? [] : ["--step", String(request.step)]),
          ...(request.cell === undefined ? [] : ["--cell", String(request.cell)]),
        ]
      : [
          ...(request.fps === undefined ? [] : ["--fps", String(request.fps)]),
          ...(request.size === undefined ? [] : ["--size", request.size]),
        ];
  return [
    cliOf("@scenity/cli"),
    request.kind,
    dir,
    ...common,
    ...camera,
    ...extra,
    ...build,
    ...lock,
    "--out",
    join(dir, output),
  ];
}

/** Start the first waiting item of a project when no item runs. */
function pump(dir: string): void {
  const queue = queues.get(dir) ?? [];
  if (queue.some((item) => item.state === "running")) return;
  const item = queue.find((each) => each.state === "waiting");
  if (item === undefined) return;
  item.state = "running";
  startCliJob(`render:${dir}`, renderArgs(dir, item.request, item.output), dir, (job) => {
    item.state = job.code === 0 && existsSync(join(dir, item.output)) ? "done" : "failed";
    item.log = job.log.slice(-10);
    pump(dir);
  });
}

/** Add a request to the queue of a project folder. */
export function addRender(dir: string, request: RenderRequest): RenderItem {
  const id = next++;
  const name = basename(request.sequence).replace(/\.sequence\.json$/, "");
  const ext = request.kind === "sheet" ? "png" : "webm";
  const output = `${RENDERS_FOLDER}/${name}-${request.kind}-${String(id)}@${String(request.from)}-${String(request.to)}.${ext}`;
  const item: RenderItem = { id, request, state: "waiting", output, log: [] };
  queues.set(dir, [...(queues.get(dir) ?? []), item]);
  pump(dir);
  return item;
}

/** The state of the queue of a project folder. */
function renderState(dir: string): Record<string, unknown> {
  const folder = join(dir, RENDERS_FOLDER);
  const outputs = existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => /\.(png|jpe?g|webm)$/.test(name))
        .sort((a, b) => statSync(join(folder, b)).mtimeMs - statSync(join(folder, a)).mtimeMs)
        .map((name) => `${RENDERS_FOLDER}/${name}`)
    : [];
  const job = jobOf(`render:${dir}`);
  return { queue: queues.get(dir) ?? [], outputs, log: job.log.slice(-10) };
}

async function handleAdd(request: IncomingMessage, response: ServerResponse, dir: string): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A render comes only from a page of this server." });
    return;
  }
  const read = readRequest(await readJson(request).catch(() => ({})));
  if (typeof read === "string") sendJson(response, 400, { ok: false, reason: read });
  else sendJson(response, 200, { ok: true, item: addRender(dir, read) });
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityRenderQueueApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-render-queue-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const what = match?.[2] ?? "";
        if (dir !== undefined && what === "render.json" && request.method === "GET")
          sendJson(response, 200, renderState(dir));
        else if (dir !== undefined && what === "render.add" && request.method === "POST")
          void handleAdd(request, response, dir);
        else next();
      });
    },
  };
}
