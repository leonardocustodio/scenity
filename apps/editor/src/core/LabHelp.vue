<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The help of the lab: all the keys and the mouse and touch controls of the lab in one dialog. The help button under
 * the title of the panel opens it.
 *
 * The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`. A key name is a data value: its key cap
 * has `translate="no"`. A mouse or touch control ("Drag") is a message.
 */
import { useI18n } from "@scenity/i18n";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@scenity/ui/components/dialog";
import { Kbd, KbdGroup } from "@scenity/ui/components/kbd";

const open = defineModel<boolean>("open", { required: true });
const { $t } = useI18n();

/** The message ID of each mouse or touch control in the key list. Each other key is a key name (a data value). */
const CONTROLS: Readonly<Record<string, string>> = {
  Drag: "lab-help-control-drag",
  Wheel: "lab-help-control-wheel",
  Click: "lab-help-control-click",
  Grip: "lab-help-control-grip",
  Fold: "lab-help-control-fold",
  Place: "lab-help-control-place",
  Drop: "lab-help-control-drop",
};

interface HelpRow {
  /** The keys (each one a key cap), or a mouse or touch control (a key of CONTROLS). */
  readonly keys: readonly string[];
  /** The message ID of the description. */
  readonly does: string;
}

/** The sections of the help. `title` is the message ID of the section title. */
const SECTIONS: readonly { readonly title: string; readonly rows: readonly HelpRow[] }[] = [
  {
    title: "lab-help-camera",
    rows: [
      { keys: ["W", "S"], does: "lab-help-camera-1" },
      { keys: ["A", "D"], does: "lab-help-camera-2" },
      { keys: ["Q", "E"], does: "lab-help-camera-3" },
      { keys: ["←", "→"], does: "lab-help-camera-4" },
      { keys: ["↑", "↓"], does: "lab-help-camera-5" },
      { keys: ["Shift"], does: "lab-help-camera-6" },
      { keys: ["Drag"], does: "lab-help-camera-7" },
      { keys: ["Wheel"], does: "lab-help-camera-8" },
      { keys: ["1", "9"], does: "lab-help-camera-9" },
    ],
  },
  {
    title: "lab-help-time",
    rows: [
      { keys: ["Space"], does: "lab-help-time-1" },
      { keys: [",", "."], does: "lab-help-time-2" },
      { keys: ["[", "]"], does: "lab-help-time-3" },
      { keys: ["\\"], does: "lab-help-time-4" },
    ],
  },
  {
    title: "lab-help-browser",
    rows: [
      { keys: ["B"], does: "lab-help-browser-1" },
      { keys: ["Shift", "B"], does: "lab-help-browser-2" },
      {
        keys: ["Drag"],
        does: "lab-help-browser-3",
      },
      { keys: ["/"], does: "lab-help-browser-4" },
      { keys: ["← → ↑ ↓"], does: "lab-help-browser-5" },
      { keys: ["Enter"], does: "lab-help-browser-6" },
      { keys: ["Backspace"], does: "lab-help-browser-7" },
    ],
  },
  {
    title: "lab-help-animations",
    rows: [
      { keys: ["P"], does: "lab-help-animations-1" },
      { keys: ["K"], does: "lab-help-animations-2" },
      { keys: ["Click"], does: "lab-help-animations-3" },
    ],
  },
  {
    title: "lab-help-props",
    rows: [
      { keys: ["Alt", "← → ↑ ↓"], does: "lab-help-props-1" },
      { keys: ["Alt", "Q", "E"], does: "lab-help-props-2" },
      { keys: ["Alt", ",", "."], does: "lab-help-props-3" },
    ],
  },
  {
    title: "lab-help-editor",
    rows: [
      { keys: ["⌘", "P"], does: "lab-help-editor-1" },
      { keys: ["Click"], does: "lab-help-editor-2" },
      { keys: ["Escape"], does: "lab-help-editor-3" },
      { keys: ["Drag"], does: "lab-help-editor-4" },
      { keys: ["R"], does: "lab-help-editor-5" },
      {
        keys: ["⌘", "Drag"],
        does: "lab-help-editor-6",
      },
      { keys: ["⌘", "Z"], does: "lab-help-editor-7" },
      {
        keys: ["Grip"],
        does: "lab-help-editor-8",
      },
      { keys: ["Fold"], does: "lab-help-editor-9" },
    ],
  },
  {
    title: "lab-help-snap",
    rows: [
      {
        keys: ["Drag"],
        does: "lab-help-snap-1",
      },
      { keys: ["Alt"], does: "lab-help-snap-2" },
      { keys: ["M"], does: "lab-help-snap-3" },
      { keys: ["Escape"], does: "lab-help-snap-4" },
    ],
  },
  {
    title: "lab-help-places",
    rows: [
      { keys: ["T"], does: "lab-help-places-1" },
      {
        keys: ["Drag"],
        does: "lab-help-places-2",
      },
    ],
  },
  {
    title: "lab-help-cables",
    rows: [
      {
        keys: ["Drag"],
        does: "lab-help-cables-1",
      },
      {
        keys: ["Drag"],
        does: "lab-help-cables-2",
      },
    ],
  },
  {
    title: "lab-help-light",
    rows: [
      {
        keys: ["I"],
        does: "lab-help-light-1",
      },
      {
        keys: ["J"],
        does: "lab-help-light-2",
      },
      {
        keys: ["Ctrl", "Drop"],
        does: "lab-help-light-3",
      },
    ],
  },
  {
    title: "lab-help-reach",
    rows: [
      {
        keys: ["G"],
        does: "lab-help-reach-1",
      },
      {
        keys: ["L"],
        does: "lab-help-reach-2",
      },
    ],
  },
  {
    title: "lab-help-describe",
    rows: [
      {
        keys: ["Place"],
        does: "lab-help-describe-1",
      },
      {
        keys: ["O"],
        does: "lab-help-describe-2",
      },
    ],
  },
  {
    title: "lab-help-solo",
    rows: [
      { keys: ["H"], does: "lab-help-solo-1" },
      { keys: ["Shift", "H"], does: "lab-help-solo-2" },
      { keys: ["Alt", "H"], does: "lab-help-solo-3" },
      {
        keys: ["Shift", "Click"],
        does: "lab-help-solo-4",
      },
      {
        keys: ["Alt", "G"],
        does: "lab-help-solo-5",
      },
    ],
  },
  {
    title: "lab-help-scene",
    rows: [
      { keys: ["Click"], does: "lab-help-scene-1" },
      { keys: ["Click"], does: "lab-help-scene-2" },
      { keys: ["Click"], does: "lab-help-scene-3" },
    ],
  },
];
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85dvh] overflow-y-auto sm:max-w-md" data-testid="lab-help">
      <DialogHeader>
        <DialogTitle>{{ $t("lab-help-title") }}</DialogTitle>
        <DialogDescription>{{ $t("lab-help-description") }}</DialogDescription>
      </DialogHeader>
      <section v-for="section in SECTIONS" :key="section.title" class="flex flex-col gap-2">
        <h3 class="text-label text-text-secondary">{{ $t(section.title) }}</h3>
        <dl class="m-0 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-caption">
          <template v-for="row in section.rows" :key="`${section.title}-${row.does}`">
            <dt>
              <KbdGroup>
                <template v-for="key in row.keys" :key="key">
                  <Kbd v-if="CONTROLS[key] !== undefined">{{ $t(CONTROLS[key]) }}</Kbd>
                  <Kbd v-else translate="no">{{ key }}</Kbd>
                </template>
              </KbdGroup>
            </dt>
            <dd class="m-0 text-text-primary">{{ $t(row.does) }}</dd>
          </template>
        </dl>
      </section>
    </DialogContent>
  </Dialog>
</template>
