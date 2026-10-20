// SPDX-License-Identifier: Apache-2.0
/**
 * The compare action of the picker. The owner marks two tiles, and the compare view opens with their sheets as A and B
 * (the first mark is A). A third mark starts a new pair. A close of the view clears the marks.
 */
import type { PickCandidate } from "@scenity/workbench-host/protocol";
import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { ComparePair, CompareSide } from "./comparePairs";

export interface PickerCompare {
  /** The IDs of the marked tiles, in mark order. */
  readonly marked: Ref<string[]>;
  /** The pair of the two marked tiles, or null while fewer are marked. */
  readonly pairs: ComputedRef<ComparePair[] | null>;
  toggle(item: PickCandidate): void;
  close(): void;
}

export function usePickerCompare(
  shown: () => readonly PickCandidate[],
  sideOf: (item: PickCandidate) => CompareSide,
): PickerCompare {
  const marked = ref<string[]>([]);
  const pairs = computed(() => {
    if (marked.value.length !== 2) return null;
    const items = marked.value.map((id) => shown().find((item) => item.id === id));
    const [a, b] = items;
    if (a === undefined || b === undefined) return null;
    return [{ label: "Sheets", a: sideOf(a), b: sideOf(b) }];
  });
  return {
    marked,
    pairs,
    toggle(item) {
      const list = marked.value;
      if (list.includes(item.id)) marked.value = list.filter((id) => id !== item.id);
      else marked.value = list.length >= 2 ? [item.id] : [...list, item.id];
    },
    close() {
      marked.value = [];
    },
  };
}
