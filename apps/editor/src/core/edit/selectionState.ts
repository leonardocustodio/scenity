// SPDX-License-Identifier: Apache-2.0
/**
 * The selection of the scene edit: the selected item of the card (`selection`), the list of all selected items
 * (`selected`, the item of the card first) and the pick of the item of the card. The URL keeps the list
 * (`sel=prop:cart` or `sel=prop:cart,prop:pillow`), so a reload and a link keep it. A click selects the picked item.
 * Shift+click (`add`) adds the item or removes it.
 */
import { parseSelection, selectionText, type PickResult, type SelectTarget } from "@scenity/runtime-dev";
import { shallowRef, type ShallowRef } from "vue";

export interface SelectionState {
  readonly selection: ShallowRef<SelectTarget | null>;
  readonly selected: ShallowRef<readonly SelectTarget[]>;
  readonly picked: ShallowRef<PickResult | null>;
  readonly select: (target: SelectTarget | null, picked?: PickResult | null) => void;
  readonly selectAll: (targets: readonly SelectTarget[]) => void;
  readonly pickAndSelect: (x: number, y: number, add?: boolean) => Promise<PickResult | null>;
}

/** Keep the selection in the URL, so a reload and a link keep it. */
function keepSelection(targets: readonly SelectTarget[]): void {
  const url = new URL(globalThis.location.href);
  if (targets.length === 0) url.searchParams.delete("sel");
  else url.searchParams.set("sel", selectionText(targets));
  globalThis.history.replaceState(globalThis.history.state, "", url);
}

const same = (a: SelectTarget, b: SelectTarget): boolean => a.kind === b.kind && a.id === b.id;

/** The list after a toggle of an item (Shift+click). An item in the list goes out, else it goes at the end. */
export function toggledList(list: readonly SelectTarget[], item: SelectTarget): SelectTarget[] {
  return list.some((entry) => same(entry, item))
    ? list.filter((entry) => !same(entry, item))
    : [...list, { kind: item.kind, id: item.id }];
}

export function useSelectionState(
  params: URLSearchParams,
  pick: (x: number, y: number) => Promise<PickResult | null>,
): SelectionState {
  // The list of the URL. The first item is the item of the card.
  const selected = shallowRef<readonly SelectTarget[]>(parseSelection(params.get("sel")));
  const selection = shallowRef<SelectTarget | null>(selected.value[0] ?? null);
  const picked = shallowRef<PickResult | null>(null);

  function select(target: SelectTarget | null, last: PickResult | null = null): void {
    selection.value = target === null ? null : { kind: target.kind, id: target.id };
    selected.value = selection.value === null ? [] : [selection.value];
    picked.value = last;
    keepSelection(selected.value);
  }

  /** Select a list. The pick of the item of the card stays when that item stays first. */
  function selectAll(targets: readonly SelectTarget[]): void {
    const list: SelectTarget[] = [];
    for (const item of targets)
      if (!list.some((entry) => same(entry, item))) list.push({ kind: item.kind, id: item.id });
    const first = list[0] ?? null;
    const now = selection.value;
    if (first === null || now === null || !same(first, now)) picked.value = null;
    selection.value = first;
    selected.value = list;
    keepSelection(list);
  }

  async function pickAndSelect(x: number, y: number, add = false): Promise<PickResult | null> {
    const result = await pick(x, y);
    const item = result === null || result.kind === "room" ? null : result;
    if (add && item !== null) {
      // Shift+click adds the item or removes it. A first item keeps its pick for the card.
      const next = toggledList(selected.value, item);
      selectAll(next);
      if (next.length === 1) picked.value = item;
    } else if (!add) {
      if (item === null) select(null);
      else select(item, item);
    }
    return result;
  }

  return { selection, selected, picked, select, selectAll, pickAndSelect };
}
