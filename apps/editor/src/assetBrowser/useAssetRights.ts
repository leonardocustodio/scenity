// SPDX-License-Identifier: Apache-2.0
/**
 * The rights of the asset browser: the assets that the release gate stops (a mark on each
 * tile, from the health of the assets), the picked assets (Mod or Shift and a click), and one rights record for all
 * the picked assets.
 */
import { ref, shallowRef } from "vue";
import { t } from "../texts";
import type { AssetSource } from "./assetClient";
import type { RightsSummary } from "./assetTypes";

/** The rights state of one browser. `done` runs after an assignment (the browser reads its list again). */
export function useAssetRights(source: AssetSource, status: { value: string }, done: () => Promise<void>) {
  const picked = ref<string[]>([]);
  /** The problems of the release gate for each stopped asset. */
  const blocked = shallowRef<ReadonlyMap<string, readonly string[]>>(new Map());
  const records = shallowRef<readonly RightsSummary[]>([]);

  async function read(): Promise<void> {
    const [health, found] = await Promise.all([source.health?.() ?? null, source.rights?.() ?? []]);
    blocked.value = new Map((health?.rights ?? []).map((item) => [item.id, item.problems]));
    records.value = found;
  }

  function toggle(id: string): void {
    picked.value = picked.value.includes(id) ? picked.value.filter((each) => each !== id) : [...picked.value, id];
  }

  /** Give the rights record (a path relative to the project folder) to each picked asset. */
  async function assign(rights: string): Promise<void> {
    if (source.assignRights === undefined || picked.value.length === 0) return;
    const count = picked.value.length;
    const result = await source.assignRights(picked.value, rights);
    status.value = result.ok ? t("assets-rights-assigned", { count, rights }) : result.reason;
    if (!result.ok) return;
    picked.value = [];
    await done();
  }

  return { picked, blocked, records, read, toggle, assign, clear: () => (picked.value = []) };
}
