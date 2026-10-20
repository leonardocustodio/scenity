// SPDX-License-Identifier: Apache-2.0
/**
 * The worker paths of the WebKit engine of the render pool (webkit.ts), under
 * `/__pool/webkit/` on the origin of the built lab. Each path needs the worker token (`authorization: Bearer <token>`):
 * the host gives it to the pool (`SCENITY_LABS_POOL_WORKER_TOKEN`) and to its pages (`SurfaceState.indexerWorker`).
 * The worker token gives only these two paths, not the API of the tools.
 *
 *   POST /__pool/webkit/poll?worker=<id>                  {agent, place} → {command} (a long poll; null after 20 s)
 *   POST /__pool/webkit/answer?worker=<id>&command=<n>    a body of `packPicture` → {ok}
 *
 * The indexer page runs on `tauri://localhost`, so the paths answer CORS for that origin and for loopback pages.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { WebKitPages, WorkerInfo } from "./webkit";

/** The variable with the worker token that the host gives the pool. */
export const POOL_WORKER_TOKEN_ENV = "SCENITY_LABS_POOL_WORKER_TOKEN";
/** The largest answer of a worker: a PNG of 4096 px and its head. */
const MAX_ANSWER = 64 * 1024 * 1024;
/** The origins of the worker pages: the page of the app and loopback pages (a test, the browser workbench). */
const PAGE_ORIGIN = /^(tauri:\/\/localhost|http:\/\/(127\.0\.0\.1|localhost):\d{1,5})$/;
/** A worker ID of the page: letters, digits and dashes. */
const WORKER_ID = /^[a-z0-9-]{4,64}$/i;

function digest(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

function cors(request: IncomingMessage): Record<string, string> {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !PAGE_ORIGIN.test(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function sendJson(request: IncomingMessage, response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    ...cors(request),
    "content-type": "application/json",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body)),
  });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_ANSWER) {
        reject(new Error("The answer is too large."));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

function infoOf(body: Buffer): WorkerInfo {
  let value: unknown;
  try {
    value = body.byteLength === 0 ? {} : JSON.parse(body.toString("utf8"));
  } catch {
    value = {};
  }
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const text = (item: unknown, fallback: string): string => (typeof item === "string" ? item.slice(0, 300) : fallback);
  return { agent: text(record.agent, "unknown"), place: text(record.place, "indexer") };
}

/** The handler of the worker paths: true when it answered. `token` null disables the paths. */
export function webkitApi(webkit: WebKitPages, token: string | null) {
  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname.slice("/__pool/webkit/".length);
    if (path !== "poll" && path !== "answer") return false;
    if (request.method === "OPTIONS") {
      response.writeHead(204, cors(request));
      response.end();
      return true;
    }
    const header = request.headers.authorization;
    const given = typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (token === null || request.method !== "POST" || !timingSafeEqual(digest(given), digest(token))) {
      sendJson(request, response, 401, { error: "The WebKit worker paths need the worker token." });
      return true;
    }
    const worker = url.searchParams.get("worker") ?? "";
    if (!WORKER_ID.test(worker)) {
      sendJson(request, response, 400, { error: "A worker ID is necessary." });
      return true;
    }
    const body = await readBody(request);
    if (path === "poll") {
      const gone = new AbortController();
      response.once("close", () => gone.abort());
      const command = await webkit.poll(worker, infoOf(body), undefined, gone.signal);
      // A page that closed gets no command: the command returns to the queue for the next poll.
      if (gone.signal.aborted || response.destroyed) {
        if (command !== null) webkit.requeue(worker, command);
        return true;
      }
      sendJson(request, response, 200, { command });
      return true;
    }
    const command = Number(url.searchParams.get("command"));
    const known = Number.isInteger(command) && webkit.answer(worker, command, body);
    sendJson(request, response, known ? 200 : 404, { ok: known });
    return true;
  };
}
