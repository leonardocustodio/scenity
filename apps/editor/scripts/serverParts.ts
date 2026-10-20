// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the request handlers of the dev server plugins: a JSON answer, and the JSON body of a
 * request (at most 1 MB).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/** The largest JSON body (bytes). */
const JSON_LIMIT = 1024 * 1024;

/** Answer with a JSON value. */
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

/** The JSON body of a request. */
export function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    request.on("data", (part: Buffer) => {
      size += part.length;
      if (size > JSON_LIMIT) {
        reject(new Error("the request is too large"));
        request.destroy();
      } else parts.push(part);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    request.on("error", reject);
  });
}
