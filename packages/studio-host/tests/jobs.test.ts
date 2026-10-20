// SPDX-License-Identifier: Apache-2.0
// The jobs of the studio: typed arguments, the states, the outputs, the GPU queue and cancel. A fake program replaces
// the CLI.
import { describe, expect, test } from "bun:test";
import { answerPaths, jobArgv, JobService, type JobInfo } from "../src/jobs";

describe("the arguments of a job", () => {
  test("become CLI words, flags and positions", () => {
    expect(
      jobArgv("shot", { camera: ["front", "top"], at: 2500, build: true, json: false, out: "shots/a.png" }),
    ).toEqual(["shot", "--camera", "front,top", "--at", "2500", "--build", "--out", "shots/a.png"]);
    expect(jobArgv("assets.import", { file: "a.glb", rights: "rights/r.yaml" })).toEqual([
      "assets",
      "import",
      "a.glb",
      "--rights",
      "rights/r.yaml",
    ]);
  });

  test("refuse an unknown argument and a value of the wrong kind", () => {
    expect(() => jobArgv("check", { evil: "x" })).toThrow("has no argument evil");
    expect(() => jobArgv("shot", { at: "soon" })).toThrow("must be a number");
    expect(() => jobArgv("shot", { camera: "front" })).toThrow("must be a list");
    expect(() => jobArgv("nope", {})).toThrow("no job command");
    expect(() => jobArgv("create", { name: "--template=x" })).toThrow('must not start with "-"');
  });

  test("clones only from an HTTPS, SSH or file URL into one folder name", () => {
    expect(jobArgv("git.clone", { url: "https://example.com/a/scene.git", folder: "scene" })).toEqual([
      "https://example.com/a/scene.git",
      "scene",
    ]);
    expect(jobArgv("git.clone", { url: "git@example.com:a/scene.git", folder: "scene" })).toHaveLength(2);
    expect(jobArgv("git.clone", { url: "file:///tmp/scene", folder: "scene" })).toHaveLength(2);
    expect(() => jobArgv("git.clone", { url: "ext::sh -c touch% /tmp/x", folder: "x" })).toThrow("url must be");
    expect(() => jobArgv("git.clone", { url: "--upload-pack=touch", folder: "x" })).toThrow("url must be");
    expect(() => jobArgv("git.clone", { url: "https://example.com/a.git", folder: "../up" })).toThrow("folder must be");
    expect(() => jobArgv("git.clone", { url: "https://example.com/a.git", folder: ".." })).toThrow("folder must be");
  });

  test("the outputs of a JSON answer", () => {
    expect(answerPaths('log\n{"out":"a.png","files":["b/c.png"],"n":1}', "/p")).toEqual(["/p/a.png", "/p/b/c.png"]);
    expect(answerPaths("no json", "/p")).toEqual([]);
  });
});

/** A fake CLI: it prints its arguments as JSON after the time of its first number argument. */
const FAKE = [
  "bun",
  "-e",
  "const ms = Number(process.argv.find((a) => /^\\d+$/.test(a)) ?? 0); await Bun.sleep(ms); console.log(JSON.stringify({ out: 'x.png', args: process.argv.slice(1) })); process.exit(process.argv.includes('--check') ? 3 : 0);",
];

function waitFor(service: JobService, id: string, states: readonly string[]): Promise<JobInfo> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const job = service.get(id);
      if (job !== undefined && states.includes(job.state)) {
        clearInterval(timer);
        resolve(job);
      }
    }, 20);
  });
}

describe("the job service", () => {
  test("runs a job to the end with its outputs", async () => {
    const seen: string[] = [];
    const service = new JobService({ onState: (job) => seen.push(job.state) }, () => FAKE);
    const job = service.start({ command: "build", args: { out: "dist" }, cwd: "/tmp" });
    const done = await waitFor(service, job.id, ["done", "failed"]);
    expect(done.state).toBe("done");
    expect(done.exitCode).toBe(0);
    expect(done.outputs).toContain("/tmp/dist");
    expect(done.outputs).toContain("/tmp/x.png");
    expect(seen).toEqual(["queued", "running", "done"]);
    expect(service.log(job.id).join("\n")).toContain('"out":"x.png"');
  });

  test("a failed job keeps its exit code", async () => {
    const service = new JobService({}, () => FAKE);
    const job = service.start({ command: "build", args: { check: true }, cwd: "/tmp" });
    const done = await waitFor(service, job.id, ["done", "failed"]);
    expect(done).toMatchObject({ state: "failed", exitCode: 3 });
  });

  test("runs one GPU job at a time, and a cancel ends a running job", async () => {
    const service = new JobService({}, () => FAKE);
    const first = service.start({ command: "shot", args: { at: 3000 }, cwd: "/tmp" });
    const second = service.start({ command: "shot", args: { at: 10 }, cwd: "/tmp" });
    const plain = service.start({ command: "check", args: {}, cwd: "/tmp" });
    expect(service.get(first.id)?.state).toBe("running");
    expect(service.get(second.id)?.state).toBe("queued");
    expect(service.get(plain.id)?.state).toBe("running");
    expect(service.cancel(first.id)).toBe(true);
    expect((await waitFor(service, first.id, ["cancelled", "done", "failed"])).state).toBe("cancelled");
    expect((await waitFor(service, second.id, ["done", "failed"])).state).toBe("done");
    await waitFor(service, plain.id, ["done", "failed"]);
  });
});
