<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The lab page of a project with no editor plugin. The lab page needs the editor face of a plugin (its takes, its
 * content browser and its commands). The page tells this and names the next steps. First it names the studio
 * (`scenity studio`), which has the Hub and every project. Then it names the scene page of the project
 * (`scenity dev`), and the editor on a project with an editor plugin (`SCENITY_PROJECT`).
 */
import { useI18n } from "@scenity/i18n";

const { $t } = useI18n();
</script>

<template>
  <main
    class="flex min-h-screen items-center justify-center bg-surface-base p-6 text-text-primary"
    data-testid="no-plugin"
  >
    <section class="max-w-prose space-y-3">
      <h1 class="text-title">{{ $t("lab-no-plugin-title") }}</h1>
      <p>{{ $t("lab-no-plugin-body") }}</p>
      <p>{{ $t("lab-no-plugin-studio") }} <code translate="no">scenity studio</code></p>
      <p>{{ $t("lab-no-plugin-scene") }} <code translate="no">scenity dev</code></p>
      <p>{{ $t("lab-no-plugin-project") }} <code translate="no">SCENITY_PROJECT</code></p>
    </section>
  </main>
</template>
