<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Export panel: the GLB export of a scene with its options (the scene, the output file,
 * a run of the importers first), and the result: the file, its size, the warnings of the export and the errors of the
 * glTF validator.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { ref, shallowRef } from "vue";
import type { AssetSource } from "../assetClient";
import type { GlbExportResult } from "../assetTypes";

const props = defineProps<{ source: AssetSource; scene: () => string }>();
const { $t } = useI18n();
const scene = ref(props.scene());
const out = ref("");
const imports = ref(true);
const running = ref(false);
const result = shallowRef<GlbExportResult | null>(null);

async function run(): Promise<void> {
  if (props.source.exportGlb === undefined) return;
  running.value = true;
  result.value = await props.source.exportGlb({
    scene: scene.value.trim(),
    ...(out.value.trim() === "" ? {} : { out: out.value.trim() }),
    runImports: imports.value,
  });
  running.value = false;
}
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('export-panel')"
    data-testid="export-panel"
  >
    <label class="flex items-center gap-1" for="export-scene">
      <span class="w-28 shrink-0">{{ $t("export-scene") }}</span>
      <input id="export-scene" v-model="scene" :class="[input, 'w-72 font-mono']" data-testid="export-scene" />
    </label>
    <label class="flex items-center gap-1" for="export-out">
      <span class="w-28 shrink-0">{{ $t("export-out") }}</span>
      <input
        id="export-out"
        v-model="out"
        :class="[input, 'w-72 font-mono']"
        :placeholder="$t('export-out-default')"
        data-testid="export-out"
      />
    </label>
    <label class="flex items-center gap-1" for="export-imports">
      <input id="export-imports" v-model="imports" type="checkbox" data-testid="export-imports" />
      {{ $t("export-imports") }}
    </label>
    <Button
      size="sm"
      variant="primary"
      class="self-start"
      :disabled="running || source.exportGlb === undefined"
      data-testid="export-run"
      @click="run"
    >
      {{ running ? $t("export-running") : $t("export-run") }}
    </Button>
    <p v-if="result?.ok === false" class="text-status-negative" role="alert">{{ result.reason }}</p>
    <div v-else-if="result?.ok === true" class="flex flex-col gap-0.5" data-testid="export-result">
      <p>
        <span class="font-mono" translate="no" data-testid="export-file">{{ result.file }}</span>
        · {{ kb(result.bytes) }} · {{ $t("export-counts", { entities: result.entities, models: result.models }) }}
      </p>
      <p
        :class="result.validatorErrors.length === 0 ? 'text-status-positive' : 'text-status-negative'"
        data-testid="export-validator"
        :data-errors="result.validatorErrors.length"
      >
        {{
          result.validatorErrors.length === 0
            ? $t("export-valid")
            : $t("export-invalid", { count: result.validatorErrors.length })
        }}
      </p>
      <p v-for="error in result.validatorErrors" :key="error" class="text-status-negative" translate="no">
        {{ error }}
      </p>
      <p v-for="warning in result.warnings" :key="warning" class="text-status-caution" translate="no">{{ warning }}</p>
    </div>
  </section>
</template>
