// SPDX-License-Identifier: Apache-2.0
/**
 * The named groups of the lab page: the built-in groups of groups.ts and the groups of the owner. The URL keeps the
 * groups of the owner (`groups=<name>:<slot>,<slot>;…`). They are a view setting of the lab, not a frame input. Alt+G
 * (`selection.group`) selects the group of the selected prop. `group.save` and `group.remove` change the groups of the
 * owner.
 */
import { getCurrentInstance, onBeforeUnmount, onMounted, shallowRef, type ShallowRef } from "vue";
import type { KeyRun } from "../edit/useSceneEdit";
import { typingInto } from "../labUi";
import type { GroupsHost } from "./commandKit";
import { allGroups, GROUPS_PARAM, groupsText, parseGroups, withGroup, type PropGroup } from "./groups";

export interface GroupTool {
  /** The groups of the owner. */
  readonly own: ShallowRef<readonly PropGroup[]>;
  /** All groups: the built-in groups, then the groups of the owner. */
  all(): PropGroup[];
  readonly host: GroupsHost;
}

/** Keep the groups of the owner in the URL. */
function keepUrl(groups: readonly PropGroup[]): void {
  const url = new URL(globalThis.location.href);
  const text = groupsText(groups);
  if (text === "") url.searchParams.delete(GROUPS_PARAM);
  else url.searchParams.set(GROUPS_PARAM, text);
  globalThis.history.replaceState(globalThis.history.state, "", url);
}

function useGroupKey(run: KeyRun): void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.code !== "KeyG" || !event.altKey || event.repeat || event.metaKey || event.ctrlKey) return;
    if (typingInto(event.target)) return;
    event.preventDefault();
    run("selection.group");
  };
  if (getCurrentInstance() === null) return;
  onMounted(() => {
    globalThis.addEventListener("keydown", onKey);
  });
  onBeforeUnmount(() => {
    globalThis.removeEventListener("keydown", onKey);
  });
}

export function useGroups(parts: {
  readonly params: URLSearchParams;
  readonly run: KeyRun;
  /** Listen to Alt+G (default: true). The tests set false. */
  readonly keys?: boolean;
}): GroupTool {
  const own = shallowRef<readonly PropGroup[]>(parseGroups(parts.params.get(GROUPS_PARAM)));
  const set = (next: readonly PropGroup[]): void => {
    own.value = next;
    keepUrl(next);
  };
  const host: GroupsHost = {
    save: (name, props) => {
      set(withGroup(own.value, name, props));
      return allGroups(own.value);
    },
    remove: (name) => {
      const next = own.value.filter((group) => group.name !== name);
      if (next.length === own.value.length) return false;
      set(next);
      return true;
    },
  };
  if (parts.keys !== false) useGroupKey(parts.run);
  return { own, all: () => allGroups(own.value), host };
}
