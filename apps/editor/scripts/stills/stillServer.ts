// SPDX-License-Identifier: Apache-2.0
/**
 * The server of the still page: Bun bundles `src/still/main.ts` once and serves `still.html`, the bundle, the
 * style sheet and the files of one project under `/projects/project/`. It listens on a free port of the loopback.
 * It also serves the asset index of the project (`assets.index.json`) and the WASM decoders of the asset loader
 * under `/decoders/` (the still page reads the assets through the manifest).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { assetIndex, projectFile } from "../projects";
import { APP } from "../lab/server";
import { STILL_DECODERS } from "./stillVersion";

export interface StillServer {
  readonly origin: string;
  stop(): void;
}

const TYPES: Readonly<Record<string, string>> = {
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

function typeOf(path: string): string {
  return TYPES[path.slice(path.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream";
}

/** The bundle of the still page (one ES module). */
async function bundle(): Promise<string> {
  const result = await Bun.build({ entrypoints: [join(APP, "src/still/main.ts")], target: "browser", format: "esm" });
  const [output] = result.outputs;
  if (!result.success || output === undefined) {
    throw new Error(`the still page does not bundle: ${result.logs.map(String).join("; ")}`);
  }
  return output.text();
}

/** Start the server of the still page for a project folder (absolute). */
export async function stillServer(projectDir: string): Promise<StillServer> {
  const script = await bundle();
  const pages: Readonly<Record<string, Response>> = {
    "/still.html": new Response(readFileSync(join(APP, "still.html")), { headers: { "Content-Type": "text/html" } }),
    "/src/still/main.ts": new Response(script, { headers: { "Content-Type": "text/javascript" } }),
    "/src/still/still.css": new Response(readFileSync(join(APP, "src/still/still.css")), {
      headers: { "Content-Type": "text/css" },
    }),
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      const page = pages[path];
      if (page !== undefined) return page.clone();
      const decoder = STILL_DECODERS[path];
      if (decoder !== undefined) {
        const wasm = readFileSync(createRequire(join(APP, "package.json")).resolve(decoder));
        return new Response(wasm, { headers: { "Content-Type": "application/wasm" } });
      }
      if (path === "/projects/project/assets.index.json") return Response.json(assetIndex(projectDir));
      const match = /^\/projects\/project\/(.+)$/.exec(path);
      const file = match?.[1] === undefined ? null : projectFile(projectDir, match[1]);
      if (file === null) return new Response("not found", { status: 404 });
      return new Response(readFileSync(file), { headers: { "Content-Type": typeOf(file) } });
    },
  });
  return {
    origin: `http://127.0.0.1:${String(server.port)}`,
    stop: () => {
      void server.stop(true);
    },
  };
}
