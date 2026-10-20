// SPDX-License-Identifier: Apache-2.0
/**
 * The machine of a `scenity bench` run: the CPU, the memory, the system and the load. Other work on the machine makes
 * the frame times high, so each run keeps the load before and after it, and `--check` judges no time at a load over the
 * limit.
 */
import { spawnSync } from "node:child_process";
import { cpus, loadavg, platform, release, totalmem } from "node:os";

/** The load of the machine at one moment: the 1-, 5- and 15-minute load averages and the `uptime` text. */
export interface LoadSample {
  readonly avg: readonly [number, number, number];
  readonly uptime: string;
}

export interface MachineInfo {
  readonly system: string;
  readonly cpu: string;
  readonly cores: number;
  readonly memoryGb: number;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** The current load. The `uptime` text is empty where the system has no `uptime` command. */
export function loadSample(): LoadSample {
  const [one = 0, five = 0, fifteen = 0] = loadavg();
  const result = spawnSync("uptime", { encoding: "utf8" });
  const uptime = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return { avg: [round(one, 2), round(five, 2), round(fifteen, 2)], uptime };
}

/** The highest 1-minute load average of the samples, or 0 with no sample. */
export function peakLoad(samples: readonly LoadSample[]): number {
  return samples.reduce((peak, sample) => Math.max(peak, sample.avg[0]), 0);
}

export function machineInfo(): MachineInfo {
  const cpu = cpus();
  return {
    system: `${platform()} ${release()}`,
    cpu: cpu[0]?.model ?? "unknown",
    cores: cpu.length,
    memoryGb: round(totalmem() / 1024 ** 3, 1),
  };
}
