// SPDX-License-Identifier: Apache-2.0
/**
 * The surface port of the studio: the tools reach an editor window of Scenity Studio with no workbench page. Each
 * call goes to `POST <studio>/api/bridge/<call>` with the host secret. The studio host sends it over its socket
 * `/bridge` to the newest editor window (of the project) and gives the answer. A `{ $bytes }` value of the answer
 * (the bytes of a picture) becomes a `Uint8Array`.
 */
import { reviveBytes } from "@scenity/agent-tools/bytes";
import type { SurfacePort } from "./tools/context";

/** The header of the host secret of the studio (`@scenity/studio-host` access.ts `TOKEN_HEADER`). */
const TOKEN_HEADER = "x-studio-token";

/** The port of the editor windows of a studio host: its origin, its secret, and the project (none: the newest). */
export function studioSurfacePort(origin: string, token: string, project?: string): SurfacePort {
  return {
    async call(call, args = [], options = {}) {
      const response = await fetch(`${origin}/api/bridge/${encodeURIComponent(call)}`, {
        method: "POST",
        headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
        body: JSON.stringify({
          args,
          ...(project === undefined ? {} : { project }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        }),
      });
      const answer = (await response.json().catch(() => ({}))) as { result?: unknown; error?: unknown };
      if (!response.ok || typeof answer.error === "string") {
        throw new Error(
          typeof answer.error === "string" ? answer.error : `the studio answered ${String(response.status)}`,
        );
      }
      return reviveBytes(answer.result ?? null);
    },
  };
}
