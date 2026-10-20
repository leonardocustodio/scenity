// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
// The security of the lab dev server. In the remote mode of the workbench host, `server.fs` allows only the
// folders that the lab page loads, and both modes deny the secret files (scripts/labsFs.ts). The dev server sends the
// Content-Security-Policy header of the lab frames (scripts/labsCsp.ts). In the remote mode, the server refuses a
// request without the gate key of the gateway (scripts/labsGate.ts). Some tests start a real Vite server.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { CSP_HEADER, frameAncestor, labCsp, labsCsp, PAGE_ORIGIN_ENV, socketOrigins } from "../../scripts/labsCsp";
import { gateKey, labsGate } from "../../scripts/labsGate";
import { isRemote, labFsOptions, labPackageFolders, REMOTE_ORIGIN_ENV, SECRET_DENY } from "../../scripts/labsFs";

const REMOTE = { [REMOTE_ORIGIN_ENV]: "https://scenity.example.org" };
const REPO = resolve(import.meta.dirname, "../../../..");

const folders: string[] = [];
const servers: ViteDevServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** A small workspace: the editor app, two packages that it imports, one package that it does not, and secrets. */
function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "labs-fs-")));
  folders.push(root);
  const pkg = (name: string, dependencies: Record<string, string> = {}) =>
    JSON.stringify({ name, dependencies, devDependencies: { "@scenity/dev": "workspace:*" } });
  write(join(root, "package.json"), "{}");
  write(join(root, "apps/editor/package.json"), pkg("@scenity/editor", { "@scenity/room": "workspace:*", vue: "3" }));
  write(join(root, "apps/editor/index.html"), "<!doctype html><title>lab</title>");
  write(join(root, "apps/editor/.env"), "SECRET=1\n");
  write(join(root, "apps/editor/certs/server.key"), "key\n");
  write(join(root, "packages/room/package.json"), pkg("@scenity/room", { "@scenity/model": "workspace:*" }));
  write(join(root, "packages/room/src/index.ts"), "export const room = 1;\n");
  write(join(root, "packages/model/package.json"), pkg("@scenity/model"));
  write(join(root, "packages/model/src/index.ts"), "export const model = 1;\n");
  write(join(root, "packages/dev/package.json"), pkg("@scenity/dev"));
  write(join(root, "packages/host/package.json"), pkg("@scenity/host"));
  write(join(root, "packages/host/src/index.ts"), "export const host = 1;\n");
  write(join(root, "tools/script.ts"), "export {};\n");
  write(join(root, "art/demo/reviews/walk.yaml"), "family: walk\n");
  write(join(root, "art/demo/masters/room.txt"), "master\n");
  write(join(root, ".git/HEAD"), "ref: refs/heads/main\n");
  return root;
}

/** Start a Vite dev server on a free port of 127.0.0.1, with the given fs options and plugins. */
async function serve(
  root: string,
  options: { fs?: ReturnType<typeof labFsOptions>; plugins?: Plugin[] },
): Promise<string> {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: options.plugins ?? [],
    server: { host: "127.0.0.1", ...(options.fs === undefined ? {} : { fs: options.fs }) },
  });
  servers.push(server);
  await server.listen(0);
  const address = server.httpServer?.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  return `http://127.0.0.1:${String(address.port)}`;
}

/** The status and the headers of a GET request. */
function fetchHead(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, unknown> }> {
  return new Promise((done, fail) => {
    get(url, { headers }, (response) => {
      response.resume();
      done({ status: response.statusCode ?? 0, headers: response.headers });
    }).on("error", fail);
  });
}

describe("the fs options of the lab dev server", () => {
  it("the local mode allows the workspace and denies the secret files", () => {
    expect(isRemote({})).toBe(false);
    expect(isRemote({ [REMOTE_ORIGIN_ENV]: " " })).toBe(false);
    const options = labFsOptions({}, "/work/", ["/work/plugins/demo/generated/ts/"]);
    expect(options.allow).toEqual(["/work", "/work/plugins/demo/generated/ts/"]);
    expect(options.deny).toEqual([...SECRET_DENY]);
    for (const vite of [".env", ".env.*", "**/.git/**"]) expect(options.deny).toContain(vite);
  });

  it("the remote mode allows the editor app, the packages that it imports and the folders of the plugins only", () => {
    const root = workspace();
    expect(labPackageFolders(root)).toEqual([join(root, "packages/model"), join(root, "packages/room")]);
    // A plugin gives its extra folders (here generated files and review records) in its editor config face.
    const options = labFsOptions(REMOTE, root, [
      join(root, "plugins/demo/generated/ts"),
      join(root, "art/demo/reviews"),
    ]);
    expect(options.allow.sort()).toEqual(
      [
        "apps/editor",
        "art/demo/reviews",
        "node_modules",
        "packages/model",
        "packages/room",
        "plugins/demo/generated/ts",
      ].map((folder) => join(root, folder)),
    );
    expect(options.allow).not.toContain(root);
    expect(options.deny).toEqual([...SECRET_DENY]);
  });

  it("the remote mode of this repository allows the editor and its packages, not the host, tools or docs", () => {
    // The editor face of each plugin checks its own folders (plugins/<name>/editor/tests).
    const allow = labFsOptions(REMOTE, REPO).allow;
    for (const folder of ["apps/editor", "packages/runtime", "packages/ui"])
      expect(allow).toContain(join(REPO, folder));
    for (const folder of ["", "packages/workbench-host", "tools", "docs", "apps/workbench", "art"])
      expect(allow).not.toContain(join(REPO, folder));
  });

  it("a remote Vite server serves the allowed files and refuses the others and the secrets", async () => {
    const root = workspace();
    const origin = await serve(join(root, "apps/editor"), {
      fs: labFsOptions(REMOTE, root, [join(root, "art/demo/reviews")]),
    });
    const status = async (file: string): Promise<number> => (await fetchHead(`${origin}/@fs${file}`)).status;
    expect(await status(join(root, "packages/room/src/index.ts"))).toBe(200);
    expect(await status(join(root, "packages/model/src/index.ts"))).toBe(200);
    expect(await status(join(root, "art/demo/reviews/walk.yaml"))).toBe(200);
    expect(await status(join(root, "packages/host/src/index.ts"))).toBe(403);
    expect(await status(join(root, "tools/script.ts"))).toBe(403);
    expect(await status(join(root, "art/demo/masters/room.txt"))).toBe(403);
    expect(await status(join(root, "package.json"))).toBe(403);
    expect(await status(join(root, ".git/HEAD"))).toBe(403);
    expect(await status(join(root, "apps/editor/.env"))).toBe(403);
    expect(await status(join(root, "apps/editor/certs/server.key"))).toBe(403);
  });
});

describe("the CSP of the lab dev server", () => {
  it("allows only the own server, WebAssembly and inline styles; no inline script, eval or other origin", () => {
    const policy = labCsp(["ws://127.0.0.1:5175"]);
    const directives = new Map(policy.split("; ").map((part) => [part.split(" ")[0], part] as const));
    expect(directives.get("default-src")).toBe("default-src 'self'");
    expect(directives.get("script-src")).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(directives.get("connect-src")).toBe("connect-src 'self' ws://127.0.0.1:5175");
    expect(directives.get("object-src")).toBe("object-src 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("*");
    expect(policy).not.toContain("frame-ancestors");
  });

  it("names the WebSocket origins of the Host header and of the remote origin, and drops a bad host", () => {
    expect(socketOrigins("127.0.0.1:5175", {})).toEqual(["ws://127.0.0.1:5175", "wss://127.0.0.1:5175"]);
    expect(socketOrigins("127.0.0.1:4310", REMOTE)).toEqual([
      "ws://127.0.0.1:4310",
      "wss://127.0.0.1:4310",
      "wss://scenity.example.org",
    ]);
    expect(socketOrigins("evil; script-src *", {})).toEqual([]);
    expect(socketOrigins(undefined, { [REMOTE_ORIGIN_ENV]: "https://x.org/path" })).toEqual([]);
  });

  it("the dev server sends the header on the page and on the Vite client module", async () => {
    const root = workspace();
    const origin = await serve(join(root, "apps/editor"), { plugins: [labsCsp({})] });
    const host = new URL(origin).host;
    for (const path of ["/", "/index.html", "/@vite/client"]) {
      const answer = await fetchHead(`${origin}${path}`);
      expect(answer.status).toBe(200);
      expect(answer.headers[CSP_HEADER.toLowerCase()]).toBe(labCsp([`ws://${host}`, `wss://${host}`]));
    }
  });
});

describe("the token gate of the remote lab server", () => {
  const KEY = "a".repeat(64);
  const GATED = { ...REMOTE, SCENITY_WORKBENCH_LAB_GATE: KEY };

  it("the local mode has no gate; a remote server without a key refuses everything", () => {
    expect(gateKey({})).toBeNull();
    expect(gateKey(REMOTE)).toBe("");
    expect(gateKey(GATED)).toBe(KEY);
  });

  it("refuses a request with no token in the remote mode, and serves one with the gate key", async () => {
    const root = workspace();
    const origin = await serve(join(root, "apps/editor"), { plugins: [labsGate(GATED)] });
    for (const path of ["/", "/index.html", "/@vite/client"]) {
      expect((await fetchHead(`${origin}${path}`)).status).toBe(401);
      expect((await fetchHead(`${origin}${path}`, { "x-scenity-lab-gate": "b".repeat(64) })).status).toBe(401);
    }
    expect((await fetchHead(`${origin}/`, { "x-scenity-lab-gate": KEY })).status).toBe(200);
  });

  it("the HMR socket needs the gate key too", async () => {
    const root = workspace();
    const origin = await serve(join(root, "apps/editor"), { plugins: [labsGate(GATED)] });
    const status = await new Promise<number>((done, fail) => {
      get(`${origin}/`, { headers: { connection: "Upgrade", upgrade: "websocket" } }, (response) => {
        response.resume();
        done(response.statusCode ?? 0);
      }).on("error", fail);
    });
    expect(status).toBe(401);
  });

  it("the local mode serves a request without a key", async () => {
    const root = workspace();
    const origin = await serve(join(root, "apps/editor"), { plugins: [labsGate({})] });
    expect((await fetchHead(`${origin}/`)).status).toBe(200);
  });

  it("frame-ancestors names the public workbench page in the remote mode only", () => {
    const page = { ...REMOTE, [PAGE_ORIGIN_ENV]: "https://workbench.example.org/" };
    expect(frameAncestor(page)).toBe("https://workbench.example.org");
    expect(frameAncestor({ [PAGE_ORIGIN_ENV]: "https://workbench.example.org" })).toBeNull();
    expect(frameAncestor({ ...REMOTE, [PAGE_ORIGIN_ENV]: "evil; script-src *" })).toBeNull();
    expect(labCsp([], frameAncestor(page))).toContain("frame-ancestors https://workbench.example.org");
  });
});
