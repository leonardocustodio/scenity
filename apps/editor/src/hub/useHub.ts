// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the Hub: the studio state from the host, the section, the search and the sort of the projects, and
 * the jobs that the Hub started. The store loads the state again when the host tells that the projects changed. It
 * follows the state of its jobs through the events of the host.
 */
import { computed, reactive, readonly } from "vue";
import type { DoctorCheck, JobInfo, Preferences, ProjectInfo, StudioApi, StudioState } from "./studioApi";

export type HubSection = "projects" | "learn" | "agents" | "settings";
export type ProjectSort = "recent" | "name";

/** The projects that match the search, in the order of the sort; the pinned ones first. */
export function visibleProjects(projects: readonly ProjectInfo[], search: string, sort: ProjectSort): ProjectInfo[] {
  const words = search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "");
  const match = (p: ProjectInfo): boolean =>
    words.every((w) => `${p.name} ${p.dir} ${p.key}`.toLowerCase().includes(w));
  const order = (a: ProjectInfo, b: ProjectInfo): number =>
    sort === "name" ? a.name.localeCompare(b.name) : b.lastOpened.localeCompare(a.lastOpened);
  return projects.filter(match).sort((a, b) => Number(b.pinned) - Number(a.pinned) || order(a, b));
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface HubState {
  loaded: boolean;
  /** The error of the last load of the state. */
  error: string;
  /** The error of the last action of the person (an open, a rename). The Hub shows it until the person closes it. */
  notice: string;
  studio: StudioState | null;
  section: HubSection;
  search: string;
  sort: ProjectSort;
  view: "cards" | "list";
  jobs: Record<string, JobInfo>;
  /** The output of each job, from its events. */
  logs: Record<string, string>;
  /** The last checks of the doctor (null before the first run). */
  checks: readonly DoctorCheck[] | null;
}

/**
 * Wait for the end of a job. The events fill its state. Each second, the store also asks the host, because an event
 * can come before the socket is open.
 */
function waitForJob(state: HubState, api: StudioApi, id: string): Promise<JobInfo> {
  const ended = (job: JobInfo | undefined): job is JobInfo =>
    job !== undefined && ["done", "failed", "cancelled"].includes(job.state);
  return new Promise((resolve) => {
    let tick = 0;
    const check = async (): Promise<void> => {
      tick += 1;
      if (tick % 10 === 0) {
        const answer = await api.job(id).catch(() => null);
        if (answer !== null) {
          state.jobs[id] = answer.job;
          state.logs[id] ??= answer.log.join("\n");
        }
      }
      const job = state.jobs[id];
      if (ended(job)) resolve(job);
      else setTimeout(() => void check(), 100);
    };
    void check();
  });
}

/** Run the checks of the doctor on the host. The Hub keeps the last result. */
async function runChecks(state: HubState, api: StudioApi): Promise<void> {
  try {
    state.checks = await api.doctor();
  } catch (error) {
    state.notice = messageOf(error);
  }
}

export function useHub(api: StudioApi) {
  const state = reactive<HubState>({
    loaded: false,
    error: "",
    notice: "",
    studio: null,
    section: "projects",
    search: "",
    sort: "recent",
    view: "cards",
    jobs: {},
    logs: {},
    checks: null,
  });

  async function load(): Promise<void> {
    try {
      state.studio = await api.state();
      state.error = "";
    } catch (error) {
      state.error = messageOf(error);
    } finally {
      state.loaded = true;
    }
  }

  const stop = api.events((event) => {
    if (event.type === "projects.changed") void load();
    else if (event.type === "jobs.state") state.jobs[event.job.id] = event.job;
    else state.logs[event.id] = (state.logs[event.id] ?? "") + event.text;
  });

  const finished = (id: string): Promise<JobInfo> => waitForJob(state, api, id);
  const checkMachine = (): Promise<void> => runChecks(state, api);

  async function savePreferences(change: Partial<Preferences>): Promise<void> {
    if (state.studio === null) return;
    const preferences = await api.savePreferences({ ...state.studio.preferences, ...change });
    state.studio = { ...state.studio, preferences };
    applyTheme(preferences);
  }

  /** Show a section of the Hub. */
  function show(section: HubSection): void {
    state.section = section;
  }

  /** Run an action of the person; a failure goes to the notice. */
  async function attempt<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      state.notice = messageOf(error);
      return undefined;
    }
  }

  const projects = computed(() => visibleProjects(state.studio?.projects ?? [], state.search, state.sort));

  return {
    state: readonly(state),
    raw: state,
    load,
    stop,
    finished,
    attempt,
    show,
    savePreferences,
    checkMachine,
    projects,
    api,
  };
}

export type Hub = ReturnType<typeof useHub>;

/**
 * Put the theme on the body and the contrast on the root element. The token rules are
 * `[data-contrast="more"] [data-theme="…"]`, thus the contrast is on an element above the theme.
 */
export function applyTheme(
  preferences: Pick<Preferences, "theme" | "contrast">,
  root: HTMLElement = document.documentElement,
  body: HTMLElement = document.body,
): void {
  body.dataset.theme = preferences.theme;
  root.dataset.contrast = preferences.contrast;
  delete root.dataset.theme;
}

/** The `scenity.*` keys of the browser storage that the host has not imported yet. */
export function browserKeys(storage: Storage, imported: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null || !key.startsWith("scenity.") || imported.includes(key)) continue;
    out[key] = storage.getItem(key) ?? "";
  }
  return out;
}

/** Move the `scenity.*` keys of the browser storage of this origin to the user state of the host. */
export async function importBrowserKeys(
  api: Pick<StudioApi, "importBrowser">,
  imported: readonly string[],
  storage: () => Storage = () => localStorage,
): Promise<readonly string[]> {
  try {
    const entries = browserKeys(storage(), imported);
    return Object.keys(entries).length > 0 ? await api.importBrowser(entries) : [];
  } catch {
    // The storage can be closed (a private window). Then the import is not necessary.
    return [];
  }
}
