<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The option pickers of a chat session: the credential, the mode, the model and the effort. The start form shows them
 * as labelled fields with hints. The Sessions tab shows them as one small row before a resume or a fork (`compact`). An
 * empty model or effort is the default of the account.
 */
import type { AgentCredential, AgentEffort, AgentMode } from "@scenity/workbench-host/protocol";
import { computed } from "vue";
import { cn, field } from "../layout/ui";
import { CREDENTIALS, EFFORTS, MODES } from "./chatWords";

const props = withDefaults(
  defineProps<{
    /** The prefix of the element IDs (unique in the page). */
    readonly id: string;
    /** The prefix of the test IDs. Empty (the default): the prefix is `id`. */
    readonly testid?: string;
    /** One small row without hints (the Sessions tab). */
    readonly compact?: boolean;
    /** The words of an empty model field and of the empty effort. */
    readonly modelHint?: string;
    readonly effortHint?: string;
  }>(),
  { testid: "", compact: false, modelHint: "the default of the account", effortHint: "the default" },
);
const credential = defineModel<AgentCredential>("credential", { required: true });
const mode = defineModel<AgentMode>("mode", { required: true });
const model = defineModel<string>("model", { required: true });
const effort = defineModel<AgentEffort | "">("effort", { required: true });

const test = computed(() => (props.testid === "" ? props.id : props.testid));
const credentialHint = computed(() => CREDENTIALS.find((item) => item.value === credential.value)?.hint ?? "");
const modeHint = computed(() => MODES.find((item) => item.value === mode.value)?.hint ?? "");
const label = computed(() => (props.compact ? "flex items-center gap-1" : "flex flex-col gap-0.5"));
const input = computed(() => (props.compact ? cn(field, "w-auto") : field));
</script>

<template>
  <div :class="compact ? 'flex flex-wrap items-center gap-2' : 'contents'" :data-testid="`${test}-pickers`">
    <label :class="label" :for="`${id}-credential`">
      Credential
      <select
        :id="`${id}-credential`"
        v-model="credential"
        :class="input"
        :title="credentialHint"
        :data-testid="`${test}-credential`"
      >
        <option v-for="item in CREDENTIALS" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
      <span v-if="!compact" class="text-text-secondary">{{ credentialHint }}</span>
    </label>
    <label :class="label" :for="`${id}-mode`">
      Mode
      <select :id="`${id}-mode`" v-model="mode" :class="input" :title="modeHint" :data-testid="`${test}-mode`">
        <option v-for="item in MODES" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
      <span v-if="!compact" class="text-text-secondary">{{ modeHint }}</span>
    </label>
    <label :class="label" :for="`${id}-model`">
      Model
      <input
        :id="`${id}-model`"
        v-model="model"
        :class="input"
        :placeholder="modelHint"
        :data-testid="`${test}-model`"
      />
    </label>
    <label :class="label" :for="`${id}-effort`">
      Effort
      <select :id="`${id}-effort`" v-model="effort" :class="input" :data-testid="`${test}-effort`">
        <option value="">{{ effortHint }}</option>
        <option v-for="level in EFFORTS" :key="level" :value="level">{{ level }}</option>
      </select>
    </label>
  </div>
</template>
