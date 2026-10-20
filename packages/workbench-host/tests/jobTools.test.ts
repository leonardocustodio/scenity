// SPDX-License-Identifier: Apache-2.0
// The job tools: `job_run` starts a CLI command of the project and gives its ID at once. `job_status` gives its state
// and `job_output` the last lines of its output. A host with no jobs and an unknown job give a clear error.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runCatalog, useRunCatalog } from "../src/runCatalog";
import { handleToolRequest } from "../src/tools/index";
import type { JobPort } from "../src/tools/jobs";
import type { RunInfo } from "../src/protocol";
import { fakeContext } from "./fakeLab";

function jobs(): JobPort & { started: string[][] } {
  const started: string[][] = [];
  const info: Omit<RunInfo, "output"> = {
    run: "r1",
    command: "check",
    args: [],
    status: "done",
    code: 0,
    summary: "12 rules pass.",
    outDir: null,
    images: [],
  } as unknown as Omit<RunInfo, "output">;
  return {
    started,
    start: (command, args) => {
      started.push([command, ...args]);
      return "r1";
    },
    info: (job) => (job === "r1" ? info : null),
    output: (job, lines) => (job === "r1" ? ["checking…", "12 rules pass."].slice(-lines) : null),
  };
}

const textOf = (result: { content: readonly { type: string; text?: string }[] }): string =>
  result.content.map((block) => block.text ?? "").join("\\n");

describe("the job tools", () => {
  // A project with one run for the agent: the job tools show with the runs of the open project.
  beforeAll(() => useRunCatalog(runCatalog({ check: { kind: "check", command: "scenity check" } }, null)));
  afterAll(() => useRunCatalog(null));

  test("start a job, read its state and its output", async () => {
    const port = jobs();
    const ctx = { ...fakeContext({ call: () => Promise.resolve(null) }), jobs: port };
    const run = textOf(await handleToolRequest("job_run", { command: "check", args: ["--json"] }, ctx));
    expect(run).toContain("Job r1 started: check --json.");
    expect(port.started).toEqual([["check", "--json"]]);
    expect(textOf(await handleToolRequest("job_status", { job: "r1" }, ctx))).toContain(
      "Job r1: check · done (exit 0)",
    );
    expect(textOf(await handleToolRequest("job_output", { job: "r1", lines: 1 }, ctx))).toBe("12 rules pass.");
  });

  test("give a clear error for an unknown job and for a host with no jobs", async () => {
    const ctx = { ...fakeContext({ call: () => Promise.resolve(null) }), jobs: jobs() };
    expect(textOf(await handleToolRequest("job_status", { job: "r9" }, ctx))).toBe('job_status: no job "r9".');
    const none = fakeContext({ call: () => Promise.resolve(null) });
    expect(textOf(await handleToolRequest("job_output", { job: "r1" }, none))).toBe(
      "job_output: the host has no jobs (job_output needs a run manager).",
    );
  });
});
