<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Approvals panel: a review queue for each approval role of the project, and the review of the selected asset. The
 * queue shows first the assets with no approval, a stale approval after a source change, or a verdict that is not
 * "approved". The review has the reviewer, a note, and Approve, Ask for changes or Reject. A review writes the approval
 * file, so the release gate (`assets release-check`) reads it. A project with no role gets a form for its first role.
 */
import { useI18n } from "@scenity/i18n";
import { Button, Select } from "@scenity/ui";
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import type { AssetSource } from "../assetClient";
import type { ApprovalQueue, ApprovalVerdictName } from "../assetTypes";
import { queueOf, readReviewer, waiting, writeReviewer } from "./approvalQueue";

const props = defineProps<{ source: AssetSource }>();
const { $t } = useI18n();
const queue = shallowRef<ApprovalQueue | null>(null);
const role = ref("");
const selectedId = ref<string | null>(null);
const reviewer = ref(readReviewer());
const note = ref("");
const reason = ref<string | null>(null);
const newRole = ref("");
const newLabel = ref("");

async function read(): Promise<void> {
  queue.value = (await props.source.approvals?.()) ?? null;
  const roles = queue.value?.roles ?? [];
  if (!roles.some((each) => each.role === role.value)) role.value = roles[0]?.role ?? "";
}
onMounted(() => void read());
watch(role, () => (selectedId.value = null));

const roleOptions = computed(() =>
  (queue.value?.roles ?? []).map((each) => {
    const count = waiting(queueOf(queue.value, each.role));
    return { value: each.role, label: `${each.label ?? each.role} (${String(count)})` };
  }),
);
const rows = computed(() => queueOf(queue.value, role.value));
const selected = computed(() => rows.value.find((row) => row.asset.id === selectedId.value) ?? null);

async function review(verdict: ApprovalVerdictName): Promise<void> {
  const row = selected.value;
  if (row === null || props.source.writeApproval === undefined) return;
  if (reviewer.value.trim() === "") {
    reason.value = $t("approvals-reviewer-needed");
    return;
  }
  writeReviewer(reviewer.value.trim());
  const result = await props.source.writeApproval({
    id: row.asset.id,
    role: role.value,
    reviewer: reviewer.value,
    verdict,
    ...(note.value.trim() === "" ? {} : { note: note.value }),
  });
  reason.value = result.ok ? null : result.reason;
  if (result.ok) note.value = "";
  await read();
}

async function addRole(): Promise<void> {
  const result = await props.source.addApprovalRole?.(newRole.value.trim(), newLabel.value);
  reason.value = result === undefined || result.ok ? null : result.reason;
  if (result?.ok === true) {
    role.value = newRole.value.trim();
    newRole.value = "";
    newLabel.value = "";
  }
  await read();
}

const MARK: Readonly<Record<string, string>> = {
  current: "text-status-positive",
  stale: "text-status-caution",
  missing: "text-text-secondary",
  refused: "text-status-negative",
};
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col text-caption text-text-primary"
    :aria-label="$t('approvals')"
    data-testid="approvals-panel"
  >
    <header class="flex flex-wrap items-center gap-1 border-b border-border-subtle px-1.5 py-1">
      <Select
        v-if="roleOptions.length > 0"
        v-model="role"
        :options="roleOptions"
        class="w-48"
        :aria-label="$t('approvals-role')"
        data-testid="approvals-role"
      />
      <Button size="sm" variant="ghost" data-testid="approvals-refresh" @click="read">
        {{ $t("approvals-refresh") }}
      </Button>
      <form class="flex items-center gap-1" @submit.prevent="addRole">
        <label class="flex items-center gap-1" for="approvals-new-role">
          {{ $t("approvals-new-role") }}
          <input
            id="approvals-new-role"
            v-model="newRole"
            :class="[input, 'w-24 font-mono']"
            data-testid="approvals-new-role"
          />
        </label>
        <label class="flex items-center gap-1" for="approvals-new-label">
          {{ $t("approvals-new-label") }}
          <input
            id="approvals-new-label"
            v-model="newLabel"
            :class="[input, 'w-32']"
            data-testid="approvals-new-label"
          />
        </label>
        <Button size="sm" type="submit" :disabled="newRole.trim() === ''" data-testid="approvals-add-role">
          {{ $t("approvals-add-role") }}
        </Button>
      </form>
    </header>
    <p v-if="reason !== null" class="px-1.5 text-status-negative" role="alert">{{ reason }}</p>
    <p v-if="roleOptions.length === 0" class="p-1.5 text-text-secondary">{{ $t("approvals-no-role") }}</p>
    <div class="flex min-h-0 flex-1">
      <ul class="min-h-0 flex-1 overflow-auto p-1" :aria-label="$t('approvals-queue')">
        <li v-for="row in rows" :key="row.asset.id">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-control px-1 py-0.5 text-left hover:bg-surface-raised"
            :class="selectedId === row.asset.id && 'bg-accent-brand/15'"
            :aria-pressed="selectedId === row.asset.id"
            :data-state="row.cell.state"
            :data-testid="`approvals-row-${row.asset.id}`"
            @click="selectedId = row.asset.id"
          >
            <span class="min-w-0 flex-1 truncate" translate="no">{{ row.asset.name }}</span>
            <span class="text-text-secondary" translate="no">{{ row.asset.kind }}</span>
            <span class="w-24 text-right" :class="MARK[row.cell.state]">{{
              $t(`approvals-state-${row.cell.state}`)
            }}</span>
          </button>
        </li>
      </ul>
      <aside
        v-if="selected !== null"
        class="flex w-72 shrink-0 flex-col gap-1 overflow-auto border-l border-border-subtle p-1.5"
        data-testid="approvals-review"
      >
        <h3 class="truncate font-medium" translate="no">{{ selected.asset.name }}</h3>
        <p v-if="selected.cell.verdict !== null" class="text-text-secondary">
          {{
            $t("approvals-last", {
              verdict: $t(`approvals-verdict-${selected.cell.verdict}`),
              reviewer: selected.cell.reviewer ?? "",
              date: selected.cell.date ?? "",
            })
          }}
        </p>
        <p v-if="selected.cell.note !== null" class="text-text-secondary" translate="no">{{ selected.cell.note }}</p>
        <label class="flex items-center gap-1" for="approvals-reviewer">
          <span class="w-20 shrink-0">{{ $t("approvals-reviewer") }}</span>
          <input
            id="approvals-reviewer"
            v-model="reviewer"
            :class="[input, 'flex-1']"
            data-testid="approvals-reviewer"
          />
        </label>
        <label class="flex flex-col gap-0.5" for="approvals-note">
          {{ $t("approvals-note") }}
          <textarea
            id="approvals-note"
            v-model="note"
            rows="3"
            class="rounded-control border border-border-subtle bg-surface-sunken p-1.5 text-text-primary"
            data-testid="approvals-note"
          />
        </label>
        <div class="flex flex-wrap gap-1">
          <Button size="sm" variant="primary" data-testid="approvals-approve" @click="review('approved')">
            {{ $t("approvals-approve") }}
          </Button>
          <Button size="sm" data-testid="approvals-changes" @click="review('changes')">
            {{ $t("approvals-changes") }}
          </Button>
          <Button size="sm" variant="ghost" data-testid="approvals-reject" @click="review('rejected')">
            {{ $t("approvals-reject") }}
          </Button>
        </div>
      </aside>
    </div>
  </section>
</template>
