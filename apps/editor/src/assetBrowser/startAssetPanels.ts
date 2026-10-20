// SPDX-License-Identifier: Apache-2.0
/**
 * The asset panels of the editor window over the dev server of the project of the page: the asset build panel
 * (scripts/buildApiServer.ts), the Rights panel (scripts/rightsApi.ts), the Approvals panel (scripts/approvalsApi.ts),
 * the release check panel (scripts/releaseApi.ts) and the Export panel (scripts/exportApi.ts).
 */
import type { StudioShell } from "../studio/shell/shell";
import { devServerAssets } from "./assetClient";
import ApprovalsPanel from "./approvals/ApprovalsPanel.vue";
import ExportPanel from "./export/ExportPanel.vue";
import AssetBuildPanel from "./build/AssetBuildPanel.vue";
import ReleasePanel from "./release/ReleasePanel.vue";
import RightsPanel from "./rights/RightsPanel.vue";

/**
 * Start the asset panels for the project folder `base` (its URL, with a "/" at the end). `scene` gives the path of the
 * open scene (the default scene of an export).
 */
export function startAssetPanels(
  shell: Pick<StudioShell, "setPanel" | "showPanel">,
  base: string,
  scene: () => string,
): void {
  const source = devServerAssets(base);
  shell.setPanel("assetBuild", { component: AssetBuildPanel, props: { source } });
  shell.setPanel("rights", { component: RightsPanel, props: { source } });
  shell.setPanel("approvals", { component: ApprovalsPanel, props: { source } });
  shell.setPanel("export", { component: ExportPanel, props: { source, scene } });
  shell.setPanel("release", {
    component: ReleasePanel,
    props: { source, open: (panel: string) => shell.showPanel(panel) },
  });
}
