// SPDX-License-Identifier: Apache-2.0
/**
 * The rules tab of the bottom dock of the scene page, beside "Assets" and "Sequence". The page loads this module only
 * in the edit mode, so the frames of the gallery do not change.
 */
import { markRaw } from "vue";
import { t } from "../../texts";
import type { DockTab } from "../assetDock/dockTab";
import SceneRulesPanel from "./SceneRulesPanel.vue";
import type { SceneRulesParts } from "./useSceneRules";
import "./rules.css";

/** The dock tab of the rules over the rule check of the page core. */
export function rulesTab(parts: SceneRulesParts): DockTab {
  // The editor and the open sequence have private fields: a reactive proxy of them cannot read them.
  return {
    id: "rules",
    label: t("dock-tab-rules"),
    component: markRaw(SceneRulesPanel),
    props: { parts: markRaw(parts) },
  };
}
