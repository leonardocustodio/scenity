// SPDX-License-Identifier: Apache-2.0
/**
 * The Performance panel of the editor window over the script API of the page: the frame statistics (`__scenity.stats`)
 * and the inspect report (`__scenity.inspect`). A click on an entity selects it. The Bench panel works over the bench
 * runner of the dev server, and the Budgets panel edits the budgets.
 */
import type { StudioShell } from "../../studio/shell/shell";
import type { PageSelectionPort } from "../inspector/startInspector";
import BenchPanel from "./BenchPanel.vue";
import BudgetsPanel from "../budgets/BudgetsPanel.vue";
import PerformancePanel from "./PerformancePanel.vue";

/** Start the Performance panel and the Bench panel of the project folder `base`. */
export function startPerformance(
  shell: Pick<StudioShell, "setPanel" | "showPanel">,
  selection: PageSelectionPort | undefined,
  base: string,
): void {
  shell.setPanel("bench", { component: BenchPanel, props: { base } });
  // The budgets editor.
  shell.setPanel("budgets", { component: BudgetsPanel, props: { base, open: (id: string) => shell.showPanel(id) } });
  shell.setPanel("performance", {
    component: PerformancePanel,
    props: {
      readStats: () => globalThis.__scenity?.stats() ?? Promise.resolve(null),
      inspect: () => globalThis.__scenity?.inspect?.() ?? Promise.resolve(null),
      select: (id: string) => selection?.set([id]),
    },
  });
}
