<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The start screen of the workbench: the Git worktrees of the repository (`checkouts.list`). The owner opens one (the
 * host starts its dev servers) or makes one from a branch (`checkouts.create`). One window shows one checkout. A new
 * worktree is `preparing` while the host runs `bun install` and `bun run generate` in it (the run `setup`). The screen
 * shows the output of that run and opens the checkout only after the run.
 */
import { stripAnsi, type Checkout } from "@scenity/workbench-host/protocol";
import { FolderGit2, GitBranchPlus, LoaderCircle, RotateCw, X } from "lucide-vue-next";
import { onMounted, onUnmounted, ref } from "vue";
import type { DockHost } from "../dock/dockHost";
import type { HostRequest } from "../host/useHost";
import { baseName, button, cn, count, field, iconButton } from "../layout/ui";
import { openNewWindow } from "./newWindow";

defineOptions({ name: "WorkbenchCheckouts" });
const props = defineProps<{
  readonly request: HostRequest;
  readonly openCheckout: (path: string) => Promise<void>;
  /** The path of the open checkout, or null. */
  readonly current: string | null;
  /** The events of the host: the output of the setup runs. */
  readonly on?: DockHost["on"] | undefined;
}>();
const emit = defineEmits<{ close: [] }>();

const checkouts = ref<readonly Checkout[] | null>(null);
const error = ref<string | null>(null);
const busy = ref<string | null>(null);
const branch = ref("");
const base = ref("");
const made = ref<string | null>(null);
/** The last output lines of each setup run, by run ID. */
const setupLines = ref<Readonly<Record<string, readonly string[]>>>({});
const stops: (() => void)[] = [];

const preparing = (checkout: Checkout): boolean => checkout.setup?.state === "preparing";

/**
 * Keep the last lines of each run. The first output of a setup run comes before the answer of `checkouts.create`,
 * so the screen keeps the lines of the last few runs, and a row shows the lines of its setup run.
 */
function addOutput(run: string, data: string): void {
  const lines = stripAnsi(data)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const kept = Object.entries(setupLines.value)
    .filter(([id]) => id !== run)
    .slice(-5);
  setupLines.value = { ...Object.fromEntries(kept), [run]: [...(setupLines.value[run] ?? []), ...lines].slice(-8) };
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function load(): Promise<void> {
  error.value = null;
  try {
    checkouts.value = await props.request("checkouts.list", {});
  } catch (reason) {
    error.value = message(reason);
  }
}

async function open(path: string): Promise<void> {
  if (path === props.current) {
    emit("close");
    return;
  }
  busy.value = path;
  error.value = null;
  try {
    await props.openCheckout(path);
    emit("close");
  } catch (reason) {
    error.value = message(reason);
  } finally {
    busy.value = null;
  }
}

/** Open the checkout in a new window with its own host (newWindow.ts). */
async function inWindow(path: string): Promise<void> {
  busy.value = path;
  error.value = null;
  try {
    await openNewWindow(path, props.request);
  } catch (reason) {
    error.value = message(reason);
  } finally {
    busy.value = null;
  }
}

async function create(): Promise<void> {
  const name = branch.value.trim();
  if (name === "") return;
  busy.value = "create";
  error.value = null;
  try {
    const params = base.value.trim() === "" ? { branch: name } : { branch: name, base: base.value.trim() };
    const checkout = await props.request("checkouts.create", params);
    made.value = checkout.path;
    branch.value = "";
    base.value = "";
    await load();
  } catch (reason) {
    error.value = message(reason);
  } finally {
    busy.value = null;
  }
}

onMounted(() => {
  void load();
  if (props.on === undefined) return;
  stops.push(props.on("runs.output", ({ run, data }) => addOutput(run, data)));
  stops.push(
    props.on("runs.done", ({ run }) => {
      if ((checkouts.value ?? []).some((checkout) => checkout.setup?.run === run)) void load();
    }),
  );
});
onUnmounted(() => {
  for (const stop of stops.splice(0)) stop();
});
</script>

<template>
  <section
    class="min-h-0 overflow-y-auto bg-surface-base px-4 py-6"
    aria-labelledby="checkouts-title"
    data-testid="checkouts"
  >
    <div class="mx-auto flex max-w-3xl flex-col gap-5">
      <div class="flex items-center gap-2">
        <h2 id="checkouts-title" class="text-title">Checkouts</h2>
        <button type="button" :class="cn(button, 'ml-auto inline-flex items-center gap-1.5')" @click="load">
          <RotateCw class="size-3.5" aria-hidden="true" />Refresh
        </button>
        <button
          v-if="current !== null"
          type="button"
          :class="iconButton"
          aria-label="Back to the open checkout"
          title="Back to the open checkout"
          data-testid="checkouts-close"
          @click="emit('close')"
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </div>
      <p v-if="error !== null" class="text-status-negative" role="alert" data-testid="checkouts-error">{{ error }}</p>
      <p v-if="checkouts === null && error === null" class="flex items-center gap-2 text-text-secondary" role="status">
        <LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Reading the worktrees
      </p>
      <ul
        v-else-if="checkouts !== null"
        class="flex flex-col divide-y divide-border-subtle rounded-control border border-border-subtle bg-surface-raised"
      >
        <li v-if="checkouts.length === 0" class="px-3 py-3 text-text-secondary">The repository has no worktrees.</li>
        <li
          v-for="checkout in checkouts"
          :key="checkout.path"
          :class="
            cn(
              'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5',
              checkout.path === made && 'bg-accent-brand/10',
            )
          "
          data-testid="checkout-row"
        >
          <FolderGit2 class="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-mono text-body">{{
              checkout.branch ?? `detached at ${checkout.head.slice(0, 8)}`
            }}</span>
            <span class="truncate text-caption text-text-secondary" :title="checkout.path">{{ checkout.path }}</span>
          </div>
          <span class="text-caption text-text-secondary">{{ count(checkout.changed, "changed file") }}</span>
          <span
            v-if="preparing(checkout)"
            class="inline-flex items-center gap-1 text-caption text-status-caution"
            role="status"
            :data-testid="`preparing-${baseName(checkout.path)}`"
          >
            <LoaderCircle class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />preparing
          </span>
          <span
            v-else-if="checkout.setup?.state === 'failed'"
            class="text-caption text-status-negative"
            :data-testid="`setup-failed-${baseName(checkout.path)}`"
            >setup failed: see the run in the Runs tab</span
          >
          <span v-if="checkout.path === current" class="text-caption text-status-positive">open here</span>
          <span v-else-if="checkout.open" class="text-caption text-text-secondary">servers on</span>
          <button
            type="button"
            :class="cn(button, 'inline-flex items-center gap-1.5')"
            :disabled="busy !== null || preparing(checkout)"
            :aria-label="`Open ${baseName(checkout.path)}`"
            :data-testid="`open-${baseName(checkout.path)}`"
            @click="open(checkout.path)"
          >
            <LoaderCircle
              v-if="busy === checkout.path"
              class="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {{ checkout.path === current ? "Show" : "Open" }}
          </button>
          <!-- A second window (app) or tab (browser) with its own host for this checkout. -->
          <button
            v-if="checkout.path !== current"
            type="button"
            :class="button"
            :disabled="busy !== null || preparing(checkout)"
            :aria-label="`Open ${baseName(checkout.path)} in a new window`"
            :data-testid="`window-${baseName(checkout.path)}`"
            @click="inWindow(checkout.path)"
          >
            New window
          </button>
          <pre
            v-if="checkout.setup !== undefined && (setupLines[checkout.setup.run]?.length ?? 0) > 0"
            class="w-full overflow-x-auto rounded-control bg-surface-sunken p-1.5 font-mono text-caption whitespace-pre-wrap"
            :data-testid="`setup-output-${baseName(checkout.path)}`"
            >{{ setupLines[checkout.setup.run]?.join("\n") }}</pre>
        </li>
      </ul>
      <form
        class="flex flex-col gap-2 rounded-control border border-border-subtle bg-surface-raised p-3"
        data-testid="checkout-create"
        @submit.prevent="create"
      >
        <h3 class="flex items-center gap-1.5 text-label">
          <GitBranchPlus class="size-4" aria-hidden="true" />New worktree
        </h3>
        <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <label for="checkout-branch" class="flex flex-col gap-1 text-caption text-text-secondary">
            Branch
            <input
              id="checkout-branch"
              v-model="branch"
              :class="cn(field, 'font-mono')"
              name="branch"
              required
              autocomplete="off"
              spellcheck="false"
              placeholder="lc/new-work"
            />
          </label>
          <label for="checkout-base" class="flex flex-col gap-1 text-caption text-text-secondary">
            Start from (optional)
            <input
              id="checkout-base"
              v-model="base"
              :class="cn(field, 'font-mono')"
              name="base"
              autocomplete="off"
              spellcheck="false"
              placeholder="develop"
            />
          </label>
          <button
            type="submit"
            :class="cn(button, 'self-end min-h-8')"
            :disabled="busy !== null || branch.trim() === ''"
            data-testid="checkout-create-submit"
          >
            {{ busy === "create" ? "Creating" : "Create worktree" }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
