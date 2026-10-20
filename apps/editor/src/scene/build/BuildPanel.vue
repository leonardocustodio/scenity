<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Build window. It has the build settings (the output folder, the size budget of each entry) and "Run the build"
 * (`scenity build` as a job of the dev server, with its log). It also has the report (the size of each entry against
 * its budget, the marker gate) and "Open the built player". Thus a person can build with no terminal.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";

interface BuildEntry {
  readonly id: string;
  readonly label: string;
  readonly gzip: number;
  readonly limitKB: number | null;
  readonly result: string;
}
interface BuildReport {
  readonly passed: boolean;
  readonly entries: readonly BuildEntry[];
  readonly markers: {
    readonly found: readonly { readonly id: string; readonly what: string }[];
    readonly modules: readonly { readonly id: string; readonly source: string }[];
  };
  readonly problems: readonly string[];
}
interface PublishResult {
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly archive: string | null;
  readonly files: number;
  readonly bytes: number;
}
interface BuildState {
  readonly out: string;
  readonly job: { readonly running: boolean; readonly log: readonly string[]; readonly code: number | null };
  /** The publish job and its result. */
  readonly publish: { readonly running: boolean; readonly result: PublishResult | null };
  readonly report: BuildReport | null;
  readonly budgets: Readonly<Record<string, { readonly gzipKB: number; readonly note?: string }>>;
  /** The publish targets of the plugins and the result of the last send. */
  readonly targets?: readonly { readonly id: string; readonly title: string }[];
  readonly sent?: { readonly target: string; readonly ok: boolean; readonly text: string } | null;
}

const props = defineProps<{ base: string }>();
const { $t } = useI18n();
const out = ref("dist");
const state = shallowRef<BuildState | null>(null);
const limits = ref<Record<string, string>>({});
const note = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

async function read(): Promise<void> {
  clearTimeout(timer);
  const query = new URLSearchParams({ out: out.value }).toString();
  const response = await fetch(`${props.base}project.build.json?${query}`, { cache: "no-store" }).catch(() => null);
  if (response?.ok === true && (response.headers.get("content-type") ?? "").includes("json")) {
    state.value = (await response.json()) as BuildState;
    if (Object.keys(limits.value).length === 0) {
      limits.value = Object.fromEntries(
        Object.entries(state.value.budgets).map(([id, budget]) => [id, String(budget.gzipKB)]),
      );
    }
  }
  if (state.value?.job.running === true || state.value?.publish.running === true) {
    timer = setTimeout(() => void read(), 1000);
  }
}
onMounted(() => void read());
onBeforeUnmount(() => clearTimeout(timer));

async function post(path: string, body: unknown): Promise<{ ok: boolean; reason?: string }> {
  const response = await fetch(`${props.base}${path}`, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((error: unknown) => error as Error);
  if (response instanceof Error) return { ok: false, reason: response.message };
  return (await response.json()) as { ok: boolean; reason?: string };
}

async function run(): Promise<void> {
  const answer = await post("project.build.run", { out: out.value });
  note.value = answer.ok ? null : (answer.reason ?? null);
  await read();
}

/** Give the archive of the last publish to a publish target of a plugin. */
async function send(target: string): Promise<void> {
  const answer = await post("project.publish.send", { out: out.value, target });
  note.value = answer.ok ? null : (answer.reason ?? null);
  await read();
}

/** The release gate first, then the build folder as a ZIP archive. */
async function publish(): Promise<void> {
  const answer = await post("project.publish.run", { out: out.value });
  note.value = answer.ok ? null : (answer.reason ?? null);
  await read();
}
const published = computed(() =>
  state.value?.publish.running === true ? null : (state.value?.publish.result ?? null),
);
/** The link of the archive of a publish, on this server (the archive is in the project folder). */
const archiveUrl = computed(() => {
  const archive = published.value?.archive ?? "";
  const at = archive.indexOf("/test-results/publish/");
  return at < 0 ? null : `${props.base}${archive.slice(at + 1)}`;
});

async function saveBudgets(): Promise<void> {
  const budgets: Record<string, { gzipKB: number; note?: string }> = {};
  for (const [id, text] of Object.entries(limits.value)) {
    const value = Number(text);
    if (text.trim() === "") continue;
    if (!Number.isFinite(value) || value <= 0) {
      note.value = $t("build-budget-bad", { id });
      return;
    }
    const old = state.value?.budgets[id]?.note;
    budgets[id] = { gzipKB: value, ...(old === undefined ? {} : { note: old }) };
  }
  const answer = await post("project.build.budgets", { budgets });
  note.value = answer.ok ? $t("build-budgets-saved") : (answer.reason ?? null);
  await read();
}

const report = computed(() => state.value?.report ?? null);
const entries = computed(() => {
  const ids = new Set([...(report.value?.entries.map((entry) => entry.id) ?? []), ...Object.keys(limits.value)]);
  return [...ids].map((id) => ({ id, entry: report.value?.entries.find((each) => each.id === id) ?? null }));
});
const log = computed(() => (state.value?.job.log ?? []).slice(-12).join("\n"));
const player = computed(() => `${props.base}${state.value?.out ?? out.value}/index.html`);
const kb = (bytes: number): string => (bytes / 1024).toFixed(1);
const RESULT: Readonly<Record<string, string>> = {
  ok: "text-status-positive",
  exceeded: "text-status-negative",
  exception: "text-status-caution",
  "no budget": "text-text-secondary",
};
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-build')"
    data-testid="build-panel"
  >
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-1" for="build-out">
        {{ $t("build-out") }}
        <input id="build-out" v-model="out" :class="[input, 'w-28 font-mono']" data-testid="build-out" @change="read" />
      </label>
      <Button size="sm" variant="primary" :disabled="state?.job.running === true" data-testid="build-run" @click="run">
        {{ state?.job.running === true ? $t("build-running") : $t("build-run") }}
      </Button>
      <a
        v-if="report !== null"
        :href="player"
        target="_blank"
        rel="noopener"
        class="text-text-link underline"
        data-testid="build-open"
        >{{ $t("build-open") }}</a
      >
      <span
        v-if="report !== null && state?.job.running !== true"
        :class="report.passed ? 'text-status-positive' : 'text-status-negative'"
        :data-passed="report.passed ? '1' : '0'"
        data-testid="build-result"
      >
        {{ report.passed ? $t("build-passed") : $t("build-failed") }}
      </span>
      <p v-if="note !== null" class="text-text-secondary" role="status">{{ note }}</p>
    </div>
    <pre
      v-if="log !== ''"
      class="max-h-24 overflow-auto rounded-control bg-surface-sunken p-1.5 font-mono text-[0.6875rem]"
      translate="no"
      data-testid="build-log"
      >{{ log }}</pre>
    <h3 class="font-medium">{{ $t("build-entries") }}</h3>
    <table class="w-full max-w-2xl">
      <thead>
        <tr class="text-left text-text-secondary">
          <th class="font-normal">{{ $t("build-entry") }}</th>
          <th class="text-right font-normal">{{ $t("build-size") }}</th>
          <th class="text-right font-normal">{{ $t("build-budget") }}</th>
          <th class="font-normal">{{ $t("build-entry-result") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="{ id, entry } in entries" :key="id" :data-entry="id" data-testid="build-entry">
          <td :title="entry?.label" translate="no">{{ id }}</td>
          <td class="text-right font-mono">{{ entry === null ? "—" : `${kb(entry.gzip)} KB` }}</td>
          <td class="text-right">
            <input
              :value="limits[id] ?? ''"
              :aria-label="$t('build-budget-of', { id })"
              :class="[input, 'w-16 text-right font-mono']"
              :data-testid="`build-budget-${id}`"
              @input="limits = { ...limits, [id]: ($event.target as HTMLInputElement).value }"
            />
          </td>
          <td :class="RESULT[entry?.result ?? 'no budget']">
            {{ entry === null ? "" : $t(`build-entry-${entry.result.replace(" ", "-")}`) }}
          </td>
        </tr>
      </tbody>
    </table>
    <Button size="sm" class="self-start" data-testid="build-save-budgets" @click="saveBudgets">
      {{ $t("build-save-budgets") }}
    </Button>
    <h3 class="font-medium">{{ $t("publish") }}</h3>
    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" :disabled="state?.publish.running === true" data-testid="publish-run" @click="publish">
        {{ state?.publish.running === true ? $t("publish-running") : $t("publish-zip") }}
      </Button>
      <span class="text-text-secondary">{{ $t("publish-hint") }}</span>
    </div>
    <div v-if="published !== null" data-testid="publish-result" :data-passed="published.passed ? '1' : '0'">
      <p v-if="published.passed" class="text-status-positive">
        {{ $t("publish-done", { files: published.files, kb: kb(published.bytes) }) }}
        <a
          v-if="archiveUrl !== null"
          :href="archiveUrl"
          download
          class="text-text-link underline"
          data-testid="publish-archive"
        >
          {{ $t("publish-download") }}
        </a>
      </p>
      <!-- The publish targets of the plugins get the archive. -->
      <div v-if="published.passed && (state?.targets?.length ?? 0) > 0" class="flex flex-wrap items-center gap-2">
        <Button
          v-for="target in state?.targets ?? []"
          :key="target.id"
          size="sm"
          variant="secondary"
          :data-testid="`publish-send-${target.id}`"
          @click="send(target.id)"
        >
          {{ $t("publish-send", { target: target.title }) }}
        </Button>
      </div>
      <p
        v-if="state?.sent"
        :class="state.sent.ok ? 'text-status-positive' : 'text-status-negative'"
        data-testid="publish-sent"
        translate="no"
      >
        {{ state.sent.text }}
      </p>
      <template v-if="!published.passed">
        <p class="text-status-negative">{{ $t("publish-stopped") }}</p>
        <ul class="text-status-negative" data-testid="publish-reasons">
          <li v-for="reason in published.reasons" :key="reason" translate="no">{{ reason }}</li>
        </ul>
      </template>
    </div>
    <template v-if="report !== null">
      <h3 class="font-medium">{{ $t("build-gate") }}</h3>
      <p
        v-if="report.markers.found.length === 0 && report.markers.modules.length === 0"
        class="text-status-positive"
        data-testid="build-gate-clean"
      >
        {{ $t("build-gate-clean") }}
      </p>
      <ul class="text-status-negative" data-testid="build-gate">
        <li v-for="item in report.markers.found" :key="item.id" translate="no">{{ item.id }}: {{ item.what }}</li>
        <li v-for="item in report.markers.modules" :key="`${item.id}:${item.source}`" translate="no">
          {{ item.id }}: {{ item.source }}
        </li>
      </ul>
      <p v-for="problem in report.problems" :key="problem" class="text-status-negative" translate="no">{{ problem }}</p>
    </template>
  </section>
</template>
