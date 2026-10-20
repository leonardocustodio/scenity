// SPDX-License-Identifier: Apache-2.0
/**
 * A request to show one asset in the asset browser (a result of the search box). The browser of the page fills its
 * search with the name of the asset and selects it.
 */
import { shallowRef } from "vue";

/** The asset to show: its ID and its name. `count` makes a second request for the same asset a change. */
export interface AssetFocus {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

/** The last request, or null. */
export const assetFocus = shallowRef<AssetFocus | null>(null);

/** Ask the asset browser to show an asset. */
export function showAsset(id: string, name: string): void {
  assetFocus.value = { id, name, count: (assetFocus.value?.count ?? 0) + 1 };
}
