// SPDX-License-Identifier: Apache-2.0
/**
 * The key command of the hierarchy panel: F2 opens the rename field of the row
 * with the focus, else of the first selected entity. The key acts in the key context "hierarchy" (the panel element).
 */
import { t } from "../../texts";
import type { PageKeyCommandSpec } from "../settings/pageKeys";
import type { HierarchyState } from "./hierarchyState";
import type { SelectionPort } from "./sceneCommands";

const ROW_PREFIX = "hierarchy-row-";

/** The ID of the entity of the hierarchy row with the focus, or null. */
function focusedRow(): string | null {
  const row = document.activeElement?.closest<HTMLElement>(`[data-testid^='${ROW_PREFIX}']`);
  return row?.dataset.testid?.slice(ROW_PREFIX.length) ?? null;
}

/** The page command `hierarchy.rename` (F2). */
export function renameCommand(state: HierarchyState, selection: SelectionPort): PageKeyCommandSpec {
  const target = (): string | null => focusedRow() ?? selection.ids[0] ?? null;
  return {
    id: "hierarchy.rename",
    title: t("hierarchy-rename-command"),
    keys: ["F2"],
    keyContext: "hierarchy",
    when: () => (target() === null ? t("hierarchy-rename-none") : null),
    run: () => {
      const id = target();
      if (id !== null) state.startRename(id);
    },
  };
}
