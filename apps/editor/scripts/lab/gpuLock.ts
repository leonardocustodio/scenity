// SPDX-License-Identifier: Apache-2.0
/**
 * One GPU user at a time on this machine. Parallel WebGL pages starve each other, and a frame of the 3D room then
 * times out or is blank. The tools of several agents wait for a lock file in the temp
 * folder. A lock of a process that ended is stale: the next tool takes it.
 */
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK = join(tmpdir(), "scenity-room3d-gpu.lock");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function owner(): number | null {
  try {
    const data = JSON.parse(readFileSync(LOCK, "utf8")) as { readonly pid?: unknown };
    const pid = Number(data.pid);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Take the GPU lock. Wait for it while another live process has it. Returns the release function. */
export async function gpuLock(options: { readonly timeoutMs?: number; readonly log?: (text: string) => void } = {}) {
  const end = Date.now() + (options.timeoutMs ?? 15 * 60_000);
  let told = false;
  for (;;) {
    try {
      const fd = openSync(LOCK, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cwd: process.cwd() }));
      closeSync(fd);
      const drop = () => {
        if (owner() === process.pid) rmSync(LOCK, { force: true });
      };
      process.once("exit", drop);
      // The render pool takes the lock once per job, so the release also removes the exit listener.
      return () => {
        process.off("exit", drop);
        drop();
      };
    } catch {
      const pid = owner();
      if (pid === null || !alive(pid)) {
        rmSync(LOCK, { force: true });
        continue;
      }
      if (!told) {
        options.log?.(`waiting for the GPU lock of process ${String(pid)} (${LOCK})`);
        told = true;
      }
      if (Date.now() > end) throw new Error(`The GPU lock (${LOCK}) stayed with process ${String(pid)}.`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
