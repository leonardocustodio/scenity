// SPDX-License-Identifier: Apache-2.0
/**
 * The background runs in Vue refs: the list of the host, the live progress lines of each
 * run from `loops.progress`, and its state from `loops.state`. The page keeps at most MAX_LINES lines per run.
 */
import type { LoopInfo, LoopParams } from "@scenity/workbench-host/protocol";
import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import type { DockHost } from "./dockHost";

/** The most progress lines that the page keeps per run. */
export const MAX_LINES = 400;

export interface LoopsApi {
  readonly loops: Ref<LoopInfo[]>;
  readonly lines: Ref<Record<string, string[]>>;
  readonly selected: Ref<string | null>;
  readonly current: ComputedRef<LoopInfo | null>;
  readonly error: Ref<string | null>;
  refresh(): Promise<void>;
  start(params: LoopParams): Promise<string | null>;
  stop(loop: string): Promise<void>;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Put a new state of a run into the list: the same ID replaces the old state; a new run comes first. */
export function upsertLoop(list: readonly LoopInfo[], next: LoopInfo): LoopInfo[] {
  return list.some((item) => item.loop === next.loop)
    ? list.map((item) => (item.loop === next.loop ? next : item))
    : [next, ...list];
}

export function useLoops(host: Pick<DockHost, "request" | "on">): LoopsApi {
  const loops = ref<LoopInfo[]>([]);
  const lines = ref<Record<string, string[]>>({});
  const selected = ref<string | null>(null);
  const error = ref<string | null>(null);
  const current = computed(() => loops.value.find((item) => item.loop === selected.value) ?? loops.value[0] ?? null);

  async function refresh(): Promise<void> {
    try {
      const list = await host.request("loops.list", {});
      loops.value = list;
      const next = { ...lines.value };
      for (const item of list) if ((next[item.loop] ?? []).length === 0) next[item.loop] = [...(item.lines ?? [])];
      lines.value = next;
      error.value = null;
    } catch (reason) {
      error.value = message(reason);
    }
  }

  const stops = [
    host.on("loops.progress", ({ loop, line }) => {
      lines.value = { ...lines.value, [loop]: [...(lines.value[loop] ?? []), line].slice(-MAX_LINES) };
    }),
    host.on("loops.state", ({ loop }) => {
      loops.value = upsertLoop(loops.value, loop);
    }),
  ];
  if (getCurrentScope() !== undefined) onScopeDispose(() => stops.forEach((stop) => stop()));

  async function start(params: LoopParams): Promise<string | null> {
    try {
      const info = await host.request("loops.start", params);
      loops.value = upsertLoop(loops.value, info);
      selected.value = info.loop;
      error.value = null;
      return info.loop;
    } catch (reason) {
      error.value = message(reason);
      return null;
    }
  }

  async function stop(loop: string): Promise<void> {
    try {
      await host.request("loops.stop", { loop });
    } catch (reason) {
      error.value = message(reason);
    }
  }

  void refresh();
  return { loops, lines, selected, current, error, refresh, start, stop };
}

/** The cost and the turns of a run, in words: "about $0.0123 · 3 turns". */
export function loopCost(loop: Pick<LoopInfo, "costUsd" | "turns" | "budgetUsd">): string {
  const cost = loop.costUsd === null ? "no cost yet" : `about $${loop.costUsd.toFixed(4)}`;
  const turns = loop.turns === null ? "" : ` · ${String(loop.turns)} turns`;
  return `${cost} of $${String(loop.budgetUsd)}${turns}`;
}
