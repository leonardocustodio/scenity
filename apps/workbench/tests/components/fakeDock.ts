// SPDX-License-Identifier: Apache-2.0
/**
 * A fake host for the dock tabs: requests that answer from a table, events that a test emits, and run files from a
 * map.
 */
import type { EventPayload, EventType, ProjectRun, RequestType, RunInfo } from "@scenity/workbench-host/protocol";
import type { DockHost } from "../../src/dock/dockHost";
import type { HostRequest } from "../../src/host/useHost";

export type DockAnswers = Partial<Record<RequestType, (params: unknown) => unknown>>;

export function runInfo(patch: Partial<RunInfo> = {}): RunInfo {
  return {
    run: "r1",
    command: "motion",
    args: ["greet"],
    checkout: "/repo",
    status: "passed",
    code: 0,
    started: "2026-10-12T15:00:00.000Z",
    ended: "2026-10-12T15:00:20.000Z",
    gpu: true,
    summary: "take greet: 8 pass, 0 fail",
    outDir: "/repo/apps/editor/test-results/room3d/workbench/motion-r1",
    images: [],
    output: "",
    ...patch,
  };
}

/** A run of the project with the defaults of the host. */
export function projectRun(id: string, patch: Partial<ProjectRun> = {}): ProjectRun {
  return {
    ...{ id, label: id, command: `bun run labs ${id}`, kind: "tool", out: null, gpu: true, gpuOff: ["--check"] },
    ...{ confirm: false, ref: false, sequence: null, agent: true, aliases: [], presets: [] },
    ...patch,
  };
}

/** The runs of the lab project with their buttons, as the host plugin of the lab gives them (`runs.commands`). */
export const LAB_RUNS: readonly ProjectRun[] = [
  projectRun("motion", { label: "Motion", presets: [{ label: "Motion", sequence: "greet" }] }),
  projectRun("verify", { presets: [{ label: "Verify" }, { label: "Verify visual", args: ["--visual"] }] }),
  projectRun("review", { kind: "review", ref: true }),
  projectRun("stills"),
  projectRun("asset", { confirm: true, gpu: "confirmed" }),
  projectRun("perf", { agent: false, presets: [{ label: "Perf (quick, dry)", args: ["--quick", "--dry"] }] }),
  projectRun("promote", {
    label: "Promote",
    confirm: true,
    presets: [
      { label: "Promote (dry)", args: ["--dry"] },
      { label: "Promote…", confirm: "Run labs promote: every runtime gate, then the release record and the version." },
    ],
  }),
];

export function fakeDock(given: DockAnswers = {}, files: Record<string, string> = {}) {
  const answers: DockAnswers = { "runs.commands": () => ({ runs: LAB_RUNS, gate: "motion" }), ...given };
  const calls: { type: RequestType; params: unknown }[] = [];
  const listeners = new Map<string, Set<(payload: never) => void>>();
  const request = ((type: RequestType, params: unknown) => {
    calls.push({ type, params });
    const answer = answers[type];
    if (answer === undefined) return Promise.reject(new Error(`No answer for ${type}.`));
    try {
      return Promise.resolve(answer(params));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }) as HostRequest;
  const dock: DockHost = {
    request,
    on(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
      return () => set.delete(listener);
    },
    fetchRunFile(run, path) {
      const text = files[`${run}:${path}`];
      return text === undefined ? Promise.reject(new Error(`No file ${path}.`)) : Promise.resolve(new Blob([text]));
    },
    // The default sequence of the project of the host (the lab of the fake runs).
    defaultSequence: () => "greet",
  };
  function emit<T extends EventType>(type: T, payload: EventPayload<T>): void {
    for (const listener of listeners.get(type) ?? []) (listener as (value: EventPayload<T>) => void)(payload);
  }
  return { dock, calls, emit };
}
