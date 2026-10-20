// SPDX-License-Identifier: Apache-2.0
/**
 * The asset dock of the edit mode. It is a lazy chunk with Vue, as the inspector is, so a page without `edit=1` never
 * loads it. With an open sequence, the dock also has the sequencer tab (also a lazy chunk). With the rule check of the
 * page, the dock also has the rules tab (also a lazy chunk). `more` gives more tabs of the page (the material editor),
 * each from a lazy chunk.
 */
import type { ScenePageEditor } from "../sceneEditor";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { PageSequence } from "../sequencer/pageSequence";
import type { PageRulesPort } from "../pageRules";
import type { DockTab } from "./dockTab";

/** The parts of the page that the asset dock uses. */
export interface AssetDockParts {
  readonly project: string;
  readonly path: string;
  readonly selection?: PageSelectionPort | undefined;
  /** The project rules and the rule check of the core (the rules tab). */
  readonly rules?: PageRulesPort | undefined;
}

/** Load the asset browser and the tabs, and give each its panel of the editor window. */
export async function openAssetDock(
  parts: AssetDockParts,
  editor: ScenePageEditor,
  sequence: PageSequence | null = null,
  more: readonly Promise<DockTab | null>[] = [],
): Promise<void> {
  const { rules } = parts;
  const [{ startAssetDock }, tab, rulesTab, ...others] = await Promise.all([
    import("./startAssetDock"),
    sequence === null
      ? null
      : import("../sequencer/startSequencer").then((chunk) => chunk.sequencerTab(sequence, parts)),
    rules === undefined
      ? null
      : import("../rules/startRules").then((chunk) =>
          chunk.rulesTab({
            ...{ editor, sequence, selection: parts.selection, port: rules },
            base: `/projects/${parts.project}/`,
          }),
        ),
    ...more,
  ]);
  await startAssetDock({
    ...{ editor, base: `/projects/${parts.project}/`, scenePath: parts.path, selection: parts.selection },
    tabs: [tab, rulesTab, ...others].filter((item): item is DockTab => item !== null),
  });
}
