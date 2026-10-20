// SPDX-License-Identifier: Apache-2.0
/**
 * The sequencer tab of the bottom dock of the scene page. The page loads this module only in the edit mode with an
 * open sequence, so the frames of the gallery do not change.
 */
import { markRaw } from "vue";
import { t } from "../../texts";
import type { DockTab } from "../assetDock/dockTab";
import type { PageSelectionPort } from "../inspector/startInspector";
import { devServerFiles } from "../projectWindow/projectFiles";
import type { PageSequence } from "./pageSequence";
import SequencerPanel from "./SequencerPanel.vue";
import "./sequencer.css";

/** The dock tab of the sequencer over the open sequence and the selection of the page. */
export function sequencerTab(
  sequence: PageSequence,
  parts: { readonly selection?: PageSelectionPort | undefined; readonly project?: string },
): DockTab {
  // The sequence files of the project for the sequence picker.
  const sequences = async (): Promise<string[]> => {
    if (parts.project === undefined) return [];
    const files = await devServerFiles(`/projects/${parts.project}/`).list();
    return files.map((file) => file.path).filter((path) => path.endsWith(".sequence.json"));
  };
  return {
    id: "sequence",
    label: t("dock-tab-sequence"),
    component: markRaw(SequencerPanel),
    // The open sequence has private fields: a reactive proxy of it cannot read them.
    props: { sequence: markRaw(sequence), selected: () => parts.selection?.ids ?? [], sequences },
  };
}
