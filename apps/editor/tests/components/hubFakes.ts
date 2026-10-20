// SPDX-License-Identifier: Apache-2.0
// A fake studio host API for the tests of the Hub: it keeps the state in memory and records the calls.
import type {
  DataTemplate,
  DoctorCheck,
  JobInfo,
  JobRequest,
  Preferences,
  ProjectInfo,
  StudioApi,
  StudioEvent,
  StudioState,
} from "../../src/hub/studioApi";

export const PREFERENCES: Preferences = {
  format: "scenity.studio-preferences/1",
  theme: "dark",
  contrast: "standard",
  locale: "en-US",
  recentCount: 8,
  autosave: true,
  firstRunDone: true,
  editor: {},
  agent: { mode: "review", budgetUsd: 5 },
  importedKeys: [],
};

export function project(key: string, change: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    key,
    dir: `/home/me/work/${key}`,
    name: key,
    lastOpened: "2026-10-01T10:00:00.000Z",
    pinned: false,
    exists: true,
    id: key,
    format: "scenity.project/1",
    newer: false,
    scenes: 1,
    picture: null,
    git: null,
    trusted: true,
    runsCode: false,
    ...change,
  };
}

export interface FakeApi extends StudioApi {
  readonly calls: string[];
  readonly jobs: JobRequest[];
  studio: StudioState;
  /** The end state of each job command (default "done"). */
  jobEnd: Record<string, JobInfo["state"]>;
  /** The templates of the person and of the plugins. */
  templateList: readonly DataTemplate[];
  emit(event: StudioEvent): void;
}

const CHECKS: readonly DoctorCheck[] = [
  { id: "bun", state: "ok", detail: "1.4.2", needed: "everything", fix: null },
  {
    id: "chromium",
    state: "missing",
    detail: "not installed",
    needed: "pictures",
    fix: { kind: "command", label: "Install Chromium", job: "fix.chromium", cmd: ["bunx"] },
  },
  { id: "claude", state: "ok", detail: "2.1.0", needed: "the built-in agent", fix: null },
];

export function fakeApi(projects: readonly ProjectInfo[] = [], preferences: Partial<Preferences> = {}): FakeApi {
  const listeners: ((event: StudioEvent) => void)[] = [];
  const opened = (dir: string) => ({
    key: dir.split("/").at(-1) ?? "",
    url: `/p/${dir.split("/").at(-1) ?? ""}/`,
    restricted: false,
  });
  const api: FakeApi = {
    calls: [],
    jobs: [],
    jobEnd: {},
    templateList: [],
    studio: {
      origin: "http://127.0.0.1:5170",
      safe: false,
      preferences: { ...PREFERENCES, ...preferences },
      projects,
      open: [],
      roots: ["/home/me"],
      checkout: true,
    },
    emit: (event) => listeners.forEach((listener) => listener(event)),
    state: () => Promise.resolve(api.studio),
    openProject: (dir) => {
      api.calls.push(`open ${dir}`);
      return Promise.resolve(opened(dir));
    },
    makeProject: (dir) => {
      api.calls.push(`make ${dir}`);
      return Promise.resolve(opened(dir));
    },
    projectAction: (action, key) => {
      api.calls.push(`${action} ${key}`);
      return Promise.resolve();
    },
    renameProject: (key, name) => {
      api.calls.push(`rename ${key} ${name}`);
      return Promise.resolve();
    },
    templates: () => Promise.resolve(api.templateList),
    saveTemplate: (key, title, description) => {
      api.calls.push(`template ${key} ${title}`);
      const made = { id: `user:${key}`, source: "user" as const, title, description, picture: false };
      api.templateList = [...api.templateList, made];
      return Promise.resolve(made);
    },
    pinProject: (key, pinned) => {
      api.calls.push(`pin ${key} ${String(pinned)}`);
      return Promise.resolve();
    },
    folders: (path = "/home/me") =>
      Promise.resolve({
        path,
        parent: path === "/home/me" ? null : "/home/me",
        project: path.endsWith("/demo"),
        folders: [{ name: "demo", path: `${path}/demo`, project: true }],
        roots: ["/home/me"],
      }),
    makeFolder: (parent, name) => Promise.resolve(`${parent}/${name}`),
    savePreferences: (next) => {
      api.calls.push(`preferences ${JSON.stringify(next)}`);
      api.studio = { ...api.studio, preferences: next };
      return Promise.resolve(next);
    },
    startJob: (request) => {
      api.jobs.push(request);
      const job: JobInfo = {
        id: `job-${String(api.jobs.length)}`,
        command: request.command,
        cwd: request.cwd,
        state: "running",
        exitCode: null,
        outputs: [],
      };
      setTimeout(() => {
        const state = api.jobEnd[request.command] ?? "done";
        api.emit({ type: "jobs.output", id: job.id, text: `${request.command} output\n` });
        api.emit({ type: "jobs.state", job: { ...job, state, exitCode: state === "done" ? 0 : 1 } });
      }, 5);
      return Promise.resolve(job);
    },
    job: (id) => Promise.reject(new Error(`no job ${id}`)),
    cancelJob: () => Promise.resolve(),
    doctor: () => Promise.resolve(CHECKS),
    importBrowser: (entries) => Promise.resolve(Object.keys(entries)),
    events: (listener) => {
      listeners.push(listener);
      return () => undefined;
    },
  };
  return api;
}
