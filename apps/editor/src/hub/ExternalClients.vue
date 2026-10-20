<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The connections of the external agents in the Hub. Each connection request also waits here, also a request with no
 * project (the owner selects the project, then Allow or Deny). Each allowed client has Revoke. "Connect over HTTP"
 * makes an allowed connection for an MCP client over HTTP (the `/mcp` path of the host). It shows its token one time,
 * in the command line for Claude Code and in the config of the other apps.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { agentClient, type ConnectionView } from "../scene/agent/agentClient";
import type { ProjectInfo } from "./studioApi";
import type { Hub } from "./useHub";

const props = defineProps<{ hub: Hub }>();
const { $t } = useI18n();
const client = agentClient();
const connections = shallowRef<readonly ConnectionView[]>([]);
const projects = computed<readonly ProjectInfo[]>(() => props.hub.state.studio?.projects ?? []);
const chosen = ref<Record<string, string>>({});
const name = ref("Codex");
const project = ref("");
const made = ref<{ name: string; token: string } | null>(null);
const copied = ref(false);
const field = "min-h-9 rounded-control border border-border-strong bg-surface-raised px-2 text-body";
const url = computed(() => `${props.hub.state.studio?.origin ?? location.origin}/mcp`);
const setup = computed(() =>
  made.value === null
    ? ""
    : `claude mcp add --transport http scenity ${url.value} --header "Authorization: Bearer ${made.value.token}"`,
);
const config = computed(() =>
  made.value === null
    ? ""
    : JSON.stringify({
        mcpServers: { scenity: { url: url.value, headers: { Authorization: `Bearer ${made.value.token}` } } },
      }),
);

async function load(): Promise<void> {
  connections.value = (await client.connections().catch(() => ({ connections: [] }))).connections;
}
let stop = (): void => undefined;
onMounted(() => {
  void load();
  stop = props.hub.api.events((event) => {
    const change = event as unknown as { type: string; connections?: readonly ConnectionView[] };
    if (change.type === "agent.connections" && change.connections !== undefined) connections.value = change.connections;
  });
});
onBeforeUnmount(() => stop());

const projectOf = (item: ConnectionView): string =>
  item.project ?? chosen.value[item.id] ?? projects.value[0]?.key ?? "";

async function act(item: ConnectionView, action: "allow" | "deny" | "revoke"): Promise<void> {
  await props.hub.attempt(async () => {
    if (action === "allow") await client.allowConnection(item.id, projectOf(item));
    else if (action === "deny") await client.denyConnection(item.id);
    else await client.revokeConnection(item.id);
  });
  await load();
}

async function connect(): Promise<void> {
  const key = project.value === "" ? (projects.value[0]?.key ?? "") : project.value;
  if (name.value.trim() === "" || key === "") return;
  const answer = await props.hub.attempt(() => client.addConnection(name.value.trim(), key));
  if (answer !== undefined) made.value = { name: answer.name, token: answer.token };
  copied.value = false;
  await load();
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text).then(() => (copied.value = true));
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="agents-clients">
    <h3 class="text-label">{{ $t("hub-clients-title") }}</h3>
    <p v-if="connections.length === 0" class="text-caption text-text-secondary">{{ $t("hub-clients-none") }}</p>
    <ul class="flex flex-col gap-2">
      <li
        v-for="item in connections"
        :key="item.id"
        class="flex flex-wrap items-center gap-2"
        :data-connection="item.id"
        :data-state="item.state"
        data-testid="agents-client"
      >
        <span class="font-semibold" translate="no">{{ item.name }}</span>
        <span class="text-caption text-text-secondary">{{ $t(`hub-clients-${item.state}`) }}</span>
        <span v-if="item.project !== null" class="text-caption" translate="no">{{ item.project }}</span>
        <template v-if="item.state === 'pending'">
          <select
            v-if="item.project === null"
            v-model="chosen[item.id]"
            :aria-label="$t('hub-clients-project')"
            :class="field"
            data-testid="agents-client-project"
          >
            <option v-for="each in projects" :key="each.key" :value="each.key" translate="no">{{ each.name }}</option>
          </select>
          <Button size="sm" variant="primary" data-testid="agents-client-allow" @click="act(item, 'allow')">
            {{ $t("hub-clients-allow") }}
          </Button>
          <Button size="sm" data-testid="agents-client-deny" @click="act(item, 'deny')">{{
            $t("hub-clients-deny")
          }}</Button>
        </template>
        <Button
          v-else-if="item.state === 'allowed'"
          size="sm"
          data-testid="agents-client-revoke"
          @click="act(item, 'revoke')"
        >
          {{ $t("hub-clients-revoke") }}
        </Button>
      </li>
    </ul>
    <form class="flex flex-wrap items-end gap-2" data-testid="agents-http" @submit.prevent="connect">
      <label class="flex flex-col gap-1 text-label" for="agents-http-name">
        {{ $t("hub-clients-name") }}
        <input id="agents-http-name" v-model="name" :class="field" data-testid="agents-http-name" />
      </label>
      <label class="flex flex-col gap-1 text-label" for="agents-http-project">
        {{ $t("hub-clients-project") }}
        <select id="agents-http-project" v-model="project" :class="field" data-testid="agents-http-project">
          <option v-for="each in projects" :key="each.key" :value="each.key" translate="no">{{ each.name }}</option>
        </select>
      </label>
      <Button type="submit" :disabled="projects.length === 0" data-testid="agents-http-connect">
        {{ $t("hub-clients-http") }}
      </Button>
    </form>
    <div v-if="made !== null" class="flex flex-col gap-1" data-testid="agents-http-made">
      <p class="text-caption text-text-secondary">{{ $t("hub-clients-token-once", { name: made.name }) }}</p>
      <code
        class="rounded-control bg-surface-sunken px-2 py-1 break-all"
        translate="no"
        data-testid="agents-http-setup"
        >{{ setup }}</code
      >
      <code class="rounded-control bg-surface-sunken px-2 py-1 break-all" translate="no">{{ config }}</code>
      <Button size="sm" class="self-start" @click="copy(setup)">
        {{ copied ? $t("hub-agents-copied") : $t("hub-agents-copy") }}
      </Button>
    </div>
  </div>
</template>
