// SPDX-License-Identifier: Apache-2.0
/**
 * The GPU lock of `scenity bench` and `scenity shot`. Parallel WebGL or WebGPU pages starve each other, so one GPU user
 * at a time runs on a machine. The default lock is the lock file of the labs tools
 * (`apps/editor/scripts/lab/gpuLock.ts`): the same path and the same format, so the CLI and `bun run labs` wait for
 * each other. The file holds the process ID of the owner. A lock of a process that ended is stale: the next tool takes
 * it.
 */
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The lock file of the labs tools. */
export const GPU_LOCK = join(tmpdir(), "scenity-room3d-gpu.lock");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function owner(path: string): number | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { readonly pid?: unknown };
    const pid = Number(data.pid);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

export interface LockOptions {
  /** The lock file (default GPU_LOCK). */
  readonly path?: string;
  readonly timeoutMs?: number;
  readonly log?: (text: string) => void;
}

/** Take the GPU lock, and wait while another live process has it. The result releases the lock. */
export async function gpuLock(options: LockOptions = {}): Promise<() => void> {
  const path = options.path ?? GPU_LOCK;
  const end = Date.now() + (options.timeoutMs ?? 15 * 60_000);
  let told = false;
  for (;;) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cwd: process.cwd() }));
      closeSync(fd);
      const drop = (): void => {
        if (owner(path) === process.pid) rmSync(path, { force: true });
      };
      process.once("exit", drop);
      return () => {
        process.off("exit", drop);
        drop();
      };
    } catch {
      const pid = owner(path);
      if (pid === null || !alive(pid)) {
        rmSync(path, { force: true });
        continue;
      }
      if (!told) {
        options.log?.(`waiting for the GPU lock of process ${String(pid)} (${path})`);
        told = true;
      }
      if (Date.now() > end) throw new Error(`The GPU lock (${path}) stayed with process ${String(pid)}.`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
