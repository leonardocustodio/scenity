// SPDX-License-Identifier: Apache-2.0
/**
 * The HTTP API of the studio host: projects, folders, the user state, jobs and the
 * doctor, under `/api/`. Each answer is JSON. A request that is not valid gets 400 with `{ error }`.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { runDoctor } from "./doctor";
import type { Folders } from "./folders";
import { jobRequestSchema, type JobService } from "./jobs";
import type { OpenProjects } from "./openProjects";
import { makeProject, readProjectDoc, type ProjectRegistry } from "./registry";
import { listTemplates, saveTemplate, templateDir, type TemplateInfo } from "./templates";
import { importBrowserState, keymapSchema, layoutsSchema, preferencesSchema, type UserState } from "./userState";

export interface ApiContext {
  readonly state: UserState;
  readonly registry: ProjectRegistry;
  readonly open: OpenProjects;
  readonly folders: Folders;
  readonly jobs: JobService;
  readonly editorApp: string | null;
  /** True in safe mode: every project opens restricted (no plugin code). */
  readonly safe: boolean;
  readonly origin: string;
  /** Tell the pages of the studio that the projects changed. */
  readonly changed: () => void;
  /** The role of the request (`/api/state` gives it to the page). */
  readonly role?: string;
  /** True for a studio in remote mode (behind the gateway). */
  readonly remote?: boolean;
}

export const json = (data: unknown, status = 200): Response => Response.json(data, { status });
const bad = (error: unknown): Response => json({ error: error instanceof Error ? error.message : String(error) }, 400);

/** The editor page of a project: its first scene in edit mode. */
export function editorUrl(key: string, dir: string): string {
  const scene = readProjectDoc(dir)?.scenes[0];
  const params = new URLSearchParams({ project: key });
  if (scene !== undefined) params.set("scene", scene);
  params.set("edit", "1");
  return `/scene.html?${params.toString()}`;
}

/** Open a project folder: the registry, the open projects and the restriction. */
export function openProject(ctx: ApiContext, dir: string): { key: string; url: string; restricted: boolean } {
  const entry = ctx.registry.add(dir);
  const info = ctx.registry.info(entry);
  const restricted = ctx.safe || (info.runsCode && !info.trusted);
  ctx.open.open(entry.key, entry.dir, restricted);
  ctx.changed();
  return { key: entry.key, url: editorUrl(entry.key, entry.dir), restricted };
}

const keyBody = z.object({ key: z.string() });

function revealCommand(dir: string): string[] {
  if (process.platform === "darwin") return ["open", dir];
  if (process.platform === "win32") return ["explorer", dir];
  return ["xdg-open", dir];
}

/** The project routes: `/api/projects/<action>`. */
async function projects(ctx: ApiContext, request: Request, action: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  switch (action) {
    case "open": {
      const dir = z.object({ dir: z.string().min(1) }).parse(body).dir;
      return json(openProject(ctx, dir));
    }
    case "make": {
      const { dir, name } = z.object({ dir: z.string().min(1), name: z.string().optional() }).parse(body);
      return json(openProject(ctx, makeProject(ctx.folders.allowed(dir), name)));
    }
    case "close":
      ctx.open.close(keyBody.parse(body).key);
      break;
    case "remove":
      ctx.open.close(keyBody.parse(body).key);
      ctx.registry.remove(keyBody.parse(body).key);
      break;
    case "rename": {
      const { key, name } = z.object({ key: z.string(), name: z.string().min(1).max(120) }).parse(body);
      ctx.registry.rename(key, name);
      break;
    }
    case "pin": {
      const { key, pinned } = z.object({ key: z.string(), pinned: z.boolean() }).parse(body);
      ctx.registry.pin(key, pinned);
      break;
    }
    case "trust": {
      const entry = ctx.registry.byKey(keyBody.parse(body).key);
      if (entry === undefined) throw new Error("no such project");
      ctx.registry.trust(entry.dir);
      if (ctx.open.get(entry.key) !== undefined) ctx.open.open(entry.key, entry.dir, ctx.safe);
      break;
    }
    case "reveal": {
      const entry = ctx.registry.byKey(keyBody.parse(body).key);
      if (entry === undefined) throw new Error("no such project");
      const [cmd, ...args] = revealCommand(entry.dir);
      spawn(cmd ?? "open", args, { detached: true, stdio: "ignore" }).unref();
      break;
    }
    default:
      return json({ error: `no project action ${action}` }, 404);
  }
  ctx.changed();
  return json({ ok: true });
}

const PICTURE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

/** The picture of a project (its first poster or still). */
function picture(ctx: ApiContext, key: string): Response {
  const entry = ctx.registry.byKey(key);
  const info = entry === undefined ? null : ctx.registry.info(entry);
  if (entry === undefined || info?.picture == null) return new Response(null, { status: 404 });
  const file = join(entry.dir, info.picture);
  return new Response(readFileSync(file), { headers: { "content-type": PICTURE_TYPES[extname(file)] ?? "image/png" } });
}

const USER_FILES = { preferences: preferencesSchema, layouts: layoutsSchema, keymap: keymapSchema } as const;

async function user(ctx: ApiContext, request: Request, name: string): Promise<Response> {
  if (name === "import" && request.method === "POST") {
    const entries = z.record(z.string(), z.string()).parse(await request.json());
    return json({ moved: importBrowserState(ctx.state, entries) });
  }
  if (!(name in USER_FILES)) return json({ error: `no user file ${name}` }, 404);
  const file = ctx.state[name as keyof typeof USER_FILES];
  if (request.method === "GET") return json(file.read());
  if (request.method === "PUT") return json((file.write as (value: unknown) => unknown)(await request.json()));
  return json({ error: "method not allowed" }, 405);
}

/** The checkout of the studio (the folder of the samples and the plugins), or null. */
function checkoutOf(ctx: ApiContext): string | null {
  if (ctx.editorApp === null) return null;
  const root = resolve(ctx.editorApp, "..", "..");
  return existsSync(join(root, "samples")) ? root : null;
}

/**
 * The templates of the person and of the plugins. `GET /api/templates` lists them; `POST /api/templates` with
 * `{ key, title, description }` saves a project as a template of the person. `GET /api/templates/picture?id=` gives
 * the picture of a template.
 */
async function templates(ctx: ApiContext, request: Request, rest: string[], url: URL): Promise<Response> {
  const all = listTemplates(ctx.state.dir, checkoutOf(ctx));
  if (rest[0] === "picture") {
    const template = all.find((each) => each.id === url.searchParams.get("id"));
    if (template?.picture == null) return new Response(null, { status: 404 });
    const file = join(template.dir, template.picture);
    return new Response(readFileSync(file), {
      headers: { "content-type": PICTURE_TYPES[extname(file)] ?? "image/png" },
    });
  }
  if (request.method === "POST") {
    const body = z
      .object({ key: z.string(), title: z.string().trim().min(1), description: z.string().default("") })
      .parse(await request.json());
    const entry = ctx.registry.byKey(body.key);
    if (entry === undefined) throw new Error("no such project");
    return json(listing(saveTemplate(ctx.state.dir, entry.dir, body)));
  }
  return json({ templates: all.map(listing) });
}

/** A template for the page: no folder, and true when it has a picture. */
const listing = (template: TemplateInfo) => ({
  id: template.id,
  source: template.source,
  title: template.title,
  description: template.description,
  picture: template.picture !== null,
});

/**
 * A `create` job with the ID of a template of the person or of a plugin copies its folder (`--from`). The page
 * names a template by its ID only. The host refuses a folder from the page.
 */
function createArgs<T>(ctx: ApiContext, args: Readonly<Record<string, T | string>>): Record<string, T | string> {
  if ("from" in args) throw new Error("name a template by its ID");
  const template = args.template;
  if (typeof template !== "string" || !/^(user|plugin):/.test(template)) return { ...args };
  const dir = templateDir(ctx.state.dir, checkoutOf(ctx), template);
  if (dir === null) throw new Error(`no template ${template}`);
  const rest: Record<string, T | string> = { ...args, from: dir };
  delete rest.template;
  return rest;
}

/** True when `path` is one of the outputs of a job, or a file in one of them. */
function isOutput(outputs: readonly string[], path: string): boolean {
  return outputs.some((out) => path === out || path.startsWith(out.endsWith(sep) ? out : out + sep));
}

async function jobs(ctx: ApiContext, request: Request, rest: string[], url: URL): Promise<Response> {
  const [id, action] = rest;
  if (id === undefined) {
    if (request.method === "POST") {
      // A job runs in an allowed folder only (the roots of the folder dialog).
      const body = jobRequestSchema.parse(await request.json());
      const args = body.command === "create" ? createArgs(ctx, body.args) : body.args;
      return json(ctx.jobs.start({ ...body, args, cwd: ctx.folders.allowed(body.cwd) }));
    }
    return json(ctx.jobs.list());
  }
  const job = ctx.jobs.get(id);
  if (job === undefined) return json({ error: "no such job" }, 404);
  if (action === "cancel" && request.method === "POST") return json({ ok: ctx.jobs.cancel(id) });
  if (action === "file") {
    const path = resolve(url.searchParams.get("path") ?? "");
    if (!isOutput(job.outputs, path) || !existsSync(path) || !statSync(path).isFile())
      return json({ error: "not an output" }, 404);
    return new Response(readFileSync(path), {
      headers: { "content-type": PICTURE_TYPES[extname(path)] ?? "application/octet-stream" },
    });
  }
  return json({ job, log: ctx.jobs.log(id) });
}

/** Answer a request of `/api/…`. */
export async function handleApi(ctx: ApiContext, request: Request, url: URL): Promise<Response> {
  const [, , area = "", ...rest] = url.pathname.split("/");
  try {
    switch (area) {
      case "state":
        return json({
          origin: ctx.origin,
          safe: ctx.safe,
          preferences: ctx.state.preferences.read(),
          projects: ctx.registry.list(),
          open: ctx.open.list(),
          roots: ctx.folders.roots,
          checkout: ctx.editorApp !== null && existsSync(join(ctx.editorApp, "..", "..", "samples")),
          role: ctx.role ?? "admin",
          remote: ctx.remote ?? false,
        });
      case "projects":
        if (rest[1] === "picture" && rest[0] !== undefined) return picture(ctx, rest[0]);
        return await projects(ctx, request, rest[0] ?? "");
      case "folders":
        if (request.method === "POST") {
          const { parent, name } = z.object({ parent: z.string(), name: z.string() }).parse(await request.json());
          return json({ path: ctx.folders.make(parent, name) });
        }
        return json(ctx.folders.list(url.searchParams.get("path") ?? undefined));
      case "user":
        return await user(ctx, request, rest[0] ?? "");
      case "jobs":
        return await jobs(ctx, request, rest, url);
      case "templates":
        return await templates(ctx, request, rest, url);
      case "doctor":
        return json(runDoctor(ctx.editorApp));
      default:
        return json({ error: `no API ${area}` }, 404);
    }
  } catch (error) {
    return bad(error);
  }
}
