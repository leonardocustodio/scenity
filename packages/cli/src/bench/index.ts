// SPDX-License-Identifier: Apache-2.0
/**
 * The entry `@scenity/cli/bench`: `scenity bench`, its project budgets and its report.
 */
export * from "./budgets";
export * from "./command";
export * from "./report";
export * from "./run";
export {
  playerPageHtml as benchPageHtml,
  PLAYER_PAGE as BENCH_PAGE,
  servePlayerPage as serveBench,
  sourceDocument,
  type PageServer as BenchServer,
} from "../page/serve";
export { toMeasure, type PageInfo, type PlayerStats } from "./page";
export { GPU_LOCK, gpuLock } from "../page/lock";
export { loadSample, machineInfo, peakLoad, type LoadSample, type MachineInfo } from "./machine";
