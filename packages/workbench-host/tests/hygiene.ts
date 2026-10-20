// SPDX-License-Identifier: Apache-2.0
/**
 * The test hygiene of the host: the temporary folders and the host processes of a test run. Without this check, runs
 * can leave supervisor and worker processes and temporary checkouts (`workbench-repo-*`).
 *
 * - `tempDir` of helpers.ts records each folder here; `trackProcess` records each host process that a test starts.
 * - `stopTracked` (an `afterAll` of each test file that starts a host process) stops the processes of that file.
 * - `checkHygiene` (the `afterAll` of hygiene.preload.ts, after every test file of the run) removes the folders that a
 *   test left, and fails when a process of the run is still alive: a child of this test process, or a process whose
 *   command line holds a temporary folder of the run.
 */
import { existsSync, rmSync } from "node:fs";

/** The temporary folders of this run. */
const folders = new Set<string>();
/** The host processes that the tests started and did not stop yet. */
const processes = new Set<Bun.Subprocess>();
/** True after a host test recorded a folder or a process: a run without host tests is not checked. */
let used = false;

/** Record a temporary folder of the run. */
export function trackFolder(path: string): string {
  used = true;
  folders.add(path);
  return path;
}

/** Record a host process (a supervisor) that a test started; `stopTracked` stops it at the end of the file. */
export function trackProcess<T extends Bun.Subprocess>(child: T): T {
  used = true;
  processes.add(child);
  void child.exited.then(() => processes.delete(child));
  return child;
}

/** Stop the recorded processes that are still alive: SIGTERM, then SIGKILL after `graceMs`. */
export async function stopTracked(graceMs = 5000): Promise<void> {
  const alive = [...processes].filter((child) => child.exitCode === null && child.signalCode === null);
  for (const child of alive) child.kill("SIGTERM");
  const timeout = Bun.sleep(graceMs).then(() => {
    for (const child of alive) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  await Promise.race([Promise.all(alive.map((child) => child.exited)), timeout]);
  await Promise.all(alive.map((child) => child.exited));
  processes.clear();
}

/** A process of the system: its ID, its parent and its command line. */
export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

/** Every process of the system now (`ps`; macOS and Linux). */
export function listProcesses(): ProcessRow[] {
  const out = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,command="]).stdout.toString();
  const rows: ProcessRow[] = [];
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match !== null) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" });
  }
  return rows;
}

/** The processes of the run that are still alive: the descendants of `root` and the processes that name a folder. */
export function leftProcesses(rows: readonly ProcessRow[], root: number, paths: Iterable<string>): ProcessRow[] {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const found = new Map<number, ProcessRow>();
  const visit = (pid: number): void => {
    for (const row of children.get(pid) ?? []) {
      // The `ps` of this check is a child too.
      if (/^(\S*\/)?ps\s/.test(row.command)) continue;
      found.set(row.pid, row);
      visit(row.pid);
    }
  };
  visit(root);
  const named = [...paths];
  for (const row of rows) {
    if (row.pid !== root && named.some((path) => row.command.includes(path))) found.set(row.pid, row);
  }
  return [...found.values()];
}

/** The end of the run: remove the folders that the tests left; fail for a process of the run that is still alive. */
export async function checkHygiene(): Promise<void> {
  if (!used) return;
  await stopTracked();
  let left = leftProcesses(listProcesses(), process.pid, folders);
  if (left.length > 0) {
    // A process can be in its last milliseconds: examine the list again one time.
    await Bun.sleep(500);
    left = leftProcesses(listProcesses(), process.pid, folders);
  }
  for (const row of left) {
    try {
      process.kill(row.pid, "SIGKILL");
    } catch {
      // It ended.
    }
  }
  for (const folder of folders) if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
  folders.clear();
  if (left.length > 0) {
    const lines = left.map((row) => `  ${String(row.pid)} ${row.command.slice(0, 200)}`).join("\n");
    throw new Error(`the tests of this run left ${String(left.length)} process(es) (now killed):\n${lines}`);
  }
}
