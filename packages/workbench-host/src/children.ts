// SPDX-License-Identifier: Apache-2.0
/**
 * The process groups of the children of the host. The dev servers, the runs and the
 * terminals each run in a process group of their own, so a stop of one ends its whole tree. The shell stops the group
 * of the host only, so a host that ends without its stop (SIGKILL, a crash) leaves these groups behind.
 *
 * The host writes each group to `children.json` in its state folder while it runs. The next start of a host with the
 * same state folder, and the supervisor after the end of its worker (supervisor.ts), end the groups of that file that
 * still run (`reapStale`). A group counts only when its first process still runs the program of the record, so a
 * process ID that the system gave to another program is safe.
 */
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { readJsonObject, writeJsonAtomic } from "./state";

/** The file of the groups in a state folder. */
export const CHILDREN_FILE = "children.json";

/** One process group of a child of the host. */
export interface ChildGroup {
  /** The process group ID (the process ID of the first process of the group). */
  readonly pgid: number;
  /** "lab server", "run", "terminal", … */
  readonly kind: string;
  /** The base name of the program of the first process (a check against a reused process ID). */
  readonly program: string;
  readonly started: string;
}

/** The groups of the children of this process. One registry per process; the host sets its file at the start. */
class ChildRegistry {
  #file: string | null = null;
  readonly #groups = new Map<number, ChildGroup>();

  /** Write the groups to `<stateDir>/children.json` after this call (null: keep them in memory only). */
  useFolder(stateDir: string | null): void {
    this.#file = stateDir === null ? null : join(stateDir, CHILDREN_FILE);
    this.#write();
  }

  /** Record a new group. */
  add(pgid: number | undefined, kind: string, program: string): void {
    if (pgid === undefined || pgid <= 0) return;
    this.#groups.set(pgid, { pgid, kind, program: basename(program), started: new Date().toISOString() });
    this.#write();
  }

  /** Forget a group that ended. */
  remove(pgid: number | undefined): void {
    if (pgid === undefined || !this.#groups.delete(pgid)) return;
    this.#write();
  }

  /** The current groups. */
  list(): ChildGroup[] {
    return [...this.#groups.values()];
  }

  #write(): void {
    if (this.#file === null) return;
    try {
      writeJsonAtomic(this.#file, { groups: this.list() });
    } catch {
      // A state folder that cannot take the file leaves only the memory list.
    }
  }
}

/** The registry of this process. */
export const childGroups = new ChildRegistry();

/** Read the groups of a state folder. */
export function readGroups(stateDir: string): ChildGroup[] {
  const value = readJsonObject(join(stateDir, CHILDREN_FILE)).groups;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ChildGroup =>
      typeof item === "object" &&
      item !== null &&
      Number.isSafeInteger((item as ChildGroup).pgid) &&
      (item as ChildGroup).pgid > 1 &&
      typeof (item as ChildGroup).program === "string",
  );
}

/** One line of `ps`: the process ID, its group and its command. */
export interface ProcessLine {
  readonly pid: number;
  readonly pgid: number;
  readonly command: string;
}

/** The processes of the system (`ps -A -o pid=,pgid=,command=`). */
export function listProcesses(): ProcessLine[] {
  // The command lines of all processes can be more than the 1 MB default buffer on a busy machine (ENOBUFS).
  const out = spawnSync("ps", ["-A", "-o", "pid=,pgid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) return [];
  return out.stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ pid: Number(match[1]), pgid: Number(match[2]), command: match[3] ?? "" }));
}

/** The groups of a list that still run the program of their record. */
export function liveGroups(groups: readonly ChildGroup[], processes: readonly ProcessLine[]): ChildGroup[] {
  return groups.filter((group) =>
    processes.some((line) => line.pgid === group.pgid && line.command.includes(group.program)),
  );
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // The group ended already.
  }
}

/**
 * End the groups of a state folder that still run (a host or a worker that ended without its stop): SIGTERM, then
 * SIGKILL after `graceMs`. The file then holds no group. Give the groups that got a signal.
 */
export async function reapStale(stateDir: string, graceMs = 2_000): Promise<ChildGroup[]> {
  const groups = readGroups(stateDir).filter((group) => !childGroups.list().some((own) => own.pgid === group.pgid));
  const live = groups.length === 0 ? [] : liveGroups(groups, listProcesses());
  for (const group of live) signalGroup(group.pgid, "SIGTERM");
  const end = Date.now() + graceMs;
  while (live.length > 0 && Date.now() < end && liveGroups(live, listProcesses()).length > 0) await Bun.sleep(100);
  for (const group of liveGroups(live, listProcesses())) signalGroup(group.pgid, "SIGKILL");
  if (groups.length > 0) {
    try {
      writeJsonAtomic(join(stateDir, CHILDREN_FILE), { groups: childGroups.list() });
    } catch {
      // The state folder is gone.
    }
  }
  return live;
}
