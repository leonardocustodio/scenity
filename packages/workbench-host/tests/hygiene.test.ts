// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the test hygiene: the search for the processes that a run left. The check itself runs after the
 * last test file (hygiene.preload.ts).
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { leftProcesses, listProcesses, stopTracked, trackProcess } from "./hygiene";
import { tempDir } from "./helpers";

describe("the test hygiene", () => {
  test("finds the descendants of the run and the processes that name a folder of the run; not the ps of the check", () => {
    const rows = [
      { pid: 10, ppid: 1, command: "bun test" },
      { pid: 11, ppid: 10, command: "bun src/main.ts --checkout /tmp/workbench-repo-a/repo" },
      { pid: 12, ppid: 11, command: "bun src/main.ts (worker)" },
      { pid: 13, ppid: 10, command: "ps -A -o pid=,ppid=,command=" },
      { pid: 20, ppid: 1, command: "/x/node_modules/.bin/vite --port 5 /tmp/workbench-repo-b/repo" },
      { pid: 30, ppid: 1, command: "bun src/main.ts --checkout /other/checkout" },
    ];
    const left = leftProcesses(rows, 10, ["/tmp/workbench-repo-b"]).map((row) => row.pid);
    expect(left.sort()).toEqual([11, 12, 20]);
  });

  test("lists the processes of the system with this process", () => {
    expect(listProcesses().some((row) => row.pid === process.pid)).toBe(true);
  });

  test("stopTracked ends a process that a test did not stop", async () => {
    const child = trackProcess(Bun.spawn(["sleep", "60"], { stdio: ["ignore", "ignore", "ignore"] }));
    await stopTracked(1000);
    expect(child.killed || child.signalCode !== null).toBe(true);
    expect(leftProcesses(listProcesses(), process.pid, []).some((row) => row.pid === child.pid)).toBe(false);
  });

  test("a temporary folder of a test stays until its cleanup or the end of the run", () => {
    expect(existsSync(tempDir("hygiene"))).toBe(true);
  });
});
