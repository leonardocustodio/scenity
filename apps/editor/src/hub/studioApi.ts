// SPDX-License-Identifier: Apache-2.0
/**
 * The client of the studio host API for the pages of the studio: the projects, the folders, the preferences, the jobs
 * and the doctor of `packages/studio-host/src/api.ts`. A write sends the CSRF value of the session (its cookie) in a
 * header. `events` follows the WebSocket `/events` of the host.
 */

export interface ProjectInfo {
  readonly key: string;
  readonly dir: string;
  readonly name: string;
  readonly lastOpened: string;
  readonly pinned: boolean;
  readonly exists: boolean;
  readonly id: string | null;
  readonly format: string | null;
  readonly newer: boolean;
  readonly scenes: number;
  readonly picture: string | null;
  readonly git: { readonly branch: string; readonly changed: number } | null;
  readonly trusted: boolean;
  readonly runsCode: boolean;
}

export type AgentMode = "ask" | "review" | "auto";

export interface Preferences {
  readonly format: "scenity.studio-preferences/1";
  readonly theme: "dark" | "light" | "navy";
  readonly contrast: "standard" | "more";
  readonly locale: string;
  readonly recentCount: number;
  readonly autosave: boolean;
  readonly firstRunDone: boolean;
  readonly editor: Readonly<Record<string, unknown>>;
  readonly agent: {
    readonly mode: AgentMode;
    readonly model?: string;
    readonly effort?: string;
    readonly budgetUsd: number;
    /** The value per kind of action (scene, files, runs, imports, network, git). */
    readonly kinds?: Readonly<Record<string, "allow" | "ask" | "deny">>;
  };
  readonly importedKeys: readonly string[];
}

export interface OpenProject {
  readonly key: string;
  readonly dir: string;
  readonly restricted: boolean;
}

export interface StudioState {
  readonly origin: string;
  readonly safe: boolean;
  readonly preferences: Preferences;
  readonly projects: readonly ProjectInfo[];
  readonly open: readonly OpenProject[];
  readonly roots: readonly string[];
  /** True when the studio runs from a Scenity checkout (the `sample:` templates need one). */
  readonly checkout: boolean;
  /** The role of this browser session and the remote mode of the studio. */
  readonly role?: "viewer" | "editor" | "admin";
  readonly remote?: boolean;
}

export interface FolderListing {
  readonly path: string;
  readonly parent: string | null;
  readonly project: boolean;
  readonly folders: readonly { readonly name: string; readonly path: string; readonly project: boolean }[];
  readonly roots: readonly string[];
}

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobInfo {
  readonly id: string;
  readonly command: string;
  readonly cwd: string;
  readonly state: JobState;
  readonly exitCode: number | null;
  readonly outputs: readonly string[];
}

export interface JobRequest {
  readonly command: string;
  readonly args?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  readonly cwd: string;
  readonly project?: string;
}

export interface DoctorCheck {
  readonly id: "bun" | "git" | "blender" | "chromium" | "claude";
  readonly state: "ok" | "warn" | "missing";
  readonly detail: string;
  readonly needed: string;
  readonly fix:
    | {
        readonly kind: "command";
        readonly label: string;
        readonly job: string;
        readonly cmd: readonly string[];
        readonly cwd?: string;
      }
    | { readonly kind: "docs"; readonly label: string; readonly url: string }
    | null;
}

/** A template of the person or of a plugin (the built-in templates are in templates.ts). */
export interface DataTemplate {
  /** `user:<id>` or `plugin:<package>/<id>`: the `template` value of a `create` job. */
  readonly id: string;
  readonly source: "user" | "plugin";
  readonly title: string;
  readonly description: string;
  /** True when `/api/templates/picture?id=` gives a picture. */
  readonly picture: boolean;
}

export type StudioEvent =
  | { readonly type: "projects.changed" }
  | { readonly type: "jobs.state"; readonly job: JobInfo }
  | { readonly type: "jobs.output"; readonly id: string; readonly text: string };

/** The error of an API answer that is not 2xx: its `error` text. */
export class StudioError extends Error {}

/** The CSRF value of the session (the readable cookie of the host). */
export function csrfValue(cookies: string = typeof document === "undefined" ? "" : document.cookie): string {
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "scenity_studio_csrf") return decodeURIComponent(rest.join("="));
  }
  return "";
}

export interface StudioApi {
  state(): Promise<StudioState>;
  openProject(dir: string): Promise<{ key: string; url: string; restricted: boolean }>;
  makeProject(dir: string, name?: string): Promise<{ key: string; url: string; restricted: boolean }>;
  projectAction(action: "close" | "remove" | "trust" | "reveal", key: string): Promise<void>;
  renameProject(key: string, name: string): Promise<void>;
  /** The templates of the person and of the plugins. */
  templates(): Promise<readonly DataTemplate[]>;
  /** Save a project as a template of the person. */
  saveTemplate(key: string, title: string, description: string): Promise<DataTemplate>;
  pinProject(key: string, pinned: boolean): Promise<void>;
  folders(path?: string): Promise<FolderListing>;
  makeFolder(parent: string, name: string): Promise<string>;
  savePreferences(preferences: Preferences): Promise<Preferences>;
  startJob(request: JobRequest): Promise<JobInfo>;
  job(id: string): Promise<{ job: JobInfo; log: readonly string[] }>;
  cancelJob(id: string): Promise<void>;
  doctor(): Promise<readonly DoctorCheck[]>;
  importBrowser(entries: Readonly<Record<string, string>>): Promise<readonly string[]>;
  events(listener: (event: StudioEvent) => void): () => void;
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** The client over `fetch` (a test gives a fake) and the page origin. */
export function studioApi(fetcher: Fetcher = (input, init) => fetch(input, init), origin = ""): StudioApi {
  const call = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const headers: Record<string, string> = { "x-studio-csrf": csrfValue() };
    if (body !== undefined) headers["content-type"] = "application/json";
    const answer = await fetcher(`${origin}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await answer.json().catch(() => ({}))) as T & { error?: string };
    if (!answer.ok) throw new StudioError(data.error ?? `${method} ${path}: ${String(answer.status)}`);
    return data;
  };
  return {
    state: () => call("/api/state"),
    openProject: (dir) => call("/api/projects/open", "POST", { dir }),
    makeProject: (dir, name) => call("/api/projects/make", "POST", name === undefined ? { dir } : { dir, name }),
    projectAction: async (action, key) => {
      await call(`/api/projects/${action}`, "POST", { key });
    },
    renameProject: async (key, name) => {
      await call("/api/projects/rename", "POST", { key, name });
    },
    templates: async () => (await call<{ templates: DataTemplate[] }>("/api/templates")).templates,
    saveTemplate: (key, title, description) => call("/api/templates", "POST", { key, title, description }),
    pinProject: async (key, pinned) => {
      await call("/api/projects/pin", "POST", { key, pinned });
    },
    folders: (path) => call(`/api/folders${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`),
    makeFolder: async (parent, name) => (await call<{ path: string }>("/api/folders", "POST", { parent, name })).path,
    savePreferences: (preferences) => call("/api/user/preferences", "PUT", preferences),
    startJob: (request) => call("/api/jobs", "POST", request),
    job: (id) => call(`/api/jobs/${encodeURIComponent(id)}`),
    cancelJob: async (id) => {
      await call(`/api/jobs/${encodeURIComponent(id)}/cancel`, "POST", {});
    },
    doctor: () => call("/api/doctor"),
    importBrowser: async (entries) => (await call<{ moved: string[] }>("/api/user/import", "POST", entries)).moved,
    events: (listener) => {
      const url = `${(origin || location.origin).replace(/^http/, "ws")}/events`;
      const socket = new WebSocket(url);
      socket.onmessage = (message) => {
        listener(JSON.parse(String(message.data)) as StudioEvent);
      };
      return () => socket.close();
    },
  };
}

/** A recipe of the agents as the Hub lists it. */
export interface HubRecipe {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly params?: UserRecipe["params"];
  readonly source: "studio" | "user" | "project";
}

/** The recipes of the studio and of the person (no project); none when the host has no agents. */
export async function studioRecipes(fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<HubRecipe[]> {
  try {
    const answer = await fetcher("/api/agent/recipes", { headers: { "x-studio-csrf": csrfValue() } });
    if (!answer.ok) return [];
    return ((await answer.json()) as { recipes?: HubRecipe[] }).recipes ?? [];
  } catch {
    return [];
  }
}

/** A recipe of the person as the host keeps it. */
export interface UserRecipe {
  readonly format: "scenity.recipe/1";
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly params: readonly { readonly name: string; readonly label: string; readonly default?: string }[];
}

/** Write the recipes of the person. The result is the reason of a refusal, or null. */
export async function saveUserRecipes(
  recipes: readonly UserRecipe[],
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<string | null> {
  const answer = await fetcher("/api/agent/recipes", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-studio-csrf": csrfValue() },
    body: JSON.stringify({ recipes }),
  }).catch((error: unknown) => error as Error);
  if (answer instanceof Error) return answer.message;
  if (answer.ok) return null;
  return ((await answer.json().catch(() => ({}))) as { error?: string }).error ?? answer.statusText;
}

/** The cost and the tokens of the agents on the current day; null when the host has no agents. */
export async function studioUsage(
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<{ readonly costUsd: number; readonly tokens: number } | null> {
  try {
    const answer = await fetcher("/api/agent/usage", { headers: { "x-studio-csrf": csrfValue() } });
    if (!answer.ok) return null;
    return ((await answer.json()) as { today?: { costUsd: number; tokens: number } }).today ?? null;
  } catch {
    return null;
  }
}

/** True when the studio runs agent sessions. */
export async function agentsAvailable(fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<boolean> {
  try {
    const answer = await fetcher("/api/agent/status", { headers: { "x-studio-csrf": csrfValue() } });
    return answer.ok && ((await answer.json()) as { available?: boolean }).available === true;
  } catch {
    return false;
  }
}

/** A template that the wizard offers to the agent. */
export interface TemplateOffer {
  readonly id: string;
  readonly title: string;
  readonly about: string;
}

/** The template and the name that the agent chooses for the words of the person. A refusal throws an error. */
export async function chooseTemplate(
  prompt: string,
  templates: readonly TemplateOffer[],
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<{ readonly template: string; readonly name: string }> {
  const answer = await fetcher("/api/agent/choose-template", {
    method: "POST",
    headers: { "content-type": "application/json", "x-studio-csrf": csrfValue() },
    body: JSON.stringify({ prompt, templates }),
  });
  const data = (await answer.json().catch(() => ({}))) as { template?: string; name?: string; error?: string };
  if (!answer.ok || data.template === undefined || data.name === undefined)
    throw new StudioError(data.error ?? answer.statusText);
  return { template: data.template, name: data.name };
}
