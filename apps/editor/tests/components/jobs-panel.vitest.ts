// SPDX-License-Identifier: Apache-2.0
// The Jobs panel and the runs of the project. The journal of the dev server runs real child processes (the state, the
// log, the output pictures, run again, stop). Also a run of `workbench.runs` with its preset, the restricted project,
// and the panel with the jobs of the server and of the studio host.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelJob, journal, outputFiles, rerunJob, trackJob } from "../../scripts/cliJob";
import { commandWords, helpPluginCommands, jobsAnswer, projectRuns, startRun } from "../../scripts/jobsApi";
import { RESTRICTED_PROJECTS } from "../../scripts/projectsFile";
import JobsPanel from "../../src/scene/jobs/JobsPanel.vue";
import { outputKind, serverRows, studioRows } from "../../src/scene/jobs/useJobs";
import { studioHost } from "../../src/studio/shell/panels";
import { editorI18n } from "../../src/texts";

const BUN = process.execPath;
const until = async (test: () => boolean): Promise<void> => {
  for (let wait = 0; wait < 200 && !test(); wait += 1) await new Promise((resolve) => setTimeout(resolve, 25));
};

afterEach(() => {
  vi.unstubAllGlobals();
  studioHost.value = false;
  document.body.innerHTML = "";
});

describe("the journal of the jobs", () => {
  it("keeps the state, the log and the output pictures of a job, and runs it again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scenity-jobs-"));
    try {
      const script = "require('fs').writeFileSync('shot.png','x'); console.log(JSON.stringify({ file: 'shot.png' }))";
      const start = (): boolean => {
        const child = spawn(BUN, ["-e", script], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
        trackJob({ key: "test:shot", args: [BUN, "-e", script], cwd: dir, child, rerun: start });
        return true;
      };
      start();
      const first = journal()[0];
      expect(first?.state).toBe("running");
      await until(() => journal()[0]?.state !== "running");
      expect(journal()[0]).toMatchObject({ state: "done", code: 0, outputs: [join(dir, "shot.png")] });
      expect(journal()[0]?.log).toEqual(['{"file":"shot.png"}']);
      expect(rerunJob(first?.id ?? "")).toBe(true);
      expect(journal().filter((item) => item.key === "test:shot")).toHaveLength(2);
      // The answer of the server gives each output file of a project folder its URL.
      await until(() => journal()[0]?.state !== "running");
      const answer = jobsAnswer({ demo: dir }) as {
        jobs: { project: string | null; outputs: { url: string | null }[] }[];
      };
      expect(answer.jobs[0]).toMatchObject({ project: "demo", outputs: [{ url: "/projects/demo/shot.png" }] });
      expect(outputFiles('"missing.png" shot.png', dir)).toEqual([join(dir, "shot.png")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops a running job", async () => {
    const child = spawn(BUN, ["-e", "setTimeout(() => {}, 20000)"], { stdio: ["ignore", "pipe", "pipe"] });
    const record = trackJob({ key: "test:long", args: [BUN, "-e", "wait"], cwd: tmpdir(), child });
    expect(cancelJob(record.id)).toBe(true);
    await until(() => journal().find((item) => item.id === record.id)?.endedAt !== null);
    expect(journal().find((item) => item.id === record.id)?.state).toBe("cancelled");
    expect(cancelJob(record.id)).toBe(false);
    expect(rerunJob(record.id)).toBe(false);
  });
});

describe("the runs of the project", () => {
  it("reads the runs and their presets, and parts a command line into words", () => {
    const project = {
      workbench: {
        surfaces: [],
        runs: {
          check: "scenity check",
          shot: { command: "scenity shot", label: "Shot", presets: [{ label: "Front", args: ["--camera", "front"] }] },
        },
      },
    };
    expect(projectRuns(project)).toEqual([
      { id: "check", label: "check", command: "scenity check", presets: [] },
      {
        id: "shot",
        label: "Shot",
        command: "scenity shot",
        presets: [{ label: "Front", args: ["--camera", "front"] }],
      },
    ]);
    expect(commandWords(`bun -e "console.log('a b')" 'c d' e`)).toEqual([
      "bun",
      "-e",
      "console.log('a b')",
      "c d",
      "e",
    ]);
  });

  it("starts a run made in the form with its preset; a restricted project has no runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scenity-runs-"));
    try {
      const write = "require('fs').writeFileSync(process.argv.at(-1), 'x')";
      writeFileSync(
        join(dir, "scenity.project.json"),
        JSON.stringify({
          workbench: {
            surfaces: [],
            runs: { make: { command: `${BUN} -e "${write}"`, presets: [{ label: "A", args: ["a.png"] }] } },
          },
        }),
      );
      expect(startRun("demo", dir, "make", 0)).toBeNull();
      await until(() => journal()[0]?.key === "run:demo:make" && journal()[0]?.state !== "running");
      expect(journal()[0]).toMatchObject({ key: "run:demo:make", state: "done" });
      expect(startRun("demo", dir, "none", undefined)).toBe("The project has no such run.");
      RESTRICTED_PROJECTS.add("demo");
      expect(startRun("demo", dir, "make", 0)).toContain("restricted");
    } finally {
      RESTRICTED_PROJECTS.delete("demo");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the Jobs panel", () => {
  it("shows the jobs of the server and of the studio with their outputs, and runs a job again", async () => {
    studioHost.value = true;
    const posts: { path: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
      if (init?.method === "POST")
        posts.push({ path: input, body: JSON.parse(typeof init.body === "string" ? init.body : "{}") as unknown });
      const answers: Record<string, unknown> = {
        "/jobs.json": {
          jobs: [
            {
              ...{
                id: "s1",
                title: "scenity shot . --json",
                state: "done",
                code: 0,
                startedAt: 2000,
                endedAt: 4500,
                log: ["ok"],
              },
              outputs: [{ path: "/p/test-results/shots/a.png", url: "/projects/p/test-results/shots/a.png" }],
            },
          ],
        },
        "/api/jobs": [
          {
            ...{
              id: "job-1",
              command: "check",
              argv: ["scenity", "check", "."],
              args: { json: true },
              cwd: "/p",
              project: "p",
            },
            ...{ state: "failed", exitCode: 1, startedAt: 1000, endedAt: 1200, outputs: [] },
          },
        ],
        "/projects/p/runs.json": {
          runs: [{ id: "check", label: "check", command: "scenity check", presets: [] }],
          restricted: false,
        },
      };
      const value = answers[input.split("?")[0] ?? ""] ?? { ok: true };
      return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
    });
    const wrapper = mount(JobsPanel, { props: { base: "/projects/p/" }, global: { plugins: [editorI18n().plugin] } });
    await flushPromises();
    const rows = wrapper.findAll("[data-job]");
    expect(rows.map((row) => [row.attributes("data-source"), row.attributes("data-state")])).toEqual([
      ["server", "done"],
      ["studio", "failed"],
    ]);
    expect(wrapper.get("[data-job=s1] img").attributes("src")).toBe("/projects/p/test-results/shots/a.png");
    expect(wrapper.get("[data-job=s1]").text()).toContain("2.5 s");
    await wrapper.get("[data-job=job-1] [data-testid=jobs-again]").trigger("click");
    await flushPromises();
    expect(posts.at(-1)).toEqual({
      path: "/api/jobs",
      body: { command: "check", args: { json: true }, cwd: "/p", project: "p" },
    });
    await wrapper.get("[data-testid=jobs-run-check]").trigger("click");
    await flushPromises();
    expect(posts.at(-1)).toEqual({ path: "/projects/p/runs.start", body: { id: "check" } });
    await wrapper.get("[data-job=s1] [data-testid=jobs-log]").trigger("click");
    expect(wrapper.get("[data-testid=jobs-log-text]").text()).toBe("ok");
    wrapper.unmount();
  });

  it("gives each output its kind and each studio job its request", () => {
    expect(["a.PNG", "b.webm", "c.zip"].map(outputKind)).toEqual(["picture", "video", "file"]);
    expect(serverRows([]).length + studioRows([]).length).toBe(0);
  });
});

describe("the commands of the plugins", () => {
  it("reads the commands of the plugins from the help of the CLI", () => {
    const help = [
      "usage: scenity <command>",
      "commands:",
      "  create   a new project",
      "commands of the project plugins:",
      "  hello    say hello",
      "  lab-run  run the lab",
    ].join("\n");
    expect(helpPluginCommands(help)).toEqual([
      { name: "hello", summary: "say hello" },
      { name: "lab-run", summary: "run the lab" },
    ]);
    expect(helpPluginCommands("usage: scenity\ncommands:\n  create  x")).toEqual([]);
  });
});
