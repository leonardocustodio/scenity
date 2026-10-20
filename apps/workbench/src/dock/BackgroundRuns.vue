<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The background runs. The owner starts one (prompt, take, budget, turns, minutes), watches its live progress lines,
 * stops it, and opens its review pack. The end shows the cost estimate and the changed files (uncommitted). It also
 * shows the check that the HEAD did not move. After an end that the `Stop` gate did not see, it shows the gate check
 * of the host. Such an end is the turn limit, the budget, the time limit or an error.
 */
import { endCheckLine, type LoopInfo, type LoopStatus } from "@scenity/workbench-host/protocol";
import { computed, ref } from "vue";
import { button, cn } from "../layout/ui";
import type { DockHost } from "./dockHost";
import LoopPack from "./LoopPack.vue";
import LoopStart from "./LoopStart.vue";
import { useRunFiles } from "./runFile";
import { loopCost, useLoops } from "./useLoops";

defineOptions({ name: "DockBackgroundRuns" });
const props = defineProps<{ readonly dock: Pick<DockHost, "request" | "on" | "fetchRunFile" | "defaultSequence"> }>();

const loops = useLoops(props.dock);
const files = useRunFiles(props.dock);
const showPack = ref(false);
const current = computed(() => loops.current.value);
const lines = computed(() => (current.value === null ? [] : (loops.lines.value[current.value.loop] ?? [])));

const STATUS_CLASS: Readonly<Record<LoopStatus, string>> = {
  starting: "text-status-caution",
  running: "text-status-caution",
  checking: "text-status-caution",
  done: "text-status-positive",
  failed: "text-status-negative",
  stopped: "text-text-secondary",
  timeout: "text-status-negative",
};

const active = (loop: LoopInfo): boolean => loop.ended === null;

function headLine(loop: LoopInfo): string {
  if (loop.endHead === null || loop.ended === null) return "";
  return loop.endHead === loop.startHead ? "no commit" : "the HEAD moved: check the commits";
}

function select(loop: string): void {
  loops.selected.value = loop;
  showPack.value = false;
}
</script>

<template>
  <div class="grid h-full min-h-0 grid-cols-[20rem_minmax(0,1fr)] gap-3" data-testid="background-runs">
    <div class="flex min-h-0 flex-col gap-2 overflow-y-auto">
      <LoopStart :default-sequence="dock.defaultSequence?.() ?? null" @start="loops.start($event)" />
      <p v-if="loops.error.value !== null" class="text-caption text-status-negative" role="alert">
        {{ loops.error.value }}
      </p>
      <ul class="flex flex-col gap-0.5" aria-label="Background runs">
        <li v-for="loop in loops.loops.value" :key="loop.loop">
          <button
            type="button"
            :class="
              cn(
                'flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left text-caption hover:bg-surface-sunken',
                current?.loop === loop.loop && 'bg-surface-sunken',
              )
            "
            :data-testid="`loop-${loop.loop}`"
            @click="select(loop.loop)"
          >
            <span :class="cn('w-16 shrink-0', STATUS_CLASS[loop.status])">{{ loop.status }}</span>
            <span class="truncate">{{ loop.prompt }}</span>
          </button>
        </li>
      </ul>
    </div>
    <section v-if="current !== null" class="flex min-h-0 flex-col gap-1.5" aria-label="Background run">
      <header class="flex flex-wrap items-center gap-2 text-caption">
        <span :class="STATUS_CLASS[current.status]" data-testid="loop-status">{{ current.status }}</span>
        <span data-testid="loop-cost">{{ loopCost(current) }}</span>
        <span v-if="current.stopReason">· {{ current.stopReason }}</span>
        <span v-if="current.sequence ?? current.take">· sequence {{ current.sequence ?? current.take }}</span>
        <span v-if="current.gate.refusals > 0">· gate refused {{ current.gate.refusals }}×</span>
        <span v-if="headLine(current)" data-testid="loop-head">· {{ headLine(current) }}</span>
        <button
          v-if="active(current)"
          type="button"
          :class="cn(button, 'ml-auto')"
          data-testid="loop-stop"
          @click="loops.stop(current.loop)"
        >
          Stop
        </button>
        <button
          v-if="current.review !== null"
          type="button"
          :class="cn(button, !active(current) && 'ml-auto')"
          :aria-pressed="showPack"
          data-testid="loop-open-pack"
          @click="showPack = !showPack"
        >
          {{ showPack ? "Progress" : "Open the pack" }}
        </button>
      </header>
      <p class="truncate text-caption text-text-secondary" :title="current.checkout">
        {{ current.checkout
        }}<template v-if="current.files.length > 0">
          · {{ current.files.length }} changed: {{ current.files.join(", ") }}</template
        >
      </p>
      <div v-if="current.endCheck !== null" class="flex flex-col gap-0.5" data-testid="loop-end-check">
        <p
          :class="cn('text-caption', current.endCheck.pass ? 'text-status-positive' : 'text-status-negative')"
          data-testid="loop-end-check-line"
        >
          {{ endCheckLine(current.endCheck) }}
        </p>
        <pre
          v-if="!current.endCheck.pass && current.endCheck.summary !== ''"
          class="max-h-24 overflow-auto rounded-control bg-surface-sunken p-1.5 font-mono text-caption whitespace-pre-wrap"
          data-testid="loop-end-check-failures"
          >{{ current.endCheck.summary }}</pre>
      </div>
      <LoopPack v-if="showPack && current.review !== null" :review="current.review" :files="files" />
      <pre
        v-else
        class="min-h-0 flex-1 overflow-auto rounded-control bg-surface-sunken p-2 font-mono text-caption whitespace-pre-wrap"
        data-testid="loop-lines"
        >{{ lines.join("\n") }}</pre>
    </section>
    <p v-else class="text-caption text-text-secondary">No background run yet.</p>
  </div>
</template>
