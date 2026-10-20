// SPDX-License-Identifier: Apache-2.0
/**
 * The layout checks of the scene editor. The plugin gives the checks of its scene (`EditorPlugin.layout`): the report
 * of the current inputs, the gate of "Save placement", the checks of a proposal, the checks of a save and the card of
 * the layout status. The edit panel, the cards and the editor read them here.
 *
 * A function reads the plugin when it runs, never when the module loads.
 */
import type { Component, Ref } from "vue";
import type { LayoutCheck, LayoutChecks, LayoutReport, ProposalLayout, SaveCheck } from "../../plugins";
import { editorPlugin } from "../plugin";
import type { LabEvent } from "../sequence";

export type { LayoutCheck, LayoutChecks, LayoutReport, ProposalLayout, SaveCheck };

/** What the layout checks read: the tune values and the events of the live take. */
export interface LayoutParts {
  readonly tunes: Ref<Record<string, number>>;
  /** The events of the live take (events that move the team change the checks). */
  readonly events: () => readonly LabEvent[];
  /** Add the method to the script API (default: true). The tests set false. */
  readonly api?: boolean;
}

/** What the checks of a save read: the current report, the place values and the number of the scratch props. */
export interface SaveInputs {
  readonly report: LayoutReport;
  readonly values: Readonly<Record<string, number>>;
  readonly scratch: number;
}

/** The layout checks of a plugin. */
export interface EditorLayout {
  /** The layout checks of the page. They are computed again at each change of the inputs that move things. */
  useChecks(parts: LayoutParts): LayoutChecks;
  /** One check in words, with its numbers. */
  checkLine(check: LayoutCheck): string;
  /** The checks that a proposal breaks and repairs, compared with the current report. */
  compare(now: LayoutReport, proposed: LayoutReport): ProposalLayout;
  /** The checks of "Save placement": the layout, the assets and the runtime gates. */
  saveChecks(inputs: SaveInputs): SaveCheck[];
  /** The card of the layout status (props `report` and `expanded`, the event `update:expanded`). */
  readonly status: Component;
}

const layout = (): EditorLayout => editorPlugin().layout;

export function useLayoutChecks(parts: LayoutParts): LayoutChecks {
  return layout().useChecks(parts);
}

export function checkLine(check: LayoutCheck): string {
  return layout().checkLine(check);
}

export function compareReports(now: LayoutReport, proposed: LayoutReport): ProposalLayout {
  return layout().compare(now, proposed);
}

export function saveChecks(inputs: SaveInputs): SaveCheck[] {
  return layout().saveChecks(inputs);
}

/** The card of the layout status of the plugin. */
export function layoutStatusCard(): Component {
  return layout().status;
}
