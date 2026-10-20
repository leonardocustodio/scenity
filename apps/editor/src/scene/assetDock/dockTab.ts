// SPDX-License-Identifier: Apache-2.0
/**
 * A tab of the bottom dock of the scene page after "Assets" (for example, the sequencer): its ID, its label, the
 * component of its panel and the props of the component.
 */
import type { Component } from "vue";

export interface DockTab {
  readonly id: string;
  readonly label: string;
  readonly component: Component;
  readonly props: Readonly<Record<string, unknown>>;
}
