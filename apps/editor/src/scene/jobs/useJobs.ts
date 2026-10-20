// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the Jobs panel. It has the jobs of the dev server (scripts/jobsApi.ts: builds, shots, renders, benches,
 * checks, asset builds, runs) and, in the studio, the jobs of the host, in one list. The newest job is first, each with
 * its state, its log and its output files, Run again and Stop. It also has the runs of the project (`workbench.runs`)
 * with their presets. The list loads again each 2 s while a job runs.
 */
import { onBeforeUnmount, ref, shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { csrfValue } from "../../hub/studioApi";

/** One output file of a job. */
export interface JobOutput {
  readonly name: string;
  readonly url: string | null;
  readonly kind: "picture" | "video" | "file";
}

/** One job of the list. */
export interface JobRow {
  readonly source: "server" | "studio";
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly code: number | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly log: readonly string[];
  readonly outputs: readonly JobOutput[];
  /** The request of a studio job, for Run again. */
  readonly request?: Readonly<Record<string, unknown>>;
}

export interface RunRow {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly presets: readonly { readonly label: string; readonly args: readonly string[] }[];
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** The kind of an output file by its extension. */
export function outputKind(path: string): JobOutput["kind"] {
  if (/\.(png|jpe?g|webp)$/i.test(path)) return "picture";
  return /\.(webm|mp4)$/i.test(path) ? "video" : "file";
}

const nameOf = (path: string): string => path.split(/[\\/]/).at(-1) ?? path;

export interface ServerJob {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly code: number | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly log: readonly string[];
  readonly outputs: readonly { readonly path: string; readonly url: string | null }[];
}

export interface StudioJob {
  readonly id: string;
  readonly command: string;
  readonly argv: readonly string[];
  readonly args?: Readonly<Record<string, unknown>>;
  readonly cwd: string;
  readonly project: string | null;
  readonly state: string;
  readonly exitCode: number | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly outputs: readonly string[];
}

/** The rows of the jobs of the dev server. */
export function serverRows(jobs: readonly ServerJob[]): JobRow[] {
  return jobs.map((job) => ({
    source: "server",
    ...{
      id: job.id,
      title: job.title,
      state: job.state,
      code: job.code,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
    },
    log: job.log,
    outputs: job.outputs.map((output) => ({
      name: nameOf(output.path),
      url: output.url,
      kind: outputKind(output.path),
    })),
  }));
}

/** The rows of the jobs of the studio host. */
export function studioRows(jobs: readonly StudioJob[]): JobRow[] {
  return jobs.map((job) => ({
    source: "studio",
    id: job.id,
    title: `${job.command} · ${job.argv.slice(1).join(" ")}`,
    ...{ state: job.state, code: job.exitCode, startedAt: job.startedAt, endedAt: job.endedAt, log: [] },
    outputs: job.outputs.map((path) => ({
      name: nameOf(path),
      url: `/api/jobs/${encodeURIComponent(job.id)}/file?path=${encodeURIComponent(path)}`,
      kind: outputKind(path),
    })),
    ...(job.args === undefined
      ? {}
      : {
          request: {
            command: job.command,
            args: job.args,
            cwd: job.cwd,
            ...(job.project === null ? {} : { project: job.project }),
          },
        }),
  }));
}

/** The runs of the project and the commands of its plugins. */
async function projectLists(base: string, fetcher: Fetcher) {
  const answer = (await (await fetcher(`${base}runs.json`, { cache: "no-store" })).json()) as {
    runs?: RunRow[];
    restricted?: boolean;
  };
  const listed = (await (await fetcher(`${base}cli.commands.json`, { cache: "no-store" })).json()) as {
    commands?: { name: string; summary: string }[];
  };
  return { runs: answer.runs ?? [], restricted: answer.restricted === true, commands: listed.commands ?? [] };
}

/** The state and the actions of the panel for the project folder `base` (its URL, with a "/" at the end). */
export function useJobs(base: string, studio: () => boolean, fetcher: Fetcher = (input, init) => fetch(input, init)) {
  const rows = shallowRef<JobRow[]>([]);
  const runs = shallowRef<RunRow[]>([]);
  /** The commands of the CLI faces of the plugins. */
  const commands = shallowRef<{ name: string; summary: string }[]>([]);
  const restricted = ref(false);
  const error = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const post = (path: string, body: unknown, headers: Record<string, string> = { [IMPORT_HEADER]: "1" }) =>
    fetcher(path, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const studioHeaders = (): Record<string, string> => ({ "x-studio-csrf": csrfValue() });

  async function load(): Promise<void> {
    clearTimeout(timer);
    try {
      const server = (await (await fetcher("/jobs.json", { cache: "no-store" })).json()) as { jobs: ServerJob[] };
      const host = studio()
        ? ((await (await fetcher("/api/jobs", { headers: studioHeaders() })).json()) as StudioJob[])
        : [];
      const all = [...serverRows(server.jobs), ...studioRows(host)];
      rows.value = all.sort(
        (a, b) => (b.startedAt ?? Number.MAX_SAFE_INTEGER) - (a.startedAt ?? Number.MAX_SAFE_INTEGER),
      );
      const lists = await projectLists(base, fetcher);
      runs.value = lists.runs;
      commands.value = lists.commands;
      restricted.value = lists.restricted;
      error.value = null;
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason);
    }
    if (rows.value.some((row) => row.state === "running" || row.state === "queued"))
      timer = setTimeout(() => void load(), 2000);
  }
  onBeforeUnmount(() => clearTimeout(timer));

  async function act(answer: Promise<Response>): Promise<void> {
    const response = await answer.catch((reason: unknown) => reason as Error);
    if (response instanceof Error) error.value = response.message;
    else if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { reason?: string; error?: string };
      error.value = data.reason ?? data.error ?? `${String(response.status)} ${response.statusText}`;
    } else error.value = null;
    await load();
  }

  return {
    rows,
    runs,
    commands,
    restricted,
    error,
    load,
    again: (row: JobRow) =>
      act(
        row.source === "server" ? post("/jobs.again", { id: row.id }) : post("/api/jobs", row.request, studioHeaders()),
      ),
    cancel: (row: JobRow) =>
      act(
        row.source === "server"
          ? post("/jobs.cancel", { id: row.id })
          : post(`/api/jobs/${encodeURIComponent(row.id)}/cancel`, {}, studioHeaders()),
      ),
    /** The log of a studio job (the host keeps it). */
    studioLog: async (row: JobRow): Promise<readonly string[]> => {
      const answer = await fetcher(`/api/jobs/${encodeURIComponent(row.id)}`, { headers: studioHeaders() });
      return ((await answer.json()) as { log?: readonly string[] }).log ?? [];
    },
    startRun: (id: string, preset?: number) =>
      act(post(`${base}runs.start`, preset === undefined ? { id } : { id, preset })),
    /** Run a command of a plugin with a command line of arguments. */
    runCommand: (name: string, args: string) => act(post(`${base}cli.run`, { name, args })),
  };
}
